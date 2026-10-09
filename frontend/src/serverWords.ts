// What the gateway says, said in the language the person reads.
//
// The gateway's errors reach the page as a sentence in English with, beside it,
// the cause as the catalogue names it (docs/design/errors.json): a code, and what
// fills that code's text (`ServerMsg::Error`, src/cause.rs). The page says the
// catalogue's words for the code and keeps the sentence for "Details". It reads
// nothing out of the sentence: a cause the gateway did not name is said with the
// general words of the place that shows it.
//
// The names of a remote's displays are the other thing the gateway writes in
// English, and this is where the page reads those. They are held to the Rust
// that writes them by docs/design/product-words.json, which
// tools/check-design.py checks.

import type { Told } from "./fault.ts";
import { codeOf, type Words } from "./words.ts";

/** The cause of an error as the gateway sends it. */
export interface ServerCause {
  code: string;
  fill: Record<string, string>;
}

/**
 * What the gateway said went wrong: the cause it named, where this page's
 * catalogue has it, and the sentence as it came either way. A code the
 * catalogue does not have is a gateway newer than the page, and is told as an
 * error with no cause rather than guessed at.
 */
export function serverFault(message: string, cause: ServerCause | null): Told {
  const code = cause && codeOf(cause.code);
  return code && cause
    ? { code, fill: cause.fill, detail: message }
    : { detail: message };
}

/**
 * A display's name as the page says it. The gateway names "All Displays" (each
 * display in a browser tab of its own), "Combined Display" (a Mac's screens in
 * one picture), "Display 2" and "Virtual display" itself; a monitor's own name,
 * which is what a Linux desktop sends, is data and is said as it came.
 */
export function displayName(label: string): Words {
  if (label === "All Displays") {
    return { key: "displays.all" };
  }
  if (label === "Combined Display") {
    return { key: "displays.combined" };
  }
  if (label === "Virtual display") {
    return { key: "displays.virtual" };
  }
  const numbered = label.match(/^Display (\d+)$/);
  return numbered
    ? { key: "displays.numbered", fill: { n: numbered[1] } }
    : { data: label };
}

/**
 * The line beside a display's name: its size, and its density where the
 * gateway states one. The gateway writes "1600×1000 at 2x"; both are numbers,
 * so the page keeps them and leaves the English word out.
 */
export function displayDetail(detail: string): string {
  const found = detail.match(/^(\d+)×(\d+)(?: at (\d+(?:\.\d+)?)x)?$/);
  if (!found) {
    return detail;
  }
  const size = `${found[1]} × ${found[2]}`;
  return found[3] ? `${size} · ${found[3]}x` : size;
}

/**
 * The line beside a display's name, as the page says it: what the gateway
 * writes under "All Displays" is words, and every other line is a size.
 */
export function displayNote(detail: string): Words {
  return detail === "One browser tab each"
    ? { key: "displays.tabeach" }
    : { data: displayDetail(detail) };
}
