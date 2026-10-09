// The page's laboratory: what it saw, told to the gateway for its log and shown
// on the page as a live panel.
//
// A session on a phone fails in ways the gateway's log cannot see from its side —
// what the browser's decoder said, when the picture's socket was let go, how
// late the sound ran — and a phone has no console to read. Switched on, the page
// notes those things as events (`note`): each is said to the gateway in a `lab`
// message (protocol.ts), which it writes in its log line by line and nowhere
// else, and each is counted into the panel (`panel`) the information sheet
// shows, by kind, the moment it happens: the picture, the sound, the tab's sight
// and the connection, as counters and measures, not as lines, since whoever has
// the phone in hand wants to know how many and how late, not to read a log.
// Switched off, which is how it starts, it says nothing of this and the panel
// is blank.
//
// It is switched by seven taps or clicks within two seconds on the "Version" row
// of the information sheet, the way Android's developer options are, and the
// choice is kept in this browser (`localStorage`), so a session opened to look
// at a defect is looked at from the first message.
//
// The gateway holds what it takes (src/ws.rs, `LabGate`): four messages a
// second, twenty lines each, 240 characters a line, and a message past that is
// dropped whole. So lines are gathered and sent at most every 300 ms, three and
// a third a second under the gateway's four, so that a message early by a
// timer's jitter is never the fifth of one second; twenty at a time, each cut to
// its length; what more there is waits, and past a store of them the oldest go.

/** How many taps switch the laboratory, and within how long. */
export const LAB_TAPS = 7;
export const LAB_TAPS_WITHIN_MS = 2_000;
/** The gateway's limits, kept here so that no message is dropped there. */
export const LAB_LINES = 20;
export const LAB_LINE_CHARS = 240;
export const LAB_EVERY_MS = 300;
/** How many lines wait to be sent at most; past that the oldest are dropped. */
export const LAB_KEPT = 200;
export const LAB_KEY = "alumia.lab";
/** How far back the panel's trace of the picture reaches: a column a second. */
export const TRACE_MS = 60_000;

/** Where the choice is kept: `localStorage`, or nothing where it is blocked. */
export interface LabStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Run `run` once, `ms` from now; what comes back calls it off. */
export type LabSchedule = (run: () => void, ms: number) => () => void;

/** Something the page saw. */
export type LabEvent =
  /** A session opened on this page, by its protocol and subtype. */
  | { kind: "connected"; how: string }
  /** The connection to the gateway dropped. */
  | { kind: "dropped" }
  /** The gateway named the desktop's size. */
  | { kind: "resize"; w: number; h: number; scale: number }
  /** The paint worker echoed that size: the bitmap is on screen. */
  | { kind: "presented"; w: number; h: number; scale: number }
  /** A keyframe asked of the gateway, painted, or given up on. */
  | { kind: "keyframe"; what: "asked" | "painted" | "gaveUp"; reason?: string }
  /** The decoder thrown away on the way back into sight, or what it said. */
  | { kind: "decoder"; what: "restarted" | "error"; said?: string }
  /** The page left or came back into sight. */
  | { kind: "sight"; visible: boolean }
  /** The width the page shows the picture at, in CSS pixels. */
  | { kind: "shown"; w: number }
  /** The sound's lead, restarts and trims over the last ten seconds. */
  | { kind: "sound"; leadMs: number; restarts: number; trims: number }
  /**
   * The trackpad cursor held at an edge of what is on screen while the view,
   * asked to pan, did not move (touchGestures.ts): where it was, in the
   * remote's pixels, and the geometry the page had, the window's height it
   * clamps by and the browser's own visual viewport, where the browser has one.
   * What the Chromium of the tests could not show of a phone's browser.
   */
  | {
      kind: "edge";
      side: "top" | "bottom" | "left" | "right";
      cursor: number;
      remote: number;
      pan: number;
      zoom: number;
      clientH: number;
      visualH: number | null;
      visualTop: number | null;
      visualScale: number | null;
    }
  /**
   * A batch of the picture painted. Counted and not said: two a second would
   * be most of the log, and the gateway counts them itself.
   */
  | { kind: "painted" };

/** What the page has seen since the laboratory was switched on, by kind. */
export interface Panel {
  /** When it was switched on, or null while off. */
  since: number | null;
  picture: {
    /** The width the picture is shown at, in CSS pixels, where the page said one. */
    shown: number | null;
    /** The size the picture arrives at, as last presented. */
    arrives: { w: number; h: number; scale: number } | null;
    /** When the last batch was painted. */
    lastAt: number | null;
    asked: number;
    painted: number;
    gaveUp: number;
    restarted: number;
    errors: number;
    /** How many times the cursor was held at an edge with the view at its limit. */
    edges: number;
  };
  sound: {
    leadMs: number | null;
    restarts: number;
    trims: number;
  };
  sight: {
    /** How many times the page went out of sight. */
    hidden: number;
    /** How long it was out of sight in all, in milliseconds. */
    awayMs: number;
    /** When it last went out of sight, while it is. */
    hiddenAt: number | null;
    /** When it last came back. */
    backAt: number | null;
  };
  link: {
    connectedAt: number | null;
    drops: number;
    resizes: number;
    /** When the last resize was named, until its echo. */
    resizeAt: number | null;
    /** How long the last resize took to be on screen, in milliseconds. */
    echoMs: number | null;
  };
  /**
   * The picture over the last minute (`TRACE_MS`), a column a second, by the
   * second it is (`at` in whole seconds): how many batches were painted in it,
   * and whether a whole picture was asked for. A second with nothing painted has
   * no column.
   */
  trace: { second: number; painted: number; asked: boolean }[];
  /** The spans the page was out of sight in the last minute; `to` null while it is. */
  away: { from: number; to: number | null }[];
  /** The last event noted, and when. */
  last: { event: LabEvent; at: number } | null;
}

const BLANK: Panel = {
  since: null,
  picture: {
    shown: null,
    arrives: null,
    lastAt: null,
    asked: 0,
    painted: 0,
    gaveUp: 0,
    restarted: 0,
    errors: 0,
    edges: 0,
  },
  sound: { leadMs: null, restarts: 0, trims: 0 },
  sight: { hidden: 0, awayMs: 0, hiddenAt: null, backAt: null },
  link: {
    connectedAt: null,
    drops: 0,
    resizes: 0,
    resizeAt: null,
    echoMs: null,
  },
  trace: [],
  away: [],
  last: null,
};

/** The line the gateway is told for an event, or null for one that is counted alone. */
export function lineOf(event: LabEvent): string | null {
  switch (event.kind) {
    case "connected":
      return `connected: ${event.how}`;
    case "dropped":
      return "dropped";
    case "resize":
      return `resize: ${event.w}x${event.h} @${event.scale}`;
    case "presented":
      return `presented: ${event.w}x${event.h} @${event.scale}`;
    case "keyframe":
      if (event.what === "asked") {
        return `keyframe asked: ${event.reason ?? ""}`;
      }
      if (event.what === "gaveUp") {
        return `keyframe given up: ${event.reason ?? ""}`;
      }
      return "keyframe settled";
    case "decoder":
      return event.what === "restarted"
        ? "decoder restarted"
        : `video error: ${event.said ?? ""}`;
    case "sight":
      return `sight: ${event.visible ? "visible" : "hidden"}`;
    case "shown":
      return `shown: ${event.w}`;
    case "sound":
      return `audio: lead ${event.leadMs} ms, restarted ${event.restarts}, trimmed ${event.trims} in 10 s`;
    case "edge": {
      const visual =
        event.visualH === null
          ? "—"
          : `${event.visualH}@${event.visualScale} +${event.visualTop}`;
      return `edge: ${event.side} cursor ${event.cursor}/${event.remote} pan ${event.pan} zoom ${event.zoom} client ${event.clientH} visual ${visual}`;
    }
    case "painted":
      return null;
  }
}

/** The panel after each kind of event, seen at `at`: a new one, for whoever holds the last. */
const AFTER: {
  [K in LabEvent["kind"]]: (
    panel: Panel,
    event: Extract<LabEvent, { kind: K }>,
    at: number,
  ) => Panel;
} = {
  connected: (panel, _event, at) => ({
    ...panel,
    link: { ...panel.link, connectedAt: at },
  }),
  dropped: (panel) => ({
    ...panel,
    link: { ...panel.link, drops: panel.link.drops + 1 },
  }),
  resize: (panel, _event, at) => ({
    ...panel,
    link: { ...panel.link, resizes: panel.link.resizes + 1, resizeAt: at },
  }),
  presented: (panel, event, at) => ({
    ...panel,
    picture: {
      ...panel.picture,
      arrives: { w: event.w, h: event.h, scale: event.scale },
    },
    link: {
      ...panel.link,
      echoMs:
        panel.link.resizeAt === null
          ? panel.link.echoMs
          : Math.round(at - panel.link.resizeAt),
      resizeAt: null,
    },
  }),
  keyframe: (panel, event) => ({
    ...panel,
    picture: {
      ...panel.picture,
      asked: panel.picture.asked + (event.what === "asked" ? 1 : 0),
      painted: panel.picture.painted + (event.what === "painted" ? 1 : 0),
      gaveUp: panel.picture.gaveUp + (event.what === "gaveUp" ? 1 : 0),
    },
  }),
  decoder: (panel, event) => ({
    ...panel,
    picture: {
      ...panel.picture,
      restarted: panel.picture.restarted + (event.what === "restarted" ? 1 : 0),
      errors: panel.picture.errors + (event.what === "error" ? 1 : 0),
    },
  }),
  sight: (panel, event, at) => {
    const { sight } = panel;
    if (event.visible) {
      return {
        ...panel,
        sight: {
          ...sight,
          awayMs:
            sight.awayMs + (sight.hiddenAt === null ? 0 : at - sight.hiddenAt),
          hiddenAt: null,
          backAt: at,
        },
      };
    }
    return {
      ...panel,
      sight: { ...sight, hidden: sight.hidden + 1, hiddenAt: at },
    };
  },
  shown: (panel, event) => ({
    ...panel,
    picture: { ...panel.picture, shown: event.w },
  }),
  sound: (panel, event) => ({
    ...panel,
    sound: {
      leadMs: event.leadMs,
      restarts: panel.sound.restarts + event.restarts,
      trims: panel.sound.trims + event.trims,
    },
  }),
  painted: (panel, _event, at) => ({
    ...panel,
    picture: { ...panel.picture, lastAt: at },
  }),
  edge: (panel) => ({
    ...panel,
    picture: { ...panel.picture, edges: panel.picture.edges + 1 },
  }),
};

/** The trace after `event` at `at`: the second's column marked, the minute kept. */
function traced(
  trace: Panel["trace"],
  event: LabEvent,
  at: number,
): Panel["trace"] {
  const painted = event.kind === "painted";
  const asked = event.kind === "keyframe" && event.what === "asked";
  if (!painted && !asked) {
    return trace;
  }
  const second = Math.floor(at / 1000);
  const last = trace.at(-1);
  const column =
    last?.second === second
      ? {
          ...last,
          painted: last.painted + (painted ? 1 : 0),
          asked: last.asked || asked,
        }
      : { second, painted: painted ? 1 : 0, asked };
  const kept = (last?.second === second ? trace.slice(0, -1) : trace).filter(
    (c) => c.second > second - TRACE_MS / 1000,
  );
  return [...kept, column];
}

/** The spans out of sight after `event` at `at`: opened, closed, and the minute kept. */
function kept(away: Panel["away"], event: LabEvent, at: number): Panel["away"] {
  let spans = away.filter(
    (span) => span.to === null || span.to > at - TRACE_MS,
  );
  if (event.kind === "sight") {
    const open = spans.at(-1);
    if (!event.visible && open?.to !== null) {
      spans = [...spans, { from: at, to: null }];
    } else if (event.visible && open?.to === null) {
      spans = [...spans.slice(0, -1), { ...open, to: at }];
    }
  }
  return spans;
}

/** The panel after `event`, seen at `at`: a new one, for whoever holds the last. */
export function counted(panel: Panel, event: LabEvent, at: number): Panel {
  // Each kind's own hand, told the event as its kind.
  const after = AFTER[event.kind] as (
    panel: Panel,
    event: LabEvent,
    at: number,
  ) => Panel;
  const next = after(panel, event, at);
  return {
    ...next,
    trace: traced(next.trace, event, at),
    away: kept(next.away, event, at),
    last: { event, at },
  };
}

export interface Lab {
  /** Whether the laboratory is on. */
  on(): boolean;
  /**
   * A tap on the version: the seventh within the window switches the
   * laboratory, and says so. Whether this one switched it.
   */
  tap(): boolean;
  /** Something the page saw, where the laboratory is on; nothing where it is off. */
  say(line: string): void;
  /**
   * Something the page saw: said to the gateway as its line, and counted into
   * the panel, where the laboratory is on; nothing where it is off.
   */
  note(event: LabEvent): void;
  /** What the page has seen since it was switched on: the same object until the next event. */
  panel(): Panel;
  /** Where the lines go: the session's sender, or nothing between sessions. */
  send(to: ((lines: string[]) => void) | null): void;
  /** Be told when the laboratory is switched, and at each event noted. */
  subscribe(listener: () => void): () => void;
}

export function createLab(options: {
  store?: LabStore | null;
  schedule?: LabSchedule;
  now?: () => number;
}): Lab {
  const store = options.store ?? null;
  const schedule: LabSchedule =
    options.schedule ??
    ((run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  const now = options.now ?? (() => performance.now());

  let on = read();
  let panel: Panel = on ? { ...BLANK, since: now() } : BLANK;
  let taps: number[] = [];
  let waiting: string[] = [];
  let to: ((lines: string[]) => void) | null = null;
  let callOff: (() => void) | null = null;
  const listeners = new Set<() => void>();

  function read(): boolean {
    try {
      return store?.getItem(LAB_KEY) === "on";
    } catch {
      return false;
    }
  }

  function keep(): void {
    try {
      if (on) {
        store?.setItem(LAB_KEY, "on");
      } else {
        store?.removeItem(LAB_KEY);
      }
    } catch {
      // Not kept; the choice still holds for this page.
    }
  }

  const tell = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const flush = () => {
    callOff = null;
    const lines = waiting.slice(0, LAB_LINES);
    waiting = waiting.slice(lines.length);
    if (lines.length > 0) {
      to?.(lines);
    }
    if (waiting.length > 0) {
      callOff = schedule(flush, LAB_EVERY_MS);
    }
  };

  const say = (line: string) => {
    if (!on) {
      return;
    }
    waiting.push(
      line.length > LAB_LINE_CHARS ? line.slice(0, LAB_LINE_CHARS) : line,
    );
    if (waiting.length > LAB_KEPT) {
      waiting = waiting.slice(waiting.length - LAB_KEPT);
    }
    callOff ??= schedule(flush, LAB_EVERY_MS);
  };

  return {
    on: () => on,
    tap() {
      const at = now();
      taps = taps.filter((tapped) => at - tapped < LAB_TAPS_WITHIN_MS);
      taps.push(at);
      if (taps.length < LAB_TAPS) {
        return false;
      }
      taps = [];
      on = !on;
      keep();
      if (on) {
        panel = { ...BLANK, since: at };
        say("lab: on");
      } else {
        // Nothing said while off goes, and nothing waiting goes either; and the
        // panel is blank again.
        callOff?.();
        callOff = null;
        waiting = [];
        panel = BLANK;
      }
      tell();
      return true;
    },
    say,
    note(event) {
      if (!on) {
        return;
      }
      const line = lineOf(event);
      if (line !== null) {
        say(line);
      }
      panel = counted(panel, event, now());
      tell();
    },
    panel: () => panel,
    send(next) {
      to = next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** `localStorage`, where this browser lets the page keep anything. */
function browserStore(): LabStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The page's one laboratory. */
export const lab: Lab = createLab({ store: browserStore() });
