// The keyboard on screen: its keys, its pages, and what Caps Lock does to a key.
//
// Everything is expressed in DOM `KeyboardEvent.code` strings — the same currency
// the whole input path already speaks (see protocol.ts and the backend
// keymap.rs). The backend maps every DOM code to an RDP scancode *and* an X11
// keysym, resolving the shifted symbol from the live Shift state (RDP defers to
// the remote host; VNC picks the shifted keysym in keymap.rs) — so a soft key is
// just a code, and shifted symbols fall out of holding the real Shift modifier.
// That reuses the existing pipeline for both engines instead of minting a second,
// keysym-only input path.
//
// Two formats, decided by the device and not by the width of the window: a
// window that is carried about, with a pointer or on a tablet, and two pages
// docked at the bottom of a phone, the same whichever way it is held. This
// module is data only: pages of rows of cells, each cell a key definition, a
// width in units and the way it commits. How a finger turns a cell into a key
// is softKeyPress.ts; where a finger is, softKeyGeometry.ts. Nothing here
// touches the page, so what each key is and where the window may go are tested
// without one.

// ── Key definitions ──

export interface PrintableSoftKey {
  type: "printable";
  label: string;
  code: string;
  // Cosmetic only: the glyph shown when Shift is active (e.g. "!" over "1").
  // Letters omit it — the display just upper-cases the label. The character
  // itself is produced by the remote from the held Shift, not from this field.
  shiftLabel?: string;
  // The key *is* the shifted symbol: sent as Shift plus the code, so `_` or `{`
  // on a phone's second page needs no Shift of its own.
  shifted?: boolean;
}

export interface SpecialSoftKey {
  type: "special";
  label: string;
  code: string;
}

export interface ComboSoftKey {
  type: "combo";
  label: string;
  // DOM codes pressed in order, released in reverse (see sendKeyCombo).
  codes: string[];
}

// Switches the phone's keyboard to its other page.
export interface PageSoftKey {
  type: "page";
  label: string;
  page: PageId;
}

// Switches the modifiers between sticking and being sent alone on a tap. Fixed
// ahead of the shortcut row on both of a phone's pages.
export interface StickySoftKey {
  type: "sticky";
  label: string;
}

/** A key that changes the keyboard itself and sends nothing. */
export interface LocalSoftKey {
  type: "local";
  label: string;
  /** Caps Lock, or the function and navigation rows coming and going. */
  does: LocalAct;
}

export type LocalAct = "caps" | "extend";

// Inert width: the half key at each end of a phone's home row, and the room
// beside the window's arrow up. Drawn as nothing; a finger on it belongs to the
// neighbouring key.
export interface SpacerSoftKey {
  type: "spacer";
}

export type SoftKeyDefinition =
  | PrintableSoftKey
  | SpecialSoftKey
  | ComboSoftKey
  | PageSoftKey
  | StickySoftKey
  | LocalSoftKey
  | SpacerSoftKey;

// ── Modifiers ──

// The modifiers the keyboard can hold, one entry per physical key: both sides
// of Shift, Ctrl, Alt and Super are distinct codes, exactly as a hardware
// keyboard reports them, and the backend keeps them apart (Alt_R vs Alt_L, the
// E0-extended scancode) — so a right-hand soft key really is the right-hand key
// on the remote, where the two differ (AltGr, a Mac's right Option).
export type ModifierKind = "shift" | "ctrl" | "alt" | "super";
export type ModifierSide = "left" | "right";

export interface ModifierKey {
  kind: ModifierKind;
  side: ModifierSide;
  // The cap a badge shows for it while it is held with no key of its own in view.
  label: string;
}

export const MODIFIER_KEYS: ReadonlyMap<string, ModifierKey> = new Map([
  ["ShiftLeft", { kind: "shift", side: "left", label: "Shift" }],
  ["ShiftRight", { kind: "shift", side: "right", label: "RShift" }],
  ["ControlLeft", { kind: "ctrl", side: "left", label: "Ctrl" }],
  ["ControlRight", { kind: "ctrl", side: "right", label: "RCtrl" }],
  ["AltLeft", { kind: "alt", side: "left", label: "Alt" }],
  ["AltRight", { kind: "alt", side: "right", label: "RAlt" }],
  ["MetaLeft", { kind: "super", side: "left", label: "Super" }],
  ["MetaRight", { kind: "super", side: "right", label: "RSuper" }],
]);

// Which modifier a key holds, or null if it is not a modifier key. A modifier
// inside a combo (Alt in Alt+Tab) is not one: only a `special` key whose own
// code is a modifier is.
export function modifierOf(def: SoftKeyDefinition): ModifierKey | null {
  if (def.type !== "special") {
    return null;
  }
  return MODIFIER_KEYS.get(def.code) ?? null;
}

// Whether either Shift is among the held codes — what decides the glyphs the
// keys display.
export function shiftHeld(held: Iterable<string>): boolean {
  for (const code of held) {
    if (code === "ShiftLeft" || code === "ShiftRight") {
      return true;
    }
  }
  return false;
}

// ── Layout model ──

/** A phone's two pages, and the window's one. */
export type PageId = "abc" | "sym" | "window";

// How a cell turns a finger into a key:
// - `lift`: the key under the finger when it lifts, after any slide to correct;
// - `down`: at once on touch, then repeating while held (Backspace, arrows);
// - `tap`: on lift, only if the finger stayed put — the scrollable shortcut row,
//   where a slide is the row scrolling and never a change of key.
export type Commit = "lift" | "down" | "tap";

// A cell's identity within its page: "page:row:col". Never a code — both Shifts
// of the window share a label, and a phone's Bksp is on both of its pages.
export type CellId = string;

export interface LayoutCell {
  id: CellId;
  def: SoftKeyDefinition;
  // Width as a share of the row: a phone row is ten units.
  units: number;
  commit: Commit;
}

export type RowKind = "shortcut" | "strip" | "main";

export interface LayoutRow {
  kind: RowKind;
  cells: LayoutCell[];
}

export interface LayoutPage {
  id: PageId;
  rows: LayoutRow[];
}

/** How the keyboard is drawn: a window, or docked on a phone. */
export type KeyboardFormat = "window" | "phone";

/**
 * The format for the device in hand. A phone is the device the engine calls one
 * (useRemoteDesktop's `sizeFollows`): it is never given a window to carry,
 * whichever way it is held and however wide it is on its side.
 */
export function keyboardFormat(phone: boolean): KeyboardFormat {
  if (!phone) {
    return "window";
  }
  return "phone";
}

// The keys that commit on touch and repeat while held: the editing and cursor
// keys a physical keyboard's typematic serves, and nothing that types a
// character a slide could still correct. Enter is deliberately absent — an
// accidental Enter in a terminal is the costliest mis-hit on this surface.
export const REPEATING_CODES: ReadonlySet<string> = new Set([
  "Backspace",
  "Delete",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Space",
  "Tab",
  "PageUp",
  "PageDown",
]);

function commitOf(def: SoftKeyDefinition): Commit {
  if (def.type === "special" && REPEATING_CODES.has(def.code)) {
    return "down";
  }
  return "lift";
}

// ── Builders ──

interface Key {
  def: SoftKeyDefinition;
  units: number;
}

function p(label: string, code: string, shiftLabel?: string, units = 1): Key {
  return { def: { type: "printable", label, code, shiftLabel }, units };
}

// A shifted printable: the key is the shifted symbol itself.
function ps(label: string, code: string): Key {
  return {
    def: { type: "printable", label, code, shifted: true },
    units: 1,
  };
}

function s(label: string, code: string, units = 1): Key {
  return { def: { type: "special", label, code }, units };
}

function c(label: string, codes: string[]): Key {
  return { def: { type: "combo", label, codes }, units: 1 };
}

function pg(label: string, page: PageId, units: number): Key {
  return { def: { type: "page", label, page }, units };
}

function local(label: string, does: LocalAct, units: number): Key {
  return { def: { type: "local", label, does }, units };
}

function gap(units: number): Key {
  return { def: { type: "spacer" }, units };
}

// `name` is the row's part of its cells' ids: its place among a page's rows, or
// a word for a row that comes and goes, so that no cell is renamed when it does.
function row(
  page: PageId,
  name: number | string,
  kind: RowKind,
  keys: readonly Key[],
  commit?: Commit,
): LayoutRow {
  return {
    kind,
    cells: keys.map((key, col) => ({
      id: `${page}:${name}:${col}`,
      def: key.def,
      units: key.units,
      commit: commit ?? commitOf(key.def),
    })),
  };
}

const letters = (keys: string): Key[] =>
  [...keys].map((letter) => p(letter, `Key${letter.toUpperCase()}`));

const DIGITS: Key[] = [
  p("1", "Digit1", "!"),
  p("2", "Digit2", "@"),
  p("3", "Digit3", "#"),
  p("4", "Digit4", "$"),
  p("5", "Digit5", "%"),
  p("6", "Digit6", "^"),
  p("7", "Digit7", "&"),
  p("8", "Digit8", "*"),
  p("9", "Digit9", "("),
  p("0", "Digit0", ")"),
];

const QWERTY: Key[] = letters("qwertyuiop");

const FUNCTIONS: Key[] = Array.from({ length: 12 }, (_, index) =>
  s(`F${index + 1}`, `F${index + 1}`),
);

// ── A phone's shortcut rows (they slide) ──

const STICKY: Key = { def: { type: "sticky", label: "Sticky" }, units: 1 };

// The Sticky key leads both rows, and the panel keeps it out of the slide so it
// is on screen on either page. With it off, a tap on a modifier sends that key
// alone, down then up — Super alone is the Start key.
//
// The chords are the ones a browser swallows or a phone cannot otherwise reach;
// Ctrl+C and its kin are the strip's Ctrl and a letter.
const SHORTCUTS_ABC: Key[] = [
  STICKY,
  c("Alt+Tab", ["AltLeft", "Tab"]),
  c("Alt+F4", ["AltLeft", "F4"]),
  c("C+A+Del", ["ControlLeft", "AltLeft", "Delete"]),
];

// The second page's row is F1 to F12.
const SHORTCUTS_FN: Key[] = [STICKY, ...FUNCTIONS];

// ── The strip: modifiers, Esc and arrows, on both of a phone's pages ──

// Esc sits beside Tab, ahead of the modifiers. Super is a symbol where the word
// would not fit, and all of them are kept narrow so the arrows keep a unit each.
const SUPER_GLYPH = "❖";

const STRIP: Key[] = [
  s("Tab", "Tab", 1.5),
  s("Esc", "Escape", 1.1),
  s("Ctrl", "ControlLeft", 1.1),
  s("Alt", "AltLeft", 1.1),
  s(SUPER_GLYPH, "MetaLeft", 1.2),
  s("←", "ArrowLeft"),
  s("↑", "ArrowUp"),
  s("↓", "ArrowDown"),
  s("→", "ArrowRight"),
];

// ── A phone's first page: letters ──

// Nine keys where the rows around it have ten units: half a key of inert margin
// at each end keeps the stagger of a real keyboard and the key width of the rows
// above. A finger on the margin goes to `a` or `l`.
const HOME: Key[] = [gap(0.5), ...letters("asdfghjkl"), gap(0.5)];

const ZXCV: Key[] = [
  s("Shift", "ShiftLeft", 1.5),
  ...letters("zxcvbnm"),
  s("Bksp", "Backspace", 1.5),
];

const bottom = (label: string, page: PageId): Key[] => [
  pg(label, page, 1.5),
  p(",", "Comma", "<"),
  s("Space", "Space", 5),
  p(".", "Period", ">"),
  s("Enter", "Enter", 1.5),
];

// ── A phone's second page: symbols and navigation ──

const SYMBOLS: Key[] = [
  p("`", "Backquote"),
  p("-", "Minus"),
  p("=", "Equal"),
  p("[", "BracketLeft"),
  p("]", "BracketRight"),
  p("\\", "Backslash"),
  p(";", "Semicolon"),
  p("'", "Quote"),
  p(",", "Comma"),
  p(".", "Period"),
];

// The shifted partners of the row above, each a key of its own.
const SYMBOLS_SHIFTED: Key[] = [
  ps("~", "Backquote"),
  ps("_", "Minus"),
  ps("+", "Equal"),
  ps("{", "BracketLeft"),
  ps("}", "BracketRight"),
  ps("|", "Backslash"),
  ps(":", "Semicolon"),
  ps('"', "Quote"),
  ps("<", "Comma"),
  ps(">", "Period"),
];

const NAVIGATION: Key[] = [
  s("Ins", "Insert"),
  s("Del", "Delete"),
  s("Home", "Home"),
  s("End", "End"),
  s("PgUp", "PageUp"),
  s("PgDn", "PageDown"),
];

const NAV: Key[] = [
  p("/", "Slash"),
  ps("?", "Slash"),
  ...NAVIGATION,
  s("PrtSc", "PrintScreen"),
  s("Menu", "ContextMenu"),
];

// The right-hand modifiers live here and nowhere else on a phone: the first
// page's Shift, Ctrl, Alt and Super are the left keys, so this is the only way a
// phone reaches AltGr on a Windows or Linux host, or a Mac's right Option.
// Backspace ends the row, where the first page has it, as wide as each of them.
const RIGHT_MODIFIERS: Key[] = (
  [
    ["RShift", "ShiftRight"],
    ["RCtrl", "ControlRight"],
    ["RAlt", "AltRight"],
    ["RSuper", "MetaRight"],
    ["Bksp", "Backspace"],
  ] as const
).map(([label, code]) => s(label, code, 2));

// ── The window: a PC keyboard, as the hardware has it ──

// The keys in use, and the arrows. The function keys and the navigation keys are
// one key away (Fn), in two rows above the rest, so that no key moves when they
// come and go.
const WINDOW: Key[][] = [
  [
    s("Esc", "Escape"),
    p("`", "Backquote", "~"),
    ...DIGITS,
    p("-", "Minus", "_"),
    p("=", "Equal", "+"),
    s("Bksp", "Backspace", 2),
  ],
  [
    s("Tab", "Tab", 1.5),
    ...QWERTY,
    p("[", "BracketLeft", "{"),
    p("]", "BracketRight", "}"),
    p("\\", "Backslash", "|", 1.5),
  ],
  [
    local("Caps", "caps", 1.8),
    ...letters("asdfghjkl"),
    p(";", "Semicolon", ":"),
    p("'", "Quote", '"'),
    s("Enter", "Enter", 2.2),
  ],
  [
    s("Shift", "ShiftLeft", 2.3),
    ...letters("zxcvbnm"),
    p(",", "Comma", "<"),
    p(".", "Period", ">"),
    p("/", "Slash", "?"),
    s("Shift", "ShiftRight", 2.7),
    gap(1),
    s("▲", "ArrowUp"),
    gap(1),
  ],
  // The bottom row as the hardware has it: Ctrl, Super and Alt left of the space
  // bar, Alt, Super and Ctrl right of it, each with its own side's code. The caps
  // match the hardware rather than naming the side — the position says it.
  [
    s("Ctrl", "ControlLeft", 1.5),
    s("Super", "MetaLeft", 1.5),
    s("Alt", "AltLeft", 1.5),
    s("Space", "Space", 4.5),
    s("Alt", "AltRight", 1.5),
    s("Super", "MetaRight", 1.5),
    s("Ctrl", "ControlRight", 1.5),
    local("Fn", "extend", 1.5),
    s("◀", "ArrowLeft"),
    s("▼", "ArrowDown"),
    s("▶", "ArrowRight"),
  ],
];

// ── Pages ──

export const PAGE_ABC: LayoutPage = {
  id: "abc",
  rows: [
    row("abc", 0, "shortcut", SHORTCUTS_ABC, "tap"),
    row("abc", 1, "strip", STRIP),
    row("abc", 2, "main", DIGITS),
    row("abc", 3, "main", QWERTY),
    row("abc", 4, "main", HOME),
    row("abc", 5, "main", ZXCV),
    row("abc", 6, "main", bottom("?123", "sym")),
  ],
};

export const PAGE_SYM: LayoutPage = {
  id: "sym",
  rows: [
    row("sym", 0, "shortcut", SHORTCUTS_FN, "tap"),
    row("sym", 1, "strip", STRIP),
    row("sym", 2, "main", SYMBOLS),
    row("sym", 3, "main", SYMBOLS_SHIFTED),
    row("sym", 4, "main", NAV),
    row("sym", 5, "main", RIGHT_MODIFIERS),
    row("sym", 6, "main", bottom("ABC", "abc")),
  ],
};

export const PAGE_WINDOW: LayoutPage = {
  id: "window",
  rows: WINDOW.map((keys, index) => row("window", index, "main", keys)),
};

// The window with Fn on: the function and the navigation rows above the rows it
// always has, which are the same rows and the same cells.
export const PAGE_WINDOW_EXTENDED: LayoutPage = {
  id: "window",
  rows: [
    row("window", "fn", "main", FUNCTIONS),
    row("window", "nav", "main", NAVIGATION),
    ...PAGE_WINDOW.rows,
  ],
};

/**
 * The page `format` shows. `page` is which of a phone's two is up, and
 * `extended` whether the window's function and navigation rows are on show.
 */
export function pageFor(
  format: KeyboardFormat,
  page: PageId,
  extended: boolean,
): LayoutPage {
  if (format === "window") {
    return extended ? PAGE_WINDOW_EXTENDED : PAGE_WINDOW;
  }
  return page === "sym" ? PAGE_SYM : PAGE_ABC;
}

// Every cell of a page by id — what the press engine is handed when the page
// changes.
export function cellsOf(page: LayoutPage): ReadonlyMap<CellId, LayoutCell> {
  const cells = new Map<CellId, LayoutCell>();
  for (const r of page.rows) {
    for (const cell of r.cells) {
      cells.set(cell.id, cell);
    }
  }
  return cells;
}

/** Whether a key types a letter, which is what Caps Lock is about. */
function isLetter(def: SoftKeyDefinition): boolean {
  return def.type === "printable" && /^[a-z]$/.test(def.label);
}

/**
 * What a key shows: a letter as it will be typed, capital under Shift or under
 * Caps Lock and small under both, as on a real keyboard; any other key its
 * shifted glyph under Shift, unless the key is the shifted glyph already.
 */
export function labelOf(
  def: SoftKeyDefinition,
  shift: boolean,
  caps: boolean,
): string {
  if (def.type === "spacer") {
    return "";
  }
  if (def.type !== "printable") {
    return def.label;
  }
  if (isLetter(def)) {
    return shift !== caps ? def.label.toUpperCase() : def.label;
  }
  return shift && !def.shifted ? (def.shiftLabel ?? def.label) : def.label;
}

/**
 * The glyph in a key's corner: what Shift makes of it, while Shift is not held.
 * A letter has none, and neither has a key that is the shifted glyph itself.
 */
export function hintOf(def: SoftKeyDefinition, shift: boolean): string | null {
  if (def.type !== "printable" || shift || def.shifted) {
    return null;
  }
  return def.shiftLabel ?? null;
}

/**
 * What Caps Lock makes of the codes a press sends: the modifiers held around a
 * key, then the key.
 *
 * Caps Lock is the Shift around a letter, which is the one way a capital reaches
 * both engines alike: the wire's own `caps` flag is read by the VNC engine alone
 * (src/protocol.rs), and RDP leaves the lock to the host. With Shift held as
 * well the letter goes small, so the Shifts are left out for it. Nothing is ever
 * left locked on the remote.
 */
export function underCapsLock(
  codes: readonly string[],
  caps: boolean,
): string[] {
  const held = codes.slice(0, -1);
  const key = codes[codes.length - 1];
  // Caps Lock is about typing a letter. Under Ctrl, Alt or Super the letter is a
  // chord's, and a real Caps Lock adds no Shift to one: Ctrl+C stays Ctrl+C.
  const chord = held.some((code) => MODIFIER_KEYS.get(code)?.kind !== "shift");
  if (!caps || key === undefined || !/^Key[A-Z]$/.test(key) || chord) {
    return [...codes];
  }
  if (shiftHeld(held)) {
    return [key];
  }
  return [...held, "ShiftLeft", key];
}

/** A place or a size, in CSS pixels. */
export interface Box {
  x: number;
  y: number;
}

/**
 * Where the window may be put: wherever it was asked to go, held inside the
 * page. A window larger than the page keeps its top left corner in it.
 */
export function withinPage(wanted: Box, size: Box, page: Box): Box {
  return {
    x: Math.max(0, Math.min(wanted.x, page.x - size.x)),
    y: Math.max(0, Math.min(wanted.y, page.y - size.y)),
  };
}
