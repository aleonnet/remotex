// Moving the app to Applications over the copies that run from there: the copy
// is put only once none is left running, never past the limit, and what the
// system then opened has to be the copy that was put.

import XCTest
@testable import AlumiaCore

final class MoveTests: XCTestCase {
    func testTheCopyIsPutOnlyOnceNoInstalledCopyRuns() {
        XCTAssertEqual(Move.next(running: 0, waited: 0), .place, "nothing was running: it is put at once")
        XCTAssertEqual(Move.next(running: 1, waited: 0), .wait, "never over an app that is running")
        XCTAssertEqual(Move.next(running: 2, waited: 3), .wait)
        XCTAssertEqual(Move.next(running: 0, waited: 3), .place, "the last one ended")
    }

    func testItDoesNotWaitForEver() {
        XCTAssertEqual(Move.next(running: 1, waited: Move.limit - 0.25), .wait)
        XCTAssertEqual(Move.next(running: 1, waited: Move.limit), .giveUp, "at the limit nothing is put over what still runs")
        XCTAssertEqual(Move.next(running: 1, waited: 5, limit: 2), .giveUp)
        // One that ended just as the limit passed is still a copy to put.
        XCTAssertEqual(Move.next(running: 0, waited: Move.limit + 1), .place)
    }

    func testWhatWasOpenedHasToBeTheCopyThatWasPut() {
        let placed = URL(fileURLWithPath: "/Applications/Alumia.app")
        // As the system gives a bundle's address: with a slash at its end.
        let launched = URL(fileURLWithPath: "/Applications/Alumia.app/", isDirectory: true)
        XCTAssertTrue(Move.opened(placed: placed, launched: launched, launchedIsThis: false))
        XCTAssertFalse(Move.opened(placed: placed, launched: launched, launchedIsThis: true),
                       "the system took this copy for the app to open")
        XCTAssertFalse(Move.opened(placed: placed, launched: URL(fileURLWithPath: "/Volumes/Alumia/Alumia.app/"), launchedIsThis: false),
                       "what opened is at another address")
        XCTAssertFalse(Move.opened(placed: placed, launched: nil, launchedIsThis: false), "nothing opened")
    }
}
