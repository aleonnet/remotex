# The Mac app

Alumia for the Mac is an app that hosts the gateway and is its control: it
installs by dragging, takes its owner through the first run, keeps the gateway
running as a service of the system, says what it is doing in the menu bar, where
it is also stopped and started, publishes the page in Tailscale by itself, and
takes its traces away. It is **not a second client**: it shows no remote screen.
The page does that, in a browser, as on every other system
([The client and its bundle](architecture.md#the-client-and-its-bundle)).

It runs on Apple Silicon, on macOS 14 or newer. For installing and removing it,
see [Install](install.md#macos-app-dmg); for building it,
[Building it](#building-it) below.

## What is in the bundle

`packaging/build-mac-app.sh` puts the bundle together by hand, with no Xcode
project: the app is a Swift package (`macos/Alumia`) and the gateway a Cargo
one, and a bundle is a folder with a known shape.

```text
Alumia.app/Contents/
  MacOS/Alumia                                    the app
  Helpers/alumia                                  the gateway
  Library/LaunchAgents/com.aleonnet.alumia.gateway.plist   the service the app registers
  Resources/AppIcon.icns, <language>.lproj/InfoPlist.strings, LICENSE, THIRD-PARTY-LICENSES.txt
  Info.plist
```

The gateway is in `Contents/Helpers` and not beside the app's own executable: a
Mac's disk does not tell `alumia` from `Alumia`.

The Swift package has two targets. `AlumiaCore` decides everything the app shows
and does, has no framework of the system in it, and is what `swift test` covers.
`Alumia` is the screens over it: the menu bar item (`NSStatusItem` with an
`NSMenu`), the first run, the settings with their sheets (a computer added,
edited or removed, the page's password changed, FFmpeg installed), and what the
app does with no window. It also has a main menu, seen only while one of its
windows is open, a menu bar item having no menu bar otherwise: its Edit menu is
what turns ⌘V, ⌘C, ⌘X, ⌘A and ⌘Z into something the field with the cursor does
(`EditCommand`, `MainMenu.swift`), and its application menu has the settings and
quitting.

## The service

The gateway runs as a launch agent the app registers with `SMAppService.agent`,
and not as a child of the app: it serves with the menu bar item hidden or quit,
and the system starts it again when it ends (`KeepAlive`). Its property list
names the binary by `BundleProgram`, so the bundle can be moved, and runs it as
`alumia serve --app`.

On a Mac that is set up the agent stays registered, whatever its owner chose:
only uninstalling takes the registration away. **Show in menu bar** is another
registration, the app's own opening at login (`SMAppService.mainApp`), which is
what brings the item back after its owner signs in again: the gateway comes back
by itself, and without it would serve with nothing on the menu bar to say so.
The item is shown unless its owner hides it, so the app asks for that opening
itself, on a Mac that is set up: once in each opening of the app, until the
system takes it (`OpenAtLogin`). From then on it
is its owner's, and one taken out of Login Items in System Settings is put back
only by turning the switch off and on. A copy made for testing never registers
it. That the item then comes back at the next login, and that the registration
outlives an app dragged over the installed one, are the system's to do and were
not measured.

### An app put in the place of an older one

Nothing of Alumia's ends a gateway because its bundle was replaced, and a
newer app dragged over the installed one would find the older one's gateway
serving as the app that is gone did, and ask it for what it does not know. So a
gateway says which file it was started from, the device and the file's number
there (`binary`, in what `alumia app status` answers), read as it starts; and
the command that asks, which is the binary in the bundle now, adds whether that
is its own file (`current`). Where it is not, with nobody connected, the app
unregisters the service and registers it again (`Renewal`, counted by
`RegistrationPolicy.renew`): twice at most by itself in one opening of the app,
and again after its owner starts Alumia or presses a notice's button; not again
within thirty seconds, since a gateway told to end goes on answering while it
ends; and never with a session open, which ending the gateway would end.

What is established and what is not. Under test: that a gateway started by the
real binary says a file, and that the command run from another file, the same
bytes at another path, calls it not current (`tests/app_mode_e2e.rs`); that the
file is read as the process starts, another put at its path afterwards changing
nothing of what it says (a test of `src/app.rs`, with no process); and the
rule, with its count and its rest. Measured by the check below: that a
service the system had refused to launch, unregistered and registered again,
starts and serves; and, on 2026-10-07 on a MacBook Pro with macOS 27, when that
check first ran to its end, the whole on a Mac with the copy made for testing:
another file put where the gateway's binary is, the gateway that runs said not
to be the bundle's, the service unregistered and registered again at once, and
another process, the bundle's, serving. The system registered that copy's
service without asking for its owner's approval. Not established: whether the
system itself starts a service again when its bundle is replaced, in which case
the app finds a gateway that is current; whether it refuses the first launch of
a build signed with a Developer ID as it refuses one signed ad hoc (below); and
what it does with a service two copies of the app, both in Applications folders,
each register, one opened after the other has quit: the two do not run together
([Only from Applications, and one at a time](#only-from-applications-and-one-at-a-time)). Two things are known to follow a gateway that ends: the built-in
display of a MacBook with its lid closed lights for that moment; and the one
that comes up asks for the folder's lock for two seconds (`CLAIM_PATIENCE`,
`src/embedded.rs`), while the one that ends may hold it for the five its work
is given, so the first to come up may end and the system start another. A
gateway started over that does not come up is one that is registered and
silent, which the app registers again, and for which the start over gives back
the tries it had spent.

### An older app put in the place of a newer one

Nothing is promised from one version to the next, in either direction
([changelog](../CHANGELOG.md)): a gateway reads the settings it knows and
refuses a file that holds anything else, whole. The settings a newer app wrote
stay where they are when an older app is dragged over it, so the older gateway
may refuse them, and what it says then is only that the configuration is not
valid TOML (`AL-9507`), with a line and a column: it does not know the key, and
so cannot name it as one. Seen on 2026-10-07, 0.0.325 put over 0.1.0.

What 0.1.0 and later write that 0.0.325 does not know is one thing: a computer
with **Two displays** on (`virtual_displays`). A computer with one display has
no such key in the file.

So, before putting an older app in the place of a newer one, in the newer app:
turn off what the older one does not have, on each computer, which keeps the
computers and their passwords; or uninstall from the settings, which deletes the
settings with everything else the app left, and add the computers again in the
older app. An older app already in place over settings it refuses is repaired
the second way, from its own settings.

### On and stopped

Alumia is on or stopped, and that is one state: **Stop Alumia** and **Turn
Alumia on** in the menu, and the switch of the General pane. It is the gateway
that is asked (`alumia app stop`, `alumia app start`), and it stays the process
it is. Stopped, it closes the page's port, ends the open session by a cause of
its own (`AL-7803`), tries nothing by the clock, and stands with only its
control socket until it is started; the app takes back what is published in
Tailscale. The choice is a mark in the app's folder (`stopped`), so a gateway
the system starts again, at the next login too, finds it and stays stopped.

The service is not unregistered to stop Alumia, because unregistering ends the
process, and it is the process that keeps a MacBook's built-in display off under
a closed lid ([The process that does not end](#the-process-that-does-not-end)):
ending it would light that display and change the scale of the one in use at
every Stop. On is also what brings Alumia back at login; there is no separate
switch for that.

The first run's "keep running", turned off, leaves Alumia set up and stopped.

### The menu

Its top is two lines nobody can choose. The first says what Alumia is doing on
this Mac, with a light beside it, and the second who is connected or what is
needed:

| The first line | Its light | The second line | What the menu offers |
|---|---|---|---|
| Alumia is running | green | No one connected, or Connected: the computer | End the session, with one open; Stop Alumia |
| Alumia needs you | amber | the notice's own sentence | the button that resolves it |
| Alumia is not set up yet | amber | | Set up… |
| Alumia is starting… | grey | | |
| Alumia is stopped | grey | | Turn Alumia on |

"Running" is said only of a gateway that answered that it serves the page
(`MenuState`). A session is named as its line of the list is, whichever of a
Mac's two entries it is on. **Open in the browser** opens this Mac's own
address, since it is on this Mac that it opens, and from there the page knows it
is at this Mac ([The Mac you are at](#the-mac-you-are-at)); **Copy the address**
copies the one for another device, the published one where there is one.

The light is one of the system's colours and never the only sign: the sentence
beside it says the same. It is the line's image, and a line's image is the
system's to show or not: "in macOS 27 and later, AppKit determines the
visibility of menu item images, and will typically hide images. Use the
`preferredImageVisibility` property with the `.visible` constant to specify that
an image should always be visible" (`NSMenuItem.h`, in the system kit). The app
that first took the look of macOS 27 lost its light that way, in its owner's
menu: built against the kit of macOS 14 it had shown it on the same system. So
the line asks, and so does the one under it, whose clear image keeps the two
sentences beginning at the same place; `MenuTests` builds the menu as the app
does and holds both to asking. Apple adds that "in some cases, AppKit may still
hide the image, overriding this preference", and does not say which: that the
light is drawn is seen in the app, on a display.

The first line is asked for in a label's colour and not left to the faint one of
a line that cannot be chosen. On macOS 27 the system draws it faint all the
same, as its owner's menu showed.

### Registered is not running

Registered is not running. The app combines what the system says of the
registration with whether the gateway answers on its control socket, and calls a
service registered but silent only after fifteen seconds without an answer. The
system does not tell an app when its owner allows it in Login Items, so a window
that shows the state asks again every two seconds. Every decision to register
goes through one rule (`RegistrationPolicy`), which tries twice at most.

### Only from Applications, and one at a time

The app is the app only from an Applications folder, the Mac's or its owner's
own, and one copy of it at a time. What it is when it starts is decided once,
before anything of it comes up (`Launch`, in `AlumiaCore`):

- **Something asked with no window** ([below](#what-it-runs-with-no-window)) is
  done wherever the bundle is and whoever runs: the gateway runs the clean-up
  from a bundle in the Trash, and the look for other computers beside the app.
- **Outside Applications**, opened from the disk image, from Downloads or from
  where Gatekeeper put a copy of it, it asks one thing in an alert, **Move to
  Applications** or **Quit Alumia**, in the catalogue's own words (`AL-1303`),
  and is nothing else: the app's model is not made, so nothing is asked of the
  system about the service or the opening at login, nothing is registered,
  Tailscale is not read, and no menu bar item comes up beside the installed
  one's.
- **From Applications, beside another copy from Applications that runs**, it asks
  the system to open that copy, and ends. An app opened again with no window on
  show shows its settings, or its first run while it is not set up.
- A copy made for testing is the app wherever it was built.

Moving it (`Move`, and `Launching.swift`) asks the copies that run from
Applications to quit, waits for them, ten seconds at most, puts this copy in
`/Applications` in the place of the one of its name, opens that one as a new
instance, sees that what the system opened is it, and ends. A copy still running
at the limit has nothing put over it, and where anything fails the Applications
folder is shown with the app beside it, to be dragged. The copies it asked to
quit have quit by then: where nothing could be put, the first of them is opened
again, and where the copy was put and did not open, it is the one in
Applications, to be opened by hand. The gateway is not asked
to end: it goes on serving, and the app that opens finds it the older bundle's
and starts it over ([above](#an-app-put-in-the-place-of-an-older-one)).

Why it does not simply start: on 2026-10-06, opened from the disk image with the
installed one running, the app ran as a second Alumia in the menu bar, and at
each look of each copy the system's record of Alumia's opening at login changed
address, from the one to the other and back (the system's log, the lines of
`backgroundtaskmanagementd`, each one beside its answer to the copy that had just
asked what was registered).

What is established and what is not. Under test: the decision, with what is
asked with no window first and the copy that moved the app no reason to give
way; when the copy is put and when the move gives up; and that only the copy
that was put counts as opened. What Apple writes of each call it uses is in
the research: that a running
application's properties change only between two turns of the main run loop,
which is why the move waits with the app's loop turning and not in a loop of its
own; and that an app opened as the system opens by default may be answered by
the copy that asked, "the running instance (...) at a different URL", which is
why the copy put is opened as a new instance. Measured once, on macOS 27.0.1,
with a scratch app that is not Alumia, three copies under one identifier and
the Hardened Runtime: the system lists the copy it opened and not a process run
from the bundle's executable that makes no application, which is what the
gateway's two runs of the app are, though the one measured only slept, where
those two talk to the network and to the system's service manager; asked at the
top of its program, before it is an application, a copy opened alone is told of
no other, and a second one of the first; a copy asked to quit ends, and is seen
to have ended a quarter of a second later; one opened as a new instance comes up
at its own address while the copy that asked still runs; and a folder held open by a
process and replaced as the move replaces a bundle is read by that process
under the name of the copy made beside it, in no Trash, so the gateway that
watches its own bundle for the Trash does not take the move for it. Not
established: the alert, the move and the giving way in Alumia itself, which run
only in an installed app, where nothing is tried
([A copy made for testing](#a-copy-made-for-testing)); which of two copies
the system opens when the one giving way asks for the other by its address;
and the move from an image that came from a download. Such a copy is in macOS's
quarantine, the copy the app makes of itself is made by the app and not by the
Finder, and whether that copy is in quarantine too was not measured. The one
thing known of when the system stops running a quarantined app from a place of
its own choosing is a sentence transcribed from Apple's developer forum, "I
believe that the current situation is that we only remove app translocation if
the user moves the app using the Finder", of what its author calls "not
something we officially document"
(the first research): if both hold,
the copy put in Applications comes up outside Applications as far as it can
tell and asks again, with the Alumia that was installed already quit and
replaced, so no menu bar item until the app is dragged there in the Finder; the
gateway goes on serving meanwhile. The scratch app was built on the Mac that ran
it, and was in no quarantine. From a downloaded image, dragging the app in the
image's own window is the way that is known.

## Where everything is kept

Everything of the hosted gateway is in one folder only its owner opens
(mode `0700`), `~/Library/Application Support/alumia/app`, beside the
[panel](local-instances.md)'s `instances`:

- `alumia.toml`, the settings, written whole for its owner alone (`0600`). It
  holds the computers' passwords and the hash of the page's, as any gateway's
  does; nothing is kept in the Keychain.
- `control.sock`, the control socket.
- `gateway.lock`: one gateway for the folder.
- `stopped`, there while its owner has Alumia stopped.
- `gateway.log`, what the gateway did, for its owner alone (`0600`): a service of
  the system has no terminal, and what it wrote to one went nowhere. Past a
  megabyte it becomes `gateway.log.1` and another is begun. The Advanced pane
  shows it in the Finder. It is opened only once the folder is this gateway's
  own, so a second one refused the folder writes nothing in the log of the
  first.
- the gateway's own files: who is logged in, the meter's history, and the mark of
  a built-in display it holds off.

What the owner chose for the app itself (reachable from other devices, show in
menu bar, the appearance, the language) is in the app's preferences, under its
bundle identifier.

## How the app and the gateway talk

The app never writes the settings itself and never reads a secret. It runs the
gateway's binary:

```text
alumia app [--language <tag>] config-show     the settings, with no password and no hash
alumia app [--language <tag>] config-apply    a change, read as JSON on standard input
alumia app [--language <tag>] status          what the gateway is doing, and whether it is this bundle's
alumia app [--language <tag>] end-session     end the open session
alumia app [--language <tag>] reload          start over with the settings as they are
alumia app [--language <tag>] stop            stop Alumia: leave the mark, and start over
alumia app [--language <tag>] start           take the mark away, and start over
```

Each prints one line of JSON, or a refusal with its code, its sentence in the
language asked for and the original text, and ends with status 1. The sentence
is the one the catalogue has for the app, where it has one beside a terminal's
(`app`, in [`errors.json`](design/errors.json)): what a form of the app can be
refused for is said with no key of the file and no option of the command line
in it. A change goes
through the gateway's own check ([`config::check`](../src/config.rs)), so what
the app accepts is what the gateway accepts; a key the app does not know is
kept, and a computer's password that was not sent stays the one it was. A change
of the computers lists every one of them, in the list's order, and one it leaves
out is removed; the app writes the one being saved with its keys and each of the
others by its name alone, so that a computer nobody touched stays as it was,
whole, under the name it had. A Mac the settings list in one mode keeps that
entry, in its mode and under its name, and gains the other. The sheet's "Two
displays" switch, which a Windows host has and a Mac that is not kept in the
Compatible mode alone, is the computer's
`virtual_displays = 2`: written in the Windows host's entry, and of a Mac's two
in the Virtual one alone, and sent as nothing where it is off, which takes the
key away ([Two displays](servers.md#two-displays-each-in-a-tab-of-its-own)). A
computer that
became one of another kind is said to be another computer in the old one's
place (`fresh`), and keeps none of its keys: its password was another account's.
What
carries a secret goes on standard input, never as an argument, which every
process of the machine could read. The commands are hidden from `--help` and
exist only on macOS with the `embedded-gateway` feature, so no container has
them.

`stop` and `start` work as `config-apply` does: the mark is left or taken away
whether a gateway is running or not, and the one that is running is asked to
start over, so with none running the next one to start finds itself as its owner
left it. `status` says `stopped` beside `serving`, and a gateway that is stopped
gives no cause: it is no fault.

`status`, `end-session` and `reload` are asked on `control.sock`, one line of
JSON each way. It is a socket of the folder and not a route of the page: nobody
the page is published to reaches it.

The shapes are those of `macos/Alumia/Tests/Fixtures`, which the gateway's tests
and the app's both read, so a field that changes on one side fails a test on the
other.

## The process that does not end

`serve --app` starts the server over **in the same process** when the settings
change. Each run of the server has a runtime of its own. A reload ends the open
session, telling the browser why
([`server.session.host-ended`](design/errors.json)), and lets go of that
browser's socket, which writes what it was sent and ends by itself; the reload
waits for that, five seconds at most, because what comes next drops every task
of the old run where it stands. Then it stops accepting, drops that runtime and
starts another.

A server that cannot start, for want of settings, a port somebody else has, or
anything else, does not end the process either: it waits with only the control
socket open, says why to whoever asks, and is tried again every five seconds and
at every reload. Ending would be worse twice: the system would start it again
and again, and each ending would light a MacBook's built-in display.

That display is the reason. With the lid closed and another display attached,
the gateway holds the built-in one off, and the hold belongs to the process
([Apple High Performance](architecture.md#apple-high-performance)). The process leaves a
mark in its folder while it holds it, so that the one that starts next, after an
update or a crash, takes the hold up again; the mark goes when the lid opens.

A gateway its owner stopped is the same: no server is started, nothing is tried
by the clock, and the process stands, holding what it holds, until it is asked
to start over without the mark.

The process ends on a signal, when its control socket cannot be set up, and
when it finds its own bundle in the Trash.

## Reaching it

The page is served on this Mac only (`127.0.0.1`), at the gateway's port. From
anywhere else it is reached through Tailscale, which the app drives by its
command: `tailscale status --json` and `tailscale serve status --json` to read
one of six states (not installed, signed out, no HTTPS certificate, ready, in
use by something else, published at an address), and `tailscale serve --bg
<port>` to publish. The shape of that JSON is "subject to change", so it is read
in one place (`Tailscale.swift`), tested against what Tailscale 1.102.4
answered. Publishing is cut at ten seconds: Tailscale does not refuse without
HTTPS, it prints where to turn it on and waits, so refusing, printing that
address and waiting all end as "no HTTPS certificate".

Nobody publishes by a button. The publication follows the gateway, by one rule
the app applies each time it looks (`Publication`): with Tailscale ready, the
gateway saying that it serves the page and **Reachable from other devices** on,
the page is published; with Alumia stopped, or that switch off, a publication
that leads to Alumia is taken back; and nothing is decided from a gateway that
did not answer. It is published only while the gateway serves, because a port
the gateway could not take is another program's, and publishing it would hand
that program to the whole network. It is taken back on a choice, and where the
gateway comes back without its port, which then is another program's, for that
same reason; a gateway that is starting over, or settings that could not be
read, are no reason to. A change of the port takes back the publication that
led to the old one and publishes nothing by itself: the rule does, once the
gateway serves at the new one. What Tailscale has published
is read from the root of this Mac's `https` address alone, which is the one
thing `tailscale serve --bg <port>` and its `off` act on: a page somebody
published by hand at another port of the address is theirs, and is neither
called published nor taken back. Where `tailscale serve status` answers nothing
that reads, the state is "no answer" and nothing is published, since the
address may be in use. With no window open
Tailscale is looked at every thirty seconds, so with the menu bar item hidden
and the app closed nothing is published or taken back until the app is opened.
A network that refused is asked again only while a window shows the state, once
in thirty seconds: somebody is there then, and may just have enabled what it
lacked.

One thing the app does not do by itself. Where this Mac's address in Tailscale
already leads to something else, which is what `tailscale serve --bg` would take
the place of, the state is "in use by something else", the row says to what, and
the one button of the row, **Use it for Alumia**, is its owner handing it over.
The button is there only where the publication would stand. With Alumia
stopped, or the switch off, what was handed over would be taken back at the
next look, and what the address led to would be gone for nothing; and while the
gateway does not serve, or before the first run, there is no page to put
there.
That state was not seen: seeing it would mean publishing something else in the
owner's network. It is built from the shape of the real answer
(`tailscale-serve-taken.json`).

### The local network

macOS asks its owner before an app reaches a computer of the local network, and
the one that reaches the computers is the gateway. It is a launch agent, which
Apple does not exempt ("The exception for `launchd` daemons doesn't apply to
`launchd` agents",
[TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)),
and it speaks through BSD sockets, where a refusal comes with no question: the
connection fails and nobody is told why. The same note says how the question is
brought up ("There's no API to explicitly bring up the local network alert
(FB8711182), but you can do this implicitly by performing a local network
operation") and whose it is: "if your app spawns a helper tool and the helper
tool performs a local network operation, macOS considers the app to be the
responsible code", which macOS uses to "Record the user's choice for the whole
app, not just that specific helper tool". An agent has to name its app only
where it is "not installed using `SMAppService`"; the gateway is installed with
it.

So the app tries the computers of the settings itself, with the Network
framework (`Reaching`): every one that is not this Mac, when one is saved and,
with a window open, every thirty seconds. That is what has macOS ask in Alumia's
name. A try macOS refuses is told apart in the way the note gives ("If your
program doesn't have local network access, the connection enters the `waiting`
state and the current path lists an unsatisfied reason of
`localNetworkDenied`"), and is a notice of its own (`AL-1306`), after Screen
Sharing's and before FFmpeg's, with a button to System Settings; a computer that
did not answer is nobody's permission missing, and is no notice. The system "may
deny the operation immediately, before the user has responded to the alert", so
the notice can come up with the question still on screen: while macOS refuses,
every look tries again, with a window open or not, and the notice goes within
seconds of "Allow".

Two things here were not measured, and take the owner at the Mac. That the
leave given to the app holds for the gateway the system runs is what the note
above says, and it was not seen on macOS 27: if it does not hold, a computer
registered by its name on the home network stays closed after "Allow", and
registering it by its Tailscale address remains the way. The second is the
address that opens System Settings at Privacy & Security, Local Network, which
Apple documents nowhere: the notice's sentence says the way there, whatever the
button opens.

Whether Screen Sharing is on is asked by connecting to this Mac's port 5900,
which is exactly what the gateway needs. There is no public way to read the
switch, and only its owner can turn it: the app opens System Settings at
Sharing.

## The Mac you are at

A session that puts a Mac on a virtual display, the Virtual mode and the
compatible one on a screen of its own, turns that Mac's own screens off for as
long. Opened from that very Mac, it takes the window that asked with them. So
the list of computers says, on the entry that is the gateway's own computer,
whether the browser that asks is at that computer (`here`, in `GET
/api/targets`): where a proxy in front names the browser's address
(`X-Forwarded-For`, which Tailscale's `serve` sets to the address the request
came from), by that address being one of this computer's; and with none, by the
gateway listening to this computer alone. The page then keeps that Mac's line on
Mirrored, whatever was remembered for it, with its mode a mark that says why,
and a line that has only a virtual display to offer does not start (`AL-2602`).
From another device that comes in through Tailscale, which is how the app
publishes the page, nothing changes. One way in cannot be told apart: a browser
on another device that reaches a gateway listening to this Mac alone through
something that names no address, an SSH tunnel or a proxy that adds no header,
looks exactly like one at this Mac, and is taken for one. It is offered this
Mac mirrored and not on a virtual display, and the line's sentence, about the
screens it is using, is not true of it. That side was chosen knowingly: the
other mistake opens a virtual display for somebody at the Mac. That a page opened at the Mac's own
Tailscale address reaches the gateway with the Mac's own address was not
measured, which would take publishing something else in the owner's network; by
this Mac's own address, which is what the menu opens, it needs none of that.

It was measured what the Mac does when such a session falls early. On
2026-10-05, on macOS 27, a Virtual session of the Mac it was opened from created
the virtual display and turned the display in use off, as every such session
does; six seconds later its connection closed, before the video had started;
and macOS's Screen Sharing did not take the virtual display down. The Mac stood
on that display alone, with nobody connected, for nine minutes, until the end of
the next session, opened from another computer, took it down. Stopping the
gateway did nothing: it had no session by then. Why that connection closed at
six seconds is not known, since a gateway hosted by the app then left no log;
it now keeps one ([Where everything is kept](#where-everything-is-kept)).

The same can follow a session opened from elsewhere that falls in its first
seconds: whoever is at the Mac finds its screens off until another session ends.
Opening this Mac from another device and ending that session brings them back.
Taking the display down from the gateway is work in the engine, and is not done.

## The other computers with Alumia

The page's list can show the other computers that host Alumia. A local-network
announcement does not cross Tailscale, so the app asks instead: run with
`--discover` and no window, it takes the devices of the Tailscale network that
are on, leaves out this one and the phones and tablets, and asks each over
`https` whether it is an Alumia (`GET /api/announce`, which any gateway answers
with its version and its computer's name, to anybody). The gateway runs that
when the page asks `/api/neighbours`, cuts it at four seconds, keeps the answer
a minute, and passes on only a name and an `https` address.

The page lists them after its own computers, under a title of their own: a line
each, by the name that computer gives itself, whose one act is a link to that
computer's own Alumia, in the same window. Nothing of it is opened from here:
each gateway keeps its own credentials, and asks for its own login.

## What it runs with no window

```text
Alumia --discover       print the other computers with Alumia, as JSON
Alumia --cleanup        take away what the app left on this Mac
Alumia --smoke          a copy made for testing checks itself (below)
Alumia --smoke-trash    a copy made for testing puts itself in the Trash (below)
```

Each is done before the app looks at where its bundle is or at who else runs
(`Launch`): the clean-up runs from the Trash, which is outside Applications.

Uninstalling, from the settings or by `--cleanup`, undoes the Tailscale
publication that points to Alumia, unregisters the service and the opening at
login, deletes the app's folder, and forgets the preferences. The panel's
`instances` are not the app's and stay.

A gateway that is running looks every ten seconds for its own bundle in a Trash
and, finding it there, runs `--cleanup` from it. So an app dragged to the Trash
takes its traces with it **while the gateway's process is there**, which was
measured with it serving; it is the same process while Alumia is stopped. Where
there is none, on a Mac nobody set up or one whose service macOS has not
allowed, Uninstall in the settings is the way.

## FFmpeg

A Mac's picture over the media stream, which the virtual and mirrored modes
both use, is HEVC, and the gateway decodes it with FFmpeg's libavcodec, which no
artifact of Alumia carries
([Packaging](../packaging/README.md#prebuilt-native-dependencies)): the gateway
loads the one Homebrew installs, and without it runs those computers only with
the picture passed through. The Hardened Runtime refuses a
library signed by another team, and Homebrew's is signed by none, so the
gateway's binary, and it alone, carries
`com.apple.security.cs.disable-library-validation`
(`packaging/macos/gateway.entitlements`). Whether FFmpeg is there is the
gateway's to say, in `status`, asked again each time: one installed while the
gateway runs is found by the next session.

While it is missing on a Mac that hosts its own screen, the app says so in three
places, each of which installs it: a seal in the General pane, which stays until
the gateway finds it; the notice over the settings; and an item of the menu. The
menu bar's icon does not ask for its owner over it, since the screen still opens
without it. All three open one sheet. On a Mac with Homebrew it shows the
command and runs it (`/opt/homebrew/bin/brew install --yes ffmpeg`, by its whole
path and with the `PATH` it needs, an app having no terminal's), shows the line
Homebrew last said while it runs, and can be closed with the installation going
on. On a Mac without Homebrew it leads to Homebrew's own installer and waits,
going on by itself once Homebrew is there. It is done only when the gateway
finds FFmpeg, whatever the command said of itself.

## Glass

The design system draws the app in two profiles
([design system](design/2026-10-03-0003-design-system.md), "Dois perfis"): with
glass on macOS 26 and 27, without it on macOS 14 and 15. Which one the app is in
is the system's version and nothing else (`Profile`, in `AlumiaCore`).

The system gives an app the look of the system kit its executable says it was
built against, and not of the system it runs on: "In Xcode, build your app with
the latest SDKs, and run it on the latest platform releases to see the changes
in your interface" (Apple, Adopting Liquid Glass). The first image of the app
said the oldest system it runs on in the kit's place, and came up on macOS 27 in
the look of macOS 14, its settings' panes on square tabs: `swift build` links
through the toolchain's own driver, handed `--sysroot` and no `SDKROOT`, and the
linker is then told that version for both. The same source built twice and run
on macOS 27.0.1 shows what the number does: saying 14.0, a push button is 67 by
32 points, a text field 21 high, a switch 42 by 25, and a title bar with a
toolbar 80; saying 27.0, they are 57 by 24, 24, 54 by 24 and 88. So the build
tells the link where the kit is, reads the number back from the executable in
the bundle and fails on any other than that Mac's kit
([Building it](#building-it)). The tests could not have caught it: they run
inside the program that runs them, which says the kit of the Mac it is on,
whatever the app's executable says.

The menu bar's menu, an alert and a sheet are the system's own, and are drawn as
that system draws them. The rest of what the glass profile is, is asked for by
name (`Glass.swift`), each thing behind the line that tells the two profiles
apart, and each is what the plain profile draws before it:

- **The windows show what is behind them**, the settings' and the first run's.
  The recipe is the one of the house's other Mac app, read in its code, which
  its owner sees working on these systems and gave as the example: a ground that
  blends what is behind the window (`NSVisualEffectView`, the `hudWindow`
  material, `behindWindow`, always active), in a window that is not opaque, has a
  clear background, and lets its content under a title bar that draws nothing.
  That app's own note is why it is this and not SwiftUI's material for a window:
  the material "KEPT THE NSWINDOW OPAQUE", measured there. In the first run the
  step stands on that ground, and the pane beside it stays the brand's dark
  glass, as the mockup has it.
- **The panes of the settings are a capsule of glass** under the window's
  title, each its symbol over its name, as the mockup draws them in this profile
  (`.am-panes`). They are not the system's bar of panes: the controller of the
  panes is told to draw none there, and the capsule is one view for the window's
  life, kept where the system keeps what goes under a title bar
  (`NSTitlebarAccessoryViewController`, whose view the window places "under the
  titlebar"; it is told to keep the capsule's own height, the system's for that
  place being 36 points, measured). Under the pane on show is a bubble, the
  label's colour at 14 parts in a hundred, which lightens the glass under it in
  the dark look and darkens it in the light one, and which slides to the next
  when another is pressed; the pane on show is the
  label's colour and heavier, the others the fainter one. Both are the other
  app's, read in its code. A pane pressed asks the window for it, which marks
  it, shows it, names itself for it and takes its height. Each pane's button is
  as wide as the widest name in either language needs, so the capsule does not
  move when the language does.
- every button is a capsule;
- the notice is a strip of glass tinted with the warning's colour, clear of the
  window's edges as a group of rows is;
- the button on it is a glass button.

Glass itself is asked for only where something stands over the content, which
Apple's guidelines keep it to ("Don't use Liquid Glass in the content layer"): a
pane's own content asks for none.

The first two were missing from the first app that took this look, and it was
its owner who saw it: the settings window opaque, its panes on the system's bar, flat.
This document had said that bar stood on glass, as a thing measured. It had been
measured inside the program that runs the tests, by reading the views the
system builds for a window never shown, and not seen: what a window looks like
is not what a test of it reads. The same owner, with the next app installed, saw
the settings window show what is behind it and the capsule there, the pane on show
hardly marked and marked anew at each press, each pane drawing a capsule of its
own: so there is one, with the bubble.

A window that is not opaque shows nothing where nothing is drawn, so its ground
covers it from edge to edge, under its title too, and the window is no taller
than what is drawn in it. Neither held at first, and no eye had caught it: a
pane kept clear of the title bar by itself while the system kept it clear as
well, so both windows were taller by a title bar than their content, with a
strip at the foot the desktop would show through. A cold reading of the change
found it, by reading the windows as the tests do. The panes now begin where the
system lays out what is under a title, and the first run's window, which draws
to every edge itself, is told to count no room of the system's.

What the tests hold is that each thing is asked for, and no more. `WindowTests`
makes both windows as the app does, never shows them, and reads them back: not
opaque, the background clear, the content under the title bar, the ground that
blends what is behind the window covering the settings window from edge to
edge and the first run's from the brand's pane to its edges, each window as
tall as its content and what is over it, no bar of the system's, one capsule
under the title with the room kept for it, asking for glass and as wide in
either language, and a pane chosen marked, shown, named and fitted. That a
button of the capsule calls the window is one line, read: a window never shown
has no button to press, and the tree that assistive software reads comes empty
from one. `GlassTests` holds the notice and its button: a view that asks for
glass leaves in the tree of layers the system builds for it a layer that reads
what is behind it, and one that asks for none leaves none. Neither looks at a
pixel.

What any of it looks like is for eyes, and is seen in the app, on a display: a
picture drawn off screen (below) has no glass in it, and shows the notice as an
empty strip on macOS 26 and 27; a window shown from a test is not one the system
photographs; and photographing a window of a scratch program behind every
other was refused by the session this was written in. How the bubble moves, and
that the foot of each window is whole, nobody has seen. And no Mac with macOS 14
or 15 was at hand: that profile is the same controls with nothing asked of
them, by construction and not by a look.

## Words

The app says nothing typed in its code. Its texts are the `mac.` texts of
[`words.json`](design/words.json) and the ones listed in
[`app-words.json`](design/app-words.json), each with why; its messages with a
code are the catalogue's
([`errors.json`](design/errors.json), the places of kind `app`).
`tools/app-words.py` writes them into the package and, with `--check`, fails on
a text typed in Swift, a key or a code nobody uses, or one missing a language.
What the gateway refuses reaches the app already as a sentence, said by the
gateway in the language the app asked for.

The language is the app's own choice (the system's, Portuguese or English), from
a dictionary of its own as the page's is: macOS gives an app no supported way to
change its own language.

## Building it

```sh
packaging/build-mac-app.sh
```

builds the gateway (`cargo build --release`) and the app
(`swift build -c release --arch arm64`, with the link told where the system kit
is: [Glass](#glass)), assembles `dist/mac/Alumia.app`, draws
the icon in the design tokens' colours, lists what the gateway is built from,
and signs each piece from the inside out, never with `--deep`. It then reads the
kit the app's executable says it was built against, and says `the app's
executable is built against the system kit` with that Mac's own, or fails. With
`ALUMIA_SIGN_IDENTITY` (a Developer ID Application identity) the pieces are
signed for distribution, with the Hardened Runtime and a secure timestamp;
without it they are signed ad hoc, which runs on that Mac and nowhere else.

```sh
ALUMIA_SIGN_IDENTITY="Developer ID Application: …" ALUMIA_NOTARY_PROFILE=<profile> \
  packaging/build-mac-dmg.sh
```

builds the disk image somebody installs from. The app is notarized by itself and
its ticket stapled to it before it enters the image, so the copy dragged to
Applications carries its own; then the image is laid out, mounted again and
checked, signed, notarized and stapled, and the build fails unless that Mac's
own Gatekeeper says `source=Notarized Developer ID`. The image wears the
system's own disk with the app's icon over it, which is what a disk image is
known by, and not the app's icon alone, which is the app's: its owner asked for
the one after seeing the other. The build draws it
(`packaging/macos/dmg-icon.swift draw`): the system's own picture of a removable
disk, and the app's icon flat on the middle of its face, at every size an icon
has. dmgbuild has a way of its own for this (`badge_icon`),
which tilts the icon back and sets it high on the disk, with no setting for
either, and which needs a library it does not ask for and leaves the icon out
without a word where that is missing; the first image with a disk was made with
it, and its owner asked for the icon straight and in the middle. The image wears
the icon twice. On its volume, where everybody who mounts it sees it: dmgbuild
copies it there and marks the volume as having an icon, without looking whether
the mark took, so the build reads back that there is an icon, that it is the
one drawn, byte for byte, and the mark, and says
`the volume's icon is the disk's with the app's over it`, or which of the three
is wrong. And on its own file (`dmg-icon.swift wear`), which is given the same
icon; a file's icon is kept beside its content and not in it, so
it is on that Mac's copy and does not travel in a download: it is put on after
the ticket, and the ticket and Gatekeeper are asked again with it on. The
profile is one
`xcrun notarytool store-credentials` stored; `ALUMIA_NOTARY_KEYCHAIN` names the
keychain it is in, when that is not the default one. The image is built on the
Mac that holds the identity and the credential, and not by the release workflow.

The image's window is after the mockup: the brand's dark glass, the app, an
arrow, the way to Applications, each of the two names on a light capsule, and
one sentence under them, in English, since one image is handed to everybody and
the Finder writes "Applications" beside the app in every language. It is laid
out by [dmgbuild](https://dmgbuild.readthedocs.io/), run through `uv` at pinned
versions, which writes the Finder's own record of it with no Finder open. Its
size, where it opens, the two icons' size and places and the picture's size are
said once, in the script, handed to the drawing and to the record, and read back
from the mounted image, at each of the picture's two densities; the build says
`the window is as declared` or fails.

Three things about that window are the Finder's and not the image's. Each was
measured on macOS 27, by photographing the window as the Finder drew it, or
read at its source:

- **The two names.** Over a ground that is the image's own the Finder writes
  them black, in a dark Mac too: over the picture, over the picture with the
  record's own colour made black, and over a plain dark colour with no picture,
  all three photographed. It writes them light only in a window with no ground
  of its own, which is dark in a dark Mac and light in a light one, and has no
  arrow and no sentence. So each name stands on a light capsule drawn where the
  Finder puts it, and the arrow and the sentence are the light things on the
  dark glass.
- **The window's foot.** A Finder with its path bar on shows it at the foot of
  this window too, over the picture, whatever the window's record asks: 32
  points, measured, and the status bar takes as much again. The first dark
  image had its sentence under that bar. Nothing is drawn in the last 60
  points, and the build fails if the sentence is put there.
- **Where it opens.** A window's record says a place on the screen, from its
  bottom left, and nothing else: "Unfortunately it doesn't appear to be possible
  to position the window relative to the top left or relative to the centre of
  the user's screen"
  ([dmgbuild's settings](https://dmgbuild.readthedocs.io/en/latest/settings.html),
  `window_rect`). No one place is the middle of every screen. The window's
  middle is put halfway between the middle of the smallest screen a Mac is sold
  with and the middle of the largest, 1470 by 956 points and 2560 by 1440: on
  either it opens some 272 points to one side of the middle and 121 above or
  below it, and nearer on every screen between.

`packaging/build-mac-dmg.sh --window <name> --photograph <picture.png>` makes an
image of the window alone, unsigned, mounts it, opens its window behind every
other, photographs that window by its own number as this Mac's Finder draws it,
and lets go of the image. It is how the three were seen, and how a change to the
window is seen before anybody is shown it. That image is written to
`tmp/mac-window/` and never to `dist/mac/`, beside the one somebody installs
from, which it looks like: one left there was dragged to Applications, and macOS
would not start the gateway of an app nobody had signed ("Launch Constraint
Violation", in its log). The tool that plants defects makes such images too.

The first image made showed its drawing at half its size, in a corner. The
record and the picture's two sizes read back as declared: it was the dense
picture itself that had been drawn so, its size in points said after the
drawing's context was made, which is when it is read. Looking at the picture
showed it. The drawing now checks that it reaches its far corner
(`packaging/macos/dmg-background.swift`), and the build fails where it does not.

The gates of the app, beside the gateway's:

```sh
uv run --no-project python tools/app-words.py --check
cd macos/Alumia && swift build -c release --arch arm64 -Xswiftc -warnings-as-errors
cd macos/Alumia && swift test
```

## A copy made for testing

```sh
packaging/build-mac-app.sh --test
```

builds `dist/mac/Alumia Test.app`: another bundle identifier, so another
service; a folder of its own, named in its `Info.plist` and in its service's
environment; and its page on port 52399. Nothing of it is the installed app's,
and the installed app refuses the two checks below, which register and
unregister a service and delete a folder. Nor is the Mac's Tailscale its own to
touch: a copy made for testing is given no Tailscale command (`Tailscale.of`),
in its window and in its clean-up alike, so it reads nothing of what its owner
has published, and publishes and takes back nothing. The two checks run with no
window, and the copy is not left open in anybody's session. It is the app
wherever it was built, so what the installed app does outside Applications, and
beside another copy of itself, is not something a copy made for testing does.

- `--test --smoke`: the copy writes settings, registers its service, waits for
  the gateway to serve, ends it and waits for the system to bring it back, stops
  it and sees the page's port closed and the process the same, starts it again,
  puts another file where its gateway's binary is and sees the gateway that
  runs said not to be the bundle's, takes the steps the app takes for that and
  sees another process serve, and takes everything away. The build then deletes
  the copy, passed or failed, which was seen where the check failed:
  one built with `--test` alone, to be tried by hand, stays until it is built
  again or deleted. A copy built again has its service registered a
  second time, as the app does with one that is registered and silent: the
  system keeps a record of the build it last ran under the service's name and
  refuses the first launch of another, which its log calls a launch constraint
  violation.
- `--test --smoke-trash`: the copy puts itself in the Trash while its gateway
  serves, and waits thirty seconds for its service and its folder to be gone.

The gateway's own end-to-end tests run against the binary inside a bundle with
`ALUMIA_TEST_BINARY=<bundle>/Contents/Helpers/alumia cargo test --test app_mode_e2e`:
that binary is the released one, which aborts on a panic.

The screens can be drawn off screen, in each language and appearance, into
pictures to hold beside the mockup:

```sh
cd macos/Alumia && ALUMIA_PICTURES="$PWD/../../tmp/app-pictures" swift test --filter ScreenPictures
```

No test depends on a picture, and glass is not in one ([Glass](#glass)).
