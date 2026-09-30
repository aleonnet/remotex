# Repository instructions

Keep this file to rules that change how work is performed. Design explanations,
protocol details, measurements, and operational guides belong in the linked
documentation.

## Workflow

- Strict no backward-compatibility or legacy paths.
- Do not run `cargo fmt`.
- No squash merges.
- After Rust changes, run `cargo clippy --all-targets -- -D warnings` and
  `cargo test --lib`, once each. Run `cargo test --tests` only when the change
  reaches what those tests drive, and a test marked `#[ignore = "slow: …"]` only
  when it reaches what that test checks. Mark a test that waits seconds that way.
- After frontend JS/TS changes, run the Biome checks in `frontend/`.
- Before browser QA of a frontend change, rebuild the gateway and say so: the
  bundle is compiled into the binary. For source-based iteration, use
  `REMOTEX_DEV_BACKEND=<port> bun run dev`.
- After Playwright changes, run `bun run typecheck` in `tests/playwright/`.
- Put temporary files and test configuration under `tmp/`. Always run local
  Python through `uv` (GitHub Actions excluded).
- Errors are `anyhow` by default, and `thiserror` wherever a caller branches on
  the kind. Carry the cause: add `.context()` on the way up, keep an error typed
  rather than flattening it to a `String`, and drop a source only when it says
  nothing the message does not.
- Keep end-to-end tests under `tests/`; dummy RDP/VNC servers may use Docker or
  Podman.

## Product boundaries

- There is one client: the browser SPA, whether in a browser or installed as a
  Chrome or Edge app.
- There is one frontend build, compiled from Cargo's `OUT_DIR` into the gateway
  binary (`src/assets.rs`) and served from its origin root. A standalone build
  and the release artifact use `frontend/dist`; a Cargo build produces the same
  bundle privately or stages that artifact. Do not add a web root, a
  `static_dir`, or any run-time path the SPA is read from. Every URL the page
  uses goes through `frontend/src/gateway.ts`.
- The bundle holds one WebAssembly module, `frontend/wasm/egfx` around
  `crates/remotex-rdp-graphics`, built by the frontend's build for
  `wasm32-unknown-unknown` with threads, by the dated nightly that directory's
  `rust-toolchain.toml` pins. The pin is the module's alone: the gateway and the
  graphics crate build on stable. Its threads share a memory, so every file
  `src/assets.rs` serves carries the two cross-origin isolation headers; keep
  them, and load nothing from another origin.
- The one file read at run time is the EXPERIMENTAL software HEVC decoder's
  release archive, named by `[hevc_wasm]`: read once at start-up, refused unless
  it is the release `src/hevc_wasm.rs` pins by SHA-256, and served from memory at
  `/hevc/`. Do not widen it to another file, an unpinned archive, or a directory.
- The page requires a secure context plus `VideoDecoder` and `AudioDecoder` and
  refuses startup in `frontend/src/preflight.ts` without them. Do not add
  fallback browser paths.
- One gateway has one active session; multi-session support is out of scope.
  Every `connect` starts from scratch after the previous engine exits; only the
  owning browser's reattach to the same target resumes an engine. Preserve the
  takeover and fresh-session behavior in
  [Session lifecycle](docs/architecture.md#session-lifecycle).

## Input and display

- Touch has two mutually exclusive layers: `touchGestures.ts` treats fingers as
  a trackpad and interprets gestures in the page; `touchPassthrough.ts` forwards
  uninterpreted MS-RDPEI contacts when an RDP host reports `touchReady`. Never add
  gesture recognition to touch passthrough. See
  [Browser SPA](docs/architecture.md#browser-spa).
- The display picker is the remote's list and the remote's checkmark: engines
  fill it, and the browser holds no display state of its own. Never move the
  checkmark on the click or add a client-side selection. An engine with nothing
  to choose between sends no list and the panel stays hidden. See
  [Switching outputs over VNC with wlshare](docs/wlshare-outputs.md).
- Pointer clients present the remote desktop at 100%; oversized desktops scroll.
  Do not add fit-to-window, zoom-to-fit, or viewport-derived scaling. Mobile,
  gated by `CAN_PINCH_ZOOM`, is the sole fit-to-width/pinch-zoom exception.
- Neither the gateway nor the browser rescales what a remote sends: frames are
  presented at `w / scale` by the density the remote confirmed. When the size or
  density is wrong for the browser, ask the remote to render the right one and
  output its answer as is. The sole exception is Apple Standard's All Displays
  over screens of different densities: the gateway sends a `mosaic` and the
  browser composes each screen at its points (`frontend/src/mosaic.ts`). Do not
  extend it to another engine, view or density.
- `ClientMsg::Viewport` is in CSS points. `ServerMsg::Resize.scale` is remote
  pixel density, not a fit factor. `resize = true` means the window continuously
  drives the remote size; do not add a client resize toggle or remembered resize
  preference. Density is the wire's word alone, and generic VNC that does not
  answer wlshare's density extension is presented at 1x: do not add a
  client-side density control, and never label a framebuffer with a density the
  server has not confirmed. Read
  [Display geometry](docs/architecture.md#display-geometry),
  [HiDPI over generic VNC](docs/generic-vnc-hidpi.md) and
  [Pixel density over VNC with wlshare](docs/wlshare-density.md) before
  changing geometry.
- Read [Apple RFB 003.889, as measured](docs/apple-vnc-889.md) before changing
  either Apple Screen Sharing subtype. Treat High Performance behavior as
  reverse-engineered measurements, not a specification.

## Media paths

- A session's picture reaches the browser one of two ways, both ordinary:
  - **Encoded here** as VP9 by the gateway's one video encoder, the
    `desktop-vp9` crate wlshare codes its own stream with, pinned by release tag
    in `Cargo.toml`. A libvpx setting, the conversion in front of it, the codec
    string or the quality walk changes in the desktop-vp9 repository and reaches
    here as a pin bump.
  - **Passed untouched**, as the remote made it, for the browser to decode or
    compose: today wlshare's VP9 on a generic VNC target, a High Performance
    Mac's HEVC under `media_passthrough`, and an RDP host's graphics pipeline
    under `egfx_passthrough`, each with its rule below. Another stream the user
    asks to pass joins them with a rule of its own; do not refuse it on this
    rule's account.

  The gateway keeps to one encoder: whatever it transcodes goes to VP9, and a
  second encoder (H.264, AV1 or any other), a codec probe, or a codec key that
  selects one is not added as a side effect of other work.
- The browser is asked two questions, each once at page load and stated on the
  session socket: which VP9 profile its decoder takes (for
  `render_chroma = "auto"`), and whether it decodes a High Performance Mac's HEVC
  and AAC-ELD (for `media_passthrough`). The gateway *selects* on the answers and
  never refuses a client for them, save a gateway whose host lacks FFmpeg or
  fdk-aac facing a browser that cannot take the Mac's stream. Do not grow them
  into a capability negotiation or another reason to turn a session away.
  Preserve the announced configuration and color-space behavior in
  [The codec](docs/architecture.md#the-codec) and
  [Choosing a chroma](docs/architecture.md#choosing-a-chroma).
- The one picture that is neither is PNG tiles: for a desktop past the video
  ceiling on a source that hands over its own rectangles, VNC without `resize`,
  each rectangle exactly as the server sent it. Do not add a key that selects
  tiles, use them within the ceiling, cut, merge or cache rectangles in the
  gateway, or give them to a source with `resize` or without rectangles, which
  still ends on the ceiling's refusal. See
  [Tiles past the ceiling](docs/architecture.md#tiles-past-the-ceiling).
- A generic VNC target lists wlshare's VP9 encoding for every browser, with the
  plan's chroma, dial and walk as pseudo-encodings beside it, and passes its
  frames untouched; any other server ignores the listing and is encoded here
  from ZRLE. Do not transcode a passed frame, pass one from another server or at
  a chroma other than the plan's, ask wlshare for the plan with a client
  message, or add a key that selects it. See
  [wlshare's stream, passed through](docs/architecture.md#wlshares-stream-passed-through).
- Remote audio uses its own `/ws/audio` socket and queue; opening the socket is
  the subscription. Do not put audio on the session socket. It is Opus encoded
  here, save a High Performance Mac's AAC-ELD under `media_passthrough`; there is
  no codec key, and do not add another encoder or another passthrough. Preserve
  claim-bound eviction and the source-format/resampling boundaries in
  [Audio frames](docs/architecture.md#audio-frames).
- Generic VNC audio is wlshare's audio extension (FLAC frames, with the QEMU
  Audio extension's control messages): `audio = true` makes the gateway ask, and
  a server that never announces it leaves the session silent rather than failing
  it. Do not take raw PCM from the RFB connection, add a second codec to it, or
  add a configuration key naming the server. See
  [Desktop audio over VNC with wlshare](docs/wlshare-audio.md).
- `ard` carries no sound and takes no `audio` key: the Mac's sound keeps playing
  where the Mac sends it. Do not add an AirPlay receiver or any other sound path
  for it to the gateway.
- `ard-high-performance` takes the Mac's picture and sound together from High
  Performance's media stream (`src/vnc_apple_media.rs`): HEVC and AAC-ELD over
  SRTP, every packet authenticated before it is decrypted and every report sent
  as SRTCP. The Mac refuses one leg without the other, so the target always
  carries sound and takes no `audio` key. Its decoders, FFmpeg's libavcodec and
  fdk-aac, are the system's shared libraries, loaded when a session needs them,
  so no build links either; only the non-default `apple-hp-media-static` feature
  links static archives instead. A gateway whose host lacks either ends the
  session of a browser that cannot decode the stream before it dials the Mac.
  Zlib carries the picture only until the stream is up and across display
  changes, and a stream that fails ends the session: do not add a subtype
  without the stream or a fallback to zlib, combinations Apple's viewer never
  offers. The Mac's own controller sets the rate from the offer's bitrate
  entries and the gateway's rate reports; do not cap the offer or add a key that
  turns the reports off. See
  [The media stream](docs/apple-vnc-889.md#the-media-stream-high-performances-picture-and-sound).
- `virtual_display = true` on `ard` is the one unofficial combination: Standard
  mode's ZRLE session on the virtual display High Performance asks for, resized
  the same way, with no stream and no sound. It is `ard`'s key alone, refused on
  every other target, and everything but the display follows `ard`. Call it
  unofficial wherever it is named, and tested with macOS 26 only; do not present
  it as a mode of Apple's viewer or grow it into a third subtype.
- `media_passthrough` on `ard-high-performance` passes the Mac's media stream
  unaltered, for a LAN, to a browser that said it decodes both halves: HEVC
  access units on the session socket, AAC-ELD units on `/ws/audio`. Both pass or
  neither does; every other browser is sent VP9 and Opus. The Mac's ZRLE
  rectangles fill the stream's gaps as VP9 encoded here, each switch starting at
  a keyframe, and a PLI is a passed stream's repaint. The page answers for the
  sound by decoding one of the Mac's units in each form `isConfigSupported`
  accepts, since it accepts forms that do not decode, and plays in the form that
  decoded (`frontend/src/appleMedia.ts`). Keep the key to that stream. See
  [Apple's media stream, passed through](docs/architecture.md#apples-media-stream-passed-through).
- `egfx_passthrough` on `rdp` passes the host's graphics pipeline (MS-RDPEGFX) to
  the browser, for a LAN: its commands out of their bulk compression, never
  altered, as `GRAPHICS` records on the session socket behind a `graphicsStart`;
  the gateway neither composes nor encodes them. Every browser composes it, so
  the key alone selects it; do not add a browser question for it. The page
  composes with the gateway's own compositor, `crates/remotex-rdp-graphics`,
  bound to WebAssembly by `frontend/wasm/egfx`: keep that crate building for
  `wasm32-unknown-unknown`. One decoder and compositor is the gateway's rule; do
  not write a second one there. The page, which already carries a software HEVC
  decoder of its own, may decode, compose or present the pipeline its own way
  (on the GPU, say) where that brings a measured gain. The host answers a
  repaint out of its caches, so a reattach starts such a session over; do not
  resume one on a repaint. H.264 stays refused in the capability advertise, and
  a host that draws with bitmap updates is encoded here as VP9. Call it
  experimental wherever it is named to an operator. See
  [RDP's graphics pipeline, passed through](docs/architecture.md#rdps-graphics-pipeline-passed-through).
- Browser camera redirection is MS-RDPECAM on RDP and wlshare's camera extension
  on generic VNC, H.264-only, and never transcoded by the gateway. It uses its own
  `/ws/camera` socket, is explicit per session, and is bound to both claim and
  engine. See [Camera frames](docs/architecture.md#camera-frames) and
  [The browser's camera over VNC with wlshare](docs/wlshare-camera.md).
- Browser microphone redirection is MS-RDPEAI on RDP and wlshare's microphone
  extension on generic VNC: low-bitrate mono Opus from the browser, decoded here
  to the 16-bit PCM the host records in. It uses its own `/ws/mic` socket under
  the camera socket's rules (explicit per session, refused with `4002` when the
  target carries no microphone, closed with the engine) and is never put on the
  session socket. See [Camera frames](docs/architecture.md#camera-frames) and
  [The browser's microphone over VNC with wlshare](docs/wlshare-microphone.md).
- Do not use Windows Server for ordinary camera QA; without the Remote Desktop
  Session Host role it does not offer the enumeration channel. Camera redirection
  is not required in the normal QA flow.

## Packaging and platforms

- Linux x86-64 artifacts target the baseline x86-64 ISA and dispatch SIMD at
  runtime. Never set a global `target-cpu`; use runtime detection and
  per-function `#[target_feature]` when needed. Prebuilt native archives must
  keep the same floor. See
  [x86-64 CPU compatibility](packaging/README.md#x86-64-cpu-compatibility).
- The native `embedded-gateway` feature is the `remotex tui` control plane and
  its hidden `serve-embedded` workers, on Unix and Windows alike, each worker's
  private endpoint a Unix socket or an owner-only named pipe behind
  `src/embedded/transport.rs`. Containers must be built through
  `packaging/build-container-binary.sh`, with default features disabled, and must
  never expose `tui`, `serve-embedded`, or `check-config --embedded`.
- The Windows MSI ships the native binary, `tui` included. Build it with
  `packaging/build-windows-msi.ps1` on `windows-ci-build` through
  `ci/windows/remote.ps1 ci -Package` only when packaging changes: release CI
  builds and install-tests the MSI itself. Do not add a service or
  package-owned live config to it.
- Follow [Packaging](packaging/README.md) for native layouts, prebuilt dependency
  rules, and release workflow.
- `THIRD-PARTY-NOTICES.txt` is a build output of
  `packaging/third-party-notices.py`. Do not commit it or hold it to the
  lockfiles. A new prebuilt C library brings its licence text to
  `packaging/notices/` and the script's list.

## Testing and interactive QA

- Follow [Stable headless browser tests](tests/playwright/README.md). Assert
  deterministic system decisions, not pixels, paint timing, frame rate, latency,
  cursor rendering, or layout-dependent synthetic input. Run headless with one
  worker, use accessible locators and web-first assertions, give wire-format
  specs an independent parser, and call `returnToPicker` from every spec.
- Use `tests/ws_probe.py` to inspect the control messages a browser sees.
- Do not use AppleScript, synthetic clicks, or screenshot loops to inspect a
  browser. Ask the client through deterministic interfaces, and ask the user for
  observations only eyes can provide.
- A virtual Mac (an Apple Virtualization guest) is for smoke tests only: that a
  session connects, shows its picture, starts its sound and survives a resize.
  It lags with sound, and its High Performance sound fails after a minute under
  Apple's own viewer too. Judge performance, sound quality and long sessions on
  a physical Mac, or against Apple's viewer on the same machine first. See
  [The sound](docs/apple-vnc-889.md#the-sound).
- Do not infer GUI or network capabilities from an SSH attachment. A tmux server
  retains the environment and access of the user that started it. Test a
  capability once and read its error; being able to drive the GUI is still not
  permission to do so.
