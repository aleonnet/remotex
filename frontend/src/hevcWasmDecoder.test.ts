// EXPERIMENTAL: the software HEVC decoder's `VideoDecoder` shape, as far as it
// goes without its worker.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createWasmHevcDecoder, isHevc } from "./hevcWasmDecoder.ts";

test("only HEVC configurations are the software decoder's", () => {
  assert.equal(isHevc("hev1.4.10.L150.BE.8"), true);
  assert.equal(isHevc("hvc1.1.6.L93.B0"), true);
  assert.equal(isHevc("vp09.01.50.08.03.06.06.06.00"), false);
});

test("another codec is refused as VideoDecoder refuses one: asynchronously, NotSupportedError", async () => {
  const errors: Error[] = [];
  const decoder = createWasmHevcDecoder({
    output: () => assert.fail("no output"),
    error: (e) => errors.push(e),
  });
  decoder.configure({ codec: "vp09.00.40.08" });
  assert.equal(errors.length, 0, "not from inside configure");
  await Promise.resolve();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, "NotSupportedError");
  assert.equal(decoder.state, "closed");
  assert.throws(() => decoder.configure({ codec: "hev1.4.10.L150.BE.8" }));
});
