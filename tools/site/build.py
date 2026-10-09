#!/usr/bin/env python3
"""Write the public page, site/index.html, and the README's header, docs/readme/alumia-*.svg,
from the product and nothing else.

The page is tools/site/template.html filled with: the product's page as the gateway served
it, harvested by tools/site/harvest.mjs into tools/site/dom/ (its document and stylesheet,
shown live inside the public page, with the lens drawn by the product's own glass shader);
the shaders of frontend/src/glass.ts, letter for letter, and its grain; the glyphs of
frontend/src/Glyph.tsx; the font of frontend/src/design/InstrumentSans.woff2; the colours of
docs/design/alumia.tokens.json; the Mac app's screens, drawn from what the app's code lays
out and says (Words.generated.swift); and the page's own words, tools/site/words.json. Run
by tools/site/build.sh, which harvests first.

    uv run --no-project python tools/site/build.py
"""

import base64
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
HERE = Path(__file__).resolve().parent
REPO = "https://github.com/aleonnet/alumia"
DOWNLOAD = f"{REPO}/releases/latest"
LANGS = ("pt-BR", "en-US")
SHORT = {"pt-BR": "pt", "en-US": "en"}


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


# ---- the colours, the font and the mark ----------------------------------------------
tokens = json.loads(read("docs/design/alumia.tokens.json"))


def colour(*path):
    node = tokens["color"]
    for step in path:
        node = node[step]
    return node["$value"]["hex"]


COLOURS = {
    "glass": colour("brand", "glass"),
    "red": colour("brand", "red"),
    "green": colour("brand", "green"),
    "blue": colour("brand", "blue"),
    "light": colour("light", "surface", "base"),
    "dark": colour("dark", "surface", "base"),
}
PLACES = {
    "/*GLASS*/": COLOURS["glass"],
    "/*RED*/": COLOURS["red"],
    "/*GREEN*/": COLOURS["green"],
    "/*BLUE*/": COLOURS["blue"],
    "/*REPO*/": REPO,
    "/*DOWNLOAD*/": DOWNLOAD,
}
for theme in ("light", "dark"):
    up = theme.upper()
    PLACES[f"/*{up}.BASE*/"] = colour(theme, "surface", "base")
    PLACES[f"/*{up}.RAISED*/"] = colour(theme, "surface", "raised")
    PLACES[f"/*{up}.SUNKEN*/"] = colour(theme, "surface", "sunken")
    PLACES[f"/*{up}.TEXT*/"] = colour(theme, "text", "primary")
    PLACES[f"/*{up}.TEXT2*/"] = colour(theme, "text", "secondary")
    PLACES[f"/*{up}.ACTION*/"] = colour(theme, "action", "default")
    PLACES[f"/*{up}.BORDER*/"] = colour(theme, "border", "subtle")

woff2 = base64.b64encode((ROOT / "frontend/src/design/InstrumentSans.woff2").read_bytes()).decode("ascii")
FONT = (
    '@font-face { font-family: "Instrument Sans"; font-weight: 400 700; font-stretch: 75% 100%; '
    f'font-display: block; src: url(data:font/woff2;base64,{woff2}) format("woff2"); }}'
)
ICON = "data:image/svg+xml;base64," + base64.b64encode((ROOT / "frontend/src/design/favicon.svg").read_bytes()).decode("ascii")

# ---- the shaders and the grain, from glass.ts --------------------------------------
glass_ts = read("frontend/src/glass.ts")


def shader(name):
    found = re.search(rf"^const {name} = `(.*?)`;", glass_ts, re.S | re.M)
    if not found:
        sys.exit(f"build: frontend/src/glass.ts has no shader named {name}")
    return found.group(1).strip()


SHADERS = (
    f'<script type="x-shader/x-vertex" id="sh-v">{shader("VERTEX")}</script>\n'
    f'<script type="x-shader/x-fragment" id="sh-glass">{shader("GLASS")}</script>\n'
    f'<script type="x-shader/x-fragment" id="sh-ignite">{shader("IGNITE")}</script>\n'
    f'<script type="x-shader/x-fragment" id="sh-dissolve">{shader("DISSOLVE")}</script>'
)
CELL = float(re.search(r"^const CELL = ([\d.]+);", glass_ts, re.M).group(1))
grain = re.search(r"^const GRAIN = \{ light: ([\d.]+), dark: ([\d.]+) \};", glass_ts, re.M)
GRAIN = {"light": float(grain.group(1)), "dark": float(grain.group(2))}

# ---- the glyphs, from Glyph.tsx ------------------------------------------------------
glyph_tsx = read("frontend/src/Glyph.tsx")
drawings = re.search(r"^const DRAWINGS = \{\n(.*?)\n\} satisfies", glyph_tsx, re.S | re.M).group(1)
GLYPHS = {
    name: " ".join(body.split())
    for name, body in re.findall(r'^  "?([a-z0-9-]+)"?: \(\n    <>\n(.*?)\n    </>\n  \),', drawings, re.S | re.M)
}

# ---- the Mac app's words, from its dictionary ---------------------------------------
swift = read("macos/Alumia/Sources/AlumiaCore/Generated/Words.generated.swift")
APP = {}
for key, pt, en in re.findall(r'^\s+"([a-z.0-9]+)": \["((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\],?$', swift, re.M):
    APP[key] = {"pt-BR": pt.replace('\\"', '"'), "en-US": en.replace('\\"', '"')}

WORDS = json.loads((HERE / "words.json").read_text(encoding="utf-8"))
WORDS.pop("$what", None)


def app(key, lang, **params):
    if key not in APP:
        sys.exit(f"build: the Mac app's dictionary has no text {key}")
    text = APP[key][lang]
    for name, value in params.items():
        text = text.replace("{" + name + "}", str(value))
    return html.escape(text, quote=False)


def own(key, lang):
    return html.escape(WORDS[lang][key], quote=False)


# ---- the Mac app's screens, from its code -------------------------------------------
# Menu.swift: the two lines with the light, End the session while somebody is connected,
# Stop Alumia, Open in the browser and Copy the address, Settings and Quit with their keys.
def bars(filled):
    return (f'<svg class="mac-bars{" filled" if filled else ""}" viewBox="0 0 18 16" aria-hidden="true">'
            '<rect x="2.25" y="2" width="3.5" height="12" rx="1"/><rect x="8" y="2" width="3.5" height="12" rx="1"/>'
            '<rect x="13.75" y="2" width="3.5" height="12" rx="1"/></svg>')


def menu(lang, serving):
    second = app("mac.menu.connected", lang, name="MacBook Pro") if serving else app("mac.menu.nobody", lang)
    rows = [f'<div class="mi said"><i class="light green"></i><span>{app("mac.menu.running", lang)}</span></div>',
            f'<div class="mi said dim"><i class="light none"></i><span>{second}</span></div>', "<hr>"]
    if serving:
        rows.append(f'<div class="mi"><span>{app("mac.menu.end", lang)}</span></div>')
    rows += [f'<div class="mi"><span>{app("mac.menu.stop", lang)}</span></div>', "<hr>",
             f'<div class="mi"><span>{app("mac.menu.open", lang)}</span></div>',
             f'<div class="mi"><span>{app("mac.copy.address", lang)}</span></div>', "<hr>",
             f'<div class="mi"><span>{app("mac.menu.settings", lang)}</span><kbd>⌘,</kbd></div>', "<hr>",
             f'<div class="mi"><span>{app("mac.menu.quit", lang)}</span><kbd>⌘Q</kbd></div>']
    return (f'<div class="mac-desk"><div class="mac-bar"><span class="mac-item on">{bars(serving)}</span>'
            f'<span class="mac-clock">{own("sample.clock", lang)}</span></div>'
            f'<div class="mac-menu" role="menu">{"".join(rows)}</div></div>')


# SettingsView.swift: five panes in a capsule, and the Computers pane with a row per
# computer, Add a computer… and the note under it.
PANES = [("mac.pane.general", "settings"), ("mac.pane.computers", "monitor"), ("mac.pane.access", "lock"),
         ("mac.pane.advanced", "sliders-horizontal"), ("mac.pane.about", "info")]


def settings(lang):
    tabs = "".join(
        f'<button type="button" class="tab{" on" if key == "mac.pane.computers" else ""}"><svg class="ic"><use href="#i-{glyph}"/></svg>'
        f"<span>{app(key, lang)}</span></button>"
        for key, glyph in PANES)
    computers = [("MacBook Pro", app("mac.modes.mac", lang), app("mac.computers.this", lang)),
                 ("Mac mini", app("mac.modes.mac", lang), app("mac.kind.mac", lang)),
                 (own("sample.office", lang), app("type.rdp", lang), app("mac.kind.windows", lang))]
    rows = "".join(
        f'<div class="row"><div class="what"><b>{name}</b><small>{modes}</small></div><span class="kind">{kind}</span>'
        f'<button type="button" class="cap">{app("mac.edit", lang)}</button></div>'
        for name, modes, kind in computers)
    body = (f'<p class="hd">{app("mac.computers.what", lang)}</p><div class="group">{rows}</div>'
            f'<div class="ft"><button type="button" class="cap"><svg class="ic"><use href="#i-plus"/></svg>{app("mac.computers.add", lang)}</button>'
            f'<p>{app("mac.computers.note", lang)}</p></div>')
    return (f'<div class="mac-win"><div class="mac-title"><span class="lights"><i></i><i></i><i></i></span><b>{app("mac.pane.computers", lang)}</b></div>'
            f'<div class="mac-tabs">{tabs}</div><div class="mac-form">{body}</div></div>')


# WizardView.swift: the pane of the brand's glass with three bars, each lit as far as its
# part is ready (the Screen Sharing step: two thirds, none, none), and the step beside it.
def first(lang):
    lit = [2 / 3, 0, 0]
    names = [app("mac.first.bar.mac", lang), app("mac.first.bar.way", lang), app("mac.first.bar.key", lang)]
    bars_ = "".join(f'<i class="bar b{i}"><b style="height:{200 * lit[i]:.1f}px"></b></i>' for i in range(3))
    named = "".join(f'<span class="nm"><i class="sw b{i}" style="opacity:{0.16 + 0.84 * lit[i]:.2f}"></i>{names[i]}</span>' for i in range(3))
    return (f'<div class="mac-first"><div class="pane"><div class="bars">{bars_}</div><div class="names">{named}</div></div>'
            f'<div class="step"><h3>{app("mac.first.sharing.title", lang)}</h3><p>{app("mac.first.sharing.body", lang)}</p>'
            f'<div class="rows"><div class="what"><b>{app("mac.sharing.name", lang)}</b><small>{app("mac.sharing.where", lang)}</small></div>'
            f'<span class="mark off"><i></i>{app("mac.sharing.off", lang)}</span><button type="button" class="cap">{app("mac.open.system", lang)}</button></div>'
            f'<p class="cap-note">{app("mac.first.sharing.note", lang)}</p>'
            f'<div class="foot"><button type="button" class="cap">{app("common.back", lang)}</button><span class="n">{app("mac.first.step", lang, n=2, total=5)}</span>'
            f'<button type="button" class="cap dis">{app("common.continue", lang)}</button></div></div></div>')


MACS = {lang: {"menu": menu(lang, True), "menu-idle": menu(lang, False), "settings-computers": settings(lang), "first": first(lang)} for lang in LANGS}

# ---- the product's page, harvested ---------------------------------------------------
def page_doc(name):
    path = HERE / "dom" / f"{name}.json"
    if not path.exists():
        sys.exit(f"build: {path.relative_to(ROOT)} is not there; run tools/site/build.sh, which harvests first")
    harvested = json.loads(path.read_text(encoding="utf-8"))
    text = re.sub(r"<script\b[^>]*>.*?</script>", "", harvested["html"], flags=re.S)
    text = re.sub(r"<link\b[^>]*>", "", text)
    body = text[text.find("<body"):]
    return {"css": harvested["css"], "body": body[: body.rfind("</body>")]}


DOCS = {f"{kind}-{SHORT[lang]}": page_doc(f"{kind}-{SHORT[lang]}")["body"] for lang in LANGS for kind in ("signin", "list", "session")}
CSS = page_doc("list-pt")["css"]
HEAD = ('<!doctype html><html lang="{lang}" data-al-theme="{theme}" data-al-clock="stopped"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        "<style>__CSS__\n/* shown, not used: nothing in the product's page is pressed from here */\n"
        "html,body{overflow:hidden} a,button{cursor:default}</style>"
        '<script type="x-shader/x-fragment" id="sh-glass">{shader}</script></head>')
# The lens on the product's glass, inside each shown page: the product's own shader, with
# the product's grain and colours, following the mouse as frontend/src/glass.ts does.
RUNNER = """
<script>
(() => {
  const canvas = document.querySelector(".al-fx canvas");
  if (!canvas) return;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return;
  const V = `#version 300 es
in vec2 a_corner; void main() { gl_Position = vec4(a_corner, 0.0, 1.0); }`;
  const F = document.getElementById("sh-glass").textContent.trim();
  const make = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const p = gl.createProgram(); gl.attachShader(p, make(gl.VERTEX_SHADER, V)); gl.attachShader(p, make(gl.FRAGMENT_SHADER, F)); gl.linkProgram(p); gl.useProgram(p);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(p, "a_corner"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(p, n);
  const hex = (h) => [1,3,5].map((i) => parseInt(h.slice(i, i+2), 16) / 255);
  const light = document.documentElement.dataset.alTheme === "light";
  gl.uniform3fv(u("u_base"), hex(light ? "__LIGHT__" : "__DARK__")); gl.uniform3fv(u("u_red"), hex("__RED__")); gl.uniform3fv(u("u_green"), hex("__GREEN__")); gl.uniform3fv(u("u_blue"), hex("__BLUE__"));
  gl.uniform1f(u("u_cell"), __CELL__); gl.uniform1f(u("u_grain"), light ? __GRAIN_LIGHT__ : __GRAIN_DARK__);
  let pointer = [-1000, -1000], lens = 0, to = 0, frame = 0;
  function draw() {
    frame = 0;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); gl.uniform2f(u("u_size"), w, h); }
    lens += (to - lens) * 0.2; if (Math.abs(to - lens) < 0.002) lens = to;
    gl.uniform2f(u("u_pointer"), pointer[0], pointer[1]); gl.uniform1f(u("u_lens"), lens);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (lens !== to) frame = requestAnimationFrame(draw);
  }
  const wake = () => { if (!frame) frame = requestAnimationFrame(draw); };
  document.addEventListener("pointermove", (e) => { if (e.pointerType !== "mouse") return; const r = canvas.getBoundingClientRect(); pointer = [e.clientX - r.left, e.clientY - r.top]; to = 1; wake(); });
  document.addEventListener("pointerleave", () => { to = 0; wake(); });
  window.addEventListener("resize", wake);
  draw();
})();
</script>"""
for place, value in (("__LIGHT__", COLOURS["light"]), ("__DARK__", COLOURS["dark"]), ("__RED__", COLOURS["red"]), ("__GREEN__", COLOURS["green"]),
                     ("__BLUE__", COLOURS["blue"]), ("__CELL__", str(CELL)), ("__GRAIN_LIGHT__", str(GRAIN["light"])), ("__GRAIN_DARK__", str(GRAIN["dark"]))):
    RUNNER = RUNNER.replace(place, value)

EMBED = {"css": CSS, "head": HEAD, "shader": shader("GLASS"), "runner": RUNNER, "docs": DOCS, "repo": REPO,
         "colours": COLOURS, "cell": CELL, "grain": GRAIN}

# ---- the page ---------------------------------------------------------------------------
out = (HERE / "template.html").read_text(encoding="utf-8")
for place, value in PLACES.items():
    out = out.replace(place, value)
out = out.replace("/*FONT*/", FONT).replace("/*ICON*/", ICON)

# The glyphs the page and the Mac app's screens use, from the product's table; the two of
# the page alone are in the template.
used = sorted(set(re.findall(r'href="#i-([a-z0-9-]+)"', out + "".join(scene for lang in MACS.values() for scene in lang.values()))))
own_symbols = set(re.findall(r'<symbol id="i-([a-z0-9-]+)"', out))
symbols = []
for name in used:
    if name in own_symbols:
        continue
    if name not in GLYPHS:
        sys.exit(f"build: frontend/src/Glyph.tsx has no glyph named {name}, which the page uses")
    symbols.append(f'<symbol id="i-{name}" viewBox="0 0 24 24">{GLYPHS[name]}</symbol>')
out = out.replace("<!--SYMBOLS-->", "<!-- The product's glyphs, from frontend/src/Glyph.tsx (Lucide's, ISC). -->\n" + "\n".join(symbols))
out = out.replace("<!--SHADERS-->", "<!-- The product's shaders, frontend/src/glass.ts, letter for letter. -->\n" + SHADERS)


def data(id_, value):
    # A closing tag inside the data would end the script: it is escaped as JSON allows.
    text = json.dumps(value, ensure_ascii=False).replace("</", "<\\/")
    return f'<script type="application/json" id="{id_}">{text}</script>'


out = out.replace("<!--DATA-->", "\n".join((data("al-words", WORDS), data("al-embed", EMBED), data("al-macs", MACS))))
for place in re.findall(r"/\*[A-Z.]+\*/|<!--[A-Z]+-->", out):
    sys.exit(f"build: {place} was left unfilled in the page")
site = ROOT / "site"
site.mkdir(exist_ok=True)
(site / "index.html").write_text(out, encoding="utf-8")
print(f"wrote site/index.html, {len(out.encode('utf-8'))} bytes")

# ---- the README's header: the wordmark on the brand's glass, lit once -----------------
# The subpixel grid of the glass, in the brand's three colours, lit by a light that opens
# from the centre once (SVG animates in an <img>) and stays; the ground outside the
# rounded header is GitHub's own page colour, dark or light, so that the header sits on
# the README as a picture of the page would.
GITHUB = {"escuro": "#0D1117", "claro": "#FFFFFF"}
for theme, ground in GITHUB.items():
    banner = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" width="1200" height="420">
<defs>
  <style>{FONT}</style>
  <pattern id="g" width="12" height="12" patternUnits="userSpaceOnUse">
    <rect x="0.7" y="1.4" width="3.3" height="10.6" rx="0.6" fill="{COLOURS["red"]}"/>
    <rect x="4.7" y="1.4" width="3.3" height="10.6" rx="0.6" fill="{COLOURS["green"]}"/>
    <rect x="8.7" y="1.4" width="3.3" height="10.6" rx="0.6" fill="{COLOURS["blue"]}"/>
  </pattern>
  <radialGradient id="lit" cx="600" cy="210" r="0" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#fff" stop-opacity="0.5"/>
    <stop offset="0.85" stop-color="#fff" stop-opacity="0.5"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0.035"/>
    <animate attributeName="r" from="0" to="900" dur="2.6s" begin="0.4s" fill="freeze" calcMode="spline" keySplines="0.2 0 0 1"/>
  </radialGradient>
  <mask id="m"><rect width="1200" height="420" fill="url(#lit)"/></mask>
  <clipPath id="c"><rect width="1200" height="420" rx="20"/></clipPath>
</defs>
<rect width="1200" height="420" fill="{ground}"/>
<g clip-path="url(#c)">
  <rect width="1200" height="420" fill="{COLOURS["glass"]}"/>
  <rect width="1200" height="420" fill="url(#g)" opacity="0.035"/>
  <rect width="1200" height="420" fill="url(#g)" mask="url(#m)"/>
  <text x="600" y="262" text-anchor="middle" font-family="Instrument Sans, system-ui, sans-serif" font-weight="600" font-stretch="75%" font-size="196" letter-spacing="-6" fill="{COLOURS["light"]}">alumia</text>
</g>
</svg>
"""
    path = ROOT / "docs/readme" / f"alumia-{theme}.svg"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(banner, encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")
