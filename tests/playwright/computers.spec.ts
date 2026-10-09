// The list of computers: which lines it has, what each is called, what the three
// places of its monitor are and which of them are keys, what the line's tip says,
// what Open sends after a key is pressed, and what the list says when it has
// nothing to list.
//
// The gateway under test has one target, so the list is given here: the answer
// to `GET /api/targets` is replaced, in the browser, by one computer of each kind
// the page tells apart, with the gateway's own headers kept. Everything asserted
// is then the page's decision about that answer, read from the DOM by role and
// by name, and from what the page sends on its session socket. The gateway hears
// one Open, for a computer it does not have, whose refusal is the failed session
// the notice is for.
//
// It needs a gateway with a web login and nothing else, which the tone harness
// is: `bash tools/run-page-tests.sh` runs it there.
import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  BASE_URL,
  computerRow,
  handle,
  LIST_TITLE,
  leaveSession,
  logIn,
  logInSpeaking,
  returnToPicker,
  SESSION_TIMEOUT_MS,
  stageSession,
  withFingers,
} from "./support";

const HAS_LOGIN =
  process.env.ALUMIA_PLAYWRIGHT_USERNAME !== undefined &&
  process.env.ALUMIA_PLAYWRIGHT_PASSWORD !== undefined;

const DEFAULT_SIZE = { w: 1440, h: 900 };

/// One entry of `GET /api/targets`, a plain VNC server unless told otherwise.
function computer(name: string, offers: Record<string, unknown>) {
  return {
    name,
    protocol: "vnc",
    subtype: null,
    host: "192.0.2.10",
    port: 5900,
    computer: null,
    here: false,
    resize: false,
    size: null,
    defaultSize: DEFAULT_SIZE,
    audio: false,
    passthrough: null,
    passthroughOnly: false,
    ...offers,
  };
}

/// One computer of each kind, as the gateway lists them
/// (docs/architecture.md, "What a session is started with"), and one Mac listed
/// twice at its address, once in each of its two modes.
const COMPUTERS = [
  computer("Studio mirrored", {
    subtype: "ard-mirror",
    host: "192.0.2.20",
    resize: true,
    defaultSize: null,
    passthrough: "apple-media",
  }),
  computer("MacBook Pro", {
    subtype: "ard-high-performance",
    host: "192.0.2.21",
    resize: true,
    passthrough: "apple-media",
  }),
  computer("Office Mac", {
    subtype: "ard",
    host: "192.0.2.22",
    defaultSize: null,
  }),
  computer("iMac", { subtype: "ard", host: "192.0.2.23", resize: true }),
  computer("Studio virtual", {
    subtype: "ard-high-performance",
    host: "192.0.2.20",
    resize: true,
    passthrough: "apple-media",
  }),
  computer("Work PC", {
    protocol: "rdp",
    host: "192.0.2.24",
    resize: true,
    size: { w: 1920, h: 1080 },
    audio: true,
    passthrough: "rdp-graphics",
  }),
  computer("Linux station", {
    subtype: "wlshare",
    host: "192.0.2.25",
    resize: true,
    audio: true,
  }),
  computer("Raspberry Pi", {}),
];

const VIRTUAL =
  "Virtual: picture and sound come here; the Mac is left without picture and without sound";
const MIRRORED = "Mirrored: mirrors everything, the sound perfect";
const WINDOW = "The size of this window";
const SOUND_ALWAYS = "Sound always comes with the picture";
const SOUND_OFF = "Without bringing the sound";
const SOUND_ON = "Sound brought here";

/// What the list shows of each line, on a desktop browser with nothing chosen
/// yet: what the computer is, its keys, and its marks, each by what it says.
const SAID = [
  // The Mac listed in both modes: one line, under what its two names share,
  // where the first of them stood, on Virtual the first time.
  { name: "Studio", kind: "Mac", keys: [VIRTUAL], marks: [WINDOW, SOUND_ALWAYS] },
  { name: "MacBook Pro", kind: "Mac", keys: [], marks: [VIRTUAL, WINDOW, SOUND_ALWAYS] },
  {
    name: "Office Mac",
    kind: "Compatible",
    keys: [],
    marks: ["The computer's screens as they are", "No sound"],
  },
  {
    name: "iMac",
    kind: "Compatible, its own screen",
    keys: [],
    marks: [WINDOW, "No sound"],
  },
  { name: "Work PC", kind: "Remote Desktop", keys: ["1920 × 1080", SOUND_OFF], marks: [] },
  { name: "Linux station", kind: "Linux, wlshare", keys: [SOUND_OFF], marks: [WINDOW] },
  { name: "Raspberry Pi", kind: "VNC", keys: [], marks: ["1440 × 900", "No sound"] },
];

/// Answer the list with `computers`, under the gateway's own headers: the page
/// holds the answer to the gateway's version before it lists anything. What it
/// gives back answers with other computers from then on. A test that changes
/// the list changes what this one route answers and takes no route away, as the
/// page asks for the computers each time the list comes on screen: Playwright
/// continues a request in flight whose route is removed under it, so the answer
/// still on its way failed with "Route is already handled!", and a route waited
/// for, taken away and put back was then not asked at all (both measured, in
/// docs/plans/2026-10-06-1300-correcao-app-de-mac.md).
async function list(
  page: Page,
  computers: unknown[],
): Promise<(others: unknown[]) => void> {
  let listed = computers;
  await page.route("**/api/targets", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: listed });
  });
  return (others) => {
    listed = others;
  };
}

/// A browser that does not decode a Mac's HEVC, whatever this machine's does: the
/// page asks its `VideoDecoder` once, at load, and is told no.
async function withoutHevc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const ask = VideoDecoder.isConfigSupported.bind(VideoDecoder);
    VideoDecoder.isConfigSupported = (config) =>
      config.codec.startsWith("hev")
        ? Promise.resolve({ supported: false, config })
        : ask(config);
  });
}

/// The keys of a line's monitor, each by what it says. Open is the line's own.
const keys = (row: Locator) =>
  row.getByRole("group").getByRole("button");
/// The marks of a line's monitor: the places with no other choice behind them.
const marks = (row: Locator) => row.getByRole("group").getByRole("img");
const open = (row: Locator) => row.getByRole("button", { name: /^Open / });

/// The `connect` the page last sent, as its target and what it is started with.
function connected(sent: { type: string }[]): unknown {
  const last = sent.filter((message) => message.type === "connect").at(-1) as
    | { target?: string; choices?: unknown }
    | undefined;
  return last && { target: last.target, choices: last.choices };
}

test.describe("the list of computers", () => {
  test.skip(
    !HAS_LOGIN,
    "set ALUMIA_PLAYWRIGHT_USERNAME and ALUMIA_PLAYWRIGHT_PASSWORD",
  );

  test.afterEach(async ({ page }) => {
    await leaveSession(page);
  });

  test("is a line a computer, a Mac in both modes one line, each with its keys and its marks", async ({
    page,
  }) => {
    await list(page, COMPUTERS);
    await logIn(page);
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(SAID.length);
    await expect(
      page.getByRole("listitem").getByRole("heading"),
    ).toHaveText(SAID.map((said) => said.name));

    for (const said of SAID) {
      const row = computerRow(page, said.name);
      await expect(row, said.name).toContainText(said.kind);
      await expect(
        row.getByRole("group", { name: `What Open brings from ${said.name}` }),
      ).toBeVisible();
      // A place is a key only where there is another choice behind it.
      await expect(keys(row), said.name).toHaveCount(said.keys.length);
      for (const [at, key] of said.keys.entries()) {
        await expect(keys(row).nth(at), said.name).toHaveAccessibleName(key);
      }
      await expect(marks(row), said.name).toHaveCount(said.marks.length);
      for (const [at, mark] of said.marks.entries()) {
        await expect(marks(row).nth(at), said.name).toHaveAccessibleName(mark);
      }
      await expect(open(row)).toBeEnabled();
      // Neither the address, nor the config's spelling, nor a tag is on the line.
      await expect(row).not.toContainText("192.0.2.");
      await expect(row.getByText("unofficial")).toHaveCount(0);
    }
    // Open stands by the monitor: under the name, on the strip of the keys and
    // of their height, not at the far end of the line.
    const studio = computerRow(page, "Studio");
    const [act, name, key] = await Promise.all(
      [open(studio), studio.getByRole("heading"), keys(studio).nth(0)].map(
        async (part) => {
          const box = await part.boundingBox();
          if (!box) {
            throw new Error("a part of the line has no box");
          }
          return box;
        },
      ),
    );
    expect(Math.round(act.x)).toBe(Math.round(name.x));
    expect(Math.round(act.y + act.height)).toBe(Math.round(key.y + key.height));
    expect(Math.round(act.height)).toBe(Math.round(key.height));
    // Nothing of the options the list had: no way to them, and nothing to tick.
    await expect(page.getByRole("button", { name: "Options" })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  test("a key chooses, the line's tip says so, and Open sends what was chosen", async ({
    page,
  }) => {
    const staged = await stageSession(page);
    await list(page, COMPUTERS);
    await logIn(page);
    // The gateway has none of these computers: it never hears their Open.
    staged.keep("connect", "disconnect");

    // The tip says what Open brings, a line a place, while the pointer rests on
    // the monitor. Open is described by it.
    const pc = computerRow(page, "Work PC");
    const tip = pc.getByRole("tooltip");
    await expect(tip).toBeHidden();
    await pc.getByRole("group").hover();
    await expect(tip).toBeVisible();
    await expect(tip.getByRole("paragraph")).toHaveText(["1920 × 1080", SOUND_OFF]);
    await expect(open(pc)).toHaveAccessibleDescription(
      new RegExp(`^1920 × 1080\\s*${SOUND_OFF}$`),
    );
    await page.mouse.move(0, 0);
    await expect(tip).toBeHidden();

    // The size's key and the sound's: each goes to its other choice, the tip
    // comes up with it, and what Open sends follows.
    await keys(pc).nth(0).click();
    await expect(keys(pc).nth(0)).toHaveAccessibleName(WINDOW);
    await expect(tip).toBeVisible();
    await keys(pc).nth(1).click();
    await expect(keys(pc).nth(1)).toHaveAccessibleName(SOUND_ON);
    await expect(tip.getByRole("paragraph")).toHaveText([WINDOW, SOUND_ON]);
    await open(pc).click();
    await expect.poll(() => connected(staged.sent)).toEqual({
      target: "Work PC",
      choices: {
        size: "window",
        audio: "opus",
        passthrough: false,
        placement: "right",
      },
    });
    await page.getByRole("button", { name: "Cancel" }).click();
    staged.say({ type: "picker" });
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();

    // The mode's key of a Mac listed in both: Open sends the other target, and
    // the places are that target's. A mirrored Mac is always fitted to the
    // window: its size is a mark, as the virtual one's is, and the mode stays
    // the line's one key.
    const mac = computerRow(page, "Studio");
    await expect(keys(mac)).toHaveCount(1);
    await keys(mac).nth(0).click();
    await expect(keys(mac).nth(0)).toHaveAccessibleName(MIRRORED);
    await expect(keys(mac)).toHaveCount(1);
    await expect(marks(mac).nth(0)).toHaveAccessibleName(
      "Picture fitted to this window",
    );
    await expect(marks(mac).nth(1)).toHaveAccessibleName(SOUND_ALWAYS);
    await open(mac).click();
    // Whoever sits at a mirrored Mac sees what the viewer does: said once.
    const ask = page.getByRole("dialog", {
      name: "Anyone in front of the Mac sees what you do",
    });
    await expect(ask).toContainText(
      "In Mirrored mode the Mac stays lit and shows what you do.",
    );
    await ask.getByRole("button", { name: "Got it, open" }).click();
    await expect.poll(() => connected(staged.sent)).toEqual({
      target: "Studio mirrored",
      choices: {
        size: "window",
        audio: "off",
        passthrough: false,
        placement: "right",
      },
    });
    await page.getByRole("button", { name: "Cancel" }).click();
    staged.say({ type: "picker" });
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();

    // What was chosen is how the list comes back after a reload: the mode of
    // the Mac, and each computer's keys.
    await page.reload();
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
    await expect(keys(computerRow(page, "Studio")).nth(0)).toHaveAccessibleName(
      MIRRORED,
    );
    await expect(keys(computerRow(page, "Work PC"))).toHaveCount(2);
    await expect(keys(computerRow(page, "Work PC")).nth(0)).toHaveAccessibleName(
      WINDOW,
    );
    await expect(keys(computerRow(page, "Work PC")).nth(1)).toHaveAccessibleName(
      SOUND_ON,
    );
    // And back on Virtual, Open sends the virtual target.
    await keys(computerRow(page, "Studio")).nth(0).click();
    await open(computerRow(page, "Studio")).click();
    await expect.poll(() => connected(staged.sent)).toEqual({
      target: "Studio virtual",
      choices: {
        size: "window",
        audio: "off",
        passthrough: false,
        placement: "right",
      },
    });
    await page.getByRole("button", { name: "Cancel" }).click();
    staged.say({ type: "picker" });
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
  });

  test("a finger sees the tip for a moment after it presses a key", async ({
    browser,
  }) => {
    // A phone as the page tells one, which has no pointer to rest anywhere.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await withFingers(page);
    await list(page, COMPUTERS);
    await page.clock.install();
    await logIn(page);
    const mac = computerRow(page, "Studio");
    const tip = mac.getByRole("tooltip");
    await expect(tip).toBeHidden();
    await keys(mac).nth(0).tap();
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(MIRRORED);
    await page.clock.fastForward(4000);
    await expect(tip).toBeHidden();

    // A line with no key at all: touching its monitor says what its marks are.
    const plain = computerRow(page, "Raspberry Pi");
    await expect(keys(plain)).toHaveCount(0);
    await expect(plain.getByRole("tooltip")).toBeHidden();
    await plain.getByRole("group").tap();
    await expect(plain.getByRole("tooltip")).toBeVisible();
    await expect(plain.getByRole("tooltip")).toContainText("No sound");
    await page.clock.fastForward(4000);
    await expect(plain.getByRole("tooltip")).toBeHidden();
    await context.close();
  });

  test("the gateway's own computer is called by its own name, on its line and on the screen that lights", async ({
    page,
  }) => {
    // The Mac the gateway runs on, listed in its two modes under names of the
    // config's own: the gateway says what that computer calls itself.
    const here = { host: "192.0.2.40", computer: "AB MacBook Pro" };
    await list(page, [
      computer("mac-virtual", {
        subtype: "ard-high-performance",
        resize: true,
        passthrough: "apple-media",
        ...here,
      }),
      computer("mac-espelhado", {
        subtype: "ard-mirror",
        resize: true,
        defaultSize: null,
        passthrough: "apple-media",
        ...here,
      }),
      computer("Raspberry Pi", {}),
    ]);
    const staged = await stageSession(page);
    await logIn(page);
    await expect(page.getByRole("listitem").getByRole("heading")).toHaveText([
      "AB MacBook Pro",
      "Raspberry Pi",
    ]);
    const mac = computerRow(page, "AB MacBook Pro");
    await expect(open(mac)).toHaveAccessibleName("Open AB MacBook Pro");

    // Open asks for the target by its entry's name, and the screen that lights
    // is titled as the line was.
    staged.keep("connect");
    await open(mac).click();
    await expect.poll(() => connected(staged.sent)).toMatchObject({
      target: "mac-virtual",
    });
    await expect(page.getByRole("main").getByRole("heading")).toHaveText(
      "AB MacBook Pro",
    );
    await page.getByRole("button", { name: "Cancel" }).click();
    staged.say({ type: "picker" });
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
  });

  test("on this very Mac the line stays Mirrored and says why, and one with only a screen of its own does not open", async ({
    page,
  }) => {
    // The Mac the gateway runs on, listed to a browser that is at that Mac: a
    // session on a screen of its own would turn off the screens this page is on.
    const here = { host: "127.0.0.1", computer: "Mac da Ana", here: true };
    const virtual = computer("mac-virtual", {
      subtype: "ard-high-performance",
      resize: true,
      passthrough: "apple-media",
      ...here,
    });
    const staged = await stageSession(page);
    const relist = await list(page, [
      virtual,
      computer("mac-espelhado", {
        subtype: "ard-mirror",
        resize: true,
        defaultSize: null,
        passthrough: "apple-media",
        ...here,
      }),
      computer("Raspberry Pi", {}),
    ]);
    await logIn(page);
    // The gateway has neither of these computers: it never hears their Open.
    staged.keep("connect", "disconnect");

    // Both modes are listed and the line has no key: the mode is a mark.
    const mac = computerRow(page, "Mac da Ana");
    await expect(keys(mac)).toHaveCount(0);
    await expect(marks(mac)).toHaveCount(3);
    await expect(marks(mac).nth(0)).toHaveAccessibleName(
      "Mirrored. Virtual is off on this Mac: it would turn off the screens you are using.",
    );
    await expect(marks(mac).nth(1)).toHaveAccessibleName(
      "Picture fitted to this window",
    );
    await open(mac).click();
    await page
      .getByRole("dialog", {
        name: "Anyone in front of the Mac sees what you do",
      })
      .getByRole("button", { name: "Got it, open" })
      .click();
    await expect.poll(() => connected(staged.sent)).toEqual({
      target: "mac-espelhado",
      choices: {
        size: "window",
        audio: "off",
        passthrough: false,
        placement: "right",
      },
    });
    await page.getByRole("button", { name: "Cancel" }).click();
    staged.say({ type: "picker" });
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();

    // Listed on a screen of its own and nothing else, it has no mode to stand
    // on: the line says why, and Open is off.
    relist([virtual]);
    await page.reload();
    const alone = computerRow(page, "Mac da Ana");
    await expect(alone.getByRole("note")).toContainText(
      "This is the Mac you are using, and this mode would turn its screens off.",
    );
    await expect(alone.getByRole("note")).toContainText("AL-2602");
    await expect(open(alone)).toBeDisabled();
  });

  test("a session found open is called by the name of its line", async ({
    page,
  }) => {
    // The gateway's own list, cut to its first computer and that one called as
    // a Mac the gateway runs on would be: a session is named by its line, not
    // by its entry.
    await page.route("**/api/targets", async (route) => {
      const response = await route.fetch();
      const listed = (await response.json()) as Record<string, unknown>[];
      await route.fulfill({
        response,
        json: listed
          .slice(0, 1)
          .map((entry) => ({ ...entry, computer: "AB MacBook Pro" })),
      });
    });
    const staged = await stageSession(page);
    await logIn(page);
    await open(computerRow(page, "AB MacBook Pro")).click();
    await expect(handle(page)).toBeVisible({ timeout: SESSION_TIMEOUT_MS });

    // Found open by a reload, with its picture held back: the screen that waits
    // for it is titled as the line was, once the list has answered.
    staged.hold("resize");
    await page.reload();
    await expect(page.getByRole("main").getByRole("heading")).toHaveText(
      "AB MacBook Pro",
    );
    staged.release();
    await expect(handle(page)).toBeVisible({ timeout: SESSION_TIMEOUT_MS });
    await returnToPicker(page);
  });

  test("the moment a line's tip stays up for is counted from the last press", async ({
    page,
  }) => {
    await list(page, COMPUTERS);
    await page.clock.install();
    await logIn(page);
    // With a mouse, which the pointer resting on the monitor would show the tip
    // to anyway: what is asked is the line's own word for the moment.
    const mac = computerRow(page, "Studio");
    await keys(mac).nth(0).click();
    await expect(mac).toHaveAttribute("data-al-told", "mode");
    await page.clock.fastForward(3000);
    await keys(mac).nth(0).click();
    await keys(mac).nth(0).click();
    await page.clock.fastForward(3000);
    await expect(mac).toHaveAttribute("data-al-told", "mode");
    await page.clock.fastForward(1000);
    await expect(mac).not.toHaveAttribute("data-al-told");
  });

  test("Open stays on the strip of the keys, and the page inside its window, whatever the name and the tip", async ({
    page,
  }) => {
    // A name too long for its line, on a Mac whose gateway can only pass its
    // picture, which is the tallest tip there is; and a plain line beside it.
    const LONG = "MacBook Pro do Alessandro no escritório de casa, segunda mesa";
    await list(page, [
      computer(LONG, {
        subtype: "ard-high-performance",
        host: "192.0.2.30",
        resize: true,
        passthrough: "apple-media",
        passthroughOnly: true,
      }),
      computer("Raspberry Pi", {}),
    ]);
    await logIn(page);
    // Where the long name fits on one line, its monitor stands as high in its
    // line as the plain one's: a tip taller than the monitor, shown or not,
    // makes no line taller. (The line itself may carry a note under it, where
    // this browser cannot take the Mac's picture.)
    await page.setViewportSize({ width: 1440, height: 900 });
    const tops = await Promise.all(
      [LONG, "Raspberry Pi"].map(async (name) => {
        const row = computerRow(page, name);
        const [line, monitor] = await Promise.all([
          row.boundingBox(),
          row.getByRole("group").boundingBox(),
        ]);
        return line && monitor ? Math.round(monitor.y - line.y) : Number.NaN;
      }),
    );
    expect(tops[0], "a tall tip makes no line taller").toBe(tops[1]);

    for (const width of [1280, 960, 700, 640]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of [LONG, "Raspberry Pi"]) {
        const row = computerRow(page, name);
        // The tip up, as tall as it gets.
        await row.getByRole("group").hover();
        await expect(row.getByRole("tooltip")).toBeVisible();
        const [act, place, tip] = await Promise.all(
          [
            open(row),
            row.getByRole("group").locator("> *").last(),
            row.getByRole("tooltip"),
          ].map(async (part) => {
            const box = await part.boundingBox();
            if (!box) {
              throw new Error("a part of the line has no box");
            }
            return box;
          }),
        );
        expect(
          Math.round(act.y + act.height),
          `${name} at ${width}: Open's foot against the keys'`,
        ).toBe(Math.round(place.y + place.height));
        // A tip with a sentence in it is given room to be read in.
        if (name === LONG) {
          expect(tip.width, `${name} at ${width}: the tip's width`).toBeGreaterThan(200);
        }
        expect(
          await page.evaluate(() => {
            const scene = document.querySelector(".al-scene");
            return scene ? scene.scrollWidth - scene.clientWidth : Number.NaN;
          }),
          `${name} at ${width}: how far the page passes its window`,
        ).toBe(0);
      }
    }
  });

  test("a computer that cannot be opened from here says why, and Open is off", async ({
    page,
  }) => {
    // A gateway that can only pass the Mac's picture, and a browser that cannot
    // take it.
    await withoutHevc(page);
    await list(page, [
      computer("MacBook Pro", {
        subtype: "ard-high-performance",
        resize: true,
        passthrough: "apple-media",
        passthroughOnly: true,
      }),
    ]);
    await logIn(page);
    const row = computerRow(page, "MacBook Pro");
    await expect(row.getByRole("note")).toContainText(
      "This server cannot decode the Mac's video, and this browser cannot take it passed through.",
    );
    await expect(row.getByRole("note")).toContainText("AL-2601");
    await expect(open(row)).toBeDisabled();
    // The tip says why the video is passed whatever anybody asks.
    await row.getByRole("group").hover();
    await expect(row.getByRole("tooltip")).toContainText(
      "This server cannot decode the Mac's video, so it is always passed through.",
    );
  });

  test("a session that does not open is said in the notice, with its code and cause", async ({
    page,
  }) => {
    // A computer the gateway does not have: it refuses the Open by name.
    await list(page, [computer("ghost", {})]);
    await logIn(page);
    await open(computerRow(page, "ghost")).click();

    // The gateway names the cause beside its sentence, and the page says the
    // cause from the catalogue; the sentence itself is kept behind Details, named
    // for what it is.
    const notice = page
      .getByRole("status")
      .filter({ hasText: "The server has no computer named ghost." });
    await expect(notice).toContainText(
      "The server has no computer named ghost. Reload the list.",
    );
    await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
    await notice.getByText("Details").click();
    await expect(notice).toContainText("Code AL-7506");
    await expect(notice).toContainText('Original text no target named "ghost"');
    // Nothing of the gateway's sentence is in what the notice says.
    await expect(notice.getByRole("paragraph")).toHaveText(
      "The server has no computer named ghost. Reload the list.",
    );
    // The list is still there to open from.
    await expect(open(computerRow(page, "ghost"))).toBeEnabled();
  });

  test("with nothing to list, says which nothing it is", async ({ page }) => {
    // Still loading: the answer is held back until the page has said so.
    let answer = () => {};
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await page.route("**/api/targets", async (route) => {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response, json: [] });
    });
    await logIn(page);
    await expect(page.getByText("Loading the computers…")).toBeVisible();
    answer();
    // No computer at all.
    await expect(
      page.getByText("No computers are set up on this server."),
    ).toBeVisible();
    await expect(page.getByText("Loading the computers…")).toHaveCount(0);
    await expect(page.getByRole("listitem")).toHaveCount(0);

    // The gateway failing to answer.
    await page.unroute("**/api/targets");
    await page.route("**/api/targets", (route) =>
      route.fulfill({ status: 500, body: "" }),
    );
    await page.reload();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      "Could not load the list of computers. Reload the page.",
    );
    await expect(alert).toContainText("AL-2100");
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();

    // A gateway of another version, and one that states none.
    await page.unroute("**/api/targets");
    await page.route("**/api/targets", (route) =>
      route.fulfill({
        json: [],
        headers: { "X-Alumia-Version": "0.0.1" },
      }),
    );
    await page.reload();
    await expect(alert).toContainText(/This page is version .+ and the server is 0\.0\.1\. Reload the page\./);
    await expect(alert).toContainText("AL-2201");
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();

    await page.unroute("**/api/targets");
    await page.route("**/api/targets", (route) => route.fulfill({ json: [] }));
    await page.reload();
    await expect(alert).toContainText("the server did not state its version");
    await expect(alert).toContainText("AL-2202");
  });

  test("another Mac with Alumia is a line after the computers, and a way to its own Alumia", async ({
    page,
  }) => {
    await list(page, COMPUTERS);
    await logIn(page);
    // The gateway under test is hosted by no Mac app and finds nobody: the list
    // is the computers, with no second title.
    const title = page.getByRole("heading", { name: "Other Macs with Alumia" });
    await expect(open(computerRow(page, "Raspberry Pi"))).toBeEnabled();
    await expect(title).toHaveCount(0);

    // What a gateway a Mac app hosts answers of the others it found
    // (`GET /api/neighbours`), given here in its place, and with them an
    // address this window must never be sent to.
    await page.route("**/api/neighbours", (route) =>
      route.fulfill({
        json: [
          { name: "Mac mini", url: "https://mac-mini.example" },
          { name: "Not secure", url: "http://not-secure.example" },
        ],
      }),
    );
    await page.reload();
    await expect(title).toBeVisible();
    const far = computerRow(page, "Mac mini");
    await expect(far).toContainText("Mac with Alumia");
    const go = far.getByRole("link", { name: "Go to this Mac: Mac mini" });
    await expect(go).toHaveAttribute("href", "https://mac-mini.example");
    await expect(go).toHaveAccessibleDescription(
      "Opens that Mac's Alumia in this window. You sign in there with its password.",
    );
    // No key, no mark and no Open: what that Mac offers is its own to say, there.
    await expect(far.getByRole("button")).toHaveCount(0);
    await expect(far.getByRole("img")).toHaveCount(0);
    // After every computer, which are all there as they were: seven lines of
    // them, the Mac in two modes being one, and then this one.
    const names = page.getByRole("listitem").getByRole("heading");
    await expect(names).toHaveCount(8);
    await expect(names.last()).toHaveText("Mac mini");
    await expect(computerRow(page, "Not secure")).toHaveCount(0);
    await expect(open(computerRow(page, "Raspberry Pi"))).toBeEnabled();
  });

  test("signing out, from the foot or from the preferences, comes back to the sign-in", async ({
    page,
  }) => {
    await list(page, COMPUTERS);
    await logIn(page);
    await page.getByRole("button", { name: "Preferences" }).click();
    await page
      .getByRole("dialog", { name: "Preferences" })
      .getByRole("button", { name: "Sign out" })
      .click();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();

    await logIn(page);
    await page
      .getByRole("contentinfo")
      .getByRole("button", { name: "Sign out" })
      .click();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
  });
});

// The harness's own computer: the one a session really opens on.
const HARNESS_TARGET = process.env.ALUMIA_PLAYWRIGHT_PICKER_TARGET;

test.describe("a session ended from the computer that hosts Alumia", () => {
  test.skip(
    !HAS_LOGIN || !HARNESS_TARGET,
    "set ALUMIA_PLAYWRIGHT_USERNAME, ALUMIA_PLAYWRIGHT_PASSWORD and ALUMIA_PLAYWRIGHT_PICKER_TARGET",
  );

  test.afterEach(async ({ page }) => {
    await leaveSession(page);
  });

  test("a session the host ended is said by the host's own reason, in each language", async ({
    page,
    browser,
  }) => {
    const target = HARNESS_TARGET ?? "";
    // What a gateway a Mac app hosts sends when somebody ends the session at
    // that Mac (`end_from_host`, src/session.rs): its own sentence, the cause,
    // and that there is no session. Said here in its place, since the harness
    // has no Mac app over it.
    const ended = "the session was ended on the computer that hosts it";
    const staged = await stageSession(page);
    await logIn(page);
    await open(computerRow(page, target)).click();
    await expect(handle(page)).toBeVisible({ timeout: SESSION_TIMEOUT_MS });
    staged.say({
      type: "error",
      message: ended,
      cause: { code: "AL-7801", fill: {} },
    });
    staged.say({ type: "picker" });

    const dialog = page.getByRole("alertdialog", { name: "The session ended" });
    // The catalogue's words for the host's reason, and none of its sentence.
    await expect(dialog.getByRole("paragraph")).toHaveText(
      "The session was ended on the computer that hosts Alumia. Open it again whenever you like.",
    );
    await dialog.getByText("Details").click();
    await expect(dialog).toContainText("Code AL-7801");
    await expect(dialog).toContainText(`Original text ${ended}`);
    // Nobody took the session, and nothing says somebody did.
    await expect(page.getByText(/another browser/i)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Back to the computers" }).click();
    await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
    await expect(open(computerRow(page, target))).toBeEnabled();

    // The other reason a host has, in the other language: its settings changed.
    const context = await browser.newContext({ locale: "pt-BR" });
    const pagina = await context.newPage();
    const montada = await stageSession(pagina);
    await logInSpeaking(pagina, "pt-BR");
    await computerRow(pagina, target)
      .getByRole("button", { name: /^Abrir / })
      .click();
    await expect(
      pagina.getByRole("button", { name: /^Abrir a barra da sessão/ }),
    ).toBeVisible({ timeout: SESSION_TIMEOUT_MS });
    const changed =
      "the session ended because the settings of the computer that hosts it changed";
    montada.say({
      type: "error",
      message: changed,
      cause: { code: "AL-7802", fill: {} },
    });
    montada.say({ type: "picker" });

    const dialogo = pagina.getByRole("alertdialog", {
      name: "A sessão terminou",
    });
    await expect(dialogo.getByRole("paragraph")).toHaveText(
      "Os ajustes do Alumia mudaram no computador que o hospeda, e a sessão terminou. Abra de novo.",
    );
    await dialogo.getByText("Detalhes").click();
    await expect(dialogo).toContainText("Código AL-7802");
    await expect(dialogo).toContainText(`Texto original ${changed}`);
    await dialogo
      .getByRole("button", { name: "Voltar aos computadores" })
      .click();
    await context.close();
  });
});

test.describe("the list of computers in Portuguese", () => {
  test.skip(
    !HAS_LOGIN,
    "set ALUMIA_PLAYWRIGHT_USERNAME and ALUMIA_PLAYWRIGHT_PASSWORD",
  );
  test.use({ locale: "pt-BR" });

  test("says the same in the other language", async ({ page }) => {
    await list(page, COMPUTERS);
    await page.goto(BASE_URL);
    await page.getByLabel("Usuário").fill(process.env.ALUMIA_PLAYWRIGHT_USERNAME ?? "");
    await page
      .getByLabel("Senha", { exact: true })
      .fill(process.env.ALUMIA_PLAYWRIGHT_PASSWORD ?? "");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    const over = page.getByRole("button", { name: "Take over" });
    const title = page.getByRole("heading", { name: "Seus computadores" });
    await expect(over.or(title).first()).toBeVisible({ timeout: 20_000 });
    if (await over.isVisible()) {
      await over.click();
    }
    await expect(title).toBeVisible();

    const mac = computerRow(page, "Studio");
    await expect(mac).toContainText("Mac");
    await expect(mac.getByText("não oficial")).toHaveCount(0);
    await expect(
      mac.getByRole("group", { name: "O que Abrir traz de Studio" }),
    ).toBeVisible();
    await expect(keys(mac).nth(0)).toHaveAccessibleName(
      "Virtual: imagem e som vêm para cá; o Mac fica sem imagem e sem som",
    );
    await expect(marks(mac)).toHaveCount(2);
    await expect(marks(mac).nth(0)).toHaveAccessibleName("O tamanho desta janela");
    await expect(marks(mac).nth(1)).toHaveAccessibleName(
      "Som sempre junto com a imagem",
    );
    await keys(mac).nth(0).click();
    await expect(keys(mac).nth(0)).toHaveAccessibleName(
      "Espelhado: espelha tudo, com o som perfeito",
    );
    // Mirrored is always fitted: the size is a mark, and the mode the one key.
    await expect(keys(mac)).toHaveCount(1);
    await expect(marks(mac).nth(0)).toHaveAccessibleName(
      "Imagem ajustada a esta janela",
    );
    await expect(mac.getByRole("button", { name: "Abrir Studio" })).toBeEnabled();
    await expect(computerRow(page, "Work PC")).toContainText(
      "Área de Trabalho Remota",
    );
    await expect(keys(computerRow(page, "Work PC")).nth(1)).toHaveAccessibleName(
      "Sem trazer o som",
    );
  });
});

// The windows the mockup is drawn in: a phone upright and on its side, a tablet
// and a desktop. The first three are touch devices.
const WINDOWS = [
  { width: 390, height: 844, touch: true },
  { width: 860, height: 412, touch: true },
  { width: 820, height: 1180, touch: true },
  { width: 1440, height: 900, touch: false },
];

for (const locale of ["en-US", "pt-BR"]) {
  test.describe(`the list of computers in ${locale}`, () => {
    test.skip(
      !HAS_LOGIN,
      "set ALUMIA_PLAYWRIGHT_USERNAME and ALUMIA_PLAYWRIGHT_PASSWORD",
    );

    test("is never wider than its window, with a line's tip up", async ({
      browser,
    }) => {
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
        await list(page, COMPUTERS);
        // Signed in in English, for the helper's sake; the language is then the
        // browser's.
        await page.addInitScript(() => {
          if (sessionStorage.getItem("al-test-signed-in") === null) {
            localStorage.setItem("alumia.language", "en-US");
          }
        });
        await logIn(page);
        await page.evaluate(() => {
          sessionStorage.setItem("al-test-signed-in", "yes");
          localStorage.removeItem("alumia.language");
        });
        await page.reload();
        await expect(page.getByRole("listitem")).toHaveCount(SAID.length);
        // The longest tip there is, the Mac's, brought up by its key.
        const mac = computerRow(page, "Studio");
        await keys(mac).nth(0).click();
        await expect(mac.getByRole("tooltip")).toBeVisible();
        const window = `${locale} ${size.width}×${size.height}`;
        const spill = await page.getByRole("main").evaluate((main) => {
          const scene = main.parentElement;
          return scene ? scene.scrollWidth - scene.clientWidth : Number.NaN;
        });
        expect(spill, window).toBe(0);
        // The tip whole inside the window's width.
        const box = await mac.getByRole("tooltip").boundingBox();
        expect(box && box.x >= 0, window).toBe(true);
        expect(box && box.x + box.width <= size.width, window).toBe(true);
        await context.close();
      }
    });
  });
}
