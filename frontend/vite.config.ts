import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The version shown on the login screen. Cargo.toml is the single source of
// truth (frontend/package.json stays an unused placeholder).
const cargoToml = readFileSync(
  new URL("../Cargo.toml", import.meta.url),
  "utf-8",
);
const version = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "dev";

// A standalone `bun run build` writes frontend/dist. Cargo instead sets this to
// its private OUT_DIR, because generated files are outputs rather than inputs to
// build.rs. Either way the one bundle is compiled into the gateway binary
// (src/assets.rs), which serves it over HTTP from an origin root. The gateway is
// the only thing that serves the page: there is no dev server in front of it.
const outDir = process.env.REMOTEX_FRONTEND_OUT_DIR ?? "dist";

export default defineConfig({
  // Relative asset URLs, and safe here rather than by luck: there is no
  // client-side router, so the document is only ever at `/` or at a one-segment
  // path the SPA fallback answered — and `./assets/…` resolves to `/assets/…`
  // from both.
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir,
    // Vite does not empty an output outside the project root by default. Cargo's
    // directory must not retain obsolete content-hashed assets between builds.
    emptyOutDir: true,
  },
  plugins: [react()],
});
