import { Frame } from "./Frame.tsx";
import { Glyph } from "./Glyph.tsx";
import { usePreferences } from "./preferences.tsx";
import type { Refusal } from "./preflight.ts";
import type { WordKey } from "./words.ts";

// "Cannot start": what is shown in the app's place where it may not start
// (preflight.ts). The decision was made before this is drawn, and nothing here
// asks the gateway for anything: a session claimed from a page that cannot show
// it is a session taken away from wherever it was working.
//
// Each way out says what to type. The page does not know the gateway's secure
// address, which is somebody's proxy, so that one is named without it; the tunnel
// and the local address are made from the address the page was opened at.

/** The port a tunnel and a local address are made with. */
function portOf(address: URL): string {
  return address.port || (address.protocol === "https:" ? "443" : "80");
}

export function CannotStart({ refusal }: { refusal: Refusal }) {
  const { t, message } = usePreferences();
  const insecure = refusal.cause === "AL-1001";
  const title: [WordKey, WordKey] = insecure
    ? ["start.insecure.1", "start.insecure.2"]
    : ["start.decoder.1", "start.decoder.2"];

  return (
    <Frame gear={false}>
      <div className="al-hero al-hero--wide">
        <h1 className="al-name al-twolines">
          <span>{t(title[0])}</span>
          <span>{t(title[1])}</span>
        </h1>
        {refusal.cause === "AL-1001" ? (
          <Insecure address={refusal.address} />
        ) : (
          <>
            <p role="alert">
              {message("AL-1000", "AL-1002", {
                missing: t(
                  refusal.missing.length > 1
                    ? "start.missing"
                    : `start.missing.${refusal.missing[0]}`,
                ),
              })}
            </p>
            <ul className="al-ways">
              <li>
                <Glyph name="monitor" />
                <span>{t("start.way.browser")}</span>
                <span className="al-chip">Chrome · Edge</span>
              </li>
            </ul>
          </>
        )}
        <p className="al-code">
          <span>{t("common.code")}</span> <span>{refusal.cause}</span>
        </p>
      </div>
    </Frame>
  );
}

function Insecure({ address }: { address: string }) {
  const { t, message } = usePreferences();
  const opened = new URL(address);
  const port = portOf(opened);
  return (
    <>
      {/* The catalogue's sentence, for a reader who is not shown the address
          and the ways out side by side. */}
      <p className="al-sr" role="alert">
        {message("AL-1000", "AL-1001")}
      </p>
      <p className="al-msg al-msg--danger">
        <Glyph name="circle-alert" />
        <span>
          <span>{t("start.address")}</span>{" "}
          <span className="al-chip">{address}</span>
        </span>
      </p>
      <ul className="al-ways">
        <li>
          <Glyph name="lock" />
          <span>{t("start.way.https")}</span>
        </li>
        <li>
          <Glyph name="command" />
          <span>{t("start.way.tunnel")}</span>
          <span className="al-chip">
            ssh -L {port}:127.0.0.1:{port} {opened.hostname}
          </span>
        </li>
        <li>
          <Glyph name="monitor" />
          <span>{t("start.way.local")}</span>
          <span className="al-chip">http://localhost:{port}</span>
        </li>
      </ul>
    </>
  );
}
