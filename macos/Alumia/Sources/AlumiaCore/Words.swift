// What the app says, in the language its owner chose.
//
// The texts are docs/design/words.json's, word for word, and the messages are the
// catalogue's: tools/app-words.py writes both into Generated/Words.generated.swift, and holds
// this package to them (a key nothing says, a key that is not there, a text typed
// into a screen). The app carries its own dictionary, as the page does, because
// Apple gives an app no supported way to change its own language, and the mockup
// has a picker for it (docs/research/2026-10-05-0030-app-de-mac.md, "Idioma do app").

import Foundation

/// A language every text is in.
public enum Language: String, Sendable, CaseIterable, Codable {
    case portuguese = "pt-BR"
    case english = "en-US"

    /// The language a list of preferred languages asks for, as the system gives
    /// it (`Locale.preferredLanguages`): the first one decides, Portuguese where
    /// it is Portuguese of any country, English for anything else.
    public static func preferred(_ languages: [String]) -> Language {
        let first = languages.first?.lowercased() ?? ""
        let language = first.split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init)
        return language == "pt" ? .portuguese : .english
    }
}

/// What the settings' Language picker holds.
public enum LanguageChoice: String, Sendable, CaseIterable, Codable {
    case system
    case portuguese = "pt-BR"
    case english = "en-US"

    public func language(preferred: [String]) -> Language {
        switch self {
        case .system: Language.preferred(preferred)
        case .portuguese: .portuguese
        case .english: .english
        }
    }

    /// The text of the choice in the picker. A language is named in itself.
    public var key: String {
        switch self {
        case .system: "mac.system"
        case .portuguese: "mac.lang.portuguese"
        case .english: "mac.lang.english"
        }
    }
}

/// How bad a message of the catalogue is.
public enum Severity: String, Sendable, Codable {
    case info, warning, error
}

/// A message of the catalogue, said: its code, its sentence, and the title of
/// the button that resolves it where it has one.
public struct Message: Sendable, Equatable {
    public var code: String
    public var severity: Severity
    /// Whether whoever reads it has something to do.
    public var userAction: Bool
    public var text: String
    public var button: String?
}

/// The dictionary and the catalogue, in one language.
public struct Words: Sendable, Equatable {
    public let language: Language

    public init(_ language: Language) {
        self.language = language
    }

    private var index: Int { language == .portuguese ? 0 : 1 }

    private static func filled(_ text: String, _ fill: [String: String]) -> String {
        fill.reduce(text) { said, hole in said.replacingOccurrences(of: "{\(hole.key)}", with: hole.value) }
    }

    /// The text of `key`, with `fill` in its places. A key the dictionary lacks is
    /// said as the key: tools/app-words.py fails on one before anybody reads it.
    public func say(_ key: String, _ fill: [String: String] = [:]) -> String {
        guard let texts = Generated.texts[key] else { return key }
        return Self.filled(texts[index], fill)
    }

    /// The catalogue's message for `code`, with `fill` in its places.
    public func message(_ code: String, _ fill: [String: String] = [:]) -> Message? {
        guard let entry = Generated.messages[code] else { return nil }
        return Message(
            code: code,
            severity: Severity(rawValue: entry.severity) ?? .error,
            userAction: entry.userAction,
            text: Self.filled(entry.text[index], fill),
            button: entry.button.map { $0[index] }
        )
    }

    /// Every key the dictionary has, and every code of the app's.
    public static var keys: [String] { Generated.texts.keys.sorted() }
    public static var codes: [String] { Generated.messages.keys.sorted() }
}

/// A message of the catalogue as the generated file writes it.
struct GeneratedMessage: Sendable {
    var severity: String
    var userAction: Bool
    var text: [String]
    var button: [String]?
}
