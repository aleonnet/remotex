import path from "node:path";
import { defineConfig } from "@playwright/test";

// The engine a run drives: Chromium, or Apple's when
// `ALUMIA_PLAYWRIGHT_ENGINE=webkit` asks for it, which is how
// tools/run-page-tests.sh runs the sound's, the opening's and the session's
// specs a second time. An iPhone's every browser is that engine, and what the page decides by
// the browser it is in (when sound may start, which decoder there is) is decided
// there and nowhere else.
const webkit = process.env.ALUMIA_PLAYWRIGHT_ENGINE === "webkit";

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: path.resolve(__dirname, "../../tmp/playwright-results"),
  reporter: "line",
  use: {
    headless: true,
    // The page speaks the browser's language (frontend/src/words.ts), and the
    // specs find their controls by name: stated here, so a run does not depend
    // on the language of the machine it is on.
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
    browserName: webkit ? "webkit" : "chromium",
    // Apple's engine has no such permissions to grant: it asks at each paste.
    permissions: webkit ? [] : ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
});
