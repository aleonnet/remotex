// The Edit menu, which gives the app's fields their keyboard: the six commands,
// each with its key, and each named in both languages.

import XCTest
@testable import AlumiaCore

final class EditMenuTests: XCTestCase {
    func testTheMenuHasTheSixEachWithItsKey() {
        let menu = EditCommand.groups.flatMap { $0 }
        XCTAssertEqual(menu, [.undo, .redo, .cut, .copy, .paste, .selectAll])
        XCTAssertEqual(Set(menu), Set(EditCommand.allCases), "every command is in the menu")
        XCTAssertEqual(menu.map { ($0.shifted ? "⇧" : "") + "⌘" + $0.key.uppercased() }, ["⌘Z", "⇧⌘Z", "⌘X", "⌘C", "⌘V", "⌘A"])
        // No two answer to the same keys.
        XCTAssertEqual(Set(menu.map { "\($0.shifted)\($0.key)" }).count, menu.count)
        XCTAssertFalse(menu.contains { $0.key.isEmpty })
    }

    func testEachIsNamedInBothLanguages() {
        XCTAssertEqual(portuguese.say(EditCommand.menuKey), "Editar")
        XCTAssertEqual(english.say(EditCommand.menuKey), "Edit")
        XCTAssertEqual(EditCommand.allCases.map { portuguese.say($0.titleKey) }, [
            "Desfazer", "Refazer", "Recortar", "Copiar", "Colar", "Selecionar Tudo",
        ])
        XCTAssertEqual(EditCommand.allCases.map { english.say($0.titleKey) }, ["Undo", "Redo", "Cut", "Copy", "Paste", "Select All"])
    }
}
