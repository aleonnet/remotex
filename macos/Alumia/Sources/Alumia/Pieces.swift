// The pieces the windows share: the notice, a state with its mark, a group of
// rows, an address with Copy beside it, a password with its eye, what a field was
// refused, the app's icon, and the ways in.
//
// They are the system's own controls and materials, laid out as the mockup lays
// them out. What is asked of macOS 26 and 27 by name, glass and the shape of a
// button, is in Glass.swift.

import AlumiaCore
import SwiftUI

extension Color {
    init(_ colour: BrandColour) {
        self.init(.sRGB, red: colour.red, green: colour.green, blue: colour.blue)
    }
}

/// The app's icon, drawn: the three bars on the unlit glass.
struct AppIcon: View {
    var side: CGFloat = 52

    var body: some View {
        HStack(spacing: side * 0.08) {
            ForEach(0..<3, id: \.self) { bar in
                RoundedRectangle(cornerRadius: side * 0.035)
                    .fill(Color(Brand.bars[bar]))
                    .frame(width: side * 0.13, height: side * 0.5)
            }
        }
        .frame(width: side, height: side)
        .background(Color(Brand.glass), in: RoundedRectangle(cornerRadius: side * 0.22, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// A state: a mark and a word. A ring while it is off, a full mark when it
/// works, and the warning's colour when it needs its owner.
struct StateMark: View {
    enum Kind {
        case off, ok, warning
    }

    var kind: Kind
    var text: String

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .strokeBorder(kind == .off ? Color.secondary : .clear, lineWidth: 1.5)
                .background(Circle().fill(kind == .ok ? Color.green : kind == .warning ? Color.orange : .clear))
                .frame(width: 8, height: 8)
            Text(text).fontWeight(.medium)
        }
        .accessibilityElement(children: .combine)
    }
}

/// What something is, with a line under it that says more.
struct What: View {
    var title: String
    var note: String?
    var strong = false

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).fontWeight(strong ? .semibold : .regular)
            if let note {
                Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// A group of rows outside a `Form`, as a form's own groups are.
struct Rows<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            content
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: Profile.current.groupCorner, style: .continuous))
    }
}

/// What a command says, or would be run: a line to read, on the ground a copied
/// line has.
struct SaidLine<Over: View>: View {
    var text: String?
    @ViewBuilder var over: Over

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            over
            if let text {
                Text(text)
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// What a sheet refused, under its form: the sentence, and the code to quote.
struct RefusalLine: View {
    var refusal: Refusal

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.circle").foregroundStyle(.red)
            (Text(refusal.says).foregroundStyle(.red) + Text(verbatim: "  ") + Text(refusal.code).font(.caption).foregroundStyle(.secondary))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.callout)
        .accessibilityElement(children: .combine)
    }
}

/// An address or a command, to be read and copied whole.
struct CopyLine: View {
    var text: String
    var copy: String
    var monospaced = true

    var body: some View {
        HStack(spacing: 8) {
            Text(text)
                .font(monospaced ? .system(.callout, design: .monospaced) : .headline)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                Opening.copy(text)
            } label: {
                Label(copy, systemImage: "doc.on.doc")
            }
        }
        .padding(.leading, 10)
        .padding(3)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// Every field of a form has one width, so they share a left edge and a right one.
let fieldWidth: CGFloat = 240

/// A row of a form outside a `Form`: what it is on the left, its control on the
/// right.
struct FieldRow<Content: View>: View {
    var label: String
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 14) {
            Text(label)
            Spacer(minLength: 8)
            content
        }
    }
}

/// A line of text to type, as wide as every other field.
struct PlainField: View {
    var label: String
    @Binding var text: String

    var body: some View {
        TextField(label, text: $text)
            .labelsHidden()
            .textFieldStyle(.roundedBorder)
            .autocorrectionDisabled()
            .frame(width: fieldWidth)
            .accessibilityLabel(label)
    }
}

/// A password, with the eye that shows it inside the field: the field is as wide
/// as the others with it.
struct SecretField: View {
    var label: String
    var show: String
    @Binding var text: String
    @State private var shown = false

    var body: some View {
        Group {
            if shown {
                TextField(label, text: $text)
            } else {
                SecureField(label, text: $text)
            }
        }
        .labelsHidden()
        .textFieldStyle(.roundedBorder)
        .frame(width: fieldWidth)
        .accessibilityLabel(label)
        .overlay(alignment: .trailing) {
            Button {
                shown.toggle()
            } label: {
                Image(systemName: shown ? "eye.slash" : "eye")
            }
            .buttonStyle(.borderless)
            .padding(.trailing, 6)
            .help(show)
            .accessibilityLabel(show)
        }
    }
}

/// The notice: one strip, one button.
struct NoticeStrip: View {
    @ObservedObject var model: AppModel

    var body: some View {
        if let notice = model.notice, let message = notice.message(model.words) {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 1) {
                    Text(message.text).fixedSize(horizontal: false, vertical: true)
                    Text(message.code).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let button = message.button {
                    Button(button) {
                        model.resolve(notice.action)
                    }
                    .buttonOnGlass()
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .noticeGround(.orange)
            .accessibilityElement(children: .contain)
        }
    }
}

/// The three ways in, as the first run and the settings both list them.
struct WaysList: View {
    @ObservedObject var model: AppModel
    /// The group's title, where it has one: the settings give it one, and the
    /// first run's step is already its title.
    var title: String?

    private var kind: StateMark.Kind {
        switch model.tailscale {
        case .missing, .ready, .unread: .off
        case .signedOut, .noHTTPS, .taken: .warning
        case .published: .ok
        }
    }

    var body: some View {
        let ways = model.ways
        let row = ways.tailscale
        Section {
            VStack(alignment: .leading, spacing: 6) {
                What(title: model.say(Ways.hereKey), note: model.say(Ways.hereNoteKey), strong: true)
                CopyLine(text: ways.here, copy: model.say("common.copy"))
            }
            VStack(alignment: .leading, spacing: 6) {
                What(title: model.say(Ways.tailscaleKey), note: row.note(model.words), strong: true)
                HStack(spacing: 12) {
                    StateMark(kind: kind, text: model.say(row.stateKey))
                    if let address = row.address {
                        Text(address).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                    }
                    Spacer(minLength: 8)
                    // Nobody publishes by a button: a state has one where it
                    // takes its owner to resolve it, the published one has Copy,
                    // and what the app does by itself has none.
                    if let act = row.actKey {
                        Button(model.say(act)) {
                            model.actOnTailscale()
                        }
                    } else if row.address != nil {
                        Button {
                            model.actOnTailscale()
                        } label: {
                            Label(model.say("common.copy"), systemImage: "doc.on.doc")
                        }
                    }
                }
            }
            HStack {
                What(title: model.say(Ways.lanKey), note: model.say(Ways.lanNoteKey), strong: true)
                Spacer(minLength: 8)
                StateMark(kind: .off, text: model.say(Ways.lanStateKey))
            }
        } header: {
            if let title {
                Text(title)
            }
        }
    }
}
