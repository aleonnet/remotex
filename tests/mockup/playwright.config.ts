import path from "node:path";
import { defineConfig } from "@playwright/test";

// The mockup is one file with no server and no session behind it, so its test is apart
// from tests/playwright, which drives the product. The same rules where they apply:
// headless, one worker, decisions and not pixels.
export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  outputDir: path.resolve(__dirname, "../../tmp/mockup-results"),
  reporter: "line",
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});
