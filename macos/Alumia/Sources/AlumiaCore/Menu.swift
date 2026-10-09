// The menu bar item and its menu: what it says and offers in each state.
//
// A menu and not a window, as Apple asks of a menu bar extra, and AppKit's own
// (`NSStatusItem` with an `NSMenu`). Its top is two lines that cannot be
// clicked: the first says what Alumia is doing on this Mac, with a light beside
// it, and the second who is connected, or what it needs. "Running" is said only
// of a gateway that answered that it is serving the page: a Mac nobody set up,
// and one whose gateway is still coming up, each say what they are. This file is
// what the menu holds; the screen draws it.

import Foundation

/// The icon: three bars, drawn as a template of one colour.
public enum StatusIcon: Sendable, Equatable {
    /// Outlined: ready.
    case outline
    /// Filled: a session is open.
    case filled
    /// Outlined, with a mark beside it: it needs its owner.
    case outlineWithMark
    /// Dimmed: Alumia is serving nothing.
    case dimmed
}

/// The light beside the first line. The sentence says the same: the colour is
/// never the only sign.
public enum Light: Sendable, Equatable {
    /// Serving.
    case green
    /// It needs its owner.
    case amber
    /// Stopped, or not serving yet.
    case grey
}

public enum MenuState: Sendable, Equatable {
    /// Its owner stopped it: nothing is served until it is started.
    case stopped
    /// Nobody has set this Mac up yet.
    case notSetUp
    /// Set up, and its gateway has not said yet that it serves.
    case starting
    case idle
    case serving
    case needsAction(Notice)
}

public enum MenuAction: Sendable, Equatable {
    case stop
    case start
    /// Open the first run.
    case setUp
    case endSession
    case resolve(NoticeAction)
    case installFFmpeg
    case openInBrowser
    case copyAddress
    case settings
    case quit
}

public enum MenuItem: Sendable, Equatable {
    /// The first line: what Alumia is doing on this Mac, and its light.
    case server(light: Light, sentence: String)
    /// The second line: who is connected, or what Alumia needs.
    case detail(sentence: String)
    case action(MenuAction, title: String, shortcut: String?, enabled: Bool)
    case separator
}

public struct Menu: Sendable, Equatable {
    /// The menu's own name, for whoever does not see it.
    public static let nameKey = "mac.menu"

    public var state: MenuState
    public var icon: StatusIcon
    /// What the item is called for whoever does not see it.
    public var label: String
    public var items: [MenuItem]
}

/// What the menu is decided from.
public struct MenuFacts: Sendable, Equatable {
    /// The first run is done: there are settings to serve.
    public var setUp: Bool
    public var notice: Notice?
    /// What the gateway last said, where it answered.
    public var gateway: GatewayStatus?
    /// The lines of the Computers pane, by which a session is named as its line.
    public var computers: [ComputerRow]

    public init(setUp: Bool, notice: Notice?, gateway: GatewayStatus?, computers: [ComputerRow] = []) {
        self.setUp = setUp
        self.notice = notice
        self.gateway = gateway
        self.computers = computers
    }

    /// The computer the open session is on, called as its line is: a Mac in both
    /// of its modes is one line, whichever of its two entries the session is on.
    public var connected: String? {
        guard let session = gateway?.session else { return nil }
        return computers.first { $0.entries.contains(session) }?.name ?? session
    }
}

extension MenuState {
    public static func of(_ facts: MenuFacts) -> MenuState {
        // Stopped is its owner's choice, and nothing it then lacks is asked of
        // them.
        if facts.gateway?.stopped == true {
            return .stopped
        }
        if let notice = facts.notice, notice.needsOwner {
            return .needsAction(notice)
        }
        guard facts.setUp else { return .notSetUp }
        guard let gateway = facts.gateway, gateway.serving else { return .starting }
        return gateway.session == nil ? .idle : .serving
    }
}

extension Menu {
    public static func of(_ facts: MenuFacts, words: Words) -> Menu {
        let state = MenuState.of(facts)
        // The page is there to open, and Alumia to stop, only while the gateway
        // serves.
        let served = facts.gateway?.serving == true
        let session = facts.connected
        var items: [MenuItem] = []
        let icon: StatusIcon
        let label: String

        switch state {
        case .stopped:
            icon = .dimmed
            label = words.say("mac.status.stopped")
            items.append(.server(light: .grey, sentence: words.say("mac.menu.stopped")))
            items.append(.separator)
            items.append(.action(.start, title: words.say("mac.menu.turnon"), shortcut: nil, enabled: true))
        case .notSetUp:
            icon = .dimmed
            label = words.say("mac.status.notsetup")
            items.append(.server(light: .amber, sentence: words.say("mac.menu.notsetup")))
            items.append(.separator)
            items.append(.action(.setUp, title: words.say("mac.menu.setup"), shortcut: nil, enabled: true))
        case .starting:
            icon = .dimmed
            label = words.say("mac.status.starting")
            items.append(.server(light: .grey, sentence: words.say("mac.menu.starting")))
        case .idle:
            icon = .outline
            label = words.say("mac.status.idle")
            items.append(.server(light: .green, sentence: words.say("mac.menu.running")))
            items.append(.detail(sentence: words.say("mac.menu.nobody")))
            items.append(.separator)
        case .serving:
            icon = .filled
            label = words.say("mac.status.serving")
            items.append(.server(light: .green, sentence: words.say("mac.menu.running")))
            items.append(.detail(sentence: words.say("mac.menu.connected", ["name": session ?? ""])))
            items.append(.separator)
            items.append(.action(.endSession, title: words.say("mac.menu.end"), shortcut: nil, enabled: true))
        case .needsAction(let notice):
            icon = .outlineWithMark
            label = words.say("mac.status.needs-action")
            let message = notice.message(words)
            items.append(.server(light: .amber, sentence: words.say("mac.menu.needsyou")))
            items.append(.detail(sentence: message?.text ?? ""))
            items.append(.separator)
            if let title = message?.button {
                items.append(.action(.resolve(notice.action), title: title, shortcut: nil, enabled: true))
            }
            // A session open meanwhile, on another computer than the one the
            // notice is about, is ended from here all the same.
            if session != nil {
                items.append(.action(.endSession, title: words.say("mac.menu.end"), shortcut: nil, enabled: true))
            }
        }

        // Offered from the menu too, where the icon does not ask for it.
        if state != .stopped, facts.notice == .ffmpegMissing {
            items.append(.action(.installFFmpeg, title: words.say("mac.menu.ffmpeg"), shortcut: nil, enabled: true))
        }
        if served {
            items.append(.action(.stop, title: words.say("mac.menu.stop"), shortcut: nil, enabled: true))
        }
        if items.last != .separator {
            items.append(.separator)
        }
        // Always there, and off where there is no page to open.
        items.append(.action(.openInBrowser, title: words.say("mac.menu.open"), shortcut: nil, enabled: served))
        items.append(.action(.copyAddress, title: words.say("mac.copy.address"), shortcut: nil, enabled: served))
        items.append(.separator)
        items.append(.action(.settings, title: words.say("mac.menu.settings"), shortcut: ",", enabled: true))
        items.append(.separator)
        items.append(.action(.quit, title: words.say("mac.menu.quit"), shortcut: "q", enabled: true))
        return Menu(state: state, icon: icon, label: label, items: items)
    }
}
