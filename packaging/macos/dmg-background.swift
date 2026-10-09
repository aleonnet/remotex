// Draw the picture behind the disk image's window, after the approved mockup
// (`.am-dmgbody`): the brand's dark glass, an arrow from the app to the
// Applications folder, a light capsule where each of the two names falls, and
// under them the one thing to do.
//
//   swift packaging/macos/dmg-background.swift <out.png> <scale> <width> <height> <row> \
//     <left> <right> <words> <ground> <ink> <plate> <sentence>
//
// The size, the places of the two icons, the colours and the sentence are handed
// over by packaging/build-mac-dmg.sh, which gives the same to the window's record
// (packaging/macos/dmg-settings.py) and reads them back from the image: none is
// typed here. `row` is how far the icons' middles are from the top, `left` and
// `right` how far from the left, and `words` how far the sentence's middle is
// from the top.
//
// The names under the two icons are the Finder's to write, and over a ground
// that is the image's own it writes them black, in a dark Mac too: photographed
// on macOS 27 over this picture, over it with the window's recorded colour made
// black, and over a plain dark colour with no picture. So each stands on a
// capsule of the `plate` colour, drawn where the Finder puts a name of 12 points
// under an icon of 92: its middle 61 points under the icon's.

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
let numbers = arguments.dropFirst(2).prefix(7).compactMap { Double($0) }.map { CGFloat($0) }
guard arguments.count == 13, numbers.count == 7 else {
    FileHandle.standardError.write(Data(
        "usage: dmg-background.swift <out.png> <scale> <width> <height> <row> <left> <right> <words> <ground> <ink> <plate> <sentence>\n".utf8
    ))
    exit(64)
}
let (scale, row, left, right, words) = (numbers[0], numbers[3], numbers[4], numbers[5], numbers[6])
let size = NSSize(width: numbers[1], height: numbers[2])
let (ground, ink, plate) = (colour(arguments[9]), colour(arguments[10]), colour(arguments[11]))
let sentence = arguments[12]

guard let drawn = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0
) else {
    exit(1)
}
// Drawn in points: the picture twice as dense is the same drawing. The size is
// said before the context is made, which is when it is read: said after, the
// dense picture was drawn at half its size in a corner, the rest of it clear,
// and that is what the first disk image showed.
drawn.size = size
guard let context = NSGraphicsContext(bitmapImageRep: drawn) else {
    exit(1)
}
NSGraphicsContext.current = context

ground.setFill()
NSRect(origin: .zero, size: size).fill()

// The arrow, 40 points long, as the mockup's: a line and its head, halfway
// between the two icons.
let middle = NSPoint(x: (left + right) / 2, y: size.height - row)
let arrow = NSBezierPath()
arrow.lineWidth = 2
arrow.lineCapStyle = .round
arrow.lineJoinStyle = .round
arrow.move(to: NSPoint(x: middle.x - 18, y: middle.y))
arrow.line(to: NSPoint(x: middle.x + 18, y: middle.y))
arrow.move(to: NSPoint(x: middle.x + 6, y: middle.y + 12))
arrow.line(to: NSPoint(x: middle.x + 18, y: middle.y))
arrow.line(to: NSPoint(x: middle.x + 6, y: middle.y - 12))
ink.withAlphaComponent(0.7).setStroke()
arrow.stroke()

// Where the Finder writes a name: under its icon. A capsule wide enough for
// "Applications" in the name's size, as the app's own buttons are capsules.
plate.setFill()
for x in [left, right] {
    let under = NSRect(x: x - 62, y: size.height - row - 72, width: 124, height: 22)
    NSBezierPath(roundedRect: under, xRadius: 11, yRadius: 11).fill()
}

// The sentence, its middle `words` from the top: clear of the window's foot,
// where the Finder's own bars stand over the picture when they are on.
let centred = NSMutableParagraphStyle()
centred.alignment = .center
sentence.draw(
    in: NSRect(x: 0, y: size.height - words - 9, width: size.width, height: 18),
    withAttributes: [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: ink, .paragraphStyle: centred]
)

context.flushGraphics()
// The drawing fills the picture, at whatever density: its far corner is ground.
guard let corner = drawn.colorAt(x: drawn.pixelsWide - 1, y: 0), corner.alphaComponent == 1 else {
    FileHandle.standardError.write(Data("dmg-background: the drawing does not reach the picture's far corner\n".utf8))
    exit(1)
}
guard let png = drawn.representation(using: .png, properties: [:]) else {
    exit(1)
}
try png.write(to: URL(fileURLWithPath: arguments[1]))
