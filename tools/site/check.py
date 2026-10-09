#!/usr/bin/env python3
"""Hold the public page and the README to what was approved.

  1. Neither says a word of a developer's notebook: the page and the two READMEs speak the
     product's words (Virtual, Mirrored) and never "unofficial", "experimental", "reverse
     engineered", "Compatible" or "a screen of its own", in either language.
  2. Every picture either refers to is there, and none of them is the mockup's
     (docs/mockups): they are captures of the product (docs/readme/, site/real/).
  3. The page's words come in both languages, with the same keys.

    uv run --no-project python tools/site/check.py
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PAGES = ["site/index.html", "README.md", "README.pt-BR.md"]
FORBIDDEN = [
    "não oficial", "nao oficial", "unofficial",
    "experimental", "experimentais",
    "engenharia reversa", "reverse engineer", "reverse-engineer",
    "compatível", "compatible",
    "tela própria", "screen of its own",
]


def main():
    faults = []
    for name in PAGES:
        text = (ROOT / name).read_text(encoding="utf-8")
        for word in FORBIDDEN:
            # Whatever its case: at the start of a sentence as much as inside one.
            if word.lower() in text.lower():
                faults.append(f"{name} says {word!r}, a word of a notebook and not of the product")
        base = (ROOT / name).parent
        referred = re.findall(r'(?:src|srcset)="([^"]+)"', text) + re.findall(r"!\[[^\]]*\]\(([^)\s]+)\)", text)
        for target in referred:
            if target.startswith(("data:", "http:", "https:", "#")):
                continue
            if "mockups/" in target:
                faults.append(f"{name} shows a picture of the mockup: {target}")
            if not (base / target).exists():
                faults.append(f"{name} refers to a picture that is not there: {target}")
    words = json.loads((ROOT / "tools/site/words.json").read_text(encoding="utf-8"))
    keys = {lang: set(words[lang]) for lang in ("pt-BR", "en-US")}
    for only in sorted(keys["pt-BR"] ^ keys["en-US"]):
        faults.append(f"tools/site/words.json has {only} in one language only")
    for fault in faults:
        print(f"check-site: {fault}")
    if faults:
        print(f"check-site: {len(faults)} fault(s)")
        return 1
    print("the page and the README say what was approved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
