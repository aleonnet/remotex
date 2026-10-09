// The sheets that come over the settings: a computer added or edited, the page's
// password changed, and FFmpeg installed.
//
// They are the pieces drawn after the approved mockup
// (docs/mockups/2026-10-05-0030-app-de-mac-pecas-novas.html), and the sheet of a
// computer after the one that gave it its Two displays row
// (docs/mockups/2026-10-07-1254-app-de-mac-duas-telas.html). What each refuses
// before anything is sent, what a saved computer writes and what FFmpeg's sheet
// says in each of its states are AlumiaCore's (Settings.swift, FFmpeg.swift); a
// refusal of the gateway's comes back said, and is shown in the same place.

import AlumiaCore
import SwiftUI

/// A sheet: its title, what it holds, and its buttons at the foot, the one that
/// goes on last.
struct SheetFrame<Content: View, Foot: View>: View {
    var title: String
    @ViewBuilder var content: Content
    @ViewBuilder var foot: Foot

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline).accessibilityAddTraits(.isHeader)
            content
            HStack(spacing: 10) {
                foot
            }
            .frame(minHeight: 28)
        }
        .padding(EdgeInsets(top: 18, leading: 18, bottom: 14, trailing: 18))
        .frame(width: 440)
        .buttonsOfTheProfile()
    }
}

/// A message of the app's own, as the line under a form shows a refusal.
private func refusal(_ message: Message?) -> Refusal? {
    message.map { Refusal(code: $0.code, says: $0.text, detail: "") }
}

/// A computer of the list, added or edited.
struct ComputerSheet: View {
    @ObservedObject var model: AppModel
    /// The line it edits, or `nil` where it adds one.
    var row: ComputerRow?
    var close: () -> Void

    @State private var draft: ComputerDraft
    @State private var refused: Refusal?
    @State private var working = false
    @State private var asking = false

    init(model: AppModel, row: ComputerRow?, close: @escaping () -> Void) {
        self.model = model
        self.row = row
        self.close = close
        _draft = State(initialValue: row.map(ComputerDraft.init) ?? ComputerDraft())
    }

    /// This Mac's name and address are not its owner's to type here.
    private var own: Bool { row?.isThisMac ?? false }

    private var keeps: Bool { row?.keepsPassword(for: draft) ?? false }

    private var noteKey: String? {
        if own {
            return "mac.computer.note.this"
        }
        return draft.kind == .mac ? "mac.computer.note.mac" : nil
    }

    var body: some View {
        SheetFrame(title: row.map { model.say("mac.computer.edit", ["name": $0.name]) } ?? model.say("mac.computer.add")) {
            if row == nil {
                // What adding one is for, before the first field.
                Text(model.say("mac.computer.add.note"))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Rows {
                FieldRow(label: model.say("mac.field.name")) {
                    PlainField(label: model.say("mac.field.name"), text: $draft.name).disabled(own)
                }
                Divider()
                FieldRow(label: model.say("mac.field.kind")) {
                    Picker(model.say("mac.field.kind"), selection: $draft.kind) {
                        ForEach(ComputerKind.allCases, id: \.self) { kind in
                            Text(model.say(kind.key)).tag(kind)
                        }
                    }
                    .labelsHidden()
                    // The left edge the fields have: a picker is as wide as
                    // what it says.
                    .frame(width: fieldWidth, alignment: .leading)
                    .disabled(own)
                }
                Divider()
                FieldRow(label: model.say("mac.field.host")) {
                    PlainField(label: model.say("mac.field.host"), text: $draft.host).disabled(own)
                }
                Divider()
                FieldRow(label: model.say("mac.port")) {
                    PlainField(label: model.say("mac.port"), text: $draft.port).disabled(own)
                }
                Divider()
                FieldRow(label: model.say("signin.user")) {
                    PlainField(label: model.say("signin.user"), text: $draft.username)
                }
                Divider()
                HStack(spacing: 14) {
                    What(title: model.say("signin.password"), note: keeps ? model.say("mac.computer.kept") : nil)
                    Spacer(minLength: 8)
                    SecretField(label: model.say("signin.password"), show: model.say("signin.show"), text: $draft.password)
                }
                if draft.offersTwoDisplays(editing: row) {
                    Divider()
                    HStack(spacing: 14) {
                        What(title: model.say("mac.field.two"),
                             note: model.say(draft.kind == .mac ? "mac.computer.two.mac" : "mac.computer.two.note"))
                        Spacer(minLength: 8)
                        Toggle(model.say("mac.field.two"), isOn: $draft.twoDisplays)
                            .toggleStyle(.switch)
                            .labelsHidden()
                    }
                }
            }
            if let noteKey {
                Text(model.say(noteKey)).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let refused {
                RefusalLine(refusal: refused)
            }
        } foot: {
            if let row, !own {
                Button(role: .destructive) {
                    asking = true
                } label: {
                    Text(model.say("mac.computer.remove")).foregroundStyle(.red)
                }
                .disabled(working)
                .alert(model.say("mac.computer.remove.title", ["name": row.name]), isPresented: $asking) {
                    Button(model.say("mac.computer.remove"), role: .destructive) {
                        send(Computers.removing(row, from: model.shown?.computers ?? []))
                    }
                    Button(model.say("common.cancel"), role: .cancel) {}
                } message: {
                    Text(model.say("mac.computer.remove.body"))
                }
            }
            Spacer(minLength: 8)
            Button(model.say("common.cancel"), action: close)
                .keyboardShortcut(.cancelAction)
                .disabled(working)
            Button(model.say("mac.save"), action: save)
                .keyboardShortcut(.defaultAction)
                .disabled(working)
        }
        // A kind has its own port: changing the kind changes a port nobody typed.
        // And a kind that opens one display only takes the second with it.
        .onChange(of: draft.kind) { _, kind in
            draft.port = String(kind.port)
            if !draft.offersTwoDisplays(editing: row) {
                draft.twoDisplays = false
            }
        }
        .onChange(of: draft) { _, _ in
            refused = nil
        }
    }

    private func save() {
        let others = model.rows.filter { $0.id != row?.id }.map(\.name)
        if let fault = ComputerFault.of(draft, others: others, stored: keeps) {
            refused = refusal(fault.message(model.words))
            return
        }
        send(Computers.saving(draft, editing: row, in: model.shown?.computers ?? []))
    }

    /// The list as it is to be, sent to the gateway, whose own check has the last
    /// word on it.
    private func send(_ computers: [ChangedComputer]) {
        working = true
        Task {
            refused = await model.apply(Change(computers: computers))
            working = false
            if refused == nil {
                close()
            }
        }
    }
}

/// Who signs in to the page, changed.
struct PasswordSheet: View {
    @ObservedObject var model: AppModel
    var close: () -> Void

    @State private var user: String
    @State private var password = ""
    @State private var again = ""
    @State private var refused: Refusal?
    @State private var working = false

    init(model: AppModel, close: @escaping () -> Void) {
        self.model = model
        self.close = close
        _user = State(initialValue: model.shown?.username ?? "")
    }

    var body: some View {
        SheetFrame(title: model.say("mac.password.title")) {
            Rows {
                FieldRow(label: model.say("signin.user")) {
                    PlainField(label: model.say("signin.user"), text: $user)
                }
                Divider()
                FieldRow(label: model.say("mac.password.new")) {
                    SecretField(label: model.say("mac.password.new"), show: model.say("signin.show"), text: $password)
                }
                Divider()
                FieldRow(label: model.say("mac.password.again")) {
                    SecretField(label: model.say("mac.password.again"), show: model.say("signin.show"), text: $again)
                }
            }
            Text(model.say("mac.password.note")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let refused {
                RefusalLine(refusal: refused)
            }
        } foot: {
            Spacer(minLength: 8)
            Button(model.say("common.cancel"), action: close)
                .keyboardShortcut(.cancelAction)
                .disabled(working)
            Button(model.say("mac.change.do"), action: change)
                .keyboardShortcut(.defaultAction)
                .disabled(working)
        }
        .onChange(of: [user, password, again]) { _, _ in
            refused = nil
        }
    }

    private func change() {
        let user = user.trimmingCharacters(in: .whitespaces)
        if let fault = PasswordFault.of(user: user, password: password, again: again) {
            refused = refusal(fault.message(model.words))
            return
        }
        working = true
        Task {
            refused = await model.apply(Change(login: Change.Login(username: user, password: password)))
            working = false
            if refused == nil {
                close()
            }
        }
    }
}

/// FFmpeg's sheet for as long as the model has one to show, and `close` once it
/// has none.
struct FFmpegOver: View {
    @ObservedObject var model: AppModel
    var close: () -> Void

    var body: some View {
        Group {
            if let sheet = model.ffmpegSheet {
                FFmpegSheetView(model: model, sheet: sheet)
            }
        }
        .onChange(of: model.ffmpegSheet == nil) { _, closed in
            if closed {
                close()
            }
        }
    }
}

/// FFmpeg installed: what is about to run, how it goes, and how it ended.
struct FFmpegSheetView: View {
    @ObservedObject var model: AppModel
    /// The sheet as it is shown; the model's own is `nil` once it is closed.
    var sheet: FFmpegSheet

    var body: some View {
        SheetFrame(title: model.say(FFmpegSheet.titleKey)) {
            Text(model.say(sheet.textKey)).fixedSize(horizontal: false, vertical: true)
            if let command = sheet.command {
                SaidLine(text: command) {}
            }
            if case .running = sheet {
                SaidLine(text: sheet.last) {
                    // Homebrew does not say how far it is: the bar says it runs.
                    ProgressView().progressViewStyle(.linear)
                }
            } else if let last = sheet.last {
                SaidLine(text: last) {}
            }
            if let state = sheet.stateKey {
                StateMark(kind: .off, text: model.say(state))
            }
        } foot: {
            Spacer(minLength: 8)
            if let leave = sheet.leaveKey {
                Button(model.say(leave)) {
                    model.closeFFmpeg()
                }
                .keyboardShortcut(.cancelAction)
            }
            Button(model.say(sheet.actKey)) {
                model.goOnWithFFmpeg()
            }
            .keyboardShortcut(.defaultAction)
        }
    }
}
