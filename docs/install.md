# Installing alumia

## macOS app (`.dmg`)

On a Mac with Apple Silicon and macOS 14 or newer, Alumia is an app: it hosts
the gateway, sets it up with no file to edit, keeps it running and says what it
is doing in the menu bar, where it is also stopped and started
([The Mac app](mac-app.md)). The disk image is built on the Mac that holds its
signing identity ([Building it](mac-app.md#building-it)) and attached to the
version's release by the publication: `Alumia-<version>.dmg` is on the
[latest release](https://github.com/aleonnet/alumia/releases/latest).

1. Open `Alumia-<version>.dmg`, whose volume wears a disk with Alumia's icon
   over it. Its window
   has the app, an arrow and the Applications folder: drag Alumia to it.
2. Open Alumia from Applications. Opened from the image's own window instead,
   it is not a second Alumia: it asks to be moved to Applications, or to quit.
   The move is not yet established in the app itself, and from an image that
   came from a download dragging is the way that is known
   ([The Mac app](mac-app.md#only-from-applications-and-one-at-a-time)). The
   first run asks, in order: whether to keep
   Alumia running; for Screen Sharing to be on, which only you can turn on and
   which it takes you to in System Settings; for this Mac's account, which is how
   it opens this Mac's own screen; where to reach it from, this Mac alone or
   through Tailscale, where the app publishes the page by itself once the first
   run ends; and for the page's password.
3. Open the address the last step shows, in a browser, and sign in.

The computers you add in its settings are the ones that do *not* have Alumia: a
Windows PC, a Linux desktop, another Mac, opened from the browser by way of this
Mac. When you add one that is on your home network, macOS asks whether Alumia
may find devices on the local network: allow it, or that computer does not
open. On the page opened at this Mac itself, this Mac's line offers Mirrored
only: Virtual would turn off the screens you are looking at.

Without FFmpeg, which no package of Alumia carries, this Mac's screen opens only
in a browser that decodes the Mac's video itself. The app says so while it is
missing, in its settings, in a notice and in its menu, and installs it with
Homebrew on a click ([FFmpeg](mac-app.md#ffmpeg)).

It installs nothing outside its own bundle. What it keeps is in
`~/Library/Application Support/alumia/app`: the settings with the passwords, for
your account alone, and the gateway's own files. The image is signed with a
Developer ID and notarized, so it opens from a browser download as any app does.

To remove it, choose **Uninstall…** under About in its settings: it says what it
deletes (the settings and the computers you added, the page's password and the
computers', the service that keeps Alumia running, the throughput history, and
its Tailscale publication where there is one), deletes it, and offers to move
the app to the Trash. macOS Screen Sharing stays as it is. Dragging the app to
the Trash does the same while Alumia's service is there, on or stopped.

The app and the `.pkg` below are two ways to run the same gateway and share
nothing: neither reads the other's settings.

## Native packages

Install a native package from the
[latest release](https://github.com/aleonnet/alumia/releases/latest). The
package manager owns the gateway executable, config example and licence; the
web client is compiled into the executable. It does not own the live config, so
an upgrade or removal never replaces or deletes credentials.

Linux release binaries require glibc 2.39 or newer: Debian 13, Ubuntu 24.04,
or later releases, and RPM distributions with the same baseline. The package
format alone does not make the binary compatible with an older distribution.

### Debian 13+ and Ubuntu 24.04+ (`.deb`)

Releases provide `alumia-linux-amd64.deb` and
`alumia-linux-arm64.deb`:

```sh
curl -fsSLO https://github.com/aleonnet/alumia/releases/latest/download/alumia-linux-amd64.deb
sudo apt install ./alumia-linux-amd64.deb
```

Use the `arm64` filename on an arm64 host. The package installs:

```text
/usr/bin/alumia
/usr/share/doc/alumia/alumia.example.toml
/usr/share/doc/alumia/LICENSE
```

### RPM distributions with glibc 2.39+ (`.rpm`)

Releases provide `alumia-linux-amd64.rpm` and
`alumia-linux-arm64.rpm`:

```sh
curl -fsSLO https://github.com/aleonnet/alumia/releases/latest/download/alumia-linux-amd64.rpm
sudo dnf install ./alumia-linux-amd64.rpm
```

Use the `arm64` filename on an arm64 host. The package uses the same `/usr/bin`
and `/usr/share` layout as the `.deb`. `sudo rpm -i` and a distribution's other
RPM frontend work too, but `dnf` is preferred because it resolves dependencies.

### macOS (`.pkg`)

The gateway package is arm64:

```sh
curl -fsSLO https://github.com/aleonnet/alumia/releases/latest/download/alumia-macos-arm64.pkg
sudo installer -pkg alumia-macos-arm64.pkg -target /
```

It installs:

```text
/usr/local/bin/alumia
/usr/local/share/doc/alumia/alumia.example.toml
/usr/local/share/doc/alumia/LICENSE
```

The package is unsigned and not notarized. A browser download is quarantined,
so fetch it with `curl` as shown and install it from the terminal. The `.pkg`
contains the gateway CLI, with the web client inside it.

### Windows (`.msi`)

Windows x86-64, from PowerShell 7 (`pwsh`) run as administrator:

```powershell
Invoke-WebRequest https://github.com/aleonnet/alumia/releases/latest/download/alumia-windows-x86_64.msi -OutFile alumia-windows-x86_64.msi
msiexec /i alumia-windows-x86_64.msi
```

The package is unsigned, so SmartScreen asks before it runs. It opens the usual
install wizard — folder, confirm, and a finish page once it is done — and
installs the same tree the Unix packages do, by default under `%ProgramFiles%\alumia`, and puts `bin`
on the machine `PATH`, so `alumia` works in a shell opened after the install:

```text
C:\Program Files\alumia\bin\alumia.exe
C:\Program Files\alumia\VERSION
C:\Program Files\alumia\share\doc\alumia\alumia.example.toml
C:\Program Files\alumia\share\doc\alumia\LICENSE
```

The gateway reads its config from `%ProgramData%\alumia\alumia.toml`. Add
`/qn` for an unattended install. The multi-instance control plane,
`alumia tui`, is included and keeps its instances under
`%LOCALAPPDATA%\alumia\instances`.

## Where the config is read from

alumia reads one TOML file. Native packages default to
`/etc/alumia/alumia.toml` on Linux and
`/usr/local/etc/alumia/alumia.toml` on macOS, and
`%ProgramData%\alumia\alumia.toml` on Windows; the container defaults to
`/opt/alumia/etc/alumia.toml`; a checkout should pass `--config`.

## First configuration

The config contains the web-login hash and target credentials. Create it as the
account that will run `alumia serve`, mode `0600`. The package ships only the
public [`alumia.example.toml`](../alumia.example.toml) from which to create it.
The same account owns the state directory, where an enabled `[meter]` keeps its
database by default.

On Linux:

```sh
sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" /etc/alumia /var/lib/alumia
sudo install -m 600 -o "$(id -un)" -g "$(id -gn)" \
  /usr/share/doc/alumia/alumia.example.toml /etc/alumia/alumia.toml
alumia gen-passwd admin
${EDITOR:-vi} /etc/alumia/alumia.toml
```

On macOS:

```sh
sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" /usr/local/etc/alumia /usr/local/var/alumia
sudo install -m 600 -o "$(id -un)" -g "$(id -gn)" \
  /usr/local/share/doc/alumia/alumia.example.toml \
  /usr/local/etc/alumia/alumia.toml
alumia gen-passwd admin
${EDITOR:-vi} /usr/local/etc/alumia/alumia.toml
```

On Windows, from PowerShell 7 (`pwsh`) opened after the default-path install, where only the account
that runs the gateway may read the directory — the config and the throughput database
with its SQLite files inherit that. If the wizard selected another folder, use its
`share\doc\alumia\alumia.example.toml` as the `Copy-Item` source instead:

```powershell
New-Item -ItemType Directory -Force "$env:ProgramData\alumia" | Out-Null
icacls "$env:ProgramData\alumia" /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F"
Copy-Item "$env:ProgramFiles\alumia\share\doc\alumia\alumia.example.toml" "$env:ProgramData\alumia\alumia.toml"
alumia gen-passwd admin
notepad "$env:ProgramData\alumia\alumia.toml"
```

The example is under `/usr/share/doc/alumia/` on Linux,
`/usr/local/share/doc/alumia/` on macOS, and on Windows under the MSI's selected
install directory (by default `%ProgramFiles%\alumia\share\doc\alumia\`).

Paste the generated `admin:$2b$...` value into `[server].site_passwd` and
replace the example `[[targets]]` entry with the remote desktop to reach. Start
the gateway in the foreground:

```sh
alumia serve
```

Then open <http://localhost:52380>. [Servers, modes and media](servers.md) says
how each kind of target is set up, and [Reaching it from another
device](#reaching-it-from-another-device), below, how the page is reached from
another machine.

A Mac target with `subtype = "ard-high-performance"` needs a library on the
gateway's host that no package contains, FFmpeg. See
[High Performance decoder](high-performance-decoder.md) for installing it.

## Configuration

alumia reads one TOML file, named with `--config` when run from a checkout.

```toml
[server]
site_passwd = "admin:$2b$..."

[[targets]]
name = "workstation"
protocol = "rdp" # rdp or vnc
host = "192.0.2.10"
username = "Administrator"
password = "change-me"
```

Generate `site_passwd` with `alumia gen-passwd <username>`. Every key, with an
example for each kind of computer, is in
[`alumia.example.toml`](../alumia.example.toml). `alumia check-config -c
alumia.toml` says what is wrong with a file without starting anything.

Two things are asked for by the page's address and by no key: `?passthrough=1`
has the server pass a Mac's or a Windows host's own stream instead of encoding
it again, and `?sound=lossless` asks for sound without loss where the computer
offers it.

## Reaching it from another device

The server listens on `127.0.0.1:52380` unless `[server].listen` or `--listen`
says otherwise. The page only starts at a secure address, because a browser
gives the clipboard, the camera and the video decoders to nothing else. From
another device, that is one of:

- the server's HTTPS address, behind a reverse proxy or a private network that
  gives it one;
- an SSH tunnel to the server's port, opened at `http://localhost:52380`;
- the server's own computer.

Opened anywhere else, the page says so, with the ways out and the code
`AL-1001`.

## Security

- One user, and one session at a time: a second browser is asked before it
  takes the session over.
- The web login is the bcrypt hash in `site_passwd`. The computers' own
  credentials stay on the server, in the config file: keep it mode `0600`.
- A kept login is stored by the server, beside the config, and not by the page.
- The default address is loopback. Putting the server on a network is a choice
  made in `[server].listen`.

## Container

```sh
docker run -d --name alumia -p 52380:52380 \
  -v ./alumia.toml:/opt/alumia/etc/alumia.toml:ro \
  ghcr.io/aleonnet/alumia:latest
```

Set `[server].listen = "0.0.0.0:52380"` in the mounted config, or pass the same
address as `-e ALUMIA_LISTEN=0.0.0.0:52380`. With `[meter].enabled` set, mount
a volume at `/opt/alumia/var` too, or the records go with the container. Images
are published for Linux amd64 and arm64 with `latest` and `v<version>` tags. The
image has no `alumia tui`.

Generate the required web-login credential with:

```sh
docker run --rm -it ghcr.io/aleonnet/alumia:latest gen-passwd admin
```

## Upgrade

Download the new asset and hand it to the same package manager:

```sh
sudo apt install ./alumia-linux-amd64.deb
sudo dnf upgrade ./alumia-linux-amd64.rpm
sudo installer -pkg alumia-macos-arm64.pkg -target /
msiexec /i alumia-windows-x86_64.msi
```

Use only the command for the host platform. Package files are replaced in
place. The live config remains untouched because it is outside every package
manifest.

Going back to an earlier version is the same command with the earlier asset,
and the config is then the thing to look at: an earlier gateway refuses a file
that holds a key it does not know, whole, and says only that the configuration
is not valid TOML. Take out what the later version added before starting the
earlier one; the [changelog](../CHANGELOG.md) says what each version added.
The Mac app keeps its own settings, and
[its guide](mac-app.md#an-older-app-put-in-the-place-of-a-newer-one) says what
to do there.

## Uninstall

On Debian or Ubuntu:

```sh
sudo apt remove alumia
```

On an RPM distribution:

```sh
sudo dnf remove alumia
```

On macOS there is no package manager to ask, so the repository ships an
uninstaller that reads the installed receipt and removes exactly what the
package wrote:

```sh
curl -fsSLO https://raw.githubusercontent.com/aleonnet/alumia/main/packaging/uninstall-macos-pkg.sh
sudo bash uninstall-macos-pkg.sh
```

`--dry-run` prints the removals without making them and needs no `sudo`. The
script forgets the receipt afterwards, and keeps any payload directory that
still holds a file the operator put there. Doing it by hand is the same steps
against the current layout:

```sh
sudo rm -f /usr/local/bin/alumia
sudo rm -rf /usr/local/share/doc/alumia
sudo pkgutil --forget com.aleonnet.alumia.gateway
```

On Windows, remove alumia from **Apps & features**.

None of these touch the live config or state. Remove `/etc/alumia` and
`/var/lib/alumia` on Linux, `/usr/local/etc/alumia` and
`/usr/local/var/alumia` on macOS, or `%ProgramData%\alumia` on Windows
separately only when the credentials, configuration, and throughput history
should be deleted too.

## Container

```sh
docker run -d --name alumia -p 52380:52380 \
  -v ./alumia.toml:/opt/alumia/etc/alumia.toml:ro \
  ghcr.io/aleonnet/alumia:latest
```

Set `[server].listen = "0.0.0.0:52380"` in the mounted config, or pass the same
address as `-e ALUMIA_LISTEN=0.0.0.0:52380`. With `[meter].enabled` set, mount a volume
at `/opt/alumia/var` too, or the records go with the container. Images are
published for Linux amd64 and arm64 with `latest` and `v<version>` tags.

Generate the required web-login credential with:

```sh
docker run --rm -it ghcr.io/aleonnet/alumia:latest gen-passwd admin
```

## Build release packages

Build the tarball input, then the native package for the current host:

```sh
bash packaging/build-tarball.sh
bash packaging/build-native-packages.sh
```

Linux builds both `.deb` and `.rpm`; macOS builds `.pkg`. See
[`packaging/README.md`](../packaging/README.md) for the release workflow.
