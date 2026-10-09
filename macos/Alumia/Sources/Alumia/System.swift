// What the app asks of the Mac it runs on: its own bundle, the service's
// registration, whether Screen Sharing answers, and the places it sends its
// owner to. Everything decided from these is in AlumiaCore, which has no
// framework in it and is what the tests cover.

import AlumiaCore
import AppKit
import Network
import ServiceManagement
import os

let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.aleonnet.alumia", category: "app")

/// What the bundle says of itself.
enum Bundled {
    static let identifier = Bundle.main.bundleIdentifier ?? "com.aleonnet.alumia"

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }

    /// The gateway's binary, beside the app's own.
    static var helper: URL {
        Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/alumia")
    }

    /// The launch agent's property list, in `Contents/Library/LaunchAgents`.
    static var agent: String {
        "\(identifier).gateway.plist"
    }

    /// A copy of the app made for testing keeps everything in a folder of its
    /// own, named in its `Info.plist`, and is never the installed one's.
    static var folderNamed: String? {
        Bundle.main.object(forInfoDictionaryKey: "AlumiaAppDir") as? String
    }

    /// Where the page is served on a Mac just set up: the gateway's own port, or
    /// the one a copy made for testing names, so that it never takes the
    /// installed one's.
    static var pagePort: Int {
        Bundle.main.object(forInfoDictionaryKey: "AlumiaPagePort") as? Int ?? FirstRun.pagePort
    }

    /// The app's folder: the settings, the control socket, the history.
    static var folder: URL {
        Uninstall.folder(home: FileManager.default.homeDirectoryForCurrentUser, named: folderNamed)
    }

    /// What the gateway's binary is run with: the app's own environment, and the
    /// folder where the bundle names one.
    static var environment: [String: String]? {
        guard let folderNamed else { return nil }
        var environment = ProcessInfo.processInfo.environment
        environment["ALUMIA_APP_DIR"] = folderNamed
        return environment
    }

    /// The Applications folders: the Mac's, and its owner's own.
    static var applications: [URL] {
        FileManager.default.urls(for: .applicationDirectory, in: [.localDomainMask, .userDomainMask])
    }

    /// The other copies of the app that run, as the system lists them: the
    /// apps it opened, and not a process run from a bundle's executable that
    /// makes no application, which is what the gateway's runs of this one with
    /// no window are (measured with one that only slept, docs/mac-app.md).
    /// Asked before there is an application, as the app's start asks it, this
    /// process is not among them (measured there too).
    static var others: [NSRunningApplication] {
        NSRunningApplication.runningApplications(withBundleIdentifier: identifier).filter { $0 != .current }
    }
}

/// The service that keeps the gateway running, and the app's own opening at
/// login.
enum Agent {
    static var gateway: SMAppService {
        SMAppService.agent(plistName: Bundled.agent)
    }

    static var registration: Registration {
        switch gateway.status {
        case .notRegistered: .notRegistered
        case .enabled: .enabled
        case .requiresApproval: .requiresApproval
        case .notFound: .notFound
        @unknown default: .notFound
        }
    }

    static func perform(_ steps: [RegistrationStep]) {
        for step in steps {
            do {
                switch step {
                case .register: try gateway.register()
                case .unregister: try gateway.unregister()
                }
            } catch {
                log.error("the service's registration refused \(String(describing: step), privacy: .public): \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// The menu bar item comes back at login while it is shown, and not once it
    /// is hidden. Whether the system took it: when and for whom is
    /// `OpenAtLogin`'s to say.
    @discardableResult
    static func openAtLogin(_ open: Bool) -> Bool {
        do {
            if open {
                if SMAppService.mainApp.status != .enabled {
                    try SMAppService.mainApp.register()
                }
            } else if SMAppService.mainApp.status != .notRegistered {
                try SMAppService.mainApp.unregister()
            }
            return true
        } catch {
            log.error("the app's own opening at login was refused: \(error.localizedDescription, privacy: .public)")
            return false
        }
    }
}

/// The first answer a connection gives, and no other: its handlers and its limit
/// all answer, from threads of their own.
private final class Once<Answer: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var answered = false
    private let continuation: CheckedContinuation<Answer, Never>

    init(_ continuation: CheckedContinuation<Answer, Never>) {
        self.continuation = continuation
    }

    func answer(_ answer: Answer) {
        let first = lock.withLock {
            defer { answered = true }
            return !answered
        }
        if first {
            continuation.resume(returning: answer)
        }
    }
}

/// Whether Screen Sharing answers on this Mac. There is no public way to read
/// its switch, and what `launchctl` says follows the process and not the switch:
/// what the gateway needs is to connect to this Mac's port 5900, so that is what
/// is asked.
enum ScreenSharing {
    static func isOn() async -> Bool {
        let connection = NWConnection(host: "127.0.0.1", port: 5900, using: .tcp)
        let on = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            let once = Once(continuation)
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready: once.answer(true)
                case .failed, .cancelled, .waiting: once.answer(false)
                default: break
                }
            }
            connection.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
                once.answer(false)
            }
        }
        connection.cancel()
        return on
    }
}

/// The computers of the settings, tried from the app (`LocalNetwork`). The try is
/// made with the Network framework, on purpose: it is a connection of this
/// framework that has macOS ask its owner, in Alumia's name, for the local
/// network, where one made through BSD sockets by a launch agent is refused with
/// no question (Apple's developer forum, thread 778457, where an engineer of
/// Apple's reproduced both on macOS 15.3.2). And it is the framework that says
/// when the leave is what is missing, in the way Apple's note gives: "If your
/// program doesn't have local network access, the connection enters the
/// `waiting` state and the current path lists an unsatisfied reason of
/// `localNetworkDenied`" (TN3179). The same note says the system "may deny the
/// operation immediately, before the user has responded to the alert": a try
/// made while the question is on screen is refused, and the next one is not.
enum Reaching {
    /// How long a computer is given to accept: one that is on answers at once.
    static let limit: TimeInterval = 3

    static func reach(_ place: Place) async -> Reach {
        guard let port = NWEndpoint.Port(rawValue: UInt16(clamping: place.port)) else { return .silent }
        let connection = NWConnection(host: NWEndpoint.Host(place.host), port: port, using: .tcp)
        let reach = await withCheckedContinuation { (continuation: CheckedContinuation<Reach, Never>) in
            let once = Once(continuation)
            connection.stateUpdateHandler = { [weak connection] state in
                switch state {
                case .ready: once.answer(.reached)
                case .waiting:
                    if case .localNetworkDenied? = connection?.currentPath?.unsatisfiedReason {
                        once.answer(.denied)
                    }
                case .failed, .cancelled: once.answer(.silent)
                default: break
                }
            }
            connection.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + limit) {
                once.answer(.silent)
            }
        }
        connection.cancel()
        return reach
    }

    /// Every place tried at once: together they take what the slowest takes.
    static func all(_ places: [Place]) async -> [Reach] {
        await withTaskGroup(of: Reach.self) { group in
            for place in places {
                group.addTask { await reach(place) }
            }
            var answers: [Reach] = []
            for await answer in group {
                answers.append(answer)
            }
            return answers
        }
    }
}

/// What the owner chose, kept between openings.
enum Preferences {
    private static var store: UserDefaults { .standard }

    private static func choice<Choice: RawRepresentable>(_ key: String, _ fallback: Choice) -> Choice where Choice.RawValue == String {
        store.string(forKey: key).flatMap(Choice.init(rawValue:)) ?? fallback
    }

    /// "Reachable from other devices": whether the page is published in
    /// Tailscale while Alumia is on.
    static var reachable: Bool {
        get { store.object(forKey: "reachable") as? Bool ?? true }
        set { store.set(newValue, forKey: "reachable") }
    }

    static var showInBar: Bool {
        get { store.object(forKey: "showInBar") as? Bool ?? true }
        set { store.set(newValue, forKey: "showInBar") }
    }

    /// The system took a registration of the app's opening at login, asked by
    /// the app itself or by the switch, and the switch has not taken it away
    /// since (`OpenAtLogin.mark`): from then on it is its owner's.
    static var openAtLoginRegistered: Bool {
        get { store.bool(forKey: "openAtLoginRegistered") }
        set { store.set(newValue, forKey: "openAtLoginRegistered") }
    }

    static var look: Look {
        get { choice("look", .system) }
        set { store.set(newValue.rawValue, forKey: "look") }
    }

    static var language: LanguageChoice {
        get { choice("language", .system) }
        set { store.set(newValue.rawValue, forKey: "language") }
    }

    static func forget() {
        store.removePersistentDomain(forName: Bundled.identifier)
    }
}

/// The places the app sends its owner to.
@MainActor
enum Opening {
    static func url(_ text: String) {
        if let url = URL(string: text) {
            NSWorkspace.shared.open(url)
        }
    }

    /// System Settings, at Sharing: where Screen Sharing is turned on, which only
    /// its owner can do.
    static func sharingSettings() {
        let pane = URL(string: "x-apple.systempreferences:com.apple.Sharing-Settings.extension")
        if let pane, NSWorkspace.shared.open(pane) {
            return
        }
        NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/System Settings.app"))
    }

    static func loginItems() {
        SMAppService.openSystemSettingsLoginItems()
    }

    /// System Settings, at Privacy & Security, Local Network: where Alumia is
    /// allowed its Mac's network. Apple documents no address for the pane, so the
    /// notice's own sentence says the way there, whatever this one opens.
    static func localNetworkSettings() {
        let pane = URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocalNetwork")
        if let pane, NSWorkspace.shared.open(pane) {
            return
        }
        NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/System Settings.app"))
    }

    /// The gateway's log, shown in the Finder.
    static func revealLog() {
        let file = Bundled.folder.appendingPathComponent("gateway.log")
        if FileManager.default.fileExists(atPath: file.path) {
            reveal(file)
        } else {
            NSWorkspace.shared.open(Bundled.folder)
        }
    }

    static func tailscaleDownload() {
        url("https://tailscale.com/download/mac")
    }

    static func tailscaleApp() {
        let app = URL(fileURLWithPath: "/Applications/Tailscale.app")
        NSWorkspace.shared.openApplication(at: app, configuration: NSWorkspace.OpenConfiguration())
    }

    /// The network's own settings, where MagicDNS and HTTPS certificates are
    /// turned on.
    static func tailscaleAdmin() {
        url("https://login.tailscale.com/admin/dns")
    }

    static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    static func reveal(_ file: URL) {
        NSWorkspace.shared.activateFileViewerSelecting([file])
    }
}
