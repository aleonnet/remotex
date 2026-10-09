// Asking the devices, over HTTP for real, at three servers of the test's own: an
// Alumia, something that answers something else, and something that takes the
// connection and never answers.

import XCTest
@testable import AlumiaCore

final class DiscoverTests: XCTestCase {
    private func device(_ name: String) -> TailscaleDevice {
        TailscaleDevice(hostName: name, dnsName: "\(name).example.ts.net.", os: "macOS", online: true)
    }

    func testOnlyAnAlumiaIsListedAndTheMuteOneIsNotWaitedFor() async throws {
        let alumia = try LocalServer(.answer(#"{"version":"0.0.325","name":"Mac mini da sala"}"#))
        let other = try LocalServer(.answer("<html>a printer</html>"))
        let mute = try LocalServer(.nothing)
        let servers = ["mini": alumia.address, "printer": other.address, "mute": mute.address]
        let devices = ["mute", "printer", "mini"].map(device)

        let began = Date()
        let found = await Neighbours.discover(among: devices, limit: 0.5) { device in
            servers[device.hostName]
        }
        XCTAssertEqual(found, [Neighbour(name: "Mac mini da sala", url: alumia.address.absoluteString)])
        XCTAssertLessThan(Date().timeIntervalSince(began), 10, "the mute one was given its limit, and no more")
    }

    func testAnAlumiaWhoseSystemSaysNoNameIsCalledWhatItsDeviceIs() async throws {
        let unnamed = try LocalServer(.answer(#"{"version":"0.0.325","name":null}"#))
        let found = await Neighbours.discover(among: [device("servidor")], limit: 2) { _ in unnamed.address }
        XCTAssertEqual(found, [Neighbour(name: "servidor", url: unnamed.address.absoluteString)])
    }

    func testAnAnswerThatIsNotAnAlumiasIsNobody() throws {
        let mini = device("mini")
        let at = try XCTUnwrap(URL(string: "https://mini.example.ts.net"))
        let answers: [(String, Int)] = [
            (#"{"version":"0.0.325","name":"Mac mini"}"#, 404),
            (#"{"name":"Mac mini"}"#, 200),
            (#"{"version":"","name":"Mac mini"}"#, 200),
            ("[]", 200),
            ("", 200),
        ]
        for (body, status) in answers {
            XCTAssertNil(Neighbours.neighbour(mini, at: at, answered: Data(body.utf8), status: status), body)
        }
        XCTAssertEqual(
            Neighbours.neighbour(mini, at: at, answered: Data(#"{"version":"1","name":"Mac mini"}"#.utf8), status: 200),
            Neighbour(name: "Mac mini", url: "https://mini.example.ts.net")
        )
    }

    func testNobodyToAskIsNobodyFound() async {
        let found = await Neighbours.discover(among: [], limit: 0.5)
        XCTAssertEqual(found, [])
        // And a device with nowhere to be asked at.
        let nowhere = await Neighbours.discover(among: [device("x")], limit: 0.5) { _ in nil }
        XCTAssertEqual(nowhere, [])
    }

    func testTheListIsPrintedInTheOrderTheDevicesWereGiven() async throws {
        let first = try LocalServer(.answer(#"{"version":"1","name":"A"}"#))
        let second = try LocalServer(.answer(#"{"version":"1","name":"B"}"#))
        let servers = ["a": first.address, "b": second.address]
        let found = await Neighbours.discover(among: [device("b"), device("a")], limit: 2) { servers[$0.hostName] }
        XCTAssertEqual(found.map(\.name), ["B", "A"])
        XCTAssertEqual(
            parsed(Neighbours.printed(found)),
            parsed(#"[{"name":"B","url":"\#(second.address.absoluteString)"},{"name":"A","url":"\#(first.address.absoluteString)"}]"#)
        )
    }
}
