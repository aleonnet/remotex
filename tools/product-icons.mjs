// Write what installing the page needs, from the mark and the tokens: the web
// app manifest and the icons it names, into frontend/public/, which Vite puts at
// the root of the bundle the gateway serves (src/assets.rs).
//
// The icons are the mark (frontend/src/design/favicon.svg) rendered by the
// Chromium the browser tests already have, at the two sizes Chromium requires of
// an installable page (192 and 512: MDN, "Making PWAs installable") and the one
// an iPhone's home screen takes (180, `apple-touch-icon`). The manifest's colours
// are the glass the mark sits on (docs/design/alumia.tokens.json, color.brand.glass):
// nothing here is written by hand a second time.
//
//     node tools/product-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../tests/playwright/node_modules/@playwright/test/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mark = readFileSync(join(root, "frontend/src/design/favicon.svg"), "utf8");
const tokens = JSON.parse(readFileSync(join(root, "docs/design/alumia.tokens.json"), "utf8"));
const glass = tokens.color.brand.glass.$value.hex;
const out = join(root, "frontend/public");
mkdirSync(join(out, "icons"), { recursive: true });

const ICONS = [
  ["icons/alumia-192.png", 192],
  ["icons/alumia-512.png", 512],
  ["icons/apple-touch-icon.png", 180],
];

const browser = await chromium.launch();
for (const [name, side] of ICONS) {
  const page = await browser.newPage({ viewport: { width: side, height: side }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${side}px;height:${side}px}</style></head><body>${mark}</body></html>`,
  );
  await page.screenshot({ path: join(out, name), omitBackground: true, type: "png" });
  await page.close();
  console.log(`wrote ${name} (${side}×${side})`);
}
await browser.close();

const manifest = {
  name: "alumia",
  short_name: "alumia",
  start_url: "/",
  display: "standalone",
  background_color: glass,
  theme_color: glass,
  icons: ICONS.filter(([, side]) => side !== 180).map(([name, side]) => ({
    src: `/${name}`,
    sizes: `${side}x${side}`,
    type: "image/png",
  })),
};
writeFileSync(join(out, "manifest.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote manifest.webmanifest (${glass})`);
