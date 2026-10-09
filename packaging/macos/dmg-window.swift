// Print the number the system gives the Finder's window of a mounted disk image, by
// the window's name, which is the volume's: what `screencapture -l` photographs it by.
//
//   swift packaging/macos/dmg-window.swift <volume name>
//
// Nothing is printed where the Finder has no window of that name. It is how
// packaging/build-mac-dmg.sh sees the window it made as the Finder draws it, where
// reading the image back says only what was asked of the Finder.

import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: dmg-window.swift <volume name>\n".utf8))
    exit(64)
}
let wanted = CommandLine.arguments[1]
let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
let found = windows.first { window in
    window[kCGWindowOwnerName as String] as? String == "Finder" && window[kCGWindowName as String] as? String == wanted
}
if let number = found?[kCGWindowNumber as String] as? Int {
    print(number)
}
