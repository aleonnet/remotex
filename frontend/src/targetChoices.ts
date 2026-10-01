// What a session is started with: whether the window drives the desktop's size,
// whether the remote's sound is taken, and whether the target's own stream is
// passed. Chosen under the target at the picker, before Start, and held for the
// life of the session — `connect` carries them and the gateway keeps them beside
// the target (src/config.rs, `Choices`).
//
// A module of its own because the rules are a pure function of three things — what
// the target's type offers (GET /api/targets), what this browser can take, and what
// was ticked last time — and the component that shows them cannot be imported
// without a browser.
//
// The rules:
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
  /** Whether the remote's sound is a choice. */
  audio: boolean;
  /** The stream this target can pass, null where it has none. */
  passthrough: Passthrough | null;
  /** Whether passing it is the only way this gateway can serve the target. */
  passthroughOnly: boolean;
}

/** What `connect` carries. */
export interface Choices {
  resize: boolean;
  audio: boolean;
  passthrough: boolean;
}

/** What this browser said it can take, as its session socket states it. */
export interface Abilities {
  appleMedia: boolean;
  rdpGraphics: boolean;
}

/** One option under an open target. */
export interface OptionRow {
  key: keyof Choices;
  label: string;
  /** What ticking it does, or why it cannot be changed here. */
  note: string;
  checked: boolean;
  disabled: boolean;
}

/** A target's options as the picker shows them. */
export interface TargetOptions {
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
  { label: string; note: string; cannot: string }
> = {
  "rdp-graphics": {
    label: "Pass the graphics pipeline through (experimental)",
    note: "The host's drawing is composed in this browser instead of encoded as video. For a LAN.",
    cannot:
      "This browser cannot compose it: that needs WebGL 2 and a cross-origin isolated page.",
  },
  "apple-media": {
    label: "Pass the Mac's stream through",
    note: "The Mac's own HEVC and AAC-ELD, instead of VP9 and Opus encoded by the gateway. For a LAN.",
    cannot: "This browser does not decode the Mac's HEVC and AAC-ELD.",
  },
};

function takes(abilities: Abilities, passthrough: Passthrough): boolean {
  return passthrough === "apple-media"
    ? abilities.appleMedia
    : abilities.rdpGraphics;
}

/**
 * The options under `target`, from what was `remembered` for it and what this
 * browser can take. Everything defaults to off: a pinned size stays the size, and
 * no remote's sound starts playing, until somebody asks.
 */
export function targetOptions(
  target: TargetInfo,
  remembered: Partial<Choices> | undefined,
  abilities: Abilities,
): TargetOptions {
  const rows: OptionRow[] = [];
  let blocked: string | null = null;
  if (target.resize) {
    rows.push({
      key: "resize",
      label: "Resize with this window",
      note: "The remote desktop follows this window's size.",
      checked: remembered?.resize ?? false,
      disabled: false,
    });
  }
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
    const words = PASSTHROUGH[target.passthrough];
    const able = takes(abilities, target.passthrough);
    if (target.passthroughOnly) {
      if (!able) {
        blocked =
          "This gateway cannot decode the Mac's stream, and this browser cannot take it passed through. Use a browser that decodes it, or install FFmpeg and fdk-aac on the gateway's host.";
      }
      rows.push({
        key: "passthrough",
        label: words.label,
        note: "This gateway cannot decode the Mac's stream, so it is always passed.",
        checked: true,
        disabled: true,
      });
    } else if (!able) {
      rows.push({
        key: "passthrough",
        label: words.label,
        note: words.cannot,
        checked: false,
        disabled: true,
      });
    } else {
      rows.push({
        key: "passthrough",
        label: words.label,
        note: words.note,
        checked: remembered?.passthrough ?? false,
        disabled: false,
      });
    }
  }
  const chosen = (key: keyof Choices) =>
    rows.find((row) => row.key === key)?.checked ?? false;
  const choices = {
    resize: chosen("resize"),
    audio: chosen("audio"),
    passthrough: chosen("passthrough"),
  };
  return {
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
 * `remembered` with `key` set for `target`, written back. Only a row somebody
 * could change is ever remembered: a greyed one says what this browser or this
 * gateway can do, which is not a choice to carry to another.
 */
export function rememberChoice(
  remembered: Record<string, Partial<Choices>>,
  target: string,
  key: keyof Choices,
  checked: boolean,
): Record<string, Partial<Choices>> {
  const next = {
    ...remembered,
    [target]: { ...remembered[target], [key]: checked },
  };
  try {
    localStorage.setItem(CHOICES_KEY, JSON.stringify(next));
  } catch {
    // Not persisted; the choice still holds for this page.
  }
  return next;
}
