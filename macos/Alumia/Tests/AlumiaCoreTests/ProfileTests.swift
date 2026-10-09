// The profile the app is drawn in: glass from macOS 26 on, plain before it.

import XCTest
@testable import AlumiaCore

final class ProfileTests: XCTestCase {
    func testGlassIsFromMacOS26On() {
        XCTAssertEqual(Profile.of(major: 14), .plain)
        XCTAssertEqual(Profile.of(major: 15), .plain)
        XCTAssertEqual(Profile.of(major: 26), .glass)
        XCTAssertEqual(Profile.of(major: 27), .glass)
        XCTAssertEqual(Profile.of(major: 28), .glass, "and whatever comes after")
    }

    func testEachProfileHasTheMockupsCorners() {
        XCTAssertEqual(Profile.glass.groupCorner, 12)
        XCTAssertEqual(Profile.plain.groupCorner, 6)
    }
}
