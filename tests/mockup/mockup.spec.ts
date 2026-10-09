// The navigable mockup, opened as the file it is. Decisions, not pixels: which scene is on
// show, what a control is called, whether anything was asked of the network, whether the
// one clock runs. docs/mockups has the file; tools/check-design.py reads its source, and
// this reads what a browser makes of it.

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const MOCKUP_FILE = path.resolve(__dirname, "../../docs/mockups/2026-10-03-0233-prancha-alumia.html");
const MOCKUP = pathToFileURL(MOCKUP_FILE).href;

// The mockup is a document, and a tree may be without it (the public copy is): then there
// is nothing to open, and every test here is skipped, saying so.
test.skip(() => !existsSync(MOCKUP_FILE), "the mockup is not in this tree");

// Written here, not read from the mockup: a scene or a state taken out of it fails by name.
const SCENES: readonly { id: string; name: string; states: readonly string[] }[] = [
  { id: "start", name: "1. Não dá para começar", states: ["insecure", "no-decoder"] },
  {
    id: "signin",
    name: "2. Entrar",
    states: ["form", "checking", "sending", "wrong", "refused", "unreachable"],
  },
  {
    id: "list",
    name: "3. Seus computadores",
    states: ["ready", "loading", "empty", "error", "stale"],
  },
  {
    id: "row",
    name: "4. Um computador e as opções",
    states: [
      "mirror",
      "own",
      "compatible",
      "compatible-own",
      "windows",
      "linux",
      "vnc",
      "browser-cannot",
      "passthrough-only",
      "blocked",
    ],
  },
  {
    id: "ignite",
    name: "5. A tela acende",
    states: ["connecting", "settled", "reconnecting", "waiting"],
  },
  {
    id: "session",
    name: "6. Na sessão",
    states: [
      "bar-closed",
      "closed-in-use",
      "closed-error",
      "bar-open",
      "more-open",
      "fullscreen-refused",
      "camera-waiting",
      "camera-live",
      "camera-error",
      "mic-live",
      "mic-error",
      "sound-error",
      "mac-keys-na",
    ],
  },
  {
    id: "panels",
    name: "7. O que sai da barra",
    states: [
      "clipboard-hidden",
      "clipboard-fetching",
      "clipboard-shown",
      "clipboard-too-large",
      "clipboard-unconfirmed",
      "clipboard-over-limit",
      "displays",
      "keyboard",
    ],
  },
  {
    id: "info",
    name: "8. Informações",
    states: ["session", "details", "shortcuts", "keys", "gestures"],
  },
  {
    id: "throughput",
    name: "9. Vazão",
    states: ["live", "paused", "custom", "between", "error", "in-session"],
  },
  {
    id: "covers",
    name: "10. O que cobre a tela",
    states: [
      "resizing",
      "too-large",
      "too-many",
      "too-many-no-exit",
      "no-decode",
      "view-only",
    ],
  },
  { id: "owner", name: "11. De quem é a sessão", states: ["busy", "taken", "failed", "stale"] },
  {
    id: "notices",
    name: "12. Aviso e diálogos",
    states: ["notice", "confirm", "destructive", "error", "permission", "acknowledge"],
  },
  {
    id: "prefs",
    name: "13. Preferências",
    states: ["from-signin", "from-list", "from-session"],
  },
];
const DEVICES = ["desktop", "phone", "phone-landscape", "tablet"] as const;
// The other part: the app of Mac, on a Mac, in the two looks the system has.
const MAC_SCENES: typeof SCENES = [
  { id: "mac-install", name: "1. Instalar", states: ["disk"] },
  {
    id: "mac-first",
    name: "2. Primeira vez",
    states: [
      "welcome",
      "keep",
      "sharing",
      "account",
      "ways-missing",
      "ways-signed-out",
      "ways-no-https",
      "ways",
      "ways-published",
      "password",
      "done",
    ],
  },
  { id: "mac-menu", name: "3. Menu da barra de menus", states: ["idle", "serving", "needs-action"] },
  { id: "mac-settings", name: "4. Ajustes", states: ["general", "computers", "access", "advanced", "about"] },
  {
    id: "mac-notices",
    name: "5. Avisos",
    states: ["sharing-off", "needs-approval", "not-in-applications", "service-stopped"],
  },
  { id: "mac-remove", name: "6. Remover o app", states: ["uninstall", "uninstalled", "trash"] },
];
const PROFILES = ["mac-glass", "mac-plain"] as const;
// Every frame the mockup has, with the part it belongs to and the scenes shown in it.
const FRAMES = [
  ...DEVICES.map((device) => ({ device, part: "browser", scenes: SCENES })),
  ...PROFILES.map((device) => ({ device, part: "mac", scenes: MAC_SCENES })),
] as const;
const THEMES = ["light", "dark"] as const;
const LANGUAGES = ["pt-BR", "en-US"] as const;
// The windows the mockup itself is opened in: a phone upright and on its side, a tablet, a
// computer.
const WINDOWS = [
  { width: 390, height: 844 },
  { width: 860, height: 412 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const;

/** What went wrong while the page ran: an error in its console, or a request to anywhere. */
function watch(page: Page): string[] {
  const wrong: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      wrong.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => wrong.push(`error: ${error.message}`));
  page.on("request", (request) => {
    const url = request.url();
    if (url !== MOCKUP && !url.startsWith(`${MOCKUP}#`) && !url.startsWith("data:")) {
      wrong.push(`request: ${url}`);
    }
  });
  return wrong;
}

// The review's own controls, by name. The product has controls of the same names (a language
// to choose, say), so the review's are told apart: they are the ones outside the product.
const header = (page: Page, name: string) =>
  page.getByRole("combobox", { name, exact: true }).and(page.locator('[id^="rv-"]'));
const product = (page: Page) => page.locator("[data-al-product]");

/** Put a part of the mockup on show, in one of its frames. */
async function frame(page: Page, part: string, device: string): Promise<void> {
  await header(page, "Parte").selectOption(part);
  await header(page, "Aparelho").selectOption(device);
}

async function show(page: Page, scene: string, state?: string): Promise<void> {
  await header(page, "Cena").selectOption(scene);
  if (state) {
    await header(page, "Estado").selectOption(state);
  }
  await expect(product(page)).toHaveAttribute("data-al-scene", scene);
  await expect(page.locator(`section[data-al-scene="${scene}"]`)).toBeVisible();
}

/**
 * What does not fit: the page scrolling sideways, the scene on show scrolling sideways
 * inside the device's frame, or a floating part of it reaching past the frame's edge.
 */
async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      found.push(`the page is ${root.scrollWidth} wide in ${root.clientWidth}`);
    }
    const frame = document.querySelector("[data-al-product]");
    const scene = frame?.querySelector<HTMLElement>("section[data-al-scene]:not([hidden])");
    if (!frame || !scene) {
      return ["no scene on show"];
    }
    if (scene.scrollWidth > scene.clientWidth) {
      found.push(`the scene is ${scene.scrollWidth} wide in ${scene.clientWidth}`);
    }
    const edge = frame.getBoundingClientRect();
    const floating =
      ".al-chrome, .al-veil, .al-drop, .al-kbd, .al-plate, .al-notice, .al-pop, .al-dialog, .al-coverbox, .al-banner, .am-win, .am-menu, .am-alert";
    for (const part of frame.querySelectorAll<HTMLElement>(floating)) {
      if (part.closest("[hidden]")) {
        continue;
      }
      const box = part.getBoundingClientRect();
      if (
        box.left < edge.left - 1 ||
        box.right > edge.right + 1 ||
        box.top < edge.top - 1 ||
        box.bottom > edge.bottom + 1
      ) {
        found.push(`${part.className} reaches past the frame`);
      }
    }
    return found;
  });
}

test.describe("every scene, in every frame", () => {
  for (const size of WINDOWS) {
    test(`in a window of ${size.width} by ${size.height}`, async ({ page }) => {
      const wrong = watch(page);
      await page.setViewportSize(size);
      await page.goto(MOCKUP);

      await expect(header(page, "Cena").getByRole("option")).toHaveText(
        SCENES.map((scene) => scene.name),
      );
      const misfits: string[] = [];
      for (const { device, part, scenes } of FRAMES) {
        await frame(page, part, device);
        await expect(header(page, "Cena").getByRole("option"), device).toHaveText(
          scenes.map((scene) => scene.name),
        );
        // Every scene in both themes and both languages.
        for (const theme of THEMES) {
          await header(page, "Tema").selectOption(theme);
          await expect(page.locator("html")).toHaveAttribute("data-al-theme", theme);
          for (const language of LANGUAGES) {
            await header(page, "Idioma").selectOption(language);
            await expect(product(page)).toHaveAttribute("lang", language);
            for (const scene of scenes) {
              await show(page, scene.id);
              for (const misfit of await overflow(page)) {
                misfits.push(`${device} ${theme} ${language} ${scene.id}: ${misfit}`);
              }
            }
          }
        }
        // Every state the control desk forces.
        for (const scene of scenes) {
          await header(page, "Cena").selectOption(scene.id);
          await expect(header(page, "Estado").getByRole("option")).toHaveCount(
            scene.states.length,
          );
          for (const state of scene.states) {
            await show(page, scene.id, state);
            for (const misfit of await overflow(page)) {
              misfits.push(`${device} ${scene.id}/${state}: ${misfit}`);
            }
          }
        }
      }
      expect(misfits).toEqual([]);
      expect(wrong).toEqual([]);
    });
  }
});

test("no text of the product is written outside the dictionary", async ({ page }) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  // The test language puts every text of the dictionary between marks. Whatever the
  // product shows, says to a screen reader or hints at must then be between them, or be
  // marked as data: a computer's name, a number, an address.
  await header(page, "Idioma").selectOption("x-test");
  const loose: string[] = [];
  for (const { device, part, scenes } of FRAMES) {
    await frame(page, part, device);
    for (const scene of scenes) {
      for (const state of scene.states) {
        await show(page, scene.id, state);
        const found = await page.evaluate(() => {
          const marked = /^⟦[^⟦⟧]*⟧$/;
          const says = /[\p{L}\p{N}]/u;
          const out: string[] = [];
          const frame = document.querySelector("[data-al-product]");
          if (!frame) {
            return ["no product"];
          }
          const walker = document.createTreeWalker(frame, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const element = node instanceof Element ? node : node.parentElement;
            if (!element || element.closest("[data-al-scenery], [data-al-data], svg, template")) {
              continue;
            }
            if (node instanceof Element) {
              for (const name of ["title", "aria-label", "placeholder", "alt"]) {
                const value = node.getAttribute(name);
                if (value !== null && !marked.test(value.trim())) {
                  out.push(`${name}="${value}"`);
                }
              }
            } else {
              const text = (node.textContent ?? "").trim();
              if (says.test(text) && !marked.test(text)) {
                out.push(text);
              }
            }
          }
          return out;
        });
        for (const text of found) {
          loose.push(`${device} ${scene.id}/${state}: ${text}`);
        }
      }
    }
  }
  expect(loose).toEqual([]);
  expect(wrong).toEqual([]);
});

test("what the page paints can be read: text and glyphs against what is really behind them", async ({
  page,
}) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  await header(page, "Idioma").selectOption("pt-BR");
  // The tokens are measured in pairs by tools/contrast.py. This measures what a browser
  // made of them: the colour each text and glyph ended up with, against the ground it
  // ended up on. Where that ground is glass, what lies behind is the remote screen, so
  // the ground is taken at both extremes, white and black, and the worse one counts.
  const faint: string[] = [];
  for (const { device, part, scenes } of FRAMES) {
    await frame(page, part, device);
    for (const theme of THEMES) {
      await header(page, "Tema").selectOption(theme);
      for (const scene of scenes) {
        for (const state of scene.states) {
          await show(page, scene.id, state);
          const found = await page.evaluate(() => {
            const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
            const frame = document.querySelector<HTMLElement>("[data-al-product]");
            if (!probe || !frame) {
              return ["nothing to measure with"];
            }
            const seen = new Map<string, number[]>();
            const rgba = (colour: string): number[] => {
              const known = seen.get(colour);
              if (known) {
                return known;
              }
              probe.clearRect(0, 0, 1, 1);
              probe.fillStyle = colour;
              probe.fillRect(0, 0, 1, 1);
              const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
              const value = [r, g, b, a / 255];
              seen.set(colour, value);
              return value;
            };
            const over = (top: number[], under: number[]) =>
              [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
            const light = (c: number[]) => {
              const [r, g, b] = c.slice(0, 3).map((v) => {
                const s = v / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
              });
              return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const ratio = (a: number[], b: number[]) => {
              const [hi, lo] = [light(a), light(b)].sort((x, y) => y - x);
              return (hi + 0.05) / (lo + 0.05);
            };
            // The grounds an element can be standing on. The nearest background, when it is
            // opaque, is the ground. When it is translucent it is glass, and what shows through
            // glass may not be an ancestor at all: it is the remote screen, or the lit grid. So
            // under the translucent layers the ground is taken at both extremes, and also at
            // the opaque ancestor when there is one: an ink between the two extremes can pass
            // both and still fail on what is really there.
            const grounds = (element: Element): number[][] => {
              const layers: number[][] = [];
              let beneath: number[] | null = null;
              for (let at: Element | null = element; at; at = at === frame ? null : at.parentElement) {
                const colour = rgba(getComputedStyle(at).backgroundColor);
                if (colour[3] === 1) {
                  if (layers.length === 0) {
                    return [colour];
                  }
                  beneath = colour;
                  break;
                }
                if (colour[3] > 0) {
                  layers.push(colour);
                }
              }
              if (layers.length === 0) {
                return [rgba(getComputedStyle(frame).backgroundColor)];
              }
              return [[255, 255, 255, 1], [0, 0, 0, 1], ...(beneath ? [beneath] : [])].map((floor) =>
                layers.reduceRight((under, top) => over(top, under), floor),
              );
            };
            const out: string[] = [];
            const judge = (element: Element, what: string, least: number, pseudo?: string) => {
              if (!element.checkVisibility() || element.closest("[disabled], [aria-disabled='true'], [data-al-scenery], .al-sr")) {
                return;
              }
              // An option that is off is off with its label. The reason written beside it is
              // not the control: it has to be read.
              if (element.closest("[data-off]") && !element.closest('[data-al-slot="note"]')) {
                return;
              }
              const ink = rgba(getComputedStyle(element, pseudo).color);
              const worst = Math.min(...grounds(element).map((ground) => ratio(over(ink, ground), ground)));
              if (worst < least) {
                out.push(`${what} at ${worst.toFixed(2)}:1, under ${least}:1`);
              }
            };
            const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const text = (node.textContent ?? "").trim();
              const element = node.parentElement;
              if (!element || !/[\p{L}\p{N}]/u.test(text) || element.closest("svg, template, option")) {
                continue;
              }
              const style = getComputedStyle(element);
              const size = Number.parseFloat(style.fontSize);
              const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
              judge(element, `"${text.slice(0, 40)}"`, large ? 3 : 4.5);
            }
            // What a field shows is text the page paints too, and it is in no text node: the
            // value typed, the words standing in for it, and the closed face of a list.
            for (const field of frame.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")) {
              if (field instanceof HTMLSelectElement) {
                judge(field, `the list "${(field.selectedOptions[0]?.textContent ?? "").slice(0, 40)}"`, 4.5);
              } else if (!["checkbox", "radio", "range", "hidden"].includes(field.type)) {
                if (field.value) {
                  judge(field, `the field "${field.type === "password" ? field.id : field.value.slice(0, 40)}"`, 4.5);
                } else if (field.placeholder) {
                  judge(field, `the placeholder "${field.placeholder.slice(0, 40)}"`, 4.5, "::placeholder");
                }
              }
            }
            for (const glyph of frame.querySelectorAll("svg.al-i")) {
              judge(glyph, `the glyph ${glyph.querySelector("use")?.getAttribute("href")}`, 3);
            }
            return [...new Set(out)];
          });
          for (const line of found) {
            faint.push(`${device} ${theme} ${scene.id}/${state}: ${line}`);
          }
        }
      }
    }
  }
  expect(faint).toEqual([]);
  expect(wrong).toEqual([]);
});

test("on a phone the session takes the whole screen, and the keyboard leaves picture above it", async ({
  page,
}) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  await header(page, "Idioma").selectOption("pt-BR");
  for (const device of ["phone", "phone-landscape"] as const) {
    await header(page, "Aparelho").selectOption(device);
    await show(page, "session", "bar-open");
    await expect(product(page)).toHaveAttribute("data-al-full", "yes");
    await expect(product(page).getByRole("toolbar", { name: "Barra da sessão" })).toBeVisible();

    await show(page, "panels", "keyboard");
    // With the keyboard up the session still has the whole screen, the bar goes, and every
    // row of a keyboard is there.
    await expect(product(page), `${device}: full screen with the keyboard up`).toHaveAttribute("data-al-full", "yes");
    await expect(product(page).getByRole("toolbar", { name: "Barra da sessão" })).toBeHidden();
    for (const key of ["q", "a", "s", "d", "f", "g", "z", "Space", "Enter"]) {
      await expect(product(page).getByRole("button", { name: key, exact: true })).toBeVisible();
    }
    // The remote picture ends where the keyboard begins, and is not a sliver.
    const room = await page.evaluate(() => {
      const frame = document.querySelector("[data-al-product]")?.getBoundingClientRect();
      const picture = document.querySelector("[data-al-remote]")?.getBoundingClientRect();
      const keys = document.querySelector(".al-kbd")?.getBoundingClientRect();
      if (!frame || !picture || !keys) {
        return null;
      }
      return { apart: Math.abs(picture.bottom - keys.top), share: picture.height / frame.height };
    });
    expect(room).not.toBeNull();
    // Neither under the keys nor short of them: no band of page between the two.
    expect(room?.apart).toBeLessThanOrEqual(1);
    expect(room?.share).toBeGreaterThanOrEqual(0.3);
  }
  // Turned on its side with the keyboard up, the picture still meets the keyboard.
  await header(page, "Aparelho").selectOption("phone");
  await show(page, "panels", "keyboard");
  for (const device of ["phone-landscape", "phone", "phone-landscape"] as const) {
    await header(page, "Aparelho").selectOption(device);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const picture = document.querySelector("[data-al-remote]")?.getBoundingClientRect();
          const keys = document.querySelector(".al-kbd")?.getBoundingClientRect();
          return picture && keys ? Math.abs(picture.bottom - keys.top) : -1;
        }),
      )
      .toBeLessThanOrEqual(1);
  }
  // With a pointer the session does not take the screen until asked.
  await header(page, "Aparelho").selectOption("desktop");
  await show(page, "session", "bar-open");
  await expect(product(page)).toHaveAttribute("data-al-full", "no");
  await product(page).getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect(product(page)).toHaveAttribute("data-al-full", "yes");
  expect(wrong).toEqual([]);
});

// The six sheets a session opens, and the scene and state that shows each. The keyboard is
// not one of them: it sits at the bottom by design, and has its own test.
const SHEETS = [
  ["Mais", "session", "more-open"],
  ["telas", "panels", "displays"],
  ["área de transferência", "panels", "clipboard-hidden"],
  ["preferências", "prefs", "from-session"],
  ["informações", "info", "session"],
  ["vazão", "throughput", "in-session"],
] as const;

test("what opens in a session is glass over the remote screen, hanging from the bar", async ({
  page,
}) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  await header(page, "Idioma").selectOption("pt-BR");
  // Where the open sheet is, against the frame and the bar, and what it is made of.
  const measure = () =>
    page.evaluate(() => {
      const frame = document.querySelector("[data-al-product]")?.getBoundingClientRect();
      const bar = document.querySelector("[data-al-bar]")?.getBoundingClientRect();
      const drop = [...document.querySelectorAll<HTMLElement>("section[data-al-scene]:not([hidden]) .al-drop")].find(
        (candidate) => candidate.checkVisibility(),
      );
      if (!frame || !bar || !drop) {
        return null;
      }
      const sheet = drop.getBoundingClientRect();
      const style = getComputedStyle(drop);
      const probe = document.createElement("canvas").getContext("2d");
      if (!probe) {
        return null;
      }
      probe.fillStyle = style.backgroundColor;
      probe.fillRect(0, 0, 1, 1);
      const barAtBottom = bar.top + bar.height / 2 > frame.top + frame.height / 2;
      return {
        off: Math.abs(sheet.left + sheet.width / 2 - (frame.left + frame.width / 2)),
        barAtBottom,
        // How far past the bar the sheet begins, on the side it hangs from. Negative is
        // under the bar.
        gap: barAtBottom ? bar.top - sheet.bottom : sheet.top - bar.bottom,
        alpha: probe.getImageData(0, 0, 1, 1).data[3] / 255,
        blurred: style.backdropFilter.includes("blur"),
      };
    });
  const amiss: string[] = [];
  for (const device of DEVICES) {
    await header(page, "Aparelho").selectOption(device);
    for (const [name, scene, state] of SHEETS) {
      await show(page, scene, state);
      const here = `${device}, ${name}`;
      await expect(page.locator("[data-al-remote]"), here).toBeVisible();
      await expect(product(page).getByRole("toolbar", { name: "Barra da sessão" }), here).toBeVisible();
      const sheet = await measure();
      if (!sheet) {
        amiss.push(`${here}: no sheet is open`);
        continue;
      }
      if (sheet.off > 1) {
        amiss.push(`${here}: ${sheet.off.toFixed(1)} px off the centre`);
      }
      // The bar is at the bottom on a phone held upright, and at the top everywhere else.
      if (sheet.barAtBottom !== (device === "phone")) {
        amiss.push(`${here}: the bar is at the ${sheet.barAtBottom ? "bottom" : "top"}`);
      }
      if (sheet.gap < 0 || sheet.gap > 16) {
        amiss.push(`${here}: begins ${sheet.gap.toFixed(1)} px past the bar, outside 0 to 16`);
      }
      if (!(sheet.alpha < 1) || !sheet.blurred) {
        amiss.push(`${here}: not glass (alpha ${sheet.alpha.toFixed(2)}, blurred ${sheet.blurred})`);
      }
    }
    // The six are named above. Whatever else hangs from the bar, in any scene and state, is
    // placed by the same rule: the notices under it are not sheets, and sit where sheets do.
    for (const scene of SCENES) {
      for (const state of scene.states) {
        await show(page, scene.id, state);
        const hung = await measure();
        if (hung && (hung.off > 1 || hung.gap < 0 || hung.gap > 16)) {
          amiss.push(
            `${device}, ${scene.id} ${state}: ${hung.off.toFixed(1)} px off the centre, begins ${hung.gap.toFixed(1)} px past the bar`,
          );
        }
      }
    }
    // With the bar closed, what is in use stays in sight on the handle.
    await show(page, "session", "closed-in-use");
    await expect(product(page).getByRole("button", { name: /Câmera e microfone em uso/ }), device).toBeVisible();
    await show(page, "session", "closed-error");
    await expect(product(page).getByRole("button", { name: /Há um problema/ }), device).toBeVisible();
  }
  expect(amiss).toEqual([]);

  // And by the product's own paths: from the menu to preferences and to information, and
  // from there to throughput, the session is never left.
  for (const device of ["desktop", "phone"] as const) {
    await header(page, "Aparelho").selectOption(device);
    for (const [open, scene] of [
      ["Preferências", "prefs"],
      ["Informações", "info"],
    ] as const) {
      await show(page, "session", "more-open");
      await product(page).getByRole("button", { name: open, exact: true }).click();
      await expect(product(page)).toHaveAttribute("data-al-scene", scene);
      await expect(page.locator("[data-al-remote]")).toBeVisible();
    }
    // Information opens on the tab last seen; the way to throughput is on the first one.
    await product(page).getByRole("tab", { name: "Esta sessão", exact: true }).click();
    await product(page).getByRole("button", { name: "Vazão", exact: true }).click();
    await expect(product(page)).toHaveAttribute("data-al-scene", "throughput");
    await expect(page.locator("[data-al-remote]")).toBeVisible();
  }
  expect(wrong).toEqual([]);
});

test("the tab's title carries what is on, in front of the name: camera, microphone, sound", async ({
  page,
}) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  await header(page, "Idioma").selectOption("pt-BR");
  const tab = page.locator("#rv-tab");
  // Before a session the title is the server's name alone.
  await show(page, "list", "ready");
  await expect(product(page)).toHaveAttribute("data-al-title", "Alumia");
  await expect(tab).toHaveText("Alumia");
  // In one, a mark for each of the three while it is on, and none for one that failed.
  for (const [state, title] of [
    ["bar-open", "🔊 Alumia"],
    ["camera-waiting", "🎥 🔊 Alumia"],
    ["camera-live", "🎥 🔊 Alumia"],
    ["camera-error", "🔊 Alumia"],
    ["mic-live", "🎤 🔊 Alumia"],
    ["mic-error", "🔊 Alumia"],
    ["closed-in-use", "🎥 🎤 🔊 Alumia"],
    ["sound-error", "Alumia"],
  ] as const) {
    await show(page, "session", state);
    await expect(product(page), state).toHaveAttribute("data-al-title", title);
    await expect(tab, state).toHaveText(title);
  }
  // Under whatever opens over the session, the title is still the session's.
  await show(page, "session", "camera-live");
  await show(page, "info", "session");
  await expect(tab).toHaveText("🎥 🔊 Alumia");
  // Silenced in this browser, the sound's mark goes, and comes back with the sound.
  await show(page, "session", "bar-open");
  const mute = product(page).getByRole("button", { name: "Silenciar", exact: true });
  await mute.click();
  await expect(tab).toHaveText("Alumia");
  await mute.click();
  await expect(tab).toHaveText("🔊 Alumia");
  // A computer that carries no sound has no mark for it.
  await page.getByRole("checkbox", { name: "som", exact: true }).uncheck();
  await expect(tab).toHaveText("Alumia");
  expect(wrong).toEqual([]);
});

test("the keyboard's window moves when dragged, and stays inside the frame", async ({ page }) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  await header(page, "Idioma").selectOption("pt-BR");
  const keyboard = product(page).getByRole("group", { name: "Teclado", exact: true });
  const grip = product(page).getByRole("button", { name: "Arraste para mover", exact: true });
  const box = async (part: typeof keyboard) => {
    const found = await part.boundingBox();
    if (!found) {
      throw new Error("not on show");
    }
    return found;
  };
  /** Press on the grip, carry it by this much, and let go. */
  const drag = async (dx: number, dy: number) => {
    const from = await box(grip);
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    await page.mouse.up();
  };
  for (const device of ["desktop", "tablet"] as const) {
    await header(page, "Aparelho").selectOption(device);
    await show(page, "panels", "keyboard");
    const frame = await box(product(page));
    const start = await box(keyboard);
    await drag(-90, -70);
    const moved = await box(keyboard);
    expect(Math.abs(moved.x - (start.x - 90)), `${device}: carried sideways`).toBeLessThanOrEqual(2);
    expect(Math.abs(moved.y - (start.y - 70)), `${device}: carried upwards`).toBeLessThanOrEqual(2);
    // Carried far past each corner, it stops at the frame's edge.
    for (const [dx, dy] of [
      [-3000, -3000],
      [3000, 3000],
    ] as const) {
      await drag(dx, dy);
      const held = await box(keyboard);
      expect(held.x, `${device}: left edge`).toBeGreaterThanOrEqual(frame.x - 1);
      expect(held.y, `${device}: top edge`).toBeGreaterThanOrEqual(frame.y - 1);
      expect(held.x + held.width, `${device}: right edge`).toBeLessThanOrEqual(frame.x + frame.width + 1);
      expect(held.y + held.height, `${device}: bottom edge`).toBeLessThanOrEqual(frame.y + frame.height + 1);
    }
    // The arrow keys carry it too, for a hand that does not drag.
    const before = await box(keyboard);
    await grip.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");
    const after = await box(keyboard);
    expect(after.x, `${device}: the left arrow`).toBeLessThan(before.x);
    expect(after.y, `${device}: the up arrow`).toBeLessThan(before.y);
    // Closed and opened again, it is back where it opens.
    await show(page, "session", "bar-open");
    await show(page, "panels", "keyboard");
    const again = await box(keyboard);
    expect(Math.abs(again.x - start.x), `${device}: opens where it opens`).toBeLessThanOrEqual(1);
    expect(Math.abs(again.y - start.y), `${device}: opens where it opens`).toBeLessThanOrEqual(1);
  }
  // On a phone the keyboard is fixed to the bottom: there is nothing to drag.
  for (const device of ["phone", "phone-landscape"] as const) {
    await header(page, "Aparelho").selectOption(device);
    await show(page, "panels", "keyboard");
    await expect(grip, device).toHaveCount(0);
  }
  expect(wrong).toEqual([]);
});

test("with a pointer the keyboard shows the keys in use, and Fn brings the function and navigation keys", async ({
  page,
}) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  await header(page, "Idioma").selectOption("pt-BR");
  const keyboard = product(page).getByRole("group", { name: "Teclado", exact: true });
  const key = (name: string) => keyboard.getByRole("button", { name, exact: true });
  const fn = key("Teclas de função e de navegação");
  for (const device of ["desktop", "tablet"] as const) {
    await header(page, "Aparelho").selectOption(device);
    await show(page, "panels", "keyboard");
    // It opens with what is typed: letters, digits, the modifiers, Esc and the arrows.
    await expect(fn, device).toHaveAttribute("aria-pressed", "false");
    for (const name of ["Esc", "a", "1", "Tab", "Enter", "▲", "◀"]) {
      await expect(key(name), `${device}: ${name}`).toBeVisible();
    }
    for (const name of ["F1", "F12", "Home", "PgDn"]) {
      await expect(key(name), `${device}: ${name} before Fn`).toHaveCount(0);
    }
    // Caps Lock is where a keyboard has it, and the letters are drawn as they will be typed.
    const capsLock = key("Fixar maiúsculas");
    await expect(capsLock, device).toHaveAttribute("aria-pressed", "false");
    await capsLock.click();
    await expect(capsLock, device).toHaveAttribute("aria-pressed", "true");
    await expect(key("A"), `${device}: capitals with Caps Lock on`).toBeVisible();
    await capsLock.click();
    await expect(key("a"), `${device}: small letters with it off`).toBeVisible();
    // Fn brings the rest, above: no key that was there moves sideways.
    const before = await key("a").boundingBox();
    await fn.click();
    await expect(fn, device).toHaveAttribute("aria-pressed", "true");
    for (const name of ["F1", "F12", "Ins", "Del", "Home", "End", "PgUp", "PgDn"]) {
      await expect(key(name), `${device}: ${name} with Fn`).toBeVisible();
    }
    const after = await key("a").boundingBox();
    expect(Math.abs((after?.x ?? 0) - (before?.x ?? -9)), `${device}: the letters stay where they were`).toBeLessThanOrEqual(1);
    // It stays as it was left: closed and opened again, the function keys are still there.
    await show(page, "session", "bar-open");
    await show(page, "panels", "keyboard");
    await expect(key("F1"), `${device}: left on`).toBeVisible();
    await fn.click();
    await expect(key("F1"), `${device}: turned off`).toHaveCount(0);
  }
  // A phone has no Fn: its function keys are a row of their own.
  await header(page, "Aparelho").selectOption("phone");
  await show(page, "panels", "keyboard");
  await expect(fn).toHaveCount(0);
  await expect(key("F1")).toBeVisible();
  expect(wrong).toEqual([]);
});

test("the meter's period is the product's: fourteen ready, a length back from now, between two times", async ({
  page,
}) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  await header(page, "Idioma").selectOption("pt-BR");
  const period = product(page).getByRole("combobox", { name: "Período", exact: true });
  const amount = product(page).getByRole("spinbutton", { name: "Duração", exact: true });
  const unit = product(page).getByRole("combobox", { name: "Unidade", exact: true });
  const from = product(page).getByLabel("De", { exact: true });
  const to = product(page).getByLabel("Até", { exact: true });
  const apply = product(page).getByRole("button", { name: "Aplicar", exact: true });
  const axis = (end: string) => product(page).locator(`[data-al-axis="${end}"]`);
  for (const [device, state] of [
    ["desktop", "live"],
    ["desktop", "in-session"],
    ["phone", "live"],
    ["phone-landscape", "in-session"],
  ] as const) {
    const here = `${device}, ${state}`;
    await header(page, "Aparelho").selectOption(device);
    await show(page, "throughput", state);
    await expect(period.getByRole("option"), here).toHaveText([
      "Últimos 60 segundos",
      "Últimos 5 minutos",
      "Últimos 15 minutos",
      "Últimos 30 minutos",
      "Última hora",
      "Últimas 3 horas",
      "Últimas 6 horas",
      "Últimas 12 horas",
      "Últimas 24 horas",
      "Últimos 3 dias",
      "Últimos 7 dias",
      "Últimos 14 dias",
      "Últimos 30 dias",
      "Tudo o que foi guardado",
      "Personalizado…",
      "Entre…",
    ]);
    // A ready period: the time axis is that period's, and no field is open.
    await period.selectOption({ label: "Últimas 3 horas" });
    await expect(axis("start"), here).toHaveText("há 3 h");
    await expect(axis("mid"), here).toHaveText("há 1,5 h");
    await expect(axis("end"), here).toHaveText("agora");
    await expect(apply, here).toHaveCount(0);
    // A length back from now: an amount, a unit, and it is read on Apply, not as typed.
    await period.selectOption({ label: "Personalizado…" });
    await expect(amount, here).toBeVisible();
    await expect(from, here).toBeHidden();
    await amount.fill("90");
    await unit.selectOption({ label: "minutos" });
    await expect(axis("start"), here).toHaveText("há 3 h");
    await apply.click();
    await expect(axis("start"), here).toHaveText("há 1,5 h");
    await expect(apply, `${here}: nothing new to apply`).toBeDisabled();
    await amount.fill("0");
    await expect(apply, `${here}: not a whole number of at least one`).toBeDisabled();
    // Between two times: both ends typed, and an end before its start is not applied.
    await period.selectOption({ label: "Entre…" });
    await expect(from, here).toBeVisible();
    await expect(amount, here).toBeHidden();
    await from.fill("2026-10-03T08:00");
    await to.fill("2026-10-03T09:30");
    await apply.click();
    await expect(axis("start"), here).toHaveText("08:00");
    await expect(axis("end"), here).toHaveText("09:30");
    await to.fill("2026-10-03T07:00");
    await expect(apply, `${here}: ends before it starts`).toBeDisabled();
    // None of it leaves where the meter was opened: a page stays a page, and in a session
    // the remote screen is still behind the glass.
    await expect(product(page), here).toHaveAttribute("data-al-scene", "throughput");
    if (state === "in-session") {
      await expect(page.locator("[data-al-remote]"), here).toBeVisible();
      await expect(header(page, "Estado"), here).toHaveValue("in-session");
    } else {
      await expect(page.locator("[data-al-remote]"), here).toBeHidden();
    }
    await period.selectOption({ label: "Últimos 60 segundos" });
    await expect(axis("start"), here).toHaveText("há 1 min");
  }
  // The two states the desk forces open the fields they are named for.
  await show(page, "throughput", "custom");
  await expect(amount).toBeVisible();
  await show(page, "throughput", "between");
  await expect(from).toBeVisible();
  expect(wrong).toEqual([]);
});

test("the app of Mac: the glass lights a bar at a time, the menu bar says the state, the title is the pane's", async ({
  page,
}) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  await header(page, "Idioma").selectOption("pt-BR");
  const button = (name: string | RegExp) => product(page).getByRole("button", { name, exact: true });
  for (const profile of PROFILES) {
    await frame(page, "mac", profile);
    await expect(product(page), profile).toHaveAttribute(
      "data-al-profile",
      profile === "mac-glass" ? "glass" : "plain",
    );

    // The first run, by its own buttons. Each bar of the glass is lit as far as its part is
    // ready: this Mac in three steps, the way in in one, the page's password in one.
    await show(page, "mac-first", "welcome");
    const assistant = product(page).getByRole("group", { name: "Primeiros passos do Alumia" });
    const glass = product(page).locator("[data-al-lightpane]");
    const lit = () =>
      glass.evaluate((pane) =>
        ["--am-r", "--am-g", "--am-b"]
          .map((name) => Number(getComputedStyle(pane).getPropertyValue(name)).toFixed(2))
          .join(" "),
      );
    const next = button("Continuar");
    expect(await lit(), `${profile}: welcome`).toBe("0.00 0.00 0.00");
    await next.click();
    await expect(product(page).getByText("Passo 1 de 5", { exact: true }), profile).toBeVisible();
    expect(await lit(), `${profile}: keep`).toBe("0.33 0.00 0.00");
    await next.click();
    await expect(header(page, "Estado"), profile).toHaveValue("sharing");
    // Screen Sharing is the person's to turn on: until it is on, there is no going on.
    await expect(next, `${profile}: before Screen Sharing is on`).toBeDisabled();
    await expect(assistant.getByText("desligado", { exact: true }), profile).toBeVisible();
    await button("Abrir os Ajustes do Sistema").click();
    await expect(assistant.getByText("ligado", { exact: true }), profile).toBeVisible();
    await expect(next, `${profile}: with Screen Sharing on`).toBeEnabled();
    await next.click();
    await expect(header(page, "Estado"), profile).toHaveValue("account");
    expect(await lit(), `${profile}: account`).toBe("1.00 0.00 0.00");
    await next.click();
    expect(await lit(), `${profile}: ways`).toBe("1.00 1.00 0.00");
    await expect(product(page).getByText("tailscale serve --bg 52380", { exact: true }), profile).toBeVisible();
    // Tailscale is installed apart, so the way in says the state it is in on this Mac, with
    // the one thing to do. None of them holds the first run back: this Mac alone is a way in.
    const tailscale = assistant.getByRole("status");
    for (const [state, says, act] of [
      ["ways-missing", "não instalado", "Baixar o Tailscale"],
      ["ways-signed-out", "desconectado", "Abrir o Tailscale"],
      ["ways-no-https", "sem certificado", "Abrir o painel do Tailscale"],
      ["ways", "pronto para publicar", "Publicar"],
      ["ways-published", "publicado", "Copiar"],
    ] as const) {
      await show(page, "mac-first", state);
      await expect(tailscale.getByText(says, { exact: true }), `${profile}, ${state}`).toBeVisible();
      await expect(tailscale.getByRole("button"), `${profile}, ${state}`).toHaveText([act]);
      await expect(next, `${profile}, ${state}`).toBeEnabled();
      expect(await lit(), `${profile}, ${state}`).toBe("1.00 1.00 0.00");
    }
    // Publishing is asked for, and then the address is there.
    await show(page, "mac-first", "ways");
    await button("Publicar").click();
    await expect(header(page, "Estado"), profile).toHaveValue("ways-published");
    await expect(tailscale.getByText("https://mac-mini.example", { exact: true }), profile).toBeVisible();
    await next.click();
    expect(await lit(), `${profile}: password`).toBe("1.00 1.00 1.00");
    await expect(glass, `${profile}: not lit before the end`).toHaveAttribute("data-al-lit", "no");
    await next.click();
    await expect(glass, `${profile}: lit at the end`).toHaveAttribute("data-al-lit", "yes");
    await button("Voltar").click();
    await expect(header(page, "Estado"), profile).toHaveValue("password");

    // The menu bar's item says the state, to the eye and to a screen reader, and its menu
    // is a menu.
    for (const [state, name, line] of [
      ["idle", "Alumia: pronto", "Pronto. Ninguém conectado."],
      ["serving", "Alumia: sessão aberta", "Um navegador está com a sessão aberta."],
      ["needs-action", "Alumia: precisa de você", "O Compartilhamento de Tela está desligado."],
    ] as const) {
      await show(page, "mac-menu", state);
      await expect(button(name), `${profile}, ${state}`).toHaveAttribute("aria-expanded", "true");
      await expect(product(page).locator(`[data-al-icon="${state}"]`), `${profile}, ${state}`).toBeVisible();
      await expect(product(page).getByRole("menu", { name: "Menu do Alumia" }), `${profile}, ${state}`).toContainText(line);
    }
    const end = product(page).getByRole("menuitem", { name: "Encerrar a sessão", exact: true });
    await show(page, "mac-menu", "idle");
    await expect(end, `${profile}: no session to end`).toHaveCount(0);
    await show(page, "mac-menu", "serving");
    await expect(end, profile).toBeVisible();

    // Settings open from the menu, and the window's title is the pane's.
    await product(page).getByRole("menuitem", { name: /^Ajustes…/ }).click();
    await expect(product(page), profile).toHaveAttribute("data-al-scene", "mac-settings");
    for (const pane of ["Computadores", "Acesso", "Avançado", "Sobre", "Geral"]) {
      const tab = product(page).getByRole("tab", { name: pane, exact: true });
      await tab.click();
      await expect(tab, `${profile}, ${pane}`).toHaveAttribute("aria-selected", "true");
      await expect(product(page).locator("#am-settings-title"), `${profile}, ${pane}`).toHaveText(pane);
    }
    // Windows and Linux are among the computers, as they are on the page.
    await show(page, "mac-settings", "computers");
    for (const computer of ["Mac mini", "PC do trabalho", "Estação Linux"]) {
      await expect(product(page).getByRole("tabpanel").getByText(computer, { exact: true }), `${profile}, ${computer}`).toBeVisible();
    }

    // A notice is one strip with one thing to do, and the menu bar's item says so too.
    for (const [state, act] of [
      ["sharing-off", "Abrir os Ajustes do Sistema"],
      ["needs-approval", "Abrir Itens de Início"],
      ["not-in-applications", "Mover para Aplicativos"],
      ["service-stopped", "Iniciar de novo"],
    ] as const) {
      await show(page, "mac-notices", state);
      const strip = product(page)
        .getByRole("status")
        .filter({ has: page.getByRole("button", { name: act, exact: true }) });
      await expect(strip, `${profile}, ${state}`).toBeVisible();
      await expect(strip.getByRole("button"), `${profile}, ${state}`).toHaveCount(1);
      await expect(button("Alumia: precisa de você"), `${profile}, ${state}`).toBeVisible();
    }

    // Removing: Uninstall says what it deletes, and Cancel leaves everything as it was.
    await show(page, "mac-settings", "about");
    await button("Desinstalar…").click();
    const alert = product(page).getByRole("alertdialog", { name: "Desinstalar o Alumia?" });
    await expect(alert.getByRole("listitem"), profile).toHaveCount(4);
    await alert.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(product(page), profile).toHaveAttribute("data-al-scene", "mac-settings");
    await expect(header(page, "Estado"), profile).toHaveValue("about");
    // The Trash alone deletes none of it, and the app says so where the app is removed.
    await show(page, "mac-remove", "trash");
    await expect(product(page).getByRole("alertdialog"), profile).toHaveCount(0);
    await expect(product(page).getByText("Arrastar o app para o Lixo não apaga nada disso."), profile).toBeVisible();
  }

  // "Open in the browser" is the way to the other part: the page, on a browser's device.
  // Coming back, the app is where it was left, in the look it was left in.
  await show(page, "mac-menu", "idle");
  await product(page).getByRole("menuitem", { name: "Abrir no navegador", exact: true }).click();
  await expect(product(page)).toHaveAttribute("data-al-scene", "signin");
  await expect(product(page)).toHaveAttribute("data-al-device", "desktop");
  await expect(header(page, "Parte")).toHaveValue("browser");
  await header(page, "Parte").selectOption("mac");
  await expect(product(page)).toHaveAttribute("data-al-scene", "mac-menu");
  await expect(header(page, "Aparelho")).toHaveValue("mac-plain");
  expect(wrong).toEqual([]);
});

test("the layout is the same in both languages: nothing moves to another line with the words", async ({
  page,
}) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  // How a scene is arranged, apart from what it says: in every container whose children can
  // wrap, which child sits on which line; and how tall each control and title is, which is
  // how many lines its words took. A text that fits beside a button in one language and
  // falls under it in the other shows up here as a different arrangement.
  const arrangement = () =>
    page.evaluate(() => {
      const frame = document.querySelector<HTMLElement>("[data-al-product]");
      if (!frame) {
        return ["no product"];
      }
      const out: string[] = [];
      const seen = (element: Element) =>
        element.checkVisibility() && !element.closest("[data-al-scenery], svg, template");
      let count = 0;
      for (const box of frame.querySelectorAll<HTMLElement>("*")) {
        if (!seen(box)) {
          continue;
        }
        const style = getComputedStyle(box);
        const wraps =
          (style.display.includes("flex") && style.flexWrap !== "nowrap") || style.display.includes("grid");
        if (wraps && box.children.length > 1) {
          // A child starts a new line when it begins below where the line so far ends.
          // Tops alone would not do: on one line, centred, a short child starts lower
          // than a tall one.
          let line = 0;
          let ends = Number.NEGATIVE_INFINITY;
          const lines = [...box.children].filter(seen).map((child) => {
            const at = child.getBoundingClientRect();
            if (at.height === 0) {
              return "-";
            }
            if (at.top >= ends - 1 && ends !== Number.NEGATIVE_INFINITY) {
              line += 1;
              ends = at.bottom;
            } else {
              ends = Math.max(ends, at.bottom);
            }
            return String(line % 36);
          });
          out.push(`${count} ${box.className.split(" ")[0] || box.tagName}: ${lines.join("")}`);
        }
        count += 1;
      }
      let control = 0;
      // What is one line by design: a button, a tab, a tag, a menu's item, a title. A card
      // or an option that holds running text grows downward with its words, and is not here.
      for (const part of frame.querySelectorAll<HTMLElement>(".al-btn, .al-tab, .al-tag, .al-chip, .al-handle, .al-eye, .al-seg button, .al-moreitem, .al-key, summary, h1, h2, .am-btn, .am-pane, .am-menuitem, .am-chip, .am-state, .am-eye")) {
        if (seen(part) && !part.closest("[data-al-data]")) {
          out.push(`${control} ${part.tagName} ${part.className.split(" ")[0]}: ${Math.round(part.getBoundingClientRect().height)} high`);
        }
        control += 1;
      }
      return out;
    });
  const moved: string[] = [];
  for (const { device, part, scenes } of FRAMES) {
    await frame(page, part, device);
    for (const scene of scenes) {
      for (const state of scene.states) {
        await header(page, "Idioma").selectOption("pt-BR");
        await show(page, scene.id, state);
        const one = await arrangement();
        await header(page, "Idioma").selectOption("en-US");
        const other = await arrangement();
        // And in a language a third longer than any written yet. A title is allowed its
        // own number of lines there; where things sit, and a control's height, are not.
        await header(page, "Idioma").selectOption("x-wide");
        const longer = await arrangement();
        const length = Math.max(one.length, other.length, longer.length);
        for (let i = 0; i < length; i += 1) {
          if (one[i] !== other[i]) {
            moved.push(`${device} ${scene.id}/${state}: pt-BR ${one[i]} | en-US ${other[i]}`);
          }
          if (one[i] !== longer[i] && !/^\d+ H[12] /.test(one[i] ?? "")) {
            moved.push(`${device} ${scene.id}/${state}: pt-BR ${one[i]} | longer ${longer[i]}`);
          }
        }
      }
    }
  }
  expect(moved).toEqual([]);
  expect(wrong).toEqual([]);
});

test("the eye shows the password, says so, and the password hides again when sent", async ({
  page,
}) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  await header(page, "Idioma").selectOption("pt-BR");
  await show(page, "signin", "form");

  // The page's own form: the app of Mac asks for a user and a password too.
  const form = product(page).locator('[data-al-scene="signin"]');
  const user = form.getByLabel("Usuário", { exact: true });
  const password = form.getByLabel("Senha", { exact: true });
  await user.fill("ale");
  await password.fill("uma senha qualquer");
  await expect(password).toHaveAttribute("type", "password");

  const eye = page.getByRole("button", { name: "Mostrar a senha", exact: true });
  await eye.click();
  await expect(password).toHaveAttribute("type", "text");
  const hide = page.getByRole("button", { name: "Ocultar a senha", exact: true });
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  await expect(product(page).getByRole("status").filter({ hasText: "A senha está visível." })).toHaveCount(1);

  // The order a keyboard walks the form in.
  await user.focus();
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(hide).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox", { name: "Manter conectado neste navegador" })).toBeFocused();
  await page.keyboard.press("Tab");
  const submit = page.getByRole("button", { name: "Entrar", exact: true });
  await expect(submit).toBeFocused();

  await submit.click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Mostrar a senha", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByRole("heading", { name: "Seus computadores" })).toBeVisible();
  expect(wrong).toEqual([]);
});

test("a control the computer does not offer is absent", async ({ page }) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  await header(page, "Idioma").selectOption("pt-BR");
  await show(page, "session", "more-open");
  const camera = product(page).getByRole("button", { name: /^Câmera/ });
  await expect(camera).toBeVisible();
  await page.getByRole("checkbox", { name: "câmera", exact: true }).uncheck();
  await expect(camera).toHaveCount(0);
  // No computer offers touch as a touchscreen today, so it is off until the desk turns it on.
  await expect(product(page).getByRole("button", { name: /^Toque como tela de toque/ })).toHaveCount(0);

  await show(page, "list", "ready");
  const throughput = product(page).getByRole("button", { name: "Vazão", exact: true });
  await expect(throughput).toBeVisible();
  await page.getByRole("checkbox", { name: "medidor de vazão", exact: true }).uncheck();
  await expect(throughput).toHaveCount(0);
  expect(wrong).toEqual([]);
});

test("the screen lights with the clock running, and opening a computer reaches the session", async ({
  page,
}) => {
  const wrong = watch(page);
  await page.goto(MOCKUP);
  await header(page, "Idioma").selectOption("pt-BR");
  // Which of the two this machine's browser is: the shaders, or the still in their place.
  const webgl = await product(page).getAttribute("data-al-webgl");
  test.info().annotations.push({ type: "webgl2", description: String(webgl) });
  console.log(`WebGL2 in this browser: ${webgl}`);

  await show(page, "ignite", "connecting");
  await expect(product(page)).toHaveAttribute("data-al-clock", "running");
  await header(page, "Movimento").selectOption("reduce");
  await expect(product(page)).toHaveAttribute("data-al-clock", "stopped");
  await header(page, "Movimento").selectOption("system");

  await show(page, "list", "ready");
  await product(page).getByRole("button", { name: "Abrir", exact: true }).first().click();
  await expect(product(page)).toHaveAttribute("data-al-scene", "ignite");
  await expect(product(page)).toHaveAttribute("data-al-scene", "session", { timeout: 10_000 });
  await product(page).getByRole("button", { name: "Abrir a barra da sessão" }).click();
  await product(page).getByRole("button", { name: "Encerrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Seus computadores" })).toBeVisible();
  await expect(product(page)).toHaveAttribute("data-al-clock", "stopped");
  expect(wrong).toEqual([]);
});

test.describe("with reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("nothing moves: no frame asked for, no repeating timer, no animation, the clock stopped", async ({
    page,
  }) => {
    const wrong = watch(page);
    // Counted from before the page's first script: what asks for a frame, what repeats.
    await page.addInitScript(() => {
      const asked = { frames: 0, repeating: 0 };
      Object.assign(window, { __asked: asked });
      const frame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        asked.frames += 1;
        return frame(callback);
      };
      const repeat = window.setInterval.bind(window);
      window.setInterval = ((...given: Parameters<typeof setInterval>) => {
        asked.repeating += 1;
        return repeat(...given);
      }) as typeof setInterval;
    });
    await page.goto(MOCKUP);
    await header(page, "Idioma").selectOption("pt-BR");

    const moving: string[] = [];
    for (const [part, scene] of [
      ...SCENES.map((scene) => ["browser", scene] as const),
      ...MAC_SCENES.map((scene) => ["mac", scene] as const),
    ]) {
      await header(page, "Parte").selectOption(part);
      for (const state of scene.states) {
        await show(page, scene.id, state);
        await expect(product(page)).toHaveAttribute("data-al-clock", "stopped");
        const running = await page.evaluate(() => document.getAnimations().length);
        if (running > 0) {
          moving.push(`${scene.id}/${state}: ${running} animations`);
        }
      }
    }
    // And through the real path, back in the page: open a computer, reach the session, end it.
    await header(page, "Parte").selectOption("browser");
    await show(page, "list", "ready");
    await product(page).getByRole("button", { name: "Abrir", exact: true }).first().click();
    await expect(product(page)).toHaveAttribute("data-al-scene", "session", { timeout: 10_000 });
    await product(page).getByRole("button", { name: "Abrir a barra da sessão" }).click();
    await product(page).getByRole("button", { name: "Encerrar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Seus computadores" })).toBeVisible();
    await expect(product(page)).toHaveAttribute("data-al-clock", "stopped");

    expect(moving).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __asked: object }).__asked)).toEqual({
      frames: 0,
      repeating: 0,
    });
    expect(wrong).toEqual([]);
  });
});
