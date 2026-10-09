// What the page says, in the language the person reads.
//
// Two sources and one way to ask. The words of the interface are a dictionary per
// language (`words/`), the same keys in each. A message that says something went
// wrong, or why something cannot be had, is an entry of the error catalogue
// (`design/errors.json`, written by `tools/check-design.py --print-errors` from
// docs/design/errors.json), named by its code. `say` takes either.
//
// A module of its own, with nothing of the browser in it, so the rules are tested
// without one: which language a browser's own list asks for, and how a text's
// `{holes}` are filled.

import errors from "./design/errors.json";
import enUS from "./words/en-US.json";
import ptBR from "./words/pt-BR.json";

export type Language = "pt-BR" | "en-US";

/** The languages the page speaks, in the order the preferences show them. */
export const LANGUAGES: readonly Language[] = ["pt-BR", "en-US"];

/** A word of the interface. */
export type WordKey = keyof typeof ptBR;

/** A message of the error catalogue, by its code. */
export type Code = keyof typeof errors;

/** Something `say` can be asked for. */
export type Key = WordKey | Code;

/** What goes in a text's `{holes}`, by name. */
export type Fill = Readonly<Record<string, string | number>>;

const WORDS: Record<Language, Record<WordKey, string>> = {
  "pt-BR": ptBR,
  "en-US": enUS,
};

function isCode(key: Key): key is Code {
  return key in errors;
}

/**
 * `value` as a code of the catalogue, or null for one this page's catalogue does
 * not have: what a gateway newer than the page may send.
 */
export function codeOf(value: string): Code | null {
  return value in errors ? (value as Code) : null;
}

/** How much a message matters, which is the glyph and the colour it is shown in. */
export type Severity = "info" | "warning" | "error";

/** The severity the catalogue gives `code`. */
export function severity(code: Code): Severity {
  return errors[code].severity as Severity;
}

/**
 * Whether the catalogue gives `code` a button: something to press about it,
 * where the message is shown, as against something that mends itself or that
 * only another browser mends.
 */
export function hasButton(code: Code): boolean {
  return "button" in errors[code];
}

/**
 * `key` in `language`, with its holes filled. A hole nothing fills is left out,
 * and the space it leaves closed: `{detail}` is the original text of a cause the
 * catalogue does not know, and a known cause has none.
 */
export function say(language: Language, key: Key, fill: Fill = {}): string {
  const text = isCode(key) ? errors[key].text[language] : WORDS[language][key];
  return text
    .replace(/\{(\w+)\}/g, (_, name: string) => String(fill[name] ?? ""))
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Something the page says that is either words or data: a word of the dictionary,
 * with what fills it; or something said as it is in every language, which a
 * computer's size and a name the page was given are. A catalogue message is
 * neither: it is asked for by its place (preferences.tsx, `message`).
 */
export type Words = { key: WordKey; fill?: Fill } | { data: string };

/** `words` in `language`: its text, or the data itself. */
export function sayWords(language: Language, words: Words): string {
  return "data" in words ? words.data : say(language, words.key, words.fill);
}

function isLanguage(value: string | null): value is Language {
  return LANGUAGES.some((language) => language === value);
}

/**
 * The language to speak: the one the person chose here, and otherwise the first
 * of the browser's own that this page has. Portuguese of any country is pt-BR
 * and English of any is en-US; a browser that asks for neither is spoken to in
 * English.
 */
export function chooseLanguage(
  stored: string | null,
  preferred: readonly string[],
): Language {
  if (isLanguage(stored)) {
    return stored;
  }
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split("-")[0];
    if (primary === "pt") {
      return "pt-BR";
    }
    if (primary === "en") {
      return "en-US";
    }
  }
  return "en-US";
}
