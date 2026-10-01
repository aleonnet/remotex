// The player's lifecycle around a FLAC stream's module, which loads after the
// player is made: what a load that ends late may still do.
//
// No audio is played here. The context is the two calls the player makes of one
// before any sound arrives, and the module's load is a promise the test settles.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type AudioFormat, createAudioPlayer } from "./audioPlayer.ts";
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
  const errors: string[] = [];
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
  assert.deepEqual(errors, ["This browser could not load the FLAC decoder."]);
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
  assert.deepEqual(errors, ["This browser could not load the FLAC decoder."]);
});
