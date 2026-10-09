// FFmpeg: the seal that stays while it is missing, and what its button does on a
// Mac with Homebrew and on one without.

import XCTest
@testable import AlumiaCore

final class FFmpegTests: XCTestCase {
    func testTheSealStaysForAsLongAsFFmpegIsMissing() {
        XCTAssertEqual(FFmpegSeal.of(present: false, installing: false), .missing)
        XCTAssertEqual(FFmpegSeal.of(present: false, installing: true), .installing)
        XCTAssertEqual(FFmpegSeal.of(present: true, installing: false), .present)
        XCTAssertEqual(FFmpegSeal.of(present: true, installing: true), .present, "found is found")

        XCTAssertEqual(portuguese.say(FFmpegSeal.missing.stateKey), "Não instalado")
        XCTAssertEqual(portuguese.say(FFmpegSeal.installing.stateKey), "Instalando…")
        XCTAssertEqual(portuguese.say(FFmpegSeal.present.stateKey), "Instalado")
        XCTAssertEqual(FFmpegSeal.missing.actKey.map(portuguese.said), "Instalar")
        XCTAssertEqual(FFmpegSeal.installing.actKey.map(portuguese.said), "Ver o andamento")
        XCTAssertNil(FFmpegSeal.present.actKey, "nothing left to do")
        XCTAssertEqual(FFmpegSeal.missing.noteKey, FFmpegSeal.installing.noteKey)
        XCTAssertNotEqual(FFmpegSeal.missing.noteKey, FFmpegSeal.present.noteKey)
    }

    func testAndSoDoesTheNotice() {
        let missing = GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380", ffmpeg: false)
        let facts = NoticeFacts(setUp: true, service: .running, gateway: missing, screenSharingOn: true, hostsThisMac: true)
        XCTAssertEqual(Notice.shown(facts), .ffmpegMissing)
        XCTAssertEqual(Notice.ffmpegMissing.action, .installFFmpeg)
    }

    func testWithHomebrewThePressInstalls() {
        let sheet = FFmpeg.pressed(homebrew: true)
        XCTAssertEqual(sheet, .ask(command: "brew install ffmpeg"), "what is about to run is shown first")
        XCTAssertEqual(FFmpeg.next(sheet), .install)
        XCTAssertEqual(portuguese.say(sheet.actKey), "Instalar")

        let command = Homebrew.install(home: "/Users/ana")
        XCTAssertEqual(command.executable.path, "/opt/homebrew/bin/brew", "by its whole path: an app has no terminal's")
        XCTAssertEqual(command.arguments, ["install", "--yes", "ffmpeg"])
        XCTAssertEqual(command.environment?["PATH"]?.hasPrefix("/opt/homebrew/bin:"), true)
        XCTAssertEqual(command.environment?["HOME"], "/Users/ana")
        XCTAssertNil(command.limit, "an installation takes the time it takes")
    }

    func testWithoutHomebrewThePressLeadsToInstallingItAndWaits() {
        let sheet = FFmpeg.pressed(homebrew: false)
        XCTAssertEqual(sheet, .noHomebrew)
        XCTAssertEqual(FFmpeg.next(sheet), .openHomebrewInstaller, "it leads somewhere")
        XCTAssertEqual(portuguese.say(sheet.actKey), "Baixar o Homebrew")
        XCTAssertEqual(Homebrew.installer.scheme, "https")
        // Then the sheet waits, and goes on by itself once Homebrew is there.
        XCTAssertEqual(FFmpeg.waited(homebrewNow: false), .waitingForHomebrew)
        XCTAssertEqual(FFmpeg.waited(homebrewNow: true), .running(lines: []))
        XCTAssertNil(FFmpeg.next(.waitingForHomebrew))
        XCTAssertNil(FFmpeg.next(.running(lines: [])))
    }

    func testItIsInstalledOnlyWhenTheGatewayFindsIt() {
        XCTAssertEqual(FFmpeg.finished(Ran(status: 0, output: "==> Pouring ffmpeg\n"), presentNow: true), .done)
        // A command that said it succeeded and left nothing the gateway loads.
        XCTAssertEqual(
            FFmpeg.finished(Ran(status: 0, output: "==> Pouring ffmpeg\nAll done\n"), presentNow: false),
            .failed(last: "All done")
        )
        let failed = FFmpeg.finished(
            Ran(status: 1, output: "==> Fetching ffmpeg\n", errors: "Error: No such file\n\n"), presentNow: false
        )
        XCTAssertEqual(failed, .failed(last: "Error: No such file"), "its complaint, and not what it printed before")
        XCTAssertEqual(FFmpeg.next(failed), .install, "and it can be tried again")
        XCTAssertEqual(portuguese.say(failed.actKey), "Tentar de novo")
        XCTAssertEqual(FFmpeg.finished(Ran(status: nil), presentNow: false), .failed(last: ""))
    }

    func testWhatTheInstallationSaysIsHeardWhileItRuns() async throws {
        // A command that says a line and goes on only once somebody heard it: one
        // whose lines came all at its end would wait here until its limit.
        let heard = FileManager.default.temporaryDirectory.appendingPathComponent("alumia-heard-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: heard) }
        let speaks = try script("""
        echo '==> Fetching ffmpeg'
        while [ ! -e '\(heard.path)' ]; do sleep 0.05; done
        echo '==> Pouring ffmpeg' >&2
        printf 'no end of line'
        """)
        let lines = Lines()
        let ran = await SystemRunner().run(Command(speaks, limit: 3)) { line in
            lines.add(line)
            if line == "==> Fetching ffmpeg" {
                FileManager.default.createFile(atPath: heard.path, contents: nil)
            }
        }
        XCTAssertFalse(ran.timedOut, "the first line was heard before the command ended")
        XCTAssertEqual(ran.status, 0)
        XCTAssertEqual(lines.all.sorted(), ["==> Fetching ffmpeg", "==> Pouring ffmpeg", "no end of line"])
        XCTAssertEqual(ran.output, "==> Fetching ffmpeg\nno end of line", "and it is all there at the end, as ever")
        XCTAssertEqual(ran.errors, "==> Pouring ffmpeg\n")

        // A runner that hears nothing meanwhile says it all at the end.
        let scripted = Scripted([Ran(status: 0, output: "one\n\ntwo\n", errors: "three\n")])
        let late = Lines()
        _ = await scripted.run(Command(speaks)) { late.add($0) }
        XCTAssertEqual(late.all, ["one", "two", "three"])
    }

    func testACommandThatEndsWithoutReadingIsNotTheAppsEnd() async throws {
        // More than a pipe holds, to a command that reads none of it: the writing
        // fails, and that is all that happens.
        let deaf = try script("exit 7")
        let ran = await SystemRunner().run(Command(deaf, input: String(repeating: "a change nobody reads\n", count: 50_000), limit: 5))
        XCTAssertEqual(ran.status, 7)
        XCTAssertFalse(ran.timedOut)
    }

    func testTheSheetShowsWhatWasSaidLast() {
        XCTAssertNil(FFmpegSheet.running(lines: []).last)
        XCTAssertEqual(FFmpegSheet.running(lines: ["==> Fetching", "==> Pouring ffmpeg"]).last, "==> Pouring ffmpeg")
        XCTAssertEqual(FFmpegSheet.failed(last: "Error: no").last, "Error: no")
        XCTAssertNil(FFmpegSheet.failed(last: "").last, "nothing said is nothing shown")
        XCTAssertNil(FFmpegSheet.done.last)
        XCTAssertEqual(FFmpegSheet.ask(command: "brew install ffmpeg").command, "brew install ffmpeg")
        XCTAssertNil(FFmpegSheet.noHomebrew.command)
        // Closing a sheet that runs leaves the installation running; the others end there.
        XCTAssertTrue(FFmpegSheet.running(lines: []).goesOnClosed)
        XCTAssertFalse(FFmpegSheet.waitingForHomebrew.goesOnClosed)
    }

    func testTheSheetsButtonsAreTheOnesTheDrawingHas() {
        func buttons(_ sheet: FFmpegSheet) -> [String] {
            [sheet.leaveKey, sheet.actKey].compactMap { $0 }.map(portuguese.said)
        }
        XCTAssertEqual(buttons(.ask(command: Homebrew.shown)), ["Cancelar", "Instalar"])
        XCTAssertEqual(buttons(.noHomebrew), ["Cancelar", "Baixar o Homebrew"])
        XCTAssertEqual(buttons(.waitingForHomebrew), ["Cancelar"], "nothing to go on to: it goes on by itself")
        XCTAssertEqual(buttons(.running(lines: [])), ["Fechar"])
        XCTAssertEqual(buttons(.failed(last: "")), ["Fechar", "Tentar de novo"])
        XCTAssertEqual(buttons(.done), ["Concluir"])
        // Waiting, it goes on saying why, and marks that it waits.
        XCTAssertEqual(FFmpegSheet.waitingForHomebrew.textKey, FFmpegSheet.noHomebrew.textKey)
        XCTAssertEqual(FFmpegSheet.waitingForHomebrew.stateKey.map(portuguese.said), "Aguardando o Homebrew")
        XCTAssertNil(FFmpegSheet.noHomebrew.stateKey)
    }

    func testEachSheetHasItsWords() {
        let sheets: [FFmpegSheet] = [
            .ask(command: Homebrew.shown), .noHomebrew, .waitingForHomebrew, .running(lines: []), .failed(last: ""), .done,
        ]
        for sheet in sheets {
            for key in [sheet.textKey, sheet.actKey, FFmpegSheet.titleKey] + [sheet.leaveKey, sheet.stateKey].compactMap({ $0 }) {
                XCTAssertNotEqual(portuguese.say(key), key, key)
                XCTAssertNotEqual(english.say(key), key, key)
            }
        }
    }
}
