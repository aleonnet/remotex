// Whether the page asks for a High Performance Mac's own stream. Only a definite "yes"
// about both halves does: the picture's probe, and a unit of the sound that actually
// decoded, in whichever form of its configuration this browser takes.
import assert from "node:assert/strict";
import { test } from "node:test";

type Behaviour = "sound" | "error" | "silent";

interface FakeInit {
  output: (data: { close: () => void }) => void;
  error: (e: unknown) => void;
}

const globals = globalThis as unknown as {
  VideoDecoder: {
    isConfigSupported: (config: {
      codec: string;
    }) => Promise<{ supported?: boolean }>;
  };
  AudioDecoder: unknown;
  EncodedAudioChunk: unknown;
};

const {
  appleEldConfig,
  chooseAppleMedia,
  decodesAppleMedia,
  esDescriptor,
  resetAppleMediaForTests,
} = await import("./appleMedia.ts");

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** The Mac's AudioSpecificConfig, and the ES_Descriptor Safari decoded it inside. */
const CONFIG = "f8e65000";
const DESCRIPTOR = "03180001000413401500180000000000000000000504f8e65000";

/**
 * A browser whose picture probe answers `picture`, and whose `AudioDecoder` does
 * what `sound` says for each description it is configured with. Returns what the
 * page asked, in order.
 */
function browser(
  picture: () => Promise<{ supported?: boolean }>,
  sound: (description: string) => Behaviour,
  timeoutMs = 2000,
): { probes: string[]; tried: { codec: string; description: string }[] } {
  resetAppleMediaForTests(timeoutMs);
  const asked = {
    probes: [] as string[],
    tried: [] as { codec: string; description: string }[],
  };
  globals.VideoDecoder = {
    isConfigSupported: ({ codec }) => {
      asked.probes.push(codec);
      return picture();
    },
  };
  globals.EncodedAudioChunk = class {
    constructor(init: object) {
      Object.assign(this, init);
    }
  };
  globals.AudioDecoder = class {
    state = "unconfigured";
    behaviour: Behaviour = "silent";
    init: FakeInit;
    constructor(init: FakeInit) {
      this.init = init;
    }
    configure(config: { codec: string; description: Uint8Array }) {
      const description = hex(config.description);
      asked.tried.push({ codec: config.codec, description });
      this.behaviour = sound(description);
      this.state = "configured";
    }
    decode() {}
    flush(): Promise<void> {
      if (this.behaviour === "sound") {
        this.init.output({ close() {} });
        return Promise.resolve();
      }
      if (this.behaviour === "error") {
        this.init.error(new Error("decoding failed"));
        return Promise.reject(new Error("decoding failed"));
      }
      return new Promise(() => {});
    }
    close() {
      this.state = "closed";
    }
  };
  return asked;
}

const yes = async () => ({ supported: true });

test("the ES_Descriptor is the one Safari decoded the Mac's sound inside", () => {
  assert.equal(
    hex(esDescriptor(Uint8Array.of(0xf8, 0xe6, 0x50, 0x00))),
    DESCRIPTOR,
  );
});

test("a browser that decodes the bare configuration, as Chrome does, is played with it", async () => {
  const asked = browser(yes, (description) =>
    description === CONFIG ? "sound" : "error",
  );
  assert.equal(await chooseAppleMedia(), true);
  assert.equal(decodesAppleMedia(), true);
  // The configuration macwork's stream announces: Range Extensions 4:4:4.
  assert.deepEqual(asked.probes, ["hev1.4.10.L150.BE.8"]);
  assert.deepEqual(asked.tried, [{ codec: "mp4a.40.2", description: CONFIG }]);
  const config = appleEldConfig({
    sampleRate: 48_000,
    channels: 2,
    head: Uint8Array.of(0xf8, 0xe6, 0x50, 0x00),
  });
  assert.equal(config.codec, "mp4a.40.2");
  assert.equal(hex(config.description as Uint8Array), CONFIG);
});

test("a browser that decodes only the ES_Descriptor, as Safari does, is played with that", async () => {
  const asked = browser(yes, (description) =>
    description === DESCRIPTOR ? "sound" : "error",
  );
  assert.equal(await chooseAppleMedia(), true);
  assert.deepEqual(
    asked.tried.map((t) => t.description),
    [CONFIG, DESCRIPTOR],
  );
  const config = appleEldConfig({
    sampleRate: 48_000,
    channels: 2,
    head: Uint8Array.of(0xf8, 0xe6, 0x50, 0x00),
  });
  assert.equal(hex(config.description as Uint8Array), DESCRIPTOR);
});

test("a picture without the sound, or the sound without the picture, keeps VP9 and Opus", async () => {
  browser(yes, () => "error");
  assert.equal(await chooseAppleMedia(), false);
  assert.throws(() =>
    appleEldConfig({
      sampleRate: 48_000,
      channels: 2,
      head: new Uint8Array(4),
    }),
  );

  const asked = browser(
    async () => ({ supported: false }),
    () => "sound",
  );
  assert.equal(await chooseAppleMedia(), false);
  assert.deepEqual(
    asked.tried,
    [],
    "the sound is not tried for a picture that will not pass",
  );
});

test("anything but a definite yes keeps VP9 and Opus", async () => {
  browser(
    async () => {
      throw new TypeError("isConfigSupported disliked the string");
    },
    () => "sound",
  );
  assert.equal(await chooseAppleMedia(), false);
  browser(
    async () => ({}),
    () => "sound",
  );
  assert.equal(await chooseAppleMedia(), false);
  // A decoder that never answers is a no, once the attempt runs out of time.
  browser(yes, () => "silent", 10);
  assert.equal(await chooseAppleMedia(), false);
});

test("the question is asked once, and the answer is not available before it", async () => {
  const asked = browser(yes, () => "sound");
  assert.throws(() => decodesAppleMedia());
  await chooseAppleMedia();
  await chooseAppleMedia();
  assert.equal(asked.probes.length, 1);
  assert.equal(asked.tried.length, 1);
});
