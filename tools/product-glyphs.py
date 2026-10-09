# Write frontend/src/Glyph.tsx: the page's glyphs, each drawing taken from its file in
# docs/design/glyphs/, and with --check hold the file in the tree to those drawings.
#
# Most are Lucide's; eight are the product's own, drawn on Lucide's grid for what Lucide has
# no drawing of. tools/mockup_sources.py says which is which, and on which sheet of the mockup
# each was first drawn. A drawing is never retyped: it is the one its file carries, so the
# page and its design cannot differ by a path.
#
# Run: uv run --no-project python tools/product-glyphs.py            (writes the file)
#      uv run --no-project python tools/product-glyphs.py --check    (the gate: the file in
#      the tree draws what the glyphs' files say, name for name; no formatter is run, so it
#      runs where the page's node_modules are not)

import pathlib
import re
import subprocess
import sys

import mockup_sources as sources

ROOT = pathlib.Path(__file__).resolve().parent.parent
LICENCE = ROOT / "docs/design/icons/lucide-ISC.txt"
GLYPH = ROOT / "frontend/src/Glyph.tsx"

PAGE = """/*! The glyphs drawn below are Lucide's (https://lucide.dev), under this licence, kept
with every copy as it asks (docs/design/icons/lucide-ISC.txt):

%s
*/
import type { ReactNode } from "react";

// The page's glyphs: Lucide's, only the ones used, drawn in the text's own colour.
// Which glyph means what is the design system's table
// (docs/design/2026-10-03-0003-design-system.md, "Glifos"), and each drawing is the
// one its file in docs/design/glyphs/ carries. Eight are not Lucide's but the product's
// own, drawn on Lucide's grid: four for the list of computers: %s;
// and four for where the second display sits: %s.
// Written by tools/product-glyphs.py, not by hand.
//
// A glyph never stands alone as a name: it is hidden from a screen reader, and
// whatever it is on (a button, a message) says what it is in words.

const DRAWINGS = {
%s
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof DRAWINGS;

export function Glyph({ name }: { name: GlyphName }) {
  return (
    <svg className="al-i" viewBox="0 0 24 24" aria-hidden="true">
      {DRAWINGS[name]}
    </svg>
  );
}
"""

# An entry of DRAWINGS as the formatter leaves it: the name, then the drawing between <> and </>.
ENTRY = re.compile(r'^  ("?[a-z0-9-]+"?): \(\n    <>\n(.*?)\n    </>\n  \),$', re.S | re.M)


def camel(found):
    """An SVG attribute as JSX writes it: `stroke-dasharray` is `strokeDasharray`."""
    return found.group(1) + found.group(2).upper() + found.group(3) + "="


def kebab(found):
    """A JSX attribute as SVG writes it: `strokeDasharray` is `stroke-dasharray`."""
    return found.group(1) + "-" + found.group(2).lower() + found.group(3) + "="


def write():
    entries = []
    for name in sources.glyph_names():
        inner = re.sub(r">\s+<", "><", sources.read_glyph(name))
        inner = re.sub(r"\b([a-z]+)-([a-z])([a-z]*)=", camel, inner)
        key = name if re.fullmatch(r"[a-z]+", name) else f'"{name}"'
        entries.append(f"  {key}: (\n    <>\n      {inner}\n    </>\n  ),")
    licence = LICENCE.read_text(encoding="utf-8").strip()
    if "*/" in licence:
        sys.exit("product-glyphs: the licence would close the comment it is kept in")
    GLYPH.write_text(
        PAGE % (licence, ", ".join(sources.OWN), ", ".join(sources.PLACED), "\n".join(entries)), encoding="utf-8"
    )
    # In the page's own formatting, which is what its checks hold every file to.
    subprocess.run(
        ["bun", "x", "biome", "format", "--write", str(GLYPH.relative_to(ROOT / "frontend"))],
        cwd=ROOT / "frontend",
        check=True,
        stdout=subprocess.DEVNULL,
    )
    print(f"product-glyphs: {len(sources.LUCIDE)} glyphs of Lucide's and {len(sources.OWN) + len(sources.PLACED)} of the product's own")
    return 0


def check():
    drawn = {found.group(1).strip('"'): found.group(2) for found in ENTRY.finditer(GLYPH.read_text(encoding="utf-8"))}
    named = set(sources.glyph_names())
    wrong = []
    for name in sorted(set(drawn) - named):
        wrong.append(f"{GLYPH.relative_to(ROOT)} draws {name}, which docs/design/glyphs/ does not have")
    for name in sorted(named - set(drawn)):
        wrong.append(f"docs/design/glyphs/ has {name}, which {GLYPH.relative_to(ROOT)} does not draw")
    for name in sorted(named & set(drawn)):
        drawing = re.sub(r"\b([a-z]+)([A-Z])([a-z]*)=", kebab, drawn[name])
        if not sources.same_drawing(drawing, sources.read_glyph(name)):
            wrong.append(f"{GLYPH.relative_to(ROOT)} is not what the glyphs say: {name}")
    for sentence in wrong:
        print(f"FAIL product-glyphs: {sentence}")
    if wrong:
        print(f"{len(wrong)} failed")
        return 1
    print(f"product-glyphs: {GLYPH.relative_to(ROOT)} draws the {len(named)} glyphs of docs/design/glyphs/ as they are")
    return 0


def main():
    if "--check" in sys.argv:
        return check()
    return write()


if __name__ == "__main__":
    sys.exit(main())
