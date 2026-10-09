// The service that keeps the gateway running: what the system says of it, what it
// is really doing, and the one rule for registering it.
//
// The gateway is a launch agent the app registers (`SMAppService.agent`), and the
// app is its control. Three things measured in the house's other Mac app shape
// this file (docs/research/2026-10-05-0030-app-de-mac.md, and the EcoFlow app's
// `ServicoDoSistema.swift`):
//
// - "enabled" is Apple's word for *eligible to run*, not for running. So the
//   state shown combines what the system says with whether the gateway answers,
//   and a gateway that has just been allowed is given time to come up.
// - `register()` on a service already registered returns without doing anything,
//   which leaves a registration inherited from a bundle that went to the Trash
//   registered and silent. `unregister()` fixes that, and ends a service that is
//   running. So a gateway that answers is never touched, a silent one is first
//   registered, and only after that failed is it unregistered and registered.
// - The system does not say when somebody turns the switch on in Login Items: a
//   window that shows the state asks again every two seconds.
//
// Whether Alumia serves is not this file's: an Alumia its owner stopped is the
// same service, registered and answering, that serves nothing until it is started
// (`GatewayStatus.stopped`). Unregistering would end the process, and it is the
// process that keeps a MacBook's built-in display off under a closed lid. So a
// Mac that is set up has its service registered whatever its owner chose, and
// only uninstalling takes the registration away.
//
// The app's own opening at login is another registration, and has a rule of its
// own at the end of this file (`OpenAtLogin`). So has the gateway left running by
// an app that was replaced (`Renewal`).
//
// All of it is the app's as it runs from an Applications folder: from anywhere
// else it does not start as the app, and asks the system nothing (`Launch`).
//
// This is the part with no framework in it, which the tests cover. The screen
// reads `SMAppService` and calls it.

import Foundation

/// What the system says of the gateway's registration: `SMAppService.Status`.
public enum Registration: Sendable, Equatable, CaseIterable {
    case notRegistered
    case enabled
    /// Registered, and waiting for its owner in Login Items; also what turning it
    /// off there gives back.
    case requiresApproval
    case notFound
}

/// How the gateway stands on this Mac.
public enum ServiceState: Sendable, Equatable, CaseIterable {
    case notRegistered
    /// Registered and answering, or registered so recently that it may still be
    /// coming up.
    case running
    /// Registered and allowed, and not answering for longer than it takes to
    /// start.
    case registeredButSilent
    case needsApproval
    /// The system answered that it cannot find the service.
    case notFound
}

/// What is read to tell the state.
public struct ServiceReading: Sendable, Equatable {
    public var registration: Registration
    /// The gateway answered on its control socket just now.
    public var answering: Bool

    public init(registration: Registration, answering: Bool) {
        self.registration = registration
        self.answering = answering
    }
}

extension ServiceState {
    /// How long a registered gateway may be silent before it is said to have
    /// stopped: the time it takes to start, with room.
    public static let tolerance: TimeInterval = 15

    /// The state, from what is read and from how long the gateway has been
    /// registered without answering (see [`SilenceClock`]).
    public static func of(_ reading: ServiceReading, silentFor: TimeInterval) -> ServiceState {
        switch reading.registration {
        case .notRegistered: return .notRegistered
        case .requiresApproval: return .needsApproval
        case .notFound: return .notFound
        case .enabled:
            if reading.answering { return .running }
            return silentFor >= tolerance ? .registeredButSilent : .running
        }
    }
}

/// The clock of "registered and silent". It runs only while the system says
/// enabled and the gateway does not answer, and anything else sets it back: before
/// the owner allows the service it must not run, or the tolerance would be spent
/// by the time they do.
public struct SilenceClock: Sendable, Equatable {
    public var since: Date?

    public init() {}

    public mutating func silentFor(_ reading: ServiceReading, now: Date = Date()) -> TimeInterval {
        guard reading.registration == .enabled, !reading.answering else {
            since = nil
            return 0
        }
        let began = since ?? now
        since = began
        return now.timeIntervalSince(began)
    }
}

/// One act on the registration.
public enum RegistrationStep: Sendable, Equatable {
    case register
    case unregister
}

/// What to do with the registration, decided in one place and tried at most
/// twice each time the app looks: once the cheap way, once undone and done again.
public struct RegistrationPolicy: Sendable, Equatable {
    /// How many times this opening has acted already.
    public private(set) var attempts = 0
    /// How many times it started over a gateway that was not this bundle's
    /// (`Renewal`), and when it last did.
    public private(set) var renewals = 0
    public private(set) var renewed: Date?
    /// An uninstall is under way, and nothing is registered from here on.
    public private(set) var ended = false

    public static let limit = 2

    /// How long after starting a gateway over it is not started over again. A
    /// gateway told to end goes on answering while its work is given its time to
    /// end (five seconds, `TIMES.grace` in src/app.rs), and a look that read it
    /// before another acted would end the one that came up in its place: this
    /// is several times that.
    public static let rest: TimeInterval = 30

    public init() {}

    /// The steps for `state`, where the gateway is `answering` or not; none once
    /// the two attempts are spent.
    public mutating func next(state: ServiceState, answering: Bool) -> [RegistrationStep] {
        let steps = Self.steps(state: state, answering: answering, alreadyTried: attempts > 0)
        guard !ended, !steps.isEmpty, attempts < Self.limit else { return [] }
        attempts += 1
        return steps
    }

    /// The steps that start over a gateway that is not this bundle's
    /// (`Renewal.due`), or none: twice at most in an opening, which an act of
    /// its owner's begins again (`startOver`), and not while the one before
    /// rests. The gateway that comes up may be refused its first
    /// launch and be silent in its turn, so it is given the whole of what a
    /// silent one is, whatever this opening had spent.
    public mutating func renew(gateway: GatewayStatus?, state: ServiceState, now: Date = Date()) -> [RegistrationStep] {
        guard !ended, Renewal.due(gateway: gateway, state: state, tried: renewals) else { return [] }
        if let renewed, now.timeIntervalSince(renewed) < Self.rest {
            return []
        }
        renewals += 1
        renewed = now
        attempts = 0
        return Renewal.steps
    }

    /// The owner pressed the notice's button, or started an Alumia that was
    /// stopped: that is a new opening, for the tries a silent service is given
    /// and for the gateways started over alike.
    public mutating func startOver() {
        attempts = 0
        renewals = 0
    }

    /// An uninstall takes the service away: a look already on its way, which
    /// read the Mac as it was, registers nothing behind it.
    public mutating func end() {
        ended = true
    }

    public static func steps(state: ServiceState, answering: Bool, alreadyTried: Bool) -> [RegistrationStep] {
        // A gateway that answers is well, whatever the system says of it.
        if answering { return [] }
        switch state {
        case .notRegistered, .notFound:
            return [.register]
        case .registeredButSilent:
            return alreadyTried ? [.unregister, .register] : [.register]
        case .needsApproval, .running:
            // Waiting for its owner, or still coming up: registering resolves
            // neither.
            return []
        }
    }
}

/// A gateway that answers and is not the one in this bundle: the app was put in
/// the place of the one that was installed, a newer one over an older, while the
/// older one's gateway ran. Nothing of Alumia's ends a gateway for that, and it
/// would go on serving as the app that is gone did, with the new app asking it
/// for what it does not know. So its service is unregistered and registered
/// again, which the system starts from the file that is at the bundle's path.
/// What of this was measured, and what was not, is in docs/mac-app.md. The count
/// and the rest between two are the policy's (`RegistrationPolicy.renew`).
///
/// Two copies of the app in Applications folders, with the one identifier, do
/// not run together (`Launch`): opened one after the other has quit, each finds
/// the other's gateway not its own and takes these steps. What the system then
/// does with a service two bundles name was not measured.
public enum Renewal {
    /// How many times one opening of the app tries by itself: a gateway that is
    /// still not the bundle's after two is not made so by a third.
    public static let limit = 2

    /// Ended, and registered from the bundle the app runs from.
    public static let steps: [RegistrationStep] = [.unregister, .register]

    /// Whether the service is started over now. Only a gateway that said it is
    /// not current, with nobody connected, since ending it ends the session, and
    /// only where the service is this app's to register: registered and
    /// allowed.
    public static func due(gateway: GatewayStatus?, state: ServiceState, tried: Int) -> Bool {
        guard let gateway, gateway.current == false, gateway.session == nil, state == .running else { return false }
        return tried < limit
    }
}

/// The app's own opening at login (`SMAppService.mainApp`), which is what brings
/// the menu bar item back after its owner signs in again: the gateway comes back
/// by its own registration, and without this one it would serve with nothing on
/// the menu bar to say so.
///
/// The item is shown unless its owner hid it, and a choice nobody made has to be
/// applied by somebody: the app registers by itself, on a Mac that is set up.
/// What is kept between openings is that the system
/// took a registration (`mark`): from then on it is its owner's, and one they
/// took out of Login Items in System Settings is not put back, until the switch
/// is turned. A copy made for testing registers nothing and unregisters nothing.
public struct OpenAtLogin: Sendable, Equatable {
    /// What is read to decide.
    public struct Facts: Sendable, Equatable {
        /// The item is shown: the switch, on unless its owner turned it off.
        public var shown: Bool
        public var setUp: Bool
        public var testCopy: Bool
        /// The mark kept between openings: the system took a registration.
        public var registered: Bool

        public init(shown: Bool, setUp: Bool, testCopy: Bool, registered: Bool) {
            self.shown = shown
            self.setUp = setUp
            self.testCopy = testCopy
            self.registered = registered
        }
    }

    /// This opening of the app asked the system already, or must not.
    public private(set) var tried = false

    public init() {}

    /// Whether the app registers now. Asked at every look and answered yes once
    /// in an opening of the app: a registration the system refuses is asked for
    /// again by the next opening, and not at every look.
    public mutating func next(_ facts: Facts) -> Bool {
        guard !tried, facts.shown, facts.setUp, !facts.testCopy, !facts.registered else { return false }
        tried = true
        return true
    }

    /// The owner turned the switch. Off, whether the app unregisters; on, the
    /// system is asked again in this opening, by `next`, which is where a Mac
    /// that is not set up registers nothing.
    @discardableResult
    public mutating func turned(on: Bool, testCopy: Bool) -> Bool {
        guard !ended else { return false }
        if on {
            tried = false
            return false
        }
        return !testCopy
    }

    /// The mark to keep after the system was asked: registered only where it
    /// took the registration, and not once the switch took it away.
    public static func mark(registering: Bool, took: Bool) -> Bool {
        registering && took
    }

    /// An uninstall is under way.
    private var ended = false

    /// An uninstall forgets the preferences, the mark among them: a look
    /// already on its way would read a Mac that never registered, and register
    /// what was just taken away. Nothing is asked of the system from here on.
    public mutating func end() {
        ended = true
        tried = true
    }
}

/// Where a bundle is the app from: inside an Applications folder only. Opened
/// from the disk image, from Downloads or translocated by Gatekeeper
/// (`/private/var/folders/…/AppTranslocation/…`), it is outside (`Launch`).
public enum ApplicationsFolder {
    public static func contains(_ bundle: URL, folders: [URL]) -> Bool {
        let path = bundle.standardizedFileURL.path
        return folders.contains { path.hasPrefix($0.standardizedFileURL.path + "/") }
    }

    /// Put a copy of `bundle` in `folder`, in the place of the one of its name
    /// that is there, and say where it is. The copy is made beside that one
    /// first and takes its place whole: a copy that fails leaves the app that was
    /// installed, and nothing of itself.
    public static func place(_ bundle: URL, in folder: URL, files: FileManager = .default) throws -> URL {
        let destination = folder.appendingPathComponent(bundle.lastPathComponent)
        let beside = folder.appendingPathComponent(".\(UUID().uuidString)-\(bundle.lastPathComponent)")
        do {
            try files.copyItem(at: bundle, to: beside)
            if files.fileExists(atPath: destination.path) {
                _ = try files.replaceItemAt(destination, withItemAt: beside)
            } else {
                try files.moveItem(at: beside, to: destination)
            }
        } catch {
            try? files.removeItem(at: beside)
            throw error
        }
        return destination
    }
}
