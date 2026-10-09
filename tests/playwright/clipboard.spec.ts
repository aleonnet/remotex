import { expect, test } from "@playwright/test";
import {
  leaveSession,
  logInAndConnect,
  openClipboardPanel,
  readRemoteClipboard,
  returnToPicker,
  setRemoteClipboard,
  skipUnlessLiveMac,
} from "./support";

// The sheet the clipboard is read and written in, and its way out.
const SHEET = { name: "Clipboard" };
// The box a fetched text is shown in, as it is, and no field.
const BOX = "On the remote computer";

// Cleanup, so it runs even when an assertion below threw: see `leaveSession`. The
// switch back at the end of the test stays, because the page-error assertion after
// it is about that too; this hook is a no-op once it has run.
test.afterEach(async ({ page }) => {
  await leaveSession(page);
});

test("clipboard panel reads require explicit Copy while pushes still auto-sync", async ({
  page,
}) => {
  test.setTimeout(90_000);
  skipUnlessLiveMac();

  const pageErrors: string[] = [];
  let remotePushes = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") {
        return;
      }
      try {
        const message = JSON.parse(payload) as {
          type?: string;
          requested?: boolean;
        };
        if (message.type === "clipboard" && !message.requested) {
          remotePushes += 1;
        }
      } catch {
        // Binary video frames and unrelated non-JSON data are not clipboard
        // control messages.
      }
    });
  });

  await logInAndConnect(page);

  // Unsolicited remote changes retain the established automatic-sync path.
  const remoteValue = `alumia-ui-remote-${Date.now()}`;
  setRemoteClipboard(remoteValue);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(remoteValue);
  await expect.poll(() => remotePushes).toBeGreaterThan(0);

  // A repeated remote announcement can follow a guest paste even though the
  // guest clipboard content did not change. It is activity for metadata, but
  // must not replace a newer local clipboard value.
  const localSentinel = `alumia-ui-local-${Date.now()}`;
  await page.evaluate(
    (text) => navigator.clipboard.writeText(text),
    localSentinel,
  );
  const pushesBeforeRepeat = remotePushes;
  setRemoteClipboard(remoteValue);
  await expect.poll(() => remotePushes).toBeGreaterThan(pushesBeforeRepeat);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(localSentinel);

  // A panel fetch is a read. It may not cross the explicit Copy boundary and
  // replace this unrelated local clipboard value.
  await openClipboardPanel(page);

  const sheet = page.getByRole("dialog", SHEET);
  const shown = sheet.getByLabel(BOX);
  await expect(shown).toBeVisible({ timeout: 10_000 });
  await expect(shown).toHaveText(remoteValue);
  await expect(sheet).toContainText(`${remoteValue.length} characters, 1 lines`);
  // No field, and nothing that takes typing focused: a phone's keyboard stays down.
  await expect(sheet.getByRole("textbox")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(localSentinel);

  await page.getByRole("button", { name: "Copy to this device" }).click();
  await expect(sheet.getByText("Copied.")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(remoteValue);

  // Write… opens the field, and Send sends what was written.
  await page.getByRole("button", { name: "Write…" }).click();
  const input = sheet.getByLabel("From this device");
  await expect(input).toBeFocused();
  const webValue = `alumia-ui-web-${Date.now()}`;
  await input.fill(webValue);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(sheet.getByText("Sent to the remote computer.")).toBeVisible();
  await expect.poll(readRemoteClipboard).toBe(webValue);

  // An empty field is not a way to clear either clipboard: the remote takes
  // ownership of whatever is sent, so Send says what it wants and sends nothing.
  await input.fill("");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    sheet.getByText("Type some text before sending."),
  ).toBeVisible();
  await expect.poll(readRemoteClipboard).toBe(webValue);
  await input.fill(webValue);

  // Some remote clipboard bridges re-announce host-provided text when the
  // guest pastes it. That echo is not a guest copy/cut and must not travel
  // back over a newer host clipboard.
  const echoSentinel = `alumia-ui-after-send-${Date.now()}`;
  await page.evaluate(
    (text) => navigator.clipboard.writeText(text),
    echoSentinel,
  );
  const pushesBeforeEcho = remotePushes;
  setRemoteClipboard(webValue);
  await expect.poll(() => remotePushes).toBeGreaterThan(pushesBeforeEcho);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(echoSentinel);

  // Closing discards the field; reopening fetches again and shows the text.
  await sheet.getByRole("button", { name: "Close" }).click();
  await openClipboardPanel(page);
  await expect(sheet.getByLabel(BOX)).toHaveText(webValue);
  await expect(sheet.getByRole("textbox")).toHaveCount(0);

  // The sheet keeps inside a phone's width; canvas pixels remain deliberately
  // unasserted.
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await sheet.boundingBox();
  // A throw rather than expect(...).not.toBeNull(): the assertions below need a
  // box, and TypeScript cannot learn from an expectation.
  if (box === null) {
    throw new Error("the clipboard sheet has no bounding box");
  }
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);

  await sheet.getByRole("button", { name: "Close" }).click();
  await returnToPicker(page);
  expect(pageErrors).toEqual([]);
});
