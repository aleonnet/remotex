// What the page shows before there is a picture: the screen that says it cannot
// start, the screen that lights while a computer is opened, and whose the session
// is when it is not this page's.
//
// Each is a decision of the page, asserted by what the page says: its headings,
// its buttons, the codes of the catalogue, and what it sends. Nothing here looks
// at the glass. The states that depend on the gateway's timing are staged: the
// spec stands in front of the gateway on the session socket (support.ts,
// `stageSession`) and holds a message back for as long as it takes to look.
//
// It runs against the gateway's own test harness, with no remote:
//
//     bash tools/run-page-tests.sh -g opening
import { type Browser, expect, type Page, test } from "@playwright/test";

import {
  BASE_URL,
  computerRow,
  fillSignIn,
  handle,
  LIST_TITLE,
  leaveSession,
  logIn,
  logInSpeaking,
  openBar,
  returnToPicker,
  SESSION_TIMEOUT_MS,
  stageSession,
  withFingers,
} from "./support";

// A session coming up, or handed back: see `SESSION_TIMEOUT_MS`.
const UP = { timeout: SESSION_TIMEOUT_MS };

const TARGET = process.env.ALUMIA_PLAYWRIGHT_PICKER_TARGET;

// The windows the mockup is drawn in: a phone upright and on its side, a tablet
// and a desktop. The first three are touch devices.
const WINDOWS = [
  { width: 390, height: 844, touch: true },
  { width: 860, height: 412, touch: true },
  { width: 820, height: 1180, touch: true },
  { width: 1440, height: 900, touch: false },
];

// How far the page's content passes its window's width: 0 where it fits.
const spill = (page: Page) =>
  page.evaluate(() => {
    const scene = document.querySelector(".al-scene");
    return scene ? scene.scrollWidth - scene.clientWidth : Number.NaN;
  });

// The requests a page makes of the gateway's API, by path.
function watchApi(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api") || path.startsWith("/ws")) {
      asked.push(path);
    }
  });
  return asked;
}

// Every value the interface's clock says of itself, from before the page runs.
// The document has no root yet when this is installed: the document itself is
// watched, and its root's attribute is found under it.
async function recordClock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = globalThis as unknown as { alClock: string[] };
    seen.alClock = [];
    new MutationObserver(() => {
      const said = document.documentElement?.dataset.alClock;
      if (said) {
        seen.alClock.push(said);
      }
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-al-clock"],
    });
  });
}

// That the clock never ran. Something said in its place is heard first, or
// hearing nothing of "running" would prove nothing.
async function expectClockNeverRan(page: Page): Promise<void> {
  const said = await page.evaluate(async () => {
    document.documentElement.dataset.alClock = "asked";
    await new Promise((heard) => setTimeout(heard, 0));
    return (globalThis as unknown as { alClock: string[] }).alClock;
  });
  expect(said.at(-1)).toBe("asked");
  expect(said).not.toContain("running");
}

const open = (page: Page, name: string) =>
  computerRow(page, name)
    .getByRole("button", { name: /^Open / })
    .click();

// The plate the screen that lights carries its words on.
const plate = (page: Page) => page.getByRole("main");

// A name that resolves to the harness and is not loopback: the browser does not
// treat it as secure, which a LAN address on plain http is not either. A launch
// option is the whole file's, and maps nothing any other test here opens.
test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP alumia.test 127.0.0.1"] },
});

test.describe("a page opened at an address that is not secure", () => {
  // The name is mapped by the launch option above, which is Chromium's: Apple's
  // engine has no such option, and the name resolves to nothing there.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "the address that is not secure is a name only Chromium's launch option maps",
  );
  const port = new URL(BASE_URL).port;
  const address = `http://alumia.test:${port}`;

  test("says it cannot start, with the address, the ways out and the code, and asks the gateway for nothing", async ({
    page,
  }) => {
    const asked = watchApi(page);
    await page.goto(`${address}/`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "No secure connection,no lit screen",
    );
    await expect(page.getByText("Opened at an address that is not secure:")).toBeVisible();
    await expect(page.getByText(address, { exact: true })).toBeVisible();
    // The catalogue's sentence is there for whoever is read the page to.
    await expect(page.getByRole("alert")).toHaveText(
      "This page only opens over a secure connection. Use the server's https address, an SSH tunnel to localhost, or http://localhost on the server's own computer.",
    );
    // Each way out says what to type, made from the address the page was opened at.
    await expect(page.getByText("Open it at the server's secure address")).toBeVisible();
    await expect(
      page.getByText(`ssh -L ${port}:127.0.0.1:${port} alumia.test`),
    ).toBeVisible();
    await expect(page.getByText(`http://localhost:${port}`)).toBeVisible();
    await expect(page.getByText("Code AL-1001")).toBeVisible();
    // No preferences on a page that will not run, and no session asked for.
    await expect(page.getByRole("button")).toHaveCount(0);
    expect(asked).toEqual([]);
  });

  test("says so in the browser's language, and fits every window", async ({
    browser,
  }) => {
    for (const locale of ["pt-BR", "en-US"]) {
      for (const size of WINDOWS) {
        const context = await browser.newContext({
          locale,
          viewport: size,
          hasTouch: size.touch,
        });
        const page = await context.newPage();
        await page.goto(`${address}/`);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          locale === "pt-BR"
            ? "Sem conexão segura,a tela não acende"
            : "No secure connection,no lit screen",
        );
        expect(await spill(page), `${locale} ${size.width}×${size.height}`).toBe(0);
        await context.close();
      }
    }
  });
});

test.describe("a browser without a decoder", () => {
  for (const [missing, named] of [
    [["VideoDecoder"], "video"],
    [["AudioDecoder"], "sound"],
    [["VideoDecoder", "AudioDecoder"], "video and sound"],
  ] as const) {
    test(`says it cannot start, and that ${named} is what it lacks`, async ({
      page,
    }) => {
      const asked = watchApi(page);
      await page.addInitScript((names) => {
        for (const name of names) {
          Object.defineProperty(globalThis, name, {
            value: undefined,
            configurable: true,
          });
        }
      }, missing);
      await page.goto(BASE_URL);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "This browsercannot light a remote screen",
      );
      await expect(page.getByRole("alert")).toHaveText(
        `This browser lacks the decoders a remote screen and its sound need (${named}). Use a recent desktop Chrome or Edge.`,
      );
      await expect(page.getByText("Chrome · Edge")).toBeVisible();
      await expect(page.getByText("Code AL-1002")).toBeVisible();
      // The address is the one thing that is fine here, and is not named.
      await expect(page.getByText(new URL(BASE_URL).host)).toHaveCount(0);
      expect(asked).toEqual([]);
    });
  }
});

test.describe("the screen that lights", () => {
  test.skip(!TARGET, "set ALUMIA_PLAYWRIGHT_PICKER_TARGET");
  const target = TARGET ?? "";

  test.afterEach(async ({ page }) => {
    await leaveSession(page);
  });

  test("Open lights the screen under the computer's name, settles at five seconds, and gives way to the session", async ({
    page,
  }) => {
    const staged = await stageSession(page);
    // The page's own clock, so the five seconds are not waited for.
    await page.clock.install();
    await logIn(page);
    // The remote's announcement of its desktop is what ends the lighting.
    staged.hold("resize");
    await open(page, target);

    await expect(plate(page).getByRole("heading")).toHaveText(target);
    await expect(plate(page).getByRole("status")).toHaveText("Connecting…");
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toHaveCount(0);
    await expect(plate(page).getByRole("button", { name: "Cancel" })).toBeVisible();

    await page.clock.fastForward(5000);
    await expect(plate(page).getByRole("status")).toHaveText(
      `Connecting to ${target}…`,
    );

    staged.release();
    await expect(handle(page)).toBeVisible(UP);
    await expect(page.getByText(`Connecting to ${target}…`)).toHaveCount(0);
    await returnToPicker(page);
  });

  test("Cancel goes back to the list, and the gateway is told to stop", async ({
    page,
  }) => {
    const staged = await stageSession(page);
    await logIn(page);
    // An Open the gateway has not answered yet.
    staged.hold("connected", "resize");
    await open(page, target);
    await expect(plate(page).getByRole("status")).toHaveText("Connecting…");

    staged.discard();
    await plate(page).getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible(UP);
    expect(staged.sent.map((message) => message.type)).toContain("disconnect");
    // And the computer opens again from there.
    await expect(
      computerRow(page, target).getByRole("button", { name: /^Open / }),
    ).toBeEnabled();
  });

  test("a Cancel the gateway never hears gives the words and Cancel back", async ({
    page,
  }) => {
    const staged = await stageSession(page);
    await logIn(page);
    // Neither the Open nor the Cancel reaches the gateway, and nothing answers.
    staged.keep("connect", "disconnect");
    await open(page, target);
    await expect(plate(page).getByRole("status")).toHaveText("Connecting…");
    const cancel = plate(page).getByRole("button", { name: "Cancel" });

    await cancel.click();
    await expect
      .poll(() => staged.sent.map((message) => message.type))
      .toContain("disconnect");
    // The screen has gone off and no list came: the plate says its words again,
    // and Cancel can be pressed again.
    await expect(page.locator(".al-plate")).not.toHaveAttribute(
      "data-al-leaving",
    );
    await expect(plate(page).getByRole("status")).toHaveText("Connecting…");
    await expect(cancel).toBeEnabled();

    // Pressed again, and answered this time.
    await cancel.click();
    staged.say({ type: "picker" });
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
    expect(
      staged.sent.filter((message) => message.type === "disconnect"),
    ).toHaveLength(2);
  });

  test("End leaves a screen that stays off until the list, and is not kept waiting by a hidden tab", async ({
    page,
  }) => {
    const staged = await stageSession(page);
    await logIn(page);
    await open(page, target);
    await expect(handle(page)).toBeVisible(UP);

    // The gateway's answer to End, held back for as long as it takes to look.
    staged.hold("picker");
    const bar = await openBar(page);
    await bar.getByRole("button", { name: "End", exact: true }).click();
    await expect
      .poll(() => staged.sent.map((message) => message.type))
      .toContain("disconnect");
    // What lies over the screen is still away: the picture and the bar do not
    // come back between the screen going off and the list.
    await expect(page.locator(".al--over")).toHaveAttribute("data-al-off");
    staged.release();
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible(UP);

    // A tab that is hidden plays nothing: End asks for the list all the same.
    await open(page, target);
    await expect(handle(page)).toBeVisible(UP);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const sentBefore = staged.sent.length;
    const again = await openBar(page);
    await again.getByRole("button", { name: "End", exact: true }).click();
    await expect
      .poll(() => staged.sent.slice(sentBefore).map((message) => message.type))
      .toContain("disconnect");
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible(UP);
  });

  test("an Open that failed and is tried again lights the screen again, and settles at its own five seconds", async ({
    page,
  }) => {
    const staged = await stageSession(page);
    await page.clock.install();
    await logIn(page);
    // The gateway never hears either Open; it is said to refuse the first.
    staged.keep("connect");
    await open(page, target);
    await expect(plate(page).getByRole("status")).toHaveText("Connecting…");
    staged.say({ type: "error", message: "the remote refused", cause: null });
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
    // Longer than the first press's five seconds, at the list.
    await page.clock.fastForward(6000);

    await page.getByRole("button", { name: "Retry" }).click();
    // Tried again from the notice: there is no monitor for the screen to grow
    // from, so it is the window at once, with no ground of the list under it.
    expect(await page.locator(".al-ground").count()).toBe(0);
    await expect(plate(page).getByRole("status")).toHaveText("Connecting…");
    await page.clock.fastForward(5000);
    await expect(plate(page).getByRole("status")).toHaveText(
      `Connecting to ${target}…`,
    );
  });

  test("a phone's whole screen, given at Open, is handed back by Cancel too", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await withFingers(page);
    const staged = await stageSession(page);
    await logIn(page);
    staged.keep("connect");
    await open(page, target);
    await expect(plate(page).getByRole("status")).toHaveText("Connecting…");
    const whole = () => page.evaluate(() => document.fullscreenElement !== null);
    await expect.poll(whole).toBe(true);

    // The gateway heard nothing, so the answer to Cancel is said in its place.
    await plate(page).getByRole("button", { name: "Cancel" }).click();
    staged.say({ type: "picker" });
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
    await expect.poll(whole).toBe(false);
    await context.close();
  });

  test("a phone says the width it shows the picture at when the session opens, and again when it is turned", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await withFingers(page);
    const staged = await stageSession(page);
    await logIn(page);
    await open(page, target);
    await expect(handle(page)).toBeVisible(UP);
    const shown = () =>
      staged.sent
        .filter((message) => message.type === "shown")
        .map((message) => message.w);
    // The window's width, at no zoom: what the picture is held to.
    await expect.poll(shown).toEqual([390]);
    // Turned on its side: the width it shows it at now, once. Out of the whole
    // screen its Open asked for first, which a window's size cannot change under.
    await page.evaluate(() => document.exitFullscreen());
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(shown).toEqual([390, 844]);
    await page.waitForTimeout(500);
    expect(shown()).toEqual([390, 844]);
    await returnToPicker(page);
    await context.close();
  });

  test("the screen grows from the monitor without a frame of the clock", async ({
    page,
  }) => {
    const staged = await stageSession(page);
    // The page's own clock, paused before Open: no frame of the interface's
    // clock comes while it stands, so what grows here grows without one.
    await page.clock.install();
    await logIn(page);
    const grows = await page.evaluate(
      () =>
        document.createElement("canvas").getContext("webgl2") !== null &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    test.skip(!grows, "this browser draws no glass, so nothing grows");
    staged.hold("resize");
    // Paused a second ahead rather than at this process's own now: the page's
    // installed clock and this one differ by a millisecond either way (measured
    // on 2026-10-08 in both engines), and a pause a millisecond in the past is
    // refused ("Cannot fast-forward to the past"); the jump fires the idle
    // list's due timers once, before Open, which is where nothing is measured.
    await page.clock.pauseAt(Date.now() + 1000);
    await open(page, target);
    // The list's ground gives way as the screen leaves the monitor: the
    // growing has begun, and no frame was waited for.
    await expect(page.locator(".al-ground")).toHaveAttribute("data-al-gone", "");
    await page.clock.resume();
    staged.release();
    await expect(handle(page)).toBeVisible(UP);
    await returnToPicker(page);
  });

  test("a session found open by a reload is waited for, not lit", async ({
    page,
  }) => {
    const staged = await stageSession(page);
    await logIn(page);
    await open(page, target);
    await expect(handle(page)).toBeVisible(UP);

    staged.hold("resize");
    await page.reload();
    await expect(plate(page).getByRole("heading")).toHaveText(target);
    await expect(plate(page).getByRole("status")).toHaveText(
      "Waiting for the remote screen…",
    );
    await expect(plate(page).getByRole("button", { name: "Cancel" })).toBeVisible();

    staged.release();
    await expect(handle(page)).toBeVisible(UP);
  });

  test("a connection that drops is reconnecting, with no Cancel to offer", async ({
    page,
  }) => {
    const staged = await stageSession(page);
    await logIn(page);
    await open(page, target);
    await expect(handle(page)).toBeVisible(UP);

    // The gateway out of reach: the session cannot be asked for again.
    await page.route("**/api/session", (route) => route.abort());
    await staged.drop();
    await expect(plate(page).getByRole("status")).toContainText("Reconnecting…");
    await expect(plate(page).getByRole("heading")).toHaveText(target);
    await expect(plate(page).getByRole("button")).toHaveCount(0);

    // Back in reach, it comes back by itself.
    await page.unroute("**/api/session");
    await expect(handle(page)).toBeVisible(UP);
  });

  test("the picture's socket let go by itself is opened again with the session's, and a computer then opens", async ({
    page,
  }) => {
    const staged = await stageSession(page);
    await logIn(page);
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
    await expect.poll(staged.displaysOpened).toBe(1);

    // Let go with the session socket left up, and no takeover to say why: a
    // page that kept waiting had no socket for a picture to arrive on, and
    // every computer it opened stayed under "Connecting…" for good.
    await staged.letDisplayGo();
    await expect.poll(staged.displaysOpened, { timeout: 15_000 }).toBe(2);
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();

    await open(page, target);
    await expect(handle(page)).toBeVisible(UP);
  });

  for (const [how, emulate] of [
    [
      "where motion is reduced",
      (page: Page) => page.emulateMedia({ reducedMotion: "reduce" }),
    ],
    [
      "without WebGL 2",
      (page: Page) =>
        page.addInitScript(() => {
          const context = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (
            this: HTMLCanvasElement,
            kind: string,
            ...rest: unknown[]
          ) {
            return kind === "webgl2"
              ? null
              : (context as (...all: unknown[]) => unknown).call(this, kind, ...rest);
          } as typeof HTMLCanvasElement.prototype.getContext;
        }),
    ],
  ] as const) {
    test(`the session opens the same ${how}, and the interface's clock never runs`, async ({
      page,
    }) => {
      await emulate(page);
      await recordClock(page);
      await logIn(page);
      await open(page, target);
      await expect(handle(page)).toBeVisible(UP);
      await returnToPicker(page);
      await expectClockNeverRan(page);
    });

    // Cancel asks for the list at once and puts the screen out meanwhile, where
    // there is something to see go out. The way back never waits on a moment,
    // played or not.
    test(`Cancel goes back to the list the same ${how}`, async ({ page }) => {
      await emulate(page);
      await recordClock(page);
      const staged = await stageSession(page);
      await logIn(page);
      staged.hold("connected", "resize");
      await open(page, target);
      await expect(plate(page).getByRole("status")).toHaveText("Connecting…");

      staged.discard();
      await plate(page).getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible(UP);
      expect(staged.sent.map((message) => message.type)).toContain("disconnect");
      await expectClockNeverRan(page);
    });
  }

  for (const locale of ["en-US", "pt-BR"]) {
    test(`fits every window in ${locale}`, async ({ browser }) => {
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
        const staged = await stageSession(page);
        await logInSpeaking(page, locale);
        // The gateway never hears this Open: the plate is what is measured, and
        // no session is left behind it for the next window to wait on.
        staged.keep("connect");
        await computerRow(page, target)
          .getByRole("button", { name: /^(Open|Abrir) / })
          .click();
        await expect(plate(page).getByRole("heading", { level: 1 })).toHaveText(
          target,
        );
        const window = `${locale} ${size.width}×${size.height}`;
        expect(await spill(page), window).toBe(0);
        // The plate whole inside the window: its heading, its words and Cancel.
        for (const part of [
          plate(page).getByRole("heading", { level: 1 }),
          plate(page).getByRole("status"),
          plate(page).getByRole("button"),
        ]) {
          const box = await part.boundingBox();
          expect(box && box.x >= 0, window).toBe(true);
          expect(box && box.x + box.width <= size.width, window).toBe(true);
          expect(box && box.y + box.height <= size.height, window).toBe(true);
        }
        await context.close();
      }
    });
  }
});

// A second browser, signed in, holding the session.
async function holder(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page);
  return page;
}

test.describe("whose the session is", () => {
  test.skip(!TARGET, "set ALUMIA_PLAYWRIGHT_PICKER_TARGET");

  test.afterEach(async ({ page }) => {
    await leaveSession(page);
  });

  test("a session in use says so, and is taken over only after asking", async ({
    page,
    browser,
  }) => {
    const other = await holder(browser);
    await fillSignIn(page);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // The page does not know which computer the other browser has open: the
    // plate is under the gateway's own name.
    await expect(plate(page)).toHaveAccessibleName("Session in use in another browser.");
    await expect(plate(page).getByRole("alert")).toHaveText(
      "This computer is open in another browser. AL-3300",
    );
    await expect(plate(page).getByRole("button", { name: "Sign out" })).toBeVisible();

    // Taking it asks first, and Escape is Cancel: the other browser keeps it.
    await plate(page).getByRole("button", { name: "Take over" }).click();
    const dialog = page.getByRole("dialog", { name: "Take over this session?" });
    await expect(dialog).toContainText(
      "The session is open in another browser, which will be disconnected.",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(other.getByRole("heading", { name: LIST_TITLE })).toBeVisible();

    await plate(page).getByRole("button", { name: "Take over" }).click();
    await dialog.getByRole("button", { name: "Take over" }).click();
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();

    // And the browser it was taken from says that, with the way back.
    await expect(plate(other)).toHaveAccessibleName("Another browser took the session over.");
    await expect(plate(other).getByRole("alert")).toHaveText(
      "Another browser took over this session. AL-3400",
    );
    await expect(plate(other).getByRole("button", { name: "Take it back" })).toBeVisible();
    await expect(plate(other).getByRole("button", { name: "Sign out" })).toBeVisible();
    await other.context().close();
  });

  test("a session the gateway does not open says the answer it gave, and offers to try again", async ({
    page,
  }) => {
    await page.route("**/api/session", (route) =>
      route.fulfill({ status: 502, body: "bad gateway" }),
    );
    await fillSignIn(page);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(plate(page)).toHaveAccessibleName("The session did not open.");
    await expect(plate(page).getByRole("alert")).toHaveText(
      "The server answered 502. Try again; if it goes on, look at the server's log. AL-3101",
    );
    await expect(plate(page).getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.unroute("**/api/session");
    await plate(page).getByRole("button", { name: "Retry" }).click();
    await expect(
      page
        .getByRole("heading", { name: LIST_TITLE })
        .or(plate(page).getByRole("button", { name: "Take over" }))
        .first(),
    ).toBeVisible();
  });

  test("a page older than its gateway says both versions, and offers the reload", async ({
    page,
  }) => {
    await page.route("**/api/session", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "x-alumia-version": "9.9.9" },
      });
    });
    await fillSignIn(page);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(plate(page)).toHaveAccessibleName("Page out of date.");
    await expect(plate(page).getByRole("alert")).toContainText(
      /^This page is version \d+\.\d+\.\d+ and the server is 9\.9\.9\. Reload the page\. AL-2201$/,
    );
    await expect(plate(page).getByRole("button", { name: "Reload" })).toBeVisible();
    await expect(plate(page).getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.unroute("**/api/session");
  });
});
