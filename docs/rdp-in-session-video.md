# A Windows host's video over its own RDP connection

A Windows host can hand this gateway a stream it codes itself, as wlshare does over
VNC ([wlshare's stream, passed through](architecture.md#wlshares-stream-passed-through)):
the host encodes its desktop as VP9 and the gateway passes each frame to the browser
as it came, so the encode this gateway does for an RDP target moves to the host and
nothing in between decodes or encodes a picture.

**Experimental.** It has been measured against one host. It is for a setup where the
host is the better place to encode, such as a gateway on a slow machine. The host's
graphics pipeline goes on beside the stream
([below](#the-hosts-graphics-go-on-beside-the-stream)), so the host codes its desktop
twice and the link from it carries both. The host pays for the encode, and one with no
CPU to spare is better left on the pipeline ([The host's CPU](#the-hosts-cpu)).

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
the RDP engine, and it runs only for a target that opts in:

```toml
[[targets]]
name = "win"
protocol = "rdp"
host = "10.0.0.5"
agent_passthrough = true
```

The key is the target's say, as `media_passthrough` is for a High Performance Mac
([Apple's media stream, passed through](architecture.md#apples-media-stream-passed-through)):
it resolves in `TargetConfig::render_plan` to `RenderPlan::agent_stream`, beside
`apple_media`, and the RDP engine offers the channel only where it is set. Without it
the session refuses `remotex.video` by name, and an agent in the session has nothing
to write to. It is refused off `rdp` and beside `egfx = false`, because the pipeline
is what carries the desktop wherever the stream cannot. Unlike the Mac's stream it
waits on no answer of the browser's: the agent codes the profile the plan names,
which is the browser's own wherever it chose one.

The host's side is [remotex-agent](agent.md) (`crates/remotex-agent`), installed by its
MSI as the `RemotexAgent` service, which starts an agent as the user of each session
attached over RDP: how it is installed, run and logged is there, and what it says on the
channel is here.

## Passed, or not taken

The stream exists to be passed through and for nothing else. The agent codes to the
plan the gateway states, which is what the attached browser decodes, so the frame
that leaves the host is the frame the browser is handed. Whenever that cannot hold,
the stream is not taken and the desktop travels as it does on a host with no agent:
the graphics pipeline, decoded here and encoded here as VP9.

- A target without `agent_passthrough` refuses the channel.
- On one with it, a host whose session runs no agent never opens the channel.
- A frame that is not the plan's profile is refused by name and the channel closed
  with it. The desktop stays on the pipeline.
- Frames passed on and not yet echoed are held to 64 MiB together, one message's
  worth. An agent keeps one in flight and never comes near it; one past it has its
  channel closed.
- A second agent's channel, while one holds it, is refused.
- There is no path that decodes the agent's stream in the gateway, to encode it
  again or for any other reason.

## The shape

```text
one RDP connection, one Windows session
├── input, Display Control, clipboard, sound: ordinary RDP
├── the graphics pipeline: carries the picture until the agent's stream does,
│   goes on unseen while it does, and carries it again in every gap
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

While the stream is the picture the session hands each frame up as `Event::Video`,
and the pipeline goes on beside it, its frames acknowledged and decoded into the
framebuffer as on any session
([below](#the-hosts-graphics-go-on-beside-the-stream)). When the pipeline takes the
picture back the session says `Event::VideoEnded`.

### What the engine does with it

- **A frame is passed** (`VideoSink::pass`), as wlshare's is: its size is held to the
  ceiling a stream encoded here is, the configuration announced ahead of it is the
  plan's chroma's string for its size, and its bytes take their share of
  `QUEUE_BUDGET`. The browser is told `passthrough: true`.
- **The framebuffer is current under the stream**, and the engine sends nothing of it.
- **A gap is VP9 encoded here.** At `Event::VideoEnded` the engine forgets what the
  shadow claims and sends the whole desktop from the framebuffer, which starts the
  stream encoded here over at a keyframe behind its own announcement
  (`VideoSink::damage`). The stream coming back starts at a
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
It codes that next frame while the one before is in flight, starting so that it is
done as the echo is expected, by how long the last echo took and the last frame took
to code: a frame then costs the longer of the two and not their sum, and on a slow
link it is no older when it goes out than one coded on the echo. Each echo is timed
to when it was read off the channel, which the coding may keep the agent's loop from.
It walks its quality with desktop-vp9's own walk (`QualityWalk::fenced`) by how long
each echo takes, less the shortest it has seen, and sharpens a desktop that went
quiet below the plan's quality with one more frame at it. The engine holds each echo
for the queue ahead of its frame on the browser's link (`VideoSink::fence_hold`), for
500 ms at most, so that the round trip the agent reads reaches the browser and not
this gateway alone: the hold wlshare's fences are given
([The fence carries the browser's queue](architecture.md#wlshares-stream-passed-through)).

### A resize

A resize is a frame of another size, and so a turn of the pipeline's. Display Control
resizes the session under the stream, and the host resets its graphics for the new
size as on any session; the agent's duplication is lost at the mode change and it
duplicates again at the new size; its first frame there is not the desktop's size as
the pipeline last described it, so the pipeline takes the picture back. The engine
resizes as it does on any RDP session, and the agent is asked for a keyframe of the
desktop as it now is.

Nothing special-cases the request. A size the host changes to unasked takes the same
path, and so does a layout the host ignores, which changes nothing.

## The pointer

The pointer travels as its own shape and is never drawn into the picture. Desktop
Duplication hands the desktop over without it and the pointer beside it
(`GetFramePointerShape`), and the agent sends the shape as a message of its own,
converted to the straight-alpha RGBA the RDP client's own pointer decoder produces,
inverted pixels as the same checkerboard. The session hands it up as the
`Event::Cursor` a host's own pointer update is.

While the stream is the picture the pointer is the agent's, in step with the frames it
comes with, and the host's own updates are held; the host's latest goes out when the
pipeline takes the picture back. While the pipeline carries the picture the host's own
updates are the ones that count. The agent's latest is kept, and goes out ahead of the
stream's first frame.

That the picture holds no pointer was checked where one would show: with the pointer
parked on the probe's patch, a flat colour, every pixel of the patch in every frame
was the colour painted.

## The host's graphics go on beside the stream

The session acknowledges every frame of the graphics pipeline
(`RDPGFX_FRAME_ACKNOWLEDGE_PDU`, [MS-RDPEGFX] 2.2.2.13) whether or not the stream is
the picture, and decodes it into the framebuffer, which nothing is sent from while the
stream is. The host therefore codes its desktop twice, once in its pipeline and once
in the agent, and the link from it carries both; in return the framebuffer is the
desktop whenever the pipeline takes the picture back, and the host's own pointer
updates go on.

Nothing stops the host's graphics under the stream:

- **Withholding acknowledgements** stalls them. A pipeline host keeps a list of the
  frames the client has not acknowledged, and how many it lets pile up is not in the
  specification; a Windows host stopped drawing at 11 or 12, and sent no pointer
  updates while it stood. It is not done: a host with a GPU froze its display minutes
  into a stream under it, and the stall is the suspect.
- **Suppress Output** ([MS-RDPBCGR] 2.2.11.3), the protocol's way to turn a host's
  display updates off, switches the session's display off and capture with it. Within
  1.5 s of the PDU, Desktop Duplication fails with `DXGI_ERROR_ACCESS_LOST`;
  duplicating the output again and a GDI `BitBlt` of the screen are both refused with
  `E_ACCESSDENIED`, and `GetPixel` returns a stale value, for as long as updates stay
  off.
- **A reported queue depth**, the one flow control the specification describes
  ([MS-RDPEGFX] 3.2.5.13), is not honoured: the host sent 33 frames a second with 0
  reported, with 64 MB and with `0xFFFFFFFE`.

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

## The host's CPU

The encode moves to the host, and on the host it competes with every application
the session runs. At normal priority the agent has only the CPU they leave. On the
host measured, a browser playing a video took every core, drawing it in software for
want of a GPU from a GPU process Chrome runs above normal priority, and the stream
fell to a few frames a second. The pipeline carried the same desktop smoothly, since
the host's own encoder is cheap and the VP9 encode ran on this gateway. Under the
stream the host pays for both, since its pipeline goes on beside it. Running the
agent above normal changed nothing, since that only matched Chrome.

So the agent runs in DWM's priority class, `HIGH_PRIORITY_CLASS`, as the session's
display work it is. It also opts out of the power throttling Windows gives a process
with no window as background work, which on a CPU with efficiency cores puts it on
them. One frame in flight and one coded behind it bound what it takes, on half the
host's cores, two at least and four at most. A host with no CPU to spare still pays for it: its applications get
less, and the video the browser there draws shows fewer frames, each of which the
stream carries.

## What is left open

- **A UAC prompt and the lock screen themselves.** The host measured has UAC switched
  off, so the secure desktop was reached with Ctrl+Alt+Del.
- **Other hosts.** One with a GPU, where DXGI and a hardware encoder differ; Windows
  Server with the Remote Desktop Session Host role; any Windows generation but the
  one measured.
- **How fast the agent codes.** It codes VP9 in software on a host that is the user's
  own desktop, and a desktop whose frame takes longer to code than the interval
  between two is sent at fewer frames than the pipeline carries. Its priority and its
  threads are set for the CPU it competes for ([above](#the-hosts-cpu)).

## Running it

Measured against one host: Windows 11 Enterprise, build 26200, in a VM with no GPU
(DXGI's adapter is the Microsoft Basic Render Driver), with a browser playing an
animation and a tone.

The probe is `tests/rdp_dvc_video_probe.rs`. The agent is built on `windows-ci-build`
by `tests/rdp-agent/build.ps1`. Most tests start a session's agent on the target
themselves, by scheduled task, in the session the probe logs on to, and refuse to while
the `RemotexAgent` service runs there; `the_service_gives_each_connection_an_agent`,
`a_reattach_starts_the_stream_over_at_a_keyframe` and
`removing_the_service_under_the_stream_gives_the_picture_back` want the service,
installed from the MSI by `tests/rdp-agent/install-service.ps1` and removed by
`uninstall-service.ps1`, which the last runs itself. What a run produces — the agent binary and logs,
host and agent frames as PNG — lands in `tmp/rdp-agent`. Leave an animation and a sound playing on the host, from a
browser: a browser page survives the probe's disconnects, where ffplay's picture
freezes at the first one.

Build the probe with the `qa` profile. A debug build does not keep up with the host,
and what it counts of the host's frames is skewed by that.

```sh
pwsh -File tests/rdp-agent/build.ps1
REMOTEX_UAT_TARGET=windows-ent-sandbox RUST_LOG=remotex::rdp_client=info \
  cargo test --profile qa --test rdp_dvc_video_probe <test> -- --ignored --nocapture
```

| Test | What it shows |
|---|---|
| `the_stream_carries_the_desktop_and_gives_it_back` | A message of megabytes in one write, the sound under it, the pointer from the agent and out of the picture, a resize, the agent leaving |
| `the_secure_desktop_is_the_pipelines_to_show` | Ctrl+Alt+Del: the gap, and the stream back after it |
| `the_stream_comes_back_on_a_new_connection` | A reconnect with the agent left running |
| `the_service_gives_each_connection_an_agent` | The installed service: an agent of its own for each connection, none streaming to a connection that refuses the channel |
| `a_reattach_starts_the_stream_over_at_a_keyframe` | Through a gateway in the test, a browser's socket dropped and reclaimed: the engine resumed, and the new socket sent nothing of the stream before a fresh announcement and the keyframe asked of the agent |
| `removing_the_service_under_the_stream_gives_the_picture_back` | Removing the MSI while its agent streams: the service stops the agent, and the pipeline takes the picture back on a connection that goes on |
| `animation_page_survives_reconnects` | Whether the host's animation and sound outlive a disconnect, with no agent |

Two switches of `remotex-agent session`, hidden from its help, are the probe's. `--patch` has it paint a small window
the colour its next frame's number names and wait for the composed screen to show it
before it captures, so that a frame counts as *fresh* only when the decoded patch
shows that colour: a captured frame proves nothing if it is the same surface handed
back again. `--big <bytes>` sends one message of that size ahead of the stream.

Through the gateway, against a target with `agent_passthrough = true`,
`tests/ws_probe.py` shows what a browser is sent: `videoFormat`
with `passthrough: true` while the stream is the picture and `false` in each gap.
`--viewport-gap` leaves the desktop at each size long enough for the stream to come
back before the next resize.

[MS-RDPBCGR]: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpbcgr/5073f4ed-1e93-45e1-b039-6e30c385867c
[MS-RDPEGFX]: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpegfx/da5c75f9-cd99-450c-98c4-014a496942b0
[`WTSVirtualChannelOpenEx`]: https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsvirtualchannelopenex
[`AcquireNextFrame`]: https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutputduplication-acquirenextframe
[`DuplicateOutput`]: https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutput1-duplicateoutput
