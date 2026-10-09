// The menu bar's menu: the lines and the items of each state, in their order,
// and "End the session" only while one is open. What each state's two lines are
// and when Alumia is said to be running is MenuLinesTests.

import XCTest
@testable import AlumiaCore

/// The menu as a list of what it reads: the first line with its light before it,
/// the second under it, each item's title, and a line for each separator. An item
/// that is off is in brackets.
func read(_ menu: Menu) -> [String] {
    menu.items.map { item in
        switch item {
        case .server(let light, let sentence):
            switch light {
            case .green: "● \(sentence)"
            case .amber: "▲ \(sentence)"
            case .grey: "○ \(sentence)"
            }
        case .detail(let sentence): "  \(sentence)"
        case .separator: "—"
        case .action(_, let title, let shortcut, let enabled):
            (enabled ? title : "[\(title)]") + (shortcut.map { " ⌘\($0.uppercased())" } ?? "")
        }
    }
}

final class MenuTests: XCTestCase {
    private let idle = GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380", ffmpeg: true)
    private let stopped = GatewayStatus(version: "0.0.325", serving: false, ffmpeg: true, stopped: true)

    private var serving: GatewayStatus {
        var status = idle
        status.session = "Mac da Ana virtual"
        return status
    }

    private func menu(notice: Notice? = nil, gateway: GatewayStatus? = nil, words: Words = portuguese) -> Menu {
        Menu.of(MenuFacts(setUp: true, notice: notice, gateway: gateway), words: words)
    }

    /// What every menu ends with, the page there to open or not.
    private func foot(open: Bool) -> [String] {
        let page = open ? ["Abrir no navegador", "Copiar o endereço"] : ["[Abrir no navegador]", "[Copiar o endereço]"]
        return page + ["—", "Ajustes… ⌘,", "—", "Sair do Alumia ⌘Q"]
    }

    func testReady() {
        let menu = menu(gateway: idle)
        XCTAssertEqual(menu.state, .idle)
        XCTAssertEqual(menu.icon, .outline)
        XCTAssertEqual(menu.label, "Alumia: pronto")
        XCTAssertEqual(read(menu), [
            "● O Alumia está rodando",
            "  Ninguém conectado",
            "—",
            "Parar o Alumia",
            "—",
        ] + foot(open: true))
    }

    func testASessionOpen() {
        let menu = menu(gateway: serving)
        XCTAssertEqual(menu.state, .serving)
        XCTAssertEqual(menu.icon, .filled)
        XCTAssertEqual(menu.label, "Alumia: sessão aberta")
        XCTAssertEqual(read(menu), [
            "● O Alumia está rodando",
            "  Conectado: Mac da Ana virtual",
            "—",
            "Encerrar a sessão",
            "Parar o Alumia",
            "—",
        ] + foot(open: true))
    }

    func testEndTheSessionIsThereOnlyWithASessionOpen() {
        let ends: (Menu) -> Bool = { menu in
            menu.items.contains { if case .action(.endSession, _, _, _) = $0 { true } else { false } }
        }
        XCTAssertTrue(ends(menu(gateway: serving)))
        XCTAssertFalse(ends(menu(gateway: idle)))
        XCTAssertFalse(ends(menu(gateway: stopped)))
        XCTAssertFalse(ends(menu(notice: .sharingOff, gateway: idle)))
        XCTAssertFalse(ends(menu(gateway: nil)))
        // A session open while the app needs its owner for something else, as one
        // on a Windows host with this Mac's Screen Sharing off: it is ended from
        // here all the same, after the thing that resolves the notice.
        let both = menu(notice: .sharingOff, gateway: serving)
        XCTAssertEqual(both.state, .needsAction(.sharingOff))
        XCTAssertEqual(Array(read(both).prefix(7)), [
            "▲ O Alumia precisa de você",
            "  O Compartilhamento de Tela está desligado, e a tela deste Mac não pode ser aberta.",
            "—",
            "Abrir os Ajustes do Sistema",
            "Encerrar a sessão",
            "Parar o Alumia",
            "—",
        ])
    }

    func testItNeedsItsOwner() {
        let menu = menu(notice: .sharingOff, gateway: idle)
        XCTAssertEqual(menu.state, .needsAction(.sharingOff))
        XCTAssertEqual(menu.icon, .outlineWithMark)
        XCTAssertEqual(menu.label, "Alumia: precisa de você")
        XCTAssertEqual(read(menu), [
            "▲ O Alumia precisa de você",
            "  O Compartilhamento de Tela está desligado, e a tela deste Mac não pode ser aberta.",
            "—",
            "Abrir os Ajustes do Sistema",
            "Parar o Alumia",
            "—",
        ] + foot(open: true))
        // The others, by the notice's own sentence and button; with no page to
        // open, the two items that open it are off, and there is nothing to stop.
        let silent = self.menu(notice: .serviceStopped(cause: nil), gateway: nil)
        XCTAssertEqual(read(silent), [
            "▲ O Alumia precisa de você",
            "  O Alumia parou de responder, e a tela deste Mac não pode ser aberta.",
            "—",
            "Iniciar de novo",
            "—",
        ] + foot(open: false))
        let approval = self.menu(notice: .needsApproval, gateway: nil)
        XCTAssertEqual(Array(read(approval).prefix(4)), [
            "▲ O Alumia precisa de você",
            "  O macOS ainda não autorizou o Alumia a continuar rodando.",
            "—",
            "Abrir Itens de Início",
        ])
    }

    func testStopped() {
        // Stopped by its owner: the gateway says so, and the menu offers to start
        // it. The two items that open the page stay where they are, off, since
        // there is no page to open.
        let menu = menu(gateway: stopped)
        XCTAssertEqual(menu.state, .stopped)
        XCTAssertEqual(menu.icon, .dimmed)
        XCTAssertEqual(menu.label, "Alumia: parado")
        let drawn = ["○ O Alumia está parado", "—", "Ligar o Alumia", "—"] + foot(open: false)
        XCTAssertEqual(read(menu), drawn)
        // Stopped is its owner's choice, and nothing it then lacks is asked of
        // them: not Screen Sharing, not FFmpeg.
        XCTAssertEqual(read(self.menu(notice: .sharingOff, gateway: stopped)), drawn)
        XCTAssertEqual(read(self.menu(notice: .ffmpegMissing, gateway: stopped)), drawn)
    }

    func testAMissingFFmpegIsAnItemAndNotTheIcon() {
        let menu = menu(notice: .ffmpegMissing, gateway: idle)
        XCTAssertEqual(menu.state, .idle)
        XCTAssertEqual(menu.icon, .outline)
        XCTAssertEqual(Array(read(menu).prefix(6)), [
            "● O Alumia está rodando", "  Ninguém conectado", "—", "Instalar o FFmpeg…", "Parar o Alumia", "—",
        ])
        // With a session open as well.
        XCTAssertEqual(
            Array(read(self.menu(notice: .ffmpegMissing, gateway: serving)).dropFirst(3).prefix(3)),
            ["Encerrar a sessão", "Instalar o FFmpeg…", "Parar o Alumia"]
        )
    }

    func testTheSameInEnglish() {
        XCTAssertEqual(read(menu(gateway: serving, words: english)), [
            "● Alumia is running",
            "  Connected: Mac da Ana virtual",
            "—",
            "End the session",
            "Stop Alumia",
            "—",
            "Open in the browser", "Copy the address",
            "—",
            "Settings… ⌘,",
            "—",
            "Quit Alumia ⌘Q",
        ])
        XCTAssertEqual(menu(gateway: stopped, words: english).label, "Alumia: stopped")
    }
}
