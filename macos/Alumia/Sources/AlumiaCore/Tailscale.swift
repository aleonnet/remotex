// Tailscale on this Mac: which of the mockup's five states it is in, where the
// page is published, and publishing it.
//
// Nobody presses a button to publish: the publication follows the gateway
// (`Publication`). With Tailscale ready and Alumia on, the page is published;
// stopped, or with its owner not wanting it reached from other devices, it is
// taken back. The one thing the app does not do by itself is take an address
// that already leads somewhere else of its owner's (`TailscaleState.taken`).
//
// A copy of the app made for testing is given no command at all (`find`): it
// reads nothing of the owner's Tailscale and changes nothing in it.
//
// The app calls Tailscale's own command, which is what its documentation gives
// (`tailscale status --json`, `tailscale serve`). The JSON says of itself
// "(WARNING: format subject to change)", so it is read in this one file, by the
// few fields named here, and anything it stops saying is the state before it.
//
// Two of the five states are read from this Mac's own answers, with the names
// taken out (Tests/Fixtures/tailscale-*.json). The other three were not seen:
// seeing them would mean signing the owner's account out or switching HTTPS off
// in their network. They come from the definitions in Tailscale 1.102.4's source
// (`ipn/ipnstate/ipnstate.go`: the seven values of `BackendState`, and
// `CertDomains`, "the set of DNS names for which the control plane server will
// assist with provisioning TLS certificates").

import Foundation

/// Tailscale on this Mac, as the mockup tells it apart.
public enum TailscaleState: Sendable, Equatable {
    /// No command to ask.
    case missing
    /// Installed, and not connected to an account: any state but running.
    case signedOut
    /// Connected, in a network with no HTTPS certificates to give.
    case noHTTPS
    /// Connected, with certificates, and what it has published could not be
    /// read: nothing is decided from it, and it is asked again.
    case unread
    /// Connected, with certificates: the page can be published.
    case ready
    /// This Mac's address in the network already leads to something else, which
    /// is said as Tailscale names it. Publishing would take its place.
    case taken(String)
    /// Published, at this address.
    case published(String)

    /// The name the mockup's texts are keyed by.
    public var name: String {
        switch self {
        case .missing: "missing"
        case .signedOut: "signed-out"
        case .noHTTPS: "no-https"
        case .unread: "unread"
        case .ready: "ready"
        case .taken: "taken"
        case .published: "published"
        }
    }
}

/// A device of the network, as `tailscale status --json` lists it.
public struct TailscaleDevice: Decodable, Sendable, Equatable {
    /// What the device calls itself. Not a DNS name, and not unique.
    public var hostName: String
    /// Its full name in the network, which ends with a dot.
    public var dnsName: String
    public var os: String
    /// Whether it is connected to the network's control plane.
    public var online: Bool

    enum CodingKeys: String, CodingKey {
        case hostName = "HostName", dnsName = "DNSName", os = "OS", online = "Online"
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: CodingKeys.self)
        hostName = try keys.decodeIfPresent(String.self, forKey: .hostName) ?? ""
        dnsName = try keys.decodeIfPresent(String.self, forKey: .dnsName) ?? ""
        os = try keys.decodeIfPresent(String.self, forKey: .os) ?? ""
        online = try keys.decodeIfPresent(Bool.self, forKey: .online) ?? false
    }

    public init(hostName: String, dnsName: String, os: String, online: Bool) {
        self.hostName = hostName
        self.dnsName = dnsName
        self.os = os
        self.online = online
    }

    /// The device's name as an address is written with it: no dot at the end.
    public var address: String {
        dnsName.hasSuffix(".") ? String(dnsName.dropLast()) : dnsName
    }
}

/// What `tailscale status --json` says, as far as the app reads it.
public struct TailscaleStatus: Decodable, Sendable, Equatable {
    public var backendState: String
    public var certDomains: [String]
    public var own: TailscaleDevice?
    public var peers: [TailscaleDevice]

    enum CodingKeys: String, CodingKey {
        case backendState = "BackendState", certDomains = "CertDomains", own = "Self", peers = "Peer"
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: CodingKeys.self)
        backendState = try keys.decodeIfPresent(String.self, forKey: .backendState) ?? ""
        certDomains = try keys.decodeIfPresent([String].self, forKey: .certDomains) ?? []
        own = try keys.decodeIfPresent(TailscaleDevice.self, forKey: .own)
        // Keyed by each device's public key, which is of no use here; in the order
        // of their names, so that the same network is the same list.
        let byKey = try keys.decodeIfPresent([String: TailscaleDevice].self, forKey: .peers) ?? [:]
        peers = byKey.values.sorted { $0.dnsName < $1.dnsName }
    }

    public static func read(_ json: String) -> TailscaleStatus? {
        try? JSONDecoder().decode(TailscaleStatus.self, from: Data(json.utf8))
    }
}

/// What `tailscale serve status --json` says: each address published, and the
/// local server it leads to.
public struct TailscaleServe: Decodable, Sendable, Equatable {
    struct Site: Decodable, Sendable, Equatable {
        struct Handler: Decodable, Sendable, Equatable {
            var proxy: String?
            /// A folder or a file served, where the address leads to one.
            var path: String?

            enum CodingKeys: String, CodingKey {
                case proxy = "Proxy", path = "Path"
            }
        }

        var handlers: [String: Handler]?

        enum CodingKeys: String, CodingKey {
            case handlers = "Handlers"
        }
    }

    var web: [String: Site]?

    enum CodingKeys: String, CodingKey {
        case web = "Web"
    }

    public static func read(_ json: String) -> TailscaleServe? {
        try? JSONDecoder().decode(TailscaleServe.self, from: Data(json.utf8))
    }

    /// What an address handed to the local server at `port` is written as.
    private static func local(_ port: Int) -> [String] {
        ["http://127.0.0.1:\(port)", "http://localhost:\(port)", "127.0.0.1:\(port)", "localhost:\(port)"]
    }

    /// The root of this Mac's `https` address, by its name: the one address
    /// `serve --bg <port>` publishes at, and `serve --bg <port> off` takes back.
    /// Another port of the address is another address, which neither touches:
    /// what somebody published there by hand is theirs, whatever it leads to.
    private var roots: [(host: String, root: Site.Handler)] {
        (web ?? [:]).sorted(by: { $0.key < $1.key }).compactMap { site, served in
            guard site.hasSuffix(":443"), let root = served.handlers?["/"] else { return nil }
            return (String(site.dropLast(4)), root)
        }
    }

    /// The `https` address that leads to the local server at `port`, where one is
    /// published: the one whose root is handed to that port of this Mac.
    public func address(for port: Int) -> String? {
        roots.first { $0.root.proxy.map(Self.local(port).contains) ?? false }.map { "https://\($0.host)" }
    }

    /// What the root of this Mac's `https` address leads to, where that is not
    /// the local server at `port`: the address publishing would use is in use,
    /// and publishing would take it from whatever has it.
    public func taken(from port: Int) -> String? {
        roots.first { !($0.root.proxy.map(Self.local(port).contains) ?? false) }.map { $0.root.proxy ?? $0.root.path ?? "" }
    }
}

extension TailscaleState {
    /// The state, from what the two questions answered. `status` is `nil` where
    /// the command answered nothing that reads: installed, and not saying it is
    /// running. `serve` is `nil` where what is published could not be read, which
    /// is not the same as nothing being published: the address may be in use, so
    /// it is not called ready. With nothing published the command says so, as an
    /// empty object: in Tailscale 1.102.4 `GetServeConfig` never hands back
    /// nothing (`if sc == nil { sc = new(ipn.ServeConfig) }`, client/local/serve.go)
    /// and `serve status --json` prints what it was handed
    /// (`runServeStatus`, cmd/tailscale/cli/serve_legacy.go).
    public static func of(installed: Bool, status: TailscaleStatus?, serve: TailscaleServe?, port: Int) -> TailscaleState {
        guard installed else { return .missing }
        guard let status, status.backendState == "Running" else { return .signedOut }
        guard !status.certDomains.isEmpty else { return .noHTTPS }
        guard let serve else { return .unread }
        if let address = serve.address(for: port) {
            return .published(address)
        }
        if let other = serve.taken(from: port) {
            return .taken(other)
        }
        return .ready
    }
}

/// What to do with the publication, decided in one place each time the app
/// looks.
public enum Publication: Sendable, Equatable {
    case publish
    case unpublish
    case nothing

    /// How long between two looks at Tailscale while no window shows its state:
    /// each look is two commands run.
    public static let every: TimeInterval = 30

    /// Whether Tailscale is looked at now: always with a window that shows its
    /// state, and otherwise once in `every`.
    public static func due(last: Date?, now: Date, shown: Bool) -> Bool {
        guard !shown, let last else { return true }
        return now.timeIntervalSince(last) >= every
    }

    /// Whether a try that failed is forgotten, so that the network is asked
    /// again: once in `every`, and only while a window shows the state. Somebody
    /// is there then, and may just have enabled what the network lacked; with
    /// nobody there, a network that refused is left alone.
    public static func forgets(failedAt: Date?, now: Date, shown: Bool) -> Bool {
        guard shown, let failedAt else { return false }
        return now.timeIntervalSince(failedAt) >= every
    }

    /// Whether something just refused is left alone for now: a command that
    /// failed is not run again at every look, which with a window open is every
    /// two seconds.
    public static func rests(since refused: Date?, now: Date) -> Bool {
        refused.map { now.timeIntervalSince($0) < every } ?? false
    }

    /// `wanted` is its owner's choice, "reachable from other devices", and
    /// `setUp` whether the first run is done. `gateway` is what the gateway said
    /// of itself, and `nil` where it did not answer: nothing is decided from a
    /// gateway nobody heard. `state` is what Tailscale says, after what was just
    /// tried (`TailscaleState.after`): a network that refused is not asked again
    /// and again. `refused` is when Tailscale last refused to take a publication
    /// back, which then rests (`rests`).
    ///
    /// The page is published only while the gateway says it serves it. A port
    /// the gateway could not take is somebody else's, and publishing it would
    /// hand another program of this Mac to the whole network; and before the
    /// first run there is no page. It is taken back on a choice, stopped or not
    /// wanted, and where the port it leads to turned out to be another
    /// program's, for the same reason; a gateway that is starting over, or a Mac
    /// whose settings could not be read, is not a reason to.
    public static func next(wanted: Bool, setUp: Bool, gateway: GatewayStatus?, state: TailscaleState,
                            refused: Date? = nil, now: Date = Date()) -> Publication {
        guard let gateway else { return .nothing }
        switch state {
        case .ready:
            return wanted && setUp && gateway.serving && !gateway.stopped ? .publish : .nothing
        case .published:
            let theirs = gateway.cause?.code == GatewayStatus.portTaken
            guard !wanted || gateway.stopped || theirs else { return .nothing }
            return rests(since: refused, now: now) ? .nothing : .unpublish
        case .missing, .signedOut, .noHTTPS, .unread, .taken:
            // Nothing to publish with, nothing that could be read, or an
            // address that is somebody else's: that one only its owner hands
            // over.
            return .nothing
        }
    }

    /// Whether its owner can hand an address in use over to Alumia now: only
    /// where a publication would stand, which is where one would be made.
    public static func handsOver(wanted: Bool, setUp: Bool, gateway: GatewayStatus?) -> Bool {
        next(wanted: wanted, setUp: setUp, gateway: gateway, state: .ready) == .publish
    }

    /// What a change of the page's port does to the publication: the one that
    /// led to the port it had is taken back, since left it would lead to
    /// nothing, and nothing is published by the change itself. The rule above
    /// publishes at the new port once the gateway says it serves there, which a
    /// port that turns out to be another program's never is.
    public static func moved(from old: Int, to new: Int, published: Bool) -> Int? {
        published && old != new ? old : nil
    }
}

/// How publishing went. Not called `Published`, which is the name of the
/// system's own wrapper for what a screen watches.
public enum Publishing: Sendable, Equatable {
    /// The command ended saying it did: the state is read again, and says where.
    case done
    /// The network has no HTTPS yet. `consent` is where Tailscale says to enable
    /// it, where it said.
    case needsHTTPS(consent: URL?)
}

extension TailscaleState {
    /// The state to show after publishing was tried, where `self` is what
    /// Tailscale says now. A try that did not publish is a network without HTTPS
    /// for as long as Tailscale still says "ready", so that the row does not go
    /// back to offering the button that just failed; one seen published is
    /// published, whatever was tried before.
    public func after(_ tried: Publishing?) -> TailscaleState {
        guard case .needsHTTPS = tried, self == .ready else { return self }
        return .noHTTPS
    }
}

/// Tailscale's command on this Mac.
public struct Tailscale: Sendable {
    /// Where the command is, or `nil`: not installed.
    public var command: URL?
    public var runner: any Runner
    /// How long publishing may take. Without HTTPS in the network the command
    /// does not refuse: it prints where to enable it and waits, which a person at
    /// a terminal would answer and an app cannot.
    public var publishLimit: TimeInterval

    public init(command: URL?, runner: any Runner = SystemRunner(), publishLimit: TimeInterval = 10) {
        self.command = command
        self.runner = runner
        self.publishLimit = publishLimit
    }

    /// Where the command is looked for: the launcher the standalone app installs,
    /// Homebrew's, and the app's own executable.
    public static let places = [
        "/usr/local/bin/tailscale",
        "/opt/homebrew/bin/tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    ]

    public static func find(among places: [String] = Tailscale.places, isThere: (String) -> Bool) -> URL? {
        places.first(where: isThere).map { URL(fileURLWithPath: $0) }
    }

    /// Tailscale as this app may ask it. A copy made for testing is given no
    /// command, wherever Tailscale is installed: with one it would read and
    /// change the publication of the Mac's owner.
    public static func of(testCopy: Bool, runner: any Runner = SystemRunner(), isThere: (String) -> Bool) -> Tailscale {
        Tailscale(command: testCopy ? nil : find(isThere: isThere), runner: runner)
    }

    /// What the command is told to publish the page at `port` with, as the mockup
    /// shows it and as it is run.
    public static func publishing(port: Int) -> [String] {
        ["serve", "--bg", String(port)]
    }

    /// Tailscale's own documentation: "add off to the end of the command you
    /// used to turn it on".
    public static func unpublishing(port: Int) -> [String] {
        publishing(port: port) + ["off"]
    }

    public func status() async -> TailscaleStatus? {
        guard let command else { return nil }
        let ran = await runner.run(Command(command, ["status", "--json"], limit: 10))
        return TailscaleStatus.read(ran.output)
    }

    public func state(port: Int) async -> TailscaleState {
        guard let command else { return .missing }
        let status = await status()
        let served = await runner.run(Command(command, ["serve", "status", "--json"], limit: 10))
        return TailscaleState.of(installed: true, status: status, serve: TailscaleServe.read(served.output), port: port)
    }

    /// What the command's end means. It published only where it ran to its end,
    /// said it succeeded, and asked for nothing: refused, asking for HTTPS to be
    /// enabled, or still waiting at its limit are all a network without it.
    public static func published(_ ran: Ran) -> Publishing {
        let said = ran.output + "\n" + ran.errors
        let consent = said
            .split(whereSeparator: \.isWhitespace)
            .map(String.init)
            .first { $0.hasPrefix("https://login.tailscale.com/") }
            .flatMap(URL.init(string:))
        if ran.succeeded, consent == nil {
            return .done
        }
        return .needsHTTPS(consent: consent)
    }

    /// Publish the page at `port` in this network.
    public func publish(port: Int) async -> Publishing {
        guard let command else { return .needsHTTPS(consent: nil) }
        return Self.published(await runner.run(Command(command, Self.publishing(port: port), limit: publishLimit)))
    }

    /// Take back the publication that leads to `port`, where there is one: what
    /// uninstalling does, so that no address is left leading to nothing.
    public func unpublish(port: Int) async -> Bool {
        guard let command, case .published = await state(port: port) else { return false }
        return await runner.run(Command(command, Self.unpublishing(port: port), limit: publishLimit)).succeeded
    }
}
