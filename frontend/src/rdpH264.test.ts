// Whether this page decodes a passed pipeline's H.264: a yes needs a decoder for
// the host's stream and a picture that copies into shared memory, and anything
// else, a browser that throws included, is a no.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  chooseRdpH264,
  decodesRdpH264,
  rdpH264Config,
  resetRdpH264ForTests,
} from "./rdpH264.ts";

const page = globalThis as unknown as {
  VideoDecoder?: unknown;
  VideoFrame?: unknown;
};
const original = {
  VideoDecoder: page.VideoDecoder,
  VideoFrame: page.VideoFrame,
};

/** What the browser was asked, in order. */
let asked: VideoDecoderConfig[] = [];
/** The frames the question made, and whether each was closed. */
let frames: { closed: boolean }[] = [];

/**
 * A browser whose decoder takes the configurations `takes` says yes to, and whose
 * pictures copy into shared memory or throw.
 */
function browserWith(
  takes: (config: VideoDecoderConfig) => boolean,
  copies = true,
): void {
  resetRdpH264ForTests();
  asked = [];
  frames = [];
  page.VideoDecoder = {
    isConfigSupported(config: VideoDecoderConfig) {
      asked.push(config);
      return Promise.resolve({ supported: takes(config) });
    },
  };
  page.VideoFrame = class {
    closed = false;
    constructor(_data: Uint8Array, init: { format: string }) {
      assert.equal(init.format, "I420");
      frames.push(this);
    }
    copyTo(destination: Uint8Array) {
      assert.ok(destination.buffer instanceof SharedArrayBuffer);
      return copies
        ? Promise.resolve([])
        : Promise.reject(new TypeError("not into shared memory"));
    }
    close() {
      this.closed = true;
    }
  };
}

afterEach(() => {
  page.VideoDecoder = original.VideoDecoder;
  page.VideoFrame = original.VideoFrame;
  resetRdpH264ForTests();
});

test("a browser with a decoder whose pictures copy into shared memory says yes", async () => {
  browserWith(() => true);
  assert.equal(await chooseRdpH264(), true);
  assert.equal(decodesRdpH264(), true);
  // For one picture a unit, and with no say in which decoder the browser uses.
  assert.deepEqual(asked, [{ codec: "avc1.4d4020", optimizeForLatency: true }]);
  assert.deepEqual(
    frames.map((frame) => frame.closed),
    [true],
  );
  // Asked once: the answer is the page's for as long as it is loaded.
  await chooseRdpH264();
  assert.equal(asked.length, 1);
});

test("a decoder is configured for the stream's own profile, the browser's choice of decoder", async () => {
  browserWith(() => true);
  assert.deepEqual(await rdpH264Config("avc1.640028"), {
    codec: "avc1.640028",
    optimizeForLatency: true,
  });
  assert.equal(asked.length, 1);
});

test("a browser with no decoder for the stream says no", async () => {
  browserWith(() => false);
  assert.equal(await rdpH264Config("avc1.4d4020"), null);
  assert.equal(await chooseRdpH264(), false);
  assert.equal(decodesRdpH264(), false);
  assert.deepEqual(
    frames,
    [],
    "nothing was copied for a decoder that is not there",
  );
});

test("nor one whose pictures do not copy into shared memory, or that throws", async () => {
  browserWith(() => true, false);
  assert.equal(await chooseRdpH264(), false);
  assert.deepEqual(
    frames.map((frame) => frame.closed),
    [true],
  );
  resetRdpH264ForTests();
  page.VideoDecoder = undefined;
  assert.equal(await chooseRdpH264(), false);
});

test("the answer is not read before it is asked", () => {
  resetRdpH264ForTests();
  assert.throws(() => decodesRdpH264(), /before chooseRdpH264/);
});
