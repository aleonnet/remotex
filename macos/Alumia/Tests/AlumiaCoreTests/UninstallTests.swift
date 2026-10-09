// Uninstalling: everything the app left on the Mac, and nothing that is not its.

import XCTest
@testable import AlumiaCore

final class UninstallTests: XCTestCase {
    private let folder = URL(fileURLWithPath: "/Users/ana/Library/Application Support/alumia/app")

    func testEverythingGoesInItsOrder() {
        XCTAssertEqual(Uninstall.steps(publishedPort: 52380, folder: folder), [
            .unpublish(port: 52380),
            .unregisterService,
            .unregisterLoginItem,
            .removeFolder(folder),
            .forgetPreferences,
        ])
    }

    func testWithNothingPublishedNothingIsTakenBack() {
        XCTAssertEqual(Uninstall.steps(publishedPort: nil, folder: folder), [
            .unregisterService, .unregisterLoginItem, .removeFolder(folder), .forgetPreferences,
        ])
    }

    func testTheAlertSaysWhatGoes() {
        XCTAssertEqual(Uninstall.listed(published: false).map(portuguese.said), [
            "os ajustes e os computadores cadastrados",
            "a senha da página e as senhas dos computadores",
            "o serviço que mantém o Alumia rodando",
            "o histórico de vazão",
        ])
        XCTAssertEqual(
            Uninstall.listed(published: true).last.map(portuguese.said),
            "a publicação no Tailscale que aponta para o Alumia"
        )
        XCTAssertEqual(Uninstall.listed(published: true).count, 5)
        for key in Uninstall.askKeys + Uninstall.doneKeys {
            XCTAssertNotEqual(portuguese.say(key), key, key)
        }
        XCTAssertEqual(portuguese.say("mac.uninstall.title"), "Desinstalar o Alumia?")
    }

    func testTheFolderIsTheAppsOwn() {
        let home = URL(fileURLWithPath: "/Users/ana")
        XCTAssertEqual(Uninstall.folder(home: home, named: nil).path, "/Users/ana/Library/Application Support/alumia/app")
        XCTAssertEqual(Uninstall.folder(home: home, named: "").path, "/Users/ana/Library/Application Support/alumia/app")
        // A copy made for testing names its own, and is uninstalled from there.
        XCTAssertEqual(Uninstall.folder(home: home, named: "/tmp/alumia-test").path, "/tmp/alumia-test")
    }

    func testOnlyTheAppsFolderIsDeleted() throws {
        let files = FileManager.default
        let support = files.temporaryDirectory.appendingPathComponent("alumia-\(UUID().uuidString)/alumia")
        let app = support.appendingPathComponent("app")
        // The terminal panel's instances are beside it, and are not the app's.
        let instances = support.appendingPathComponent("instances/casa")
        try files.createDirectory(at: app, withIntermediateDirectories: true)
        try files.createDirectory(at: instances, withIntermediateDirectories: true)
        for file in ["alumia.toml", "logins", "meter.sqlite3", "display-held"] {
            try "x".write(to: app.appendingPathComponent(file), atomically: true, encoding: .utf8)
        }
        try "x".write(to: instances.appendingPathComponent("alumia.toml"), atomically: true, encoding: .utf8)

        try Uninstall.remove(folder: app)

        XCTAssertFalse(files.fileExists(atPath: app.path), "nothing of it is left")
        XCTAssertTrue(files.fileExists(atPath: instances.appendingPathComponent("alumia.toml").path), "the panel's is untouched")
        // Deleting what is already gone is not an error.
        XCTAssertNoThrow(try Uninstall.remove(folder: app))
        XCTAssertTrue(files.fileExists(atPath: support.path), "and so is the folder the two are in")
        try files.removeItem(at: support.deletingLastPathComponent())
    }

    func testTheFolderItWasInGoesOnceEmpty() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent("alumia-\(UUID().uuidString)")
        // Alumia's own, which the app's folder and the panel's are in: empty, it
        // is a trace.
        let app = root.appendingPathComponent("alumia/app")
        try files.createDirectory(at: app, withIntermediateDirectories: true)
        try Uninstall.remove(folder: app)
        XCTAssertFalse(files.fileExists(atPath: root.appendingPathComponent("alumia").path), "nothing of Alumia is left")
        XCTAssertTrue(files.fileExists(atPath: root.path), "what it was in is nobody's to delete")

        // A folder named somewhere else is deleted alone: what it is in is not
        // Alumia's.
        let named = root.appendingPathComponent("somewhere/app-test")
        try files.createDirectory(at: named, withIntermediateDirectories: true)
        try Uninstall.remove(folder: named)
        XCTAssertFalse(files.fileExists(atPath: named.path))
        XCTAssertTrue(files.fileExists(atPath: root.appendingPathComponent("somewhere").path))
        try files.removeItem(at: root)
    }
}
