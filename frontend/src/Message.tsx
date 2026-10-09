import { Glyph, type GlyphName } from "./Glyph.tsx";
import { usePreferences } from "./preferences.tsx";
import { type Code, type Fill, type Severity, severity } from "./words.ts";

// A message of the error catalogue, where it happened.
//
// Every message has a place: where on the page it appears, named by the place's
// general code (docs/design/errors.json). A cause the catalogue knows has a code
// of its own under it, and one it does not is said with the general code. The
// place is written out where the message is shown, as a code and never as a
// variable: `tools/check-design.py` finds each one in the page again, fails when
// the catalogue has no entry for it, and fails on a place it cannot read.
//
// The code is shown beside the words: these are the messages somebody has
// something to do about, and the code is what they quote when they ask. How
// much it matters is the catalogue's to say, and is the glyph and the colour.

const LOOKS: Record<Severity, { glyph: GlyphName; tone: string }> = {
  info: { glyph: "info", tone: "" },
  warning: { glyph: "triangle-alert", tone: " al-msg--warning" },
  error: { glyph: "circle-alert", tone: " al-msg--danger" },
};

/** The glyph and the class a message of `code`'s severity is shown with. */
export function lookOf(code: Code): { glyph: GlyphName; tone: string } {
  return LOOKS[severity(code)];
}

/**
 * Why an option cannot be changed here: the catalogue's words for the cause, in
 * the place of the note that would say what the option does. No glyph and no
 * code beside it, because there is nothing to do about it: it is how this
 * browser or this gateway is.
 */
export function Reason({ place, cause }: { place: Code; cause?: Code }) {
  const { message } = usePreferences();
  return <small>{message(place, cause)}</small>;
}

export function Message({
  place,
  cause,
  fill,
  detail,
  role = "alert",
}: {
  /** The general code of where this message appears. */
  place: Code;
  /** The code of the cause, where the catalogue knows it. */
  cause?: Code;
  fill?: Fill;
  /**
   * What whoever reported the cause said of it, in their own words: kept on the
   * code, for whoever points at it, and never said in the sentence, which is in
   * the person's language.
   */
  detail?: string;
  /**
   * An alert is announced when it appears, which is right for what just went
   * wrong. A note is for what is simply so, and was so when the page was drawn.
   */
  role?: "alert" | "note";
}) {
  const { message } = usePreferences();
  const look = lookOf(cause ?? place);
  return (
    <p className={`al-msg${look.tone}`} role={role}>
      <Glyph name={look.glyph} />
      <span>
        <span>{message(place, cause, fill)}</span>{" "}
        <span className="al-code" title={detail}>
          {cause ?? place}
        </span>
      </span>
    </p>
  );
}
