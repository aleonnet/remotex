import { type ReactNode, useState } from "react";
import { fillOf, type Told } from "./fault.ts";
import { Glyph } from "./Glyph.tsx";
import { lookOf } from "./Message.tsx";
import { usePreferences } from "./preferences.tsx";
import type { Code } from "./words.ts";

// The app's notice: one strip of glass pinned at the top, over whatever it
// interrupted, for something that went wrong and that somebody can do something
// about. It says what happened in the catalogue's words, the cause's where the
// catalogue knows it, offers at most one thing to do, and keeps the rest behind
// "Details": the code to quote and the original text of the cause, to copy. The
// original text is whoever failed's own, in whatever language they speak, and is
// never part of the sentence.
//
// It is announced to a screen reader without taking the focus, and it does not go
// away by itself: whoever shows it takes it down when what it says stops being so.

/**
 * What a notice keeps behind "Details": the code to quote and, where whoever
 * failed said something of their own, those words as they came, with a Copy for
 * both. The same under every notice, the strip over the remote screen included.
 */
export function Details({ code, detail }: { code: Code; detail?: string }) {
  const { t, message } = usePreferences();
  // What the last Copy came to, said beside the button in the words the
  // clipboard's own messages have: copied, or refused.
  const [copied, setCopied] = useState<Code | null>(null);

  const copy = () => {
    navigator.clipboard.writeText(`${code} ${detail ?? ""}`.trim()).then(
      () => setCopied("AL-6306"),
      () => setCopied("AL-6307"),
    );
  };

  return (
    <details className="al-details">
      <summary>
        <Glyph name="chevron-right" />
        <span>{t("common.details")}</span>
      </summary>
      <div className="al-detailbody">
        <span>
          <span>{t("common.code")}</span> <span>{code}</span>
        </span>
        {detail && (
          <span>
            <span>{t("common.original")}</span> <span>{detail}</span>
          </span>
        )}
        <span>
          <button type="button" className="al-btn al-btn--quiet" onClick={copy}>
            <Glyph name="copy" />
            <span>{t("common.copy")}</span>
          </button>{" "}
          <output>{copied && message("AL-6300", copied)}</output>
        </span>
      </div>
    </details>
  );
}

export function Notice({
  place,
  told,
  act,
}: {
  /** The general code of what the notice is about. */
  place: Code;
  /** What went wrong: the cause, or only the words of whoever reported it. */
  told: Told;
  /** The one thing to do about it, as a button. */
  act?: ReactNode;
}) {
  const { message } = usePreferences();
  const code = told.code ?? place;
  const look = lookOf(code);

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <output> takes phrasing content only, and this holds a disclosure
    <div className="al-notice al-glass" role="status">
      <div className={`al-noticerow al-msg${look.tone}`}>
        <Glyph name={look.glyph} />
        <p>{message(place, told.code, fillOf(told))}</p>
        {act}
      </div>
      <Details code={code} detail={told.detail} />
    </div>
  );
}
