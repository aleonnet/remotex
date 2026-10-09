// Harvest the product's page as the gateway serves it: the document and the stylesheet
// of the sign-in, of the list and of a session, in both languages, into
// tools/site/dom/<page>-<pt|en>.json, for build.py to show live inside the public page.
//
// The sign-in and the list come from a gateway run with tools/site/site.toml (the three
// computers of example); the session from the gateway's own test harness
// (tools/page-harness.sh), whose one computer answers a connection. Fonts the stylesheet
// names are fetched and embedded, so the harvest needs no server afterwards.
//
//   node tools/site/harvest.mjs gateway <url> <password> [pt-BR|en-US]
//   node tools/site/harvest.mjs harness <url> <password>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../tests/playwright/node_modules/@playwright/test/index.mjs";

const [mode, base, password, only] = process.argv.slice(2);
if (!["gateway", "harness"].includes(mode) || !base || !password) {
  console.error("harvest: node tools/site/harvest.mjs gateway|harness <url> <password>");
  process.exit(2);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "dom");
mkdirSync(out, { recursive: true });

// What the page calls its controls, in each language: the harvest drives it by what a
// person reads, as the browser tests do.
const WORDS = {
  "pt-BR": { user: "Usuário", pass: "Senha", submit: "Entrar", list: "Seus computadores", open: "Abrir", handle: "Abrir a barra da sessão", end: "Encerrar" },
  "en-US": { user: "Username", pass: "Password", submit: "Sign in", list: "Your computers", open: "Open", handle: "Open the session bar", end: "End" },
};

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

const harvest = (page) => page.evaluate(async () => {
  const css = [];
  for (const sheet of document.styleSheets) {
    try { css.push(Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n")); }
    catch { css.push(`/* unreadable: ${sheet.href} */`); }
  }
  const urls = [...new Set(css.join("\n").match(/url\(([^)]+)\)/g) || [])].map((u) => u.slice(4, -1).replace(/^["']|["']$/g, ""));
  const assets = {};
  for (const u of urls) {
    if (u.startsWith("data:")) continue;
    try {
      const blob = await (await fetch(u)).blob();
      assets[u] = await new Promise((done) => { const reader = new FileReader(); reader.onload = () => done(reader.result); reader.readAsDataURL(blob); });
    } catch {}
  }
  let text = css.join("\n");
  for (const [u, data] of Object.entries(assets)) text = text.split(`url(${u})`).join(`url(${data})`).split(`url("${u}")`).join(`url("${data}")`);
  return { css: text, html: document.documentElement.outerHTML };
});

async function signIn(page, w) {
  await page.getByLabel(w.user, { exact: true }).fill("admin");
  await page.getByLabel(w.pass, { exact: true }).fill(password);
  await page.getByRole("button", { name: w.submit, exact: true }).click();
  const takeOver = page.getByRole("button", { name: /Take over|Assumir/ });
  const list = page.getByRole("heading", { name: w.list });
  await list.or(takeOver).first().waitFor({ timeout: 20000 });
  if (await takeOver.isVisible()) { await takeOver.click(); await list.waitFor({ timeout: 20000 }); }
  return list;
}

for (const lang of only ? [only] : ["pt-BR", "en-US"]) {
  const l = lang === "pt-BR" ? "pt" : "en", w = WORDS[lang];
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: lang });
  await context.addInitScript((chosen) => { localStorage.setItem("alumia.theme", "dark"); localStorage.setItem("alumia.language", chosen); }, lang);
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForTimeout(900);
  if (mode === "gateway") {
    writeFileSync(join(out, `signin-${l}.json`), JSON.stringify(await harvest(page)));
    await signIn(page, w);
    await page.waitForTimeout(800);
    const listed = await harvest(page);
    writeFileSync(join(out, `list-${l}.json`), JSON.stringify(listed));
    console.log(`harvested signin and list, ${l}, ${listed.css.length} bytes of stylesheet`);
  } else {
    const list = await signIn(page, w);
    await page.getByRole("button", { name: new RegExp(`^${w.open}`) }).first().click();
    const handle = page.getByRole("button", { name: w.handle });
    await handle.waitFor({ timeout: 25000 });
    await page.waitForTimeout(800);
    await handle.click();
    await page.waitForTimeout(500);
    writeFileSync(join(out, `session-${l}.json`), JSON.stringify(await harvest(page)));
    console.log(`harvested session, ${l}`);
    await page.getByRole("toolbar").getByRole("button", { name: w.end, exact: true }).click({ timeout: 5000 }).catch(() => {});
    await list.waitFor({ timeout: 20000 }).catch(() => {});
  }
  await context.close();
}
await browser.close();
