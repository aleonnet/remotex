// How the app starts: what it does with no window first, then an app only from
// an Applications folder, and one at a time.

import XCTest
@testable import AlumiaCore

final class LaunchTests: XCTestCase {
    private let folders = [URL(fileURLWithPath: "/Applications"), URL(fileURLWithPath: "/Users/ana/Applications")]
    private let installed = URL(fileURLWithPath: "/Applications/Alumia.app")
    private let image = URL(fileURLWithPath: "/Volumes/Alumia/Alumia.app")

    private func launch(_ arguments: [String] = [], from own: URL, beside others: [URL] = [], testCopy: Bool = false) -> Launch {
        Launch.of(arguments: arguments, own: own, folders: folders, testCopy: testCopy, others: { others })
    }

    func testWhatRunsWithNoWindowComesBeforeWhereTheBundleIs() {
        // The gateway runs the clean-up from a bundle in the Trash, and the look
        // for other computers from one whose app is running.
        let trashed = URL(fileURLWithPath: "/Users/ana/.Trash/Alumia.app")
        XCTAssertEqual(launch(["--cleanup"], from: trashed), .windowless(.cleanUp), "from the Trash, it cleans up and asks nothing")
        XCTAssertEqual(launch(["--discover"], from: installed, beside: [installed]), .windowless(.discover),
                       "beside the app that runs, it still looks")
        XCTAssertEqual(launch(["--smoke"], from: image, testCopy: true), .windowless(.smoke))
        XCTAssertEqual(launch(["--smoke-trash"], from: image, testCopy: true), .windowless(.smokeTrash))
        // And it asks the system nothing about the copies that run.
        var asked = false
        let decided = Launch.of(arguments: ["--discover"], own: installed, folders: folders, testCopy: false) {
            asked = true
            return []
        }
        XCTAssertEqual(decided, .windowless(.discover))
        XCTAssertFalse(asked, "the copies that run are not asked for where nothing depends on them")
    }

    func testOutsideApplicationsItOffersToBeMovedAndIsNotTheApp() {
        let outside = [
            "/Volumes/Alumia/Alumia.app",
            "/Users/ana/Downloads/Alumia.app",
            "/private/var/folders/xx/T/AppTranslocation/0000/d/Alumia.app",
        ]
        for path in outside {
            XCTAssertEqual(launch(from: URL(fileURLWithPath: path)), .offerMove, path)
            // With the installed one running or not: it is never a second app.
            XCTAssertEqual(launch(from: URL(fileURLWithPath: path), beside: [installed]), .offerMove, path)
        }
    }

    func testFromApplicationsItIsTheAppAndOneAtATime() {
        XCTAssertEqual(launch(from: installed), .app)
        XCTAssertEqual(launch(from: URL(fileURLWithPath: "/Users/ana/Applications/Alumia.app")), .app)
        // Another copy from an Applications folder runs: it is the one opened.
        let other = URL(fileURLWithPath: "/Users/ana/Applications/Alumia.app")
        XCTAssertEqual(launch(from: installed, beside: [other]), .giveWay(to: other), "two copies from Applications never run together")
    }

    func testTheCopyThatMovedItIsNoReasonToGiveWay() {
        // The app just put in Applications is opened while the copy that put it
        // there, in the disk image, has not ended yet.
        XCTAssertEqual(launch(from: installed, beside: [image]), .app, "the copy that is moving it runs from outside Applications")
        // Beside both, it is the one from Applications it gives way to.
        let other = URL(fileURLWithPath: "/Users/ana/Applications/Alumia.app")
        XCTAssertEqual(launch(from: installed, beside: [image, other]), .giveWay(to: other))
    }

    func testACopyMadeForTestingIsTheAppWhereverItWasBuilt() {
        let built = URL(fileURLWithPath: "/Users/ana/alumia/dist/mac/Alumia Test.app")
        XCTAssertEqual(launch(from: built, testCopy: true), .app)
        XCTAssertEqual(launch(from: built, beside: [built], testCopy: true), .app)
    }

    func testTheOfferSaysTheMockupsWordsWithItsButton() {
        let said = Launch.offer(portuguese)
        XCTAssertEqual(said?.code, "AL-1303")
        XCTAssertEqual(said?.text, "O Alumia precisa estar na pasta Aplicativos para continuar rodando.")
        XCTAssertEqual(said?.button, "Mover para Aplicativos")
        XCTAssertEqual(Launch.offer(english)?.text, "Alumia has to be in the Applications folder to keep running.")
        XCTAssertEqual(Launch.offer(english)?.button, "Move to Applications")
    }
}
