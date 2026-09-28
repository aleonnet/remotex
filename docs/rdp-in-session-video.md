# A Windows host's video over its own RDP connection

A Windows host can hand this gateway a stream it codes itself, as wlshare does over
VNC ([wlshare's stream, passed through](architecture.md#wlshares-stream-passed-through)):
the host encodes its desktop as VP9 and the gateway passes each frame to the browser
as it came, so the encode this gateway does for an RDP target moves to the host and
nothing in between decodes or encodes a picture.

Windows has no extension point for a codec in its RDP graphics pipeline
(`Microsoft::Windows::RDS::Graphics`): its encoders are its own, and the only video
among them, H.264, is the lossy source the RDP client refuses on purpose
([Source payloads the gateway decodes instead of forwarding](roadmap.md#source-payloads-the-gateway-decodes-instead-of-forwarding)).
What an application on the host can do is open a **dynamic virtual channel** of its
own, inside the RDP connection the session is attached to, and write whatever it
likes on it. So the stream comes from an **agent** running in the session, over a
**proprietary display side channel** carried by RDP's standard dynamic-channel
transport. It is not a new RDP graphics codec or decoder extension: RDP treats the
channel's messages as opaque application data.

The gateway's side is `src/rdp_client/proto/video.rs`, the RDP client's session and
the RDP engine. The agent is a proof of concept, `tests/dvc-video-poc/agent`, started
by hand or by the probe: nothing installs it or starts it at logon.

## Passed, or not taken

The stream exists to be passed through and for nothing else. The agent codes to the
plan the gateway states, which is what the attached browser decodes, so the frame
that leaves the host is the frame the browser is handed. Whenever that cannot hold,
the stream is not taken and the desktop travels as it does on a host with no agent:
the graphics pipeline, decoded here and encoded here as VP9.

- A host whose session runs no agent never opens the channel. Nothing is configured,
  and no key selects the stream.
- A frame that is not the plan's profile is refused by name and the channel closed
  with it. The desktop stays on the pipeline.
- A target with `egfx = false` refuses the channel: the stream stands in for the
  pipeline, and there is none to stand in for.
- There is no path that decodes the agent's stream in the gateway, to encode it
  again or for any other reason.

## The shape

```text
one RDP connection, one Windows session
├── input, Display Control, clipboard, sound: ordinary RDP
├── the graphics pipeline: carries the picture until the agent's stream does,
│   stalled while it does, and carries it again in every gap
└── proprietary display side channel "remotex.video" (an RDP DVC)
    ├── agent → gateway: frames, the pointer's shape, "I cannot see the desktop"
    └── gateway → agent: the plan, an echo per frame, "send a keyframe"
```

The agent runs as the logged-on user in the RDP session. It opens the channel with

```c
WTSVirtualChannelOpenEx(WTS_CURRENT_SESSION, "remotex.video",
    WTS_CHANNEL_OPTION_DYNAMIC | WTS_CHANNEL_OPTION_DYNAMIC_PRI_HIGH |
    WTS_CHANNEL_OPTION_DYNAMIC_NO_COMPRESS);
```

and reads and writes the file handle `WTSVirtualChannelQuery` gives it: the
documented way to open a DVC from a session, whose high priority is the one
[`WTSVirtualChannelOpenEx`] names for display data. TermService carries those bytes
to the client as a Create Request for the name and Data on the number it gave it,
exactly as it carries its own channels.

The channel inherits everything the connection has: no port, no listener and no logon
of its own, and the session it belongs to is the one Windows attached the connection
to. After a disconnect the agent's write fails with `ERROR_PIPE_NOT_CONNECTED`, its
open fails with `ERROR_NOT_CONNECTED` until a client attaches again, and it opens the
channel on the next connection by itself. The single-session and takeover rules this
gateway keeps therefore hold for the channel without anything added: a takeover
rebuilds the engine, the new connection accepts the channel again, and the agent is
told the new plan.

## The channel's messages

Each message is one write on the host and one Data message in the client. The
channel cuts a long one into its own Data First and Data PDUs and the client joins
them (`proto/dvc.rs`), so the messages carry no framing of their own: a message of
4 MiB written with one `WriteFile` arrived whole. The first byte is the kind, and
every field is little-endian, as RDP's are.

| Kind | From | Body | Meaning |
|---|---|---|---|
| `0x81` plan | gateway | `u8` version, `u8` chroma (1 is 4:4:4, 0 is 4:2:0), `u8` quality, `u8` adaptive | What to code. The gateway's first word, on accepting the channel, and the agent codes nothing before it. |
| `0x01` frame | agent | `u32` number, `u16` width, `u16` height, one VP9 frame | The whole desktop. |
| `0x82` echo | gateway | `u32` number | That frame has gone on to the browser. |
| `0x83` keyframe | gateway | — | The next frame is to be one a decoder can start from. |
| `0x02` pointer | agent | `u16` width, `u16` height, `u16` hotspot x, `u16` hotspot y, straight-alpha RGBA | The pointer's shape. |
| `0x03` pointer hidden | agent | — | The host shows no pointer. |
| `0x04` gap | agent | — | The agent cannot see the desktop. |

The plan carries the protocol's version, 1. An agent that speaks another closes the
channel, and the desktop stays on the pipeline. A message the client cannot read —
an unknown kind, a frame that opens with no VP9 header or with another profile's, a
pointer larger than RDP's own 384 pixels a side — closes the channel the same way,
and never ends the session: the agent is an application on the host, and the desktop
has the pipeline to travel on.

Whether a frame is a keyframe, and its profile, are read from the frame's own opening
bits rather than stated beside it, so there is one answer to each.

## Whose picture it is

The pipeline carries the desktop, and the stream carries it instead while it flows.
`proto::video::Stream` keeps that one decision:

- **The stream becomes the picture** at a keyframe the size of the desktop. Until one
  comes, the agent is asked for it, once, and each frame dropped is echoed so the
  agent sends the next.
- **The pipeline takes the picture back** when the agent says it cannot see the
  desktop, when a frame arrives at any size but the desktop's, and when the channel
  closes.

While the stream is the picture the session hands each frame up as `Event::Video`
and withholds the pipeline's frame acknowledgements, which is what stalls the host's
own graphics ([below](#withholding-frame-acknowledgements-stalls-the-hosts-graphics)).
When the pipeline takes the picture back the session resumes them and says
`Event::VideoEnded`. The caller never drives the acknowledgements: a channel that
closes under a stalled pipeline would otherwise leave nobody to resume it.

### What the engine does with it

- **A frame is passed** (`VideoSink::pass`), as wlshare's is: its size is held to the
  ceiling a stream encoded here is, the configuration announced ahead of it is the
  plan's chroma's string for its size, and its bytes take their share of
  `QUEUE_BUDGET`. The browser is told `passthrough: true`.
- **The framebuffer is stale under the stream.** The host draws 11 or 12 more frames
  after the first acknowledgement is withheld, which the client decodes and the
  engine sends nothing of.
- **A gap is VP9 encoded here.** At `Event::VideoEnded` the engine forgets what the
  shadow claims, asks the host to repaint, and at the pipeline's next frame sends the
  whole desktop, which starts the stream encoded here over at a keyframe behind its
  own announcement (`VideoSink::damage`). The stream coming back starts at a
  keyframe the same way. These are the turns a High Performance Mac's passed stream
  and its ZRLE rectangles take
  ([The gaps are VP9 encoded here](architecture.md#apples-media-stream-passed-through)).
- **A browser that must start over** — a reattach — is sent nothing until a keyframe,
  which the engine asks the agent for.

### The plan, the echo and the walk

The plan is the target's `RenderPlan`: the chroma the browser's decoder resolved, the
target's `video_quality` as the ceiling, and whether `render_adaptive` lets the walk
listen. So the target's keys mean on the agent's stream what they mean on one encoded
here. It is fixed for an engine.

The agent keeps one frame in flight and sends the next on the echo of the one before.
It walks its quality with desktop-vp9's own walk (`QualityWalk::fenced`) by how long
each echo takes, less the shortest it has seen, and sharpens a desktop that went
quiet below the plan's quality with one more frame at it. The engine holds each echo
for the queue ahead of its frame on the browser's link (`VideoSink::fence_hold`), for
500 ms at most, so that the round trip the agent reads reaches the browser and not
this gateway alone: the hold wlshare's fences are given
([The fence carries the browser's queue](architecture.md#wlshares-stream-passed-through)).

### A resize

A resize is a frame of another size, and so a turn of the pipeline's. Display Control
resizes the session under the stream; the agent's duplication is lost at the mode
change and it duplicates again at the new size; its first frame there is not the
desktop's size as the pipeline last described it, so the pipeline takes the picture
back. The acknowledgements resume, and with them comes the host's graphics reset for
the new size, which had been waiting for them. The engine resizes as it does on any
RDP session, and the agent is asked for a keyframe of the desktop as it now is.
Measured, the pipeline had the picture 0.7 s after the resize was asked for and the
stream had it back 1.7 s after.

Nothing special-cases the request. A size the host changes to unasked takes the same
path, and so does a layout the host ignores, which changes nothing.

## The pointer

The pointer travels as its own shape and is never drawn into the picture. Desktop
Duplication hands the desktop over without it and the pointer beside it
(`GetFramePointerShape`), and the agent sends the shape as a message of its own,
converted to the straight-alpha RGBA the RDP client's own pointer decoder produces,
inverted pixels as the same checkerboard. The session hands it up as the
`Event::Cursor` a host's own pointer update is.

It has to come from the agent, because a host whose graphics are stalled sends no
pointer updates either. Crossing the desktop on one path, the host sent 20 shapes
with its frames acknowledged and none with them withheld; parked over a window that
shows the animated busy ring, 99 and none. Under the stream the same two brought 13
and 31 shapes from the agent.

While the pipeline carries the picture the host's own updates are the ones that
count. The agent's latest is kept, and goes out ahead of the stream's first frame.

That the picture holds no pointer was checked where one would show: with the pointer
parked on the probe's patch, a flat colour, every pixel of the patch in every frame
was the colour painted.

## Withholding frame acknowledgements stalls the host's graphics

A graphics pipeline host keeps a list of the frames the client has not yet
acknowledged with `RDPGFX_FRAME_ACKNOWLEDGE_PDU` ([MS-RDPEGFX] 3.2.1.2 and
2.2.2.13). How many it lets pile up is not in the specification. This host stops at
11 or 12: a client that stops acknowledging stops the host's graphics, and the
desktop is then coded once, by the agent, not twice.

This is a measured modern-Windows behavior, not the protocol's. It has to be
remeasured on each supported Windows generation rather than inferred from the
specification, and the design does not depend on it for anything but the saving: a
host that went on drawing would be decoded into a framebuffer nothing is sent from,
and only the newest withheld acknowledgement is kept, so the client's state stays
bounded whatever a host does.

- **The display stays on.** Capture stays fresh throughout, and it follows the
  desktop: keystrokes reach the session and the agent's frames show the result.
- **Sound is untouched**: 5 or 6 buffers every second, which is 44.1 kHz 16-bit
  stereo, before the stall, through it and across the resume.
- **The pointer is not**: see [The pointer](#the-pointer).
- **The graphics reset waits.** Display Control still resizes the session, and the
  host's reset for the new size comes only once acknowledgements resume.
- **The resume is specified.** The client sends the newest withheld frame with the
  `0xFFFFFFFF` suspend sentinel, which has the host clear its outstanding frames
  without waiting on them, and the next EndFrame's ordinary acknowledgement opts back
  in ([MS-RDPEGFX] 2.2.2.13). The host's first frame came 23 to 66 ms later, after
  stalls of 10 and of 30 seconds. An ordinary acknowledgement of the newest frame
  resumed it the same way and as fast; the sentinel is kept because it is the half
  that is specified.
- **The host repaints what changed, unasked.** With Start opened under the stall,
  1709 of the 3639 blocks compared differed between the host's picture here and the
  agent's; five seconds after the resume none did.

### What does not stop the host's graphics

**Suppress Output** ([MS-RDPBCGR] 2.2.11.3) is the protocol's way to turn a host's
display updates off: once it is processed, "the server MUST stop or resume sending
graphics updates" ([MS-RDPBCGR] 3.3.5.11.2). It switches the session's display off
and capture with it. Within 1.5 s of the PDU, Desktop Duplication fails with
`DXGI_ERROR_ACCESS_LOST`; duplicating the output again and a GDI `BitBlt` of the
screen are both refused with `E_ACCESSDENIED`, and `GetPixel` returns a stale value,
for as long as updates stay off. The input desktop stays `Default`: the session is
not locked, its display is switched off. None of that is specified. The DXGI
reference gives `DXGI_ERROR_ACCESS_LOST` for a desktop switch, a mode change or a
change of DWM or full-screen state ([`AcquireNextFrame`]), and `E_ACCESSDENIED` for
an application without access to the current desktop image
([`DuplicateOutput`]); neither names Suppress Output.

**A reported queue depth** is the one flow control the specification describes: a
server SHOULD throttle by the `queueDepth` a client reports, the bytes of graphics it
holds unprocessed ([MS-RDPEGFX] 3.2.5.13). This host does not. It sent 33 frames a
second with 0 reported, with 64 MB and with `0xFFFFFFFE`.

**The specified opt-out**, an acknowledgement carrying the suspend sentinel, is the
opposite of a stall: the host then waits on no acknowledgement at all.

## The secure desktop

A capture in the user's session is refused the secure desktop: a UAC prompt, the lock
screen, the screen Ctrl+Alt+Del brings up. Desktop Duplication fails with
`DXGI_ERROR_ACCESS_LOST` and duplicating again is refused with `E_ACCESSDENIED` until
the user's desktop is back. The agent then says it cannot see the desktop, once, and
tries again every quarter of a second; the pipeline takes the picture and shows the
secure desktop, which the host draws like any other; and the stream comes back at a
keyframe when the agent can duplicate again.

Measured with Ctrl+Alt+Del: the agent gave the picture up 271 ms after the keys, the
host's first frame came 8 ms after that, the agent sent nothing while the screen was
up, and the stream was the picture again 369 ms after Escape.

The same message covers a duplication that is refused for a moment across a mode
change, which costs a turn of the pipeline's that the resize takes anyway.

## What is left open

- **An agent on the host.** A service that starts the capture in each session,
  including across logon, and a supported way to ship and update it. The probe starts
  the proof of concept by scheduled task in a session that already exists.
- **A reattach under the stream.** The engine asks the agent for a keyframe and sends
  nothing until it comes. No probe drives it: `tests/ws_probe.py`'s second `connect`
  starts a fresh engine, as the session rules have it.
- **A UAC prompt and the lock screen themselves.** The host measured has UAC switched
  off, so the secure desktop was reached with Ctrl+Alt+Del.
- **Other hosts.** One with a GPU, where DXGI and a hardware encoder differ; Windows
  Server with the Remote Desktop Session Host role; any Windows generation but the
  one measured.
- **How fast the agent codes.** It codes VP9 in software, with two threads, on a host
  that is the user's own desktop. Nothing here judges its frame rate or tunes it.

## Running it

Measured against one host: Windows 11 Enterprise, build 26200, in a VM with no GPU
(DXGI's adapter is the Microsoft Basic Render Driver), with a browser playing an
animation and a tone.

The probe is `tests/rdp_dvc_video_probe.rs`. The agent is built on `windows-ci-build`
and started on the target by scheduled task, in the session the probe logs on to;
what a run produces — the agent binary and log, host and agent frames as PNG — lands
in `tmp/dvc-video-poc`. Leave an animation and a sound playing on the host, from a
browser: a browser page survives the probe's disconnects, where ffplay's picture
freezes at the first one.

Build the probe with the `qa` profile. A debug build does not keep up with the host,
and what it counts of the host's frames is skewed by that.

```sh
pwsh -File tests/dvc-video-poc/build.ps1
REMOTEX_UAT_TARGET=windows-ent-sandbox RUST_LOG=remotex::rdp_client=info \
  cargo test --profile qa --test rdp_dvc_video_probe <test> -- --ignored --nocapture
```

| Test | What it shows |
|---|---|
| `the_stream_carries_the_desktop_and_gives_it_back` | A message of megabytes in one write, the stall and the sound under it, the pointer from the agent and out of the picture, a resize, the agent leaving |
| `the_secure_desktop_is_the_pipelines_to_show` | Ctrl+Alt+Del: the gap, and the stream back after it |
| `the_stream_comes_back_on_a_new_connection` | A reconnect with the agent left running |
| `animation_page_survives_reconnects` | Whether the host's animation and sound outlive a disconnect, with no agent |

Two switches of the agent's are the probe's. `--patch` has it paint a small window
the colour its next frame's number names and wait for the composed screen to show it
before it captures, so that a frame counts as *fresh* only when the decoded patch
shows that colour: a captured frame proves nothing if it is the same surface handed
back again. `--big <bytes>` sends one message of that size ahead of the stream.

Through the gateway, `tests/ws_probe.py` shows what a browser is sent: `videoFormat`
with `passthrough: true` while the stream is the picture and `false` in each gap.
`--viewport-gap` leaves the desktop at each size long enough for the stream to come
back before the next resize.

[MS-RDPBCGR]: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpbcgr/5073f4ed-1e93-45e1-b039-6e30c385867c
[MS-RDPEGFX]: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpegfx/da5c75f9-cd99-450c-98c4-014a496942b0
[`WTSVirtualChannelOpenEx`]: https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsvirtualchannelopenex
[`AcquireNextFrame`]: https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutputduplication-acquirenextframe
[`DuplicateOutput`]: https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutput1-duplicateoutput
