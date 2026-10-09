// The rules of the session's screens, checked without a browser.
//
// Run with `bun test src/sessionState.test.ts` from frontend/.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barItems,
  coverOf,
  handleOf,
  macKeysState,
  momentOf,
  moreItems,
  mutedHere,
  muteGlyph,
  type Now,
  type Offers,
  offerState,
  veilOf,
  viewOf,
  viewOnly,
} from "./sessionState.ts";

// A page on the list, which each test then moves somewhere.
const onList: Now = {
  status: "connected",
  mode: "picker",
  pendingTarget: null,
  pictured: false,
  openedHere: false,
  settled: false,
  tab: null,
};

test("with the session held and no computer chosen, the list is shown", () => {
  assert.deepEqual(viewOf(onList), { kind: "list" });
});

test("a page asking for the session as it loads is connecting, with nothing to cancel", () => {
  assert.deepEqual(viewOf({ ...onList, status: "connecting" }), {
    kind: "opening",
    state: "connecting",
    cancel: false,
  });
});

test("Open lights the screen: connecting, then settled at five seconds, and either can be cancelled", () => {
  const opening = { ...onList, pendingTarget: "Mac mini", openedHere: true };
  assert.deepEqual(viewOf(opening), {
    kind: "opening",
    state: "connecting",
    cancel: true,
  });
  assert.deepEqual(viewOf({ ...opening, settled: true }), {
    kind: "opening",
    state: "settled",
    cancel: true,
  });
});

test("a session this page opened stays lit until its picture arrives", () => {
  // The gateway answered `connected`, and the remote has not announced its desktop.
  const answered: Now = {
    ...onList,
    mode: "desktop",
    openedHere: true,
    settled: true,
  };
  assert.deepEqual(viewOf(answered), {
    kind: "opening",
    state: "settled",
    cancel: true,
  });
  assert.deepEqual(viewOf({ ...answered, pictured: true }), {
    kind: "session",
  });
});

test("a session found open, by a reload or after a drop, is waited for", () => {
  assert.deepEqual(viewOf({ ...onList, mode: "desktop" }), {
    kind: "opening",
    state: "waiting",
    cancel: true,
  });
  // However long it takes: "settled" is the lighting's word, and nothing lit here.
  assert.deepEqual(viewOf({ ...onList, mode: "desktop", settled: true }), {
    kind: "opening",
    state: "waiting",
    cancel: true,
  });
});

test("a dropped connection is reconnecting, and offers no Cancel", () => {
  // With a session on screen or without one: ending a session goes over the
  // connection that dropped, and the list exists only with it up.
  for (const before of [
    onList,
    { ...onList, mode: "desktop" as const, pictured: true },
    { ...onList, pendingTarget: "Mac mini", openedHere: true },
  ]) {
    assert.deepEqual(viewOf({ ...before, status: "reconnecting" }), {
      kind: "opening",
      state: "reconnecting",
      cancel: false,
    });
  }
});

test("a session that is not this page's says whose it is, whatever else is held", () => {
  for (const [status, state] of [
    ["busy", "busy"],
    ["takenOver", "taken"],
    ["failed", "failed"],
    ["stale", "stale"],
  ] as const) {
    assert.deepEqual(
      viewOf({ ...onList, status, mode: "desktop", pictured: true }),
      { kind: "owner", state },
    );
  }
});

// A page showing the second display in a tab of its own, as it loads.
const onTab: Now = { ...onList, status: "connecting", tab: 2 };

test("a display's tab waits for its display, shows it, and never the list", () => {
  assert.deepEqual(viewOf(onTab), {
    kind: "opening",
    state: "connecting",
    cancel: false,
  });
  // Let in by the gateway, with no picture yet: waited for, and nothing to
  // cancel, since the session is another page's to end.
  const attached: Now = { ...onTab, status: "connected", mode: "desktop" };
  assert.deepEqual(viewOf(attached), {
    kind: "opening",
    state: "waiting",
    cancel: false,
  });
  assert.deepEqual(viewOf({ ...attached, pictured: true }), {
    kind: "session",
  });
  // Connected with no desktop is the list on the session's page, and on a
  // display's tab still the wait.
  assert.deepEqual(viewOf({ ...onTab, status: "connected" }), {
    kind: "opening",
    state: "connecting",
    cancel: false,
  });
  assert.deepEqual(viewOf({ ...attached, status: "reconnecting" }), {
    kind: "opening",
    state: "reconnecting",
    cancel: false,
  });
});

test("a display that is not this tab's to show says why, whatever else is held", () => {
  for (const [status, state] of [
    ["busy", "busy"],
    ["takenOver", "taken"],
    ["idle", "idle"],
    ["unavailable", "unavailable"],
  ] as const) {
    assert.deepEqual(
      viewOf({ ...onTab, status, mode: "desktop", pictured: true }),
      { kind: "owner", state },
    );
  }
});

// A session on a computer that offers everything, to a device that has everything.
const everything: Offers = {
  fullscreen: true,
  displays: 3,
  sound: true,
  camera: true,
  microphone: true,
  macHost: true,
  touch: true,
  appWindow: true,
  pointer: true,
  tab: null,
};

// One that offers nothing beyond a picture.
const nothing: Offers = {
  fullscreen: false,
  displays: 0,
  sound: false,
  camera: false,
  microphone: false,
  macHost: false,
  touch: false,
  appWindow: false,
  pointer: true,
  tab: null,
};

test("the bar has only what the session has: absent, not greyed", () => {
  assert.deepEqual(barItems(everything), [
    "fullscreen",
    "displays",
    "mute",
    "keyboard",
    "more",
    "end",
  ]);
  assert.deepEqual(barItems(nothing), ["keyboard", "more", "end"]);
  // A list of one display is no choice.
  assert.ok(!barItems({ ...everything, displays: 1 }).includes("displays"));
  assert.ok(!barItems({ ...everything, sound: false }).includes("mute"));
});

test("the bar of a display's tab has what is that tab's, and no more", () => {
  // Whatever the session offers: the sound, the keyboard, the menu and End are
  // its page's.
  assert.deepEqual(barItems({ ...everything, tab: 2 }), [
    "fullscreen",
    "size",
    "disconnect",
  ]);
  assert.deepEqual(barItems({ ...nothing, tab: 2 }), ["size", "disconnect"]);
  // A device with no keyboard of its own: the tab could be pointed at and not
  // typed in, so the keyboard on screen is the tab's too.
  assert.deepEqual(barItems({ ...everything, pointer: false, tab: 2 }), [
    "fullscreen",
    "size",
    "keyboard",
    "disconnect",
  ]);
});

test("the menu has only what the computer and the device offer", () => {
  assert.deepEqual(moreItems(everything), [
    "clipboard",
    "camera",
    "microphone",
    "mackeys",
    "touch",
    "window",
    "info",
    "prefs",
    "signout",
  ]);
  assert.deepEqual(moreItems(nothing), [
    "clipboard",
    "info",
    "prefs",
    "signout",
  ]);
  assert.ok(!moreItems({ ...everything, camera: false }).includes("camera"));
  assert.ok(
    !moreItems({ ...everything, microphone: false }).includes("microphone"),
  );
});

test("the window is fitted only in an installed app with a pointer", () => {
  assert.ok(!moreItems({ ...everything, appWindow: false }).includes("window"));
  // A touch client's picture fits its width: there is no 100% to size a window to.
  assert.ok(!moreItems({ ...everything, pointer: false }).includes("window"));
});

test("a camera or a microphone is off, waiting for the remote, or in use by it", () => {
  assert.equal(offerState(false, false), "off");
  assert.equal(offerState(true, false), "waiting");
  assert.equal(offerState(true, true), "inuse");
  // The remote cannot be using what is not offered.
  assert.equal(offerState(false, true), "off");
});

test("the Mac keys do not apply to a Mac, whatever is chosen", () => {
  assert.equal(macKeysState(true, false), "on");
  assert.equal(macKeysState(false, false), "off");
  assert.equal(macKeysState(true, true), "na");
  assert.equal(macKeysState(false, true), "na");
});

test("the handle keeps in sight what is in use and what went wrong, and says the same", () => {
  const quiet = {
    cameraInUse: false,
    microphoneInUse: false,
    muted: false,
    problem: false,
    display: null,
  };
  assert.deepEqual(handleOf(quiet), {
    marks: [],
    says: "session.handle",
    display: null,
  });
  assert.deepEqual(handleOf({ ...quiet, cameraInUse: true }), {
    marks: ["camera"],
    says: "session.handle.camera",
    display: null,
  });
  assert.deepEqual(handleOf({ ...quiet, microphoneInUse: true }), {
    marks: ["microphone"],
    says: "session.handle.microphone",
    display: null,
  });
  assert.deepEqual(
    handleOf({ ...quiet, cameraInUse: true, microphoneInUse: true }),
    {
      marks: ["camera", "microphone"],
      says: "session.handle.inuse",
      display: null,
    },
  );
  // A problem is the one that asks for something, so it is what is said.
  assert.deepEqual(handleOf({ ...quiet, cameraInUse: true, problem: true }), {
    marks: ["camera", "error"],
    says: "session.handle.error",
    display: null,
  });
});

test("a session muted here is marked on the handle, and said when nothing else is", () => {
  const muted = {
    cameraInUse: false,
    microphoneInUse: false,
    muted: true,
    problem: false,
    display: null,
  };
  assert.deepEqual(handleOf(muted), {
    marks: ["muted"],
    says: "session.handle.muted",
    display: null,
  });
  // What the remote is using is said ahead of it, and a problem ahead of both:
  // the mark stays in sight all the same.
  assert.deepEqual(handleOf({ ...muted, cameraInUse: true }), {
    marks: ["camera", "muted"],
    says: "session.handle.camera",
    display: null,
  });
  assert.deepEqual(handleOf({ ...muted, problem: true }), {
    marks: ["muted", "error"],
    says: "session.handle.error",
    display: null,
  });
  // A display's tab has no Mute on its bar, and so nothing of it on its handle.
  assert.deepEqual(handleOf({ ...muted, display: 2 }), {
    marks: [],
    says: "session.handle.display",
    display: 2,
  });
});

test("muted here is a session with sound that this browser is not listening to, and nothing wrong with it", () => {
  const listening = { available: true, enabled: true, fault: null };
  assert.equal(mutedHere(listening), false);
  assert.equal(mutedHere({ ...listening, enabled: false }), true);
  // A session opened without sound has nothing to mute.
  assert.equal(
    mutedHere({ available: false, enabled: false, fault: null }),
    false,
  );
  // A sound that failed is a problem, and the handle marks it as one.
  assert.equal(
    mutedHere({ ...listening, enabled: false, fault: { code: "AL-5102" } }),
    false,
  );
});

test("the Mute button is drawn as the crossed speaker while it is pressed", () => {
  assert.equal(muteGlyph(true), "volume-x");
  assert.equal(muteGlyph(false), "volume-2");
});

test("the handle of a display's tab wears its number, and still marks a problem", () => {
  const tab = {
    cameraInUse: false,
    microphoneInUse: false,
    muted: false,
    problem: false,
    display: 2,
  };
  assert.deepEqual(handleOf(tab), {
    marks: [],
    says: "session.handle.display",
    display: 2,
  });
  assert.deepEqual(handleOf({ ...tab, problem: true }), {
    marks: ["error"],
    says: "session.handle.display",
    display: 2,
  });
});

test("anything open over the remote screen makes it view only, and says what", () => {
  for (const [open, veil] of [
    ["more", "veil.menu"],
    ["clipboard", "veil.clipboard"],
    ["displays", "veil.displays"],
    ["info", "veil.info"],
    ["prefs", "veil.prefs"],
    ["throughput", "veil.throughput"],
  ] as const) {
    assert.equal(veilOf(open), veil);
    assert.equal(viewOnly(open, false), true, open);
  }
});

test("the bar by itself and the keyboard leave the remote live; a dialog does not", () => {
  // Neither is among what can be open: with nothing open the remote takes input.
  assert.equal(veilOf(null), null);
  assert.equal(viewOnly(null, false), false);
  assert.equal(viewOnly(null, true), true);
});

test("a tab whose session's page is gone says so ahead of everything else", () => {
  assert.deepEqual(
    coverOf({
      left: true,
      resizing: true,
      unavailable: true,
      held: "screens",
      displays: [0, 1, 2],
      active: 0,
    }),
    { kind: "left" },
  );
});

test("a resize that has not settled covers the screen", () => {
  assert.deepEqual(
    coverOf({
      left: false,
      resizing: true,
      unavailable: false,
      held: null,
      displays: [],
      active: null,
    }),
    { kind: "resizing" },
  );
  assert.equal(
    coverOf({
      left: false,
      resizing: false,
      unavailable: false,
      held: null,
      displays: [1, 2],
      active: 1,
    }),
    null,
  );
});

test("a desktop with no picture offers every display but the one being sent", () => {
  assert.deepEqual(
    coverOf({
      left: false,
      resizing: false,
      unavailable: false,
      held: "screens",
      displays: [0, 1, 2],
      active: 0,
    }),
    { kind: "held", cause: "screens", others: [1, 2] },
  );
  // Nothing else to show: the cover says so, and offers nothing.
  assert.deepEqual(
    coverOf({
      left: false,
      resizing: false,
      unavailable: false,
      held: "size",
      displays: [],
      active: null,
    }),
    { kind: "held", cause: "size", others: [] },
  );
  // And it is said ahead of a resize, which has nothing to do about it.
  assert.deepEqual(
    coverOf({
      left: false,
      resizing: true,
      unavailable: true,
      held: "size",
      displays: [7],
      active: 7,
    }),
    { kind: "held", cause: "size", others: [] },
  );
});

test("a display whose picture has not come is said so, behind a resize", () => {
  const waiting = {
    left: false,
    resizing: false,
    unavailable: true,
    held: null,
    displays: [1, 2],
    active: 1,
  };
  assert.deepEqual(coverOf(waiting), { kind: "unavailable" });
  // The picture is waited for because of the resize, so the resize is what is said.
  assert.deepEqual(coverOf({ ...waiting, resizing: true }), {
    kind: "resizing",
  });
});

test("the grid leaves as a picture arrives behind the lighting, and nowhere else", () => {
  assert.equal(momentOf(null, "opening", "session", false), "dissolve");
  assert.equal(momentOf(null, "list", "session", false), null);
  assert.equal(momentOf(null, "session", "opening", false), null);
  assert.equal(momentOf("dissolve", "session", "list", false), null);
  // A session that starts covered, its picture not yet come: the lit screen stays
  // up as the cover, and the grid leaves when the cover does, not here.
  assert.equal(
    momentOf(null, "opening", "session", true),
    null,
    "the cover's own going is the grid leaving",
  );
});

test("an End that was pressed is carried out when the session is back, and forgotten off a session", () => {
  // The connection drops while the picture goes dark, and comes back.
  assert.equal(momentOf("off", "session", "opening", false), "off");
  assert.equal(momentOf("off", "opening", "session", false), "off");
  assert.equal(momentOf("off", "opening", "session", true), "off");
  // Back at the list, or at somebody else's session, there is nothing to end.
  assert.equal(momentOf("off", "opening", "list", false), null);
  assert.equal(momentOf("off", "session", "owner", false), null);
});
