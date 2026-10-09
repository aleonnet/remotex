// How the app starts: what it was asked on its command line, where its bundle
// is, and which other copies of it run.
//
// The app is an app only from an Applications folder, and one at a time. Opened
// from the disk image, from Downloads or translocated by Gatekeeper, it offers to
// be moved and does nothing else: nothing is asked of the system about its
// service or its opening at login, which the system would answer by pointing its
// record of Alumia at the copy that asked, and no menu bar item stands beside
// the installed one's. Opened from an Applications folder while another copy
// from one runs, it gives way to that copy.
//
// What it does with no window comes before both, wherever the bundle is: the
// gateway runs the clean-up from a bundle that is in the Trash, and a look for
// other computers from one whose app is running.
//
// A copy made for testing is the app wherever it was built: it has an identifier
// of its own, and its checks run from dist/mac.
//
// This is the part with no framework in it, which the tests cover. What the
// decision does on screen is Launching.swift.

import Foundation

/// What the app does with no window, each by its argument.
public enum Windowless: String, Sendable, Equatable, CaseIterable {
    case discover = "--discover"
    case cleanUp = "--cleanup"
    case smoke = "--smoke"
    case smokeTrash = "--smoke-trash"
}

public enum Launch: Sendable, Equatable {
    /// One of the things it does with no window, and ends.
    case windowless(Windowless)
    case app
    /// Outside Applications: the one thing offered is to be moved there.
    case offerMove
    /// Another copy from an Applications folder runs: it is opened, and this
    /// one ends.
    case giveWay(to: URL)

    /// The catalogue's code of what is said outside Applications.
    public static let code = "AL-1303"

    /// `own` is this bundle, and `folders` the Applications folders. `others`
    /// gives the bundles of the other copies that run, and is asked only where
    /// the answer depends on it: what runs with no window asks the system
    /// nothing of the kind. A copy that runs from outside Applications is the
    /// one that is moving this one there, and is no reason to give way.
    public static func of(arguments: [String], own: URL, folders: [URL], testCopy: Bool, others: () -> [URL]) -> Launch {
        if let asked = Windowless.allCases.first(where: { arguments.contains($0.rawValue) }) {
            return .windowless(asked)
        }
        if testCopy {
            return .app
        }
        guard ApplicationsFolder.contains(own, folders: folders) else { return .offerMove }
        if let running = others().first(where: { ApplicationsFolder.contains($0, folders: folders) }) {
            return .giveWay(to: running)
        }
        return .app
    }

    /// What the offer says: the catalogue's sentence, and its button.
    public static func offer(_ words: Words) -> Message? {
        words.message(code)
    }
}

/// Moving the app to Applications over the copies of it that run from there:
/// they are asked to quit first, and the copy is put only once none is left,
/// since a bundle replaced under a running app leaves that app running from
/// files that are gone.
public enum Move: Sendable, Equatable {
    case wait
    case place
    /// A copy is still running at the limit: nothing is put over it.
    case giveUp

    /// How long the installed copies are given to quit. A menu bar item ends
    /// at once; this is so as not to wait for ever on one that does not.
    public static let limit: TimeInterval = 10

    /// `running` is how many of the copies asked to quit still run, and
    /// `waited` how long ago they were asked.
    public static func next(running: Int, waited: TimeInterval, limit: TimeInterval = Move.limit) -> Move {
        if running == 0 {
            return .place
        }
        return waited >= limit ? .giveUp : .wait
    }

    /// Whether what the system opened is the copy that was put: at its address,
    /// and not this process, which the system may take for the app to open
    /// where it is not told to start another. The system gives a bundle's
    /// address with a slash at its end, so the two are compared as paths.
    public static func opened(placed: URL, launched: URL?, launchedIsThis: Bool) -> Bool {
        guard !launchedIsThis, let launched else { return false }
        return launched.standardizedFileURL.path == placed.standardizedFileURL.path
    }
}
