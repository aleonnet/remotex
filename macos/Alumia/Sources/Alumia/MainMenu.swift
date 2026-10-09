// The app's main menu. A menu bar item has no menu bar of its own, and this one
// is seen only while a window of the app is open, which is when the app stands in
// the Dock too (`Windows.bring`). It is there for the keyboard: ⌘V reaches the
// field that has the cursor through the Edit menu's item, and through nothing
// else. What the Edit menu holds is AlumiaCore's `EditCommand`; this makes it of
// AppKit's items, each sent to whoever has the cursor. The application's own menu
// has the two things the menu bar item's has for the app itself, the settings and
// quitting, by the same words and the same keys.

import AlumiaCore
import AppKit

@MainActor
enum MainMenu {
    /// What each command asks of the field that has the cursor. Undo and redo
    /// are the field's undo manager's, which answers to these two names.
    private static func action(_ command: EditCommand) -> Selector {
        switch command {
        case .undo: Selector(("undo:"))
        case .redo: Selector(("redo:"))
        case .cut: #selector(NSText.cut(_:))
        case .copy: #selector(NSText.copy(_:))
        case .paste: #selector(NSText.paste(_:))
        case .selectAll: #selector(NSText.selectAll(_:))
        }
    }

    /// `settings` is what opens the settings: the app delegate's, with its
    /// selector.
    static func make(_ words: Words, settings: (target: AnyObject, action: Selector)) -> NSMenu {
        let main = NSMenu()
        // The first place is the application's own menu, under the app's name.
        let own = NSMenu()
        let open = NSMenuItem(title: words.say("mac.menu.settings"), action: settings.action, keyEquivalent: ",")
        open.target = settings.target
        own.addItem(open)
        own.addItem(.separator())
        own.addItem(NSMenuItem(title: words.say("mac.menu.quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        let app = NSMenuItem()
        app.submenu = own
        main.addItem(app)

        let edit = NSMenu(title: words.say(EditCommand.menuKey))
        for (place, group) in EditCommand.groups.enumerated() {
            if place > 0 {
                edit.addItem(.separator())
            }
            for command in group {
                let item = NSMenuItem(title: words.say(command.titleKey), action: action(command), keyEquivalent: command.key)
                item.keyEquivalentModifierMask = command.shifted ? [.command, .shift] : [.command]
                edit.addItem(item)
            }
        }
        let item = NSMenuItem()
        item.submenu = edit
        main.addItem(item)
        return main
    }
}
