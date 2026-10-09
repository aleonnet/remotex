// Uninstalling: what it says it deletes, and deleting exactly that.
//
// Dragging an app to the Trash deletes the app and nothing it left behind, so
// the app offers to take its traces away itself: it says what goes, asks, does
// it, and then offers to move the app to the Trash. The gateway does the same
// when it finds its bundle in the Trash (`Alumia --cleanup`, src/app.rs).

import Foundation

/// One thing uninstalling does.
public enum UninstallStep: Sendable, Equatable {
    /// Take back the Tailscale publication that leads to the page, so no address
    /// is left leading to nothing.
    case unpublish(port: Int)
    /// Unregister the service that keeps the gateway running, which also stops
    /// it: "the system terminates it".
    case unregisterService
    /// And the app's own opening at login.
    case unregisterLoginItem
    /// Delete the app's folder: the settings, the computers and their passwords,
    /// the page's password, the kept logins and the throughput history.
    case removeFolder(URL)
    /// And what the app remembers of its own: language, look, its switches.
    case forgetPreferences
}

public enum Uninstall {
    /// What is done, in this order: the publication while there is still a
    /// Tailscale to ask, the service before the folder it writes in.
    public static func steps(publishedPort: Int?, folder: URL) -> [UninstallStep] {
        var steps: [UninstallStep] = []
        if let publishedPort {
            steps.append(.unpublish(port: publishedPort))
        }
        steps += [.unregisterService, .unregisterLoginItem, .removeFolder(folder), .forgetPreferences]
        return steps
    }

    /// The lines of the alert that asks: what is deleted from this Mac. The
    /// publication is among them only where there is one.
    public static func listed(published: Bool) -> [String] {
        var keys = ["mac.uninstall.1", "mac.uninstall.2", "mac.uninstall.3", "mac.uninstall.4"]
        if published {
            keys.append("mac.uninstall.5")
        }
        return keys
    }

    public static let askKeys = ["mac.uninstall.title", "mac.uninstall.lead", "mac.uninstall.keeps", "mac.uninstall.do", "common.cancel"]
    public static let doneKeys = ["mac.uninstalled.title", "mac.uninstalled.body", "mac.uninstalled.trash", "common.notnow"]

    /// The app's own folder, where the hosted gateway keeps everything
    /// (src/app.rs): the one named, or the one under the home folder. Its
    /// sibling, the terminal panel's instances, is not the app's.
    public static func folder(home: URL, named: String?) -> URL {
        if let named, !named.isEmpty {
            return URL(fileURLWithPath: named)
        }
        return home.appendingPathComponent("Library/Application Support/alumia/app")
    }

    /// Alumia's own folder under Application Support, which the app's folder and
    /// the panel's are in.
    static let shared = "alumia"

    /// Delete `folder`; one that is not there is already deleted. The folder it
    /// was in goes with it once that is Alumia's own and has nothing else in it:
    /// empty, it is a trace, and with the panel's instances in it, it is theirs.
    public static func remove(folder: URL, files: FileManager = .default) throws {
        if files.fileExists(atPath: folder.path) {
            try files.removeItem(at: folder)
        }
        let within = folder.deletingLastPathComponent()
        // A folder that cannot be listed is not there, or is not ours to judge.
        if within.lastPathComponent == shared, (try? files.contentsOfDirectory(atPath: within.path))?.isEmpty == true {
            try files.removeItem(at: within)
        }
    }
}
