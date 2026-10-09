// The computers of this Mac's network: which of them the app tries, so that
// macOS asks for the network in Alumia's name, and what each answer means. Only a
// try macOS refused is a matter of permission: a computer that is off is not.

import XCTest
@testable import AlumiaCore

final class LocalNetworkTests: XCTestCase {
    private let rows = Computers.rows([
        ShownComputer(name: "Este Mac virtual", kind: "vnc", subtype: "ard-high-performance", host: "127.0.0.1", hasPassword: true),
        ShownComputer(name: "Este Mac mirrored", kind: "vnc", subtype: "ard-mirror", host: "127.0.0.1", hasPassword: true),
        ShownComputer(name: "Mac mini virtual", kind: "vnc", subtype: "ard-high-performance", host: "mac-mini.example", hasPassword: true),
        ShownComputer(name: "Mac mini mirrored", kind: "vnc", subtype: "ard-mirror", host: "mac-mini.example", hasPassword: true),
        ShownComputer(name: "PC da sala", kind: "rdp", host: "192.168.1.20", hasPassword: true),
        ShownComputer(name: "Túnel", kind: "vnc", host: "localhost", port: 5901),
        ShownComputer(name: "Outra conta no PC", kind: "rdp", host: "192.168.1.20", hasPassword: true),
    ])

    func testEveryComputerThatIsNotThisMacIsTriedOnce() {
        XCTAssertEqual(LocalNetwork.tried(rows), [
            Place(host: "mac-mini.example", port: 5900),
            Place(host: "192.168.1.20", port: 3389),
        ])
        // This Mac by any of its names, and with nothing else there is nobody.
        let own = Computers.rows([
            ShownComputer(name: "a", kind: "vnc", host: "127.0.0.1"),
            ShownComputer(name: "b", kind: "vnc", host: "LOCALHOST", port: 5901),
            ShownComputer(name: "c", kind: "vnc", host: "::1", port: 5902),
        ])
        XCTAssertEqual(LocalNetwork.tried(own), [])
        XCTAssertEqual(LocalNetwork.tried([]), [])
    }

    func testOnlyATryMacOSRefusedIsAMatterOfPermission() {
        XCTAssertTrue(LocalNetwork.denied([.denied]))
        XCTAssertTrue(LocalNetwork.denied([.reached, .silent, .denied]), "one refused says so, whatever the others answered")
        XCTAssertFalse(LocalNetwork.denied([.reached]))
        XCTAssertFalse(LocalNetwork.denied([.silent, .silent]), "a computer that is off is nobody's permission missing")
        XCTAssertFalse(LocalNetwork.denied([]))
    }

    func testARefusalIsTheNoticeOfTheLocalNetworkInItsPlace() {
        let serving = GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380", ffmpeg: false)
        func shown(sharing: Bool, answers: [Reach]) -> Notice? {
            Notice.shown(NoticeFacts(setUp: true, service: .running, gateway: serving, screenSharingOn: sharing, hostsThisMac: true,
                                     localNetworkDenied: LocalNetwork.denied(answers)))
        }
        XCTAssertEqual(shown(sharing: true, answers: [.denied]), .localNetworkDenied)
        XCTAssertEqual(Notice.localNetworkDenied.action, .openLocalNetwork, "its button leads to System Settings")
        XCTAssertEqual(shown(sharing: false, answers: [.denied]), .sharingOff, "this Mac's own screen first")
        XCTAssertEqual(shown(sharing: true, answers: [.silent]), .ffmpegMissing, "and a decoder after it")
        XCTAssertEqual(shown(sharing: true, answers: [.reached]), .ffmpegMissing)
    }

    func testTheyAreTriedAtOnceAfterAChangeAndThenNowAndThen() {
        let now = Date(timeIntervalSince1970: 10_000)
        XCTAssertTrue(LocalNetwork.due(last: nil, now: now, denied: false, shown: true), "the first time, and after a computer is saved")
        XCTAssertFalse(LocalNetwork.due(last: now - 29, now: now, denied: false, shown: true))
        XCTAssertTrue(LocalNetwork.due(last: now - LocalNetwork.every, now: now, denied: false, shown: true))
        // With no window nobody is there to be asked anything.
        XCTAssertFalse(LocalNetwork.due(last: nil, now: now, denied: false, shown: false))
        XCTAssertFalse(LocalNetwork.due(last: now - 3600, now: now, denied: false, shown: false))
        // While macOS refuses, each look tries again, with a window or without:
        // a try made with its question still on screen is refused before
        // anybody answers it, and the notice goes when they allow.
        XCTAssertTrue(LocalNetwork.due(last: now - 1, now: now, denied: true, shown: true))
        XCTAssertTrue(LocalNetwork.due(last: now - 1, now: now, denied: true, shown: false))
    }
}
