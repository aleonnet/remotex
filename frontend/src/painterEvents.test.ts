// What the page does with each word the paint worker says, without a worker.
//
// Run with `bun test src/painterEvents.test.ts` from frontend/.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PainterHandlers } from "./desktopPainter.ts";
import type { PainterEvent } from "./desktopPainterWorker.ts";
import { deliverPainterEvent } from "./painterEvents.ts";

function page() {
  const heard: string[] = [];
  const handlers: PainterHandlers = {
    onVideoError: (fault) => heard.push(`error:${fault?.code ?? "none"}`),
    onVideoNeedsKeyframe: (reason) => heard.push(`needs:${reason}`),
    onVideoSettled: () => heard.push("settled"),
    onPainted: (sequence) => heard.push(`painted:${sequence}`),
    onResized: (seq) => heard.push(`resized:${seq}`),
    onReached: (seq) => heard.push(`reached:${seq}`),
  };
  const deliver = (
    event: PainterEvent,
    clears: number,
    to: PainterHandlers | null = handlers,
  ) =>
    deliverPainterEvent(event, clears, to, (shown) =>
      heard.push(`graphics:${shown}`),
    );
  return { heard, deliver };
}

test("a keyframe asked for by an attachment a clear has ended is not the page's to ask for", () => {
  // The worker said it before it took the clear, and the page hears it after
  // posting one: asked for then, it would be asked for on the next attachment's
  // account, which owes nothing and so would never say it was settled.
  const { heard, deliver } = page();
  deliver({ type: "videoNeedsKeyframe", reason: "went quiet", epoch: 0 }, 1);
  deliver({ type: "videoSettled", epoch: 0 }, 1);
  deliver({ type: "graphicsShown", shown: true, epoch: 0 }, 1);
  assert.deepEqual(heard, []);

  deliver({ type: "videoNeedsKeyframe", reason: "went quiet", epoch: 1 }, 1);
  deliver({ type: "videoSettled", epoch: 1 }, 1);
  deliver({ type: "graphicsShown", shown: true, epoch: 1 }, 1);
  assert.deepEqual(heard, ["needs:went quiet", "settled", "graphics:true"]);
});

test("what carries no attachment goes to the handlers that are bound", () => {
  const { heard, deliver } = page();
  deliver({ type: "videoError", fault: { code: "AL-4602" } }, 3);
  deliver({ type: "videoError", fault: null }, 3);
  deliver({ type: "resized", seq: 7 }, 3);
  deliver({ type: "reached", seq: 8 }, 3);
  deliver(
    { type: "painted", sequence: 4, generation: 2, queuedMs: 0, drawMs: 1 },
    3,
  );
  assert.deepEqual(heard, [
    "error:AL-4602",
    "error:none",
    "resized:7",
    "reached:8",
    "painted:4",
  ]);
});

test("with no attachment bound nothing is told, and the picture's canvas is still shown or hidden", () => {
  const { heard, deliver } = page();
  deliver({ type: "resized", seq: 7 }, 0, null);
  deliver(
    { type: "videoNeedsKeyframe", reason: "went quiet", epoch: 0 },
    0,
    null,
  );
  deliver({ type: "graphicsShown", shown: false, epoch: 0 }, 0, null);
  assert.deepEqual(heard, ["graphics:false"]);
});
