// Draw the app's icon: the three bars on the unlit glass.
//
//   swift packaging/macos/icon.swift <out.png> <glass> <red> <green> <blue>
//
// The four colours are the design tokens' (docs/design/alumia.tokens.json), read
// and handed over by packaging/build-mac-app.sh as `#RRGGBB`, so that none is
// typed here. The shape is the mockup's own (`.am-appicon`): a rounded square,
// and on it three bars of one height, each 13% of its width, 8% apart.

import AppKit

func colour(_ hex: String) -> NSColor {
    let value = UInt32(hex.dropFirst(), radix: 16) ?? 0
    return NSColor(
        srgbRed: CGFloat((value >> 16) & 0xFF) / 255,
        green: CGFloat((value >> 8) & 0xFF) / 255,
        blue: CGFloat(value & 0xFF) / 255,
        alpha: 1
    )
}

let arguments = CommandLine.arguments
guard arguments.count == 6 else {
    FileHandle.standardError.write(Data("usage: icon.swift <out.png> <glass> <red> <green> <blue>\n".utf8))
    exit(64)
}
let glass = colour(arguments[2])
let bars = arguments[3...5].map(colour)

// The size macOS asks an icon's master at, and the square it leaves inside for
// the shape: 824 of 1024, which is the margin every app icon keeps.
let side: CGFloat = 1024
let square = NSRect(x: 100, y: 100, width: 824, height: 824)

guard let drawn = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(side), pixelsHigh: Int(side), bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
), let context = NSGraphicsContext(bitmapImageRep: drawn) else {
    exit(1)
}
NSGraphicsContext.current = context

let shape = NSBezierPath(roundedRect: square, xRadius: square.width * 0.225, yRadius: square.width * 0.225)
glass.setFill()
shape.fill()
// The glass catches a little light from above, as the mockup's does.
shape.addClip()
NSGradient(colors: [NSColor.white.withAlphaComponent(0.10), NSColor.white.withAlphaComponent(0)])?
    .draw(in: square, angle: -90)

let (width, gap, height) = (square.width * 0.13, square.width * 0.08, square.height * 0.5)
let left = square.midX - (3 * width + 2 * gap) / 2
for (place, bar) in bars.enumerated() {
    let rect = NSRect(x: left + CGFloat(place) * (width + gap), y: square.midY - height / 2, width: width, height: height)
    bar.setFill()
    NSBezierPath(roundedRect: rect, xRadius: width * 0.25, yRadius: width * 0.25).fill()
}

context.flushGraphics()
guard let png = drawn.representation(using: .png, properties: [:]) else {
    exit(1)
}
try png.write(to: URL(fileURLWithPath: arguments[1]))
