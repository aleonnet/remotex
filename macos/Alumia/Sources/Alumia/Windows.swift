// The app's two windows, FFmpeg's sheet over the settings, and the alerts that
// uninstall it.
//
// The settings are AppKit's own tab view controller, with the window named for
// the pane on show, as Apple asks ("Update the window's title to reflect the
// currently visible pane"). Each pane's content is SwiftUI. Where there is no
// glass the controller is in the toolbar style, which draws the panes across the
// top. Where there is, it draws none: the panes are a capsule of glass under the
// window's title (`PaneTabs`), one for the window's life, where the system keeps
// what goes under a title bar; and the window shows what is behind it
// (Glass.swift), as the first run's does.
//
// The app has no icon in the Dock while it has no window: it is an agent app
// (`LSUIElement`). While a window is open it takes one, so the window can be
// found and brought forward like any other.

import AlumiaCore
import AppKit
import SwiftUI

@MainActor
final class Windows: NSObject, NSWindowDelegate {
    private let model: AppModel
    private var wizard: NSWindow?
    private var settings: NSWindow?
    private var tabs: NSTabViewController?
    /// The pane on show, which the capsule of panes marks.
    private let shown = ShownPane()
    /// FFmpeg's sheet, while it is over the settings.
    private var ffmpeg: NSViewController?

    init(model: AppModel) {
        self.model = model
    }

    // -- the first run -------------------------------------------------------------------

    func showWizard() {
        bring(makeWizard())
    }

    /// The first run's window, made once and not shown: showing it is
    /// `showWizard`, and a test looks at it as it is made.
    func makeWizard() -> NSWindow {
        if let wizard {
            wizard.title = model.say(Wizard.windowKey)
            return wizard
        }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 820, height: 540),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        if Profile.current == .glass {
            SeeThrough.make(window)
        }
        let content = NSHostingView(rootView: WizardView(model: model) { [weak self] in
            self?.wizard?.close()
        })
        // The first run draws to every edge of its window, its title bar's room
        // included, and is as tall as it says: with the title bar's room counted
        // again the window was that much taller than what is drawn in it, and
        // where the window shows what is behind it that is a strip of nothing.
        content.safeAreaRegions = []
        window.contentView = content
        window.center()
        window.delegate = self
        window.title = model.say(Wizard.windowKey)
        wizard = window
        return window
    }

    // -- the settings ------------------------------------------------------------------------

    func showSettings() {
        bring(makeSettings())
    }

    /// The settings window, made once and not shown: showing it is
    /// `showSettings`, and a test looks at it as it is made.
    func makeSettings() -> NSWindow {
        if let settings {
            retitle()
            return settings
        }
        let glass = Profile.current == .glass
        let tabs = NSTabViewController()
        if glass {
            tabs.tabStyle = .unspecified
            tabs.tabView.tabViewType = .noTabsNoBorder
            tabs.tabView.drawsBackground = false
        } else {
            tabs.tabStyle = .toolbar
        }
        for pane in Pane.allCases {
            let content = NSHostingController(rootView: PaneView(pane: pane, model: model, windowed: glass) { [weak self] in
                self?.askToUninstall()
            })
            content.sizingOptions = [.preferredContentSize]
            let item = NSTabViewItem(viewController: content)
            item.image = NSImage(systemSymbolName: pane.symbol, accessibilityDescription: nil)
            tabs.addTabViewItem(item)
        }
        let window = NSWindow(contentViewController: tabs)
        window.styleMask = [.titled, .closable, .miniaturizable]
        if glass {
            SeeThrough.make(window)
            // The capsule of panes, under the title: "telling the window to place
            // this view controller's view under the titlebar"
            // (NSTitlebarAccessoryViewController.h, of the place it has by default).
            let capsule = NSHostingView(rootView: PaneTabs(shown: shown, model: model) { [weak self] in
                self?.select($0)
            })
            capsule.sizingOptions = []
            capsule.frame = NSRect(x: 0, y: 0, width: 700, height: PaneTabs.room)
            let under = NSTitlebarAccessoryViewController()
            // As tall as the capsule needs, and not the system's own height for
            // what goes there, which is shorter (36 points, measured).
            under.automaticallyAdjustsSize = false
            under.view = capsule
            window.addTitlebarAccessoryViewController(under)
        }
        window.isReleasedWhenClosed = false
        window.center()
        window.delegate = self
        self.tabs = tabs
        settings = window
        retitle()
        return window
    }

    /// Show `pane`, mark it in the capsule and name the window for it: what the
    /// capsule of panes asks.
    func select(_ pane: Pane) {
        guard let tabs, let index = Pane.allCases.firstIndex(of: pane) else { return }
        shown.pane = pane
        tabs.selectedTabViewItemIndex = index
        retitle()
    }

    /// FFmpeg's sheet, over the settings: the seal's button opens it, and so do
    /// the notice's, from whichever pane, and the menu's item, with no window
    /// open. It is the window's own and not a pane's, so that it is one from all
    /// three; what it shows is the model's, and it goes when the model has none.
    func showFFmpeg() {
        showSettings()
        guard let tabs, ffmpeg == nil else { return }
        let sheet = NSHostingController(rootView: FFmpegOver(model: model) { [weak self] in
            self?.closeFFmpeg()
        })
        sheet.sizingOptions = [.preferredContentSize]
        ffmpeg = sheet
        tabs.presentAsSheet(sheet)
    }

    private func closeFFmpeg() {
        if let ffmpeg {
            tabs?.dismiss(ffmpeg)
        }
        ffmpeg = nil
    }

    /// The panes' names, in the language the app is in now.
    func retitle() {
        guard let tabs else { return }
        for (item, pane) in zip(tabs.tabViewItems, Pane.allCases) {
            item.label = model.say(pane.key)
        }
        // The window's name is the pane's on show, which the controller sets when
        // the pane changes and not when its label does.
        if tabs.tabViewItems.indices.contains(tabs.selectedTabViewItemIndex) {
            settings?.title = tabs.tabViewItems[tabs.selectedTabViewItemIndex].label
        }
        wizard?.title = model.say(Wizard.windowKey)
    }

    private func bring(_ window: NSWindow?) {
        model.watching = true
        NSApp.setActivationPolicy(.regular)
        NSApp.activate()
        window?.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        let closing = notification.object as? NSWindow
        let open = [wizard, settings].compactMap { $0 }.filter { $0 !== closing && $0.isVisible }
        if open.isEmpty {
            model.watching = false
            NSApp.setActivationPolicy(.accessory)
        }
    }

    // -- uninstalling --------------------------------------------------------------------------

    /// Say what is deleted, ask, delete it, and then offer to move the app to
    /// the Trash, where it has nothing left to take with it.
    private func askToUninstall() {
        guard let window = settings else { return }
        let asking = NSAlert()
        asking.messageText = model.say("mac.uninstall.title")
        asking.informativeText = model.say("mac.uninstall.lead")
        // The list is the alert's own view: its text would wrap an item with no indent.
        asking.accessoryView = UninstallAlert.view(
            items: Uninstall.listed(published: model.isPublished).map { model.say($0) },
            keeps: model.say("mac.uninstall.keeps")
        )
        let uninstall = asking.addButton(withTitle: model.say("mac.uninstall.do"))
        uninstall.hasDestructiveAction = true
        // Return does not delete: the one way to it is the button itself.
        uninstall.keyEquivalent = ""
        asking.addButton(withTitle: model.say("common.cancel")).keyEquivalent = "\u{1b}"

        Task {
            guard await asking.beginSheetModal(for: window) == .alertFirstButtonReturn else { return }
            // In the app's language as it was: uninstalling forgets the choice.
            let words = model.words
            await model.uninstall()
            let done = NSAlert()
            done.messageText = words.say("mac.uninstalled.title")
            done.informativeText = words.say("mac.uninstalled.body")
            done.addButton(withTitle: words.say("mac.uninstalled.trash"))
            done.addButton(withTitle: words.say("common.notnow")).keyEquivalent = "\u{1b}"
            if await done.beginSheetModal(for: window) == .alertFirstButtonReturn {
                _ = try? await NSWorkspace.shared.recycle([Bundle.main.bundleURL])
            }
            NSApp.terminate(nil)
        }
    }
}
