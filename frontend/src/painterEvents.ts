// What the page does with each word the paint worker says.
//
// The worker outlives an attachment and answers a `clear` when its turn comes,
// so a word it said for the attachment that clear ended can reach the page after
// the page has moved on. Most words are harmless then, or carry their own fence
// (a `resized` is matched against what the binding still waits for, a `painted`
// against the socket's generation). Three are an attachment's and nothing else
// says whose: the keyframe a cut chain needs, what settles it, and whether the
// picture's canvas is shown. Each carries the count of clears the worker had
// taken when it said it, and one said before the last clear is dropped here. A
// keyframe asked for on a dead attachment's word would be asked for on the next
// one's account, which owes nothing and so would never say it was settled: the
// page would ask until it gave up, and then say a picture that is there is gone.

import type { PainterHandlers } from "./desktopPainter.ts";
import type { PainterEvent } from "./desktopPainterWorker.ts";

/**
 * Hand `event` to the attachment that is bound. `clears` is how many clears the
 * page has posted, which is the worker's own count once it has taken them all.
 */
export function deliverPainterEvent(
  event: PainterEvent,
  clears: number,
  handlers: PainterHandlers | null,
  showGraphics: (shown: boolean) => void,
): void {
  if ("epoch" in event && event.epoch !== clears) {
    return;
  }
  if (event.type === "graphicsShown") {
    showGraphics(event.shown);
    return;
  }
  if (!handlers) {
    return;
  }
  switch (event.type) {
    case "videoError":
      handlers.onVideoError(event.fault);
      break;
    case "videoNeedsKeyframe":
      handlers.onVideoNeedsKeyframe(event.reason);
      break;
    case "videoSettled":
      handlers.onVideoSettled();
      break;
    case "resized":
      handlers.onResized(event.seq);
      break;
    case "reached":
      handlers.onReached(event.seq);
      break;
    case "painted":
      handlers.onPainted(
        event.sequence,
        event.generation,
        event.queuedMs,
        event.drawMs,
      );
      break;
  }
}
