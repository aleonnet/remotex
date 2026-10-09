// What the app asks of macOS 26 and 27 by name: windows that show what is behind
// them, glass, and buttons that are capsules.
//
// Some of the glass is the system's own and needs no asking: the menu bar's menu
// is made of it, and so are a switch's knob and an alert. The rest is asked for
// here, each thing behind the one line that tells the two profiles apart, and on
// macOS 14 and 15 each is what it was: the mockup's plain profile.
//
// - A window that shows what is behind it. The recipe is the one of the house's
//   other Mac app, which its owner sees working on these systems: a ground that
//   blends what is behind the window (`NSVisualEffectView`, `.behindWindow`), in a
//   window that is not opaque and has a clear background. That app's own note is
//   why it is this and not SwiftUI's material for a window: the material "KEPT
//   THE NSWINDOW OPAQUE", measured there.
// - The panes of the settings, a capsule of glass under the window's title, as
//   the approved mockup draws them in this profile (`.am-panes`), and not the
//   system's bar of them, which is no glass: the owner saw that in the installed
//   app.
// - The notice, which lies over a pane, and the button on it: glass is for what
//   stands over the content, and not for the content ("Don't use Liquid Glass in
//   the content layer", Apple's Human Interface Guidelines, Materials).
// - A button, which on macOS 27 comes as a rectangle unless it is asked otherwise.
//
// That each is asked for is what the tests hold (GlassTests, WindowTests). None of
// it was seen on a display by whoever wrote it: a window made in a test is never
// shown, and glass is drawn only on a display.

import AlumiaCore
import AppKit
import SwiftUI

extension Profile {
    /// The profile of the Mac the app runs on.
    static let current = Profile.of(major: ProcessInfo.processInfo.operatingSystemVersion.majorVersion)
}

/// The ground of a window that shows what is behind it: the system's own
/// material for it, always lit, blending what is behind the window.
struct WindowGround: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .hudWindow
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}

/// What a window of the glass profile is given so that its ground shows: it is
/// not opaque, and its content goes under its title bar, which draws nothing of
/// its own.
enum SeeThrough {
    @MainActor static func make(_ window: NSWindow) {
        window.styleMask.insert(.fullSizeContentView)
        window.titlebarAppearsTransparent = true
        window.isOpaque = false
        window.backgroundColor = .clear
    }
}

extension View {
    /// The ground of a window that shows what is behind it, under this view and
    /// out to the window's edges, where `shown`.
    func windowGround(_ shown: Bool) -> some View {
        background {
            if shown {
                WindowGround().ignoresSafeArea()
            }
        }
    }

    /// A capsule of glass under this view where there is glass, as the panes of
    /// the settings stand on: it answers a press, as what holds controls does.
    @ViewBuilder func capsuleOfGlass() -> some View {
        if #available(macOS 26, *) {
            glassEffect(.regular.interactive(), in: Capsule())
        } else {
            self
        }
    }

    /// Every button under this view in its profile's shape: a capsule with glass,
    /// the system's own rectangle without.
    @ViewBuilder func buttonsOfTheProfile() -> some View {
        if #available(macOS 26, *) {
            buttonBorderShape(.capsule)
        } else {
            self
        }
    }

    /// The ground of the notice: a strip of glass tinted with `colour`, clear of
    /// the window's edges as a group of rows is; without glass, the opaque strip
    /// from edge to edge that the mockup's plain profile draws.
    @ViewBuilder func noticeGround(_ colour: Color) -> some View {
        if #available(macOS 26, *) {
            glassEffect(.regular.tint(colour.opacity(0.22)), in: .rect(cornerRadius: Profile.glass.groupCorner))
                .padding(.horizontal, 20)
                .padding(.top, 10)
        } else {
            background(colour.opacity(0.18))
        }
    }

    /// A button that stands on glass is glass itself.
    @ViewBuilder func buttonOnGlass() -> some View {
        if #available(macOS 26, *) {
            buttonStyle(.glass)
        } else {
            self
        }
    }
}
