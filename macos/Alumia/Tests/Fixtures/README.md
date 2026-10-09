# The examples both sides are tested against

The app and the gateway it hosts talk in JSON, and these files are that talk: the
gateway's tests (`src/app.rs`) and the app's (`Tests/AlumiaCoreTests`) read the
same ones, so a field that changes its name or its shape on one side fails a test
on the other.

- `settings-before.toml`, `change.json`, `shown-after.json`: settings, the change
  the app sends, and what the app is shown afterwards. The change turns two
  displays on for the Mac, which is written in its Virtual entry alone; an entry
  that opens with one display is sent the key as nothing, which takes it away.
- `replaced.json`: the change the app sends when a computer becomes one of
  another kind, here the Windows host of `settings-before.toml` made a plain VNC
  server with no password typed. It is another computer in the old one's place:
  nothing of the old one is kept, its password least of all.
- `refused.json`: a change the gateway refuses, as the app is told it: in the
  words the catalogue has for the app, and not in a terminal's.
- `status-serving.json`, `status-waiting.json`, `status-stopped.json`: what the
  gateway is doing, the last of them stopped by its owner, which is no fault.
- `neighbours.json`: what the app prints of the other computers it found.
- `tailscale-status.json`, `tailscale-serve.json`: what Tailscale 1.102.4 answered
  `tailscale status --json` and `tailscale serve status --json` on the Mac this
  was written on, with a page published. The shape and the states are that
  answer's. Every name, address, key and account in it was replaced, the fields
  the app does not read were left out, and nothing in it is anybody's.
- `tailscale-serve-taken.json`: the same answer made into one where the Mac's
  address already leads to something else of its owner's, and another port of it
  to a third thing. Built from the shape of the real one, and not seen: seeing it
  would mean publishing something else in the owner's network.

Every name, address and password in all of them is made up.
