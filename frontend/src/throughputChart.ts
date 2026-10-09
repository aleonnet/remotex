// The geometry of one direction of the meter: the points of a range as the paths
// of an SVG, an area under a line, four grid lines, a dashed line across the
// range's average rate, and a gap where a point was not read. What they are drawn
// with — the colours of the tokens, the area in lit cells — is the stylesheet's
// and the panel's (ThroughputPanel.tsx, alumia.css); this is where things are.
//
// The drawing is in a box of its own units, stretched to whatever room the page
// gives it, so nothing here asks the page how wide it is.

/** The box the trace is drawn in, in its own units. */
export const VIEW = { width: 640, height: 150 };

/** Room kept above the highest point and under the lowest, in the same units. */
const PAD = 6;

/** The runs of read seconds in `points`, each as `[from, to)`. */
export function runs(points: readonly (number | null)[]): [number, number][] {
  const found: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= points.length; i++) {
    const read = i < points.length && points[i] !== null;
    if (read && start < 0) {
      start = i;
    } else if (!read && start >= 0) {
      found.push([start, i]);
      start = -1;
    }
  }
  return found;
}

/** The x of the point at `index` of `count`, across the box. */
export function chartX(index: number, count: number): number {
  return count > 1 ? (index / (count - 1)) * VIEW.width : 0;
}

/** The y of `value` on a scale that tops out at `top`. */
export function chartY(value: number, top: number): number {
  const room = VIEW.height - PAD * 2;
  return VIEW.height - PAD - (top > 0 ? value / top : 0) * room;
}

/** What is drawn of one direction, as path data and positions in the box. */
export interface ChartShape {
  /** The four grid lines' y, lowest first. */
  grid: number[];
  /** One closed area per run of read points. */
  areas: string[];
  /** One line per run, over its area. */
  lines: string[];
  /**
   * The y of the range's average rate, or null where nothing moved: a line at
   * zero would only trace the axis. It is the average and not the peak so that
   * one busy second marks the graph as the outlier it is rather than setting its
   * line; the peak is said in words beside the graph.
   */
  mean: number | null;
}

const at = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/**
 * The shape of `points`, oldest first, on a scale that tops out at `top`, with
 * the average `mean`. A point that was not read is a gap, not a zero.
 */
export function chartShape(
  points: readonly (number | null)[],
  top: number,
  mean: number,
): ChartShape {
  const floor = chartY(0, top);
  const areas: string[] = [];
  const lines: string[] = [];
  for (const [from, to] of runs(points)) {
    const trace = [];
    for (let i = from; i < to; i++) {
      trace.push(
        at(chartX(i, points.length), chartY(points[i] as number, top)),
      );
    }
    const first = chartX(from, points.length).toFixed(1);
    const last = chartX(to - 1, points.length).toFixed(1);
    areas.push(
      `M${first} ${floor.toFixed(1)} L${trace.join(" L")} L${last} ${floor.toFixed(1)} Z`,
    );
    lines.push(`M${trace.join(" L")}`);
  }
  return {
    grid: [0.25, 0.5, 0.75, 1].map((share) => chartY(top * share, top)),
    areas,
    lines,
    mean: mean > 0 ? chartY(mean, top) : null,
  };
}

/** The point under a pointer `px` from the plot's left edge: the nearest, never beside it. */
export function pointedIndex(px: number, count: number, width: number): number {
  if (count < 2 || width <= 0) {
    return 0;
  }
  const index = Math.round((px / width) * (count - 1));
  return Math.max(0, Math.min(count - 1, index));
}

/**
 * Where the tooltip for the point at `index` sits, in pixels from the plot's
 * left: over it, kept inside the plot, `half` being the room each side of its
 * middle its text takes.
 */
export function tipLeft(
  index: number,
  count: number,
  width: number,
  half = 34,
): number {
  const over = count > 1 ? (index / (count - 1)) * width : 0;
  return Math.max(half, Math.min(width - half, over));
}
