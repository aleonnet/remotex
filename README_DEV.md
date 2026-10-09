# Developing alumia

English · [Português](README_DEV.pt-BR.md)

For whoever changes the code. To run alumia and use it, see the
[README](README.md). The rules that change how work is done here are in
[`AGENTS.md`](AGENTS.md), and the design rules in
[Constraints](docs/architecture.md#constraints): read an area's section before
changing what it covers.

## Build and run

You need [Rust](https://rustup.rs) through `rustup` and [Bun](https://bun.sh).
`wasm-pack` comes with `bun install`, and `rustup` installs the toolchain the
WebAssembly modules pin the first time they are built.

Install the frontend dependencies once, then use Cargo. `cargo run` rebuilds
the frontend when its sources change and compiles the bundle into the gateway
binary.

```sh
bun install --cwd frontend
cp alumia.example.toml alumia.toml
cargo run -- gen-passwd admin
# Paste the generated credential into alumia.toml, then:
cargo run -- serve -c alumia.toml
```

Open <http://localhost:52380>. Use `RUST_LOG=info` or `RUST_LOG=debug` for
backend logs, and `cargo build` to compile without starting the gateway.

What a session's page sees reaches that log too when its laboratory is on:
seven taps or clicks on the "Version" row of the information sheet switch it,
the row says "Lab on" while it is, and the choice is kept in the browser
(`localStorage`, `alumia.lab`). The page then says in `lab` messages what it
saw — the session opening, each `resize`, what its video decoder said, each
keyframe asked for and settled, its sight, the width it shows the picture at,
the sound's lead every ten seconds, and the cursor held at an edge of what is
on screen while the view can move no further, with the window's height and the
browser's visual viewport — and the gateway writes each line as
`lab: …` at `info`, held to four messages a second, twenty lines a message and
240 characters a line (`src/ws.rs`, `frontend/src/lab.ts`). On, the
information sheet also has a Laboratory tab: a live panel of the same events,
counted by kind the moment the page sees them (the picture, the sound, the
tab's sight, the connection), with Copy report. It is how a session
on a phone, which has no console, is read.

A gateway for somebody to try is built with `cargo build --profile qa` into
`target/qa`: optimised as a release build is, without its link-time
optimisation, so a change rebuilds in seconds rather than minutes. A debug
build is too slow to judge a session by.

```sh
cargo build --profile qa
RUST_LOG=info ./target/qa/alumia serve -c alumia.toml
```

The built frontend is embedded in the binary at compile time (`src/assets.rs`),
so `target/release/alumia` runs on its own with no `frontend/dist` beside it.
`build.rs` runs `bun run build` into Cargo's private output directory before
the crate compiles and fails the build if `index.html` is missing afterwards.
There is no dev server: the gateway is the only thing that serves the page. A
release builder can name a platform-independent bundle that it built earlier:

```sh
bun run --cwd frontend build
ALUMIA_PREBUILT_FRONTEND=frontend/dist cargo build --release
```

## Where things are

| Path | Contents |
|---|---|
| `src/` | gateway, session management, and RDP/VNC engines |
| `frontend/` | React SPA |
| `frontend/src/design/`, `frontend/src/words/` | the tokens and the two dictionaries the page reads, written by tools |
| `macos/Alumia/` | the Mac app, a Swift package: `AlumiaCore` decides, `Alumia` is the screens |
| `tests/` | protocol and engine end-to-end tests |
| `tests/playwright/` | the page in a browser |
| `tests/mockup/` | the mockup's own test |
| `tools/` | checks, generators and the test harness's scripts |
| `packaging/` | release, install, and container scripts |
| `docs/` | reference, design, mockups, plans and research |

## Checks

After a Rust change, and after a frontend one:

```sh
cargo clippy --all-targets -- -D warnings
cargo test --lib

cd frontend
bun run check
cd ..
```

After a change to the Mac app:

```sh
cd macos/Alumia
swift build -c release --arch arm64 -Xswiftc -warnings-as-errors
swift test
cd ../..
```

The whole set a delivery is closed with, run once on the final tree:

```sh
cargo clippy --all-targets -- -D warnings
cargo test --lib
cargo test --tests
(cd frontend && bun run check && bun run test)
(cd tests/playwright && bun run typecheck)
uv run --no-project python tools/check-design.py
uv run --no-project python tools/contrast.py
uv run --no-project python tools/refute-mockup.py --anchors
bash tools/run-page-tests.sh
lychee --offline --root-dir . docs/ README.md README.pt-BR.md README_DEV.md README_DEV.pt-BR.md CHANGELOG.md CHANGELOG.pt-BR.md
uv run --no-project python tools/check-docs.py
uv run --no-project python tools/app-words.py --check
(cd macos/Alumia && swift build -c release --arch arm64 -Xswiftc -warnings-as-errors && swift test)
```

Do not run `cargo fmt`. Local Python always runs through `uv`.

## Tests

- **The page's rules**, with no browser: `bun run test` in `frontend/`.
- **The page in a browser, with no remote computer:** `bash
  tools/run-page-tests.sh` builds the gateway's own test harness
  (`serve_a_test_tone` in `src/server.rs`: the real router, with the page
  compiled in and a scripted engine) and runs the specs that need no remote
  against it, in Chromium, and the sound, opening and session specs a second time in
  Apple's engine (`bunx playwright install chromium webkit` once, in
  `tests/playwright/`). `-g <title>` runs the tests whose title matches. See
  [Stable headless browser tests](tests/playwright/README.md): they assert
  decisions, not pixels.
- **Proofs that the tests fail when they should:**
  `uv run --no-project python tools/refute-page.py` plants one defect at a
  time in the code of the page, the gateway or the Mac app and requires the
  named test to fail with the exact words. It takes minutes and is not a gate;
  `--anchors` only checks that each defect still finds its place.
- **VNC against a container.** The container-backed VNC test uses Docker or
  Podman and does not start a browser. It is ignored by default; run it
  explicitly with:

  ```sh
  cargo test --test vnc_e2e -- --ignored
  ```

  For a remote Podman connection:

  ```sh
  CONTAINER_CONNECTION=workstation-wsl \
  ALUMIA_TEST_CONTAINER_HOST=<engine-host> \
  cargo test --test vnc_e2e -- --ignored
  ```

  `CONTAINER_CONNECTION` is the Podman system connection name.
  `ALUMIA_TEST_CONTAINER_HOST` is the engine host's IP address or DNS name as
  reachable from the machine running the tests; an SSH config alias is not
  resolved for the tests' direct VNC connections.
- **RDP against a real machine.** RDP has no container to test against: the
  gateway's RDP client speaks NLA to a current Windows host and nothing else,
  so its end-to-end tests borrow a real machine. See
  [`tests/rdp_proto_probe.rs`](tests/rdp_proto_probe.rs) and
  [`tests/rdp_client_probe.rs`](tests/rdp_client_probe.rs).
- **A real Mac or Windows host in a browser:** the specs `batch-envelope`,
  `clipboard`, `oversized-clipboard`, `display-drag`, `egfx-passthrough`,
  `egfx-two-displays`, `software-hevc` and `video-stream` under
  `tests/playwright/` need one, and are not run by the harness.
- `tests/ws_probe.py` shows the control messages a browser sees.
- **The gateway a Mac app hosts:** `cargo test --test app_mode_e2e` runs the
  real binary as `serve --app` in a folder of the test's own, on a Mac. With
  `ALUMIA_TEST_BINARY=<bundle>/Contents/Helpers/alumia` it runs the same cases
  against the binary inside a bundle.
- **The Mac app:** `swift test` in `macos/Alumia` covers what the app decides,
  with no screen. `packaging/build-mac-app.sh --test --smoke` builds a copy
  that never touches an installed Alumia and has it check its service by
  itself. See [The Mac app](docs/mac-app.md#a-copy-made-for-testing).

## The interface: design system, mockup and words

The page's colours, sizes and times come from one file of tokens, its texts
from two dictionaries, and its messages from one catalogue. None is written by
hand in the page, and none in the terminal or in the Mac app either.

- [`docs/design/`](docs/design/2026-10-03-0003-design-system.md): the design
  system, its addenda, the tokens (`alumia.tokens.json`), the words of the
  interface in both languages (`words.json`), the glyphs (`glyphs/`, one SVG
  each), the message catalogue (`errors.json`) and the texts the product has
  and the source does not (`product-words.json`).
- `docs/mockups/`: the mockup, and the drawing of the list of computers. It is
  a document, where a text is read and approved and a glyph is first drawn,
  and a consumer of the sources: `tools/mockup_sources.py --extract` promotes
  what it carries to `words.json` and `glyphs/`, `--refresh` sends
  `words.json` back into it, and `tools/check-design.py` holds its copies to
  the sources. A tree without it builds and checks the same: the public
  repository, `aleonnet/alumia`, has neither it nor `docs/comparisons/`.
- `tools/product-words.py` and `tools/product-glyphs.py` write
  `frontend/src/words/` and `frontend/src/Glyph.tsx` from `words.json` and
  `glyphs/`; with `--check`, each holds what it wrote to its source.
- `tools/check-design.py` holds the page to all of it: no colour written by
  hand, no text without a source, no message without a code. It holds the
  terminal to the same: what a command says to a person is the catalogue's or
  `docs/design/terminal-words.json`'s, in English and in Portuguese. And it
  holds the engines: every sentence one writes for an error names its cause, or
  is listed in the catalogue as kept, with why.
- `tools/app-words.py` writes the Mac app's dictionary from the `mac.` texts of
  `words.json`, `docs/design/app-words.json` and the catalogue, and with
  `--check` fails on a text typed in Swift.
- `tools/compare-screens.sh` photographs the product beside the mockup into
  `docs/comparisons/`. No test depends on a photograph, and in a tree without
  the mockups it refuses in a sentence.
- `tools/product-icons.mjs` writes what installing the page needs into
  `frontend/public/`: the web app manifest, and the mark rendered as the icons
  it names, with the Chromium of `tests/playwright/`.

## The public page and the README's pictures

The page at `site/` and the pictures of `docs/readme/` are built from the
product and kept in the repository: `bash tools/site/build.sh` compiles the
gateway, runs it with the three computers of example of `tools/site/site.toml`
and the test harness beside it, harvests the page it serves into
`tools/site/dom/` and photographs it, builds `site/index.html` from
`tools/site/template.html`, `tools/site/words.json` and the product's code (the
shaders, the glyphs, the font, the tokens, the Mac app's dictionary), and
photographs the Mac app's screens from that page. It needs the Chromium of
`tests/playwright/`. `tools/site/check.py` holds the page and the two READMEs to
what was approved: the product's words, and pictures of the product only. The
workflow `.github/workflows/pages.yml` publishes `site/` as it is, in the public
repository, on every push to its main that touches `site/`: the page is
<https://aleonnet.github.io/alumia/>.

## Documents

- The map of every document is [`docs/README.md`](docs/README.md), in
  Portuguese. It is the first file to open when resuming work.
- A new document is named `yyyy-mm-dd-hhmm-description.md`, with a `status:`
  of `proposto`, `rejeitado`, `aceito`, `obsoleto` or `superado por <file>`.
  To revise one, a new file is created and the old one is marked superseded;
  it is never rewritten in place.
- The three entry documents exist in English and in Portuguese: `README`,
  `README_DEV` and `CHANGELOG`. `tools/check-docs.py` holds the two languages
  of each to the same sections, the same command blocks and the same links.
- A change somebody would notice goes into the [changelog](CHANGELOG.md),
  under *Unreleased*, in both languages.

## Packaging and release

```sh
bun install --cwd frontend
cargo build --release
bash packaging/build-tarball.sh
bash packaging/build-native-packages.sh
```

Local Cargo builds automatically rebuild the frontend when its sources change,
and the binary carries it. The native package builder consumes the tarball so
every artifact contains the same gateway binary. Artifacts are always built
`--release`.

The Mac app and its disk image are built by themselves, on the Mac that holds
the signing identity:

```sh
bash packaging/build-mac-app.sh
ALUMIA_SIGN_IDENTITY="Developer ID Application: …" ALUMIA_NOTARY_PROFILE=<profile> \
  bash packaging/build-mac-dmg.sh
```

Without an identity the first signs ad hoc, which runs on that Mac alone; the
second needs the identity and a stored notary profile, and fails unless the
image comes out notarized. See [The Mac app](docs/mac-app.md#building-it).

[Packaging](packaging/README.md) has the native layouts, the prebuilt
dependency rules, the x86-64 CPU floor and the release workflow,
[Installing](docs/install.md) what each package installs, and
[Releasing](docs/release.md) how a version is published: the tag on `main`,
`tools/publish-public.sh`, the public repository `aleonnet/alumia` and its
release, each step as a command with what its output says. Before a version
is tagged, `tools/rehearse-publish.sh` rehearses its publication from end to
end with nothing reaching GitHub, and the release workflow dispatched in this
repository rehearses its packages, publishing nothing.

## Bringing in the original's work

alumia began as [remotex](https://github.com/andrewtheguy/remotex). The remote
`upstream` is the original, and nothing is pushed to it.

- `tools/sync-original.sh` brings the original's new work in, already renamed,
  and leaves the merge uncommitted: the checks run before the commit.
- `tools/rename-product.sh` renames the product across the repository.
- No squash merges.
