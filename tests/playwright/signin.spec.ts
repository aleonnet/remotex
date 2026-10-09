// The sign-in, and the two things a person chooses about the page itself: its
// language and its theme.
//
// Everything asserted is a decision of the page or of the gateway: which message
// of the error catalogue a failed sign-in is given, what the eye does to the
// field and says about it, what the request and the cookie of a kept login carry,
// which language and theme the document is in and whether a reload finds them,
// and whether the page asked the browser for an animation frame. Nothing here
// looks at a pixel.
//
// It needs a gateway with a web login and nothing else, which the tone harness
// is: `bash tools/run-page-tests.sh` runs it there.
import { expect, type Page, test } from "@playwright/test";

import {
  BASE_URL,
  fillSignIn,
  LIST_TITLE,
  leaveSession,
  logIn,
} from "./support";

const HAS_LOGIN =
  process.env.ALUMIA_PLAYWRIGHT_USERNAME !== undefined &&
  process.env.ALUMIA_PLAYWRIGHT_PASSWORD !== undefined;

const password = (page: Page) => page.getByLabel("Password", { exact: true });
const signIn = (page: Page) =>
  page.getByRole("button", { name: "Sign in", exact: true });

/// What a login leads to: the list of computers, or the offer to take over a
/// session another browser of this run left holding the slot.
const signedIn = (page: Page) =>
  page
    .getByRole("heading", { name: LIST_TITLE })
    .or(page.getByRole("button", { name: "Take over" }));

/// The sign-in form, reached: the page has asked who this is and been told
/// nobody.
async function open(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(signIn(page)).toBeVisible();
}

test.describe("the sign-in", () => {
  test.skip(
    !HAS_LOGIN,
    "set ALUMIA_PLAYWRIGHT_USERNAME and ALUMIA_PLAYWRIGHT_PASSWORD",
  );

  // Cleanup, so a run that ended on a desktop hands it back: see `leaveSession`.
  test.afterEach(async ({ page }) => {
    await leaveSession(page);
  });

  test("a wrong password is said with the catalogue's words and code, and a right one signs in", async ({
    page,
  }) => {
    await fillSignIn(page);
    await password(page).fill("not the password");
    await signIn(page).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      "Wrong username or password. Check them and try again.",
    );
    await expect(alert).toContainText("AL-1201");
    // Refused, the form is still there to be corrected.
    await expect(signIn(page)).toBeEnabled();

    await logIn(page);
    await expect(signedIn(page).first()).toBeVisible();
    await expect(signIn(page)).toHaveCount(0);
  });

  // The browser's password manager, as far as the page can ask anything of it:
  // Chrome's and Edge's `PasswordCredential`, and `navigator.credentials.store`.
  // Whether the browser then shows its "Save password?" is the browser's, and no
  // page can see it; what the page decides is when it asks, and with what. A
  // stand-in keeps what it was handed.
  const handed = (page: Page) =>
    page.evaluate(
      () =>
        (globalThis as unknown as { alHanded: { id: string; password: string }[] })
          .alHanded,
    );

  async function standInForPasswordManager(
    page: Page,
    has: boolean,
  ): Promise<void> {
    await page.addInitScript((present) => {
      const kept: { id: string; password: string }[] = [];
      (globalThis as unknown as { alHanded: typeof kept }).alHanded = kept;
      class Handed {
        id: string;
        password: string;
        constructor(data: { id: string; password: string }) {
          this.id = data.id;
          this.password = data.password;
        }
      }
      Object.defineProperty(globalThis, "PasswordCredential", {
        value: present ? Handed : undefined,
        configurable: true,
      });
      Object.defineProperty(navigator.credentials, "store", {
        value: (credential: Handed) => {
          kept.push({ id: credential.id, password: credential.password });
          return Promise.resolve();
        },
        configurable: true,
      });
    }, has);
  }

  test("the browser is asked to save what was typed once the gateway takes it, and never a wrong password", async ({
    page,
  }) => {
    await standInForPasswordManager(page, true);
    await fillSignIn(page);
    await password(page).fill("not the password");
    await signIn(page).click();
    await expect(page.getByRole("alert")).toContainText("AL-1201");
    expect(await handed(page)).toEqual([]);

    await password(page).fill(process.env.ALUMIA_PLAYWRIGHT_PASSWORD ?? "");
    await signIn(page).click();
    await expect(signedIn(page).first()).toBeVisible();
    expect(await handed(page)).toEqual([
      {
        id: process.env.ALUMIA_PLAYWRIGHT_USERNAME,
        password: process.env.ALUMIA_PLAYWRIGHT_PASSWORD,
      },
    ]);
  });

  test("a browser with nothing to be asked signs in all the same", async ({
    page,
  }) => {
    await standInForPasswordManager(page, false);
    await fillSignIn(page);
    await signIn(page).click();
    await expect(signedIn(page).first()).toBeVisible();
    expect(await handed(page)).toEqual([]);
  });

  test("a gateway that refuses and one that does not answer are told apart", async ({
    page,
  }) => {
    await fillSignIn(page);
    const alert = page.getByRole("alert");

    await page.route("**/api/auth/login", (route) =>
      route.fulfill({ status: 503, body: "" }),
    );
    await signIn(page).click();
    await expect(alert).toContainText(
      "The server refused the sign-in (answer 503).",
    );
    await expect(alert).toContainText("AL-1202");

    await page.unroute("**/api/auth/login");
    await page.route("**/api/auth/login", (route) => route.abort());
    await signIn(page).click();
    await expect(alert).toContainText("The server did not answer.");
    // What the browser said of it is kept on the code, as it said it, and is no
    // part of the sentence.
    await expect(alert).toHaveText(
      "The server did not answer. Check that it is running and that this device reaches its network. AL-1203",
    );
    await expect(alert.getByText("AL-1203")).toHaveAttribute("title", /\S/);
  });

  test("the eye shows the password and says so, and sending hides it again", async ({
    page,
  }) => {
    await fillSignIn(page);
    await expect(password(page)).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Show the password" }).click();
    await expect(password(page)).toHaveAttribute("type", "text");
    await expect(page.getByRole("status")).toHaveText(
      "The password is visible.",
    );
    const hide = page.getByRole("button", { name: "Hide the password" });
    await expect(hide).toHaveAttribute("aria-pressed", "true");

    await hide.click();
    await expect(password(page)).toHaveAttribute("type", "password");
    await expect(page.getByRole("status")).toHaveText(
      "The password is hidden.",
    );

    // Left showing, it is hidden again by the sending, whatever the answer.
    await page.getByRole("button", { name: "Show the password" }).click();
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({ status: 401, body: "" }),
    );
    await signIn(page).click();
    await expect(page.getByRole("alert")).toContainText("AL-1201");
    await expect(password(page)).toHaveAttribute("type", "password");
    await expect(
      page.getByRole("button", { name: "Show the password" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("a login is kept only where the box is ticked: the request says so, and the cookie lasts thirty days", async ({
    page,
    browser,
  }) => {
    const sent = async (keep: boolean) => {
      await fillSignIn(page);
      await page
        .getByRole("checkbox", { name: "Keep me signed in on this browser" })
        .setChecked(keep);
      const request = page.waitForRequest("**/api/auth/login");
      await signIn(page).click();
      const body: unknown = (await request).postDataJSON();
      await expect(signedIn(page).first()).toBeVisible();
      const cookies = await page.context().cookies();
      const session = cookies.find((cookie) => cookie.name === "alumia_session");
      if (!session) {
        throw new Error("the login set no session cookie");
      }
      return { body, session };
    };

    // Not ticked: the login it always was, in a cookie that ends with the browser.
    const plain = await sent(false);
    expect(plain.body).toMatchObject({ keep: false });
    expect(plain.session.expires).toBe(-1);
    await page.context().clearCookies();

    // Ticked: the request says so, and the cookie lasts thirty days.
    const kept = await sent(true);
    expect(kept.body).toMatchObject({ keep: true });
    const days = (kept.session.expires - Date.now() / 1000) / 86_400;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);

    // That cookie is the whole login: a browser that starts with nothing else
    // is signed in. What makes it outlive the browser is its lifetime, above.
    const later = await browser.newContext();
    try {
      await later.addCookies([kept.session]);
      const other = await later.newPage();
      await other.goto(BASE_URL);
      await expect(signedIn(other).first()).toBeVisible();
      await expect(signIn(other)).toHaveCount(0);
    } finally {
      await later.close();
    }
  });
});

test.describe("the language and the theme", () => {
  test("a choice of either shows at once, and a reload finds it", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page);
    const root = page.locator("html");
    // With nothing chosen: the browser's language and the system's theme.
    await expect(root).toHaveAttribute("lang", "en-US");
    await expect(root).toHaveAttribute("data-al-theme", "dark");

    await page.getByRole("button", { name: "Preferences" }).click();
    const panel = page.getByRole("dialog", { name: "Preferences" });
    await panel.getByRole("button", { name: "Português (Brasil)" }).click();
    await expect(root).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
    // The panel is in the language chosen too, and stays open to choose again.
    const painel = page.getByRole("dialog", { name: "Preferências" });
    await painel.getByRole("button", { name: "Claro" }).click();
    await expect(root).toHaveAttribute("data-al-theme", "light");
    await expect(painel.getByRole("button", { name: "Claro" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.reload();
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
    await expect(root).toHaveAttribute("lang", "pt-BR");
    await expect(root).toHaveAttribute("data-al-theme", "light");

    // "System" gives the theme back to the system, which is dark here.
    await page.getByRole("button", { name: "Preferências" }).click();
    await page
      .getByRole("dialog", { name: "Preferências" })
      .getByRole("button", { name: "Sistema" })
      .click();
    await expect(root).toHaveAttribute("data-al-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(root).toHaveAttribute("data-al-theme", "light");
  });

  // The glass behind the page is drawn only when something changed, in the
  // colours of the theme the document has at that instant. So what is asked is
  // which theme the document said at each draw, and no pixel is read. The theme
  // is chosen from the keyboard: a click moves the pointer first, and the pointer
  // moving is itself something that draws the glass again, which would hide a
  // glass left in the theme before. A phone has no pointer to hide it.
  test("the glass behind the page is drawn again in the theme chosen, with no pointer moving", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const draws: string[] = [];
      (globalThis as unknown as { glassDraws: string[] }).glassDraws = draws;
      const drawArrays = WebGL2RenderingContext.prototype.drawArrays;
      WebGL2RenderingContext.prototype.drawArrays = function (...args) {
        draws.push(document.documentElement.dataset.alTheme ?? "");
        return drawArrays.apply(this, args);
      };
    });
    const drawn = (from = 0) =>
      page.evaluate(
        (from) =>
          (globalThis as unknown as { glassDraws: string[] }).glassDraws.slice(from),
        from,
      );
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page);
    const root = page.locator("html");
    await expect(root).toHaveAttribute("data-al-theme", "dark");
    // The glass is drawn here at all: without it nothing below says anything.
    await expect.poll(async () => (await drawn()).length).toBeGreaterThan(0);

    const gear = page.getByRole("button", { name: "Preferences" });
    await gear.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Preferences" });
    for (const [name, theme] of [
      ["Light", "light"],
      ["Dark", "dark"],
    ]) {
      await panel.getByRole("button", { name }).focus();
      const before = (await drawn()).length;
      await page.keyboard.press("Enter");
      await expect(root).toHaveAttribute("data-al-theme", theme);
      await expect
        .poll(async () => (await drawn(before)).at(-1), {
          message: `the last draw of the glass after choosing ${name}`,
        })
        .toBe(theme);
    }
  });

  test("Escape closes the preferences and gives the focus back to the gear", async ({
    page,
  }) => {
    await open(page);
    const gear = page.getByRole("button", { name: "Preferences" });
    await gear.click();
    await expect(gear).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("dialog", { name: "Preferences" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Preferences" })).toHaveCount(0);
    await expect(gear).toHaveAttribute("aria-expanded", "false");
    await expect(gear).toBeFocused();
  });
});

// A field of less than 16 px makes iOS zoom the page in when it takes the
// focus, and the page does not zoom back out by itself (index.css says so of
// the clipboard's field): on a device whose pointer is a finger, every field is
// 16 px or more. A coarse pointer is what Chromium says of itself with touch
// emulated, which `hasTouch` turns on.
test.describe("a device with fingers", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("has every text field at 16 px or more, so that focusing one zooms nothing in", async ({
    page,
  }) => {
    await open(page);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      "the browser under test has a coarse pointer",
    ).toBe(true);
    for (const field of [page.getByLabel("Username"), password(page)]) {
      const size = await field.evaluate(
        (element) => Number.parseFloat(getComputedStyle(element).fontSize),
      );
      expect(size).toBeGreaterThanOrEqual(16);
    }
  });
});

// The page can be installed: the document links a web app manifest, which the
// gateway serves with its own type, naming the page and two icons that are
// there. What a browser then offers ("Install", "Add to Home Screen") is the
// browser's, and no page can see it.
test.describe("installing the page", () => {
  test("the document links a manifest the gateway serves, with icons of 192 and 512", async ({
    page,
  }) => {
    await open(page);
    const link = page.locator('link[rel="manifest"]');
    await expect(link).toHaveCount(1);
    const href = await link.getAttribute("href");
    const manifest = await page.request.get(new URL(href ?? "", BASE_URL).toString());
    expect(manifest.status()).toBe(200);
    expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
    const said = (await manifest.json()) as {
      name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; type: string }[];
    };
    expect(said.name).toBe("alumia");
    expect(said.start_url).toBe("/");
    expect(said.display).toBe("standalone");
    const sizes = said.icons.map((icon) => icon.sizes).sort();
    expect(sizes).toEqual(["192x192", "512x512"]);
    for (const icon of said.icons) {
      const image = await page.request.get(new URL(icon.src, BASE_URL).toString());
      expect(image.status(), icon.src).toBe(200);
      expect(image.headers()["content-type"], icon.src).toBe("image/png");
    }
    // And the icon an iPhone's home screen takes, which reads no manifest.
    const touch = page.locator('link[rel="apple-touch-icon"]');
    await expect(touch).toHaveCount(1);
    const apple = await page.request.get(
      new URL((await touch.getAttribute("href")) ?? "", BASE_URL).toString(),
    );
    expect(apple.status()).toBe(200);
  });
});

test.describe("the tab's icon", () => {
  const icon = (page: Page) => page.locator('link[rel="icon"]');

  test("is the mark, and a gateway's own logo where it has one", async ({
    page,
  }) => {
    // The mark, compiled into the page: there before any of it runs.
    await open(page);
    await expect(icon(page)).toHaveCount(1);
    await expect(icon(page)).toHaveAttribute("href", /favicon|^data:image\/svg/);

    // A gateway that says it has a logo has it put in the mark's place.
    await page.route("**/api/config", async (route) => {
      const response = await route.fetch();
      const config: Record<string, unknown> = await response.json();
      await route.fulfill({ response, json: { ...config, logo: true } });
    });
    await page.reload();
    await expect(icon(page)).toHaveAttribute("href", /\/api\/logo$/);
    await expect(icon(page)).toHaveCount(1);
  });
});

test.describe("a browser that asks for Portuguese", () => {
  test.use({ locale: "pt-BR" });

  test("is spoken to in Portuguese", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByLabel("Usuário")).toBeVisible();
    await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Manter conectado neste navegador" }),
    ).not.toBeChecked();
  });
});

// The windows the mockup is drawn in: a phone upright and on its side, a tablet
// and a desktop.
const WINDOWS = [
  { width: 390, height: 844 },
  { width: 860, height: 412 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
];

for (const locale of ["en-US", "pt-BR"]) {
  test.describe(`the sign-in in ${locale}`, () => {
    test.use({ locale });

    test("is never wider than its window", async ({ page }) => {
      for (const size of WINDOWS) {
        await page.setViewportSize(size);
        await page.goto(BASE_URL);
        await expect(page.getByRole("checkbox")).toBeVisible();
        // The scene is what scrolls: nothing in it may ask for more width.
        const spill = await page.getByRole("main").evaluate((main) => {
          const scene = main.parentElement;
          return scene ? scene.scrollWidth - scene.clientWidth : Number.NaN;
        });
        expect(spill, `${size.width}×${size.height}`).toBe(0);
      }
    });
  });
}

/// Count the animation frames the page asks for, from before any of it runs.
async function countFrames(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const counted = globalThis as unknown as { alFrames: number };
    counted.alFrames = 0;
    const ask = globalThis.requestAnimationFrame.bind(globalThis);
    globalThis.requestAnimationFrame = (callback) => {
      counted.alFrames += 1;
      return ask(callback);
    };
  });
  return () =>
    page.evaluate(() => (globalThis as unknown as { alFrames: number }).alFrames);
}

test.describe("the unlit glass", () => {
  test("follows a mouse through the one clock", async ({ page }) => {
    const frames = await countFrames(page);
    await open(page);
    expect(await frames()).toBe(0);
    await page.mouse.move(200, 200);
    await expect.poll(frames).toBeGreaterThan(0);
    await expect(page.locator("html")).toHaveAttribute("data-al-clock", "stopped");
  });

  test("does not move where motion is reduced", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const frames = await countFrames(page);
    await open(page);
    await page.mouse.move(200, 200);
    await page.mouse.move(300, 260);
    await expect(page.locator("html")).toHaveAttribute("data-al-clock", "stopped");
    expect(await frames()).toBe(0);
  });

  test("is not needed: without WebGL 2 the page is the same page", async ({
    page,
  }) => {
    await page.addInitScript(() => {
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
    });
    await open(page);
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(password(page)).toBeVisible();
  });
});
