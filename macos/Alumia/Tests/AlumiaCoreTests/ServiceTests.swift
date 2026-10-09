// The service: "registered" is not "running", and the registration is acted on
// by one rule, twice at most.

import XCTest
@testable import AlumiaCore

final class ServiceTests: XCTestCase {
    private func reading(_ registration: Registration, answering: Bool = false) -> ServiceReading {
        ServiceReading(registration: registration, answering: answering)
    }

    func testRegisteredIsNotRunning() {
        // Enabled is "eligible to run": silent past the tolerance, it has stopped.
        XCTAssertEqual(ServiceState.of(reading(.enabled, answering: true), silentFor: 0), .running)
        XCTAssertEqual(ServiceState.of(reading(.enabled), silentFor: ServiceState.tolerance), .registeredButSilent)
        XCTAssertEqual(ServiceState.of(reading(.enabled), silentFor: 60), .registeredButSilent)
        // Just allowed, it is still coming up.
        XCTAssertEqual(ServiceState.of(reading(.enabled), silentFor: ServiceState.tolerance - 1), .running)
        // An answer is an answer, however long the silence before it.
        XCTAssertEqual(ServiceState.of(reading(.enabled, answering: true), silentFor: 600), .running)
    }

    func testEachThingTheSystemSaysIsAState() {
        XCTAssertEqual(ServiceState.of(reading(.notRegistered), silentFor: 0), .notRegistered)
        XCTAssertEqual(ServiceState.of(reading(.requiresApproval), silentFor: 0), .needsApproval)
        XCTAssertEqual(ServiceState.of(reading(.notFound), silentFor: 0), .notFound)
        // Whether Alumia is on or stopped is not the service's to say
        // (PowerTests), and where the bundle is, is settled before the app
        // starts (LaunchTests).
    }

    func testTheClockOfSilenceRunsOnlyWhileRegisteredAndSilent() {
        var clock = SilenceClock()
        let start = Date(timeIntervalSince1970: 1_000)
        XCTAssertEqual(clock.silentFor(reading(.requiresApproval), now: start), 0, "not before it is allowed")
        XCTAssertEqual(clock.silentFor(reading(.requiresApproval), now: start + 600), 0)
        XCTAssertEqual(clock.silentFor(reading(.enabled), now: start + 600), 0, "allowed just now")
        XCTAssertEqual(clock.silentFor(reading(.enabled), now: start + 610), 10)
        XCTAssertEqual(clock.silentFor(reading(.enabled, answering: true), now: start + 615), 0, "an answer sets it back")
        XCTAssertEqual(clock.silentFor(reading(.enabled), now: start + 620), 0)
        XCTAssertEqual(clock.silentFor(reading(.enabled), now: start + 640), 20)
    }

    func testTheRegistrationIsTriedTwiceAndNoMore() {
        var policy = RegistrationPolicy()
        // The cheap way first, then undone and done again, and then nothing.
        XCTAssertEqual(policy.next(state: .registeredButSilent, answering: false), [.register])
        XCTAssertEqual(policy.next(state: .registeredButSilent, answering: false), [.unregister, .register])
        XCTAssertEqual(policy.next(state: .registeredButSilent, answering: false), [], "no third attempt")
        XCTAssertEqual(policy.next(state: .notRegistered, answering: false), [])
        XCTAssertEqual(policy.attempts, RegistrationPolicy.limit)
        // The owner pressing the notice's button is a new opening.
        policy.startOver()
        XCTAssertEqual(policy.next(state: .registeredButSilent, answering: false), [.register])
    }

    func testAServiceThatAnswersIsNeverTouched() {
        var policy = RegistrationPolicy()
        for state in ServiceState.allCases {
            XCTAssertEqual(policy.next(state: state, answering: true), [], "\(state)")
        }
        XCTAssertEqual(policy.attempts, 0, "and nothing was spent on it")
    }

    func testOnlyWhatRegisteringResolvesIsRegistered() {
        XCTAssertEqual(RegistrationPolicy.steps(state: .notRegistered, answering: false, alreadyTried: false), [.register])
        XCTAssertEqual(RegistrationPolicy.steps(state: .notFound, answering: false, alreadyTried: true), [.register])
        for state in [ServiceState.needsApproval, .running] {
            for tried in [false, true] {
                XCTAssertEqual(RegistrationPolicy.steps(state: state, answering: false, alreadyTried: tried), [], "\(state)")
            }
        }
        // Each act that does nothing spends nothing.
        var policy = RegistrationPolicy()
        XCTAssertEqual(policy.next(state: .needsApproval, answering: false), [])
        XCTAssertEqual(policy.attempts, 0)
    }

    func testOnlyWhatIsInsideAnApplicationsFolderIsInOne() {
        let folders = [URL(fileURLWithPath: "/Applications"), URL(fileURLWithPath: "/Users/ana/Applications")]
        let inside = ["/Applications/Alumia.app", "/Users/ana/Applications/Alumia.app", "/Applications/Utilities/Alumia.app"]
        let outside = [
            "/Volumes/Alumia/Alumia.app",
            "/Users/ana/Downloads/Alumia.app",
            "/private/var/folders/xx/T/AppTranslocation/0000/d/Alumia.app",
            "/ApplicationsOld/Alumia.app",
        ]
        for path in inside {
            XCTAssertTrue(ApplicationsFolder.contains(URL(fileURLWithPath: path), folders: folders), path)
        }
        for path in outside {
            XCTAssertFalse(ApplicationsFolder.contains(URL(fileURLWithPath: path), folders: folders), path)
        }
    }

    func testAnAppIsPutInTheFolderWholeOrNotAtAll() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent("alumia-\(UUID().uuidString)")
        defer { try? files.removeItem(at: root) }
        let folder = root.appendingPathComponent("Applications")
        let installed = folder.appendingPathComponent("Alumia.app")
        try files.createDirectory(at: installed, withIntermediateDirectories: true)
        try "old".write(to: installed.appendingPathComponent("which"), atomically: true, encoding: .utf8)
        func which() -> String? { try? String(contentsOf: installed.appendingPathComponent("which"), encoding: .utf8) }

        // A copy that cannot be made leaves the app that was there, and nothing
        // beside it.
        let missing = root.appendingPathComponent("Downloads/Alumia.app")
        XCTAssertThrowsError(try ApplicationsFolder.place(missing, in: folder))
        XCTAssertEqual(which(), "old", "the installed app is still the installed app")
        XCTAssertEqual(try files.contentsOfDirectory(atPath: folder.path), ["Alumia.app"])

        // One that can takes its place, whole.
        try files.createDirectory(at: missing, withIntermediateDirectories: true)
        try "new".write(to: missing.appendingPathComponent("which"), atomically: true, encoding: .utf8)
        XCTAssertEqual(try ApplicationsFolder.place(missing, in: folder).path, installed.path)
        XCTAssertEqual(which(), "new")
        XCTAssertEqual(try files.contentsOfDirectory(atPath: folder.path), ["Alumia.app"])
        XCTAssertTrue(files.fileExists(atPath: missing.path), "it is a copy: the one opened stays where it was")

        // And where there was none, it is simply put there.
        try files.removeItem(at: installed)
        XCTAssertEqual(try ApplicationsFolder.place(missing, in: folder).path, installed.path)
        XCTAssertEqual(which(), "new")
    }
}
