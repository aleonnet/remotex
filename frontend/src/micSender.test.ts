// The microphone sender's pure halves: the Opus configuration, the downmix,
// and the frame the gateway parses. Then its failure points, against a staged
// browser. That a real microphone is heard on a remote needs a microphone and
// a gateway, which is browser QA's business.
//
// Run with `bun test src/micSender.test.ts` from frontend/.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FaultError, faultOf } from "./fault.ts";
import {
  downmix,
  MIC_BITRATE,
  MIC_FRAME_MICROSECONDS,
  opusConfig,
  startMicSender,
} from "./micSender";
import { encodeMicFrame } from "./protocol";

test("the microphone is mono speech at a low bitrate, whatever it captures at", () => {
  const config = opusConfig(44_100);
  assert.equal(config.codec, "opus");
  assert.equal(config.sampleRate, 44_100);
  assert.equal(config.numberOfChannels, 1);
  assert.equal(config.bitrate, MIC_BITRATE);
  assert.equal(MIC_BITRATE, 16_000);
  assert.equal(config.opus?.application, "voip");
  assert.equal(config.opus?.signal, "voice");
  assert.equal(config.opus?.frameDuration, MIC_FRAME_MICROSECONDS);
});

test("channels are averaged into one", () => {
  const mono = downmix([
    new Float32Array([1, 0.5, -1]),
    new Float32Array([0, 0.5, 1]),
  ]);
  assert.deepEqual(Array.from(mono), [0.5, 0.5, 0]);
  assert.equal(downmix([]).length, 0);
});

// The layout mirrors `mic` in src/protocol.rs, whose parser has its own tests
// over the same bytes.
test("a microphone frame is the kind byte then the packet", () => {
  assert.deepEqual(
    Array.from(encodeMicFrame(new Uint8Array([0xf8, 0xff])) ?? []),
    [0x05, 0xf8, 0xff],
  );
  assert.equal(encodeMicFrame(new Uint8Array()), null);
});

// The failure points, each named by its code in the catalogue
// (docs/design/errors.json), against a staged browser: only what
// `startMicSender` asks of one, and nothing that encodes.

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static last: FakeSocket;
  readyState = FakeSocket.CONNECTING;
  binaryType = "";
  bufferedAmount = 0;
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

class FakeAudioEncoder {
  static supported = true;
  // What `configure` throws, when the encoder is to refuse the microphone's audio.
  static refusal: Error | null = null;
  static last: FakeAudioEncoder;
  static async isConfigSupported(): Promise<{ supported: boolean }> {
    return { supported: FakeAudioEncoder.supported };
  }
  state = "unconfigured";
  encodeQueueSize = 0;
  readonly init: { error: (e: Error) => void };
  constructor(init: { error: (e: Error) => void }) {
    this.init = init;
    FakeAudioEncoder.last = this;
  }
  configure(): void {
    if (FakeAudioEncoder.refusal) {
      throw FakeAudioEncoder.refusal;
    }
    this.state = "configured";
  }
  encode(): void {}
  reset(): void {
    this.state = "unconfigured";
  }
  close(): void {
    this.state = "closed";
  }
}

// A microphone whose audio comes when the test says: each `read` waits for the
// next thing `captured` is given, and for ever once there is nothing more.
type Read = { done: boolean; value?: unknown } | Error;
let captured: ((read: Read) => void)[] = [];

class FakeTrackProcessor {
  readable = {
    getReader: () => ({
      read: () =>
        new Promise((resolve, reject) => {
          captured.push((read) =>
            read instanceof Error ? reject(read) : resolve(read),
          );
        }),
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
    getSettings: () => ({ sampleRate: 48_000 }),
  };
}

type Track = ReturnType<typeof fakeTrack>;

const browser = globalThis as unknown as {
  AudioEncoder: unknown;
  MediaStreamTrackProcessor: unknown;
  WebSocket: unknown;
  navigator: unknown;
};

// A browser with everything the sender asks for, and a microphone giving `tracks`.
function stageBrowser(tracks: Track[]): void {
  captured = [];
  FakeAudioEncoder.supported = true;
  FakeAudioEncoder.refusal = null;
  browser.AudioEncoder = FakeAudioEncoder;
  browser.MediaStreamTrackProcessor = FakeTrackProcessor;
  browser.WebSocket = FakeSocket;
  browser.navigator = {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => tracks,
        getAudioTracks: () => tracks,
      }),
    },
  };
}

const quiet = { onStopped: () => {}, onStreaming: () => {} };

function isFault(code: string) {
  return (thrown: unknown) => {
    assert.ok(thrown instanceof FaultError, String(thrown));
    assert.equal(thrown.fault.code, code);
    return true;
  };
}

// A sender started on a staged browser, with what it stopped with.
async function started(): Promise<{ stopped: unknown[]; track: Track }> {
  const track = fakeTrack();
  stageBrowser([track]);
  const stopped: unknown[] = [];
  await startMicSender("ws://x", {
    onStopped: (fault) => stopped.push(fault),
    onStreaming: () => {},
  });
  return { stopped, track };
}

// Let the capture pump take what it was just given.
function settled(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("a browser with no sound encoder is refused by name", async () => {
  stageBrowser([fakeTrack()]);
  browser.AudioEncoder = undefined;
  await assert.rejects(startMicSender("ws://x", quiet), isFault("AL-5501"));
});

test("a browser that cannot read the microphone's sound is refused by name", async () => {
  stageBrowser([fakeTrack()]);
  browser.MediaStreamTrackProcessor = undefined;
  await assert.rejects(startMicSender("ws://x", quiet), isFault("AL-5502"));
});

test("a browser that offers no capture is refused by name", async () => {
  stageBrowser([fakeTrack()]);
  browser.navigator = {};
  await assert.rejects(startMicSender("ws://x", quiet), isFault("AL-5503"));
});

test("a microphone that gives no sound is named", async () => {
  stageBrowser([]);
  await assert.rejects(startMicSender("ws://x", quiet), isFault("AL-5504"));
});

test("a browser that cannot encode Opus is named, and the microphone is let go", async () => {
  const track = fakeTrack();
  stageBrowser([track]);
  FakeAudioEncoder.supported = false;
  await assert.rejects(startMicSender("ws://x", quiet), isFault("AL-5505"));
  assert.equal(track.stopped, true);
});

test("a permission the browser refuses stays the browser's own error, for the page to name", async () => {
  stageBrowser([fakeTrack()]);
  const refused = new DOMException("Permission denied", "NotAllowedError");
  browser.navigator = {
    mediaDevices: { getUserMedia: () => Promise.reject(refused) },
  };
  await assert.rejects(startMicSender("ws://x", quiet), (thrown) => {
    assert.equal(thrown, refused);
    assert.deepEqual(faultOf(thrown, "AL-5511"), {
      code: "AL-5511",
      detail: "NotAllowedError: Permission denied",
    });
    return true;
  });
});

test("an encoder that fails stops the sender with its cause and what it said", async () => {
  const { stopped, track } = await started();
  FakeAudioEncoder.last.init.error(new Error("out of memory"));
  assert.deepEqual(stopped, [{ code: "AL-5506", detail: "out of memory" }]);
  assert.equal(track.stopped, true);
});

test("a computer that takes no microphone is named, and an ordinary close is not a failure", async () => {
  for (const [code, fault] of [
    [4002, { code: "AL-5507" }],
    [1000, null],
  ] as const) {
    const { stopped } = await started();
    FakeSocket.last.onclose?.({ code });
    assert.deepEqual(stopped, [fault]);
  }
});

test("audio the encoder refuses while the remote records stops the sender by name", async () => {
  const { stopped } = await started();
  FakeSocket.last.onmessage?.({ data: '{"type":"micOpen"}' });
  FakeAudioEncoder.refusal = new Error("unsupported sample rate");
  let closed = false;
  captured[0]({
    done: false,
    value: {
      sampleRate: 44_100,
      numberOfChannels: 1,
      close: () => {
        closed = true;
      },
    },
  });
  await settled();
  assert.deepEqual(stopped, [
    { code: "AL-5508", detail: "unsupported sample rate" },
  ]);
  assert.equal(closed, true, "the captured buffer is closed either way");
});

test("a capture that fails stops the sender by name", async () => {
  const { stopped } = await started();
  captured[0](new Error("device lost"));
  await settled();
  assert.deepEqual(stopped, [{ code: "AL-5509", detail: "device lost" }]);
});

test("a capture that ends, unplugged or its permission taken back, stops the sender by name", async () => {
  const { stopped } = await started();
  captured[0]({ done: true });
  await settled();
  assert.deepEqual(stopped, [{ code: "AL-5510" }]);
});
