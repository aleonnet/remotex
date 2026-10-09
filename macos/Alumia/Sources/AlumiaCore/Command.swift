// Running a command and reading what it says: the gateway's own (`alumia app …`),
// Tailscale's and Homebrew's.
//
// Everything the app knows about what is outside it comes through here, as text a
// test can give in a command's place. What goes to a command that is a secret
// goes on its standard input and never among its arguments: every process on the
// machine reads another's arguments.

import Foundation

/// What a command did.
public struct Ran: Sendable, Equatable {
    /// Its exit status, or `nil` where it could not be started at all.
    public var status: Int32?
    /// It was still running at its limit, and was ended.
    public var timedOut: Bool
    public var output: String
    public var errors: String

    public init(status: Int32?, timedOut: Bool = false, output: String = "", errors: String = "") {
        self.status = status
        self.timedOut = timedOut
        self.output = output
        self.errors = errors
    }

    /// It ran to its end and said it succeeded.
    public var succeeded: Bool { status == 0 && !timedOut }
}

/// A command to run.
public struct Command: Sendable, Equatable {
    public var executable: URL
    public var arguments: [String]
    /// What it reads on its standard input, which is closed after it.
    public var input: String?
    /// Its whole environment, or the app's own where `nil`.
    public var environment: [String: String]?
    /// How long it may run. One that prompts and waits, as Tailscale does when it
    /// wants HTTPS enabled, is ended there.
    public var limit: TimeInterval?

    public init(_ executable: URL, _ arguments: [String] = [], input: String? = nil,
                environment: [String: String]? = nil, limit: TimeInterval? = nil) {
        self.executable = executable
        self.arguments = arguments
        self.input = input
        self.environment = environment
        self.limit = limit
    }
}

/// Whoever runs commands: the system, or a test's script of answers.
public protocol Runner: Sendable {
    func run(_ command: Command) async -> Ran
    /// Run `command`, and hand `said` each line it says as it says it: what an
    /// installation that takes minutes shows meanwhile.
    func run(_ command: Command, said: @escaping @Sendable (String) -> Void) async -> Ran
}

extension Ran {
    /// What it printed and then what it complained of, a line at a time, without
    /// the empty ones.
    public var lines: [String] {
        (output + "\n" + errors).split(whereSeparator: \.isNewline).map(String.init)
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }
}

extension Runner {
    /// A runner that hears nothing meanwhile says it all at the end.
    public func run(_ command: Command, said: @escaping @Sendable (String) -> Void) async -> Ran {
        let ran = await run(command)
        ran.lines.forEach(said)
        return ran
    }
}

/// A value another thread is handed whole: what the system's own process and
/// pipe types are while this file starts and ends them from one place.
private struct Handed<Value>: @unchecked Sendable {
    let value: Value
}

/// A flag two threads share.
private final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var raised = false

    func raise() {
        lock.lock()
        raised = true
        lock.unlock()
    }

    var isRaised: Bool {
        lock.lock()
        defer { lock.unlock() }
        return raised
    }
}

private final class Collected: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()

    func set(_ read: Data) {
        lock.lock()
        data = read
        lock.unlock()
    }

    var text: String {
        lock.lock()
        defer { lock.unlock() }
        return String(decoding: data, as: UTF8.self)
    }
}

/// The system's own processes.
public struct SystemRunner: Runner {
    public init() {}

    public func run(_ command: Command) async -> Ran {
        await run(command, hearing: nil)
    }

    public func run(_ command: Command, said: @escaping @Sendable (String) -> Void) async -> Ran {
        await run(command, hearing: said)
    }

    private func run(_ command: Command, hearing said: (@Sendable (String) -> Void)?) async -> Ran {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: Self.wait(for: command, said: said))
            }
        }
    }

    /// Everything `pipe` is written, read to its end; with `said`, each line of
    /// it handed over as soon as it is whole, and at the end whatever was left
    /// without one.
    private static func all(of pipe: FileHandle, said: (@Sendable (String) -> Void)?) -> Data {
        guard let said else { return pipe.readDataToEndOfFile() }
        var (read, unsaid) = (Data(), Data())
        func say(_ line: Data) {
            let text = String(decoding: line, as: UTF8.self)
            if !text.trimmingCharacters(in: .whitespaces).isEmpty {
                said(text)
            }
        }
        while true {
            let some = pipe.availableData
            if some.isEmpty {
                break
            }
            read.append(some)
            unsaid.append(some)
            // A line ends at a line feed, or at the carriage return a progress
            // line is written over.
            while let end = unsaid.firstIndex(where: { $0 == 0x0A || $0 == 0x0D }) {
                say(unsaid[unsaid.startIndex..<end])
                unsaid.removeSubrange(unsaid.startIndex...end)
            }
        }
        say(unsaid)
        return read
    }

    /// Run `command` to its end, or to its limit, on the calling thread.
    private static func wait(for command: Command, said: (@Sendable (String) -> Void)?) -> Ran {
        let process = Process()
        process.executableURL = command.executable
        process.arguments = command.arguments
        if let environment = command.environment {
            process.environment = environment
        }
        let (input, output, errors) = (Pipe(), Pipe(), Pipe())
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errors
        do {
            try process.run()
        } catch {
            return Ran(status: nil, errors: error.localizedDescription)
        }

        let timedOut = Flag()
        let handed = Handed(value: process)
        var watch: DispatchWorkItem?
        if let limit = command.limit {
            let item = DispatchWorkItem {
                guard handed.value.isRunning else { return }
                timedOut.raise()
                handed.value.terminate()
                // One that ignores being asked is not waited on.
                DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
                    if handed.value.isRunning {
                        kill(handed.value.processIdentifier, SIGKILL)
                    }
                }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + limit, execute: item)
            watch = item
        }

        if let text = command.input {
            // A command that ended without reading is not an error of the writing,
            // and must not be this process's end: writing to a pipe nobody reads
            // is a signal that ends the writer, unless the pipe is told to make
            // it an error instead.
            _ = fcntl(input.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1)
            try? input.fileHandleForWriting.write(contentsOf: Data(text.utf8))
        }
        try? input.fileHandleForWriting.close()

        // Both read to their end, and each on its own thread: a command that
        // fills one pipe while only the other is read would never end.
        let complained = Collected()
        let reading = DispatchGroup()
        let errorsEnd = Handed(value: errors.fileHandleForReading)
        DispatchQueue.global().async(group: reading) {
            complained.set(all(of: errorsEnd.value, said: said))
        }
        let printed = all(of: output.fileHandleForReading, said: said)
        reading.wait()
        process.waitUntilExit()
        watch?.cancel()
        return Ran(
            status: process.terminationStatus,
            timedOut: timedOut.isRaised,
            output: String(decoding: printed, as: UTF8.self),
            errors: complained.text
        )
    }
}
