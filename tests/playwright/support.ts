// Shared setup for the live-Mac clipboard specs: the environment they need, the
// login/target flow, and the SSH hooks that drive the Mac's own pasteboard.
//
// Both specs run against the same single session slot, so they are sequential by
// configuration (workers: 1) rather than by luck — a second browser claiming the
// slot would evict the first.
import { execFileSync } from "node:child_process";
import {
  expect,
  type Locator,
  type Page,
  test,
  type WebSocketRoute,
} from "@playwright/test";

export const BASE_URL =
  process.env.ALUMIA_PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:52380/";
export const TARGET = process.env.ALUMIA_PLAYWRIGHT_TARGET ?? "mac";
const USERNAME = process.env.ALUMIA_PLAYWRIGHT_USERNAME;
const PASSWORD = process.env.ALUMIA_PLAYWRIGHT_PASSWORD;
const MAC_SSH = process.env.ALUMIA_PLAYWRIGHT_MAC_SSH;
const SSH_TIMEOUT_MS = 10_000;
const LEAVE_TIMEOUT_MS = 10_000;
const REQUIRED_ENV: Record<string, string | undefined> = {
  ALUMIA_PLAYWRIGHT_USERNAME: USERNAME,
  ALUMIA_PLAYWRIGHT_PASSWORD: PASSWORD,
  ALUMIA_PLAYWRIGHT_MAC_SSH: MAC_SSH,
};
export const MISSING_ENV = Object.entries(REQUIRED_ENV)
  .filter(([, value]) => !value)
  .map(([name]) => name);

/// Where the Mac's Screen Sharing service listens, as `host:port` — and the opt-in
/// for every spec that needs a live Mac target.
///
/// An endpoint rather than a flag, because it is the specific thing those specs
/// depend on and the only thing that can be checked: credentials do not tell you a
/// VM is up, and with the Mac merely stopped the specs failed on a
/// connect timeout deep inside the browser, reading as a bug in whatever was being
/// changed. Unset by default, so a plain run never assumes a live Mac — the
/// browser-side equivalent of `#[ignore]` on the Rust e2e tests that need a
/// container.
///
///     ALUMIA_PLAYWRIGHT_MAC_SCREEN_SHARING=... npx playwright test
export const SCREEN_SHARING_ENDPOINT =
  process.env.ALUMIA_PLAYWRIGHT_MAC_SCREEN_SHARING;

/// Whether something is listening at [`SCREEN_SHARING_ENDPOINT`].
///
/// A TCP connect is sufficient to establish that Screen Sharing is reachable.
/// `nc`, because this has to answer synchronously for a `test.skip` at suite level,
/// and this file already shells out for the pasteboard. A probe that cannot run at
/// all (no `nc`) answers `true`: the point is to skip a *known* absent service, not
/// to guess at one.
///
/// `-G`, the connect timeout, is macOS's `nc` alone: anywhere else it is an option
/// `nc` does not know, which exits non-zero like a refused connection and skipped
/// every live-Mac spec. There `-w` bounds the connect as well.
function screenSharingIsListening(endpoint: string): boolean {
  const at = endpoint.lastIndexOf(":");
  const host = at > 0 ? endpoint.slice(0, at) : endpoint;
  const port = at > 0 ? endpoint.slice(at + 1) : "";
  const connectTimeout = process.platform === "darwin" ? ["-G", "2"] : [];
  try {
    execFileSync("nc", ["-z", ...connectTimeout, "-w", "2", host, port], {
      stdio: "ignore",
      timeout: SSH_TIMEOUT_MS,
    });
    return true;
  } catch (cause) {
    // `nc` exits non-zero for a refused or timed-out connection, which is the
    // answer. Anything without an exit status is `nc` itself missing, which is not.
    return !(cause instanceof Error && "status" in cause);
  }
}

/// Skip the enclosing spec or suite unless a live Mac target was requested, its
/// Screen Sharing service can be reached, and the environment to drive it is set.
/// One place for all three, so every such spec skips for the same reasons and says
/// which one applied.
export function skipUnlessLiveMac(): void {
  if (!SCREEN_SHARING_ENDPOINT) {
    test.skip(
      true,
      "set ALUMIA_PLAYWRIGHT_MAC_SCREEN_SHARING=host:port to run the live-Mac specs",
    );
    return;
  }
  if (MISSING_ENV.length > 0) {
    test.skip(true, `set ${MISSING_ENV.join(", ")} to run the live-Mac specs`);
    return;
  }
  test.skip(
    !screenSharingIsListening(SCREEN_SHARING_ENDPOINT),
    `nothing is listening at ${SCREEN_SHARING_ENDPOINT} — start Screen Sharing on the Mac`,
  );
}

// The three above are optional in the environment but required by the time a
// test body runs, which `test.skip(MISSING_ENV.length > 0, …)` guarantees. This
// turns that guarantee into something the types agree with, instead of a `!` on
// every use.
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is unset; MISSING_ENV should have skipped this`);
  }
  return value;
}

export function setRemoteClipboard(text: string): void {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  execFileSync(
    "ssh",
    [
      required("ALUMIA_PLAYWRIGHT_MAC_SSH", MAC_SSH),
      `printf '%s' '${encoded}' | base64 --decode | pbcopy`,
    ],
    { timeout: SSH_TIMEOUT_MS },
  );
}

// A pasteboard of `bytes` ASCII characters, generated on the Mac rather than
// sent over SSH: the point of this one is a size the link is meant to refuse.
//
// Built with `head`, `tr` and `pbcopy` — no interpreter. This used to ask
// `python3` for the string, which on a Mac without the Xcode command line tools
// is a stub that prints the install notice to stderr, writes nothing, and
// *exits zero*: the pasteboard kept whatever it already held, and the spec
// failed twenty seconds later waiting for a card about a value that had never
// been set. A QA Mac should not need a toolchain to hold a string.
export function setRemoteClipboardBytes(bytes: number): void {
  execFileSync(
    "ssh",
    [
      required("ALUMIA_PLAYWRIGHT_MAC_SSH", MAC_SSH),
      `head -c ${bytes} /dev/zero | tr '\\0' 'x' | pbcopy`,
    ],
    { timeout: SSH_TIMEOUT_MS },
  );
}

export function readRemoteClipboard(): string {
  return execFileSync(
    "ssh",
    [required("ALUMIA_PLAYWRIGHT_MAC_SSH", MAC_SSH), "pbpaste"],
    { encoding: "utf8", timeout: SSH_TIMEOUT_MS },
  ).replace(/\r?\n$/, "");
}

// What a spec starts its session with. The size and the sound are chosen at the
// list, by the keys of the computer's monitor, before Open; each defaults to off,
// and each key is put where it is asked rather than left as found, so a run does
// not depend on what an earlier one left remembered in the browser. A passthrough
// is no key: it is asked for by the page's address (`?passthrough=1`).
//
// `resize` is the desktop following this window. Off, the session takes the size
// the target keeps where the list offers one; a target with no size configured
// follows the window whatever is asked, since that is the one size it has here.
export interface StartChoices {
  resize?: boolean;
  sound?: boolean;
  passthrough?: boolean;
}

// The list of computers, by its title: where a login lands, and where a session
// is handed back to.
export const LIST_TITLE = "Your computers";

// A computer's line at the list: the list item whose heading is the computer's
// name, whole. Exact, because a config holding `video` and `video-motion` has two
// lines a looser match would both find. A Mac the gateway lists in both of its
// modes at one address is one line, under what the two names share.
export function computerRow(page: Page, name: string): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

// The handle of the session's bar, by its name: "Open the session bar", which
// goes on to say what is in use or wrong when something is. It is on screen only
// over a session whose remote has announced its desktop: until then the page
// shows the screen that lights, so the handle is also the page's word that the
// session is ready to be acted on.
export const HANDLE = /^Open the session bar/;

export function handle(page: Page): Locator {
  return page.getByRole("button", { name: HANDLE });
}

// The session's bar, opened from its handle and left open if it already is.
export async function openBar(page: Page): Promise<Locator> {
  const bar = page.getByRole("toolbar", { name: "Session bar" });
  if (!(await bar.isVisible())) {
    await handle(page).click({ timeout: LEAVE_TIMEOUT_MS });
  }
  await expect(bar).toBeVisible();
  return bar;
}

// Log in and get to a live desktop, which the page says without a word about
// canvas pixels: the bar's handle, which is up once the gateway has reached the
// remote and announced its desktop.
//
// That is what a spec that then acts on the remote needs. Before it the gateway
// may still be logging on, and a value put on a Mac's pasteboard then was there
// before the pasteboard was watched: not a change, never announced, and the spec
// would wait for it in vain.
//
// Either landing is accepted, because the server keeps a target session running
// when its browser goes away: a run that ended on the desktop — or crashed there
// — is reattached straight to it and never sees the picker. Requiring the picker
// here made one abandoned run break every run after it.
export async function logInAndConnect(
  page: Page,
  choices: StartChoices = {},
): Promise<void> {
  await landOn(page, TARGET, true, "", choices);
}

// Log in and land on *one named target*, whichever the run started on.
//
// The tolerance above is what makes an abandoned run harmless, and it is exactly
// what a spec about a particular target cannot have: reattaching to whatever was
// left running would assert against the wrong dial and read as a product failure.
// So a session found on a desktop is handed back to the picker first, and the
// target is then chosen by name. `search` is the page's query at load, for a spec
// about something the page decides from its URL. `choices` is what its session is
// started with.
export async function logInAndConnectTo(
  page: Page,
  target: string,
  search = "",
  choices: StartChoices = {},
): Promise<void> {
  await landOn(page, target, false, search, choices);
}

// The size that follows this browser's window, as the size's place says it.
export const FOLLOWS_WINDOW = /^The size of this window$/;

// The sound's key, by what it says in each of its two states.
export const SOUND_OFF = "Without bringing the sound";
export const SOUND_ON = "Sound brought here";

// `search` with what `choices` asks of the page's address: a passthrough.
function addressFor(search: string, choices: StartChoices): string {
  if (!choices.passthrough) {
    return search;
  }
  const query = new URLSearchParams(search);
  query.set("passthrough", "1");
  return `?${query}`;
}

// Put `target`'s keys at the list where `choices` asks and press Open.
//
// A place is a key only where the computer offers another choice, and a mark
// otherwise. One that is asked for and is not to be had fails here, by name,
// rather than as a session that started without it.
async function startTarget(
  page: Page,
  target: string,
  choices: StartChoices,
): Promise<void> {
  const item = computerRow(page, target);
  // The size's key says the size it is on: this window's, or one the computer
  // keeps. Pressing it goes to the other.
  const follows = item.getByRole("button", { name: FOLLOWS_WINDOW });
  const following = (await follows.count()) > 0;
  if (choices.resize && !following) {
    const kept = item.getByRole("button", { name: /^\d+ × \d+$/ });
    if ((await kept.count()) > 0) {
      await kept.click({ timeout: LEAVE_TIMEOUT_MS });
      await expect(follows).toBeVisible();
    } else {
      // One size, and it is the window's: a mark, not a key.
      await expect(item.getByRole("img", { name: FOLLOWS_WINDOW })).toBeVisible();
    }
  } else if (!choices.resize && following) {
    await follows.click({ timeout: LEAVE_TIMEOUT_MS });
    await expect(follows).toHaveCount(0);
  }
  // The sound's key says whether the sound is brought.
  const wanted = item.getByRole("button", {
    name: choices.sound ? SOUND_ON : SOUND_OFF,
  });
  const other = item.getByRole("button", {
    name: choices.sound ? SOUND_OFF : SOUND_ON,
  });
  if (choices.sound || (await other.count()) > 0) {
    if ((await wanted.count()) === 0) {
      await other.click({ timeout: LEAVE_TIMEOUT_MS });
    }
    await expect(wanted).toBeVisible();
  }
  await item.getByRole("button", { name: /^Open / }).click();
}

// Both of the above, differing only in what they do about a session that is already
// on a desktop: `keepRunningSession` reattaches to it, and otherwise it is handed
// back to the picker so `target` is the one actually connected. One implementation,
// so the locators and the timeout cannot drift apart between them.
async function landOn(
  page: Page,
  target: string,
  keepRunningSession: boolean,
  search: string,
  choices: StartChoices,
): Promise<void> {
  await logIn(page, addressFor(search, choices));
  const onPicker = await page
    .getByRole("heading", { name: LIST_TITLE })
    .isVisible();
  // A landing on a desktop is either kept — the tolerance that makes an abandoned run
  // harmless — or handed back to the picker, so the target chosen below is the one
  // actually connected.
  if (onPicker || !keepRunningSession) {
    if (!onPicker) {
      await returnToPicker(page);
    }
    await startTarget(page, target, choices);
  }
  await expect(handle(page)).toBeVisible({ timeout: 20_000 });
}

// The sign-in form, filled with the local test login and not yet sent. The
// password is named exactly: the eye beside it is named for it too ("Show the
// password"), and a looser match finds both.
export async function fillSignIn(page: Page, search = ""): Promise<void> {
  await page.goto(new URL(search, BASE_URL).toString());
  await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  await page
    .getByLabel("Username")
    .fill(required("ALUMIA_PLAYWRIGHT_USERNAME", USERNAME));
  await page
    .getByLabel("Password", { exact: true })
    .fill(required("ALUMIA_PLAYWRIGHT_PASSWORD", PASSWORD));
}

// The login itself, which ends on whichever of the two landings this run gets.
export async function logIn(page: Page, search = ""): Promise<void> {
  await fillSignIn(page, search);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // A third landing, and the one that used to end a run before it started: the slot
  // is held by a browser that is gone or busy — a previous test's context, a QA tab
  // left open — and the page offers the takeover rather than deciding for anybody.
  // Taking it is what a test run wants and is the flow the product documents: it
  // ends whatever session was there, and this page lands on the picker.
  const takeOver = page.getByRole("button", { name: "Take over" });
  const picker = page.getByRole("heading", { name: LIST_TITLE });
  const menu = handle(page);
  await expect(takeOver.or(picker).or(menu).first()).toBeVisible({
    timeout: 20_000,
  });
  if (await takeOver.isVisible()) {
    await takeOver.click();
    // Taking a session from a browser that may be using it is asked about first.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Take over" })
      .click();
  }
  await expect(picker.or(menu).first()).toBeVisible({ timeout: 20_000 });
}

export async function openClipboardPanel(page: Page): Promise<void> {
  const bar = await openBar(page);
  await bar.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Clipboard", exact: true }).click();
}

// Hand the session back to the picker, so the next spec starts where this one
// did. Every spec here does this on the way out, most of them through
// `leaveSession` below.
//
// The clicks have a timeout of their own. Without one a button that cannot be
// clicked — under a sheet a spec left open — is retried until the test's timeout,
// and then again for as long under the `afterEach` that cleans up.
export async function returnToPicker(page: Page): Promise<void> {
  const bar = await openBar(page);
  await bar
    .getByRole("button", { name: "End", exact: true })
    .click({ timeout: LEAVE_TIMEOUT_MS });
  await expect(page.getByRole("heading", { name: LIST_TITLE })).toBeVisible();
}

// The same thing as cleanup, for an `afterEach`: hand the session back even when a
// spec threw halfway, so a failing run does not leave the gateway's one slot sitting
// on a desktop for the next spec to take over.
//
// Every step is conditional, because cleanup runs after failures and a hook that
// threw would bury the real one under a second. Whatever a spec left open over
// the session is closed first, a dialog and then a sheet, each by Escape, which
// is the one way out they all share: the bar's End is under them otherwise, and
// the click below would have nothing to land on.
export async function leaveSession(page: Page): Promise<void> {
  const bar = page.getByRole("toolbar", { name: "Session bar" });
  if (!(await handle(page).or(bar).first().isVisible())) {
    return;
  }
  for (const over of [page.locator("dialog[open]"), page.getByRole("dialog")]) {
    if (await over.first().isVisible()) {
      await page.keyboard.press("Escape");
    }
  }
  await returnToPicker(page);
}

// How long a session may take to come up, or to be handed back. The gateway
// waits for the engine it just ended before it starts the next
// (`ENGINE_EXIT_GRACE` in src/session.rs, five seconds), and the test harness's
// scripted engine never ends by itself: every session after the first on one
// harness takes that long to answer, and so does a Cancel sent meanwhile.
export const SESSION_TIMEOUT_MS = 20_000;

// One of a session's control messages, as either end sends it.
export type Control = { type: string } & Record<string, unknown>;

// A session whose gateway a spec stands in front of: every message still goes to
// the real gateway and comes from it, and the spec may hold one back, change one
// on its way, or say one the gateway did not. What the page then does about it is
// the page's own decision, which is what a spec is for.
export interface Staged {
  /** What the page sent on its session socket and on its display's, in order. */
  sent: Control[];
  /** Give the page a message as if the gateway had sent it. */
  say: (message: Control) => void;
  /**
   * Give the page's display a binary frame as if the gateway had sent it: a
   * batch of the picture, in the wire's own bytes.
   */
  paint: (frame: Buffer) => void;
  /** Hold back the gateway's messages of these types from now on. */
  hold: (...types: string[]) => void;
  /** Deliver what was held, and hold nothing more. */
  release: () => void;
  /** Throw away what was held, and hold nothing more. */
  discard: () => void;
  /** Change the gateway's messages of a type on their way to the page. */
  change: (type: string, change: (message: Control) => Control) => void;
  /** Keep the page's messages of these types from the gateway, which then never hears them. */
  keep: (...types: string[]) => void;
  /** Cut the page's socket, as a network that dropped would. */
  drop: () => Promise<void>;
  /**
   * Let the page's display socket go, as the gateway lets one go (close 4001),
   * with the session socket left as it is.
   */
  letDisplayGo: () => Promise<void>;
  /** How many display sockets the page has opened so far. */
  displaysOpened: () => number;
}

// The session socket alone: the display's, the sound's, the camera's and the
// microphone's have a path of their own after `/ws`.
const SESSION_SOCKET = /\/ws\?/;

// The socket of the display the session's page shows: the picture, and what the
// gateway says of it.
const DISPLAY_SOCKET = /\/ws\/display\?/;

// What the gateway says on a display's socket rather than on the session's
// (src/protocol.rs, `ServerMsg::is_display`): where a message a spec says for the
// gateway has to arrive to be read as the gateway's.
const DISPLAY_SAYS = new Set([
  "videoFormat",
  "graphicsStart",
  "graphicsView",
  "resize",
  "cursor",
  "mosaic",
  "oversize",
  "resizing",
  "screenUnavailable",
  "remoteOs",
  "touchReady",
]);

// The sound's socket, where the gateway says the format of what it sends.
export const SOUND_SOCKET = /\/ws\/audio\?/;

// Stand in front of the gateway on a session, which is two of the page's
// sockets: the session's, and its display's, where the picture and what is said
// of it travel. A spec holds, changes and says a message without naming which of
// the two carries it. Another socket can be named instead, and is then staged
// alone. Asked for before the page is opened, so the first socket is already
// staged.
export async function stageSession(
  page: Page,
  which: RegExp = SESSION_SOCKET,
): Promise<Staged> {
  const sent: Control[] = [];
  const holding = new Set<string>();
  const changes = new Map<string, (message: Control) => Control>();
  const kept = new Set<string>();
  // What was held, with the socket it was on its way to.
  let held: { text: string; deliver: (text: string) => void }[] = [];
  // The way to the page on each socket: the staged one, and the display's
  // where a session is staged.
  let toPage: ((text: string) => void) | null = null;
  let toDisplay: ((text: string) => void) | null = null;
  let paintDisplay: ((frame: Buffer) => void) | null = null;
  let cut: (() => Promise<void>) | null = null;
  let cutDisplay: (() => Promise<void>) | null = null;
  let displays = 0;

  const stand = (socket: WebSocketRoute, display: boolean) => {
    const gateway = socket.connectToServer();
    const deliver = (text: string) => socket.send(text);
    if (display) {
      displays += 1;
      toDisplay = deliver;
      paintDisplay = (frame) => socket.send(frame);
      cutDisplay = async () => {
        // The gateway's own end goes too, so its slot is free for the next one.
        await gateway.close();
        await socket.close({ code: 4001, reason: "a display socket was let go" });
      };
    } else {
      toPage = deliver;
      cut = () => socket.close();
    }
    socket.onMessage((message) => {
      if (typeof message === "string") {
        const control = JSON.parse(message) as Control;
        sent.push(control);
        if (kept.has(control.type)) {
          return;
        }
      }
      gateway.send(message);
    });
    gateway.onMessage((message) => {
      if (typeof message !== "string") {
        socket.send(message);
        return;
      }
      const control = JSON.parse(message) as Control;
      if (holding.has(control.type)) {
        held.push({ text: message, deliver });
        return;
      }
      const change = changes.get(control.type);
      socket.send(change ? JSON.stringify(change(control)) : message);
    });
  };

  await page.routeWebSocket(which, (socket) => stand(socket, false));
  const session = which === SESSION_SOCKET;
  if (session) {
    await page.routeWebSocket(DISPLAY_SOCKET, (socket) => stand(socket, true));
  }

  return {
    sent,
    say: (message) => {
      const onDisplay = session && DISPLAY_SAYS.has(message.type);
      (onDisplay ? toDisplay : toPage)?.(JSON.stringify(message));
    },
    paint: (frame) => {
      paintDisplay?.(frame);
    },
    hold: (...types) => {
      for (const type of types) {
        holding.add(type);
      }
    },
    release: () => {
      holding.clear();
      for (const { text, deliver } of held) {
        deliver(text);
      }
      held = [];
    },
    discard: () => {
      holding.clear();
      held = [];
    },
    change: (type, change) => {
      changes.set(type, change);
    },
    keep: (...types) => {
      for (const type of types) {
        kept.add(type);
      }
    },
    drop: async () => {
      await cut?.();
    },
    letDisplayGo: async () => {
      await cutDisplay?.();
    },
    displaysOpened: () => displays,
  };
}

// The words a page of each language signs in and opens a session with.
const SPOKEN = {
  "en-US": {
    user: "Username",
    pass: "Password",
    submit: "Sign in",
    over: "Take over",
  },
  "pt-BR": { user: "Usuário", pass: "Senha", submit: "Entrar", over: "Assumir" },
} as const;

// `logIn` on a page of either language: sign in, and take over a session another
// page of this run left holding, to land on the list.
export async function logInSpeaking(page: Page, locale: string): Promise<void> {
  const words = SPOKEN[locale as keyof typeof SPOKEN];
  await page.goto(BASE_URL);
  await page
    .getByLabel(words.user)
    .fill(required("ALUMIA_PLAYWRIGHT_USERNAME", USERNAME));
  await page
    .getByLabel(words.pass, { exact: true })
    .fill(required("ALUMIA_PLAYWRIGHT_PASSWORD", PASSWORD));
  await page.getByRole("button", { name: words.submit, exact: true }).click();
  const over = page.getByRole("button", { name: words.over });
  const list = page.getByRole("list");
  await expect(over.or(list).first()).toBeVisible({
    timeout: SESSION_TIMEOUT_MS,
  });
  if (await over.isVisible()) {
    await over.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: words.over })
      .click();
  }
  await expect(list).toBeVisible({ timeout: SESSION_TIMEOUT_MS });
}

// Open the page as a device with fingers. A browser under test reports one touch
// point however it is opened (measured: `hasTouch` gives `maxTouchPoints` 1), and
// the page takes two for a touch client, the one whose picture fits its width
// (`CAN_PINCH_ZOOM` in useRemoteDesktop.ts): so the page is told five, as a phone
// or a tablet says. Asked for before the page is opened.
export async function withFingers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "maxTouchPoints", {
      get: () => 5,
    });
  });
}

// Choose `display` in the session page's Screens sheet, opened from the bar, and
// leave the sheet closed. `display` is the entry's name as the page says it
// ("Display 2", "All screens"); the line under it is not part of what is asked for.
export async function chooseDisplay(
  page: Page,
  display: string,
): Promise<void> {
  const bar = await openBar(page);
  const sheet = page.getByRole("dialog", { name: "Screens" });
  if (!(await sheet.isVisible())) {
    await bar.getByRole("button", { name: "Screens" }).click();
  }
  // The entries are pressed buttons, one pressed at a time; the one asked for
  // is not it yet. The sheet stays open after a press, so the mark is seen to
  // move, and is closed here.
  await sheet
    .getByRole("button", { name: new RegExp(`^${display}`), pressed: false })
    .click();
  await sheet.getByRole("button", { name: "Close" }).click();
}
