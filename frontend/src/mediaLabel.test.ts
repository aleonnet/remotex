// What the information sheet says about the sound and the picture.
//
// The cases that matter are the ones the Picture line cannot answer: why there is
// no sound, whose the picture is, and what a live decoder was actually
// configured with.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  audioDetail,
  pictureState,
  soundState,
  videoSaid,
} from "./mediaLabel.ts";

const OPUS = {
  codec: "opus",
  sampleRate: 48_000,
  channels: 2,
  passthrough: false,
};

test("a session without sound says so rather than offering nothing", () => {
  assert.equal(
    soundState({ available: false, enabled: false, error: null, stream: null }),
    "none",
  );
});

test("a muted session is distinguished from one whose sound failed", () => {
  assert.equal(
    soundState({ available: true, enabled: false, error: null, stream: null }),
    "muted",
  );
  // The one state here that is wrong rather than off, and it comes first: the
  // failure is also why the sound is no longer asked for.
  assert.equal(
    soundState({
      available: true,
      enabled: false,
      error: { code: "AL-5102", fill: { codec: "opus" } },
      stream: OPUS,
    }),
    "stopped",
  );
});

test("turning the sound on is a press, and its format a round trip later", () => {
  const row = { available: true, enabled: true, error: null };
  assert.equal(soundState({ ...row, stream: null }), "waiting");
  assert.equal(soundState({ ...row, stream: OPUS }), "playing");
});

test("a stream names its codec, its rate and its channels, as data", () => {
  assert.equal(audioDetail(OPUS), "opus · 48 kHz · 2");
  // An RDP host's PCM, coded as FLAC at the host's own rate.
  assert.equal(
    audioDetail({ ...OPUS, codec: "flac", sampleRate: 44_100 }),
    "flac · 44.1 kHz · 2",
  );
  assert.equal(audioDetail({ ...OPUS, channels: 1 }), "opus · 48 kHz · 1");
});

test("the picture is the remote's own, the gateway's, or composed here", () => {
  assert.equal(pictureState(null), "waiting");
  assert.equal(
    pictureState({ decode: "hev1.4.10.L150.BE.8", passthrough: true }),
    "passed",
  );
  assert.equal(
    pictureState({ decode: "vp09.00.40.08", passthrough: false }),
    "encoded",
  );
  assert.equal(
    pictureState({ decode: "", passthrough: true, composed: true }),
    "composed",
  );
});

test("the video decoder's line waits for the format, then names it", () => {
  assert.deepEqual(videoSaid(null, null), { code: "AL-5800" });
  assert.deepEqual(
    videoSaid({ decode: "vp09.00.40.08", passthrough: false }, null),
    { decode: "vp09.00.40.08" },
  );
});

test("a picture that is not a video stream says why no video is in use", () => {
  const stream = { decode: "vp09.00.40.08", passthrough: true };
  // Held, whatever decoder was built before.
  assert.deepEqual(videoSaid(stream, "size"), { code: "AL-5801" });
  assert.deepEqual(videoSaid(stream, "screens"), { code: "AL-5802" });
  assert.deepEqual(
    videoSaid({ decode: "", passthrough: true, composed: true }, null),
    { code: "AL-5803" },
  );
});
