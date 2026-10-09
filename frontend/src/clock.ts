// The one clock. Everything that moves in the page's own interface is a
// subscriber here, and this is the only place that asks the browser for a frame.
//
// It says on the document's root whether it is running or stopped
// (`data-al-clock`), which is what a test asks instead of counting frames. Where
// the system asks for reduced motion it never runs: a caller is refused, and
// shows its end state at once.
//
// The remote desktop's picture is not this clock's: it is painted by a worker of
// its own (desktopPainter.ts), at the stream's pace.

/** One frame's work. Returning false ends the subscription. */
type Step = (now: number) => boolean;

const REDUCED = "(prefers-reduced-motion: reduce)";
const running = new Set<Step>();
let frame = 0;

function reduced(): boolean {
  return matchMedia(REDUCED).matches;
}

/**
 * Whether anything moves here: not where the system asks for reduced motion. For
 * a movement the stylesheet makes, whose start a component has to arrange.
 */
export function moves(): boolean {
  return !reduced();
}

function report(): void {
  document.documentElement.dataset.alClock = frame ? "running" : "stopped";
}

function tick(now: number): void {
  frame = 0;
  for (const step of [...running]) {
    if (!step(now)) {
      running.delete(step);
    }
  }
  wake();
}

function wake(): void {
  if (!frame && running.size > 0 && !document.hidden && !reduced()) {
    frame = requestAnimationFrame(tick);
  }
  report();
}

document.addEventListener("visibilitychange", wake);

/**
 * Run `step` every frame until it returns false. Refused, and false, where
 * motion is reduced: the caller then shows its end state at once.
 */
export function run(step: Step): boolean {
  if (reduced()) {
    report();
    return false;
  }
  running.add(step);
  wake();
  return true;
}

/** End `step`'s subscription, and the frame asked for where it was the last. */
export function stop(step: Step): void {
  running.delete(step);
  if (running.size === 0 && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  report();
}
