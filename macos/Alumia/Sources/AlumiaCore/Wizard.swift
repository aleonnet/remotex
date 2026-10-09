// The first run: its eleven states, what each asks, and how far it lights the
// glass.
//
// The mockup's first run is one window with a pane of glass on its left and three
// bars on it, one for each thing a Mac needs before its screen is reachable: this
// Mac itself, the way in, and the page's password. A bar is lit as far as its
// part is ready, and with the three lit the glass is. This Mac takes three
// steps, the way in one, the password one.

import Foundation

public enum WizardState: String, Sendable, Equatable, CaseIterable {
    case welcome
    case keep
    case sharing
    case account
    /// The way in has a state for each state Tailscale can be in on this Mac.
    case waysMissing = "ways-missing"
    case waysSignedOut = "ways-signed-out"
    case waysNoHTTPS = "ways-no-https"
    case ways
    case waysPublished = "ways-published"
    case password
    case done
}

/// The step a state belongs to: the ways in are one step, whatever Tailscale says.
public enum WizardStep: Int, Sendable, Equatable, CaseIterable {
    case welcome, keep, sharing, account, ways, password, done
}

/// What the first run knows while it is open.
public struct WizardFacts: Sendable, Equatable {
    /// Something answers at this Mac's Screen Sharing port.
    public var screenSharingOn: Bool
    /// The macOS account the gateway opens this Mac's screen with.
    public var accountUser: String
    public var accountPassword: String
    public var tailscale: TailscaleState
    /// Who signs in to the page.
    public var pageUser: String
    public var pagePassword: String

    public init(screenSharingOn: Bool = false, accountUser: String = "", accountPassword: String = "",
                tailscale: TailscaleState = .missing, pageUser: String = "", pagePassword: String = "") {
        self.screenSharingOn = screenSharingOn
        self.accountUser = accountUser
        self.accountPassword = accountPassword
        self.tailscale = tailscale
        self.pageUser = pageUser
        self.pagePassword = pagePassword
    }
}

/// How far each of the three bars is lit, from nothing to all of it.
public struct Lit: Sendable, Equatable {
    public var mac: Double
    public var way: Double
    public var key: Double

    public init(_ mac: Double, _ way: Double, _ key: Double) {
        self.mac = mac
        self.way = way
        self.key = key
    }
}

/// The first run in one of its states.
public struct Wizard: Sendable, Equatable {
    public var state: WizardState

    public init(_ state: WizardState) {
        self.state = state
    }

    public var step: WizardStep {
        switch state {
        case .welcome: .welcome
        case .keep: .keep
        case .sharing: .sharing
        case .account: .account
        case .waysMissing, .waysSignedOut, .waysNoHTTPS, .ways, .waysPublished: .ways
        case .password: .password
        case .done: .done
        }
    }

    /// The steps that are counted: the welcome before them and the end after are
    /// not.
    public static let counted = 5

    /// "Step n of 5", or `nil` on the welcome and at the end.
    public var number: Int? {
        switch step {
        case .welcome, .done: nil
        case .keep: 1
        case .sharing: 2
        case .account: 3
        case .ways: 4
        case .password: 5
        }
    }

    public var lit: Lit {
        switch step {
        case .welcome: Lit(0, 0, 0)
        case .keep: Lit(1.0 / 3, 0, 0)
        case .sharing: Lit(2.0 / 3, 0, 0)
        case .account: Lit(1, 0, 0)
        case .ways: Lit(1, 1, 0)
        case .password, .done: Lit(1, 1, 1)
        }
    }

    /// The glass itself is lit at the end, and only there.
    public var glassLit: Bool {
        step == .done
    }

    public var titleKey: String {
        switch step {
        case .welcome: "mac.first.welcome.title"
        case .keep: "mac.first.keep.title"
        case .sharing: "mac.first.sharing.title"
        case .account: "mac.first.account.title"
        case .ways: "mac.first.ways.title"
        case .password: "mac.first.password.title"
        case .done: "mac.first.done.title"
        }
    }

    public var bodyKey: String {
        switch step {
        case .welcome: "mac.first.welcome.body"
        case .keep: "mac.first.keep.body"
        case .sharing: "mac.first.sharing.body"
        case .account: "mac.first.account.body"
        case .ways: "mac.first.ways.body"
        case .password: "mac.first.password.body"
        case .done: "mac.first.done.body"
        }
    }

    /// The names of the three bars, in their order.
    public static let barKeys = ["mac.first.bar.mac", "mac.first.bar.way", "mac.first.bar.key"]

    /// The window's name, for whoever does not see it.
    public static let windowKey = "mac.first.window"

    /// The other words of a step, beside its title and its body: the switch of
    /// "keep running", the row that says whether Screen Sharing is on and the
    /// button that leads to it, the account's fields, the page's.
    public var detailKeys: [String] {
        switch step {
        case .welcome: []
        case .keep: ["mac.keep.label", "mac.keep.note"]
        case .sharing:
            ["mac.sharing.name", "mac.sharing.where", "mac.sharing.off", "mac.sharing.on", "mac.open.system", "mac.first.sharing.note"]
        case .account: ["mac.account.user", "signin.password", "signin.show", "mac.account.note"]
        case .ways: ["common.copy"]
        case .password: ["signin.user", "signin.password", "signin.show"]
        case .done: ["mac.copy.address"]
        }
    }

    public static let backKey = "common.back"

    /// "Step n of 5", said.
    public func numbered(_ words: Words) -> String? {
        number.map { words.say("mac.first.step", ["n": String($0), "total": String(Self.counted)]) }
    }

    /// The title of the button that goes on.
    public var forwardKey: String {
        step == .done ? "mac.first.finish" : "common.continue"
    }

    public var hasBack: Bool {
        step != .welcome && step != .done
    }

    /// Whether the button that goes on is on. Screen Sharing is the owner's to
    /// turn on, and the step waits for it; an account and a login need both of
    /// their halves; and the ways in never hold anybody: this Mac's own address
    /// already works, and Tailscale can be seen to later.
    public func canContinue(_ facts: WizardFacts) -> Bool {
        switch step {
        case .welcome, .keep, .ways, .done:
            true
        case .sharing:
            facts.screenSharingOn
        case .account:
            !facts.accountUser.isEmpty && !facts.accountPassword.isEmpty
        case .password:
            PasswordFault.of(user: facts.pageUser, password: facts.pagePassword, again: facts.pagePassword) == nil
        }
    }

    /// The state the way in is in, for what Tailscale is on this Mac.
    public static func ways(_ tailscale: TailscaleState) -> WizardState {
        switch tailscale {
        case .missing: .waysMissing
        case .signedOut: .waysSignedOut
        case .noHTTPS: .waysNoHTTPS
        // An address in use, and one that could not be read, are the same step
        // as one free: only the row differs.
        case .ready, .unread, .taken: .ways
        case .published: .waysPublished
        }
    }

    /// The state after this one, where the button that goes on is pressed.
    public func next(_ facts: WizardFacts) -> WizardState {
        switch step {
        case .welcome: .keep
        case .keep: .sharing
        case .sharing: .account
        case .account: Self.ways(facts.tailscale)
        case .ways: .password
        case .password, .done: .done
        }
    }

    public func previous(_ facts: WizardFacts) -> WizardState {
        switch step {
        case .welcome, .keep: .welcome
        case .sharing: .keep
        case .account: .sharing
        case .ways: .account
        case .password: Self.ways(facts.tailscale)
        case .done: .done
        }
    }

    /// The same step, as Tailscale now is: the way in follows it while it is
    /// open, and no other step does.
    public func following(_ tailscale: TailscaleState) -> WizardState {
        step == .ways ? Self.ways(tailscale) : state
    }
}

/// The three ways in, as the first run and the settings both list them.
public struct Ways: Sendable, Equatable {
    public struct TailscaleRow: Sendable, Equatable {
        /// The word beside the row's name: "not installed", "published".
        public var stateKey: String
        public var noteKey: String
        /// The button's title, where the state has something to press.
        public var actKey: String?
        /// What this Mac's address leads to, where that is not Alumia: what the
        /// note names.
        public var leads: String?
        /// The address shown, with Copy, where it is published.
        public var address: String?

        /// The note, said.
        public func note(_ words: Words) -> String {
            words.say(noteKey, ["where": leads ?? ""])
        }
    }

    /// This Mac's own address, which works before anything else is set up.
    public var here: String
    public var tailscale: TailscaleRow

    public static let hereKey = "mac.ways.here"
    public static let hereNoteKey = "mac.ways.here.note"
    public static let tailscaleKey = "mac.ways.tailscale"
    /// The local network without Tailscale, which the page cannot use yet.
    public static let lanKey = "mac.ways.lan"
    public static let lanNoteKey = "mac.ways.lan.note"
    public static let lanStateKey = "mac.ways.unavailable"

    /// `reachable` is its owner's choice, "reachable from other devices",
    /// `gateway` what the gateway said of itself, and `setUp` whether the first
    /// run is done. Nobody publishes by a button: with Tailscale ready the row
    /// says what the app is doing about it by itself (`Publication.next`), which
    /// before the first run ends, and while the gateway is not serving, is
    /// nothing yet; and the one button left is the one that hands over an
    /// address in use, there only where the publication would stand.
    public static func of(port: Int, tailscale: TailscaleState, reachable: Bool = true,
                          gateway: GatewayStatus? = GatewayStatus(version: "", serving: true, ffmpeg: true),
                          setUp: Bool = true) -> Ways {
        let stopped = gateway?.stopped == true
        let row: TailscaleRow
        switch tailscale {
        case .missing:
            row = TailscaleRow(stateKey: "mac.ts.missing", noteKey: "mac.ts.missing.note", actKey: "mac.ts.missing.act")
        case .signedOut:
            row = TailscaleRow(stateKey: "mac.ts.signed-out", noteKey: "mac.ts.signed-out.note", actKey: "mac.ts.signed-out.act")
        case .noHTTPS:
            row = TailscaleRow(stateKey: "mac.ts.no-https", noteKey: "mac.ts.no-https.note", actKey: "mac.ts.no-https.act")
        case .ready where !reachable:
            row = TailscaleRow(stateKey: "mac.ts.off", noteKey: "mac.ts.off.note")
        case .ready where stopped:
            row = TailscaleRow(stateKey: "mac.ts.off", noteKey: "mac.ts.stopped.note")
        case .ready where !setUp:
            row = TailscaleRow(stateKey: "mac.ts.ready", noteKey: "mac.ts.ready.later")
        case .ready where gateway?.serving != true:
            row = TailscaleRow(stateKey: "mac.ts.ready", noteKey: "mac.ts.ready.waiting")
        case .ready:
            row = TailscaleRow(stateKey: "mac.ts.publishing", noteKey: "mac.ts.publishing.note")
        case .unread:
            row = TailscaleRow(stateKey: "mac.ts.unread", noteKey: "mac.ts.unread.note")
        case .taken(let other):
            let hands = Publication.handsOver(wanted: reachable, setUp: setUp, gateway: gateway)
            row = TailscaleRow(stateKey: "mac.ts.taken", noteKey: "mac.ts.taken.note", actKey: hands ? "mac.ts.taken.act" : nil, leads: other)
        case .published(let address):
            row = TailscaleRow(stateKey: "mac.ts.published", noteKey: "mac.ts.published.note", address: address)
        }
        return Ways(here: "http://localhost:\(port)", tailscale: row)
    }

    /// The address somebody elsewhere opens: the published one, or this Mac's
    /// own where nothing is published.
    public var address: String {
        tailscale.address ?? here
    }

    /// What the menu opens in the browser: this Mac's own address, since it is on
    /// this Mac that it opens, and from here the page knows it is at this Mac.
    public var opened: String {
        here
    }

    /// What the menu copies: the address for another device.
    public var copied: String {
        address
    }
}
