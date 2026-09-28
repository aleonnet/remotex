# remotex-viewer

[remotex-viewer](https://github.com/andrewtheguy/remotex-viewer) shows gateways' pages,
each in a window of its own, on Windows and macOS. It is a repository of its own with
its own versions: the page it shows is this repository's, and changes here rarely reach
it. It is the one client in another window, a shell around the unchanged page that
delivers web platform APIs the page already uses — full screen, key events,
`navigator.clipboard`, `window.resizeTo` — natively, and on Windows the HEVC decoding
WebView2 lacks. Its README describes it; this page is what the gateway owes it.

## The interop protocol

What the viewer provides beyond the web platform, and what the page uses of it, is a
versioned protocol, numbered here. The gateway states the version its page speaks in
the page itself:

```html
<meta name="remotex-viewer-interop" content="1" />
```

in `frontend/index.html`, and the viewer uses a part of the protocol only in a document
whose version it speaks. A viewer that does not speak it leaves the page to the web
platform alone, where every part of it has a web answer, so an old viewer in front of a
newer gateway, or the other way round, is a session without that part, never a broken
one. The page carries no code for the viewer: the declaration is the protocol's only
trace in it.

A change to anything a version below describes — what the page asks, how it feeds a
decoder, what it takes back — is a new version: bump `content`, describe the new
version here, and the viewer adds it to the versions it speaks. Nothing is added to a
version once released.

### Version 1: HEVC

A High Performance Mac's picture is HEVC Range Extensions 4:4:4, which WebView2 does not
decode, so on Windows the viewer decodes it with FFmpeg's HEVC decoder and answers the
page's `VideoDecoder` for it. Version 1 is that decoder:

- **The question.** The page asks once at load, on its main thread,
  `VideoDecoder.isConfigSupported({codec: "hev1.4.10.L150.BE.8"})`
  (`frontend/src/appleMedia.ts`), and a `supported: true` is half of the yes it states
  on the session socket for `media_passthrough`.
- **The decoder.** The page decodes in a dedicated module worker it starts with the
  global `Worker` constructor (`frontend/src/desktopPainter.ts`), with a `VideoDecoder`
  configured with a `hev1.` codec string, `optimizeForLatency: true`, and no
  `description`: the parameter sets are in band. It uses `configure`, `decode`, `close`
  and `state` and nothing else of it.
- **The chunks.** Each `EncodedVideoChunk` is one access unit as an Annex B byte stream,
  as the Mac sent it (`src/vnc_apple_media.rs`), `key` or `delta` as the gateway marks
  it, with a timestamp.
- **The pictures.** The page takes any `VideoFrame` a decoder outputs, carrying its
  chunk's timestamp; the viewer's are 8-bit `I444`.

A Mac's AAC-ELD is not in the protocol: WebView2's own `AudioDecoder` takes it.
