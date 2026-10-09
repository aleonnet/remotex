// The page's FLAC decoder, through its binding, fed frames libFLAC made.
//
// The frames below are what the gateway's own encoder produced for one block of
// a known signal at each rate a session carries: wlshare's 48 kHz in blocks of
// 960 and an RDP host's 44.1 kHz in blocks of 882, each a stream of its own with
// no header, as they travel. The decoder shares nothing with that encoder, so
// what is checked is that the two agree, sample for sample.
//
// Run with `bun run test` from frontend/, which builds the module first.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type FlacStream, loadFlac } from "./flacDecoder.ts";

const module = readFileSync(
  new URL("../wasm/flac/pkg/alumia_flac_bg.wasm", import.meta.url),
);

const bytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

const WLSHARE: FlacStream = {
  sampleRate: 48_000,
  channels: 2,
  packetFrames: 960,
};
const RDP: FlacStream = { sampleRate: 44_100, channels: 2, packetFrames: 882 };

const WLSHARE_FRAME = bytes(
  "fff87aa80003bf3314ffff12421600000000030300804020100804020100804020100804020100804020100804020100804003fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff0fffffffc3fffffff148000f10645b00000000000040dc0040040040040040040040040040040040040040040040040040040040040040040040040040040007ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe1fffffff87ffffffe0fb5f",
);
const RDP_FRAME = bytes(
  "fff879a8000371f114ffff1242050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000023084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210842108421084210807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc520003c41905c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000026e0202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202003fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03204",
);

/**
 * The signal the frames were made from: both extremes of a 16-bit sample first,
 * then a ramp up on the left and a ramp down on the right.
 */
const signal = (frame: number): [number, number] =>
  frame === 0 ? [-32768, 32767] : [frame * 7 - 3000, 12345 - frame * 3];

for (const [name, stream, frame] of [
  ["wlshare's", WLSHARE, WLSHARE_FRAME],
  ["an RDP host's", RDP, RDP_FRAME],
] as const) {
  test(`${name} frame decodes to exactly the samples that were encoded`, async () => {
    const decoder = (await loadFlac(module))(stream);
    const planes = decoder.decode(frame);
    assert.equal(planes.length, 2);
    for (const [channel, plane] of planes.entries()) {
      assert.equal(plane.length, stream.packetFrames);
      for (let n = 0; n < plane.length; n++) {
        // Exact: a 16-bit sample over 2^15 is a float32 with nothing rounded.
        assert.equal(plane[n] * 32768, signal(n)[channel], `sample ${n}`);
      }
    }
    decoder.close();
  });
}

test("a frame that is not the stream's is refused, and the next still decodes", async () => {
  const decoder = (await loadFlac(module))(WLSHARE);
  assert.throws(
    () => decoder.decode(new Uint8Array(64).fill(0xab)),
    /not a FLAC frame/,
  );
  assert.throws(() => decoder.decode(new Uint8Array(0)), /not a FLAC frame/);
  // The other source's rate.
  assert.throws(() => decoder.decode(RDP_FRAME), /another rate/);
  // A bit of the samples flipped, which the frame's CRC catches.
  const damaged = WLSHARE_FRAME.slice();
  damaged[damaged.length >> 1] ^= 1;
  assert.throws(() => decoder.decode(damaged), /decoding a FLAC frame/);
  // Cut short, and with more after it.
  assert.throws(() =>
    decoder.decode(WLSHARE_FRAME.subarray(0, WLSHARE_FRAME.length - 3)),
  );
  assert.throws(
    () => decoder.decode(Uint8Array.from([...WLSHARE_FRAME, 0])),
    /1 bytes after the FLAC frame/,
  );
  assert.equal(decoder.decode(WLSHARE_FRAME)[0][1] * 32768, signal(1)[0]);
  decoder.close();
});

test("a frame of another block or channel count than was announced is refused", async () => {
  const make = await loadFlac(module);
  assert.throws(
    () => make({ ...WLSHARE, packetFrames: 480 }).decode(WLSHARE_FRAME),
    /960 frames of 2 channels/,
  );
  assert.throws(
    () => make({ ...WLSHARE, channels: 1 }).decode(WLSHARE_FRAME),
    /960 frames of 2 channels/,
  );
});

test("a stream that is not carried as FLAC has no decoder", async () => {
  const make = await loadFlac(module);
  assert.throws(
    () => make({ ...WLSHARE, sampleRate: 32_000 }),
    /not a stream carried here/,
  );
  assert.throws(
    () => make({ ...WLSHARE, channels: 3 }),
    /not a stream carried here/,
  );
});
