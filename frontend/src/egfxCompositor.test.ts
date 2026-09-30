// The WebAssembly compositor itself, fed commands this file builds by hand.
//
// Not built with anything of the gateway's: the PDUs below are transcribed from
// [MS-RDPEGFX] 2.2.2, so what is checked is the module's reading of the protocol
// and not its agreement with its own writer. The codecs have their tests where
// they are written (crates/remotex-rdp-graphics); what is pinned here is the
// boundary — that the module loads and starts its threads, composes a pipeline from
// its first command, says what it painted, and hands back the picture where a
// texture takes it from.
//
// Run with `bun run test` from frontend/, which builds the module first.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadEgfx } from "./egfxCompositor.ts";

const module = readFileSync(
  new URL("../wasm/egfx/pkg/remotex_egfx_bg.wasm", import.meta.url),
);

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];

/** `RDPGFX_HEADER`: the command, no flags, the length with the header in it. */
const pdu = (command: number, body: number[]) => [
  ...u16(command),
  ...u16(0),
  ...u32(8 + body.length),
  ...body,
];

const resetGraphics = (w: number, h: number) => {
  const body = [...u32(w), ...u32(h), ...u32(0)];
  // Padded so the PDU is 340 bytes, as the specification has every one.
  return pdu(0x000e, [...body, ...new Array(340 - 8 - body.length).fill(0)]);
};
const XRGB = 0x20;
const createSurface = (id: number, w: number, h: number) =>
  pdu(0x0009, [...u16(id), ...u16(w), ...u16(h), XRGB]);
const mapToOutput = (id: number, x: number, y: number) =>
  pdu(0x000f, [...u16(id), ...u16(0), ...u32(x), ...u32(y)]);
const startFrame = (frame: number) => pdu(0x000b, [...u32(0), ...u32(frame)]);
const endFrame = (frame: number) => pdu(0x000c, u32(frame));
const rect = (l: number, t: number, r: number, b: number) => [
  ...u16(l),
  ...u16(t),
  ...u16(r),
  ...u16(b),
];
const solidFill = (id: number, bgr: number[], rects: number[][]) =>
  pdu(0x0004, [
    ...u16(id),
    ...bgr,
    0xff,
    ...u16(rects.length),
    ...rects.flat(),
  ]);
const uncompressed = (id: number, at: number[], bgrx: number[]) =>
  pdu(0x0001, [
    ...u16(id),
    ...u16(0),
    XRGB,
    ...at,
    ...u32(bgrx.length),
    ...bgrx,
  ]);

const run = (...pdus: number[][]) => new Uint8Array(pdus.flat());

const pixel = (
  composed: { pixels: Uint8ClampedArray; width: number },
  x: number,
  y: number,
) => [...composed.pixels.subarray((y * composed.width + x) * 4).subarray(0, 4)];

test("a pipeline is composed from its first command, frame by frame", async () => {
  const compositor = (await loadEgfx(module))();
  const opening = compositor.compose(
    run(resetGraphics(8, 4), createSurface(1, 8, 4), mapToOutput(1, 0, 0)),
  );
  assert.deepEqual([opening.width, opening.height], [8, 4]);
  assert.deepEqual(
    [...opening.painted],
    [],
    "nothing is painted before a frame ends",
  );

  // A frame that ends in the next run reaches the picture when it ends.
  const begun = compositor.compose(
    run(startFrame(1), solidFill(1, [0x30, 0x20, 0x10], [rect(2, 1, 6, 3)])),
  );
  assert.deepEqual([...begun.painted], []);
  assert.deepEqual(pixel(begun, 2, 1), [0, 0, 0, 0]);

  const ended = compositor.compose(run(endFrame(1)));
  assert.deepEqual([...ended.painted], [2, 1, 4, 2]);
  assert.equal(ended.resized, false);
  // Red, green, blue, and a byte unused: what a texture is uploaded from.
  assert.deepEqual(pixel(ended, 2, 1), [0x10, 0x20, 0x30, 0]);
  assert.deepEqual(pixel(ended, 5, 2), [0x10, 0x20, 0x30, 0]);
  assert.deepEqual(pixel(ended, 6, 2), [0, 0, 0, 0], "outside the fill");
  assert.equal(ended.pixels.length, 8 * 4 * 4);
  assert.ok(
    ended.pixels.buffer instanceof SharedArrayBuffer,
    "the picture is the module's own framebuffer, in the memory its threads share",
  );
  compositor.close();
});

test("rectangles that touch along one row band are painted as one", async () => {
  const compositor = (await loadEgfx(module))();
  compositor.compose(
    run(resetGraphics(8, 4), createSurface(1, 8, 4), mapToOutput(1, 0, 0)),
  );
  const composed = compositor.compose(
    run(
      startFrame(1),
      solidFill(1, [1, 2, 3], [rect(0, 1, 2, 3), rect(2, 1, 5, 3)]),
      solidFill(1, [4, 5, 6], [rect(0, 3, 2, 4)]),
      endFrame(1),
    ),
  );
  assert.deepEqual([...composed.painted], [0, 1, 5, 2, 0, 3, 2, 1]);
  assert.deepEqual(pixel(composed, 4, 2), [3, 2, 1, 0]);
  assert.deepEqual(pixel(composed, 1, 3), [6, 5, 4, 0]);
  compositor.close();
});

test("pixels on the wire land where their rectangle says", async () => {
  const compositor = (await loadEgfx(module))();
  compositor.compose(
    run(resetGraphics(4, 4), createSurface(3, 4, 4), mapToOutput(3, 0, 0)),
  );
  const composed = compositor.compose(
    run(
      startFrame(9),
      uncompressed(3, rect(1, 2, 3, 3), [1, 2, 3, 0, 4, 5, 6, 0]),
      endFrame(9),
    ),
  );
  assert.deepEqual([...composed.painted], [1, 2, 2, 1]);
  assert.deepEqual(pixel(composed, 1, 2), [3, 2, 1, 0]);
  assert.deepEqual(pixel(composed, 2, 2), [6, 5, 4, 0]);
  compositor.close();
});

test("a reset resizes the framebuffer and starts the picture over", async () => {
  const compositor = (await loadEgfx(module))();
  compositor.compose(
    run(
      resetGraphics(4, 4),
      createSurface(1, 4, 4),
      mapToOutput(1, 0, 0),
      startFrame(1),
      solidFill(1, [9, 9, 9], [rect(0, 0, 4, 4)]),
      endFrame(1),
    ),
  );
  const resized = compositor.compose(
    run(resetGraphics(6, 2), createSurface(2, 6, 2), mapToOutput(2, 0, 0)),
  );
  assert.deepEqual([resized.width, resized.height], [6, 2]);
  assert.equal(resized.resized, true);
  assert.equal(resized.pixels.length, 6 * 2 * 4);
  assert.ok(
    resized.pixels.every((byte) => byte === 0),
    "the picture of the size before is gone",
  );
  compositor.close();
});

test("each compositor holds a pipeline of its own", async () => {
  const make = await loadEgfx(module);
  const first = make();
  first.compose(
    run(resetGraphics(4, 4), createSurface(1, 4, 4), mapToOutput(1, 0, 0)),
  );
  // A second one has seen none of that: a fill of a surface it was never told of
  // paints nothing, where the first paints it.
  const second = make();
  second.compose(run(resetGraphics(4, 4)));
  const frame = run(
    startFrame(1),
    solidFill(1, [1, 1, 1], [rect(0, 0, 1, 1)]),
    endFrame(1),
  );
  assert.deepEqual([...first.compose(frame).painted], [0, 0, 1, 1]);
  assert.deepEqual([...second.compose(frame).painted], []);
  first.close();
  second.close();
});

test("a command that does not decode is thrown, with the reason", async () => {
  const compositor = (await loadEgfx(module))();
  // A header that says its PDU is shorter than a header.
  assert.throws(
    () => compositor.compose(new Uint8Array([0x0c, 0, 0, 0, 4, 0, 0, 0])),
    /graphics pipeline PDU/,
  );
  compositor.close();
});
