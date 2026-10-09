// What the app does where it is not to be the app (`Launch`, in AlumiaCore):
// outside Applications it asks to be moved there, and beside a copy that runs
// from Applications it has that copy opened. Either way it ends, and the app's
// model is never made: nothing is asked of the system about the service or the
// opening at login, nothing is registered, Tailscale is not read, and no menu
// bar item comes up.
//
// It runs as an application, with the main run loop turning, because of what
// Apple writes of a running application's properties: they "persist until the
// next turn of the main run loop in a common mode", so a copy asked to quit is
// seen to have ended only between two turns of it (NSRunningApplication.h).
//
// None of it runs in a copy made for testing, which is the app wherever it is,
// and nothing is tried with an installed Alumia: what stands behind the move is
// AlumiaCore's rule, which the tests cover, Apple's own words, and a scratch
// app that is not Alumia, three copies of it under one identifier and the
// Hardened Runtime (docs/mac-app.md): a copy asked to quit ends, and one opened
// as a new instance comes up at its own address while the copy that asked
// still runs. Opened as the system opens by
// default, it may be this copy that the system takes for the app to open:
// "If an instance of an application is already running, but the running
// instance is at a different URL (...), use the running application"
// (NSWorkspace.h, `allowsRunningApplicationSubstitution`).

import AlumiaCore
import AppKit

@MainActor
final class Launching: NSObject, NSApplicationDelegate {
    enum What {
        case offerMove
        case giveWay(to: URL)
    }

    private let what: What
    /// In the language its owner chose in the app, which is kept with its
    /// preferences.
    private let words = Words(Preferences.language.language(preferred: Locale.preferredLanguages))

    init(_ what: What) {
        self.what = what
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        switch what {
        case .offerMove: offer()
        case .giveWay(let running): giveWay(to: running)
        }
    }

    /// The one question: be moved to Applications, or quit.
    private func offer() {
        guard let said = Launch.offer(words), let move = said.button else { return NSApp.terminate(nil) }
        NSApp.setActivationPolicy(.regular)
        NSApp.activate()
        let asking = NSAlert()
        asking.messageText = said.text
        asking.informativeText = said.code
        asking.addButton(withTitle: move)
        asking.addButton(withTitle: words.say("mac.menu.quit")).keyEquivalent = "\u{1b}"
        guard asking.runModal() == .alertFirstButtonReturn else { return NSApp.terminate(nil) }
        Task { await self.move() }
    }

    /// Put this copy in Applications, over the ones that run from there, and
    /// open it. Where that cannot be done, show the folder with the app beside
    /// it for its owner to drag.
    private func move() async {
        let own = NSRunningApplication.current
        let folders = Bundled.applications
        let installed = Bundled.others.filter { other in
            other.bundleURL.map { ApplicationsFolder.contains($0, folders: folders) } ?? false
        }
        // Read before it is asked to quit: of a copy that has ended "some
        // properties may not be available" (NSRunningApplication.h).
        let had = installed.first?.bundleURL
        for copy in installed {
            _ = copy.terminate()
        }
        let asked = Date()
        waiting: while true {
            switch Move.next(running: installed.filter { !$0.isTerminated }.count, waited: Date().timeIntervalSince(asked)) {
            case .place: break waiting
            // One of them still runs, so there is an Alumia still.
            case .giveUp: return showFolder()
            case .wait: try? await Task.sleep(for: .milliseconds(250))
            }
        }
        let placed: URL
        do {
            placed = try ApplicationsFolder.place(Bundle.main.bundleURL, in: URL(fileURLWithPath: "/Applications"))
        } catch {
            log.error("the app could not put itself in Applications: \(error.localizedDescription, privacy: .public)")
            // Nothing was put, and the copies that ran were asked to quit for
            // it: the first of them is opened again, so that a move that did
            // not happen leaves its owner the Alumia they had.
            if let had {
                _ = try? await opened(had)
            }
            return showFolder()
        }
        do {
            let launched = try await opened(placed)
            guard Move.opened(placed: placed, launched: launched.bundleURL, launchedIsThis: launched == own) else {
                log.error("the app put in Applications is not what the system opened")
                return showFolder()
            }
            NSApp.terminate(nil)
        } catch {
            log.error("the app put in Applications could not be opened: \(error.localizedDescription, privacy: .public)")
            showFolder()
        }
    }

    /// Open the app at `bundle` as an instance of its own, whatever copy of it
    /// runs: this one does, at another address.
    private func opened(_ bundle: URL) async throws -> NSRunningApplication {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        return try await NSWorkspace.shared.openApplication(at: bundle, configuration: configuration)
    }

    private func showFolder() {
        NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
        NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications"))
        NSApp.terminate(nil)
    }

    /// Ask the system to open the copy that runs, which is how an app opened
    /// again shows its settings, or its first run on a Mac nobody set up, and
    /// end. Asked from a copy that also runs, at another address, which of the
    /// two the system takes for it was not measured.
    private func giveWay(to running: URL) {
        NSWorkspace.shared.openApplication(at: running, configuration: NSWorkspace.OpenConfiguration()) { _, _ in
            Task { @MainActor in
                NSApp.terminate(nil)
            }
        }
    }
}
