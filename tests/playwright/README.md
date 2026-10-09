# Stable headless browser tests

One rule decides what belongs here: **assert on what the system decides, never on
what a machine's timing decides.**

In scope, because their values are deterministic — DOM state and accessible roles,
control-plane JSON, HTTP responses, and WebSocket frame bytes (header fields,
record counts, payload lengths, ordering). `framereceived` qualifies because it is
a transport event carrying a fixed payload.

Out of scope, because their values are a race — canvas pixels, whether or how many
paints happened, frame rate or latency, cursor rendering, synthetic pointer input
and gestures, and screenshot comparison. The Rust protocol and container E2E tests
cover those; they control their own clock.

The quieter flaky shapes are worth naming too, because they pass locally and fail
in a year: fixed sleeps, CSS or nth-child selectors, assertions on transient states
a fast machine skips through, and counts taken over a wall-clock window. Where a
count is the point, assert a relationship that holds for any sample — `records >
frames` — not a number that depends on how long the run happened to watch.

`batch-envelope.spec.ts` is the v4 binary envelope, read off the SPA's own socket.
It exists because it is the only test that watches the browser link as the browser
actually uses it — the Rust E2E tests drive a raw WebSocket client, and the
TypeScript unit tests parse frames they built themselves, so both ends can
agree with their own fixtures and disagree with each other. Its frame parser is
deliberately a second implementation rather than an import of the SPA's, because a
wrong parser would otherwise agree with itself.

`video-stream.spec.ts` is the desktop's stream read from the same socket. Video is
VP9 only, and the harness desktop is well within the video ceiling, so every record
is VIDEO and everything it asserts is
decidable without asking the browser anything. It parses VIDEO records itself — op, keyframe flags byte, the desktop size the last
`resize` announced — and checks that no access unit outran the `videoFormat` that
says how to decode it.

`egfx-passthrough.spec.ts` is an RDP host's graphics pipeline passed for the page
to compose, read from the same socket: that `graphicsStart` comes ahead of the
first `GRAPHICS` record, that every record is whole commands by their own
headers' lengths, that the page acknowledges each batch once its paint worker has
composed it, and that a page that reloads is given a pipeline from its first
command rather than the one that was running. A compositor that refused a command
says so in the DOM, which is what stands in for the picture here. Against a target
with the EXPERIMENTAL `egfx_h264` key, and a host playing a video, it also asserts
that the page said it decodes H.264, that the session says it carries it, and that
a batch whose commands draw with H.264 is acknowledged: the acknowledgment follows
the decode of every access unit in the batch, and a decoder that gave no picture
says so in the DOM instead.

`egfx-two-displays.spec.ts` is the same pipeline passed over two virtual
displays, read from both displays' sockets of one browser: that each socket
names the column of the composed picture its display is (`graphicsView`) beside
its size, that the second display's tab is sent no picture of its own — no
`videoFormat`, no binary frame, no `graphicsStart` — and shows the canvas it is
painted on from the session page's picture all the same, and that the picker
moving the session's page to the other display moves the view without starting
the pipeline over.

`display-drag.spec.ts` reads the input each display socket sends while a held
drag crosses the edge between two virtual displays. It checks that the edge
towards the display beside it is open and every outer edge still clamps the
pointer, without judging whether a remote window visibly followed the drag.

`software-hevc.spec.ts` is the BETA software HEVC decoder, in a High
Performance session started with the Mac's stream passed and the page loaded with
`?hevc_decoder=software`. Against a gateway that has the decoder's archive it
asserts that the page is cross-origin isolated and says it decodes the Mac's
stream, that the gateway passes the HEVC, that the page asks for the decoder and
its worker loads it, and that the first passed keyframe's batch is acknowledged
with no video error or repaint request before it — an ordering, not a timing,
because a failed decoder reports before the paint worker acknowledges. Against a
gateway without the table it asserts the fallback: the page remains isolated,
asks for the decoder and gets a 404, then selects VP9.

`input-held.spec.ts` is a High Performance wait holding input back: that while
the gateway's `resizing` or `screenUnavailable` is true the page sends no `key`
frame, and that a key held when the wait went up is released. The wait is found
by the line its plate says ("Resizing…", "Waiting for the remote screen…"). The session
socket is passed through the spec, which keeps the gateway's word on both from
the page and says them itself, so when the notice is up is the spec's decision
rather than a Mac's display settling, and it runs against whatever target the
run is configured for. It asserts the order of the frames the page sent and
whether the notice is in the DOM.

`audio-socket.spec.ts` keeps sound on its dedicated `/ws/audio` connection. It
asserts which socket receives the format and packets, that a session started with
sound opens that socket and one started without it does not, and that opening and
closing it is the whole subscription, a mute surviving a reload. The deterministic
tone harness in `src/server.rs` supplies audio without a remote.

`picker-options.spec.ts` is what a session is started with: that Open sends
the choices made by the keys of the computer's monitor and `connected` reports
them back, that each key says what the session will have and goes to its other
choice as it is pressed, that the browser remembers what was chosen, and that a
second browser taking the session over is given none of it: it lands on a list
whose line says why a passthrough its address asks for cannot be had there. It
needs an `rdp` target that configures a `size`, the one type that has a size to
choose, a sound to bring and a stream to pass, and the tone harness is one.

`computers.spec.ts` is the list itself. The gateway under test has one target,
so the answer to `GET /api/targets` is replaced in the browser by one computer
of each kind the page tells apart, and one Mac listed twice at its address, once
in each of its two modes, under the gateway's own headers. It asserts that the
Mac is one line under what its two names share, what each line is called, which
of its three places are keys and which are marks, and what each says; that the
line's tip comes up while the pointer rests on the monitor and, for a finger,
for a moment after a key is pressed; what Open sends after each key, read from
the session socket, the target of a Mac's other mode included; that the choices
come back after a reload; that a computer which cannot be opened says why with
Open off, that a refused Open is said in the notice with its code and cause,
what the list says while loading, empty, failed and out of date, that signing
out comes back to the sign-in, and that the list is never wider than its window
in either language, with a tip up.

`signin.spec.ts` is the sign-in and the page's own two preferences. It asserts
which message of the error catalogue a failed sign-in is given, with its code
(wrong credentials, a gateway that refuses, one that does not answer); that the
eye changes the field's type and says so, and that sending hides the password
again; that a login is kept only where the box is ticked, read from the request
and from the cookie's lifetime; that the language and the theme chosen show at once and survive a
reload; that the tab's icon is the mark, and the gateway's own logo where it
says it has one; that the sign-in is never wider than its window, in both languages; and
that the unlit glass behind it asks for a frame only through the one clock, for
none where motion is reduced, and is not needed where there is no WebGL 2. It
needs a gateway with a web login and nothing else, which the tone harness is.

`clipboard.spec.ts` is the live-Mac regression for the web clipboard sheet. It
proves that unsolicited remote copies still auto-sync, while opening and
revealing the panel leave the local clipboard untouched until explicit Copy.

`oversized-clipboard.spec.ts` covers the refusal path: a Mac pasteboard larger
than `MAX_CLIPBOARD_BYTES` reaches the panel as its size, not as the first 512 KiB
of itself. It is here rather than only in the Rust unit tests because
the claim spans macOS Screen Sharing, the gateway, the browser link and the panel,
and the failure it guards against — a truncated value arriving *successfully* —
is invisible to any one of them.

`support.ts` holds what the specs share: the login/target flow and the SSH hooks
that read and write the Mac's pasteboard. A spec names what its session is started
with — resize, sound, the target's passthrough — and the flow puts the keys of the
computer's monitor where that asks before pressing Open, and asks for a passthrough
by the page's address, so a run does not depend on what an earlier one left
remembered in the browser. Two conventions live there. Every spec
hands the session back to the picker in an `afterEach` through `leaveSession`,
because the server keeps a target session running when its browser goes away and a
spec that failed halfway would otherwise leave it there; and `logInAndConnect`
accepts either landing, so a run abandoned on the desktop does not break the next
one.

`opening.spec.ts` is what the page shows before there is a picture. That it says
it cannot start, with the catalogue's sentence and code and with nothing asked of
the gateway, at an address that is not secure (a name mapped to the harness by
`--host-resolver-rules`, which the browser does not treat as loopback) and in a
browser without a decoder; the four states of the screen that lights, with the
remote's `resize` held back for as long as it takes to read each; that Cancel
tells the gateway to stop and is absent while reconnecting; whose the session is,
with a second browser holding it, a refused claim and a newer gateway each said
by `page.route`; that the interface's clock never runs where motion is
reduced or there is no WebGL 2; that a phone says the width it shows the
picture at (`shown`) when the session opens and again when it is turned; and
that the screen grows from the monitor under the page's own clock, which gives
no frame of the interface's.

`session.spec.ts` is a session: what the bar and its menu offer, that the remote
is sent no key and no click while something is open over it and is sent them
again when that closes, the list of screens, the clipboard, the keyboard on
screen in each of its formats, the information, the list of screens (and that a
Mirrored session's other screens are shown as unavailable, with why, and a press
on one sends nothing), what covers the remote (and
that a picture that has not come is waited for on the lit screen under the
session's name, with no title and no banner, the line changing to the resize's
while one holds), the dialogs, and a sound the browser cannot decode. It reads what the page sends on
its session socket, and says in the remote's place what only a real remote
sends. Of the page's own rules it asserts that the clipboard is read on focus
where a read is granted on the `clipboard-read` permission and not where the
browser knows none (said in Chromium with a Permissions API that refuses the
name stood in), and that the sheet's Paste button reads this browser's clipboard
into the field inside the tap; that seven taps on the
version switch the laboratory, which the row says and which sends `lab`
messages within the gateway's limits, and that the sheet then has a Laboratory
tab, an instrument panel whose gauges change as the page sees things (the hidden
gauge reads 1× after the page hides and comes back, and the last event says the
decoder started over), with the last minute's trace and a Copy report that puts
the panel on the clipboard;
and that a page that hides and comes back
says `sight` both ways, asks for a keyframe, is not settled by a unit that is
no keyframe and is by one that is.

Of the keyboard on screen it asserts the `key` frames that leave and the
accessible state of the keys, and never repeat, how long a key is held or where a
key is drawn. In its window: that a key is sent down then up when it is let go,
that a press that slides to the key beside it is that key's and one let go off
the keyboard is none, that Shift is held for one key and let go by a second
press, that Caps Lock is a Shift around each letter and Fn brings its rows
without moving a key, that a key is pressed from a real keyboard too, and that
the window is carried with the arrows and stays on the page. On a phone, upright
and on its side, which the test declares by its size and its fingers: that the
keyboard is docked with no bar beside it, that the strip and its arrows are on
both pages, that a tapped Ctrl is held for the next key, that with the Sticky key
off a modifier is sent alone, that a symbol of the second page that needs Shift
is Shift and its key, that a modifier held with no key on the page in view is
named there, that no key's word is cut, and that the keyboard is as tall on one
page as on the other.

`throughput.spec.ts` is the meter, from the list and from a session. The harness
keeps no meter, so the spec answers `/api/config`, `/api/throughput/live` and
`/api/throughput` in the gateway's place, and asserts what the page does with
the answers.

These three stand in front of the gateway with `stageSession` (`support.ts`): a
`page.routeWebSocket` that passes every message on to the real gateway and back,
and lets a spec hold one of the gateway's back, change one, keep one of the
page's from it, or say one the gateway did not. A phone or a tablet is opened
with `withFingers`: a browser under test reports one touch point however it is
opened, and the page takes two for a touch client.

One thing about the harness sets their waits (`SESSION_TIMEOUT_MS`): the gateway
waits up to five seconds for an engine it ended before it starts the next, and
the harness's scripted engine never ends by itself, so every session after the
first on one harness takes that long to answer.

## Run

Install Chromium once, and Apple's engine with it, which the page's own run
drives the sound, the opening and the session specs in a second time:

```sh
cd tests/playwright
bunx playwright install chromium webkit
```

The runner itself needs no separate step: every `bun run` script here installs the
pinned dependencies first if `node_modules` is missing, which it is in a fresh
clone.

Start the gateway from the repository root. It serves the page the specs open,
the bundle compiled into it, so a frontend change is in a run only after the
gateway is rebuilt:

```sh
cargo run -- serve --config tmp/test_config.toml
```

Then provide the gateway's address, the local test login and the SSH destination
for the Mac target:

```sh
cd tests/playwright
ALUMIA_PLAYWRIGHT_BASE_URL='http://127.0.0.1:<port>/' \
ALUMIA_PLAYWRIGHT_USERNAME='<username>' \
ALUMIA_PLAYWRIGHT_PASSWORD='<password>' \
ALUMIA_PLAYWRIGHT_TARGET='mac' \
ALUMIA_PLAYWRIGHT_MAC_SSH='<ssh-user>@<mac-host>' \
ALUMIA_PLAYWRIGHT_MAC_SCREEN_SHARING='<mac-host>:5900' \
bun run test
```

`ALUMIA_PLAYWRIGHT_MAC_SCREEN_SHARING` opts into the specs that need a live Mac
target; without it they skip, so a plain `bun run test` never assumes a VM
is up. The helper checks that the Mac's Screen Sharing service is listening at
that address before starting, rather than failing later inside the browser and
making an unavailable target look like a product bug. This is the same bargain
the Rust e2e tests make with `#[ignore]`.

The video spec needs a local gateway config with a live target. Put that
gitignored config under `tmp/` (for example, `tmp/qa_video.toml`) and name the
target with `ALUMIA_PLAYWRIGHT_VIDEO_TARGET`:

```sh
cargo run -- serve --config tmp/qa_video.toml
```

```sh
cd tests/playwright
ALUMIA_PLAYWRIGHT_BASE_URL='http://127.0.0.1:52889/' \
ALUMIA_PLAYWRIGHT_USERNAME='admin' \
ALUMIA_PLAYWRIGHT_PASSWORD='<password>' \
ALUMIA_PLAYWRIGHT_VIDEO_TARGET='video' \
bun run test:video
```

That gateway serves the SPA compiled into its binary, so rebuild the gateway
after a frontend change and restart it; a stale bundle is exactly what these
specs cannot see.

The passthrough spec needs a live RDP host, in a target named by
`ALUMIA_PLAYWRIGHT_EGFX_TARGET`, and starts its sessions with the pipeline
passed:

```sh
cd tests/playwright
ALUMIA_PLAYWRIGHT_BASE_URL='http://127.0.0.1:52889/' \
ALUMIA_PLAYWRIGHT_USERNAME='admin' \
ALUMIA_PLAYWRIGHT_PASSWORD='<password>' \
ALUMIA_PLAYWRIGHT_EGFX_TARGET='win' \
bunx playwright test '/egfx-passthrough\.spec\.ts$'
```

Its H.264 case needs a target with `egfx_h264 = true`, named by
`ALUMIA_PLAYWRIGHT_EGFX_H264_TARGET`, while the host is playing a video:

```sh
ALUMIA_PLAYWRIGHT_EGFX_H264_TARGET='win-h264' \
bunx playwright test '/egfx-passthrough\.spec\.ts$'
```

The two-display spec needs the same kind of host, in a target with
`virtual_displays = 2`, named by `ALUMIA_PLAYWRIGHT_EGFX_DISPLAYS_TARGET`:

```sh
ALUMIA_PLAYWRIGHT_EGFX_DISPLAYS_TARGET='win2' \
bunx playwright test '/egfx-two-displays\.spec\.ts$'
```

The cross-display drag spec accepts either an RDP or High Performance target
with two virtual displays. Name it with `ALUMIA_PLAYWRIGHT_DRAG_TARGET`:

```sh
ALUMIA_PLAYWRIGHT_DRAG_TARGET='win2' \
bunx playwright test '/display-drag\.spec\.ts$'
```

The software HEVC spec needs a gateway whose config has an
`ard-high-performance` target, with the pinned
release archive beside the config (where a gateway run from a Cargo build looks
for it), and names that target with
`ALUMIA_PLAYWRIGHT_HEVC_TARGET`:

```sh
gh release download v0.0.3 --repo andrewtheguy/hevc-wasm-archives \
  --pattern hevc-wasm-v0.0.3.tar.gz --dir tmp
cargo run --profile qa -- serve --config tmp/qa_hevc.toml
```

```sh
cd tests/playwright
ALUMIA_PLAYWRIGHT_BASE_URL='http://127.0.0.1:52889/' \
ALUMIA_PLAYWRIGHT_USERNAME='admin' \
ALUMIA_PLAYWRIGHT_PASSWORD='<password>' \
ALUMIA_PLAYWRIGHT_HEVC_TARGET='macvmhevc' \
bun run test:hevc
```

Against a gateway without the archive, add `ALUMIA_PLAYWRIGHT_HEVC_WASM=0`,
which runs the fallback test instead.

The sign-in, list, audio, picker, opening, session and meter specs use the
test-tone gateway instead of a live target, and one command builds it and then,
for each spec file, starts it, runs the file against the address it prints and
stops it:

```sh
bash tools/run-page-tests.sh
ALUMIA_PAGE_SPECS="opening session" bash tools/run-page-tests.sh   # those files alone
```

What follows it is passed to Playwright, so `bash tools/run-page-tests.sh -g eye`
runs the tests whose title matches.

Every file runs in Chromium. The sound, the opening and the session specs run
again in Apple's engine (`ALUMIA_PLAYWRIGHT_ENGINE=webkit`, which the script sets): every
browser of an iPhone is that engine, and what the page decides by the browser it
is in is decided there, when sound may start, which video decoder there is, what
a press leaves focused. The session spec's two decoder tests feed that engine's
own decoder a broken keyframe and then a real one, and the sound spec's reload
test holds there what that engine does and Chromium does not: the session comes
back muted, and says so. `ALUMIA_PAGE_WEBKIT_SPECS`
names the files run there, and set empty leaves Chromium alone. A test that
cannot hold in Apple's engine for a reason of the tool, and not of the page, is
skipped there with the reason beside it: the page opened at a name only a
Chromium launch option maps, the test that reads the browser's clipboard
from a script, and the test of a sheet keeping room for its scroll bar, which
needs a scroll bar that takes room: that test styles the sheet's, since a Mac's
own are drawn over the content, and Apple's engine reserves no gutter for a
styled one. It is desktop WebKit as Playwright builds it, not an iPhone: what
only a phone does, the tab put in the background above all, is still measured on
the device.

By hand it is the harness, which waits fifteen minutes:

```sh
cargo test --lib serve_a_test_tone -- --ignored --nocapture
```

and, against the URL it prints:

```sh
cd tests/playwright
ALUMIA_PLAYWRIGHT_BASE_URL='http://127.0.0.1:<port>/' \
ALUMIA_PLAYWRIGHT_USERNAME='admin' \
ALUMIA_PLAYWRIGHT_PASSWORD='hunter2' \
ALUMIA_PLAYWRIGHT_AUDIO_TARGET='test-tone' \
ALUMIA_PLAYWRIGHT_PICKER_TARGET='test-tone' \
bunx playwright test '/(signin|computers|audio-socket|picker-options)\.spec\.ts$'
```

The notice spec runs against the same gateway, as the run's target:

```sh
ALUMIA_PLAYWRIGHT_TARGET='test-tone' \
bunx playwright test '/input-held\.spec\.ts$'
```

The picker spec also runs against a live RDP host, named the same way.

`bun run test` runs all specs. `bun run test:clipboard`,
`bun run test:oversized`, `bun run test:video` and `bun run test:hevc` run one
each; their filters are anchored (`'/clipboard\.spec\.ts$'`) because a
positional argument is a regex matched against the whole path, and the bare name `clipboard.spec.ts` also matches
`oversized-clipboard.spec.ts`.

The specs are TypeScript, which Playwright transpiles itself — and transpiling is
all it does, so a type error would otherwise never surface. `bun run typecheck`
is what actually checks them:

```sh
cd tests/playwright
bun run typecheck
```

The defaults are `http://127.0.0.1:52380/`, the gateway's built-in port, and
target `mac`. Override the URL with `ALUMIA_PLAYWRIGHT_BASE_URL` when the
gateway's config names another port.
Live-target groups are skipped with a message naming their missing opt-in when
their configuration is absent. The browser is told its language is `en-US`
(`playwright.config.ts`): the page speaks the browser's language, and the specs
find their controls by name. They always run headless with one worker, and share the
single session slot, which is why they are sequential by configuration rather
than by luck.
