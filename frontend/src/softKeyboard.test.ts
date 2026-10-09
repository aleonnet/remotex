// The keyboard on screen, without a screen: what the layout data promises the
// panel and the press engine, where each side's modifiers live, that no key the
// keyboard had before it was redrawn is out of reach, what Caps Lock makes of a
// key, and that its window stays on the page.
//
// Run with `bun test src/softKeyboard.test.ts` from frontend/.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cellsOf,
  hintOf,
  keyboardFormat,
  type LayoutPage,
  labelOf,
  MODIFIER_KEYS,
  modifierOf,
  PAGE_ABC,
  PAGE_SYM,
  PAGE_WINDOW,
  PAGE_WINDOW_EXTENDED,
  pageFor,
  REPEATING_CODES,
  type SoftKeyDefinition,
  shiftHeld,
  underCapsLock,
  withinPage,
} from "./softKeyboard.ts";

const PHONE_PAGES = [PAGE_ABC, PAGE_SYM];
const PAGES = [PAGE_ABC, PAGE_SYM, PAGE_WINDOW, PAGE_WINDOW_EXTENDED];
// What each page is called when a test fails on it.
const nameOf = (page: LayoutPage) =>
  page === PAGE_WINDOW_EXTENDED ? "window with Fn" : page.id;

const defsOn = (page: LayoutPage): SoftKeyDefinition[] =>
  [...cellsOf(page).values()].map((cell) => cell.def);

const codesOn = (page: LayoutPage) =>
  defsOn(page)
    .filter((def) => def.type === "special")
    .map((def) => def.code);

const sidesOn = (page: LayoutPage) =>
  new Set(
    defsOn(page)
      .map((def) => modifierOf(def)?.side)
      .filter((side) => side !== undefined),
  );

// A key of the window with Fn on, by what is written on it.
function key(label: string): SoftKeyDefinition {
  const found = defsOn(PAGE_WINDOW_EXTENDED).find(
    (def) => def.type !== "spacer" && def.label === label,
  );
  assert.ok(found, `the window has no key ${label}`);
  return found;
}

// The code of such a key, which is what the engine sends for it.
function code(label: string): string {
  const def = key(label);
  assert.ok(def.type === "printable" || def.type === "special", label);
  return def.code;
}

// What a key reaches pressed alone, as the press engine sends it: its own code,
// a chord's codes, a shifted symbol's Shift and code.
function alone(def: SoftKeyDefinition): string[] | null {
  switch (def.type) {
    case "printable":
      return def.shifted ? ["ShiftLeft", def.code] : [def.code];
    case "special":
      return [def.code];
    case "combo":
      return def.codes;
    default:
      return null;
  }
}

// Every chord the pages of a format can send with no modifier held.
const reach = (pages: LayoutPage[]): Set<string> =>
  new Set(
    pages
      .flatMap(defsOn)
      .map(alone)
      .filter((codes) => codes !== null)
      .map((codes) => codes.join("+")),
  );

// What the keyboard sent before it was redrawn, written out from the layouts it
// had then: each entry a chord, its codes joined by "+". A key the new layouts
// cannot reach fails here by name.
const LETTER_CODES = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((l) => `Key${l}`);
const DIGIT_CODES = [..."1234567890"].map((d) => `Digit${d}`);
const FUNCTION_CODES = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);
const ARROWS = ["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"];
const NAVIGATION = ["Insert", "Delete", "Home", "End", "PageUp", "PageDown"];
const SYMBOLS = [
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
];
const KEYS = [
  "Escape",
  ...FUNCTION_CODES,
  ...DIGIT_CODES,
  ...LETTER_CODES,
  ...SYMBOLS,
  "Backspace",
  "Tab",
  "Enter",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  ...NAVIGATION,
  ...ARROWS,
];

const BEFORE: Record<"window" | "phone", string[]> = {
  // The full PC keyboard the window was given.
  window: KEYS,
  // A phone's two screens, with the chords it keeps. Ctrl+Esc and Ctrl with Z,
  // C, V, A and S were keys of their own, and are the strip's Ctrl and the key
  // (docs/design/2026-10-07-0926-adendo-teclado-no-celular.md).
  phone: [...KEYS, "AltLeft+Tab", "AltLeft+F4", "ControlLeft+AltLeft+Delete"],
};

test("no key the keyboard had is out of reach in the format that replaces it", () => {
  for (const [format, pages, before] of [
    ["window", [PAGE_WINDOW_EXTENDED], BEFORE.window],
    ["phone", PHONE_PAGES, BEFORE.phone],
  ] as const) {
    const reached = reach([...pages]);
    for (const chord of before) {
      assert.ok(reached.has(chord), `${format} no longer reaches ${chord}`);
    }
  }
});

test("the format is the device's: a phone is never given the window, however wide", () => {
  // A computer, or a tablet: the window.
  assert.equal(keyboardFormat(false), "window");
  // A phone, whichever way it is held.
  assert.equal(keyboardFormat(true), "phone");
  assert.equal(pageFor("phone", "abc", false), PAGE_ABC);
  assert.equal(pageFor("phone", "sym", true), PAGE_SYM);
  assert.equal(pageFor("window", "abc", false), PAGE_WINDOW);
  assert.equal(pageFor("window", "sym", true), PAGE_WINDOW_EXTENDED);
});

// ── A phone's two pages ──

test("every phone row measures ten units, so the rows line up", () => {
  for (const page of PHONE_PAGES) {
    for (const row of page.rows) {
      if (row.kind === "shortcut") {
        continue;
      }
      const units = row.cells.reduce((sum, cell) => sum + cell.units, 0);
      assert.equal(units, 10, `${page.id} ${row.kind} row`);
    }
  }
});

test("the phone pages have the same rows, so the keyboard keeps its height", () => {
  assert.equal(PAGE_ABC.rows.length, 7);
  assert.deepEqual(
    PAGE_ABC.rows.map((row) => row.kind),
    PAGE_SYM.rows.map((row) => row.kind),
  );
  for (const page of PHONE_PAGES) {
    for (const cell of page.rows[0].cells) {
      assert.equal(cell.commit, "tap", cell.id);
    }
  }
});

test("the first page's shortcut row has no modifier and no Ctrl chord, and the second's is the F-keys", () => {
  const cells = PAGE_ABC.rows[0].cells;
  assert.ok(cells.every((cell) => modifierOf(cell.def) === null));
  assert.deepEqual(
    cells.map((cell) => cell.def.type === "combo" && cell.def.label),
    [false, "Alt+Tab", "Alt+F4", "C+A+Del"],
  );
  const sym = PAGE_SYM.rows[0].cells
    .slice(1)
    .map((cell) => (cell.def.type === "special" ? cell.def.code : ""));
  assert.deepEqual(sym, FUNCTION_CODES);
  // Ctrl and one key is the strip's Ctrl and that key; only a three-finger
  // chord earns a key of its own.
  for (const cell of cells) {
    if (cell.def.type === "combo" && cell.def.codes[0] === "ControlLeft") {
      assert.ok(cell.def.codes.length > 2, cell.def.label);
    }
  }
});

test("only the shortcut row commits on a tap", () => {
  for (const page of PAGES) {
    for (const row of page.rows) {
      for (const cell of row.cells) {
        assert.equal(cell.commit === "tap", row.kind === "shortcut", cell.id);
      }
    }
  }
});

test("no page repeats a cell id, and Fn renames no cell", () => {
  for (const page of PAGES) {
    const ids = page.rows.flatMap((row) => row.cells.map((cell) => cell.id));
    assert.equal(new Set(ids).size, ids.length, nameOf(page));
    assert.equal(cellsOf(page).size, ids.length, nameOf(page));
  }
  for (const [id, cell] of cellsOf(PAGE_WINDOW)) {
    assert.equal(cellsOf(PAGE_WINDOW_EXTENDED).get(id), cell, id);
  }
});

test("a phone's first page holds only left-hand modifiers", () => {
  assert.deepEqual([...sidesOn(PAGE_ABC)], ["left"]);
});

test("a phone's second page holds every right-hand modifier", () => {
  const codes = new Set(codesOn(PAGE_SYM));
  for (const [modifier, held] of MODIFIER_KEYS) {
    if (held.side === "right") {
      assert.ok(codes.has(modifier), `${modifier} missing from the page`);
    }
  }
});

test("the strip has Esc beside Tab, then its modifiers and its arrows", () => {
  const strip = PAGE_ABC.rows.find((row) => row.kind === "strip");
  assert.ok(strip);
  assert.deepEqual(
    strip.cells.map((cell) =>
      cell.def.type === "special" ? cell.def.code : "",
    ),
    [
      "Tab",
      "Escape",
      "ControlLeft",
      "AltLeft",
      "MetaLeft",
      "ArrowLeft",
      "ArrowUp",
      "ArrowDown",
      "ArrowRight",
    ],
  );
  // The shortcut row above does not carry it.
  assert.ok(
    PAGE_ABC.rows[0].cells.every(
      (cell) => cell.def.type !== "special" || cell.def.code !== "Escape",
    ),
  );
});

test("the strip is the same on both of a phone's pages", () => {
  const strip = (page: LayoutPage) =>
    page.rows
      .filter((row) => row.kind === "strip")
      .flatMap((row) => row.cells.map((cell) => cell.def));
  assert.deepEqual(strip(PAGE_SYM), strip(PAGE_ABC));
  assert.ok(strip(PAGE_ABC).length > 0);
});

test("Backspace ends the same row on both of a phone's pages", () => {
  for (const page of PHONE_PAGES) {
    const last = page.rows[5].cells.at(-1);
    assert.ok(last, page.id);
    assert.equal(
      last.def.type === "special" ? last.def.code : "",
      "Backspace",
      page.id,
    );
  }
});

test("each of a phone's pages has one Sticky key, leading its shortcut row, and the window has none", () => {
  const sticky = (page: LayoutPage) =>
    [...cellsOf(page).values()]
      .filter((cell) => cell.def.type === "sticky")
      .map((cell) => cell.id);
  for (const page of PHONE_PAGES) {
    assert.deepEqual(sticky(page), [`${page.id}:0:0`], page.id);
  }
  // Where a PC keyboard has Caps Lock, the window has Caps Lock.
  assert.deepEqual(sticky(PAGE_WINDOW_EXTENDED), []);
  assert.deepEqual(PAGE_WINDOW.rows[2].cells[0].def, {
    type: "local",
    label: "Caps",
    does: "caps",
  });
});

test("the keys that repeat are exactly the editing and cursor keys, never a character", () => {
  for (const page of PAGES) {
    for (const cell of cellsOf(page).values()) {
      const repeats =
        cell.def.type === "special" && REPEATING_CODES.has(cell.def.code);
      assert.equal(cell.commit === "down", repeats, cell.id);
      if (cell.def.type === "printable") {
        assert.notEqual(cell.commit, "down", cell.id);
      }
    }
  }
  assert.ok(!REPEATING_CODES.has("Enter"));
});

test("a modifier inside a chord is not a modifier key", () => {
  const altTab = defsOn(PAGE_ABC).find(
    (def) => def.type === "combo" && def.label === "Alt+Tab",
  );
  assert.ok(altTab);
  assert.equal(modifierOf(altTab), null);
});

// ── The window ──

test("the window puts each side's keys on its side, by code, under the same keycap", () => {
  const bottom = PAGE_WINDOW.rows[PAGE_WINDOW.rows.length - 1].cells.map(
    (cell) => cell.def,
  );
  assert.deepEqual(
    bottom.flatMap((def) =>
      def.type === "special" && modifierOf(def) ? [def.code] : [],
    ),
    [
      "ControlLeft",
      "MetaLeft",
      "AltLeft",
      "AltRight",
      "MetaRight",
      "ControlRight",
    ],
  );
  const shifts = defsOn(PAGE_WINDOW).filter(
    (def) => def.type === "special" && def.label === "Shift",
  );
  assert.deepEqual(
    shifts.map((def) => def.type === "special" && def.code),
    ["ShiftLeft", "ShiftRight"],
  );
});

test("the function and navigation rows come and go above the rest, and no key moves", () => {
  const without = PAGE_WINDOW.rows;
  const withThem = PAGE_WINDOW_EXTENDED.rows;
  assert.equal(without.length, 5);
  assert.equal(withThem.length, without.length + 2);
  assert.deepEqual(withThem.slice(2), without);
});

test("Caps and Fn are the keyboard's own, and send no code", () => {
  for (const label of ["Caps", "Fn"]) {
    assert.equal(key(label).type, "local", label);
    assert.equal(alone(key(label)), null, label);
  }
});

// Caps Lock is applied to what the press engine sends: the modifiers held
// around a key, in the order they were taken, then the key.

test("Caps Lock is a Shift around each letter, and around nothing else", () => {
  assert.deepEqual(underCapsLock([code("a")], true), ["ShiftLeft", "KeyA"]);
  assert.deepEqual(underCapsLock([code("a")], false), ["KeyA"]);
  // A digit under Caps Lock is still the digit, as on a real keyboard.
  assert.deepEqual(underCapsLock([code("1")], true), ["Digit1"]);
  assert.deepEqual(underCapsLock([code("-")], true), ["Minus"]);
  assert.deepEqual(underCapsLock([code("Enter")], true), ["Enter"]);
  assert.deepEqual(underCapsLock([], true), []);
});

test("Caps Lock leaves a chord alone: Ctrl+C is not Ctrl+Shift+C", () => {
  // Under Ctrl, Alt or Super the letter is a chord's, and a real Caps Lock adds
  // no Shift to one.
  for (const held of ["ControlLeft", "AltRight", "MetaLeft"]) {
    assert.deepEqual(
      underCapsLock([held, code("c")], true),
      [held, "KeyC"],
      held,
    );
  }
  // A Shift held with it is the chord's own, and stays.
  assert.deepEqual(
    underCapsLock(["ControlLeft", "ShiftLeft", code("c")], true),
    ["ControlLeft", "ShiftLeft", "KeyC"],
  );
  // A chord key's codes are its own.
  assert.deepEqual(underCapsLock(["AltLeft", "Tab"], true), ["AltLeft", "Tab"]);
});

test("Shift under Caps Lock types the letter small: the Shift is left out for it", () => {
  assert.deepEqual(underCapsLock(["ShiftRight", code("a")], true), ["KeyA"]);
  // And still shifts everything that is not a letter.
  assert.deepEqual(underCapsLock(["ShiftLeft", code("1")], true), [
    "ShiftLeft",
    "Digit1",
  ]);
});

test("a key shows what it will type", () => {
  const a = key("a");
  assert.equal(labelOf(a, false, false), "a");
  assert.equal(labelOf(a, true, false), "A");
  assert.equal(labelOf(a, false, true), "A");
  assert.equal(labelOf(a, true, true), "a");
  const one = key("1");
  assert.equal(labelOf(one, false, true), "1");
  assert.equal(labelOf(one, true, false), "!");
  assert.equal(labelOf(key("Enter"), true, true), "Enter");
  // A key that is the shifted symbol already shows it, Shift or no Shift.
  const under: SoftKeyDefinition = {
    type: "printable",
    label: "_",
    code: "Minus",
    shifted: true,
  };
  assert.equal(labelOf(under, false, false), "_");
  assert.equal(labelOf(under, true, false), "_");
  assert.equal(labelOf({ type: "spacer" }, true, true), "");
});

test("a key's corner shows what Shift makes of it, until Shift is held", () => {
  const one = key("1");
  assert.equal(hintOf(one, false), "!");
  assert.equal(hintOf(one, true), null);
  // A letter has no glyph of its own for Shift, and a word has none at all.
  assert.equal(hintOf(key("a"), false), null);
  assert.equal(hintOf(key("Enter"), false), null);
  // The digits and the two beside Space are a phone's keys that have one.
  const hinted = (page: LayoutPage) =>
    defsOn(page)
      .filter((def) => hintOf(def, false) !== null)
      .map((def) => (def.type === "printable" ? def.label : ""));
  assert.deepEqual(hinted(PAGE_ABC), [..."1234567890", ",", "."]);
  assert.deepEqual(hinted(PAGE_SYM), [",", "."]);
});

test("either Shift shifts the displayed glyphs", () => {
  assert.equal(shiftHeld([]), false);
  assert.equal(shiftHeld(["ShiftLeft"]), true);
  assert.equal(shiftHeld(["ShiftRight", "AltRight"]), true);
  assert.equal(shiftHeld(["AltRight"]), false);
});

test("the window is held inside the page, whichever way it is carried", () => {
  const size = { x: 760, y: 260 };
  const page = { x: 1280, y: 800 };
  assert.deepEqual(withinPage({ x: 100, y: 90 }, size, page), {
    x: 100,
    y: 90,
  });
  // Past each edge in turn: it stops at the edge, whole.
  assert.deepEqual(withinPage({ x: -40, y: 90 }, size, page), { x: 0, y: 90 });
  assert.deepEqual(withinPage({ x: 100, y: -5 }, size, page), { x: 100, y: 0 });
  assert.deepEqual(withinPage({ x: 9000, y: 90 }, size, page), {
    x: 520,
    y: 90,
  });
  assert.deepEqual(withinPage({ x: 100, y: 9000 }, size, page), {
    x: 100,
    y: 540,
  });
  // A page smaller than the window keeps the window's top left corner.
  assert.deepEqual(withinPage({ x: 50, y: 50 }, size, { x: 400, y: 200 }), {
    x: 0,
    y: 0,
  });
});
