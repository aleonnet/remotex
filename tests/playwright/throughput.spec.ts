// The meter: a page from the list of computers, and a sheet of glass from a
// session.
//
// The gateway's test harness keeps no meter, so the spec says the gateway's three
// answers in its place: that there is one (`/api/config`), the rate right now
// (`/api/throughput/live`), and the recorded rows (`/api/throughput`). What is
// asserted is what the page does with them: the numbers as throughput.ts writes
// them, said from this browser's end; that Pause reads nothing more; that a
// typed period is asked for on Apply and not before; what a failed read says.
// Nothing here looks at the traces.
//
//     ALUMIA_PAGE_SPECS=throughput bash tools/run-page-tests.sh
import { expect, type Page, test } from "@playwright/test";

import {
  computerRow,
  handle,
  LIST_TITLE,
  leaveSession,
  logIn,
  logInSpeaking,
  openBar,
  SESSION_TIMEOUT_MS,
  withFingers,
} from "./support";

const TARGET = process.env.ALUMIA_PLAYWRIGHT_PICKER_TARGET;
test.skip(!TARGET, "set ALUMIA_PLAYWRIGHT_PICKER_TARGET");
const target = TARGET ?? "";

test.afterEach(async ({ page }) => {
  await leaveSession(page);
});

// What the gateway is said to answer, and what the page asked of it.
interface Meter {
  /** The rates the next live read answers with, in bytes per second as the gateway counts them. */
  rates: { socket: string; sentPerSec: number; receivedPerSec: number }[];
  /** The status the recorded rows answer with. */
  recorded: number;
  /** Every read of the rate right now. */
  live: number;
  /** The query of every read of the recorded rows. */
  asked: string[];
}

// The screen's socket and the sound's: 1.2 Mb/s and 20 kb/s as this browser
// counts them, of which the sound is 200 kb/s received.
const BUSY = [
  { socket: "session", sentPerSec: 125_000, receivedPerSec: 2_500 },
  { socket: "audio", sentPerSec: 25_000, receivedPerSec: 0 },
];

// Stand in for the gateway's meter. Asked for before the page is opened.
async function stageMeter(page: Page): Promise<Meter> {
  const meter: Meter = { rates: BUSY, recorded: 200, live: 0, asked: [] };
  const now = () => Math.floor(Date.now() / 1000);
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), throughput: true },
    });
  });
  await page.route("**/api/throughput/live", (route) => {
    meter.live += 1;
    return route.fulfill({
      json: {
        at: now(),
        rates: meter.rates.map((rate) => ({ target, ...rate })),
      },
    });
  });
  await page.route(/\/api\/throughput(\?.*)?$/, (route) => {
    meter.asked.push(new URL(route.request().url()).search);
    if (meter.recorded !== 200) {
      return route.fulfill({ status: meter.recorded, body: "no" });
    }
    return route.fulfill({
      json: {
        now: now(),
        intervalSecs: 60,
        maxRecords: 1000,
        hasSeconds: false,
        records: [],
        open: [],
      },
    });
  });
  return meter;
}

// A direction's trace, by the name on it.
const trace = (page: Page, direction: "Received" | "Sent") =>
  page.getByRole("figure").filter({ hasText: direction });

test("from the list, the meter is a page that says the rates from this browser's end, by connection", async ({
  page,
}) => {
  await stageMeter(page);
  await logIn(page);
  await page.getByRole("button", { name: "Throughput" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Throughput");
  await expect(page.getByRole("heading", { name: LIST_TITLE })).toHaveCount(0);
  await expect(
    page.getByText(
      "The rate between this browser and the server, per computer and per connection, in bits per second, sampled by the server once a second.",
    ),
  ).toBeVisible();
  // What the gateway sent is what this browser received, and the other way about.
  await expect(trace(page, "Received")).toContainText("1.2 Mb/s");
  await expect(trace(page, "Received")).toContainText("now");
  await expect(trace(page, "Sent")).toContainText("20 kb/s");

  // One connection alone.
  await page.getByLabel("Connection").selectOption({ label: "Sound" });
  await expect(trace(page, "Received")).toContainText("200 kb/s");
  await expect(trace(page, "Sent")).toContainText("0 b/s");
  await expect(page.getByLabel("Computer").getByRole("option")).toHaveText([
    "All computers",
    target,
  ]);

  // The newest points, in words, for whoever does not read a trace.
  await page.getByLabel("Connection").selectOption({ label: "All connections" });
  await page.getByText("See as a table").click();
  await expect(page.getByRole("definition").first()).toHaveText(
    "↓ 1.2 Mb/s · ↑ 20 kb/s",
  );

  await page.getByRole("button", { name: "Back to the computers" }).click();
  await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
});

test("Pause reads nothing more and keeps what is on screen, until Resume", async ({
  page,
}) => {
  const meter = await stageMeter(page);
  // The page's own clock, so that its seconds pass when the spec says.
  await page.clock.install();
  await logIn(page);
  await page.getByRole("button", { name: "Throughput" }).click();
  await expect(trace(page, "Received")).toContainText("1.2 Mb/s");

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  const read = meter.live;
  meter.rates = [{ socket: "session", sentPerSec: 500_000, receivedPerSec: 0 }];
  await page.clock.runFor(5000);
  expect(meter.live).toBe(read);
  await expect(trace(page, "Received")).toContainText("1.2 Mb/s");

  await page.getByRole("button", { name: "Resume" }).click();
  await page.clock.runFor(2000);
  await expect(trace(page, "Received")).toContainText("4.0 Mb/s");
  expect(meter.live).toBeGreaterThan(read);
});

test("a typed period is asked for on Apply, not as it is typed, and a failed read says why", async ({
  page,
}) => {
  const meter = await stageMeter(page);
  await logIn(page);
  await page.getByRole("button", { name: "Throughput" }).click();
  await expect(trace(page, "Received")).toContainText("1.2 Mb/s");

  await page.getByLabel("Period").selectOption({ label: "Custom…" });
  await page.getByLabel("Length").fill("2");
  await page.getByLabel("Unit").selectOption({ label: "hours" });
  // Two hours, typed and not applied: nothing was asked for them.
  expect(meter.asked.filter((query) => query.includes("7200"))).toEqual([]);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect
    .poll(() => meter.asked.filter((query) => query.includes("7200")))
    .toEqual(["?within=7200"]);
  // Applied, there is nothing more to apply.
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // A read the gateway refuses says its answer, with the code.
  meter.recorded = 500;
  await page.getByLabel("Length").fill("3");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not load the throughput (answer 500). If it goes on, look at the server's log. AL-6602",
  );
  // And a gateway that keeps no meter says that.
  meter.recorded = 404;
  await page.getByLabel("Length").fill("4");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This server is not recording throughput. AL-6601",
  );
});

test("from a session, the meter hangs from the bar over a view-only remote, and closes back to the information", async ({
  page,
}) => {
  await stageMeter(page);
  await logIn(page);
  await computerRow(page, target).getByRole("button", { name: /^Open / }).click();
  await expect(handle(page)).toBeVisible({ timeout: SESSION_TIMEOUT_MS });

  const bar = await openBar(page);
  await bar.getByRole("button", { name: "More" }).click();
  await page
    .getByRole("dialog", { name: "More" })
    .getByRole("button", { name: "Information" })
    .click();
  await page
    .getByRole("dialog", { name: "Information" })
    .getByRole("button", { name: "Throughput" })
    .click();

  const sheet = page.getByRole("dialog", { name: "Throughput" });
  await expect(sheet.getByRole("figure").filter({ hasText: "Received" })).toContainText(
    "1.2 Mb/s",
  );
  await expect(sheet.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(
    page.getByText("The remote screen is view only while the throughput is open."),
  ).toBeVisible();
  // It is the session's still: no list, no page of its own.
  await expect(page.getByRole("heading", { name: LIST_TITLE })).toHaveCount(0);
  await expect(bar).toBeVisible();

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Information" })).toBeVisible();
  await expect(bar).toBeVisible();
});

// The windows the mockup is drawn in; the first three are devices with fingers.
const WINDOWS = [
  { width: 390, height: 844, touch: true },
  { width: 860, height: 412, touch: true },
  { width: 820, height: 1180, touch: true },
  { width: 1440, height: 900, touch: false },
];

for (const [locale, title] of [
  ["en-US", "Throughput"],
  ["pt-BR", "Vazão"],
] as const) {
  test(`the meter's page fits every window in ${locale}`, async ({ browser }) => {
    for (const size of WINDOWS) {
      const context = await browser.newContext({
        locale,
        viewport: size,
        hasTouch: size.touch,
      });
      const page = await context.newPage();
      if (size.touch) {
        await withFingers(page);
      }
      await stageMeter(page);
      await logInSpeaking(page, locale);
      await page.getByRole("button", { name: title }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByRole("figure").first()).toContainText("1,2 Mb/s".replace(",", locale === "pt-BR" ? "," : "."));
      const spill = await page.evaluate(() => {
        const scene = document.querySelector(".al-scene");
        return scene ? scene.scrollWidth - scene.clientWidth : Number.NaN;
      });
      expect(spill, `${locale} ${size.width}×${size.height}`).toBe(0);
      // Each control whole inside the window.
      for (const control of await page.getByRole("combobox").all()) {
        const box = await control.boundingBox();
        expect(
          (box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= size.width,
          `${locale} ${size.width}×${size.height}`,
        ).toBe(true);
      }
      await context.close();
    }
  });
}
