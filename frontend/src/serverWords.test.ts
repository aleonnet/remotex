// What the gateway says, as the page takes it: the cause it names, said from
// the catalogue, and its display names, held to what the gateway's code writes.
//
// Run with `bun test src/serverWords.test.ts` from frontend/.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  displayDetail,
  displayName,
  displayNote,
  serverFault,
} from "./serverWords.ts";
import { type Code, LANGUAGES, say } from "./words.ts";

const design = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../docs/design/${name}`, import.meta.url), "utf8"),
  );

interface Entry {
  code: Code;
  text: Record<string, string>;
  origin?: { file: string };
}

interface Place {
  kind: string;
  general: Entry;
  causes: Entry[];
}

/**
 * The kinds of place no browser is told of: a terminal's and the Mac app's
 * messages are said where they happen, and the page does not carry them. Named
 * by what is left out, so that a kind added later is held to the page until
 * somebody says it is not the page's.
 */
const NOT_A_BROWSERS = ["terminal", "app"];

/** Every message of `places`: each one's general message, and its causes. */
const messages = (places: Place[]): Entry[] =>
  places.flatMap((place) => [place.general, ...place.causes]);

/** Every message of the catalogue. */
function entries(): Entry[] {
  return messages(design("errors.json").places);
}

/** The messages of the places a browser is told of. */
function told(): Entry[] {
  const places: Place[] = design("errors.json").places;
  return messages(
    places.filter((place) => !NOT_A_BROWSERS.includes(place.kind)),
  );
}

test("a cause the gateway names is said by its code, with what fills it, and the sentence kept", () => {
  const message =
    "VNC session ended: the Mac's media stream brought pictures of 6400x3600, not of the 8448x3600 display it was offered for, within 10s of its offer";
  const fill = { got: "6400 × 3600", wanted: "8448 × 3600" };
  assert.deepEqual(serverFault(message, { code: "AL-7701", fill }), {
    code: "AL-7701",
    fill,
    detail: message,
  });
  // And it is the catalogue's own words that are said, in each language, with
  // nothing of the gateway's sentence in them.
  assert.equal(
    say("pt-BR", "AL-7701", fill),
    "O Mac mandou a imagem de outra tela (6400 × 3600), e não a da tela pedida (8448 × 3600).",
  );
  assert.equal(
    say("en-US", "AL-7701", fill),
    "The Mac sent the picture of another screen (6400 × 3600), and not that of the screen asked for (8448 × 3600).",
  );
});

test("an error nobody named a cause for keeps its sentence and is given no cause", () => {
  const message =
    "VNC session ended: a zrle run of 12 overruns the 4 pixels its tile has left";
  assert.deepEqual(serverFault(message, null), { detail: message });
  // A code this page's catalogue does not have is a gateway newer than the page:
  // told the same way, never guessed at.
  assert.deepEqual(serverFault(message, { code: "AL-7999", fill: {} }), {
    detail: message,
  });
});

test("no message of the catalogue takes somebody else's words into its sentence", () => {
  const all = entries();
  assert.ok(all.length >= 150, "the catalogue's messages were not found");
  for (const { code, text } of all) {
    for (const language of LANGUAGES) {
      assert.ok(text[language], `${code} has no ${language} text`);
      assert.doesNotMatch(
        text[language],
        /\{detail\}/,
        `${code} puts the original words inside its ${language} sentence`,
      );
    }
  }
});

test("every cause the gateway is the origin of is one this page can say", () => {
  const sent = told().filter((entry) => entry.origin?.file.startsWith("src/"));
  assert.ok(sent.length >= 45, "the gateway's causes were not found");
  for (const { code } of sent) {
    const said = serverFault("as the gateway said it", { code, fill: {} });
    assert.equal(said.code, code, `${code} is not in the page's catalogue`);
  }
  // And the ones left out are left out: a terminal's cause is no browser's.
  assert.ok(
    entries().length > told().length,
    "the terminal's and the app's messages were not found",
  );
});

test("a display the gateway names is said from the dictionary, and a monitor's own name as it came", () => {
  const named: { says: string; key: string | null; line?: string }[] =
    design("product-words.json").server;
  assert.ok(named.length >= 3, "the gateway's display names were not found");
  for (const { says, key, line } of named) {
    if (key === null) {
      assert.equal(displayDetail(says), "1600 × 1000 · 2x");
      assert.deepEqual(displayNote(says), { data: "1600 × 1000 · 2x" });
    } else if (line === "detail") {
      // What the gateway writes under a name, where that is words and no size.
      assert.deepEqual(displayNote(says), { key });
    } else {
      const words = displayName(says);
      assert.equal("key" in words && words.key, key, says);
    }
  }
  assert.deepEqual(displayName("Display 2"), {
    key: "displays.numbered",
    fill: { n: "2" },
  });
  assert.deepEqual(displayName("DP-1"), { data: "DP-1" });
  assert.equal(displayDetail("1920×1080"), "1920 × 1080");
  assert.equal(displayDetail("something else"), "something else");
});
