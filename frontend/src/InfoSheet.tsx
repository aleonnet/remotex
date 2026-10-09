import {
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react";
import { appWindow, onAppWindowChange } from "./appWindow.ts";
import {
  connectionLabel,
  connectionMode,
  type SessionKind,
} from "./connectionLabel.ts";
import { fillOf } from "./fault.ts";
import { fullscreenSupported } from "./fullscreen.ts";
import { Glyph } from "./Glyph.tsx";
import { keyboardLockSupported } from "./keyboardLock.ts";
import { type LabEvent, lab, type Panel, TRACE_MS } from "./lab.ts";
import {
  type AudioRow,
  audioDetail,
  pictureState,
  soundState,
  type VideoStreamInfo,
  videoSaid,
} from "./mediaLabel.ts";
import { usePreferences } from "./preferences.tsx";
import type { DisplayInfo, HoldCause } from "./protocol.ts";
import { Sheet } from "./Sheet.tsx";
import {
  CAN_PINCH_ZOOM,
  densityLabel,
  type RemoteSize,
} from "./useRemoteDesktop.ts";
import type { Code, Fill, WordKey } from "./words.ts";

// Information about the session, in four tabs, every row on the same two columns
// and every key drawn as a key.
//
// "This session" says what a person asks first — which computer, how large, is
// there sound, whose picture — and keeps what an operator asks behind "Details":
// the config's spelling of the connection, the dial the gateway resolved, the
// decoders this browser built, the two densities. A density that did not take is
// otherwise invisible: the desktop simply looks soft, or half the size it was
// asked for, with nothing saying which end disagreed.
//
// The keys tab shows both tables, whichever pair of keyboards this session has:
// each says which pair it is about.

type Tab = "session" | "shortcuts" | "keys" | "gestures" | "lab";

const TABS: readonly [Tab, WordKey][] = [
  ["session", "info.tab.session"],
  ["shortcuts", "info.tab.shortcuts"],
  ["keys", "info.tab.keys"],
  ["gestures", "info.tab.gestures"],
];

/** The laboratory's tab, there while the laboratory is on (lab.ts). */
const LAB_TAB: [Tab, WordKey] = ["lab", "info.tab.lab"];

/** A length of time in the panel's words: seconds, or minutes and seconds. */
function spanOf(ms: number, t: (key: WordKey, fill?: Fill) => string): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60
    ? t("info.lab.minutes", { m: Math.floor(s / 60), s: s % 60 })
    : t("info.lab.seconds", { s });
}

/** Why a whole picture was asked for, in the dictionary's words: the page's own reasons (framePainter.ts). */
const WHY: Record<string, WordKey> = {
  "the page was out of sight": "info.lab.why.sight",
  "a malformed batch was dropped": "info.lab.why.malformed",
};

/**
 * An event in words, for the panel's last line: each kind its sentence. A
 * reason the decoder gave in its own words (videoDecoder.ts) is said as the
 * decoder failing, with those words after.
 */
function eventSaid(
  event: LabEvent,
  t: (key: WordKey, fill?: Fill) => string,
): string {
  const why = (reason?: string) => {
    const key = reason === undefined ? undefined : WHY[reason];
    return key
      ? t(key)
      : `${t("info.lab.why.decoder")}${reason ? ` (${reason})` : ""}`;
  };
  switch (event.kind) {
    case "connected":
      return t("info.lab.event.connected", { how: event.how });
    case "dropped":
      return t("info.lab.event.dropped");
    case "resize":
      return t("info.lab.event.resize", event);
    case "presented":
      return t("info.lab.event.presented", event);
    case "keyframe":
      if (event.what === "asked") {
        return t("info.lab.event.asked", { why: why(event.reason) });
      }
      if (event.what === "gaveUp") {
        return t("info.lab.event.gaveUp", { why: why(event.reason) });
      }
      return t("info.lab.event.painted");
    case "decoder":
      return event.what === "restarted"
        ? t("info.lab.event.restarted")
        : t("info.lab.event.error", { said: event.said ?? "" });
    case "sight":
      return t(
        event.visible ? "info.lab.event.visible" : "info.lab.event.hidden",
      );
    case "shown":
      return t("info.lab.event.shown", { w: event.w });
    case "sound":
      return t("info.lab.event.sound", {
        ms: event.leadMs,
        restarts: event.restarts,
        trims: event.trims,
      });
    case "painted":
      return t("info.lab.event.batch");
    case "edge":
      return t("info.lab.event.edge", {
        side: t(`info.lab.side.${event.side}`),
        cursor: event.cursor,
        remote: event.remote,
        clientH: event.clientH,
        visual:
          event.visualH === null
            ? t("info.lab.none")
            : `${event.visualH} px · ${event.visualScale}× · +${event.visualTop}`,
      });
  }
}

/** One second of the trace: how lit, and whether asked or away. */
interface Column {
  lit: 0 | 1 | 2;
  ask: boolean;
  away: boolean;
}

/** The last minute of the picture as columns, the newest last, at `now`. */
function columnsOf(panel: Panel, now: number): Column[] {
  const newest = Math.floor(now / 1000);
  const seconds = TRACE_MS / 1000;
  const traced = new Map(panel.trace.map((c) => [c.second, c]));
  return Array.from({ length: seconds }, (_, i) => {
    const second = newest - seconds + 1 + i;
    const column = traced.get(second);
    const at = second * 1000;
    return {
      lit: column ? (column.painted > 1 ? 2 : 1) : 0,
      ask: column?.asked ?? false,
      away: panel.away.some(
        (span) => span.from <= at + 999 && (span.to === null || span.to > at),
      ),
    };
  });
}

/**
 * The laboratory's panel: what the page has seen since the laboratory was
 * switched on, as instruments (lab.ts, `panel`). The trace is the last minute
 * of the picture drawn as the glass's own grid, a column a second; under it
 * the last event in words, and four gauges with one big number each, their
 * "ago"s running every second and a measure that asks for attention in the
 * colour of danger. Copy report takes the panel as text to this device's
 * clipboard, inside the tap.
 */
function Laboratory() {
  const { t, message } = usePreferences();
  const panel = useSyncExternalStore(lab.subscribe, lab.panel);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [copied, setCopied] = useState<Code | null>(null);

  const none = t("info.lab.none");
  const ago = (at: number | null) => (at === null ? none : spanOf(now - at, t));
  const { picture, sound, sight, link } = panel;
  const gauges: {
    caption: WordKey;
    big: string;
    lines: { says: string; danger?: boolean }[];
  }[] = [
    {
      caption: "info.lab.gauge.shown",
      big: picture.shown === null ? none : `${picture.shown} px`,
      lines: [
        {
          says: `${picture.arrives ? t("info.lab.arrives", picture.arrives) : none} · ${t("info.lab.last", { t: ago(picture.lastAt) })}`,
        },
        {
          says: t("info.lab.keyframes", {
            asked: picture.asked,
            painted: picture.painted,
            gaveUp: picture.gaveUp,
          }),
          danger: picture.gaveUp > 0,
        },
        {
          says: t("info.lab.decoder", {
            restarted: picture.restarted,
            errors: picture.errors,
          }),
          danger: picture.errors > 0,
        },
      ],
    },
    {
      caption: "info.lab.gauge.lead",
      big: sound.leadMs === null ? none : `${sound.leadMs} ms`,
      lines: [
        { says: t("info.lab.restarts", { n: sound.restarts }) },
        {
          says: t("info.lab.trims", { n: sound.trims }),
          danger: sound.trims > 0,
        },
      ],
    },
    {
      caption: "info.lab.gauge.hidden",
      big: `${sight.hidden}×`,
      lines: [
        {
          says: t("info.lab.away", {
            t: spanOf(
              sight.awayMs +
                (sight.hiddenAt === null ? 0 : now - sight.hiddenAt),
              t,
            ),
          }),
        },
        { says: t("info.lab.back", { t: ago(sight.backAt) }) },
      ],
    },
    {
      caption: "info.lab.gauge.connected",
      big: ago(link.connectedAt),
      lines: [
        {
          says: t("info.lab.drops", { n: link.drops }),
          danger: link.drops > 0,
        },
        {
          says: t("info.lab.resizes", {
            n: link.resizes,
            ms: link.echoMs ?? none,
          }),
        },
      ],
    },
  ];
  const last = panel.last && {
    when: t("info.lab.event", { t: ago(panel.last.at) }),
    said: eventSaid(panel.last.event, t),
  };
  const report = [
    t("info.lab.since", { t: ago(panel.since) }),
    ...(last ? [`${last.when} ${last.said}`] : []),
    ...gauges.flatMap((gauge) => [
      "",
      t(gauge.caption),
      `  ${gauge.big}`,
      ...gauge.lines.map((line) => `  ${line.says}`),
    ]),
  ].join("\n");
  const copy = () => {
    navigator.clipboard.writeText(report).then(
      () => setCopied("AL-6306"),
      () => setCopied("AL-6307"),
    );
  };
  const columns = columnsOf(panel, now);

  return (
    <div className="al-lab">
      <div className="al-labhead">
        <span>{t("info.lab.since", { t: ago(panel.since) })}</span>
        <span className="al-small al-dim">{t("info.lab.trace")}</span>
      </div>
      <div className="al-labtrace" aria-hidden="true">
        {columns.map((column, i) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: a column is its place in the minute
            key={i}
            data-lit={column.lit}
            data-ask={column.ask ? "" : undefined}
            data-away={column.away ? "" : undefined}
          >
            <b />
            <b />
            <b />
          </i>
        ))}
      </div>
      <div className="al-labkey">
        <span data-key="lit">{t("info.lab.trace.lit")}</span>
        <span data-key="ask">{t("info.lab.trace.ask")}</span>
        <span data-key="away">{t("info.lab.trace.away")}</span>
      </div>
      {last && (
        <p className="al-small">
          <span>{last.when}</span> <span>{last.said}</span>
        </p>
      )}
      <dl className="al-gauges">
        {gauges.map((gauge) => (
          <div className="al-gauge" key={gauge.caption}>
            <dt>{t(gauge.caption)}</dt>
            <dd>{gauge.big}</dd>
            {gauge.lines.map((line) => (
              <dd
                key={line.says}
                className={line.danger ? "al-msg--danger" : undefined}
              >
                {line.says}
              </dd>
            ))}
          </div>
        ))}
      </dl>
      <div className="al-formrow">
        <button type="button" className="al-btn" onClick={copy}>
          <Glyph name="copy" />
          <span>{t("info.lab.copy")}</span>
        </button>
        <output>{copied && message("AL-6300", copied)}</output>
      </div>
    </div>
  );
}

/** Keys, drawn as keys. What is written on a key is the key, in any language. */
function Caps({ keys }: { keys: string }) {
  return (
    <span>
      {keys.split(" ").map((key) => (
        <kbd key={key} className="al-cap">
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** One cell of the sheet's grid: what it is, its value, and a note under it. */
function Spec({
  name,
  value,
  note,
  onTap,
}: {
  name: string;
  value: string;
  note?: ReactNode;
  /** The value takes taps, as the version's does: seven switch the laboratory (lab.ts). */
  onTap?: () => void;
}) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>
        {onTap ? (
          <button type="button" className="al-spec-tap" onClick={onTap}>
            {value}
          </button>
        ) : (
          value
        )}
      </dd>
      {note && <dd className="al-small">{note}</dd>}
    </div>
  );
}

/** What an operator asks, behind "Details": all of it data, the same in any language. */
function Technical({
  kind,
  size,
  hostScale,
  renderPlan,
  oversize,
  audio,
  videoStream,
}: Pick<
  Props,
  | "kind"
  | "size"
  | "hostScale"
  | "renderPlan"
  | "oversize"
  | "audio"
  | "videoStream"
>) {
  const { t, message } = usePreferences();
  const video = videoSaid(videoStream, oversize);
  // Why no video is in use, where the line has a cause to give beyond waiting.
  const why =
    "code" in video && video.code !== "AL-5800" ? video.code : undefined;
  return (
    <details className="al-details">
      <summary>
        <Glyph name="chevron-right" />
        <span>{t("common.details")}</span>
      </summary>
      <dl className="al-dl al-detailbody">
        <dt>{t("info.connection")}</dt>
        <dd>{kind ? connectionLabel(kind) : "—"}</dd>
        <dt>{t("info.render")}</dt>
        <dd>{renderPlan || "—"}</dd>
        <dt>{t("info.audio")}</dt>
        <dd>{audio.stream ? audioDetail(audio.stream) : "—"}</dd>
        <dt>{t("info.video")}</dt>
        <dd>{"decode" in video ? video.decode : message("AL-5800", why)}</dd>
        <dt>{t("info.density")}</dt>
        <dd>
          {size ? densityLabel(size.scale * 100).replace("x", "×") : "—"}
          {" · "}
          {densityLabel(hostScale).replace("x", "×")}
        </dd>
      </dl>
    </details>
  );
}

function ThisSession({
  name,
  kind,
  size,
  hostScale,
  renderPlan,
  oversize,
  audio,
  videoStream,
  displays,
  onThroughput,
}: Omit<Props, "onClose" | "touchActive" | "macHost">) {
  const { t, said, message } = usePreferences();
  // Whether the page's laboratory is on, which the version row switches and says.
  const labOn = useSyncExternalStore(lab.subscribe, lab.on);
  const mode = kind
    ? connectionMode(
        kind,
        displays.some((display) => display.virtual),
      )
    : null;
  // A Mac sends its sound and its picture over its own media stream, and mutes
  // itself while it does: the two notes that are about that, and nothing else.
  const mac =
    kind?.subtype === "ard-high-performance" || kind?.subtype === "ard-mirror";
  const sound = soundState(audio);
  const SOUND: Record<typeof sound, WordKey> = {
    playing: "info.sound.on",
    muted: "info.sound.muted",
    none: "info.sound.none",
    waiting: "info.waiting",
    stopped: "info.sound.stopped",
  };
  const picture = pictureState(videoStream);
  // A Mirrored session of a Mac with several screens: why only its main one is shown.
  const mirrorScreens =
    kind?.subtype === "ard-mirror" && displays.length > 1
      ? message("AL-5900")
      : null;
  const PICTURE: Record<typeof picture, WordKey> = {
    passed: "info.picture.passed",
    encoded: "info.picture.encoded",
    composed: "info.picture.composed",
    waiting: "info.waiting",
  };

  return (
    <>
      <p>
        <span className="al-name al-infoname">{name}</span>
        {mode && (
          <>
            {" "}
            <span>{said(mode)}</span>
          </>
        )}
      </p>
      <dl className="al-spec">
        <Spec
          name={t("info.remote")}
          value={size ? `${size.w} × ${size.h}` : "—"}
          note={mirrorScreens ?? t("info.remote.note")}
        />
        <Spec
          name={t("info.here")}
          value={`${window.innerWidth} × ${window.innerHeight}`}
          // A touch client fits the picture to its width; a pointer shows it at 100%.
          note={t(CAN_PINCH_ZOOM ? "info.here.fitted" : "info.here.note")}
        />
        <Spec
          name={t("info.sound")}
          value={t(SOUND[sound])}
          note={
            audio.error
              ? message("AL-5700", audio.error.code, fillOf(audio.error))
              : mac && sound !== "none" && t("info.sound.note")
          }
        />
        <Spec
          name={t("info.picture")}
          value={t(PICTURE[picture])}
          note={mac && picture === "passed" && t("info.picture.note")}
        />
        <Spec
          name={t("info.link")}
          value={t("info.link.secure")}
          note={location.origin}
        />
        <Spec
          name={t("info.version")}
          value={__APP_VERSION__}
          note={t(labOn ? "info.lab.on" : "info.version.note")}
          onTap={lab.tap}
        />
      </dl>
      <Technical
        kind={kind}
        size={size}
        hostScale={hostScale}
        renderPlan={renderPlan}
        oversize={oversize}
        audio={audio}
        videoStream={videoStream}
      />
      {onThroughput && (
        <div className="al-formrow">
          <button type="button" className="al-btn" onClick={onThroughput}>
            <Glyph name="activity" />
            <span>{t("throughput.title")}</span>
          </button>
        </div>
      )}
    </>
  );
}

function Shortcuts({ macHost }: { macHost: boolean }) {
  const { t } = usePreferences();
  // Subscribed, not read: one row tells the person to install this page as an
  // app, and doing so must make the row itself go away without a reload.
  const installed = useSyncExternalStore(
    onAppWindowChange,
    appWindow,
    () => false,
  );
  // A full screen without Keyboard Lock is the larger desktop and nothing more,
  // so the keys are promised only where the browser has them to give. Escape
  // also stops being a key that has to be *held*, which is a lock's doing alone.
  const locks = keyboardLockSupported();
  return (
    <dl className="al-rows">
      <dt>{t("info.short.1.a")}</dt>
      <dd>
        {/* This device's chord, and not every device's: the one that works here. */}
        <Caps keys={macHost ? "⌃ ⌘ ⇧ ;" : "Ctrl Alt Shift ;"} />
      </dd>
      {fullscreenSupported() && (
        <>
          <dt>{t(locks ? "info.short.2.a" : "session.fullscreen.enter")}</dt>
          <dd>{t(locks ? "info.short.2.b.bar" : "info.short.2.b.nolock")}</dd>
          <dt>{t(locks ? "info.short.3.a" : "info.short.3.a.nolock")}</dt>
          <dd>
            <Caps keys="Esc" />
            <span>{t(locks ? "info.short.3.b" : "info.short.3.b.nolock")}</span>
          </dd>
        </>
      )}
      {!installed && (
        <>
          <dt>{t("info.short.4.a")}</dt>
          <dd>{t("info.short.4.b.short")}</dd>
        </>
      )}
    </dl>
  );
}

function Keys() {
  const { t } = usePreferences();
  return (
    <>
      <p className="al-rowshead">{t("info.mackeys")}</p>
      <dl className="al-rows">
        <dt>{t("info.mackeys.1.a")}</dt>
        <dd>
          <span>{t("info.mackeys.1.lead")}</span>
          <Caps keys="A C F P S V X Z" />
        </dd>
        <dt>{t("info.mackeys.2.a")}</dt>
        <dd>{t("info.mackeys.2.b")}</dd>
        <dt>
          <Caps keys="⌘" /> <span>{t("info.mackeys.3.a")}</span>
        </dt>
        <dd>{t("info.mackeys.3.b")}</dd>
        <dt>{t("info.mackeys.4.a")}</dt>
        <dd>
          <Caps keys="⌘W ⌘T ⌘N ⌘L ⌘O ⌘R" />
        </dd>
        <dt>{t("info.mackeys.5.a")}</dt>
        <dd>{t("info.mackeys.5.b")}</dd>
      </dl>
      <p className="al-rowshead">{t("info.pckeys")}</p>
      <dl className="al-rows">
        <dt>
          <Caps keys="Alt" />
          <span>{t("info.pckeys.1.a")}</span>
        </dt>
        <dd>
          <Caps keys="⌘" />
        </dd>
        <dt>
          <Caps keys="⊞" />
          <span>{t("info.pckeys.2.a")}</span>
        </dt>
        <dd>
          <Caps keys="⌘" />
        </dd>
        <dt>
          <Caps keys="Alt" />
          <span>{t("info.pckeys.3.a")}</span>
        </dt>
        <dd>
          <Caps keys="⌥" />
        </dd>
        <dt>
          <Caps keys="⌥" />
          <span>{t("info.pckeys.4.a")}</span>
        </dt>
        <dd>{t("info.pckeys.4.b.short")}</dd>
      </dl>
    </>
  );
}

const GESTURES: readonly [WordKey, WordKey][] = [
  ["info.touch.1.a", "info.touch.1.b"],
  ["info.touch.2.a", "info.touch.2.b"],
  ["info.touch.3.a", "info.touch.3.b"],
  ["info.touch.4.a", "info.touch.4.b"],
  ["info.touch.5.a", "info.touch.5.b"],
  ["info.touch.6.a", "info.touch.6.b"],
];

function Gestures({ touchActive }: { touchActive: boolean }) {
  const { t, message } = usePreferences();
  return (
    <>
      {/* With touch passed to the remote, its own gestures apply and these do
          not: said ahead of the table it sets aside. */}
      {touchActive && <p role="note">{message("AL-5600")}</p>}
      <dl className="al-rows">
        {GESTURES.map(([gesture, action]) => (
          <Fragment key={gesture}>
            <dt>{t(gesture)}</dt>
            <dd>{t(action)}</dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}

interface Props {
  /** The computer the session is on. */
  name: string;
  /** What it is speaking, from `connected`. */
  kind: SessionKind | null;
  /** The remote's framebuffer and its density; null before it announces one. */
  size: RemoteSize | null;
  /** This screen's density, in hundredths. */
  hostScale: number;
  /** The dial the gateway resolved, one line. */
  renderPlan: string;
  /** Why the desktop has no picture, where it has none. */
  oversize: HoldCause | null;
  audio: AudioRow;
  videoStream: VideoStreamInfo | null;
  displays: DisplayInfo[];
  /** Fingers reach the remote as touches, so its own gestures apply. */
  touchActive: boolean;
  /** This keyboard has a Command key: which chord hides the handle here. */
  macHost: boolean;
  /** Opens the meter, on a gateway that keeps one. */
  onThroughput: (() => void) | null;
  onClose: () => void;
}

export function InfoSheet(props: Props) {
  const { t } = usePreferences();
  const [tab, setTab] = useState<Tab>("session");
  const id = useId();
  // The laboratory's tab is there while the laboratory is on, and the sheet is
  // back on the first tab the moment it goes.
  const labOn = useSyncExternalStore(lab.subscribe, lab.on);
  const tabs = labOn ? [...TABS, LAB_TAB] : TABS;
  const shown = tab === "lab" && !labOn ? "session" : tab;

  return (
    <Sheet title={t("session.info")} kind="wide" onClose={props.onClose}>
      <div className="al-tabs" role="tablist" aria-label={t("session.info")}>
        {tabs.map(([name, word]) => (
          <button
            key={name}
            type="button"
            className="al-tab"
            role="tab"
            id={`${id}-${name}`}
            aria-selected={shown === name}
            aria-controls={`${id}-panel`}
            onClick={() => setTab(name)}
          >
            {t(word)}
          </button>
        ))}
      </div>
      <div
        className={
          shown === "keys" ? "al-tabpanel al-tabpanel--tight" : "al-tabpanel"
        }
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${shown}`}
      >
        {shown === "session" && <ThisSession {...props} />}
        {shown === "shortcuts" && <Shortcuts macHost={props.macHost} />}
        {shown === "keys" && <Keys />}
        {shown === "gestures" && <Gestures touchActive={props.touchActive} />}
        {shown === "lab" && <Laboratory />}
      </div>
    </Sheet>
  );
}
