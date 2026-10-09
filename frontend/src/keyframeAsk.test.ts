// The asking for a keyframe after the stream's chain is cut, over a clock this
// file turns by hand.
//
// Run with `bun test src/keyframeAsk.test.ts` from frontend/.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASK_EVERY_MS,
  ASK_FOR_MS,
  createKeyframeAsk,
  type Schedule,
} from "./keyframeAsk.ts";

// A clock that moves only when told: what was scheduled runs when its time comes,
// in order, and a thing scheduled from inside a run is seen by the same turn.
function clock() {
  let now = 0;
  let waiting: { at: number; run: () => void }[] = [];
  const schedule: Schedule = (run, ms) => {
    const entry = { at: now + ms, run };
    waiting.push(entry);
    return () => {
      waiting = waiting.filter((other) => other !== entry);
    };
  };
  const pass = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = waiting
        .filter((entry) => entry.at <= until)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) {
        break;
      }
      waiting = waiting.filter((entry) => entry !== next);
      now = next.at;
      next.run();
    }
    now = until;
  };
  return { schedule, pass, waiting: () => waiting.length };
}

function asking() {
  const time = clock();
  const asked: string[] = [];
  const gaveUp: string[] = [];
  const ask = createKeyframeAsk({
    ask: (reason) => asked.push(reason),
    gaveUp: (reason) => gaveUp.push(reason),
    schedule: time.schedule,
  });
  return { ...time, ask, asked, gaveUp };
}

// Every ask a debt is good for: one at once, and one each time the wait passes
// until the time is up.
const ASKS = ASK_FOR_MS / ASK_EVERY_MS;

test("the wait and the time it is asked for are the ones its owner was told", () => {
  assert.equal(ASK_EVERY_MS, 2_000);
  assert.equal(ASK_FOR_MS, 30_000);
});

test("asked, and none came: it is asked for again at each wait, and given up when the time is up", () => {
  const { ask, asked, gaveUp, pass, waiting } = asking();
  ask.need("the decoder failed");
  assert.deepEqual(asked, ["the decoder failed"], "asked at once");

  pass(ASK_EVERY_MS - 1);
  assert.equal(asked.length, 1, "not before the wait is over");
  pass(1);
  assert.equal(asked.length, 2);

  pass(ASK_FOR_MS - ASK_EVERY_MS - 1);
  assert.equal(asked.length, ASKS);
  assert.deepEqual(gaveUp, [], "not given up before the time is up");
  pass(1);
  assert.deepEqual(
    gaveUp,
    ["the decoder failed"],
    "said once, with what cut it",
  );
  assert.equal(asked.length, ASKS, "the giving up asks nothing");

  // And that is the end of it: nothing waits, and nothing more is asked.
  assert.equal(waiting(), 0);
  pass(10 * ASK_FOR_MS);
  assert.equal(asked.length, ASKS);
  assert.equal(gaveUp.length, 1);
});

test("an ask that could not leave is the same as one nobody answered: the next one goes", () => {
  const time = clock();
  let open = false;
  const sent: string[] = [];
  const ask = createKeyframeAsk({
    // A socket that is not open drops what it is given, in silence (outbound.ts).
    ask: (reason) => {
      if (open) {
        sent.push(reason);
      }
    },
    gaveUp: () => {},
    schedule: time.schedule,
  });
  ask.need("the decoder failed");
  time.pass(ASK_EVERY_MS);
  assert.deepEqual(sent, []);
  open = true;
  time.pass(ASK_EVERY_MS);
  assert.deepEqual(
    sent,
    ["the decoder failed"],
    "asked once the socket is back",
  );
});

test("it fails again: the failure behind an ask neither hurries the next nor buys more time", () => {
  const { ask, asked, gaveUp, pass } = asking();
  ask.need("the decoder failed");
  pass(ASK_EVERY_MS / 2);
  // The keyframe the first ask brought is the one the next decoder failed on.
  ask.need("the decoder failed again");
  assert.equal(asked.length, 1, "no ask of its own: one is on its way");
  pass(ASK_EVERY_MS / 2);
  assert.deepEqual(asked, ["the decoder failed", "the decoder failed again"]);

  for (let i = 0; i < 100; i += 1) {
    pass(ASK_EVERY_MS / 2);
    ask.need("the decoder failed again");
  }
  assert.equal(
    asked.length,
    ASKS,
    "a decoder that fails every time is not asked for ever",
  );
  assert.deepEqual(gaveUp, ["the decoder failed again"]);
  // Given up is given up: a failure after it asks nothing.
  ask.need("the decoder failed again");
  pass(ASK_FOR_MS);
  assert.equal(asked.length, ASKS);
  assert.equal(gaveUp.length, 1);
});

test("a picture painted is the end of the debt, and the next cut starts a new one", () => {
  const { ask, asked, gaveUp, pass, waiting } = asking();
  ask.need("the decoder went quiet");
  pass(ASK_EVERY_MS);
  assert.equal(asked.length, 2);
  ask.painted();
  assert.equal(waiting(), 0, "nothing left waiting");
  pass(ASK_FOR_MS);
  assert.equal(asked.length, 2);
  assert.deepEqual(gaveUp, []);

  // A picture with nothing owed is the ordinary case, and does nothing.
  ask.painted();
  ask.need("a malformed batch was dropped");
  assert.equal(asked.length, 3, "asked at once, as the first was");
  pass(ASK_FOR_MS);
  assert.equal(asked.length, 2 + ASKS, "with all its time");
});

test("the page back in sight asks again at once, with all the time, and only for what is owed", () => {
  const { ask, asked, gaveUp, pass } = asking();
  // Nothing owed: coming back asks nothing.
  ask.again();
  assert.deepEqual(asked, []);

  ask.need("the decoder failed");
  pass(3 * ASK_EVERY_MS + 1);
  assert.equal(asked.length, 4);
  ask.again();
  assert.equal(asked.length, 5, "at once");
  pass(ASK_FOR_MS - 1);
  assert.equal(asked.length, 4 + ASKS, "and for the whole time from there");
  assert.deepEqual(gaveUp, []);
  pass(1);
  assert.equal(gaveUp.length, 1);

  // What was given up while nobody looked is taken up again by coming back.
  ask.again();
  assert.equal(asked.length, 5 + ASKS);
  pass(ASK_EVERY_MS);
  assert.equal(asked.length, 6 + ASKS);
  ask.painted();
  ask.again();
  assert.equal(asked.length, 6 + ASKS, "painted since: nothing owed");
});

test("the attachment's end forgets the debt: its picture is the next attachment's to bring", () => {
  const { ask, asked, gaveUp, pass, waiting } = asking();
  ask.need("the decoder failed");
  ask.clear();
  assert.equal(waiting(), 0);
  pass(ASK_FOR_MS);
  ask.again();
  assert.equal(asked.length, 1);
  assert.deepEqual(gaveUp, []);
});
