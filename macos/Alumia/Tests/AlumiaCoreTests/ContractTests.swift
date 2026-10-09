// What the app sends is what the gateway takes, and what the gateway says is what
// the app reads: the same examples the gateway's own tests read
// (`what_the_app_sends_and_reads_is_what_the_server_takes_and_says`, src/app.rs).

import XCTest
@testable import AlumiaCore

final class ContractTests: XCTestCase {
    private func decoded<Value: Decodable>(_ name: String, as _: Value.Type) throws -> Value {
        try JSONDecoder().decode(Value.self, from: Data(fixture(name).utf8))
    }

    func testTheChangeTheAppSendsIsTheExample() {
        // The settings of the example, as the app is shown them.
        let shown = [
            ShownComputer(name: "Mac da Ana virtual", kind: "vnc", subtype: "ard-high-performance", host: "127.0.0.1",
                          port: 5900, username: "ana", hasPassword: true),
            ShownComputer(name: "Mac da Ana mirrored", kind: "vnc", subtype: "ard-mirror", host: "127.0.0.1", port: 5900,
                          username: "ana", hasPassword: true),
            ShownComputer(name: "pc-da-sala", kind: "rdp", host: "192.0.2.10", username: "ana", hasPassword: true),
            ShownComputer(name: "linux-antigo", kind: "vnc", host: "192.0.2.30", hasVncPassword: true),
            ShownComputer(name: "estacao", kind: "vnc", subtype: "wlshare", host: "192.0.2.40"),
        ]
        let rows = Computers.rows(shown)
        XCTAssertEqual(rows.map(\.name), ["Mac da Ana", "pc-da-sala", "linux-antigo", "estacao"])
        // The Mac edited, with no password typed and two displays turned on; the
        // Windows host renamed and moved; the plain VNC server removed; the Linux
        // one nobody touched.
        var two = ComputerDraft(rows[0])
        two.twoDisplays = true
        let mac = Computers.saving(two, editing: rows[0], in: shown)
        var moved = ComputerDraft(rows[1])
        moved.name = "escritorio"
        moved.host = "192.0.2.20"
        let pc = Computers.saving(moved, editing: rows[1], in: shown)
        let left = Computers.removing(rows[2], from: shown).map(\.name)
        // Each of the three writes the others as they are; the example is the
        // three at once.
        let change = Change(
            listen: "127.0.0.1:52399",
            login: Change.Login(username: "ana", password: "a-senha-nova-da-pagina"),
            computers: (mac.prefix(2) + pc.dropFirst(2)).filter { left.contains($0.was ?? $0.name) }
        )
        XCTAssertEqual(parsed(change.json()), parsed(fixture("change.json")))
        // The Windows host made a plain VNC server, with no password typed: another
        // computer in its place, which the gateway is told keeps nothing of it.
        var became = ComputerDraft(rows[1])
        became.kind = .vnc
        became.port = String(ComputerKind.vnc.port)
        became.username = ""
        let replaced = Change(computers: Computers.saving(became, editing: rows[1], in: shown))
        XCTAssertEqual(parsed(replaced.json()), parsed(fixture("replaced.json")))
        // What is not changed is not sent, and the two of the Advanced pane are
        // sent by the names the gateway reads.
        XCTAssertEqual(parsed(Change().json()), parsed("{}"))
        XCTAssertEqual(parsed(Change(brand: "Estúdio", meter: true).json()), parsed(#"{"brand":"Estúdio","meter":true}"#))
    }

    func testTheSettingsShownAreReadAsTheExampleHasThem() throws {
        let shown = try decoded("shown-after.json", as: Shown.self)
        XCTAssertTrue(shown.configured)
        XCTAssertEqual(shown.listen, "127.0.0.1:52399")
        XCTAssertEqual(shown.port, 52399)
        XCTAssertEqual(shown.username, "ana")
        XCTAssertEqual(shown.brand, "casa")
        XCTAssertFalse(shown.meter)
        XCTAssertEqual(shown.computers.map(\.name), ["Mac da Ana virtual", "Mac da Ana mirrored", "escritorio", "estacao"])
        XCTAssertEqual(shown.computers[2], ShownComputer(name: "escritorio", kind: "rdp", host: "192.0.2.20", port: 3389,
                                                         username: "ana", hasPassword: true))
        XCTAssertEqual(shown.computers[3], ShownComputer(name: "estacao", kind: "vnc", subtype: "wlshare", host: "192.0.2.40"),
                       "the one nobody touched, as it was")
        // And as the list shows them: the Mac's two entries one line.
        let rows = Computers.rows(shown.computers)
        XCTAssertEqual(rows.map(\.name), ["Mac da Ana", "escritorio", "estacao"])
        XCTAssertEqual(rows.map(\.kind), [.mac, .windows, .linux])
        XCTAssertEqual(rows[0].entries, ["Mac da Ana virtual", "Mac da Ana mirrored"])
        XCTAssertEqual(rows.map(\.twoDisplays), [true, false, false], "the Mac's is on in the example")
        XCTAssertTrue(rows[0].isThisMac)
        XCTAssertFalse(rows[1].isThisMac)
        XCTAssertEqual(rows.map { portuguese.say($0.detailKey) }, ["Virtual e Espelhado", "Área de Trabalho Remota", "Linux, wlshare"])
    }

    func testARefusalIsReadWithItsCodeAndItsSentence() {
        let line = fixture("refused.json").replacingOccurrences(of: "\n", with: "")
        let read = Gateway.read(Ran(status: 1, output: line + "\n"), as: Shown.self, words: portuguese)
        XCTAssertEqual(read.failure, Refusal(
            code: "AL-9520",
            says: "O computador escritorio está com o endereço vazio. Informe o nome dele na rede ou o IP.",
            detail: "target \"escritorio\" has an empty host"
        ))
    }

    func testTheStatusIsReadServingAndNot() throws {
        let serving = try decoded("status-serving.json", as: GatewayStatus.self)
        XCTAssertEqual(serving, GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380",
                                              session: "Mac da Ana virtual", ffmpeg: true))
        let waiting = try decoded("status-waiting.json", as: GatewayStatus.self)
        XCTAssertFalse(waiting.serving)
        XCTAssertFalse(waiting.ffmpeg, "whether FFmpeg is there is the gateway's to say")
        XCTAssertNil(waiting.listen)
        XCTAssertEqual(waiting.cause?.code, GatewayStatus.notSetUp)
        XCTAssertEqual(waiting.cause?.says, "O Alumia ainda não foi configurado neste Mac. Abra o Alumia e conclua a configuração.")

        let line = fixture("status-serving.json").replacingOccurrences(of: "\n", with: "")
        XCTAssertEqual(Gateway.read(Ran(status: 0, output: line), as: GatewayStatus.self, words: portuguese).success, serving)
    }

    func testTheNeighboursTheAppPrintsAreTheExample() throws {
        let found = try decoded("neighbours.json", as: [Neighbour].self)
        XCTAssertEqual(found, [
            Neighbour(name: "MacBook da Ana", url: "https://macbook-da-ana.example.ts.net"),
            Neighbour(name: "Mac mini da sala", url: "https://mac-mini-da-sala.example.ts.net"),
        ])
        XCTAssertEqual(parsed(Neighbours.printed(found)), parsed(fixture("neighbours.json")))
    }

    func testAGatewayThatCouldNotBeAskedIsTheAppsOwnMessage() {
        let cases = [
            Ran(status: nil, errors: "The file “alumia” doesn’t exist."),
            Ran(status: 0, output: "not json"),
            Ran(status: 0, timedOut: true, output: "{\"configured\":true,\"listen\":\"x\",\"computers\":[]}"),
            Ran(status: 2, output: ""),
        ]
        for ran in cases {
            let read = Gateway.read(ran, as: Shown.self, words: portuguese)
            XCTAssertEqual(read.failure?.code, "AL-1800", "\(ran)")
            XCTAssertEqual(read.failure?.says, "O Alumia não conseguiu falar com o servidor dele neste Mac. Feche o Alumia e abra de novo.")
        }
        XCTAssertEqual(Gateway.read(cases[0], as: Shown.self, words: portuguese).failure?.detail, "The file “alumia” doesn’t exist.")
    }

    func testEachRequestIsACommandOfTheGatewaysOwnBinary() async {
        let runner = Scripted([
            Ran(status: 0, output: fixture("status-serving.json").replacingOccurrences(of: "\n", with: "")),
            Ran(status: 0, output: "{\"ended\":true}"),
        ])
        let binary = URL(fileURLWithPath: "/Applications/Alumia.app/Contents/Helpers/alumia")
        let gateway = Gateway(binary: binary, runner: runner, language: .english, environment: ["ALUMIA_APP_DIR": "/tmp/t"])
        let status = await gateway.status()
        XCTAssertEqual(status.success?.session, "Mac da Ana virtual")
        let ended = await gateway.endSession()
        XCTAssertEqual(ended.success, true)
        XCTAssertEqual(runner.asked.map(\.arguments), [
            ["app", "--language", "en-US", "status"], ["app", "--language", "en-US", "end-session"],
        ])
        XCTAssertTrue(runner.asked.allSatisfy { $0.executable == binary && $0.environment == ["ALUMIA_APP_DIR": "/tmp/t"] })
    }
}

extension Result {
    var success: Success? {
        if case .success(let value) = self { value } else { nil }
    }

    var failure: Failure? {
        if case .failure(let error) = self { error } else { nil }
    }
}
