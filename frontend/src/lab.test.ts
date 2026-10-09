// The laboratory's two rules: what switches it, and how much it says at once.
//
// Run with `bun test src/lab.test.ts` from frontend/.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLab,
  LAB_EVERY_MS,
  LAB_KEPT,
  LAB_KEY,
  LAB_LINE_CHARS,
  LAB_LINES,
  LAB_TAPS,
  LAB_TAPS_WITHIN_MS,
  type LabStore,
  TRACE_MS,
} from "./lab.ts";

/** A store in memory, with what was written to it. */
function memory(): LabStore & { kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, value);
    },
    removeItem: (key) => {
      kept.delete(key);
    },
  };
}

/** A lab on a hand clock, whose sends and schedules the test holds. */
function harness(store: LabStore | null = memory()) {
  let clock = 0;
  const sent: string[][] = [];
  const due: { run: () => void; at: number }[] = [];
  const lab = createLab({
    store,
    now: () => clock,
    schedule: (run, ms) => {
      const entry = { run, at: clock + ms };
      due.push(entry);
      return () => {
        const i = due.indexOf(entry);
        if (i >= 0) {
          due.splice(i, 1);
        }
      };
    },
  });
  lab.send((lines) => sent.push(lines));
  const advance = (ms: number) => {
    clock += ms;
    for (const entry of [...due].sort((a, b) => a.at - b.at)) {
      if (entry.at <= clock) {
        due.splice(due.indexOf(entry), 1);
        entry.run();
      }
    }
  };
  const taps = (n: number) => {
    let switched = false;
    for (let i = 0; i < n; i++) {
      switched = lab.tap() || switched;
    }
    return switched;
  };
  return { lab, sent, due, advance, taps };
}

test("seven taps within two seconds switch it, and are kept in the store", () => {
  const store = memory();
  const h = harness(store);
  assert.equal(h.lab.on(), false);
  assert.equal(h.taps(LAB_TAPS - 1), false, "six taps switch nothing");
  assert.equal(h.lab.on(), false);
  assert.equal(h.lab.tap(), true, "the seventh does");
  assert.equal(h.lab.on(), true);
  assert.equal(store.kept.get(LAB_KEY), "on");
  // Seven more switch it off, and the store forgets it.
  assert.equal(h.taps(LAB_TAPS), true);
  assert.equal(h.lab.on(), false);
  assert.equal(store.kept.has(LAB_KEY), false);
});

test("taps spread over more than two seconds do not add up", () => {
  const h = harness();
  h.taps(LAB_TAPS - 1);
  h.advance(LAB_TAPS_WITHIN_MS);
  assert.equal(h.lab.tap(), false, "the first six are two seconds old");
  assert.equal(
    h.taps(LAB_TAPS - 1),
    true,
    "six quick ones after it make seven",
  );
});

test("a choice kept in the store is the page's from the start, and a store that is blocked is no choice", () => {
  const store = memory();
  store.setItem(LAB_KEY, "on");
  assert.equal(harness(store).lab.on(), true);
  const blocked: LabStore = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  const h = harness(blocked);
  assert.equal(h.lab.on(), false);
  assert.equal(h.taps(LAB_TAPS), true, "switched for this page all the same");
  assert.equal(h.lab.on(), true);
});

test("switched on it says so; lines go twenty at a time, four times a second, each cut to its length; off, nothing goes", () => {
  const h = harness();
  h.lab.say("before");
  h.advance(LAB_EVERY_MS);
  assert.equal(h.sent.length, 0, "nothing is said while it is off");
  h.taps(LAB_TAPS);
  for (let i = 0; i < 25; i++) {
    h.lab.say(`line ${i} ${"x".repeat(300)}`);
  }
  assert.equal(h.sent.length, 0, "gathered, not sent at once");
  h.advance(LAB_EVERY_MS);
  assert.equal(h.sent.length, 1);
  assert.equal(
    h.sent[0].length,
    LAB_LINES,
    "twenty lines a message, and no more",
  );
  assert.equal(h.sent[0][0], "lab: on");
  assert.equal(h.sent[0][1].length, LAB_LINE_CHARS);
  h.advance(LAB_EVERY_MS);
  assert.equal(h.sent.length, 2, "the rest a quarter of a second later");
  assert.equal(h.sent[1].length, 26 - LAB_LINES);
  h.advance(LAB_EVERY_MS);
  assert.equal(
    h.sent.length,
    2,
    "and nothing more while there is nothing to say",
  );
  // Off: what waits is dropped with the schedule.
  h.lab.say("waiting");
  h.taps(LAB_TAPS);
  assert.equal(h.lab.on(), false);
  h.advance(LAB_EVERY_MS);
  assert.equal(h.sent.length, 2);
  assert.equal(h.due.length, 0);
});

test("each event the page notes feeds the panel and says the same line the gateway was told", () => {
  const h = harness();
  h.taps(LAB_TAPS);
  const blank = h.lab.panel();
  assert.equal(blank.since, 0, "switched on at the clock's zero");
  assert.equal(blank.picture.asked, 0);
  assert.equal(blank.sight.hidden, 0);
  assert.equal(blank.link.connectedAt, null);

  h.lab.note({ kind: "connected", how: "vnc ard-mirror" });
  h.advance(1_000);
  h.lab.note({ kind: "resize", w: 2532, h: 1424, scale: 2 });
  h.advance(180);
  h.lab.note({ kind: "presented", w: 2532, h: 1424, scale: 2 });
  h.lab.note({ kind: "shown", w: 1170 });
  h.lab.note({ kind: "keyframe", what: "asked", reason: "the decoder failed" });
  h.lab.note({
    kind: "keyframe",
    what: "asked",
    reason: "the page was out of sight",
  });
  h.lab.note({ kind: "keyframe", what: "painted" });
  h.lab.note({ kind: "painted" });
  h.lab.note({ kind: "sight", visible: false });
  h.advance(5_000);
  h.lab.note({ kind: "sight", visible: true });
  h.lab.note({ kind: "decoder", what: "restarted" });
  h.lab.note({ kind: "decoder", what: "error", said: "AL-4601 hev1" });
  h.lab.note({ kind: "sound", leadMs: 120, restarts: 2, trims: 0 });
  h.lab.note({ kind: "dropped" });
  h.lab.note({
    kind: "keyframe",
    what: "gaveUp",
    reason: "the decoder failed",
  });

  const panel = h.lab.panel();
  assert.notEqual(
    panel,
    blank,
    "a new panel for each event, for whoever holds the last",
  );
  assert.equal(panel.link.connectedAt, 0);
  assert.equal(panel.link.resizes, 1);
  assert.equal(panel.link.echoMs, 180, "the echo of the last resize");
  assert.equal(panel.link.drops, 1);
  assert.deepEqual(panel.picture.arrives, { w: 2532, h: 1424, scale: 2 });
  assert.equal(panel.picture.shown, 1170);
  assert.equal(panel.picture.lastAt, 1_180, "the last picture painted");
  assert.equal(panel.picture.asked, 2);
  assert.equal(panel.picture.painted, 1);
  assert.equal(panel.picture.gaveUp, 1);
  assert.equal(panel.picture.restarted, 1);
  assert.equal(panel.picture.errors, 1);
  assert.equal(panel.sight.hidden, 1);
  assert.equal(panel.sight.awayMs, 5_000, "out of sight for five seconds");
  assert.equal(panel.sight.backAt, 6_180);
  assert.equal(panel.sound.leadMs, 120);
  assert.equal(panel.sound.restarts, 2);
  assert.equal(panel.sound.trims, 0);

  // The lines the gateway is told are the ones it was told before the panel.
  for (let i = 0; i < 10; i++) {
    h.advance(LAB_EVERY_MS);
  }
  const said = h.sent.flat();
  assert.deepEqual(said, [
    "lab: on",
    "connected: vnc ard-mirror",
    "resize: 2532x1424 @2",
    "presented: 2532x1424 @2",
    "shown: 1170",
    "keyframe asked: the decoder failed",
    "keyframe asked: the page was out of sight",
    "keyframe settled",
    "sight: hidden",
    "sight: visible",
    "decoder restarted",
    "video error: AL-4601 hev1",
    "audio: lead 120 ms, restarted 2, trimmed 0 in 10 s",
    "dropped",
    "keyframe given up: the decoder failed",
  ]);

  // Off, the panel is blank again, and an event noted off counts for nothing.
  h.taps(LAB_TAPS);
  h.lab.note({ kind: "sight", visible: false });
  assert.equal(h.lab.panel().since, null);
  assert.equal(h.lab.panel().sight.hidden, 0);
});

test("the panel keeps the last minute as a trace, a column a second, the spans out of sight, and the last event", () => {
  const h = harness();
  h.taps(LAB_TAPS);
  // Second 0: two batches painted and a whole picture asked for.
  h.lab.note({ kind: "painted" });
  h.lab.note({ kind: "painted" });
  h.lab.note({
    kind: "keyframe",
    what: "asked",
    reason: "the page was out of sight",
  });
  // Second 1: one batch. Seconds 2 to 4: out of sight. Second 5: back, one batch.
  h.advance(1_000);
  h.lab.note({ kind: "painted" });
  h.advance(1_000);
  h.lab.note({ kind: "sight", visible: false });
  h.advance(3_000);
  h.lab.note({ kind: "sight", visible: true });
  h.lab.note({ kind: "painted" });
  const panel = h.lab.panel();
  assert.deepEqual(panel.trace, [
    { second: 0, painted: 2, asked: true },
    { second: 1, painted: 1, asked: false },
    { second: 5, painted: 1, asked: false },
  ]);
  assert.deepEqual(panel.away, [{ from: 2_000, to: 5_000 }]);
  assert.deepEqual(panel.last, {
    event: { kind: "painted" },
    at: 5_000,
  });
  // Past the minute the oldest columns and spans go.
  h.advance(TRACE_MS);
  h.lab.note({ kind: "painted" });
  assert.deepEqual(h.lab.panel().trace, [
    { second: 65, painted: 1, asked: false },
  ]);
  assert.deepEqual(h.lab.panel().away, []);
  // Out of sight now: the span is open.
  h.lab.note({ kind: "sight", visible: false });
  assert.deepEqual(h.lab.panel().away, [{ from: 65_000, to: null }]);
});

// The cursor held at an edge of what is on screen while the view cannot move
// any further: the one thing the Chromium of the tests could not show of a
// phone's browser, so the page says the geometry it had at that moment.
test("the cursor held at an edge is counted and said with the geometry of the view", () => {
  const h = harness();
  h.taps(LAB_TAPS);
  h.lab.note({
    kind: "edge",
    side: "bottom",
    cursor: 1300,
    remote: 1424,
    pan: -158,
    zoom: 1,
    clientH: 390,
    visualH: 390,
    visualTop: 0,
    visualScale: 1,
  });
  h.lab.note({
    kind: "edge",
    side: "bottom",
    cursor: 1310,
    remote: 1424,
    pan: -158,
    zoom: 1.5,
    clientH: 390,
    visualH: null,
    visualTop: null,
    visualScale: null,
  });
  const panel = h.lab.panel();
  assert.equal(panel.picture.edges, 2);
  assert.equal(panel.last?.event.kind, "edge");
  for (let i = 0; i < 4; i++) {
    h.advance(LAB_EVERY_MS);
  }
  assert.deepEqual(h.sent.flat().slice(1), [
    "edge: bottom cursor 1300/1424 pan -158 zoom 1 client 390 visual 390@1 +0",
    "edge: bottom cursor 1310/1424 pan -158 zoom 1.5 client 390 visual —",
  ]);
});

test("past the store of lines the oldest go, and a session with no sender loses them", () => {
  const h = harness();
  h.taps(LAB_TAPS);
  for (let i = 0; i < LAB_KEPT + 50; i++) {
    h.lab.say(`line ${i}`);
  }
  const all: string[] = [];
  for (let i = 0; i < 20; i++) {
    h.advance(LAB_EVERY_MS);
  }
  for (const lines of h.sent) {
    all.push(...lines);
  }
  assert.equal(all.length, LAB_KEPT);
  assert.equal(
    all[0],
    "line 50",
    "the first fifty-one lines went: 'lab: on' and lines 0 to 49",
  );
  h.lab.send(null);
  h.lab.say("unheard");
  h.advance(LAB_EVERY_MS);
  assert.equal(all.length, LAB_KEPT);
});
