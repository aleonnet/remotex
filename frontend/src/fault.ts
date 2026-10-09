// Why something failed, as data and not as a sentence.
//
// Whatever fails names its cause by the catalogue's code (docs/design/errors.json),
// with what fills the holes of that cause's text and, where the browser or the
// gateway said something of its own, those words as they came. The page then says
// the cause in the language the person reads, with the code beside it, and keeps
// the original words for whoever asks. A module that failed with an English
// sentence left the page two bad choices: show it as it is, or guess the cause
// back out of its wording.

import type { Code, Fill } from "./words.ts";

export interface Fault {
  /** The cause, by its code in the catalogue. */
  code: Code;
  /** What fills the holes of the cause's text. */
  fill?: Fill;
  /**
   * What whoever failed said of it, in their own words: never part of the
   * sentence the page says, which is in the person's language, and kept beside
   * the code for whoever asks ("Details").
   */
  detail?: string;
}

/**
 * What a place is told went wrong: a cause the catalogue knows, or only the
 * words of whoever failed, which the place then says under its own general code.
 */
export type Told =
  | Fault
  | { code?: undefined; fill?: undefined; detail: string };

/** A failure thrown with its cause named. */
export class FaultError extends Error {
  readonly fault: Fault;

  constructor(fault: Fault) {
    super(fault.detail ?? fault.code);
    this.name = "FaultError";
    this.fault = fault;
  }
}

/**
 * What a thrown value says of itself: an error's name and message, the name
 * left out where it says nothing (`Error`), and nothing at all for a value
 * that is not an error.
 */
export function described(thrown: unknown): string | undefined {
  if (!(thrown instanceof Error)) {
    return undefined;
  }
  return thrown.name && thrown.name !== "Error"
    ? `${thrown.name}: ${thrown.message}`
    : thrown.message || undefined;
}

/**
 * What fills the place's text for `told`: the cause's own holes. Words nobody
 * knows the cause of fill nothing: the place says its general sentence, and the
 * words are shown apart from it.
 */
export function fillOf(told: Told): Fill | undefined {
  return told.fill;
}

/** A fault as a log line reads it: the code, and what was said of it. */
export function logged(fault: Fault): string {
  return fault.detail === undefined
    ? fault.code
    : `${fault.code} (${fault.detail})`;
}

/**
 * The fault a caught value carries, or `code` with what the value said of
 * itself: the cause of a failure nothing named, which is the browser's own
 * (a permission refused, a device busy).
 */
export function faultOf(thrown: unknown, code: Code): Fault {
  if (thrown instanceof FaultError) {
    return thrown.fault;
  }
  const detail = described(thrown);
  return detail === undefined ? { code } : { code, detail };
}
