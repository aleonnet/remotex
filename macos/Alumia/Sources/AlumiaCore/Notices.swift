// The notice: one strip, one button, for the one thing that most needs its owner.
//
// The mockup shows a single notice over the settings, and the menu bar's icon
// says the same thing. When more than one thing is wrong, the one shown is the
// one that has to be resolved first: a service nobody allowed does not run, one
// that does not run shares no screen, this Mac's own screen comes before the
// computers of its network, and a screen that cannot be shared needs no decoder
// yet. An Alumia its owner stopped lacks nothing they have to be told: the menu
// says it is stopped. And an app outside Applications has no notice here: it
// does not start as the app, and says so itself (`Launch`).
//
// Each is a message of the catalogue, said with its code (docs/design/errors.json,
// the app's places).

import Foundation

/// What a notice's button does.
public enum NoticeAction: Sendable, Equatable {
    /// System Settings, at Login Items.
    case openLoginItems
    case startAgain
    /// System Settings, at Sharing.
    case openSharing
    /// System Settings, at Privacy & Security, Local Network.
    case openLocalNetwork
    case installFFmpeg
}

public enum Notice: Sendable, Equatable {
    case needsApproval
    /// The gateway is not serving. With `cause`, the gateway said why (a port
    /// somebody else has, settings it refuses), already in the app's language.
    case serviceStopped(cause: Refusal?)
    case sharingOff
    /// macOS did not let Alumia reach a computer of this Mac's network: its
    /// owner answered no when it asked, or turned it off in System Settings.
    case localNetworkDenied
    case ffmpegMissing

    /// The catalogue's code.
    public var code: String {
        switch self {
        case .sharingOff: "AL-1301"
        case .needsApproval: "AL-1302"
        case .serviceStopped: "AL-1304"
        case .ffmpegMissing: "AL-1305"
        case .localNetworkDenied: "AL-1306"
        }
    }

    public var action: NoticeAction {
        switch self {
        case .needsApproval: .openLoginItems
        case .serviceStopped: .startAgain
        case .sharingOff: .openSharing
        case .localNetworkDenied: .openLocalNetwork
        case .ffmpegMissing: .installFFmpeg
        }
    }

    /// Whether the menu bar's icon says "needs you" for it. A missing FFmpeg does
    /// not: the screen opens without it, in a browser that decodes the Mac's
    /// video, and the menu offers to install it.
    public var needsOwner: Bool {
        self != .ffmpegMissing
    }

    /// The notice as it is said: the catalogue's sentence and button, and for a
    /// gateway that said why it is not serving, its reason in the sentence's
    /// place, under the same button.
    public func message(_ words: Words) -> Message? {
        guard var message = words.message(code) ?? words.message("AL-1300") else { return nil }
        if case .serviceStopped(let cause?) = self, !cause.says.isEmpty {
            message.code = cause.code
            message.text = cause.says
        }
        return message
    }
}

/// What the notice is decided from.
public struct NoticeFacts: Sendable, Equatable {
    /// The first run is done: there are settings to serve.
    public var setUp: Bool
    public var service: ServiceState
    /// What the gateway last said, where it answered.
    public var gateway: GatewayStatus?
    /// Something accepts a connection at this Mac's port 5900, which is what the
    /// gateway needs of Screen Sharing and all the app can know of its switch.
    public var screenSharingOn: Bool
    /// One of the computers is this Mac, whose screen is the one Screen Sharing
    /// shares and FFmpeg decodes.
    public var hostsThisMac: Bool
    /// macOS refused the app a computer of this Mac's network just now
    /// (`Reach.denied`).
    public var localNetworkDenied: Bool

    public init(setUp: Bool, service: ServiceState, gateway: GatewayStatus?, screenSharingOn: Bool, hostsThisMac: Bool,
                localNetworkDenied: Bool = false) {
        self.localNetworkDenied = localNetworkDenied
        self.setUp = setUp
        self.service = service
        self.gateway = gateway
        self.screenSharingOn = screenSharingOn
        self.hostsThisMac = hostsThisMac
    }
}

extension Notice {
    /// The one notice to show, or none.
    public static func shown(_ facts: NoticeFacts) -> Notice? {
        if facts.service == .needsApproval {
            return .needsApproval
        }
        // Stopped by its owner's choice is a state the menu says, and no notice.
        if facts.gateway?.stopped == true {
            return nil
        }
        // Before the first run there is nothing to serve, and its absence is the
        // first run's to say.
        guard facts.setUp else { return nil }
        switch facts.service {
        case .registeredButSilent, .notRegistered, .notFound:
            return .serviceStopped(cause: nil)
        case .needsApproval, .running:
            break
        }
        if let gateway = facts.gateway, !gateway.serving, let cause = gateway.cause, cause.code != GatewayStatus.notSetUp {
            return .serviceStopped(cause: cause)
        }
        if facts.hostsThisMac, !facts.screenSharingOn {
            return .sharingOff
        }
        if facts.localNetworkDenied {
            return .localNetworkDenied
        }
        if facts.hostsThisMac, let gateway = facts.gateway, !gateway.ffmpeg {
            return .ffmpegMissing
        }
        return nil
    }
}
