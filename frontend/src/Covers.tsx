import { useCallback, useRef, useState } from "react";
import type { Fault } from "./fault.ts";
import { fillOf } from "./fault.ts";
import { Glyph } from "./Glyph.tsx";
import { lookOf } from "./Message.tsx";
import { Details } from "./Notice.tsx";
import { usePreferences } from "./preferences.tsx";
import type { DisplayInfo } from "./protocol.ts";
import { displayName } from "./serverWords.ts";
import type { Cover } from "./sessionState.ts";
import type { RemoteSize } from "./useRemoteDesktop.ts";
import { Waiting } from "./Waiting.tsx";
import { hasButton } from "./words.ts";

// What covers the remote screen, under the bar, which stays the way out from all
// of it.
//
// A resize that has not settled, and a display whose picture has not come (a
// Mac's video at the start, after a change of display, and when the Mac starts
// its video over): each is a wait, with nothing wrong and nothing to show, and
// both are waited for on the screen that lights (Waiting.tsx), the plate saying
// which. Nothing typed or pointed at is sent while it is up, and what was held is
// let go: a key or a click would land on a display nobody can see. A resize is
// said ahead of a picture that has not come while both hold. The gateway says
// when each comes down; the scene then stays for the grid to leave over the
// picture, and takes itself down.
//
// A display in a tab of its own whose session's page is gone: the tab is the
// session's, and with nobody at the session it says so and sends nothing. The
// gateway says when the page is back.
//
// A desktop with no picture: past what a video stream carries, or a Mac's
// Combined Display over more than two screens. No picture comes, and the session
// stays up for the one way out, a smaller desktop from the remote. Choosing one of
// its displays is that way for a Mac on Combined Display, so they are offered here
// and not only in the bar. A press sends a `selectDisplay` and nothing else: the cover
// comes down when the gateway says the desktop has a picture again.
//
// A second display the remote did not give: said in a strip beside the picture,
// which is whole and the session's as it is.
//
// And a picture this browser cannot show: its own strip rather than a cover,
// because nothing is wrong with the session or the gateway — it is this browser
// that cannot decode what is arriving. What the browser said of its decoder is
// kept behind the strip's "Details", as under any notice: on a phone there is no
// pointer to hold over the code, and those words are the whole diagnosis. While
// a wait is up the strip is not drawn: the fault is on the wait's plate instead,
// the one thing on screen.

export function Covers({
  cover,
  name,
  size,
  displays,
  onSelectDisplay,
  videoFault,
  secondMissing,
}: {
  /** What covers the screen (sessionState.ts), or null. */
  cover: Cover;
  /** The session's name, as the bar has it: what the wait's plate says. */
  name: string;
  size: RemoteSize | null;
  displays: DisplayInfo[];
  onSelectDisplay: (id: number) => void;
  /** Why this browser shows no picture, or null. */
  videoFault: Fault | null;
  /** Whether the remote gave one display where two were asked for. */
  secondMissing: boolean;
}) {
  const { t, message } = usePreferences();
  const waits = cover?.kind === "resizing" || cover?.kind === "unavailable";
  return (
    <>
      <Wait cover={cover} up={waits} name={name} fault={videoFault} />
      {cover?.kind === "left" && (
        <div className="al-cover">
          <output className="al-coverbox al-glass">
            <h2>{t("covers.left")}</h2>
            <p>{message("AL-4900")}</p>
          </output>
        </div>
      )}
      {cover?.kind === "held" && (
        <Held
          cover={cover}
          size={size}
          displays={displays}
          onSelectDisplay={onSelectDisplay}
        />
      )}
      {secondMissing && !videoFault && (
        <output
          className={`al-banner al-glass al-msg${lookOf("AL-3503").tone}`}
        >
          <Glyph name={lookOf("AL-3503").glyph} />
          <span>{message("AL-3500", "AL-3503")}</span>
        </output>
      )}
      {videoFault && !waits && (
        <div
          className={`al-banner al-glass al-msg${lookOf(videoFault.code).tone}`}
          role="alert"
        >
          <Glyph name={lookOf(videoFault.code).glyph} />
          <span>
            <span>
              {message("AL-4600", videoFault.code, fillOf(videoFault))}
            </span>{" "}
            <span className="al-code">{videoFault.code}</span>
          </span>
          {hasButton(videoFault.code) && (
            <button
              type="button"
              className="al-btn"
              onClick={() => location.reload()}
            >
              {t("common.reload")}
            </button>
          )}
          {videoFault.detail && (
            <Details code={videoFault.code} detail={videoFault.detail} />
          )}
        </div>
      )}
    </>
  );
}

/**
 * The wait (Waiting.tsx), which stays mounted past its cover for the grid to
 * leave over the picture, and comes down when it says it has gone. The line it
 * last said stays its line meanwhile.
 */
function Wait({
  cover,
  up,
  name,
  fault,
}: {
  cover: Cover;
  /** Whether a wait is the cover now. */
  up: boolean;
  name: string;
  fault: Fault | null;
}) {
  const [waiting, setWaiting] = useState(false);
  if (up && !waiting) {
    setWaiting(true);
  }
  const line = useRef<"AL-3200" | "AL-4500">("AL-3200");
  if (cover?.kind === "resizing") {
    line.current = "AL-4500";
  } else if (cover?.kind === "unavailable") {
    line.current = "AL-3200";
  }
  const gone = useCallback(() => setWaiting(false), []);
  if (!up && !waiting) {
    return null;
  }
  return (
    <Waiting
      name={name}
      line={line.current}
      fault={fault}
      up={up}
      onGone={gone}
    />
  );
}

/** A desktop with no picture: the reason, and the ways out. */
function Held({
  cover,
  size,
  displays,
  onSelectDisplay,
}: {
  cover: Extract<Cover, { kind: "held" }>;
  size: RemoteSize | null;
  displays: DisplayInfo[];
  onSelectDisplay: (id: number) => void;
}) {
  const { t, said, message } = usePreferences();
  const others = displays.filter((display) =>
    cover.others.includes(display.id),
  );
  return (
    <div className="al-cover">
      <div
        className="al-coverbox al-glass"
        role="alert"
        aria-label={message("AL-4000")}
      >
        <h2>{t(cover.cause === "size" ? "covers.large" : "covers.many")}</h2>
        {cover.cause === "size" ? (
          <p>
            {message("AL-4200", undefined, {
              width: size?.w ?? 0,
              height: size?.h ?? 0,
            })}
          </p>
        ) : (
          <p>{message("AL-4100")}</p>
        )}
        {others.length > 0 ? (
          <>
            <p>{message("AL-4300")}</p>
            <div className="al-formrow">
              {others.map((display) => (
                <button
                  type="button"
                  key={display.id}
                  className="al-btn"
                  onClick={() => onSelectDisplay(display.id)}
                >
                  {said(displayName(display.label))}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p>{message("AL-4400")}</p>
        )}
      </div>
    </div>
  );
}
