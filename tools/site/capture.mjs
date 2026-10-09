// Photograph the product for the README (docs/readme/) and for the public page
// (site/real/): the page the gateway serves, in a desktop browser and in a phone's, in
// both themes where the README offers both, in both languages; and the Mac app's screens
// as the public page draws them from the app's code.
//
//   node tools/site/capture.mjs gateway <url> <password> [pt-BR|en-US]   the sign-in, the list, the screen lighting
//   node tools/site/capture.mjs harness <url> <password>   a session's bar, from the test harness
//   node tools/site/capture.mjs app                        the Mac app's screens, from site/index.html
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../tests/playwright/node_modules/@playwright/test/index.mjs";

const [mode, base, password, only] = process.argv.slice(2);
const LANGS = only ? [only] : ["pt-BR", "en-US"];
if (!["gateway", "harness", "app"].includes(mode) || (mode !== "app" && (!base || !password))) {
  console.error("capture: node tools/site/capture.mjs gateway|harness <url> <password>, or app");
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const README = join(root, "docs/readme");
const SITE = join(root, "site/real");
mkdirSync(README, { recursive: true });
mkdirSync(SITE, { recursive: true });

const WORDS = {
  "pt-BR": { user: "Usuário", pass: "Senha", submit: "Entrar", list: "Seus computadores", open: "Abrir", cancel: "Cancelar", handle: "Abrir a barra da sessão", end: "Encerrar" },
  "en-US": { user: "Username", pass: "Password", submit: "Sign in", list: "Your computers", open: "Open", cancel: "Cancel", handle: "Open the session bar", end: "End" },
};
const THEME = { dark: "escuro", light: "claro" };
const SIZE = { desktop: { width: 1280, height: 820 }, phone: { width: 412, height: 860 } };

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

async function open(device, theme, lang) {
  const context = await browser.newContext({ viewport: SIZE[device], deviceScaleFactor: 2, locale: lang, hasTouch: device === "phone", isMobile: device === "phone" });
  await context.addInitScript(([t, chosen]) => { localStorage.setItem("alumia.theme", t); localStorage.setItem("alumia.language", chosen); }, [theme, lang]);
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForTimeout(900);
  return { context, page };
}

async function signIn(page, w) {
  await page.getByLabel(w.user, { exact: true }).fill("admin");
  await page.getByLabel(w.pass, { exact: true }).fill(password);
  await page.getByRole("button", { name: w.submit, exact: true }).click();
  const takeOver = page.getByRole("button", { name: /Take over|Assumir/ });
  const list = page.getByRole("heading", { name: w.list });
  await list.or(takeOver).first().waitFor({ timeout: 20000 });
  if (await takeOver.isVisible()) { await takeOver.click(); await list.waitFor({ timeout: 20000 }); }
  await page.waitForTimeout(700);
  return list;
}

if (mode === "gateway") {
  // The list, in both themes, on a desktop: the README's first picture.
  for (const theme of ["dark", "light"]) for (const lang of LANGS) {
    const l = lang === "pt-BR" ? "pt" : "en", w = WORDS[lang];
    const { context, page } = await open("desktop", theme, lang);
    await signIn(page, w);
    await page.mouse.move(SIZE.desktop.width * 0.62, SIZE.desktop.height * 0.55);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(README, `lista-${THEME[theme]}-${l}.png`) });
    console.log(`captured the list, ${THEME[theme]}, ${l}`);
    await context.close();
  }
  // The screen lighting, dark, on a desktop and on a phone, and the phone's sign-in and
  // list. Open is pressed on a computer that reaches nothing: the lighting is what the
  // page shows while it waits, photographed 1.3 s in.
  for (const device of ["desktop", "phone"]) for (const lang of LANGS) {
    const l = lang === "pt-BR" ? "pt" : "en", w = WORDS[lang];
    const { context, page } = await open(device, "dark", lang);
    if (device === "phone") await page.screenshot({ path: join(README, `celular-entrar-${l}.png`) });
    const list = await signIn(page, w);
    if (device === "phone") await page.screenshot({ path: join(README, `celular-lista-${l}.png`) });
    await page.getByRole("button", { name: new RegExp(`^${w.open}`) }).first().click();
    await page.waitForTimeout(1300);
    const name = device === "phone" ? `celular-acende-${l}.png` : `acende-${l}.png`;
    await page.screenshot({ path: join(README, name) });
    await page.screenshot({ path: join(SITE, name) });
    console.log(`captured the screen lighting, ${device}, ${l}`);
    await page.getByRole("button", { name: w.cancel, exact: true }).click({ timeout: 5000 }).catch(() => {});
    await list.waitFor({ timeout: 20000 }).catch(() => {});
    await context.close();
  }
} else if (mode === "harness") {
  // A session with its bar open, on a desktop, dark: the top strip, 16 by 3, which is
  // the bar and what is under it.
  for (const lang of ["pt-BR", "en-US"]) {
    const l = lang === "pt-BR" ? "pt" : "en", w = WORDS[lang];
    const { context, page } = await open("desktop", "dark", lang);
    const list = await signIn(page, w);
    await page.getByRole("button", { name: new RegExp(`^${w.open}`) }).first().click();
    const handle = page.getByRole("button", { name: w.handle });
    await handle.waitFor({ timeout: 25000 });
    await page.waitForTimeout(800);
    await handle.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(README, `barra-${l}.png`), clip: { x: 0, y: 0, width: SIZE.desktop.width, height: SIZE.desktop.width * 3 / 16 } });
    console.log(`captured the session bar, ${l}`);
    await page.getByRole("toolbar").getByRole("button", { name: w.end, exact: true }).click({ timeout: 5000 }).catch(() => {});
    await list.waitFor({ timeout: 20000 }).catch(() => {});
    await context.close();
  }
} else {
  // The Mac app's screens, as the public page draws them from the app's code, in both
  // themes and languages: the menu, the first run and the settings' Computers pane.
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(`file://${join(root, "site/index.html")}`);
  await page.waitForTimeout(1500);
  for (const theme of ["dark", "light"]) for (const lang of ["pt-BR", "en-US"]) {
    const l = lang === "pt-BR" ? "pt" : "en";
    await page.evaluate(([t, chosen]) => { localStorage.setItem("alumia-site.theme", t); localStorage.setItem("alumia-site.lang", chosen); }, [theme, lang]);
    await page.reload();
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.getElementById("mac").scrollIntoView());
    await page.waitForTimeout(600);
    for (const [scene, element, name] of [["menu", ".mac-desk", "app-menu"], ["first", ".mac-first", "app-primeira-vez"], ["settings-computers", ".mac-win", "app-computadores"]]) {
      await page.locator(`[data-mac="${scene}"] ${element}`).screenshot({ path: join(README, `${name}-${THEME[theme]}-${l}.png`) });
    }
    console.log(`captured the Mac app's screens, ${THEME[theme]}, ${l}`);
  }
}
await browser.close();
