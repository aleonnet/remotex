// The menu bar item: the three bars, and the menu under them.
//
// AppKit's own (`NSStatusItem` with an `NSMenu`), as Apple asks of a menu bar
// extra: "Display a menu — not a popover — when people click your menu bar
// extra." What the menu holds in each state is AlumiaCore's `Menu`; this draws
// it, and draws the icon as a template of one colour, which is what the system
// tints for a light or a dark bar.
//
// The menu's top is two lines nobody can choose: what Alumia is doing, with a
// light beside it in one of the system's own colours, and under it who is
// connected or what is needed. The light is never the only sign: the sentence
// beside it says the same.
//
// The light is the line's image, and a line's image is the system's to show or
// not: "in macOS 27 and later, AppKit determines the visibility of menu item
// images, and will typically hide images. Use the `preferredImageVisibility`
// property with the `.visible` constant to specify that an image should always
// be visible" (`NSMenuItem.h`). This app showed its light on macOS 27 while it
// was built against an older system's kit, and lost it the day it was built
// against that system's own: so both lines ask.

import AlumiaCore
import AppKit

@MainActor
final class StatusItem: NSObject, NSMenuDelegate {
    private let model: AppModel
    private let openSettings: () -> Void
    private let openFirstRun: () -> Void
    private var item: NSStatusItem?
    /// What each item of the open menu does, by the item's tag.
    private var actions: [MenuAction] = []

    init(model: AppModel, openSettings: @escaping () -> Void, openFirstRun: @escaping () -> Void) {
        self.model = model
        self.openSettings = openSettings
        self.openFirstRun = openFirstRun
    }

    /// Show the item as the app now is, or take it away where its owner hid it.
    func update() {
        guard model.showInBar else {
            if let item {
                NSStatusBar.system.removeStatusItem(item)
            }
            item = nil
            return
        }
        let item = item ?? make()
        let menu = model.menu
        item.button?.image = Self.icon(menu.icon)
        item.button?.setAccessibilityLabel(menu.label)
        item.button?.toolTip = menu.label
    }

    private func make() -> NSStatusItem {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let menu = NSMenu()
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
        self.item = item
        return item
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        menu.setAccessibilityLabel(model.say(Menu.nameKey))
        actions = []
        for entry in model.menu.items {
            switch entry {
            case .separator:
                menu.addItem(.separator())
            case .server(let light, let sentence):
                // What the menu is read for, so it is asked for in the colour of
                // a label and not left to the faint one of a line that cannot be
                // chosen. Whether a line that is off keeps the colour is the
                // system's to decide; the sentence is there either way.
                let said = Self.said(sentence, image: Self.light(light))
                said.attributedTitle = NSAttributedString(string: sentence, attributes: [
                    .foregroundColor: NSColor.labelColor,
                    .font: NSFont.menuFont(ofSize: 0),
                ])
                menu.addItem(said)
            case .detail(let sentence):
                // Under the first line's words: a clear image of the light's size
                // stands where the light does.
                menu.addItem(Self.said(sentence, image: Self.light(nil)))
            case .action(let action, let title, let shortcut, let enabled):
                let item = NSMenuItem(title: title, action: #selector(chosen(_:)), keyEquivalent: shortcut ?? "")
                item.target = self
                item.isEnabled = enabled
                item.tag = actions.count
                actions.append(action)
                menu.addItem(item)
            }
        }
    }

    @objc private func chosen(_ sender: NSMenuItem) {
        guard actions.indices.contains(sender.tag) else { return }
        switch actions[sender.tag] {
        case .stop: model.setRunning(false)
        case .start: model.setRunning(true)
        case .setUp: openFirstRun()
        case .endSession: model.endSession()
        case .resolve(let action): model.resolve(action)
        case .installFFmpeg: model.pressFFmpeg()
        case .openInBrowser: model.openInBrowser()
        case .copyAddress: model.copyAddress()
        case .settings: openSettings()
        case .quit: NSApp.terminate(nil)
        }
    }

    /// A line of the menu that says something and cannot be chosen.
    private static func said(_ sentence: String, image: NSImage) -> NSMenuItem {
        let said = NSMenuItem(title: sentence, action: nil, keyEquivalent: "")
        said.isEnabled = false
        said.image = image
        if #available(macOS 27, *) {
            said.preferredImageVisibility = .visible
        }
        return said
    }

    /// The light beside the first line, ten points across: full and green while
    /// Alumia serves, full and orange while it needs its owner, and a grey ring
    /// while it serves nothing. `nil` is the same room with nothing in it.
    static func light(_ light: Light?) -> NSImage {
        NSImage(size: NSSize(width: 10, height: 10), flipped: false) { rect in
            guard let light else { return true }
            let circle = NSBezierPath(ovalIn: rect.insetBy(dx: 1.5, dy: 1.5))
            switch light {
            case .green:
                NSColor.systemGreen.setFill()
                circle.fill()
            case .amber:
                NSColor.systemOrange.setFill()
                circle.fill()
            case .grey:
                NSColor.secondaryLabelColor.setStroke()
                circle.lineWidth = 1.25
                circle.stroke()
            }
            return true
        }
    }

    /// The three bars, 18 by 16 points, in black and clear: outlined while ready,
    /// filled while a session is open, outlined with a mark beside them while the
    /// app needs its owner, and faint while it serves nothing.
    static func icon(_ icon: StatusIcon) -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 16), flipped: false) { _ in
            let marked = icon == .outlineWithMark
            // Narrower with the mark beside them, so that it stands clear of the
            // third bar.
            let (width, gap, height): (CGFloat, CGFloat, CGFloat) = (marked ? 3 : 3.5, marked ? 1.75 : 2.25, 12)
            let left: CGFloat = marked ? 0.5 : 2.25
            NSColor.black.withAlphaComponent(icon == .dimmed ? 0.4 : 1).set()
            for bar in 0..<3 {
                let rect = NSRect(x: left + CGFloat(bar) * (width + gap), y: 2, width: width, height: height)
                let path = NSBezierPath(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), xRadius: 1, yRadius: 1)
                if icon == .filled {
                    NSBezierPath(roundedRect: rect, xRadius: 1.2, yRadius: 1.2).fill()
                } else {
                    path.lineWidth = 1
                    path.stroke()
                }
            }
            if marked {
                // The mark: a stroke and a dot, as an exclamation mark is.
                NSBezierPath(roundedRect: NSRect(x: 15.4, y: 6.5, width: 1.6, height: 7.5), xRadius: 0.8, yRadius: 0.8).fill()
                NSBezierPath(ovalIn: NSRect(x: 15.2, y: 2.4, width: 2, height: 2)).fill()
            }
            return true
        }
        image.isTemplate = true
        return image
    }
}
