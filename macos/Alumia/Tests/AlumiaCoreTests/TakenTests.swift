// This Mac's address in Tailscale already leading to something else of its
// owner's: the state says so and to what, the app publishes nothing over it by
// itself, and the row has the one button by which its owner hands it over.

import XCTest
@testable import AlumiaCore

final class TakenTests: XCTestCase {
    private let status = TailscaleStatus.read(fixture("tailscale-status.json"))
    private let taken = fixture("tailscale-serve-taken.json")

    private func state(_ serve: String, port: Int = 52380) -> TailscaleState {
        TailscaleState.of(installed: true, status: status, serve: TailscaleServe.read(serve), port: port)
    }

    func testAnAddressThatLeadsElsewhereIsInUseAndSaysByWhat() {
        XCTAssertEqual(state(taken), .taken("http://127.0.0.1:3000"))
        // A folder served there, and not another server.
        let folder = taken.replacingOccurrences(of: "\"Proxy\": \"http://127.0.0.1:3000\"", with: "\"Path\": \"/Users/ana/Public\"")
        XCTAssertNotEqual(folder, taken)
        XCTAssertEqual(state(folder), .taken("/Users/ana/Public"))
    }

    func testOnlyTheAddressPublishingWouldTakeIsInUse() {
        // Another port of the address is another address: publishing leaves it.
        let other = taken.replacingOccurrences(of: "mac-da-ana.example.ts.net:443", with: "mac-da-ana.example.ts.net:10000")
        XCTAssertEqual(state(other), .ready)
        // And one somebody published the page at by hand is not the app's to
        // take back: the command the app runs acts on the address's own root,
        // which here is something else's. It is in use, and not published.
        XCTAssertEqual(state(taken, port: 8080), .taken("http://127.0.0.1:3000"))
        XCTAssertNil(TailscaleServe.read(taken)?.address(for: 8080))
        // What leads to the page itself is published, and not in use.
        XCTAssertEqual(state(fixture("tailscale-serve.json")), .published("https://mac-da-ana.example.ts.net"))
        XCTAssertEqual(state("{}"), .ready)
    }

    private let serving = GatewayStatus(version: "0.0.325", serving: true, ffmpeg: true)
    private let stopped = GatewayStatus(version: "0.0.325", serving: false, ffmpeg: true, stopped: true)

    func testNothingIsPublishedOverItByItself() {
        for wanted in [true, false] {
            for gateway in [serving, stopped] {
                XCTAssertEqual(Publication.next(wanted: wanted, setUp: true, gateway: gateway, state: state(taken)), .nothing)
            }
        }
    }

    func testItIsHandedOverOnlyWhereThePublicationWouldStand() {
        // Stopped, or not wanted, what was just published would be taken back
        // at the next look, and what the address led to be gone for nothing;
        // and while the gateway does not serve, or before the first run, there
        // is no page to put there. The row offers no button then.
        func act(reachable: Bool = true, gateway: GatewayStatus?, setUp: Bool = true) -> String? {
            Ways.of(port: 52380, tailscale: state(taken), reachable: reachable, gateway: gateway, setUp: setUp).tailscale.actKey
        }
        XCTAssertEqual(act(gateway: serving), "mac.ts.taken.act")
        XCTAssertNil(act(gateway: stopped))
        XCTAssertNil(act(reachable: false, gateway: serving))
        XCTAssertNil(act(gateway: nil))
        XCTAssertNil(act(gateway: serving, setUp: false))
        XCTAssertTrue(Publication.handsOver(wanted: true, setUp: true, gateway: serving))
        XCTAssertFalse(Publication.handsOver(wanted: true, setUp: true, gateway: stopped))
        XCTAssertFalse(Publication.handsOver(wanted: true, setUp: false, gateway: serving))
    }

    func testTheRowSaysWhereItLeadsAndOffersToUseIt() {
        let row = Ways.of(port: 52380, tailscale: state(taken)).tailscale
        XCTAssertEqual(portuguese.say(row.stateKey), "em uso por outra coisa")
        XCTAssertEqual(row.note(portuguese), "O endereço deste Mac no Tailscale já leva a http://127.0.0.1:3000. O Alumia não mexe nele sozinho.")
        XCTAssertEqual(row.note(english), "This Mac's address in Tailscale already leads to http://127.0.0.1:3000. Alumia does not touch it by itself.")
        XCTAssertEqual(row.actKey.map(portuguese.said), "Usar para o Alumia")
        XCTAssertEqual(row.actKey.map(english.said), "Use it for Alumia")
        XCTAssertNil(row.address)
        // It is still the same step of the first run as an address that is free.
        XCTAssertEqual(Wizard.ways(state(taken)), .ways)
    }
}
