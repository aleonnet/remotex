#!/usr/bin/env python3
"""The structured sources of the interface's words and glyphs, and the mockup held to them.

The words the page and the Mac app say, in both languages, are docs/design/words.json: one
entry a key, with its pt-BR and its en-US text side by side, in the order the page's
dictionaries have them. The glyphs the page draws are docs/design/glyphs/<name>.svg: one
file a glyph, on Lucide's 24-point grid, holding the drawing as its sheet of origin wrote it.
tools/product-words.py, tools/app-words.py, tools/product-glyphs.py, tools/check-design.py
and packaging/build-mac-dmg.sh read those two and nothing else.

The mockup (docs/mockups/) is where a text is read, argued over and approved, and where a
glyph is first drawn; it is a document, and a consumer of the sources: it carries copies of
the two dictionaries and of the glyphs, and tools/check-design.py holds those copies to the
sources. It is not read as a source by anything, so a tree without docs/mockups (the public
copy) generates, builds and checks the same.

    uv run --no-project python tools/mockup_sources.py --extract
        write words.json and glyphs/ from the sheets: the step that promotes what was
        approved in the mockup to the sources
    uv run --no-project python tools/mockup_sources.py --refresh
        write the mockup's two dictionaries from words.json, so a text changed in the
        source reaches the sheet without retyping
    uv run --no-project python tools/mockup_sources.py --check
        each text and each glyph the sheets differ in from the sources, or that the mockup
        is not in this tree

Fifteen glyphs are drawn on two sheets; the copies differ in a space before `/>` and in
nothing else (measured 2026-10-09), so a drawing is compared with its whitespace taken out,
and extracted from the one sheet each glyph is bound to below.
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MOCKUP = ROOT / "docs/mockups/2026-10-03-0233-prancha-alumia.html"
LIST = ROOT / "docs/mockups/2026-10-04-1245-lista-monitores.html"
SECOND = ROOT / "docs/mockups/2026-10-06-2338-segunda-tela.html"
WORDS = ROOT / "docs/design/words.json"
GLYPHS = ROOT / "docs/design/glyphs"
LANGUAGES = ("pt-BR", "en-US")

WHAT = (
    "The words of the interface, in both languages, by key: the source the page's dictionaries "
    "(tools/product-words.py) and the Mac app's (tools/app-words.py) are written from, and that "
    "the mockup's own dictionaries are held to (tools/check-design.py). The keys are in the order "
    "the page's dictionaries have them. First written by tools/mockup_sources.py --extract from "
    "the approved mockup; edited here from then on, and sent back to the mockup with --refresh."
)

# The glyphs the page draws: Lucide's, from the mockup's sprite, and the product's own, drawn
# on Lucide's grid by the list's design and the second display's. Each is bound to the one
# sheet its drawing is taken from. Which glyph means what is the design system's table
# (docs/design/2026-10-03-0003-design-system.md, "Glifos").
LUCIDE = (
    "activity",
    "app-window",
    "arrow-left",
    "camera",
    "check",
    "chevron-right",
    "circle-alert",
    "circle-check",
    "clipboard",
    "command",
    "copy",
    "ellipsis",
    "eye",
    "eye-off",
    "grip-horizontal",
    "info",
    "keyboard",
    "lock",
    "log-out",
    "maximize",
    "mic",
    "minimize",
    "monitor",
    "pause",
    "play",
    "pointer",
    "power",
    "rotate-cw",
    "send",
    "settings",
    "triangle-alert",
    "volume-2",
    "volume-x",
    "x",
)
# A Mac's two modes, and whether a desktop's size follows the window: the list's design.
OWN = ("fit", "mode-mirror", "mode-virtual", "one-to-one")
# Where the second of two displays sits against the first: the second display's design.
PLACED = ("second-bottom", "second-left", "second-right", "second-top")
SHEET_OF = {
    **{name: MOCKUP for name in LUCIDE},
    **{name: LIST for name in OWN},
    **{name: SECOND for name in PLACED},
}

# A glyph's file: Lucide's own root, so the file opens in a browser as the glyph looks.
SVG_OPEN = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
)
SVG_CLOSE = "</svg>"


def relative(path):
    return path.relative_to(ROOT)


def words_in(html):
    """The mockup's two dictionaries, by language, in the order the mockup has them."""
    found = {}
    for language in LANGUAGES:
        block = re.search(rf'<script type="application/json" id="al-i18n-{language}">(.*?)</script>', html, re.S)
        if not block:
            sys.exit(f"mockup-sources: the mockup has no dictionary for {language}")
        found[language] = json.loads(block.group(1))
    return found


def glyph_in(html, name):
    """The drawing of one glyph as a sheet writes it inside its <symbol>, or None."""
    found = re.search(rf'<symbol id="i-{re.escape(name)}" viewBox="0 0 24 24">(.*?)</symbol>', html, re.S)
    return found.group(1).strip() if found else None


def same_drawing(one, other):
    """Whether two drawings are the same with their whitespace taken out."""

    def bare(drawing):
        return re.sub(r">\s+<", "><", re.sub(r"\s*/>", "/>", re.sub(r"\s+", " ", drawing.strip())))

    return bare(one) == bare(other)


def read_words():
    """The source: each key with its text in each language, in the source's order."""
    return json.loads(WORDS.read_text(encoding="utf-8"))["words"]


def by_language(words):
    """The source turned into one dictionary a language, as the generators want it."""
    return {language: {key: entry[language] for key, entry in words.items()} for language in LANGUAGES}


def read_glyph(name):
    """The drawing a glyph's file holds, between the root's tags."""
    text = (GLYPHS / f"{name}.svg").read_text(encoding="utf-8")
    opened = text.index(">", text.index("<svg")) + 1
    return text[opened:text.rindex(SVG_CLOSE)].strip()


def glyph_names():
    """The glyphs the sources have, by name."""
    return sorted(path.stem for path in GLYPHS.glob("*.svg"))


def words_text(words):
    """words.json as it is written: one entry a line, both languages side by side."""
    lines = ["{", f'  "$what": {json.dumps(WHAT)},', '  "words": {']
    entries = [
        f"    {json.dumps(key, ensure_ascii=False)}: "
        + "{"
        + ", ".join(f"{json.dumps(language)}: {json.dumps(entry[language], ensure_ascii=False)}" for language in LANGUAGES)
        + "}"
        for key, entry in words.items()
    ]
    lines.append(",\n".join(entries))
    lines += ["  }", "}", ""]
    return "\n".join(lines)


def dictionary_text(dictionary):
    """A dictionary as the mockup carries it: one entry a line, as it was written there."""
    body = ",\n".join(f"{json.dumps(key, ensure_ascii=False)}: {json.dumps(text, ensure_ascii=False)}" for key, text in dictionary.items())
    return "\n{\n" + body + "\n}\n"


def extract():
    html = MOCKUP.read_text(encoding="utf-8")
    found = words_in(html)
    first = found[LANGUAGES[0]]
    for language in LANGUAGES[1:]:
        if set(found[language]) != set(first):
            sys.exit(f"mockup-sources: the mockup's dictionaries do not have the same keys in {LANGUAGES[0]} and {language}")
    words = {key: {language: found[language][key] for language in LANGUAGES} for key in first}
    WORDS.write_text(words_text(words), encoding="utf-8")

    GLYPHS.mkdir(parents=True, exist_ok=True)
    sheets = {path: path.read_text(encoding="utf-8") for path in (MOCKUP, LIST, SECOND)}
    for name, sheet in sorted(SHEET_OF.items()):
        drawing = glyph_in(sheets[sheet], name)
        if drawing is None:
            sys.exit(f"mockup-sources: {relative(sheet)} has no glyph named {name}")
        (GLYPHS / f"{name}.svg").write_text(f"{SVG_OPEN}\n{drawing}\n{SVG_CLOSE}\n", encoding="utf-8")
    print(f"mockup-sources: {len(words)} texts in each language to {relative(WORDS)}, {len(SHEET_OF)} glyphs to {relative(GLYPHS)}/")
    return 0


def refresh():
    html = MOCKUP.read_text(encoding="utf-8")
    for language, dictionary in by_language(read_words()).items():
        html, count = re.subn(
            rf'(<script type="application/json" id="al-i18n-{language}">).*?(</script>)',
            lambda found: found.group(1) + dictionary_text(dictionary) + found.group(2),
            html,
            count=1,
            flags=re.S,
        )
        if count != 1:
            sys.exit(f"mockup-sources: the mockup has no dictionary for {language}")
    MOCKUP.write_text(html, encoding="utf-8")
    print(f"mockup-sources: the mockup's dictionaries are {relative(WORDS)}'s again")
    return 0


def drift():
    """Each way the sheets differ from the sources, as a sentence; nothing when they agree.
    Nothing too when the mockup is not in this tree: there is nothing to hold."""
    if not MOCKUP.is_file():
        return []
    said = []
    source = by_language(read_words())
    carried = words_in(MOCKUP.read_text(encoding="utf-8"))
    for language in LANGUAGES:
        for key in sorted(set(carried[language]) - set(source[language])):
            said.append(f"the text {key} is in the mockup's {language} dictionary and not in {relative(WORDS)}")
        for key in sorted(set(source[language]) - set(carried[language])):
            said.append(f"the text {key} is in {relative(WORDS)} and not in the mockup's {language} dictionary")
    for key in sorted(set(source[LANGUAGES[0]]) & set(carried[LANGUAGES[0]])):
        if any(source[language][key] != carried[language].get(key) for language in LANGUAGES):
            said.append(f"the text {key} is not what {relative(WORDS)} says")
    sheets = {}
    for name in glyph_names():
        sheet = SHEET_OF.get(name)
        if sheet is None:
            said.append(f"the glyph {name} is in {relative(GLYPHS)}/ and bound to no sheet in tools/mockup_sources.py")
            continue
        if sheet not in sheets:
            sheets[sheet] = sheet.read_text(encoding="utf-8") if sheet.is_file() else ""
        drawing = glyph_in(sheets[sheet], name)
        if drawing is None:
            said.append(f"the glyph {name} is not drawn in {relative(sheet)}")
        elif not same_drawing(drawing, read_glyph(name)):
            said.append(f"the glyph {name} is not {relative(GLYPHS)}/{name}.svg")
    for name in sorted(set(SHEET_OF) - set(glyph_names())):
        said.append(f"the glyph {name} is bound to a sheet and has no file in {relative(GLYPHS)}/")
    return said


def check():
    if not MOCKUP.is_file():
        print(f"mockup-sources: {relative(MOCKUP)} is not in this tree; there is nothing to hold to the sources")
        return 0
    said = drift()
    for sentence in said:
        print(f"FAIL mockup-sources: {sentence}")
    if said:
        print(f"{len(said)} failed")
        return 1
    print(f"mockup-sources: the mockup carries {relative(WORDS)} and {relative(GLYPHS)}/ as they are")
    return 0


def main():
    modes = {"--extract": extract, "--refresh": refresh, "--check": check}
    if len(sys.argv) != 2 or sys.argv[1] not in modes:
        sys.exit("usage: mockup_sources.py --extract | --refresh | --check")
    return modes[sys.argv[1]]()


if __name__ == "__main__":
    sys.exit(main())
