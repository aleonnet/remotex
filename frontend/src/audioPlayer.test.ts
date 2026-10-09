// The player's lifecycle around a FLAC stream's module, which loads after the
// player is made: what a load that ends late may still do.
//
// No audio is played here. The context is the two calls the player makes of one
// before any sound arrives, and the module's load is a promise the test settles.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type AudioFormat, createAudioPlayer } from "./audioPlayer.ts";
import type { Fault } from "./fault.ts";
import type { FlacFactory } from "./flacDecoder.ts";

const FLAC: AudioFormat = {
  codec: "flac",
  sampleRate: 48_000,
  channels: 2,
  packetFrames: 960,
  head: new Uint8Array(0),
};

const context = () =>
  ({ currentTime: 0, close: async () => {} }) as unknown as AudioContext;

/** A player on a load the test settles, and the errors it reported. */
function playerOnPendingLoad() {
  const errors: Fault[] = [];
  let resolve: (make: FlacFactory) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<FlacFactory>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const load = { promise, resolve, reject };
  const player = createAudioPlayer(
    FLAC,
    context(),
    { onError: (reason) => errors.push(reason) },
    () => load.promise,
  );
  return { player, errors, load };
}

/** Let the load's callbacks run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a module that fails to load is reported", async () => {
  const { errors, load } = playerOnPendingLoad();
  load.reject(new Error("offline"));
  await settled();
  assert.deepEqual(errors, [{ code: "AL-5101" }]);
});

test("a load that fails after the player closed reports nothing", async () => {
  // Muted, or replaced by another stream's player, while the module was still
  // on its way: the handler would stop the stream that replaced this one.
  const { player, errors, load } = playerOnPendingLoad();
  player.close();
  load.reject(new Error("offline"));
  await settled();
  assert.deepEqual(errors, []);
});

test("a load that ends after the player closed makes no decoder", async () => {
  const { player, errors, load } = playerOnPendingLoad();
  player.close();
  let made = 0;
  load.resolve(() => {
    made += 1;
    throw new Error("not reached");
  });
  await settled();
  assert.equal(made, 0);
  assert.deepEqual(errors, []);
});

test("a stream the module refuses is reported", async () => {
  const { errors, load } = playerOnPendingLoad();
  load.resolve(() => {
    throw new Error("not a stream carried here");
  });
  await settled();
  assert.deepEqual(errors, [{ code: "AL-5101" }]);
});

/** WebCodecs' decoder as far as the player drives it, and what it was asked. */
class FakeAudioDecoder {
  static calls: string[] = [];
  state = "unconfigured";
  configure(): void {
    this.state = "configured";
    FakeAudioDecoder.calls.push("configure");
  }
  decode(chunk: { data: Uint8Array }): void {
    FakeAudioDecoder.calls.push(`decode ${chunk.data[0]}`);
  }
  reset(): void {
    this.state = "unconfigured";
    FakeAudioDecoder.calls.push("reset");
  }
  close(): void {
    this.state = "closed";
  }
}

const OPUS: AudioFormat = {
  codec: "opus",
  sampleRate: 48_000,
  channels: 2,
  packetFrames: 960,
  head: new Uint8Array(19),
};

/** Run `body` with WebCodecs' two globals standing in. */
function withFakeWebCodecs(body: () => void): void {
  const scope = globalThis as Record<string, unknown>;
  const had = [scope.AudioDecoder, scope.EncodedAudioChunk];
  FakeAudioDecoder.calls = [];
  scope.AudioDecoder = FakeAudioDecoder;
  scope.EncodedAudioChunk = class {
    data: Uint8Array;
    constructor(init: { data: Uint8Array }) {
      this.data = init.data;
    }
  };
  try {
    body();
  } finally {
    [scope.AudioDecoder, scope.EncodedAudioChunk] = had;
  }
}

test("a gap starts the decoder again before the packets after it", () => {
  withFakeWebCodecs(() => {
    const player = createAudioPlayer(OPUS, context(), { onError: () => {} });
    player.push([new Uint8Array([1])], 0);
    player.gap();
    player.push([new Uint8Array([2])], 0.04);
    assert.deepEqual(FakeAudioDecoder.calls, [
      "configure",
      "decode 1",
      "reset",
      "configure",
      "decode 2",
    ]);
    player.close();
    player.gap();
    assert.equal(FakeAudioDecoder.calls.length, 5, "nothing after a close");
  });
});

test("a gap is nothing to a FLAC stream, whose frames decode alone", () => {
  withFakeWebCodecs(() => {
    const { player } = playerOnPendingLoad();
    player.gap();
    assert.deepEqual(FakeAudioDecoder.calls, []);
    player.close();
  });
});
