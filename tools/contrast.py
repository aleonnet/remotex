# The contrast and the colour-vision separation of the design system's colours, read from
# docs/design/alumia.tokens.json: the pairs to measure are listed in the file itself, under
# `$extensions` -> `com.alumia.contrast`, so a colour added there is measured here.
#
# Fails when a text pair is under 4.5:1 or a component pair under 3:1 (WCAG 2.2), and when
# two chart colours are too alike under protanopia, deuteranopia or tritanopia, or with full
# colour vision, or too faint against their surface.
#
# The colour-vision check is the one the throughput charts' colours were chosen with:
# Machado, Oliveira and Fernandes (2009) at severity 1.0, and the distance between the two
# simulated colours in OKLab, times 100.
#
# Run: uv run --no-project python tools/contrast.py

import json
import math
import pathlib
import sys

TOKENS = pathlib.Path(__file__).resolve().parent.parent / "docs/design/alumia.tokens.json"
EXTENSION = "com.alumia.contrast"

# Under each simulated deficiency, and with none.
CVD_MIN = 8.0
NORMAL_MIN = 15.0
CHART_SURFACE_MIN = 3.0

MACHADO = {
    "protanopia": (
        (0.152286, 1.052583, -0.204868),
        (0.114503, 0.786281, 0.099216),
        (-0.003882, -0.048116, 1.051998),
    ),
    "deuteranopia": (
        (0.367322, 0.860646, -0.227968),
        (0.280085, 0.672501, 0.047413),
        (-0.011820, 0.042940, 0.968881),
    ),
    "tritanopia": (
        (1.255528, -0.076749, -0.178779),
        (-0.078411, 0.930809, 0.147602),
        (0.004733, 0.691367, 0.303900),
    ),
}


def hex_to_srgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4))


def to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def to_gamma(c):
    c = min(1.0, max(0.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def luminance(srgb):
    r, g, b = (to_linear(c) for c in srgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    """The WCAG 2.2 contrast ratio of two opaque sRGB colours."""
    x, y = sorted((luminance(a), luminance(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


def oklab(linear):
    r, g, b = linear
    l = math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    )


def oklch(srgb):
    """Lightness 0-1, chroma, and hue in degrees, of an sRGB colour."""
    lightness, a, b = oklab(tuple(to_linear(c) for c in srgb))
    return lightness, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360


def oklch_to_srgb(lightness, chroma, hue):
    """An OKLCH colour as sRGB, each channel clamped to what a display shows."""
    a = chroma * math.cos(math.radians(hue))
    b = chroma * math.sin(math.radians(hue))
    l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    linear = (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )
    return tuple(to_gamma(c) for c in linear)


def to_hex(srgb):
    return "#" + "".join(f"{round(min(1.0, max(0.0, c)) * 255):02X}" for c in srgb)


def simulate(srgb, kind):
    linear = tuple(to_linear(c) for c in srgb)
    return tuple(
        min(1.0, max(0.0, sum(row[i] * linear[i] for i in range(3)))) for row in MACHADO[kind]
    )


def distance(a, b, kind=None):
    """How far apart two colours are in OKLab, times 100, as seen with `kind`."""
    if kind:
        first, second = oklab(simulate(a, kind)), oklab(simulate(b, kind))
    else:
        first, second = (oklab(tuple(to_linear(c) for c in x)) for x in (a, b))
    return 100 * math.dist(first, second)


def over(top, alpha, bottom):
    """`top` at `alpha` laid over an opaque `bottom`, the way a browser composites it."""
    return tuple(alpha * t + (1 - alpha) * b for t, b in zip(top, bottom))


def token(tokens, path):
    node = tokens
    for key in path.split("."):
        node = node[key]
    return node


def colour(tokens, path):
    """A colour token's sRGB value and alpha, from the hex written beside its OKLCH."""
    value = token(tokens, path)["$value"]
    return hex_to_srgb(value["hex"]), value.get("alpha", 1)


def opaque(tokens, path, beneath):
    """The colour at `path` as it reaches the eye: itself, or laid over `beneath`."""
    srgb, alpha = colour(tokens, path)
    if alpha == 1:
        return srgb
    if beneath is None:
        raise SystemExit(f"{path} is translucent and its pair names nothing under it")
    under, under_alpha = colour(tokens, beneath)
    if under_alpha != 1:
        raise SystemExit(f"{beneath} is translucent and cannot be what lies under {path}")
    return over(srgb, alpha, under)


def main():
    tokens = json.loads(TOKENS.read_text(encoding="utf-8"))
    checks = tokens["$extensions"][EXTENSION]
    failed = 0

    for pair in checks["pairs"]:
        back = opaque(tokens, pair["bg"], pair.get("over"))
        front = opaque(tokens, pair["fg"], pair["bg"] if pair.get("over") is None else None)
        value = ratio(front, back)
        low = value < pair["min"]
        failed += low
        beneath = f" over {pair['over']}" if pair.get("over") else ""
        print(
            f"{'FAIL' if low else 'ok  '} {value:5.2f}:1 (min {pair['min']}:1)  "
            f"{pair['fg']} on {pair['bg']}{beneath}"
        )

    for chart in checks["charts"]:
        first, second = (colour(tokens, path)[0] for path in chart["colours"])
        names = " and ".join(chart["colours"])
        for kind in MACHADO:
            value = distance(first, second, kind)
            low = value < CVD_MIN
            failed += low
            print(f"{'FAIL' if low else 'ok  '} {value:5.1f} (min {CVD_MIN})  {names}, {kind}")
        value = distance(first, second)
        low = value < NORMAL_MIN
        failed += low
        print(f"{'FAIL' if low else 'ok  '} {value:5.1f} (min {NORMAL_MIN})  {names}, full colour vision")
        for surface in chart["surfaces"]:
            back = colour(tokens, surface)[0]
            for path, srgb in zip(chart["colours"], (first, second)):
                value = ratio(srgb, back)
                low = value < CHART_SURFACE_MIN
                failed += low
                print(
                    f"{'FAIL' if low else 'ok  '} {value:5.2f}:1 (min {CHART_SURFACE_MIN}:1)  "
                    f"{path} on {surface}"
                )

    print(f"{failed} failed" if failed else "all pairs pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
