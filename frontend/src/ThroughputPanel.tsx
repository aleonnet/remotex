import {
  type CSSProperties,
  type FormEvent,
  Fragment,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { Fault } from "./fault.ts";
import { Glyph } from "./Glyph.tsx";
import { gatewayConfig } from "./gatewayConfig.ts";
import { Message } from "./Message.tsx";
import { usePreferences } from "./preferences.tsx";
import { Sheet } from "./Sheet.tsx";
import {
  appendLive,
  clockNow,
  customThroughputRange,
  customThroughputWindow,
  DEFAULT_THROUGHPUT_RANGE,
  fetchThroughput,
  fetchThroughputLive,
  formatRate,
  highest,
  isThroughputWindow,
  LIVE_HISTORY_SECS,
  type LiveRate,
  liveSeries,
  liveTotals,
  localInputValue,
  type RateSeries,
  rateScale,
  recordedSeries,
  seedLive,
  spanLabel,
  THROUGHPUT_PRESETS,
  THROUGHPUT_SOCKETS,
  THROUGHPUT_UNITS,
  type ThroughputLive,
  type ThroughputRange,
  type ThroughputReport,
  type ThroughputSeries,
  type ThroughputSocket,
  type ThroughputSource,
  type ThroughputUnit,
  throughputBounds,
  throughputRangeIsLive,
  throughputRangeKey,
  throughputTargets,
  timeLabel,
} from "./throughput.ts";
import { chartShape, pointedIndex, tipLeft, VIEW } from "./throughputChart.ts";
import type { WordKey } from "./words.ts";

// The meter: a page of its own from the list of computers, and a sheet of glass
// from a session's information. See throughput.ts.
//
// A network meter over one range: each direction's rate, large, over a trace of
// the range behind it, one per direction since the two differ by orders of
// magnitude and would flatten each other on one scale. The rate right now — what
// the gateway's last one-second sample found moving — is polled every second while
// the meter is open and kept for the last five minutes. One poll is out at a time,
// so a slow answer is never overtaken by a later one.
//
// The range decides what the trace is drawn from. One no longer than the seconds
// kept is drawn from them, second by second; its right edge is the gateway's clock
// as the page reckons it, so a poll that fails or is skipped leaves a gap rather
// than the last sample standing at "now". A longer one is drawn from the recorded
// timeframes, a point the average over one or over several, read when the range is
// chosen and again as each timeframe closes. Pause stops both reads, and so the
// trace, until Resume.
//
// The directions are the browser's: "Received" is what this browser receives, which
// the gateway counts as what it sent, and "Sent" the other way about. Every rate is
// in bits per second; the bytes behind them stay in the model and the API.

/// Whether to offer the meter at all: only a gateway with `[meter].enabled` records any.
export function useThroughputAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    gatewayConfig().then(({ throughput }) => {
      if (!cancelled) {
        setAvailable(throughput);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

/// How often the rate right now is read: the gateway samples once a second.
const LIVE_PERIOD_MS = 1000;

/// How soon the recorded rows are read again when the read carried the seconds that
/// moved — the trace then draws a point a second, and a stale one shows — and how soon a
/// failed read is retried.
const RECORDED_PERIOD_SECS = 10;

/// How long a range the "Between…" fields open on.
const SEEDED_WINDOW_SECS = 3600;

/// How many of the newest points the table says.
const TABLE_ROWS = 5;

/// What each socket is called: the screen's, the sound's, and the two the browser sends on.
const SOCKET_WORD: Record<ThroughputSocket, WordKey> = {
  session: "throughput.socket.screen",
  audio: "throughput.socket.sound",
  camera: "session.camera",
  mic: "session.microphone",
};

/// What each ready range is called, by its key (throughput.ts, `throughputRangeKey`).
const PRESET_WORD: Record<string, WordKey> = {
  "60:seconds": "throughput.range.60s",
  "5:minutes": "throughput.range.5min",
  "15:minutes": "throughput.range.15min",
  "30:minutes": "throughput.range.30min",
  "1:hours": "throughput.range.1h",
  "3:hours": "throughput.range.3h",
  "6:hours": "throughput.range.6h",
  "12:hours": "throughput.range.12h",
  "24:hours": "throughput.range.24h",
  "3:days": "throughput.range.3d",
  "7:days": "throughput.range.7d",
  "14:days": "throughput.range.14d",
  "30:days": "throughput.range.30d",
  all: "throughput.range.all",
};

const UNIT_WORD: Record<ThroughputUnit, WordKey> = {
  seconds: "throughput.unit.seconds",
  minutes: "throughput.unit.minutes",
  hours: "throughput.unit.hours",
  days: "throughput.unit.days",
};

/// How long until the recorded rows are read again: a range drawn a point per timeframe
/// has nothing new to say until the next one closes, while one drawn a point per second
/// moves on with every read.
function readAgainSecs(report: ThroughputReport): number {
  return report.hasSeconds
    ? RECORDED_PERIOD_SECS
    : Math.max(RECORDED_PERIOD_SECS, report.intervalSecs);
}

/// The filter select's value for a target: `null` (the list) cannot be an option
/// value, and a prefix keeps a computer named "all" apart from the "all" choice.
function targetKey(target: string | null): string {
  return target === null ? "picker" : `target:${target}`;
}

/// The select of the period and, under it, the fields the two typed periods are
/// written in: a length back from now, or a start and an end of its own. Both apply
/// on Apply (or Enter), not per keystroke, so half a number and half a date are never
/// read.
function RangeControls({
  range,
  now,
  onChange,
  select,
}: {
  range: ThroughputRange;
  /// The gateway's second, which the fields open on; before the first read, this
  /// browser's own.
  now: number | null;
  onChange: (range: ThroughputRange) => void;
  /// Where the select itself goes: beside the other two, above the fields.
  select: (select: ReactNode) => ReactNode;
}) {
  const { t } = usePreferences();
  const id = useId();
  const listed = THROUGHPUT_PRESETS.some(
    (p) => throughputRangeKey(p) === throughputRangeKey(range),
  );
  const [mode, setMode] = useState<"preset" | "span" | "window">(() => {
    if (listed) {
      return "preset";
    }
    return isThroughputWindow(range) ? "window" : "span";
  });
  const seed =
    range === "all" || isThroughputWindow(range)
      ? DEFAULT_THROUGHPUT_RANGE
      : range;
  const [amount, setAmount] = useState(String(seed.amount));
  const [unit, setUnit] = useState<ThroughputUnit>(seed.unit);
  // The range on screen when the fields are opened, or the hour up to now.
  const openOn = () => {
    const clock = now ?? Math.floor(Date.now() / 1000);
    const window = isThroughputWindow(range)
      ? range
      : { from: clock - SEEDED_WINDOW_SECS, to: clock };
    return {
      from: localInputValue(window.from),
      to: localInputValue(window.to),
    };
  };
  const [times, setTimes] = useState(openOn);
  const typed =
    mode === "window"
      ? customThroughputWindow(times.from, times.to)
      : customThroughputRange(amount, unit);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    if (typed !== null) {
      onChange(typed);
    }
  };
  const applyButton = (
    <button
      type="submit"
      className="al-btn"
      disabled={
        typed === null ||
        throughputRangeKey(typed) === throughputRangeKey(range)
      }
    >
      {t("common.apply")}
    </button>
  );

  return (
    <>
      {select(
        <select
          className="al-select"
          aria-label={t("throughput.range")}
          value={mode === "preset" ? throughputRangeKey(range) : mode}
          onChange={(e) => {
            if (e.target.value === "window") {
              setTimes(openOn());
            }
            if (e.target.value === "span" || e.target.value === "window") {
              setMode(e.target.value);
              return;
            }
            setMode("preset");
            const chosen = THROUGHPUT_PRESETS.find(
              (p) => throughputRangeKey(p) === e.target.value,
            );
            if (chosen !== undefined) {
              onChange(chosen);
            }
          }}
        >
          {THROUGHPUT_PRESETS.map((choice) => (
            <option
              key={throughputRangeKey(choice)}
              value={throughputRangeKey(choice)}
            >
              {t(PRESET_WORD[throughputRangeKey(choice)])}
            </option>
          ))}
          <option value="span">{t("throughput.custom")}</option>
          <option value="window">{t("throughput.between")}</option>
        </select>,
      )}
      {mode === "span" && (
        <form className="al-periodform" onSubmit={apply}>
          <div className="al-field">
            <label htmlFor={`${id}-amount`}>{t("throughput.length")}</label>
            <input
              className="al-input"
              id={`${id}-amount`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="al-field">
            <label htmlFor={`${id}-unit`}>{t("throughput.unit")}</label>
            <select
              className="al-select"
              id={`${id}-unit`}
              value={unit}
              onChange={(e) => setUnit(e.target.value as ThroughputUnit)}
            >
              {THROUGHPUT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(UNIT_WORD[u])}
                </option>
              ))}
            </select>
          </div>
          {applyButton}
        </form>
      )}
      {mode === "window" && (
        <form className="al-periodform" onSubmit={apply}>
          <div className="al-field">
            <label htmlFor={`${id}-from`}>{t("throughput.from")}</label>
            <input
              className="al-input"
              id={`${id}-from`}
              type="datetime-local"
              value={times.from}
              onChange={(e) => setTimes({ ...times, from: e.target.value })}
            />
          </div>
          <div className="al-field">
            <label htmlFor={`${id}-to`}>{t("throughput.to")}</label>
            <input
              className="al-input"
              id={`${id}-to`}
              type="datetime-local"
              value={times.to}
              onChange={(e) => setTimes({ ...times, to: e.target.value })}
            />
          </div>
          {applyButton}
        </form>
      )}
    </>
  );
}

/// What one range comes to at this read: the trace's series, drawn from the seconds
/// kept or from the recorded rows. Before the first answer it is a trace of nothing
/// read, as wide as the range asked for.
function seriesOf(
  range: ThroughputRange,
  read: {
    report: ThroughputReport | null;
    history: readonly ThroughputLive[];
    now: number | null;
  },
  keep: (source: ThroughputSource) => boolean,
): ThroughputSeries {
  const { within, end } = throughputBounds(range);
  if (throughputRangeIsLive(range) && within !== null) {
    return liveSeries(read.history, within, keep, read.now);
  }
  if (read.report !== null) {
    return recordedSeries(read.report, { within, end }, keep);
  }
  const unread: RateSeries = { points: [null, null], mean: 0, busiest: 0 };
  return {
    sent: unread,
    received: unread,
    stepSecs: (within ?? 0) / 2,
    spanSecs: within ?? 0,
    end: null,
  };
}

/// One direction: its name, the reading large, the average and the peak, and its trace.
function Trace({
  direction,
  series,
  now,
  pointed,
  when,
  note,
}: {
  direction: "received" | "sent";
  series: RateSeries;
  /// The rate right now, where the meter has one to say: null where it has none.
  now: number | null;
  /// The point under the cursor, where there is one.
  pointed: number | null;
  /// What the reading is of: "now", or the instant under the cursor.
  when: string;
  /// What the scale is of, beside its top, where a point is an average.
  note: string;
}) {
  const { t, language } = usePreferences();
  const id = useId();
  const { points, mean } = series;
  // The scale fits what is drawn — the steps and the mean line, which stands above
  // every step when a step averages quiet seconds the mean leaves out. The busiest
  // second stands above both over recorded timeframes, and is said in words.
  const top = rateScale(Math.max(highest(points), mean));
  const shape = chartShape(points, top, mean);
  const reading = pointed === null ? now : (points[pointed] ?? null);
  const cross =
    pointed === null
      ? null
      : (pointed / Math.max(1, points.length - 1)) * VIEW.width;
  return (
    <figure className={`al-trace al-${direction}`}>
      <figcaption className="al-tracehead">
        <span>
          <i className="al-swatch" />
          <span>{t(`throughput.${direction}`)}</span>
        </span>
        <b>
          {reading === null
            ? pointed === null
              ? "—"
              : t("throughput.unread")
            : formatRate(reading, language)}
        </b>
        <span className="al-small">{when}</span>
        <span className="al-small al-push">
          <span>{t("throughput.avg")}</span>{" "}
          <span>{formatRate(mean, language)}</span>
          {" · "}
          <span>{t("throughput.peak")}</span>{" "}
          <span>{formatRate(series.busiest, language)}</span>
        </span>
      </figcaption>
      <div className="al-plot">
        <svg
          className="al-chart"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* The area is not a wash of colour: it is the lit cells of a screen. */}
          <defs>
            <pattern id={id} width={4} height={4} patternUnits="userSpaceOnUse">
              <rect className="al-cells" width={3} height={3} />
            </pattern>
          </defs>
          {shape.grid.map((y) => (
            <line
              key={y}
              className="al-gridline"
              x1={0}
              x2={VIEW.width}
              y1={y}
              y2={y}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {shape.areas.map((d) => (
            <path key={d} className="al-area" fill={`url(#${id})`} d={d} />
          ))}
          {shape.mean !== null && (
            <line
              className="al-avg"
              x1={0}
              x2={VIEW.width}
              y1={shape.mean}
              y2={shape.mean}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {shape.lines.map((d) => (
            <path
              key={d}
              className="al-line"
              d={d}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {cross !== null && (
            <line
              className="al-cross"
              x1={cross}
              x2={cross}
              y1={0}
              y2={VIEW.height}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <span className="al-scale al-small">
          {note && `${note} · `}
          {formatRate(top, language)}
        </span>
      </div>
    </figure>
  );
}

/// Where what arrives comes from, now: each socket's share of what this browser is
/// receiving, as a bar and as its rate.
function Share({ rates }: { rates: readonly LiveRate[] }) {
  const { t, language } = usePreferences();
  const bySocket = THROUGHPUT_SOCKETS.map(
    (socket) =>
      [
        socket,
        liveTotals(rates.filter((rate) => rate.socket === socket)).sent,
      ] as const,
  );
  return (
    <figure className="al-sharefigure">
      <figcaption className="al-small">{t("throughput.share")}</figcaption>
      <div className="al-share" aria-hidden="true">
        {bySocket.map(([socket, rate]) => (
          <i key={socket} style={{ flex: rate } as CSSProperties} />
        ))}
      </div>
      <div className="al-sharekey">
        {bySocket.map(([socket, rate]) => (
          <span key={socket}>
            <span>{t(SOCKET_WORD[socket])}</span>{" "}
            <b>{formatRate(rate, language)}</b>
          </span>
        ))}
      </div>
    </figure>
  );
}

/// What the meter reads, and reads again: the recorded rows of the range, the rate
/// right now, and the seconds kept of it.
function useReadings(
  range: ThroughputRange,
  paused: boolean,
  onUnauthorized: () => void,
) {
  const [report, setReport] = useState<ThroughputReport | null>(null);
  const [live, setLive] = useState<ThroughputLive | null>(null);
  const [history, setHistory] = useState<readonly ThroughputLive[]>([]);
  // The gateway's second a sampled trace ends at, moved on by every poll's outcome.
  const [now, setNow] = useState<number | null>(null);
  const anchor = useRef<{ at: number; wall: number } | null>(null);
  const [error, setError] = useState<Fault | null>(null);
  const sampled = throughputRangeIsLive(range);
  // The range whose rows are on screen, so that pausing reads nothing more.
  const shown = useRef<string | null>(null);

  // The recorded rows of a range longer than the seconds kept, read when it is chosen
  // and again as each timeframe closes, one read out at a time. A failed read leaves
  // nothing of the range on screen and is tried again.
  useEffect(() => {
    if (sampled) {
      return;
    }
    const key = throughputRangeKey(range);
    if (paused && shown.current === key) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      const result = await fetchThroughput(throughputBounds(range));
      if (cancelled) {
        return;
      }
      let again = RECORDED_PERIOD_SECS;
      if (result.kind === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (result.kind === "error") {
        shown.current = null;
        setReport(null);
        setError(result.fault);
      } else {
        shown.current = key;
        setError(null);
        setReport(result.report);
        again = readAgainSecs(result.report);
      }
      if (!paused) {
        timer = setTimeout(() => void read(), again * 1000);
      }
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [range, sampled, paused, onUnauthorized]);

  // The rate right now, once a second while the meter is open and not paused, one
  // read out at a time: a tick while one is still out is skipped, so an answer never
  // lands after a later one. A read that fails shows nothing rather than a stale
  // number, and the clock moves on without a sample, which the trace draws as a gap;
  // the next second tries again. The seconds behind the first sample — before the
  // meter opened, or while it was paused — are read once from the recorded rows,
  // after that sample, so the trace opens on the range rather than on the second it
  // was opened in.
  useEffect(() => {
    if (paused) {
      return;
    }
    let cancelled = false;
    let reading = false;
    let seeding: "due" | "out" | "done" = "due";
    const seed = async () => {
      if (seeding !== "due") {
        return;
      }
      seeding = "out";
      const result = await fetchThroughput({
        within: LIVE_HISTORY_SECS,
        end: null,
      });
      if (cancelled) {
        return;
      }
      if (result.kind === "unauthorized") {
        onUnauthorized();
      } else if (result.kind === "ok") {
        seeding = "done";
        setHistory((kept) => seedLive(kept, result.report));
      } else {
        seeding = "due";
      }
    };
    const read = async () => {
      if (reading) {
        return;
      }
      reading = true;
      const result = await fetchThroughputLive();
      reading = false;
      if (cancelled) {
        return;
      }
      if (result.kind === "unauthorized") {
        onUnauthorized();
      } else if (result.kind === "ok") {
        anchor.current = { at: result.live.at, wall: Date.now() };
        setNow(result.live.at);
        setLive(result.live);
        setHistory((kept) => appendLive(kept, result.live));
        void seed();
      } else {
        setNow(clockNow(anchor.current, Date.now()));
        setLive(null);
      }
    };
    void read();
    const timer = setInterval(() => void read(), LIVE_PERIOD_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [paused, onUnauthorized]);

  // The previous range's rows are not the next range's, even while it loads.
  const forget = useCallback(() => {
    shown.current = null;
    setReport(null);
    setError(null);
  }, []);

  return { report, live, history, now, error, forget };
}

/// The two traces under one cursor: a pointer over either, or the arrow keys, walks
/// the time, and the readings, the tooltip and the table follow it.
function Traces({
  series,
  rates,
  relative,
  between,
}: {
  series: ThroughputSeries;
  /// The rate right now in each direction, as this browser sees it.
  rates: { received: number; sent: number } | null;
  /// The range ends now, so an instant is how long ago it was.
  relative: boolean;
  /// A range between two times, by its two ends; null for one that ends now.
  between: { from: number; to: number } | null;
}) {
  const { t, language } = usePreferences();
  const box = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const count = series.received.points.length;
  // A series of another length may replace this one under a resting cursor.
  const pointed = cursor !== null && cursor < count ? cursor : null;
  const { stepSecs, spanSecs, end } = series;

  // What an instant `ago` seconds before the trace's end is called: how long ago,
  // on a range that ends now and is drawn a second a point; otherwise the time.
  const instant = (ago: number): string => {
    if (stepSecs === 1 && relative) {
      return ago === 0
        ? t("throughput.now")
        : t("throughput.axis.ago", { span: spanLabel(ago, language) });
    }
    return end === null
      ? ""
      : timeLabel(
          end - Math.min(ago + stepSecs, spanSecs),
          spanSecs > 86_400,
          language,
        );
  };
  const agoOf = (index: number) => (count - 1 - index) * stepSecs;

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const area = event.currentTarget.getBoundingClientRect();
    setCursor(pointedIndex(event.clientX - area.left, count, area.width));
  };
  const walk = (event: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (event.key === "Escape") {
      setCursor(null);
    } else if (step !== undefined) {
      setCursor((was) =>
        Math.max(0, Math.min(count - 1, (was ?? count - 1) + step)),
      );
      event.preventDefault();
    }
  };

  const when = pointed === null ? instant(0) : instant(agoOf(pointed));
  // A point that is an average over a span of time says so beside the scale.
  const note =
    stepSecs > 1 && end !== null
      ? t("throughput.averages", { span: spanLabel(stepSecs, language) })
      : "";
  const ago = (secs: number) =>
    t("throughput.axis.ago", { span: spanLabel(secs, language) });
  // A range between two times stands at the times; the rest at how far back they reach.
  const axis = between
    ? [
        timeLabel(between.from, true, language),
        timeLabel((between.from + between.to) / 2, true, language),
        timeLabel(end ?? between.to, true, language),
      ]
    : [
        spanSecs > 0 ? ago(spanSecs) : t("throughput.axis.first"),
        spanSecs > 0 ? ago(spanSecs / 2) : "",
        t("throughput.axis.now"),
      ];
  const newest = Array.from(
    { length: Math.min(TABLE_ROWS, count) },
    (_, row) => count - 1 - row,
  );
  const said = (value: number | null | undefined) =>
    value === null || value === undefined
      ? t("throughput.unread")
      : formatRate(value, language);

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset draws a border and a legend, and this is two traces read as one */}
      <div
        ref={box}
        className="al-meter"
        role="group"
        aria-label={t("throughput.chart")}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys walk the time along the traces, which need the focus for it
        tabIndex={0}
        onPointerMove={point}
        onPointerLeave={() => setCursor(null)}
        onKeyDown={walk}
      >
        {pointed !== null && (
          <div
            className="al-tip"
            style={{
              left: `${tipLeft(pointed, count, box.current?.clientWidth ?? 0)}px`,
            }}
          >
            {when}
          </div>
        )}
        <Trace
          direction="received"
          series={series.received}
          now={rates?.received ?? null}
          pointed={pointed}
          when={when}
          note={note}
        />
        <Trace
          direction="sent"
          series={series.sent}
          now={rates?.sent ?? null}
          pointed={pointed}
          when={when}
          note={note}
        />
        <div className="al-axis al-small" aria-hidden="true">
          {axis.map((at, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the start, the middle and the end, in that order
            <span key={index}>{at}</span>
          ))}
        </div>
      </div>
      <details className="al-details">
        <summary>
          <Glyph name="chevron-right" />
          <span>{t("throughput.table")}</span>
        </summary>
        <dl className="al-dl al-detailbody">
          {newest.map((index) => (
            <Fragment key={index}>
              <dt>{instant(agoOf(index))}</dt>
              <dd>
                ↓ {said(series.received.points[index])} · ↑{" "}
                {said(series.sent.points[index])}
              </dd>
            </Fragment>
          ))}
        </dl>
      </details>
    </>
  );
}

export default function ThroughputPanel({
  variant,
  onClose,
  onUnauthorized,
}: {
  /// A sheet of its own on the page it opened from the list, or a sheet of glass
  /// hanging from a session's bar, which has a way out of its own.
  variant: "page" | "sheet";
  /// Closes the sheet: back to the information it was opened from.
  onClose?: () => void;
  onUnauthorized: () => void;
}) {
  const { t, message } = usePreferences();
  const [range, setRange] = useState<ThroughputRange>(DEFAULT_THROUGHPUT_RANGE);
  const [paused, setPaused] = useState(false);
  const [targetFilter, setTargetFilter] = useState("all");
  const [socketFilter, setSocketFilter] = useState<ThroughputSocket | "all">(
    "all",
  );
  const { report, live, history, now, error, forget } = useReadings(
    range,
    paused,
    onUnauthorized,
  );

  const changeRange = (next: ThroughputRange) => {
    forget();
    setRange(next);
  };

  // The computers to choose from: those the seconds kept or the range's rows saw
  // moving. A filter on one neither knows falls back to every computer rather than
  // sitting on an option the select no longer has.
  const targets = new Map<string, string | null>();
  for (const target of throughputTargets(
    history,
    report ? [...report.records, ...report.open] : [],
  )) {
    targets.set(targetKey(target), target);
  }
  const selected = targets.has(targetFilter) ? targetFilter : "all";
  const ofTarget = (source: ThroughputSource) =>
    selected === "all" || targetKey(source.target) === selected;
  const keep = (source: ThroughputSource) =>
    ofTarget(source) &&
    (socketFilter === "all" || source.socket === socketFilter);

  // The gateway's "sent" is what it wrote to this browser, and its "received" what
  // it read from it: said here from the browser's end, the other way about.
  const counted = seriesOf(range, { report, history, now }, keep);
  const series: ThroughputSeries = {
    ...counted,
    received: counted.sent,
    sent: counted.received,
  };
  const totals = live === null ? null : liveTotals(live.rates.filter(keep));

  const pause = (
    <button
      type="button"
      className="al-btn"
      onClick={() => setPaused((was) => !was)}
    >
      <Glyph name={paused ? "play" : "pause"} />
      <span>{t(paused ? "throughput.resume" : "throughput.pause")}</span>
    </button>
  );
  const body = (
    <>
      <p>{message("AL-6500")}</p>
      <RangeControls
        range={range}
        now={now}
        onChange={changeRange}
        select={(period) => (
          <div className="al-trio">
            <select
              className="al-select"
              aria-label={t("throughput.computer")}
              value={selected}
              onChange={(e) => setTargetFilter(e.target.value)}
            >
              <option value="all">{t("throughput.all")}</option>
              {[...targets].map(([key, target]) => (
                <option key={key} value={key}>
                  {target ?? t("throughput.picker")}
                </option>
              ))}
            </select>
            <select
              className="al-select"
              aria-label={t("throughput.socket")}
              value={socketFilter}
              onChange={(e) =>
                setSocketFilter(e.target.value as ThroughputSocket | "all")
              }
            >
              <option value="all">{t("throughput.allsockets")}</option>
              {THROUGHPUT_SOCKETS.map((socket) => (
                <option key={socket} value={socket}>
                  {t(SOCKET_WORD[socket])}
                </option>
              ))}
            </select>
            {period}
          </div>
        )}
      />
      {error && (
        <Message place="AL-6600" cause={error.code} fill={error.fill} />
      )}
      <Traces
        series={series}
        rates={
          totals === null
            ? null
            : { received: totals.sent, sent: totals.received }
        }
        relative={!isThroughputWindow(range)}
        between={isThroughputWindow(range) ? range : null}
      />
      {live !== null && <Share rates={live.rates.filter(ofTarget)} />}
    </>
  );

  if (variant === "sheet") {
    return (
      <Sheet
        title={t("throughput.title")}
        kind="wide"
        acts={pause}
        onClose={onClose ?? (() => {})}
      >
        {body}
      </Sheet>
    );
  }
  return (
    <div className="al-sheet">
      <div className="al-panelhead">
        <h1 className="al-name al-metertitle">{t("throughput.title")}</h1>
        <span className="al-acts">{pause}</span>
      </div>
      {body}
    </div>
  );
}
