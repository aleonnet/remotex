import { useEffect, useId, useRef, useState } from "react";
import { AppVersion } from "./AppVersion.tsx";
import { decodesAppleMedia } from "./appleMedia.ts";
import { Dialog } from "./Dialog.tsx";
import { Frame } from "./Frame.tsx";
import { fillOf, type Told } from "./fault.ts";
import {
  fullscreenSupported,
  isFullscreen,
  toggleFullscreen,
} from "./fullscreen.ts";
import { Glyph } from "./Glyph.tsx";
import { gatewayFetch } from "./gateway.ts";
import { type VersionDifference, versionDifference } from "./gatewayVersion.ts";
import type { Grows } from "./Ignite.tsx";
import { Message, Reason } from "./Message.tsx";
import { Notice } from "./Notice.tsx";
import { type Neighbour, neighbours } from "./neighbours.ts";
import { usePreferences } from "./preferences.tsx";
import { composesRdpGraphics } from "./rdpGraphics.ts";
import ThroughputPanel, { useThroughputAvailable } from "./ThroughputPanel.tsx";
import {
  type Abilities,
  asked,
  type Choices,
  type Here,
  hereOf,
  macMode,
  modeOf,
  type Place,
  placesOf,
  pressed,
  type Row,
  readRememberedChoices,
  readRememberedModes,
  rememberChoice,
  rememberMode,
  rowKey,
  rowsOf,
  type TargetInfo,
  type TargetOptions,
  targetOptions,
} from "./targetChoices.ts";
import { CAN_PINCH_ZOOM, sizeFollows } from "./useRemoteDesktop.ts";

// The list of computers: the state where the user is signed in and holds the
// session slot, but no connection has started yet (see useRemoteDesktop's
// "picker" mode). It lists the `[[targets]]` profiles from GET /api/targets, a
// line a computer (targetChoices.ts, `rowsOf`): a monitor, its name, and Open.
//
// The monitor is this window, small. Its screen shows how the picture will
// arrive, and its base holds three places, always the same three: the mode of a
// Mac, the size, the sound. A place with another choice behind it is a key, and
// pressing it chooses; one with none is a mark. What each says is the line's
// tip, shown while the pointer rests on the monitor, while a key has the
// keyboard's focus, and for a moment after a key is pressed or a finger touches
// the monitor, which is how a finger sees it. What was chosen is remembered in
// this browser.
//
// After the computers come the other Macs with Alumia, where the gateway finds
// any (neighbours.ts): a line each, whose one act is to take this window to that
// Mac's own Alumia.
//
// `open` sends the Open over the live socket with the choices; `sound` tells
// it the session will carry the remote's sound, so the click is spent on an audio
// context, and `from` is where the line's monitor is on the window, which is
// where the screen that lights grows from (Ignite.tsx). A phone asks for full
// screen in the same press, where its browser has one: a desktop in a strip
// between two browser bars is not a desktop. `connectError` is why the last
// session ended, shown here rather than on a dead-end screen: a session that did
// not open, in the notice at the top with Try again; one that was on screen and
// fell, in a dialog, because the person was looking at a desktop a moment ago
// and is owed the reason before the list. `onLogout` ends the web login;
// `onUnauthorized` fires if the target list itself comes back 401 (the login
// expired).

// The computers this browser was already told share their own screen: a Mac
// mirrored shows whoever sits at it what the viewer does, which is said once per
// computer, before the first Open, and not at every one.
const ACKNOWLEDGED_KEY = "alumia.mirrorAcknowledged";

function acknowledged(): string[] {
  try {
    const kept: unknown = JSON.parse(
      localStorage.getItem(ACKNOWLEDGED_KEY) ?? "[]",
    );
    return Array.isArray(kept)
      ? kept.filter((name) => typeof name === "string")
      : [];
  } catch {
    // Storage blocked, or something else's value: nothing was acknowledged.
    return [];
  }
}

function acknowledge(name: string): void {
  try {
    localStorage.setItem(
      ACKNOWLEDGED_KEY,
      JSON.stringify([...new Set([...acknowledged(), name])]),
    );
  } catch {
    // Storage blocked: it is asked again next time, which errs the right way.
  }
}

// How long a line's tip stays up after one of its keys is pressed, or after a
// finger touches its monitor.
const TOLD_MS = 3600;
// How long after the list arrives the light has passed behind its last key.
const ARRIVED_MS = 2400;

/**
 * Whether what was lifted from a monitor is a finger or a pen, which has nothing
 * to rest on it: touching it says what a pointer resting there is told.
 */
function touched(event: { pointerType: string }): boolean {
  return event.pointerType !== "mouse";
}

/**
 * Where a line's monitor has its screen on the window, as what a clip leaves
 * out, and where its name stands.
 */
function boxOf(
  screen: HTMLElement | null,
  name: HTMLElement | null,
): Grows | null {
  if (!screen) {
    return null;
  }
  const box = screen.getBoundingClientRect();
  const named = name?.getBoundingClientRect();
  return {
    top: box.top,
    right: window.innerWidth - box.right,
    bottom: window.innerHeight - box.bottom,
    left: box.left,
    name: named
      ? { left: named.left, top: named.top, height: named.height }
      : null,
  };
}

/** One computer: its monitor, its name, what the monitor says, and Open. */
function Computer({
  row,
  options,
  places,
  here,
  pending,
  opening,
  onPress,
  onOpen,
}: {
  row: Row;
  options: TargetOptions;
  places: readonly (Place | null)[];
  here: Here;
  /** An Open is waiting on the server: nothing here can be changed meanwhile. */
  pending: boolean;
  /** That Open is this computer's. */
  opening: boolean;
  onPress: (opt: Place["opt"]) => void;
  onOpen: (from: Grows | null) => void;
}) {
  const { t, said } = usePreferences();
  const screen = useRef<HTMLSpanElement>(null);
  const name = useRef<HTMLHeadingElement>(null);
  const tip = useId();
  // What the tip is up for, while it still is: the key last pressed, or the
  // whole monitor a finger touched. Every press is a moment of its own, so the
  // time is counted from the last.
  const [told, setTold] = useState<{ of: Place["opt"] | "all" } | null>(null);
  useEffect(() => {
    if (told === null) {
      return;
    }
    const timer = setTimeout(() => setTold(null), TOLD_MS);
    return () => clearTimeout(timer);
  }, [told]);
  const verb = t(opening ? "list.opening" : "list.open");
  const { stream } = options;

  return (
    <li className="al-row" data-al-told={told?.of}>
      {/* A finger has nothing to rest on the monitor: touching it says what a
          pointer resting there is told. The words are each place's name too. */}
      <div
        className="al-mon"
        data-al-here={here}
        onPointerUp={(event) => {
          if (touched(event)) {
            setTold({ of: "all" });
          }
        }}
      >
        {/* A screen is lit in either theme: what is drawn on it is the light
            theme's, whatever the page's. */}
        <span
          className="al-monscreen"
          data-al-theme="light"
          aria-hidden="true"
          ref={screen}
        >
          <i className="al-px" />
          <i className="al-bars" />
        </span>
        {/* biome-ignore lint/a11y/useSemanticElements: a group of three keys, not a form's fieldset */}
        <span
          className="al-monbase"
          role="group"
          aria-label={t("list.keys", { name: row.name })}
        >
          {places.map((place, at) => {
            if (place === null) {
              // biome-ignore lint/suspicious/noArrayIndexKey: the three places never change order
              return <span className="al-place" key={at} />;
            }
            return place.key ? (
              <button
                type="button"
                key={place.opt}
                className="al-place al-place--key"
                data-al-opt={place.opt}
                aria-label={said(place.says)}
                disabled={pending}
                onClick={() => {
                  onPress(place.opt);
                  setTold({ of: place.opt });
                }}
              >
                <Glyph name={place.glyph} />
              </button>
            ) : (
              <span
                key={place.opt}
                className="al-place"
                role="img"
                data-al-opt={place.opt}
                aria-label={said(place.says)}
              >
                <Glyph name={place.glyph} />
              </span>
            );
          })}
        </span>
      </div>
      <div className="al-who">
        <h2 className="al-name" ref={name}>
          {row.name}
        </h2>
        <p className="al-kind">{said(options.kind)}</p>
      </div>
      {/* What Open brings, a line a glyph: Open is described by it, so it is
          heard as well as seen. */}
      <div className="al-says al-glass" role="tooltip" id={tip}>
        {places.map(
          (place) =>
            place && (
              <p key={place.opt} data-al-for={place.opt}>
                <Glyph name={place.glyph} />
                <span>{said(place.says)}</span>
              </p>
            ),
        )}
        {stream && (
          <p>
            <Glyph name="info" />
            {"passed" in stream ? (
              <span>{said(stream.passed)}</span>
            ) : (
              <Reason place="AL-2500" cause={stream.cause} />
            )}
          </p>
        )}
      </div>
      <div className="al-rowact">
        <button
          type="button"
          className="al-btn al-btn--primary"
          aria-label={`${verb} ${row.name}`}
          aria-describedby={tip}
          onClick={() => onOpen(boxOf(screen.current, name.current))}
          disabled={pending || options.blocked !== null}
        >
          {verb}
        </button>
      </div>
      {options.blocked && (
        <div className="al-rownote">
          <Message place="AL-2600" cause={options.blocked} role="note" />
        </div>
      )}
    </li>
  );
}

/**
 * Another Mac with Alumia: a monitor that is not lit, because its picture is not
 * this gateway's to bring, its name, and the way to its own Alumia. The monitor's
 * base keeps the room of the three places with nothing in them: what that Mac
 * offers is its own to say, there.
 */
function Far({ neighbour }: { neighbour: Neighbour }) {
  const { t } = usePreferences();
  const tip = useId();
  // The tip is up for a moment after a finger touches the monitor, as a
  // computer's is.
  const [told, setTold] = useState(false);
  useEffect(() => {
    if (!told) {
      return;
    }
    const timer = setTimeout(() => setTold(false), TOLD_MS);
    return () => clearTimeout(timer);
  }, [told]);
  const verb = t("list.far.go");

  return (
    <li className="al-row" data-al-told={told ? "all" : undefined}>
      <div
        className="al-mon al-mon--far"
        aria-hidden="true"
        onPointerUp={(event) => {
          if (touched(event)) {
            setTold(true);
          }
        }}
      >
        <span className="al-monscreen" />
        <span className="al-monbase" />
      </div>
      <div className="al-who">
        <h2 className="al-name">{neighbour.name}</h2>
        <p className="al-kind">{t("list.far.kind")}</p>
      </div>
      <div className="al-says al-glass" role="tooltip" id={tip}>
        <p>
          <Glyph name="lock" />
          <span>{t("list.far.says")}</span>
        </p>
      </div>
      <div className="al-rowact">
        {/* A link, and not a button: it leaves this page for that Mac's. */}
        <a
          className="al-btn"
          href={neighbour.url}
          aria-label={`${verb}: ${neighbour.name}`}
          aria-describedby={tip}
        >
          {verb}
        </a>
      </div>
    </li>
  );
}

/** Said once per computer, before a mirrored Mac's first Open. */
function MirrorAsk({
  onCancel,
  onOpen,
}: {
  onCancel: () => void;
  onOpen: () => void;
}) {
  const { t } = usePreferences();
  return (
    <Dialog
      title={t("dialog.ack.title")}
      onCancel={onCancel}
      acts={
        <button
          type="button"
          className="al-btn al-btn--primary"
          onClick={onOpen}
        >
          {t("dialog.ack.act")}
        </button>
      }
    >
      <p>{t("dialog.ack.body.mirrored")}</p>
    </Dialog>
  );
}

/** Why a session that was on screen ended, said before the list is given back. */
function SessionEnded({ told, onClose }: { told: Told; onClose: () => void }) {
  const { t, message } = usePreferences();
  // A session that was on screen ended: with no cause named, that is what is
  // said, and never that it did not open.
  const code = told.code ?? "AL-7700";
  return (
    <Dialog
      alert
      title={t("dialog.error.title")}
      acts={
        <button
          type="button"
          className="al-btn al-btn--primary"
          onClick={onClose}
        >
          {t("dialog.error.act")}
        </button>
      }
    >
      {/* Always the catalogue's words, in the person's language: the cause's, or
          the general sentence for one nobody named. What whoever failed said is
          under Details, as it came. */}
      <p>{message("AL-2000", code, fillOf(told))}</p>
      <details className="al-details">
        <summary>
          <Glyph name="chevron-right" />
          <span>{t("common.details")}</span>
        </summary>
        <div className="al-detailbody">
          <span>
            <span>{t("common.code")}</span> <span>{code}</span>
          </span>
          {told.detail && (
            <span>
              <span>{t("common.original")}</span> <span>{told.detail}</span>
            </span>
          )}
        </div>
      </details>
    </Dialog>
  );
}

/** What an Open asks for: the computer, what it is started with, and where its monitor is. */
export interface Opened {
  name: string;
  /** What the line is called, which is what the screen that lights is titled. */
  title: string;
  choices: Choices;
  sound: boolean;
  /** The screen of the line's monitor on the window, which the lighting grows from. */
  from: Grows | null;
}

/** What the list says when it has nothing to list, and which nothing it is. */
function Unlisted({
  loading,
  empty,
  failed,
  stale,
}: {
  loading: boolean;
  /** The gateway answered, with no computer. */
  empty: boolean;
  /** The gateway did not answer. */
  failed: boolean;
  /** The gateway is of another version than this page's. */
  stale: VersionDifference | null;
}) {
  const { t, message } = usePreferences();
  return (
    <>
      {loading && (
        <>
          <output className="al-dim">{message("AL-2300")}</output>
          <div className="al-list" aria-hidden="true">
            <div className="al-skel" />
            <div className="al-skel" />
            <div className="al-skel" />
          </div>
        </>
      )}
      {empty && <p className="al-dim">{message("AL-2400")}</p>}
      {failed && <Message place="AL-2100" />}
      {stale && (
        <Message
          place="AL-2200"
          cause={stale.gateway === null ? "AL-2202" : "AL-2201"}
          fill={{ page: stale.page, gateway: stale.gateway ?? "" }}
        />
      )}
      {(failed || stale) && (
        <div>
          <button
            type="button"
            className="al-btn al-btn--primary"
            onClick={() => location.reload()}
          >
            <Glyph name="rotate-cw" />
            <span>{t("common.reload")}</span>
          </button>
        </div>
      )}
    </>
  );
}

/** The lines of the list, with what this browser remembers of each. */
function Lines({
  targets,
  pendingTarget,
  onOpen,
}: {
  targets: TargetInfo[];
  pendingTarget: string | null;
  /** Open was pressed on a line; `mirrored` is whether it is a Mac mirroring its screens. */
  onOpen: (opened: Opened, mirrored: boolean) => void;
}) {
  // What was chosen for each computer the last time, in this browser, and the
  // mode each two-mode Mac was on.
  const [remembered, setRemembered] = useState(readRememberedChoices);
  const [modes, setModes] = useState(readRememberedModes);
  // Whether the list has just arrived: the light passes once behind its keys.
  const [arrived, setArrived] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setArrived(false), ARRIVED_MS);
    return () => clearTimeout(timer);
  }, []);
  // What this browser can take, asked once at load (main.tsx) and stated on its
  // session socket too: the gateway refuses a stream it said it cannot. What of
  // it a desktop can follow, which decides the sizes a target offers here. And
  // whether it fits a picture to its width, as a touch client does.
  const abilities: Abilities = {
    appleMedia: decodesAppleMedia(),
    rdpGraphics: composesRdpGraphics(),
    follows: sizeFollows(),
    fitted: CAN_PINCH_ZOOM,
  };
  // What the page's address asks for, which no key offers.
  const asks = asked(location.search);
  const pending = pendingTarget !== null;

  return (
    <ul className="al-list" data-al-arrived={arrived ? "" : undefined}>
      {rowsOf(targets).map((row) => {
        const target = modeOf(row, modes);
        const options = targetOptions(
          target,
          remembered[target.name],
          abilities,
          asks,
        );
        return (
          <Computer
            key={rowKey(row)}
            row={row}
            options={options}
            places={placesOf(
              target,
              options,
              abilities,
              row.targets.length > 1,
            )}
            here={hereOf(target, options, abilities)}
            pending={pending}
            opening={pendingTarget === target.name}
            onPress={(opt) => {
              if (opt === "mode") {
                const next =
                  macMode(target) === "virtual" ? "mirror" : "virtual";
                setModes((was) => rememberMode(was, row, next));
              } else {
                setRemembered((was) =>
                  rememberChoice(was, target.name, pressed(options, opt)),
                );
              }
            }}
            onOpen={(from) =>
              onOpen(
                {
                  name: target.name,
                  title: row.name,
                  choices: options.choices,
                  sound: options.sound,
                  from,
                },
                macMode(target) === "mirror",
              )
            }
          />
        );
      })}
    </ul>
  );
}

export default function TargetPicker({
  open,
  pendingTarget,
  connectError,
  sessionFell,
  onRetry,
  onDismissError,
  onLogout,
  onUnauthorized,
}: {
  open: (opened: Opened) => void;
  pendingTarget: string | null;
  connectError: Told | null;
  /** That error ended a session that was on screen. */
  sessionFell: boolean;
  /** Open again what was last opened, where something was. */
  onRetry: (() => void) | null;
  onDismissError: () => void;
  onLogout: () => void;
  onUnauthorized: () => void;
}) {
  const { t } = usePreferences();
  // The Open that is waiting on "Understood": a mirrored Mac's first.
  const [asking, setAsking] = useState<Opened | null>(null);

  // Open, with full screen on a phone in the same press where its browser has
  // one; a refusal there is not this screen's to report, and the session opens
  // the same without it.
  const press = (opened: Opened) => {
    if (sizeFollows() === null && fullscreenSupported() && !isFullscreen()) {
      void toggleFullscreen().catch(() => {});
    }
    open(opened);
  };
  const [targets, setTargets] = useState<TargetInfo[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Set when the list came from a gateway of another version than this page's
  // (gatewayVersion.ts): the two versions, said beside a Reload.
  const [stale, setStale] = useState<VersionDifference | null>(null);
  // Offered only on a gateway with `[meter].enabled`; the view replaces the list while open.
  const throughputAvailable = useThroughputAvailable();
  const [showThroughput, setShowThroughput] = useState(false);

  useEffect(() => {
    let cancelled = false;
    gatewayFetch("/api/targets")
      .then((res) => {
        // Another gateway than this page's: its targets are not listed, because
        // nothing this page would start on them is that gateway's to answer.
        // Asked of its 401 too, and first: the reload comes before the login.
        const difference = versionDifference(res);
        if (difference) {
          if (!cancelled) {
            setStale(difference);
          }
          return null;
        }
        if (res.status === 401) {
          onUnauthorized();
          return null;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json() as Promise<TargetInfo[]>;
      })
      .then((list) => {
        if (!cancelled && list) {
          setTargets(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onUnauthorized]);

  // The other Macs with Alumia, asked once the list is there: they come after
  // it, and whatever goes wrong with asking is none of them (neighbours.ts).
  const [far, setFar] = useState<Neighbour[]>([]);
  const listed = targets !== null;
  useEffect(() => {
    if (!listed) {
      return;
    }
    let cancelled = false;
    void neighbours().then((found) => {
      if (!cancelled) {
        setFar(found);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [listed]);

  // The meter is a page of its own, with the way back where the mark was.
  if (showThroughput) {
    return (
      <Frame
        gear={false}
        top={
          <button
            type="button"
            className="al-btn al-btn--quiet"
            onClick={() => setShowThroughput(false)}
          >
            <Glyph name="arrow-left" />
            <span>{t("throughput.back")}</span>
          </button>
        }
      >
        <ThroughputPanel variant="page" onUnauthorized={onUnauthorized} />
      </Frame>
    );
  }

  const pending = pendingTarget !== null;
  const loading = targets === null && !loadFailed && !stale;

  return (
    <Frame
      onSignOut={onLogout}
      busy={pending}
      notice={
        connectError &&
        !sessionFell && (
          <Notice
            place="AL-2000"
            told={connectError}
            act={
              onRetry && (
                <button type="button" className="al-btn" onClick={onRetry}>
                  {t("common.retry")}
                </button>
              )
            }
          />
        )
      }
      foot={
        <>
          {throughputAvailable && (
            <button
              type="button"
              className="al-btn al-btn--quiet"
              onClick={() => setShowThroughput(true)}
              disabled={pending}
            >
              <Glyph name="activity" />
              <span>{t("throughput.title")}</span>
            </button>
          )}
          <button
            type="button"
            className="al-btn al-btn--quiet"
            onClick={onLogout}
            disabled={pending}
          >
            <Glyph name="log-out" />
            <span>{t("common.signout")}</span>
          </button>
          <AppVersion className="al-push" />
        </>
      }
    >
      <h1 className="al-listtitle">{t("list.title")}</h1>
      <Unlisted
        loading={loading}
        empty={targets?.length === 0}
        failed={loadFailed}
        stale={stale}
      />
      {targets && (
        <Lines
          targets={targets}
          pendingTarget={pendingTarget}
          onOpen={(opened, mirrored) => {
            if (mirrored && !acknowledged().includes(opened.name)) {
              setAsking(opened);
            } else {
              press(opened);
            }
          }}
        />
      )}
      {targets && far.length > 0 && (
        <>
          <h1 className="al-listtitle al-listtitle--next">
            {t("list.far.title")}
          </h1>
          <ul className="al-list">
            {far.map((neighbour) => (
              <Far key={neighbour.url} neighbour={neighbour} />
            ))}
          </ul>
        </>
      )}
      {asking && (
        <MirrorAsk
          onCancel={() => setAsking(null)}
          onOpen={() => {
            acknowledge(asking.name);
            setAsking(null);
            press(asking);
          }}
        />
      )}
      {connectError && sessionFell && (
        <SessionEnded told={connectError} onClose={onDismissError} />
      )}
    </Frame>
  );
}
