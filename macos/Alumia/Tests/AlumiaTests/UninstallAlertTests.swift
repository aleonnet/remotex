// The alert that asks before uninstalling, as the app lays out what it deletes: one
// item a line, each with its marker and a hanging indent, the sentence of what stays
// after them, in a view wide enough for the items. An NSAlert's own informative text
// is plain and wraps a line with no indent (what the owner photographed on
// 2026-10-08), and a paragraph of it all was unreadable (2026-10-09): so the list is
// the alert's accessory view, and this holds it to the shape.

import AlumiaCore
import AppKit
import XCTest
@testable import Alumia

@MainActor
final class UninstallAlertTests: XCTestCase {
    private let portuguese = Words(.portuguese)
    private let english = Words(.english)

    private func items(published: Bool, in words: Words) -> [String] {
        Uninstall.listed(published: published).map { words.say($0) }
    }

    /// Each paragraph of `text` with the style it is set in.
    private func paragraphs(of text: NSAttributedString) -> [(String, NSParagraphStyle)] {
        var found: [(String, NSParagraphStyle)] = []
        let whole = text.string as NSString
        var at = 0
        while at < whole.length {
            let range = whole.paragraphRange(for: NSRange(location: at, length: 0))
            let style = text.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle
            found.append((whole.substring(with: range).trimmingCharacters(in: .newlines), style ?? NSParagraphStyle()))
            at = range.location + range.length
        }
        return found
    }

    func testEachItemIsALineWithAHangingIndent() {
        for (words, published) in [(portuguese, true), (portuguese, false), (english, true)] {
            let listed = items(published: published, in: words)
            let text = UninstallAlert.text(items: listed, keeps: words.say("mac.uninstall.keeps"))
            let lines = paragraphs(of: text)
            XCTAssertEqual(lines.count, listed.count + 1, "an item a line, and the sentence of what stays")
            for (line, item) in zip(lines, listed) {
                XCTAssertEqual(line.0, "•\t\(item)", "each item is its own line, with the marker")
                XCTAssertEqual(line.1.firstLineHeadIndent, 0, "the marker stands at the margin")
                XCTAssertEqual(line.1.headIndent, UninstallAlert.indent, "the continuation of an item is indented to its text")
                XCTAssertGreaterThan(line.1.headIndent, 0)
                XCTAssertEqual(line.1.tabStops.first?.location, UninstallAlert.indent, "the text begins where the continuation does")
            }
            XCTAssertEqual(lines.last?.0, words.say("mac.uninstall.keeps"), "what stays comes after the list, with no marker")
            XCTAssertFalse(lines.last?.0.hasPrefix("•") ?? true)
        }
        XCTAssertEqual(items(published: true, in: portuguese).count, 5)
        XCTAssertEqual(items(published: false, in: portuguese).count, 4)
    }

    func testTheViewIsWideEnoughForTheItems() {
        let listed = items(published: true, in: english)
        let view = UninstallAlert.view(items: listed, keeps: english.say("mac.uninstall.keeps"))
        XCTAssertEqual(view.frame.width, UninstallAlert.width, "the list is given its width, wider than the alert's own text")
        XCTAssertGreaterThan(view.frame.height, 0)
        XCTAssertEqual(view.attributedStringValue.string, UninstallAlert.text(items: listed, keeps: english.say("mac.uninstall.keeps")).string)
        XCTAssertFalse(view.isEditable)
        XCTAssertEqual(view.font?.pointSize, NSFont.systemFontSize, "the alert's own size of text")
    }
}
