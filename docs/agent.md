# remotex-agent

`remotex-agent` (`crates/remotex-agent`) runs on a Windows machine that a gateway reaches
as an `rdp` target. It captures the desktop of each session attached over RDP, codes it
as VP9 at the plan the gateway states, and sends it on a dynamic channel of that very
connection, `remotex.video`. A gateway whose target sets `agent_passthrough = true` passes
each frame to the browser as it came, so the encode moves from the gateway to the host;
the protocol, the rules the gateway holds the stream to and what was measured are in
[A Windows host's video over its own RDP connection](rdp-in-session-video.md).

**Experimental.** It has been measured against one Windows host, and what it relies on
in the host's graphics is measured behavior, not a specification. Its use is to move the
encode to the host where the setup favours it, such as a gateway on a slow machine.
The host's graphics pipeline goes on beside the stream, so the host codes its desktop
twice and the link from it carries both. The host pays for the encode in CPU, beside
everything its session runs, so a host with
none to spare, such as one drawing a video in software for want of a GPU, shows its
desktop more smoothly without it
([The host's CPU](rdp-in-session-video.md#the-hosts-cpu)).

The agent opens no port and makes no connection of its own: the channel is the RDP
connection's, and the host sees no traffic it would not see without it. It has no
configuration either. The target's keys decide whether the stream is taken, and what
it is coded to arrives from the gateway on the channel.

## Installing it

Download `remotex-agent-windows-x86_64.msi` from the
[latest release](https://github.com/andrewtheguy/remotex/releases/latest) onto the
Windows machine, and open it, or from PowerShell 7 (`pwsh`) run as administrator:

```powershell
msiexec /i remotex-agent-windows-x86_64.msi /qn
```

It installs `remotex-agent.exe`, with the Visual C++ runtime beside it, under
`%ProgramFiles%\remotex-agent`, and the **RemotexAgent** service, which it starts at once
and which starts at every boot. Then set the gateway's target:

```toml
[[targets]]
name = "win"
protocol = "rdp"
host = "10.0.0.5"
agent_passthrough = true
```

A session connected before the install gets an agent within a few seconds; nothing needs
restarting on either side. To upgrade, install a newer MSI over it: the service is
stopped, its files replaced and started again. To remove it, use **Apps & features**, or
`msiexec /x remotex-agent-windows-x86_64.msi /qn`; the service goes with it.

Windows x86-64 only, on a Windows that takes RDP connections: Windows 10 or 11 Pro or
Enterprise, or Windows Server. The package is not signed, so a downloaded one opened by
hand meets SmartScreen's warning.

## The service

The service runs `remotex-agent service` as LocalSystem, in session 0, where there is no
desktop to capture and no RDP connection to write to: it captures nothing. It keeps one
**session's agent**, `remotex-agent session`, running in each session that a user is
logged on to and that is attached over RDP:

- A session attached over RDP gets its agent as soon as someone is logged on to it,
  started as that user, on that user's desktop and with that user's environment, and
  without a console window.
- A session left — disconnected or logged off — has its agent stopped at once. The next
  connection to it gets an agent of its own, and so does a gateway's takeover, which
  leaves the session on one connection and comes back on another.
- A session's agent that exits by itself is started again 5 seconds later, twice as long
  after each exit that followed a run shorter than a minute, up to 5 minutes.
- The console, and a session nobody is logged on to, get no agent: neither has an RDP
  connection to carry the stream.

It learns of sessions from the service control manager's session notifications, and
looks at them every 5 seconds besides, which is what restarts an agent and what puts a
missed notification right. When the service stops, for an upgrade, a removal or a
shutdown, it stops every agent it started; when it starts, it stops any other
`remotex-agent` left in a user's session. Windows starts the service again 10 seconds
after it ends without being asked to.

A session's agent runs as the user and not as LocalSystem on purpose: it reads the
gateway's messages off the channel, and a capture with the user's rights is all the
stream needs. The cost is the **secure desktop** — a UAC prompt, Ctrl+Alt+Del, the lock
screen — which a capture in the user's session is refused. The agent says so, and the
graphics pipeline carries the picture until the user's desktop is back.

## A session's agent

`remotex-agent session` streams the session it runs in, and is what the service starts;
run by hand in a session, from the zip the release carries beside the MSI, it does the
same for as long as it runs. It must not run beside the service's own agent in the same
session: the two would contend for the channel.

It opens the channel first. A session attached to a gateway whose target does not set
`agent_passthrough` has the channel refused, as has one between connections; the agent
tries again a second later, then twice as long each time up to 30 seconds. A channel
that closes, or that cannot be written, is tried again the same way, the wait starting
over at a second only once the gateway has echoed a frame on it, so a channel closed as
soon as it opens — a gateway that speaks another version, or one that refuses the first
frame — is not reopened every second. Once open, it waits for the gateway's plan, codes
nothing before it, and streams: see
[Whose picture it is](rdp-in-session-video.md#whose-picture-it-is) for what the gateway
does with each message.

It duplicates the output at the desktop's origin, which is the only one an RDP session
has unless its client spans monitors.

## Logs

| Log | Written by |
|---|---|
| `%SystemRoot%\System32\LogFiles\remotex-agent\service.log` | the service: each session change, and each agent it started, stopped or saw exit |
| `%LOCALAPPDATA%\remotex-agent\session.log` | each user's session's agents: the channel opening and closing, the plan, the capture starting over, quality changes |

A line is a UTC time to the millisecond and what happened; nothing is logged per frame.
A log past 1 MiB is kept once as `<name>.old.log` the next time a process starts writing
it. Neither an upgrade nor a removal touches them.

## Building

The crate is a member of the root workspace, on its version, and codes with the
gateway's pinned `desktop-vp9`. It is Windows only: on any other target the binary is a
stub that says so. `tests/rdp-agent/build.ps1` builds it on `windows-ci-build` with the
`qa` profile, and with `-Check` runs its clippy and tests first;
`ci/windows/ci.ps1` runs them with the gateway's.

`packaging/build-windows-agent.ps1` builds the release artifacts,
`dist\remotex-agent-windows-x86_64.msi` from `packaging/windows/remotex-agent.wxs` and
`dist\remotex-agent-windows-x86_64.zip`, and `packaging/verify-windows-agent-msi.ps1`
installs the MSI, checks the service is registered and running as the package says, and
removes it. The release workflow's Windows row runs both and attaches the two artifacts
to the release; `ci/windows/ci.ps1 -Package` runs them on `windows-ci-build`.

A real host's side is `tests/rdp_dvc_video_probe.rs`. Three of its tests run against a
host with the MSI installed (`tests/rdp-agent/install-service.ps1`, and
`uninstall-service.ps1` after): `the_service_gives_each_connection_an_agent`,
`a_reattach_starts_the_stream_over_at_a_keyframe`, which reattaches a browser to a
gateway under the stream, and `removing_the_service_under_the_stream_gives_the_picture_back`,
which removes the MSI while its agent streams. The others start a session's agent
themselves; see [Running it](rdp-in-session-video.md#running-it).

## Not yet

- **The secure desktop.** A session's agent started as LocalSystem in the user's session
  could duplicate the Winlogon desktop too, at the price of a SYSTEM process reading the
  channel. The pipeline carries it instead.
- **More than one monitor**, and Windows on arm64.
- **A signed package.**
