# Servers, modes and media

What alumia opens and how: the two protocols, the tiers its servers are ranked
in, a Mac's modes, two displays in two tabs, pixel density, sound, and the
camera and the microphone. This
is the reference the [README](../README.md) points to; the wire and the design
behind it are in [architecture.md](architecture.md).

## What the gateway is

A single-user remote desktop gateway for RDP and VNC targets, including Macs
using the built-in Screen Sharing service. The Rust backend owns each protocol
session and streams desktop updates over a WebSocket protocol to the browser
SPA. Remote audio uses a dedicated WebSocket so sound never queues behind the
picture; redirected camera and microphone media each use their own socket too.

The main reason this exists is the client: it is a browser, so anything with one
reaches every target — RDP, VNC and Macs alike — with nothing to install per
platform and nothing that has to exist for your OS. The list of computers has a
line for each, named as its entry is, or as the computer names itself where it is
the Mac the gateway runs on, with a monitor whose keys choose the size the desktop will have
and whether the remote's sound is taken, and Open connects with them; whether
the remote's own stream is passed through is asked for by the page's address.
The size is shown before Open. It is either one
the desktop keeps — the target's `size = "1920x1080"`, or 1440×900 where it sets
none — or the window's: in a session started with resize the window drives the
remote's size, so the desktop is renegotiated at the size asked for rather than
scaled on the client. A wlshare server, a Mac's virtual display and `rdp` can be
handed the window, by a desktop browser or a tablet; a phone is offered the kept
sizes instead. On RDP a resize is a graphics reset of the default graphics
pipeline, so a target with `egfx = false` keeps its size, and so does a plain
`vnc` target, which is asked for its size once.
Not every server is served alike: see [Supported servers](#supported-servers)
for the tiers they are ranked in.

## The two protocols

- RDP uses a built-in client, protocol and all: the desktop over the graphics
  pipeline (MS-RDPEGFX) or plain bitmap updates, pointer, keyboard, mouse and
  resize, spoken over NLA to modern Windows' own Remote Desktop server, tested
  on Windows 10 and 11. It carries the clipboard, sound (MS-RDPEA), and the
  browser's camera and microphone, and does not carry touch. See
  [`docs/rdp-client.md`](rdp-client.md).
- VNC uses a built-in RFB client and connects directly to macOS Screen Sharing,
  over Apple's own RFB 003.889 with Apple Remote Desktop authentication, as
  Apple's viewer does. `subtype = "ard"` selects Screen Sharing's Standard mode,
  on the Mac's own displays.
  `subtype = "ard-high-performance"` is its High Performance mode as Apple's
  viewer has it: one virtual display holding every remote window, or two with
  `virtual_displays = 2`,
  with the picture as HEVC and the sound as AAC-ELD over the Mac's SRTP media
  stream: the picture decoded by the host's FFmpeg, the sound by the browser. Resize
  needs a virtual display: High Performance's, or the unofficial
  `virtual_display = true` under `ard`, which puts Standard mode's picture on one
  and was tested on macOS 26 only. The unofficial `subtype = "ard-mirror"` takes
  that same media stream for the Mac's own displays, left lit, and fits the
  picture to the viewer's window. Both modes are reverse engineered, having no
  specification.
  A wlroots-based Wayland desktop behind
  [wlshare](https://github.com/andrewtheguy/wlshare) is a `vnc` target with
  `subtype = "wlshare"`: the gateway then lists wlshare's private RFB
  extensions, so its own VP9 stream is passed through, the output's scale is
  reported and shown as such, and in a session started with resize the output
  follows the browser's density. Without the subtype the same server is read as any VNC
  server is.

## One client: the page

There is one client: the page a browser loads. For desktop use, install that page
as an app in Chrome or Edge. The app window gives the client the browser-reserved
key chords that a normal windowed tab keeps for itself, without a separate native
wrapper or a second client lifecycle.

An installed desktop browser app has **More → Fit the window**. It
uses [`window.resizeTo()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/resizeTo)
to make the app's content area exactly the remote desktop's logical size; it
resizes the local window and never scales or resizes the remote desktop. This is
supported in installed Chrome and Edge desktop app windows and is best-effort in
other browsers. Ordinary tabs cannot resize their containing browser window, and
mobile browsers ignore the request.

On macOS, the window's own rounded corners are masked over the page, so a window
sized to the desktop loses the framebuffer's corner pixels — a desktop shown at
100% has nothing to spare there. The corner radius is a system-wide setting
rather than a per-app one; one point is square enough to see every pixel:

```sh
defaults write -g NSConvolutionOverride1 -float 1
```

Windows pick the value up when their app next launches, so quit and reopen the
browser app. `defaults delete -g NSConvolutionOverride1` restores Apple's radius
— 26 points on macOS 26, 10 before it.

## Compatibility between releases

There is no backward compatibility between releases, and no legacy path is kept
for one. A release may change or remove a configuration key, a browser API, the
WebSocket protocol or a feature, with nothing that reads the old form: check
[`alumia.example.toml`](../alumia.example.toml) against your config when you
upgrade. The page and the gateway are one release too, so a tab left open across
an upgrade says both versions and asks to be reloaded.

See [`docs/architecture.md`](architecture.md) for the system design and
[`docs/known-issues.md`](known-issues.md) for faults worth recognising rather
than re-investigating.

## Supported servers

What sets servers apart here is how the picture reaches the browser: passed
through as the server made it, or decoded and encoded again as VP9 in the
gateway, which adapts to the link.

### Native servers, prioritized

alumia is built around the remote desktop servers native to each platform:
Windows' own Remote Desktop, macOS's built-in Screen Sharing, and on Linux
wlshare, our own. They are ranked in tiers. Design, testing and optimization
start from the first tier, and a higher tier comes first when work for two
competes.

All three have these in common:

- **The desktop outlives the viewer.** A Windows host holds a disconnected
  session for the next logon, and a Mac's or a wlshare desktop keeps running
  with nobody watching. A browser coming back from a reload or a dropped
  connection resumes where it was. A different browser, a phone picking up what
  a desktop started, say, starts at the picker and chooses its own size and
  sound; starting the target returns it to the same desktop, with its
  windows as they were left.
- **HiDPI and Retina.** Each renders at the pixel density of the browser's
  screen, or says which density its pixels are, so the desktop is sharp on a
  Retina display and is shown at its true size.
- **The pointer travels apart from the picture.** It arrives as its own shape
  and the browser wears it on its own pointer, so it moves with the hand rather
  than a network round trip behind it.

#### Tier 1: wlshare on Linux

[wlshare](https://github.com/andrewtheguy/wlshare), this project's own VNC
server for wlroots-based Wayland desktops, is the ideal. It codes the desktop as
VP9 itself, at the quality and chroma the target asks for, and walks that quality
by the browser's link, so the gateway passes its stream through untouched and
the session still adapts to a slow link. Because wlshare is ours, what RFB
lacks is added to it as an extension: pixel density, switching outputs,
sound, and the browser's camera and microphone. It is a `vnc` target with
`subtype = "wlshare"`, which is what makes the gateway list those extensions and
ask for the stream.

#### Tier 2: modern Windows' Remote Desktop, and a Mac's High Performance Screen Sharing

The host's own stream, passed through to the browser for a LAN:

- **Modern Windows' own Remote Desktop server**, in a session started with the
  passthrough: the host's graphics pipeline (MS-RDPEGFX), composed in the browser
  by the gateway's own compositor built to WebAssembly, which takes nearly all of
  the picture's work off the gateway. It was run against one Windows 11 host,
  with sound and the clipboard beside it, and not yet with the camera or the
  microphone. A target with `egfx_h264 = true`, which is **experimental**, lets
  the host draw video with H.264 on that pipeline, which the browser decodes;
  without the key what is passed is lossless.
- **macOS Screen Sharing's High Performance mode** (`ard-high-performance`), in a
  session started with the passthrough: the Mac's HEVC picture, to a browser
  that decodes it (Chrome and Safari; not Firefox). Its AAC-ELD sound is passed
  in every session.

The passthrough is no choice at the picker: the page's address asks for it
(`?passthrough=1`), and a browser that cannot take the stream is not sent it. A passed stream does not adapt to a slow link: the Mac's own
rate control keeps it between 20 and 60 Mbit/s, and a Windows host's pipeline is
sent as drawn. A session started without it is the gateway's VP9, which does
adapt and is the answer for a slow link. VP9 also serves a browser that cannot
decode the Mac's stream, and a Windows host that draws with plain bitmap updates
rather than the pipeline. On RDP the passthrough is the only way past VP9:
without it the gateway composes the host's pipeline, or takes its bitmap updates,
and encodes the picture as VP9.

#### Tier 3: a Mac's Standard Screen Sharing

Screen Sharing's Standard mode (`ard`, including the unofficial
`virtual_display = true`) is decoded in the gateway and encoded as VP9, adapting
to the link. Nothing of it is passed through.

### Other servers, not prioritized

Every other VNC server is a plain `vnc` target, reached through the RFB baseline
and always encoded as VP9 in the gateway, at 1x and without sound. The gateway
reads two lossless encodings: ZRLE, which it asks for, and Raw, which a server
may send whatever a client lists. CopyRect, zlib, Hextile and RRE, which only a
server without ZRLE needs, and Tight and the other vendor or lossy ones are not
listed. A
wlshare server behind a plain target is read the same way: its fallback for
ordinary VNC clients. Plain VNC stays supported, and is worked on as needed
rather than ahead of the tiers.

Another RDP server, an older Windows or xrdp say, may happen to work if it
speaks what the client implements ([The RDP client](rdp-client.md)), but
it is not a target: it is not tested against. Its picture follows
Windows' rule, encoded as VP9 in the gateway unless the session was started with
the pipeline passed.

## Macs

Macs can be configured as ordinary VNC targets using macOS Screen Sharing, with
no additional software. Use `protocol = "vnc"` with `subtype = "ard"` and the Mac
account's username and password; that selects Apple Remote Desktop authentication
so the connection lands at the user's own screen rather than a login-window
session.

The Mac must grant that account Observe and Control in Remote Management's
per-user access list. The default "All users" setting rejects the connection
with the same authentication error as incorrect credentials. See
[Remote Management access](apple-vnc-889.md#remote-management-access).

Apple Screen Sharing Standard mode (`ard`) lists the Mac's physical screens, can
show one screen or all of them, reports each screen's pixel density, keeps pixels
at full fidelity, and supports the native Apple pasteboard. Every Apple subtype
asks the Mac for ZRLE rectangles from the start, although High Performance steps
over them undecoded and never displays them.

High Performance (`ard-high-performance`) takes the same credentials and the same
encrypted protocol revision. It requests one virtual display, or two where the
target sets `virtual_displays = 2`, at the size the
session keeps, or at the full resolution of the client's screen where the window
drives it, and at the density of the client's screen either way. Once connected, it disables the remote
Mac's physical displays and puts all of the remote Mac's windows on what it
requested. Apple's official macOS Screen Sharing client chooses one virtual display
or two the same way. It takes the picture and sound Apple's own viewer takes:
after the first layout the gateway offers the Mac's media stream, and the Mac
then sends the screen as HEVC 4:4:4 and its sound as AAC-ELD, over UDP with
SRTP, to the gateway's ports 5900 and 5901, at 20 to 60 Mbit/s as the delay the
gateway reports to it every 50 ms allows, as Apple's viewer reports. A Linux
gateway needs `net.core.rmem_max` of at least 4194304 for the screen's socket,
which the log warns about when it is lower: the stock 212992 loses keyframes at
Retina sizes. The gateway authenticates and decrypts every packet. The sound it sends on
as the Mac sent it, AAC-ELD the browser decodes, and to no browser that has muted it. The picture it
decodes and sends on as the VP9 every target uses — or, in a session started with the passthrough, which the page's
address asks for (`?passthrough=1`) in a browser that decodes it (Chrome and Safari; not Firefox), sends the HEVC
on as the Mac sent it, for a LAN;
the browser waits on the screen that lights ("Waiting for the remote screen…") and holds the keyboard and the pointer back until the stream sends its first picture,
at connect and across display changes, and a stream that fails ends the session, as
it does in Apple's viewer. A playing
video does not delay the Mac's reading of the input, as RFB pixels' deflate does. The Mac refuses the picture without the sound, and
mutes its own speakers while it streams, so a session always carries sound, with
nothing to choose at the picker, and nothing reaches an AirPlay speaker the Mac
plays to. It is **experimental**.

Decoding the picture needs a library on the gateway's host that no release
artifact contains: FFmpeg's libavcodec. Install it as
[High Performance decoder](high-performance-decoder.md) says for Linux,
macOS and Windows. A gateway without it can only pass the picture: the line's
monitor says so, and a browser that cannot decode the
HEVC cannot start the target. See
[The media stream](apple-vnc-889.md#the-media-stream-high-performances-picture-and-sound).

Every Apple subtype carries the native Apple pasteboard. In a session started with resize, the window continuously drives High
Performance's virtual display, using Apple's
dynamic-resolution feature to replace its mode from client viewport reports.
The size is chosen before the session starts and holds for it: there is no
auto-resize toggle or one-shot remote-resize button in the session. The local
app-window sizing control described above does not change that. The descriptor's
fixed 3840×2160 backing ceiling permits successive arbitrary sizes within that
bound, and every fresh connection turns the Mac's Dynamic resolution setting back
on. Standard `ard` on the Mac's physical displays offers no resize. One virtual
display or two is the target's `virtual_displays`, read when the session opens
([Two displays](#two-displays-each-in-a-tab-of-its-own)); it does not change
during a session.

**Unofficial:** `virtual_display = true` on an `ard` target opens Standard mode on
one virtual display instead of the Mac's physical ones — the display and the
resizing above are High Performance's, and the picture stays ZRLE, with no media
stream offered, no decoders needed and no sound. Apple's viewer never offers this
combination, so nothing but alumia exercises the Mac's side of it; it was tested
against macOS 26 only, and a macOS update is free to break it while leaving the
two official modes alone.

**Unofficial:** `subtype = "ard-mirror"` is the Mac's physical displays, as `ard`
shares them, with the picture and the sound over High Performance's media stream.
The session asks for no virtual display, so the Mac's own screens stay lit and
show what the viewer sees. The Mac sends each screen at its own pixels, whatever
is asked of it, so the gateway reduces each decoded picture to the viewer's
window before encoding it, again at every window change, and sends the pointer
back in the Mac's pixels: a 5120×2880 screen reaches a 4K window as 4K. A phone
has no window to report and fits the picture to its width, so it is sent the
picture no wider than it shows it: the same screen reaches a phone of 1170×2532
pixels as 1170×658 when it opens held upright, as 2532×1424 once it is turned,
and sharper as a pinch zooms in, up to the Mac's own pixels. The gateway's own
encoder moves a ceiling over that by how long each frame takes it, so a Mac
that is busy sends a phone a smaller picture rather than a late one. The same
holds for a phone in Virtual mode. A desk is sent the window's size, as before.
The picture is always fitted to the viewer, and the list offers no other size for
it. On a Mac with more than one display the stream is the main display's, so
that is the screen a Mirrored session shows; the others are not reached. With the
passthrough the picture goes on as the Mac sent it. The Mac mutes its own sound
output for the length of the session, as under High Performance, so whoever sits
at the Mac hears nothing. Apple's viewer never makes this combination; it was
measured against macOS 27 only, on Macs with one display and on one with two.
See [`docs/apple-vnc-889.md`](apple-vnc-889.md).

## Two displays, each in a tab of its own

**Alpha.** Three kinds of computer can be opened on two displays, the first on
the session's page and the second in another tab of the same browser. In the
Mac app the key below is the "Two displays" switch of a computer's sheet, on a
Windows host and on a Mac, one kept in the Compatible mode alone excepted:

- **A Windows host**, with `virtual_displays = 2` on its `rdp` target: the host
  is asked for two displays, each the session's size. Where the second sits
  against the first is chosen on the computer's line in the list, by the first
  place of its monitor: right, left, above or below, to match where your own
  second display is. A host that lays out one display where two were asked for
  is said so beside the picture, on the session's page: there is no list of
  screens then, and the second display is not available on that computer.
- **A Mac in the Virtual mode**, with `virtual_displays = 2` on its
  `ard-high-performance` target: Apple's viewer's "2 Virtual Displays". The Mac
  places the second to the right of the first, so its line has no key for
  another side; to have it elsewhere, arrange the displays on the Mac while the
  session is open, in System Settings → Displays → Arrange, and the session
  follows. The Mac sends a stream for each display, the second to the gateway's
  UDP port 5902.
- **A Linux desktop with wlshare 0.0.54 or later and exactly two outputs.** No
  key asks for it: the outputs are the compositor's.

The session starts on *All screens*, in the bar's **Screens** sheet, which
keeps the first display on this page and has the way to the second, **Open
Display 2 in another tab**: it opens at `/display/2`, just that display, with
its own pointer and keyboard, and pressed again it brings that tab to the
front. The sheet's *Display 1* and *Display 2* show one display alone on the
session's page, which closes the other's tab; the gateway encodes only what is
shown. On a session that follows the window, each tab's window sizes its own
display.

The second display's tab has a bar of its own, behind a handle that wears the
display's number: **Full screen**, that display's size and density, and
**Disconnect**, which stops showing the display there and ends nothing. Sound,
the clipboard and End stay on the session's page, and so does the keyboard on
screen where the device has a keyboard of its own.

The tab is the session's. When the session's page goes — closed, reloading, or
its connection dropped — the tab says so over its display, lets go of what it
held and sends the remote nothing, and comes back by itself when the page does.

A display is shown in one tab at a time, and only in the browser that holds the
session, by its sign-in. A tab that opens it while another shows it says so and
asks before it takes it over; the tab it was taken from says so and offers
**Take it back**. Opened while the session does not show it in a tab, it says
that, and offers to try again.

A window dragged over the edge between the two tabs arrives on the other
display, as the pointer does. With each tab full screen on a display of its own
the edges meet, so it arrives where it was dragged to; with anything between
the two pictures it arrives short by that much. The tab is for a client with
two physical displays, one for each. On a phone or a tablet it opens too: its
bar has the keyboard on screen there, since such a device has none of its own,
and the display keeps the size and the density of the first, which its window
does not change.

With a Windows host's drawing passed through (`?passthrough=1`), the browser
holding the session composes both displays once and shows one; the second
display's tab is painted from that same picture, so nothing is decoded twice.
That was checked against one Windows 11 host by a headless browser's sockets,
not yet by eye.

## Pixel density over VNC

A plain `vnc` target has no way to learn that its pixels are HiDPI — standard RFB
carries sizes in pixels and nothing else, and a plain target lists no extension
to it — so it is shown at 1x, one CSS pixel per framebuffer pixel, and the
size it is asked for goes to the server as pixels, whatever server it reaches.
See [`docs/standard-rfb-hidpi.md`](standard-rfb-hidpi.md) for what that means
on a sway output at scale 2 and why a second client's size request can come back
prohibited. Density over VNC is a wlshare extension, listed for a target with
`subtype = "wlshare"` and no other: wlshare reports its output's scale, the
gateway labels the framebuffer with it, and the browser's density is declared
back to the server together with the window in points × that density, so the
output changes mode and scale at once. See
[`docs/wlshare-density.md`](wlshare-density.md).

## Sound

Sound is chosen at the picker on an `rdp` target and on a `wlshare` one, by the
sound's key on the computer's line. On
wlshare it comes through wlshare's audio extension: the gateway lists its
pseudo-encoding, wlshare announces so and then streams the desktop's sound on the
RFB connection itself, coded there as Opus at the target's rate and passed to
the browser as it came. While a client listens the host is
silent: the desktop plays into a PipeWire sink of wlshare's own, whose monitor is
what is captured. A session started without sound asks for none, and the host
keeps playing where it did. In the session the bar's Mute changes only
whether this browser listens. A plain `vnc` target carries no sound and offers
none. See [`docs/wlshare-audio.md`](wlshare-audio.md).

A session that carries sound comes up playing, on a phone and a tablet as on a
desk. In Safari, and in any browser of an iPhone or an iPad, a page that is
reloaded comes back muted, and the bar's Mute is the press that starts the
sound again; the button and the closed bar's handle show a crossed speaker
while the session is muted here. The Opus a
session is sent follows the link down to a floor the encoder's own library sets;
no key of the target sets one.

On a Mac, audio is **experimental**. An `ard-high-performance` target receives
it from Screen Sharing itself, beside the picture (above). No such path has been
measured in Standard mode, so an `ard` target carries no sound; no Mac target
offers sound as a choice. Standard mode never touches the Mac's sound output, so the
Mac keeps playing where it did — its own speakers, or an AirPlay receiver that
runs outside alumia, on Linux or Windows.

## Camera and microphone

Two redirections send this browser's own media the other way and are
**experimental**: `camera = true` offers the remote a virtual
webcam over MS-RDPECAM — or, on a `wlshare` target, over wlshare's camera
extension, which makes it a PipeWire camera on the wlroots desktop (see
[`docs/wlshare-camera.md`](wlshare-camera.md)) — and `microphone = true`
offers an RDP host a microphone over MS-RDPEAI, or a `wlshare` target one over
wlshare's microphone extension, which makes it a PipeWire audio source on the
wlroots desktop (see
[`docs/wlshare-microphone.md`](wlshare-microphone.md)). They serve a
different purpose from the rest of the session. The
screen and the remote's sound aim to match sitting at the desktop and spend the
bandwidth that takes on a fast link; the camera and the microphone are for
someone who needs one for a while — a call, a recording — and are sent as
cheaply as that allows on any link. The microphone goes as mono speech Opus at
16 kbit/s, which the gateway decodes to the PCM the host records in. Both are off
by default and enabled per session from the session bar's menu, never remembered, and
both are refused on Apple's Screen Sharing and on a plain `vnc` target. A Windows host starts the microphone only once something on it
records. Their socket rules, control messages and channel wire formats are tested
like everything else, and the wlshare paths have container coverage. On RDP,
`a_real_host_records_the_microphone` feeds a host's recording device.
`a_real_host_streams_the_camera` in `tests/rdp_client_probe.rs` carries H.264
frames to a host's Camera app, but it is ignored by default and does not check
the pixels the host displays. The camera channel is created only by a Windows
host that redirects cameras — a workstation, or a Windows Server carrying the
Remote Desktop Session Host role. The picture is verified by hand there, where
remote audio and the rest of the RDP feature set are exercised on
every test run. Expect to re-check it by hand after a change.

## Apple's protocol has no specification

Apple's protocol revision is the one part of alumia built entirely without a specification: Apple
documents none of it — the revision, its record layer, its control messages, High
Performance's virtual display handling or its media stream — so all of it is reverse engineered and only as correct as the Macs it has been measured
against. A macOS update is free to change any of it. The dynamic-resolution
descriptor has been measured across its arbitrary-size boundary and a burst of
viewport reports, but remains reverse engineered.
