// The lead the sound is given is the one its arrivals measure: nothing for a
// steady stream, the span of a burst for packets that come in bundles, and what
// the late ones need where they are more than a few.
//
// Run with `bun test src/audioJitter.test.ts` from frontend/.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createJitterMeter, JITTER_BUCKET_S } from "./audioJitter.ts";

const PACKET_S = 0.02;

test("a stream that arrives on time needs no lead", () => {
  const meter = createJitterMeter();
  assert.equal(meter.lead(), 0, "nothing measured yet");
  for (let i = 0; i < 200; i++) {
    meter.arrived(10 + i * PACKET_S, PACKET_S);
  }
  assert.equal(meter.lead(), 0);
});

test("packets that arrive in bundles need the span of a bundle", () => {
  const meter = createJitterMeter();
  // Four packets at once every 80 ms: the first of each bundle is 60 ms behind the last.
  for (let frame = 0; frame < 50; frame++) {
    for (let k = 0; k < 4; k++) {
      meter.arrived(5 + frame * 0.08, PACKET_S);
    }
  }
  assert.ok(Math.abs(meter.lead() - 0.06) < 1e-9, `got ${meter.lead()}`);
});

test("one late packet in a hundred raises nothing; a tenth of them do", () => {
  const meter = createJitterMeter();
  for (let i = 0; i < 100; i++) {
    meter.arrived(1 + i * PACKET_S + (i === 50 ? 0.05 : 0), PACKET_S);
  }
  assert.equal(meter.lead(), 0, "the quantile leaves one out");
  const jittery = createJitterMeter();
  for (let i = 0; i < 100; i++) {
    jittery.arrived(1 + i * PACKET_S + (i % 10 === 0 ? 0.05 : 0), PACKET_S);
  }
  assert.ok(
    Math.abs(jittery.lead() - 0.06) < 1e-9,
    `fifty milliseconds, rounded up to a bucket: got ${jittery.lead()}`,
  );
});

test("the window forgets, and a reset counts the sender's clock from the next packet", () => {
  const meter = createJitterMeter(10);
  for (let i = 0; i < 10; i++) {
    meter.arrived(i * PACKET_S + (i % 2 === 0 ? 0.1 : 0), PACKET_S);
  }
  assert.ok(meter.lead() > 0);
  for (let i = 10; i < 20; i++) {
    meter.arrived(i * PACKET_S, PACKET_S);
  }
  assert.equal(meter.lead(), 0, "the late packets have left the window");
  // A gap: the sender's clock would say every packet after it is seconds late.
  meter.reset();
  for (let i = 0; i < 10; i++) {
    meter.arrived(100 + i * PACKET_S, PACKET_S);
  }
  assert.equal(meter.lead(), 0);
});

test("a lead is a whole number of buckets", () => {
  const meter = createJitterMeter();
  for (let i = 0; i < 100; i++) {
    meter.arrived(i * PACKET_S + (i % 2 === 0 ? 0.013 : 0), PACKET_S);
  }
  assert.ok(
    Math.abs(meter.lead() - JITTER_BUCKET_S) < 1e-9,
    `got ${meter.lead()}`,
  );
});
