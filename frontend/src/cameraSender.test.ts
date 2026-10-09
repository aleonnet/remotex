// The camera sender's pure halves: the H.264 configuration chosen for a capture
// geometry, and the rational frame rate the wire carries. Then its failure
// points, against a staged browser. That a real camera's picture reaches a
// remote needs a camera and a gateway, which is browser QA's business.
//
// Run with `bun test src/cameraSender.test.ts` from frontend/.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPTURE_FPS,
  captureRate,
  h264Config,
  normalizeConstrainedBaseline,
  rationalFps,
  startCameraSender,
} from "./cameraSender";
import { FaultError, faultOf } from "./fault.ts";
import { encodeCameraFrame } from "./protocol";

test("the announced rate is the camera's, held to the capture ceiling", () => {
  assert.equal(captureRate(10), 10);
  assert.equal(captureRate(30), CAPTURE_FPS, "a camera that ignored the max");
  assert.equal(captureRate(undefined), CAPTURE_FPS);
  assert.equal(captureRate(0), CAPTURE_FPS);
});

test("a 720p30 camera fits level 3.1", () => {
  // 80x45 macroblocks at 30 fps = 108,000/s, exactly level 3.1's limit.
  assert.equal(h264Config(1280, 720, 30).codec, "avc1.42e01f");
});

test("1080p30 needs level 4.0 and 4K needs 5.1 at any rate", () => {
  assert.equal(h264Config(1920, 1080, 30).codec, "avc1.42e028");
  // 3840x2160 is 32,400 macroblocks a frame, past level 5.0's 22,080, even
  // though 15 fps is inside its macroblock rate.
  assert.equal(h264Config(3840, 2160, 15).codec, "avc1.42e033");
  assert.equal(h264Config(3840, 2160, 30).codec, "avc1.42e033");
  assert.equal(h264Config(3840, 2160, 60).codec, "avc1.42e034");
});

test("the bitrate is a tenth of a bit per pixel per frame, clamped", () => {
  // 1280*720*30*0.1 = 2.76 Mbit/s — inside the clamp, so exactly that.
  assert.equal(h264Config(1280, 720, 30).bitrate, 2_764_800);
  // A tiny capture stays at the floor, a 4K60 one at the ceiling.
  assert.equal(h264Config(160, 120, 15).bitrate, 300_000);
  assert.equal(h264Config(3840, 2160, 60).bitrate, 8_000_000);
});

test("integer frame rates stay {fps, 1}", () => {
  assert.deepEqual(rationalFps(30), { numerator: 30, denominator: 1 });
  assert.deepEqual(rationalFps(60), { numerator: 60, denominator: 1 });
});

test("fractional frame rates keep their thousandths, reduced", () => {
  assert.deepEqual(rationalFps(29.97), { numerator: 2997, denominator: 100 });
  assert.deepEqual(rationalFps(23.976), { numerator: 2997, denominator: 125 });
});

test("baseline SPS units are normalized to the requested constrained profile", () => {
  const unit = new Uint8Array([
    0, 0, 0, 1, 0x27, 0x42, 0x00, 0x1f, 0xaa, 0, 0, 1, 0x28, 0xce, 0x3c,
  ]);
  normalizeConstrainedBaseline(unit);
  assert.deepEqual(
    Array.from(unit),
    [0, 0, 0, 1, 0x27, 0x42, 0xe0, 0x1f, 0xaa, 0, 0, 1, 0x28, 0xce, 0x3c],
  );
});

test("SPS normalization handles three-byte start codes and preserves other profiles", () => {
  const unit = new Uint8Array([
    0, 0, 1, 0x67, 0x42, 0x40, 0x1f, 0, 0, 1, 0x67, 0x64, 0x00, 0x28,
  ]);
  normalizeConstrainedBaseline(unit);
  assert.deepEqual(
    Array.from(unit),
    [0, 0, 1, 0x67, 0x42, 0xe0, 0x1f, 0, 0, 1, 0x67, 0x64, 0x00, 0x28],
  );
});

// The layout mirrors `camera` in src/protocol.rs; the Rust side's parser has
// its own tests over the same bytes, which is the two-ends check the audio
// frame gets between decodeAudioFrame and `audio::frame`.
test("a camera frame is kind then flags then the unit, keyframe in bit zero", () => {
  assert.deepEqual(
    Array.from(encodeCameraFrame(new Uint8Array([9, 8]), true) ?? []),
    [0x04, 0x01, 9, 8],
  );
  assert.deepEqual(
    Array.from(encodeCameraFrame(new Uint8Array([7]), false) ?? []),
    [0x04, 0x00, 7],
  );
});

test("an empty unit is refused, matching the gateway parser's rejection", () => {
  assert.equal(encodeCameraFrame(new Uint8Array(), true), null);
});

// The failure points, each named by its code in the catalogue
// (docs/design/errors.json). A camera and a gateway are staged here, the way
// keyboardLock.test.ts stages a keyboard: only what `startCameraSender` asks of
// the browser, and nothing that encodes.

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static last: FakeSocket;
  readyState = FakeSocket.CONNECTING;
  binaryType = "";
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

class FakeVideoEncoder {
  static supported = true;
  static last: FakeVideoEncoder;
  static async isConfigSupported(): Promise<{ supported: boolean }> {
    return { supported: FakeVideoEncoder.supported };
  }
  state = "unconfigured";
  encodeQueueSize = 0;
  readonly init: { error: (e: Error) => void };
  constructor(init: { error: (e: Error) => void }) {
    this.init = init;
    FakeVideoEncoder.last = this;
  }
  configure(): void {
    this.state = "configured";
  }
  close(): void {
    this.state = "closed";
  }
}

// A camera whose frames never come: the pump waits, and the test decides what
// happens meanwhile.
class FakeTrackProcessor {
  readable = {
    getReader: () => ({
      read: () => new Promise<never>(() => {}),
      cancel: async () => {},
    }),
  };
}

function fakeTrack() {
  return {
    stopped: false,
    stop() {
      this.stopped = true;
    },
    getSettings: () => ({ width: 640, height: 480, frameRate: 15 }),
  };
}

type Track = ReturnType<typeof fakeTrack>;

const browser = globalThis as unknown as {
  VideoEncoder: unknown;
  MediaStreamTrackProcessor: unknown;
  WebSocket: unknown;
  navigator: unknown;
};

// A browser with everything the sender asks for, and a camera giving `tracks`.
function stageBrowser(tracks: Track[]): void {
  FakeVideoEncoder.supported = true;
  browser.VideoEncoder = FakeVideoEncoder;
  browser.MediaStreamTrackProcessor = FakeTrackProcessor;
  browser.WebSocket = FakeSocket;
  browser.navigator = {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => tracks,
        getVideoTracks: () => tracks,
      }),
    },
  };
}

const quiet = { onStopped: () => {}, onStreaming: () => {} };

// Whether a rejection is the fault `code`, with `fill` where the cause has holes.
function isFault(code: string, fill?: Record<string, string | number>) {
  return (thrown: unknown) => {
    assert.ok(thrown instanceof FaultError, String(thrown));
    assert.equal(thrown.fault.code, code);
    assert.deepEqual(thrown.fault.fill, fill);
    return true;
  };
}

test("a browser with no video encoder is refused by name", async () => {
  stageBrowser([fakeTrack()]);
  browser.VideoEncoder = undefined;
  await assert.rejects(startCameraSender("ws://x", quiet), isFault("AL-5301"));
});

test("a browser that cannot read the camera's frames is refused by name", async () => {
  stageBrowser([fakeTrack()]);
  browser.MediaStreamTrackProcessor = undefined;
  await assert.rejects(startCameraSender("ws://x", quiet), isFault("AL-5302"));
});

test("a browser that offers no capture is refused by name", async () => {
  stageBrowser([fakeTrack()]);
  browser.navigator = {};
  await assert.rejects(startCameraSender("ws://x", quiet), isFault("AL-5303"));
});

test("a camera that gives no picture is named", async () => {
  stageBrowser([]);
  await assert.rejects(startCameraSender("ws://x", quiet), isFault("AL-5304"));
});

test("a format the browser cannot encode is named with the format, and the camera is let go", async () => {
  const track = fakeTrack();
  stageBrowser([track]);
  FakeVideoEncoder.supported = false;
  await assert.rejects(
    startCameraSender("ws://x", quiet),
    isFault("AL-5305", { codec: "avc1.42e01f", width: 640, height: 480 }),
  );
  assert.equal(track.stopped, true, "the camera light must not stay on");
});

test("a permission the browser refuses stays the browser's own error, for the page to name", async () => {
  stageBrowser([fakeTrack()]);
  const refused = new DOMException("Permission denied", "NotAllowedError");
  browser.navigator = {
    mediaDevices: { getUserMedia: () => Promise.reject(refused) },
  };
  await assert.rejects(startCameraSender("ws://x", quiet), (thrown) => {
    assert.equal(thrown, refused);
    assert.deepEqual(faultOf(thrown, "AL-5308"), {
      code: "AL-5308",
      detail: "NotAllowedError: Permission denied",
    });
    return true;
  });
});

test("an encoder that fails stops the sender with its cause and what it said", async () => {
  const track = fakeTrack();
  stageBrowser([track]);
  const stopped: unknown[] = [];
  await startCameraSender("ws://x", {
    onStopped: (fault) => stopped.push(fault),
    onStreaming: () => {},
  });
  FakeVideoEncoder.last.init.error(new Error("out of memory"));
  assert.deepEqual(stopped, [{ code: "AL-5306", detail: "out of memory" }]);
  assert.equal(track.stopped, true);
  // Exactly one stop: the socket's close after it finds nothing to do.
  FakeSocket.last.onclose?.({ code: 1000 });
  assert.equal(stopped.length, 1);
});

test("a computer that takes no camera is named, and an ordinary close is not a failure", async () => {
  for (const [code, fault] of [
    [4002, { code: "AL-5307" }],
    [1000, null],
  ] as const) {
    stageBrowser([fakeTrack()]);
    const stopped: unknown[] = [];
    await startCameraSender("ws://x", {
      onStopped: (reason) => stopped.push(reason),
      onStreaming: () => {},
    });
    FakeSocket.last.onclose?.({ code });
    assert.deepEqual(stopped, [fault]);
  }
});
