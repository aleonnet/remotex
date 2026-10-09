// What the tests share: the examples both sides of the app's contract read, a
// runner that answers from a script, and a server of the test's own.

import Foundation
import Network
import XCTest
@testable import AlumiaCore

/// One of the examples in Tests/Fixtures, which the gateway's tests read too.
func fixture(_ name: String, file: StaticString = #filePath) -> String {
    let fixtures = URL(fileURLWithPath: "\(file)").deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Fixtures")
    guard let text = try? String(contentsOf: fixtures.appendingPathComponent(name), encoding: .utf8) else {
        XCTFail("no example named \(name) in \(fixtures.path)")
        return ""
    }
    return text
}

/// JSON as something two of which are equal whatever the order of their keys.
func parsed(_ text: String, file: StaticString = #filePath, line: UInt = #line) -> NSObject {
    guard let value = try? JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed]) as? NSObject else {
        XCTFail("not JSON: \(text)", file: file, line: line)
        return NSNull()
    }
    return value
}

let portuguese = Words(.portuguese)
let english = Words(.english)

extension Words {
    /// A text with nothing to fill, for a list of keys read one by one.
    func said(_ key: String) -> String {
        say(key)
    }
}

/// A runner that answers from a script, in order, and remembers what it was
/// asked to run.
final class Scripted: Runner, @unchecked Sendable {
    private let lock = NSLock()
    private var answers: [Ran]
    private var commands: [Command] = []

    init(_ answers: [Ran]) {
        self.answers = answers
    }

    var asked: [Command] {
        lock.withLock { commands }
    }

    func run(_ command: Command) async -> Ran {
        lock.withLock {
            commands.append(command)
            return answers.isEmpty ? Ran(status: nil, errors: "nothing more was scripted") : answers.removeFirst()
        }
    }
}

/// The lines a command said, as they were heard.
final class Lines: @unchecked Sendable {
    private let lock = NSLock()
    private var heard: [String] = []

    func add(_ line: String) {
        lock.withLock { heard.append(line) }
    }

    var all: [String] {
        lock.withLock { heard }
    }
}

/// A script where an executable is, for what has to be a real process.
func script(_ body: String) throws -> URL {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("alumia-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let file = folder.appendingPathComponent("stand-in")
    try "#!/bin/sh\n\(body)\n".write(to: file, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: file.path)
    return file
}

/// A server on this Mac that says one thing to whoever connects, or nothing.
final class LocalServer: @unchecked Sendable {
    enum Says {
        /// An HTTP answer with this body.
        case answer(String)
        /// It takes the connection and never answers.
        case nothing
    }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "alumia.test.server")
    let port: Int

    init(_ says: Says) throws {
        let listener = try NWListener(using: .tcp, on: .any)
        self.listener = listener
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            if case .ready = state {
                ready.signal()
            }
        }
        listener.newConnectionHandler = { [queue] connection in
            connection.start(queue: queue)
            switch says {
            case .nothing:
                // Kept, so that it stays open and silent.
                Self.keep(connection)
            case .answer(let body):
                connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { _, _, _, _ in
                    let answer = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
                    connection.send(content: Data(answer.utf8), completion: .contentProcessed { _ in
                        connection.cancel()
                    })
                }
            }
        }
        listener.start(queue: queue)
        guard ready.wait(timeout: .now() + 5) == .success, let port = listener.port?.rawValue else {
            throw CocoaError(.featureUnsupported)
        }
        self.port = Int(port)
    }

    private static let kept = Kept()

    private static func keep(_ connection: NWConnection) {
        kept.add(connection)
    }

    var address: URL {
        URL(string: "http://127.0.0.1:\(port)")!
    }

    deinit {
        listener.cancel()
    }
}

/// The connections a silent server holds open for as long as the tests run.
private final class Kept: @unchecked Sendable {
    private let lock = NSLock()
    private var connections: [NWConnection] = []

    func add(_ connection: NWConnection) {
        lock.lock()
        connections.append(connection)
        lock.unlock()
    }
}
