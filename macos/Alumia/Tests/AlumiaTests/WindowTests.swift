// The settings window as the app makes it, and never shown.
//
// Where there is glass (macOS 26 and 27) the window shows what is behind it, and
// its panes are chosen from a capsule of glass under its title. Each part of that
// is something the window is asked to be, and can be read back from it with no
// display: it is not opaque, its background is clear, its content goes under its
// title bar, the pane on show stands on the material that blends what is behind
// the window, the system's bar of panes is not made, and the capsule asks for
// glass. Where there is none (macOS 14 and 15) it is the window it was. What all
// of it looks like is seen on a display, in the app.

import AlumiaCore
import AppKit
import SwiftUI
import XCTest
@testable import Alumia

@MainActor
final class WindowTests: XCTestCase {
    private func model(_ language: Language = .english) -> AppModel {
        let model = AppModel()
        let computers = [
            ShownComputer(name: "Mac mini virtual", kind: "vnc", subtype: "ard-high-performance", host: "127.0.0.1", port: 5900,
                          username: "ale", hasPassword: true),
        ]
        let shown = Shown(configured: true, listen: "127.0.0.1:52380", username: "ale", computers: computers)
        model.stage(language: language, status: GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380", ffmpeg: true),
                    shown: shown, service: .running, screenSharingOn: true, tailscale: .ready)
        return model
    }

    /// The settings window, laid out and settled, with the controller of its panes.
    private func settings(_ windows: Windows) throws -> (NSWindow, NSTabViewController) {
        _ = NSApplication.shared
        let window = windows.makeSettings()
        let tabs = try XCTUnwrap(window.contentViewController as? NSTabViewController)
        settle(window)
        return (window, tabs)
    }

    private func settle(_ window: NSWindow) {
        window.layoutIfNeeded()
        window.displayIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
    }

    /// The capsule of panes the window keeps under its title, where it has one.
    private func capsule(of window: NSWindow) -> NSHostingView<PaneTabs>? {
        window.titlebarAccessoryViewControllers.compactMap { $0.view as? NSHostingView<PaneTabs> }.first
    }

    /// Every view of `kind` under `view`.
    private func views<Kind: NSView>(_ kind: Kind.Type, under view: NSView?) -> [Kind] {
        guard let view else { return [] }
        return ([view as? Kind].compactMap { $0 }) + view.subviews.flatMap { views(kind, under: $0) }
    }

    /// The grounds that blend what is behind the window, under `view`.
    private func grounds(under view: NSView?) -> [NSVisualEffectView] {
        views(NSVisualEffectView.self, under: view).filter {
            $0.blendingMode == .behindWindow && $0.material == .hudWindow && $0.state == .active
        }
    }

    /// Where `view` is in its window, from the window's bottom left.
    private func place(_ view: NSView) -> NSRect {
        view.convert(view.bounds, to: nil)
    }

    private func count(_ layer: CALayer?) -> Int {
        guard let layer else { return 0 }
        let own = String(describing: type(of: layer)).contains("Backdrop") ? 1 : 0
        return own + (layer.sublayers ?? []).map(count).reduce(0, +)
    }

    func testTheSettingsWindowShowsWhatIsBehindItWhereThereIsGlass() throws {
        let (window, tabs) = try settings(Windows(model: model()))
        let ground = grounds(under: window.contentView)
        if #available(macOS 26, *) {
            XCTAssertFalse(window.isOpaque, "the settings window is not opaque")
            XCTAssertEqual(window.backgroundColor, .clear, "and its own background is clear")
            XCTAssertTrue(window.styleMask.contains(.fullSizeContentView), "its content goes under its title bar")
            XCTAssertTrue(window.titlebarAppearsTransparent, "which draws nothing of its own")
            XCTAssertEqual(ground.count, 1, "the pane on show stands on the material that blends what is behind the window")
            XCTAssertEqual(ground.first.map(place), NSRect(origin: .zero, size: window.frame.size),
                           "which covers the window from edge to edge, its title's room included: a window that is not opaque shows nothing where nothing is drawn")
            XCTAssertEqual(tabs.tabStyle, .unspecified, "the system's bar of panes is not made")
            XCTAssertEqual(tabs.tabView.tabViewType, .noTabsNoBorder, "and the tab view draws no tabs of its own")
            XCTAssertFalse(tabs.tabView.drawsBackground, "nor a ground over the window's")
            XCTAssertNotNil(capsule(of: window), "the capsule of panes is under the window's title")
            XCTAssertEqual(window.titlebarAccessoryViewControllers.count, 1, "and there is one")
        } else {
            XCTAssertTrue(window.isOpaque, "before macOS 26 the window is the one it was")
            XCTAssertEqual(tabs.tabStyle, .toolbar)
            XCTAssertEqual(ground.count, 0)
            XCTAssertNil(capsule(of: window), "with the system's bar of panes and no capsule")
        }
    }

    func testThePanesAreACapsuleOfGlassWhereThereIsGlass() {
        _ = NSApplication.shared
        let host = NSHostingView(rootView: PaneTabs(shown: ShownPane(), model: model(), choose: { _ in }))
        host.frame = NSRect(origin: .zero, size: host.fittingSize)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        settle(window)
        if #available(macOS 26, *) {
            XCTAssertGreaterThan(count(host.layer), 0, "the capsule of panes is glass")
        } else {
            XCTAssertEqual(count(host.layer), 0, "before macOS 26 there is no glass to ask for")
        }
        // As wide whatever the language: five panes of one width, and the room around them.
        for language in [Language.english, .portuguese] {
            let capsule = NSHostingView(rootView: PaneTabs(shown: ShownPane(), model: model(language), choose: { _ in }))
            XCTAssertEqual(capsule.fittingSize.width, 5 * 104 + 4 * 2 + 2 * 4, "the capsule is as wide in \(language)")
        }
    }

    func testChoosingAPaneShowsItNamesTheWindowAndFitsIt() throws {
        let windows = Windows(model: model())
        let (window, tabs) = try settings(windows)
        XCTAssertEqual(tabs.selectedTabViewItemIndex, 0)
        XCTAssertEqual(window.title, "General", "the window is named for the pane on show")
        let general = window.frame.height

        windows.select(.access)
        settle(window)
        XCTAssertEqual(tabs.selectedTabViewItemIndex, 2, "choosing a pane shows it")
        XCTAssertEqual(window.title, "Access", "and names the window for it")
        XCTAssertGreaterThan(window.frame.height, general, "and the window is as tall as the pane on show")
        if #available(macOS 26, *) {
            let ground = grounds(under: window.contentView)
            XCTAssertEqual(ground.count, 1, "which stands on the same ground")
            XCTAssertEqual(ground.first.map(place), NSRect(origin: .zero, size: window.frame.size), "from edge to edge of the taller window")
            XCTAssertEqual(capsule(of: window)?.rootView.shown.pane, .access, "and the capsule marks the pane on show")
        }
    }

    func testTheWindowIsAsTallAsEachPaneNeeds() throws {
        let windows = Windows(model: model())
        let (window, tabs) = try settings(windows)
        for (index, pane) in Pane.allCases.enumerated() {
            windows.select(pane)
            settle(window)
            let shown = try XCTUnwrap(tabs.tabViewItems[index].viewController?.view)
            XCTAssertEqual(shown.frame.height, shown.fittingSize.height, accuracy: 1, "\(pane.rawValue): the window gives the pane what it asks for")
            XCTAssertEqual(shown.frame.width, 700, accuracy: 1, "\(pane.rawValue): the window is as wide as a pane")
            XCTAssertEqual(tabs.view.frame.height, shown.frame.height, accuracy: 1, "\(pane.rawValue): and the pane fills what the window gives it")
            // The window is the pane alone and what the window puts over its
            // content, and no taller: counted twice, that room was a strip at the
            // window's foot with nothing drawn in it.
            let alone = NSHostingView(rootView: PaneView(pane: pane, model: model(), uninstall: {}))
            let over = window.frame.height - window.contentLayoutRect.height
            XCTAssertEqual(window.frame.height, alone.fittingSize.height + over, accuracy: 1,
                           "\(pane.rawValue): the window is as tall as the pane and what is over it")
            if #available(macOS 26, *) {
                XCTAssertEqual(grounds(under: window.contentView).map(place), [NSRect(origin: .zero, size: window.frame.size)],
                               "\(pane.rawValue): and its ground covers it from edge to edge")
            }
        }
        if #available(macOS 26, *) {
            XCTAssertEqual(capsule(of: window)?.frame.height ?? 0, PaneTabs.room, accuracy: 1, "the capsule has the room kept for it")
            XCTAssertGreaterThanOrEqual(window.frame.height - window.contentLayoutRect.height, PaneTabs.room,
                                        "and a pane begins under it: the window's content is laid out from where the capsule ends")
        }
    }

    func testTheFirstRunsWindowShowsWhatIsBehindItWhereThereIsGlass() {
        _ = NSApplication.shared
        let window = Windows(model: model()).makeWizard()
        settle(window)
        XCTAssertEqual(window.frame.size, NSSize(width: 820, height: 540), "the window is as large as what the first run draws, and no taller")
        let ground = grounds(under: window.contentView)
        if #available(macOS 26, *) {
            XCTAssertFalse(window.isOpaque, "the first run's window is not opaque")
            XCTAssertEqual(window.backgroundColor, .clear, "and its own background is clear")
            // Beside the brand's pane, which is 250 points wide and drawn solid.
            XCTAssertEqual(ground.map(place), [NSRect(x: 250, y: 0, width: 570, height: 540)],
                           "the step stands on the material that blends what is behind the window, from the brand's pane to the window's edges")
        } else {
            XCTAssertTrue(window.isOpaque, "before macOS 26 the window is the one it was")
            XCTAssertEqual(ground.count, 0)
        }
    }

    func testThePaneAskedForInTheCapsuleIsShown() throws {
        guard #available(macOS 26, *) else {
            throw XCTSkip("before macOS 26 the panes are the system's bar, which the system wires")
        }
        let (window, tabs) = try settings(Windows(model: model()))
        // What the capsule calls with the pane pressed. That its buttons call it
        // is one line of `PaneTabs`, read and not tested: a window never shown has
        // no button to press.
        let choose = try XCTUnwrap(capsule(of: window)?.rootView.choose, "the capsule is given the window's way to another pane")
        choose(.advanced)
        settle(window)
        XCTAssertEqual(tabs.selectedTabViewItemIndex, 3, "pressing a pane in the capsule shows it")
        XCTAssertEqual(window.title, "Advanced")
    }
}
