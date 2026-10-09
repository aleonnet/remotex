// The rules of the session's screens, with no screen in them.
//
// What the page shows between the list of computers and a picture, what the bar
// and its menu offer, what the handle says, what covers the remote screen, and
// when the remote takes no input: each is decided here from what the page's
// session engine holds (useRemoteDesktop.ts), by a function a test calls without
// a browser. The components draw the answer and decide nothing.

import type { ConnectionStatus, SessionMode } from "./useRemoteDesktop.ts";

/** A state of the screen that lights, in the mockup's words. */
export type Opening = "connecting" | "settled" | "waiting" | "reconnecting";

/**
 * Whose the session is, when it is not this page's to show. On a page that shows
 * a display in a tab of its own, whose that display is: in use in another tab,
 * taken over by one, asked by this tab's own bar to stop being shown here
 * (`idle`), or not shown in a tab by the session at all (`unavailable`).
 */
export type Owner =
  | "busy"
  | "taken"
  | "failed"
  | "stale"
  | "idle"
  | "unavailable";

/** What the engine holds, as far as the screens ask. */
export interface Now {
  status: ConnectionStatus;
  mode: SessionMode;
  /** The computer an Open is waiting on. */
  pendingTarget: string | null;
  /** Whether the remote has announced its desktop: there is a picture to show. */
  pictured: boolean;
  /** Whether this page opened the session it is on, as against finding it open. */
  openedHere: boolean;
  /** Whether five seconds have passed since that Open. */
  settled: boolean;
  /**
   * The display this page shows in a tab of its own, beside the session another
   * tab of this browser holds; null on the page that holds the session.
   */
  tab: number | null;
}

/** What the page shows. */
export type View =
  | { kind: "list" }
  /**
   * The screen lighting. `cancel` is whether there is something to cancel and
   * a way to: a computer chosen, and the connection up to carry the request.
   */
  | { kind: "opening"; state: Opening; cancel: boolean }
  | { kind: "owner"; state: Owner }
  | { kind: "session" };

const OWNERS: Partial<Record<ConnectionStatus, Owner>> = {
  busy: "busy",
  takenOver: "taken",
  failed: "failed",
  stale: "stale",
  idle: "idle",
  unavailable: "unavailable",
};

/**
 * What the page shows for what the engine holds.
 *
 * The four states of the lighting:
 *   - connecting: the page is asking the gateway for the session as it loads,
 *     or Open was just pressed;
 *   - settled: five seconds after that Open, with no picture yet;
 *   - waiting: the page attached to a session that was already open (a reload,
 *     or back from a drop) whose picture has not arrived;
 *   - reconnecting: the connection to the gateway dropped. Nothing can be
 *     cancelled then: ending a session goes over that connection, and the list
 *     exists only with it up.
 *
 * A display's tab has no list and holds no session: it shows its display or
 * waits for it, and has nothing to cancel, since ending the session is the
 * session's page's to do.
 */
export function viewOf(now: Now): View {
  const owner = OWNERS[now.status];
  if (owner) {
    return { kind: "owner", state: owner };
  }
  if (now.status === "connecting") {
    return { kind: "opening", state: "connecting", cancel: false };
  }
  if (now.status === "reconnecting") {
    return { kind: "opening", state: "reconnecting", cancel: false };
  }
  if (now.tab !== null) {
    if (now.mode === "desktop" && now.pictured) {
      return { kind: "session" };
    }
    return {
      kind: "opening",
      state: now.mode === "desktop" ? "waiting" : "connecting",
      cancel: false,
    };
  }
  const lighting: Opening = now.settled ? "settled" : "connecting";
  if (now.mode === "picker") {
    return now.pendingTarget === null
      ? { kind: "list" }
      : { kind: "opening", state: lighting, cancel: true };
  }
  if (now.pictured) {
    return { kind: "session" };
  }
  return {
    kind: "opening",
    state: now.openedHere ? lighting : "waiting",
    cancel: true,
  };
}

/** A moment played over a session: the grid leaving, or the picture going dark. */
export type Played = "dissolve" | "off";

/**
 * The moment to play as the view changes from `was` to `now`, given the one
 * `pending`. The grid leaves as a picture arrives behind the lighting. Not when
 * the session starts `covered`, its picture not yet come (Waiting.tsx): the lit
 * screen stays up as the cover, and the grid leaves when the cover does, once.
 * An End that was pressed is not forgotten by a connection that drops while the
 * picture goes dark: it is played, and so carried out, when the session is
 * back. Off a session altogether there is nothing to play.
 */
export function momentOf(
  pending: Played | null,
  was: View["kind"],
  now: View["kind"],
  covered: boolean,
): Played | null {
  if (now === "list" || now === "owner") {
    return null;
  }
  if (pending === "off") {
    return "off";
  }
  return was === "opening" && now === "session" && !covered ? "dissolve" : null;
}

/** What the computer and this device offer, as far as the bar asks. */
export interface Offers {
  /** The browser grants the page a full screen of its own. */
  fullscreen: boolean;
  /** How many displays the remote lists: none, for one that offers no choice. */
  displays: number;
  /** The session carries the remote's sound. */
  sound: boolean;
  camera: boolean;
  microphone: boolean;
  /** This keyboard has a Command key, which is what the Mac keys are about. */
  macHost: boolean;
  /** The host takes touch contacts, and this device has fingers to offer. */
  touch: boolean;
  /** The page is installed as an app, whose window is the page's to resize. */
  appWindow: boolean;
  /** A pointer client, as against the one whose picture fits its width. */
  pointer: boolean;
  /** The display this page shows in a tab of its own, or null on the session's page. */
  tab: number | null;
}

/** Something on the bar: a button, or what a display's tab says of its size. */
export type BarItem =
  | "fullscreen"
  | "displays"
  | "mute"
  | "keyboard"
  | "more"
  | "end"
  | "size"
  | "disconnect";

/**
 * The bar's buttons. One that has nothing to act on is absent, not greyed: a
 * session without sound has none to mute, and a remote with one screen has no
 * list to choose from.
 *
 * A display's tab has what is that tab's and no more: its own full screen, what
 * its display is drawn at, and the way to stop showing it here. The sound, the
 * clipboard and End are the session's page's. So is the keyboard on screen where
 * there is a keyboard to type on; on a device with none, a tab without it could
 * be pointed at and not typed in, so there it is the tab's too.
 */
export function barItems(offers: Offers): BarItem[] {
  if (offers.tab !== null) {
    const items: (BarItem | false)[] = [
      offers.fullscreen && "fullscreen",
      "size",
      !offers.pointer && "keyboard",
      "disconnect",
    ];
    return items.filter((item) => item !== false);
  }
  const items: (BarItem | false)[] = [
    offers.fullscreen && "fullscreen",
    offers.displays > 1 && "displays",
    offers.sound && "mute",
    "keyboard",
    "more",
    "end",
  ];
  return items.filter((item) => item !== false);
}

/** An item of the bar's menu. */
export type MoreItem =
  | "clipboard"
  | "camera"
  | "microphone"
  | "mackeys"
  | "touch"
  | "window"
  | "info"
  | "prefs"
  | "signout";

/**
 * The menu's items, under the same rule as the bar's. The window can be fitted
 * only where it is the page's to resize and the picture is shown at 100%: an
 * installed app, with a pointer.
 */
export function moreItems(offers: Offers): MoreItem[] {
  const items: (MoreItem | false)[] = [
    "clipboard",
    offers.camera && "camera",
    offers.microphone && "microphone",
    offers.macHost && "mackeys",
    offers.touch && "touch",
    offers.appWindow && offers.pointer && "window",
    "info",
    "prefs",
    "signout",
  ];
  return items.filter((item) => item !== false);
}

/** A camera or a microphone, as its item says it. */
export type OfferState =
  /** Not offered to the remote. */
  | "off"
  /** Offered, and no program over there has opened it. */
  | "waiting"
  /** A program over there is using it now. */
  | "inuse";

export function offerState(offered: boolean, streaming: boolean): OfferState {
  if (!offered) {
    return "off";
  }
  return streaming ? "inuse" : "waiting";
}

/** The Mac keys, as their item says them. */
export type MacKeysState =
  | "on"
  | "off"
  /** The remote is a Mac, where Command is sent as Command whatever is chosen. */
  | "na";

export function macKeysState(
  enabled: boolean,
  remoteIsMac: boolean,
): MacKeysState {
  if (remoteIsMac) {
    return "na";
  }
  return enabled ? "on" : "off";
}

/**
 * How the bar's Mute button is drawn: the crossed speaker while it is pressed,
 * which is this browser not listening, and the speaker otherwise.
 */
export function muteGlyph(muted: boolean): "volume-2" | "volume-x" {
  return muted ? "volume-x" : "volume-2";
}

/**
 * Whether the session's sound is muted here: the session carries it, this
 * browser is not listening, and nothing is wrong with it. A sound that failed
 * is a problem, and marked as one.
 */
export function mutedHere(sound: {
  available: boolean;
  enabled: boolean;
  fault: object | null;
}): boolean {
  return sound.available && !sound.enabled && sound.fault === null;
}

/** A mark on the handle, for what stays in sight with the bar closed. */
export type HandleMark = "camera" | "microphone" | "muted" | "error";

/** The handle: its marks, and what it says to somebody who cannot see them. */
export interface Handle {
  marks: HandleMark[];
  says:
    | "session.handle"
    | "session.handle.inuse"
    | "session.handle.camera"
    | "session.handle.microphone"
    | "session.handle.muted"
    | "session.handle.error"
    | "session.handle.display";
  /** The display a tab of its own shows, which its handle wears as a number. */
  display: number | null;
}

/**
 * What the handle shows and says. In use is the remote using it now, not merely
 * offered it. A problem is said ahead of what is in use, because it is the one
 * that asks for something. Muted is the session's sound not listened to here,
 * with nothing wrong with it: it is marked whatever else is, and said when
 * nothing else is, since it asks for nothing. The handle of a display's tab says
 * which display's bar it opens; a problem there still leaves its mark.
 */
export function handleOf(state: {
  cameraInUse: boolean;
  microphoneInUse: boolean;
  muted: boolean;
  problem: boolean;
  display: number | null;
}): Handle {
  const { display } = state;
  if (display !== null) {
    return {
      marks: state.problem ? ["error"] : [],
      says: "session.handle.display",
      display,
    };
  }
  const marks: HandleMark[] = [];
  if (state.cameraInUse) {
    marks.push("camera");
  }
  if (state.microphoneInUse) {
    marks.push("microphone");
  }
  if (state.muted) {
    marks.push("muted");
  }
  if (state.problem) {
    return {
      marks: [...marks, "error"],
      says: "session.handle.error",
      display,
    };
  }
  if (state.cameraInUse && state.microphoneInUse) {
    return { marks, says: "session.handle.inuse", display };
  }
  if (state.cameraInUse) {
    return { marks, says: "session.handle.camera", display };
  }
  if (state.microphoneInUse) {
    return { marks, says: "session.handle.microphone", display };
  }
  if (state.muted) {
    return { marks, says: "session.handle.muted", display };
  }
  return { marks, says: "session.handle", display };
}

/** What can be open over the remote screen, hanging from the bar. */
export type Open =
  | "more"
  | "clipboard"
  | "displays"
  | "info"
  | "prefs"
  | "throughput";

const VEILS = {
  more: "veil.menu",
  clipboard: "veil.clipboard",
  displays: "veil.displays",
  info: "veil.info",
  prefs: "veil.prefs",
  throughput: "veil.throughput",
} as const;

/**
 * What the "view only" line names: what is open over the remote screen, or null
 * when nothing is. The bar by itself is not: it is the remote's own controls,
 * and so is the keyboard, which is input.
 */
export function veilOf(open: Open | null): (typeof VEILS)[Open] | null {
  return open ? VEILS[open] : null;
}

/**
 * Whether the remote takes no input: something is open over it, or a dialog is
 * asking. The remote then keeps painting and is sent no key and no pointer, and
 * the automatic clipboard stands down (useRemoteDesktop.ts).
 */
export function viewOnly(open: Open | null, dialog: boolean): boolean {
  return open !== null || dialog;
}

/** What covers the remote screen. */
export type Cover =
  /** A resize that has not settled. */
  | { kind: "resizing" }
  /**
   * A desktop with no picture: past what video carries, or too many screens for
   * one view. `others` are the displays that could be shown alone, by id.
   */
  | { kind: "held"; cause: "size" | "screens"; others: number[] }
  /**
   * A display whose picture has not come: a Mac's video at the start, after a
   * change of display, and when the Mac starts its video over. While it is up
   * the page sends the remote no pointer and no key, and lets go of what was held
   * (useRemoteDesktop.ts).
   */
  | { kind: "unavailable" }
  /**
   * A display shown in a tab of its own whose session's page is gone: closed,
   * reloading, or its connection dropped. Nobody is at the session, so the tab
   * says so and sends nothing; it comes back by itself when the page does.
   */
  | { kind: "left" }
  | null;

/**
 * What covers the remote screen. A desktop with no picture is said ahead of a
 * resize: it is the one with something to do about it. The display being sent
 * is the one held, so it is not among the ways out. A resize is said ahead of a
 * picture that has not come: the picture is waited for because of it.
 */
export function coverOf(state: {
  left: boolean;
  resizing: boolean;
  unavailable: boolean;
  held: "size" | "screens" | null;
  displays: readonly number[];
  active: number | null;
}): Cover {
  // Ahead of the rest: none of it is anybody's to act on with no page at the session.
  if (state.left) {
    return { kind: "left" };
  }
  if (state.held) {
    return {
      kind: "held",
      cause: state.held,
      others: state.displays.filter((id) => id !== state.active),
    };
  }
  if (state.resizing) {
    return { kind: "resizing" };
  }
  return state.unavailable ? { kind: "unavailable" } : null;
}
