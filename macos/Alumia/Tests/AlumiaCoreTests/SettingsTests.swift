// The settings: the computers as lines, what a sheet refuses beside its field,
// and the words, in the language chosen.

import XCTest
@testable import AlumiaCore

final class SettingsTests: XCTestCase {
    func testTheLanguageIsTheOneChosenOrTheSystems() {
        XCTAssertEqual(Language.preferred(["pt-BR", "en-US"]), .portuguese)
        XCTAssertEqual(Language.preferred(["pt-PT"]), .portuguese)
        XCTAssertEqual(Language.preferred(["pt"]), .portuguese)
        XCTAssertEqual(Language.preferred(["en-GB", "pt-BR"]), .english, "the first one decides")
        XCTAssertEqual(Language.preferred(["fr-FR"]), .english)
        XCTAssertEqual(Language.preferred([]), .english)
        XCTAssertEqual(LanguageChoice.system.language(preferred: ["pt-BR"]), .portuguese)
        XCTAssertEqual(LanguageChoice.english.language(preferred: ["pt-BR"]), .english, "whatever the system is in")
        XCTAssertEqual(LanguageChoice.portuguese.language(preferred: ["en-US"]), .portuguese)
        // A language is named in itself, in either.
        XCTAssertEqual(LanguageChoice.allCases.map { english.say($0.key) }, ["Match the system", "Português (Brasil)", "English (US)"])
        XCTAssertEqual(portuguese.say(LanguageChoice.system.key), "Como o sistema")
    }

    func testATextIsSaidWithWhatFillsIt() {
        XCTAssertEqual(portuguese.say("mac.about.version", ["version": "0.0.325"]), "Versão 0.0.325")
        XCTAssertEqual(english.say("mac.computer.edit", ["name": "Mac mini"]), "Edit Mac mini")
        XCTAssertEqual(portuguese.say("mac.no.such.key"), "mac.no.such.key", "one the dictionary lacks shows as itself")
        XCTAssertNil(portuguese.message("AL-0000"))
        let taken = ComputerFault.nameTaken("Mac mini").message(portuguese)
        XCTAssertEqual(taken?.text, "Já existe um computador chamado Mac mini. Escolha outro nome.")
        XCTAssertEqual(taken?.code, "AL-1402")
    }

    func testEveryTextIsInBothLanguages() {
        XCTAssertGreaterThan(Words.keys.count, 150)
        for key in Words.keys {
            XCTAssertNotEqual(portuguese.say(key), "", key)
            XCTAssertNotEqual(english.say(key), "", key)
        }
        for code in Words.codes {
            XCTAssertNotNil(portuguese.message(code), code)
            XCTAssertNotEqual(portuguese.message(code)?.text, english.message(code)?.text, code)
        }
    }

    func testThePanesAndTheirWords() {
        XCTAssertEqual(Pane.allCases.map { portuguese.say($0.key) }, ["Geral", "Computadores", "Acesso", "Avançado", "Sobre"])
        XCTAssertEqual(Look.allCases.map { portuguese.say($0.key) }, ["Como o sistema", "Clara", "Escura"])
        let all = SettingsText.general + SettingsText.computers + SettingsText.access + SettingsText.advanced
            + SettingsText.about + [SettingsText.window] + SheetText.computer + SheetText.removal + SheetText.password
        for key in all {
            XCTAssertNotEqual(portuguese.say(key), key, key)
        }
    }

    func testTwoEntriesOfAMacAtOneAddressAreOneLine() {
        func entry(_ name: String, _ subtype: String?, host: String = "192.0.2.20", port: Int? = 5900, kind: String = "vnc") -> ShownComputer {
            ShownComputer(name: name, kind: kind, subtype: subtype, host: host, port: port, username: "ana", hasPassword: true)
        }
        let rows = Computers.rows([
            entry("Studio mirrored", "ard-mirror"),
            entry("MacBook Pro", "ard-high-performance", host: "192.0.2.21"),
            entry("Office Mac", "ard", host: "192.0.2.22"),
            entry("Studio virtual", "ard-high-performance"),
            entry("Work PC", nil, host: "192.0.2.24", port: nil, kind: "rdp"),
            entry("Linux station", "wlshare", host: "192.0.2.25"),
            entry("Raspberry Pi", nil, host: "192.0.2.26"),
            // Another Mac behind a tunnel: the same address, another port.
            entry("Tunnel virtual", "ard-high-performance", port: 5901),
        ])
        XCTAssertEqual(rows.map(\.name), ["Studio", "MacBook Pro", "Office Mac", "Work PC", "Linux station", "Raspberry Pi", "Tunnel virtual"])
        XCTAssertEqual(rows.map(\.kind), [.mac, .mac, .mac, .windows, .linux, .vnc, .mac])
        XCTAssertEqual(rows[0].entries, ["Studio virtual", "Studio mirrored"], "the virtual one first, wherever it stood")
        XCTAssertEqual(rows.map(\.compatible), [false, false, true, false, false, false, false])
        XCTAssertEqual(rows[3].port, 3389, "a Windows host's own port where none is written")
        XCTAssertEqual(rows.map { portuguese.say($0.detailKey) }, [
            "Virtual e Espelhado", "Virtual e Espelhado", "Compatível", "Área de Trabalho Remota", "Linux, wlshare", "VNC",
            "Virtual e Espelhado",
        ])
    }

    func testTheNameTwoEntriesShareIsThePagesRule() {
        // The same cases the page's own rule has (`sharedName`, targetChoices.ts).
        XCTAssertEqual(Computers.sharedName("Studio virtual", "Studio mirrored"), "Studio")
        XCTAssertEqual(Computers.sharedName("mac-mini-hp", "mac-mini-mirror"), "mac-mini")
        XCTAssertEqual(Computers.sharedName("Mac da Ana virtual", "Mac da Ana mirrored"), "Mac da Ana")
        XCTAssertEqual(Computers.sharedName("studio", "studio"), "studio")
        XCTAssertEqual(Computers.sharedName("virtual", "mirrored"), "virtual", "no whole word shared: the first one's")
        XCTAssertEqual(Computers.sharedName("Mac1", "Mac2"), "Mac1", "they part inside a word")
    }

    func testAComputerIsWrittenAsItsKindIs() {
        let mac = ComputerDraft(name: "Mac mini", kind: .mac, host: "mac-mini.local", username: "ana", password: "s")
        XCTAssertEqual(mac.entries().map(\.subtype), ["ard-high-performance", "ard-mirror"])
        XCTAssertEqual(mac.entries().map(\.name), ["Mac mini virtual", "Mac mini mirrored"])
        XCTAssertEqual(mac.entries().map(\.port), [5900, 5900])
        let pc = ComputerDraft(name: "PC", kind: .windows, host: "192.0.2.24", username: "ana", password: "s")
        XCTAssertEqual(pc.port, "3389")
        XCTAssertEqual(pc.entries(), [ChangedComputer(name: "PC", kind: "rdp", host: "192.0.2.24", port: 3389, username: "ana", password: "s")])
        let linux = ComputerDraft(name: "L", kind: .linux, host: "h")
        XCTAssertEqual(linux.entries().first?.subtype, "wlshare")
        XCTAssertNil(linux.entries().first?.username, "an empty one is none")
        XCTAssertNil(linux.entries().first?.password, "and a password not typed is not sent")

        // A Mac kept in the mode the app does not offer stays in it.
        let office = ComputerRow(name: "Office Mac", kind: .mac, compatible: true, host: "192.0.2.22", port: 5900,
                                 username: "ana", hasPassword: true, entries: ["Office Mac"])
        XCTAssertEqual(ComputerDraft(office).entries(editing: office).map(\.subtype), ["ard"])
        // A Windows host that became a Mac is two entries, the first under its
        // old name's place.
        var became = ComputerDraft(ComputerRow(name: "PC", kind: .windows, compatible: false, host: "h", port: 3389,
                                               username: "ana", hasPassword: true, entries: ["PC"]))
        became.kind = .mac
        XCTAssertEqual(became.entries().count, 2)
    }

    /// Two displays are a Windows host's and a Mac's in its Virtual mode: read
    /// from the entry that takes them, written there alone, and taken away from
    /// a computer that opens with one.
    func testTwoDisplaysAreWrittenOnlyWhereTheyAreTaken() {
        let shown = [
            ShownComputer(name: "Studio virtual", kind: "vnc", subtype: "ard-high-performance", host: "192.0.2.20",
                          username: "ana", virtualDisplays: 2, hasPassword: true),
            ShownComputer(name: "Studio mirrored", kind: "vnc", subtype: "ard-mirror", host: "192.0.2.20", username: "ana",
                          hasPassword: true),
            ShownComputer(name: "PC", kind: "rdp", host: "192.0.2.24", username: "ana", virtualDisplays: 2, hasPassword: true),
            ShownComputer(name: "Other PC", kind: "rdp", host: "192.0.2.25", username: "ana", virtualDisplays: 1, hasPassword: true),
            ShownComputer(name: "Office Mac", kind: "vnc", subtype: "ard", host: "192.0.2.22", username: "ana", hasPassword: true),
            ShownComputer(name: "Linux", kind: "vnc", subtype: "wlshare", host: "192.0.2.26"),
        ]
        let rows = Computers.rows(shown)
        XCTAssertEqual(rows.map(\.name), ["Studio", "PC", "Other PC", "Office Mac", "Linux"])
        XCTAssertEqual(rows.map(\.twoDisplays), [true, true, false, false, false])
        // The sheet offers the switch where the computer can open with two.
        XCTAssertEqual(rows.map { ComputerDraft($0).offersTwoDisplays(editing: $0) }, [true, true, true, false, false])
        XCTAssertTrue(ComputerDraft(kind: .mac).offersTwoDisplays(), "a Mac added has both modes")
        XCTAssertFalse(ComputerDraft(kind: .vnc).offersTwoDisplays())

        // A Mac's is written in its Virtual entry and taken from the Mirrored one.
        let mac = ComputerDraft(rows[0]).entries(editing: rows[0])
        XCTAssertEqual(mac.map(\.subtype), ["ard-high-performance", "ard-mirror"])
        XCTAssertEqual(mac.map(\.virtualDisplays), [2, nil])
        // Turned off, it is taken away: a null, which leaving the key out would not do.
        var one = ComputerDraft(rows[1])
        one.twoDisplays = false
        let pc = Computers.saving(one, editing: rows[1], in: shown)
        XCTAssertEqual(pc[2].virtualDisplays, nil)
        XCTAssertEqual(
            parsed(Change(computers: [pc[2]]).json()),
            parsed(#"""
            {"computers":[{"name":"PC","protocol":"rdp","subtype":null,"host":"192.0.2.24","port":3389,"username":"ana",
              "virtual_displays":null}]}
            """#)
        )
        var on = ComputerDraft(rows[2])
        on.twoDisplays = true
        XCTAssertEqual(on.entries(editing: rows[2]).map(\.virtualDisplays), [2])
        // A computer that became one of a kind that opens with one display takes
        // the second with it, whatever the switch was left saying.
        var became = ComputerDraft(rows[1])
        became.kind = .linux
        XCTAssertEqual(became.entries(editing: rows[1]).map(\.virtualDisplays), [nil])
        // And a Mac kept in the mode the list does not offer has no Virtual mode.
        var office = ComputerDraft(rows[3])
        office.twoDisplays = true
        XCTAssertEqual(office.entries(editing: rows[3]).map(\.virtualDisplays), [nil])
    }

    /// The switch is read from a Mac's Virtual entry wherever that entry stands
    /// and whether or not the Mac has the other mode, and a computer added, or a
    /// Mac that gains its Virtual mode on being saved, is written with it.
    func testTwoDisplaysAreReadAndWrittenOnEveryShapeOfAMac() {
        let shown = [
            // Both modes, the Mirrored entry first in the settings.
            ShownComputer(name: "Sala mirrored", kind: "vnc", subtype: "ard-mirror", host: "192.0.2.20", username: "ana",
                          hasPassword: true),
            ShownComputer(name: "Sala virtual", kind: "vnc", subtype: "ard-high-performance", host: "192.0.2.20",
                          username: "ana", virtualDisplays: 2, hasPassword: true),
            // The Virtual mode alone, with two displays.
            ShownComputer(name: "Solo", kind: "vnc", subtype: "ard-high-performance", host: "192.0.2.21", username: "ana",
                          virtualDisplays: 2, hasPassword: true),
            // The Mirrored mode alone, which has none to read: the key written
            // there by hand is not the switch's.
            ShownComputer(name: "Espelho", kind: "vnc", subtype: "ard-mirror", host: "192.0.2.22", username: "ana",
                          virtualDisplays: 2, hasPassword: true),
            // Both modes, the Virtual entry saying one display.
            ShownComputer(name: "Um virtual", kind: "vnc", subtype: "ard-high-performance", host: "192.0.2.23",
                          username: "ana", virtualDisplays: 1, hasPassword: true),
            ShownComputer(name: "Um mirrored", kind: "vnc", subtype: "ard-mirror", host: "192.0.2.23", username: "ana",
                          hasPassword: true),
        ]
        let rows = Computers.rows(shown)
        XCTAssertEqual(rows.map(\.name), ["Sala", "Solo", "Espelho", "Um"])
        XCTAssertEqual(rows.map(\.twoDisplays), [true, true, false, false])

        // Saved as they were read, each keeps it in its Virtual entry.
        XCTAssertEqual(ComputerDraft(rows[0]).entries(editing: rows[0]).map(\.virtualDisplays), [2, nil])
        var solo = ComputerDraft(rows[1])
        solo.password = "s"
        let saved = solo.entries(editing: rows[1])
        XCTAssertEqual(saved.map(\.subtype), ["ard-high-performance", "ard-mirror"])
        XCTAssertEqual(saved.map(\.virtualDisplays), [2, nil])
        // A Mac that was Mirrored alone gains its Virtual entry with the switch on.
        var mirrored = ComputerDraft(rows[2])
        mirrored.password = "s"
        mirrored.twoDisplays = true
        let gained = mirrored.entries(editing: rows[2])
        XCTAssertEqual(gained.map(\.subtype), ["ard-high-performance", "ard-mirror"])
        XCTAssertEqual(gained.map(\.virtualDisplays), [2, nil])

        // A computer added with the switch on is written with it, and without it.
        let mac = ComputerDraft(name: "Novo", kind: .mac, host: "h", username: "ana", password: "s", twoDisplays: true)
        XCTAssertEqual(mac.entries().map(\.virtualDisplays), [2, nil])
        let pc = ComputerDraft(name: "PC novo", kind: .windows, host: "h", twoDisplays: true)
        XCTAssertEqual(pc.entries().map(\.virtualDisplays), [2])
        XCTAssertEqual(ComputerDraft(name: "PC novo", kind: .windows, host: "h").entries().map(\.virtualDisplays), [nil])
        XCTAssertEqual(Computers.saving(pc, editing: nil, in: shown).last?.virtualDisplays, 2, "and so it is sent")
        // One of a kind that opens with one display is not, whatever the switch says.
        XCTAssertEqual(ComputerDraft(name: "L", kind: .linux, host: "h", twoDisplays: true).entries().map(\.virtualDisplays), [nil])
    }

    func testSavingOneComputerWritesTheOthersAsTheyAre() throws {
        let shown = [
            // A Mac the settings name in their own way, mirrored first, with no port written.
            ShownComputer(name: "estudio espelho", kind: "vnc", subtype: "ard-mirror", host: "192.0.2.20", username: "ana", hasPassword: true),
            ShownComputer(name: "PC", kind: "rdp", host: "192.0.2.24", username: "ana", hasPassword: true),
            ShownComputer(name: "estudio", kind: "vnc", subtype: "ard-high-performance", host: "192.0.2.20", username: "ana", hasPassword: true),
            // A Mac in one mode only.
            ShownComputer(name: "Solo", kind: "vnc", subtype: "ard-high-performance", host: "192.0.2.21", port: 5900, username: "ana", hasPassword: true),
        ]
        let rows = Computers.rows(shown)
        XCTAssertEqual(rows.map(\.name), ["estudio", "PC", "Solo"])

        // The Windows host renamed: the two Macs are written by their names alone,
        // where they stand, and nothing else of them.
        var pc = ComputerDraft(rows[1])
        pc.name = " Escritório "
        let saved = Computers.saving(pc, editing: rows[1], in: shown)
        XCTAssertEqual(saved.map(\.name), ["estudio espelho", "Escritório", "estudio", "Solo"])
        XCTAssertEqual(saved.map(\.untouched), [true, false, true, true])
        XCTAssertEqual(saved[1].was, "PC")
        XCTAssertEqual(
            parsed(Change(computers: saved).json()),
            parsed(#"""
            {"computers":[{"name":"estudio espelho"},
              {"name":"Escritório","was":"PC","protocol":"rdp","subtype":null,"host":"192.0.2.24","port":3389,"username":"ana",
               "virtual_displays":null},
              {"name":"estudio"},{"name":"Solo"}]}
            """#)
        )

        // The Mac edited: its two entries go where the first of them stood, the
        // virtual one first, each under the name it has. Nobody renamed it.
        var mac = ComputerDraft(rows[0])
        mac.username = "bia"
        let edited = Computers.saving(mac, editing: rows[0], in: shown)
        XCTAssertEqual(edited.map(\.name), ["estudio", "estudio espelho", "PC", "Solo"])
        XCTAssertEqual(edited.map(\.was), [nil, nil, nil, nil])
        XCTAssertEqual(edited.prefix(2).map(\.subtype), ["ard-high-performance", "ard-mirror"])
        XCTAssertEqual(edited.prefix(2).map(\.username), ["bia", "bia"])
        XCTAssertEqual(edited.map(\.untouched), [false, false, true, true])
        // Renamed, its entries are named from the new name, each found by the one
        // it had.
        mac.name = "Sala"
        let renamed = Computers.saving(mac, editing: rows[0], in: shown)
        XCTAssertEqual(renamed.prefix(2).map(\.name), ["Sala virtual", "Sala mirrored"])
        XCTAssertEqual(renamed.prefix(2).map(\.was), ["estudio", "estudio espelho"])

        // One added goes to the end, and one removed is left out.
        let added = Computers.saving(ComputerDraft(name: "Pi", kind: .vnc, host: " pi.local "), editing: nil, in: shown)
        XCTAssertEqual(added.map(\.name), ["estudio espelho", "PC", "estudio", "Solo", "Pi"])
        XCTAssertEqual(added.last?.host, "pi.local")
        XCTAssertEqual(added.dropLast().map(\.untouched), [true, true, true, true])
        XCTAssertEqual(Computers.removing(rows[0], from: shown).map(\.name), ["PC", "Solo"])
        XCTAssertEqual(Computers.removing(rows[1], from: shown).map(\.name), ["estudio espelho", "estudio", "Solo"])
    }

    func testAMacInOneModeKeepsItsEntryAndGainsTheOther() {
        // The settings list each of these Macs once: one virtual, one mirrored
        // with a key the app does not know.
        let shown = [
            ShownComputer(name: "Solo", kind: "vnc", subtype: "ard-high-performance", host: "192.0.2.21", username: "ana", hasPassword: true),
            ShownComputer(name: "Espelho virtual", kind: "vnc", subtype: "ard-mirror", host: "192.0.2.22", username: "ana", hasPassword: true),
        ]
        let rows = Computers.rows(shown)
        XCTAssertEqual(rows.map(\.name), ["Solo", "Espelho virtual"])
        XCTAssertEqual(rows.map(\.modes), [["ard-high-performance"], ["ard-mirror"]])

        var solo = ComputerDraft(rows[0])
        solo.password = "s"
        let saved = Computers.saving(solo, editing: rows[0], in: shown)
        // The entry it has stays as it is named and in its mode; the other mode
        // is an entry added, named from the computer's name.
        XCTAssertEqual(saved.map(\.name), ["Solo", "Solo mirrored", "Espelho virtual"])
        XCTAssertEqual(saved.map(\.subtype), ["ard-high-performance", "ard-mirror", "ard-mirror"])
        XCTAssertEqual(saved.map(\.was), [nil, nil, nil])
        XCTAssertEqual(Computers.rows(saved.prefix(2).map { ShownComputer(name: $0.name, kind: $0.kind, subtype: $0.subtype, host: $0.host) }).map(\.name), ["Solo"],
                       "and the line is called what it was")

        // The one that was mirrored stays the mirrored one, whatever it is named.
        var mirrored = ComputerDraft(rows[1])
        mirrored.password = "s"
        let other = Computers.saving(mirrored, editing: rows[1], in: shown)
        XCTAssertEqual(other.map(\.name), ["Solo", "Espelho virtual virtual", "Espelho virtual"])
        XCTAssertEqual(other.map(\.subtype), ["ard-high-performance", "ard-high-performance", "ard-mirror"])
        XCTAssertEqual(other.map(\.was), [nil, nil, nil], "the entry it had is not moved into the other mode")
        XCTAssertEqual(other.map(\.untouched), [true, false, false])
    }

    func testAComputerOfAnotherKindIsAnotherComputer() throws {
        let shown = [
            ShownComputer(name: "Sala virtual", kind: "vnc", subtype: "ard-high-performance", host: "192.0.2.20", username: "ana", hasPassword: true),
            ShownComputer(name: "Sala mirrored", kind: "vnc", subtype: "ard-mirror", host: "192.0.2.20", username: "ana", hasPassword: true),
            ShownComputer(name: "PC", kind: "rdp", host: "192.0.2.24", username: "ana", hasPassword: true),
        ]
        let rows = Computers.rows(shown)
        // The Mac made a Windows host, the password left blank: one entry, in the
        // place of the Mac's, that keeps nothing of it. The Mac's password is not
        // the Windows host's.
        var sala = ComputerDraft(rows[0])
        sala.kind = .windows
        sala.port = "3389"
        XCTAssertFalse(rows[0].keepsPassword(for: sala))
        let windows = Computers.saving(sala, editing: rows[0], in: shown)
        XCTAssertEqual(windows.map(\.name), ["Sala", "PC"])
        XCTAssertEqual(windows[0].was, "Sala virtual")
        XCTAssertTrue(windows[0].fresh)
        XCTAssertNil(windows[0].password)
        XCTAssertFalse(windows[1].fresh)
        // And the Windows host made a Mac: two entries, neither the old one.
        var pc = ComputerDraft(rows[1])
        pc.kind = .mac
        pc.port = "5900"
        pc.password = "s"
        let mac = Computers.saving(pc, editing: rows[1], in: shown)
        XCTAssertEqual(mac.suffix(2).map(\.name), ["PC virtual", "PC mirrored"])
        XCTAssertEqual(mac.suffix(2).map(\.fresh), [true, true])
        // The same kind is the same computer.
        XCTAssertEqual(Computers.saving(ComputerDraft(rows[1]), editing: rows[1], in: shown).map(\.fresh), [false, false, false])
        // As the gateway reads it.
        let said = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(Change(computers: [windows[0]]).json().utf8)) as? [String: Any])
        let entry = try XCTUnwrap((said["computers"] as? [[String: Any]])?.first)
        XCTAssertEqual(entry["fresh"] as? Bool, true)
        XCTAssertNil(entry["password"], "no password is sent, and none is kept")
    }

    func testABlankPasswordIsKeptOnlyWhereEveryEntryHasOne() {
        func row(_ kind: ComputerKind, entries: [String], compatible: Bool = false, hasPassword: Bool = true) -> ComputerRow {
            ComputerRow(name: "x", kind: kind, compatible: compatible, host: "h", port: kind.port, username: "ana",
                        hasPassword: hasPassword, entries: entries)
        }
        let both = row(.mac, entries: ["x virtual", "x mirrored"])
        XCTAssertTrue(both.keepsPassword(for: ComputerDraft(both)))
        // Saved, a Mac in one mode gains the other, which has no password yet.
        let solo = row(.mac, entries: ["x"])
        XCTAssertFalse(solo.keepsPassword(for: ComputerDraft(solo)))
        let compatible = row(.mac, entries: ["x"], compatible: true)
        XCTAssertTrue(compatible.keepsPassword(for: ComputerDraft(compatible)), "it stays one entry")
        let pc = row(.windows, entries: ["x"])
        XCTAssertTrue(pc.keepsPassword(for: ComputerDraft(pc)))
        var became = ComputerDraft(pc)
        became.kind = .mac
        XCTAssertFalse(pc.keepsPassword(for: became), "another kind of computer has another account")
        let none = row(.windows, entries: ["x"], hasPassword: false)
        XCTAssertFalse(none.keepsPassword(for: ComputerDraft(none)))
    }

    func testTheComputersSheetRefusesBesideItsField() {
        let good = ComputerDraft(name: "Mac mini", kind: .mac, host: "mac-mini.local", username: "ana", password: "s")
        XCTAssertNil(ComputerFault.of(good, others: ["PC"], stored: false))

        var draft = good
        draft.name = "  "
        XCTAssertEqual(ComputerFault.of(draft, others: [], stored: false), .noName)
        draft = good
        XCTAssertEqual(ComputerFault.of(draft, others: ["mac MINI"], stored: false), .nameTaken("Mac mini"))
        draft.host = ""
        XCTAssertEqual(ComputerFault.of(draft, others: [], stored: false), .noHost)
        draft = good
        for port in ["", "0", "65536", "abc", "-1"] {
            draft.port = port
            XCTAssertEqual(ComputerFault.of(draft, others: [], stored: false), .badPort, port)
        }
        draft = good
        draft.password = ""
        XCTAssertEqual(ComputerFault.of(draft, others: [], stored: false), .macNeedsAccount)
        XCTAssertNil(ComputerFault.of(draft, others: [], stored: true), "left blank, the stored one stays")
        draft.username = ""
        XCTAssertEqual(ComputerFault.of(draft, others: [], stored: true), .macNeedsAccount)
        // Only a Mac asks for an account here: the others, the gateway judges.
        let vnc = ComputerDraft(name: "Pi", kind: .vnc, host: "pi.local")
        XCTAssertNil(ComputerFault.of(vnc, others: [], stored: false))

        XCTAssertEqual(
            [ComputerFault.noName, .nameTaken("x"), .noHost, .badPort, .macNeedsAccount].map(\.code),
            ["AL-1401", "AL-1402", "AL-1403", "AL-1404", "AL-1405"]
        )
        XCTAssertEqual(ComputerFault.badPort.message(portuguese)?.text, "A porta é um número de 1 a 65535.")
    }

    func testThePasswordsSheetRefusesBesideItsField() {
        XCTAssertNil(PasswordFault.of(user: "ana", password: "s", again: "s"))
        XCTAssertEqual(PasswordFault.of(user: "", password: "s", again: "s"), .noUser)
        XCTAssertEqual(PasswordFault.of(user: "a:b", password: "s", again: "s"), .colonInUser)
        XCTAssertEqual(PasswordFault.of(user: "ana", password: "", again: ""), .empty)
        XCTAssertEqual(PasswordFault.of(user: "ana", password: "s", again: "t"), .differ)
        XCTAssertEqual(
            [PasswordFault.noUser, .colonInUser, .empty, .differ].map(\.code), ["AL-1501", "AL-1502", "AL-1503", "AL-1504"]
        )
        XCTAssertEqual(PasswordFault.differ.message(english)?.text, "The two passwords are not the same.")
    }
}
