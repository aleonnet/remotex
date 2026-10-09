import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Covers } from "./Covers.tsx";
import { isFullscreen, toggleFullscreen } from "./fullscreen.ts";
import { gatewayFetch } from "./gateway.ts";
import { mountGlass } from "./glass.ts";
import { Ignite, SessionMoment } from "./Ignite.tsx";
import { usePreferences } from "./preferences.tsx";
import { SessionBar, type SessionBarProps } from "./SessionBar.tsx";
import {
  coverOf,
  momentOf,
  type Played,
  type View,
  viewOf,
} from "./sessionState.ts";
import TargetPicker, { type Opened } from "./TargetPicker.tsx";
import { lineNameOf, type TargetInfo } from "./targetChoices.ts";
import {
  CAN_PINCH_ZOOM,
  sizeFollows,
  useRemoteDesktop,
} from "./useRemoteDesktop.ts";

// How long the screen lights before its words settle (glass.ts lights for as long).
const SETTLES_AFTER_MS = 5000;

type Session = ReturnType<typeof useRemoteDesktop>;

/** What the bar is told of the session, from what the engine holds. */
function barOf(
  session: Session,
): Pick<
  SessionBarProps,
  | "kind"
  | "size"
  | "hostScale"
  | "renderPlan"
  | "oversize"
  | "displays"
  | "activeDisplayId"
  | "onSelectDisplay"
  | "sound"
  | "videoStream"
  | "camera"
  | "microphone"
  | "macKeys"
  | "touch"
  | "remoteClipboard"
  | "onFetchClipboard"
  | "onSendClipboard"
  | "sendKeyCombo"
  | "onKeyboardInset"
  | "onLocalShortcut"
  | "onViewOnlyChange"
> {
  return {
    kind: session.connection,
    size: session.size,
    hostScale: session.hostScale,
    renderPlan: session.renderPlan,
    oversize: session.oversize,
    displays: session.displays,
    activeDisplayId: session.activeDisplayId,
    onSelectDisplay: session.selectDisplay,
    sound: {
      available: session.canAudio,
      enabled: session.audioEnabled,
      fault: session.audioError,
      stream: session.audioStream,
      onChange: session.setAudio,
    },
    videoStream: session.videoStream,
    camera: {
      available: session.canCamera,
      enabled: session.cameraEnabled,
      streaming: session.cameraStreaming,
      fault: session.cameraError,
      onChange: session.setCamera,
    },
    microphone: {
      available: session.canMic,
      enabled: session.micEnabled,
      streaming: session.micStreaming,
      fault: session.micError,
      onChange: session.setMic,
    },
    macKeys: {
      host: session.isMacHost,
      remoteIsMac: session.remoteIsMac,
      enabled: session.macKeyOverridesEnabled,
      onChange: session.setMacKeyOverridesEnabled,
    },
    touch: {
      offered: session.touchOffered,
      enabled: session.touchEnabled,
      active: session.touchActive,
      onChange: session.setTouchEnabled,
    },
    remoteClipboard: session.remoteClipboard,
    onFetchClipboard: session.requestClipboard,
    onSendClipboard: session.sendClipboard,
    sendKeyCombo: session.sendKeyCombo,
    onKeyboardInset: session.setBottomInset,
    onLocalShortcut: session.onLocalShortcut,
    onViewOnlyChange: session.setViewOnly,
  };
}

/**
 * The last Open pressed on this page: what to open again, where the screen
 * that lights grows from, whether the session on screen is one this page opened, as against
 * one it found open, and whether five seconds have passed since. A session stops
 * being this page's own opening when the connection drops: what comes back
 * after it is a session found.
 */
function useOpening(session: Session) {
  const { status, connect } = session;
  const [opened, setOpened] = useState<Opened | null>(null);
  const [here, setHere] = useState(false);
  const [settled, setSettled] = useState(false);
  const open = useCallback(
    (next: Opened) => {
      // A press of its own each time, Retry included: the five seconds are
      // counted from this one.
      setOpened({ ...next });
      setHere(true);
      setSettled(false);
      connect(next.name, next.choices, next.sound);
    },
    [connect],
  );
  useEffect(() => {
    if (status !== "connected") {
      setHere(false);
    }
  }, [status]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `opened` is the press the five seconds are counted from
  useEffect(() => {
    if (!here) {
      return;
    }
    const timer = setTimeout(() => setSettled(true), SETTLES_AFTER_MS);
    return () => clearTimeout(timer);
  }, [opened, here]);
  return { opened, here, settled, open };
}

/**
 * What the screen that lights is titled while a computer is waited for: the name
 * its line had, where the Open is this page's own, and the target's otherwise.
 */
function titleOf(pending: string | null, opened: Opened | null): string | null {
  return pending !== null && pending === opened?.name ? opened.title : pending;
}

/**
 * What a session is called: the name its line has in the list. The page that
 * opened it has that name from the line. One that found it open asks the gateway
 * for the list, and calls the session by its target's name until the answer
 * comes, and for good where no answer does.
 */
function useSessionTitle(
  name: string | null,
  opened: Opened | null,
): string | null {
  const here = name !== null && name === opened?.name;
  const [found, setFound] = useState<{ of: string; title: string } | null>(
    null,
  );
  useEffect(() => {
    if (name === null || here) {
      return;
    }
    let cancelled = false;
    gatewayFetch("/api/targets")
      .then((res) => (res.ok ? (res.json() as Promise<TargetInfo[]>) : null))
      .then((list) => {
        const title = list && lineNameOf(list, name);
        if (!cancelled && title) {
          setFound({ of: name, title });
        }
      })
      .catch(() => {
        // The target's name stands.
      });
    return () => {
      cancelled = true;
    };
  }, [name, here]);
  if (here) {
    return titleOf(name, opened);
  }
  return found?.of === name ? found.title : name;
}

/**
 * A speaker on the tab title while sound is playing, and a camera and a
 * microphone while each is offered — the one place the desktop has room to say
 * so with the bar closed, and for the camera and the microphone it is also the
 * honest little recording light. At the *front*, not the end: a tab title is
 * truncated from the right, so a suffix is the first thing to vanish. Desktop
 * only, so the list's tab stays the plain branding. A display's tab is titled
 * with its display ahead of the branding, to be told from the session's.
 */
function useTitleMarks(
  session: Session,
  branding: string,
  display: string | null,
) {
  const { mode, audioEnabled, cameraEnabled, micEnabled } = session;
  useEffect(() => {
    const marks =
      mode === "desktop"
        ? `${cameraEnabled ? "🎥 " : ""}${micEnabled ? "🎤 " : ""}${audioEnabled ? "🔊 " : ""}`
        : "";
    const shown = display === null ? "" : `${display} · `;
    document.title = `${marks}${shown}${branding}`;
  }, [mode, audioEnabled, cameraEnabled, micEnabled, branding, display]);
}

/** Hand back the whole screen a phone was given by its Open (TargetPicker.tsx). */
function handBack() {
  if (sizeFollows() === null && isFullscreen()) {
    void toggleFullscreen().catch(() => {});
  }
}

/**
 * A phone keeps the whole screen for as long as there is a session to show on
 * it, and no longer: it is handed back wherever the session is left, not by End
 * alone. Back at the list, by whichever way (End, Cancel, an Open that failed, a
 * session that fell); at a session that is somebody else's; and when the page's
 * session goes with the page, as signing out takes it.
 */
function useScreenHandedBack(kind: View["kind"]) {
  useEffect(() => {
    if (kind === "list" || kind === "owner") {
      handBack();
    }
  }, [kind]);
  useEffect(() => handBack, []);
}

/** Whether a session's picture is waited for on the lit screen (Waiting.tsx). */
function coveredOf(session: Session): boolean {
  return session.screenUnavailable || session.remoteResizing;
}

/**
 * The displays a desktop held with no picture offers as ways out: none on a
 * Mirrored session, whose stream carries the Mac's main screen whatever is
 * asked for (the gateway drops the choice; see DisplayPanel.tsx).
 */
function waysOutOf(session: Session): number[] {
  return session.connection?.subtype === "ard-mirror"
    ? []
    : session.displays.map((display) => display.id);
}

/**
 * The two moments played over a session (glass.ts): the lit grid leaving as the
 * picture arrives behind it, and the picture going off when it is ended, after
 * which `leave` is called. The first is decided as the view changes, in the
 * same render, so the picture is never shown bare for a frame before the grid
 * that is about to leave it; not for a session that starts `covered`, whose
 * picture is still waited for on the lit screen (Waiting.tsx), which plays the
 * grid's leaving itself when the picture comes. A screen that was seen going
 * off stays off until the list the gateway answers with: the picture is not
 * shown again meanwhile.
 */
function useMoments(
  kind: View["kind"],
  covered: boolean,
  leave: (seen: boolean) => void,
) {
  const [moment, setMoment] = useState<Played | null>(null);
  const [shown, setShown] = useState(kind);
  if (shown !== kind) {
    setShown(kind);
    setMoment(momentOf(moment, shown, kind, covered));
  }
  const playing = useRef(moment);
  playing.current = moment;
  const done = useCallback(
    (played: boolean) => {
      if (playing.current !== "off") {
        setMoment(null);
        return;
      }
      leave(played);
      if (!played) {
        setMoment(null);
      }
    },
    [leave],
  );
  const end = useCallback(() => setMoment("off"), []);
  return { moment, done, end };
}

/**
 * Leaving for the list, and what is seen of it. End puts the picture out and
 * then asks (`ended`). Cancel asks at once (`cancelled`), and the screen that
 * lights is kept until it has gone off (`out`), though the list may be this
 * page's to show before that. Either way, a screen that was seen going off
 * leaves its afterglow over the list that comes back.
 */
function useLeaving(view: View, switchTarget: () => void) {
  const { kind } = view;
  // What the view is, state and all: a change of it that is not the list is a
  // screen the one that went off has nothing to do with.
  const stage = "state" in view ? `${kind} ${view.state}` : kind;
  // The screen that lights is going off after a Cancel.
  const [cancelling, setCancelling] = useState(false);
  // How many screens have gone off, which is which afterglow is on screen.
  const [glow, setGlow] = useState<number | null>(null);
  const owed = useRef(false);
  const ended = useCallback(
    (seen: boolean) => {
      owed.current = seen;
      switchTarget();
    },
    [switchTarget],
  );
  const cancelled = useCallback(
    (seen: boolean) => {
      owed.current = seen;
      setCancelling(seen);
      switchTarget();
    },
    [switchTarget],
  );
  const out = useCallback(() => setCancelling(false), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stage` is what changed
  useEffect(() => {
    if (kind !== "list") {
      owed.current = false;
    }
  }, [stage]);
  useEffect(() => {
    if (kind === "list" && !cancelling && owed.current) {
      owed.current = false;
      setGlow((last) => (last ?? 0) + 1);
    }
  }, [kind, cancelling]);
  const gone = useCallback(() => setGlow(null), []);
  return { cancelling, glow, ended, cancelled, out, gone };
}

/**
 * What a screen that went off leaves for a moment over the list that came back:
 * the glass as going off left it, not lit and with the spot at its centre, and
 * going (alumia.css, `.al-afterglow`). Decoration: out of a screen reader's
 * way, and nothing a press lands on.
 */
function Afterglow({ onGone }: { onGone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Before the list is painted, so that it is never seen bare first.
  useLayoutEffect(() => {
    const element = canvas.current;
    const scene = element?.parentElement;
    const glass = element && scene ? mountGlass(element, scene, "out") : null;
    if (!glass) {
      onGone();
      return;
    }
    glass.draw();
    return () => glass.release();
  }, [onGone]);
  return (
    <div className="al-afterglow" aria-hidden="true" onAnimationEnd={onGone}>
      <canvas ref={canvas} />
    </div>
  );
}

export default function RemoteDesktop({
  branding,
  tabDisplay,
  onLogout,
  onUnauthorized,
}: {
  /** The name the deployment gives itself, said before any computer is opened. */
  branding: string;
  /**
   * The display this page shows in a tab of its own (`/display/N`), beside the
   * session another tab of this browser holds: its picture and the input made
   * over it, a bar with what is this tab's, and no list. Null on the page that
   * holds the session.
   */
  tabDisplay: number | null;
  onLogout: () => void;
  onUnauthorized: () => void;
}) {
  const { t } = usePreferences();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphicsRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLImageElement>(null);
  // The keyboard belongs to the overlay, whose key listeners are scoped to it
  // rather than the window; the bar calls this when a control of its own has
  // taken focus and is done with it. See SessionBar and useRemoteDesktop.
  const focusDesktop = useCallback(
    () => overlayRef.current?.focus({ preventScroll: true }),
    [],
  );
  const session = useRemoteDesktop(
    canvasRef,
    graphicsRef,
    overlayRef,
    pointerRef,
    onUnauthorized,
    tabDisplay,
  );
  const { pendingTarget, switchTarget } = session;
  const opening = useOpening(session);
  const sessionTitle = useSessionTitle(session.sessionName, opening.opened);
  // What a display's tab is called, on its plate, its bar and the browser's tab.
  const displayTitle =
    tabDisplay === null ? null : t("displays.numbered", { n: tabDisplay });
  useTitleMarks(session, branding, displayTitle);

  // What is on screen (sessionState.ts): the list, the screen lighting, whose
  // the session is, or the session.
  const view = viewOf({
    status: session.status,
    mode: session.mode,
    pendingTarget,
    pictured: session.size !== null,
    openedHere: opening.here,
    settled: opening.settled,
    tab: tabDisplay,
  });

  // Leaving for the list by End or by Cancel, with the afterglow over the list
  // that comes back.
  const leaving = useLeaving(view, switchTarget);
  const { moment, done, end } = useMoments(
    view.kind,
    coveredOf(session),
    leaving.ended,
  );
  useScreenHandedBack(view.kind);
  // What the session is called on the bar and on the wait's plate.
  const sessionCalled = displayTitle ?? sessionTitle ?? branding;

  return (
    /* screen-touch swaps native scrolling for the gesture transform
       (pinch zoom + pan) and stretches the input overlay over the whole
       viewport so gestures land everywhere — see index.css. */
    <div className={`screen${CAN_PINCH_ZOOM ? " screen-touch" : ""}`}>
      <div className="surface">
        {/* Starts 0×0 so no ghost block shows before the first resize; the
            resize handler keeps the full pixel bitmap separate from its
            remote-point CSS size. Kept
            mounted in both modes so the hook's canvas ref stays stable. */}
        <canvas ref={canvasRef} className="framebuffer" width={0} height={0} />
        {/* What is drawn on the GPU is drawn here and not on the canvas above:
            an RDP host's graphics pipeline, passed through, and the software
            HEVC decoder's pictures (glPicture.ts). The paint worker shows it
            while it holds one of them. It takes the canvas above's box, and
            lies under the input overlay like it. */}
        <canvas
          ref={graphicsRef}
          className="framebuffer graphics"
          width={0}
          height={0}
        />
        {/* Transparent overlay captures mouse + keyboard input. tabIndex
            makes the div focusable — without it, focus() in the mousedown
            handler is a no-op and the keydown/keyup listeners (scoped to
            the focused overlay, not window) never fire. */}
        <div
          ref={overlayRef}
          className="input-overlay"
          role="application"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the remote-desktop surface (role=application) must take focus to receive keyboard input
          tabIndex={0}
        />
        {/* The pointer for the touch gesture layer's virtual cursor, drawn
            only when the engine sends cursor shapes instead of compositing
            them (VNC). Sized and positioned imperatively by the hook; hidden
            by default, and decorative, so it carries no alt text. */}
        <img ref={pointerRef} className="remote-pointer" alt="" />
      </div>

      {/* The list of computers: shown once the session is this page's and no
          computer is open or being opened, after a screen that Cancel put out
          has gone off. */}
      {view.kind === "list" && !leaving.cancelling && (
        <TargetPicker
          open={opening.open}
          pendingTarget={pendingTarget}
          connectError={session.connectError}
          sessionFell={session.sessionFell}
          // Tried again from the notice, not from a line: no monitor to grow from.
          onRetry={
            opening.opened
              ? () =>
                  opening.open({ ...(opening.opened as Opened), from: null })
              : null
          }
          onDismissError={session.dismissConnectError}
          onLogout={onLogout}
          onUnauthorized={onUnauthorized}
        />
      )}

      {/* Between the list and a picture, and where the session is not this
          page's to show: the screen that lights (Ignite.tsx). */}
      {(view.kind === "opening" ||
        view.kind === "owner" ||
        leaving.cancelling) && (
        <Ignite
          title={
            displayTitle ??
            titleOf(pendingTarget, opening.opened) ??
            sessionTitle ??
            branding
          }
          display={tabDisplay}
          opening={view.kind === "opening" ? view.state : null}
          owner={view.kind === "owner" ? view.state : null}
          cancel={view.kind === "opening" && view.cancel}
          told={session.connectError}
          here={opening.here}
          from={opening.opened?.from ?? null}
          onCancel={leaving.cancelled}
          onOut={leaving.out}
          onTakeOver={session.takeOver}
          onRetry={session.retry}
          onSignOut={onLogout}
        />
      )}

      {/* The session: glass over the remote screen (SessionBar.tsx). Not over a
          screen that Cancel is putting out, should a picture arrive meanwhile. */}
      {view.kind === "session" && !leaving.cancelling && (
        <SessionBar
          {...barOf(session)}
          name={sessionCalled}
          onFocusDesktop={focusDesktop}
          onEnd={end}
          onSignOut={onLogout}
          onUnauthorized={onUnauthorized}
          tab={tabDisplay}
          onDisconnect={session.releaseTab}
        >
          <Covers
            cover={coverOf({
              left: session.pageGone,
              resizing: session.remoteResizing,
              unavailable: session.screenUnavailable,
              held: session.oversize,
              displays: waysOutOf(session),
              active: session.activeDisplayId,
            })}
            name={sessionCalled}
            size={session.size}
            displays={session.displays}
            onSelectDisplay={session.selectDisplay}
            videoFault={session.videoError}
            secondMissing={session.secondMissing}
          />
          {/* A canvas of its own to each moment: an End pressed while the grid
              is still leaving is played on a glass that was not given back. */}
          {moment && (
            <SessionMoment key={moment} moment={moment} onDone={done} />
          )}
        </SessionBar>
      )}

      {leaving.glow !== null && (
        <Afterglow key={leaving.glow} onGone={leaving.gone} />
      )}
    </div>
  );
}
