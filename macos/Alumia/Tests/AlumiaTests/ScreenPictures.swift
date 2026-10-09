// Pictures of the app's screens, drawn off screen, to hold beside the mockup.
//
// Nothing is asserted about a pixel, and nothing appears on anybody's display: a
// screen is laid out in a window that is never shown and drawn into a file. They
// are for eyes, as the photographs beside the page's mockup are
// (tools/compare-screens.sh), and the test does nothing unless it is asked:
//
//   ALUMIA_PICTURES=/path/to/folder swift test --filter ScreenPictures
//
// A pane's picture is its content, alone: the panes across the top are the
// window's, a capsule of glass where there is glass and the system's bar where
// there is none, and are not in it. Neither is glass, which is drawn only on a
// display: on macOS 26 and 27 the notice is an empty strip here, and the ground
// of the first run's step, which there blends what is behind its window, is
// whatever a window never shown has behind it. A window shown from a test is not
// one the system photographs either
// (`screencapture -l`: "could not create image from window", macOS 27.0.1), so
// what glass looks like is seen in the app itself. And these are drawn inside
// the program that runs the tests, which is built against the system kit of the
// Mac it runs on whatever the app's own executable says of itself: that the app
// is, is held where the bundle is built (packaging/build-mac-app.sh).

import AlumiaCore
import AppKit
import SwiftUI
import XCTest
@testable import Alumia

@MainActor
final class ScreenPictures: XCTestCase {
    private let serving = GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380", ffmpeg: true)

    private let computers = [
        ShownComputer(name: "Mac mini virtual", kind: "vnc", subtype: "ard-high-performance", host: "127.0.0.1", port: 5900,
                      username: "ale", hasPassword: true),
        ShownComputer(name: "Mac mini mirrored", kind: "vnc", subtype: "ard-mirror", host: "127.0.0.1", port: 5900,
                      username: "ale", hasPassword: true),
        ShownComputer(name: "MacBook Pro virtual", kind: "vnc", subtype: "ard-high-performance", host: "macbook.local",
                      port: 5900, username: "ale", hasPassword: true),
        ShownComputer(name: "MacBook Pro mirrored", kind: "vnc", subtype: "ard-mirror", host: "macbook.local", port: 5900,
                      username: "ale", hasPassword: true),
        ShownComputer(name: "PC do trabalho", kind: "rdp", host: "192.0.2.24", port: 3389, username: "ale", hasPassword: true),
        ShownComputer(name: "Estação Linux", kind: "vnc", subtype: "wlshare", host: "192.0.2.25", port: 5900),
    ]

    private func model(_ language: Language, service: ServiceState = .running, sharing: Bool = true,
                       tailscale: TailscaleState = .published("https://mac-mini.example"), setUp: Bool = true,
                       ffmpeg: Bool = true, installing: Bool = false) -> AppModel {
        let model = AppModel()
        let shown = Shown(configured: setUp, listen: "127.0.0.1:52380", username: "ale", brand: nil, meter: true,
                          computers: setUp ? computers : [])
        var status = serving
        status.ffmpeg = ffmpeg
        model.stage(language: language, status: service == .running ? status : nil, shown: shown, service: service,
                    screenSharingOn: sharing, tailscale: tailscale, installing: installing)
        return model
    }

    /// Lay `view` out in a window nobody sees and draw it into `name`.png.
    private func picture<Content: View>(_ view: Content, _ name: String, dark: Bool, in folder: URL) throws {
        // What a window draws under its content is the window's, and is not in a
        // picture of the content: so the picture is given it.
        let host = NSHostingView(rootView: view.background(Color(nsColor: .windowBackgroundColor)))
        let size = host.fittingSize
        host.frame = NSRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        // SwiftUI settles what it draws a turn of the run loop after it is laid out.
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        guard let drawn = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
            return XCTFail("\(name) could not be drawn")
        }
        host.cacheDisplay(in: host.bounds, to: drawn)
        let png = try XCTUnwrap(drawn.representation(using: .png, properties: [:]))
        try png.write(to: folder.appendingPathComponent("\(name).png"))
    }

    func testEveryScreenInEachLanguageAndTheme() throws {
        guard let named = ProcessInfo.processInfo.environment["ALUMIA_PICTURES"], !named.isEmpty else {
            throw XCTSkip("set ALUMIA_PICTURES to a folder to draw the screens into")
        }
        _ = NSApplication.shared
        let folder = URL(fileURLWithPath: named)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        for (language, tag) in [(Language.portuguese, "pt"), (.english, "en")] {
            for dark in [false, true] {
                let theme = dark ? "dark" : "light"
                // The first run, state by state, with Tailscale as each way in has it.
                let tailscale: [WizardState: TailscaleState] = [
                    .waysMissing: .missing, .waysSignedOut: .signedOut, .waysNoHTTPS: .noHTTPS, .ways: .ready,
                    .waysPublished: .published("https://mac-mini.example"),
                ]
                for state in WizardState.allCases where dark == false || [.welcome, .sharing, .ways, .done].contains(state) {
                    let model = model(language, sharing: state != .sharing, tailscale: tailscale[state] ?? .ready, setUp: false)
                    try picture(WizardView(model: model, finish: {}, state: state), "first-\(state.rawValue)-\(tag)-\(theme)",
                                dark: dark, in: folder)
                }
                // The settings, pane by pane.
                for pane in Pane.allCases {
                    try picture(PaneView(pane: pane, model: model(language), uninstall: {}),
                                "settings-\(pane.rawValue)-\(tag)-\(theme)", dark: dark, in: folder)
                }
                // And the notice, three of the ones a window shows.
                let notices: [(String, AppModel)] = [
                    ("sharing-off", model(language, sharing: false)),
                    ("needs-approval", model(language, service: .needsApproval)),
                    ("service-stopped", model(language, service: .registeredButSilent)),
                ]
                for (name, model) in notices where dark == false {
                    try picture(PaneView(pane: .general, model: model, uninstall: {}), "notice-\(name)-\(tag)-\(theme)",
                                dark: dark, in: folder)
                }
                // The pieces drawn after the mockup: FFmpeg's seal in its three
                // states, with the notice over the one that is missing.
                let seals: [(String, AppModel)] = [
                    ("missing", model(language, ffmpeg: false)),
                    ("installing", model(language, ffmpeg: false, installing: true)),
                    ("present", model(language)),
                ]
                for (name, model) in seals {
                    try picture(PaneView(pane: .general, model: model, uninstall: {}), "ffmpeg-seal-\(name)-\(tag)-\(theme)",
                                dark: dark, in: folder)
                }
                // Its sheet, state by state.
                let sheets: [(String, FFmpegSheet)] = [
                    ("ask", .ask(command: Homebrew.shown)), ("nobrew", .noHomebrew), ("waiting", .waitingForHomebrew),
                    ("running", .running(lines: ["==> Pouring ffmpeg.arm64_tahoe.bottle.tar.gz"])),
                    ("failed", .failed(last: "Error: No such file or directory @ rb_sysopen - /opt/homebrew/Cellar/ffmpeg")),
                    ("done", .done),
                ]
                for (name, sheet) in sheets {
                    try picture(FFmpegSheetView(model: model(language, ffmpeg: false), sheet: sheet),
                                "ffmpeg-sheet-\(name)-\(tag)-\(theme)", dark: dark, in: folder)
                }
                // And the sheets of a computer, added and edited, and of the page's
                // password.
                let listed = model(language)
                try picture(ComputerSheet(model: listed, row: nil, close: {}), "computer-add-\(tag)-\(theme)", dark: dark, in: folder)
                try picture(ComputerSheet(model: listed, row: listed.rows[0], close: {}), "computer-edit-this-\(tag)-\(theme)",
                            dark: dark, in: folder)
                try picture(ComputerSheet(model: listed, row: listed.rows[2], close: {}), "computer-edit-\(tag)-\(theme)",
                            dark: dark, in: folder)
                try picture(PasswordSheet(model: listed, close: {}), "password-\(tag)-\(theme)", dark: dark, in: folder)
            }
        }
        // The menu bar's icon in its four states, as the system tints it.
        for (icon, name) in [(StatusIcon.outline, "idle"), (.filled, "serving"), (.outlineWithMark, "needs-action"), (.dimmed, "off")] {
            let image = StatusItem.icon(icon)
            let big = NSImage(size: NSSize(width: 144, height: 128), flipped: false) { rect in
                NSColor.white.setFill()
                rect.fill()
                image.draw(in: rect)
                return true
            }
            let data = try XCTUnwrap(big.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
            try data.write(to: folder.appendingPathComponent("icon-\(name).png"))
        }
    }
}
