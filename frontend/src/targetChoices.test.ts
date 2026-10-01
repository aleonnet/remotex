// Which options a target shows at the picker, which are greyed, and what Start
// then sends. The properties under test are the picker's three rules: not offered
// is not shown, offered but unavailable is greyed with the reason, and a target
// that can only be passed cannot start in a browser that cannot take it.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  type Abilities,
  type Choices,
  readRememberedChoices,
  rememberChoice,
  type TargetInfo,
  targetOptions,
} from "./targetChoices.ts";

const ABLE: Abilities = { appleMedia: true, rdpGraphics: true };
const UNABLE: Abilities = { appleMedia: false, rdpGraphics: false };

function target(offers: Partial<TargetInfo>): TargetInfo {
  return {
    name: "t",
    protocol: "vnc",
    subtype: null,
    host: "192.0.2.1",
    port: 5900,
    resize: false,
    audio: false,
    passthrough: null,
    passthroughOnly: false,
    ...offers,
  };
}

const RDP = target({
  protocol: "rdp",
  resize: true,
  audio: true,
  passthrough: "rdp-graphics",
});
const HIGH_PERFORMANCE = target({
  subtype: "ard-high-performance",
  resize: true,
  passthrough: "apple-media",
});

function keys(rows: { key: keyof Choices }[]): string[] {
  return rows.map((row) => row.key);
}

test("only what the target's type offers has a row", () => {
  assert.deepEqual(keys(targetOptions(RDP, undefined, ABLE).rows), [
    "resize",
    "audio",
    "passthrough",
  ]);
  // A plain VNC server: resize, and nothing else to choose.
  assert.deepEqual(
    keys(targetOptions(target({ resize: true }), undefined, ABLE).rows),
    ["resize"],
  );
  // wlshare's VP9 is the subtype's picture, not a choice.
  assert.deepEqual(
    keys(
      targetOptions(
        target({ subtype: "wlshare", resize: true, audio: true }),
        undefined,
        ABLE,
      ).rows,
    ),
    ["resize", "audio"],
  );
  // Standard Screen Sharing on the Mac's physical displays offers nothing.
  const standard = targetOptions(target({ subtype: "ard" }), undefined, ABLE);
  assert.deepEqual(standard.rows, []);
  assert.deepEqual(standard.choices, {
    resize: false,
    audio: false,
    passthrough: false,
  });
  assert.equal(standard.blocked, null);
});

test("nothing is chosen until somebody chooses it", () => {
  const options = targetOptions(RDP, undefined, ABLE);
  assert.deepEqual(options.choices, {
    resize: false,
    audio: false,
    passthrough: false,
  });
  assert.equal(options.sound, false);
  assert.ok(options.rows.every((row) => !row.checked && !row.disabled));
});

test("what was ticked last time is what Start sends", () => {
  const options = targetOptions(RDP, { resize: true, audio: true }, ABLE);
  assert.deepEqual(options.choices, {
    resize: true,
    audio: true,
    passthrough: false,
  });
  assert.equal(options.sound, true);
  // A choice remembered for something the target no longer offers is not sent.
  const plain = targetOptions(
    target({ resize: true }),
    { resize: true, audio: true, passthrough: true },
    ABLE,
  );
  assert.deepEqual(plain.choices, {
    resize: true,
    audio: false,
    passthrough: false,
  });
});

test("High Performance's sound has no row and is always carried", () => {
  const options = targetOptions(HIGH_PERFORMANCE, undefined, ABLE);
  assert.deepEqual(keys(options.rows), ["resize", "passthrough"]);
  assert.equal(options.choices.audio, false);
  assert.equal(options.sound, true);
});

test("a passthrough this browser cannot take is greyed, with the reason", () => {
  for (const [offered, reason] of [
    [RDP, /WebGL 2/],
    [HIGH_PERFORMANCE, /does not decode/],
  ] as const) {
    // Remembered from a browser that could: still not sent from one that cannot.
    const options = targetOptions(offered, { passthrough: true }, UNABLE);
    const row = options.rows.find((r) => r.key === "passthrough");
    assert.ok(row);
    assert.equal(row.disabled, true);
    assert.equal(row.checked, false);
    assert.match(row.note, reason);
    assert.equal(options.choices.passthrough, false);
    assert.equal(options.blocked, null, "the target still starts, encoded");
  }
});

test("a gateway that cannot decode the Mac's stream can only pass it", () => {
  const only = { ...HIGH_PERFORMANCE, passthroughOnly: true };
  const able = targetOptions(only, { passthrough: false }, ABLE);
  const row = able.rows.find((r) => r.key === "passthrough");
  assert.ok(row);
  assert.equal(row.checked, true, "shown as the choice already made");
  assert.equal(row.disabled, true);
  assert.equal(able.choices.passthrough, true);
  assert.equal(able.blocked, null);

  // And where the browser cannot take it either, the target cannot start: Start
  // says so before the Mac is dialled.
  const unable = targetOptions(only, undefined, UNABLE);
  assert.match(unable.blocked ?? "", /cannot decode the Mac's stream/);
});

test("an RDP host's pipeline is never the only way, whatever the entry says", () => {
  // Every gateway composes the pipeline itself, so the flag means nothing here
  // and none of the Mac's wording reaches an RDP target.
  const flagged = { ...RDP, passthroughOnly: true };
  const able = targetOptions(flagged, { passthrough: false }, ABLE);
  const row = able.rows.find((r) => r.key === "passthrough");
  assert.ok(row);
  assert.equal(row.checked, false);
  assert.equal(row.disabled, false, "still a choice");
  assert.equal(able.blocked, null);

  const unable = targetOptions(flagged, undefined, UNABLE);
  assert.equal(unable.blocked, null, "the target still starts, encoded");
  assert.match(
    unable.rows.find((r) => r.key === "passthrough")?.note ?? "",
    /cannot compose/,
  );
});

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };
});

test("choices are remembered per target", () => {
  assert.deepEqual(readRememberedChoices(), {});
  let remembered = rememberChoice({}, "win", "audio", true);
  remembered = rememberChoice(remembered, "win", "resize", true);
  remembered = rememberChoice(remembered, "mac", "passthrough", true);
  remembered = rememberChoice(remembered, "win", "audio", false);
  const expected = {
    win: { audio: false, resize: true },
    mac: { passthrough: true },
  };
  assert.deepEqual(remembered, expected);
  assert.deepEqual(readRememberedChoices(), expected, "and written through");
});

test("unreadable storage remembers nothing and still returns the choice", () => {
  storage.set("remotex.targetChoices", "not json");
  assert.deepEqual(readRememberedChoices(), {});
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readRememberedChoices(), {});
  assert.deepEqual(rememberChoice({}, "win", "resize", true), {
    win: { resize: true },
  });
});
