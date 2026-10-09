// What two fingers mean. The gesture layer decides once per two-finger drag
// whether the fingers are pinching or scrolling, and the decision holds for the
// rest of the gesture; a two-finger tap still has to survive both.
//
// Driven through a stand-in element and document, since the decision is
// arithmetic on touch coordinates and needs no layout.
//
// At the end, the layer's word for a cursor it cannot take any further: when a
// one-finger drag pushes the cursor past the edge of what is on screen and the
// view, asked to pan, does not move, the layer says so (`onEdge`), once a
// second at most. That is the geometry a phone's browser is asked for when the
// cursor stops short of the picture's bottom (plan 6, decision 4); the Chromium
// of the browser tests reaches the bottom every time, so this is the one place
// the rule is proved.
//
// Run with `bun test src/touchGestures.test.ts` from frontend/.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { ClientMsg } from "./protocol.ts";
import {
  attachTouchGestures,
  type GestureView,
  type TouchGestures,
} from "./touchGestures.ts";

type Handler = (e: TouchEvent) => void;

const REMOTE = { w: 2000, h: 1000 };
// Pixels the remote draws per point; a test changes it for a dense desktop.
let remoteScale = 1;

let sent: ClientMsg[] = [];
let view: GestureView;
let gestures: TouchGestures;
const handlers = new Map<string, Handler>();

const element = {
  addEventListener(type: string, handler: Handler) {
    handlers.set(type, handler);
  },
  removeEventListener(type: string) {
    handlers.delete(type);
  },
  getBoundingClientRect: () => ({ left: 0, top: 0 }),
} as unknown as HTMLElement;

// The overlay reads the viewport through the document; nothing else does.
Object.assign(globalThis, {
  document: { documentElement: { clientWidth: 400, clientHeight: 800 } },
});

const touch = (identifier: number, clientX: number, clientY: number) =>
  ({ identifier, clientX, clientY, force: 0 }) as unknown as Touch;

function dispatch(
  type: "touchstart" | "touchmove" | "touchend",
  touches: Touch[],
  changed: Touch[] = touches,
): void {
  handlers.get(type)?.({
    touches: touches as unknown as TouchList,
    changedTouches: changed as unknown as TouchList,
    preventDefault() {},
    stopImmediatePropagation() {},
  } as unknown as TouchEvent);
}

const wheels = () => sent.filter((msg) => msg.type === "wheel");

// That many scroll ticks, each 32 remote px along one axis.
const ticks = (count: number, dx: number, dy: number) =>
  Array.from({ length: count }, () => ({
    type: "wheel",
    dx,
    dy,
    unit: "pixel",
  }));

// Two fingers, 50px apart, moved together by the given offsets in turn.
function twoFingerDrag(steps: readonly { dx: number; dy: number }[]): void {
  dispatch("touchstart", [touch(1, 100, 400), touch(2, 150, 400)]);
  for (const step of steps) {
    dispatch("touchmove", [
      touch(1, 100 + step.dx, 400 + step.dy),
      touch(2, 150 + step.dx, 400 + step.dy),
    ]);
  }
}

beforeEach(() => {
  sent = [];
  remoteScale = 1;
  view = { fit: 0.2, zoom: 1, pan: { x: 0, y: 0 } };
  handlers.clear();
  gestures = attachTouchGestures(element, {
    send: (msg) => sent.push(msg),
    remoteSize: () => ({ ...REMOTE, scale: remoteScale }),
    view: () => view,
    applyView: (zoom, pan) => {
      view = { fit: view.fit, zoom, pan };
    },
  });
  gestures.notePointer(1000, 500);
});

test("fingers moving in parallel scroll, in the natural direction", () => {
  // 12px classifies the gesture as a scroll and names its axis. The desktop is
  // shown at a fifth of its size, so the 44px the fingers covered is 220px of
  // it: six ticks, and 28px carried.
  twoFingerDrag([
    { dx: 0, dy: 12 },
    { dx: 0, dy: 44 },
  ]);
  assert.deepEqual(wheels(), ticks(6, 0, -32));
  assert.equal(view.zoom, 1, "a scroll never zooms");
});

test("a swipe delivered as one move scrolls by all of it", () => {
  // The browser is free to coalesce a fast swipe into a single touchmove: the
  // travel that classifies the gesture has to count, or a flick scrolls nothing.
  twoFingerDrag([{ dx: 0, dy: 100 }]);
  assert.deepEqual(wheels(), ticks(15, 0, -32));
});

test("a zoomed-in view scrolls the less for the same travel", () => {
  // Content follows the fingers: at 1:1 the 44px they covered is 44px of the
  // desktop, one tick.
  view = { fit: 0.2, zoom: 5, pan: { x: 0, y: 0 } };
  twoFingerDrag([
    { dx: 0, dy: 12 },
    { dx: 0, dy: 44 },
  ]);
  assert.deepEqual(wheels(), ticks(1, 0, -32));
});

test("a dense desktop scrolls by its points, not its pixels", () => {
  // Drawn at two pixels a point, the 220 pixels the fingers covered are 110
  // points: three ticks.
  remoteScale = 2;
  twoFingerDrag([
    { dx: 0, dy: 12 },
    { dx: 0, dy: 44 },
  ]);
  assert.deepEqual(wheels(), ticks(3, 0, -32));
});

test("a sideways drag scrolls sideways", () => {
  twoFingerDrag([
    { dx: 12, dy: 0 },
    { dx: 44, dy: 0 },
  ]);
  assert.deepEqual(wheels(), ticks(6, -32, 0));
});

test("a diagonal drag locks onto the axis it was classified on", () => {
  // Mostly downwards, then hard to the right: the sideways travel arrives after
  // the lock and never reaches the wire as a horizontal tick.
  twoFingerDrag([
    { dx: 4, dy: 12 },
    { dx: 60, dy: 44 },
  ]);
  assert.deepEqual(wheels(), ticks(6, 0, -32));
});

test("fingers changing their distance pinch, and never scroll", () => {
  dispatch("touchstart", [touch(1, 100, 400), touch(2, 150, 400)]);
  dispatch("touchmove", [touch(1, 80, 400), touch(2, 170, 400)]);
  dispatch("touchmove", [touch(1, 50, 400), touch(2, 200, 400)]);
  assert.ok(view.zoom > 1, `expected a zoom, got ${view.zoom}`);
  assert.deepEqual(wheels(), []);
});

test("a scroll that drifts apart stays a scroll", () => {
  dispatch("touchstart", [touch(1, 100, 400), touch(2, 150, 400)]);
  dispatch("touchmove", [touch(1, 100, 412), touch(2, 150, 412)]);
  // The same downward travel, with the fingers spreading as they go.
  dispatch("touchmove", [touch(1, 60, 444), touch(2, 190, 444)]);
  assert.deepEqual(wheels(), ticks(6, 0, -32));
  assert.equal(view.zoom, 1);
});

test("two fingers that stay put are still a right-click", () => {
  dispatch("touchstart", [touch(1, 100, 400), touch(2, 150, 400)]);
  dispatch("touchmove", [touch(1, 102, 401), touch(2, 151, 400)]);
  dispatch("touchend", [touch(2, 151, 400)], [touch(1, 102, 401)]);
  dispatch("touchend", [], [touch(2, 151, 400)]);
  assert.deepEqual(
    sent.filter((msg) => msg.type === "mouseButton"),
    [
      { type: "mouseButton", button: "right", pressed: true, clicks: 1 },
      { type: "mouseButton", button: "right", pressed: false, clicks: 1 },
    ],
  );
});

test("a scroll releases without clicking anything", () => {
  twoFingerDrag([
    { dx: 0, dy: 12 },
    { dx: 0, dy: 44 },
  ]);
  dispatch("touchend", [touch(2, 150, 444)], [touch(1, 100, 444)]);
  dispatch("touchend", [], [touch(2, 150, 444)]);
  assert.deepEqual(
    sent.filter((msg) => msg.type === "mouseButton"),
    [],
  );
});

// ---- the cursor held at an edge ----

interface FakeTouch {
  identifier: number;
  clientX: number;
  clientY: number;
  force?: number;
}

/** An element with listeners the test fires itself, and a rect at the origin. */
function surface() {
  const listeners = new Map<string, (event: unknown) => void>();
  const el = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLElement;
  const fire = (type: string, touches: FakeTouch[], changed = touches) => {
    const event = {
      touches,
      changedTouches: changed,
      preventDefault() {},
      stopImmediatePropagation() {},
    };
    listeners.get(type)?.(event);
  };
  return { el, fire };
}

/**
 * A view of a 640×480 remote shown at 1:1 on a window 390 points tall, panned
 * to its limit: the picture's bottom sits at the window's bottom, as far as the
 * view's own clamp knows (`vh`). The gesture layer measures the window itself,
 * through `document`, which the test sets apart from the clamp's: that is the
 * disagreement a browser's own zoom leaves behind, and what `onEdge` reports.
 */
function viewOf(vh: number) {
  const size = { w: 640, h: 480, scale: 1 };
  const view: GestureView = { fit: 1, zoom: 1, pan: { x: 0, y: vh - size.h } };
  return {
    size,
    view,
    applyView(zoom: number, pan: { x: number; y: number }) {
      view.zoom = zoom;
      view.pan = {
        x: Math.min(Math.max(pan.x, Math.min(0, 844 - size.w * zoom)), 0),
        y: Math.min(Math.max(pan.y, Math.min(0, vh - size.h * zoom)), 0),
      };
    },
  };
}

function withDocument(clientHeight: number, run: () => void) {
  const had = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    documentElement: { clientWidth: 844, clientHeight },
  };
  try {
    run();
  } finally {
    (globalThis as { document?: unknown }).document = had;
  }
}

test("a cursor pushed past the bottom of what is on screen, with the view at its limit, is said once a second", () => {
  const { el, fire } = surface();
  const v = viewOf(390);
  const edges: {
    side: string;
    cursor: number;
    remote: number;
    pan: number;
    zoom: number;
  }[] = [];
  let now = 10_000;
  // The window the layer measures is shorter than the clamp's: 300 of 390.
  withDocument(300, () => {
    attachTouchGestures(el, {
      send() {},
      remoteSize: () => v.size,
      view: () => v.view,
      applyView: (zoom, pan) => v.applyView(zoom, pan),
      onEdge: (edge) => edges.push(edge),
      now: () => now,
    });
    // One finger, down far enough to be a drag of the cursor, then on past
    // the edge: the cursor starts at the centre and is pushed down 600 points.
    fire("touchstart", [{ identifier: 1, clientX: 200, clientY: 100 }]);
    for (let y = 120; y <= 700; y += 20) {
      fire("touchmove", [{ identifier: 1, clientX: 200, clientY: y }]);
    }
    assert.equal(
      edges.length,
      1,
      "said once, however many moves held it there",
    );
    assert.deepEqual(edges[0], {
      side: "bottom",
      cursor: 389,
      remote: 480,
      pan: -90,
      zoom: 1,
    });
    // A second later, still held there: said again.
    now += 1_000;
    fire("touchmove", [{ identifier: 1, clientX: 200, clientY: 720 }]);
    assert.equal(edges.length, 2);
    fire("touchend", [], [{ identifier: 1, clientX: 200, clientY: 720 }]);
  });
});

test("while the view can still move, the cursor at the edge pans it and nothing is said", () => {
  const { el, fire } = surface();
  const v = viewOf(390);
  // Not at the limit yet: the picture can still slide up by 60.
  v.view.pan.y = -30;
  const edges: unknown[] = [];
  withDocument(390, () => {
    attachTouchGestures(el, {
      send() {},
      remoteSize: () => v.size,
      view: () => v.view,
      applyView: (zoom, pan) => v.applyView(zoom, pan),
      onEdge: (edge) => edges.push(edge),
      now: () => 0,
    });
    fire("touchstart", [{ identifier: 1, clientX: 200, clientY: 100 }]);
    for (let y = 120; y <= 400; y += 20) {
      fire("touchmove", [{ identifier: 1, clientX: 200, clientY: y }]);
    }
    assert.equal(
      v.view.pan.y,
      -90,
      "the view slid to its limit under the cursor",
    );
    assert.equal(
      edges.length,
      0,
      "and the cursor reached the picture's bottom: no edge",
    );
    fire("touchend", [], [{ identifier: 1, clientX: 200, clientY: 400 }]);
  });
});
