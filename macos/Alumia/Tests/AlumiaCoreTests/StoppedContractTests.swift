// A gateway its owner stopped, as it says so: the example the gateway's own
// tests write the same way (`a_stopped_gateway_says_so_as_the_app_reads_it`,
// src/app.rs), read here as the app reads it.

import XCTest
@testable import AlumiaCore

final class StoppedContractTests: XCTestCase {
    private func status(_ name: String) throws -> GatewayStatus {
        try JSONDecoder().decode(GatewayStatus.self, from: Data(fixture(name).utf8))
    }

    func testAStoppedGatewayIsReadStoppedAndNoFault() throws {
        let stopped = try status("status-stopped.json")
        XCTAssertEqual(stopped, GatewayStatus(version: "0.0.325", serving: false, ffmpeg: true, stopped: true))
        XCTAssertNil(stopped.cause, "stopped by choice is no fault")
        XCTAssertNil(stopped.session)
        // And the other two say that they are not.
        XCTAssertFalse(try status("status-serving.json").stopped)
        XCTAssertFalse(try status("status-waiting.json").stopped)
    }

    func testWhatTheAppMakesOfIt() throws {
        let stopped = try status("status-stopped.json")
        XCTAssertEqual(MenuState.of(MenuFacts(setUp: true, notice: nil, gateway: stopped)), .stopped)
        XCTAssertNil(Notice.shown(NoticeFacts(setUp: true, service: .running, gateway: stopped, screenSharingOn: false, hostsThisMac: true)))
        XCTAssertEqual(Publication.next(wanted: true, setUp: true, gateway: stopped, state: .published("https://a.example.ts.net")), .unpublish)
    }
}
