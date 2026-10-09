// What a session is started with is chosen at the list, by the keys of its
// computer's monitor, and this is the assertion that the choice is the one the
// gateway is sent, the one it reports back, and the one it holds a later browser
// to.
//
// Everything asserted is a system decision: which places of the monitor are keys
// and what each says, what `connect` carried and what `connected` answered, read
// from the session socket by this file's own parser, what the browser kept for
// the next visit, and what a browser that cannot take the session's passthrough
// is told and shown. Nothing here looks at the canvas.
//
// It needs a gateway with an `rdp` target that configures a size, the one type
// that has a size to choose, a sound to bring and a stream to pass. The tone
// harness in `src/server.rs` is one, with a scripted engine and no remote, and
// `bash tools/run-page-tests.sh` runs this against it. By hand:
//
//     cargo test --lib serve_a_test_tone -- --ignored --nocapture
//
// then, against the address it prints:
//
//     ALUMIA_PLAYWRIGHT_BASE_URL=http://127.0.0.1:PORT/ \
//     ALUMIA_PLAYWRIGHT_USERNAME=admin \
//     ALUMIA_PLAYWRIGHT_PASSWORD=hunter2 \
//     ALUMIA_PLAYWRIGHT_PICKER_TARGET=test-tone \
//     bunx playwright test '/picker-options\.spec\.ts$'
import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  computerRow,
  FOLLOWS_WINDOW,
  handle,
  LIST_TITLE,
  leaveSession,
  logIn,
  logInAndConnectTo,
  returnToPicker,
  SOUND_OFF,
  SOUND_ON,
} from "./support";

/// The opt-in, and the target name in one, as the other specs have it.
const PICKER_TARGET = process.env.ALUMIA_PLAYWRIGHT_PICKER_TARGET;

interface Choices {
  size: "target" | "default" | "window";
  audio: "off" | "opus" | "flac";
  passthrough: boolean;
}

interface Session {
  /// The `choices` of every `connect` the page sent.
  connects: Choices[];
  /// Every session status the gateway sent, in order, as it came.
  statuses: Record<string, unknown>[];
}

/// Record what the session socket carried about starting a session. Registered
/// before navigation so nothing is missed.
function watchSession(page: Page): Session {
  const seen: Session = { connects: [], statuses: [] };
  page.on("websocket", (ws) => {
    if (new URL(ws.url()).pathname !== "/ws") {
      return;
    }
    ws.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") {
        return;
      }
      const message: Record<string, unknown> = JSON.parse(payload);
      if (message.type === "connect") {
        seen.connects.push(message.choices as Choices);
      }
    });
    ws.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") {
        return;
      }
      const message: Record<string, unknown> = JSON.parse(payload);
      if (message.type === "connected") {
        seen.statuses.push(message);
      }
    });
  });
  return seen;
}

/// The keys of a line's monitor: the places with another choice behind them.
const keys = (row: Locator) => row.getByRole("group").getByRole("button");

/// A size the computer keeps, as its key says it.
const KEPT = /^\d+ × \d+$/;
const OPEN = /^Open /;

test.describe("what a session is started with", () => {
  test.skip(
    !PICKER_TARGET,
    "set ALUMIA_PLAYWRIGHT_PICKER_TARGET=<rdp target> against a gateway with one",
  );

  // Cleanup, so it runs even when an assertion above threw: see `leaveSession`.
  test.afterEach(async ({ page }) => {
    await leaveSession(page);
  });

  test("Open carries what was chosen, and the session reports it back", async ({
    page,
  }) => {
    const seen = watchSession(page);
    await logInAndConnectTo(page, PICKER_TARGET ?? "", "", { resize: true });

    expect(seen.connects).toEqual([
      { size: "window", audio: "off", passthrough: false, placement: "right" },
    ]);
    const connected = seen.statuses.at(-1);
    expect(connected).toMatchObject({
      type: "connected",
      name: PICKER_TARGET,
      resize: true,
      audio: false,
      passthrough: null,
    });
  });

  test("a line's keys say what the session will have, and are remembered for it", async ({
    page,
  }) => {
    await logInAndConnectTo(page, PICKER_TARGET ?? "", "", { sound: true });
    await returnToPicker(page);

    // An rdp target with a size configured has two keys, and what was chosen is
    // how each comes back: the size its config sets, which is the size until
    // somebody chooses the window, and the sound brought.
    const row = computerRow(page, PICKER_TARGET ?? "");
    await expect(keys(row)).toHaveCount(2);
    await expect(keys(row).nth(0)).toHaveAccessibleName(KEPT);
    await expect(keys(row).nth(1)).toHaveAccessibleName(SOUND_ON);
    await expect(row.getByRole("button", { name: OPEN })).toBeEnabled();
    // The line's tip says the same, a line a place, and nothing of a stream:
    // none is passed, and that is the ordinary case.
    await row.getByRole("group").hover();
    await expect(row.getByRole("tooltip").getByRole("paragraph")).toHaveText([
      KEPT,
      SOUND_ON,
    ]);

    // A key goes to its other choice as it is pressed.
    await keys(row).nth(0).click();
    await expect(keys(row).nth(0)).toHaveAccessibleName(FOLLOWS_WINDOW);

    // Kept by the browser, not by the page: a reload finds it as it was left.
    await page.reload();
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible({
      timeout: 20_000,
    });
    const again = computerRow(page, PICKER_TARGET ?? "");
    await expect(keys(again).nth(0)).toHaveAccessibleName(FOLLOWS_WINDOW);
    await expect(keys(again).nth(1)).toHaveAccessibleName(SOUND_ON);
    // And back: nothing is left brought for the next spec.
    await keys(again).nth(1).click();
    await expect(keys(again).nth(1)).toHaveAccessibleName(SOUND_OFF);
  });

  test("a browser that takes a session over starts at the list with its own choices", async ({
    page,
    browser,
  }) => {
    const first = watchSession(page);
    await logInAndConnectTo(page, PICKER_TARGET ?? "", "", {
      passthrough: true,
    });
    expect(first.statuses.at(-1)).toMatchObject({
      type: "connected",
      passthrough: "rdp-graphics",
    });

    // A second browser whose page is not cross-origin isolated, which is one that
    // cannot compose a passed pipeline, takes the session over.
    const context = await browser.newContext();
    try {
      await context.addInitScript(() => {
        Object.defineProperty(globalThis, "crossOriginIsolated", {
          value: false,
        });
      });
      const other = await context.newPage();
      const second = watchSession(other);
      // Its address asks for the passthrough too.
      await logIn(other, "?passthrough=1");

      // It is given neither the session nor one rebuilt without the passthrough:
      // it lands on the list, where the line says why what its address asks for
      // cannot be had here, and the computer still opens without it.
      await expect(other.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
      expect(second.statuses).toEqual([]);
      const item = computerRow(other, PICKER_TARGET ?? "");
      await item.getByRole("group").hover();
      await expect(item.getByRole("tooltip")).toContainText(
        "This browser cannot compose Windows' drawing here",
      );
      await expect(item.getByRole("button", { name: OPEN })).toBeEnabled();
    } finally {
      await context.close();
    }

    // The slot goes back to the page the cleanup knows, which the second browser
    // evicted: it lands on the list, since the takeover ended the session.
    await page.getByRole("button", { name: "Take it back" }).click();
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe("what a session is started with, on a phone", () => {
  test.skip(
    !PICKER_TARGET,
    "set ALUMIA_PLAYWRIGHT_PICKER_TARGET=<rdp target> against a gateway with one",
  );

  // A phone as the page tells one: a screen whose short side is a phone's, and,
  // set in the test, the two touch points a pinch needs.
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test.afterEach(async ({ page }) => {
    await leaveSession(page);
  });

  test("a phone is offered sizes the desktop keeps, never its window", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "maxTouchPoints", {
        get: () => 5,
      });
    });
    const seen = watchSession(page);
    await logIn(page);

    // The size the target configures, and the default behind its key: two sizes
    // the desktop keeps, and no window to follow.
    const item = computerRow(page, PICKER_TARGET ?? "");
    await expect(keys(item).nth(0)).toHaveAccessibleName(KEPT);
    await expect(keys(item).nth(0)).not.toHaveAccessibleName("1440 × 900");
    await expect(
      item.getByRole("button", { name: FOLLOWS_WINDOW }),
    ).toHaveCount(0);

    await keys(item).nth(0).click();
    await expect(keys(item).nth(0)).toHaveAccessibleName("1440 × 900");
    await item.getByRole("button", { name: OPEN }).click();
    await expect(handle(page)).toBeVisible({ timeout: 20_000 });
    expect(seen.connects.at(-1)).toMatchObject({ size: "default" });
    expect(seen.statuses.at(-1)).toMatchObject({
      type: "connected",
      resize: false,
    });
  });
});
