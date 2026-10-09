// What the app knows while it runs, and what its screens ask it to do.
//
// It reads four things, again and again: what the system says of the service,
// what the gateway answers, whether Screen Sharing answers, and, while somebody is
// looking, the settings and Tailscale. What each means is AlumiaCore's to decide.
// The system does not say when its owner turns a switch in System Settings, so a
// window that shows a state asks every two seconds.
//
// Four things it does by itself from what it reads, each by a rule of
// AlumiaCore's: it keeps the service registered on a Mac that is set up
// (`RegistrationPolicy`), it starts over a gateway left running by the app it
// took the place of (`Renewal`), it registers its own opening at login
// (`OpenAtLogin`), and it has the publication in Tailscale follow the gateway,
// published while it is on and taken back while it is stopped (`Publication`),
// for which Tailscale is looked at now and then with no window open too.

import AlumiaCore
import AppKit

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var words: Words
    /// What the gateway last answered, or `nil` where it did not.
    @Published private(set) var status: GatewayStatus?
    @Published private(set) var shown: Shown?
    @Published private(set) var service: ServiceState = .running
    @Published private(set) var screenSharingOn = true
    /// "Reachable from other devices", its owner's choice.
    @Published private(set) var reachable: Bool
    /// macOS refused the app a computer of this Mac's network, the last time
    /// they were tried.
    @Published private(set) var localNetworkDenied = false
    @Published private(set) var showInBar: Bool
    @Published private(set) var look: Look
    @Published private(set) var language: LanguageChoice
    /// What Tailscale says, and how the last try at publishing went.
    @Published private var tailscaleRead: TailscaleState = .missing
    @Published private var published: Publishing?
    /// What FFmpeg's sheet shows, while it is open.
    @Published private(set) var ffmpegSheet: FFmpegSheet?
    /// FFmpeg is being installed, with its sheet open or closed.
    @Published private(set) var installing = false

    /// Up while a window is: the state is asked more often while it is looked at.
    var watching = false {
        didSet {
            if watching, !oldValue {
                Task { await refresh() }
            }
        }
    }

    /// Whoever draws outside SwiftUI: the menu bar item.
    var onChange: (() -> Void)?
    /// Whoever shows FFmpeg's sheet: the settings window, which the menu and the
    /// notice open it over.
    var showFFmpeg: (() -> Void)?

    private var silence = SilenceClock()
    private var policy = RegistrationPolicy()
    private var openAtLogin = OpenAtLogin()
    /// When Tailscale was last looked at, and the computers last tried.
    private var lookedAtTailscale: Date?
    private var triedComputers: Date?
    /// When publishing last failed, where it did, and when taking it back did.
    private var failedToPublish: Date?
    private var failedToUnpublish: Date?
    private var loop: Task<Void, Never>?
    /// What Homebrew has said of the installation that runs.
    private var heard: [String] = []
    private var waitingForHomebrew: Task<Void, Never>?

    init() {
        let language = Preferences.language
        self.language = language
        words = Words(language.language(preferred: Locale.preferredLanguages))
        reachable = Preferences.reachable
        showInBar = Preferences.showInBar
        look = Preferences.look
    }

    #if DEBUG
    /// The app in a state somebody describes, for a picture of a screen in it:
    /// the tests' photographs (Tests/AlumiaTests), which no release carries.
    func stage(language: Language, status: GatewayStatus?, shown: Shown?, service: ServiceState,
               screenSharingOn: Bool, tailscale: TailscaleState, installing: Bool = false) {
        words = Words(language)
        self.status = status
        self.shown = shown
        self.service = service
        self.screenSharingOn = screenSharingOn
        tailscaleRead = tailscale
        self.installing = installing
    }
    #endif

    // -- what is read ------------------------------------------------------------------

    private var gateway: Gateway {
        Gateway(binary: Bundled.helper, language: words.language, environment: Bundled.environment)
    }

    private var tailscaleCommand: Tailscale {
        Tailscale.of(testCopy: Bundled.folderNamed != nil) { FileManager.default.isExecutableFile(atPath: $0) }
    }

    func start() {
        apply(look)
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refresh()
                try? await Task.sleep(for: .seconds(self.watching ? 2 : 5))
            }
        }
    }

    func refresh() async {
        let gateway = gateway
        if case .success(let answered) = await gateway.status() {
            status = answered
        } else {
            status = nil
        }
        if shown == nil || watching, case .success(let settings) = await gateway.show() {
            shown = settings
        }
        let reading = ServiceReading(registration: Agent.registration, answering: status != nil)
        service = ServiceState.of(reading, silentFor: silence.silentFor(reading))
        // Nothing is registered before there are settings to serve: the first
        // run registers at its end. From then on the service stays registered,
        // on or stopped: stopped is the gateway's to be, and not the service's.
        if setUp {
            Agent.perform(policy.next(state: service, answering: reading.answering))
        }
        // A gateway left running by the app this one took the place of is
        // started over, from this bundle.
        Agent.perform(policy.renew(gateway: status, state: service))
        registerOpeningAtLogin()
        screenSharingOn = await ScreenSharing.isOn()
        if Publication.due(last: lookedAtTailscale, now: Date(), shown: watching) {
            await followWithTailscale()
        }
        if LocalNetwork.due(last: triedComputers, now: Date(), denied: localNetworkDenied, shown: watching) {
            tryComputers()
        }
        onChange?()
    }

    /// The item is shown unless its owner hid it, and nobody turns a switch to
    /// have what it already shows: so the app registers its own opening at
    /// login. When, and what is kept of it, is `OpenAtLogin`'s to say.
    private func registerOpeningAtLogin() {
        let facts = OpenAtLogin.Facts(shown: showInBar, setUp: setUp, testCopy: Bundled.folderNamed != nil,
                                      registered: Preferences.openAtLoginRegistered)
        if openAtLogin.next(facts) {
            Preferences.openAtLoginRegistered = OpenAtLogin.mark(registering: true, took: Agent.openAtLogin(true))
        }
    }

    /// Read what Tailscale says, and have the publication follow the gateway.
    private func followWithTailscale() async {
        let tailscale = tailscaleCommand
        lookedAtTailscale = Date()
        if Publication.forgets(failedAt: failedToPublish, now: Date(), shown: watching) {
            published = nil
            failedToPublish = nil
        }
        tailscaleRead = await tailscale.state(port: port)
        switch Publication.next(wanted: reachable, setUp: setUp, gateway: status, state: self.tailscale,
                                 refused: failedToUnpublish) {
        case .publish:
            published = await tailscale.publish(port: port)
            if case .needsHTTPS = published {
                failedToPublish = Date()
            }
        case .unpublish:
            failedToUnpublish = await tailscale.unpublish(port: port) ? nil : Date()
            published = nil
        case .nothing:
            return
        }
        tailscaleRead = await tailscale.state(port: port)
    }

    /// Try the computers of the settings from the app, which is what has macOS
    /// ask for this Mac's network in Alumia's name. Not waited for: one that is
    /// off takes its whole limit to say nothing.
    private func tryComputers() {
        triedComputers = Date()
        let places = LocalNetwork.tried(rows)
        Task {
            let denied = LocalNetwork.denied(await Reaching.all(places))
            if denied != localNetworkDenied {
                localNetworkDenied = denied
                onChange?()
            }
        }
    }

    // -- what follows from it ------------------------------------------------------------

    var setUp: Bool {
        shown?.configured ?? false
    }

    var rows: [ComputerRow] {
        Computers.rows(shown?.computers ?? [])
    }

    /// Where the page is served: what the settings say, and before there are
    /// any, where the first run will have it.
    var port: Int {
        setUp ? shown?.port ?? Bundled.pagePort : Bundled.pagePort
    }

    var tailscale: TailscaleState {
        tailscaleRead.after(published)
    }

    var ways: Ways {
        Ways.of(port: port, tailscale: tailscale, reachable: reachable, gateway: status, setUp: setUp)
    }

    /// Whether Alumia is on: what the General pane's switch shows. On is what a
    /// Mac is unless its gateway said it was stopped.
    var running: Bool {
        status?.stopped != true
    }

    /// The one notice.
    var notice: Notice? {
        Notice.shown(NoticeFacts(
            setUp: setUp,
            service: service,
            gateway: status,
            screenSharingOn: screenSharingOn,
            hostsThisMac: rows.contains(where: \.isThisMac),
            localNetworkDenied: localNetworkDenied
        ))
    }

    /// FFmpeg's seal, where the gateway answered: whether it is there is the
    /// gateway's to say, and of one that is silent nothing is said.
    var ffmpegSeal: FFmpegSeal? {
        status.map { FFmpegSeal.of(present: $0.ffmpeg, installing: installing) }
    }

    var menu: Menu {
        Menu.of(MenuFacts(setUp: setUp, notice: notice, gateway: status, computers: rows), words: words)
    }

    func say(_ key: String, _ fill: [String: String] = [:]) -> String {
        words.say(key, fill)
    }

    // -- what the owner chooses ------------------------------------------------------------

    /// Stop Alumia, or start it: the menu's two items and the General pane's
    /// switch. It is the gateway that is asked, and it stays the process it is:
    /// stopped, the page closes, the open session ends, and what is published in
    /// Tailscale is taken back at once.
    func setRunning(_ on: Bool) {
        Task {
            _ = on ? await gateway.start() : await gateway.stop()
            if on {
                policy.startOver()
            }
            lookedAtTailscale = nil
            await refresh()
        }
    }

    func set(reachable: Bool) {
        self.reachable = reachable
        Preferences.reachable = reachable
        lookedAtTailscale = nil
        Task { await refresh() }
    }

    func set(showInBar: Bool) {
        self.showInBar = showInBar
        Preferences.showInBar = showInBar
        if openAtLogin.turned(on: showInBar, testCopy: Bundled.folderNamed != nil) {
            Preferences.openAtLoginRegistered = OpenAtLogin.mark(registering: false, took: Agent.openAtLogin(false))
        }
        registerOpeningAtLogin()
        onChange?()
    }

    func set(look: Look) {
        self.look = look
        Preferences.look = look
        apply(look)
    }

    func set(language: LanguageChoice) {
        self.language = language
        Preferences.language = language
        words = Words(language.language(preferred: Locale.preferredLanguages))
        onChange?()
    }

    private func apply(_ look: Look) {
        switch look {
        case .system: NSApp.appearance = nil
        case .light: NSApp.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
        }
    }

    // -- what the screens ask ----------------------------------------------------------------

    /// Make `change` in the settings; a refusal comes back said.
    func apply(_ change: Change) async -> Refusal? {
        switch await gateway.apply(change) {
        case .success:
            // A computer just saved is tried now: this is when macOS asks.
            triedComputers = nil
            await refresh()
            return nil
        case .failure(let refusal):
            return refusal
        }
    }

    /// Serve the page at `port`. A publication in Tailscale that led to the port
    /// it had is taken back: left where it was, it would lead to nothing. Nothing
    /// is published here: the rule does that, at the next look, once the gateway
    /// says it serves at the new port.
    func set(port: Int) async -> Refusal? {
        let (old, moved) = (self.port, isPublished)
        if let refusal = await apply(Change(listen: "127.0.0.1:\(port)")) {
            return refusal
        }
        if let left = Publication.moved(from: old, to: port, published: moved) {
            _ = await tailscaleCommand.unpublish(port: left)
            lookedAtTailscale = nil
            await refresh()
        }
        return nil
    }

    func endSession() {
        Task {
            _ = await gateway.endSession()
            await refresh()
        }
    }

    func openInBrowser() {
        Opening.url(ways.opened)
    }

    func copyAddress() {
        Opening.copy(ways.copied)
    }

    func resolve(_ action: NoticeAction) {
        switch action {
        case .openLoginItems: Opening.loginItems()
        case .openSharing: Opening.sharingSettings()
        case .openLocalNetwork: Opening.localNetworkSettings()
        case .startAgain:
            policy.startOver()
            Task { await refresh() }
        case .installFFmpeg:
            pressFFmpeg()
        }
    }

    // -- FFmpeg ---------------------------------------------------------------------------------

    private var homebrewIsHere: Bool {
        FileManager.default.isExecutableFile(atPath: Homebrew.brew)
    }

    /// The seal's button, the notice's and the menu's item: the sheet, on how
    /// the installation goes where one runs, and on what installing takes where
    /// none does.
    func pressFFmpeg() {
        ffmpegSheet = installing ? .running(lines: heard) : FFmpeg.pressed(homebrew: homebrewIsHere)
        showFFmpeg?()
    }

    /// The sheet's own button.
    func goOnWithFFmpeg() {
        guard let sheet = ffmpegSheet else { return }
        switch FFmpeg.next(sheet) {
        case .install:
            install()
        case .openHomebrewInstaller:
            NSWorkspace.shared.open(Homebrew.installer)
            ffmpegSheet = FFmpeg.waited(homebrewNow: false)
            waitForHomebrew()
        case nil:
            closeFFmpeg()
        }
    }

    /// Close the sheet. An installation that runs goes on, and the seal says so.
    func closeFFmpeg() {
        waitingForHomebrew?.cancel()
        waitingForHomebrew = nil
        ffmpegSheet = nil
    }

    /// The sheet waits for Homebrew, and goes on by itself once it is there.
    private func waitForHomebrew() {
        waitingForHomebrew?.cancel()
        waitingForHomebrew = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard let self, !Task.isCancelled, self.ffmpegSheet == .waitingForHomebrew else { return }
                if FFmpeg.waited(homebrewNow: self.homebrewIsHere) != .waitingForHomebrew {
                    self.install()
                    return
                }
            }
        }
    }

    private func install() {
        guard !installing else { return }
        installing = true
        heard = []
        ffmpegSheet = .running(lines: [])
        Task {
            let ran = await SystemRunner().run(Homebrew.install(home: NSHomeDirectory())) { line in
                Task { @MainActor in
                    self.hear(line)
                }
            }
            // Installed is what the gateway now finds, whatever Homebrew said.
            await refresh()
            installing = false
            if ffmpegSheet != nil {
                ffmpegSheet = FFmpeg.finished(ran, presentNow: status?.ffmpeg == true)
            }
            onChange?()
        }
    }

    private func hear(_ line: String) {
        guard installing else { return }
        heard.append(line)
        if case .running = ffmpegSheet {
            ffmpegSheet = .running(lines: heard)
        }
    }

    /// What the button of Tailscale's row does, in the state it is in.
    func actOnTailscale() {
        switch tailscale {
        case .missing: Opening.tailscaleDownload()
        case .signedOut: Opening.tailscaleApp()
        case .noHTTPS:
            if case .needsHTTPS(let consent?) = published {
                NSWorkspace.shared.open(consent)
            } else {
                Opening.tailscaleAdmin()
            }
        case .ready, .unread:
            // Nothing to press: the publication follows the gateway.
            break
        case .taken:
            // Its owner hands the address over: published in the place of what
            // it led to, and only where the row offers it, which is where the
            // publication would stand.
            guard ways.tailscale.actKey != nil else { break }
            Task {
                published = await tailscaleCommand.publish(port: port)
                lookedAtTailscale = nil
                await refresh()
            }
        case .published(let address):
            Opening.copy(address)
        }
    }

    /// Take away everything the app left on this Mac but the app itself.
    func uninstall() async {
        loop?.cancel()
        // And a look already on its way registers nothing behind this.
        policy.end()
        openAtLogin.end()
        var publishedPort: Int?
        if case .published = await tailscaleCommand.state(port: port) {
            publishedPort = port
        }
        for step in Uninstall.steps(publishedPort: publishedPort, folder: Bundled.folder) {
            switch step {
            case .unpublish(let port): _ = await tailscaleCommand.unpublish(port: port)
            case .unregisterService: Agent.perform([.unregister])
            case .unregisterLoginItem: Agent.openAtLogin(false)
            case .removeFolder(let folder):
                do {
                    try Uninstall.remove(folder: folder)
                } catch {
                    log.error("the app's folder could not be deleted: \(error.localizedDescription, privacy: .public)")
                }
            case .forgetPreferences: Preferences.forget()
            }
        }
    }

    /// Whether the page is published in Tailscale now: what the uninstall alert
    /// lists a line for.
    var isPublished: Bool {
        if case .published = tailscale {
            return true
        }
        return false
    }
}
