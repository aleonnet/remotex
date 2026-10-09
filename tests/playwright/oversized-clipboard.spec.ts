// The refusal path, end to end against the live Mac: a pasteboard larger than
// MAX_CLIPBOARD_BYTES is reported as its size rather than transferred in part.
//
// Worth a live test rather than only unit coverage, because the claim spans five
// layers that each used to truncate independently — macOS Screen Sharing, gateway,
// browser link, panel state, and the panel's own buttons — and the interesting
// failure is a truncated value arriving *successfully*, which no single layer can
// catch.
import { expect, test } from "@playwright/test";
import {
  leaveSession,
  logInAndConnect,
  openClipboardPanel,
  readRemoteClipboard,
  returnToPicker,
  setRemoteClipboard,
  setRemoteClipboardBytes,
  skipUnlessLiveMac,
} from "./support";

const LIMIT = 524_288;
// Just over the limit, because the limit is the whole subject: a layer that
// truncates at 512 KiB truncates any oversized value alike, so a bigger one
// proves nothing extra. It costs something, though — Apple's pasteboard archive
// of an n-character string measures about 4n, and `MAX_ARCHIVE_BYTES` in
// src/vnc_apple_clipboard.rs refuses to inflate past 4 × the limit plus 64 KiB,
// so past roughly 540 000 characters the reader declines before any size is
// taken and the sheet has no size to say.
const OVERSIZED = 530_000;

// Cleanup, so it runs even when an assertion below threw: see `leaveSession`. The
// call at the end of the test stays, because the page-error assertion after it is
// about the switch back too; this hook is a no-op once that has run.
test.afterEach(async ({ page }) => {
  await leaveSession(page);
});

test("a remote clipboard over the limit is reported, not truncated", async ({
  page,
}) => {
  test.setTimeout(90_000);
  skipUnlessLiveMac();

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await logInAndConnect(page);

  // Set *after* the session is up, on purpose: the gateway starts the remote
  // pasteboard watch during connection, so a value that was already there is not
  // a change and is never read at all. `logInAndConnect` returns once it is.
  const localSentinel = `alumia-ui-local-${Date.now()}`;
  await page.evaluate(
    (text) => navigator.clipboard.writeText(text),
    localSentinel,
  );
  setRemoteClipboardBytes(OVERSIZED);

  await openClipboardPanel(page);

  // No count of characters or lines: none of the text was transferred to count.
  // Its size is the whole of what the sheet knows.
  const sheet = page.getByRole("dialog", { name: "Clipboard" });
  const box = sheet.getByLabel("On the remote computer");
  await expect(box).toBeVisible({ timeout: 20_000 });
  expect(OVERSIZED).toBeGreaterThan(LIMIT);
  await expect(box).toContainText("530 kB");
  await expect(sheet).toContainText("Too large to transfer");
  await expect(sheet).not.toContainText("characters");

  // The refusal costs the local clipboard nothing — the whole point of not
  // mirroring a value that was never transferred.
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(localSentinel);

  // Copy names the size as the reason. "Nothing to copy" would be the answer for
  // a remote that copied nothing, which is the case this is kept apart from.
  await page.getByRole("button", { name: "Copy to this device" }).click();
  await expect(
    sheet.getByText("The remote clipboard is too large to transfer."),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(localSentinel);

  // Sending is not held by it: Write… opens the field empty, and Send works
  // from there, for as long as the remote's clipboard is oversized.
  await page.getByRole("button", { name: "Write…" }).click();
  const input = sheet.getByLabel("From this device");
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("");
  const typed = `alumia-ui-typed-${Date.now()}`;
  await input.fill(typed);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(sheet.getByText("Sent to the remote computer.")).toBeVisible();
  await expect.poll(readRemoteClipboard).toBe(typed);

  // And a value that fits still comes through afterwards, so the refusal left
  // nothing behind that suppresses the next copy — the sheet shows it as an
  // ordinary text again.
  //
  // Asserted through the sheet's own fetch rather than through this browser's clipboard:
  // mirroring into the OS clipboard is best-effort by design (writeText can
  // reject), so it is the wrong signal for "did the value arrive". The approved
  // clipboard spec is where that mirror is covered.
  const afterValue = `alumia-ui-after-${Date.now()}`;
  setRemoteClipboard(afterValue);
  await sheet.getByRole("button", { name: "Close" }).click();
  await openClipboardPanel(page);
  await expect(sheet.getByLabel("On the remote computer")).toHaveText(afterValue, {
    timeout: 20_000,
  });
  await expect(sheet).toContainText(`${afterValue.length} characters`);
  await expect(sheet).not.toContainText("Too large to transfer");

  // Closed before leaving: the bar's End is under whatever hangs from it.
  await sheet.getByRole("button", { name: "Close" }).click();
  await returnToPicker(page);
  expect(pageErrors).toEqual([]);
});
