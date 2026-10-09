// Whether this browser reads the clipboard on focus, in silence, or only inside
// the tap that asks.
//
// The specification lets a page read the clipboard only as the person pastes;
// what each browser does beyond that is its own. Chromium asks once for the
// `clipboard-read` permission and reads in silence from then on: "If a read
// isn't allowed by the spec and the document has focus, it triggers a request
// to use permission clipboard-read, and succeeds if the permission is granted
// (either because the user accepted the prompt, or because the permission was
// granted already)" (MDN, "Clipboard API", Security considerations). Firefox and
// Safari grant no such permission — "The clipboard-read and clipboard-write
// permissions are not supported (and not planned to be supported) by Firefox or
// Safari" (same page) — and answer a read inside a gesture with "an ephemeral
// context menu with a single Paste option"; WebKit says of a read outside one
// that "the promise will immediately reject", and of one inside it that "On
// iOS, this takes the form of a callout bar with a single option to paste"
// (WebKit blog, "Async Clipboard API", Safari 13.1). So a page that read the
// clipboard on every focus showed an iPhone the callout on every return to the
// session, and would show Firefox its menu.
//
// The test is the permission itself: a browser whose Permissions API knows
// `clipboard-read` reads on focus; one that does not (the query rejects with a
// TypeError for a name it does not support) leaves the clipboard to the
// sheet's own Paste button, which reads inside the tap and is answered by the
// one callout the person asked for.
export async function clipboardReadsOnFocus(): Promise<boolean> {
  try {
    await navigator.permissions.query({
      name: "clipboard-read" as PermissionName,
    });
    return true;
  } catch {
    return false;
  }
}
