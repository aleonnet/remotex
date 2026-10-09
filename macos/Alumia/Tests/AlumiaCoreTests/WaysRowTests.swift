// Tailscale's row of the ways in, in each state: nobody publishes by a button.
// With Tailscale ready the row says what the app is doing about it by itself; the
// one button left is the one that hands over an address in use; and the other
// states are the mockup's.

import XCTest
@testable import AlumiaCore

final class WaysRowTests: XCTestCase {
    private let serving = GatewayStatus(version: "0.0.325", serving: true, ffmpeg: true)

    private func row(_ state: TailscaleState, reachable: Bool = true, stopped: Bool = false, setUp: Bool = true,
                     serving: Bool = true) -> Ways.TailscaleRow {
        let gateway = GatewayStatus(version: "0.0.325", serving: serving && !stopped, ffmpeg: true, stopped: stopped)
        return Ways.of(port: 52380, tailscale: state, reachable: reachable, gateway: gateway, setUp: setUp).tailscale
    }

    func testReadySaysWhatTheAppIsDoingAndHasNoButton() {
        let publishing = row(.ready)
        XCTAssertEqual(portuguese.say(publishing.stateKey), "publicando…")
        XCTAssertEqual(english.say(publishing.stateKey), "publishing…")
        XCTAssertEqual(publishing.noteKey, "mac.ts.publishing.note")
        // Off by its owner's choice, which comes before anything else.
        let off = row(.ready, reachable: false)
        XCTAssertEqual(portuguese.say(off.stateKey), "desligado")
        XCTAssertEqual(off.noteKey, "mac.ts.off.note")
        XCTAssertEqual(row(.ready, reachable: false, stopped: true).noteKey, "mac.ts.off.note")
        // Nothing is published while Alumia is stopped, and the row says which.
        let stopped = row(.ready, stopped: true)
        XCTAssertEqual(portuguese.say(stopped.stateKey), "desligado")
        XCTAssertEqual(stopped.noteKey, "mac.ts.stopped.note")
        // In the first run nothing is published yet: the mockup's word, and when.
        let later = row(.ready, setUp: false)
        XCTAssertEqual(portuguese.say(later.stateKey), "pronto para publicar")
        XCTAssertEqual(later.noteKey, "mac.ts.ready.later")
        // Set up, and its server not serving: nothing is published until it is.
        let waiting = row(.ready, serving: false)
        XCTAssertEqual(portuguese.say(waiting.stateKey), "pronto para publicar")
        XCTAssertEqual(waiting.noteKey, "mac.ts.ready.waiting")
        XCTAssertEqual(Ways.of(port: 52380, tailscale: .ready, gateway: nil).tailscale.noteKey, "mac.ts.ready.waiting", "nor from a gateway nobody heard")
        // Connected, and what is published could not be read.
        let unread = row(.unread)
        XCTAssertEqual(portuguese.say(unread.stateKey), "sem resposta")
        XCTAssertEqual(unread.noteKey, "mac.ts.unread.note")
        for row in [publishing, off, stopped, later, waiting, unread] {
            XCTAssertNil(row.actKey, "nothing to press")
            XCTAssertNil(row.address)
            XCTAssertNotEqual(row.note(portuguese), row.noteKey, "the dictionary has \(row.noteKey)")
            XCTAssertNotEqual(row.note(portuguese), row.note(english))
        }
    }

    func testNoStateOffersToPublish() {
        let states: [TailscaleState] = [
            .missing, .signedOut, .noHTTPS, .unread, .ready, .taken("http://127.0.0.1:3000"), .published("https://a.example.ts.net"),
        ]
        for state in states {
            for reachable in [true, false] {
                for stopped in [true, false] {
                    for setUp in [true, false] {
                        let act = row(state, reachable: reachable, stopped: stopped, setUp: setUp).actKey
                        XCTAssertNotEqual(act, "mac.ts.ready.act", "\(state)")
                        XCTAssertNotEqual(act.map(portuguese.said), "Publicar", "\(state)")
                    }
                }
            }
        }
    }

    func testTheOtherStatesAreTheMockups() {
        XCTAssertEqual(row(.missing).actKey, "mac.ts.missing.act")
        XCTAssertEqual(row(.signedOut).actKey, "mac.ts.signed-out.act")
        XCTAssertEqual(row(.noHTTPS).actKey, "mac.ts.no-https.act")
        XCTAssertEqual(row(.taken("http://127.0.0.1:3000")).actKey, "mac.ts.taken.act")
        let published = row(.published("https://a.example.ts.net"))
        XCTAssertNil(published.actKey)
        XCTAssertEqual(published.address, "https://a.example.ts.net")
        XCTAssertEqual(portuguese.say(published.stateKey), "publicado")
        // Its owner's choice and Alumia stopped change only the row of a
        // Tailscale that is ready: the others say what Tailscale lacks.
        XCTAssertEqual(row(.missing, reachable: false, stopped: true), row(.missing))
        XCTAssertEqual(row(.noHTTPS, reachable: false), row(.noHTTPS))
    }
}
