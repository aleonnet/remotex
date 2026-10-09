# Changelog

English · [Português](CHANGELOG.pt-BR.md)

What changed in alumia that somebody using it would notice, newest first. The
format is [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

alumia numbers its own releases, from 0.1.0. The number is read as
[Semantic Versioning](https://semver.org/) reads a version that begins with a
zero: nothing is promised from one release to the next, and there is no
backward compatibility between them. What a release may change or remove is
what you depend on: a configuration key of `alumia.toml`, an option of the
command line, what the page's address asks for (`?passthrough=1`,
`?sound=lossless`), the WebSocket protocol, or a feature, with nothing that
reads the old form. Check [`alumia.example.toml`](alumia.example.toml) against
your config when you upgrade. Until 0.1.0 the number was remotex's, the project
alumia came from.

## Unreleased

Nothing yet.

## 0.1.3 - 2026-10-09

Everything since alumia left [remotex](https://github.com/andrewtheguy/remotex)
at its version 0.0.325, with what remotex did up to its 0.0.364 taken in: the
first release published, at
[github.com/aleonnet/alumia](https://github.com/aleonnet/alumia/releases/tag/v0.1.3),
with the Mac app's disk image attached.

### Added

- **Installing the page.** The document links a web app manifest, with the
  brand's mark as its icons: Chrome and Edge offer *Install*, an iPhone *Add to
  Home Screen* with the right icon, and the installed page opens without the
  browser's bar.
- **A public page and a new README,** both built from the product itself: the
  page the gateway serves, shown live, the screen that lights as the page
  scrolls, and the Mac app's screens drawn from its code. The page is `site/`,
  published through GitHub Pages at
  [aleonnet.github.io/alumia](https://aleonnet.github.io/alumia/); the README
  shows the product in both themes and languages.
- **A Mac's Mirrored mode** (`subtype = "ard-mirror"`): the Mac's own screens,
  left lit, with the picture and the sound over the Mac's media stream, always
  fitted to the viewer's window, or to the screen of a phone, which has no
  window. On a Mac with more than one display it shows
  the main one. Unofficial, and measured on macOS 27 with one display and with
  two.
- **An interface of its own**, drawn from a design system: one file of tokens,
  two themes (light and dark, or the system's) and two languages (Português
  and English), chosen under the gear.
- **Messages with a code.** Whatever goes wrong is said in a sentence with a
  code to quote (`AL-1001`), from one catalogue, and a media failure names its
  cause where it happens.
- **Keep me signed in on this browser:** a login the server keeps for thirty
  days and across a restart. A sign-in is also handed to the browser's password
  manager.
- **Your computers:** a line for each computer, with a monitor that shows how
  the picture will arrive and keys that choose a Mac's mode, the size and the
  sound. A Mac listed in both modes at one address and port is one line. The
  Mac the server itself runs on is listed, and its session is called, by the
  name that computer gives itself.
- **The screen that lights** between the list and the picture, coming on and
  going off as a tube does, and a screen that says whose the session is when it
  is not this page's, with the one thing to do about it.
- **The session's bar**, hanging from a handle: full screen, screens, mute, the
  keyboard on screen, the clipboard, the camera and the microphone, an
  information sheet and the preferences.
- **A keyboard on screen** that is a window on a desktop and a tablet, with
  Caps Lock and the function keys, and is docked on a phone in two pages of the
  same height: a strip always there with Tab, Esc, Ctrl, Alt, Super and the
  arrows, the shifted symbols as keys of their own, and a Sticky key that lets a
  modifier be sent alone. A key goes out when the finger lifts, shown over the
  finger and corrected by sliding to its neighbour; a touch between two keys is
  the nearest one; only the editing and cursor keys repeat while held; and a
  finger resting on a modifier holds it for every key typed meanwhile.
- **The throughput meter** as a page from the list and a sheet in a session.
- **"Cannot start"**, when the page is opened at an address that is not secure
  or in a browser without the decoders, with the ways out.
- **A Mac app** (Apple Silicon, macOS 14 or newer) that hosts the server and is
  its control, and shows no remote screen. It takes the look of the macOS it
  runs on, and on macOS 26 and 27 its windows show what is behind them and the
  panes of its settings are a capsule of glass. It installs by dragging, from a
  disk image signed and notarized that wears the system's disk with Alumia's
  icon over it; takes its owner through the first run: keep
  running, Screen Sharing, this Mac's account, where to reach it from, the
  page's password; keeps the server running as a service of the system; and
  says in the menu bar, in two lines with a light beside the first, what the
  server is doing on this Mac and who is connected. See
  [The Mac app](docs/mac-app.md).
- **Stop Alumia and Turn Alumia on,** in the app's menu and as the switch of its
  General pane: stopped, the page closes, an open session ends saying so, what
  is published in Tailscale is taken back, and nothing comes back by itself,
  after a restart either. End the session is in the menu too.
- **A newer Alumia dragged over the installed one** finds, when it is opened,
  that the server running is the older one's, and with nobody connected
  unregisters its service and registers it again; and the app registers its own
  opening at login, which is what shows the menu bar item, without anybody
  turning *Show in menu bar* off and on. Neither was yet checked from end to
  end on a Mac ([The Mac app](docs/mac-app.md#the-service)).
- **Opened from outside Applications,** from the disk image for one, the app
  asks one thing, to be moved to Applications or to quit, and is no second
  Alumia in the menu bar. Moved over an Alumia that is running, it has that one
  quit first and takes its place, and of two copies in Applications folders only
  one runs. The move was not yet seen in the app itself, and from an image that
  came from a download dragging is the way that is known
  ([The Mac app](docs/mac-app.md#only-from-applications-and-one-at-a-time)).
- **The app's settings,** in five panes: the computers, added, edited and
  removed in a sheet, which says what adding one is for; who signs in to the
  page, and the password changed; where the page is reached from, with
  Tailscale's state on this Mac; the port, the name on the page, the meter and
  the server's log, shown in the Finder; the appearance and the language.
- **The page published in Tailscale by the app itself,** with no button: while
  Alumia is on and *Reachable from other devices* is, and taken back while it
  is stopped. Where this Mac's address in Tailscale already leads to something
  else, the app says to what and leaves it alone until its owner hands it over.
- **The app's notices,** one at a time, each with the button that resolves it:
  Screen Sharing off, macOS's authorization missing, the service stopped with
  the server's own reason, macOS keeping Alumia from the local network, and
  FFmpeg missing.
- **The local network asked for by the app:** the app tries the computers of its
  settings itself, which is what has macOS ask, in Alumia's name, to reach the
  computers of the Mac's network.
- **The Mac you are at is not opened on a virtual display:** with the page open
  at the Mac that hosts alumia, that Mac's line stays Mirrored and says why,
  since a virtual display turns off the screens the page is on. From another
  device that comes in through Tailscale the line has both modes, as before;
  through an SSH tunnel, or a proxy that names no address, a browser cannot be
  told from one at the Mac, and is offered Mirrored only.
- **FFmpeg installed from the app:** while it is missing the app says so in the
  settings, in a notice and in the menu, and a click installs it with Homebrew,
  showing what Homebrew says; on a Mac without Homebrew it leads to installing
  it and goes on by itself.
- **Uninstall,** in the app: it says what it deletes, asks, deletes the
  settings, the stored passwords, the service and the Tailscale publication
  that points to Alumia, and offers to move the app to the Trash. An app put in
  the Trash while Alumia is running takes the same traces with it.
- **Other Macs with Alumia** on the page, after your computers, where the
  server is hosted by the Mac app and finds any on the Tailscale network: a line
  each, by the name that Mac gives itself, that takes the window to that Mac's
  own Alumia.
- **A session ended at the Mac that hosts Alumia says so:** ended from the
  app's menu, because Alumia was stopped there, or because its settings
  changed, each in its own sentence.
- **The terminal in two languages:** what a command says when it fails, the
  `alumia tui` panel and the command line's help come in Portuguese or in
  English, by the terminal's language (`LC_ALL`, `LC_MESSAGES`, `LANG`; on
  Windows, the user's language), each failure with its code.
- **Checks and tools:** the page held to the design system, browser tests
  against the gateway's own test harness with no remote computer, proofs by
  planted defect that those tests fail when they should, and the product
  photographed beside the mockup.
- **Documents:** the design system, a navigable mockup of the browser and of
  the Mac app, the plans and the research, and these entry documents in two
  languages.

- **Two displays, each in a tab of its own** (alpha): a Windows computer or a
  Mac in the Virtual mode with `virtual_displays = 2`, and a Linux desktop with
  wlshare and two outputs. The first display is on the session's page and the
  second opens from the Screens sheet in another tab of the same browser, with
  a bar of its own that wears the display's number. On a Windows computer the
  first key of its line chooses where the second display sits. A display is
  shown in one tab at a time, and another tab asks before it takes it. In the
  Mac app it is the "Two displays" switch of a computer's sheet, on a Windows
  computer and on a Mac, one kept in the Compatible mode alone excepted.
- **Screen not available:** while a Mac's video has not arrived, on opening and
  when the Mac starts it over, the page says so instead of showing an empty or
  a stale picture. The keyboard and the pointer are held until the picture is
  back, and a key that was down is let up.
- **Scrolling a Mac goes both ways** and by the distance scrolled, as Apple's
  own viewer sends it.
- **A black X for a pointer** where the remote hands over no pointer shape,
  instead of no pointer at all.

### Changed

- **The clipboard sheet has two directions, each with a button.** From the
  remote computer: the text as it is, in a box that is no field, so that
  opening the sheet on a phone brings no keyboard up, and *Copy to this
  device*. From here: *Send what I copied here*, one tap that reads this
  device's clipboard and sends it, and *Write…*, which opens a field only when
  asked. The card that hid the text behind a tap, and the Paste button, are
  gone.
- **Every text field is 16 px on a device with fingers,** since iOS zooms the
  page in to focus a smaller field and does not zoom back out.
- **The laboratory says when the cursor is held at an edge** while the view
  can move no further: which edge, with the window's height and the browser's
  visual viewport, in its panel and in the gateway's log.
- **A phone is sent a Mac's picture at the width it shows it.** In both of a
  Mac's modes the picture reaches a phone no wider than the phone shows it:
  its screen's short side when the session opens, its long side once it is
  turned, and more as a pinch zooms in, up to the Mac's own pixels. The Mac's
  encoder also holds the picture to what it can encode in time, by its own
  measure, so a busy Mac sends a phone a smaller picture rather than a late
  one. A desk is sent the window's size, as before, whatever the Mac's load.
- **The sound's lead is measured.** The page gives the sound the lead its
  packets are measured to need, from how late they arrive, up to the 300 ms it
  already held them to: a Mac on the same desk starts as before, and a phone
  whose packets come in bundles no longer hears a hole at each one.
- **The laboratory.** Seven taps or clicks on the "Version" row of the
  information sheet switch the page's laboratory on and off, kept in the
  browser. On, the row says so, and the page tells the server what it sees —
  the session opening, each size, what its video decoder said, each keyframe
  asked for and painted, when it leaves and comes back into sight, the
  sound's lead — which the server writes in its log as `lab:` lines, twenty
  lines a message and four messages a second at most. On, the information
  sheet also has a Laboratory tab: an instrument panel of the same events, the
  last minute of the picture as a trace on the glass's own grid (lit as the
  picture came, red where a whole picture was asked for, dark where the page
  was out of sight), the last event in words, and four gauges with one big
  number each (the width shown, the sound's lead, hidden how many times,
  connected for how long) and their counts, changing the moment the page sees
  them, with Copy report.
- **A Windows computer that gives one display of the two asked for says so.**
  The session's page showed one screen and no word of the other; it now says
  beside the picture that the second display is not available on that computer.
- **The second display's tab has the keyboard on screen on a phone and a
  tablet,** in its bar, where it could be pointed at and not typed in.
- **The second display's tab stops when the session's page goes.** Closed,
  reloading, or its connection dropped: the tab says the session's page was
  closed, lets go of what it held and sends the remote nothing, where it went on
  sending keys and clicks for up to a minute with no word of it. It comes back by
  itself when the page does.
- **An engine's error says its own cause.** A session that ended, or a computer
  that did not connect, with only the general sentence and the engine's English
  text under Details now says what happened, in both languages: a connection
  that dropped, an answer Alumia does not understand, a login exchange that
  failed, a screen too large to hold, a picture that could not be read, among
  twenty-nine new causes. A video encoder that fails says so as the session
  ends, and so does a session the server could not start, where the page was
  told nothing.
- **The optional software HEVC decoder for a browser is hevc-wasm 0.0.3.** A
  gateway that holds the 0.0.1 archive refuses it at start and says the command
  that downloads the new one.
- **The version is alumia's own, 0.1.1 now,** and no longer the number of the
  project it came from.
- **A session muted here says so.** The bar's Mute button shows a crossed
  speaker while it is pressed, and the closed bar's handle shows the same mark.
  A session with sound comes up playing on every device, a phone and a tablet
  included: the press on Open is what starts it. In Safari, and in any browser
  of an iPhone or an iPad, a page that is reloaded comes back muted, because
  that browser starts sound only at a press, and Mute is that press.
- **A Mac's screens in one picture are called Combined display;** All screens
  now means each display in a tab of its own.
- **A Mac's video holds better:** the gateway takes the Mac's video as the one
  picture of a Virtual or Mirrored session, asks for a lost piece again instead
  of a whole new picture, and says its own cause when the Mac names no ports or
  another viewer already has the Mac.
- **A drag that leaves the picture keeps going,** over the bar or past the
  window's edge.
- **A phone or a tablet opens a computer that keeps its size at the device's own
  density,** on Windows and on Linux with wlshare: sharper, where it used to open
  at 1x.
- **Why a connection was closed reaches the page behind a proxy or a tunnel,**
  where it used to read as a connection that dropped.
- **A plain VNC server is read with ZRLE and Raw only.**
- **A Mac that does not take Screen Sharing's scroll message is not opened as a
  Mac,** and the page says so; it used to be scrolled by the wheel alone. Such a
  Mac can still be set up as a plain VNC server.
- **The product is named alumia.** The binary, the config file
  (`alumia.toml`), the environment variables (`ALUMIA_*`) and the install paths
  carry the name.
- **A Mac's two stream modes are called Virtual and Mirrored** wherever the
  page names them, with no "unofficial" tag.
- **With something open over the remote screen, the remote takes no input:**
  the menu, the clipboard, the list of screens, the information sheet, the
  preferences, the meter and a dialog. The bar open alone leaves it live.
- **The keyboard on screen follows the device, not the window's width:** a
  phone on its side keeps the phone's keyboard.
- **End and Cancel put the screen out** before the list comes back.
- **The README** is for whoever uses alumia; building, checks and packaging
  moved to `README_DEV.md`, and the servers' reference to `docs/servers.md`.
- **A Mirrored session lists the Mac's screens.** With more than one display
  attached the list of screens shows them all, the mark on the main one, which
  is the one the Mac's stream carries; the others are shown as unavailable, with
  why and the way to one of them, the Mac's Virtual mode. Measured on macOS 27:
  the Mac takes a request for another display and goes on streaming its main
  one, so the request is not sent.
- **The wait for a picture is the screen that lights.** While a Mac's picture
  has not come, at the start, after a change of display or a restart of its
  stream, and while a display is being resized, the page no longer shows a box
  with the title "Screen not available": it shows the screen that lights, lit
  part of the way and breathing slowly, with the session's name and one line on
  the plate of the opening, "Waiting for the remote screen…" or "Resizing…".
  There is no bar of progress, since the wait has no known length. When the
  page has given up asking for the picture the light stops and the plate says
  so, with Reload. When the picture comes, the lit grid leaves over it, once.
  Where motion is reduced the light stands.

### Removed

- **The configuration key `audio_adaptive_min`.** The lowest rate the sound
  follows the link down to is the encoder's own; a file that still has the key
  is refused at start, with the key named.
- **From the list of computers:** passing the Mac's video through, passing a
  Windows host's graphics through, and sound without loss. The server still
  does all three, asked for by the page's address (`?passthrough=1`,
  `?sound=lossless`), and passes a Mac's video by itself where it has no
  decoder.
- **The size key of a Mirrored Mac:** its picture is always fitted to the
  viewer, and the screens' own size is no longer a choice.
- **The floating menu** and the options under each computer, replaced by the
  session's bar and the keys of the monitor.

### Fixed

- The Mac app's alert that asks before uninstalling lists what it deletes one
  item a line, each with its marker and a hanging indent, in a view wide enough
  for the items, with what stays after them. In 0.1.2 an item that did not fit
  went on under its marker, with no indent.
- A session on a phone comes back from the background with its picture. The
  page tells the server when it is out of sight, and again when the session
  opens, so a connection that dropped while it was hidden comes back in sight
  too; the server sends it nothing until it is back, then a whole picture; the
  page drops the video decoder it had, which an iPhone invalidates in the
  background, and builds a new one on that picture. Before, the picture froze
  with a decoder error (AL-4602) on returning to the tab.
- A keyframe asked for again inside 300 ms of the last is sent once: a phone
  behind its desktop asked eight times in a session and was sent eight whole
  pictures.
- No "Paste" callout on an iPhone or an iPad, in Safari or in Firefox, when
  the session opens or the page is focused: the page reads the clipboard on
  focus only where the browser grants that once, as a permission (Chrome and
  Edge, which are as they were), and not where it asks the person at each
  read. The clipboard sheet has *Send what I copied here* in every browser,
  which reads this device's clipboard inside the tap and sends it: there the
  browser asks once, for the read the person asked for.
- The screen that lights grows from the computer's monitor as soon as it is
  pressed, without waiting for a frame of the interface's clock, which a busy
  browser could hold back.
- A closed MacBook's built-in display is put back off after a Virtual session,
  and is held off for as long as the server's process lasts. Hosted by the Mac
  app, the server takes new settings without ending its process, so changing
  one does not light the display, and a server that starts again after an
  update takes the hold up where the one before left it.
- A Mac's first picture arrives sooner: the decoder is warmed before it.
- A Mirrored session takes the ports of an offer from that offer's own answer.
- A Mirrored session opens on a Mac with more than one display, a MacBook with
  its lid open beside an external one: it used to end after ten seconds, blaming
  a firewall. It shows the Mac's main display, and the pointer lands on it.
- A Mac's video that does not start says what came instead: another screen's
  pictures, packets with no picture, or nothing, which alone is put to a
  firewall.
- Error messages are said whole in the page's language. The reason the
  server, the browser or the remote computer gives no longer sits in the
  middle of the sentence, in English: each cause that is known has its own
  sentence and code (a password refused, a computer that does not answer, what
  Windows says when it ends a session, each way a Mac's video and sound fail),
  and the original text is kept under Details.
- The information sheet no longer shifts when Details opens, and its tables
  have rows of one height.
- The glass behind the page follows the theme at once, on every device. It
  kept the theme before until a pointer moved, and on a phone for good.
- A phone on a Mac's Mirrored mode is sent the picture no wider than its
  screen is long, in its own pixels. It was sent a 5120×2880 screen as
  3840×2160, fell tens of seconds behind and lost its connection.
- A picture lost when the browser's video decoder fails comes back. The page
  asks the server for a whole picture every two seconds until one is painted,
  for up to thirty seconds, and again when the page is back in sight; it used
  to ask once. Past that time it says the picture is not coming back, with
  Reload, and the notice keeps what the browser said of its decoder under
  Details.
- A computer no longer stays under "Connecting…" for good after the server
  lets go of the picture's connection alone: the page brings both of its
  connections back by itself. A size the page could not apply no longer keeps
  it there either, and is said in the browser's console.
- Edge no longer draws a second eye on the password field.

## 0.0.325 and earlier

The history before this point is remotex's: see
[its repository](https://github.com/andrewtheguy/remotex).
