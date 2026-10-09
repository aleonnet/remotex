#!/usr/bin/env python3
"""Hold the entry documents to one another, and to the README they replaced.

Three documents are how somebody enters this repository, each in English and in
Portuguese: README (using alumia), README_DEV (changing it) and CHANGELOG. This checks:

  1. The two languages of each say the same thing in the same shape: the same sequence of
     heading levels, the same command blocks byte for byte, the same link targets, and a
     link to the other language at the top. What a sentence says is not checked: that is
     read, side by side.
  2. Nothing of the README these replaced was lost. Every command block, every `code span`
     and every address it had (as it stood at OLD) is in one of the documents that took its
     text, or is listed in LEFT_OUT with the reason.
  3. The README is for whoever uses alumia: it has none of the commands of a developer's
     checks.

    uv run --no-project python tools/check-docs.py
"""

import pathlib
import re
import subprocess
import sys
import textwrap

ROOT = pathlib.Path(__file__).resolve().parent.parent

# (English, Portuguese)
PAIRS = [
    ("README.md", "README.pt-BR.md"),
    ("README_DEV.md", "README_DEV.pt-BR.md"),
    ("CHANGELOG.md", "CHANGELOG.pt-BR.md"),
]

# The commit whose README.md the entry documents replaced, and where its text went.
OLD = "3f2e07c8"
HOLDERS = [
    "README.md",
    "README_DEV.md",
    "CHANGELOG.md",
    "docs/servers.md",
    "docs/local-instances.md",
    "docs/install.md",
]

# What the old README had and no document has now, on purpose, each with why.
LEFT_OUT = {
    # The README of plan 6 (2026-10-10) links four documents and no more; the decoder's
    # is reached from Servers, modes and media and from Installing, which both link it.
    "`docs/high-performance-decoder.md`": "linked from docs/servers.md and docs/install.md, not from the README",
}

# A code span is kept if a document has it as a span. One long enough to be nobody else's
# words is kept too where a document has what it says outside a span: as a link's target,
# or inside a command block.
PLAIN_FROM = 9

# What only a developer runs: none of it belongs in the README for whoever uses alumia.
DEVELOPERS = ["cargo clippy", "cargo test", "bun run check"]

FENCE = re.compile(r"^(\s*)(```|~~~)")


def split(text):
    """The text outside fenced blocks, and the blocks, each without its common indentation."""
    prose, blocks, inside, block = [], [], False, []
    for line in text.split("\n"):
        if FENCE.match(line):
            if inside:
                blocks.append(textwrap.dedent("\n".join(block)).strip("\n"))
                block = []
            inside = not inside
            continue
        (block if inside else prose).append(line)
    return "\n".join(prose), blocks


def levels(prose):
    return [len(mark) for mark in re.findall(r"^(#{1,6}) ", prose, flags=re.M)]


def targets(prose):
    """Where the links lead, with a link inside the document itself left out and the
    language's own suffix taken off, so that the two languages of a pair compare."""
    found = re.findall(r"\]\(([^)\s]+)\)", prose) + re.findall(r"<(https?://[^>]+)>", prose)
    return sorted(
        target.replace(".pt-BR.md", ".md")
        for target in found
        if not target.startswith("#")
    )


def squeezed(text):
    return re.sub(r"\s+", " ", text)


def spans(prose):
    return {squeezed(span) for span in re.findall(r"`[^`\n]+(?:\n[^`\n]+)?`", prose)}


def addresses(text):
    return set(re.findall(r"https?://[^\s)>\]`\"']+", text))


def read(path):
    return (ROOT / path).read_text()


def pair_faults(english, portuguese):
    faults = []
    texts = {name: split(read(name)) for name in (english, portuguese)}
    (en_prose, en_blocks), (pt_prose, pt_blocks) = texts[english], texts[portuguese]
    if levels(en_prose) != levels(pt_prose):
        faults.append(
            f"{english} and {portuguese} have different headings: {levels(en_prose)} against {levels(pt_prose)}"
        )
    for at, block in enumerate(en_blocks):
        if at >= len(pt_blocks) or pt_blocks[at] != block:
            faults.append(
                f"{portuguese} does not have {english}'s command block {at + 1}: {block.splitlines()[0]!r}"
            )
    if len(pt_blocks) > len(en_blocks):
        faults.append(f"{portuguese} has {len(pt_blocks) - len(en_blocks)} command block(s) {english} does not")
    if targets(en_prose) != targets(pt_prose):
        only_en = sorted(set(targets(en_prose)) - set(targets(pt_prose)))
        only_pt = sorted(set(targets(pt_prose)) - set(targets(en_prose)))
        faults.append(
            f"{english} and {portuguese} link to different places: only the first {only_en}, only the second {only_pt}"
        )
    for name, other in ((english, portuguese), (portuguese, english)):
        top = "\n".join(read(name).split("\n")[:6])
        if f"]({other})" not in top:
            faults.append(f"{name} does not link to {other} at its top")
    return faults


def kept_faults():
    shown = subprocess.run(
        ["git", "show", f"{OLD}:README.md"], cwd=ROOT, capture_output=True, text=True, check=False
    )
    if shown.returncode != 0:
        print(f"check-docs: commit {OLD} is not in this clone; what the old README had is NOT checked")
        return []
    old_prose, old_blocks = split(shown.stdout)
    held = [split(read(name)) for name in HOLDERS]
    held_blocks = {block for _, blocks in held for block in blocks}
    held_text = squeezed("\n".join(read(name) for name in HOLDERS))
    faults = []
    for block in old_blocks:
        if block not in held_blocks:
            faults.append(f"a command block of the old README is in no document: {block.splitlines()[0]!r}")
    for span in sorted(spans(old_prose)):
        said = span.strip("`")
        kept = span in held_text or (len(said) >= PLAIN_FROM and said in held_text)
        if not kept and span not in LEFT_OUT:
            faults.append(f"a code span of the old README is in no document: {span}")
    for address in sorted(addresses(shown.stdout)):
        if address not in held_text and address not in LEFT_OUT:
            faults.append(f"an address of the old README is in no document: {address}")
    for left in LEFT_OUT:
        if left in held_text:
            faults.append(f"LEFT_OUT lists {left}, which a document has: take it off the list")
    return faults


def audience_faults():
    faults = []
    for name in PAIRS[0]:
        text = read(name)
        for command in DEVELOPERS:
            if command in text:
                faults.append(f"{name} has a developer's command, `{command}`: it belongs in README_DEV")
    return faults


def main():
    faults = []
    for english, portuguese in PAIRS:
        faults += pair_faults(english, portuguese)
    faults += kept_faults()
    faults += audience_faults()
    for fault in faults:
        print(f"check-docs: {fault}")
    if faults:
        print(f"check-docs: {len(faults)} fault(s)")
        return 1
    print("all documents agree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
