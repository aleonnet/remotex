import { useCallback, useEffect, useRef, useState } from "react";
import { type Fault, fillOf } from "./fault.ts";
import { Glyph } from "./Glyph.tsx";
import { type Glass, LASTS, mountGlass } from "./glass.ts";
import { lookOf } from "./Message.tsx";
import { Details } from "./Notice.tsx";
import { usePreferences } from "./preferences.tsx";
import { hasButton } from "./words.ts";

// The wait for a picture, inside a session.
//
// A Mac's picture has not come: at the start, after a change of display, and
// when the Mac starts its stream over; or the display is being resized. Nothing
// is wrong, and nothing can be shown, so the wait is the screen that lights
// (Ignite.tsx), as it is between the list and the first picture: the dark glass
// lit part of the way, breathing slowly (glass.ts, the `waiting` still), with
// the plate low and left, the session's name and one line. No title, no box in
// the middle, and no bar of progress: there is no known length to it. Where
// motion is reduced the light stands; where the glass is not drawn, the still
// of CSS stands in, as at the opening.
//
// When the page has given up asking for the picture (keyframeAsk.ts, the fault
// AL-4609) the light stops and the plate says so, with the code and the button
// the banner of Covers.tsx carries where no wait is up: the fault is on the one
// thing on screen, and not under it.
//
// When the picture is on its way (`up` false) the lit grid leaves cell by cell
// over it, the plate goes, and the scene says it has gone (`onGone`) for whoever
// mounted it to take it down: at the end of the moment, at once where there is
// nothing to see, and within twice the moment's length where the clock never
// runs it to its end, a tab that is hidden (as SessionMoment does).

export function Waiting({
  name,
  line,
  fault,
  up,
  onGone,
}: {
  /** The session's name, as the bar has it. */
  name: string;
  /** What is waited for: the display's picture, or the end of its resize. */
  line: "AL-3200" | "AL-4500";
  /** Why this browser shows no picture, or null: said on the plate while up. */
  fault: Fault | null;
  /** Whether the picture is still waited for. False: it is on its way. */
  up: boolean;
  /** The scene has gone, after the grid left or at once. */
  onGone: () => void;
}) {
  const { t, message, painted } = usePreferences();
  const scene = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const glass = useRef<Glass | null>(null);
  // Whether the glass is drawn, or the still stands in for it: null until asked.
  const [drawn, setDrawn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!canvas.current || !scene.current) {
      return;
    }
    const mounted = mountGlass(canvas.current, scene.current, "waiting");
    glass.current = mounted;
    setDrawn(mounted !== null);
    return () => {
      mounted?.release();
      glass.current = null;
    };
  }, []);

  // Waited for: breathing, or standing once the page has given up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `drawn` is when the glass exists
  useEffect(() => {
    if (up) {
      glass.current?.show(fault ? "settled" : "waiting");
    }
  }, [up, fault, drawn]);

  // On its way: the grid leaves, once, and the scene is gone when it has. A
  // fault that changes meanwhile changes nothing here: the plate is leaving.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `drawn` is when the glass exists
  useEffect(() => {
    if (up) {
      return;
    }
    const within = setTimeout(onGone, 2 * LASTS.dissolve);
    const done = () => {
      clearTimeout(within);
      onGone();
    };
    if (!glass.current) {
      done();
      return;
    }
    glass.current.play("dissolve", done);
    return () => clearTimeout(within);
  }, [up, drawn, onGone]);

  // Its colours are the theme's, so a change of theme is drawn again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `painted` is what changed
  useEffect(() => glass.current?.draw(), [painted]);

  const reload = useCallback(() => location.reload(), []);

  return (
    <div className="al-wait" ref={scene}>
      {/* The glass: decoration, behind the plate and out of a screen reader's way. */}
      <div className="al-fx" aria-hidden="true" hidden={drawn === false}>
        <canvas ref={canvas} />
      </div>
      {drawn === false && (
        <div className="al-still al-still--dark" aria-hidden="true" />
      )}
      <div className="al-lit">
        {/* The plate is the status: the name and the one line, as the cover's box was. */}
        <output
          className="al-plate al-glass"
          data-al-leaving={up ? undefined : ""}
        >
          <h1 className="al-name">{name}</h1>
          {fault && up ? (
            <>
              <p role="alert" className={`al-msg${lookOf(fault.code).tone}`}>
                <Glyph name={lookOf(fault.code).glyph} />
                <span>{message("AL-4600", fault.code, fillOf(fault))}</span>{" "}
                <span className="al-code">{fault.code}</span>
              </p>
              {(hasButton(fault.code) || fault.detail) && (
                <div className="al-acts">
                  {hasButton(fault.code) && (
                    <button
                      type="button"
                      className="al-btn al-btn--primary"
                      onClick={reload}
                    >
                      {t("common.reload")}
                    </button>
                  )}
                  {fault.detail && (
                    <Details code={fault.code} detail={fault.detail} />
                  )}
                </div>
              )}
            </>
          ) : line === "AL-4500" ? (
            <p>{message("AL-4500")}</p>
          ) : (
            <p>{message("AL-3200")}</p>
          )}
        </output>
      </div>
    </div>
  );
}
