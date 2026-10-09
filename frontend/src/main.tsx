import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./alumia.css";
import { chooseAppleMedia } from "./appleMedia.ts";
import { CannotStart } from "./CannotStart.tsx";
import { applyPreferences, PreferencesProvider } from "./preferences.tsx";
import { refusal } from "./preflight.ts";
import { chooseRdpH264 } from "./rdpH264.ts";
import { chooseVideoChroma } from "./videoChroma.ts";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

// Before `App`, which asks the gateway who this is on its first render: a session
// claimed from a page that cannot decode its own video is a session taken away from
// wherever it was working. See preflight.ts. Then, with a decoder known to exist, the
// questions asked of it — how much colour it takes, whether it takes a High
// Performance Mac's HEVC, and whether it takes the H.264 of an RDP host's pipeline
// — whose answers every session socket this page opens carries (videoChroma.ts,
// appleMedia.ts, rdpH264.ts). Awaited here so that nothing downstream has to wait
// on it or carry a path for its absence. The language and the theme kept in this
// browser go on the document ahead of those questions, so the first screen is
// painted in them. A page that may not start is given the screen that says why
// in the app's place: `App` is never mounted, and nothing is asked of the gateway.
applyPreferences();
const refused = refusal();
if (!refused) {
  await Promise.all([chooseVideoChroma(), chooseAppleMedia(), chooseRdpH264()]);
}
createRoot(root).render(
  <StrictMode>
    <PreferencesProvider>
      {refused ? <CannotStart refusal={refused} /> : <App />}
    </PreferencesProvider>
  </StrictMode>,
);
