// The Edit menu: what gives the app's fields their keyboard.
//
// An app that is a menu bar item has no menu bar of its own, and it is the main
// menu that turns ⌘V into "paste" for whichever field has the cursor: with none,
// a password copied from somewhere else could not be pasted into the first run.
// So the app has the menu, which is on the menu bar only while a window of the
// app is open, and which every field answers to. This is what it holds; the app
// makes it of AppKit's own items.

import Foundation

public enum EditCommand: String, Sendable, Equatable, CaseIterable {
    case undo, redo, cut, copy, paste, selectAll

    /// The key pressed with ⌘.
    public var key: String {
        switch self {
        case .undo, .redo: "z"
        case .cut: "x"
        case .copy: "c"
        case .paste: "v"
        case .selectAll: "a"
        }
    }

    /// Whether ⇧ is held too.
    public var shifted: Bool {
        self == .redo
    }

    public var titleKey: String {
        switch self {
        case .undo: "mac.editmenu.undo"
        case .redo: "mac.editmenu.redo"
        case .cut: "mac.editmenu.cut"
        case .copy: "mac.editmenu.copy"
        case .paste: "mac.editmenu.paste"
        case .selectAll: "mac.editmenu.all"
        }
    }

    /// The menu's own name.
    public static let menuKey = "mac.editmenu"

    /// The menu, in the order the system's own has: what is undone, a line, and
    /// what is done to a selection.
    public static let groups: [[EditCommand]] = [[.undo, .redo], [.cut, .copy, .paste, .selectAll]]
}
