# Desktop audio over VNC with wlshare

How a wlroots-based Wayland desktop behind wlshare hands the gateway its sound,
on the RFB connection it already has, so a `wlshare` target plays through the
browser the way an RDP one does. Standard RFB carries pixels and a clipboard and
nothing else; this is wlshare's private audio extension, which carries the sound
as Opus, or as lossless FLAC on a target that asks for that, and borrows its
control messages from the QEMU Audio extension `rfbproto` registers. Either way
the gateway codes nothing: wlshare makes the stream the browser decodes, and the
gateway passes it as it came. It is announced the way the density extension is
([`wlshare-density.md`](wlshare-density.md)): a `wlshare` session started with
sound lists a pseudo-encoding, and wlshare announces that it speaks it
before anything is turned on.

Measured 2026-09-09 on `workstation-wsl`, a headless sway with one `HEADLESS-1`
output and PipeWire's own dummy sink, through a one-off WebSocket probe. The
maintained `tests/ws_probe.py --audio` probe exercises the current socket path.

The server side is [wlshare](https://github.com/andrewtheguy/wlshare), which,
while any client listens, has the desktop play into a PipeWire sink of its own
rather than the host's, so the host is silent the way a remote desktop's is. It
captures that sink's monitor — what the desktop is playing, whatever is playing
it — and sends it in the format the client asked for, coded as the client asked:
Opus packets, or FLAC frames.

## Configuration

```toml
[[targets]]
name = "workstation"
protocol = "vnc"
subtype = "wlshare"
host = "127.0.0.1"
port = 5900
username = "me"
password = "…"
```

`audio_format`, `audio_bitrate`, `audio_adaptive` and `audio_adaptive_min` mean
on this target what they mean on an `rdp` one, with wlshare's encoder in place
of the gateway's: Opus at `audio_bitrate`, walked down toward the floor while
the browser's link is behind, unless `audio_format = "flac"` (EXPERIMENTAL)
asks for the sound lossless. The format is the gateway's to ask for on the
wire; wlshare has no key for it.

`subtype = "wlshare"` says the server is wlshare, and Sound, ticked under the
target at the picker before Start, is what makes the gateway list the extension
to it. A session started without it lists none, and the desktop keeps playing on
the host. The choice is offered on a `wlshare` target and on no other `vnc`
target: a plain one is read through the
RFB baseline, which carries no sound, `ard` carries none either, and
`ard-high-performance` takes its sound from the media stream. A `wlshare`
target pointed at a server that is not wlshare, or at a wlshare with its own
switch off, lists the pseudo-encoding, hears no announcement, and runs in
silence. QEMU's own audio extension, which carries raw samples, is never asked
for.

wlshare's own `audio` key (default `false`) is the server's side of the same
switch: with it off the extension is not announced, and a client that lists the
pseudo-encoding is told nothing.

## The wire

Two private pseudo-encodings and one private message type, beside the QEMU Audio
extension's message type for everything else.

- **Pseudo-encoding** `0x574c5346`, `WLSF` in ASCII, listed in the client's
  `SetEncodings` beside the standard ones. A server that does not know it
  ignores it, as RFB requires. QEMU's own pseudo-encoding, `-259`, is not
  listed: what it promises is raw samples.
- **Pseudo-encoding** `0x574c4f50`, `WLOP`, listed beside the first: the sound
  as Opus in place of FLAC. The gateway lists it unless the target sets
  `audio_format = "flac"`. It rides `SetEncodings`, as the VP9 stream's choices
  do, so the stream that begins is already the one asked for.
- **Message type** `255` with **submessage** `1`, the QEMU extensions' shared
  type, for the client's set-format, enable and disable and the server's begin
  and end, and for wlshare's own set-bitrate beside them. Nothing else under type 255 is advertised by this client, and a
  submessage or operation it does not know is fatal: the QEMU submessages share
  no length field, so one that cannot be measured leaves the stream at an
  offset nothing recovers from. That includes QEMU's operation 2, raw data.
- **Message type** `0xE4`, server → client, for the sound itself: one Opus
  packet or one FLAC frame a message.

### Server → client: the announcement

An **empty pseudo-rectangle** of encoding `WLSF` inside a `FramebufferUpdate` —
the only way support is announced, the same shape ExtendedDesktopSize uses.
wlshare sends it as its own update, ahead of any pixels, on the first
`SetEncodings` that lists the encoding.

| Offset | Type | Field |
|---|---|---|
| 0 | U16 | x, 0 |
| 2 | U16 | y, 0 |
| 4 | U16 | width, 0 |
| 6 | U16 | height, 0 |
| 8 | S32 | encoding, `0x574c5346` |

### Client → server: set format, set bitrate, enable, disable

The format is the client's to choose — the server converts whatever the desktop
plays into it — so there is nothing to negotiate. This gateway asks for
**signed 16-bit, 2 channels, 48 000 Hz**, which is Opus's own rate — wlshare
codes Opus only at 8, 12, 16, 24 or 48 kHz — and one a browser plays as it is.

| Offset | Type | Field |
|---|---|---|
| 0 | U8 | `255` |
| 1 | U8 | `1` |
| 2 | U16 | operation: 0 enable, 1 disable, 2 set format |
| 4 | U8 | sample format (set format only): 0 U8, 1 S8, 2 U16, **3 S16** |
| 5 | U8 | channels, 1 or 2 |
| 6 | U32 | frequency, 8 000 to 96 000 in wlshare |

Four bytes for an enable or a disable, ten for a set-format. QEMU's 32-bit
formats, 4 and 5, are refused by wlshare, since FLAC stores at most 24 bits.

Set-bitrate is operation `3`, wlshare's own: the rate Opus is coded at, in bits
per second, 6 000 to 510 000. wlshare starts at 96 000 where it is told none,
and a running stream moves to a new rate at its next packet, with no restart
and nothing said to the decoder. A FLAC stream has no rate to move.

| Offset | Type | Field |
|---|---|---|
| 0 | U8 | `255` |
| 1 | U8 | `1` |
| 2 | U16 | operation, `3` |
| 4 | U32 | bits per second |

The gateway sends set-format, set-bitrate and enable, once, when the
announcement arrives, and a set-bitrate again each time its walk moves.

### Server → client: begin, end

| Offset | Type | Field |
|---|---|---|
| 0 | U8 | `255` |
| 1 | U8 | `1` |
| 2 | U16 | operation: 0 end, 1 begin |

### Server → client: a frame

| Offset | Type | Field |
|---|---|---|
| 0 | U8 | `0xE4` |
| 1 | U8[3] | padding |
| 4 | U32 | length of the frame |
| 8 | U8[] | one Opus packet or one FLAC frame |

Sent between a begin and an end. Every frame holds exactly `frequency / 50`
frames of samples — 20 ms, **960** at the gateway's 48 kHz.

An Opus packet is the stream the gateway's own encoder makes of an RDP host's
sound: both are [desktop-opus](https://github.com/andrewtheguy/desktop-opus), a
repository of its own that the gateway and wlshare each pin by release tag —
libopus tuned for music, constrained variable rate around the bitrate, at full
effort, linked statically from a prebuilt archive. `OpusHead` is never sent:
everything in it follows from the format the client set, with the encoder's
lookahead, 312 samples at 48 kHz, as the pre-skip, so the gateway states it to
the browser itself (`vnc_audio::PASSED_OPUS`). Silence is a few bytes a packet.

A FLAC frame is in FLAC's
fixed-blocking mode, and is numbered zero: wlshare makes each frame a FLAC
stream of its own, one block long, so that none waits for the next. The FLAC stream header,
`STREAMINFO`, is never sent: everything in it follows from the format the client
set and that block size, so the page's decoder is held to it. An
unsigned format has the top bit of every sample flipped before it is encoded,
mapping it onto the signed range with silence on zero, and flipped back after;
the gateway asks for a signed one, so nothing flips. Decoded samples are
interleaved, little-endian, and bit for bit what wlshare captured.

Opus is the one lossy step on the way to the browser, made once, by wlshare, and
a target with `audio_format = "flac"` (EXPERIMENTAL) has none
([Lossless sound](architecture.md#lossless-sound)). As FLAC, music and speech
cost about two-thirds of their 1.5 Mbit/s PCM rate or less on the RFB
connection and on the browser's, and a desktop playing nothing, whose capture
still runs, a few bytes a frame; as Opus they cost the target's bitrate on both.

## What the gateway does with it

`src/vnc_audio.rs` is the wire and what the browser is told of each stream;
`src/vnc.rs` keeps the
extension's state per connection as `Audio`: `Off` where no sound was asked for
and on the Apple dialects, `Asked` from the handshake, `Announced` once the
rectangle has arrived and the stream has been turned on, and `Unanswered` once
pixels have arrived with no announcement in front of them — a server that
announces late is still taken.

- The announcement is answered after the update it arrived in, not inside it,
  so the enable goes out once however the update was framed.
- `begin` publishes the negotiated format on `AudioBridge` and `end` clears it,
  which leaves an open `/ws/audio` response filling with silence rather than
  ending. A desktop going quiet must not cost the listener its stream.
- Each frame between a begin and an end goes to the bridge as it came, one unit
  a frame (`AudioBridge::unit`), and from there to `/ws/audio` behind an
  `audioFormat` that says `passthrough` (`AudioListener::into_passed`): `opus`
  with the `OpusHead` above, which the browser's WebCodecs decoder takes, or
  `flac` for the page's own decoder. Nothing here decodes, checks or re-encodes
  a frame; the browser's decoder is what refuses a bad one. An empty frame, one
  past the audio socket's 16-bit packet length, or one outside a begin and an
  end is dropped with a warning.
- The Opus bitrate is the target's: `audio_bitrate` is named to wlshare with the
  enable, and where `audio_adaptive` is on, the walk that would move an encoder
  here moves wlshare's instead. The pump that feeds `/ws/audio` measures how
  long its sends block, as for any target, and each rate the walk arrives at
  goes through the bridge to the VNC engine, which sends it as a set-bitrate
  ([Audio frames](architecture.md#audio-frames)). A new listener's walk starts
  from the ceiling. Silence is not shed, since a passed stream has no samples
  here to tell it by.
- A frame length past 64 KiB is read past rather than allocated: a frame is
  3840 bytes of samples before compression, and FLAC adds a few header bytes at
  worst, so anything larger is a server that has lost its framing.

So the gateway needs no codec for wlshare's sound, and no library on its host:
a `wlshare` target's Sound is never greyed at the picker for the want of one.
wlshare's FLAC encoder is libFLAC, through
[desktop-flac](https://github.com/andrewtheguy/desktop-flac), which the gateway
pins too, for the FLAC it codes of an RDP host's sound.

Audio shares the TCP stream with the pixels, which is the one cost of carrying
it in band. wlshare drains its capture queue before every framebuffer update, so
sound is never held behind a ZRLE or VP9 frame it was ready before; the browser's
300 ms lead clamp absorbs what is left.

## What wlshare does

While any client listens, the desktop plays into the **speaker**, a
`support.null-audio-sink` named `wlshare-speaker` ("wlshare remote audio") that
`crates/wlshare/src/audio.rs` makes with the first client's enable and removes
with the last one's disable or disconnect. Its `priority.session` is 100000,
above what WirePlumber gives any host sink, the one the user configured
included, so it is the default while it exists and every stream that follows
the default moves to it. Nothing on the host is muted and no default is
written: the node belongs to wlshare's PipeWire connection, so when it goes —
or wlshare dies — WirePlumber makes the host's sink the default again and the
streams follow it back. A stream an application pinned to a sink of its own
stays there and is heard on the host.

`crates/wlshare/src/audio.rs` starts one PipeWire capture per client that
enables audio, on a thread of its own, and stops it on a disable or when the
client goes. The stream is a `Stream/Input/Audio` node with
`stream.capture.sink = "true"` and `target.object` the speaker, which is what
makes PipeWire connect it to the **speaker's monitor** rather than to a
microphone, and `node.latency` asks
for 20 ms buffers, one frame's worth in either codec. The process callback runs on that capture's own loop thread
rather than on the graph's real-time one — `RT_PROCESS` is deliberately not set,
since the callback encodes, allocates, takes a mutex and wakes a task, none of
which is real-time safe: on the data thread it could stall the whole audio graph
and give every application on the host an xrun. It encodes there,
off the session's task, and queues each finished frame in a sixteen-deep queue,
dropping the oldest when a client cannot keep up — a dropped FLAC frame is a
20 ms hole, a dropped Opus packet one the decoder conceals, and a stalled
capture callback is worse. A set-format on a running stream, or a list that
changes its codec, restarts the capture as now asked for; a set-bitrate moves
the running encoder.

PipeWire honours its own quantum before settling on the requested one, so the
first buffers of a session are often smaller than 20 ms — 512 frames where 960
were asked for, measured. The encoder keeps what does not fill a frame for the
next buffer, so every frame on the wire is exactly 20 ms.

A headless session needs no sink of its own, and no `null-sink` needs
configuring: the speaker is one.

## Measured

These were taken while the RFB connection carried raw PCM and the gateway coded
the Opus. The stream that reaches the browser is the same one, now made by
wlshare with the same encoder at the same rate; neither leg has been measured
again on a live desktop since.

With a 6-second 440/660 Hz stereo tone playing into the default sink through
`pw-play`, then silence, on this host:

```
306 frames, 306 packets, 73746 bytes     tone:    241 bytes a packet
192 frames, 192 packets,   576 bytes     silence:   3 bytes a packet
```

And the control, wayvnc on another host, reached as a `wlshare` target and asked
for sound:

```
vnc: the server carries no audio; the session runs without sound
0 frames
```

The format is still announced on `/ws/audio` there — the gateway advertises one
format and writes the header before any remote channel is up — so a server
without the extension is silence measured in packets, not in the announcement.

Exercise the current path:

```sh
REMOTEX_PROBE_PASSWORD=… uv run tests/ws_probe.py \
  --port <gateway port> --target <name> --user <user> --seconds 8 --audio
# meanwhile, on the host
pw-play <some>.wav
```
