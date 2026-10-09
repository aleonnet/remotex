// A copy of the app made for testing and the owner's Tailscale: it is given no
// command, wherever Tailscale is installed, so it reads nothing of the owner's
// publication and changes nothing in it, in its window and in its clean-up alike.

import XCTest
@testable import AlumiaCore

final class IsolationTests: XCTestCase {
    func testACopyMadeForTestingIsGivenNoCommand() {
        XCTAssertNil(Tailscale.of(testCopy: true) { _ in true }.command)
        // The installed app is given the one that is there.
        XCTAssertEqual(Tailscale.of(testCopy: false) { _ in true }.command?.path, "/usr/local/bin/tailscale")
        XCTAssertNil(Tailscale.of(testCopy: false) { _ in false }.command)
    }

    func testWithNoCommandNothingIsAskedOfTailscale() async {
        let runner = Scripted([])
        let tailscale = Tailscale.of(testCopy: true, runner: runner) { _ in true }
        let state = await tailscale.state(port: 52399)
        XCTAssertEqual(state, .missing, "as on a Mac that does not have it")
        let status = await tailscale.status()
        XCTAssertNil(status)
        let published = await tailscale.publish(port: 52399)
        XCTAssertEqual(published, .needsHTTPS(consent: nil))
        let taken = await tailscale.unpublish(port: 52399)
        XCTAssertFalse(taken)
        XCTAssertEqual(runner.asked.count, 0, "not one command was run")
        // And nothing follows from the state it is then in.
        let serving = GatewayStatus(version: "0.0.325", serving: true, ffmpeg: true)
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: serving, state: state), .nothing)
    }
}
