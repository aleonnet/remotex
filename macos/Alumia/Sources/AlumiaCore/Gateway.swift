// The gateway the app hosts, as the app reads and changes it.
//
// The app holds no reader of the settings file and no opinion on what a valid one
// is: it asks the gateway's own binary (`alumia app …`, src/app.rs), which answers
// one line of JSON, and a refusal comes back already said in the app's language.
// What is written here is the shape of those answers, and the examples both sides
// are tested against are the same files (Tests/Fixtures).

import Foundation

/// Why not, as the gateway says it: the catalogue's code, its sentence in the
/// language asked for, and the gateway's own words for whoever wants them.
public struct Refusal: Codable, Sendable, Equatable, Error {
    public var code: String
    public var says: String
    public var detail: String

    public init(code: String, says: String, detail: String) {
        self.code = code
        self.says = says
        self.detail = detail
    }
}

/// What the hosted gateway is doing (`alumia app status`).
public struct GatewayStatus: Codable, Sendable, Equatable {
    public var version: String
    /// Whether the page is being served.
    public var serving: Bool
    /// Where, as the settings write it.
    public var listen: String?
    /// The computer the open session is on, by the name the settings give it.
    public var session: String?
    /// Whether this Mac has the FFmpeg a Mac's picture is decoded with.
    public var ffmpeg: Bool
    /// Why the page is not being served.
    public var cause: Refusal?
    /// Its owner stopped it: it serves nothing, by choice, until it is started.
    public var stopped: Bool
    /// Whether it was started from the binary that is in this bundle now. The
    /// gateway does not say it: the command the app asks it by does, which is
    /// that binary (`told_current`, src/app.rs). False after the app was put in
    /// the place of an older one whose gateway still runs (`Renewal`); nothing
    /// where nothing was said.
    public var current: Bool?

    public init(version: String, serving: Bool, listen: String? = nil, session: String? = nil,
                ffmpeg: Bool, cause: Refusal? = nil, stopped: Bool = false) {
        self.version = version
        self.serving = serving
        self.stopped = stopped
        self.listen = listen
        self.session = session
        self.ffmpeg = ffmpeg
        self.cause = cause
    }

    /// The cause that is no fault: nobody has set this Mac up yet.
    public static let notSetUp = "AL-9901"
    /// The cause of a port the gateway could not take: another program has it.
    public static let portTaken = "AL-9411"
}

/// A computer of the settings, as shown: every key it has but its secrets, of
/// which only that they are there.
public struct ShownComputer: Codable, Sendable, Equatable {
    public var name: String
    public var kind: String
    public var subtype: String?
    public var host: String
    public var port: Int?
    public var username: String?
    /// How many displays it opens with, where the settings say: two, on a Windows
    /// host and in a Mac's Virtual mode, is a second one in a browser tab of its own.
    public var virtualDisplays: Int?
    public var hasPassword: Bool
    public var hasVncPassword: Bool

    enum CodingKeys: String, CodingKey {
        case name, kind = "protocol", subtype, host, port, username, virtualDisplays = "virtual_displays"
        case hasPassword, hasVncPassword
    }

    public init(name: String, kind: String, subtype: String? = nil, host: String, port: Int? = nil,
                username: String? = nil, virtualDisplays: Int? = nil, hasPassword: Bool = false,
                hasVncPassword: Bool = false) {
        self.name = name
        self.kind = kind
        self.subtype = subtype
        self.host = host
        self.port = port
        self.username = username
        self.virtualDisplays = virtualDisplays
        self.hasPassword = hasPassword
        self.hasVncPassword = hasVncPassword
    }
}

/// The settings as the app shows them (`alumia app config-show`).
public struct Shown: Codable, Sendable, Equatable {
    /// Whether there are settings at all: false on a Mac nobody has set up.
    public var configured: Bool
    public var listen: String
    /// Who signs in to the page.
    public var username: String?
    /// What the page calls this gateway, where the settings say.
    public var brand: String?
    /// Whether the throughput is recorded.
    public var meter: Bool
    public var computers: [ShownComputer]

    public init(configured: Bool, listen: String, username: String? = nil, brand: String? = nil,
                meter: Bool = false, computers: [ShownComputer] = []) {
        self.configured = configured
        self.listen = listen
        self.username = username
        self.brand = brand
        self.meter = meter
        self.computers = computers
    }

    /// The port of `listen`, where it is an address with one.
    public var port: Int? {
        listen.split(separator: ":").last.flatMap { Int($0) }
    }
}

/// A computer in a change: the keys the app keeps, all of them, so that one the
/// computer no longer has is taken away (a Mac that became a Windows host has no
/// subtype), and the password only where one was typed: left out, the gateway
/// keeps the one it has. One nobody touched is written by its name alone
/// (`Computers.saving`).
public struct ChangedComputer: Sendable, Equatable {
    public var name: String
    /// The name it had, where it was renamed: what the gateway finds it by.
    public var was: String?
    public var kind: String
    public var subtype: String?
    public var host: String
    public var port: Int
    public var username: String?
    public var password: String?
    /// Two, where it opens with a second display; none where it opens with one,
    /// which takes the key away.
    public var virtualDisplays: Int?
    /// Nobody touched it: only its name is written, by which the gateway keeps
    /// every key it has, the ones the app does not know among them.
    public var untouched = false
    /// It is another computer in the place of the one it is found by: the
    /// gateway keeps no key of that one, its passwords least of all.
    public var fresh = false

    public init(name: String, was: String? = nil, kind: String, subtype: String? = nil, host: String,
                port: Int, username: String? = nil, password: String? = nil, virtualDisplays: Int? = nil) {
        self.name = name
        self.was = was
        self.kind = kind
        self.subtype = subtype
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.virtualDisplays = virtualDisplays
    }
}

extension ChangedComputer: Encodable {
    enum CodingKeys: String, CodingKey {
        case name, was, fresh, kind = "protocol", subtype, host, port, username, password
        case virtualDisplays = "virtual_displays"
    }

    public func encode(to encoder: Encoder) throws {
        var keys = encoder.container(keyedBy: CodingKeys.self)
        try keys.encode(name, forKey: .name)
        if untouched {
            return
        }
        if fresh {
            try keys.encode(true, forKey: .fresh)
        }
        try keys.encodeIfPresent(was, forKey: .was)
        try keys.encode(kind, forKey: .kind)
        // A null takes the key away, which leaving it out would not.
        try keys.encode(subtype, forKey: .subtype)
        try keys.encode(host, forKey: .host)
        try keys.encode(port, forKey: .port)
        try keys.encode(username, forKey: .username)
        try keys.encodeIfPresent(password, forKey: .password)
        try keys.encode(virtualDisplays, forKey: .virtualDisplays)
    }
}

/// What the app asks to be different in the settings (`alumia app config-apply`).
/// Whatever it leaves out stays as it is.
public struct Change: Encodable, Sendable, Equatable {
    public struct Login: Encodable, Sendable, Equatable {
        public var username: String
        public var password: String

        public init(username: String, password: String) {
            self.username = username
            self.password = password
        }
    }

    /// Where the page is served.
    public var listen: String?
    /// Who signs in to the page.
    public var login: Login?
    /// What the page calls this gateway. Empty is the name it has by itself.
    public var brand: String?
    /// Whether the throughput is recorded.
    public var meter: Bool?
    /// Every computer, in the order of the list: one left out is removed.
    public var computers: [ChangedComputer]?

    public init(listen: String? = nil, login: Login? = nil, brand: String? = nil, meter: Bool? = nil,
                computers: [ChangedComputer]? = nil) {
        self.listen = listen
        self.login = login
        self.brand = brand
        self.meter = meter
        self.computers = computers
    }

    /// The change as the gateway reads it.
    public func json() -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        // Strings, numbers and nulls: nothing here fails to encode.
        return (try? encoder.encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
    }
}

/// The gateway's binary inside the app's bundle, asked as the app asks it.
public struct Gateway: Sendable {
    /// `Contents/Helpers/alumia`.
    public var binary: URL
    public var runner: any Runner
    public var language: Language
    /// What the binary is run with: a copy of the app made for testing names its
    /// own folder here (`ALUMIA_APP_DIR`), and the installed one names nothing.
    public var environment: [String: String]?

    public init(binary: URL, runner: any Runner = SystemRunner(), language: Language,
                environment: [String: String]? = nil) {
        self.binary = binary
        self.runner = runner
        self.language = language
        self.environment = environment
    }

    /// The command of one request. A change goes on `input`, where its passwords
    /// are nobody else's to read.
    public func command(_ asked: String, input: String? = nil) -> Command {
        Command(binary, ["app", "--language", language.rawValue, asked], input: input,
                environment: environment, limit: 30)
    }

    private struct Refused: Decodable {
        var refused: Refusal
    }

    /// What one line the binary printed says: its answer, or its refusal.
    public static func read<Answer: Decodable>(_ ran: Ran, as _: Answer.Type, words: Words) -> Result<Answer, Refusal> {
        let line = Data(ran.output.trimmingCharacters(in: .whitespacesAndNewlines).utf8)
        let decoder = JSONDecoder()
        if let refused = try? decoder.decode(Refused.self, from: line) {
            return .failure(refused.refused)
        }
        if ran.succeeded, let answer = try? decoder.decode(Answer.self, from: line) {
            return .success(answer)
        }
        // Not started, ended at its limit, or printed what is not an answer: the
        // app's own word for a gateway it could not ask.
        let said = words.message("AL-1800")?.text ?? ""
        let detail = ran.errors.isEmpty ? ran.output : ran.errors
        return .failure(Refusal(code: "AL-1800", says: said, detail: detail.trimmingCharacters(in: .whitespacesAndNewlines)))
    }

    private func ask<Answer: Decodable>(_ asked: String, input: String? = nil, as kind: Answer.Type) async -> Result<Answer, Refusal> {
        Self.read(await runner.run(command(asked, input: input)), as: kind, words: Words(language))
    }

    public func status() async -> Result<GatewayStatus, Refusal> {
        await ask("status", as: GatewayStatus.self)
    }

    public func show() async -> Result<Shown, Refusal> {
        await ask("config-show", as: Shown.self)
    }

    private struct Applied: Decodable {
        var applied: Bool
    }

    private struct Reloaded: Decodable {
        var reloaded: Bool
    }

    private struct Ended: Decodable {
        var ended: Bool
    }

    /// Make `change` in the settings, and have the running gateway take them.
    /// Where none is running the settings are changed all the same, and the next
    /// one to start serves them.
    public func apply(_ change: Change) async -> Result<Void, Refusal> {
        switch await ask("config-apply", input: change.json(), as: Applied.self) {
        case .failure(let refusal): return .failure(refusal)
        case .success: break
        }
        _ = await ask("reload", as: Reloaded.self)
        return .success(())
    }

    /// End the open session from this Mac, reporting whether there was one.
    public func endSession() async -> Result<Bool, Refusal> {
        await ask("end-session", as: Ended.self).map(\.ended)
    }

    private struct Stood: Decodable {
        var stopped: Bool
    }

    /// Stop Alumia: the page closes and the open session ends, and the gateway
    /// stands, serving nothing, until it is started. Where none is running the
    /// next one to start finds itself stopped.
    public func stop() async -> Result<Void, Refusal> {
        await ask("stop", as: Stood.self).map { _ in }
    }

    /// Start an Alumia that was stopped.
    public func start() async -> Result<Void, Refusal> {
        await ask("start", as: Stood.self).map { _ in }
    }
}
