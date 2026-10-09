import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Glyph } from "./Glyph.tsx";
import { usePreferences } from "./preferences.tsx";
import {
  type Box,
  type CellId,
  cellsOf,
  hintOf,
  type KeyboardFormat,
  type LayoutCell,
  type LayoutPage,
  type LayoutRow,
  type LocalAct,
  labelOf,
  MODIFIER_KEYS,
  modifierOf,
  type PageId,
  pageFor,
  shiftHeld,
  underCapsLock,
  withinPage,
} from "./softKeyboard.ts";
import {
  createHitTester,
  type GeometryRow,
  type Rect,
} from "./softKeyGeometry.ts";
import {
  createPressEngine,
  type HitTester,
  type ModifierState,
  type PointerKind,
  type PointerSample,
  type PressCommand,
  type PressEngine,
  type StepResult,
} from "./softKeyPress.ts";
import type { WordKey } from "./words.ts";

// The keyboard on screen: a window that is carried, or two pages docked at the
// bottom of a phone. Both are pages of softKeyboard.ts drawn as cells, and one
// press engine (softKeyPress.ts) listening on the key area turns fingers into
// keys for both — no cell has a pointer handler of its own.
//
// It is the one thing over the remote screen that is itself input, so the remote
// stays live under it (sessionState.ts): a press here goes to the remote like a
// press on a keyboard. Every key is a real button, with its name and the focus
// of any button.

// How far an arrow key carries the window.
const CARRY_STEP_PX = 16;

// The pointer a press from a real keyboard is given: no device has it.
const KEYBOARD_POINTER = -1;

// ── The engine's host: DOM events in, state and keys out ──

interface EngineHandlers {
  /** A key, with the modifiers held around it, as the engine decided it. */
  send: (codes: string[]) => void;
  onFocusDesktop: () => void;
  onLocal: (does: LocalAct) => void;
  setPage: (page: PageId) => void;
  setSticky: (on: boolean) => void;
  setHeld: (held: ReadonlyMap<string, ModifierState>) => void;
  setActive: (ids: ReadonlySet<CellId>) => void;
  setPreviews: (
    update: (
      prev: ReadonlyMap<number, Preview>,
    ) => ReadonlyMap<number, Preview>,
  ) => void;
}

interface Preview {
  id: CellId;
  // The cell's centre x and top y, relative to the key area.
  x: number;
  y: number;
}

function toRect(r: DOMRect): Rect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

// Measure every key of the area into a hit tester. The shortcut row is left
// out: its keys commit on tap where they are touched, and the ones that slide
// do so under a finger, so a slide never resolves into it, and the area's bounds
// start below it.
function measure(area: HTMLElement): HitTester {
  const rows: GeometryRow[] = [];
  let top = area.getBoundingClientRect().top;
  for (const rowEl of area.querySelectorAll<HTMLElement>("[data-row]")) {
    if (rowEl.dataset.row === "shortcut") {
      top = Math.max(top, rowEl.getBoundingClientRect().bottom);
      continue;
    }
    const cells = [...rowEl.querySelectorAll<HTMLElement>("[data-cell]")].map(
      (el) => ({
        id: el.dataset.cell ?? "",
        rect: toRect(el.getBoundingClientRect()),
        spacer: el.dataset.spacer === "true",
      }),
    );
    if (cells.length > 0) {
      rows.push({ rect: toRect(rowEl.getBoundingClientRect()), cells });
    }
  }
  const bounds = { ...toRect(area.getBoundingClientRect()), top };
  return createHitTester(rows, bounds);
}

function pointerKind(type: string): PointerKind {
  return type === "touch" || type === "pen" ? type : "mouse";
}

// Where a cell sits, for the preview over it.
function previewOf(area: HTMLElement, id: CellId): Preview | null {
  const el = area.querySelector<HTMLElement>(`[data-cell="${id}"]`);
  if (!el) {
    return null;
  }
  const a = area.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { id, x: r.left - a.left + r.width / 2, y: r.top - a.top };
}

// The cell an event is on, as the DOM has it, or `skip` for a control in the key
// area with a click of its own (a phone's ✕). A spacer is no cell: the hit
// tester gives the finger to the neighbouring key.
function cellUnder(e: Event): { cell: CellId | null; skip: boolean } {
  const target = e.target instanceof Element ? e.target : null;
  const cellEl = target?.closest<HTMLElement>("[data-cell]") ?? null;
  if (cellEl) {
    const spacer = cellEl.dataset.spacer === "true";
    return { cell: spacer ? null : (cellEl.dataset.cell ?? null), skip: false };
  }
  return { cell: null, skip: target?.closest("button") !== null };
}

// Every pointer is captured by the key area, which outlives the keys: a mouse
// released outside the keyboard would otherwise be lost, and a touch would
// otherwise stay with the key it landed on, which a change of page replaces
// under a resting thumb, taking its lift with it.
function capture(area: HTMLElement, e: PointerEvent) {
  try {
    area.setPointerCapture(e.pointerId);
  } catch {
    // A pointer that is already gone: its up or cancel follows.
  }
}

// A key is being typed; if focus has fallen to the body, the physical keyboard
// has gone silent with it.
function focusIfLost(h: EngineHandlers) {
  if (
    document.activeElement === null ||
    document.activeElement === document.body
  ) {
    h.onFocusDesktop();
  }
}

function withPreview(
  prev: ReadonlyMap<number, Preview>,
  pointerId: number,
  preview: Preview | null,
): ReadonlyMap<number, Preview> {
  const next = new Map(prev);
  if (preview) {
    next.set(pointerId, preview);
  } else {
    next.delete(pointerId);
  }
  return next;
}

// A tick of feedback where the device has it (Android); iOS has no such API.
function vibrate() {
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(10);
  }
}

// Keep the engine for the keyboard's life, listen on the key area, and run its
// commands. The handlers are read through a ref so the listeners are attached
// once and never go stale. Returns the call that forgets the keys' measured
// positions, for whatever moves them without changing the page (the window being
// carried).
function useSoftKeyEngine(
  areaRef: RefObject<HTMLDivElement | null>,
  page: LayoutPage,
  handlers: EngineHandlers,
): () => void {
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  const geometryRef = useRef<HitTester | null>(null);
  const engineRef = useRef<PressEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = createPressEngine((x, y, prefer) => {
      if (geometryRef.current === null) {
        const area = areaRef.current;
        geometryRef.current = area ? measure(area) : () => null;
      }
      return geometryRef.current(x, y, prefer);
    }, cellsOf(page));
  }

  // The keys moved: measure again at the next touch.
  const invalidateGeometry = useCallback(() => {
    geometryRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    const observer = new ResizeObserver(invalidateGeometry);
    observer.observe(area);
    window.addEventListener("resize", invalidateGeometry);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", invalidateGeometry);
    };
  }, [areaRef, invalidateGeometry]);

  // Runs a result's commands and arms the next tick. Set by the listener effect
  // below for the page effect after it, which never outlives it.
  const applyRef = useRef<(result: StepResult) => void>(() => {});

  useEffect(() => {
    const area = areaRef.current;
    const engine = engineRef.current;
    if (!area || !engine) {
      return;
    }
    let timer: number | null = null;

    const run = (command: PressCommand) => {
      const h = handlersRef.current;
      switch (command.kind) {
        case "send":
          h.send(command.codes);
          focusIfLost(h);
          break;
        case "modifiers":
          h.setHeld(command.held);
          break;
        case "active":
          h.setActive(command.ids);
          break;
        case "preview": {
          const { pointerId, id } = command;
          const preview = id === null ? null : previewOf(area, id);
          h.setPreviews((prev) => withPreview(prev, pointerId, preview));
          break;
        }
        case "page":
          h.setPage(command.page);
          break;
        case "sticky":
          h.setSticky(command.on);
          break;
        case "local":
          h.onLocal(command.does);
          break;
        case "haptic":
          vibrate();
          break;
      }
    };

    const apply = (result: StepResult) => {
      for (const command of result.commands) {
        run(command);
      }
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (result.nextTickAt !== null) {
        const delay = Math.max(0, result.nextTickAt - performance.now());
        timer = window.setTimeout(() => {
          timer = null;
          apply(engine.handle({ kind: "tick", t: performance.now() }));
        }, delay);
      }
    };
    applyRef.current = apply;

    const sample = (e: PointerEvent): PointerSample => ({
      id: e.pointerId,
      kind: pointerKind(e.pointerType),
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
    });
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) {
        return;
      }
      const { cell, skip } = cellUnder(e);
      if (skip) {
        return;
      }
      // No focus change, no text selection, no compatibility mouse events.
      e.preventDefault();
      capture(area, e);
      apply(engine.handle({ kind: "down", p: sample(e), cell }));
    };
    const onMove = (e: PointerEvent) =>
      apply(engine.handle({ kind: "move", p: sample(e) }));
    const onUp = (e: PointerEvent) =>
      apply(engine.handle({ kind: "up", p: sample(e) }));
    const onCancel = (e: PointerEvent) =>
      apply(
        engine.handle({
          kind: "cancel",
          id: e.pointerId,
          t: performance.now(),
        }),
      );
    // A press from a real keyboard, Enter or Space on the focused key, arrives as
    // a click with no pointer behind it: that one is the key too, down and up at
    // once. A click that follows a pointer is not a second press.
    const onClick = (e: MouseEvent) => {
      const { cell } = cellUnder(e);
      if (e.detail !== 0 || cell === null) {
        return;
      }
      const p: PointerSample = {
        id: KEYBOARD_POINTER,
        kind: "mouse",
        x: 0,
        y: 0,
        t: performance.now(),
      };
      apply(engine.handle({ kind: "down", p, cell }));
      apply(engine.handle({ kind: "up", p }));
    };
    const cancelAll = () =>
      apply(engine.handle({ kind: "cancelAll", t: performance.now() }));
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        cancelAll();
      }
    };
    // Android's long-press menu would otherwise cancel a held key; the
    // compatibility mousedown would otherwise move focus in WebKit.
    const swallow = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("[data-cell]")) {
        e.preventDefault();
      }
    };

    area.addEventListener("pointerdown", onDown);
    area.addEventListener("pointermove", onMove);
    area.addEventListener("pointerup", onUp);
    area.addEventListener("pointercancel", onCancel);
    area.addEventListener("lostpointercapture", onCancel);
    area.addEventListener("click", onClick);
    area.addEventListener("contextmenu", swallow);
    area.addEventListener("mousedown", swallow);
    window.addEventListener("blur", cancelAll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      area.removeEventListener("pointerdown", onDown);
      area.removeEventListener("pointermove", onMove);
      area.removeEventListener("pointerup", onUp);
      area.removeEventListener("pointercancel", onCancel);
      area.removeEventListener("lostpointercapture", onCancel);
      area.removeEventListener("click", onClick);
      area.removeEventListener("contextmenu", swallow);
      area.removeEventListener("mousedown", swallow);
      window.removeEventListener("blur", cancelAll);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      // Whatever was held when the keyboard closed is over.
      apply(engine.handle({ kind: "cancelAll", t: performance.now() }));
      applyRef.current = () => {};
    };
  }, [areaRef]);

  // A new page: new cells under the fingers, and new positions under the next
  // touch. The fingers themselves stay — a thumb resting on a modifier keeps it
  // through the switch, and its lift still arrives, since the key area that
  // captured it is the same element on every page.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    geometryRef.current = null;
    applyRef.current(engine.handle({ kind: "layout", cells: cellsOf(page) }));
  }, [page]);

  return invalidateGeometry;
}

// ── Cells ──

// The keys named by something other than what is drawn on them: an arrow is a
// glyph, and so is a phone's Super.
const SPOKEN: ReadonlyMap<string, WordKey> = new Map([
  ["ArrowLeft", "keyboard.left"],
  ["ArrowUp", "keyboard.up"],
  ["ArrowDown", "keyboard.down"],
  ["ArrowRight", "keyboard.right"],
  ["MetaLeft", "keyboard.super"],
]);

/** What the keys are drawn from: what is held, what is on, what is under a finger. */
interface Shown {
  format: KeyboardFormat;
  shift: boolean;
  caps: boolean;
  extended: boolean;
  sticky: boolean;
  held: ReadonlyMap<string, ModifierState>;
  active: ReadonlySet<CellId>;
}

// Held or on, for a key that stays so; undefined for one that does not. A
// modifier is such a key only while modifiers stick: with the Sticky key off it
// is a key like any other, sent alone.
function pressedOf(cell: LayoutCell, shown: Shown): boolean | undefined {
  const { def } = cell;
  if (def.type === "sticky") {
    return shown.sticky;
  }
  if (def.type === "local") {
    return def.does === "caps" ? shown.caps : shown.extended;
  }
  if (def.type === "special" && modifierOf(def) && shown.sticky) {
    return shown.held.has(def.code);
  }
  return undefined;
}

// What a key is called where what is written on it does not say.
function spokenOf(cell: LayoutCell): WordKey | undefined {
  const { def } = cell;
  if (def.type === "sticky") {
    return "keyboard.stickyKey";
  }
  if (def.type === "local") {
    return def.does === "caps" ? "keyboard.caps" : "keyboard.fn";
  }
  return def.type === "special" ? SPOKEN.get(def.code) : undefined;
}

// How a key is drawn, from what is written on it and the row it is in.
function keyClass(row: LayoutRow, label: string, phone: boolean): string {
  // A letter is a letter; everything else on a keyboard is quieter than one.
  const quiet = row.kind === "shortcut" || label.length > 1;
  // A word on a key of a phone's rows, which may be one unit wide, is set
  // smaller. A key of the row that slides is as wide as its words ask.
  const word = phone && row.kind !== "shortcut" && label.length > 2;
  return `al-key${quiet ? " al-key--quiet" : ""}${word ? " al-key--word" : ""}`;
}

// A cell is the whole hit area, edge to edge with its neighbours; the key drawn
// inside it is only a picture. It has no pointer handler of its own: the key
// area's engine decides what a touch on it means. A real button, with its name,
// reached and pressed from a real keyboard like any other.
function Cell({
  cell,
  row,
  shown,
}: {
  cell: LayoutCell;
  row: LayoutRow;
  shown: Shown;
}) {
  const { t } = usePreferences();
  const { def } = cell;
  const style = { "--al-w": cell.units } as CSSProperties;
  if (def.type === "spacer") {
    return (
      <span
        className="al-cell"
        data-cell={cell.id}
        data-spacer="true"
        style={style}
      />
    );
  }
  const phone = shown.format === "phone";
  const label = labelOf(def, shown.shift, shown.caps);
  const hint = phone ? hintOf(def, shown.shift) : null;
  const spoken = spokenOf(cell);
  // A switch is a key of the keyboard's own, and says what it does: neither what
  // is written on it nor its place does.
  const switches = def.type === "sticky" || def.type === "local";
  // A switch and the keys it has turned loose are drawn open: the Sticky key
  // while off, and every modifier with it.
  const bare =
    !shown.sticky && (def.type === "sticky" || modifierOf(def) !== null);
  return (
    <button
      type="button"
      className={def.type === "sticky" ? "al-cell al-cell--fixed" : "al-cell"}
      style={style}
      aria-pressed={pressedOf(cell, shown)}
      aria-label={spoken && t(spoken)}
      title={spoken && switches ? t(spoken) : undefined}
      data-cell={cell.id}
      data-al-held={shown.active.has(cell.id) ? "" : undefined}
      data-al-bare={bare ? "" : undefined}
      data-al-switch={def.type === "sticky" ? "" : undefined}
    >
      <span className={keyClass(row, label, phone)}>
        {label}
        {hint && (
          <span className="al-keyhint" aria-hidden="true">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

function Rows({ rows, shown }: { rows: LayoutRow[]; shown: Shown }) {
  return rows.map((row) => (
    <div
      key={row.cells[0].id}
      className={row.kind === "strip" ? "al-keys al-keys--low" : "al-keys"}
      data-row={row.kind}
    >
      {row.cells.map((cell) => (
        <Cell key={cell.id} cell={cell} row={row} shown={shown} />
      ))}
    </div>
  ));
}

// ── The keyboard ──

export function SoftKeyboardPanel({
  format,
  sendKeyCombo,
  onClose,
  onDockedHeightChange,
  onFocusDesktop,
}: {
  /** A window that is carried, or docked on a phone. */
  format: KeyboardFormat;
  // Presses each DOM code in order then releases in reverse (transient — see
  // useRemoteDesktop.sendKeyCombo). The keyboard's only channel to the remote.
  sendKeyCombo: (codes: string[]) => void;
  onClose: () => void;
  // Reports the keyboard's height (CSS px) while it is docked to the bottom edge
  // of a phone, and 0 while it is a window or when it closes. The picture then
  // ends where the keyboard begins instead of lying under it.
  onDockedHeightChange: (px: number) => void;
  // Hands focus back to the remote screen when a key finds it lost: the physical
  // keyboard's listeners live there.
  onFocusDesktop: () => void;
}) {
  const { t } = usePreferences();
  // Which of a phone's two pages is up.
  const [pageId, setPageId] = useState<PageId>("abc");
  // Whether the function and navigation rows are on show, and whether Caps Lock
  // is on: both stay as the person left them while the keyboard is open.
  const [extended, setExtended] = useState(false);
  const [caps, setCaps] = useState(false);
  const [held, setHeld] = useState<ReadonlyMap<string, ModifierState>>(
    () => new Map(),
  );
  const [sticky, setSticky] = useState(true);
  const [active, setActive] = useState<ReadonlySet<CellId>>(() => new Set());
  const [previews, setPreviews] = useState<ReadonlyMap<number, Preview>>(
    () => new Map(),
  );
  const panel = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  // Where the window was carried to, or null while it sits where it opens.
  const [carried, setCarried] = useState<Box | null>(null);
  const docked = format !== "window";
  const page = pageFor(format, pageId, extended);

  const invalidateGeometry = useSoftKeyEngine(area, page, {
    // Caps Lock is this keyboard's own, and nothing the engine knows: it is
    // applied to what the engine sends (softKeyboard.ts).
    send: (codes) => sendKeyCombo(underCapsLock(codes, caps)),
    onFocusDesktop,
    onLocal: (does) =>
      (does === "caps" ? setCaps : setExtended)((on: boolean) => !on),
    setPage: setPageId,
    setSticky,
    setHeld,
    setActive,
    setPreviews,
  });

  useEffect(() => {
    const element = panel.current;
    if (!docked || !element) {
      onDockedHeightChange(0);
      return;
    }
    const measured = () =>
      onDockedHeightChange(element.getBoundingClientRect().height);
    measured();
    const observer = new ResizeObserver(measured);
    observer.observe(element);
    return () => {
      observer.disconnect();
      onDockedHeightChange(0);
    };
  }, [docked, onDockedHeightChange]);

  // Put the window at `wanted`, held inside the page (softKeyboard.ts). The keys
  // have moved with it: where they are is measured again at the next touch.
  const carry = useCallback(
    (wanted: Box) => {
      const element = panel.current;
      if (!element) {
        return;
      }
      setCarried(
        withinPage(
          wanted,
          { x: element.offsetWidth, y: element.offsetHeight },
          { x: window.innerWidth, y: window.innerHeight },
        ),
      );
      invalidateGeometry();
    },
    [invalidateGeometry],
  );
  // A window made smaller must not leave the keyboard outside it.
  useEffect(() => {
    if (!carried) {
      return;
    }
    const kept = () => carry(carried);
    window.addEventListener("resize", kept);
    return () => window.removeEventListener("resize", kept);
  }, [carried, carry]);

  const spot = (): Box => {
    const box = panel.current?.getBoundingClientRect();
    return { x: box?.left ?? 0, y: box?.top ?? 0 };
  };
  const gripDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const grip = event.currentTarget;
    const from = spot();
    const origin = { x: event.clientX, y: event.clientY };
    const move = (now: PointerEvent) =>
      carry({
        x: from.x + now.clientX - origin.x,
        y: from.y + now.clientY - origin.y,
      });
    const stop = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", stop);
      grip.removeEventListener("pointercancel", stop);
    };
    grip.setPointerCapture(event.pointerId);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", stop);
    grip.addEventListener("pointercancel", stop);
    event.preventDefault();
  };
  const gripKey = (event: ReactKeyboardEvent) => {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-CARRY_STEP_PX, 0],
      ArrowRight: [CARRY_STEP_PX, 0],
      ArrowUp: [0, -CARRY_STEP_PX],
      ArrowDown: [0, CARRY_STEP_PX],
    };
    const step = steps[event.key];
    if (!step) {
      return;
    }
    const from = spot();
    carry({ x: from.x + step[0], y: from.y + step[1] });
    event.preventDefault();
  };

  const cells = useMemo(() => cellsOf(page), [page]);
  const shown: Shown = {
    format,
    shift: shiftHeld(held.keys()),
    caps,
    extended,
    sticky,
    held,
    active,
  };

  // Held modifiers with no key on this page — a right Alt armed on a phone's
  // second page, say — are named beside the way out, so they are never unseen.
  const unseen = useMemo(() => {
    const onPage = new Set<string>();
    for (const cell of cells.values()) {
      if (cell.def.type === "special") {
        onPage.add(cell.def.code);
      }
    }
    return [...held.keys()].filter((code) => !onPage.has(code));
  }, [cells, held]);

  const style =
    carried && !docked
      ? ({
          "--al-kbd-x": `${carried.x}px`,
          "--al-kbd-y": `${carried.y}px`,
        } as CSSProperties)
      : undefined;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset draws a border and a legend, and this is a window of keys with its own head
    <div
      ref={panel}
      className="al-kbd al-glass"
      role="group"
      aria-label={t("session.keyboard")}
      data-al-format={format}
      data-al-moved={carried && !docked ? "" : undefined}
      style={style}
    >
      {!docked && (
        <div className="al-panelhead">
          <button
            type="button"
            className="al-btn al-btn--quiet al-grip"
            onPointerDown={gripDown}
            onKeyDown={gripKey}
          >
            <Glyph name="grip-horizontal" />
            <span>{t("keyboard.drag")}</span>
          </button>
          <button
            type="button"
            className="al-btn al-btn--icon al-btn--quiet"
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={onClose}
          >
            <Glyph name="x" />
          </button>
        </div>
      )}
      <div className="al-kbdrows" ref={area}>
        {page.rows
          .filter((row) => row.kind === "shortcut")
          .map((row) => (
            <div
              key={row.cells[0].id}
              className="al-keys al-keys--low"
              data-row="shortcut"
            >
              {/* The Sticky key stays put ahead of the keys that slide. */}
              {row.cells
                .filter((cell) => cell.def.type === "sticky")
                .map((cell) => (
                  <Cell key={cell.id} cell={cell} row={row} shown={shown} />
                ))}
              <div className="al-keys al-keys--scroll">
                {row.cells
                  .filter((cell) => cell.def.type !== "sticky")
                  .map((cell) => (
                    <Cell key={cell.id} cell={cell} row={row} shown={shown} />
                  ))}
              </div>
              {unseen.length > 0 && (
                <span className="al-keybadges">
                  {unseen.map((code) => (
                    <span key={code} className="al-keybadge">
                      {MODIFIER_KEYS.get(code)?.label ?? code}
                    </span>
                  ))}
                </span>
              )}
              <button
                type="button"
                className="al-cell al-cell--fixed"
                aria-label={t("common.close")}
                title={t("common.close")}
                onClick={onClose}
              >
                <span className="al-key al-key--quiet">
                  <Glyph name="x" />
                </span>
              </button>
            </div>
          ))}
        <Rows
          rows={page.rows.filter((row) => row.kind !== "shortcut")}
          shown={shown}
        />
        {[...previews].map(([pointer, preview]) => {
          const cell = cells.get(preview.id);
          return (
            cell && (
              <div
                key={pointer}
                className="al-keypreview"
                aria-hidden="true"
                style={{ left: `${preview.x}px`, top: `${preview.y}px` }}
              >
                {labelOf(cell.def, shown.shift, caps)}
              </div>
            )
          );
        })}
      </div>
      {/* A phone's Sticky key says it; a window has no such key. */}
      {format !== "phone" && <p className="al-small">{t("keyboard.sticky")}</p>}
    </div>
  );
}
