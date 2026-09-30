// What an `egfx_passthrough` target puts on the session socket, and what the page
// says it did with it: an RDP host's graphics pipeline, passed for the browser to
// compose, where every other target's picture is a video stream.
//
// Everything asserted is decided by the system and not by a machine's timing: the
// render the gateway resolved, the order of `graphicsStart` and the records behind
// it, the records' own framing, the acknowledgment the page sends once its paint
// worker has composed a batch, and the DOM's account of a compositor that refused
// what it was fed and of the canvas the picture is shown on. Nothing here looks at
// a pixel. A GRAPHICS record is a header this
// file parses for itself, and what is inside one is the host's.
//
// It needs a gateway whose local config names a live RDP host with the key. Keep
// that gitignored file under `tmp/`, for example `tmp/qa_egfx.toml`:
//
//     cargo run -- serve --config tmp/qa_egfx.toml
//
//     REMOTEX_PLAYWRIGHT_BASE_URL=http://127.0.0.1:52890/ \
//     REMOTEX_PLAYWRIGHT_USERNAME=admin \
//     REMOTEX_PLAYWRIGHT_PASSWORD=… \
//     REMOTEX_PLAYWRIGHT_EGFX_TARGET=win \
//     bunx playwright test '/egfx-passthrough\.spec\.ts$'
import { expect, type Page, test } from "@playwright/test";

import { leaveSession, logInAndConnectTo, returnToPicker } from "./support";

/// The opt-in, and the target name in one, as the video spec has it.
const EGFX_TARGET = process.env.REMOTEX_PLAYWRIGHT_EGFX_TARGET;

/// The wire, copied from src/protocol.rs rather than imported from the SPA.
const BATCH_FRAME_KIND = 0x02;
const BATCH_HEADER_LEN = 8;
const OP_GRAPHICS = 0x04;
const GRAPHICS_HEADER_LEN = 5;
/// `RDPGFX_HEADER`, [MS-RDPEGFX] 2.2.1.5: the command, its flags, the PDU's length.
const RDPGFX_HEADER_LEN = 8;

interface Batch {
  flags: number;
  count: number;
  sequence: number;
  /** Each record's commands' length. */
  runs: number[];
  /** Whether the records exactly filled the frame. */
  exact: boolean;
  /** The first record op this parser did not recognize, if any. */
  badOp?: number;
  /** Whether every run was whole commands, by the headers' own lengths. */
  whole: boolean;
}

/// Whether `run` is whole PDUs end to end: each header's length taken at its word.
function wholeCommands(run: Buffer): boolean {
  let at = 0;
  while (at < run.length) {
    if (at + RDPGFX_HEADER_LEN > run.length) {
      return false;
    }
    const length = run.readUInt32LE(at + 4);
    if (length < RDPGFX_HEADER_LEN) {
      return false;
    }
    at += length;
  }
  return at === run.length;
}

function parseBatch(payload: Buffer): Batch {
  const count = payload.readUInt16LE(2);
  const runs: number[] = [];
  let at = BATCH_HEADER_LEN;
  let exact = true;
  let whole = true;
  let badOp: number | undefined;
  while (at < payload.length) {
    const op = payload.readUInt8(at);
    if (op !== OP_GRAPHICS) {
      badOp = op;
      exact = false;
      break;
    }
    if (at + GRAPHICS_HEADER_LEN > payload.length) {
      exact = false;
      break;
    }
    const length = payload.readUInt32LE(at + 1);
    const start = at + GRAPHICS_HEADER_LEN;
    if (start + length > payload.length) {
      exact = false;
      break;
    }
    whole &&= wholeCommands(payload.subarray(start, start + length));
    runs.push(length);
    at = start + length;
  }
  return {
    flags: payload.readUInt8(1),
    count,
    sequence: payload.readUInt32LE(4),
    runs,
    exact: exact && at === payload.length,
    badOp,
    whole,
  };
}

interface Session {
  /** Every control message's `type`, in arrival order. */
  controlTypes: string[];
  connected?: { render: string };
  batches: Batch[];
  /** Binary frames that were not batches. */
  badKinds: number[];
  /**
   * Runs that arrived on a session before its own `graphicsStart` said a pipeline
   * had begun. Counted over every session watched.
   */
  unannounced: number;
  /** The sequences the page acknowledged, as it sent them. */
  acknowledged: number[];
}

/// Watch the session socket. Registered before navigation, so nothing is missed.
function watchSession(page: Page): Session {
  const seen: Session = {
    controlTypes: [],
    batches: [],
    badKinds: [],
    unannounced: 0,
    acknowledged: [],
  };
  page.on("websocket", (ws) => {
    if (new URL(ws.url()).pathname !== "/ws") {
      return;
    }
    // Whether this session's pipeline has been announced: a socket's own, and a
    // session's own on it, so the one before cannot answer for the one after.
    let started = false;
    ws.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") {
        return;
      }
      const message = JSON.parse(payload);
      if (message.type === "paintAck") {
        seen.acknowledged.push(message.sequence);
      }
    });
    const control = (text: string) => {
      const message = JSON.parse(text);
      if (typeof message.type !== "string") {
        return;
      }
      seen.controlTypes.push(message.type);
      if (message.type === "connected") {
        seen.connected = { render: message.render };
        // A session that starts is a socket's count starting over.
        seen.batches = [];
        seen.acknowledged = [];
        started = false;
      } else if (message.type === "graphicsStart") {
        started = true;
      }
    };
    ws.on("framereceived", ({ payload }) => {
      if (typeof payload === "string") {
        control(payload);
        return;
      }
      const kind = payload.readUInt8(0);
      if (kind !== BATCH_FRAME_KIND) {
        seen.badKinds.push(kind);
        return;
      }
      const batch = parseBatch(payload);
      if (!started) {
        seen.unannounced += batch.runs.length;
      }
      seen.batches.push(batch);
    });
  });
  return seen;
}

const runs = (seen: Session): number[] => seen.batches.flatMap((b) => b.runs);

test.describe("a target that passes its graphics pipeline", () => {
  test.skip(
    !EGFX_TARGET,
    "set REMOTEX_PLAYWRIGHT_EGFX_TARGET=<target> against a gateway with a live RDP host and egfx_passthrough",
  );

  // Cleanup, so it runs even when an assertion above threw: see `leaveSession`.
  test.afterEach(async ({ page }) => {
    await leaveSession(page);
  });

  test("is sent the host's commands, and composes every batch of them", async ({
    page,
  }) => {
    const seen = watchSession(page);
    await logInAndConnectTo(page, EGFX_TARGET ?? "");

    await expect
      .poll(() => runs(seen).length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    // Composed, and not merely received: the acknowledgment is sent when the paint
    // worker has finished a batch.
    await expect
      .poll(() => seen.acknowledged.length, { timeout: 20_000 })
      .toBeGreaterThan(0);

    expect(seen.connected?.render).toBe(
      "the host's graphics pipeline, passed through",
    );
    expect(seen.badKinds, "binary frames that were not batches").toEqual([]);
    expect(
      seen.unannounced,
      "runs that arrived before their session's graphicsStart",
    ).toBe(0);
    expect(
      seen.controlTypes,
      "a passed pipeline is no video stream",
    ).not.toContain("videoFormat");
    expect(
      seen.controlTypes.indexOf("resize"),
      "the desktop's size is announced ahead of the pipeline that draws it",
    ).toBeLessThan(seen.controlTypes.indexOf("graphicsStart"));

    for (const batch of seen.batches) {
      expect(batch.flags, "reserved frame flags must be zero").toBe(0);
      expect(batch.badOp, "every record must be a GRAPHICS record").toBe(
        undefined,
      );
      expect(batch.exact, "records must exactly fill the frame").toBe(true);
      expect(
        batch.runs.length,
        "the header's record count must match the records present",
      ).toBe(batch.count);
      expect(batch.whole, "a run is whole commands, never part of one").toBe(
        true,
      );
    }
    for (const length of runs(seen)) {
      expect(length).toBeGreaterThan(0);
    }
    // Acknowledged in the order they were sent, none twice and none invented.
    const sent = seen.batches.map((batch) => batch.sequence);
    expect(sent).toEqual(sent.map((_, index) => index + 1));
    expect(seen.acknowledged).toEqual(
      seen.acknowledged.map((_, index) => index + 1),
    );
    expect(Math.max(...seen.acknowledged)).toBeLessThanOrEqual(
      Math.max(...sent),
    );

    // A compositor that refused a command says so where the desktop is.
    await expect(page.getByRole("alert")).toHaveCount(0);

    // The pipeline's picture is drawn on a canvas of its own, which the page
    // shows once the paint worker says a run has been drawn on it. A canvas has
    // no role to be found by: it is the one laid over the desktop's.
    await expect(page.locator("canvas.graphics")).toBeVisible();

    // And the session card says which of the two this browser is doing.
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "Info", exact: true }).click();
    const card = page.getByRole("dialog", { name: "Info" });
    await expect(card).toContainText("composed by this browser");
    await expect(card).toContainText(
      "the host's graphics pipeline, passed through",
    );
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  });

  test("starts the pipeline over for a page that comes back", async ({
    page,
  }) => {
    const seen = watchSession(page);
    await logInAndConnectTo(page, EGFX_TARGET ?? "");
    await expect
      .poll(() => seen.acknowledged.length, { timeout: 20_000 })
      .toBeGreaterThan(0);

    // The page that comes back holds nothing the host draws against, so what it is
    // given is a session from its first command: connected, and a pipeline that
    // starts, with nothing resumed in between.
    const before = seen.controlTypes.length;
    await page.reload();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(() => seen.acknowledged.length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    const after = seen.controlTypes.slice(before);
    expect(after).toContain("connected");
    expect(after).toContain("graphicsStart");
    expect(
      seen.unannounced,
      "runs that arrived before their session's graphicsStart",
    ).toBe(0);
    expect(seen.batches[0]?.sequence).toBe(1);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("canvas.graphics")).toBeVisible();

    await returnToPicker(page);
  });
});
