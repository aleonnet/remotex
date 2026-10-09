import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { moves, run } from "./clock.ts";
import { Dialog } from "./Dialog.tsx";
import { fillOf, type Told } from "./fault.ts";
import { draws, type Glass, LASTS, type Moment, mountGlass } from "./glass.ts";
import { usePreferences } from "./preferences.tsx";
import type { Opening, Owner } from "./sessionState.ts";

// The screen that lights, and whose the session is.
//
// Between the list of computers and a picture there is a screen: the dark glass
// in either theme, because it is a screen. Where Open was pressed on this page
// it grows from the monitor of the line that was pressed until it is the whole
// window, and then comes on as a tube does (glass.ts). The words sit on a plate
// of glass, low and left, under the name of the computer being opened, which
// arrives there from its line, or the gateway's own name before any computer is.
// Cancel asks for the list at once, and the screen goes off, as a tube does,
// before the list is shown; a list that has not come by then finds the plate
// back, over a screen that stays off, with Cancel to press again. Where the
// glass is not drawn, or nothing moves, none of this moves either.
//
// The same plate, on glass that is not lit, says whose the session is when it is
// not this page's to show: in use in another browser, taken over, not opened,
// or a page older than its gateway. Each offers the one thing to do about it,
// and Sign out beside it, because none of the four has a list to go back to.
//
// A page that shows a display in a tab of its own says there whose that display
// is: open in another tab, taken over by one, not shown here since this tab's
// own Disconnect, or not shown in a tab by the session at all. The one thing to
// do, and no Sign out: that would end the sign-in of the session's page too.

/** What the lighting says while it lasts. */
function OpeningWords({
  state,
  name,
  told,
}: {
  state: Opening;
  name: string;
  /** What the retries are failing with, once they have failed enough to say. */
  told: Told | null;
}) {
  const { t, message } = usePreferences();
  if (state === "settled") {
    return <output>{t("ignite.settled", { name })}</output>;
  }
  if (state === "waiting") {
    return <output>{message("AL-3200")}</output>;
  }
  if (state === "connecting") {
    return <output>{message("AL-3000")}</output>;
  }
  return (
    <output>
      <span>{message("AL-3000", "AL-3005")}</span>
      {told && (
        <>
          {" "}
          <span>{message("AL-3100", told.code, fillOf(told))}</span>{" "}
          <span className="al-code" title={told.detail}>
            {told.code ?? "AL-3100"}
          </span>
        </>
      )}
    </output>
  );
}

/** Whose the session is, with the code to quote. */
function OwnerWords({ state, told }: { state: Owner; told: Told | null }) {
  const { message } = usePreferences();
  const fill = told ? fillOf(told) : undefined;
  let words: [string, string];
  if (state === "busy") {
    words = [message("AL-3300"), "AL-3300"];
  } else if (state === "taken") {
    words = [message("AL-3400"), "AL-3400"];
  } else if (state === "failed") {
    words = [message("AL-3100", told?.code, fill), told?.code ?? "AL-3100"];
  } else {
    words = [message("AL-2200", told?.code, fill), told?.code ?? "AL-2200"];
  }
  return (
    <p role="alert">
      <span>{words[0]}</span>{" "}
      <span className="al-code" title={told?.detail}>
        {words[1]}
      </span>
    </p>
  );
}

/** Whose a display is, on the page that shows it in a tab of its own. */
function DisplayWords({
  state,
  display,
  told,
}: {
  state: Owner;
  display: number;
  told: Told | null;
}) {
  const { message } = usePreferences();
  const fill = { n: display, ...(told ? fillOf(told) : undefined) };
  let words: [string, string];
  if (state === "busy") {
    words = [message("AL-3300", "AL-3301", fill), "AL-3301"];
  } else if (state === "taken") {
    words = [message("AL-3400", "AL-3401", fill), "AL-3401"];
  } else if (state === "unavailable") {
    const cause = told?.code ?? "AL-3501";
    words = [message("AL-3500", cause, fill), cause];
  } else {
    words = [message("AL-3500", undefined, fill), "AL-3500"];
  }
  return (
    <p role="alert">
      <span>{words[0]}</span> <span className="al-code">{words[1]}</span>
    </p>
  );
}

/** The one thing to do about a session that is not this page's. */
function OwnerAct({
  state,
  onAsk,
  onTakeOver,
  onRetry,
}: {
  state: Owner;
  /** Taking a session from a browser that is using it is asked about first. */
  onAsk: () => void;
  onTakeOver: () => void;
  onRetry: () => void;
}) {
  const { t } = usePreferences();
  const acts: Record<Owner, [string, () => void]> = {
    busy: [t("common.takeover"), onAsk],
    taken: [t("common.takeback"), onTakeOver],
    failed: [t("common.retry"), onRetry],
    stale: [t("common.reload"), () => location.reload()],
    idle: [t("common.connect"), onRetry],
    unavailable: [t("common.retry"), onRetry],
  };
  const [label, act] = acts[state];
  return (
    <button type="button" className="al-btn al-btn--primary" onClick={act}>
      {label}
    </button>
  );
}

/**
 * Where a line's monitor and its name were on the window when its Open was
 * pressed, in pixels: what a clip of the window leaves out around the monitor's
 * screen, and the name's own place and height.
 */
export interface Grows {
  top: number;
  right: number;
  bottom: number;
  left: number;
  name: { left: number; top: number; height: number } | null;
}

// How long the screen is given to reach the window's size where the browser
// never says it has: a tab that was hidden as it grew. And how long it is given
// to go off where the clock never runs it to its end: the same tab.
const GROWS_WITHIN_MS = 800;
const OFF_WITHIN_MS = 2 * LASTS.off;

/** Whether a screen moves here: the glass is drawn, and motion is not reduced. */
function alive(): boolean {
  return moves() && draws();
}

/**
 * The dark glass behind the plate: coming on, lit part of the way, or not lit.
 * A screen that was opened here starts as the monitor of its line and is the
 * window before it comes on.
 */
function Screen({
  here,
  from,
  lit,
  leaving,
  onLeft,
  onOut,
  children,
}: {
  /** Whether Open was pressed on this page, as against a session found open. */
  here: boolean;
  /** Where that line's monitor was, where it is known. */
  from: Grows | null;
  /** Whether the glass is lit at all: not, under a session that is not this page's. */
  lit: boolean;
  /** Cancel was pressed: `onLeft` is called, and the screen goes off. */
  leaving: boolean;
  /** Called as the screen starts going off, and told whether that will be seen. */
  onLeft: (seen: boolean) => void;
  /** Called when it has gone off: at once, where there was nothing to see. */
  onOut: () => void;
  children: ReactNode;
}) {
  const { painted } = usePreferences();
  const scene = useRef<HTMLDivElement>(null);
  const tube = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const glass = useRef<Glass | null>(null);
  // Whether the glass is drawn, or the still stands in for it: null until asked.
  const [drawn, setDrawn] = useState<boolean | null>(null);
  // The screen's size: the monitor it starts as, on its way to the window, or
  // the window. Where nothing moves, or no monitor is known, it is the window
  // from the start.
  const [size, setSize] = useState<"monitor" | "growing" | "window">(() =>
    here && from && alive() ? "monitor" : "window",
  );
  // Cancel put this screen out: it is not lit again while the Open it was
  // cancelled on is still the one waited for.
  const [out, setOut] = useState(false);
  // The monitor's clip is laid out before the growing starts, and the growing
  // starts in the same task: a transition runs from the computed style before
  // the change, and forcing the layout is what computes it (CSS Transitions,
  // "before-change style"). Not a frame of the clock, which a tab that is not
  // in sight, or a browser that is busy, may not give for a while: the screen
  // then stood as the monitor, with the plate over it, until the clock ran.
  useLayoutEffect(() => {
    if (size !== "monitor") {
      return;
    }
    void tube.current?.getBoundingClientRect();
    setSize("growing");
  }, [size]);
  useEffect(() => {
    if (size === "growing") {
      const timer = setTimeout(() => setSize("window"), GROWS_WITHIN_MS);
      return () => clearTimeout(timer);
    }
  }, [size]);

  useEffect(() => {
    if (!canvas.current || !scene.current) {
      return;
    }
    const mounted = mountGlass(canvas.current, scene.current, "unlit");
    glass.current = mounted;
    setDrawn(mounted !== null);
    return () => {
      mounted?.release();
      glass.current = null;
    };
  }, []);

  // The lighting is played once, when the screen opened here is the window's
  // size. Anything else on this screen is a still: a session waited for that was
  // not opened here, lit part of the way; a session that is not this page's, and
  // a screen still growing, not lit.
  const lights = lit && here && size === "window";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `drawn` is when the glass exists
  useEffect(() => {
    if (leaving || (out && here)) {
      return;
    }
    if (lights) {
      glass.current?.play("ignite", () => {});
    } else {
      glass.current?.show(lit && !here ? "settled" : "unlit");
    }
  }, [lights, lit, here, drawn, leaving, out]);

  // Leaving is asked for at once, so that a picture arriving meanwhile cannot
  // make a Cancel be forgotten, and going off is played over the lighting
  // itself. It ends on the screen that went off; with no glass, where nothing
  // moves, or on a screen that is not lit (still growing, waited for, or put
  // out already) there is nothing to see, and it has gone off at once. A tab
  // that is hidden never plays it to its end, and is not waited for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `leaving` is the one thing that starts it
  useEffect(() => {
    if (!leaving) {
      return;
    }
    const seen = glass.current !== null && moves() && lights && !out;
    onLeft(seen);
    if (!seen) {
      onOut();
      return;
    }
    setOut(true);
    const within = setTimeout(onOut, OFF_WITHIN_MS);
    glass.current?.play(
      "off",
      () => {
        clearTimeout(within);
        onOut();
      },
      false,
    );
    return () => clearTimeout(within);
  }, [leaving]);

  // Its colours are the theme's, so a change of theme is drawn again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `painted` is what changed
  useEffect(() => glass.current?.draw(), [painted]);

  // What the clip leaves out while the screen is still the monitor.
  const clip =
    size === "monitor" && from
      ? `inset(${from.top}px ${from.right}px ${from.bottom}px ${from.left}px round 8px)`
      : undefined;

  return (
    <div className="al al--screen" ref={scene}>
      {/* The list's ground, which the screen grows over and which goes as it does. */}
      {size !== "window" && (
        <div
          className="al-ground"
          data-al-gone={size === "growing" ? "" : undefined}
        />
      )}
      {/* The glass itself: what grows from the monitor. Decoration, behind
          everything and out of a screen reader's way. */}
      <div
        className="al-tube"
        ref={tube}
        aria-hidden="true"
        style={{ clipPath: clip }}
        onTransitionEnd={(event) => {
          if (event.propertyName === "clip-path") {
            setSize("window");
          }
        }}
      >
        <div className="al-fx" hidden={drawn === false}>
          <canvas ref={canvas} />
        </div>
        {drawn === false && <div className="al-still al-still--dark" />}
      </div>
      <div className="al-scene">{children}</div>
    </div>
  );
}

/**
 * The name on the plate, which arrives there from where it stood on its line:
 * placed back where it was, at the size it had, and let go.
 */
function PlateName({ title, from }: { title: string; from: Grows | null }) {
  const name = useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: where it comes from is read once, as it is first laid out
  useLayoutEffect(() => {
    const heading = name.current;
    const was = from?.name;
    if (!heading || !was || !alive()) {
      return;
    }
    const now = heading.getBoundingClientRect();
    heading.dataset.alPlaced = "";
    heading.style.transform = `translate(${was.left - now.left}px, ${was.top - now.top}px) scale(${was.height / now.height})`;
    run(() => {
      delete heading.dataset.alPlaced;
      heading.style.transform = "";
      return false;
    });
  }, []);
  return (
    <h1 className="al-name" ref={name}>
      {title}
    </h1>
  );
}

export function Ignite({
  title,
  opening,
  owner,
  cancel,
  told,
  here,
  from,
  display,
  onCancel,
  onOut,
  onTakeOver,
  onRetry,
  onSignOut,
}: {
  /** The computer being opened, or the gateway's name where none is. */
  title: string;
  /** The display this page shows in a tab of its own, or null on the session's page. */
  display: number | null;
  /** The state of the lighting, or null when the plate says whose the session is. */
  opening: Opening | null;
  owner: Owner | null;
  /** Whether Cancel is offered. */
  cancel: boolean;
  /** Why the session is not this page's, or what the retries are failing with. */
  told: Told | null;
  /** Whether Open was pressed on this page, as against a session found open. */
  here: boolean;
  /** Where the line that was pressed had its monitor and its name. */
  from: Grows | null;
  /** Leave for the list; told whether the screen is seen going off meanwhile. */
  onCancel: (seen: boolean) => void;
  /** The screen that Cancel put out has gone off. */
  onOut: () => void;
  onTakeOver: () => void;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  const { t, message } = usePreferences();
  const [asking, setAsking] = useState(false);
  // Cancel was pressed and the screen is going off: the words are away for as
  // long as that takes, and no longer.
  const [leaving, setLeaving] = useState(false);
  // What the screen is, in a few words, for whoever lands on it without seeing
  // it: the plate says the rest.
  const status = (state: Owner): string => {
    const words: Record<Owner, string> = {
      busy: message("AL-3000", "AL-3001"),
      taken: message("AL-3000", "AL-3002"),
      failed: message("AL-3000", "AL-3003"),
      stale: message("AL-3000", "AL-3004"),
      idle: message("AL-3000", "AL-3008"),
      unavailable: message("AL-3000", "AL-3009"),
    };
    const ofDisplay: Partial<Record<Owner, string>> = {
      busy: message("AL-3000", "AL-3006"),
      taken: message("AL-3000", "AL-3007"),
    };
    return (display !== null && ofDisplay[state]) || words[state];
  };

  return (
    <Screen
      here={here}
      from={from}
      lit={owner === null}
      leaving={leaving}
      onLeft={onCancel}
      onOut={() => {
        setLeaving(false);
        onOut();
      }}
    >
      <main className="al-lit" aria-label={owner ? status(owner) : undefined}>
        <div
          className="al-plate al-glass"
          data-al-leaving={leaving ? "" : undefined}
        >
          <PlateName title={title} from={here ? from : null} />
          {opening && <OpeningWords state={opening} name={title} told={told} />}
          {owner && display === null && (
            <OwnerWords state={owner} told={told} />
          )}
          {owner && display !== null && (
            <DisplayWords state={owner} display={display} told={told} />
          )}
          {owner && (
            <div className="al-acts">
              <OwnerAct
                state={owner}
                onAsk={() => setAsking(true)}
                onTakeOver={onTakeOver}
                onRetry={onRetry}
              />
              {display === null && (
                <button type="button" className="al-btn" onClick={onSignOut}>
                  {t("common.signout")}
                </button>
              )}
            </div>
          )}
          {cancel && (
            <div className="al-acts">
              <button
                type="button"
                className="al-btn"
                disabled={leaving}
                onClick={() => setLeaving(true)}
              >
                {t("common.cancel")}
              </button>
            </div>
          )}
        </div>
      </main>
      {asking && (
        <Dialog
          title={
            display === null
              ? t("dialog.confirm.title")
              : t("dialog.display.title", { n: display })
          }
          onCancel={() => setAsking(false)}
          acts={
            <>
              <button
                type="button"
                className="al-btn"
                onClick={() => setAsking(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="al-btn al-btn--primary"
                onClick={() => {
                  setAsking(false);
                  onTakeOver();
                }}
              >
                {t("common.takeover")}
              </button>
            </>
          }
        >
          <p>
            {display === null
              ? t("dialog.confirm.body.unnamed")
              : t("dialog.display.body")}
          </p>
        </Dialog>
      )}
    </Screen>
  );
}

/**
 * A moment played over a session, on the glass laid over the remote screen: the
 * lit grid leaving cell by cell as the picture arrives behind it, or the picture
 * closing to a line and the line to a spot as the session ends. `onDone` is
 * called once: when it has played, at once where motion is reduced, at once
 * where there is no glass to play it on, and without it where the clock never
 * runs it to its end (a tab that is hidden): neither moment is anything but
 * decoration. It is told whether there was anything to see.
 */
export function SessionMoment({
  moment,
  onDone,
}: {
  moment: Exclude<Moment, "ignite">;
  onDone: (played: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const scene = element?.closest<HTMLElement>(".al");
    const glass = element && scene ? mountGlass(element, scene, "unlit") : null;
    if (!glass) {
      onDone(false);
      return;
    }
    // What lies over the screen goes as it goes off (alumia.css).
    if (moment === "off" && scene) {
      scene.dataset.alOff = "";
    }
    let told = false;
    const tell = (played: boolean) => {
      if (!told) {
        told = true;
        onDone(played);
      }
    };
    const within = setTimeout(() => tell(false), 2 * LASTS[moment]);
    glass.play(moment, tell);
    return () => {
      clearTimeout(within);
      delete scene?.dataset.alOff;
      glass.release();
    };
  }, [moment, onDone]);
  return (
    <div className="al-fx" aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}
