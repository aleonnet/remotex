# Local instances: `alumia tui`

Several gateways on one machine, each with its own config and its own address,
behind one loopback port. For one gateway, `alumia serve` is all there is: see
the [README](../README.md).

Native installs also include a multi-instance terminal control plane:

```sh
alumia tui
```

It listens only on both loopbacks, at `serve`'s port: 52380 unless `--port` or
`ALUMIA_TUI_PORT` says otherwise, and never a port the kernel picked, because
this is a number you type into a browser. A port something else is already
serving refuses the start rather than answering on half of it.
Open <http://alumia.localhost:52380>; each
running instance has its own origin at
`http://<instance>.alumia.localhost:52380`. Press `n` to create an instance,
`e` to edit its `alumia.toml`, `s` to start it, `x` to stop it, `r` to restart
it, `a` to start every stopped one, `o` to open a running one in your browser,
Enter to see its settings, and `q` to stop every child and quit.

Each immediate subdirectory is one instance. The default root is
`~/.local/share/alumia/instances` on Linux (or
`$XDG_DATA_HOME/alumia/instances`),
`~/Library/Application Support/alumia/instances` on macOS, and
`%LOCALAPPDATA%\alumia\instances` on Windows; pass `--instances-dir` to choose
another. The root is made private to your account — mode `0700`, or on Windows
an ACL naming only you and `SYSTEM` — because the configs hold credentials. Its
config uses the same `[branding]` and `[[targets]]` format as a gateway's and
deliberately has no `[server]` block. `e` opens it in `$VISUAL` or
`$EDITOR` — `vi` when neither is set, and Notepad on Windows. The supervisor owns
the shared TCP port and proxies each subdomain to that child's private endpoint:
`<instance>/gateway.sock`, or on Windows a named pipe only your account can open.
