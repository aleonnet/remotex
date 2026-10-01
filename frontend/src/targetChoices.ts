// What a session is started with: how the desktop is sized, whether the remote's
// sound is taken, and whether the target's own stream is passed. Chosen under the
// target at the picker, before Start, and held for the life of the session —
// `connect` carries them and the gateway keeps them beside the target
// (src/config.rs, `Choices`).
//
// A module of its own because the rules are a pure function of three things — what
// the target's type offers (GET /api/targets), what this browser can take, and what
// was chosen last time — and the component that shows them cannot be imported
// without a browser.
//
// The rules:
// - The size a session will have is always shown, and is a choice only where
//   there are two: see `sizeOptions`.
// - An option the target's type does not offer has no row.
// - One it offers that cannot be had here is greyed, with the reason: a
//   passthrough this browser cannot take, or one that is the only way this gateway
//   can serve the target, which is then shown ticked.
// - A target that can only be passed, in a browser that cannot take it, cannot
//   start, and Start says so before the remote is dialled.

/** The stream a target can pass untouched, as `/api/targets` names it. */
export type Passthrough = "rdp-graphics" | "apple-media";

/** One entry of GET /api/targets. */
export interface TargetInfo {
  name: string;
  protocol: string;
  // The target's `subtype` where it has one, null otherwise. Shown because four
  // entries in this list can say `vnc` and mean a plain server, a wlshare one, a
  // Mac sharing its physical displays, and a Mac on one virtual display it will
  // disable them for — which is a difference somebody is choosing between here,
  // not discovering after connecting. See connectionLabel.ts.
  subtype: string | null;
  host: string;
  port: number;
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

/** What `connect` carries. */
export interface Choices {
  size: Sizing;
  audio: boolean;
  passthrough: boolean;
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
}

/** One way a target's desktop can be sized. */
export interface SizeOption {
  value: Sizing;
  /** The size, as Start will ask for it. */
  label: string;
  note: string;
}

/** One option under an open target. */
export interface OptionRow {
  key: "audio" | "passthrough";
  label: string;
  /** What ticking it does, or why it cannot be changed here. */
  note: string;
  checked: boolean;
  disabled: boolean;
}

/** A target's options as the picker shows them. */
export interface TargetOptions {
  /**
   * The ways this target's desktop can be sized here: never empty, a choice
   * where there are two, and otherwise the one size the session will have.
   */
  sizes: SizeOption[];
  rows: OptionRow[];
  /** What Start sends. */
  choices: Choices;
  /** Whether a session started with them carries the remote's sound. */
  sound: boolean;
  /** Why the target cannot start in this browser, or null. */
  blocked: string | null;
}

const PASSTHROUGH: Record<
  Passthrough,
  {
    label: string;
    note: string;
    cannot: string;
    // What is said where the stream can only be passed, null for a stream every
    // gateway can also encode itself.
    only: { note: string; blocked: string } | null;
  }
> = {
  "rdp-graphics": {
    label: "Pass the graphics pipeline through (experimental)",
    note: "The host's drawing is composed in this browser instead of encoded as video. For a LAN.",
    cannot:
      "This browser cannot compose it: that needs WebGL 2 and a cross-origin isolated page.",
    only: null,
  },
  "apple-media": {
    label: "Pass the Mac's stream through",
    note: "The Mac's own HEVC and AAC-ELD, instead of VP9 and Opus encoded by the gateway. For a LAN.",
    cannot: "This browser does not decode the Mac's HEVC and AAC-ELD.",
    only: {
      note: "This gateway cannot decode the Mac's stream, so it is always passed.",
      blocked:
        "This gateway cannot decode the Mac's stream, and this browser cannot take it passed through. Use a browser that decodes it, or install FFmpeg and fdk-aac on the gateway's host.",
    },
  },
};

function takes(abilities: Abilities, passthrough: Passthrough): boolean {
  return passthrough === "apple-media"
    ? abilities.appleMedia
    : abilities.rdpGraphics;
}

/**
 * The passthrough row of a target that has a stream to pass, and why the target
 * cannot start here where that stream is the only way and this browser cannot
 * take it.
 */
function passthroughRow(
  passthrough: Passthrough,
  passthroughOnly: boolean,
  remembered: boolean | undefined,
  abilities: Abilities,
): { row: OptionRow; blocked: string | null } {
  const words = PASSTHROUGH[passthrough];
  const able = takes(abilities, passthrough);
  const only = passthroughOnly ? words.only : null;
  const row = { key: "passthrough" as const, label: words.label };
  if (only) {
    return {
      row: { ...row, note: only.note, checked: true, disabled: true },
      blocked: able ? null : only.blocked,
    };
  }
  if (!able) {
    return {
      row: { ...row, note: words.cannot, checked: false, disabled: true },
      blocked: null,
    };
  }
  return {
    row: {
      ...row,
      note: words.note,
      checked: remembered ?? false,
      disabled: false,
    },
    blocked: null,
  };
}

const FOLLOWS: Record<"window" | "screen", SizeOption> = {
  window: {
    value: "window",
    label: "This window's size",
    note: "The desktop follows the window as it changes.",
  },
  screen: {
    value: "window",
    label: "This screen's size",
    note: "Asked for once, in landscape. Rotating does not change it.",
  },
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
 */
function sizeOptions(
  target: TargetInfo,
  follows: Abilities["follows"],
): SizeOption[] {
  if (!target.defaultSize) {
    return [
      {
        value: "target",
        label: "The remote's own size",
        note: "This target shares its displays as they are.",
      },
    ];
  }
  // A plain VNC server is asked, and whether it takes a size is known only once
  // it is dialled.
  const asked =
    target.protocol === "vnc" && target.subtype === null
      ? " A server that takes no size keeps its own."
      : "";
  const kept = (size: Points, value: Sizing, what: string): SizeOption => ({
    value,
    label: `${size.w}×${size.h}`,
    note: `${what} The desktop stays at it.${asked}`,
  });
  const configured = target.size
    ? [kept(target.size, "target", "The size set for this target.")]
    : [];
  if (target.resize && follows) {
    return [...configured, FOLLOWS[follows]];
  }
  if (target.size === null) {
    return [kept(target.defaultSize, "target", "The default size.")];
  }
  return target.resize
    ? [...configured, kept(target.defaultSize, "default", "The default size.")]
    : configured;
}

/**
 * The options under `target`, from what was `remembered` for it and what this
 * browser can do. A size the operator configured is the size until somebody
 * chooses another, and no remote's sound starts playing until somebody asks.
 */
export function targetOptions(
  target: TargetInfo,
  remembered: Partial<Choices> | undefined,
  abilities: Abilities,
): TargetOptions {
  const sizes = sizeOptions(target, abilities.follows);
  const size =
    sizes.find((option) => option.value === remembered?.size)?.value ??
    sizes[0].value;
  const rows: OptionRow[] = [];
  let blocked: string | null = null;
  if (target.audio) {
    rows.push({
      key: "audio",
      label: "Sound",
      note: "Take the remote's sound and play it here.",
      checked: remembered?.audio ?? false,
      disabled: false,
    });
  }
  if (target.passthrough) {
    const passed = passthroughRow(
      target.passthrough,
      target.passthroughOnly,
      remembered?.passthrough,
      abilities,
    );
    rows.push(passed.row);
    blocked = passed.blocked;
  }
  const chosen = (key: OptionRow["key"]) =>
    rows.find((row) => row.key === key)?.checked ?? false;
  const choices = {
    size,
    audio: chosen("audio"),
    passthrough: chosen("passthrough"),
  };
  return {
    sizes,
    rows,
    choices,
    // High Performance's sound comes with its picture, so it has no row and is
    // always there.
    sound: choices.audio || target.passthrough === "apple-media",
    blocked,
  };
}

// Remembered per target, in this browser, as lasting choices about how each
// desktop is used from this machine: localStorage rather than sessionStorage, so
// they survive a new tab.
const CHOICES_KEY = "remotex.targetChoices";

/** Every target's remembered choices, by name. Empty where nothing can be read. */
export function readRememberedChoices(): Record<string, Partial<Choices>> {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(CHOICES_KEY) ?? "{}",
    );
    return stored !== null && typeof stored === "object"
      ? (stored as Record<string, Partial<Choices>>)
      : {};
  } catch {
    return {}; // storage disabled or blocked, or not what this wrote
  }
}

/**
 * `remembered` with `key` set for `target`, written back. Only a choice somebody
 * could change is ever remembered: a greyed row says what this browser or this
 * gateway can do, which is not a choice to carry to another.
 */
export function rememberChoice<K extends keyof Choices>(
  remembered: Record<string, Partial<Choices>>,
  target: string,
  key: K,
  value: Choices[K],
): Record<string, Partial<Choices>> {
  const next = {
    ...remembered,
    [target]: { ...remembered[target], [key]: value },
  };
  try {
    localStorage.setItem(CHOICES_KEY, JSON.stringify(next));
  } catch {
    // Not persisted; the choice still holds for this page.
  }
  return next;
}
