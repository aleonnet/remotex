import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Glyph } from "./Glyph.tsx";
import { usePreferences } from "./preferences.tsx";
import {
  type ClipboardSnapshot,
  MAX_CLIPBOARD_BYTES,
  type RemoteClipboard,
} from "./protocol.ts";
import { Sheet } from "./Sheet.tsx";
import type { Code } from "./words.ts";

// The remote's clipboard, in its two directions, each with a button of its own.
//
// From the remote computer to here: the sheet opens asking the remote for what
// it holds, says so while it waits, and then shows the text as it is, in a box
// that is no field, so that nothing on a phone brings the keyboard up; under it
// how much there is, and "Copy to this device", which writes this browser's
// clipboard inside the press. From here to the remote: "Send what I copied
// here", which reads this browser's clipboard inside the press, the one way a
// browser that reads the clipboard only on a gesture lets a page have it
// (clipboardGesture.ts), and sends it in the same act; and "Write…", which is the
// one thing that opens a field, with the focus, for whoever wants to type. Closing
// the sheet throws all of it away. The text is alumia's snapshot from the fetch,
// and nothing here keeps it. The sheet is the same on every device; drawn and
// approved in docs/mockups/2026-10-10-0030-folha-area-de-transferencia-no-celular.html.
//
// Copy says what it came to beside itself, Send and Send what I copied here
// beside themselves, in the catalogue's words (docs/design/errors.json, AL-6300).

const encoder = new TextEncoder();

/** How long what Send or Copy came to stays said. */
const SAID_MS = 4000;

/** A size in bytes as a person reads it, in the page's language. */
function sized(bytes: number, language: string): string {
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString(language, { maximumFractionDigits: digits })} ${units[unit]}`;
}

/** What a button came to, said beside it for a while. */
function useSaid(): [Code | null, (code: Code) => void] {
  const [said, setSaid] = useState<Code | null>(null);
  useEffect(() => {
    if (said === null) {
      return;
    }
    const timer = setTimeout(() => setSaid(null), SAID_MS);
    return () => clearTimeout(timer);
  }, [said]);
  return [said, setSaid];
}

/**
 * From the remote computer to here: the text as it is, in a box that is no
 * field, how much there is, and Copy. A text refused for its size is its size
 * and the catalogue's word, and Copy says so.
 */
function RemoteText({
  text,
  oversized,
  copied,
  onCopy,
}: {
  text: string;
  /** The size the remote's clipboard was refused at, or null. */
  oversized: number | null;
  copied: Code | null;
  onCopy: () => void;
}) {
  const { t, message, language } = usePreferences();
  return (
    <>
      <div className="al-field">
        <span className="al-fieldname">{t("clipboard.remote")}</span>
        {/* Selectable and no field: nothing here takes the focus or brings a
            phone's keyboard up. A section named for whoever cannot see it. */}
        <section
          className="al-input al-textarea al-read"
          aria-label={t("clipboard.remote")}
        >
          {oversized === null
            ? text
            : t("clipboard.meta.large", { size: sized(oversized, language) })}
        </section>
        {oversized === null ? (
          <span className="al-small">
            {t("clipboard.count", {
              chars: [...text].length.toLocaleString(language),
              lines: text.split("\n").length.toLocaleString(language),
            })}
          </span>
        ) : (
          <span className="al-small">{message("AL-6000")}</span>
        )}
      </div>
      <div className="al-formrow">
        <button
          type="button"
          className="al-btn al-btn--primary"
          onClick={onCopy}
        >
          <Glyph name="copy" />
          <span>{t("clipboard.copyhere")}</span>
        </button>
        <output className="al-small">
          {copied && message("AL-6300", copied)}
        </output>
      </div>
      <hr className="al-rule" />
    </>
  );
}

export function ClipboardPanel({
  remoteClipboard,
  onFetch,
  onSend,
  onClose,
}: {
  /** The last answer from the remote, or null before one. */
  remoteClipboard: RemoteClipboard | null;
  /** Asks the remote for what it holds; resolves when it answers, or does not. */
  onFetch: () => Promise<ClipboardSnapshot | null>;
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const { t, message, language } = usePreferences();
  const [fetching, setFetching] = useState(true);
  const [text, setText] = useState("");
  // Whether the field is up: asked for by Write…, or by a read this browser
  // refused, which leaves pasting by hand.
  const [writing, setWriting] = useState(false);
  const [copied, setCopied] = useSaid();
  const [said, setSaid] = useSaid();
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();

  // Asked once, when the sheet opens: it then shows what the remote holds now,
  // and not whatever arrived last, which for a browser that attached mid-session
  // is nothing at all.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on opening
  useEffect(() => {
    let closed = false;
    void onFetch().finally(() => {
      if (!closed) {
        setFetching(false);
      }
    });
    return () => {
      closed = true;
    };
  }, []);

  // The remote's clipboard was refused for its size, so there is nothing to
  // show or copy — only the size to report. Kept distinct from an empty
  // clipboard, which is what a truncating transfer would have looked like.
  const oversized = remoteClipboard?.oversizedBytes ?? null;
  // A plain VNC server that has shown no clipboard at all. Said for as long as
  // that holds: it bears on sending as much as on what is shown.
  const unconfirmed = remoteClipboard?.unconfirmed ?? false;
  const bytes = encoder.encode(text).byteLength;
  const overLimit = bytes > MAX_CLIPBOARD_BYTES;

  // Only a field that was asked for gets the focus, and the keyboard with it.
  useEffect(() => {
    if (writing) {
      field.current?.focus();
    }
  }, [writing]);

  const write = useCallback(() => {
    setWriting(true);
  }, []);

  const send = useCallback(() => {
    // The remote takes ownership of whatever arrives, so an empty send would
    // wipe its clipboard rather than leave it alone.
    if (text.length === 0) {
      setSaid("AL-6301");
      return;
    }
    onSend(text);
    // Neither is an acknowledgement — no engine gets one — but only the first
    // has a reason to doubt.
    setSaid(unconfirmed ? "AL-6302" : "AL-6303");
  }, [text, onSend, unconfirmed, setSaid]);

  const copy = useCallback(async () => {
    const copying = oversized === null ? (remoteClipboard?.text ?? "") : "";
    // Writing an empty string is not a no-op: it clears this browser's clipboard.
    // The two reasons there is nothing look the same from here, and only one of
    // them means the remote copied nothing.
    if (copying.length === 0) {
      setCopied(oversized === null ? "AL-6304" : "AL-6305");
      return;
    }
    // One path. `navigator.clipboard` exists here — a secure context is what this
    // client starts on — and this runs inside the Copy button's own press, which is
    // the gesture `writeText` asks for. A refusal is the browser or the person
    // saying no, and the honest answer to that is to say so.
    try {
      await navigator.clipboard.writeText(copying);
      setCopied("AL-6306");
    } catch {
      setCopied("AL-6307");
    }
  }, [remoteClipboard, oversized, setCopied]);

  const sendCopied = useCallback(async () => {
    // Inside the button's own press, which is the gesture `readText` asks for
    // where it asks for one; a browser that reads on a permission reads here
    // too. A refusal is the browser or the person saying no: the field is the
    // way left, to paste into by hand.
    let read: string;
    try {
      read = await navigator.clipboard.readText();
    } catch {
      setSaid("AL-6309");
      setWriting(true);
      return;
    }
    if (read.length === 0) {
      setSaid("AL-6310");
      return;
    }
    // Over the limit it is not sent: it goes to the field, which says the limit
    // and takes it shortened.
    if (encoder.encode(read).byteLength > MAX_CLIPBOARD_BYTES) {
      setText(read);
      setWriting(true);
      return;
    }
    onSend(read);
    setSaid(unconfirmed ? "AL-6302" : "AL-6303");
  }, [onSend, unconfirmed, setSaid]);

  return (
    <Sheet title={t("session.clipboard")} onClose={onClose}>
      {fetching ? (
        <output>{t("clipboard.fetching")}</output>
      ) : (
        <>
          {remoteClipboard !== null && (
            <RemoteText
              text={remoteClipboard.text}
              oversized={oversized}
              copied={copied}
              onCopy={copy}
            />
          )}
          <div className="al-field">
            {writing ? (
              <label htmlFor={fieldId}>{t("clipboard.here")}</label>
            ) : (
              <span className="al-fieldname">{t("clipboard.here")}</span>
            )}
            {writing && (
              <textarea
                ref={field}
                id={fieldId}
                className="al-input al-textarea"
                value={text}
                placeholder={t("clipboard.placeholder")}
                onChange={(event) => setText(event.currentTarget.value)}
                spellCheck={false}
              />
            )}
          </div>
          {unconfirmed && (
            <p className="al-msg al-msg--warning al-small" role="note">
              <Glyph name="triangle-alert" />
              <span>{message("AL-6200")}</span>
            </p>
          )}
          {overLimit && (
            <p className="al-msg al-msg--warning al-small" role="note">
              <Glyph name="triangle-alert" />
              <span>
                {message("AL-6400", undefined, {
                  bytes: bytes.toLocaleString(language),
                  limit: MAX_CLIPBOARD_BYTES.toLocaleString(language),
                })}
              </span>
            </p>
          )}
          <div className="al-formrow">
            {writing ? (
              <button
                type="button"
                className="al-btn al-btn--primary"
                onClick={send}
                disabled={overLimit}
              >
                <Glyph name="send" />
                <span>{t("clipboard.send")}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="al-btn al-btn--primary"
                  onClick={sendCopied}
                >
                  <Glyph name="send" />
                  <span>{t("clipboard.sendcopied")}</span>
                </button>
                <button type="button" className="al-btn" onClick={write}>
                  <Glyph name="keyboard" />
                  <span>{t("clipboard.write")}</span>
                </button>
              </>
            )}
            <output className="al-small">
              {said && message("AL-6300", said)}
            </output>
          </div>
        </>
      )}
    </Sheet>
  );
}
