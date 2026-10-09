# Write the page's two dictionaries (frontend/src/words/pt-BR.json and en-US.json), and with
# --check hold them to what this writes.
#
# A text of the page is docs/design/words.json's, word for word: the mockup is where each one
# was read, argued over and approved, tools/mockup_sources.py is how it reaches the source, and
# a text retyped into the product is a text that can drift. So the dictionaries are not edited
# by hand. They are every browser text the source has (the keys under `mac.` are the Mac
# app's), less the ones docs/design/product-words.json lists as unused by the product, plus
# the ones it lists as the product's own.
#
# tools/check-design.py holds the result to the same two sources, and fails a text no
# file of the page uses.
#
# Run: uv run --no-project python tools/product-words.py            (writes the files)
#      uv run --no-project python tools/product-words.py --check    (the gate)

import json
import pathlib
import sys

import mockup_sources as sources

ROOT = pathlib.Path(__file__).resolve().parent.parent
OWN = ROOT / "docs/design/product-words.json"
WORDS = ROOT / "frontend/src/words"
LANGUAGES = ("pt-BR", "en-US")
# The Mac app's texts: the second part of the mockup, and not this page's.
MAC = "mac."


def dictionaries():
    """The two dictionaries as they are meant to be, by language."""
    source = sources.by_language(sources.read_words())
    listed = json.loads(OWN.read_text(encoding="utf-8"))
    meant = {}
    for language in LANGUAGES:
        given = source[language]
        words = {
            key: text
            for key, text in given.items()
            if not key.startswith(MAC) and key not in listed["unused"]
        }
        for key, entry in listed["own"].items():
            if key in given:
                sys.exit(f"product-words: {key} is listed as the product's own, and docs/design/words.json has it")
            words[key] = entry[language]
        for key in listed["unused"]:
            if key not in given:
                sys.exit(f"product-words: {key} is listed as unused, and docs/design/words.json does not have it")
        meant[language] = words
    return meant


def text(words):
    return json.dumps(words, ensure_ascii=False, indent=2) + "\n"


def check():
    wrong = 0
    for language, words in dictionaries().items():
        path = WORDS / f"{language}.json"
        if not path.is_file() or path.read_text(encoding="utf-8") != text(words):
            print(f"FAIL product-words: {path.relative_to(ROOT)} is not what this tool writes: run it without --check")
            wrong += 1
    if wrong:
        print(f"{wrong} failed")
        return 1
    print("product-words: both dictionaries are what this tool writes")
    return 0


def main():
    if "--check" in sys.argv:
        return check()
    for language, words in dictionaries().items():
        (WORDS / f"{language}.json").write_text(text(words), encoding="utf-8")
        print(f"product-words: {language}, {len(words)} texts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
