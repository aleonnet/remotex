// What a session is started with: how the desktop is sized, whether the remote's
// sound is taken and as what, and whether the target's own stream is passed.
// `connect` carries them and the gateway keeps them beside the target for the
// life of the session (src/config.rs, `Choices`).
//
// A module of its own because the rules are a pure function of four things — what
// the target's type offers (GET /api/targets), what this browser can take, what
// was chosen last time, and what the page's address asks for — and the component
// that shows them cannot be imported without a browser. What it returns is said
// by the component in the language chosen: every text here is a key of the
// dictionary or a code of the error catalogue (words.ts), and a size in points is
// data, said as it is.
//
// The rules:
// - A line of the list is a computer. A Mac the gateway lists twice at one
//   address, once on a screen of its own and once mirroring its screens, is one
//   line with two modes: see `rowsOf`.
// - A line has three places, always in this order: the mode, the size, the
//   sound. Each is a glyph and what it says, and it is a key only where there is
//   another choice behind it: see `placesOf`.
// - Where the second display sits is a choice on a computer opened with two
//   virtual displays whose host is told where each goes, which no Mac is: its
//   line has no mode, and the first place is that choice. See `PLACEMENTS`.
// - The size is a choice only where the target offers this client two: see
//   `sizeOptions`.
// - Sound is brought or not where the target offers it. A Mac's media stream
//   always carries it, so there it is said and not chosen.
// - A passthrough is nobody's choice at the list. A stream is passed where it is
//   the only way this gateway can serve the target, and where the page's address
//   asks for it (`?passthrough=1`); lossless sound is asked for the same way
//   (`?sound=lossless`). See `asked`.
// - A target that can only be passed, in a browser that cannot take it, cannot
//   start, and the list says so before the remote is dialled.
// - The Mac the browser is at is not opened on a virtual display, which would
//   turn off the screens this page is on: its line stays on the mirrored mode,
//   and a line that has only a virtual display to offer cannot start. See
//   `takesItsScreens`.

import type { Code, Words } from "./words.ts";

/** The stream a target can pass untouched, as `/api/targets` names it. */
export type Passthrough = "rdp-graphics" | "apple-media";

/** One entry of GET /api/targets. */
export interface TargetInfo {
  name: string;
  protocol: string;
  // The target's `subtype` where it has one, null otherwise. Four entries in this
  // list can say `vnc` and mean a plain server, a wlshare one, a Mac sharing its
  // physical displays, and a Mac on one virtual display it will disable them for —
  // which is a difference somebody is choosing between here, not discovering
  // after connecting. See `kind` and `macMode`.
  subtype: string | null;
  host: string;
  port: number;
  /**
   * What the gateway's own computer calls itself, where the target is that very
   * computer, and null for a target anywhere else. The line is named by it.
   */
  computer: string | null;
  /**
   * Whether the browser that asked is at that very computer: the screens a
   * session would take are the ones this page is on. See `takesItsScreens`.
   */
  here: boolean;
  /** Whether the window can drive the desktop's size. */
  resize: boolean;
  /** The size the operator configured for the target, null where there is none. */
  size: Points | null;
  /**
   * The size a session keeps where none is configured. Null on a target no
   * session states a size for: a Mac sharing its physical displays.
   */
  defaultSize: Points | null;
  /** Whether the remote's sound is a choice. */
  audio: boolean;
  /** The stream this target can pass, null where it has none. */
  passthrough: Passthrough | null;
  /**
   * Whether passing it is the only way this gateway can serve the target: a High
   * Performance Mac on a host that cannot decode its stream. Never an RDP host,
   * whose pipeline every gateway composes itself.
   */
  passthroughOnly: boolean;
  /** Whether where the second virtual display sits is a choice. */
  placement: boolean;
}

/** A desktop size in points. */
export interface Points {
  w: number;
  h: number;
}

/**
 * How a session's desktop is sized, as `connect` names it: kept at the target's
 * size (the configured one, or the default where it has none), kept at the
 * default on a target that configures another, or driven by this client's window.
 */
export type Sizing = "target" | "default" | "window";

/**
 * Whether a session takes the remote's sound, as `connect` names it, and what
 * the sound is sent as: Opus, or lossless as FLAC.
 */
export type Sound = "off" | "opus" | "flac";

/**
 * Where the second of two virtual displays sits against the first, as `connect`
 * names it.
 */
export type Placement = "right" | "left" | "top" | "bottom";

/** What `connect` carries. */
export interface Choices {
  size: Sizing;
  audio: Sound;
  passthrough: boolean;
  placement: Placement;
}

/** What this browser can do with a target. */
export interface Abilities {
  /** What it said it can take, as its session socket states it. */
  appleMedia: boolean;
  rdpGraphics: boolean;
  /**
   * What of this client a desktop can follow: its window on a desktop browser, its
   * screen, asked for once, on a tablet, and nothing on a phone, whose window is
   * no desktop's shape.
   */
  follows: "window" | "screen" | null;
  /** A touch client, whose picture is fitted to its width whatever its size. */
  fitted: boolean;
}

/** What the page's address asks for, which no screen offers. */
export interface Asked {
  /** `?passthrough=1`: pass the target's own stream, where this browser takes it. */
  passthrough: boolean;
  /** `?sound=lossless`: a sound that is brought is sent lossless. */
  lossless: boolean;
}

/**
 * What the page's address asks for. The three things the engine can do and the
 * list does not offer are reached this way, as the software HEVC decoder is
 * (`?hevc_decoder=software`, appleMedia.ts): a Mac's video passed through, a
 * Windows host's drawing passed through, and lossless sound.
 */
export function asked(search: string): Asked {
  const query = new URLSearchParams(search);
  return {
    passthrough: query.get("passthrough") === "1",
    lossless: query.get("sound") === "lossless",
  };
}

/** The two ways a Mac is opened over its media stream. */
export type MacMode = "virtual" | "mirror";

/**
 * Which of a Mac's two modes `target` is: a screen of its own, which leaves the
 * Mac without picture and without sound, or its own screens mirrored. Null for
 * anything else, a Mac in the compatible mode included.
 */
export function macMode(target: TargetInfo): MacMode | null {
  if (target.protocol !== "vnc") {
    return null;
  }
  if (target.subtype === "ard-high-performance") {
    return "virtual";
  }
  return target.subtype === "ard-mirror" ? "mirror" : null;
}

/**
 * A Mac in the compatible mode on a screen of its own, which `/api/targets` shows
 * as an `ard` target that keeps a size, since only a virtual display has one to
 * keep.
 */
function compatibleOwn(target: TargetInfo): boolean {
  return (
    target.protocol === "vnc" &&
    target.subtype === "ard" &&
    target.defaultSize !== null
  );
}

/**
 * Whether a session on `target` would take the screens this page is on: the Mac
 * is the one the browser is at, and the session puts it on a virtual display,
 * which turns its own screens off for as long. That is the virtual mode and the
 * compatible one on a screen of its own, and neither is opened from that Mac:
 * the window that asked would go dark with the rest.
 */
function takesItsScreens(target: TargetInfo): boolean {
  return (
    target.here && (macMode(target) === "virtual" || compatibleOwn(target))
  );
}

// Why a target that would take the screens this page is on cannot start here.
const AT_THIS_MAC: Code = "AL-2602";

const OTHER: Record<MacMode, MacMode> = {
  virtual: "mirror",
  mirror: "virtual",
};

/** A line of the list: a computer, and the target or the two it is opened by. */
export interface Row {
  /** The name the line is listed under. */
  name: string;
  /**
   * One target, or a Mac's two at one address: the virtual one, then the
   * mirrored one.
   */
  targets: TargetInfo[];
}

// What stands between the words of a target's name.
const SEPARATOR = /[\s\-_.]/;

/**
 * The name two targets of one Mac share: what both names begin with, up to the
 * end of a word, without the separator after it. Where they share no whole word,
 * the name of the first.
 */
function sharedName(first: string, second: string): string {
  let length = 0;
  while (
    length < first.length &&
    length < second.length &&
    first[length] === second[length]
  ) {
    length += 1;
  }
  // Back to the end of a word, where the names part inside one.
  const whole = (name: string) =>
    length === name.length || SEPARATOR.test(name[length]);
  while (
    length > 0 &&
    !(whole(first) && whole(second)) &&
    !SEPARATOR.test(first[length - 1])
  ) {
    length -= 1;
  }
  const shared = first
    .slice(0, length)
    .replace(new RegExp(`${SEPARATOR.source}+$`), "");
  return shared === "" ? first : shared;
}

/**
 * The lines of the list for what the gateway lists, in its order. Two targets
 * of a Mac at one address and port, one in each mode, are one line, where the
 * first of them stands. Everything else is a line of its own: a Windows host, a
 * Linux one, a plain server, a Mac in the compatible mode, a Mac listed in one
 * mode only, a second target of a mode already taken there, and a Mac at
 * another port of the same address, which is another Mac behind a tunnel.
 */
export function rowsOf(targets: TargetInfo[]): Row[] {
  const taken = new Set<TargetInfo>();
  const rows: Row[] = [];
  for (const target of targets) {
    if (taken.has(target)) {
      continue;
    }
    taken.add(target);
    const mode = macMode(target);
    const other = mode
      ? targets.find(
          (candidate) =>
            !taken.has(candidate) &&
            candidate.host === target.host &&
            candidate.port === target.port &&
            macMode(candidate) === OTHER[mode],
        )
      : undefined;
    // A target that is the gateway's own computer is called what that computer
    // calls itself, whatever its config entry was named.
    if (!mode || !other) {
      rows.push({ name: target.computer ?? target.name, targets: [target] });
      continue;
    }
    taken.add(other);
    rows.push({
      name: target.computer ?? sharedName(target.name, other.name),
      targets: mode === "virtual" ? [target, other] : [other, target],
    });
  }
  return rows;
}

/**
 * The name of the line the target called `name` stands on, in what the gateway
 * lists: what a session on that target is called. Null where nothing listed has
 * the name.
 */
export function lineNameOf(targets: TargetInfo[], name: string): string | null {
  const row = rowsOf(targets).find((line) =>
    line.targets.some((target) => target.name === name),
  );
  return row?.name ?? null;
}

/** One way a target's desktop can be sized. */
export interface SizeOption {
  value: Sizing;
  /** The size, as Open will ask for it. */
  label: Words;
}

/** A target's options as the list shows them. */
export interface TargetOptions {
  /** What the computer is, in the words under its name. */
  kind: Words;
  /**
   * The ways this target's desktop can be sized here: never empty, a choice
   * where there are two, and otherwise the one size the session will have.
   */
  sizes: SizeOption[];
  /** Whether the remote's sound is a choice here. */
  soundChoice: boolean;
  /** Whether where the second display sits is a choice here. */
  placementChoice: boolean;
  /** What Open sends. */
  choices: Choices;
  /** Whether a session started with them carries the remote's sound. */
  sound: boolean;
  /**
   * What is said of the target's stream where something is: that it is passed
   * because the address asked, as words, or why it is passed or cannot be, as
   * the catalogue names the cause. Null where the stream is encoded here and
   * nobody asked otherwise.
   */
  stream: { passed: Words } | { cause: Code } | null;
  /** Why the target cannot start in this browser, as the catalogue names it, or null. */
  blocked: Code | null;
}

/**
 * What `target` is, in the words under its name. A Mac opened over its media
 * stream is a Mac, whose mode is its line's to say. A Mac in the compatible mode
 * says so, and whether on a screen of its own (`compatibleOwn`).
 *
 * A subtype this build has never heard of names itself in the config's own
 * spelling: the gateway and this page ship together, so that is a build mismatch,
 * and a line that dropped the value would describe the computer wrongly.
 */
function kind(target: TargetInfo): Words {
  if (target.protocol === "rdp") {
    return { key: "type.rdp" };
  }
  switch (target.subtype) {
    case null:
      return { key: "type.vnc" };
    case "wlshare":
      return { key: "type.wlshare" };
    case "ard-high-performance":
    case "ard-mirror":
      return { key: "type.mac" };
    case "ard":
      return compatibleOwn(target)
        ? { key: "mode.compatibleOwn" }
        : { key: "mode.compatible" };
    default:
      return { data: `${target.protocol.toUpperCase()} · ${target.subtype}` };
  }
}

const PASSTHROUGH: Record<
  Passthrough,
  {
    /** Why a browser that cannot take it cannot. */
    cannot: Code;
    // What is said where the stream can only be passed, null for a stream every
    // gateway can also encode itself: why it is passed whatever is asked, and
    // why a browser that cannot take the stream cannot start the target.
    only: { cannot: Code; blocked: Code } | null;
    /** The session's video, passed. */
    passed: Words;
  }
> = {
  "rdp-graphics": {
    cannot: "AL-2501",
    only: null,
    passed: { key: "pass.rdp.on" },
  },
  "apple-media": {
    cannot: "AL-2502",
    only: { cannot: "AL-2503", blocked: "AL-2601" },
    passed: { key: "pass.on" },
  },
};

function takes(abilities: Abilities, passthrough: Passthrough): boolean {
  return passthrough === "apple-media"
    ? abilities.appleMedia
    : abilities.rdpGraphics;
}

/**
 * Whether a target's stream is passed, what is said of it, and why the target
 * cannot start here where that stream is the only way and this browser cannot
 * take it. Nothing the list remembers enters into it.
 */
function passing(
  target: TargetInfo,
  abilities: Abilities,
  wanted: boolean,
): Pick<TargetOptions, "stream" | "blocked"> & { passthrough: boolean } {
  if (!target.passthrough) {
    return { passthrough: false, stream: null, blocked: null };
  }
  const words = PASSTHROUGH[target.passthrough];
  const able = takes(abilities, target.passthrough);
  const only = target.passthroughOnly ? words.only : null;
  if (only) {
    return {
      passthrough: true,
      stream: { cause: only.cannot },
      blocked: able ? null : only.blocked,
    };
  }
  if (!wanted) {
    return { passthrough: false, stream: null, blocked: null };
  }
  return able
    ? { passthrough: true, stream: { passed: words.passed }, blocked: null }
    : { passthrough: false, stream: { cause: words.cannot }, blocked: null };
}

const FOLLOWS: Record<"window" | "screen", SizeOption> = {
  window: { value: "window", label: { key: "size.window" } },
  screen: { value: "window", label: { key: "size.screen" } },
};

/**
 * The ways `target`'s desktop can be sized from a client that `follows`.
 *
 * - A target the window cannot drive keeps one size: the configured one, or the
 *   default.
 * - One it can drive follows a desktop browser's window or a tablet's screen, and
 *   offers the configured size beside that where there is one.
 * - A phone has nothing a desktop could follow, so there the choice is between the
 *   configured size and the default.
 * - A target that shares its displays as they are is shown at their size. Where
 *   the viewer still drives it — a Mac mirroring its screens over its media
 *   stream, whose picture the gateway fits to the viewer — that is its one size,
 *   on every client: a phone's browser fits the picture to its screen itself.
 */
function sizeOptions(
  target: TargetInfo,
  follows: Abilities["follows"],
): SizeOption[] {
  if (!target.defaultSize) {
    return [
      target.resize
        ? FOLLOWS[follows ?? "screen"]
        : { value: "target", label: { key: "size.asis.plain" } },
    ];
  }
  const kept = (size: Points, value: Sizing): SizeOption => ({
    value,
    label: { data: `${size.w} × ${size.h}` },
  });
  const configured = target.size ? [kept(target.size, "target")] : [];
  if (target.resize && follows) {
    return [...configured, FOLLOWS[follows]];
  }
  if (target.size === null) {
    return [kept(target.defaultSize, "target")];
  }
  return target.resize
    ? [...configured, kept(target.defaultSize, "default")]
    : configured;
}

// The second display against the first, in the order its key goes round: the
// edge of the first a window dragged over arrives on the second from. The right
// is where it has always been.
const PLACEMENTS: readonly Placement[] = ["right", "left", "top", "bottom"];

/**
 * What `target` is opened with, from what was `remembered` for it, what this
 * browser can do and what the page's address `asks`. A size the operator
 * configured is the size until somebody chooses another, and no remote's sound
 * starts playing until somebody asks. A sound that is brought is Opus, and
 * lossless only where the address asks. What an older page remembered of a
 * passthrough or of a format is not a choice any more, and is not sent. A target
 * that would take the screens this page is on does not start, whatever this
 * browser can take.
 */
export function targetOptions(
  target: TargetInfo,
  remembered: Partial<Choices> | undefined,
  abilities: Abilities,
  asks: Asked,
): TargetOptions {
  const sizes = sizeOptions(target, abilities.follows);
  const size =
    sizes.find((option) => option.value === remembered?.size)?.value ??
    sizes[0].value;
  const brought =
    target.audio &&
    (remembered?.audio === "opus" || remembered?.audio === "flac");
  const audio: Sound = !brought ? "off" : asks.lossless ? "flac" : "opus";
  const passed = passing(target, abilities, asks.passthrough);
  // The second display is on the right until somebody puts it elsewhere, and
  // always where its place is not a choice.
  const placement =
    (target.placement &&
      PLACEMENTS.find((place) => place === remembered?.placement)) ||
    "right";
  return {
    kind: kind(target),
    sizes,
    soundChoice: target.audio,
    placementChoice: target.placement,
    choices: { size, audio, passthrough: passed.passthrough, placement },
    // A Mac's media stream carries its sound with its picture, always.
    sound: audio !== "off" || macMode(target) !== null,
    stream: passed.stream,
    blocked: takesItsScreens(target) ? AT_THIS_MAC : passed.blocked,
  };
}

/** What the monitor of a line shows of the picture that will arrive. */
export type Here =
  /** The remote's screen is this window's size, and fills it. */
  | "fill"
  /** The picture is fitted inside this window, with room left beside it. */
  | "fit"
  /** The picture is larger than this window, and scrolls. */
  | "over";

/**
 * What the monitor shows for `target` opened with `options`. A desktop that
 * follows the window fills it. A Mac mirroring its screens is fitted to it by
 * the gateway, save a passed stream, which is never fitted. Any other size is
 * the remote's own: larger than the window with a pointer, and fitted to its
 * width on a touch client.
 */
export function hereOf(
  target: TargetInfo,
  options: TargetOptions,
  abilities: Abilities,
): Here {
  const { size, passthrough } = options.choices;
  const own = abilities.fitted ? "fit" : "over";
  if (size !== "window") {
    return own;
  }
  if (macMode(target) !== "mirror") {
    return "fill";
  }
  return passthrough ? own : "fit";
}

/** The glyph of a place, by its name in Glyph.tsx. */
export type PlaceGlyph =
  | "mode-virtual"
  | "mode-mirror"
  | "fit"
  | "one-to-one"
  | "volume-2"
  | "volume-x"
  | `second-${Placement}`;

/** One of the three places at the base of a line's monitor. */
export interface Place {
  opt: "mode" | "place" | "size" | "sound";
  glyph: PlaceGlyph;
  /** What it says: its line of the tip, and its name to a screen reader. */
  says: Words;
  /** Whether there is another choice behind it: a key, as against a mark. */
  key: boolean;
}

/** What the sound's place says: a Mac's is always there, and the rest is the choice. */
function soundSays(target: TargetInfo, options: TargetOptions): Words {
  if (macMode(target)) {
    return { key: "list.says.sound.always" };
  }
  if (!options.soundChoice) {
    return { key: "sound.none" };
  }
  if (options.choices.audio === "off") {
    return { key: "sound.off" };
  }
  return {
    key: options.choices.audio === "flac" ? "sound.flac" : "list.says.sound.on",
  };
}

/** The size's place: the glyph, what it says, and whether it is a key. */
function sizePlace(
  target: TargetInfo,
  options: TargetOptions,
  abilities: Abilities,
): Place {
  const { choices, sizes } = options;
  const mirrored = macMode(target) === "mirror";
  // A passed stream is never fitted: a Mac mirroring its screens is shown at
  // their own size then, whatever the window was asked to be.
  const unfitted = mirrored && choices.passthrough;
  const sizing = unfitted ? "target" : choices.size;
  const size = sizes.find((option) => option.value === sizing) ?? sizes[0];
  const follows = sizing === "window";
  const fitted: Words = {
    key:
      abilities.follows === "window"
        ? "list.says.fitted.window"
        : "list.says.fitted.screen",
  };
  const says = (): Words => {
    if (unfitted) {
      return { key: "size.asis.plain" };
    }
    return mirrored && follows ? fitted : size.label;
  };
  return {
    opt: "size",
    glyph: follows ? "fit" : "one-to-one",
    says: says(),
    key: sizes.length > 1 && !unfitted,
  };
}

/**
 * The three places of a line, in their order, for the `target` of the mode it is
 * on, opened with `options`. `modes` is whether the line has both of a Mac's
 * modes to choose between. A place that does not apply is null and keeps its
 * room: a computer that is no Mac has no mode. One that is opened with two
 * displays and is told where the second goes has that choice there instead, a
 * key that goes round the four sides. The Mac the browser is at has both modes
 * listed and one to be on (`modeOf`), so there the mode is a mark, and says why
 * the other is not offered.
 */
export function placesOf(
  target: TargetInfo,
  options: TargetOptions,
  abilities: Abilities,
  modes: boolean,
): [Place | null, Place, Place] {
  const mode = macMode(target);
  const held = modes && target.here;
  const says = (): Words => {
    if (mode === "virtual") {
      return { key: "list.says.virtual" };
    }
    return { key: held ? "list.says.mirror.here" : "list.says.mirror" };
  };
  const { placement } = options.choices;
  const first: Place | null = mode
    ? {
        opt: "mode",
        glyph: mode === "virtual" ? "mode-virtual" : "mode-mirror",
        says: says(),
        key: modes && !held,
      }
    : options.placementChoice
      ? {
          opt: "place",
          glyph: `second-${placement}`,
          says: { key: `list.says.second.${placement}` },
          key: true,
        }
      : null;
  return [
    first,
    sizePlace(target, options, abilities),
    {
      opt: "sound",
      glyph: options.sound ? "volume-2" : "volume-x",
      says: soundSays(target, options),
      key: options.soundChoice,
    },
  ];
}

/** What somebody can choose on a line, one at a time. */
export type Chosen =
  | Pick<Choices, "size">
  | Pick<Choices, "audio">
  | Pick<Choices, "placement">;

/**
 * What pressing the size's key, the sound's or the second display's chooses:
 * the size after the one chosen, round again to the first; the sound brought
 * or not; and the side after the one the second display is on, round again.
 */
export function pressed(
  options: TargetOptions,
  opt: "size" | "sound" | "place",
): Chosen {
  if (opt === "sound") {
    return { audio: options.choices.audio === "off" ? "opus" : "off" };
  }
  if (opt === "place") {
    const on = PLACEMENTS.indexOf(options.choices.placement);
    return { placement: PLACEMENTS[(on + 1) % PLACEMENTS.length] };
  }
  const at = options.sizes.findIndex(
    (size) => size.value === options.choices.size,
  );
  return { size: options.sizes[(at + 1) % options.sizes.length].value };
}

// Remembered in this browser, as lasting choices about how each desktop is used
// from this machine: localStorage rather than sessionStorage, so they survive a
// new tab. A target's size, its sound and where its second display sits are kept
// under its name, and the mode a two-mode Mac was last opened in under the name
// of its virtual target.
const CHOICES_KEY = "alumia.targetChoices";
const MODES_KEY = "alumia.rowModes";

function readStored<T>(key: string): Record<string, T> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    return stored !== null && typeof stored === "object"
      ? (stored as Record<string, T>)
      : {};
  } catch {
    return {}; // storage disabled or blocked, or not what this wrote
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not persisted; the choice still holds for this page.
  }
}

/** Every target's remembered choices, by name. Empty where nothing can be read. */
export function readRememberedChoices(): Record<string, Partial<Choices>> {
  return readStored<Partial<Choices>>(CHOICES_KEY);
}

/**
 * `remembered` with what was chosen set for `target`, written back. Only what
 * somebody could choose is ever remembered.
 */
export function rememberChoice(
  remembered: Record<string, Partial<Choices>>,
  target: string,
  choice: Chosen,
): Record<string, Partial<Choices>> {
  const next = {
    ...remembered,
    [target]: { ...remembered[target], ...choice },
  };
  writeStored(CHOICES_KEY, next);
  return next;
}

/** The mode each two-mode Mac was last on, by its line's key. */
export function readRememberedModes(): Record<string, MacMode> {
  return readStored<MacMode>(MODES_KEY);
}

/** What a two-mode Mac's mode is remembered under: its virtual target's name. */
export function rowKey(row: Row): string {
  return row.targets[0].name;
}

/**
 * The mode a line is on: the one remembered for it, and the virtual one the
 * first time. A line with one target is on that target's, and the line of the
 * Mac the browser is at is on the mirrored one, whatever is remembered: the
 * virtual one would take the screens this page is on.
 */
export function modeOf(
  row: Row,
  remembered: Record<string, MacMode>,
): TargetInfo {
  if (row.targets.length < 2) {
    return row.targets[0];
  }
  const [virtual, mirrored] = row.targets;
  if (takesItsScreens(virtual)) {
    return mirrored;
  }
  return remembered[rowKey(row)] === "mirror" ? mirrored : virtual;
}

/** `remembered` with `row` on `mode`, written back. */
export function rememberMode(
  remembered: Record<string, MacMode>,
  row: Row,
  mode: MacMode,
): Record<string, MacMode> {
  const next = { ...remembered, [rowKey(row)]: mode };
  writeStored(MODES_KEY, next);
  return next;
}
