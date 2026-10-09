// Pure scheduling policy for decoded remote-audio buffers. It maintains a
// continuous playhead and discards excess lead rather than accumulating latency.
//
// Guacamole's browser policy, with one measured number: begin at the audio
// playhead plus the lead the arrivals were measured to need (audioJitter.ts),
// and clamp any accumulated queue to 300 ms. A late packet produces a gap
// instead of turning temporary jitter into permanent remote-desktop lag, and the
// lead is what keeps a packet that is late by what the last hundred were from
// being a gap at all.

/// Furthest ahead of the audio clock the schedule may run, and the most lead a
/// start is given.
export const MAX_LEAD_S = 0.3;

export interface Scheduled {
  /** When to start this buffer, on the audio context's clock. */
  startAt: number;
  /**
   * Seconds to skip from the *front* of this buffer, which is how catching up is
   * expressed: `AudioBufferSourceNode.start(when, offset)` takes it directly, so
   * nothing is copied and nothing is resampled to drop it.
   */
  trim: number;
  /** Where the timeline stands once this buffer has played. */
  nextAt: number;
  /**
   * The ceiling was hit, so audio already scheduled past `startAt` has to be
   * stopped there. Without that, this buffer would play *over* the tail of the last
   * one rather than in place of it — which is what Guacamole's clamp does, and why
   * it needs a quietest-point search to hide the seam.
   */
  clamped: boolean;
  /**
   * The timeline had run out: a first buffer, or one after an underrun, started
   * at the playhead and the lead rather than where the last one ended.
   */
  restarted: boolean;
}

/**
 * Place a decoded buffer back-to-back, or — where the timeline has run out —
 * `lead` seconds after the playhead, never more than the ceiling; or at the
 * maximum lead with its excess front trimmed.
 */
export function scheduleBuffer(
  nextAt: number,
  now: number,
  duration: number,
  lead: number,
): Scheduled {
  const restarted = nextAt < now;
  const startAt = restarted
    ? now + Math.min(Math.max(lead, 0), MAX_LEAD_S)
    : nextAt;
  const ceiling = now + MAX_LEAD_S;
  if (startAt <= ceiling) {
    return {
      startAt,
      trim: 0,
      nextAt: startAt + duration,
      clamped: false,
      restarted,
    };
  }
  // Never more than the buffer holds: past that there is nothing left to skip, and
  // the buffer is dropped whole rather than started before it exists.
  const trim = Math.min(startAt - ceiling, duration);
  return {
    startAt: ceiling,
    trim,
    nextAt: ceiling + (duration - trim),
    clamped: true,
    restarted,
  };
}
