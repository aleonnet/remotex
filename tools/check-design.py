# What a reader of the design system cannot see by reading it: that the tokens, the error
# catalogue and the mockup still agree with each other and with the product's code.
#
# The tokens (docs/design/alumia.tokens.json):
#   - the hexadecimal beside a colour is the colour its OKLCH says;
#   - a Display P3 colour is a brand colour's own numbers read as P3, with that colour's
#     hexadecimal as the one shown where P3 is not;
#   - the light and dark themes name the same colours;
#   - every colour the contrast check is told to measure exists.
#
# The error catalogue (docs/design/errors.json):
#   - every place where the product shows a message has an entry, found again in the code
#     by the four searches below, so a place added to the product fails here until it has a
#     general code;
#   - no code is repeated, and each sits under its place's number;
#   - each code has a severity, says whether the user has something to do, and has its text
#     in both languages, with the same placeholders in each; so do the words a terminal's
#     message has for the Mac app, where it has them, and no other place's message has any;
#   - the snippet a place or a cause quotes is still in the file it names.
#
# The mockup (docs/mockups/), where it is in the tree: nothing fetched from anywhere, the
# tokens and the catalogue it carries are the tokens and the catalogue, no colour written by
# hand, one clock, and the two dictionaries and the glyphs it carries are docs/design/words.json's
# and docs/design/glyphs/'s (tools/mockup_sources.py). A tree without it (the public copy) is
# told so, and everything else is checked the same.
#
# The product (frontend/src), which is drawn from the design system:
#   - the tokens, the catalogue and the tab's icon it carries (frontend/src/design) are
#     what this tool writes, with --print-css, --print-errors and --print-favicon;
#   - its two dictionaries have the same keys, and a text docs/design/words.json also has is
#     that text, word for word; one the source has not, and a browser text of the source the
#     product does not use, is listed in docs/design/product-words.json, with why; and every
#     text of the dictionaries is used by some file of the page;
#   - a cause of the catalogue is written by the file the catalogue says it is born in,
#     the gateway's among them, and every cause the gateway names is in the catalogue;
#   - no message of the catalogue takes the original words of whoever failed into its
#     sentence;
#   - a label the gateway writes in English and the page says in its own words is still
#     written by the Rust the list names;
#   - its stylesheets (frontend/src/alumia.css, frontend/src/index.css) write no colour
#     by hand.
#
# The terminal (the commands, their help and the `alumia tui` panel), which says an error
# by the catalogue and everything else by docs/design/terminal-words.json (src/words.rs):
#   - an error born in one of the terminal's files names its cause in the statement that
#     writes its sentence, or is listed in the dictionary's `kept`, with why it is told by
#     the general sentence of the command that failed;
#   - a command writes nothing for a person with words of its own: what it prints comes
#     from src/words.rs;
#   - the dictionary has every text in both languages, with the same placeholders, and
#     every text of it is said by some file of the gateway;
#   - no cause of the terminal is named in a file that sends messages to a browser, whose
#     catalogue does not carry the terminal's.
#
# Run: uv run --no-project python tools/check-design.py

import json
import pathlib
import re
import sys

import contrast
import mockup_sources

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKENS = ROOT / "docs/design/alumia.tokens.json"
ERRORS = ROOT / "docs/design/errors.json"
# The mockup in force. An earlier one stays beside it, to be compared with, and is not held
# to tokens and a catalogue that have moved on since.
MOCKUP = ROOT / "docs/mockups/2026-10-03-0233-prancha-alumia.html"
# What the product carries of the design system, and its own stylesheet and words.
PRODUCT = ROOT / "frontend/src"
PRODUCT_TOKENS = PRODUCT / "design/tokens.css"
PRODUCT_ERRORS = PRODUCT / "design/errors.json"
PRODUCT_FAVICON = PRODUCT / "design/favicon.svg"
PRODUCT_CSS = (PRODUCT / "alumia.css", PRODUCT / "index.css")
# What the page's dictionaries hold that is not simply the source's browser texts: a text
# of the product's own, a text of the source the product does not use, each with why, and
# the labels the gateway writes in English. A text listed there that the source gains, or
# the product loses, fails: the list is not a place to leave things.
PRODUCT_WORDS = ROOT / "docs/design/product-words.json"
SOURCE_WORDS = "docs/design/words.json"
# A cause the gateway names beside an error it sends: the catalogue's code, written out.
GATEWAY_CODE = re.compile(r'"(AL-\d{4})"')
# The Mac app's texts in the source: the second part of the mockup, and not the page's.
MAC_WORDS = "mac."

LANGUAGES = ("pt-BR", "en-US")
SEVERITIES = ("info", "warning", "error")
THEMED = (("color.light", "color.dark"), ("color.mac.light", "color.mac.dark"))

# Where the page shows a message. The place writes its own general code out:
# `place="AL-1200"` on a component that shows a message, or `message("AL-1100")` for the
# catalogue's words alone. Those are the only two ways a screen can get at the catalogue's
# words (frontend/src/preferences.tsx: `t` takes no code), and a place written as anything
# but a general code fails here, so the search reaches every one of them.
PAGE_PLACE = re.compile(r'\bplace="AL-\d{2}00"|\bmessage\("AL-\d{2}00"')
# The general code such a place names for itself.
NAMED_PLACE = re.compile(r'(?:\bplace=|\bmessage\()"(AL-\d{2}00)"')
# A place this search could not read: a variable, or a code that is not a general one.
UNREADABLE_PLACE = re.compile(r'\bplace=(?!"AL-\d{2}00")|\bmessage\((?!"AL-\d{2}00")')
# The components that take a place from whoever uses them and pass it on: what they hold
# is the parameter, and the place is written where they are used.
PLACE_TAKERS = ("Message.tsx", "Notice.tsx")
# An error sent to the browser. Lines that read one (`=>`, `let ServerMsg`) are not sites,
# and neither is anything from a file's tests on.
SERVER_PLACE = "ServerMsg::Error {"
SERVER_READS = ("=>", "let ServerMsg")
TESTS_START = re.compile(r"^\s*mod tests \{")
HTTP_PLACE = re.compile(r"^\s*AppError::\w+(\([^)]*\))? =>")
CLOSE_PLACE = re.compile(r"^const CLOSE_\w+: u16 = \d+;")
# What a command tells whoever ran it: an error, by the general code of the command.
TERMINAL_PLACE = re.compile(r'\bwords::(?:tell(?:_in|_line)?|told_to_app)\([^"]*"AL-\d{2}00"')
# The kinds of place whose messages a browser shows. The page and the mockup carry these,
# and not what a terminal says.
BROWSER_KINDS = ("page", "page-by-hand", "server", "http", "close")
# The terminal's own texts, and the files whose sentences are a person's to read at one.
TERMINAL_WORDS = ROOT / "docs/design/terminal-words.json"
TERMINAL_FILES = (
    "src/main.rs",
    "src/cli.rs",
    "src/app.rs",
    "src/config.rs",
    "src/auth.rs",
    "src/throughput.rs",
    "src/hevc_wasm.rs",
    "src/assets.rs",
    "src/embedded.rs",
    "src/embedded/manager.rs",
    "src/embedded/transport.rs",
    "src/embedded/owner_only.rs",
)
# The engines: what connects to a remote computer and carries its session, and what
# prepares its picture. Every file of the Windows client is one too (`engine_files`).
ENGINE_FILES = (
    "src/engine.rs",
    "src/vnc.rs",
    "src/vnc_apple.rs",
    "src/vnc_apple_media.rs",
    "src/vnc_apple_clipboard.rs",
    "src/vnc_audio.rs",
    "src/vnc_camera.rs",
    "src/vnc_clipboard.rs",
    "src/vnc_encodings.rs",
    "src/vnc_mic.rs",
    "src/vnc_record.rs",
    "src/vnc_rsa_aes.rs",
    "src/rdp.rs",
    "src/encode.rs",
    "src/stream.rs",
    "src/video.rs",
    "src/vp9.rs",
    "src/protocol.rs",
)
# Where an engine writes an error's sentence: as anywhere, and besides in an `io::Error` it
# builds and in a type of error's own words, neither of which can carry a cause and each of
# which is told by its kind where the page is told.
ENGINE_SITE = re.compile(
    r"\b(?:bail|ensure)(?:_known)?!\(|\banyhow!\(|\.(?:context|with_context)\(|\bio::Error::new\(|#\[error\("
)
# Where an error's sentence is written, and where a command prints.
ERROR_SITE = re.compile(r"\b(?:bail|ensure)(?:_known)?!\(|\banyhow!\(|\.(?:context|with_context)\(")
PRINT_SITE = re.compile(r"\be?print(?:ln)?!\(")
# The texts no file spells the key of: a command's help and each of its arguments' are
# asked for by the name clap has for each, made where this line is. src/cli.rs's own test
# holds them to the commands and arguments there are, both ways, which this cannot see.
NAMED_TEXTS = ("cli.", 'format!("cli.{}", sub.get_name())')
RUST_STRING = re.compile(r'"(?:[^"\\]|\\.)*"', re.S)
TERMINAL_CODE = re.compile(r'"AL-9[4-9]\d\d"')

failures = []


def fail(message):
    failures.append(message)


def squeeze(text):
    """Text with every run of whitespace as one space, so a snippet may span lines."""
    return " ".join(text.split())


# -- the tokens ---------------------------------------------------------------------------


def colours(node, path=""):
    """Every colour value in the tokens, with the path it was found at."""
    if isinstance(node, dict):
        if "colorSpace" in node:
            yield path, node
            return
        for key, child in node.items():
            if key != "$extensions":
                yield from colours(child, f"{path}.{key}" if path else key)


def lookup(tokens, path):
    node = tokens
    for key in path.split("."):
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node


def check_tokens():
    tokens = json.loads(TOKENS.read_text(encoding="utf-8"))
    found = 0
    for path, value in colours(tokens):
        found += 1
        where = path.removesuffix(".$value")
        written = value.get("hex")
        if not isinstance(written, str) or not re.fullmatch(r"#[0-9A-F]{6}", written):
            fail(f"tokens: {where} has no hexadecimal written as #RRGGBB")
            continue
        if value["colorSpace"] == "oklch":
            meant = contrast.to_hex(contrast.oklch_to_srgb(*value["components"]))
            if meant != written:
                fail(f"tokens: {where} says {written} and its OKLCH is {meant}")
        elif value["colorSpace"] == "display-p3":
            name = where.rsplit(".", 1)[-1]
            sibling = lookup(tokens, f"color.brand.{name}")
            if not where.startswith("color.brand.p3.") or sibling is None:
                fail(f"tokens: {where} is Display P3 and is not a brand colour's wide-gamut twin")
                continue
            if sibling["$value"]["hex"] != written:
                fail(f"tokens: {where} falls back to {written}, and color.brand.{name} is {sibling['$value']['hex']}")
            same = contrast.hex_to_srgb(written)
            if any(abs(a - b) > 0.0005 for a, b in zip(value["components"], same)):
                fail(f"tokens: {where} is not color.brand.{name}'s own numbers read as Display P3")
        else:
            fail(f"tokens: {where} is in {value['colorSpace']}, and colours here are OKLCH")

    for first, second in THEMED:
        names = [
            {path.removeprefix(theme + ".").removesuffix(".$value") for path, _ in colours(lookup(tokens, theme), theme)}
            for theme in (first, second)
        ]
        for missing in sorted(names[0] ^ names[1]):
            fail(f"tokens: {missing} is in one of {first} and {second} and not in the other")

    checks = tokens["$extensions"][contrast.EXTENSION]
    named = [path for pair in checks["pairs"] for path in (pair["fg"], pair["bg"], pair.get("over")) if path]
    named += [path for chart in checks["charts"] for path in chart["colours"] + chart["surfaces"]]
    for path in sorted(set(named)):
        node = lookup(tokens, path)
        if node is None or "colorSpace" not in node.get("$value", {}):
            fail(f"tokens: the contrast check names {path}, which is not a colour")
    print(f"tokens: {found} colours")


# -- the error catalogue ------------------------------------------------------------------


def sources(folder, suffixes):
    return sorted(
        path
        for path in (ROOT / folder).rglob("*")
        if path.suffix in suffixes and ".test." not in path.name
    )


def gateway_code(path):
    """A file of the gateway's up to its tests: what runs, and not what is asserted about it."""
    kept = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if TESTS_START.match(line):
            break
        kept.append(line)
    return "\n".join(kept)


def places_in_code():
    """Each place the product shows a message at, as (kind, file, line number, line)."""
    for path in sources("frontend/src", (".ts", ".tsx")):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if PAGE_PLACE.search(line):
                yield "page", path, number, line.strip()
    for path in sources("src", (".rs",)):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if TESTS_START.match(line):
                break
            if SERVER_PLACE in line and not any(read in line for read in SERVER_READS):
                yield "server", path, number, line.strip()
            if TERMINAL_PLACE.search(line):
                yield "terminal", path, number, line.strip()
    for kind, name, pattern in (("http", "src/error.rs", HTTP_PLACE), ("close", "src/ws.rs", CLOSE_PLACE)):
        path = ROOT / name
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if pattern.match(line):
                yield kind, path, number, line.strip()


def quoted(file, snippet, what):
    """Whether `snippet` is still in `file`, failing with `what` when it is not."""
    path = ROOT / file
    if not path.is_file():
        fail(f"errors: {what} names {file}, which does not exist")
        return False
    if not snippet or squeeze(snippet) not in squeeze(path.read_text(encoding="utf-8")):
        fail(f"errors: {what} quotes a snippet that is no longer in {file}: {snippet!r}")
        return False
    return True


def check_code(entry, what, seen):
    code = entry.get("code", "")
    if not re.fullmatch(r"AL-\d{4}", code):
        fail(f"errors: {what} has the code {code!r}, which is not AL- and four digits")
    elif code in seen:
        fail(f"errors: the code {code} is used by {seen[code]} and by {what}")
    else:
        seen[code] = what
    if entry.get("severity") not in SEVERITIES:
        fail(f"errors: {code} has the severity {entry.get('severity')!r}")
    if not isinstance(entry.get("user_action"), bool):
        fail(f"errors: {code} does not say whether the user has something to do")
    # `app` is the same message as the Mac app is told it, where a terminal's words for
    # it are a file's key or a command's option: held as the text is.
    for field in ("text", "button", "app"):
        words = entry.get(field)
        if words is None and field != "text":
            continue
        if not isinstance(words, dict) or set(words) != set(LANGUAGES) or not all(words.values()):
            fail(f"errors: {code} does not have its {field} in exactly {' and '.join(LANGUAGES)}")
            continue
        holes = [sorted(set(re.findall(r"\{(\w+)\}", words[language]))) for language in LANGUAGES]
        if holes[0] != holes[1]:
            fail(f"errors: {code} has different placeholders in each language: {holes[0]} and {holes[1]}")
    return code


def check_catalogue():
    catalogue = json.loads(ERRORS.read_text(encoding="utf-8"))
    seen, ids, snippets = {}, set(), set()
    listed = {}
    by_hand = in_app = 0
    for place in catalogue["places"]:
        name = place.get("id", "?")
        if name in ids:
            fail(f"errors: the place {name} is listed twice")
        ids.add(name)
        kind, file = place.get("kind"), place.get("file", "")
        quoted(file, place.get("snippet"), f"the place {name}")
        if (file, squeeze(place.get("snippet") or "")) in snippets:
            fail(f"errors: the place {name} quotes the same snippet as another place in {file}")
        snippets.add((file, squeeze(place.get("snippet") or "")))
        if kind in ("page-by-hand", "app"):
            # The Mac app's places are listed by hand, each by a snippet of where it is
            # said: tools/app-words.py holds the app to its codes.
            by_hand += kind == "page-by-hand"
            in_app += kind == "app"
            if place.get("match") is not None:
                fail(f"errors: the place {name} is listed by hand and names a line to search for")
        elif kind in ("page", "server", "http", "close", "terminal"):
            listed.setdefault((kind, file, place.get("match")), []).append(name)
            for other in place.get("also", []):
                quoted(other.get("file", ""), other.get("snippet"), f"the place {name}")
                listed.setdefault((kind, other.get("file", ""), other.get("match")), []).append(name)
        else:
            fail(f"errors: the place {name} has the kind {kind!r}")

        general = place.get("general")
        if not isinstance(general, dict):
            fail(f"errors: the place {name} has no general code")
            continue
        code = check_code(general, f"the place {name}", seen)
        if not code.endswith("00"):
            fail(f"errors: {code} is the general code of {name} and does not end in 00")
        named = NAMED_PLACE.search(place.get("match") or "")
        if named and named.group(1) != code:
            fail(f"errors: the place {name} is {code}, and the line it names says {named.group(1)}")
        for cause in place.get("causes", []):
            own = check_code(cause, f"a cause of {name}", seen)
            if own[:5] != code[:5] or own.endswith("00"):
                fail(f"errors: {own} is a cause of {name} and is not numbered under {code}")
            origin = cause.get("origin", {})
            quoted(origin.get("file", ""), origin.get("snippet"), own)
        # Only what a terminal says has other words for the app: a browser's messages
        # are the page's, and the app's own are already its own.
        for entry in [general, *place.get("causes", [])]:
            if "app" in entry and kind != "terminal":
                fail(f"errors: {entry.get('code')} has words for the Mac app, and its place is not a terminal's")

    for path in sources("frontend/src", (".ts", ".tsx")):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            taker = path.name in PLACE_TAKERS and not PAGE_PLACE.search(line)
            if UNREADABLE_PLACE.search(line) and not taker and not line.lstrip().startswith(("//", "*", "/*")):
                fail(
                    f"errors: {path.relative_to(ROOT)}:{number} shows a message at a place that is not a "
                    f"general code written out: {line.strip()}"
                )

    counted = {}
    lines = {}
    for kind, path, number, line in places_in_code():
        key = (kind, str(path.relative_to(ROOT)), line)
        counted[key] = counted.get(key, 0) + 1
        lines.setdefault(key, []).append(number)
    for key in sorted(set(counted) | set(listed), key=str):
        kind, file, line = key
        in_code, in_catalogue = counted.get(key, 0), len(listed.get(key, []))
        if in_code > in_catalogue:
            where = ", ".join(f"{file}:{number}" for number in lines[key])
            fail(
                f"errors: a place with no general code. {in_code} in the code ({where}) and "
                f"{in_catalogue} in the catalogue: {line}"
            )
        elif in_catalogue > in_code:
            fail(
                f"errors: {', '.join(listed[key])} name a line found {in_code} times in {file}: {line}"
            )
    totals = {
        kind: sum(n for (k, _, _), n in counted.items() if k == kind)
        for kind in ("page", "server", "http", "close", "terminal")
    }
    print(
        f"errors: {len(seen)} codes; places in the code: {totals['page']} on the page by search "
        f"and {by_hand} by hand, {totals['server']} sent by the server, {totals['http']} HTTP "
        f"answers, {totals['close']} close codes, {totals['terminal']} told at a terminal, "
        f"{in_app} in the Mac app"
    )


# -- the mockup ---------------------------------------------------------------------------


def kebab(name):
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "-", name).lower()


def number(value):
    return f"{value:g}"


def css_value(kind, value):
    """A token's value as the mockup's stylesheet writes it."""
    if kind == "color":
        parts = " ".join(number(c) for c in value["components"])
        alpha = f" / {number(value['alpha'])}" if "alpha" in value else ""
        if value["colorSpace"] == "oklch":
            return f"oklch({parts}{alpha})"
        return f"color({value['colorSpace']} {parts}{alpha})"
    if kind in ("dimension", "duration"):
        return f"{number(value['value'])}{value['unit']}"
    if kind == "cubicBezier":
        return f"cubic-bezier({', '.join(number(n) for n in value)})"
    if kind == "fontFamily":
        families = value if isinstance(value, list) else [value]
        return ", ".join(f'"{name}"' if " " in name else name for name in families)
    if kind == "shadow":
        lengths = " ".join(css_value("dimension", value[side]) for side in ("offsetX", "offsetY", "blur", "spread"))
        return f"{lengths} {css_value('color', value['color'])}"
    return number(value)


# Where a themed group's tokens land: one name, with the value its theme gives it.
THEMES = {
    "color.light.": ("light", ""),
    "color.dark.": ("dark", ""),
    "color.mac.light.": ("light", "mac-"),
    "color.mac.dark.": ("dark", "mac-"),
    "shadow.light.": ("light", "shadow-"),
    "shadow.dark.": ("dark", "shadow-"),
}
# The theme is an attribute any element may carry, so a part of the page that is always the
# unlit glass can be dark inside a light page.
BLOCKS = {"all": ":root", "light": '[data-al-theme="light"]', "dark": '[data-al-theme="dark"]'}


def css_variables(tokens):
    """The custom properties the tokens stand for, by the block each belongs in."""
    blocks = {name: {} for name in BLOCKS}

    def walk(node, path, kind):
        kind = node.get("$type", kind)
        if "$value" in node:
            block, name = "all", path
            for prefix, (theme, short) in THEMES.items():
                if path.startswith(prefix):
                    block, name = theme, short + path.removeprefix(prefix)
            blocks[block]["--al-" + "-".join(kebab(part) for part in name.split("."))] = css_value(kind, node["$value"])
            return
        for key, child in node.items():
            if not key.startswith("$") and isinstance(child, dict):
                walk(child, f"{path}.{key}" if path else key, kind)

    walk(tokens, "", None)
    return blocks


def css_text():
    """The tokens as a stylesheet: what --print-css writes, and what the product carries."""
    blocks = css_variables(json.loads(TOKENS.read_text(encoding="utf-8")))
    lines = []
    for name, selector in BLOCKS.items():
        lines.append(f"{selector} {{")
        lines += [f"  {variable}: {value};" for variable, value in blocks[name].items()]
        lines.append("}")
    return "\n".join(lines) + "\n"


def errors_text():
    """The catalogue as the page carries it: what --print-errors writes."""
    return json.dumps(catalogue_for_mockup(), ensure_ascii=False, separators=(",", ":")) + "\n"


def catalogue_for_mockup():
    """What the mockup carries of the catalogue: each code a browser shows, and what it says."""
    catalogue = json.loads(ERRORS.read_text(encoding="utf-8"))
    carried = {}
    for place in catalogue["places"]:
        if place.get("kind") not in BROWSER_KINDS:
            continue
        for entry in [place["general"], *place["causes"]]:
            carried[entry["code"]] = {
                key: entry[key] for key in ("severity", "user_action", "text", "button") if key in entry
            }
    return carried


# The words CSS takes as a colour. `transparent` and `currentColor` are not among them:
# neither is a colour somebody chose.
NAMED_COLOURS = set(
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown "
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan "
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid "
    "darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet "
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro "
    "ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki "
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow "
    "lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray "
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine "
    "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise "
    "mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab "
    "orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru "
    "pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown "
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan "
    "teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split()
)
COLOUR_FUNCTION = re.compile(r"\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(")
HEX_COLOUR = re.compile(r"#[0-9a-fA-F]{3,8}\b")
VARIABLE = re.compile(r"var\(\s*--[\w-]+")
EXTERNAL = (
    (re.compile(r"<(?!a\b)\w+\b[^>]*\b(?:src|href|poster|data|action|srcset)\s*=\s*[\"']?\s*(?:https?:)?//", re.I), "a resource from another address"),
    (re.compile(r"url\(\s*[\"']?\s*(?:https?:)?//", re.I), "a url() to another address"),
    (re.compile(r"@import\b"), "an @import"),
    (re.compile(r"\bfetch\s*\("), "a fetch()"),
    (re.compile(r"\bimport\s*\("), "an import()"),
    (re.compile(r"\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b"), "a network interface"),
)
LITERAL_VECTOR = re.compile(r"\bvec[34]\s*\(\s*[-+]?\d*\.?\d+\s*(?:,\s*[-+]?\d*\.?\d+\s*){2,3}\)")


def written_colour(value):
    """The first colour written by hand in a CSS value, or None when it uses none."""
    bare = VARIABLE.sub("", value)
    found = HEX_COLOUR.search(bare) or COLOUR_FUNCTION.search(bare)
    if found:
        return found.group(0)
    for word in re.findall(r"(?<![\w-])[a-zA-Z]+(?![\w(-])", bare):
        if word.lower() in NAMED_COLOURS:
            return word
    return None


def block(html, kind, name):
    """The inside of the <style> or <script> block with this id, failing when it is not there."""
    found = re.search(rf'<{kind}\b[^>]*\bid="{re.escape(name)}"[^>]*>(.*?)</{kind}>', html, re.S)
    if not found:
        fail(f"mockup: there is no <{kind} id=\"{name}\"> block")
        return ""
    return found.group(1)


def declarations(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    return re.findall(r"([\w-]+)\s*:\s*([^;{}]+)[;}]", css)


def check_mockup():
    if not MOCKUP.is_file():
        print(f"mockup: {MOCKUP.relative_to(ROOT)} is not in this tree; its checks are skipped")
        return
    html = MOCKUP.read_text(encoding="utf-8")

    # Nothing from anywhere else: it works with the network off.
    for pattern, what in EXTERNAL:
        for found in pattern.finditer(html):
            line = html.count("\n", 0, found.start()) + 1
            fail(f"mockup: line {line} has {what}: {squeeze(found.group(0))[:80]}")

    # The tokens it carries are the tokens.
    expected = css_variables(json.loads(TOKENS.read_text(encoding="utf-8")))
    carried = block(html, "style", "al-tokens")
    for name, selector in BLOCKS.items():
        found = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", carried)
        if not found:
            fail(f"mockup: the token block has no rule for {selector}")
            continue
        written = {variable: squeeze(value) for variable, value in re.findall(r"(--al-[\w-]+)\s*:\s*([^;]+);", found.group(1))}
        for variable in sorted(set(written) | set(expected[name])):
            if written.get(variable) != expected[name].get(variable):
                fail(
                    f"mockup: {variable} under {selector} is {written.get(variable, 'not there')}, "
                    f"and the tokens say {expected[name].get(variable, 'nothing of it')}"
                )

    # The product's own stylesheet takes every colour from them.
    for name, value in declarations(block(html, "style", "al-product-css")):
        colour = written_colour(value)
        if colour:
            fail(f"mockup: the product's stylesheet writes a colour by hand: {name}: {squeeze(value)[:70]} ({colour})")

    # So does the product's markup, the picture of the remote screen aside: that is scenery.
    product = re.search(r"<!-- al:product -->(.*?)<!-- /al:product -->", html, re.S)
    if not product:
        fail("mockup: the product is not marked with <!-- al:product --> and <!-- /al:product -->")
        markup = ""
    else:
        markup = re.sub(r"<!-- al:scenery -->.*?<!-- /al:scenery -->", "", product.group(1), flags=re.S)
    for attribute, value in re.findall(r'\b(fill|stroke|stop-color|flood-color|color)\s*=\s*"([^"]*)"', markup):
        if value not in ("none", "currentColor") and not value.startswith("var(--al-"):
            fail(f'mockup: the product has {attribute}="{value}", which is not none, currentColor or a token')
    for value in re.findall(r'\bstyle\s*=\s*"([^"]*)"', markup):
        colour = written_colour(value)
        if colour:
            fail(f'mockup: the product has style="{value[:60]}", with a colour written by hand ({colour})')

    # A shader takes its colours as uniforms: no vector of three or four written numbers.
    shaders = re.findall(r'<script\b[^>]*\btype="x-shader/[\w-]+"[^>]*\bid="([\w-]+)"[^>]*>(.*?)</script>', html, re.S)
    if not shaders:
        fail("mockup: there is no shader block")
    for name, source in shaders:
        for found in LITERAL_VECTOR.finditer(source):
            fail(f"mockup: the shader {name} writes a vector of numbers: {found.group(0)}")

    # One clock: nothing repeats on a timer, and only the clock asks for a frame.
    clock = block(html, "script", "al-clock")
    scripts = re.findall(r"<script\b(?![^>]*\btype=\"(?:application/json|x-shader/[\w-]+)\")[^>]*>(.*?)</script>", html, re.S)
    for source in scripts:
        if "setInterval" in source:
            fail("mockup: a script uses setInterval, and all motion goes through the one clock")
        if "requestAnimationFrame" in source and source != clock:
            fail("mockup: a script other than the clock asks for an animation frame")
    product_script = block(html, "script", "al-product-js")
    for source, name in ((product_script, "al-product-js"), (clock, "al-clock")):
        found = HEX_COLOUR.search(source) or COLOUR_FUNCTION.search(source)
        if found:
            fail(f"mockup: the script {name} writes a colour by hand: {found.group(0)}")

    # Both languages say the same things, and nothing asks for a text that is not there.
    words = {}
    for language in LANGUAGES:
        try:
            words[language] = json.loads(block(html, "script", f"al-i18n-{language}") or "{}")
        except json.JSONDecodeError as error:
            fail(f"mockup: the {language} dictionary is not JSON: {error}")
            words[language] = {}
    first, second = (words[language] for language in LANGUAGES)
    for key in sorted(set(first) ^ set(second)):
        fail(f"mockup: the text {key} is in one of {' and '.join(LANGUAGES)} and not in the other")
    for key in sorted(set(first) & set(second)):
        holes = [sorted(set(re.findall(r"\{(\w+)\}", words[language][key]))) for language in LANGUAGES]
        if not first[key] or not second[key]:
            fail(f"mockup: the text {key} is empty in a language")
        elif holes[0] != holes[1]:
            fail(f"mockup: the text {key} has different placeholders in each language")

    # The catalogue it carries is the catalogue.
    try:
        codes = json.loads(block(html, "script", "al-errors") or "{}")
    except json.JSONDecodeError as error:
        fail(f"mockup: the error catalogue it carries is not JSON: {error}")
        codes = {}
    if codes != catalogue_for_mockup():
        fail("mockup: the error catalogue it carries differs from docs/design/errors.json (see --print-errors)")

    asked = set(re.findall(r'\bdata-t(?:-(?:title|aria-label|placeholder|alt))?="([^"]+)"', html))
    asked |= set(re.findall(r'\bt\(\s*"([^"]+)"', "\n".join(scripts)))
    for key in sorted(asked):
        if key not in first and key not in codes:
            fail(f"mockup: something asks for the text {key}, which no dictionary has")

    # The dictionaries and the glyphs it carries are the sources', and nothing drifted.
    for said in mockup_sources.drift():
        fail(f"mockup: {said}")
    print(f"mockup: {len(first)} texts in each language, {len(shaders)} shader blocks, {len(codes)} codes carried")


def favicon_text():
    """The tab's icon: the mark at 16 px, three bars of 4 px on the unlit glass, in the
    brand's colours. An image file cannot take a token, so it is written from them."""
    brand = json.loads(TOKENS.read_text(encoding="utf-8"))["color"]["brand"]
    glass, red, green, blue = (brand[name]["$value"]["hex"] for name in ("glass", "red", "green", "blue"))
    bars = "".join(
        f'<rect x="{x}" y="3" width="4" height="10" rx="1" fill="{colour}"/>'
        for x, colour in ((2, red), (6, green), (10, blue))
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
        f'<rect width="16" height="16" rx="3" fill="{glass}"/>{bars}</svg>\n'
    )


# -- the product --------------------------------------------------------------------------


def holes(text):
    return sorted(set(re.findall(r"\{(\w+)\}", text)))


def check_product():
    carried = (
        (PRODUCT_TOKENS, css_text(), "--print-css"),
        (PRODUCT_ERRORS, errors_text(), "--print-errors"),
        (PRODUCT_FAVICON, favicon_text(), "--print-favicon"),
    )
    for path, meant, flag in carried:
        name = path.relative_to(ROOT)
        if not path.is_file():
            fail(f"product: {name} does not exist (write it with {flag})")
        elif path.read_text(encoding="utf-8") != meant:
            fail(f"product: {name} is not what {flag} writes")

    for sheet in PRODUCT_CSS:
        for name, value in declarations(sheet.read_text(encoding="utf-8")):
            colour = written_colour(value)
            if colour:
                fail(f"product: {sheet.relative_to(ROOT)} writes a colour by hand: {name}: {squeeze(value)[:70]} ({colour})")

    listed = json.loads(PRODUCT_WORDS.read_text(encoding="utf-8"))
    own, unused = listed["own"], listed["unused"]
    words = {language: json.loads((PRODUCT / f"words/{language}.json").read_text(encoding="utf-8")) for language in LANGUAGES}
    source = mockup_sources.by_language(mockup_sources.read_words())
    first, second = (words[language] for language in LANGUAGES)
    for key in sorted(set(first) ^ set(second)):
        fail(f"product: the text {key} is in one of {' and '.join(LANGUAGES)} and not in the other")
    for key in sorted(set(first) & set(second)):
        if not first[key] or not second[key]:
            fail(f"product: the text {key} is empty in a language")
        elif holes(first[key]) != holes(second[key]):
            fail(f"product: the text {key} has different placeholders in each language")
        for language in LANGUAGES:
            said = source[language].get(key)
            if said is None:
                if key not in own:
                    fail(f"product: the text {key} is not in {SOURCE_WORDS}, and is not listed as the product's own")
                elif words[language][key] != own[key].get(language):
                    fail(f"product: the text {key} in {language} is not what {PRODUCT_WORDS.relative_to(ROOT)} lists")
            elif key in own:
                fail(f"product: the text {key} is listed as the product's own, and {SOURCE_WORDS} has it")
            elif words[language][key] != said:
                fail(f"product: the text {key} in {language} is not what {SOURCE_WORDS} says: {words[language][key]!r} and {said!r}")
    for key, entry in sorted(own.items()):
        if key not in first:
            fail(f"product: the text {key} is listed as the product's own, and the product does not have it")
        if not entry.get("why"):
            fail(f"product: the text {key} is listed as the product's own, and does not say why")
    for key, why in sorted(unused.items()):
        if key in first:
            fail(f"product: the text {key} is listed as unused, and the product has it")
        if key not in source[LANGUAGES[0]]:
            fail(f"product: the text {key} is listed as unused, and {SOURCE_WORDS} does not have it")
        if not why:
            fail(f"product: the text {key} is listed as unused, and does not say why")
    for key in sorted(source[LANGUAGES[0]]):
        if not key.startswith(MAC_WORDS) and key not in first and key not in unused:
            fail(f"product: the text {key} of {SOURCE_WORDS} is neither in the product nor listed as unused")

    # A text nobody says is a text left behind. A key is said where it is written out, or
    # where a template that begins it is: `throughput.${direction}` says both directions.
    page = "\n".join(path.read_text(encoding="utf-8") for path in sources("frontend/src", (".ts", ".tsx")))
    templates = set(re.findall(r"`([a-z][\w.]*\.)\$\{", page))
    for key in sorted(first):
        if f'"{key}"' not in page and not any(key.startswith(prefix) for prefix in templates):
            fail(f"product: the text {key} is in the dictionaries, and no file of the page uses it")

    # A cause is written where the catalogue says it is born: by a file of the page, or by
    # the gateway, which names it beside the error it sends (src/cause.rs). And every code
    # the gateway names is one the catalogue has, so no cause reaches a page that has no
    # words for it.
    catalogue = json.loads(ERRORS.read_text(encoding="utf-8"))["places"]
    known = {entry.get("code", "") for place in catalogue for entry in [place["general"], *place["causes"]]}
    for place in catalogue:
        for cause in place.get("causes", []):
            code, born = cause.get("code", ""), cause.get("origin", {}).get("file", "")
            path = ROOT / born
            if born.startswith("frontend/src/"):
                if path.is_file() and f'"{code}"' not in path.read_text(encoding="utf-8"):
                    fail(f"product: {code} is born in {born}, which never writes it")
            elif born.startswith("src/"):
                if path.is_file() and f'"{code}"' not in gateway_code(path):
                    fail(f"product: {code} is written by the gateway ({born}), which never names it")
    for path in sources("src", (".rs",)):
        for code in sorted(set(GATEWAY_CODE.findall(gateway_code(path))) - known):
            fail(f"product: {path.relative_to(ROOT)} names the cause {code}, which the catalogue does not have")

    # No message takes somebody else's words into its sentence: what the gateway, the
    # browser or the remote said is shown apart from it, as it came.
    for place in catalogue:
        for entry in [place["general"], *place["causes"]]:
            for language in LANGUAGES:
                if "{detail}" in entry.get("text", {}).get(language, ""):
                    fail(f"product: {entry.get('code')} puts the original words inside its {language} sentence")

    # A label the gateway writes in English is still written by the Rust the list names.
    for label in listed["server"]:
        path = ROOT / label.get("file", "")
        if not path.is_file() or label.get("snippet", "") not in path.read_text(encoding="utf-8"):
            fail(f"product: the gateway's label {label.get('says')!r} is no longer written by {label.get('file')}: {label.get('snippet')!r}")
        if label.get("key") is not None and label["key"] not in first:
            fail(f"product: the gateway's label {label.get('says')!r} is said with {label['key']}, which the product does not have")

    print(f"product: {len(first)} texts in each language, {len(own)} of them not in the source, {len(unused)} of the source's unused")



# -- the terminal -------------------------------------------------------------------------

def rust_code(text):
    """Rust source with its comments blanked, and where its string literals are.

    Offsets are kept, so a place found in what this returns is the same place in the file.
    A quote inside a comment or a character literal is not the start of a string.
    """
    out, strings, at, end = list(text), [], 0, len(text)
    while at < end:
        two = text[at:at + 2]
        if two == "//":
            stop = text.find("\n", at)
            stop = end if stop < 0 else stop
            out[at:stop] = " " * (stop - at)
            at = stop
        elif two == "/*":
            stop = text.find("*/", at + 2)
            stop = end if stop < 0 else stop + 2
            out[at:stop] = [c if c == "\n" else " " for c in text[at:stop]]
            at = stop
        elif text[at] == '"' or re.match(r'b?r#*"', text[at:at + 8]):
            raw = re.match(r'b?r(#*)"', text[at:at + 8])
            if raw:
                close = '"' + raw.group(1)
                stop = text.find(close, at + len(raw.group(0)))
                stop = end if stop < 0 else stop + len(close)
            else:
                literal = RUST_STRING.match(text, at)
                stop = literal.end() if literal else end
            strings.append((at, stop))
            at = stop
        elif text[at] == "'":
            character = re.match(r"'(?:\\.[^']*|[^\\'])'", text[at:at + 12])
            at += len(character.group(0)) if character else 1
        else:
            at += 1
    return "".join(out), strings


def sentence_after(code, strings, inside, at, skip_condition=False):
    """What the call opened just before `at` says: the first string among its
    arguments, without its quotes, or the arguments themselves where the
    sentence is made elsewhere (`.with_context(not_ours)`). `ensure!` says it
    after its condition."""
    depth, stop, comma = 1, at, None
    while stop < len(code) and depth:
        if not inside[stop]:
            depth += code[stop] in "([{"
            depth -= code[stop] in ")]}"
            if code[stop] == "," and depth == 1 and comma is None:
                comma = stop
        stop += 1
    begin = comma + 1 if skip_condition and comma is not None else at
    found = next(((a, b) for a, b in strings if begin <= a < stop), None)
    if found is None:
        return squeeze(code[begin:stop - 1])
    # As Rust reads it: a backslash at a line's end joins the next line to it.
    return re.sub(r"\\\n\s*", "", code[found[0] + 1:found[1] - 1])


def statement_of(code, inside, site):
    """The expression the sentence at `site` is written in, as text: back to where it begins,
    and on through what is chained after its call. A match arm is one, a call's argument is
    one, and what an `if` or a `match` goes on to do in its block is not part of it: a cause
    named there is another statement's."""
    start, closed = site.start(), 0
    while start > 0:
        at = start - 1
        if not inside[at]:
            mark = code[at]
            if mark in ")]":
                closed += 1
            elif mark in "([":
                closed = max(closed - 1, 0)
            elif mark == "}" and closed == 0:
                break
            elif mark in ";{" and closed == 0:
                break
            elif mark == "," and closed == 0:
                break
            elif mark == ">" and at > 0 and code[at - 1] == "=" and closed == 0:
                break
        start -= 1
    stop, depth = site.end(), 1
    while stop < len(code):
        if not inside[stop]:
            mark = code[stop]
            if depth <= 0 and mark in ";,{":
                break
            if mark in "([{":
                depth += 1
            elif mark in ")]}":
                if depth <= 0 and mark == "}":
                    break
                depth -= 1
        stop += 1
    return code[start:stop]


def engine_files():
    """The files whose errors end a session or refuse a connection, and so reach a page."""
    client = sorted(str(path.relative_to(ROOT)) for path in (ROOT / "src/rdp_client").rglob("*.rs"))
    graphics = sorted(str(path.relative_to(ROOT)) for path in (ROOT / "crates/alumia-rdp-graphics/src").rglob("*.rs"))
    return ENGINE_FILES + tuple(client) + tuple(graphics)


def check_engines():
    """Every sentence an engine writes for an error names, in the statement that writes it,
    the cause the page says it by: its code, a step's `.cause(`, or a cause's `.of(`. One that
    names none is listed under the catalogue's `kept` with why it is said as it is: an error
    that ends no session, or one told by where it failed."""
    kept = json.loads(ERRORS.read_text(encoding="utf-8")).get("kept", [])
    for entry in kept:
        if not entry.get("why"):
            fail(f"engines: {entry.get('file')} keeps {entry.get('says')!r} as it is, and does not say why")
    unmet = {(entry.get("file"), entry.get("says")) for entry in kept}
    errors = named = held = 0
    for name in engine_files():
        code, strings = rust_code(gateway_code(ROOT / name))
        inside = bytearray(len(code))
        for start, stop in strings:
            inside[start:stop] = b"\x01" * (stop - start)
        for site in ENGINE_SITE.finditer(code):
            if inside[site.start()]:
                continue
            errors += 1
            statement = statement_of(code, inside, site)
            if '"AL-' in statement or ".cause(" in statement or ".of(" in statement:
                named += 1
                continue
            # An `io::Error` says its sentence after its kind.
            after = "ensure" in site.group(0) or "io::Error" in site.group(0)
            literal = sentence_after(code, strings, inside, site.end(), skip_condition=after)
            if (name, literal) in unmet or any(entry.get("file") == name and entry.get("says") == literal for entry in kept):
                unmet.discard((name, literal))
                held += 1
                continue
            fail(
                f"engines: {name}:{code.count(chr(10), 0, site.start()) + 1} writes an error's sentence and names "
                f"no cause for it, and it is not kept: {literal!r}"
            )
    for file, says in sorted(unmet, key=str):
        fail(f"engines: {says!r} is kept as it is in {file}, and nothing there writes it")
    print(f"engines: {errors} errors written, {named} of them with a cause and {held} kept as they are")


def check_terminal():
    listed = json.loads(TERMINAL_WORDS.read_text(encoding="utf-8"))
    words, kept = listed.get("words", {}), listed.get("kept", [])
    for key, entry in sorted(words.items()):
        if not isinstance(entry, dict) or set(entry) != set(LANGUAGES) or not all(entry.values()):
            fail(f"terminal: the text {key} is not in exactly {' and '.join(LANGUAGES)}")
        elif holes(entry[LANGUAGES[0]]) != holes(entry[LANGUAGES[1]]):
            fail(f"terminal: the text {key} has different placeholders in each language")
    for entry in kept:
        if not entry.get("why"):
            fail(f"terminal: {entry.get('file')} keeps {entry.get('says')!r} as it is, and does not say why")
    unmet = {(entry.get("file"), entry.get("says")) for entry in kept}

    errors = named = held = said = 0
    for name in TERMINAL_FILES:
        code, strings = rust_code(gateway_code(ROOT / name))
        inside = bytearray(len(code))
        for start, stop in strings:
            inside[start:stop] = b"\x01" * (stop - start)

        def line_of(at):
            return code.count("\n", 0, at) + 1

        def literal_after(at, skip_condition=False):
            return sentence_after(code, strings, inside, at, skip_condition)

        for site in ERROR_SITE.finditer(code):
            if inside[site.start()]:
                continue
            errors += 1
            statement = statement_of(code, inside, site)
            # A cause is named by its code, or by `.cause(` taking one made a line above.
            if '"AL-' in statement or ".cause(" in statement:
                named += 1
                continue
            literal = literal_after(site.end(), skip_condition="ensure" in site.group(0))
            if (name, literal) in unmet or any(entry.get("file") == name and entry.get("says") == literal for entry in kept):
                unmet.discard((name, literal))
                held += 1
                continue
            fail(
                f"terminal: {name}:{line_of(site.start())} writes an error's sentence and names no cause for it, "
                f"and it is not kept: {literal!r}"
            )
        for site in PRINT_SITE.finditer(code):
            if inside[site.start()]:
                continue
            literal = literal_after(site.end())
            if re.search(r"[A-Za-z]{2,}", re.sub(r"\{[^}]*\}", "", literal)):
                if (name, literal) in unmet or any(entry.get("file") == name and entry.get("says") == literal for entry in kept):
                    unmet.discard((name, literal))
                    continue
                fail(f"terminal: {name}:{line_of(site.start())} prints words of its own: {literal[:90]!r}")
        for key in re.findall(r'\bsay(?:_in)?\(\s*(?:\w+,\s*)?"([^"]+)"', code):
            said += 1
            if key not in words:
                fail(f"terminal: {name} says the text {key}, which the dictionary does not have")
    for file, says in sorted(unmet, key=str):
        fail(f"terminal: {says!r} is kept as it is in {file}, and nothing there writes it")

    gateway = {name: gateway_code(ROOT / name) for name in TERMINAL_FILES}
    under, made = NAMED_TEXTS
    by_name = made in gateway["src/cli.rs"]
    for key in sorted(words):
        if key.startswith(under) and by_name:
            continue
        if not any(f'"{key}"' in code for code in gateway.values()):
            fail(f"terminal: the text {key} is in the dictionary, and no file of the terminal says it")
    for path in sources("src", (".rs",)):
        code = gateway_code(path)
        if SERVER_PLACE in code:
            for found in sorted(set(TERMINAL_CODE.findall(code))):
                fail(
                    f"terminal: {path.relative_to(ROOT)} sends messages to a browser and names the "
                    f"terminal's cause {found}, which no browser has words for"
                )
    print(
        f"terminal: {errors} errors written, {named} of them with a cause and {held} kept as they are; "
        f"{len(words)} texts in each language, said in {said} places"
    )


def main():
    if "--print-css" in sys.argv:
        sys.stdout.write(css_text())
        return 0
    if "--print-errors" in sys.argv:
        sys.stdout.write(errors_text())
        return 0
    if "--print-favicon" in sys.argv:
        sys.stdout.write(favicon_text())
        return 0
    check_tokens()
    check_catalogue()
    check_mockup()
    check_product()
    check_terminal()
    check_engines()
    for message in failures:
        print(f"FAIL {message}")
    print(f"{len(failures)} failed" if failures else "all checks pass")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
