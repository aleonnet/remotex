// swift-tools-version: 6.0
// Alumia for the Mac: the app that hosts the gateway and is its control. It shows
// no remote screen: the page does that (docs/mac-app.md).
//
// The logic is a library with no screen in it, which `swift test` covers; the app
// target is the screens over it.
import PackageDescription

let package = Package(
    name: "Alumia",
    // Apple Silicon, macOS 14 or later. What is glass on macOS 26 and 27 is the
    // system's own controls, and anything asked for by name sits behind
    // `if #available(macOS 26, *)`.
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "AlumiaCore", targets: ["AlumiaCore"]),
        // The app's executable, which packaging/build-mac-app.sh puts in a bundle
        // beside the gateway's binary.
        .executable(name: "Alumia", targets: ["Alumia"]),
    ],
    targets: [
        .target(name: "AlumiaCore"),
        .executableTarget(name: "Alumia", dependencies: ["AlumiaCore"]),
        .testTarget(name: "AlumiaCoreTests", dependencies: ["AlumiaCore"]),
        // The screens, drawn off screen into pictures to hold beside the mockup:
        // a test that does nothing unless it is asked for them.
        .testTarget(name: "AlumiaTests", dependencies: ["Alumia", "AlumiaCore"]),
    ]
)
