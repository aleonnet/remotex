// The picture's way back after its stream's chain is cut.
//
// A decoder that failed or went quiet is thrown away, and the one built next can
// start at nothing but a keyframe, which only the gateway can send: the page asks
// for it with a `refresh` (see `onVideoNeedsKeyframe` in useRemoteDesktop.ts).
// One ask was all there was, and one is not enough. It is dropped in silence
// while the socket is not open (outbound.ts), the keyframe it brings can be the
// one the next decoder fails on, and a browser that had the page in the
// background may answer nothing until it is back. So what is owed is asked for
// again at each wait until a picture is painted.
//
// Not for ever: a browser that shows no picture after being asked for the whole
// of `ASK_FOR_MS` is not going to show one by being asked, each ask has the
// gateway encode a whole picture, and the page then says so and leaves the
// reload to the person. Coming back into sight takes it up again, because a page
// nobody was looking at is one a browser may not have been running at all.

/** How long an ask is given before the next one. */
export const ASK_EVERY_MS = 2_000;
/** How long a picture is asked for before the page says it is not coming. */
export const ASK_FOR_MS = 30_000;

/** Run `run` once, `ms` from now; what comes back calls it off. */
export type Schedule = (run: () => void, ms: number) => () => void;

const onTheClock: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export interface KeyframeAsk {
  /**
   * The chain was cut, and why: asked for at once, and again until a picture is
   * painted. A cut while one is already owed changes only what the next ask
   * says: it neither hurries it nor buys more time, so a decoder that fails on
   * every keyframe is not asked for ever.
   */
  need(reason: string): void;
  /** A picture of the stream was painted: nothing is owed. */
  painted(): void;
  /**
   * The page is back in sight: what is owed, given up on or not, is asked for
   * at once and for the whole time again.
   */
  again(): void;
  /** The attachment ended: its picture is the next attachment's to bring. */
  clear(): void;
}

export function createKeyframeAsk(options: {
  /** Ask the gateway for a keyframe. */
  ask: (reason: string) => void;
  /** The time is up with no picture painted, and what last cut the chain. */
  gaveUp: (reason: string) => void;
  schedule?: Schedule;
}): KeyframeAsk {
  const schedule = options.schedule ?? onTheClock;
  // What is owed: why, and how many more asks its time holds. Zero left with
  // nothing scheduled is a debt given up on.
  let owed: { reason: string; left: number } | null = null;
  let callOff: (() => void) | null = null;

  const stop = () => {
    callOff?.();
    callOff = null;
  };

  const turn = () => {
    callOff = null;
    if (!owed) {
      return;
    }
    if (owed.left === 0) {
      options.gaveUp(owed.reason);
      return;
    }
    owed.left -= 1;
    options.ask(owed.reason);
    callOff = schedule(turn, ASK_EVERY_MS);
  };

  const start = (reason: string) => {
    stop();
    owed = { reason, left: ASK_FOR_MS / ASK_EVERY_MS - 1 };
    options.ask(reason);
    callOff = schedule(turn, ASK_EVERY_MS);
  };

  return {
    need(reason) {
      if (owed) {
        owed.reason = reason;
        return;
      }
      start(reason);
    },
    painted() {
      stop();
      owed = null;
    },
    again() {
      if (owed) {
        start(owed.reason);
      }
    },
    clear() {
      stop();
      owed = null;
    },
  };
}
