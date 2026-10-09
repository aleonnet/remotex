// The first run: one window, a step a screen, and on its left the glass that
// lights as each part is ready.
//
// Which step comes after which, what each is called, how far each bar is lit and
// when the button that goes on is on are AlumiaCore's `Wizard`. This is the
// window.

import AlumiaCore
import SwiftUI

/// The pane on the left: the three bars on the unlit glass, each lit as far as
/// its part is ready, and the glass itself lit at the end.
private struct GlassPane: View {
    var lit: Lit
    var glassLit: Bool
    var names: [String]

    private var fractions: [Double] { [lit.mac, lit.way, lit.key] }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            HStack(spacing: 14) {
                ForEach(0..<3, id: \.self) { bar in
                    ZStack(alignment: .bottom) {
                        Color(Brand.bars[bar]).opacity(0.16)
                        Color(Brand.bars[bar]).frame(height: 200 * fractions[bar])
                    }
                    .frame(width: 36, height: 200)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                }
            }
            .accessibilityHidden(true)
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(0..<3, id: \.self) { bar in
                    HStack(spacing: 9) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color(Brand.bars[bar]).opacity(0.16 + 0.84 * fractions[bar]))
                            .frame(width: 10, height: 14)
                        Text(names[bar]).font(.callout)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(EdgeInsets(top: 30, leading: 26, bottom: 26, trailing: 26))
        .frame(width: 250)
        .frame(maxHeight: .infinity)
        .foregroundStyle(Color(Brand.onGlass))
        .background {
            ZStack {
                Color(Brand.glass)
                RadialGradient(
                    colors: [Color(Brand.onGlass).opacity(glassLit ? 0.26 : 0), .clear],
                    center: UnitPoint(x: 0.5, y: 0.38),
                    startRadius: 0,
                    endRadius: 330
                )
            }
            .ignoresSafeArea()
        }
        .animation(.easeInOut(duration: 0.45), value: lit)
        .animation(.easeInOut(duration: 0.45), value: glassLit)
    }
}

struct WizardView: View {
    @ObservedObject var model: AppModel
    /// Close the window: the first run is over.
    var finish: () -> Void

    /// The state it opens in: the welcome, but for a picture of another.
    @State var state = WizardState.welcome
    @State private var keep = true
    @State private var accountUser = NSUserName()
    @State private var accountPassword = ""
    @State private var pageUser = NSUserName()
    @State private var pagePassword = ""
    @State private var refusal: Refusal?
    @State private var working = false

    private var wizard: Wizard { Wizard(state) }

    private var facts: WizardFacts {
        WizardFacts(
            screenSharingOn: model.screenSharingOn,
            accountUser: accountUser,
            accountPassword: accountPassword,
            tailscale: model.tailscale,
            pageUser: pageUser,
            pagePassword: pagePassword
        )
    }

    var body: some View {
        HStack(spacing: 0) {
            GlassPane(lit: wizard.lit, glassLit: wizard.glassLit, names: Wizard.barKeys.map { model.say($0) })
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(model.say(wizard.titleKey))
                        .font(.system(size: 24, weight: .bold))
                        .accessibilityAddTraits(.isHeader)
                    Text(model.say(wizard.bodyKey)).fixedSize(horizontal: false, vertical: true)
                    step
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                foot
            }
            .padding(EdgeInsets(top: 36, leading: 32, bottom: 18, trailing: 32))
            // The step stands on what is behind the window where there is glass;
            // the pane beside it is the brand's own dark glass in either profile.
            .windowGround(Profile.current == .glass)
        }
        .frame(width: 820, height: 540)
        .buttonsOfTheProfile()
        // The glass goes to the window's top: the window has no bar of its own.
        .ignoresSafeArea()
        // The way in follows Tailscale while it is the step on screen.
        .onChange(of: model.tailscale) { _, tailscale in
            state = wizard.following(tailscale)
        }
    }

    @ViewBuilder private var step: some View {
        switch wizard.step {
        case .welcome:
            EmptyView()
        case .keep:
            Rows {
                Toggle(isOn: $keep) {
                    What(title: model.say("mac.keep.label"), note: model.say("mac.keep.note"))
                }
                .toggleStyle(.switch)
            }
        case .sharing:
            Rows {
                HStack(spacing: 12) {
                    What(title: model.say("mac.sharing.name"), note: model.say("mac.sharing.where"), strong: true)
                    Spacer(minLength: 8)
                    if model.screenSharingOn {
                        StateMark(kind: .ok, text: model.say("mac.sharing.on"))
                    } else {
                        StateMark(kind: .off, text: model.say("mac.sharing.off"))
                        Button(model.say("mac.open.system")) {
                            Opening.sharingSettings()
                        }
                    }
                }
            }
            Text(model.say("mac.first.sharing.note")).font(.caption).foregroundStyle(.secondary)
        case .account:
            Rows {
                FieldRow(label: model.say("mac.account.user")) {
                    PlainField(label: model.say("mac.account.user"), text: $accountUser)
                }
                Divider()
                FieldRow(label: model.say("signin.password")) {
                    SecretField(label: model.say("signin.password"), show: model.say("signin.show"), text: $accountPassword)
                }
            }
            Text(model.say("mac.account.note")).font(.caption).foregroundStyle(.secondary)
        case .ways:
            Form {
                WaysList(model: model)
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .padding(.horizontal, -20)
        case .password:
            Rows {
                FieldRow(label: model.say("signin.user")) {
                    PlainField(label: model.say("signin.user"), text: $pageUser)
                }
                Divider()
                FieldRow(label: model.say("signin.password")) {
                    SecretField(label: model.say("signin.password"), show: model.say("signin.show"), text: $pagePassword)
                }
            }
            if let refusal {
                // What the gateway refused, in its own words for it, with the
                // code to quote.
                VStack(alignment: .leading, spacing: 1) {
                    Text(refusal.says).fixedSize(horizontal: false, vertical: true)
                    Text(refusal.code).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                }
                .foregroundStyle(.red)
            }
        case .done:
            CopyLine(text: model.ways.address, copy: model.say("mac.copy.address"), monospaced: false)
        }
    }

    private var foot: some View {
        HStack(spacing: 10) {
            if wizard.hasBack {
                Button(model.say(Wizard.backKey)) {
                    refusal = nil
                    state = wizard.previous(facts)
                }
                .disabled(working)
            }
            if let numbered = wizard.numbered(model.words) {
                Text(numbered).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Button(model.say(wizard.forwardKey)) {
                forward()
            }
            .keyboardShortcut(.defaultAction)
            .disabled(working || !wizard.canContinue(facts))
        }
        .frame(minHeight: 28)
    }

    private func forward() {
        switch wizard.step {
        case .password:
            // The settings are written here, at the end, whole: this Mac in both
            // of its modes and the page's login.
            working = true
            let change = FirstRun.change(facts, computerName: Host.current().localizedName ?? "", pagePort: model.port)
            Task {
                refusal = await model.apply(change)
                working = false
                if refusal == nil {
                    // Whoever chose not to keep it running has it set up and
                    // stopped, to be turned on from the menu: there is one on
                    // and one stopped, and this is the same.
                    if !keep {
                        model.setRunning(false)
                    }
                    state = .done
                }
            }
        case .done:
            finish()
        case .welcome, .keep, .sharing, .account, .ways:
            state = wizard.next(facts)
        }
    }
}
