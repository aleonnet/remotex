// The settings: five panes, each a form of the system's own, with the notice over
// them when the app needs its owner. Where there is glass the panes are chosen
// from a capsule of it under the window's title, in a window that shows what is
// behind it; where there is none, from the system's bar of them, which the
// window makes.
//
// What each pane holds is the approved mockup's, and FFmpeg's seal and the two
// sheets, of a computer and of the page's password, are the pieces drawn after it
// (docs/mockups/2026-10-05-0030-app-de-mac-pecas-novas.html; Sheets.swift).

import AlumiaCore
import SwiftUI

extension Pane {
    /// The pane's symbol, one of the system's own.
    var symbol: String {
        switch self {
        case .general: "gearshape"
        case .computers: "display"
        case .access: "lock"
        case .advanced: "slider.horizontal.3"
        case .about: "info.circle"
        }
    }
}

/// Which pane the settings window shows. It is the window's to say, and what
/// the capsule of panes is drawn from: one capsule for the window's life, so that
/// the mark of the pane on show moves to the next and is not drawn anew.
@MainActor
final class ShownPane: ObservableObject {
    @Published var pane = Pane.general
}

/// The panes, in a capsule of glass: each its symbol over its name, and under the
/// one on show a bubble, the label's colour and faint, that slides to the next
/// when another is pressed, as the house's other Mac app has it. The one on show
/// is the label's colour and heavier, the others the fainter one. As wide each as
/// the widest name in either language needs, so that nothing moves when the
/// language does.
struct PaneTabs: View {
    /// How tall the room is that the window keeps for the capsule under its title.
    static let room: CGFloat = 68

    @ObservedObject var shown: ShownPane
    @ObservedObject var model: AppModel
    var choose: (Pane) -> Void

    @Namespace private var bubble
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Pane.allCases, id: \.self) { pane in
                let on = pane == shown.pane
                Button {
                    choose(pane)
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: pane.symbol).font(.system(size: 17)).frame(height: 20)
                        Text(model.say(pane.key)).font(.system(size: 11, weight: on ? .semibold : .regular))
                    }
                    .foregroundStyle(on ? .primary : .secondary)
                    .frame(width: 104)
                    .padding(.vertical, 6)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .background {
                    if on {
                        Capsule().fill(.primary.opacity(0.14)).matchedGeometryEffect(id: "shown", in: bubble)
                    }
                }
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .capsuleOfGlass()
        .animation(still ? nil : .snappy(duration: 0.3), value: shown.pane)
    }
}

/// One pane, under the notice.
struct PaneView: View {
    var pane: Pane
    @ObservedObject var model: AppModel
    /// In the window that shows what is behind it: on that window's ground,
    /// which goes on under its title and its capsule of panes, while the pane
    /// itself begins where they end, as the system lays out what is under a
    /// title bar. A pane alone, as a picture of one is, is not.
    var windowed = false
    /// Ask before uninstalling, and do it: the window's to show.
    var uninstall: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            NoticeStrip(model: model)
            Form {
                switch pane {
                case .general: GeneralPane(model: model)
                case .computers: ComputersPane(model: model)
                case .access: AccessPane(model: model)
                case .advanced: AdvancedPane(model: model)
                case .about: AboutPane(model: model, uninstall: uninstall)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(windowed ? .hidden : .automatic)
            .frame(height: height)
        }
        .frame(width: 700)
        .buttonsOfTheProfile()
        .windowGround(windowed)
    }

    /// The pane is as tall as it needs, within what the mockup gives it: a form
    /// does not say how tall it is, so each pane does. The notice over it is as
    /// tall as what it says, and the window is the two.
    private var height: CGFloat {
        switch pane {
        case .general: model.ffmpegSeal == nil ? 400 : 470
        case .about: 400
        case .advanced: 460
        case .computers: min(720, max(400, 240 + CGFloat(model.rows.count) * 52))
        case .access: 700
        }
    }
}

private struct GeneralPane: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Section {
            // The same on and stopped the menu has: one state, wherever it is
            // turned.
            Toggle(isOn: Binding(get: { model.running }, set: { model.setRunning($0) })) {
                What(title: model.say("mac.on.label"), note: model.say("mac.on.note"))
            }
            Toggle(isOn: Binding(get: { model.showInBar }, set: { model.set(showInBar: $0) })) {
                What(title: model.say("mac.inbar.label"), note: model.say("mac.inbar.note"))
            }
        }
        Section {
            Picker(model.say("mac.look.label"), selection: Binding(get: { model.look }, set: { model.set(look: $0) })) {
                ForEach(Look.allCases, id: \.self) { look in
                    Text(model.say(look.key)).tag(look)
                }
            }
            Picker(model.say("mac.lang.label"), selection: Binding(get: { model.language }, set: { model.set(language: $0) })) {
                ForEach(LanguageChoice.allCases, id: \.self) { choice in
                    Text(model.say(choice.key)).tag(choice)
                }
            }
        }
        if let seal = model.ffmpegSeal {
            // The seal: it stays for as long as FFmpeg is missing, and its
            // button installs it.
            Section {
                HStack(spacing: 12) {
                    What(title: model.say("mac.ffmpeg.name"), note: model.say(seal.noteKey), strong: true)
                    Spacer(minLength: 8)
                    StateMark(kind: Self.mark(seal), text: model.say(seal.stateKey))
                    if let act = seal.actKey {
                        Button(model.say(act)) {
                            model.pressFFmpeg()
                        }
                    }
                }
            }
        }
    }

    private static func mark(_ seal: FFmpegSeal) -> StateMark.Kind {
        switch seal {
        case .missing: .warning
        case .installing: .off
        case .present: .ok
        }
    }
}

private struct ComputersPane: View {
    /// The sheet over the pane: a line of the list edited, or a computer added.
    private struct Editing: Identifiable {
        var row: ComputerRow?
        var id: String { row?.id ?? "" }
    }

    @ObservedObject var model: AppModel
    @State private var editing: Editing?

    var body: some View {
        Section {
            ForEach(model.rows) { row in
                HStack(spacing: 12) {
                    What(title: row.name, note: model.say(row.detailKey), strong: true)
                    Spacer(minLength: 8)
                    Text(model.say(row.isThisMac ? ComputerRow.thisMacKey : row.kind.key)).foregroundStyle(.secondary)
                    Button(model.say("mac.edit")) {
                        editing = Editing(row: row)
                    }
                }
            }
        } header: {
            // What the list is for, before anything is added to it.
            Text(model.say("mac.computers.what"))
                .font(.callout)
                .foregroundStyle(.secondary)
                .textCase(nil)
                .fixedSize(horizontal: false, vertical: true)
        } footer: {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    editing = Editing(row: nil)
                } label: {
                    Label(model.say("mac.computers.add"), systemImage: "plus")
                }
                Text(model.say("mac.computers.note"))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .sheet(item: $editing) { editing in
            ComputerSheet(model: model, row: editing.row) {
                self.editing = nil
            }
        }
    }
}

private struct AccessPane: View {
    @ObservedObject var model: AppModel
    @State private var changing = false

    var body: some View {
        Section(model.say("mac.access.who")) {
            LabeledContent(model.say("signin.user")) {
                Text(model.shown?.username ?? "").textSelection(.enabled)
            }
            LabeledContent(model.say("signin.password")) {
                HStack(spacing: 12) {
                    Text(verbatim: "••••••••").accessibilityHidden(true)
                    Button(model.say("mac.change")) {
                        changing = true
                    }
                }
            }
        }
        .sheet(isPresented: $changing) {
            PasswordSheet(model: model) {
                changing = false
            }
        }
        Section {
            Toggle(isOn: Binding(get: { model.reachable }, set: { model.set(reachable: $0) })) {
                What(title: model.say("mac.reachable.label"), note: model.say("mac.reachable.note"))
            }
        }
        WaysList(model: model, title: model.say("mac.access.where"))
    }
}

private struct AdvancedPane: View {
    @ObservedObject var model: AppModel
    @State private var port = ""
    @State private var brand = ""
    @State private var refusal: Refusal?

    var body: some View {
        Section {
            LabeledContent(model.say("mac.port")) {
                PlainField(label: model.say("mac.port"), text: $port).onSubmit(savePort)
            }
            LabeledContent(model.say("mac.brand")) {
                PlainField(label: model.say("mac.brand"), text: $brand).onSubmit {
                    change(Change(brand: brand))
                }
            }
            Toggle(isOn: Binding(get: { model.shown?.meter ?? false }, set: { change(Change(meter: $0)) })) {
                What(title: model.say("mac.meter.label"), note: model.say("mac.meter.note"))
            }
            HStack(spacing: 12) {
                What(title: model.say("mac.file.label"), note: model.say("mac.file.note"))
                Spacer(minLength: 8)
                Button(model.say("mac.file.show")) {
                    Opening.reveal(Bundled.folder.appendingPathComponent("alumia.toml"))
                }
            }
            HStack(spacing: 12) {
                What(title: model.say("mac.log.label"), note: model.say("mac.log.note"))
                Spacer(minLength: 8)
                Button(model.say("mac.file.show")) {
                    Opening.revealLog()
                }
            }
        } footer: {
            if let refusal {
                VStack(alignment: .leading, spacing: 1) {
                    Text(refusal.says).fixedSize(horizontal: false, vertical: true)
                    Text(refusal.code).font(.caption).textSelection(.enabled)
                }
                .foregroundStyle(.red)
            }
        }
        .onAppear(perform: read)
        .onChange(of: model.shown) { _, _ in
            if refusal == nil {
                read()
            }
        }
    }

    /// The fields say what the settings say, until somebody types in them.
    private func read() {
        port = String(model.port)
        brand = model.shown?.brand ?? Brand.name
    }

    private func savePort() {
        // What is not a port is the gateway's to refuse, in its own words.
        guard let number = Int(port), number != model.port else { return }
        Task {
            refusal = await model.set(port: number)
        }
    }

    private func change(_ change: Change) {
        Task {
            refusal = await model.apply(change)
        }
    }
}

private struct AboutPane: View {
    @ObservedObject var model: AppModel
    var uninstall: () -> Void

    var body: some View {
        Section {
            HStack(spacing: 14) {
                AppIcon(side: 52)
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: Brand.name).font(.title3.bold())
                    Text(model.say("mac.about.version", ["version": model.status?.version ?? Bundled.version]))
                        .foregroundStyle(.secondary)
                }
            }
        }
        Section(model.say("mac.remove.title")) {
            HStack(spacing: 12) {
                What(title: model.say("mac.remove.label"), note: model.say("mac.remove.cleans"), strong: true)
                Spacer(minLength: 8)
                Button(role: .destructive, action: uninstall) {
                    // In the colour of what deletes, as the mockup has it.
                    Text(model.say("mac.remove.act")).foregroundStyle(.red)
                }
            }
        }
    }
}
