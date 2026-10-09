// An app put in the place of the one that was installed finds the gateway of the
// one before still running: the gateway says it is not the one in this bundle,
// and its service is ended and started again, from the bundle that is there now.

import XCTest
@testable import AlumiaCore

final class RenewalTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 10_000)

    private func gateway(current: Bool?, session: String? = nil) -> GatewayStatus {
        var gateway = GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380", session: session, ffmpeg: true)
        gateway.current = current
        return gateway
    }

    func testAGatewayOfTheAppThatWasReplacedIsStartedOver() {
        var policy = RegistrationPolicy()
        XCTAssertEqual(policy.renew(gateway: gateway(current: false), state: .running, now: now), [.unregister, .register],
                       "ended, and started from the bundle that is there now")
    }

    func testTheOneOfThisBundleIsLeftAlone() {
        var policy = RegistrationPolicy()
        XCTAssertEqual(policy.renew(gateway: gateway(current: true), state: .running, now: now), [])
        XCTAssertEqual(policy.renew(gateway: gateway(current: nil), state: .running, now: now), [], "and so is one nothing was said of")
        XCTAssertEqual(policy.renew(gateway: nil, state: .running, now: now), [], "and one nobody heard")
        XCTAssertEqual(policy.renewals, 0)
    }

    func testAnOpenSessionIsNotEndedForIt() {
        var policy = RegistrationPolicy()
        XCTAssertEqual(policy.renew(gateway: gateway(current: false, session: "Mac mini virtual"), state: .running, now: now), [])
        // Once it is over, the gateway is started over.
        XCTAssertEqual(policy.renew(gateway: gateway(current: false), state: .running, now: now), [.unregister, .register])
    }

    func testOnlyAServiceThisAppMayRegisterIsTouched() {
        for state in ServiceState.allCases where state != .running {
            var policy = RegistrationPolicy()
            XCTAssertEqual(policy.renew(gateway: gateway(current: false), state: state, now: now), [], "\(state)")
        }
    }

    func testAGatewayThatIsEndingIsNotEndedAgain() {
        // Told to end, a gateway answers for as long as its work is given, and
        // two looks may have read it before either acted: one start over, and
        // then a rest.
        var policy = RegistrationPolicy()
        XCTAssertFalse(policy.renew(gateway: gateway(current: false), state: .running, now: now).isEmpty)
        XCTAssertEqual(policy.renew(gateway: gateway(current: false), state: .running, now: now), [])
        XCTAssertEqual(policy.renew(gateway: gateway(current: false), state: .running, now: now + RegistrationPolicy.rest - 1), [])
        XCTAssertEqual(policy.renewals, 1)
    }

    func testItIsTriedTwiceAtMostInOneOpeningOfTheApp() {
        var policy = RegistrationPolicy()
        var at = now
        for _ in 0..<Renewal.limit {
            XCTAssertFalse(policy.renew(gateway: gateway(current: false), state: .running, now: at).isEmpty)
            at += RegistrationPolicy.rest
        }
        XCTAssertEqual(policy.renew(gateway: gateway(current: false), state: .running, now: at), [], "a third makes nothing of it")
        XCTAssertEqual(policy.renewals, Renewal.limit)
    }

    func testAnActOfItsOwnersIsANewOpening() {
        // The two are what the app tries by itself. Its owner pressing the
        // notice's button, or starting Alumia, begins again, once the last one
        // has rested.
        var policy = RegistrationPolicy()
        var at = now
        for _ in 0..<Renewal.limit {
            XCTAssertFalse(policy.renew(gateway: gateway(current: false), state: .running, now: at).isEmpty)
            at += RegistrationPolicy.rest
        }
        XCTAssertEqual(policy.renew(gateway: gateway(current: false), state: .running, now: at), [])
        policy.startOver()
        XCTAssertEqual(policy.renew(gateway: gateway(current: false), state: .running, now: at), [.unregister, .register],
                       "its owner asked")
        XCTAssertEqual(policy.renewals, 1)
    }

    func testTheGatewayThatComesUpIsGivenWhatASilentOneIs() {
        // A service that was silent earlier in this opening spent the two tries
        // a silent one is given. The gateway started over may be refused its
        // first launch, and is then silent itself: it has both again.
        var policy = RegistrationPolicy()
        XCTAssertEqual(policy.next(state: .registeredButSilent, answering: false), [.register])
        XCTAssertEqual(policy.next(state: .registeredButSilent, answering: false), [.unregister, .register])
        XCTAssertEqual(policy.next(state: .registeredButSilent, answering: false), [], "spent")
        XCTAssertFalse(policy.renew(gateway: gateway(current: false), state: .running, now: now).isEmpty)
        XCTAssertEqual(policy.next(state: .registeredButSilent, answering: false), [.register])
        XCTAssertEqual(policy.next(state: .registeredButSilent, answering: false), [.unregister, .register])
    }

    func testNothingIsRegisteredBehindAnUninstall() {
        var policy = RegistrationPolicy()
        policy.end()
        XCTAssertEqual(policy.next(state: .notRegistered, answering: false), [], "a look already on its way registers nothing")
        XCTAssertEqual(policy.renew(gateway: gateway(current: false), state: .running, now: now), [])
        policy.startOver()
        XCTAssertEqual(policy.next(state: .notRegistered, answering: false), [], "and nothing in this opening brings it back")
    }

    func testTheCommandsWordIsReadAndTheGatewaysOwnExamplesHaveNone() throws {
        let line = fixture("status-serving.json").replacingOccurrences(of: "\n", with: "")
        let decoder = JSONDecoder()
        XCTAssertNil(try decoder.decode(GatewayStatus.self, from: Data(line.utf8)).current)
        let told = line.replacingOccurrences(of: "\"version\"", with: "\"current\": false, \"version\"")
        XCTAssertEqual(try decoder.decode(GatewayStatus.self, from: Data(told.utf8)).current, false)
    }
}
