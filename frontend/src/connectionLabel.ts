// What a session is speaking, for the information sheet.
//
// A module of its own because it is a pure function of two strings, where the
// component that shows it cannot be imported without a browser.
//
// Worth showing because `vnc` is several different things. A plain VNC server, a
// wlshare server and a Mac in each of its modes all arrive as `"protocol":"vnc"`,
// and they differ in what a person will notice: a plain server is read at 1x with
// no sound and no display list, wlshare passes its own stream and has all three,
// a Mac shares its physical displays or makes one of its own. "Why is there no
// display list", "why does this computer not follow the window" all have the same
// first question — which of them is this.
//
// Two answers, for two readers. The mode in plain words, the ones the list of
// computers uses for the same computer. And the config's own spelling, behind
// "Details": it is what `subtype` is set to in `alumia.toml`, so somebody reading
// it can find the line that produced it, and a subtype this build has never heard
// of still names itself instead of vanishing.

import type { Words } from "./words.ts";

/** What `connected` says the session is on. */
export interface SessionKind {
  protocol: string;
  /** The target's `subtype` where it has one, null for plain RDP and plain VNC. */
  subtype: string | null;
}

/** The config's spelling: `VNC · ard-mirror`, or the protocol alone. */
export function connectionLabel({ protocol, subtype }: SessionKind): string {
  const family = protocol.toUpperCase();
  return subtype ? `${family} · ${subtype}` : family;
}

/**
 * The mode in plain words: a Mac's two over its media stream are Virtual and
 * Mirrored, as the list of computers calls them. A Mac in Standard mode shares
 * its physical displays unless it was put on a display of its own, which is the
 * `virtual_display` key: `virtualDisplay` says the remote reported one.
 */
export function connectionMode(
  kind: SessionKind,
  virtualDisplay: boolean,
): Words {
  if (kind.protocol === "rdp") {
    return { key: "type.rdp" };
  }
  switch (kind.subtype) {
    case null:
      return { key: "type.vnc" };
    case "wlshare":
      return { key: "type.wlshare" };
    case "ard-high-performance":
      return { key: "mode.virtual" };
    case "ard-mirror":
      return { key: "mode.mirrored" };
    case "ard":
      return {
        key: virtualDisplay ? "mode.compatibleOwn" : "mode.compatible",
      };
    default:
      return { data: connectionLabel(kind) };
  }
}
