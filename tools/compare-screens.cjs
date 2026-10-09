// The photographs tools/compare-screens.sh takes, and the page that shows them.
//
// Each pair is one scene of the mockup in one state, on one device, in one theme and one
// language, and the same thing in the product: reached the way a person reaches it, with
// what only a real remote sends said in its place on the session socket. The pairs vary
// device, theme and language between them rather than multiplying every scene by all
// three. Both sides are taken with motion reduced, so the glass is at its end state.
//
// The list of computers is compared with its own design
// (docs/mockups/2026-10-04-1245-lista-monitores.html), which is the one in force for it:
// the product is given the computers that design draws.
//
//   NODE_PATH=tests/playwright/node_modules node tools/compare-screens.cjs <harness url> [pair ...]
//   node tools/compare-screens.cjs - --page      the page again, from the photographs there are
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const REPO = path.resolve(__dirname, "..");
const OUT = path.join(REPO, "docs/comparisons/2026-10-03-navegador");
const MOCKUP = `file://${path.join(REPO, "docs/mockups/2026-10-03-0233-prancha-alumia.html")}`;
const LIST = `file://${path.join(REPO, "docs/mockups/2026-10-04-1245-lista-monitores.html")}`;
const WORDS = {
  "pt-BR": require(path.join(REPO, "frontend/src/words/pt-BR.json")),
  "en-US": require(path.join(REPO, "frontend/src/words/en-US.json")),
};
const DEVICES = {
  desktop: { width: 1440, height: 900, touch: false, says: "Computador" },
  tablet: { width: 820, height: 1180, touch: true, says: "Tablet" },
  phone: { width: 390, height: 844, touch: true, says: "Celular em pé" },
  "phone-landscape": { width: 860, height: 412, touch: true, says: "Celular deitado" },
};
const THEMES = { light: "claro", dark: "escuro" };
const TARGET = "test-tone";
const UP = { timeout: 20_000 };

// What a Mac with two screens and a virtual one lists, in the gateway's own words.
const DISPLAYS = [
  { id: 0, label: "All Displays", detail: "3200×1000 at 2x", main: false, virtual: false },
  { id: 1, label: "Display 1", detail: "1600×1000 at 2x", main: true, virtual: false },
  { id: 2, label: "Display 2", detail: "1600×1000 at 2x", main: false, virtual: false },
];

// The computers the list's design draws, as the gateway would list them: two Macs in both
// of their modes, a Windows host with a size configured, a wlshare desktop and a plain
// server. And what that design shows chosen: the second Mac mirrored, the Linux sound brought.
const entry = (name, host, offers) => ({
  name, host, protocol: "vnc", subtype: null, port: 5900, resize: false, size: null,
  defaultSize: { w: 1440, h: 900 }, audio: false, passthrough: null, passthroughOnly: false, computer: null, ...offers,
});
const VIRTUAL = { subtype: "ard-high-performance", resize: true, passthrough: "apple-media" };
const MIRROR = { subtype: "ard-mirror", resize: true, defaultSize: null, passthrough: "apple-media" };
const LISTED = [
  entry("MacBook Pro virtual", "192.0.2.20", VIRTUAL),
  entry("MacBook Pro espelhado", "192.0.2.20", MIRROR),
  entry("Mac mini virtual", "192.0.2.21", { ...VIRTUAL, size: { w: 1920, h: 1080 } }),
  entry("Mac mini espelhado", "192.0.2.21", MIRROR),
  entry("PC do trabalho", "192.0.2.22", { protocol: "rdp", resize: true, size: { w: 1920, h: 1080 }, audio: true, passthrough: "rdp-graphics" }),
  entry("Estação Linux", "192.0.2.23", { subtype: "wlshare", resize: true, audio: true }),
  entry("Raspberry Pi", "192.0.2.24", {}),
];
async function listed(page) {
  await page.addInitScript(() => {
    localStorage.setItem("alumia.rowModes", JSON.stringify({ "Mac mini virtual": "mirror" }));
    localStorage.setItem("alumia.targetChoices", JSON.stringify({ "Estação Linux": { audio: "opus" } }));
  });
  await page.route("**/api/targets", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: LISTED });
  });
}

// The list's design, at a device, a theme and a language, as a page of its own.
const FRAMES = { desktop: "Computador", tablet: "Tablet", phone: "Celular" };
async function designed(page, device, theme, language) {
  await page.goto(LIST);
  await page.getByRole("button", { name: FRAMES[device] }).click();
  await page.evaluate(
    ([chosenTheme, english]) => {
      document.getElementById("study").dataset.alTheme = chosenTheme;
      // The design's own two globals: its language, and the function that draws it.
      lang = english ? 1 : 0;
      draw();
    },
    [theme, language === "en-US"],
  );
  await page.evaluate(() => document.fonts.ready);
}

// Stand in front of the gateway on the page's session socket: say a message in its
// place, or keep one of the page's from it.
async function stage(page) {
  const kept = new Set();
  const sent = [];
  let toPage = () => {};
  await page.routeWebSocket(/\/ws\?/, (socket) => {
    const gateway = socket.connectToServer();
    toPage = (text) => socket.send(text);
    socket.onMessage((message) => {
      if (typeof message === "string") {
        const type = JSON.parse(message).type;
        sent.push(type);
        if (kept.has(type)) return;
      }
      gateway.send(message);
    });
    gateway.onMessage((message) => socket.send(message));
  });
  return {
    sent,
    say: (message) => toPage(JSON.stringify(message)),
    keep: (type) => kept.add(type),
  };
}

// The gateway's meter, which the harness does not keep.
async function meter(page) {
  const now = () => Math.floor(Date.now() / 1000);
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), throughput: true } });
  });
  // A rate that moves, by a rule and not by chance, so that two rounds draw the same.
  let read = 0;
  await page.route("**/api/throughput/live", (route) => {
    read += 1;
    const swell = 1 + 0.5 * Math.sin(read / 5) + 0.25 * Math.sin(read / 1.7);
    return route.fulfill({
      json: {
        at: now() + read,
        rates: [
          { target: TARGET, socket: "session", sentPerSec: Math.round(2_400_000 * swell), receivedPerSec: Math.round(26_000 * swell) },
          { target: TARGET, socket: "audio", sentPerSec: 16_000, receivedPerSec: 0 },
        ],
      },
    });
  });
  await page.route(/\/api\/throughput(\?.*)?$/, (route) =>
    route.fulfill({
      json: { now: now(), intervalSecs: 60, maxRecords: 1000, hasSeconds: false, records: [], open: [] },
    }),
  );
}

async function signIn(page, url, t) {
  await page.goto(url);
  await page.getByLabel(t["signin.user"]).fill("admin");
  await page.getByLabel(t["signin.password"], { exact: true }).fill("hunter2");
  await page.getByRole("button", { name: t["signin.submit"], exact: true }).click();
}

// Sign in and land on the list, taking over a session an earlier pair left holding.
async function toList(page, url, t) {
  await signIn(page, url, t);
  const over = page.getByRole("button", { name: t["common.takeover"] });
  const list = page.getByRole("list");
  await over.or(list).first().waitFor(UP);
  if (await over.isVisible()) {
    await over.click();
    await page.getByRole("dialog").getByRole("button", { name: t["common.takeover"] }).click();
  }
  await list.waitFor(UP);
}

const openButton = (page) =>
  page.getByRole("listitem").getByRole("button", { name: /^(Open|Abrir) / });
const handle = (page, t) => page.getByRole("button", { name: new RegExp(`^${t["session.handle"]}`) });
const item = (page, t, key) => page.getByRole("button", { name: t[key], exact: true });

async function toSession(page, url, t) {
  await toList(page, url, t);
  await openButton(page).click();
  await handle(page, t).waitFor(UP);
}

async function toBar(page, url, t) {
  await toSession(page, url, t);
  await handle(page, t).click();
}

async function toMore(page, url, t) {
  await toBar(page, url, t);
  await item(page, t, "session.more").click();
}

// The pairs: the mockup's scene and state, the device, theme and language, and how the
// product gets there. `url` is the harness; `insecure` the same harness by a name the
// browser does not treat as secure.
const PAIRS = [
  ["start-insecure", "Não dá para começar: endereço não seguro", "start", "insecure", "desktop", "light", "pt-BR",
    async ({ page, insecure }) => { await page.goto(insecure); await page.getByRole("heading", { level: 1 }).waitFor(); }],
  ["start-no-decoder", "Não dá para começar: navegador sem decodificador", "start", "no-decoder", "phone", "dark", "en-US",
    async ({ page, url }) => {
      await page.addInitScript(() => Object.defineProperty(globalThis, "VideoDecoder", { value: undefined }));
      await page.goto(url);
      await page.getByRole("heading", { level: 1 }).waitFor();
    }],
  ["list-desktop", "Seus computadores, no computador", "list", null, "desktop", "light", "pt-BR",
    async ({ page, url, t }) => { await listed(page); await toList(page, url, t); },
    async (page) => designed(page, "desktop", "light", "pt-BR")],
  ["list-tip", "Seus computadores: a dica de uma linha", "list", null, "desktop", "light", "pt-BR",
    async ({ page, url, t }) => {
      await listed(page);
      await toList(page, url, t);
      await page.getByRole("listitem").nth(1).getByRole("group").hover();
      await page.getByRole("tooltip").waitFor();
      return () => {};
    },
    async (page) => {
      await designed(page, "desktop", "light", "pt-BR");
      await page.locator("#rows .row").nth(1).locator(".screen").hover();
    }],
  ["list-tablet", "Seus computadores, no tablet", "list", null, "tablet", "dark", "en-US",
    async ({ page, url, t }) => { await listed(page); await toList(page, url, t); },
    async (page) => designed(page, "tablet", "dark", "en-US")],
  ["list-phone", "Seus computadores, no celular", "list", null, "phone", "light", "en-US",
    async ({ page, url, t }) => { await listed(page); await toList(page, url, t); },
    async (page) => designed(page, "phone", "light", "en-US")],
  ["ignite-connecting", "A tela que acende: conectando", "ignite", "connecting", "desktop", "dark", "pt-BR",
    async ({ page, url, t, staged }) => {
      await toList(page, url, t);
      staged.keep("connect");
      await openButton(page).click();
      await page.getByRole("status").waitFor();
    }],
  ["owner-busy", "De quem é a sessão: em uso em outro navegador", "owner", "busy", "tablet", "light", "pt-BR",
    async ({ page, url, t, browser }) => {
      const other = await (await browser.newContext({ locale: "pt-BR" })).newPage();
      await toList(other, url, t);
      await signIn(page, url, t);
      await page.getByRole("button", { name: t["common.takeover"] }).waitFor(UP);
      return () => other.context().close();
    }],
  ["owner-failed", "De quem é a sessão: não abriu", "owner", "failed", "phone", "dark", "en-US",
    async ({ page, url, t }) => {
      await page.route("**/api/session", (route) => route.fulfill({ status: 502, body: "bad gateway" }));
      await signIn(page, url, t);
      await page.getByRole("button", { name: t["common.retry"] }).waitFor(UP);
    }],
  ["session-bar", "A barra da sessão, aberta", "session", "bar-open", "desktop", "light", "pt-BR",
    async ({ page, url, t }) => toBar(page, url, t)],
  ["session-more", "A barra da sessão: Mais", "session", "more-open", "phone", "light", "pt-BR",
    async ({ page, url, t }) => toMore(page, url, t)],
  ["panels-clipboard", "Área de transferência, com o texto revelado", "panels", "clipboard-shown", "desktop", "light", "en-US",
    async ({ page, url, t, staged }) => {
      await toMore(page, url, t);
      await item(page, t, "session.clipboard").click();
      while (!staged.sent.includes("clipboardRequest")) await page.waitForTimeout(50);
      staged.say({ type: "clipboard", requested: true, text: "ssh -L 8443:127.0.0.1:8443 gateway\nsudo systemctl restart alumia", changedAtMs: null, oversizedBytes: null, unconfirmed: false });
      await page.getByRole("dialog").getByRole("button").filter({ hasText: /\d/ }).first().click();
      await page.getByRole("textbox").waitFor();
    }],
  ["panels-displays", "A lista de telas", "panels", "displays", "tablet", "dark", "pt-BR",
    async ({ page, url, t, staged }) => {
      await toBar(page, url, t);
      staged.say({ type: "displays", active: 1, displays: DISPLAYS });
      await item(page, t, "session.displays").click();
    }],
  ["panels-keyboard", "O teclado, no computador", "panels", "keyboard", "desktop", "light", "pt-BR",
    async ({ page, url, t }) => { await toBar(page, url, t); await item(page, t, "session.keyboard").click(); }],
  ["panels-keyboard-phone", "O teclado, no celular deitado", "panels", "keyboard", "phone-landscape", "dark", "pt-BR",
    async ({ page, url, t }) => { await toBar(page, url, t); await item(page, t, "session.keyboard").click(); }],
  ["info-session", "Informações: esta sessão", "info", "session", "desktop", "dark", "pt-BR",
    async ({ page, url, t }) => { await toMore(page, url, t); await item(page, t, "session.info").click(); }],
  ["info-keys", "Informações: teclas", "info", "keys", "phone", "light", "en-US",
    async ({ page, url, t }) => {
      await toMore(page, url, t);
      await item(page, t, "session.info").click();
      await page.getByRole("tab", { name: t["info.tab.keys"] }).click();
    }],
  ["info-shortcuts", "Informações: atalhos", "info", "shortcuts", "desktop", "light", "pt-BR",
    async ({ page, url, t }) => {
      await toMore(page, url, t);
      await item(page, t, "session.info").click();
      await page.getByRole("tab", { name: t["info.tab.shortcuts"] }).click();
    }],
  ["info-keys-desktop", "Informações: teclas, no computador", "info", "keys", "desktop", "dark", "pt-BR",
    async ({ page, url, t }) => {
      await toMore(page, url, t);
      await item(page, t, "session.info").click();
      await page.getByRole("tab", { name: t["info.tab.keys"] }).click();
    }],
  ["info-gestures", "Informações: gestos de toque", "info", "gestures", "tablet", "light", "en-US",
    async ({ page, url, t }) => {
      await toMore(page, url, t);
      await item(page, t, "session.info").click();
      await page.getByRole("tab", { name: t["info.tab.gestures"] }).click();
    }],
  ["throughput-live", "Vazão, pela lista", "throughput", "live", "desktop", "light", "pt-BR",
    async ({ page, url, t }) => {
      await meter(page);
      await page.clock.install();
      await toList(page, url, t);
      await item(page, t, "throughput.title").click();
      await page.getByRole("figure").first().waitFor();
      await page.clock.runFor(60_000);
    }],
  ["throughput-session", "Vazão, pela sessão", "throughput", "in-session", "tablet", "dark", "en-US",
    async ({ page, url, t }) => {
      await meter(page);
      await page.clock.install();
      await toMore(page, url, t);
      await item(page, t, "session.info").click();
      await item(page, t, "throughput.title").click();
      await page.getByRole("figure").first().waitFor();
      await page.clock.runFor(60_000);
    }],
  ["covers-too-many", "O que cobre a tela: telas demais", "covers", "too-many", "desktop", "light", "pt-BR",
    async ({ page, url, t, staged }) => {
      await toSession(page, url, t);
      staged.say({ type: "displays", active: 0, displays: DISPLAYS });
      staged.say({ type: "oversize", cause: "screens" });
      await page.getByRole("alert").waitFor();
    }],
  ["notices-destructive", "Diálogo: sair e encerrar a sessão", "notices", "destructive", "phone", "dark", "pt-BR",
    async ({ page, url, t }) => {
      await toMore(page, url, t);
      await item(page, t, "common.signout").click();
      await page.getByRole("alertdialog").waitFor();
    }],
];

// What is known to differ, said beside its pair on the page.
const NOTES = {
  "list-desktop": "Ao lado do desenho em vigor da lista (docs/mockups/2026-10-04-1245-lista-monitores.html), e não da prancha. No desenho os Macs são um computador cada; no produto são dois alvos da configuração no mesmo endereço, juntados numa linha sob o começo comum dos nomes. O Raspberry Pi é um VNC comum, que guarda o tamanho dele: o produto mostra \"1:1\" e a imagem maior que a janela, onde o desenho mostrava ajustada. As linhas da dica não têm ponto final no produto.",
  "list-tip": "A dica com o ponteiro parado no monitor do Mac mini, que está em Espelhado.",
  "list-tablet": "O tablet do produto tem teclas maiores que as do desenho: é aparelho de toque.",
  "list-phone": "Num celular não há janela para o tamanho seguir: as telas são mostradas ajustadas à largura, com as faixas em cima e embaixo, e o tamanho é o que o computador guarda.",
  "ignite-connecting": "O título é o nome do computador que está sendo aberto; no servidor de teste, \"test-tone\".",
  "owner-busy": "Diferença decidida no plano: a página não sabe qual computador o outro navegador abriu, então o título é o nome do servidor, e a segunda ação é \"Sair\" (sem a sessão não há lista para onde voltar).",
  "owner-failed": "Mesma diferença do par acima: título do servidor e \"Sair\" como segunda ação.",
  "session-bar": "O servidor de teste tem uma tela só e a sessão foi aberta sem som: por isso \"Telas\" e \"Silenciar\" não aparecem. Um botão sem o que fazer some, não fica apagado.",
  "session-more": "O computador do servidor de teste não aceita câmera nem microfone, por isso os dois itens não aparecem.",
  "info-session": "O servidor de teste não mede vazão, por isso não há o botão \"Vazão\"; e não manda vídeo, por isso \"Imagem\" diz \"Aguardando o formato\".",
  "info-shortcuts": "Difere da prancha por ordem do dono (2026-10-04): linhas da mesma altura, as duas colunas no meio, só o atalho deste aparelho, textos mais curtos.",
  "info-keys": "Difere da prancha por ordem do dono (2026-10-04): linhas da mesma altura, teclas na mesma linha do texto, sem as frases que sobravam.",
  "info-keys-desktop": "Difere da prancha por ordem do dono (2026-10-04): linhas da mesma altura, teclas na mesma linha do texto, sem as frases que sobravam.",
  "info-gestures": "Difere da prancha por ordem do dono (2026-10-04): linhas da mesma altura e as duas colunas no meio.",
  "throughput-live": "As leituras são encenadas pela ferramenta: os números não são os da prancha. O vão no traço é um segundo sem leitura, desenhado como vão.",
  "throughput-session": "As leituras são encenadas pela ferramenta: os números não são os da prancha.",
  "start-insecure": "Diferença decidida no plano: a página não conhece o endereço seguro do servidor, então essa linha fica sem endereço.",
};

const file = (id, side) => `${id}-${side}.jpg`;

async function product(browser, url, pair) {
  const [id, , , , device, theme, language, reach] = pair;
  const size = DEVICES[device];
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: size.touch,
    locale: language,
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.addInitScript(
    ([chosenLanguage, chosenTheme, fingers]) => {
      localStorage.setItem("alumia.language", chosenLanguage);
      localStorage.setItem("alumia.theme", chosenTheme);
      if (fingers) {
        Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5 });
      }
    },
    [language, theme, size.touch],
  );
  const staged = await stage(page);
  const insecure = `http://alumia.test:${new URL(url).port}/`;
  const after = await reach({ page, url, insecure, t: WORDS[language], staged, browser });
  await page.evaluate(() => document.fonts.ready);
  // The pointer out of the way, so that no button is photographed under it: save where
  // the pair is of something the pointer rests on, which says so by handing back a step.
  if (!after) await page.mouse.move(2, size.height - 2);
  await page.screenshot({ path: path.join(OUT, file(id, "produto")), type: "jpeg", quality: 85 });
  if (after) await after();
  await context.close();
}

// The list's design, on a page of its own beside the mockup's.
async function design(page, pair) {
  const [id, , , , , , , , draws] = pair;
  await draws(page);
  await page.locator("#frame").screenshot({ path: path.join(OUT, file(id, "prancha")), type: "jpeg", quality: 85 });
}

async function mockup(page, pair) {
  const [id, , scene, state, device, theme, language] = pair;
  await page.evaluate(
    ([d, t, l, s, st]) => {
      window.AL.set({ device: d, theme: t, language: l });
      window.AL.go(s, st);
    },
    [device, theme, language, scene, state],
  );
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#al-product").screenshot({ path: path.join(OUT, file(id, "prancha")), type: "jpeg", quality: 85 });
}

function index() {
  const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const pairs = PAIRS.filter(([id]) => fs.existsSync(path.join(OUT, file(id, "produto")))).map(
    ([id, title, , , device, theme, language]) => {
      const where = `${DEVICES[device].says} · tema ${THEMES[theme]} · ${language}`;
      const sides = [["produto", "Produto"], ["prancha", id.startsWith("list-") ? "Desenho da lista" : "Prancha"]]
        .map(([side, says]) =>
          `<figure><figcaption>${says}</figcaption><a href="${file(id, side)}"><img loading="lazy" src="${file(id, side)}" alt="${says}: ${escape(title)}"></a></figure>`)
        .join("");
      const note = NOTES[id] ? `<p>${escape(NOTES[id])}</p>` : "";
      return `<section id="${id}"><h2>${escape(title)}</h2><p class="where">${where}</p>${note}<div class="sides">${sides}</div></section>`;
    },
  );
  const page = `<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alumia: o produto ao lado da prancha</title>
<style>
:root { color-scheme: light dark; --bg: #f3f4f6; --ink: #14171c; --soft: #566070; --line: #cfd4dc; --card: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #14171c; --ink: #eef0f3; --soft: #a3acb9; --line: #333a45; --card: #1d2128; } }
body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 1500px; margin: 0 auto; }
h1 { font-size: 28px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 0; }
p { margin: 0 0 12px; color: var(--soft); max-width: 75ch; } .where { font-size: 13px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 0 0 16px; }
.sides { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
figure { margin: 0; flex: 1 1 320px; min-width: 0; } figcaption { font-size: 13px; color: var(--soft); margin: 0 0 4px; }
img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; display: block; }
</style>
<main>
<h1>Alumia: o produto ao lado da prancha</h1>
<p>À esquerda, a página de verdade, fotografada no servidor de teste do repositório. À direita, a mesma cena na prancha aprovada. O servidor de teste não tem um computador remoto: onde a prancha desenha a tela remota, o produto mostra a tela vazia de 640 × 480 dele, e o nome do computador é "test-tone". Clique numa foto para abri-la inteira. Refeita com <code>bash tools/compare-screens.sh</code>.</p>
${pairs.join("\n")}
</main>
</html>
`;
  fs.writeFileSync(path.join(OUT, "index.html"), page);
  return pairs.length;
}

(async () => {
  const [url, ...only] = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  // The page alone, from the photographs already taken.
  if (only.includes("--page")) {
    console.log(`${index()} pairs on ${path.relative(REPO, path.join(OUT, "index.html"))}`);
    return;
  }
  const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP alumia.test 127.0.0.1"] });
  const board = await (await browser.newContext({ viewport: { width: 1900, height: 1400 }, reducedMotion: "reduce" })).newPage();
  await board.goto(MOCKUP);
  const sheet = await (await browser.newContext({ viewport: { width: 1300, height: 1400 }, reducedMotion: "reduce" })).newPage();
  for (const pair of PAIRS) {
    if (only.length > 0 && !only.includes(pair[0])) continue;
    try {
      await product(browser, url, pair);
      await (pair[8] ? design(sheet, pair) : mockup(board, pair));
      console.log("ok  ", pair[0]);
    } catch (error) {
      console.log("FAIL", pair[0], String(error).split("\n")[0]);
      process.exitCode = 1;
    }
  }
  await browser.close();
  console.log(`${index()} pairs on ${path.relative(REPO, path.join(OUT, "index.html"))}`);
})();
