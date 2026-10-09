// The one environment check this client makes, and it is a refusal rather than a
// branch.
//
// Two things below the login are not optional and neither can be supplied by the
// page itself. A **secure context**, because that is what `navigator.clipboard`,
// `navigator.keyboard` and WebCodecs are all gated on. And the **WebCodecs
// decoders**, because every target may deliver its desktop as an encoded video
// stream (even though an RDP graphics pipeline can be composed instead) and its
// sound as encoded packets, and nothing here decodes either one itself — the gateway
// names a configuration and the browser's decoder does the work (videoDecoder.ts,
// audioPlayer.ts).
//
// Missing either, every dependent feature used to go missing separately and explain
// itself separately: near-identical "reach this gateway over HTTPS" messages under
// the clipboard and the keyboard, a banner over the canvas, another beside the audio
// toggle, and a fallback path behind each. A session that half worked, in a way
// nobody could describe.
//
// So the checks happen once, before the app mounts, and the answer is no. Nothing
// downstream tests `isSecureContext` or `typeof VideoDecoder` again, and nothing
// carries a second path for either case: there is no such session left to have a
// path for.
//
// The gateway speaks plain HTTP and always has — it has no TLS listener and is not
// getting one. A secure context therefore comes from where the page is reached, not
// from what the gateway is:
//
//   http://localhost:52380, http://127.0.0.1:52380, http://[::1]:52380   loopback
//   http://<label>.localhost:52380                                       RFC 6761
//   https://gateway.example                                    TLS-terminating proxy
//
// A LAN address on plain http is the case this refuses, and the screen that says so
// (CannotStart.tsx) names the three ways out. This module decides and says why, as
// data; it draws nothing, so the rule is tested without a page.

/** A decoder this client cannot work without, as the screen names it. */
export type Decoder = "video" | "sound";

/**
 * Why the client will not start: the cause, by its code in the catalogue
 * (docs/design/errors.json), with what the screen says of it.
 */
export type Refusal =
  /** Not a secure context: the address the page was opened at is the problem. */
  | { cause: "AL-1001"; address: string }
  /** No WebCodecs decoder for one or both of what every session carries. */
  | { cause: "AL-1002"; missing: Decoder[] };

/**
 * The decoders this client cannot work without, of the ones this browser lacks.
 *
 * Both, not either: audio is a target's own choice and video is a render dial's, so
 * a browser with one and not the other is a browser that plays some targets and not
 * others — which is exactly the half-working session this file exists to refuse.
 * Checked as globals rather than through `isConfigSupported`, because that is
 * asynchronous and per codec, and this is a question about the browser.
 */
function missingDecoders(): Decoder[] {
  const missing: Decoder[] = [];
  if (typeof VideoDecoder === "undefined") {
    missing.push("video");
  }
  if (typeof AudioDecoder === "undefined") {
    missing.push("sound");
  }
  return missing;
}

/**
 * Why the client may not start, or null.
 *
 * The secure context is asked about first because it is the answerable one: WebCodecs
 * is itself secure-context gated, so an insecure origin fails both checks, and
 * "install a different browser" would be the wrong thing to tell someone whose
 * browser is fine.
 */
export function refusal(): Refusal | null {
  if (!window.isSecureContext) {
    return { cause: "AL-1001", address: window.location.origin };
  }
  const missing = missingDecoders();
  return missing.length > 0 ? { cause: "AL-1002", missing } : null;
}
