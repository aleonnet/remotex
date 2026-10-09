// The notice: one, the one that has to be resolved first, with its button.

import XCTest
@testable import AlumiaCore

final class NoticeTests: XCTestCase {
    private let serving = GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380", ffmpeg: true)

    private func facts(service: ServiceState = .running, gateway: GatewayStatus? = nil, sharing: Bool = true,
                       setUp: Bool = true, thisMac: Bool = true, denied: Bool = false) -> NoticeFacts {
        NoticeFacts(setUp: setUp, service: service, gateway: gateway ?? serving, screenSharingOn: sharing, hostsThisMac: thisMac,
                    localNetworkDenied: denied)
    }

    func testWithNothingWrongThereIsNoNotice() {
        XCTAssertNil(Notice.shown(facts()))
    }

    func testOnlyOneIsShownAndInTheDeclaredOrder() {
        // Everything wrong at once, and then one thing less each time.
        var missing = serving
        missing.ffmpeg = false
        let all = { (service: ServiceState) in self.facts(service: service, gateway: missing, sharing: false, denied: true) }
        XCTAssertEqual(Notice.shown(all(.needsApproval)), .needsApproval)
        XCTAssertEqual(Notice.shown(all(.registeredButSilent)), .serviceStopped(cause: nil))
        XCTAssertEqual(Notice.shown(all(.running)), .sharingOff)
        // This Mac's own screen first, then the computers of its network, and a
        // decoder last.
        XCTAssertEqual(Notice.shown(facts(gateway: missing, denied: true)), .localNetworkDenied)
        XCTAssertEqual(Notice.shown(facts(gateway: missing)), .ffmpegMissing)
        XCTAssertNil(Notice.shown(facts()))
        // The order, by their codes.
        XCTAssertEqual(
            [Notice.needsApproval, .serviceStopped(cause: nil), .sharingOff, .localNetworkDenied, .ffmpegMissing]
                .map(\.code),
            ["AL-1302", "AL-1304", "AL-1301", "AL-1306", "AL-1305"]
        )
    }

    func testEachNoticeSaysTheMockupsWordsWithItsButton() {
        let said: [(Notice, String, String, NoticeAction)] = [
            (.sharingOff, "O Compartilhamento de Tela está desligado, e a tela deste Mac não pode ser aberta.",
             "Abrir os Ajustes do Sistema", .openSharing),
            (.needsApproval, "O macOS ainda não autorizou o Alumia a continuar rodando.", "Abrir Itens de Início", .openLoginItems),
            (.serviceStopped(cause: nil), "O Alumia parou de responder, e a tela deste Mac não pode ser aberta.",
             "Iniciar de novo", .startAgain),
            (.ffmpegMissing, "O FFmpeg não está instalado, e a tela deste Mac só abre em navegador que decodifica o vídeo do Mac.",
             "Instalar", .installFFmpeg),
            (.localNetworkDenied,
             "O macOS não está deixando o Alumia alcançar os computadores da rede local. "
                 + "Permita em Ajustes do Sistema › Privacidade e Segurança › Rede Local.",
             "Abrir os Ajustes do Sistema", .openLocalNetwork),
        ]
        for (notice, text, button, action) in said {
            let message = notice.message(portuguese)
            XCTAssertEqual(message?.text, text)
            XCTAssertEqual(message?.button, button)
            XCTAssertEqual(message?.code, notice.code)
            XCTAssertEqual(notice.action, action)
            XCTAssertNotEqual(notice.message(english)?.text, text, "and in the other language")
        }
        XCTAssertEqual(Notice.sharingOff.message(english)?.text, "Screen Sharing is off, and this Mac's screen cannot be opened.")
        XCTAssertEqual(Notice.sharingOff.message(english)?.button, "Open System Settings")
    }

    func testAServiceThatSaysWhyItStoppedIsToldByItsReason() {
        let cause = Refusal(
            code: "AL-9411",
            says: "Não foi possível escutar em 127.0.0.1:52380. A porta pode estar em uso por outro programa.",
            detail: "127.0.0.1:52380 is already in use"
        )
        let stopped = GatewayStatus(version: "0.0.325", serving: false, ffmpeg: true, cause: cause)
        let notice = Notice.shown(facts(gateway: stopped))
        XCTAssertEqual(notice, .serviceStopped(cause: cause))
        let message = notice?.message(portuguese)
        XCTAssertEqual(message?.text, cause.says, "the gateway's own reason, in the app's language")
        XCTAssertEqual(message?.code, "AL-9411")
        XCTAssertEqual(message?.button, "Iniciar de novo", "under the same button")
    }

    func testAMacNobodySetUpHasNoNoticeOfIt() {
        // No settings yet is the first run's to say, and no fault.
        let unset = GatewayStatus(
            version: "0.0.325", serving: false, ffmpeg: false,
            cause: Refusal(code: GatewayStatus.notSetUp, says: "O Alumia ainda não foi configurado neste Mac.", detail: "")
        )
        XCTAssertNil(Notice.shown(facts(gateway: unset, sharing: false, setUp: false)))
        XCTAssertNil(Notice.shown(facts(service: .notRegistered, gateway: unset, setUp: false)))
        // What has to be resolved before the service runs is said even then.
        XCTAssertEqual(Notice.shown(facts(service: .needsApproval, gateway: unset, setUp: false)), .needsApproval)
    }

    func testStoppedByChoiceIsNoNotice() {
        // Its owner stopped it: nothing it then lacks is theirs to be told, and
        // the menu says that it is stopped.
        let stopped = GatewayStatus(version: "0.0.325", serving: false, ffmpeg: false, stopped: true)
        XCTAssertNil(Notice.shown(facts(gateway: stopped, sharing: false, denied: true)))
        // What keeps the service itself from running is said all the same.
        XCTAssertEqual(Notice.shown(facts(service: .needsApproval, gateway: stopped)), .needsApproval)
    }

    func testWhatIsOnlyThisMacsIsSaidOnlyWhereThisMacIsHosted() {
        var missing = serving
        missing.ffmpeg = false
        XCTAssertNil(Notice.shown(facts(gateway: missing, sharing: false, thisMac: false)))
    }

    func testOnlyAMissingFFmpegLeavesTheIconAsItIs() {
        XCTAssertFalse(Notice.ffmpegMissing.needsOwner)
        for notice in [Notice.needsApproval, .serviceStopped(cause: nil), .sharingOff, .localNetworkDenied] {
            XCTAssertTrue(notice.needsOwner)
        }
    }
}
