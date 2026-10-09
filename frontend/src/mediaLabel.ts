// What the information sheet says about the sound and the picture.
//
// A module of its own for the reason `connectionLabel.ts` is one: these are pure
// functions of what arrived on the wire, and a test of them should not have to
// stand up a fake browser to import the component that shows the answer.
//
// The sheet's Picture line says what the *gateway* resolved to. These say what
// this browser ended up doing with it, which is a different fact and the one that
// is otherwise invisible: the dial names a codec but never says a decoder was
// configured, and it says nothing at all about sound, whose format is announced
// only on the audio socket.
//
// Nothing here is a sentence. A state is named, and the sheet says it from the
// dictionary or the catalogue; what is data — a codec string, a rate — is given
// as data, the same in every language.

import type { Fault } from "./fault.ts";
import type { HoldCause } from "./protocol.ts";

/**
 * The wire fields of `audioFormat`, minus the `OpusHead` bytes and the samples in
 * a packet.
 *
 * Only the decoder wants those; this describes the stream to a person, and the
 * client keeps exactly what it can show rather than parking a `Uint8Array` in React
 * state for the life of the session.
 */
export interface AudioStreamInfo {
  codec: string;
  sampleRate: number;
  channels: number;
  // The remote's own packets, passed through untouched — a High Performance
  // Mac's AAC-ELD, wlshare's Opus or FLAC — rather than coded by the gateway.
  passthrough: boolean;
}

/** Everything the sound's state is derived from. See `useRemoteDesktop`. */
export interface AudioRow {
  /** The session carries sound at all (`audio` on `connected`). */
  available: boolean;
  /** This browser asked for it. Never proof that any is arriving. */
  enabled: boolean;
  /** A decoder that refused or failed, which is also why `enabled` went false. */
  error: Fault | null;
  /** The format the decoder was built from, or null before one arrived. */
  stream: AudioStreamInfo | null;
}

/** What the sound is doing here. */
export type SoundState =
  /** The session carries none. */
  | "none"
  /** A decoder refused or failed: the one state that is wrong rather than off. */
  | "stopped"
  | "muted"
  /** Asked for, and its format not here yet. */
  | "waiting"
  | "playing";

/**
 * The sound's state. The failure comes ahead of everything else because it is
 * the only state here that is *wrong* rather than merely off.
 */
export function soundState(row: AudioRow): SoundState {
  if (!row.available) {
    return "none";
  }
  if (row.error) {
    return "stopped";
  }
  if (!row.enabled) {
    return "muted";
  }
  // Enabled is a press; the format is a round trip later, and the gap is real on a
  // remote that has to arm its audio bridge first.
  return row.stream ? "playing" : "waiting";
}

// 48 kHz, written the way somebody comparing it to a device's rate would say it.
// A fractional rate such as 44.1 kHz keeps its fraction.
function rate(hz: number): string {
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

/** The stream the sound decoder was built from: codec, rate and channels. */
export function audioDetail(stream: AudioStreamInfo): string {
  return `${stream.codec} · ${rate(stream.sampleRate)} · ${stream.channels}`;
}

/** The wire fields of `videoFormat`, or a pipeline this browser composes. */
export interface VideoStreamInfo {
  decode: string;
  // The remote's own stream, passed through untouched — wlshare's VP9, a High
  // Performance Mac's HEVC — rather than one the gateway encoded.
  passthrough: boolean;
  // Not a stream at all: an RDP host's graphics pipeline, composed here
  // (`graphicsStart`). No decoder is configured and `decode` names nothing.
  composed?: boolean;
}

/** Whose the picture is. */
export type PictureState =
  /** Its format is not here yet. */
  | "waiting"
  /** The remote's own stream, as it came. */
  | "passed"
  /** A stream the gateway encoded. */
  | "encoded"
  /** An RDP host's drawing, composed by this browser. */
  | "composed";

export function pictureState(stream: VideoStreamInfo | null): PictureState {
  if (!stream) {
    return "waiting";
  }
  if (stream.composed) {
    return "composed";
  }
  return stream.passthrough ? "passed" : "encoded";
}

/**
 * What the video decoder's line says: the exact configuration the decoder was
 * built with, or why none is in use, as the catalogue's code for it. While the
 * desktop is held — past what a video stream encodes, or All Displays over too
 * many screens — there is no picture, whatever decoder was built before.
 */
export type VideoSaid =
  /** The WebCodecs string, which is data. */
  | { decode: string }
  /** Waiting for the format (the place's own words), or why no video is in use. */
  | { code: "AL-5800" | "AL-5801" | "AL-5802" | "AL-5803" };

export function videoSaid(
  stream: VideoStreamInfo | null,
  held: HoldCause | null,
): VideoSaid {
  if (held === "size") {
    return { code: "AL-5801" };
  }
  if (held === "screens") {
    return { code: "AL-5802" };
  }
  if (!stream) {
    return { code: "AL-5800" };
  }
  return stream.composed ? { code: "AL-5803" } : { decode: stream.decode };
}
