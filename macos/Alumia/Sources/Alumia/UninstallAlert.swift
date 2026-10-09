// What the alert that asks before uninstalling lists: one item a line, each with its
// marker and a hanging indent, and the sentence of what stays after them.
//
// An NSAlert's informative text is plain text, and wraps a line with no indent: an
// item that did not fit went on under its marker (the owner's photograph of
// 2026-10-08), and the items as one paragraph could not be read (2026-10-09). So the
// opening stays in the informative text and the list is the alert's accessory view,
// a label with its own paragraph style and a width the items fit in, which also
// widens the alert.

import AppKit

@MainActor
enum UninstallAlert {
    /// Where an item's text begins, and where its continuation is indented to.
    static let indent: CGFloat = 12
    /// The list's width: wider than the alert's own text, so that each item is one
    /// line (measured on 2026-10-09 at 300, the alert's own, where the Tailscale line
    /// wrapped, and at 340, where none did).
    static let width: CGFloat = 340

    /// The items, "•" and a tab before each, one paragraph each with the hanging
    /// indent, and then `keeps`, a paragraph of its own with room before it.
    static func text(items: [String], keeps: String) -> NSAttributedString {
        let font = NSFont.systemFont(ofSize: NSFont.systemFontSize)
        let item = NSMutableParagraphStyle()
        item.firstLineHeadIndent = 0
        item.headIndent = indent
        item.tabStops = [NSTextTab(textAlignment: .left, location: indent)]
        item.paragraphSpacing = 2
        let after = NSMutableParagraphStyle()
        after.paragraphSpacingBefore = 6
        let text = NSMutableAttributedString()
        for line in items {
            text.append(NSAttributedString(string: "•\t\(line)\n", attributes: [.font: font, .paragraphStyle: item, .foregroundColor: NSColor.labelColor]))
        }
        text.append(NSAttributedString(string: keeps, attributes: [.font: font, .paragraphStyle: after, .foregroundColor: NSColor.labelColor]))
        return text
    }

    /// The label the alert takes as its accessory view, as tall as the text needs.
    static func view(items: [String], keeps: String) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: "")
        label.attributedStringValue = text(items: items, keeps: keeps)
        label.font = NSFont.systemFont(ofSize: NSFont.systemFontSize)
        label.preferredMaxLayoutWidth = width
        let height = label.sizeThatFits(NSSize(width: width, height: .greatestFiniteMagnitude)).height
        label.frame = NSRect(x: 0, y: 0, width: width, height: height)
        return label
    }
}
