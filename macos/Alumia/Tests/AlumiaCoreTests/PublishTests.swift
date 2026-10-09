// "Publish", and the three ways it does not: the command refuses, the command
// says where to enable HTTPS, or the command waits to be answered. Tailscale's
// own documentation says that without HTTPS in the network the command does not
// refuse: it prompts, and waits. An app has nobody at a terminal to answer.

import XCTest
@testable import AlumiaCore

final class PublishTests: XCTestCase {
    private let consent = "https://login.tailscale.com/f/serve?node=n0000000001CNTRL"

    func testACommandThatRefusesIsANetworkWithoutHTTPS() {
        let refused = Ran(status: 1, errors: "error: HTTPS is not enabled for this tailnet\n")
        XCTAssertEqual(Tailscale.published(refused), .needsHTTPS(consent: nil))
        XCTAssertEqual(Tailscale.published(Ran(status: nil, errors: "no such file")), .needsHTTPS(consent: nil))
    }

    func testACommandThatSaysWhereToEnableHTTPSGivesThatAddress() {
        let asked = Ran(status: nil, timedOut: true, output: "Serve is not enabled on your tailnet.\nTo enable, visit:\n\n  \(consent)\n")
        XCTAssertEqual(Tailscale.published(asked), .needsHTTPS(consent: URL(string: consent)))
        // Even one that said so and then ended well has published nothing.
        let ended = Ran(status: 0, output: "To enable, visit: \(consent)\n")
        XCTAssertEqual(Tailscale.published(ended), .needsHTTPS(consent: URL(string: consent)))
    }

    func testACommandStillWaitingAtItsLimitIsANetworkWithoutHTTPS() {
        XCTAssertEqual(Tailscale.published(Ran(status: 15, timedOut: true)), .needsHTTPS(consent: nil))
        XCTAssertEqual(Tailscale.published(Ran(status: 0, timedOut: true)), .needsHTTPS(consent: nil), "ended at the limit, whatever it said")
    }

    func testATryThatDidNotPublishIsShownAsNoHTTPSAndNeverAsPublished() {
        let failed = Publishing.needsHTTPS(consent: URL(string: consent))
        // Tailscale still says "ready": the row must not offer the same button
        // again, nor say it published.
        XCTAssertEqual(TailscaleState.ready.after(failed), .noHTTPS)
        XCTAssertEqual(TailscaleState.ready.after(.needsHTTPS(consent: nil)), .noHTTPS)
        XCTAssertEqual(TailscaleState.noHTTPS.after(failed), .noHTTPS)
        XCTAssertEqual(TailscaleState.signedOut.after(failed), .signedOut)
        // Seen published later, it is published; and a try that worked changes
        // nothing of what Tailscale says.
        XCTAssertEqual(TailscaleState.published("https://a.example.ts.net").after(failed), .published("https://a.example.ts.net"))
        XCTAssertEqual(TailscaleState.ready.after(.done), .ready)
        XCTAssertEqual(TailscaleState.ready.after(nil), .ready)
    }

    func testOnlyACommandThatEndedWellHasPublished() {
        let done = Ran(status: 0, output: "Available within your tailnet:\n\nhttps://mac-da-ana.example.ts.net/\n|-- proxy http://127.0.0.1:52380\n")
        XCTAssertEqual(Tailscale.published(done), .done, "the published address is not a place to enable anything")
    }

    /// The real thing: a command that prompts and waits is ended at the limit,
    /// and the app is not left waiting with it.
    func testACommandThatWaitsIsEndedAtTheLimit() async throws {
        let waits = try script("echo 'To enable, visit: \(consent)'\nexec sleep 30")
        let tailscale = Tailscale(command: waits, publishLimit: 0.3)
        let began = Date()
        let published = await tailscale.publish(port: 52380)
        XCTAssertEqual(published, .needsHTTPS(consent: URL(string: consent)))
        XCTAssertLessThan(Date().timeIntervalSince(began), 10, "it was not waited for")
    }

    func testPublishingRunsTheCommandTheMockupShows() async {
        let runner = Scripted([Ran(status: 0, output: "Available within your tailnet:\n")])
        let tailscale = Tailscale(command: URL(fileURLWithPath: "/usr/local/bin/tailscale"), runner: runner)
        let published = await tailscale.publish(port: 52399)
        XCTAssertEqual(published, .done)
        XCTAssertEqual(runner.asked.map(\.arguments), [["serve", "--bg", "52399"]])
        XCTAssertEqual(runner.asked.first?.limit, 10, "never without a limit")

        let without = await Tailscale(command: nil, runner: Scripted([])).publish(port: 52399)
        XCTAssertEqual(without, .needsHTTPS(consent: nil))
    }

    func testUninstallingTakesBackOnlyAPublicationThatLeadsToThePage() async {
        let status = fixture("tailscale-status.json")
        let serve = fixture("tailscale-serve.json")
        let command = URL(fileURLWithPath: "/usr/local/bin/tailscale")

        let published = Scripted([Ran(status: 0, output: status), Ran(status: 0, output: serve), Ran(status: 0)])
        let taken = await Tailscale(command: command, runner: published).unpublish(port: 52380)
        XCTAssertTrue(taken)
        XCTAssertEqual(published.asked.last?.arguments, ["serve", "--bg", "52380", "off"])

        // What is published leads to another port: it is somebody else's.
        let other = Scripted([Ran(status: 0, output: status), Ran(status: 0, output: serve)])
        let left = await Tailscale(command: command, runner: other).unpublish(port: 52399)
        XCTAssertFalse(left)
        XCTAssertEqual(other.asked.count, 2, "asked, and nothing taken back")
    }
}
