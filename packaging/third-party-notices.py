# /// script
# requires-python = ">=3.13"
# ///
"""Write THIRD-PARTY-NOTICES.txt: the notices of everything a release build of the
gateway contains that remotex did not write.

    uv run --python 3.13 packaging/third-party-notices.py <output>

A build output, like the frontend bundle: packaging/build-tarball.sh and
packaging/build-windows-msi.ps1 write it into the tree they package, or take the
one release CI made once, from REMOTEX_PREBUILT_NOTICES. It is not kept in the
repository.

Three parts, each from where it is kept:

- the C libraries linked into the gateway from their prebuilt archives, whose
  licences are in packaging/notices/, since no crate carries them all;
- the web client's packages, compiled into the gateway with it, from
  frontend/node_modules (`bun install` in frontend/ first);
- the Rust crates, from cargo-about (`cargo install cargo-about --locked
  --features cli`) under packaging/about.toml.

cargo-about refuses a crate under a licence packaging/about.toml does not accept,
so a dependency that cannot be shipped fails the packaging that would ship it.
"""

import json
import re
import subprocess
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The C libraries, in the order a reader meets them: the picture, the sound, the
# allocator under both.
C_LIBRARIES = [
    ("libvpx, the VP9 encoder (desktop-vp9, libvpx-prebuilt-sys)", "libvpx.txt"),
    ("Opus, the audio codec (opus-prebuilt, libopus-prebuilt-sys)", "opus.txt"),
    ("jemalloc, the memory allocator (tikv-jemalloc-sys)", "jemalloc.txt"),
]


def clean(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.replace("\r", "").strip("\n").split("\n"))


def heading(title: str) -> str:
    rule = "=" * 80
    return f"{rule}\n{title}\n{rule}\n"


def notice(title: str, text: str) -> str:
    wrapped = textwrap.fill(
        title, 76, initial_indent="-- ", subsequent_indent="   ", break_on_hyphens=False, break_long_words=False
    )
    return f"{wrapped}\n\n{clean(text)}\n"


def web_packages() -> list[tuple[str, str, str, str]]:
    """(name, version, licence, text) for each package the web client's runtime
    dependencies pull in."""
    modules = ROOT / "frontend" / "node_modules"
    if not modules.is_dir():
        sys.exit("frontend/node_modules is missing: run `bun install --frozen-lockfile` in frontend/")
    wanted = list(json.loads((ROOT / "frontend" / "package.json").read_text())["dependencies"])
    found: dict[str, tuple[str, str, str, str]] = {}
    while wanted:
        name = wanted.pop()
        if name in found:
            continue
        directory = modules / name
        manifest = json.loads((directory / "package.json").read_text())
        files = sorted(
            f for f in directory.iterdir() if re.fullmatch(r"(?i)(licen[cs]e|copying)(\.\w+)?", f.name)
        )
        if not files:
            sys.exit(f"{name} carries no licence file")
        text = "\n\n".join(f.read_text() for f in files)
        found[name] = (name, manifest["version"], manifest["license"], text)
        wanted.extend(manifest.get("dependencies", {}))
    return sorted(found.values())


def rust_licences() -> list[tuple[str, list[str], str]]:
    """(licence, crates, text) for each distinct licence text cargo-about found:
    offline, so a crate that ships no licence file gets its licence's standard text
    on every machine rather than whatever its repository says today."""
    subprocess.run(["cargo", "fetch", "--locked"], cwd=ROOT, check=True)
    about = subprocess.run(
        ["cargo", "about", "generate", "--config", "packaging/about.toml", "--format", "json", "--frozen"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    groups = []
    for licence in json.loads(about.stdout)["licenses"]:
        crates = sorted(
            {
                f"{use['crate']['name']} {use['crate']['version']}"
                for use in licence["used_by"]
                # The workspace's own crates are remotex's, and have no source.
                if use["crate"]["source"] is not None
            }
        )
        if crates:
            groups.append((licence["id"], crates, licence["text"]))
    return sorted(groups, key=lambda g: (g[0], g[1]))


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: third-party-notices.py <output>")
    output = Path(sys.argv[1])
    parts = [
        "THIRD-PARTY NOTICES\n\n"
        + textwrap.fill(
            "remotex is under the MIT licence in LICENSE. A release build of its gateway "
            "also contains the software below, each part under the licence given with it.",
            80,
        )
        + "\n"
    ]

    parts.append(heading("C libraries linked into the gateway"))
    for title, file in C_LIBRARIES:
        parts.append(notice(title, (ROOT / "packaging" / "notices" / file).read_text()))

    parts.append(heading("The web client, compiled into the gateway"))
    by_text: dict[str, list[str]] = {}
    for name, version, licence, text in web_packages():
        by_text.setdefault(clean(text), []).append(f"{name} {version} ({licence})")
    for text, packages in by_text.items():
        parts.append(notice(", ".join(packages), text))

    parts.append(heading("Rust crates"))
    for licence, crates, text in rust_licences():
        parts.append(notice(f"{licence}: {', '.join(crates)}", text))

    output.write_text("\n".join(parts), newline="\n")
    print(f"wrote {output}")


if __name__ == "__main__":
    main()
