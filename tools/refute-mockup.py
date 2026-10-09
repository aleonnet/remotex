#!/usr/bin/env python3
"""Prove that the checks of the design system and of the mockup bite.

A check that has never failed proves nothing. Each proof here plants one defect in one file,
runs the check that has to catch it, demands the exact words of the failure, puts the file
back and compares its fingerprint with the one taken before. A proof counts only when all
four hold: the check failed, it said the expected words, and the file is as it was.

    uv run --no-project python tools/refute-mockup.py            every proof
    uv run --no-project python tools/refute-mockup.py 8 9a       those whose id starts so
    uv run --no-project python tools/refute-mockup.py --anchors  only that each defect still
                                                                 finds where it is planted

It is not one of the gates: the proofs that run the mockup's test take minutes together.
Run it before a commit that changes the mockup, the tokens, the catalogue or their checks.
Stopped half way (Ctrl+C, or a signal to end), it puts the file back before it goes. It needs
the mockup in the tree, which the public copy has not: there it says so and does nothing.
"""

import hashlib
import json
import pathlib
import re
import signal
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import contrast  # noqa: E402  (the colour arithmetic the planted colours are worked out with)

MOCKUP = ROOT / "docs/mockups/2026-10-03-0233-prancha-alumia.html"
TOKENS = ROOT / "docs/design/alumia.tokens.json"
ERRORS = ROOT / "docs/design/errors.json"


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command, cwd=ROOT):
    done = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
    return done.returncode, done.stdout + done.stderr


def design():
    return run(["uv", "run", "--no-project", "python", "tools/check-design.py"])


def pairs():
    return run(["uv", "run", "--no-project", "python", "tools/contrast.py"])


def spec(title):
    """The one test of the mockup whose title has these words."""
    return lambda: run(["bunx", "playwright", "test", "-g", title], cwd=ROOT / "tests/mockup")


def swap(old, new):
    def planted(text):
        assert text.count(old) == 1, f"the place to plant it is there {text.count(old)} times: {old[:70]}"
        return text.replace(old, new)

    return planted


def after(anchor, addition):
    return swap(anchor, anchor + addition)


def first(old, new):
    """For what the file has many times, like the mark: the first of them."""

    def planted(text):
        assert old in text, f"the place to plant it is gone: {old[:70]}"
        return text.replace(old, new, 1)

    return planted


def tokens(change):
    def planted(text):
        tree = json.loads(text)
        change(tree)
        return json.dumps(tree, indent=2, ensure_ascii=False) + "\n"

    return planted


def colour(tree, path, value):
    """Set a token to this colour, its hexadecimal and its OKLCH agreeing."""
    node = tree
    for key in path.split("."):
        node = node[key]
    lightness, chroma, hue = contrast.oklch(contrast.hex_to_srgb(value))
    node["$value"]["components"] = [round(lightness, 4), round(chroma, 4), round(hue, 2)]
    node["$value"]["hex"] = value


def without_place(place):
    def planted(text):
        catalogue = json.loads(text)
        kept = [entry for entry in catalogue["places"] if entry["id"] != place]
        assert len(kept) == len(catalogue["places"]) - 1, place
        catalogue["places"] = kept
        return json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n"

    return planted


def without_scene(text):
    out, count = re.subn(
        r'  <!-- 8\. Session information -->\n  <section class="al-scene" data-al-scene="info".*?</section>\n',
        "",
        text,
        flags=re.S,
    )
    assert count == 1
    return out


# A grey for text that falls just under 4.0:1 on the light ground, and a red and a green of
# one lightness, which a colour-blind eye cannot tell apart.
GROUND = contrast.hex_to_srgb("#F4F6F8")
GREY = next(
    grey
    for grey in (f"#{v:02X}{v + 7:02X}{v + 21:02X}" for v in range(0x5B, 0x90))
    if contrast.ratio(contrast.hex_to_srgb(grey), GROUND) <= 4.0
)
RED = contrast.to_hex(contrast.oklch_to_srgb(0.6, 0.13, 25))
GREEN = contrast.to_hex(contrast.oklch_to_srgb(0.6, 0.13, 145))


def red_and_green(tree):
    colour(tree, "color.light.chart.sent", RED)
    colour(tree, "color.light.chart.received", GREEN)


KEEP = """        <label class="al-check"><input type="checkbox" name="keep"><span data-t="signin.keep"></span></label>
        <div class="al-acts">
          <button class="al-btn al-btn--primary" type="submit" data-al-when="form wrong refused unreachable" data-t="signin.submit"></button>
          <button class="al-btn al-btn--primary" type="button" disabled data-al-when="sending" data-t="signin.sending"></button>
        </div>"""
KEEP_BESIDE = """        <div class="al-formrow">
          <button class="al-btn al-btn--primary" type="submit" data-al-when="form wrong refused unreachable" data-t="signin.submit"></button>
          <button class="al-btn al-btn--primary" type="button" disabled data-al-when="sending" data-t="signin.sending"></button>
          <label class="al-check"><input type="checkbox" name="keep"><span data-t="signin.keep"></span></label>
        </div>"""

READ = spec("can be read")
OPENS = spec("what opens in a session")
PHONE = spec("on a phone the session")
SAME = spec("same in both languages")
TITLE = spec("the tab's title")
WINDOW = spec("the keyboard's window")
PERIOD = spec("the meter's period")
MAC = spec("the app of Mac")
KEYS = spec("with a pointer the keyboard")

# (id, what is planted, the file, how, the check that must fail, the words it must say)
PROOFS = [
    # 1. Nothing is fetched from anywhere.
    ("1a", "a font fetched from the internet", MOCKUP, after('<style id="al-review-css">\n', '@font-face { font-family: "Outra"; src: url(https://fonts.example/outra.woff2); }\n'), design, ["has a url() to another address"]),
    ("1b", "an image with an outside address, put there by a script", MOCKUP, after('<script id="al-review-js">\n', 'new Image().src = "https://example.invalid/x.png";\n'), spec("a control the computer does not offer"), ["request: https://example.invalid/x.png"]),
    ("1c", "a fetch() in a script", MOCKUP, after('<script id="al-review-js">\n', 'fetch("dados.json");\n'), design, ["has a fetch()"]),
    # 2. Every text is in both languages, and none is written straight into a scene.
    ("2a", "a key taken out of en-US", MOCKUP, swap('"signin.keep": "Keep me signed in on this browser",\n', ""), design, ["the text signin.keep is in one of pt-BR and en-US and not in the other"]),
    ("2b", "a text written straight into a scene", MOCKUP, first('data-t="signin.lead"></p>', 'data-t="signin.lead"></p><p data-al-when="form">Texto fixo na cena</p>'), spec("no text of the product"), ["Texto fixo na cena"]),
    ("2c", "a hint (title) written straight", MOCKUP, first('data-al-act="prefs" data-t-aria-label="prefs.title" data-t-title="prefs.title">', 'data-al-act="prefs" data-t-aria-label="prefs.title" title="Dica fixa">'), spec("no text of the product"), ['title=\\"Dica fixa\\"']),
    # 3. Colours come from the tokens, and the tokens hold.
    ("3a", "a colour written by hand in the product's stylesheet", MOCKUP, swap(".al-row { background: var(--al-surface-raised);", ".al-row { background: #1F2226;"), design, ["the product's stylesheet writes a colour by hand: background: #1F2226"]),
    ("3b", "a fill with a colour written by hand on a bar of the mark", MOCKUP, first('<span class="al-mark" aria-hidden="true"><i></i>', '<span class="al-mark" aria-hidden="true"><svg viewBox="0 0 4 14"><rect width="4" height="14" fill="#FF4536"/></svg>'), design, ['the product has fill="#FF4536"']),
    ("3b2", "a style with a colour written by hand on a bar of the mark", MOCKUP, first('<span class="al-mark" aria-hidden="true"><i></i>', '<span class="al-mark" aria-hidden="true"><i style="background: red"></i>'), design, ["with a colour written by hand (red)"]),
    ("3c", "a vector of three numbers written in a shader", MOCKUP, after("out vec4 colour;\nvec3 subpixel(vec2 at) {\n", "  vec3 tint = vec3(1.0, 0.27, 0.21);\n"), design, ["the shader al-shader-glass writes a vector of numbers: vec3(1.0, 0.27, 0.21)"]),
    ("3d", "a colour changed in the mockup alone", MOCKUP, swap("--al-surface-base: oklch(0.9722 0.0034 247.86);", "--al-surface-base: oklch(0.95 0.0034 247.86);"), design, ['--al-surface-base under [data-al-theme="light"] is oklch(0.95 0.0034 247.86), and the tokens say oklch(0.9722 0.0034 247.86)']),
    ("3e", "a hexadecimal that is not its OKLCH", TOKENS, tokens(lambda tree: tree["color"]["light"]["action"]["default"]["$value"].__setitem__("hex", "#2860F1")), design, ["says #2860F1 and its OKLCH is #2860F0"]),
    ("3f", f"the grey of secondary text lightened to {GREY}, under 4.0:1", TOKENS, tokens(lambda tree: colour(tree, "color.light.text.secondary", GREY)), pairs, ["color.light.text.secondary on color.light.surface.base"]),
    ("3g", f"the two colours of the charts made a red and a green of one lightness ({RED}, {GREEN})", TOKENS, tokens(red_and_green), pairs, ["color.light.chart.sent and color.light.chart.received"]),
    ("3h", "a colour that one theme has and the other lacks", TOKENS, tokens(lambda tree: tree["color"]["dark"]["state"].pop("warning")), design, ["state.warning is in one of color.light and color.dark"]),
    # 4. Every scene is there, and nothing passes the frame.
    ("4a", "a scene taken out", MOCKUP, without_scene, spec("in a window of 1440"), ["8. Informações"]),
    ("4b", "a block of the review wider than a window of 820 px", MOCKUP, after('<style id="al-review-css">\n', ".rv-block { min-width: 900px !important; }\n"), spec("in a window of 820"), ["the page is"]),
    ("4c", "a block of the product wider than the frame", MOCKUP, after('<style id="al-product-css">\n', ".al-row { min-width: 1500px; }\n"), spec("in a window of 820"), ["the scene is"]),
    # 5. The eye.
    ("5a", "the eye without the change of the field's type", MOCKUP, swap('    field.type = shown ? "text" : "password";\n', ""), spec("the eye shows the password"), ['Expected: "text"']),
    ("5b", "the password not hidden again when sent", MOCKUP, swap("    reveal(root.querySelector('[data-al-act=\"eye\"]'), false);\n", ""), spec("the eye shows the password"), ['Expected: "password"']),
    # 6. Reduced motion, and the one clock.
    ("6a", "a shader's loop that ignores the preference for less motion", MOCKUP, swap('const reduced = () => system.matches || root.dataset.alMotion === "reduce";', "const reduced = () => false;"), spec("nothing moves"), ['Expected: "stopped"']),
    ("6b", "a loop on a repeating timer, for the tool", MOCKUP, after("  render();\n  return { at, go,", ' setInterval(() => draw("glass", 0), 500);'), design, ["a script uses setInterval"]),
    ("6c", "a loop on a repeating timer, for the test", MOCKUP, swap("  render();\n  return { at, go,", '  setInterval(() => draw("glass", 0), 500);\n  render();\n  return { at, go,'), spec("nothing moves"), ['"repeating": 1']),
    ("6d", "the clock held at stopped while the screen lights", MOCKUP, swap('const say = () => { root.dataset.alClock = frame ? "running" : "stopped"; };', 'const say = () => { root.dataset.alClock = "stopped"; };'), spec("the screen lights with the clock running"), ['Expected: "running"']),
    ("6e", "an animation frame asked for outside the clock", MOCKUP, after('<script id="al-product-js">\n', "requestAnimationFrame(() => {});\n"), design, ["a script other than the clock asks for an animation frame"]),
    # 7. The error catalogue.
    ("7a", "a code used twice", ERRORS, swap('"code": "AL-1202"', '"code": "AL-1201"'), design, ["the code AL-1201 is used by"]),
    # The check names the lines it found the place at. They are left out of what is waited
    # for: a line added above either would fail the proof, and it is the place, the file and
    # the two counts that the defect is about.
    ("7b", "the general code of a place of the page taken out (the boot refusal)", ERRORS, without_place("page.boot.refusal"), design, ["a place with no general code. 1 in the code (frontend/src/CannotStart.tsx:", ") and 0 in the catalogue: "]),
    ("7c", "the general code of a place of the server taken out (the end of a VNC session)", ERRORS, without_place("server.vnc.ended"), design, ["a place with no general code. 2 in the code (src/vnc.rs:", ") and 1 in the catalogue: .msg(ServerMsg::Error {"]),
    ("7d", "a snippet of origin that is no longer in the file", ERRORS, swap('"snippet": "? { cause: \\"AL-1201\\" }"', '"snippet": "? { cause: \\"AL-1201\\", }"'), design, ["AL-1201 quotes a snippet that is no longer in frontend/src/signin.ts"]),
    ("7e", "a code with one language missing", ERRORS, swap('"text": { "pt-BR": "Usuário ou senha incorretos. Confira e tente de novo.", "en-US": "Wrong username or password. Check them and try again." }', '"text": { "pt-BR": "Usuário ou senha incorretos. Confira e tente de novo." }'), design, ["AL-1201 does not have its text in exactly pt-BR and en-US"]),
    ("7f", "a placeholder that differs between the languages", ERRORS, swap("The server refused the sign-in (answer {status})", "The server refused the sign-in (answer {code})"), design, ["AL-1202 has different placeholders"]),
    ("7g", "a place of the page whose snippet left the code", ERRORS, swap('"snippet": "? message(\\"AL-5700\\", audio.error.code, fillOf(audio.error))"', '"snippet": "? message(\\"AL-5700\\", audio.error.cause, fillOf(audio.error))"'), design, ["the place page.info.audio-row quotes a snippet that is no longer in frontend/src/InfoSheet.tsx"]),
    ("7h", "the catalogue the mockup carries differing from the catalogue", MOCKUP, swap('"AL-1201":{"severity":"error"', '"AL-1201":{"severity":"info"'), design, ["the error catalogue it carries differs from docs/design/errors.json"]),
    # 8. What the page paints, what opens in a session, the phone, the tab, the keyboard's
    #    window and the meter's period.
    ("8a", "the button's colour beaten by a general rule (the defect the owner saw)", MOCKUP, swap(".al :where(button, input, select, textarea) { font: inherit; color: inherit; }", ".al button, .al input, .al select, .al textarea { font: inherit; color: inherit; }"), READ, ['\\"Abrir\\" at 3.57:1, under 4.5:1']),
    ("8b", "secondary text back over the glass", MOCKUP, swap(".al-glass :where(.al-dim, small, .al-tag, .al-code, .al-msg, .al-btn--quiet, dt) { color: var(--al-text-primary); }", ""), READ, ['\\"experimental\\" at']),
    ("8c", "a text of low contrast on a phone on its side alone", MOCKUP, after("@container al (max-height: 480px) {\n", "  .al-facts { color: var(--al-border-subtle); }\n"), READ, ["phone-landscape ", "under 4.5:1"]),
    ("8d", "a band between the picture and the keyboard when the phone is turned", MOCKUP, swap("  new ResizeObserver(dock).observe(keyboardPanel);\n", ""), PHONE, ["Expected: <= 1"]),
    ("8e", "the keyboard without the row of asdf", MOCKUP, swap('[["", 0.5, "gap"], ...each("a s d f g h j k l"), ["", 0.5, "gap"]],', ""), PHONE, ["getByRole('button', { name: 'a', exact: true })"]),
    ("8f", "the session on a phone out of full screen", MOCKUP, swap("const full = session && (at.full ?? phone);", "const full = session && (at.full ?? false);"), PHONE, ['Expected: "yes"']),
    ("8g", "a session's preferences going to the page of before the connection", MOCKUP, swap('    prefs: () => go("prefs"),', '    prefs: () => go("prefs", "from-list"),'), OPENS, ["[data-al-remote]"]),
    ("8h", "the sheet off the centre", MOCKUP, swap("position: absolute; z-index: 7; top: var(--al-near); left: 50%;", "position: absolute; z-index: 7; top: var(--al-near); left: 78%;"), OPENS, ["desktop, Mais: ", "px off the centre"]),
    ("8i", "the sheet off the centre on a phone held upright alone", MOCKUP, swap("  .al-drop { --al-far: 52px; top: auto; bottom: var(--al-near);", "  .al-drop { --al-far: 52px; top: auto; bottom: var(--al-near); left: 56%;"), OPENS, ["phone, Mais: ", "px off the centre"]),
    ("8j", "the sheet off the centre in the list of displays alone", MOCKUP, swap('style="padding: var(--al-space-4); gap: var(--al-space-3)" data-al-when="displays"', 'style="padding: var(--al-space-4); gap: var(--al-space-3); left: 70%" data-al-when="displays"'), OPENS, ["desktop, telas: ", "px off the centre"]),
    ("8k", "the sheet under the bar on a phone on its side (the defect measured: 62 px written by hand)", MOCKUP, swap("  .al-drop { --al-far: 42px; }", "  .al-drop { --al-far: 42px; top: 62px; }"), OPENS, ["phone-landscape, Mais: begins -6.8 px past the bar, outside 0 to 16"]),
    ("8l", "the sheet on the wrong side of the bar on a phone held upright", MOCKUP, swap("  .al-drop { --al-far: 52px; top: auto; bottom: var(--al-near);", "  .al-drop { --al-far: 52px;"), OPENS, ["phone, Mais: begins ", "outside 0 to 16"]),
    ("8m", "the bar at the bottom on a computer", MOCKUP, swap(".al-chrome { position: absolute; z-index: 8; top: var(--al-space-2);", ".al-chrome { position: absolute; z-index: 8; bottom: var(--al-space-2);"), OPENS, ["desktop, Mais: the bar is at the bottom"]),
    ("8n", "a notice that hangs from the bar put under it (not one of the six sheets)", MOCKUP, after('<style id="al-product-css">\n', ".al-say { margin-top: -40px; }\n"), OPENS, ["desktop, session fullscreen-refused: ", "px past the bar"]),
    ("8o", "the sheet solid, not glass", MOCKUP, swap(".al-glass { background: var(--al-glass);", ".al-glass { background: var(--al-surface-raised);"), OPENS, ["desktop, Mais: not glass (alpha 1.00"]),
    ("8p", "the handle, closed, not showing what is in use", MOCKUP, swap('const marks = state === "closed-in-use" ? ["camera", "microphone"]', 'const marks = state === "closed-in-use" ? []'), OPENS, ["Câmera e microfone em uso"]),
    ("8q", "the tab's title without the camera's mark", MOCKUP, swap('.includes(on) ? "🎥 " : "",', '.includes(on) ? "" : "",'), TITLE, ['Expected: "🎥 🔊 Alumia"']),
    ("8r", "the tab's title keeping the sound's mark when silenced", MOCKUP, swap('at.has.sound && on !== "sound-error" && !muted ? "🔊 " : "",', 'at.has.sound && on !== "sound-error" ? "🔊 " : "",'), TITLE, ['Expected: "Alumia"', 'Received: "🔊 Alumia"']),
    ("8s", "the keyboard's window not moving when dragged", MOCKUP, swap('    grip.addEventListener("pointermove", move);\n', ""), WINDOW, ["desktop: carried sideways"]),
    ("8t", "the keyboard's window carried past the frame", MOCKUP, swap("const within = (value, room) => `${Math.max(0, Math.min(value, room))}px`;", "const within = (value) => `${value}px`;"), WINDOW, ["desktop: left edge"]),
    ("8u", 'the list of periods without "Entre…"', MOCKUP, swap('<option value="window" data-t="throughput.between"></option>', ""), PERIOD, ['"Entre…"']),
    ("8v", "a typed period read as it is typed, not on Apply", MOCKUP, swap('  root.addEventListener("input", (event) => { if (event.target.closest("[data-al-period]")) shown(); });', '  root.addEventListener("input", (event) => { if (event.target.closest("[data-al-period]")) { const asked = typed(); if (asked !== null) Object.assign(period, asked, { all: false }); render(); } });'), PERIOD, ['Expected: "há 3 h"', 'Received: "há 1,5 h"']),
    ("8w", "a period chosen in a session leaving the session", MOCKUP, swap('if (["live", "custom", "between"].includes(at.states.throughput)) at.states.throughput =', "at.states.throughput ="), PERIOD, ["desktop, in-session", "[data-al-remote]"]),
    ("8x", "Apply left on for an end before its start", MOCKUP, swap("return from < to ? { window: { from, to } } : null;", "return { window: { from, to } };"), PERIOD, ["ends before it starts"]),
    # 9. The arrangement does not depend on the language.
    ("9a", "the owner's case: keep me signed in beside the button, which falls to a new line in one language", MOCKUP, swap(KEEP, KEEP_BESIDE), SAME, ["al-formrow: 01 | en-US"]),
    ("9b", "the meter's three choices wrapping with the words", MOCKUP, swap(".al-trio { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--al-space-2); }", ".al-trio { display: flex; flex-wrap: wrap; gap: var(--al-space-2); }"), SAME, ["al-trio:"]),
    ("9c", "a label that falls to a new line with a text 30% longer", MOCKUP, swap(".al-rowmode { display: grid; justify-items: start;", ".al-rowmode { display: flex; flex-wrap: wrap;"), SAME, ["| longer"]),
    # 10. The app of Mac.
    ("10a", "going on in the first run with Screen Sharing still off", MOCKUP, swap('root.querySelector("[data-al-after-sharing]").disabled = !shared;', 'root.querySelector("[data-al-after-sharing]").disabled = false;'), MAC, ["before Screen Sharing is on"]),
    ("10b", "a bar of the glass lit before its part is ready", MOCKUP, swap("keep: [1 / 3, 0, 0]", "keep: [1, 0, 0]"), MAC, ['Expected: "0.33 0.00 0.00"']),
    ("10c", "the glass lit before the last step", MOCKUP, swap('pane.dataset.alLit = step === "done" ? "yes" : "no";', 'pane.dataset.alLit = "yes";'), MAC, ["not lit before the end"]),
    ("10d", "the menu bar's item not saying the state", MOCKUP, swap("item.dataset.tAriaLabel = item.dataset.tTitle = `mac.status.${icon}`;", 'item.dataset.tAriaLabel = item.dataset.tTitle = "mac.status.idle";'), MAC, ["Alumia: sessão aberta"]),
    ("10e", "the settings' title not following the pane", MOCKUP, swap('    root.querySelector("[data-al-panetitle]").dataset.t = `mac.pane.${shown}`;\n', ""), MAC, ["mac-glass, Computadores"]),
    ("10f", "a second button in the notice", MOCKUP, after('data-al-noticeact data-t="mac.notice.sharing-off.act"></button>', '<button type="button" class="am-btn" data-t="common.notnow"></button>'), MAC, ["mac-glass, sharing-off", "Expected: 1"]),
    ("10g", "a text of the app written straight into its menu", MOCKUP, swap('<span data-t="mac.menu.quit"></span>', "<span>Sair do Alumia</span>"), spec("no text of the product"), ["Sair do Alumia"]),
    ("10h", "a colour written by hand in the app's stylesheet", MOCKUP, swap(".am-btn--danger { color: var(--al-mac-danger); }", ".am-btn--danger { color: #d33; }"), design, ["the product's stylesheet writes a colour by hand: color: #d33"]),
    ("10i", "small text of the app in a colour too faint to read", MOCKUP, swap(".am-note, .am-win small { font-size: 11px; color: var(--al-mac-label-secondary); }", ".am-note, .am-win small { font-size: 11px; color: var(--al-mac-separator); }"), READ, ["mac-glass ", "under 4.5:1"]),
    ("11a", "the function keys on show before Fn is asked for", MOCKUP, swap("...(extended ? KEYBOARD.extended : [])", "...KEYBOARD.extended"), KEYS, ["desktop: F1 before Fn"]),
    ("11c", "Caps Lock on and the letters still drawn small", MOCKUP, swap("key.textContent = caps && /^[a-z]$/.test(label) ? label.toUpperCase() : label;", "key.textContent = label;"), KEYS, ["desktop: capitals with Caps Lock on"]),
    ("11b", "two things to do where Tailscale's state is said", MOCKUP, swap('<button type="button" class="am-btn" data-al-ts="published">', '<button type="button" class="am-btn">'), MAC, ["mac-glass, ways-missing"]),
    # 12. What a field shows is painted too, and so is the reason beside an option that is off.
    ("12a", "what is typed in a field in a colour too faint to read", MOCKUP, after('<style id="al-product-css">\n', ".al input.al-input { color: var(--al-border-subtle); }\n"), READ, ["the field ", "under 4.5:1"]),
    ("12b", "the closed face of a list in a colour too faint to read", MOCKUP, after('<style id="al-product-css">\n', ".al select.al-select { color: var(--al-border-subtle); }\n"), READ, ["the list ", "under 4.5:1"]),
    ("12c", "the reason beside an option that is off, too faint to read", MOCKUP, after('<style id="al-product-css">\n', '.al [data-off] [data-al-slot="note"] { color: var(--al-border-subtle); }\n'), READ, [" row/", "under 4.5:1"]),
    ("10j", "a window of the app wider than the Mac's screen", MOCKUP, swap(".am-assist { width: 820px; height: 540px; flex-direction: row; }", ".am-assist { width: 1400px; height: 540px; flex-direction: row; }"), spec("in a window of 1440"), ["am-win am-assist reaches past the frame"]),
    # 13. The mockup carries the sources (docs/design/words.json, docs/design/glyphs/) as they are.
    ("13a", "a text changed in the mockup's dictionary alone, away from docs/design/words.json", MOCKUP, swap('"signin.keep": "Manter conectado neste navegador",', '"signin.keep": "Manter conectado neste navegador.",'), design, ["the text signin.keep is not what docs/design/words.json says"]),
    ("13b", "a glyph redrawn in the mockup alone, away from its file in docs/design/glyphs/", MOCKUP, swap('<symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>', '<symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-6"/></symbol>'), design, ["the glyph check is not docs/design/glyphs/check.svg"]),
]


def prove(identity, what, path, plant, check, words):
    before = fingerprint(path)
    original = path.read_bytes()
    started = time.monotonic()
    try:
        text = original.decode("utf-8")
        planted = plant(text)
        assert planted != text, "the defect was not planted"
        path.write_text(planted, encoding="utf-8")
        code, said = check()
    finally:
        path.write_bytes(original)
    restored = fingerprint(path) == before
    missing = [word for word in words if word not in said]
    proved = code != 0 and not missing and restored
    line = next((line.strip() for line in said.splitlines() if words[-1] in line), "")
    print(f"{'PROVED    ' if proved else 'NOT PROVED'} {identity}  {what}", flush=True)
    print(f"    exit {code}; restored {restored} ({before[:12]}); {time.monotonic() - started:.0f} s; {line[:200]}", flush=True)
    if not proved:
        for word in missing:
            print(f"    the check did not say: {word}")
        print(said[-2000:])
    return proved


def anchors():
    """After code moved: every defect still finds its place, and planting it changes the file."""
    lost = 0
    for identity, what, path, plant, _check, _words in PROOFS:
        text = path.read_text(encoding="utf-8")
        try:
            assert plant(text) != text, "planting it changes nothing"
        except AssertionError as why:
            lost += 1
            print(f"LOST {identity}  {what}: {why}")
    print(f"{len(PROOFS) - lost} of {len(PROOFS)} defects find their place")
    sys.exit(1 if lost else 0)


def main():
    # Asked to end, leave as an exception does, so that `finally` puts the file back.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    if not MOCKUP.is_file():
        sys.exit(f"refute-mockup: {MOCKUP.relative_to(ROOT)} is not in this tree, and every proof here plants a defect in it")
    if sys.argv[1:] == ["--anchors"]:
        anchors()
    wanted = sys.argv[1:]
    chosen = [proof for proof in PROOFS if not wanted or any(proof[0].startswith(prefix) for prefix in wanted)]
    if not chosen:
        sys.exit(f"no proof has an id that starts with {', '.join(wanted)}")
    identities = [proof[0] for proof in PROOFS]
    assert len(identities) == len(set(identities)), "two proofs share an id"
    for name, check in (("tools/check-design.py", design), ("tools/contrast.py", pairs)):
        code, said = check()
        if code != 0:
            sys.exit(f"{name} fails before anything is planted, so nothing can be proved:\n{said[-1500:]}")
    started = time.monotonic()
    proved = [prove(*proof) for proof in chosen]
    print(f"\n{sum(proved)} of {len(proved)} proved in {(time.monotonic() - started) / 60:.1f} min")
    for path in (MOCKUP, TOKENS, ERRORS):
        print(f"    {fingerprint(path)[:12]}  {path.relative_to(ROOT)}")
    sys.exit(0 if all(proved) else 1)


if __name__ == "__main__":
    main()
