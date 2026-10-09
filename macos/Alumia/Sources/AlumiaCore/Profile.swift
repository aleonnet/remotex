// The two profiles the Mac app is drawn in: with glass, and without.
//
// The design system has both (docs/design/2026-10-03-0003-design-system.md, "Dois
// perfis"): on macOS 26 and 27 wide corners, buttons that are capsules, and glass
// where something stands over the content; on macOS 14 and 15 the same controls
// in rectangles of small corners, on opaque grounds. Which one the app is in is
// the system's version and nothing else, and the screens ask for glass by name
// only behind `if #available(macOS 26, *)`, which is this same line.

import Foundation

public enum Profile: Sendable, Equatable {
    /// macOS 26 and later.
    case glass
    /// macOS 14 and 15.
    case plain

    /// The first version of macOS whose controls and materials are glass.
    public static let firstWithGlass = 26

    /// The profile of the macOS whose version begins with `major`.
    public static func of(major: Int) -> Profile {
        major >= firstWithGlass ? .glass : .plain
    }

    /// The corner of a group of rows the app draws itself, in points: the
    /// mockup's own for each profile.
    public var groupCorner: Double {
        self == .glass ? 12 : 6
    }
}
