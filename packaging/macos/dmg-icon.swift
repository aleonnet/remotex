// The disk image's icon: the system's own disk with the app's icon over it, which
// is what a disk image is known by, drawn here and put on a file.
//
//   swift packaging/macos/dmg-icon.swift draw <the app's icon.icns> <out.icns>
//   swift packaging/macos/dmg-icon.swift wear <file> <icon.icns>
//
// `draw` lays the app's icon flat on the middle of the disk's face, at every size
// an icon has. The tool that builds the image has a way of its own for this
// (dmgbuild's `badge_icon`), and it tilts the icon back and sets it high on the
// disk, with no setting for either: the image's owner saw that one and asked for
// this. The disk is the system's own picture of a removable one, the same that
// tool draws on.
//
// `wear` puts an icon on a file, as the Finder shows it. It is the system's own
// way ("Sets the icon for the file or directory at the specified path",
// `NSWorkspace.setIcon(_:forFile:options:)`), and it is kept beside the file's
// content, not in it: the image is as it was signed, and the icon stays on this
// Mac's copy of the file. packaging/build-mac-dmg.sh reads back that it took, and
// asks Gatekeeper again with it on.

import AppKit

func fail(_ said: String) -> Never {
    FileHandle.standardError.write(Data("dmg-icon: \(said)\n".utf8))
    exit(1)
}

let disk = "/System/Library/Extensions/IOStorageFamily.kext/Contents/Resources/Removable.icns"
// Where the disk's face is in its picture, as parts of the picture's side: its
// middle, across and from the foot, and how much of the side the app's icon
// takes.
let (across, up, side) = (0.5, 0.553, 0.52)

func draw(app: String, to out: String) {
    guard let ground = NSImage(contentsOfFile: disk) else { fail("the system's disk icon is not at \(disk)") }
    guard let badge = NSImage(contentsOfFile: app) else { fail("no icon at \(app)") }
    let set = FileManager.default.temporaryDirectory.appendingPathComponent("dmg-icon-\(getpid()).iconset")
    try? FileManager.default.removeItem(at: set)
    do {
        try FileManager.default.createDirectory(at: set, withIntermediateDirectories: true)
    } catch {
        fail("could not make \(set.path): \(error.localizedDescription)")
    }
    defer { try? FileManager.default.removeItem(at: set) }

    // The sizes an icon has, each at one and at two dots a point.
    for (points, dense) in [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)] {
        let dots = points * dense
        guard let drawn = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: dots, pixelsHigh: dots, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ), let context = NSGraphicsContext(bitmapImageRep: drawn) else {
            fail("could not draw at \(dots) dots")
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        let whole = NSRect(x: 0, y: 0, width: dots, height: dots)
        ground.draw(in: whole, from: .zero, operation: .sourceOver, fraction: 1)
        let wide = Double(dots) * side
        let over = NSRect(x: Double(dots) * across - wide / 2, y: Double(dots) * up - wide / 2, width: wide, height: wide)
        badge.draw(in: over, from: .zero, operation: .sourceOver, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        let name = "icon_\(points)x\(points)\(dense == 2 ? "@2x" : "").png"
        guard let png = drawn.representation(using: .png, properties: [:]) else { fail("could not write \(name)") }
        do {
            try png.write(to: set.appendingPathComponent(name))
        } catch {
            fail("could not write \(name): \(error.localizedDescription)")
        }
    }

    let pack = Process()
    pack.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
    pack.arguments = ["-c", "icns", set.path, "-o", out]
    do {
        try pack.run()
    } catch {
        fail("could not run iconutil: \(error.localizedDescription)")
    }
    pack.waitUntilExit()
    guard pack.terminationStatus == 0 else { fail("iconutil could not put \(out) together") }
}

let arguments = CommandLine.arguments
switch (arguments.count, arguments.dropFirst().first) {
case (4, "draw"):
    draw(app: arguments[2], to: arguments[3])
case (4, "wear"):
    guard let icon = NSImage(contentsOfFile: arguments[3]) else { fail("no icon at \(arguments[3])") }
    exit(NSWorkspace.shared.setIcon(icon, forFile: arguments[2], options: []) ? 0 : 1)
default:
    FileHandle.standardError.write(Data("dmg-icon: draw <the app's icon.icns> <out.icns> | wear <file> <icon.icns>\n".utf8))
    exit(64)
}
