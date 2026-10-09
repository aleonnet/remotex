// The first run, state by state, as the mockup has it: the step each is, how far
// each bar is lit, and whether the button that goes on is on.

import XCTest
@testable import AlumiaCore

final class WizardTests: XCTestCase {
    /// The mockup's own table (`LIT`, in the mockup's script): how far the three
    /// bars are lit in each step.
    private let mockup: [(WizardState, number: Int?, lit: Lit)] = [
        (.welcome, nil, Lit(0, 0, 0)),
        (.keep, 1, Lit(1.0 / 3, 0, 0)),
        (.sharing, 2, Lit(2.0 / 3, 0, 0)),
        (.account, 3, Lit(1, 0, 0)),
        (.waysMissing, 4, Lit(1, 1, 0)),
        (.waysSignedOut, 4, Lit(1, 1, 0)),
        (.waysNoHTTPS, 4, Lit(1, 1, 0)),
        (.ways, 4, Lit(1, 1, 0)),
        (.waysPublished, 4, Lit(1, 1, 0)),
        (.password, 5, Lit(1, 1, 1)),
        (.done, nil, Lit(1, 1, 1)),
    ]

    func testTheElevenStatesAreTheMockups() {
        XCTAssertEqual(mockup.map(\.0), WizardState.allCases)
        XCTAssertEqual(WizardState.allCases.count, 11)
        XCTAssertEqual(
            WizardState.allCases.map(\.rawValue),
            ["welcome", "keep", "sharing", "account", "ways-missing", "ways-signed-out", "ways-no-https", "ways",
             "ways-published", "password", "done"]
        )
    }

    func testEachStateSaysItsStepAndLightsItsBars() {
        for (state, number, lit) in mockup {
            let wizard = Wizard(state)
            XCTAssertEqual(wizard.number, number, state.rawValue)
            XCTAssertEqual(wizard.lit, lit, state.rawValue)
            XCTAssertEqual(wizard.glassLit, state == .done, "the glass is lit at the end, and only there")
            XCTAssertEqual(wizard.numbered(portuguese), number.map { "Passo \($0) de 5" })
            XCTAssertEqual(wizard.numbered(english), number.map { "Step \($0) of 5" })
        }
        XCTAssertEqual(Wizard.counted, 5)
    }

    func testEachStepHasItsWords() {
        for state in WizardState.allCases {
            let wizard = Wizard(state)
            for key in [wizard.titleKey, wizard.bodyKey, wizard.forwardKey] + wizard.detailKeys {
                XCTAssertNotEqual(portuguese.say(key), key, "\(state.rawValue): the dictionary has \(key)")
            }
        }
        XCTAssertEqual(portuguese.say(Wizard(.welcome).titleKey), "A tela deste Mac, em qualquer navegador")
        XCTAssertEqual(portuguese.say(Wizard(.done).titleKey), "A tela está acesa")
        XCTAssertEqual(Wizard.barKeys.map(portuguese.said), ["Este Mac", "O caminho", "A senha da página"])
        XCTAssertEqual(portuguese.say(Wizard(.keep).forwardKey), "Continuar")
        XCTAssertEqual(portuguese.say(Wizard(.done).forwardKey), "Concluir")
        XCTAssertFalse(Wizard(.welcome).hasBack)
        XCTAssertFalse(Wizard(.done).hasBack)
        XCTAssertTrue(Wizard(.sharing).hasBack)
    }

    func testTheStepOfScreenSharingWaitsForIt() {
        let sharing = Wizard(.sharing)
        XCTAssertFalse(sharing.canContinue(WizardFacts(screenSharingOn: false)), "only its owner turns it on")
        XCTAssertTrue(sharing.canContinue(WizardFacts(screenSharingOn: true)), "and the step goes on by itself when they do")
    }

    func testAnAccountAndALoginNeedBothHalves() {
        let account = Wizard(.account)
        XCTAssertFalse(account.canContinue(WizardFacts()))
        XCTAssertFalse(account.canContinue(WizardFacts(accountUser: "ana")))
        XCTAssertFalse(account.canContinue(WizardFacts(accountPassword: "x")))
        XCTAssertTrue(account.canContinue(WizardFacts(accountUser: "ana", accountPassword: "x")))

        let password = Wizard(.password)
        XCTAssertFalse(password.canContinue(WizardFacts()))
        XCTAssertFalse(password.canContinue(WizardFacts(pageUser: "ana")))
        XCTAssertFalse(password.canContinue(WizardFacts(pageUser: "a:b", pagePassword: "x")), "a colon cannot be in the user")
        XCTAssertTrue(password.canContinue(WizardFacts(pageUser: "ana", pagePassword: "x")))
    }

    func testNoWayInHoldsAnybody() {
        // This Mac's own address already works, whatever Tailscale is.
        for state in [WizardState.welcome, .keep, .waysMissing, .waysSignedOut, .waysNoHTTPS, .ways, .waysPublished, .done] {
            XCTAssertTrue(Wizard(state).canContinue(WizardFacts()), state.rawValue)
        }
    }

    func testTheWayInIsTheStateTailscaleIsIn() {
        XCTAssertEqual(Wizard.ways(.missing), .waysMissing)
        XCTAssertEqual(Wizard.ways(.signedOut), .waysSignedOut)
        XCTAssertEqual(Wizard.ways(.noHTTPS), .waysNoHTTPS)
        XCTAssertEqual(Wizard.ways(.ready), .ways)
        XCTAssertEqual(Wizard.ways(.published("https://a.example.ts.net")), .waysPublished)
        // The step follows Tailscale while it is open, and no other step does.
        XCTAssertEqual(Wizard(.waysMissing).following(.ready), .ways)
        XCTAssertEqual(Wizard(.ways).following(.published("https://a.example.ts.net")), .waysPublished)
        XCTAssertEqual(Wizard(.account).following(.ready), .account)
    }

    func testTheStepsGoOnAndBackInOrder() {
        let facts = WizardFacts(tailscale: .ready)
        var state = WizardState.welcome
        var walked = [state]
        while state != .done {
            state = Wizard(state).next(facts)
            walked.append(state)
        }
        XCTAssertEqual(walked, [.welcome, .keep, .sharing, .account, .ways, .password, .done])
        XCTAssertEqual(Wizard(.password).previous(facts), .ways)
        XCTAssertEqual(Wizard(.password).previous(WizardFacts(tailscale: .missing)), .waysMissing)
        XCTAssertEqual(Wizard(.ways).previous(facts), .account)
        XCTAssertEqual(Wizard(.keep).previous(facts), .welcome)
        XCTAssertEqual(Wizard(.done).next(facts), .done)
    }
}
