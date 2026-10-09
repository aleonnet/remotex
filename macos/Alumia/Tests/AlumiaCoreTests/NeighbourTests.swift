// Who is asked whether it is an Alumia: the devices that are on, and neither this
// Mac nor a phone or a tablet.

import XCTest
@testable import AlumiaCore

final class NeighbourTests: XCTestCase {
    func testTheDevicesOfTheRealAnswerThatAreWorthAsking() throws {
        let status = try XCTUnwrap(TailscaleStatus.read(fixture("tailscale-status.json")))
        XCTAssertEqual(status.peers.count, 5)
        XCTAssertEqual(status.own?.address, "mac-da-ana.example.ts.net")
        // On, and not a phone: the other Mac, the Windows host and the Linux one.
        // Any of them may host an Alumia; the two iPhones and iPads may not.
        XCTAssertEqual(Neighbours.candidates(in: status).map(\.address), [
            "mac-mini-da-sala.example.ts.net", "pc-da-sala.example.ts.net", "servidor.example.ts.net",
        ])
    }

    func testAPhoneThatIsOnIsNotAsked() throws {
        let said = fixture("tailscale-status.json").replacingOccurrences(of: "\"Online\": false", with: "\"Online\": true")
        let status = try XCTUnwrap(TailscaleStatus.read(said))
        XCTAssertTrue(status.peers.allSatisfy(\.online))
        XCTAssertFalse(Neighbours.candidates(in: status).contains { $0.os == "iOS" })
        XCTAssertEqual(Neighbours.candidates(in: status).count, 3)
    }

    func testADeviceThatIsOffIsNotAsked() throws {
        let said = fixture("tailscale-status.json").replacingOccurrences(of: "\"Online\": true", with: "\"Online\": false")
        let status = try XCTUnwrap(TailscaleStatus.read(said))
        XCTAssertEqual(Neighbours.candidates(in: status), [])
    }

    func testThisMacIsNotAskedAboutItself() throws {
        // A network that lists this Mac among its devices too.
        let own = "\"Peer\": {\n    \"nodekey:self\": { \"HostName\": \"Mac da Ana\", \"DNSName\": \"mac-da-ana.example.ts.net.\", \"OS\": \"macOS\", \"Online\": true },"
        let said = fixture("tailscale-status.json").replacingOccurrences(of: "\"Peer\": {", with: own)
        let status = try XCTUnwrap(TailscaleStatus.read(said))
        XCTAssertEqual(status.peers.count, 6)
        XCTAssertFalse(Neighbours.candidates(in: status).contains { $0.address == "mac-da-ana.example.ts.net" })
        XCTAssertEqual(Neighbours.candidates(in: status).count, 3)
    }

    func testADeviceIsAskedAtItsOwnHTTPSAddress() {
        let device = TailscaleDevice(hostName: "Mac mini da sala", dnsName: "mac-mini-da-sala.example.ts.net.", os: "macOS", online: true)
        XCTAssertEqual(Neighbours.address(of: device)?.absoluteString, "https://mac-mini-da-sala.example.ts.net")
        // One with no name in the network has nowhere to be asked.
        let nameless = TailscaleDevice(hostName: "x", dnsName: "", os: "linux", online: true)
        XCTAssertEqual(
            Neighbours.candidates(in: try! JSONDecoder().decode(TailscaleStatus.self, from: Data("{}".utf8))), []
        )
        XCTAssertEqual(nameless.address, "")
    }
}
