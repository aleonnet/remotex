// The two addresses of the menu: "Open in the browser" opens this Mac's own,
// since it is on this Mac that it opens, and "Copy the address" copies the one
// for another device.

import XCTest
@testable import AlumiaCore

final class AddressTests: XCTestCase {
    func testTheMenuOpensThisMacsAddressAndCopiesThePublishedOne() {
        let published = Ways.of(port: 52380, tailscale: .published("https://mac-da-ana.example.ts.net"))
        XCTAssertEqual(published.opened, "http://localhost:52380")
        XCTAssertEqual(published.copied, "https://mac-da-ana.example.ts.net")
    }

    func testWithNothingPublishedBothAreThisMacs() {
        for state in [TailscaleState.missing, .signedOut, .noHTTPS, .ready, .taken("http://127.0.0.1:3000")] {
            let ways = Ways.of(port: 52399, tailscale: state)
            XCTAssertEqual(ways.opened, "http://localhost:52399", "\(state)")
            XCTAssertEqual(ways.copied, "http://localhost:52399", "\(state)")
        }
    }
}
