// The settings window: its five panes, the computers as the list shows them, and
// what a sheet refuses before anything is sent to the gateway.
//
// The gateway's own check is what decides whether settings are valid, and its
// refusal comes back said (Gateway.swift). What is refused here first is only what
// a field can say of itself, beside the field, before a password is hashed and a
// file written: a name left empty, a port that is not one.

import Foundation

public enum Pane: String, Sendable, Equatable, CaseIterable {
    case general, computers, access, advanced, about

    /// The pane's name, which is also the window's title while it is shown.
    public var key: String {
        switch self {
        case .general: "mac.pane.general"
        case .computers: "mac.pane.computers"
        case .access: "mac.pane.access"
        case .advanced: "mac.pane.advanced"
        case .about: "mac.pane.about"
        }
    }
}

/// How the app looks.
public enum Look: String, Sendable, Equatable, CaseIterable, Codable {
    case system, light, dark

    public var key: String {
        switch self {
        case .system: "mac.system"
        case .light: "mac.look.light"
        case .dark: "mac.look.dark"
        }
    }
}

/// The labels of the settings, by pane: the mockup's, and the ones its owner
/// asked for on using the app (docs/design/app-words.json says which).
public enum SettingsText {
    public static let general = [
        "mac.on.label", "mac.on.note", "mac.inbar.label", "mac.inbar.note", "mac.look.label", "mac.lang.label",
        "mac.ffmpeg.name",
    ]
    public static let computers = ["mac.computers.what", "mac.computers.add", "mac.computers.note", "mac.edit"]
    public static let access = [
        "mac.access.who", "signin.user", "signin.password", "mac.change", "mac.access.where",
        "mac.reachable.label", "mac.reachable.note",
    ]
    public static let advanced = [
        "mac.port", "mac.brand", "mac.meter.label", "mac.meter.note", "mac.file.label", "mac.file.note", "mac.file.show",
        "mac.log.label", "mac.log.note",
    ]
    public static let about = ["mac.about.version", "mac.remove.title", "mac.remove.label", "mac.remove.cleans", "mac.remove.act"]
    /// The window's own name, for whoever does not see it.
    public static let window = "mac.settings"
}

/// What a computer is, as the sheet's Kind picker lists it.
public enum ComputerKind: String, Sendable, Equatable, CaseIterable {
    case mac, windows, linux, vnc

    /// The name in the picker.
    public var key: String {
        switch self {
        case .mac: "mac.kind.mac"
        case .windows: "mac.kind.windows"
        case .linux: "mac.kind.linux"
        case .vnc: "mac.kind.vnc"
        }
    }

    /// What the list says under the computer's name.
    public var detailKey: String {
        switch self {
        case .mac: "mac.modes.mac"
        case .windows: "type.rdp"
        case .linux: "type.wlshare"
        case .vnc: "mac.kind.vnc"
        }
    }

    /// The port a computer of this kind listens on unless told otherwise.
    public var port: Int {
        self == .windows ? 3389 : 5900
    }
}

/// A line of the Computers pane: a computer, which is one entry of the settings
/// or, for a Mac at one address in both of its modes, two.
public struct ComputerRow: Sendable, Equatable, Identifiable {
    public var name: String
    public var kind: ComputerKind
    /// A Mac in the one mode the list does not offer to add, kept as it is.
    public var compatible: Bool
    public var host: String
    public var port: Int
    public var username: String
    public var hasPassword: Bool
    /// The names its entries have in the settings: what the gateway finds them by.
    public var entries: [String]
    /// The mode each of a Mac's entries is in, as the settings write it, in the
    /// order of `entries`.
    public var modes: [String] = []
    /// It opens with two displays, the second in a browser tab of its own: what
    /// the settings say of a Windows host, and of a Mac's entry in the Virtual mode.
    public var twoDisplays = false

    public var id: String { entries.joined(separator: "\n") }

    /// The name of its entry in `mode`, where it has one.
    func entry(in mode: String) -> String? {
        zip(entries, modes).first { $0.1 == mode }?.0
    }

    /// It is this Mac: its screen is the one Screen Sharing shares here.
    public var isThisMac: Bool {
        kind == .mac && port == 5900 && ["127.0.0.1", "localhost", "::1"].contains(host)
    }

    /// What the list says under the name.
    public var detailKey: String {
        compatible ? "mac.mode.compatible" : kind.detailKey
    }

    /// What marks the line of this Mac.
    public static let thisMacKey = "mac.computers.this"
}

public enum Computers {
    static let virtual = "ard-high-performance"
    static let mirrored = "ard-mirror"
    static let compatible = "ard"
    /// What the settings write for a computer that opens with two displays.
    static let twoDisplaysWritten = 2

    /// What stands between the words of a name.
    private static func separates(_ character: Character) -> Bool {
        character.isWhitespace || character == "-" || character == "_" || character == "."
    }

    /// The name two entries of one Mac share: what both begin with, up to the end
    /// of a word, without the separator after it; the first one's where they
    /// share no whole word. The page calls the line the same
    /// (`sharedName`, frontend/src/targetChoices.ts).
    public static func sharedName(_ first: String, _ second: String) -> String {
        let (a, b) = (Array(first), Array(second))
        var length = 0
        while length < a.count, length < b.count, a[length] == b[length] {
            length += 1
        }
        func whole(_ name: [Character]) -> Bool {
            length == name.count || separates(name[length])
        }
        while length > 0, !(whole(a) && whole(b)), !separates(a[length - 1]) {
            length -= 1
        }
        var shared = Array(a[..<length])
        while let last = shared.last, separates(last) {
            shared.removeLast()
        }
        return shared.isEmpty ? first : String(shared)
    }

    /// The mode a Mac's other entry is in, for one in either of the two.
    private static func otherMode(_ subtype: String?) -> String? {
        switch subtype {
        case virtual: mirrored
        case mirrored: virtual
        default: nil
        }
    }

    private static func kind(of computer: ShownComputer) -> ComputerKind {
        if computer.kind == "rdp" {
            return .windows
        }
        switch computer.subtype {
        case virtual, mirrored, compatible: return .mac
        case "wlshare": return .linux
        default: return .vnc
        }
    }

    /// The lines of the pane for what the settings list, in their order: two
    /// entries of a Mac at one address and port, one in each mode, are one line,
    /// where the first of them stands, as on the page.
    public static func rows(_ shown: [ShownComputer]) -> [ComputerRow] {
        var taken = Set<Int>()
        var rows: [ComputerRow] = []
        for (place, computer) in shown.enumerated() where !taken.contains(place) {
            taken.insert(place)
            let kind = kind(of: computer)
            let port = computer.port ?? kind.port
            var name = computer.name
            var entries = [computer.name]
            var modes = kind == .mac ? [computer.subtype ?? ""] : []
            var hasPassword = computer.hasPassword
            // A Mac's is its Virtual entry's: the Mirrored one opens the Mac's own.
            var twoDisplays = computer.virtualDisplays == twoDisplaysWritten && computer.subtype != mirrored
            if let other = otherMode(computer.subtype),
               let pair = shown.indices.first(where: { index in
                   let candidate = shown[index]
                   let samePlace = candidate.host == computer.host && (candidate.port ?? kind.port) == port
                   return !taken.contains(index) && candidate.subtype == other && samePlace
               }) {
                taken.insert(pair)
                // The virtual one first, whichever stands first in the settings.
                let (first, second) = computer.subtype == virtual ? (computer, shown[pair]) : (shown[pair], computer)
                name = sharedName(computer.name, shown[pair].name)
                entries = [first.name, second.name]
                modes = [virtual, mirrored]
                hasPassword = first.hasPassword && second.hasPassword
                twoDisplays = first.virtualDisplays == twoDisplaysWritten
            }
            rows.append(ComputerRow(
                name: name,
                kind: kind,
                compatible: computer.subtype == compatible,
                host: computer.host,
                port: port,
                username: computer.username ?? "",
                hasPassword: hasPassword,
                entries: entries,
                modes: modes,
                twoDisplays: twoDisplays
            ))
        }
        return rows
    }

    /// An entry of the settings as it is: written by its name alone, so that
    /// every key it has stays, the ones the app does not know among them.
    private static func kept(_ entry: ShownComputer) -> ChangedComputer {
        var kept = ChangedComputer(name: entry.name, kind: entry.kind, subtype: entry.subtype, host: entry.host,
                                   port: entry.port ?? kind(of: entry).port, username: entry.username)
        kept.untouched = true
        return kept
    }

    /// The whole list as a change writes it, with `written` where `row` stood:
    /// at the place of the first of its entries, the others of it left out. What
    /// nobody touched is written as it is.
    private static func list(_ shown: [ShownComputer], with written: [ChangedComputer], inPlaceOf row: ComputerRow) -> [ChangedComputer] {
        var placed = false
        return shown.flatMap { entry -> [ChangedComputer] in
            guard row.entries.contains(entry.name) else { return [kept(entry)] }
            defer { placed = true }
            return placed ? [] : written
        }
    }

    /// The list with `draft` saved: in the place of `row`, the line it edits, or
    /// at the end, where it is a computer added.
    public static func saving(_ draft: ComputerDraft, editing row: ComputerRow?, in shown: [ShownComputer]) -> [ChangedComputer] {
        var draft = draft
        draft.name = draft.name.trimmingCharacters(in: .whitespaces)
        draft.host = draft.host.trimmingCharacters(in: .whitespaces)
        guard let row else {
            return shown.map(kept) + draft.entries()
        }
        return list(shown, with: draft.entries(editing: row), inPlaceOf: row)
    }

    /// The list without `row`: left out of it, its entries are removed.
    public static func removing(_ row: ComputerRow, from shown: [ShownComputer]) -> [ChangedComputer] {
        list(shown, with: [], inPlaceOf: row)
    }
}

extension ComputerRow {
    /// Whether a password left blank in `draft` is one the gateway has for every
    /// entry the draft writes: the same kind of computer, and for a Mac both of
    /// its modes there already. A Mac the settings list in one mode gains the
    /// other on being saved, which has no password to keep.
    public func keepsPassword(for draft: ComputerDraft) -> Bool {
        guard hasPassword, kind == draft.kind else { return false }
        return kind != .mac || compatible || entries.count == 2
    }
}

/// A computer as the sheet edits it.
public struct ComputerDraft: Sendable, Equatable {
    public var name: String
    public var kind: ComputerKind
    public var host: String
    /// As typed.
    public var port: String
    public var username: String
    /// Left empty, the password the gateway has stays.
    public var password: String
    /// It opens with two displays, the second in a browser tab of its own.
    public var twoDisplays: Bool

    public init(name: String = "", kind: ComputerKind = .mac, host: String = "", port: String? = nil,
                username: String = "", password: String = "", twoDisplays: Bool = false) {
        self.name = name
        self.kind = kind
        self.host = host
        self.port = port ?? String(kind.port)
        self.username = username
        self.password = password
        self.twoDisplays = twoDisplays
    }

    public init(_ row: ComputerRow) {
        self.init(name: row.name, kind: row.kind, host: row.host, port: String(row.port), username: row.username,
                  twoDisplays: row.twoDisplays)
    }

    /// Whether this computer can open with two displays: a Windows host, and a
    /// Mac, in its Virtual mode. A Mac kept in the mode the list does not offer
    /// to add has no Virtual mode to open them in. `row` is the line being edited.
    public func offersTwoDisplays(editing row: ComputerRow? = nil) -> Bool {
        switch kind {
        case .windows: true
        case .mac: !(row?.compatible ?? false)
        case .linux, .vnc: false
        }
    }

    /// The entries of the settings this computer is: one, or for a Mac the two
    /// the page shows as one line with both modes. `row` is the line being
    /// edited, whose entries keep their passwords, and their names where nobody
    /// renamed the computer.
    ///
    /// A computer that became one of another kind is another computer in the
    /// old one's place: its entries keep nothing of the old ones, whose password
    /// was another account's.
    public func entries(editing row: ComputerRow? = nil) -> [ChangedComputer] {
        let port = Int(port) ?? kind.port
        let password = password.isEmpty ? nil : password
        let username = username.isEmpty ? nil : username
        let another = row.map { $0.kind != kind } ?? false
        // Written only in the entry that takes it: a Windows host's, and a Mac's
        // in the Virtual mode. Everywhere else the key is taken away.
        let two = twoDisplays && offersTwoDisplays(editing: row) ? Computers.twoDisplaysWritten : nil
        func entry(_ name: String, was: String?, kind: String, subtype: String?) -> ChangedComputer {
            let takesTwo = kind == "rdp" || subtype == Computers.virtual
            var entry = ChangedComputer(name: name, was: was == name ? nil : was, kind: kind, subtype: subtype, host: host,
                                        port: port, username: username, password: password,
                                        virtualDisplays: takesTwo ? two : nil)
            entry.fresh = another
            return entry
        }
        switch kind {
        case .mac:
            if let row, row.compatible {
                return [entry(name, was: row.entries.first, kind: "vnc", subtype: Computers.compatible)]
            }
            // Each mode's entry is the one the line has in that mode, under the
            // name it has, or under the computer's new one where it was renamed;
            // a mode the line does not have yet is an entry added.
            let renamed = row?.name != name
            func mode(_ subtype: String, _ word: String) -> ChangedComputer {
                let had = another ? nil : row?.entry(in: subtype)
                if let had, !renamed {
                    return entry(had, was: nil, kind: "vnc", subtype: subtype)
                }
                return entry("\(name) \(word)", was: had, kind: "vnc", subtype: subtype)
            }
            return [mode(Computers.virtual, "virtual"), mode(Computers.mirrored, "mirrored")]
        case .windows:
            return [entry(name, was: row?.entries.first, kind: "rdp", subtype: nil)]
        case .linux:
            return [entry(name, was: row?.entries.first, kind: "vnc", subtype: "wlshare")]
        case .vnc:
            return [entry(name, was: row?.entries.first, kind: "vnc", subtype: nil)]
        }
    }
}

/// What the computer's sheet refuses, beside the field it is about.
public enum ComputerFault: Sendable, Equatable {
    case noName
    case nameTaken(String)
    case noHost
    case badPort
    case macNeedsAccount

    /// The catalogue's code.
    public var code: String {
        switch self {
        case .noName: "AL-1401"
        case .nameTaken: "AL-1402"
        case .noHost: "AL-1403"
        case .badPort: "AL-1404"
        case .macNeedsAccount: "AL-1405"
        }
    }

    public var fill: [String: String] {
        if case .nameTaken(let name) = self {
            return ["name": name]
        }
        return [:]
    }

    /// The refusal as it is said beside its field.
    public func message(_ words: Words) -> Message? {
        words.message(code, fill) ?? words.message("AL-1400")
    }

    /// The first thing wrong with `draft`, or `nil`. `others` are the names of
    /// the list's other lines, and `stored` whether the gateway already holds a
    /// password for this one.
    public static func of(_ draft: ComputerDraft, others: [String], stored: Bool) -> ComputerFault? {
        let name = draft.name.trimmingCharacters(in: .whitespaces)
        if name.isEmpty {
            return .noName
        }
        if others.contains(where: { $0.compare(name, options: .caseInsensitive) == .orderedSame }) {
            return .nameTaken(name)
        }
        if draft.host.trimmingCharacters(in: .whitespaces).isEmpty {
            return .noHost
        }
        guard let port = Int(draft.port), (1...65535).contains(port) else {
            return .badPort
        }
        if draft.kind == .mac, draft.username.isEmpty || (draft.password.isEmpty && !stored) {
            return .macNeedsAccount
        }
        return nil
    }
}

/// What the sheet that changes the page's password refuses.
public enum PasswordFault: Sendable, Equatable {
    case noUser
    case colonInUser
    case empty
    case differ

    public var code: String {
        switch self {
        case .noUser: "AL-1501"
        case .colonInUser: "AL-1502"
        case .empty: "AL-1503"
        case .differ: "AL-1504"
        }
    }

    /// The refusal as it is said beside its field.
    public func message(_ words: Words) -> Message? {
        words.message(code) ?? words.message("AL-1500")
    }

    public static func of(user: String, password: String, again: String) -> PasswordFault? {
        if user.isEmpty {
            return .noUser
        }
        // The gateway keeps the login as `user:hash`.
        if user.contains(":") {
            return .colonInUser
        }
        if password.isEmpty {
            return .empty
        }
        return password == again ? nil : .differ
    }
}

/// The sheets' own words, which the mockup of the new pieces drew.
public enum SheetText {
    public static let computer = [
        "mac.computer.add", "mac.computer.add.note", "mac.computer.edit", "mac.field.name", "mac.field.kind", "mac.field.host", "mac.port",
        "signin.user", "signin.password", "signin.show", "mac.computer.kept", "mac.field.two", "mac.computer.two.note",
        "mac.computer.two.mac", "mac.computer.note.mac", "mac.computer.note.this", "mac.save", "common.cancel",
        "mac.computer.remove",
    ]
    public static let removal = ["mac.computer.remove.title", "mac.computer.remove.body", "mac.computer.remove", "common.cancel"]
    public static let password = [
        "mac.password.title", "signin.user", "mac.password.new", "mac.password.again", "mac.password.note",
        "mac.change.do", "common.cancel",
    ]
}
