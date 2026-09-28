# A Windows host's video over its own RDP connection

A proof of concept, on the `poc/dvc-video` branch, for the one way a Windows host
could hand this gateway a stream it codes itself, as wlshare does over VNC
([wlshare's stream, passed through](architecture.md#wlshares-stream-passed-through)).
Windows has no extension point for a codec in its RDP graphics pipeline
(`Microsoft::Windows::RDS::Graphics`): its encoders are its own, and the only video
among them, H.264, is the lossy source the RDP client refuses on purpose
([Source payloads the gateway decodes instead of forwarding](roadmap.md#source-payloads-the-gateway-decodes-instead-of-forwarding)).
What an application on the host can do is open a **dynamic virtual channel** of its
own, inside the RDP connection the session is attached to, and write whatever it
likes on it. This is a **proprietary display side channel** carried by RDP's standard
dynamic-channel transport, not a new RDP graphics codec or decoder extension: RDP
treats its VP9 messages as opaque application data.

The questions were whether that channel can carry the desktop, and whether the host's
own graphics can be turned off beside it, so the host does not encode the same
desktop twice. The answers are yes, and yes — but not with the PDU made for the
purpose.

Measured against one host: Windows 11 Enterprise, build 26200, in a VM with no GPU
(DXGI's adapter is the Microsoft Basic Render Driver), with a browser playing an
animation and a tone.

## The shape

```text
one RDP connection, one Windows session
├── input, Display Control, clipboard, sound: ordinary RDP
├── the graphics pipeline: stalled once the agent's stream is up
└── proprietary display side channel "remotex.video" (an RDP DVC)
    └── the in-session agent: capture → VP9 → the channel
```

The agent (`tests/dvc-video-poc/agent`) runs as the logged-on user in the RDP
session. It opens the channel with

```c
WTSVirtualChannelOpenEx(WTS_CURRENT_SESSION, "remotex.video",
    WTS_CHANNEL_OPTION_DYNAMIC | WTS_CHANNEL_OPTION_DYNAMIC_PRI_HIGH |
    WTS_CHANNEL_OPTION_DYNAMIC_NO_COMPRESS);
```

and writes to the file handle `WTSVirtualChannelQuery` gives it: the documented way
to open a DVC from a session, whose high priority is the one
[`WTSVirtualChannelOpenEx`] names for display data. TermService carries
those bytes to the client as a Create Request for the name and Data on the number it
gave it, exactly as it carries its own channels, and the RDP client
(`src/rdp_client/session.rs`) accepts the name and hands the payloads up. The agent
captures the desktop with DXGI Desktop Duplication, codes it with desktop-vp9 — the
crate the gateway and wlshare code with — at 4:2:0, and cuts each frame into writes
of 32,000 bytes behind a one-byte first/last flag.

The channel inherits everything the connection has: no port, no listener and no logon
of its own, and the session it belongs to is the one Windows attached the connection
to. After a disconnect the agent's write fails with `ERROR_PIPE_NOT_CONNECTED`, its
open fails with `ERROR_NOT_CONNECTED` until a client attaches again, and it had the
channel back within a second of the next connection. The single-session and takeover
rules this gateway keeps therefore hold for the channel without anything added.

## Freshness

A captured frame proves nothing if it is the same surface handed back again. So the
agent paints a small window a different colour every tick, flushes DWM, captures,
and says in each message which colour it painted; the probe decodes the VP9 and reads
the patch. A frame counts as fresh only when the decoded pixels show the colour
painted just before the capture. Every figure below counts fresh frames.

## Suppress Output switches the display off

Suppress Output ([MS-RDPBCGR] 2.2.11.3) is the protocol's way to turn a host's
display updates off: once it is processed, "the server MUST stop or resume sending
graphics updates" ([MS-RDPBCGR] 3.3.5.11.2). It is the obvious way to stop the
host's graphics, and a no-go:

| Phase | Agent frames | Fresh | Host graphics frames |
|---|---|---|---|
| Updates on, 15 s | 141 | 141 | 72 |
| Suppressed, 15 s | 42, all captured before duplication was lost | 42 | 14, then 0 |
| Suppressed, resized to 1600×900, 15 s | 0 | 0 | the reset only |
| Updates on again, 12 s | 45, at 1600×900 | 44 | 38 |

Within 1.5 s of the PDU, Desktop Duplication fails with `DXGI_ERROR_ACCESS_LOST`;
duplicating the output again and a GDI `BitBlt` of the screen are both refused with
`E_ACCESSDENIED`, and `GetPixel` returns a stale value, for as long as updates stay
off. The input desktop stays `Default`, and the host's picture afterwards is the
ordinary desktop: the session is not locked, its display is switched off. Everything
comes back the moment updates are allowed again.

None of that is specified. The DXGI reference gives `DXGI_ERROR_ACCESS_LOST` for a
desktop switch, a mode change or a change of DWM or full-screen state
([`AcquireNextFrame`]), and `E_ACCESSDENIED` for an application without access to
the current desktop image, with the secure desktop as its example
([`DuplicateOutput`]); neither names Suppress Output. A client typically sends the
PDU "when its window is either minimized or restored" ([MS-RDPBCGR] 2.2.11.3), and
screen capture failing on a remote session while its client is minimized is widely
reported, but only in forums and support answers, not in Microsoft's documentation.

## Withholding frame acknowledgements stalls the graphics instead

A graphics pipeline host keeps a list of the frames the client has not yet
acknowledged with `RDPGFX_FRAME_ACKNOWLEDGE_PDU` ([MS-RDPEGFX] 3.2.1.2 and
2.2.2.13). How many it lets pile up is not in the specification: the only flow
control it describes is a server that SHOULD throttle by the `queueDepth` a client
reports ([MS-RDPEGFX] 3.2.5.13), which this client leaves at 0, "unavailable", and
its product behavior appendix has no note on acknowledgements. This host stops at
11. A client that stops acknowledging therefore stops the host's graphics, without
touching the display:

This is deliberately a measured modern-Windows behavior, not the protocol's
acknowledgement opt-out. The specified opt-out sends an acknowledgement with
`queueDepth = 0xFFFFFFFF`; a conforming server then clears its outstanding frames
and must not wait or block on them ([MS-RDPEGFX] 3.2.5.13). This client targets
modern Windows, but the stall still has to be remeasured on each supported Windows
generation rather than inferred from the specification.

| Phase | Agent frames, all fresh | Host graphics frames | Sound |
|---|---|---|---|
| Acknowledged, 30 s | 278 | about 5 a second | 54 buffers per 10 s |
| Withheld, first 10 s | 135 | 12, then 0 | unchanged |
| Withheld, 2 minutes | about 11 a second | 0 | unchanged |
| Withheld, resized to 1600×900, 20 s | 128 | 0 | unchanged |
| Acknowledged again, 20 s | 129, at 1600×900 | the reset, then about 3 a second | 36 buffers, then 56 |

- The host sends 11 frames past the last acknowledgement, then nothing, for as long
  as the acknowledgements are held back: two minutes was measured, and the session
  neither dropped nor degraded.
- The display stays on. Capture stays fresh throughout, and it follows the desktop:
  keystrokes that opened Start and typed into its search reached the session, and
  the agent's frames showed the result while the host's framebuffer on this end did
  not.
- Sound is untouched while the pipeline is stalled: 54 buffers every 10 s is
  44.1 kHz 16-bit stereo. The 10 s after the resume carried 36, under the graphics
  reset and the host's first frames at the new size, and the next 10 s 56.
- Display Control still resizes the session. Duplication is lost at the mode change,
  the agent duplicates again at the new size and goes on. The host's own graphics
  reset for the new size waits until acknowledgements resume, so a gateway on this
  design takes the size from the agent's stream, not from the pipeline. Neither
  MS-RDPEGFX nor Display Control says so; it is measured, as the stall is.
- Only the newest withheld acknowledgement is retained, so the client's state stays
  bounded even if a future Windows build does not stop at 11 frames. It also gives
  the resuming acknowledgement the most recently processed frame required by
  [MS-RDPEGFX] 3.3.5.13. To resume, the client sends that frame with the specified
  `0xFFFFFFFF` suspend sentinel; this clears Windows' outstanding-frame list, and
  the next EndFrame receives an ordinary acknowledgement that opts back in
  ([MS-RDPEGFX] 2.2.2.13). Unlike the stall, this half is specified, and the host
  measured here follows it: its graphics came back after the sentinel.

## The host does not encode twice

Each process's CPU time on the host, sampled every 5 s over alternating minutes of
acknowledged and withheld frames, with the agent running throughout — percent of one
core, averaged over each phase (the host has 4):

| Process | Acknowledged | Withheld | Acknowledged | Withheld |
|---|---|---|---|---|
| TermService's svchost | 8.2 | 1.0 | 7.8 | 1.3 |
| The agent (capture and VP9) | 35.8 | 37.4 | 35.8 | 36.3 |
| The browser playing the animation | 154.5 | 127.4 | 147.5 | 127.7 |

TermService, the process that encodes the host's graphics, falls by 83 to 88% while
the pipeline is stalled. What is left is carrying the agent's stream and the sound
over the connection. No graphics reach the client in those phases, so there is
nothing to decode on this end either. The agent does not move with the phase; the
browser's renderer falls by about 20 points of a core while the pipeline is stalled.

The agent's own figure depends on the content, and on this host it codes VP9 in
software; it is the cost the gateway pays today to encode the pipeline's picture,
moved to the host.

## What a product would take

Not decided, and each of these is a rule this repository keeps
([AGENTS.md](../AGENTS.md#media-paths)) that would need an answer first:

- **An agent installed on every host.** A service that starts the capture in each
  session, including across logon, and a supported way to ship and update it. The
  POC starts it by scheduled task in a session that already exists.
- **No fallback.** A stalled pipeline gives the browser nothing unless the agent
  delivers, so a session whose agent is missing or whose channel closes ends, as a
  failed High Performance stream does.
- **The stream passed through.** A remote's own stream passed untouched is allowed
  where a rule says so; this would be a new one, beside wlshare's.
- **What the POC leaves open.** The secure desktop (UAC, the lock screen), which a
  per-user capture cannot see; the pointer, which Desktop Duplication hands over
  separately; a host with a GPU, where DXGI and a hardware encoder differ; Windows
  Server with the Remote Desktop Session Host role; and sessions longer than the
  two minutes measured.

## Running it

The probe is `tests/rdp_dvc_video_probe.rs`. The agent is built on `windows-ci-build`
and started on the target by scheduled task, in the session the probe logs on to;
everything a run produces — the agent binary and log, host and agent frames as PNG,
CPU samples — lands in `tmp/dvc-video-poc`. Leave an animation and a sound playing on
the host, from a browser: a browser page survives the probe's disconnects, where
ffplay's picture freezes at the first one.

```sh
pwsh -File tests/dvc-video-poc/build.ps1
REMOTEX_UAT_TARGET=windows-ent-sandbox RUST_LOG=remotex::rdp_client=info \
  cargo test --test rdp_dvc_video_probe <test> -- --ignored --nocapture
```

| Test | What it measures |
|---|---|
| `dvc_video_survives_suppress_output` | Suppress Output, a resize under it, a reconnect |
| `dvc_video_with_frame_acks_withheld` | Withheld acknowledgements, two minutes, keystrokes, a resize |
| `host_cpu_acked_against_withheld` | Alternating minutes, for the CPU comparison |
| `animation_page_survives_reconnects` | Whether the host's animation and sound outlive a disconnect |

For the CPU comparison, sample the host beside the run and cut the samples by the
phases the run records:

```sh
pwsh -File tests/dvc-video-poc/cpu-procs.ps1 380 > tmp/dvc-video-poc/cpu-procs.log &
REMOTEX_UAT_TARGET=windows-ent-sandbox cargo test --test rdp_dvc_video_probe \
  host_cpu_acked_against_withheld -- --ignored --nocapture
uv run --python 3.13 tests/dvc-video-poc/analyze_cpu.py
```

[MS-RDPBCGR]: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpbcgr/5073f4ed-1e93-45e1-b039-6e30c385867c
[MS-RDPEGFX]: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpegfx/da5c75f9-cd99-450c-98c4-014a496942b0
[`WTSVirtualChannelOpenEx`]: https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsvirtualchannelopenex
[`AcquireNextFrame`]: https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutputduplication-acquirenextframe
[`DuplicateOutput`]: https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutput1-duplicateoutput
