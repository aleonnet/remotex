// A display shown in a tab of its own, beside the session's page: what the list
// offers a computer opened on two displays, what the Screens sheet says and
// links to, what the tab's own bar has, and whose the display is when two tabs
// want it. Against the gateway's test harness (tools/run-page-tests.sh), whose
// scripted computer "two-screens" starts on two displays and draws nothing: every
// assertion here is a decision of the page's or the gateway's, not a pixel.
import { expect, type Page, test } from "@playwright/test";

import {
  BASE_URL,
  chooseDisplay,
  computerRow,
  handle,
  logIn,
  openBar,
  returnToPicker,
  stageSession,
} from "./support";

const TWO = "two-screens";

// The bar of the display's tab, opened from the handle that wears its number.
const TAB_HANDLE = "Open Display 2's bar";

async function openTabBar(tab: Page) {
  const bar = tab.getByRole("toolbar", { name: "Display 2's bar" });
  if (!(await bar.isVisible())) {
    await tab.getByRole("button", { name: TAB_HANDLE }).click();
  }
  await expect(bar).toBeVisible();
  return bar;
}

// The session on "two-screens", opened from its line with the second display
// where its key was left.
async function openTwo(page: Page) {
  await logIn(page);
  await computerRow(page, TWO).getByRole("button", { name: "Open" }).click();
  await expect(handle(page)).toBeVisible({ timeout: 20_000 });
}

test.describe("a second display in a tab of its own", () => {
  test.skip(BASE_URL === "", "needs the gateway's test harness");

  test("the list's first key says where the second display sits, and Open sends it", async ({
    page,
  }) => {
    const staged = await stageSession(page);
    await logIn(page);
    const row = computerRow(page, TWO);
    const place = row.getByRole("button", { name: /^Second display/ });
    await expect(place).toHaveAccessibleName("Second display on the right");
    await place.click();
    await expect(place).toHaveAccessibleName("Second display on the left");
    await row.getByRole("button", { name: "Open" }).click();
    await expect
      .poll(() => staged.sent.find((message) => message.type === "connect"))
      .toMatchObject({ target: TWO, choices: { placement: "left" } });
    await expect(handle(page)).toBeVisible({ timeout: 20_000 });
    // Back on the right for whoever comes next: the choice is remembered.
    await returnToPicker(page);
    for (const side of ["above", "below", "on the right"]) {
      await place.click();
      await expect(place).toHaveAccessibleName(`Second display ${side}`);
    }
  });

  test("the Screens sheet says both displays are shown, and has the way to the second", async ({
    page,
  }) => {
    await openTwo(page);
    await (await openBar(page)).getByRole("button", { name: "Screens" }).click();
    const sheet = page.getByRole("dialog", { name: "Screens" });
    await expect(
      sheet.getByRole("button", { name: /^All screens/, pressed: true }),
    ).toContainText("A tab each");
    await expect(
      sheet.getByRole("button", { name: /^Display 2/, pressed: false }),
    ).toContainText("640 × 480 · 1x");
    const link = sheet.getByRole("link", {
      name: "Open Display 2 in another tab",
    });
    await expect(link).toHaveAttribute("href", /\/display\/2$/);
    // One display alone is in no tab, and the way to one goes with it.
    await sheet.getByRole("button", { name: /^Display 1/ }).click();
    await expect(link).toHaveCount(0);
    await sheet.getByRole("button", { name: /^All screens/ }).click();
    await expect(link).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();
    await returnToPicker(page);
  });

  test("the tab has a bar of its own, and is one tab's at a time", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await openTwo(page);

    // The display's own page, in this browser: it is this tab's as it opens.
    const tab = await context.newPage();
    await tab.goto(new URL("/display/2", BASE_URL).toString());
    await expect(tab.getByRole("button", { name: TAB_HANDLE })).toBeVisible({
      timeout: 20_000,
    });
    await expect(tab).toHaveTitle(/^Display 2 · /);
    const bar = await openTabBar(tab);
    await expect(bar.getByRole("note")).toHaveText("Display 2 · 640 × 480 · 1×");
    await expect(bar.getByRole("button", { name: "Disconnect" })).toBeVisible();
    // What is the session's stays on the session's page.
    for (const name of ["End", "More", "Keyboard", "Screens"]) {
      await expect(bar.getByRole("button", { name, exact: true })).toHaveCount(0);
    }

    // Another tab takes nothing by opening it: it says whose it is, and asks.
    const other = await context.newPage();
    await other.goto(new URL("/display/2", BASE_URL).toString());
    const inUse = other.getByText(/^Display 2 is open in another tab/);
    await expect(inUse).toBeVisible({ timeout: 10_000 });
    await expect(other.getByText("AL-3301")).toBeVisible();
    await expect(other.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await other.getByRole("button", { name: "Take over" }).click();
    const asked = other.getByRole("dialog", { name: "Take over Display 2?" });
    await expect(asked).toContainText("The other tab stops showing it.");
    await asked.getByRole("button", { name: "Take over" }).click();
    await expect(other.getByRole("button", { name: TAB_HANDLE })).toBeVisible({
      timeout: 10_000,
    });
    // The tab it was taken from says so, and does not take it back by itself.
    await expect(tab.getByText(/^Another tab took over Display 2/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(tab.getByText("AL-3401")).toBeVisible();
    await tab.getByRole("button", { name: "Take it back" }).click();
    await expect(tab.getByRole("button", { name: TAB_HANDLE })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      other.getByText(/^Another tab took over Display 2/),
    ).toBeVisible({ timeout: 10_000 });
    await other.close();

    // Disconnect stops showing the display here, and ends nothing.
    await (await openTabBar(tab))
      .getByRole("button", { name: "Disconnect" })
      .click();
    await expect(tab.getByText(/^Display 2 is not shown in this tab/)).toBeVisible();
    await expect(handle(page)).toBeVisible();
    await tab.getByRole("button", { name: "Connect" }).click();
    await expect(tab.getByRole("button", { name: TAB_HANDLE })).toBeVisible({
      timeout: 10_000,
    });

    // One display alone on the session's page is in no tab, and the tab says so.
    await chooseDisplay(page, "Display 1");
    await expect(
      tab.getByText(/^The session is not showing Display 2 in a tab/),
    ).toBeVisible({ timeout: 10_000 });
    await expect(tab.getByText("AL-3501")).toBeVisible();
    await chooseDisplay(page, "All screens");
    await tab.getByRole("button", { name: "Retry" }).click();
    await expect(tab.getByRole("button", { name: TAB_HANDLE })).toBeVisible({
      timeout: 10_000,
    });

    // A device with a keyboard: the one on screen stays the session's page's.
    await expect(
      (await openTabBar(tab)).getByRole("button", { name: "Keyboard" }),
    ).toHaveCount(0);

    // The session's page goes: the tab says so over its display, and comes back
    // by itself when the page does.
    await page.goto("about:blank");
    const left = tab.getByText("The session's page was closed");
    await expect(left).toBeVisible({ timeout: 10_000 });
    await expect(
      tab.getByText("This display comes back when it is opened again."),
    ).toBeVisible();
    await page.goto(BASE_URL);
    await expect(handle(page)).toBeVisible({ timeout: 20_000 });
    await expect(left).toHaveCount(0);
    await tab.close();

    await returnToPicker(page);
  });
});

test.describe("a second display's tab on a touch device", () => {
  test.skip(BASE_URL === "", "needs the gateway's test harness");
  // A touch client as the page tells one: the two touch points a pinch needs.
  test.use({ hasTouch: true });

  test("has the keyboard on screen in its bar, and its keys go to that display", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "maxTouchPoints", {
        get: () => 5,
      });
    });
    await openTwo(page);

    const tab = await context.newPage();
    // What the tab sends on its display's socket, as the gateway reads it.
    const sent: string[] = [];
    tab.on("websocket", (ws) => {
      if (new URL(ws.url()).pathname === "/ws/display") {
        ws.on("framesent", ({ payload }) => {
          if (typeof payload === "string") {
            sent.push(payload);
          }
        });
      }
    });
    await tab.goto(new URL("/display/2", BASE_URL).toString());
    await expect(tab.getByRole("button", { name: TAB_HANDLE })).toBeVisible({
      timeout: 20_000,
    });
    const bar = await openTabBar(tab);
    await bar.getByRole("button", { name: "Keyboard" }).click();
    const board = tab.getByRole("group", { name: "Keyboard" });
    await expect(board).toBeVisible();
    await board.getByRole("button", { name: "a", exact: true }).click();
    await expect
      .poll(() => sent.filter((frame) => frame.includes('"type":"key"')))
      .toEqual([
        '{"type":"key","code":"KeyA","pressed":true,"caps":false}',
        '{"type":"key","code":"KeyA","pressed":false,"caps":false}',
      ]);
    await board.getByRole("button", { name: "Close" }).click();
    await tab.close();

    await returnToPicker(page);
  });
});
