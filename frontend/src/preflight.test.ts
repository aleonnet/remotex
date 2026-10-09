// The gate every other file in this client depends on not having to check.
//
// Worth its own test precisely because nothing else tests it: once this returns null
// the rest of the client assumes a secure context and a pair of WebCodecs decoders
// everywhere, with no branch left to exercise. If it ever returned null without them
// the failure would surface as the clipboard, the keyboard, the picture and the sound
// going missing separately, which is the state this exists to make impossible.
import assert from "node:assert/strict";
import { test } from "node:test";

const globals = globalThis as unknown as {
  window: { isSecureContext: boolean; location: { origin: string } };
  // Present or absent is the whole of what the module asks about them, so a
  // constructor nobody calls is enough of a decoder here.
  VideoDecoder: unknown;
  AudioDecoder: unknown;
};
globals.window = {
  isSecureContext: true,
  location: { origin: "http://10.0.0.4:52380" },
};

const { refusal } = await import("./preflight.ts");

/** A browser with everything, which each test then takes something away from. */
function capable(): void {
  globals.window.isSecureContext = true;
  globals.VideoDecoder = class {};
  globals.AudioDecoder = class {};
}

test("a capable browser is not refused", () => {
  capable();
  assert.equal(refusal(), null);
});

test("an insecure context refuses, by its code, and says where", () => {
  capable();
  globals.window.isSecureContext = false;
  // The address, because "this gateway" is ambiguous the moment someone has two.
  assert.deepEqual(refusal(), {
    cause: "AL-1001",
    address: "http://10.0.0.4:52380",
  });
});

test("a missing decoder refuses, by its code, and names which one", () => {
  for (const [missing, named] of [
    ["VideoDecoder", "video"],
    ["AudioDecoder", "sound"],
  ] as const) {
    capable();
    globals[missing] = undefined;
    assert.deepEqual(
      refusal(),
      { cause: "AL-1002", missing: [named] },
      `${missing} went missing and the refusal did not say so`,
    );
  }
});

test("a browser with neither decoder is told about both, once", () => {
  capable();
  globals.VideoDecoder = undefined;
  globals.AudioDecoder = undefined;
  // Not the address: it is the one thing that is fine here, and naming it sends
  // the reader to fix the deployment instead of the browser.
  assert.deepEqual(refusal(), {
    cause: "AL-1002",
    missing: ["video", "sound"],
  });
});

test("an insecure context is the reason given, even with no decoders either", () => {
  // WebCodecs is itself secure-context gated, so this is not a contrived pairing —
  // it is what every insecure origin looks like. Telling that reader to install a
  // different browser would be telling them to fix the wrong thing.
  capable();
  globals.window.isSecureContext = false;
  globals.VideoDecoder = undefined;
  globals.AudioDecoder = undefined;
  assert.equal(refusal()?.cause, "AL-1001");
});
