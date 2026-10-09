// The menu of the menu bar, built as the app builds it and never opened.
//
// Its two lines that say something and cannot be chosen carry an image: the light
// beside what Alumia is doing, and under it a clear one of the same size, so that
// the two sentences begin at the same place. An app built against the system kit
// of macOS 27 has the images of its menu's lines hidden unless it asks otherwise
// ("in macOS 27 and later, AppKit determines the visibility of menu item images,
// and will typically hide images", `NSMenuItem.h`), which is how the light went
// the day the app took that kit. So each of them asks to be seen, and this holds
// them to asking. Whether the system then draws them is seen on a display.

import AlumiaCore
import AppKit
import XCTest
@testable import Alumia

@MainActor
final class MenuTests: XCTestCase {
    private func serving() -> AppModel {
        let model = AppModel()
        let computers = [
            ShownComputer(name: "Mac mini virtual", kind: "vnc", subtype: "ard-high-performance", host: "127.0.0.1", port: 5900,
                          username: "ale", hasPassword: true),
        ]
        let shown = Shown(configured: true, listen: "127.0.0.1:52380", username: "ale", computers: computers)
        model.stage(language: .english, status: GatewayStatus(version: "0.0.325", serving: true, listen: "127.0.0.1:52380", ffmpeg: true),
                    shown: shown, service: .running, screenSharingOn: true, tailscale: .ready)
        return model
    }

    func testTheLightAndTheRoomUnderItAskToBeSeen() {
        _ = NSApplication.shared
        let item = StatusItem(model: serving(), openSettings: {}, openFirstRun: {})
        let menu = NSMenu()
        item.menuNeedsUpdate(menu)

        let said = menu.items.filter { !$0.isSeparatorItem && !$0.isEnabled && $0.image != nil }
        XCTAssertEqual(said.count, 2, "what Alumia is doing, with the light, and who is connected under it")
        if #available(macOS 27, *) {
            for line in said {
                XCTAssertEqual(line.preferredImageVisibility, .visible, "the image of the line \"\(line.title)\" asks to be seen")
            }
        }
    }
}
