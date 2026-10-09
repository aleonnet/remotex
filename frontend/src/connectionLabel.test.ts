// What the information sheet says about the connection.
//
// The case that matters is the one where `protocol` alone is not an answer: several
// targets say `vnc`, and what a person notices about them — a display list, a
// target that follows its window or keeps a fixed display, a path that is reverse
// engineered — differs by subtype and by nothing else on the wire.

import assert from "node:assert/strict";
import { test } from "node:test";

import { connectionLabel, connectionMode } from "./connectionLabel.ts";

const vnc = (subtype: string | null) => ({ protocol: "vnc", subtype });

test("a target with no subtype is just its protocol", () => {
  assert.equal(connectionLabel({ protocol: "rdp", subtype: null }), "RDP");
  assert.equal(connectionLabel(vnc(null)), "VNC");
});

test("a subtype is said in the config's own spelling, so the line can be found", () => {
  assert.equal(connectionLabel(vnc("ard")), "VNC · ard");
  assert.equal(connectionLabel(vnc("ard-mirror")), "VNC · ard-mirror");
  assert.equal(connectionLabel(vnc("wlshare")), "VNC · wlshare");
});

test("each mode is named in plain words, a Mac's two as the list calls them", () => {
  const named = (subtype: string | null, virtual = false) =>
    connectionMode(vnc(subtype), virtual);
  assert.deepEqual(connectionMode({ protocol: "rdp", subtype: null }, false), {
    key: "type.rdp",
  });
  assert.deepEqual(named(null), { key: "type.vnc" });
  assert.deepEqual(named("wlshare"), { key: "type.wlshare" });
  assert.deepEqual(named("ard-high-performance"), { key: "mode.virtual" });
  assert.deepEqual(named("ard-mirror"), { key: "mode.mirrored" });
  assert.deepEqual(named("ard"), { key: "mode.compatible" });
  // Standard mode on a display of its own: the remote reported a virtual display.
  assert.deepEqual(named("ard", true), { key: "mode.compatibleOwn" });
});

test("a subtype this build has never heard of still names itself", () => {
  // The gateway and this client ship together, so this is a build mismatch rather
  // than a new feature — and a line that dropped the value would describe the
  // session wrongly rather than incompletely.
  assert.deepEqual(connectionMode(vnc("ard-something-new"), false), {
    data: "VNC · ard-something-new",
  });
});
