// The two lines at the menu's top, in each of its six states: what Alumia is
// doing on this Mac, with its light, and under it who is connected or what is
// needed. And the three things they must never get wrong: "running" is said only
// of a gateway that answered that it serves, "Stop" is there only then, and
// "Turn on" only for one its owner stopped.

import XCTest
@testable import AlumiaCore

final class MenuLinesTests: XCTestCase {
    private let serving = GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380", ffmpeg: true)
    private let stopped = GatewayStatus(version: "0.0.325", serving: false, ffmpeg: true, stopped: true)
    /// Answering, and with nothing to serve yet: nobody has set this Mac up.
    private let unset = GatewayStatus(
        version: "0.0.325", serving: false, ffmpeg: true,
        cause: Refusal(code: GatewayStatus.notSetUp, says: "Falta configurar.", detail: "")
    )
    /// A Mac in both of its modes: one line, two entries of the settings.
    private let rows = Computers.rows([
        ShownComputer(name: "Mac mini virtual", kind: "vnc", subtype: "ard-high-performance", host: "mini.example", hasPassword: true),
        ShownComputer(name: "Mac mini mirrored", kind: "vnc", subtype: "ard-mirror", host: "mini.example", hasPassword: true),
    ])

    private func facts(setUp: Bool = true, notice: Notice? = nil, gateway: GatewayStatus?) -> MenuFacts {
        MenuFacts(setUp: setUp, notice: notice, gateway: gateway, computers: rows)
    }

    private func session(on name: String) -> GatewayStatus {
        var status = serving
        status.session = name
        return status
    }

    /// The lines that cannot be chosen, as they read.
    private func lines(_ facts: MenuFacts, _ words: Words = portuguese) -> [String] {
        read(Menu.of(facts, words: words)).filter { ["●", "▲", "○", " "].contains(String($0.prefix(1))) }
    }

    private func has(_ action: MenuAction, _ facts: MenuFacts) -> Bool {
        Menu.of(facts, words: portuguese).items.contains { item in
            if case .action(let found, _, _, _) = item { found == action } else { false }
        }
    }

    /// Every way a Mac can stand, by name.
    private var every: [(String, MenuFacts)] {
        [
            ("stopped", facts(gateway: stopped)),
            ("not set up, nothing answering", facts(setUp: false, gateway: nil)),
            ("not set up, the gateway saying so", facts(setUp: false, gateway: unset)),
            ("starting, nothing answering", facts(gateway: nil)),
            ("starting, answering and not serving yet", facts(gateway: unset)),
            ("idle", facts(gateway: serving)),
            ("a session open", facts(gateway: session(on: "Mac mini mirrored"))),
            ("needs its owner, serving", facts(notice: .sharingOff, gateway: serving)),
            ("needs its owner, silent", facts(notice: .serviceStopped(cause: nil), gateway: nil)),
        ]
    }

    func testEachStateHasItsLines() {
        XCTAssertEqual(lines(facts(gateway: stopped)), ["○ O Alumia está parado"])
        XCTAssertEqual(lines(facts(setUp: false, gateway: nil)), ["▲ Falta configurar o Alumia"])
        XCTAssertEqual(lines(facts(gateway: nil)), ["○ O Alumia está iniciando…"])
        XCTAssertEqual(lines(facts(gateway: serving)), ["● O Alumia está rodando", "  Ninguém conectado"])
        // The session is called as its line is, whichever of a Mac's two entries
        // it is on, and by the entry's own name where no line has it.
        XCTAssertEqual(lines(facts(gateway: session(on: "Mac mini mirrored"))), ["● O Alumia está rodando", "  Conectado: Mac mini"])
        XCTAssertEqual(lines(facts(gateway: session(on: "Mac mini virtual"))), ["● O Alumia está rodando", "  Conectado: Mac mini"])
        XCTAssertEqual(lines(facts(gateway: session(on: "PC da sala"))), ["● O Alumia está rodando", "  Conectado: PC da sala"])
        XCTAssertEqual(lines(facts(notice: .localNetworkDenied, gateway: serving)), [
            "▲ O Alumia precisa de você",
            "  O macOS não está deixando o Alumia alcançar os computadores da rede local. "
                + "Permita em Ajustes do Sistema › Privacidade e Segurança › Rede Local.",
        ])
        XCTAssertEqual(lines(facts(gateway: session(on: "Mac mini virtual")), english), ["● Alumia is running", "  Connected: Mac mini"])
        XCTAssertEqual(lines(facts(setUp: false, gateway: nil), english), ["▲ Alumia is not set up yet"])
    }

    func testEachStateIsToldApart() {
        let states = every.map { MenuState.of($0.1) }
        XCTAssertEqual(states, [
            .stopped, .notSetUp, .notSetUp, .starting, .starting, .idle, .serving,
            .needsAction(.sharingOff), .needsAction(.serviceStopped(cause: nil)),
        ])
        // A Mac nobody set up has the first run to open, and nothing else to do.
        let unset = Menu.of(facts(setUp: false, gateway: nil), words: portuguese)
        XCTAssertEqual(unset.icon, .dimmed)
        XCTAssertEqual(unset.label, "Alumia: falta configurar")
        XCTAssertEqual(Array(read(unset).prefix(4)), ["▲ Falta configurar o Alumia", "—", "Configurar…", "—"])
        XCTAssertTrue(has(.setUp, facts(setUp: false, gateway: nil)))
        let starting = Menu.of(facts(gateway: nil), words: portuguese)
        XCTAssertEqual(starting.label, "Alumia: iniciando")
        XCTAssertEqual(Array(read(starting).prefix(3)), ["○ O Alumia está iniciando…", "—", "[Abrir no navegador]"])
    }

    func testRunningIsSaidOnlyOfAGatewayThatServes() {
        for (name, facts) in every {
            let served = facts.gateway?.serving == true
            let lines = lines(facts)
            XCTAssertEqual(lines.contains("● O Alumia está rodando"), served && facts.notice == nil, name)
            XCTAssertEqual(lines.contains { $0.hasPrefix("●") }, served && facts.notice == nil, "\(name): the green light")
            // Who is connected is said of a gateway that serves, and of no other.
            let connection = lines.contains { $0 == "  Ninguém conectado" || $0.hasPrefix("  Conectado: ") }
            XCTAssertEqual(connection, served && facts.notice == nil, "\(name): the connection")
        }
    }

    func testStopIsThereOnlyWhileItServesAndTurnOnOnlyWhileItIsStopped() {
        for (name, facts) in every {
            XCTAssertEqual(has(.stop, facts), facts.gateway?.serving == true, "\(name): Stop")
            XCTAssertEqual(has(.start, facts), facts.gateway?.stopped == true, "\(name): Turn on")
        }
    }
}
