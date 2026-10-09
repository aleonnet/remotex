// What the first run writes at its end: this Mac as a computer of the list, and
// who signs in to the page.
//
// This Mac is written twice, at its own address, once in each of the two modes a
// Mac is opened in: the page shows two such entries as one line with both modes,
// under the name the Mac gives itself (frontend/src/targetChoices.ts).

import Foundation

public enum FirstRun {
    /// This Mac's own Screen Sharing.
    public static let host = "127.0.0.1"
    public static let port = 5900
    /// Where the page is served unless the settings say otherwise.
    public static let pagePort = 52380

    /// The change that sets a Mac up. `computerName` is what the Mac calls
    /// itself, which its two entries are named from.
    public static func change(_ facts: WizardFacts, computerName: String, pagePort: Int = FirstRun.pagePort) -> Change {
        let name = computerName.trimmingCharacters(in: .whitespaces)
        let draft = ComputerDraft(
            name: name.isEmpty ? "Mac" : name,
            kind: .mac,
            host: host,
            port: String(port),
            username: facts.accountUser,
            password: facts.accountPassword
        )
        return Change(
            listen: "127.0.0.1:\(pagePort)",
            login: Change.Login(username: facts.pageUser, password: facts.pagePassword),
            computers: draft.entries()
        )
    }
}
