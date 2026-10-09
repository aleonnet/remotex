// The app's own opening at login, which is what brings the menu bar item back
// after its owner signs in again: registered by the app itself on a Mac that is
// set up, kept as done only where the system took it, and after that its
// owner's, put back only by the switch.

import XCTest
@testable import AlumiaCore

final class OpenAtLoginTests: XCTestCase {
    private func facts(shown: Bool = true, setUp: Bool = true, testCopy: Bool = false, registered: Bool = false) -> OpenAtLogin.Facts {
        OpenAtLogin.Facts(shown: shown, setUp: setUp, testCopy: testCopy, registered: registered)
    }

    func testAnInstalledAppThatShowsItsItemRegistersByItself() {
        var opening = OpenAtLogin()
        XCTAssertTrue(opening.next(facts()))
        // Once in an opening of the app: a refusal is not asked again at every look.
        XCTAssertFalse(opening.next(facts()), "tried once already")
        // And the next opening tries again, while the system has not taken it.
        var another = OpenAtLogin()
        XCTAssertTrue(another.next(facts()))
    }

    func testItIsDoneOnlyWhereTheSystemTookIt() {
        XCTAssertTrue(OpenAtLogin.mark(registering: true, took: true))
        XCTAssertFalse(OpenAtLogin.mark(registering: true, took: false), "refused: the next opening tries again")
        XCTAssertFalse(OpenAtLogin.mark(registering: false, took: true), "taken away by the switch: nothing is registered")
        XCTAssertFalse(OpenAtLogin.mark(registering: false, took: false))
    }

    func testWhatItsOwnerTookAwayIsNotPutBack() {
        // Registered once, it is its owner's: taken out of Login Items in System
        // Settings, it stays out, in this opening and in the next.
        var opening = OpenAtLogin()
        XCTAssertFalse(opening.next(facts(registered: true)))
        var another = OpenAtLogin()
        XCTAssertFalse(another.next(facts(registered: true)))
    }

    func testNothingIsRegisteredBeforeTheMacIsSetUpOrHidden() {
        var opening = OpenAtLogin()
        XCTAssertFalse(opening.next(facts(setUp: false)))
        XCTAssertFalse(opening.next(facts(shown: false)))
        // None of them was a try: set up at the end of the first run, it registers.
        XCTAssertTrue(opening.next(facts()))
    }

    func testTheSwitchPutsItBackAndTakesItAway() {
        var opening = OpenAtLogin()
        XCTAssertTrue(opening.next(facts()))
        // Off: unregistered, and the mark goes with it (`mark`).
        XCTAssertTrue(opening.turned(on: false, testCopy: false), "it is unregistered")
        XCTAssertFalse(opening.next(facts(shown: false)))
        // On again: asked of the system now, though this opening had tried.
        XCTAssertFalse(opening.turned(on: true, testCopy: false), "nothing to unregister")
        XCTAssertTrue(opening.next(facts()))
        // And on a Mac nobody set up, turning it on registers nothing: the app
        // does, by itself, once it is set up.
        var unset = OpenAtLogin()
        XCTAssertFalse(unset.turned(on: true, testCopy: false))
        XCTAssertFalse(unset.next(facts(setUp: false)))
    }

    func testACopyMadeForTestingNeverTouchesItsOwnersLoginItems() {
        var opening = OpenAtLogin()
        XCTAssertFalse(opening.next(facts(testCopy: true)))
        XCTAssertFalse(opening.turned(on: false, testCopy: true), "nothing is unregistered either")
        XCTAssertFalse(opening.turned(on: true, testCopy: true))
        XCTAssertFalse(opening.next(facts(testCopy: true)))
    }

    func testNothingIsRegisteredBehindAnUninstall() {
        var opening = OpenAtLogin()
        opening.end()
        // The preferences are forgotten, the mark with them: a look already on
        // its way finds a Mac that reads as never registered.
        XCTAssertFalse(opening.next(facts()))
        opening.turned(on: true, testCopy: false)
        XCTAssertFalse(opening.next(facts()), "and nothing brings it back in this opening")
    }
}
