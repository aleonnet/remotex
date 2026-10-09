// The publication in Tailscale follows the gateway: published while Alumia is on
// and its owner wants it reached from other devices, taken back while it is
// stopped or they do not, and otherwise left alone, a try that has just failed
// included.

import XCTest
@testable import AlumiaCore

final class PublicationTests: XCTestCase {
    private let published = TailscaleState.published("https://a.example.ts.net")
    private let every: [TailscaleState] = [
        .missing, .signedOut, .noHTTPS, .unread, .ready, .taken("http://127.0.0.1:3000"), .published("https://a.example.ts.net"),
    ]
    private let serving = GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380", ffmpeg: true)
    private let stopped = GatewayStatus(version: "0.0.325", serving: false, ffmpeg: true, stopped: true)
    /// Answering, and not serving: its port is another program's.
    private let refused = GatewayStatus(
        version: "0.0.325", serving: false, ffmpeg: true,
        cause: Refusal(code: "AL-9411", says: "Não foi possível escutar em 127.0.0.1:52380.", detail: "")
    )
    /// Answering, with nothing to serve yet: nobody has set this Mac up.
    private let unset = GatewayStatus(
        version: "0.0.325", serving: false, ffmpeg: true,
        cause: Refusal(code: GatewayStatus.notSetUp, says: "Falta configurar.", detail: "")
    )

    func testItIsPublishedWithTailscaleReadyAndAlumiaServingAndWanted() {
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: serving, state: .ready), .publish)
        // And in no other case.
        for state in every {
            for wanted in [true, false] {
                for gateway in [serving, stopped, refused, unset] {
                    let next = Publication.next(wanted: wanted, setUp: true, gateway: gateway, state: state)
                    XCTAssertEqual(next == .publish, state == .ready && wanted && gateway == serving, "\(state) \(wanted) \(gateway)")
                }
            }
        }
    }

    func testAPortTheGatewayDoesNotServeIsNeverHandedToTheNetwork() {
        // The port is another program's, and publishing it would hand that
        // program to the whole network; and before the first run there is no
        // page at all.
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: refused, state: .ready), .nothing)
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: unset, state: .ready), .nothing)
    }

    func testAPublicationThatLeadsToAnotherProgramsPortIsTakenBack() {
        // Published, and the gateway comes back without its port: the address
        // now leads to whatever program has it.
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: refused, state: published), .unpublish)
        // A gateway that is only starting over, or waiting for anything else, is
        // no reason to: the page will be there again.
        let starting = GatewayStatus(version: "0.0.325", serving: false, ffmpeg: true)
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: starting, state: published), .nothing)
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: unset, state: published), .nothing)
    }

    func testAMacWhoseSettingsCouldNotBeReadKeepsItsPublication() {
        // "Not set up" is also what the app sees when the settings do not read:
        // nothing is published then, and nothing is taken back either.
        XCTAssertEqual(Publication.next(wanted: true, setUp: false, gateway: serving, state: .ready), .nothing)
        XCTAssertEqual(Publication.next(wanted: true, setUp: false, gateway: serving, state: published), .nothing)
        XCTAssertEqual(Publication.next(wanted: true, setUp: false, gateway: unset, state: published), .nothing)
    }

    func testAChangeOfPortTakesBackTheOldOneAndPublishesNothing() {
        XCTAssertEqual(Publication.moved(from: 52380, to: 52381, published: true), 52380)
        XCTAssertNil(Publication.moved(from: 52380, to: 52380, published: true), "the same port: as it is")
        XCTAssertNil(Publication.moved(from: 52380, to: 52381, published: false), "nothing was published")
        // What publishes at the new port is the rule, and only once the gateway
        // serves there: a port that is another program's is never published.
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: refused, state: .ready), .nothing)
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: serving, state: .ready), .publish)
    }

    func testItIsTakenBackWhenAlumiaIsStoppedOrItsOwnerDoesNotWantIt() {
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: stopped, state: published), .unpublish)
        XCTAssertEqual(Publication.next(wanted: false, setUp: true, gateway: serving, state: published), .unpublish)
        XCTAssertEqual(Publication.next(wanted: false, setUp: true, gateway: stopped, state: published), .unpublish)
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: serving, state: published), .nothing, "published and wanted: as it is")
        // Only what leads to Alumia is ever taken back.
        for state in every where state != published {
            for wanted in [true, false] {
                XCTAssertNotEqual(Publication.next(wanted: wanted, setUp: true, gateway: stopped, state: state), .unpublish, "\(state)")
            }
        }
    }

    func testNothingIsDecidedFromAGatewayNobodyHeard() {
        for state in every {
            for wanted in [true, false] {
                XCTAssertEqual(Publication.next(wanted: wanted, setUp: true, gateway: nil, state: state), .nothing, "\(state)")
            }
        }
    }

    func testWhatCouldNotBeReadIsNotCalledReady() {
        // Connected, with certificates, and `serve status` answered nothing that
        // reads: the address may be in use, so nothing is published over it.
        let status = TailscaleStatus.read(fixture("tailscale-status.json"))
        let unread = TailscaleState.of(installed: true, status: status, serve: nil, port: 52380)
        XCTAssertEqual(unread, .unread)
        XCTAssertEqual(TailscaleState.of(installed: true, status: status, serve: TailscaleServe.read("not json"), port: 52380), .unread)
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: serving, state: unread), .nothing)
        // Nothing published, said so, is ready.
        XCTAssertEqual(TailscaleState.of(installed: true, status: status, serve: TailscaleServe.read("{}"), port: 52380), .ready)
    }

    func testACommandThatWasRefusedIsNotRunAgainAtEveryLook() {
        let now = Date(timeIntervalSince1970: 10_000)
        XCTAssertFalse(Publication.rests(since: nil, now: now))
        XCTAssertTrue(Publication.rests(since: now - 2, now: now))
        XCTAssertFalse(Publication.rests(since: now - Publication.every, now: now))
        // In the rule itself: a publication Tailscale just refused to take back
        // is left for now, and asked for again once it has rested.
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: stopped, state: published, refused: now - 2, now: now), .nothing)
        XCTAssertEqual(
            Publication.next(wanted: true, setUp: true, gateway: stopped, state: published, refused: now - Publication.every, now: now),
            .unpublish
        )
    }

    func testATryThatJustFailedIsNotTriedAgain() {
        // Tailscale still says ready, and the try said the network has no HTTPS:
        // what is decided from is the state after the try.
        let after = TailscaleState.ready.after(.needsHTTPS(consent: nil))
        XCTAssertEqual(after, .noHTTPS)
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: serving, state: after), .nothing)
    }

    func testAFailedTryIsForgottenOnlyWhileSomebodyIsLooking() {
        let now = Date(timeIntervalSince1970: 10_000)
        // With a window open, the network is asked again once in a while: its
        // owner may just have enabled what it lacked.
        XCTAssertTrue(Publication.forgets(failedAt: now - Publication.every, now: now, shown: true))
        XCTAssertFalse(Publication.forgets(failedAt: now - 29, now: now, shown: true))
        // With nobody there, a network that refused is left alone.
        XCTAssertFalse(Publication.forgets(failedAt: now - 3600, now: now, shown: false))
        XCTAssertFalse(Publication.forgets(failedAt: nil, now: now, shown: true))
    }

    func testTailscaleIsLookedAtNowAndThenWithNoWindowOpen() {
        let now = Date(timeIntervalSince1970: 10_000)
        XCTAssertTrue(Publication.due(last: nil, now: now, shown: false), "the first time")
        XCTAssertFalse(Publication.due(last: now - 29, now: now, shown: false))
        XCTAssertTrue(Publication.due(last: now - Publication.every, now: now, shown: false))
        XCTAssertTrue(Publication.due(last: now - 1, now: now, shown: true), "always, while its state is shown")
    }
}
