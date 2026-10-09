// The computers of this Mac's network, and macOS's leave to reach them.
//
// macOS asks its owner before an app reaches a computer of the local network,
// and the gateway is the one that reaches them. It is a launch agent, which
// Apple's note on local network privacy does not exempt ("The exception for
// launchd daemons doesn't apply to launchd agents", TN3179), and it speaks
// through BSD sockets, where a refusal comes with no question asked: the
// connection fails and nobody is told why. The same note says how the question
// is brought up ("There's no API to explicitly bring up the local network alert
// (FB8711182), but you can do this implicitly by performing a local network
// operation") and whose it is ("if your app spawns a helper tool and the helper
// tool performs a local network operation, macOS considers the app to be the
// responsible code", which it uses to "Record the user's choice for the whole
// app, not just that specific helper tool").
//
// So the app, which has a window and the Network framework, tries each computer
// of the settings that is somewhere else: that is what makes macOS ask in
// Alumia's name, and a try macOS refuses is the one answer that becomes a notice.
// This file is who is tried and what each answer means; the screen makes the
// connection (`Reaching`, in the app).

import Foundation

/// A place a computer of the settings is reached at.
public struct Place: Sendable, Equatable, Hashable {
    public var host: String
    public var port: Int

    public init(host: String, port: Int) {
        self.host = host
        self.port = port
    }
}

/// How one try ended.
public enum Reach: Sendable, Equatable {
    /// Something accepted the connection.
    case reached
    /// macOS refused it: its owner answered no, or turned Alumia off under
    /// Privacy & Security, Local Network.
    case denied
    /// Nothing answered in time: off, away, or an address that leads nowhere.
    /// Nobody's permission is missing for that.
    case silent
}

public enum LocalNetwork {
    /// What this Mac is called from itself, which macOS asks nobody about.
    static let own: Set<String> = ["127.0.0.1", "localhost", "::1"]

    /// The places worth trying: every computer of the settings that is not this
    /// Mac, each once, in the order of the list.
    public static func tried(_ rows: [ComputerRow]) -> [Place] {
        var seen = Set<Place>()
        return rows
            .filter { !own.contains($0.host.lowercased()) && !$0.host.isEmpty }
            .map { Place(host: $0.host, port: $0.port) }
            .filter { seen.insert($0).inserted }
    }

    /// How long between two rounds of tries while a window is open: a computer
    /// that is off takes its whole limit to say nothing.
    public static let every: TimeInterval = 30

    /// Whether the computers are tried now. With a window `shown`: the first
    /// time, after a change to them, which forgets the last time, and then once
    /// in `every`. With none, nobody is there to be asked anything, and they are
    /// not tried. While macOS is refusing, each look tries again, with a window
    /// or without: a try made with the question still on screen is refused
    /// before its owner answers, and the notice of it should go as soon as they
    /// allow, wherever they are then. A refusal answers at once, and costs no
    /// wait.
    public static func due(last: Date?, now: Date, denied: Bool, shown: Bool) -> Bool {
        if denied { return true }
        guard shown else { return false }
        guard let last else { return true }
        return now.timeIntervalSince(last) >= every
    }

    /// Whether macOS is keeping Alumia from this Mac's network: one try it
    /// refused says so, whatever the others answered.
    public static func denied(_ answers: [Reach]) -> Bool {
        answers.contains(.denied)
    }
}
