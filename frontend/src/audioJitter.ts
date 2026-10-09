// How much lead the sound needs here, measured from how its packets arrive.
//
// The schedule (audioSchedule.ts) starts the sound at the playhead and clamps what
// runs ahead, so a packet that arrives late is a hole. How late packets arrive is
// not the same on every link: a Mac on the same desk delivers one packet a frame,
// on time; a phone's socket delivers two to four at once, seconds of them late
// under a loaded encoder (measured 2026-10-08, docs/research). A lead chosen once
// for both is wrong for one of them, so the lead is measured.
//
// The measure is libwebrtc's NetEq's (`modules/audio_coding/neteq/
// underrun_optimizer.cc`): each packet's arrival delay relative to the earliest
// of the recent ones, kept in a histogram of 20 ms buckets over the last packets,
// and the target delay is a quantile of it. The relative delay is RFC 3550's
// (section 6.4.1): the difference between when a packet arrived and when it was
// due by the sender's clock, which here is the packet's own length counted from
// the first. Taken against the least of the window, a clock that drifts between
// the two ends moves nothing.

/** One bucket of the histogram, in seconds: a packet's length. */
export const JITTER_BUCKET_S = 0.02;
/** How many packets the window holds: two seconds of 20 ms packets. */
export const JITTER_SAMPLES = 100;
/** The quantile of relative delays the lead covers. */
export const JITTER_QUANTILE = 0.95;

export interface JitterMeter {
  /**
   * One packet arrived at `at` seconds on the page's clock, `packetS` seconds
   * of sound long: where the sender's clock stands for it.
   */
  arrived(at: number, packetS: number): void;
  /**
   * The lead the sound needs, in seconds: the quantile of the relative delays,
   * rounded up to a bucket. Zero until two packets have arrived.
   */
  lead(): number;
  /** Packets were dropped before the next one: the sender's clock is counted again from it. */
  reset(): void;
}

export function createJitterMeter(
  samples: number = JITTER_SAMPLES,
): JitterMeter {
  // Arrival delays against the sender's clock, the last `samples` of them.
  let delays: number[] = [];
  // Where the sender's clock stood for the last packet, on the page's clock, or
  // null before the first.
  let due: number | null = null;

  return {
    arrived(at, packetS) {
      if (due === null) {
        due = at;
      } else {
        due += packetS;
      }
      delays.push(at - due);
      if (delays.length > samples) {
        delays = delays.slice(delays.length - samples);
      }
    },
    lead() {
      if (delays.length < 2) {
        return 0;
      }
      const least = Math.min(...delays);
      const relative = delays
        .map((delay) => delay - least)
        .sort((a, b) => a - b);
      const at = Math.min(
        relative.length - 1,
        Math.max(0, Math.ceil(JITTER_QUANTILE * relative.length) - 1),
      );
      return (
        Math.max(0, Math.ceil(relative[at] / JITTER_BUCKET_S - 1e-9)) *
        JITTER_BUCKET_S
      );
    },
    reset() {
      due = null;
    },
  };
}
