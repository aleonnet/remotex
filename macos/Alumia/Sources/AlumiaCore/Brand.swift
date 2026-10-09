// The brand's colours: the three bars, and the glass under them.
//
// They are the design tokens' (docs/design/alumia.tokens.json), written into the
// package by tools/app-words.py beside the texts, so that none is typed here.
// Everything else the app draws is the system's own: its controls, its
// materials, and its colours for them.

import Foundation

/// A colour in sRGB, each part from 0 to 1.
public struct BrandColour: Sendable, Equatable {
    public var red: Double
    public var green: Double
    public var blue: Double
}

public enum Brand {
    /// What the app is called. A name, the same in every language.
    public static let name = "Alumia"

    private static func colour(_ name: String) -> BrandColour {
        let value = Generated.colours[name] ?? 0
        return BrandColour(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    /// The unlit screen: what the three bars stand on.
    public static var glass: BrandColour { colour("glass") }
    /// What is written on it.
    public static var onGlass: BrandColour { colour("onGlass") }
    /// The three bars, in their order: this Mac, the way in, the page's password.
    public static var bars: [BrandColour] { [colour("red"), colour("green"), colour("blue")] }
}
