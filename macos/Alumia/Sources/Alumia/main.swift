// Alumia for the Mac. It hosts the gateway and is its control, and it shows no
// remote screen: the page does that (docs/mac-app.md).
//
// Run with no window, it does one of the two things the gateway asks of it
// (src/app.rs) and ends: find the other computers with Alumia, or take the app's
// traces away once its bundle is in the Trash. What it does is decided at the
// foot of this file, by AlumiaCore's `Launch`, before any interface comes up:
// that first, wherever the bundle is; and then the app itself only from an
// Applications folder, one copy at a time (Launching.swift is the rest).

import AlumiaCore
import AppKit

/// What the app does with no window.
enum Headless {
    private final class Answer<Value: Sendable>: @unchecked Sendable {
        private let lock = NSLock()
        private var value: Value?

        func set(_ answered: Value) {
            lock.withLock { value = answered }
        }

        var answered: Value? {
            lock.withLock { value }
        }
    }

    /// Wait on the calling thread for `work`, which runs off it.
    @discardableResult
    private static func wait<Value: Sendable>(for work: @escaping @Sendable () async -> Value) -> Value {
        let done = DispatchSemaphore(value: 0)
        let answer = Answer<Value>()
        Task.detached {
            answer.set(await work())
            done.signal()
        }
        done.wait()
        // Set before the signal, on the one path that gives it.
        return answer.answered!
    }

    /// Tailscale as this bundle may ask it: a copy made for testing has none.
    private static var tailscale: Tailscale {
        Tailscale.of(testCopy: Bundled.folderNamed != nil) { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// Print the other computers with Alumia, as JSON: each device of the
    /// Tailscale network that is on and is not a phone, asked whether it is one.
    /// Within the few seconds the gateway gives it.
    static func discover() -> Never {
        wait {
            var found: [Neighbour] = []
            if let status = await tailscale.status() {
                found = await Neighbours.discover(among: Neighbours.candidates(in: status), limit: 3)
            }
            print(Neighbours.printed(found))
        }
        exit(0)
    }

    /// Take away what the app left on this Mac, with nobody to ask: the gateway
    /// found the bundle in the Trash.
    static func cleanUp() -> Never {
        let folder = Bundled.folder
        let environment = Bundled.environment
        wait {
            let gateway = Gateway(binary: Bundled.helper, language: .english, environment: environment)
            var publishedPort: Int?
            if case .success(let shown) = await gateway.show(), let port = shown.port,
               case .published = await tailscale.state(port: port) {
                publishedPort = port
            }
            for step in Uninstall.steps(publishedPort: publishedPort, folder: folder) {
                switch step {
                case .unpublish(let port): _ = await tailscale.unpublish(port: port)
                case .unregisterService: Agent.perform([.unregister])
                case .unregisterLoginItem: Agent.openAtLogin(false)
                case .removeFolder(let folder): try? Uninstall.remove(folder: folder)
                case .forgetPreferences: Preferences.forget()
                }
            }
        }
        exit(0)
    }
}

extension Headless {
    /// Ask `question` every quarter of a second until it says yes, for at most
    /// `seconds`.
    private static func until(_ seconds: Double, _ question: @Sendable () async -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if await question() {
                return true
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
        return false
    }

    /// What a copy made for testing checks itself with, nobody at it: its own
    /// folder, port and service, and a line said for each step. The installed
    /// app has none: a check registers and unregisters its service and deletes
    /// its folder.
    private struct Check: Sendable {
        let folder: URL
        let port: Int
        let label: String
        let gateway: Gateway

        static func own() -> Check {
            guard Bundled.folderNamed != nil else {
                print("refused: only a copy of the app made for testing checks itself")
                exit(64)
            }
            return Check(
                folder: Bundled.folder,
                port: Bundled.pagePort,
                label: "\(Bundled.identifier).gateway",
                gateway: Gateway(binary: Bundled.helper, language: .english, environment: Bundled.environment)
            )
        }

        func said(_ step: String, _ held: Bool) -> Bool {
            print("\(held ? "ok    " : "FAILED") \(step)")
            return held
        }

        func serving() async -> Bool {
            if case .success(let status) = await gateway.status() {
                return status.serving
            }
            return false
        }

        /// The gateway says it is stopped, and nothing accepts at the page's port.
        func standing() async -> Bool {
            guard case .success(let status) = await gateway.status(), status.stopped, !status.serving else { return false }
            return await Reaching.reach(Place(host: "127.0.0.1", port: port)) != .reached
        }

        /// What the system that runs the service says of it.
        private func listed() async -> Ran {
            await SystemRunner().run(Command(URL(fileURLWithPath: "/bin/launchctl"), ["list", label], limit: 5))
        }

        /// Whether the system has the service at all, running or not.
        func registered() async -> Bool {
            await listed().status == 0
        }

        /// The gateway's process, by its number; `nil` where the service has
        /// none.
        func process() async -> Int32? {
            // `"PID" = 38830;`
            let said = await listed().output
            guard let line = said.split(whereSeparator: \.isNewline).first(where: { $0.contains("\"PID\"") }) else { return nil }
            return Int32(line.filter(\.isNumber))
        }

        /// Settings written, the service registered, and the gateway serving.
        func started() async -> Bool {
            let change = Change(
                listen: "127.0.0.1:\(port)",
                login: Change.Login(username: "smoke", password: "only-for-the-smoke-test"),
                computers: [ChangedComputer(name: "nothing", kind: "vnc", host: "127.0.0.1", port: 59999)]
            )
            var written = false
            if case .success = await gateway.apply(change) {
                written = true
            }
            guard said("the settings are written in \(folder.path)", written) else { return false }

            Agent.perform([.register])
            guard said("the service is registered (\(Agent.registration))", Agent.registration == .enabled) else { return false }
            if await until(30, { await serving() }) {
                return said("the gateway serves on port \(port)", true)
            }
            // What the app does with a service that is registered and silent
            // (`RegistrationPolicy`): undone, and done again. A copy built again
            // needs it: the system keeps a record of the build it last ran under
            // this name, and refuses to launch another one against it. Measured
            // on 2026-10-05, in the system's log of a first run after a build:
            // "xpcproxy exited due to OS_REASON_CODESIGNING | Launch Constraint
            // Violation" at the first launch, the service inactive again at
            // each of the two the system tried after it, and a gateway serving
            // at once where the service had been unregistered and registered.
            Agent.perform([.unregister, .register])
            return said("the gateway serves on port \(port), its service registered a second time", await until(30) { await serving() })
        }

        /// Whether the gateway that answers is the one in this bundle, as the
        /// command that asks it says.
        func current() async -> Bool? {
            if case .success(let status) = await gateway.status() {
                return status.current
            }
            return nil
        }

        /// Another file put where the gateway's binary is, the same bytes: what
        /// an app dragged over the installed one does to it.
        func replaced() -> Bool {
            let files = FileManager.default
            let binary = Bundled.helper
            let before = binary.deletingLastPathComponent().appendingPathComponent("alumia-before")
            let other = binary.deletingLastPathComponent().appendingPathComponent("alumia-other")
            do {
                try files.copyItem(at: binary, to: other)
                try files.moveItem(at: binary, to: before)
                try files.moveItem(at: other, to: binary)
                try files.removeItem(at: before)
                return true
            } catch {
                return false
            }
        }

        /// Whatever was found, everything the check made is taken away again.
        func ended() async -> Bool {
            Agent.perform([.unregister])
            let stopped = await until(20) { await !registered() }
            let unregistered = said("unregistered, it stops", stopped && Agent.registration != .enabled)
            try? Uninstall.remove(folder: folder)
            let gone = said("its folder is gone", !FileManager.default.fileExists(atPath: folder.path))
            return unregistered && gone
        }
    }

    /// A copy made for testing checks the whole arrangement by itself: it writes
    /// settings, registers the service, waits for the gateway to serve, ends it
    /// and waits for the system to bring it back, stops it and starts it as its
    /// owner would from the menu, puts another file in its gateway's place and
    /// starts the gateway over from it as the app does for one it replaced, and
    /// takes everything away again. The first step that fails ends it.
    static func smoke() -> Never {
        let check = Check.own()
        let passed = wait { () async -> Bool in
            var held = await check.started()
            if held {
                if let before = await check.process() {
                    kill(before, SIGKILL)
                    // The system brings it back, no sooner than ten seconds
                    // after it last started it.
                    let back = await until(40) {
                        guard let now = await check.process(), now != before else { return false }
                        return await check.serving()
                    }
                    held = check.said("ended (process \(before)), it comes back by itself and serves", back)
                } else {
                    held = check.said("the service has a process", false)
                }
            }
            if held {
                // Stopped is the gateway's to be: the same process, serving
                // nothing, and the service as registered as it was.
                let before = await check.process()
                _ = await check.gateway.stop()
                let stood = await until(15) { await check.standing() }
                let same = await check.process()
                held = check.said("stopped, the page's port is closed and the process is the same", stood && before != nil && same == before)
            }
            if held {
                _ = await check.gateway.start()
                held = check.said("started, it serves again", await until(15) { await check.serving() })
            }
            if held {
                // An app put in the place of this one: the gateway that runs is
                // the file that was there, said not to be the bundle's, and the
                // steps the app takes for that start the one that is there now.
                let was = await check.current()
                let other = check.replaced()
                let now = await check.current()
                held = check.said("another file in its binary's place, the gateway that runs is said not to be the bundle's",
                                  was == true && other && now == false)
            }
            if held {
                let before = await check.process()
                var policy = RegistrationPolicy()
                var steps: [RegistrationStep] = []
                if case .success(let status) = await check.gateway.status() {
                    steps = policy.renew(gateway: status, state: .running)
                }
                Agent.perform(steps)
                let renewed = await until(40) {
                    guard let process = await check.process(), process != before else { return false }
                    guard await check.current() == true else { return false }
                    return await check.serving()
                }
                held = check.said("its service ended and registered again, the gateway is the bundle's and serves", !steps.isEmpty && renewed)
            }
            let ended = await check.ended()
            return held && ended
        }
        exit(passed ? 0 : 1)
    }

    /// A copy made for testing puts itself in the Trash while its gateway
    /// serves, and waits for the gateway to notice and have the traces taken
    /// away: within thirty seconds, no service and no folder. What it then finds
    /// left it takes away itself, the copy in the Trash too, and says so.
    static func smokeTrash() -> Never {
        let check = Check.own()
        let bundle = Bundle.main.bundleURL
        let passed = wait { () async -> Bool in
            var held = await check.started()
            var trashed: URL?
            if held {
                var moved: NSURL?
                try? FileManager.default.trashItem(at: bundle, resultingItemURL: &moved)
                trashed = moved as URL?
                held = check.said("the copy is in the Trash (\(trashed?.path ?? "nowhere"))", trashed != nil)
            }
            if held {
                let began = Date()
                let cleaned = await until(30) {
                    await !check.registered() && !FileManager.default.fileExists(atPath: check.folder.path)
                }
                let took = Int(Date().timeIntervalSince(began).rounded())
                let service = await check.registered() ? "its service is still registered" : "its service is unregistered"
                let folder = FileManager.default.fileExists(atPath: check.folder.path) ? "its folder is still there" : "its folder is gone"
                held = check.said("after \(took) s in the Trash, \(service) and \(folder)", cleaned)
            }
            _ = await check.ended()
            if let trashed {
                try? FileManager.default.removeItem(at: trashed)
                _ = check.said("the copy is deleted from the Trash", !FileManager.default.fileExists(atPath: trashed.path))
            }
            return held
        }
        exit(passed ? 0 : 1)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = AppModel()
    private lazy var windows = Windows(model: model)
    private lazy var status = StatusItem(
        model: model,
        openSettings: { [weak self] in self?.windows.showSettings() },
        openFirstRun: { [weak self] in self?.windows.showWizard() }
    )
    private var asked = false
    /// The language the main menu was last made in.
    private var menuLanguage: Language?

    func applicationDidFinishLaunching(_ notification: Notification) {
        speak()
        model.onChange = { [weak self] in
            self?.changed()
        }
        model.showFFmpeg = { [weak self] in
            self?.windows.showFFmpeg()
        }
        status.update()
        model.start()
    }

    /// Something the model reads changed: the menu bar item says so, and the
    /// first time the settings are known, a Mac nobody set up gets its first run.
    private func changed() {
        status.update()
        windows.retitle()
        speak()
        if !asked, model.shown != nil {
            asked = true
            if !model.setUp {
                windows.showWizard()
            }
        }
    }

    /// The main menu, in the app's language: made again only when that changes.
    private func speak() {
        let language = model.words.language
        if menuLanguage != language {
            menuLanguage = language
            NSApp.mainMenu = MainMenu.make(model.words, settings: (self, #selector(openSettings)))
        }
    }

    /// The application menu's own way to the settings, as the menu bar item's is.
    @objc private func openSettings() {
        windows.showSettings()
    }

    /// Opened again from Applications, with its menu bar item hidden or not, and
    /// no window on show: it shows the settings, or the first run while Alumia is
    /// not set up.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows {
            if model.setUp {
                windows.showSettings()
            } else {
                windows.showWizard()
            }
        }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}

// What it was asked with no window comes first; then it is the app only from an
// Applications folder, and one at a time (`Launch`).
let delegate: NSApplicationDelegate
switch Launch.of(
    arguments: Array(CommandLine.arguments.dropFirst()),
    own: Bundle.main.bundleURL,
    folders: Bundled.applications,
    testCopy: Bundled.folderNamed != nil,
    others: { Bundled.others.compactMap(\.bundleURL) }
) {
case .windowless(.discover): Headless.discover()
case .windowless(.cleanUp): Headless.cleanUp()
case .windowless(.smoke): Headless.smoke()
case .windowless(.smokeTrash): Headless.smokeTrash()
case .app: delegate = AppDelegate()
case .offerMove: delegate = Launching(.offerMove)
case .giveWay(let running): delegate = Launching(.giveWay(to: running))
}
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
