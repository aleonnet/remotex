# High Performance decoders

An `ard-high-performance` target sends its picture as HEVC and its sound as
AAC-ELD. The gateway decodes them with two libraries that are in no release
artifact, because their licences keep them out. Install both on the host that
runs the gateway:

| Library | Decodes | Version | Licence |
|---|---|---|---|
| FFmpeg's libavcodec, with its libavutil | the HEVC picture | FFmpeg 6.1 to 9 (libavcodec 60 to 63) | LGPL-2.1-or-later |
| Fraunhofer's fdk-aac | the AAC-ELD sound | fdk-aac 2 | not OSI-approved, grants no patents |

Only `ard-high-performance` needs them. `rdp`, plain `vnc` and `ard` targets,
`virtual_display = true` included, do not.

The gateway loads them when a session needs them, and looks again at every
session until it finds them. So they can be installed while the gateway runs:
the next session uses them. A Windows gateway whose config names their folders
loads them from there when it starts instead: see
[Decoders kept in a folder of their own](#decoders-kept-in-a-folder-of-their-own).

- [Debian](#debian)
- [Ubuntu](#ubuntu)
- [Other Linux distributions](#other-linux-distributions)
- [macOS](#macos)
- [Windows](#windows)
- [Container](#container)
- [Checking the install](#checking-the-install)
- [Without the decoders](#without-the-decoders)

## Debian

fdk-aac is in Debian's `non-free` component, which is off by default.

1. Add `non-free` to the `Components:` line of
   `/etc/apt/sources.list.d/debian.sources`:

   ```text
   Components: main non-free
   ```

   A host that still has `/etc/apt/sources.list` takes it at the end of each
   `deb` line instead.

2. Install both libraries (Debian 13, trixie):

   ```sh
   sudo apt update
   sudo apt install libavcodec61 libfdk-aac2t64
   ```

The `.deb` recommends both, so with `non-free` already on, installing the
`.deb` brings them in and step 2 is not needed. With it off, apt installs
libavcodec and skips fdk-aac without an error.

## Ubuntu

Both are in `universe`, which a stock install has on
(`sudo add-apt-repository universe` turns it on where it is off). On Ubuntu
24.04:

```sh
sudo apt update
sudo apt install libavcodec60 libfdk-aac2
```

Later releases name FFmpeg's package after its own major: `libavcodec61` on
25.04 and 25.10. The `.deb` recommends whichever the release has, as on Debian.

Ubuntu's `libfdk-aac2` is built from fdk-aac-free, a build with the
patent-encumbered profiles removed. It accepts the Mac's AAC-ELD configuration.

## Other Linux distributions

Install the distribution's FFmpeg and fdk-aac libraries. The gateway asks the
system loader for these names, so any package that provides them serves:

| Library | File |
|---|---|
| libavcodec | `libavcodec.so.60` to `libavcodec.so.63` |
| libavutil | `libavutil.so.58` to `libavutil.so.61`, the one released with that libavcodec |
| fdk-aac | `libfdk-aac.so.2` |

## macOS

With [Homebrew](https://brew.sh):

```sh
brew install ffmpeg fdk-aac
```

The gateway finds them in Homebrew's `lib` (`/opt/homebrew/lib`, or
`/usr/local/lib` on an Intel Mac) with nothing to configure. It also looks in
MacPorts' `/opt/local/lib` and wherever the system loader does, for
`libavcodec.60.dylib` to `libavcodec.63.dylib` and `libfdk-aac.2.dylib`.

On macOS the loaded libavcodec decodes through VideoToolbox.

## Windows

The two come from different places, both from PowerShell 7 (`pwsh`).

### FFmpeg

Install a shared build of FFmpeg 9.0, a download of about 80 MB:

```powershell
winget install BtbN.FFmpeg.LGPL.Shared.9.0
```

winget puts the build's `bin` folder, which holds `avcodec-63.dll` and
`avutil-61.dll`, on the `PATH` of the user who installed it. So run the gateway
as that user, from a shell opened after the install. A gateway already running
has to be restarted to see the new `PATH`.

### fdk-aac

It comes from [MSYS2](https://www.msys2.org), as one small package with no
dependencies:

1. Install MSYS2 into its default folder, `C:\msys64`:

   ```powershell
   winget install MSYS2.MSYS2
   ```

2. Bring MSYS2 up to date. If it stops to update itself first, run the same
   line again:

   ```powershell
   C:\msys64\usr\bin\pacman.exe -Syu --noconfirm
   ```

3. Install the library:

   ```powershell
   C:\msys64\usr\bin\pacman.exe -S --needed --noconfirm mingw-w64-ucrt-x86_64-fdk-aac
   ```

The gateway finds `libfdk-aac-2.dll` in `C:\msys64\ucrt64\bin` with nothing to
configure. `PATH` does not need that folder.

### Decoders kept in a folder of their own

`[hp_decoders]` in the gateway's config names the folders, for DLLs that are
not on `PATH`: a shared FFmpeg build unzipped somewhere, an MSYS2 outside
`C:\msys64`, or a gateway run by another user than the one winget installed
for.

```toml
[hp_decoders]
ffmpeg_dir = 'C:\ffmpeg\bin'
fdk_aac_dir = 'C:\fdk-aac'
```

| Key | The folder holds |
|---|---|
| `ffmpeg_dir` | `avcodec-60.dll` to `avcodec-63.dll`, the `avutil-58.dll` to `avutil-61.dll` released with it, and the other DLLs of that build: a shared build's `bin` |
| `fdk_aac_dir` | `libfdk-aac-2.dll` |

Each is a whole path, drive included. Either key can be left out.

A named folder is the only place that decoder is loaded from, and the gateway
loads it when it starts: one that does not find the decoder there refuses to
start, and says which file it tried. Only a gateway on Windows takes this
table.

### Where the gateway looks without it

For a decoder `[hp_decoders]` names no folder for, the gateway looks when a
session needs it, in this order:

1. Windows' own search: beside `remotex.exe`, then the folders on `PATH`.
2. MSYS2's `C:\msys64\ucrt64\bin`.

MSYS2 has an FFmpeg too, `mingw-w64-ucrt-x86_64-ffmpeg`, which the gateway
finds there. It is a full build that brings more than a hundred packages and
about 1.5 GB with it, which is why the steps above take FFmpeg from elsewhere.

## Container

The public image, `ghcr.io/andrewtheguy/remotex`, has neither library. To
decode in a container, build an image on top of it that adds Debian's:

```dockerfile
FROM ghcr.io/andrewtheguy/remotex:latest
RUN sed -i 's/^Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends libavcodec61 libfdk-aac2t64 \
    && rm -rf /var/lib/apt/lists/*
```

## Checking the install

Connect to the `ard-high-performance` target from a browser. When the gateway
decodes the stream, its log names the libraries it loaded:

```text
vnc: the HEVC decoder is libavcodec 61.19.101, from libavcodec.so.61
vnc: the AAC-ELD decoder is fdk-aac, from libfdk-aac.so.2
```

A Windows gateway with `[hp_decoders]` logs the same lines when it starts.

When a library is missing, the page shows the reason and the log repeats it,
naming the library, how to install it, and every file it tried:

```text
vnc: refusing a browser that does not decode the Mac's stream: the AAC-ELD decoder, fdk-aac, is not installed: …
```

## Without the decoders

A gateway without them still serves an `ard-high-performance` target that sets
`media_passthrough = true`, to a browser that decodes the Mac's stream itself:
Chrome and Safari do, Firefox does not. The HEVC and AAC-ELD go to that browser
as the Mac sent them, and nothing is decoded on the gateway. A browser that
cannot decode them is refused before the gateway dials the Mac.

See [The media stream](apple-vnc-889.md#the-media-stream-high-performances-picture-and-sound)
for what the stream carries, and
[Prebuilt native dependencies](../packaging/README.md#prebuilt-native-dependencies)
for why no artifact links the two libraries and for the `apple-hp-media-static`
build that does.
