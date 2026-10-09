// A session: the bar and what hangs from it, the keyboard on screen, what covers
// the remote screen, the dialogs, and when the remote takes no input.
//
// Each is asserted by what the page says and by what it sends: the names of its
// buttons, the catalogue's sentences and codes, and the messages that leave on
// the session socket, which the spec reads standing in front of the gateway
// (support.ts, `stageSession`). What only a real remote sends, the spec says in
// its place: its list of displays, its clipboard, a desktop too large to show.
// Nothing here looks at the picture.
//
// It runs against the gateway's own test harness, with no remote:
//
//     ALUMIA_PAGE_SPECS=session bash tools/run-page-tests.sh
import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  computerRow,
  handle,
  leaveSession,
  logIn,
  logInAndConnectTo,
  logInSpeaking,
  openBar,
  returnToPicker,
  SESSION_TIMEOUT_MS,
  SOUND_SOCKET,
  type Staged,
  stageSession,
  withFingers,
} from "./support";

// A browser under test hides its scroll bars (`--hide-scrollbars`), and then one
// that appears takes no room. A person's browser on Windows shows them, and a
// scroll bar appearing is what moves a sheet's content sideways: so this file
// keeps them, which is the one way the spec about that can fail. Kept is not
// enough on a Mac: Chromium there draws the Mac's own scroll bars, over the
// content and taking no room unless a mouse is in use (its `OverlayScrollbar`
// feature follows `NSScroller`'s preferred style, and its `classic` mode was
// measured to change nothing in the headless browser here), so that spec gives
// the sheet a styled scroll bar of its own, which takes room whatever the Mac
// prefers: measured on 2026-10-08, 15 px, and 30 px reserved by the gutter.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const TARGET = process.env.ALUMIA_PLAYWRIGHT_PICKER_TARGET;
test.skip(!TARGET, "set ALUMIA_PLAYWRIGHT_PICKER_TARGET");
const target = TARGET ?? "";

const UP = { timeout: SESSION_TIMEOUT_MS };

test.afterEach(async ({ page }) => {
  await leaveSession(page);
});

// The remote screen, as the page offers it to whoever asks: the one thing on it
// that takes the keyboard.
const surface = (page: Page) => page.getByRole("application");

// The keys that left for the remote, in order: "+KeyA" pressed, "-KeyA" released.
const keys = (staged: Staged): string[] =>
  staged.sent
    .filter((message) => message.type === "key")
    .map((message) => `${message.pressed ? "+" : "-"}${message.code}`);

const sentOf = (staged: Staged, type: string) =>
  staged.sent.filter((message) => message.type === type);

// A key pressed on a real keyboard with the remote screen holding the focus.
async function type(page: Page, key: string): Promise<void> {
  await surface(page).focus();
  await page.keyboard.press(key);
}

// A session on the harness's computer, staged, with the bar's handle up.
async function session(page: Page): Promise<Staged> {
  const staged = await stageSession(page);
  await logInAndConnectTo(page, target);
  return staged;
}

// What a Mac with two screens and a virtual one lists, in the gateway's own words.
const DISPLAYS = [
  {
    id: 0,
    label: "All Displays",
    detail: "3200×1000 at 2x",
    main: false,
    virtual: false,
  },
  {
    id: 1,
    label: "Display 1",
    detail: "1600×1000 at 2x",
    main: true,
    virtual: false,
  },
  {
    id: 2,
    label: "Display 2",
    detail: "1600×1000 at 2x",
    main: false,
    virtual: false,
  },
  {
    id: 3,
    label: "Virtual display",
    detail: "1280×800 at 1x",
    main: false,
    virtual: true,
  },
];

// The menu the bar's More opens.
const more = (page: Page) => page.getByRole("dialog", { name: "More" });

async function openMore(page: Page): Promise<Locator> {
  const bar = await openBar(page);
  if (!(await more(page).isVisible())) {
    await bar.getByRole("button", { name: "More" }).click();
  }
  await expect(more(page)).toBeVisible();
  return more(page);
}

const VIEW_ONLY = (what: string) =>
  `The remote screen is view only while ${what}.`;

test("the bar and its menu offer what the session has, and a healthy session raises no alert", async ({
  page,
}) => {
  const staged = await session(page);

  // What the specs that need a real remote depend on staying as it is: the
  // surface's own classes, and nothing on the page asking for attention.
  await expect(page.locator(".screen .surface canvas.framebuffer")).toHaveCount(
    2,
  );
  await expect(page.locator(".screen .surface .input-overlay")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(handle(page)).toHaveAccessibleName("Open the session bar");

  // Opened from the keyboard, the bar keeps the focus, on its first button: the
  // handle that had it is gone, and somebody walking the bar is not typing at
  // the remote.
  await handle(page).focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("toolbar", { name: "Session bar" })
      .getByRole("button")
      .first(),
  ).toBeFocused();
  expect(keys(staged)).toEqual([]);

  // One screen and no sound: neither has a button.
  const bar = await openBar(page);
  await expect(bar.getByRole("button", { name: "Keyboard" })).toBeVisible();
  await expect(
    bar.getByRole("button", { name: "End", exact: true }),
  ).toBeVisible();
  await expect(bar.getByRole("button", { name: "Screens" })).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Mute" })).toHaveCount(0);

  // A remote that lists its screens gets the button for them.
  staged.say({ type: "displays", active: 1, displays: DISPLAYS });
  await expect(bar.getByRole("button", { name: "Screens" })).toBeVisible();

  // The harness's computer takes no camera and no microphone.
  const menu = await openMore(page);
  for (const name of ["Clipboard", "Information", "Preferences", "Sign out"]) {
    await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(menu.getByRole("button", { name: /^Camera/ })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: /^Microphone/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the remote takes no input while something is open over it, says so, and takes it again when that closes", async ({
  page,
}) => {
  const staged = await session(page);
  staged.say({ type: "displays", active: 1, displays: DISPLAYS });

  // With nothing open, and with the bar open by itself, a key reaches the remote.
  await type(page, "a");
  await expect.poll(() => keys(staged)).toContain("+KeyA");
  // The bar opened with a pointer hands the keyboard back to the remote by
  // itself: nothing here puts the focus anywhere.
  const bar = await openBar(page);
  await page.keyboard.press("b");
  await expect.poll(() => keys(staged)).toContain("+KeyB");
  await expect(page.getByRole("status")).toHaveCount(0);

  // Each thing that opens over the remote: how to open it, and what the line says.
  const opened: [string, string, () => Promise<unknown>][] = [
    ["KeyM", "the menu is open", () => openMore(page)],
    [
      "KeyC",
      "the clipboard is open",
      async () =>
        (await openMore(page))
          .getByRole("button", { name: "Clipboard" })
          .click(),
    ],
    [
      "KeyS",
      "the list of screens is open",
      () => bar.getByRole("button", { name: "Screens" }).click(),
    ],
    [
      "KeyI",
      "the information is open",
      async () =>
        (await openMore(page))
          .getByRole("button", { name: "Information" })
          .click(),
    ],
    [
      "KeyP",
      "the preferences are open",
      async () =>
        (await openMore(page))
          .getByRole("button", { name: "Preferences" })
          .click(),
    ],
  ];
  let sentinel = 0;
  for (const [code, what, open] of opened) {
    await open();
    await expect(page.getByText(VIEW_ONLY(what))).toBeVisible();
    // The line is written a step before the input is told, so it is the remote's
    // surface that says when it has stopped taking input: only then is a key that
    // arrives a key that got through.
    await expect(surface(page), what).not.toHaveAttribute("data-al-live");
    await type(page, code.slice(3).toLowerCase());
    await page.keyboard.press("Escape");
    await expect(page.getByText(VIEW_ONLY(what))).toHaveCount(0);
    // Closing hands the keyboard back to the remote, by itself: that is the
    // page's word that it is live again. A key then is the proof the one before
    // it never left: the socket keeps their order.
    await expect(surface(page)).toBeFocused();
    sentinel += 1;
    await page.keyboard.press(`${sentinel}`);
    await expect.poll(() => keys(staged)).toContain(`+Digit${sentinel}`);
    expect(keys(staged), what).not.toContain(`+${code}`);
  }

  // A press beside what is open closes it, and is not a click on the remote.
  await openMore(page);
  const box = await surface(page).boundingBox();
  const at = {
    x: (box?.x ?? 0) + 40,
    y: (box?.y ?? 0) + (box?.height ?? 0) - 40,
  };
  await page.mouse.click(at.x, at.y);
  await expect(more(page)).toHaveCount(0);
  expect(sentOf(staged, "mouseButton")).toEqual([]);
  // The same press with nothing open is the remote's.
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(() => sentOf(staged, "mouseButton").length)
    .toBeGreaterThan(0);
});

test("a computer that gave one display of the two asked for is said so beside the picture", async ({
  page,
}) => {
  const staged = await session(page);
  const said = page.getByText(
    "This computer gave one display only. The second display is not available on it.",
  );
  await expect(said).toHaveCount(0);
  staged.say({ type: "secondDisplay", missing: true });
  await expect(said).toBeVisible();
  // Nothing is covered: the remote takes input as it did.
  await type(page, "a");
  await expect.poll(() => keys(staged)).toContain("+KeyA");
  staged.say({ type: "secondDisplay", missing: false });
  await expect(said).toHaveCount(0);
});

test("the list of screens says the remote's, and its mark moves only when the remote confirms", async ({
  page,
}) => {
  const staged = await session(page);
  staged.say({ type: "displays", active: 1, displays: DISPLAYS });
  const bar = await openBar(page);
  await bar.getByRole("button", { name: "Screens" }).click();

  const list = page.getByRole("group", { name: "Screens" });
  await expect(list.getByRole("button")).toHaveText([
    "All screens3200 × 1000 · 2x",
    "Display 11600 × 1000 · 2x",
    "Display 21600 × 1000 · 2x",
    "Virtual display1280 × 800 · 1x",
  ]);
  const one = list.getByRole("button", { name: /^Display 1/ });
  const two = list.getByRole("button", { name: /^Display 2/ });
  await expect(one).toHaveAttribute("aria-pressed", "true");

  // The press asks; the mark stays where the remote last said it was.
  await two.click();
  await expect
    .poll(() => sentOf(staged, "selectDisplay"))
    .toEqual([{ type: "selectDisplay", id: 2 }]);
  await expect(one).toHaveAttribute("aria-pressed", "true");
  await expect(two).toHaveAttribute("aria-pressed", "false");

  // The remote's answer moves it, with the list still open to show it.
  staged.say({ type: "displays", active: 2, displays: DISPLAYS });
  await expect(two).toHaveAttribute("aria-pressed", "true");
  await expect(one).toHaveAttribute("aria-pressed", "false");
});

// A Mirrored session of a Mac with several screens lists them, and the page
// shows the ones the stream cannot switch to as unavailable, with why and the
// way: the Mac's stream carries its main screen whatever screen is asked for
// (measured on macOS 27, 2026-10-08), so a press on another sends nothing, and
// the information sheet says the same under the remote screen's row.
test("a Mirrored session lists the Mac's screens, the others unavailable, and says why", async ({
  page,
}) => {
  const staged = await stageSession(page);
  staged.change("connected", (message) => ({ ...message, subtype: "ard-mirror" }));
  await logInAndConnectTo(page, target);
  staged.say({ type: "displays", active: 1, displays: DISPLAYS.slice(1, 3) });
  const bar = await openBar(page);
  await bar.getByRole("button", { name: "Screens" }).click();
  const sheet = page.getByRole("dialog", { name: "Screens" });
  const list = sheet.getByRole("group", { name: "Screens" });
  const one = list.getByRole("button", { name: /^Display 1/ });
  const two = list.getByRole("button", { name: /^Display 2/ });
  await expect(one).toHaveAttribute("aria-pressed", "true");
  await expect(two).toBeDisabled();
  const why =
    "In Mirrored mode the Mac sends its main display. To choose another, open the Mac in Virtual.";
  await expect(sheet).toContainText(why);
  await two.click({ force: true });
  await page.waitForTimeout(300);
  expect(sentOf(staged, "selectDisplay")).toEqual([]);
  await sheet.getByRole("button", { name: "Close" }).click();
  await (await openMore(page))
    .getByRole("button", { name: "Information" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Information" }).getByRole("tabpanel"),
  ).toContainText(why);
});

// Answer the page's request for the remote's clipboard, as the gateway would.
async function answerClipboard(
  staged: Staged,
  asked: number,
  snapshot: { text: string; oversizedBytes?: number; unconfirmed?: boolean },
): Promise<void> {
  await expect
    .poll(() => sentOf(staged, "clipboardRequest").length)
    .toBeGreaterThan(asked);
  staged.say({
    type: "clipboard",
    requested: true,
    text: snapshot.text,
    changedAtMs: null,
    oversizedBytes: snapshot.oversizedBytes ?? null,
    unconfirmed: snapshot.unconfirmed ?? false,
  });
}

async function openClipboard(page: Page): Promise<Locator> {
  await (await openMore(page))
    .getByRole("button", { name: "Clipboard" })
    .click();
  return page.getByRole("dialog", { name: "Clipboard" });
}

const localClipboard = (page: Page) =>
  page.evaluate(() => navigator.clipboard.readText());

test("the clipboard shows the remote's text as it is, with no field and nothing focused, and touches this browser's only on Copy", async ({
  page,
  browserName,
}) => {
  // The spec reads and writes this browser's clipboard itself, to know what the
  // page did to it, and Apple's engine lets a script do that only inside a
  // person's own paste.
  test.skip(
    browserName === "webkit",
    "Apple's engine gives a script no way to read the clipboard the spec compares",
  );
  const staged = await session(page);
  const remote = "line one\nline two";
  await page.evaluate(() =>
    navigator.clipboard.writeText("this browser's own"),
  );

  const sheet = await openClipboard(page);
  await expect(sheet.getByRole("status").first()).toHaveText(
    "Fetching from the remote computer…",
  );
  await answerClipboard(staged, 0, { text: remote });

  // The text as it is, in a box that is no field, and how much there is; no
  // field on the sheet, and the focus on the sheet itself, not on anything
  // that would bring a phone's keyboard up.
  const box = sheet.getByLabel("On the remote computer");
  await expect(box).toHaveText(remote);
  await expect(sheet).toContainText("17 characters, 2 lines");
  await expect(sheet.getByRole("textbox")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.activeElement?.tagName),
    "nothing that takes typing has the focus",
  ).not.toMatch(/INPUT|TEXTAREA/);
  expect(await localClipboard(page)).toBe("this browser's own");

  // Copy takes the remote's text to this browser, and says so beside itself.
  await sheet.getByRole("button", { name: "Copy to this device" }).click();
  await expect(sheet.getByText("Copied.")).toBeVisible();
  expect(await localClipboard(page)).toBe(remote);

  // Write… is the one thing that opens a field, with the focus, and Send sends
  // what was written.
  await sheet.getByRole("button", { name: "Write…" }).click();
  const field = sheet.getByLabel("From this device");
  await expect(field).toBeFocused();
  await field.fill("typed here");
  await sheet.getByRole("button", { name: "Send", exact: true }).click();
  await expect(sheet.getByText("Sent to the remote computer.")).toBeVisible();
  await expect
    .poll(() => sentOf(staged, "clipboard").map((message) => message.text))
    .toContain("typed here");

  // Nothing to send is said, not sent.
  await field.fill("");
  await sheet.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    sheet.getByText("Type some text before sending."),
  ).toBeVisible();
  expect(sentOf(staged, "clipboard")).toHaveLength(1);
});

test("a clipboard too large to transfer, and one the remote never announced, are each said", async ({
  page,
}) => {
  const staged = await session(page);

  let sheet = await openClipboard(page);
  await answerClipboard(staged, 0, { text: "", oversizedBytes: 2_000_000 });
  await expect(sheet.getByLabel("On the remote computer")).toHaveText(
    "Text from the remote computer: 2 MB",
  );
  await expect(sheet).toContainText(
    "Too large to transfer. Copy less on the remote computer.",
  );
  await sheet.getByRole("button", { name: "Copy to this device" }).click();
  await expect(
    sheet.getByText("The remote clipboard is too large to transfer."),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  sheet = await openClipboard(page);
  await answerClipboard(staged, 1, { text: "", unconfirmed: true });
  await expect(sheet.getByRole("note")).toHaveText(
    "This computer has not announced a clipboard. Text may not arrive.",
  );
  await sheet.getByRole("button", { name: "Write…" }).click();
  await sheet.getByLabel("From this device").fill("anything");
  await sheet.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    sheet.getByText("Sent, but this computer may ignore it."),
  ).toBeVisible();
});

const keyboard = (page: Page) =>
  page.getByRole("group", { name: "Keyboard" }).first();

async function openKeyboard(page: Page): Promise<Locator> {
  const bar = await openBar(page);
  await bar.getByRole("button", { name: "Keyboard" }).click();
  await expect(keyboard(page)).toBeVisible();
  return keyboard(page);
}

const key = (board: Locator, name: string) =>
  board.getByRole("button", { name, exact: true }).first();

// What a phone's Sticky key is called: what it does while it is on.
const STICKY = "Hold Shift, Ctrl, Alt and Super until the next key";

test("the keyboard on screen sends what a keyboard would: a key when it is let go, a held Shift once, Caps as a Shift around each letter, Fn's keys, an editing key at once and again while held", async ({
  page,
}) => {
  const staged = await session(page);
  const board = await openKeyboard(page);

  // It is input: the remote stays live under it, and nothing says view only.
  // A key of the real keyboard goes to the remote with nothing putting the
  // focus there: the bar's button, pressed with a pointer, gave it back.
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.keyboard.press("q");
  await expect.poll(() => keys(staged)).toEqual(["+KeyQ", "-KeyQ"]);

  // A key says it is being pressed, for as long as it is, and goes when it is
  // let go: down, then up.
  await key(board, "a").hover();
  await page.mouse.down();
  await expect(key(board, "a")).toHaveAttribute("data-al-held", "");
  await page.mouse.up();
  await expect(key(board, "a")).not.toHaveAttribute("data-al-held");
  await expect.poll(() => keys(staged).slice(2)).toEqual(["+KeyA", "-KeyA"]);

  // A press that slides to the key beside it before it is let go is that key's,
  // and one let go off the keyboard is no key: what follows it is all that left.
  await key(board, "z").hover();
  await page.mouse.down();
  await key(board, "x").hover();
  await expect(key(board, "x")).toHaveAttribute("data-al-held", "");
  await page.mouse.up();
  await expect.poll(() => keys(staged).slice(4)).toEqual(["+KeyX", "-KeyX"]);
  await key(board, "z").hover();
  await page.mouse.down();
  await board.getByRole("button", { name: "Drag to move" }).hover();
  await expect(key(board, "z")).not.toHaveAttribute("data-al-held");
  await page.mouse.up();

  // Shift stays held for one key, and shows what that key will type.
  await key(board, "Shift").click();
  await expect(key(board, "Shift")).toHaveAttribute("aria-pressed", "true");
  await key(board, "A").click();
  await expect
    .poll(() => keys(staged).slice(6))
    .toEqual(["+ShiftLeft", "+KeyA", "-KeyA", "-ShiftLeft"]);
  await expect(key(board, "Shift")).toHaveAttribute("aria-pressed", "false");
  await key(board, "a").click();
  await expect.poll(() => keys(staged).slice(10)).toEqual(["+KeyA", "-KeyA"]);
  // Nothing locks: pressed a second time it is let go, and the key after is plain.
  await key(board, "Shift").click();
  await expect(key(board, "Shift")).toHaveAttribute("aria-pressed", "true");
  await key(board, "Shift").click();
  await expect(key(board, "Shift")).toHaveAttribute("aria-pressed", "false");
  await key(board, "s").click();
  await expect.poll(() => keys(staged).slice(12)).toEqual(["+KeyS", "-KeyS"]);

  // Caps Lock is this keyboard's own: a Shift around each letter, nothing held
  // on the remote, and with Shift too the letter is small again.
  await key(board, "Caps Lock").click();
  await expect(key(board, "Caps Lock")).toHaveAttribute("aria-pressed", "true");
  await key(board, "B").click();
  await expect
    .poll(() => keys(staged).slice(14))
    .toEqual(["+ShiftLeft", "+KeyB", "-KeyB", "-ShiftLeft"]);
  await key(board, "1").click();
  await expect
    .poll(() => keys(staged).slice(18))
    .toEqual(["+Digit1", "-Digit1"]);
  await key(board, "Shift").click();
  await key(board, "b").click();
  await expect.poll(() => keys(staged).slice(20)).toEqual(["+KeyB", "-KeyB"]);
  await key(board, "Caps Lock").click();
  await expect(key(board, "Caps Lock")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Fn brings the function and navigation keys, and moves no other key.
  await expect(key(board, "F5")).toHaveCount(0);
  const before = await key(board, "a").boundingBox();
  await key(board, "Function and navigation keys").click();
  await key(board, "F5").click();
  await expect.poll(() => keys(staged).slice(22)).toEqual(["+F5", "-F5"]);
  const after = await key(board, "a").boundingBox();
  expect(after?.x).toBe(before?.x);

  // A key is a button like any other: reached with the real keyboard and pressed
  // with it, which is the key too, and is not the remote's Enter.
  await key(board, "d").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => keys(staged).slice(24)).toEqual(["+KeyD", "-KeyD"]);
  // A window has every key of a keyboard and no switch for its modifiers: the
  // sentence under the keys says what they do.
  await expect(key(board, STICKY)).toHaveCount(0);
  await expect(
    board.getByText("Shift, Ctrl, Alt and Super stay held until the next key."),
  ).toBeVisible();

  // An editing key goes at once, with the pointer still on it, and again for as
  // long as it is held: every tick a whole press and release.
  await key(board, "Bksp").hover();
  await page.mouse.down();
  await expect
    .poll(() => keys(staged).slice(26, 28))
    .toEqual(["+Backspace", "-Backspace"]);
  await expect(key(board, "Bksp")).toHaveAttribute("data-al-held", "");
  await expect
    .poll(() => keys(staged).slice(28, 30))
    .toEqual(["+Backspace", "-Backspace"]);
  await page.mouse.up();
  await expect(key(board, "Bksp")).not.toHaveAttribute("data-al-held");
});

test("the keyboard's window is carried with the arrows and never leaves the page", async ({
  page,
}) => {
  await session(page);
  const board = await openKeyboard(page);
  const grip = board.getByRole("button", { name: "Drag to move" });
  const size = page.viewportSize() ?? { width: 0, height: 0 };

  // Sixteen pixels a press: more presses than the page is wide or tall.
  for (const [arrow, presses] of [
    ["ArrowLeft", 90],
    ["ArrowUp", 70],
    ["ArrowRight", 180],
    ["ArrowDown", 140],
  ] as const) {
    await grip.focus();
    for (let press = 0; press < presses; press += 1) {
      await page.keyboard.press(arrow);
    }
    const box = await board.boundingBox();
    expect(box, arrow).not.toBeNull();
    expect(box?.x, arrow).toBeGreaterThanOrEqual(0);
    expect(box?.y, arrow).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0), arrow).toBeLessThanOrEqual(
      size.width,
    );
    expect((box?.y ?? 0) + (box?.height ?? 0), arrow).toBeLessThanOrEqual(
      size.height,
    );
  }
  // And it did move: it ends against the right and the bottom edges.
  const end = await board.boundingBox();
  expect((end?.x ?? 0) + (end?.width ?? 0)).toBeGreaterThan(size.width - 16);
  expect((end?.y ?? 0) + (end?.height ?? 0)).toBeGreaterThan(size.height - 16);
});

// The keys of a phone's strip, on both of its pages, by what each is called.
const STRIP = [
  "Tab",
  "Esc",
  "Ctrl",
  "Alt",
  "Super",
  "Left arrow",
  "Up arrow",
  "Down arrow",
  "Right arrow",
];

// The keys whose words do not fit them, by what is written on each.
const cut = (board: Locator) =>
  board.evaluate((element) =>
    Array.from(element.querySelectorAll(".al-key"))
      .filter((cap) => cap.scrollWidth > cap.clientWidth)
      .map((cap) => cap.textContent),
  );

for (const [held, viewport] of [
  ["upright", { width: 390, height: 844 }],
  ["on its side", { width: 860, height: 412 }],
] as const) {
  test(`on a phone ${held} the keyboard is docked, in two pages of the same rows, and never a window`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport, hasTouch: true });
    const page = await context.newPage();
    await withFingers(page);
    const staged = await session(page);
    // A phone is given the whole screen by its Open.
    const whole = () =>
      page.evaluate(() => document.fullscreenElement !== null);
    await expect.poll(whole).toBe(true);
    const board = await openKeyboard(page);

    await expect(
      board.getByRole("button", { name: "Drag to move" }),
    ).toHaveCount(0);
    // Docked: as wide as the page, and at its bottom edge.
    const box = await board.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.width).toBe(viewport.width);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(viewport.height, 3);
    // The bar gives its place to the keyboard.
    await expect(page.getByRole("toolbar")).toHaveCount(0);

    // The first page: the strip and its arrows over the letters, each word whole.
    for (const name of STRIP) {
      await expect(key(board, name)).toBeVisible();
    }
    expect(await cut(board)).toEqual([]);
    await key(board, "a").tap();
    await expect.poll(() => keys(staged)).toEqual(["+KeyA", "-KeyA"]);

    // A tapped Ctrl is held for the next key, and spent by it.
    await key(board, "Ctrl").tap();
    await expect(key(board, "Ctrl")).toHaveAttribute("aria-pressed", "true");
    await key(board, "c").tap();
    await expect
      .poll(() => keys(staged).slice(2))
      .toEqual(["+ControlLeft", "+KeyC", "-KeyC", "-ControlLeft"]);
    await expect(key(board, "Ctrl")).toHaveAttribute("aria-pressed", "false");
    // A chord of the row that slides is sent as the chord.
    await key(board, "Alt+Tab").tap();
    await expect
      .poll(() => keys(staged).slice(6))
      .toEqual(["+AltLeft", "+Tab", "-Tab", "-AltLeft"]);

    // With the Sticky key off, a modifier is a key like any other, sent alone.
    const sticky = key(board, STICKY);
    await expect(sticky).toHaveAttribute("aria-pressed", "true");
    await sticky.tap();
    await expect(sticky).toHaveAttribute("aria-pressed", "false");
    await key(board, "Super").tap();
    await expect
      .poll(() => keys(staged).slice(10))
      .toEqual(["+MetaLeft", "-MetaLeft"]);
    await expect(key(board, "Super")).not.toHaveAttribute("aria-pressed");

    // The second page, from the key in the corner: the same strip, F1 to F12 where
    // the chords were, the Sticky key as it was left, and the keyboard no taller
    // or shorter, so the picture above it does not move.
    await key(board, "?123").tap();
    await expect(key(board, "ABC")).toBeVisible();
    for (const name of [...STRIP, "F1"]) {
      await expect(key(board, name)).toBeVisible();
    }
    expect(await cut(board)).toEqual([]);
    expect(await board.boundingBox()).toEqual(box);
    await expect(sticky).toHaveAttribute("aria-pressed", "false");
    await sticky.tap();
    await expect(sticky).toHaveAttribute("aria-pressed", "true");
    // A symbol that needs Shift is a key of its own: Shift and the key.
    await key(board, "_").tap();
    await expect
      .poll(() => keys(staged).slice(12))
      .toEqual(["+ShiftLeft", "+Minus", "-Minus", "-ShiftLeft"]);

    // A modifier held here has no key on the first page, and is named there until
    // the key that spends it.
    await key(board, "RAlt").tap();
    await expect(key(board, "RAlt")).toHaveAttribute("aria-pressed", "true");
    await key(board, "ABC").tap();
    await expect(key(board, "?123")).toBeVisible();
    await expect(board.getByText("RAlt", { exact: true })).toBeVisible();
    await key(board, "e").tap();
    await expect
      .poll(() => keys(staged).slice(16))
      .toEqual(["+AltRight", "+KeyE", "-KeyE", "-AltRight"]);
    await expect(board.getByText("RAlt", { exact: true })).toHaveCount(0);

    await board.getByRole("button", { name: "Close" }).click();
    await leaveSession(page);
    // And hands it back with the session.
    await expect.poll(whole).toBe(false);
    await context.close();
  });
}

// A table of the information sheet, measured: the height of each row, and how far
// each cell's content sits from the middle of its row.
const tables = (panel: Locator) =>
  panel.evaluate((element) =>
    Array.from(element.querySelectorAll("dl"))
      .filter((list) => list.querySelector(":scope > dt"))
      .map((list) =>
        Array.from(list.children).map((cell) => {
          const box = cell.getBoundingClientRect();
          const content = document.createRange();
          content.selectNodeContents(cell);
          const drawn = content.getBoundingClientRect();
          return {
            height: Math.round(box.height),
            offCentre: Math.abs(
              (drawn.top + drawn.bottom) / 2 - (box.top + box.bottom) / 2,
            ),
          };
        }),
      ),
  );

test("every table of the information has rows of one height, with both columns in the middle of the row", async ({
  page,
}) => {
  await session(page);
  // The handle's hint is the sentence, and no chord to read as punctuation.
  await expect(handle(page)).toHaveAttribute("title", "Open the session bar");
  await (await openMore(page))
    .getByRole("button", { name: "Information" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Information" });
  const panel = sheet.getByRole("tabpanel");

  for (const tab of ["Shortcuts", "Keys", "Touch gestures"]) {
    await sheet.getByRole("tab", { name: tab }).click();
    const measured = await tables(panel);
    expect(measured.length, tab).toBeGreaterThan(0);
    for (const rows of measured) {
      expect(
        new Set(rows.map((cell) => cell.height)).size,
        `${tab}: row heights`,
      ).toBe(1);
      for (const cell of rows) {
        expect(
          cell.offCentre,
          `${tab}: a cell off the middle of its row`,
        ).toBeLessThan(1.5);
      }
    }
  }

  // The chord that hides the handle is this device's, and not both devices'.
  await sheet.getByRole("tab", { name: "Shortcuts" }).click();
  await expect(panel.locator("dd").first().locator("kbd")).toHaveCount(4);
});

test("opening Details does not move what is above it, where the scroll bar takes room", async ({
  page,
  browserName,
}) => {
  // A window short enough for the sheet to scroll once Details is open. Its
  // scroll bar is styled below so that it takes width, as Windows' does (see the
  // launch option above): a styled scroll bar is never drawn over the content.
  // Apple's engine gives a styled scroll bar its room too, but reserves none for
  // the gutter (measured on 2026-10-08: 15 px taken, 0 px reserved), so the
  // sheet's rule cannot hold there and the spec does not ask it to.
  test.skip(
    browserName === "webkit",
    "Apple's engine reserves no gutter for a styled scroll bar",
  );
  await page.setViewportSize({ width: 1280, height: 620 });
  await session(page);
  await page.addStyleTag({
    content: ".al-drop::-webkit-scrollbar { width: 15px; }",
  });
  await (await openMore(page))
    .getByRole("button", { name: "Information" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Information" });
  const above = () =>
    sheet.getByText("Remote screen", { exact: true }).evaluate((cell) => {
      const box = cell.getBoundingClientRect();
      return { x: box.x, width: box.width };
    });
  const scrolls = () =>
    sheet.evaluate((element) => element.scrollHeight > element.clientHeight);

  const before = await above();
  expect(await scrolls()).toBe(false);
  await sheet.getByText("Details").click();
  expect(await scrolls()).toBe(true);
  expect(await above()).toEqual(before);
});

test("the information says this session, the shortcuts, both key tables and the gestures", async ({
  page,
}) => {
  await session(page);
  await (await openMore(page))
    .getByRole("button", { name: "Information" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Information" });
  const tabs = sheet.getByRole("tablist", { name: "Information" });
  await expect(tabs.getByRole("tab")).toHaveText([
    "This session",
    "Shortcuts",
    "Keys",
    "Touch gestures",
  ]);

  const panel = sheet.getByRole("tabpanel");
  await expect(panel).toContainText("Remote screen");
  await expect(panel).toContainText("640 × 480");
  await expect(panel).toContainText("None in this session");
  // The harness keeps no meter, so there is none to open.
  await expect(sheet.getByRole("button", { name: "Throughput" })).toHaveCount(
    0,
  );
  await panel.getByText("Details").click();
  await expect(panel).toContainText("Remote Desktop");

  await tabs.getByRole("tab", { name: "Shortcuts" }).click();
  await expect(panel).toContainText("Hide or show the bar's handle");

  // Both tables, whichever keyboard this is.
  await tabs.getByRole("tab", { name: "Keys" }).click();
  await expect(panel).toContainText("A Mac keyboard with a PC, with Mac keys");
  await expect(panel).toContainText(
    "A PC keyboard with a Mac: the key you press, and the one that arrives",
  );

  await tabs.getByRole("tab", { name: "Touch gestures" }).click();
  await expect(panel).toContainText("Two-finger pinch");
  await expect(panel.getByRole("note")).toHaveCount(0);
});

test("a resize, a desktop too large and too many screens each cover the remote with the reason and the ways out", async ({
  page,
}) => {
  const staged = await session(page);

  staged.say({ type: "resizing", active: true });
  await expect(
    page.getByRole("status").filter({ hasText: "Resizing…" }),
  ).toBeVisible();
  // It says so over the remote, and nothing pressed is sent while it does: a
  // press would land on a screen nobody can see yet.
  const box = await surface(page).boundingBox();
  const press = () =>
    page.mouse.click(
      (box?.x ?? 0) + 40,
      (box?.y ?? 0) + (box?.height ?? 0) - 40,
    );
  await press();
  staged.say({ type: "resizing", active: false });
  await expect(page.getByText("Resizing…")).toHaveCount(0);
  // Lifted, the remote takes input again. A key goes behind the press, so by the
  // time it is seen everything a press sent has been: one press, down and up.
  await press();
  await type(page, "z");
  await expect.poll(() => keys(staged)).toContain("+KeyZ");
  expect(sentOf(staged, "mouseButton")).toHaveLength(2);

  // Too large, with nothing else to show.
  staged.say({ type: "oversize", cause: "size" });
  const cover = page.getByRole("alert", {
    name: "The remote screen cannot be shown right now.",
  });
  await expect(cover.getByRole("heading")).toHaveText("Too large to show");
  await expect(cover).toContainText(
    "The remote screen is 640×480 pixels, past what a video stream carries.",
  );
  await expect(cover).toContainText(
    "Nothing can be shown until the remote computer's screen is smaller.",
  );
  await expect(cover.getByRole("button")).toHaveCount(0);

  // Too many screens: every other one is a way out, the one being sent is not.
  staged.say({ type: "displays", active: 0, displays: DISPLAYS });
  staged.say({ type: "oversize", cause: "screens" });
  await expect(cover.getByRole("heading")).toHaveText(
    "Too many screens to show",
  );
  await expect(cover).toContainText(
    '"All screens" joins more than two screens, which is more than one view shows.',
  );
  await expect(cover.getByRole("button")).toHaveText([
    "Display 1",
    "Display 2",
    "Virtual display",
  ]);
  await cover.getByRole("button", { name: "Display 2" }).click();
  await expect
    .poll(() => sentOf(staged, "selectDisplay"))
    .toEqual([{ type: "selectDisplay", id: 2 }]);

  staged.say({ type: "oversize", cause: null });
  await expect(cover).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a picture that has not come is waited for on the lit screen, under the session's name, with no title and no banner", async ({
  page,
}) => {
  const staged = await session(page);

  // The gateway's word: the display's picture is not here yet. The wait is the
  // screen that lights, lit part of the way, with the plate of the opening: the
  // session's name and the one line, and no box with a title in the middle.
  staged.say({ type: "screenUnavailable", active: true });
  const waiting = page
    .getByRole("status")
    .filter({ hasText: "Waiting for the remote screen…" });
  await expect(waiting).toBeVisible();
  await expect(waiting.getByRole("heading", { level: 1 })).toHaveText(target);
  await expect(page.getByText("Screen not available")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Screen not available" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  // A resize said while the picture is waited for takes the line over: the
  // picture is waited for because of it.
  staged.say({ type: "resizing", active: true });
  await expect(
    page.getByRole("status").filter({ hasText: "Resizing…" }),
  ).toBeVisible();
  await expect(page.getByText("Waiting for the remote screen…")).toHaveCount(0);
  staged.say({ type: "resizing", active: false });
  await expect(waiting).toBeVisible();

  // The picture is on its way: the screen goes, and nothing of it stays.
  staged.say({ type: "screenUnavailable", active: false });
  await expect(waiting).toHaveCount(0);
  await expect(page.getByText("Resizing…")).toHaveCount(0);
});

test("a session that was on screen and fell is said in a dialog that only its button closes", async ({
  page,
}) => {
  const staged = await session(page);
  // What an engine that ended sends: its own sentence, the cause the page says
  // in the person's language, and that there is no session.
  const sentence = "VNC session ended: the VNC server closed the connection";
  staged.say({
    type: "error",
    message: sentence,
    cause: { code: "AL-7711", fill: {} },
  });
  staged.say({ type: "picker" });

  const dialog = page.getByRole("alertdialog", { name: "The session ended" });
  // The cause's own words, and nothing of the gateway's sentence among them.
  await expect(dialog.getByRole("paragraph")).toHaveText(
    "The remote computer closed the connection. Open it again.",
  );
  // The sentence is kept for whoever asks, beside the code, named for what it is.
  await dialog.getByText("Details").click();
  await expect(dialog).toContainText("Code AL-7711");
  await expect(dialog).toContainText(`Original text ${sentence}`);
  // One way on, and Escape is not it, however often it is pressed.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Back to the computers" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your computers" }),
  ).toBeVisible();
  // Read once: the list does not say it again.
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a session that fell with no cause named is said to have ended, its sentence kept for whoever asks", async ({
  page,
}) => {
  const staged = await session(page);
  const sentence =
    "VNC session ended: a zrle run of 12 overruns the 4 pixels its tile has left";
  staged.say({ type: "error", message: sentence, cause: null });
  staged.say({ type: "picker" });

  const dialog = page.getByRole("alertdialog", { name: "The session ended" });
  // The general words of a session that ended, never the gateway's sentence.
  await expect(dialog.getByRole("paragraph")).toHaveText(
    "The session with the remote computer ended. Open it again.",
  );
  await dialog.getByText("Details").click();
  await expect(dialog).toContainText("Code AL-7700");
  await expect(dialog).toContainText(`Original text ${sentence}`);
  await dialog.getByRole("button", { name: "Back to the computers" }).click();
});

test("a session that fell is said in Portuguese by its cause, the gateway's sentence kept under Detalhes", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "pt-BR" });
  const page = await context.newPage();
  const staged = await stageSession(page);
  await logInSpeaking(page, "pt-BR");
  await computerRow(page, target)
    .getByRole("button", { name: /^Abrir / })
    .click();
  await expect(
    page.getByRole("button", { name: /^Abrir a barra da sessão/ }),
  ).toBeVisible(UP);

  // What Windows says when it ends an idle session, as the gateway words it.
  const sentence =
    "RDP session ended: the server ended the session: the session was idle for longer than the host allows (0x00000003)";
  staged.say({
    type: "error",
    message: sentence,
    cause: { code: "AL-7112", fill: {} },
  });
  staged.say({ type: "picker" });

  const dialog = page.getByRole("alertdialog", { name: "A sessão terminou" });
  await expect(dialog.getByRole("paragraph")).toHaveText(
    "A sessão ficou parada por mais tempo do que o computador remoto permite. Abra de novo.",
  );
  await dialog.getByText("Detalhes").click();
  await expect(dialog).toContainText("Código AL-7112");
  await expect(dialog).toContainText(`Texto original ${sentence}`);
  await dialog.getByRole("button", { name: "Voltar aos computadores" }).click();
  await context.close();
});

test("Sign out asks first, with the focus on Cancel; Escape cancels and gives the focus back", async ({
  page,
}) => {
  await session(page);
  const menu = await openMore(page);
  const signOut = menu.getByRole("button", { name: "Sign out" });
  // From the keyboard, whose user the focus is given back for: a press with a
  // pointer leaves no focus on a button in Apple's engine to give back.
  await signOut.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("alertdialog", {
    name: "Sign out and end the session?",
  });
  await expect(dialog).toContainText(
    `The session open with ${target} ends now. Whatever is open on the remote computer stays there.`,
  );
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(signOut).toBeFocused();
  await expect(
    page.getByRole("toolbar", { name: "Session bar" }),
  ).toBeVisible();

  await signOut.click();
  await dialog.getByRole("button", { name: "Sign out and end" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("a sound this browser cannot decode is said with its code, hanging from the bar, and marked on the handle", async ({
  page,
}) => {
  // The gateway's format, with a codec no browser has.
  const sound = await stageSession(page, SOUND_SOCKET);
  sound.change("audioFormat", (format) => ({
    ...format,
    codec: "no-such-codec",
  }));
  await logInAndConnectTo(page, target, "", { sound: true });

  await expect(handle(page)).toHaveAccessibleName(
    "Open the session bar. Something needs attention.",
    UP,
  );
  await handle(page).click();
  const said = page.getByRole("alert");
  await expect(said).toContainText(
    "This browser cannot decode the sound the server sends (no-such-codec). Open the session in another browser, or carry on without sound. AL-5102",
  );
  await expect(
    said.getByRole("button", { name: "Turn on again" }),
  ).toBeVisible();
});

test("a session muted here says so on the bar's button and on the closed bar's handle, until the sound is back", async ({
  page,
}) => {
  await stageSession(page);
  await logInAndConnectTo(page, target, "", { sound: true });
  await expect(handle(page)).toHaveAccessibleName(/^Open the session bar$/, UP);
  // What the handle and the button draw is read as what they hold, and not as
  // pixels: the handle one drawing more, the button another drawing.
  await expect(handle(page).locator("svg")).toHaveCount(1);

  const mute = (await openBar(page)).getByRole("button", {
    name: "Mute",
    exact: true,
  });
  const drawn = () => mute.locator("svg").innerHTML();
  const speaker = await drawn();
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await expect.poll(drawn).not.toBe(speaker);

  // A press on the remote screen closes the bar, and the handle keeps it in sight.
  await surface(page).click();
  await expect(handle(page)).toHaveAccessibleName(
    "Open the session bar. The sound is muted here.",
  );
  await expect(handle(page).locator("svg")).toHaveCount(2);

  await openBar(page);
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  await expect.poll(drawn).toBe(speaker);
  await surface(page).click();
  await expect(handle(page)).toHaveAccessibleName(/^Open the session bar$/);
  await expect(handle(page).locator("svg")).toHaveCount(1);
});

// One real VP9 picture of 64 × 64, made once with ffmpeg's libvpx-vp9 and kept
// as its bytes: what a browser's own decoder takes as the first unit of a stream
// announced as `vp09.00.10.08`.
const VP9_KEYFRAME = Buffer.from(
  "gkmDQgAD8AP2ADgkHBiMAAAwcAAAfIsf+xgN///tkIP/++jjnm2URAA=",
  "base64",
);

// A batch of one VIDEO record, as `batch` in src/protocol.rs lays it out: the
// frame's kind and flags, the count of records, the batch's sequence, then the
// record's op, its flags (bit 0 a keyframe), the picture's size and the unit.
// Written here and not taken from the page's reader, which is what reads it.
function videoBatch(sequence: number, unit: Buffer): Buffer {
  const head = Buffer.alloc(18);
  head.writeUInt8(0x02, 0);
  head.writeUInt8(0, 1);
  head.writeUInt16LE(1, 2);
  head.writeUInt32LE(sequence, 4);
  head.writeUInt8(0x03, 8);
  head.writeUInt8(0x01, 9);
  head.writeUInt16LE(64, 10);
  head.writeUInt16LE(64, 12);
  head.writeUInt32LE(unit.length, 14);
  return Buffer.concat([head, unit]);
}

test("a video decoder that fails is asked for its picture again until one is painted, with what the browser said under Details", async ({
  page,
}) => {
  const staged = await session(page);
  // The gateway of the harness sends no picture: it is not to hear of batches
  // it never sent, nor to answer the asks this test counts.
  staged.keep("refresh", "paintAck");
  const asked = () => sentOf(staged, "refresh").length;
  const before = asked();

  staged.say({
    type: "videoFormat",
    decode: "vp09.00.10.08",
    passthrough: false,
  });
  // A keyframe by its header, which is all a browser reads before it hands the
  // unit to its decoder, and no picture after it: the decoder is what fails.
  const broken = Buffer.concat([
    VP9_KEYFRAME.subarray(0, 12),
    Buffer.alloc(VP9_KEYFRAME.length - 12, 0xff),
  ]);
  staged.paint(videoBatch(1, broken));

  const said = page.getByRole("alert");
  await expect(said).toContainText(
    "This browser's video decoder failed. The picture comes back by itself on the next full frame; if it does not, reload the page. AL-4602",
    UP,
  );
  // What the browser said of its decoder, as it came, for whoever asks.
  await said.getByText("Details").click();
  await expect(said.getByText(/^Original text \S/)).toBeVisible();

  // Asked for at once, and again while no picture is painted: three asks are
  // two waits, and one alone is what left the picture away for good.
  await expect
    .poll(() => asked() - before, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(3);

  // The keyframe comes and is painted: nothing is said any more.
  staged.paint(videoBatch(2, VP9_KEYFRAME));
  await expect(said).toHaveCount(0);
  // And nothing more is asked. Two waits with no ask is the proof: while the
  // picture was away one came at every wait.
  const settled = asked();
  await page.waitForTimeout(4_500);
  expect(asked(), "asked again with the picture painted").toBe(settled);

  // The decoder fails again: a new debt, asked for at once. The session's end
  // forgets it, for the picture is the next session's to bring.
  staged.paint(videoBatch(3, broken));
  await expect.poll(() => asked() - settled).toBeGreaterThanOrEqual(1);
  await returnToPicker(page);
  const ended = asked();
  await page.waitForTimeout(4_500);
  expect(asked(), "asked with the session ended").toBe(ended);
});

test("a picture that asking does not bring back is said so, and coming back into sight asks for it again", async ({
  page,
}) => {
  // Half a minute of asking is what this waits out.
  test.setTimeout(120_000);
  const staged = await session(page);
  staged.keep("refresh", "paintAck");
  const asked = () => sentOf(staged, "refresh").length;

  staged.say({
    type: "videoFormat",
    decode: "vp09.00.10.08",
    passthrough: false,
  });
  staged.paint(
    videoBatch(
      1,
      Buffer.concat([
        VP9_KEYFRAME.subarray(0, 12),
        Buffer.alloc(VP9_KEYFRAME.length - 12, 0xff),
      ]),
    ),
  );

  // No picture comes for all the time it is asked for: the page stops asking
  // and says so, with what the browser said still behind Details.
  const said = page.getByRole("alert");
  await expect(said).toContainText(
    "The picture stopped, and asking the server for it again did not bring it back. Reload the page. AL-4609",
    { timeout: 45_000 },
  );
  await expect(said.getByRole("button", { name: "Reload" })).toBeVisible();
  await said.getByText("Details").click();
  await expect(said.getByText(/^Original text \S/)).toBeVisible();

  // The page comes back into sight: what is owed is asked for at once, and
  // again at each wait, as if it had just been cut.
  const gaveUpAt = asked();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect.poll(() => asked() - gaveUpAt).toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => asked() - gaveUpAt, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(3);

  // And the keyframe, when it comes, is the end of it.
  staged.paint(videoBatch(2, VP9_KEYFRAME));
  await expect(said).toHaveCount(0);
});

// The windows the mockup is drawn in: a phone upright and on its side, a tablet
// and a desktop. The first three are devices with fingers, where the remote's
// picture is fitted to the width; on the desktop the harness's 640 × 480 fits.
const WINDOWS = [
  { width: 390, height: 844, touch: true },
  { width: 860, height: 412, touch: true },
  { width: 820, height: 1180, touch: true },
  { width: 1440, height: 900, touch: false },
];

const SPOKEN = {
  "en-US": {
    open: /^Open /,
    handle: /^Open the session bar/,
    bar: "Session bar",
    more: "More",
    info: "Information",
    keyboard: "Keyboard",
    tabs: ["Shortcuts", "Keys", "Touch gestures"],
    close: "Close",
    end: "End",
  },
  "pt-BR": {
    open: /^Abrir /,
    handle: /^Abrir a barra da sessão/,
    bar: "Barra da sessão",
    more: "Mais",
    info: "Informações",
    keyboard: "Teclado",
    tabs: ["Atalhos", "Teclas", "Gestos de toque"],
    close: "Fechar",
    end: "Encerrar",
  },
} as const;

for (const locale of ["en-US", "pt-BR"] as const) {
  test(`the bar, the menu, the information and the keyboard fit every window in ${locale}`, async ({
    browser,
  }) => {
    // A session for each window, each waiting on the harness's last (support.ts).
    test.setTimeout(120_000);
    const words = SPOKEN[locale];
    for (const size of WINDOWS) {
      const window = `${locale} ${size.width}×${size.height}`;
      const context = await browser.newContext({
        locale,
        viewport: size,
        hasTouch: size.touch,
      });
      const page = await context.newPage();
      if (size.touch) {
        await withFingers(page);
      }
      await logInSpeaking(page, locale);
      await computerRow(page, target)
        .getByRole("button", { name: words.open })
        .click();
      const grip = page.getByRole("button", { name: words.handle });
      await expect(grip).toBeVisible(UP);

      const fits = async (part: Locator, what: string) => {
        const box = await part.boundingBox();
        expect(box, `${window}: ${what}`).not.toBeNull();
        expect(box?.x, `${window}: ${what}`).toBeGreaterThanOrEqual(0);
        expect(
          (box?.x ?? 0) + (box?.width ?? 0),
          `${window}: ${what}`,
        ).toBeLessThanOrEqual(size.width);
        expect(
          (box?.y ?? 0) + (box?.height ?? 0),
          `${window}: ${what}`,
        ).toBeLessThanOrEqual(size.height);
        const spill = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(spill, `${window}: ${what}`).toBe(0);
      };

      await grip.click();
      const bar = page.getByRole("toolbar", { name: words.bar });
      await fits(bar, "the bar");
      await bar.getByRole("button", { name: words.more }).click();
      const menu = page.getByRole("dialog", { name: words.more });
      await fits(menu, "the menu");
      await menu.getByRole("button", { name: words.info }).click();
      const sheet = page.getByRole("dialog", { name: words.info });
      await fits(sheet, "the information");
      // The line that says view only is read whole: the sheet ends before it or
      // begins after it, however many lines it takes in this window and however
      // tall the sheet is.
      const apart = async (what: string) => {
        const line = await page.getByRole("status").boundingBox();
        const over = await sheet.boundingBox();
        expect(line && over, `${window}: ${what}`).not.toBeNull();
        expect(
          (line?.y ?? 0) + (line?.height ?? 0) <= (over?.y ?? 0) ||
            (over?.y ?? 0) + (over?.height ?? 0) <= (line?.y ?? 0),
          `${window}: the view-only line is under ${what}`,
        ).toBe(true);
      };
      await apart("the information");
      for (const tab of words.tabs) {
        await sheet.getByRole("tab", { name: tab }).click();
        await fits(sheet, `the information, ${tab}`);
        await apart(`the information, ${tab}`);
      }
      await page.keyboard.press("Escape");
      await bar.getByRole("button", { name: words.keyboard }).click();
      const board = page.getByRole("group", { name: words.keyboard }).first();
      await fits(board, "the keyboard");
      await board.getByRole("button", { name: words.close }).click();

      // Hand the session back: the next window opens its own.
      if (!(await bar.isVisible())) {
        await grip.click();
      }
      await bar.getByRole("button", { name: words.end, exact: true }).click();
      await expect(page.getByRole("list")).toBeVisible(UP);
      await context.close();
    }
  });
}

test("a session that opens as the page loads can be handed back from the bar", async ({
  page,
}) => {
  // What every spec here leans on to leave: the bar's End, back to the list.
  await logIn(page);
  await computerRow(page, target)
    .getByRole("button", { name: /^Open / })
    .click();
  await expect(handle(page)).toBeVisible(UP);
  const bar = await openBar(page);
  await bar.getByRole("button", { name: "End", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your computers" }),
  ).toBeVisible(UP);
});

// Whether this browser reads the clipboard on focus: where a read is granted on
// the `clipboard-read` permission it does; where the browser knows no such
// permission and a read needs a gesture that shows the system's "Paste" callout
// (clipboardGesture.ts), the page leaves the clipboard to the sheet's own Paste
// button. Counted at the browser's own method, which the page calls or does not;
// `hasFocus` is said to be true, which a headless window may not be. A browser
// without the permission is stood in by a Permissions API that refuses the name,
// as Safari's and Firefox's do.
async function countClipboardReads(
  page: Page,
  noPermission: boolean,
): Promise<void> {
  await page.addInitScript((noPermission: boolean) => {
    const counted = globalThis as unknown as { alReads: number };
    counted.alReads = 0;
    if (noPermission) {
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (descriptor: PermissionDescriptor) => {
        if ((descriptor as { name: string }).name === "clipboard-read") {
          return Promise.reject(new TypeError("not a supported permission"));
        }
        return query(descriptor);
      };
    }
    document.hasFocus = () => true;
    const clipboard = navigator.clipboard;
    const read = clipboard.readText.bind(clipboard);
    clipboard.readText = () => {
      counted.alReads += 1;
      return read();
    };
  }, noPermission);
}

const clipboardReads = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { alReads: number }).alReads);

test("the clipboard is read on focus where a read is granted on a permission", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Apple's engine reads the clipboard inside a gesture alone",
  );
  await countClipboardReads(page, false);
  await session(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => clipboardReads(page)).toBeGreaterThanOrEqual(1);
});

test("the clipboard is not read on focus where a read needs a gesture", async ({
  page,
}) => {
  await countClipboardReads(page, true);
  await session(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(500);
  expect(await clipboardReads(page)).toBe(0);
});

// "Send what I copied here" reads this browser's clipboard inside the press, in
// every browser, and sends it in the same act: what a browser that reads only on
// a gesture answers with its one callout, and the one press the way from here to
// the remote takes. Nothing copied is said, not sent.
test("Send what I copied here reads this browser's clipboard inside the press and sends it", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Apple's engine answers a read with a callout only a person can tap",
  );
  await countClipboardReads(page, true);
  const staged = await session(page);
  await page.evaluate(() => navigator.clipboard.writeText("from this device"));
  const sheet = await openClipboard(page);
  await answerClipboard(staged, 0, { text: "the remote's" });
  expect(await clipboardReads(page)).toBe(0);
  await sheet.getByRole("button", { name: "Send what I copied here" }).click();
  await expect(sheet.getByText("Sent to the remote computer.")).toBeVisible();
  expect(await clipboardReads(page)).toBe(1);
  await expect
    .poll(() => sentOf(staged, "clipboard").map((message) => message.text))
    .toEqual(["from this device"]);
  // No field was opened for it: the press was the whole act.
  await expect(sheet.getByRole("textbox")).toHaveCount(0);

  await page.evaluate(() => navigator.clipboard.writeText(""));
  await sheet.getByRole("button", { name: "Send what I copied here" }).click();
  await expect(sheet.getByText("Nothing copied on this device.")).toBeVisible();
  expect(sentOf(staged, "clipboard")).toHaveLength(1);
});

// Seven taps on the version switch the page's laboratory (lab.ts), which the
// row says, and from then on what the page sees goes to the gateway in `lab`
// messages within the gateway's limits. Seven more switch it off, and nothing
// more goes.
test("seven taps on the version switch the laboratory, which says so and tells the gateway what the page sees", async ({
  page,
  browserName,
}) => {
  const staged = await session(page);
  await (await openMore(page))
    .getByRole("button", { name: "Information" })
    .click();
  const panel = page
    .getByRole("dialog", { name: "Information" })
    .getByRole("tabpanel");
  const version = panel.getByRole("button", { name: /^\d+\.\d+\.\d+/ });
  const labs = () => sentOf(staged, "lab");
  const sheet = page.getByRole("dialog", { name: "Information" });
  const labTab = sheet.getByRole("tab", { name: "Laboratory" });
  for (let i = 0; i < 6; i++) {
    await version.click();
  }
  await expect(panel).not.toContainText("Lab on");
  await expect(labTab).toHaveCount(0);
  await version.click();
  await expect(panel).toContainText(
    "Lab on: the page tells the gateway what it sees",
  );
  // On, the sheet has the laboratory's tab: a live panel of what the page sees,
  // counted by kind, which counts the moment the page sees it.
  await labTab.click();
  // The gauges: hidden, with its big number; the trace of the last sixty seconds;
  // the last event in words.
  const hidden = panel.getByRole("definition").filter({ hasText: /^\d+×$/ });
  await expect(hidden).toHaveText("0×");
  await expect(panel.getByText("last 60 s")).toBeVisible();
  // Nothing has been seen since it was switched on: no last event yet.
  await expect(panel).not.toContainText("last event");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    delete (document as unknown as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(hidden).toHaveText("1×");
  // Something was seen: the last event is said in words, whichever came last
  // of what coming back into sight set off (the decoder starting over, the
  // keyframe asked for, the gateway's answer).
  await expect(panel).toContainText("last event, ");
  // Copy report puts the panel on this browser's clipboard, which the spec reads
  // back from a script: Apple's engine lets a script do that only inside a
  // person's own paste, so there the button is pressed and the text not read.
  await panel.getByRole("button", { name: "Copy report" }).click();
  if (browserName !== "webkit") {
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/hidden\n\s*1×/);
  }
  await sheet.getByRole("tab", { name: "This session" }).click();
  await expect.poll(() => labs().length).toBeGreaterThanOrEqual(1);
  const first = labs()[0].lines as string[];
  expect(first[0]).toBe("lab: on");
  for (const message of labs()) {
    const lines = message.lines as string[];
    expect(lines.length).toBeLessThanOrEqual(20);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(240);
    }
  }
  // Something the page sees, said: its sight.
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect
    .poll(() => labs().flatMap((message) => message.lines as string[]))
    .toContain("sight: visible");
  // Off: the row says the version's own note again, and nothing more is said.
  for (let i = 0; i < 7; i++) {
    await version.click();
  }
  await expect(panel).not.toContainText("Lab on");
  const said = labs().length;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await page.waitForTimeout(600);
  expect(labs().length).toBe(said);
});

// A page says its sight when the session opens, which is how an engine a page
// reattaches to after hiding is told the page is back. Out of sight it says so,
// and back in sight says so again, drops the decoder it had and asks for the
// keyframe the next one starts at: a unit that is no keyframe is not painted,
// and asking goes on until one is.
test("a page that hides and comes back says so, drops its decoder and starts again at the next keyframe", async ({
  page,
}) => {
  const staged = await session(page);
  staged.keep("refresh", "paintAck");
  const asked = () => sentOf(staged, "refresh").length;
  const sight = () => sentOf(staged, "sight").map((message) => message.visible);
  await expect.poll(sight).toEqual([true]);

  staged.say({
    type: "videoFormat",
    decode: "vp09.00.10.08",
    passthrough: false,
  });
  staged.paint(videoBatch(1, VP9_KEYFRAME));
  await page.waitForTimeout(500);
  const before = asked();

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(sight).toEqual([true, false]);
  await page.evaluate(() => {
    delete (document as unknown as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(sight).toEqual([true, false, true]);
  // The decoder went: a keyframe is asked for at once.
  await expect.poll(() => asked() - before).toBeGreaterThanOrEqual(1);
  // A unit that is no keyframe does not settle it: the asking goes on.
  const delta = videoBatch(2, VP9_KEYFRAME);
  delta.writeUInt8(0x00, 9);
  staged.paint(delta);
  const stillAsking = asked();
  await expect
    .poll(() => asked() - stillAsking, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2);
  // The keyframe does: nothing more is asked.
  staged.paint(videoBatch(3, VP9_KEYFRAME));
  await page.waitForTimeout(2_500);
  const settled = asked();
  await page.waitForTimeout(4_500);
  expect(asked(), "asked again with the keyframe painted").toBe(settled);
});
