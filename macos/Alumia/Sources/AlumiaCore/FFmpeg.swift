// FFmpeg: whether this Mac has it, the seal that says so, and installing it.
//
// A Mac's picture reaches the gateway as HEVC, and the gateway decodes it with
// FFmpeg's libavcodec, which macOS does not bring and which Alumia does not ship
// (its licence keeps it out of every artifact: packaging/README.md). Without it
// the screen still opens, in a browser that decodes the Mac's video itself. So
// the app says when it is missing, keeps a seal that says so until it is there,
// and installs it on a click, with Homebrew.
//
// Whether it is there is the gateway's to say, which is who loads it
// (`GatewayStatus.ffmpeg`): an FFmpeg installed while the gateway runs is found
// by the next session, and by the next time the app asks.

import Foundation

/// The seal in the settings.
public enum FFmpegSeal: Sendable, Equatable {
    case missing
    case installing
    case present

    public var stateKey: String {
        switch self {
        case .missing: "mac.ffmpeg.state.missing"
        case .installing: "mac.ffmpeg.state.running"
        case .present: "mac.ffmpeg.state.present"
        }
    }

    public var noteKey: String {
        self == .present ? "mac.ffmpeg.note.present" : "mac.ffmpeg.note.missing"
    }

    /// The button beside it: install, see how the installation goes, or nothing.
    public var actKey: String? {
        switch self {
        case .missing: "mac.ffmpeg.install"
        case .installing: "mac.ffmpeg.see"
        case .present: nil
        }
    }

    /// The seal stays for as long as the gateway does not find FFmpeg, whatever
    /// an installation said of itself.
    public static func of(present: Bool, installing: Bool) -> FFmpegSeal {
        if present {
            return .present
        }
        return installing ? .installing : .missing
    }
}

/// The sheet the seal's button opens.
public enum FFmpegSheet: Sendable, Equatable {
    /// Homebrew is here: the command is shown, and Install runs it.
    case ask(command: String)
    /// Homebrew is not: it is installed first, by its own installer.
    case noHomebrew
    /// The owner went to install Homebrew: the sheet goes on by itself when it
    /// appears.
    case waitingForHomebrew
    /// Installing. `lines` is what Homebrew has said.
    case running(lines: [String])
    /// It did not finish. `last` is what Homebrew said last.
    case failed(last: String)
    case done

    /// The sheet's sentence. While it waits for Homebrew it goes on saying why.
    public var textKey: String {
        switch self {
        case .ask: "mac.ffmpeg.ask"
        case .noHomebrew, .waitingForHomebrew: "mac.ffmpeg.nobrew"
        case .running: "mac.ffmpeg.running"
        case .failed: "mac.ffmpeg.failed"
        case .done: "mac.ffmpeg.done"
        }
    }

    /// The state the sheet marks under its sentence, where it is in one.
    public var stateKey: String? {
        self == .waitingForHomebrew ? "mac.ffmpeg.waiting" : nil
    }

    /// The title of the button that goes on from here, or where there is
    /// nowhere to go on to, of the one that closes the sheet.
    public var actKey: String {
        switch self {
        case .ask: "mac.ffmpeg.install"
        case .noHomebrew: "mac.ffmpeg.getbrew"
        case .waitingForHomebrew: "common.cancel"
        case .running: "mac.close"
        case .failed: "mac.retry"
        case .done: "mac.first.finish"
        }
    }

    /// The title of the button that leaves, beside one that goes on.
    public var leaveKey: String? {
        switch self {
        case .ask, .noHomebrew: "common.cancel"
        case .failed: "mac.close"
        case .waitingForHomebrew, .running, .done: nil
        }
    }

    public static let titleKey = "mac.ffmpeg.title"

    /// The command the sheet shows before running it.
    public var command: String? {
        if case .ask(let command) = self {
            return command
        }
        return nil
    }

    /// What Homebrew said last, where it said anything: under the bar while it
    /// runs, and under the sentence of an installation that did not finish.
    public var last: String? {
        switch self {
        case .running(let lines): lines.last
        case .failed(let last): last.isEmpty ? nil : last
        case .ask, .noHomebrew, .waitingForHomebrew, .done: nil
        }
    }

    /// Whether what the sheet shows goes on with the sheet closed: an
    /// installation does, and waiting for Homebrew ends there.
    public var goesOnClosed: Bool {
        if case .running = self {
            return true
        }
        return false
    }
}

public enum Homebrew {
    /// "/opt/homebrew for Apple Silicon" (docs.brew.sh/Installation).
    public static let brew = "/opt/homebrew/bin/brew"

    /// Homebrew's own installer, a package that needs no terminal.
    public static let installer = URL(string: "https://github.com/Homebrew/brew/releases/latest")!

    public static let arguments = ["install", "--yes", "ffmpeg"]

    /// The command as the sheet shows it.
    public static let shown = "brew install ffmpeg"

    /// Installing FFmpeg. Homebrew is called by its whole path and given the
    /// `PATH` it needs: an app has no terminal's.
    public static func install(home: String) -> Command {
        Command(
            URL(fileURLWithPath: brew),
            arguments,
            environment: [
                "PATH": "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
                "HOME": home,
                "HOMEBREW_NO_AUTO_UPDATE": "1",
                "HOMEBREW_NO_ENV_HINTS": "1",
            ]
        )
    }
}

public enum FFmpeg {
    /// What pressing the seal's button opens.
    public static func pressed(homebrew: Bool) -> FFmpegSheet {
        homebrew ? .ask(command: Homebrew.shown) : .noHomebrew
    }

    /// What the sheet's own button does next, where it is not just closing.
    public enum Next: Sendable, Equatable {
        case install
        case openHomebrewInstaller
    }

    public static func next(_ sheet: FFmpegSheet) -> Next? {
        switch sheet {
        case .ask, .failed: .install
        case .noHomebrew: .openHomebrewInstaller
        case .waitingForHomebrew, .running, .done: nil
        }
    }

    /// The sheet that waits for Homebrew, once Homebrew is there or still not.
    public static func waited(homebrewNow: Bool) -> FFmpegSheet {
        homebrewNow ? .running(lines: []) : .waitingForHomebrew
    }

    /// How an installation ended. Done only where the gateway now finds FFmpeg:
    /// a command that said it succeeded and left nothing the gateway loads has
    /// not installed it.
    public static func finished(_ ran: Ran, presentNow: Bool) -> FFmpegSheet {
        if presentNow {
            return .done
        }
        // What it printed, and then what it complained of: a failure's last word
        // is its complaint.
        return .failed(last: ran.lines.last ?? "")
    }
}
