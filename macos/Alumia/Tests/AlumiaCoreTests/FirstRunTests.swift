// What the first run writes: this Mac in both of its modes, and the page's
// login, handed to the gateway where no other process reads it.

import XCTest
@testable import AlumiaCore

final class FirstRunTests: XCTestCase {
    private let facts = WizardFacts(
        screenSharingOn: true, accountUser: "ana", accountPassword: "a-senha-do-mac",
        tailscale: .ready, pageUser: "ana", pagePassword: "a-senha-da-pagina"
    )

    func testThisMacIsWrittenInItsTwoModesAtItsOwnAddress() {
        let change = FirstRun.change(facts, computerName: "Mac da Ana")
        let computers = change.computers ?? []
        XCTAssertEqual(computers.map(\.name), ["Mac da Ana virtual", "Mac da Ana mirrored"])
        XCTAssertEqual(computers.map(\.subtype), ["ard-high-performance", "ard-mirror"], "Virtual and Mirrored, and no other mode")
        for computer in computers {
            XCTAssertEqual(computer.kind, "vnc")
            XCTAssertEqual(computer.host, "127.0.0.1")
            XCTAssertEqual(computer.port, 5900)
            XCTAssertEqual(computer.username, "ana")
            XCTAssertEqual(computer.password, "a-senha-do-mac")
            XCTAssertNil(computer.was)
        }
        XCTAssertEqual(change.login, Change.Login(username: "ana", password: "a-senha-da-pagina"))
        XCTAssertEqual(change.listen, "127.0.0.1:52380")
        // The two are one line, as the page shows them, under the Mac's own name.
        let shown = computers.map {
            ShownComputer(name: $0.name, kind: $0.kind, subtype: $0.subtype, host: $0.host, port: $0.port,
                          username: $0.username, hasPassword: true)
        }
        let rows = Computers.rows(shown)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.name, "Mac da Ana")
        XCTAssertEqual(rows.first?.isThisMac, true)
        XCTAssertEqual(rows.first?.compatible, false)
    }

    func testAMacWithNoNameIsStillWritten() {
        let change = FirstRun.change(facts, computerName: "  ", pagePort: 52399)
        XCTAssertEqual(change.computers?.map(\.name), ["Mac virtual", "Mac mirrored"])
        XCTAssertEqual(change.listen, "127.0.0.1:52399")
    }

    func testTheChangeGoesOnStandardInputAndNeverAmongTheArguments() async {
        let runner = Scripted([Ran(status: 0, output: "{\"applied\":true}\n"), Ran(status: 0, output: "{\"reloaded\":true}\n")])
        let gateway = Gateway(binary: URL(fileURLWithPath: "/Applications/Alumia.app/Contents/Helpers/alumia"),
                              runner: runner, language: .portuguese)
        let applied = await gateway.apply(FirstRun.change(facts, computerName: "Mac da Ana"))
        guard case .success = applied else {
            return XCTFail("\(applied)")
        }

        let asked = runner.asked
        XCTAssertEqual(asked.map(\.arguments), [
            ["app", "--language", "pt-BR", "config-apply"],
            ["app", "--language", "pt-BR", "reload"],
        ])
        let change = asked[0]
        for secret in ["a-senha-do-mac", "a-senha-da-pagina"] {
            XCTAssertTrue(change.input?.contains(secret) == true, "the change carries it")
            XCTAssertFalse(change.arguments.joined(separator: " ").contains(secret), "where another process would read it")
            XCTAssertFalse((change.environment ?? [:]).values.contains { $0.contains(secret) })
        }
        XCTAssertNil(asked[1].input)
        XCTAssertEqual(parsed(change.input ?? ""), parsed(FirstRun.change(facts, computerName: "Mac da Ana").json()))
    }

    func testAChangeTheGatewayRefusesIsNotReloaded() async {
        let refused = "{\"refused\":{\"code\":\"AL-9520\",\"says\":\"O computador x está com o endereço vazio. Preencha host.\",\"detail\":\"d\"}}\n"
        let runner = Scripted([Ran(status: 1, output: refused)])
        let gateway = Gateway(binary: URL(fileURLWithPath: "/x/alumia"), runner: runner, language: .portuguese)
        let applied = await gateway.apply(Change(listen: "127.0.0.1:1"))
        guard case .failure(let refusal) = applied else {
            return XCTFail("it was refused")
        }
        XCTAssertEqual(refusal.code, "AL-9520")
        XCTAssertEqual(runner.asked.count, 1, "nothing changed, so nothing to take")
    }
}
