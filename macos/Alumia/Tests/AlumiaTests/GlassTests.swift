// What the app asks for by name on macOS 26 and 27 is glass there, and is not
// asked for before it.
//
// Nothing here looks at a pixel. A view that asks for glass leaves in the tree of
// layers the system builds for it the layer that reads what is behind it (a
// `CABackdropLayer`), and one that asks for none leaves none: measured on macOS
// 27.0.1 with a button, a text on a colour, a glass button and a text on glass,
// each alone in a window nobody sees. So the test asks the system what it built.
// On macOS 14 and 15 there is no glass to find, and the same views are held to
// leaving none.

import AlumiaCore
import AppKit
import SwiftUI
import XCTest
@testable import Alumia

@MainActor
final class GlassTests: XCTestCase {
    private let serving = GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380", ffmpeg: true)

    private let thisMac = [
        ShownComputer(name: "Mac mini virtual", kind: "vnc", subtype: "ard-high-performance", host: "127.0.0.1", port: 5900,
                      username: "ale", hasPassword: true),
        ShownComputer(name: "Mac mini mirrored", kind: "vnc", subtype: "ard-mirror", host: "127.0.0.1", port: 5900,
                      username: "ale", hasPassword: true),
    ]

    private func model(sharing: Bool) -> AppModel {
        let model = AppModel()
        let shown = Shown(configured: true, listen: "127.0.0.1:52380", username: "ale", computers: thisMac)
        model.stage(language: .english, status: serving, shown: shown, service: .running, screenSharingOn: sharing,
                    tailscale: .ready)
        return model
    }

    private func count(_ layer: CALayer?) -> Int {
        guard let layer else { return 0 }
        let own = String(describing: type(of: layer)).contains("Backdrop") ? 1 : 0
        return own + (layer.sublayers ?? []).map(count).reduce(0, +)
    }

    /// How many layers that read what is behind them the system builds for
    /// `view`, laid out in a window that is never shown.
    private func glass<Content: View>(in view: Content) -> Int {
        _ = NSApplication.shared
        let host = NSHostingView(rootView: view)
        host.frame = NSRect(origin: .zero, size: host.fittingSize)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        return count(host.layer)
    }

    func testTheProfileIsTheSystemsOwn() {
        if #available(macOS 26, *) {
            XCTAssertEqual(Profile.current, .glass, "what the screens ask behind `#available` and what the profile says are one line")
        } else {
            XCTAssertEqual(Profile.current, .plain)
        }
    }

    func testTheNoticeIsGlassWhereThereIsGlass() {
        let noticed = model(sharing: false)
        XCTAssertEqual(noticed.notice, .sharingOff)
        let strip = glass(in: NoticeStrip(model: noticed).frame(width: 700))
        // Its two parts, each alone: the ground it lies on, and the button on it.
        let ground = glass(in: Text(verbatim: "-").padding().noticeGround(.orange))
        let button = glass(in: Button(action: {}, label: { Text(verbatim: "-") }).buttonOnGlass())
        // A pane with no notice over it asks for none: its controls are the
        // system's, and its content is no place for glass.
        let pane = glass(in: PaneView(pane: .about, model: model(sharing: true), uninstall: {}))
        if #available(macOS 26, *) {
            XCTAssertGreaterThan(ground, 0, "the notice's ground is a strip of glass")
            XCTAssertGreaterThan(button, 0, "the button on it is glass")
            XCTAssertGreaterThanOrEqual(strip, ground + button, "and the notice is both")
        } else {
            XCTAssertEqual([strip, ground, button], [0, 0, 0], "before macOS 26 there is no glass to ask for")
        }
        XCTAssertEqual(pane, 0, "a pane's content is not glass")
        // And a pane alone, as a picture of one is, is not in the window that
        // shows what is behind it: it stands on no ground of that window's.
        // Laid out in a window never shown, as the one in the window is when the
        // ground is found under it (WindowTests).
        let alone = NSHostingView(rootView: PaneView(pane: .about, model: model(sharing: true), uninstall: {}))
        alone.frame = NSRect(origin: .zero, size: alone.fittingSize)
        let window = NSWindow(contentRect: alone.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = alone
        alone.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        XCTAssertEqual(grounds(under: alone), 0, "a pane alone has no window's ground under it")
    }

    /// The grounds that blend what is behind a window, under `view`. Only those:
    /// the system puts a material of its own in a pane at times, which is not one.
    private func grounds(under view: NSView) -> Int {
        let own = (view as? NSVisualEffectView).map { $0.blendingMode == .behindWindow && $0.material == .hudWindow } ?? false
        return (own ? 1 : 0) + view.subviews.map(grounds).reduce(0, +)
    }
}
