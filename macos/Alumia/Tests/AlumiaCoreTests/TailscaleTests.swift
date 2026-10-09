// Tailscale's five states, each from what its command says.
//
// Two are read from the real answers of the Mac this was written on, with the
// names replaced (Tests/Fixtures): a page published, and the same network asked
// about a port nothing is published for. The other three could not be seen
// without signing the owner's account out or switching HTTPS off in their
// network, and are built from the definitions in Tailscale 1.102.4's source.

import XCTest
@testable import AlumiaCore

final class TailscaleTests: XCTestCase {
    private let status = fixture("tailscale-status.json")
    private let serve = fixture("tailscale-serve.json")

    private func state(_ status: String?, _ serve: String?, port: Int, installed: Bool = true) -> TailscaleState {
        TailscaleState.of(
            installed: installed,
            status: status.flatMap(TailscaleStatus.read),
            serve: serve.flatMap(TailscaleServe.read),
            port: port
        )
    }

    func testAPagePublishedIsReadWithItsAddress() {
        // The real answers, for the port the real publication leads to.
        XCTAssertEqual(state(status, serve, port: 52380), .published("https://mac-da-ana.example.ts.net"))
    }

    func testTheSameNetworkIsReadyWhereNothingIsPublished() {
        // The real status again: connected, with certificates, and nothing
        // published.
        XCTAssertEqual(state(status, "{}", port: 52380), .ready)
        // What is published not said at all is not "nothing published".
        XCTAssertEqual(state(status, nil, port: 52380), .unread)
        // The real publication, asked about another port: the address is in use,
        // by what it leads to (TakenTests).
        XCTAssertEqual(state(status, serve, port: 52399), .taken("http://127.0.0.1:52380"))
    }

    func testNoCommandIsNotInstalled() {
        XCTAssertEqual(state(nil, nil, port: 52380, installed: false), .missing)
        XCTAssertEqual(state(status, serve, port: 52380, installed: false), .missing, "whatever else is said")
    }

    func testAnyStateButRunningIsSignedOut() {
        // The six other values of `BackendState`.
        for other in ["NoState", "InUseOtherUser", "NeedsLogin", "NeedsMachineAuth", "Stopped", "Starting"] {
            let said = status.replacingOccurrences(of: "\"BackendState\": \"Running\"", with: "\"BackendState\": \"\(other)\"")
            XCTAssertNotEqual(said, status)
            XCTAssertEqual(state(said, serve, port: 52380), .signedOut, other)
        }
        // And a command that answered nothing that reads.
        XCTAssertEqual(state("", nil, port: 52380), .signedOut)
        XCTAssertEqual(state("Tailscale is stopped.", nil, port: 52380), .signedOut)
    }

    func testANetworkWithNoCertificatesHasNoHTTPS() {
        // `CertDomains`: "the set of DNS names for which the control plane server
        // will assist with provisioning TLS certificates". None, no HTTPS.
        let empty = status.replacingOccurrences(of: "\"CertDomains\": [\"mac-da-ana.example.ts.net\"]", with: "\"CertDomains\": []")
        let null = status.replacingOccurrences(of: "\"CertDomains\": [\"mac-da-ana.example.ts.net\"]", with: "\"CertDomains\": null")
        XCTAssertNotEqual(empty, status)
        for said in [empty, null] {
            XCTAssertEqual(state(said, "{}", port: 52380), .noHTTPS)
            // Not published either, whatever an old publication still says.
            XCTAssertEqual(state(said, serve, port: 52380), .noHTTPS)
        }
    }

    func testEachStateHasItsWordsInTheWaysIn() {
        let states: [TailscaleState] = [
            .missing, .signedOut, .noHTTPS, .unread, .ready, .taken("http://127.0.0.1:3000"), .published("https://a.example.ts.net"),
        ]
        XCTAssertEqual(states.map(\.name), ["missing", "signed-out", "no-https", "unread", "ready", "taken", "published"])
        // Ready is the one state whose row says what the app is doing about it,
        // and not the state: WaysRowTests.
        for state in states where state != .ready {
            let row = Ways.of(port: 52380, tailscale: state).tailscale
            for key in [row.stateKey, row.noteKey] + [row.actKey].compactMap({ $0 }) {
                XCTAssertTrue(key.hasPrefix("mac.ts.\(state.name)"), key)
                XCTAssertNotEqual(portuguese.say(key), key, "the dictionary has \(key)")
                XCTAssertNotEqual(portuguese.say(key), english.say(key), key)
            }
        }
        let ready = Ways.of(port: 52380, tailscale: .ready)
        XCTAssertEqual(Tailscale.publishing(port: 52380), ["serve", "--bg", "52380"], "the command that is run")
        XCTAssertEqual(ready.here, "http://localhost:52380")
        XCTAssertEqual(ready.address, "http://localhost:52380")
        let published = Ways.of(port: 52380, tailscale: .published("https://a.example.ts.net"))
        XCTAssertNil(published.tailscale.actKey, "nothing left to press")
        XCTAssertEqual(published.address, "https://a.example.ts.net")
    }

    func testTheCommandIsLookedForWhereItIsInstalled() {
        XCTAssertNil(Tailscale.find { _ in false })
        XCTAssertEqual(Tailscale.find { $0 == "/opt/homebrew/bin/tailscale" }?.path, "/opt/homebrew/bin/tailscale")
        XCTAssertEqual(Tailscale.find { _ in true }?.path, "/usr/local/bin/tailscale", "the launcher first")
    }

    func testTheStateIsAskedOfTheCommand() async {
        let runner = Scripted([Ran(status: 0, output: status), Ran(status: 0, output: serve)])
        let tailscale = Tailscale(command: URL(fileURLWithPath: "/usr/local/bin/tailscale"), runner: runner)
        let state = await tailscale.state(port: 52380)
        XCTAssertEqual(state, .published("https://mac-da-ana.example.ts.net"))
        XCTAssertEqual(runner.asked.map(\.arguments), [["status", "--json"], ["serve", "status", "--json"]])

        let none = await Tailscale(command: nil, runner: Scripted([])).state(port: 52380)
        XCTAssertEqual(none, .missing)
    }
}
