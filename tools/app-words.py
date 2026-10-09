# Write the Mac app's dictionary (macos/Alumia/Sources/AlumiaCore/Generated/Words.generated.swift),
# and with --check hold the app to it.
#
# A text of the app is docs/design/words.json's, word for word, as a text of the page is
# (tools/product-words.py): the mockup is where each one was read, argued over and approved,
# and tools/mockup_sources.py is how it reaches the source. So the app's dictionary is not
# edited by hand. It is every `mac.` text the source
# has, less the ones docs/design/app-words.json lists as unused, plus the browser texts it
# lists as shared and the texts it lists as the app's own. The app's messages are the
# catalogue's (docs/design/errors.json, the places of kind `app`), and are written beside the
# texts: that is how the app says a message with its code.
#
# What --check fails:
#   - a generated file that is not what this tool writes;
#   - a text or a code the app's sources name and the dictionary does not have;
#   - a text or a code the dictionary has and no source names;
#   - a text in one language only, or with different places in each;
#   - a notice whose words in the catalogue are not the source's;
#   - words typed straight into a screen, where a key belongs.
#
# Run: uv run --no-project python tools/app-words.py            (writes the file)
#      uv run --no-project python tools/app-words.py --check    (the gate)

import json
import pathlib
import re
import sys

import mockup_sources as sources

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = "docs/design/words.json"
OWN = ROOT / "docs/design/app-words.json"
ERRORS = ROOT / "docs/design/errors.json"
TOKENS = ROOT / "docs/design/alumia.tokens.json"
# The brand's colours the app draws with, by where the tokens have each.
BRAND = {
    "glass": "brand.glass",
    "red": "brand.red",
    "green": "brand.green",
    "blue": "brand.blue",
    "onGlass": "backdrop.lightest",
}
SOURCES = ROOT / "macos/Alumia/Sources"
GENERATED = SOURCES / "AlumiaCore/Generated/Words.generated.swift"
LANGUAGES = ("pt-BR", "en-US")
MAC = "mac."
# What a key looks like: a literal of this shape in the app's sources is meant as one.
KEY = re.compile(r"(?:mac|common|signin|type)\.[a-z0-9]+(?:[.-][a-z0-9]+)*")
CODE = re.compile(r"AL-\d{4}")
# The app's own places of the catalogue: 13 to 19.
OWN_CODE = re.compile(r"AL-1[3-9]\d\d")
HOLE = re.compile(r"\{(\w+)\}")
# Where a screen takes its words: a literal there is a text nobody translated. A key is said
# through `say(`, which is not among these.
SCREEN = re.compile(
    r"\b(?:Text|Button|Label|Toggle|Picker|Section|Link|Menu|SecureField|TextField|LabeledContent|NSMenuItem)"
    r"\(\s*(?:title:\s*)?$"
    r"|\.(?:help|navigationTitle|accessibilityLabel|accessibilityHint|alert|confirmationDialog)\(\s*$"
    r"|\.(?:title|stringValue|toolTip|messageText|informativeText|placeholderString)\s*=\s*$"
)

failures = []


def fail(message):
    failures.append(message)


def source_words():
    """The source, one dictionary a language."""
    return sources.by_language(sources.read_words())


def texts():
    """Every text of the app, by key, in each language."""
    source, listed = source_words(), json.loads(OWN.read_text(encoding="utf-8"))
    first = source[LANGUAGES[0]]
    meant = {}
    for key in first:
        if key.startswith(MAC) and key not in listed["unused"]:
            meant[key] = [source[language][key] for language in LANGUAGES]
    for key in listed["shared"]:
        if key not in first:
            sys.exit(f"app-words: {key} is listed as shared with the page, and {SOURCE} does not have it")
        if key.startswith(MAC):
            sys.exit(f"app-words: {key} is listed as shared, and it is the app's already")
        meant[key] = [source[language][key] for language in LANGUAGES]
    for key, why in listed["unused"].items():
        if key not in first or not key.startswith(MAC):
            sys.exit(f"app-words: {key} is listed as unused, and it is not a `{MAC}` text of {SOURCE}")
        if not why:
            sys.exit(f"app-words: {key} is listed as unused, and nothing says why")
    for key, entry in listed["own"].items():
        if key in first:
            sys.exit(f"app-words: {key} is listed as the app's own, and {SOURCE} has it")
        if not entry.get("why") or not all(entry.get(language) for language in LANGUAGES):
            sys.exit(f"app-words: {key} needs its why and its text in {' and '.join(LANGUAGES)}")
        meant[key] = [entry[language] for language in LANGUAGES]
    return meant


def messages():
    """The app's messages of the catalogue, by code."""
    meant = {}
    for place in json.loads(ERRORS.read_text(encoding="utf-8"))["places"]:
        if place.get("kind") != "app":
            continue
        for entry in [place["general"], *place["causes"]]:
            meant[entry["code"]] = {
                "severity": entry["severity"],
                "userAction": entry["user_action"],
                "text": [entry["text"][language] for language in LANGUAGES],
                "button": [entry["button"][language] for language in LANGUAGES] if "button" in entry else None,
            }
    return meant


def literal(text):
    """A Swift string literal: JSON's, which Swift reads the same for what is written here."""
    return json.dumps(text, ensure_ascii=False)


def colours():
    """The colours of the brand the app draws with: the three bars and the glass under
    them, each as the design tokens write it in sRGB."""
    tokens = json.loads(TOKENS.read_text(encoding="utf-8"))["color"]
    meant = {}
    for name, path in BRAND.items():
        node = tokens
        for part in path.split("."):
            node = node[part]
        meant[name] = node["$value"]["hex"]
    return meant


def swift(words, said):
    lines = [
        "// Written by tools/app-words.py from docs/design/words.json, docs/design/app-words.json and the",
        "// app's places of docs/design/errors.json. Not edited by hand: change those, and run the tool.",
        "",
        "enum Generated {",
        "    /// Each text, in Portuguese and then in English.",
        "    static let texts: [String: [String]] = [",
    ]
    for key in sorted(words):
        lines.append(f"        {literal(key)}: [{', '.join(literal(text) for text in words[key])}],")
    lines += [
        "    ]",
        "",
        "    /// Each message of the app's places of the catalogue.",
        "    static let messages: [String: GeneratedMessage] = [",
    ]
    for code in sorted(said):
        entry = said[code]
        button = "nil" if entry["button"] is None else f"[{', '.join(literal(text) for text in entry['button'])}]"
        lines.append(
            f"        {literal(code)}: GeneratedMessage(severity: {literal(entry['severity'])}, "
            f"userAction: {'true' if entry['userAction'] else 'false'}, "
            f"text: [{', '.join(literal(text) for text in entry['text'])}], button: {button}),"
        )
    lines += [
        "    ]",
        "",
        "    /// The brand's colours, as the design tokens write them in sRGB.",
        "    static let colours: [String: UInt32] = [",
    ]
    for name, value in sorted(colours().items()):
        lines.append(f"        {literal(name)}: 0x{value.lstrip('#').upper()},")
    lines += ["    ]", "}", ""]
    return "\n".join(lines)


def literals(source):
    """The string literals of a Swift source outside its comments, each with what stands
    before it on its line."""
    found, at, end = [], 0, len(source)
    while at < end:
        two = source[at:at + 2]
        if two == "//":
            stop = source.find("\n", at)
            at = end if stop < 0 else stop
        elif two == "/*":
            stop = source.find("*/", at + 2)
            at = end if stop < 0 else stop + 2
        elif source.startswith('"""', at):
            stop = source.find('"""', at + 3)
            stop = end if stop < 0 else stop
            found.append((source[at + 3:stop], source[source.rfind("\n", 0, at) + 1:at]))
            at = stop + 3
        elif source[at] == '"':
            match = re.compile(r'"((?:[^"\\\n]|\\.)*)"').match(source, at)
            if not match:
                at += 1
                continue
            found.append((match.group(1), source[source.rfind("\n", 0, at) + 1:at]))
            at = match.end()
        else:
            at += 1
    return found


def check():
    words, said = texts(), messages()
    for key, pair in sorted(words.items()):
        holes = [sorted(set(HOLE.findall(text))) for text in pair]
        if not all(pair):
            fail(f"the text {key} is not in both languages")
        elif holes[0] != holes[1]:
            fail(f"the text {key} has different places in each language: {holes[0]} and {holes[1]}")

    meant = swift(words, said)
    if not GENERATED.is_file() or GENERATED.read_text(encoding="utf-8") != meant:
        fail(f"{GENERATED.relative_to(ROOT)} is not what this tool writes: run it without --check")

    source, listed = source_words(), json.loads(OWN.read_text(encoding="utf-8"))
    for code, key in listed.get("notices", {}).items():
        entry = said.get(code)
        if entry is None:
            fail(f"the notice {code} is not among the app's messages of the catalogue")
            continue
        for index, language in enumerate(LANGUAGES):
            if entry["text"][index] != source[language].get(key):
                fail(f"{code} does not say in {language} what {SOURCE} says in {key}")
            if (entry["button"] or [None, None])[index] != source[language].get(f"{key}.act"):
                fail(f"the button of {code} is not in {language} what {SOURCE} says in {key}.act")

    catalogue = {
        entry["code"]
        for place in json.loads(ERRORS.read_text(encoding="utf-8"))["places"]
        for entry in [place["general"], *place["causes"]]
    }
    used, named, places = set(), set(), 0
    for path in sorted(SOURCES.rglob("*.swift")):
        if path == GENERATED:
            continue
        where = path.relative_to(ROOT)
        for text, before in literals(path.read_text(encoding="utf-8")):
            if KEY.fullmatch(text):
                places += 1
                used.add(text)
                if text not in words:
                    fail(f"{where} says the text {text}, which the dictionary does not have")
            elif CODE.fullmatch(text):
                named.add(text)
                if OWN_CODE.fullmatch(text) and text not in said:
                    fail(f"{where} names {text}, which is not a message of the app's in the catalogue")
                elif text not in catalogue:
                    fail(f"{where} names {text}, which the catalogue does not have")
            elif SCREEN.search(before) and re.search(r"[A-Za-zÀ-ÿ]{2,}", re.sub(r"\\\([^)]*\)", "", text)):
                fail(f"{where} writes words of its own on a screen, where a key belongs: {text!r}")
    for key in sorted(set(words) - used):
        fail(f"the text {key} is in the dictionary, and no source of the app says it")
    for code in sorted(set(said) - named):
        fail(f"the message {code} is the app's in the catalogue, and no source of the app names it")

    for failure in failures:
        print(f"FAIL app-words: {failure}")
    if failures:
        print(f"{len(failures)} failed")
        return 1
    print(
        f"app-words: {len(words)} texts in each language, said in {places} places; "
        f"{len(said)} messages with a code; all checks pass"
    )
    return 0


def main():
    if "--check" in sys.argv:
        return check()
    words, said = texts(), messages()
    GENERATED.parent.mkdir(parents=True, exist_ok=True)
    GENERATED.write_text(swift(words, said), encoding="utf-8")
    print(f"app-words: {len(words)} texts and {len(said)} messages written to {GENERATED.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
