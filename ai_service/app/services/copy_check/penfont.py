"""A single-stroke pen alphabet, drawn rather than typeset.

Why this exists
---------------
Three independent critics scoring a machine-marked script agreed on one thing:
the annotation text was the fastest tell on the page. Not the placement, not
the colour - the letterforms.

    "Every piece of annotation text is a computer font, not handwriting. ...
     identical repeated glyphs (every 'o' in 'other proceedings' is the same
     pixel shape). This is the single fastest tell in the whole script."

That cannot be fixed with a handwriting TTF. A font reuses one outline per
character, so the fourth 'e' in a comment is pixel-identical to the first, and
no amount of per-letter rotation or baseline drift hides that. A hand redraws
every letter slightly differently, and the only way to reproduce it is to draw
the letters.

So each glyph here is a set of polylines on a unit em box - x from 0 to its
advance width, y from 0 (baseline) up to 1.0 (cap height), descenders going
negative. The renderer walks those polylines with the same wobbling pen used
for ticks and rules, which means every instance of every letter comes out a
little different, with the same pen character as the rest of the marking.

The shapes are deliberately plain - a legible hand, not calligraphy. A teacher's
margin note is written fast.
"""
from __future__ import annotations

from typing import Any, Optional

# Each glyph: (advance_width, [stroke, stroke, ...]) where a stroke is a list
# of (x, y) points. Baseline y=0, x-height ~0.62, cap height ~1.0.
_X = 0.62  # x-height, referenced often enough to name

# The glyphs are drawn on a nearly square body: advance ~0.56 against an
# x-height of 0.62, so width/height lands near 0.9. The reference teacher's
# hand measures 0.52-0.70 - narrow and tall. That proportion is not cosmetic:
# a tall narrow letter keeps its counters open under a fat pen, which is how
# that hand carries a stroke of 0.229-0.554 of its x-height while its ink
# density stays at 0.078-0.156. On a square body the same weight simply fills
# the bowls in. Stretching the glyphs vertically at draw time buys both.
_Y_STRETCH = 1.42

GLYPHS: dict[str, tuple[float, list[list[tuple[float, float]]]]] = {
    " ": (0.34, []),
    # ---- lowercase -------------------------------------------------------
    "a": (0.56, [[(0.48, 0.44), (0.40, 0.60), (0.22, 0.62), (0.10, 0.52), (0.08, 0.30),
                  (0.16, 0.10), (0.34, 0.06), (0.46, 0.16), (0.48, 0.34)],
                 [(0.48, 0.58), (0.48, 0.10), (0.54, 0.02)]]),
    "b": (0.56, [[(0.10, 1.00), (0.10, 0.06)],
                 [(0.10, 0.40), (0.20, 0.58), (0.36, 0.60), (0.48, 0.46), (0.48, 0.22),
                  (0.38, 0.06), (0.22, 0.04), (0.10, 0.16)]]),
    "c": (0.52, [[(0.46, 0.52), (0.34, 0.62), (0.18, 0.58), (0.09, 0.40), (0.10, 0.20),
                  (0.20, 0.06), (0.36, 0.04), (0.47, 0.14)]]),
    "d": (0.56, [[(0.48, 1.00), (0.48, 0.06)],
                 [(0.48, 0.44), (0.38, 0.60), (0.20, 0.62), (0.09, 0.46), (0.09, 0.22),
                  (0.19, 0.06), (0.36, 0.05), (0.48, 0.18)]]),
    "e": (0.52, [[(0.09, 0.34), (0.46, 0.36), (0.44, 0.54), (0.28, 0.62), (0.13, 0.54),
                  (0.08, 0.34), (0.14, 0.12), (0.30, 0.04), (0.46, 0.12)]]),
    "f": (0.36, [[(0.34, 0.94), (0.24, 1.02), (0.16, 0.94), (0.16, 0.00)],
                 [(0.04, 0.60), (0.32, 0.60)]]),
    "g": (0.56, [[(0.48, 0.60), (0.48, -0.14), (0.38, -0.28), (0.20, -0.28), (0.10, -0.20)],
                 [(0.48, 0.44), (0.38, 0.60), (0.20, 0.62), (0.09, 0.46), (0.09, 0.24),
                  (0.19, 0.08), (0.36, 0.07), (0.48, 0.20)]]),
    "h": (0.56, [[(0.10, 1.00), (0.10, 0.02)],
                 [(0.10, 0.42), (0.22, 0.58), (0.38, 0.60), (0.48, 0.46), (0.48, 0.02)]]),
    "i": (0.26, [[(0.13, 0.62), (0.13, 0.02)], [(0.13, 0.82), (0.13, 0.86)]]),
    "j": (0.28, [[(0.16, 0.62), (0.16, -0.16), (0.08, -0.28), (0.00, -0.24)],
                 [(0.16, 0.82), (0.16, 0.86)]]),
    "k": (0.52, [[(0.10, 1.00), (0.10, 0.02)],
                 [(0.46, 0.60), (0.12, 0.26)], [(0.24, 0.36), (0.48, 0.02)]]),
    "l": (0.26, [[(0.12, 1.00), (0.12, 0.10), (0.20, 0.02)]]),
    "m": (0.82, [[(0.08, 0.60), (0.08, 0.02)],
                 [(0.08, 0.44), (0.18, 0.58), (0.32, 0.58), (0.40, 0.44), (0.40, 0.02)],
                 [(0.40, 0.44), (0.50, 0.58), (0.64, 0.58), (0.72, 0.44), (0.72, 0.02)]]),
    "n": (0.56, [[(0.10, 0.60), (0.10, 0.02)],
                 [(0.10, 0.42), (0.22, 0.58), (0.38, 0.60), (0.48, 0.46), (0.48, 0.02)]]),
    "o": (0.56, [[(0.28, 0.62), (0.13, 0.54), (0.08, 0.34), (0.14, 0.12), (0.30, 0.04),
                  (0.45, 0.13), (0.50, 0.34), (0.44, 0.54), (0.28, 0.62)]]),
    "p": (0.56, [[(0.10, 0.60), (0.10, -0.28)],
                 [(0.10, 0.42), (0.22, 0.58), (0.38, 0.60), (0.48, 0.44), (0.48, 0.22),
                  (0.38, 0.06), (0.22, 0.04), (0.10, 0.16)]]),
    "q": (0.56, [[(0.48, 0.60), (0.48, -0.28)],
                 [(0.48, 0.44), (0.38, 0.60), (0.20, 0.62), (0.09, 0.46), (0.09, 0.22),
                  (0.19, 0.06), (0.36, 0.05), (0.48, 0.18)]]),
    "r": (0.40, [[(0.11, 0.60), (0.11, 0.02)],
                 [(0.11, 0.40), (0.22, 0.57), (0.36, 0.60)]]),
    "s": (0.46, [[(0.40, 0.54), (0.26, 0.62), (0.12, 0.56), (0.14, 0.42), (0.30, 0.34),
                  (0.40, 0.24), (0.36, 0.08), (0.20, 0.04), (0.08, 0.12)]]),
    "t": (0.36, [[(0.16, 0.88), (0.16, 0.14), (0.26, 0.03)],
                 [(0.03, 0.60), (0.32, 0.60)]]),
    "u": (0.56, [[(0.10, 0.60), (0.10, 0.18), (0.20, 0.04), (0.36, 0.05), (0.47, 0.20)],
                 [(0.47, 0.60), (0.47, 0.02)]]),
    "v": (0.50, [[(0.06, 0.60), (0.25, 0.02), (0.44, 0.60)]]),
    "w": (0.74, [[(0.05, 0.60), (0.20, 0.02), (0.35, 0.44), (0.50, 0.02), (0.66, 0.60)]]),
    "x": (0.50, [[(0.07, 0.60), (0.44, 0.02)], [(0.44, 0.60), (0.07, 0.02)]]),
    "y": (0.52, [[(0.07, 0.60), (0.26, 0.06)],
                 [(0.46, 0.60), (0.20, -0.28), (0.06, -0.26)]]),
    "z": (0.48, [[(0.08, 0.60), (0.42, 0.60), (0.08, 0.03), (0.43, 0.03)]]),
    # ---- uppercase -------------------------------------------------------
    "A": (0.64, [[(0.04, 0.00), (0.32, 1.00), (0.60, 0.00)], [(0.14, 0.32), (0.50, 0.32)]]),
    "B": (0.60, [[(0.11, 0.00), (0.11, 1.00), (0.40, 1.00), (0.52, 0.86), (0.48, 0.62),
                  (0.30, 0.54)], [(0.11, 0.54), (0.40, 0.52), (0.55, 0.36), (0.50, 0.10),
                  (0.34, 0.00), (0.11, 0.00)]]),
    "C": (0.62, [[(0.56, 0.84), (0.40, 1.00), (0.20, 0.94), (0.08, 0.66), (0.08, 0.34),
                  (0.20, 0.08), (0.40, 0.00), (0.57, 0.14)]]),
    "D": (0.64, [[(0.11, 0.00), (0.11, 1.00), (0.36, 1.00), (0.54, 0.82), (0.56, 0.44),
                  (0.42, 0.08), (0.20, 0.00), (0.11, 0.00)]]),
    "E": (0.56, [[(0.50, 1.00), (0.11, 1.00), (0.11, 0.00), (0.52, 0.00)],
                 [(0.11, 0.52), (0.40, 0.52)]]),
    "F": (0.54, [[(0.50, 1.00), (0.11, 1.00), (0.11, 0.00)], [(0.11, 0.54), (0.40, 0.54)]]),
    "G": (0.66, [[(0.58, 0.84), (0.40, 1.00), (0.20, 0.92), (0.08, 0.64), (0.09, 0.32),
                  (0.22, 0.06), (0.42, 0.00), (0.58, 0.14), (0.58, 0.40), (0.38, 0.40)]]),
    "H": (0.64, [[(0.10, 1.00), (0.10, 0.00)], [(0.54, 1.00), (0.54, 0.00)],
                 [(0.10, 0.52), (0.54, 0.52)]]),
    "I": (0.28, [[(0.14, 1.00), (0.14, 0.00)]]),
    "J": (0.44, [[(0.34, 1.00), (0.34, 0.20), (0.24, 0.02), (0.08, 0.04)]]),
    "K": (0.60, [[(0.11, 1.00), (0.11, 0.00)], [(0.54, 1.00), (0.13, 0.46)],
                 [(0.26, 0.58), (0.56, 0.00)]]),
    "L": (0.50, [[(0.12, 1.00), (0.12, 0.00), (0.48, 0.00)]]),
    "M": (0.78, [[(0.08, 0.00), (0.08, 1.00), (0.38, 0.28), (0.68, 1.00), (0.68, 0.00)]]),
    "N": (0.66, [[(0.10, 0.00), (0.10, 1.00), (0.56, 0.06), (0.56, 1.00)]]),
    "O": (0.68, [[(0.34, 1.00), (0.14, 0.88), (0.07, 0.56), (0.12, 0.20), (0.32, 0.00),
                  (0.52, 0.10), (0.60, 0.44), (0.54, 0.84), (0.34, 1.00)]]),
    "P": (0.58, [[(0.11, 0.00), (0.11, 1.00), (0.40, 1.00), (0.54, 0.86), (0.50, 0.62),
                  (0.30, 0.52), (0.11, 0.52)]]),
    "Q": (0.68, [[(0.34, 1.00), (0.14, 0.88), (0.07, 0.56), (0.12, 0.20), (0.32, 0.00),
                  (0.52, 0.10), (0.60, 0.44), (0.54, 0.84), (0.34, 1.00)],
                 [(0.40, 0.24), (0.64, -0.08)]]),
    "R": (0.60, [[(0.11, 0.00), (0.11, 1.00), (0.40, 1.00), (0.53, 0.86), (0.48, 0.62),
                  (0.28, 0.54), (0.11, 0.54)], [(0.32, 0.52), (0.56, 0.00)]]),
    "S": (0.54, [[(0.48, 0.88), (0.30, 1.00), (0.12, 0.90), (0.14, 0.66), (0.36, 0.54),
                  (0.48, 0.38), (0.44, 0.10), (0.24, 0.00), (0.08, 0.12)]]),
    "T": (0.54, [[(0.04, 1.00), (0.50, 1.00)], [(0.27, 1.00), (0.27, 0.00)]]),
    "U": (0.64, [[(0.10, 1.00), (0.10, 0.24), (0.24, 0.02), (0.44, 0.03), (0.55, 0.24),
                  (0.55, 1.00)]]),
    "V": (0.62, [[(0.05, 1.00), (0.32, 0.00), (0.58, 1.00)]]),
    "W": (0.86, [[(0.04, 1.00), (0.22, 0.00), (0.42, 0.66), (0.60, 0.00), (0.78, 1.00)]]),
    "X": (0.60, [[(0.07, 1.00), (0.54, 0.00)], [(0.54, 1.00), (0.07, 0.00)]]),
    "Y": (0.60, [[(0.06, 1.00), (0.30, 0.50), (0.54, 1.00)], [(0.30, 0.50), (0.30, 0.00)]]),
    "Z": (0.56, [[(0.08, 1.00), (0.50, 1.00), (0.08, 0.00), (0.52, 0.00)]]),
    # ---- digits ----------------------------------------------------------
    "0": (0.56, [[(0.28, 0.96), (0.12, 0.80), (0.08, 0.48), (0.13, 0.14), (0.28, 0.00),
                  (0.44, 0.14), (0.49, 0.48), (0.44, 0.82), (0.28, 0.96)]]),
    "1": (0.34, [[(0.08, 0.78), (0.22, 0.96), (0.22, 0.00)]]),
    "2": (0.52, [[(0.09, 0.80), (0.24, 0.96), (0.42, 0.88), (0.42, 0.64), (0.10, 0.16),
                  (0.08, 0.00), (0.46, 0.00)]]),
    "3": (0.52, [[(0.10, 0.86), (0.28, 0.97), (0.44, 0.86), (0.38, 0.60), (0.24, 0.54)],
                 [(0.30, 0.54), (0.46, 0.44), (0.44, 0.14), (0.26, 0.00), (0.09, 0.10)]]),
    "4": (0.54, [[(0.38, 0.00), (0.38, 0.96), (0.06, 0.30), (0.50, 0.30)]]),
    "5": (0.52, [[(0.44, 0.96), (0.14, 0.96), (0.11, 0.56), (0.28, 0.62), (0.44, 0.50),
                  (0.44, 0.20), (0.26, 0.00), (0.09, 0.10)]]),
    "6": (0.54, [[(0.44, 0.90), (0.26, 0.98), (0.12, 0.76), (0.09, 0.36), (0.18, 0.06),
                  (0.36, 0.02), (0.47, 0.20), (0.42, 0.44), (0.22, 0.50), (0.10, 0.36)]]),
    "7": (0.50, [[(0.07, 0.96), (0.46, 0.96), (0.22, 0.00)]]),
    "8": (0.54, [[(0.28, 0.54), (0.13, 0.64), (0.14, 0.86), (0.30, 0.97), (0.44, 0.86),
                  (0.42, 0.64), (0.28, 0.54), (0.12, 0.42), (0.10, 0.16), (0.28, 0.00),
                  (0.46, 0.14), (0.44, 0.42), (0.28, 0.54)]]),
    "9": (0.54, [[(0.12, 0.10), (0.28, 0.00), (0.44, 0.22), (0.47, 0.62), (0.36, 0.94),
                  (0.20, 0.96), (0.10, 0.78), (0.16, 0.56), (0.36, 0.52), (0.46, 0.64)]]),
    # ---- punctuation -----------------------------------------------------
    ".": (0.26, [[(0.12, 0.04), (0.15, 0.02)]]),
    ",": (0.26, [[(0.15, 0.06), (0.09, -0.12)]]),
    ";": (0.26, [[(0.14, 0.34), (0.16, 0.32)], [(0.15, 0.06), (0.09, -0.12)]]),
    ":": (0.26, [[(0.14, 0.36), (0.16, 0.34)], [(0.14, 0.06), (0.16, 0.04)]]),
    "-": (0.42, [[(0.06, 0.34), (0.36, 0.34)]]),
    "/": (0.44, [[(0.05, -0.04), (0.38, 0.98)]]),
    "(": (0.30, [[(0.24, 1.00), (0.10, 0.66), (0.10, 0.28), (0.24, -0.06)]]),
    ")": (0.30, [[(0.07, 1.00), (0.21, 0.66), (0.21, 0.28), (0.07, -0.06)]]),
    "'": (0.20, [[(0.10, 0.98), (0.08, 0.76)]]),
    "&": (0.66, [[(0.58, 0.00), (0.22, 0.62), (0.20, 0.86), (0.34, 0.97), (0.44, 0.86),
                  (0.38, 0.66), (0.10, 0.40), (0.10, 0.14), (0.28, 0.00), (0.52, 0.16)]]),
    "?": (0.48, [[(0.09, 0.80), (0.24, 0.97), (0.40, 0.86), (0.36, 0.62), (0.23, 0.50),
                  (0.23, 0.32)], [(0.23, 0.06), (0.25, 0.04)]]),
    "!": (0.24, [[(0.12, 0.96), (0.12, 0.26)], [(0.12, 0.06), (0.14, 0.04)]]),
    "+": (0.46, [[(0.06, 0.42), (0.40, 0.42)], [(0.23, 0.60), (0.23, 0.24)]]),
    "=": (0.46, [[(0.06, 0.50), (0.40, 0.50)], [(0.06, 0.28), (0.40, 0.28)]]),
    "%": (0.66, [[(0.08, 0.96), (0.56, 0.96)], [(0.12, 0.96), (0.12, 0.66)],
                 [(0.52, 0.30), (0.52, 0.00)], [(0.08, 0.00), (0.56, 0.00)]]),
}

def _smooth(points: list, per_seg: int = 4) -> list:
    """Catmull-Rom through `points`, so a curve reads as a curve.

    The glyphs are defined with only a handful of control points to keep this
    file readable, which meant 'o', 'e' and 'c' rendered as a few straight
    chords - visible as polygons at zoom, and one of the things that gave the
    lettering away as synthetic.
    """
    if len(points) < 3:
        return points
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(len(pts) - 3):
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        for k in range(per_seg):
            t = k / per_seg
            t2, t3 = t * t, t * t * t
            out.append((
                0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
                       + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                       + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
                       + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                       + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
            ))
    out.append(points[-1])
    return out


_FALLBACK = GLYPHS["-"]
DEFAULT_ADVANCE = 0.52


def text_width(text: str, size: float, tracking: float = 0.06) -> float:
    """Width of `text` drawn at `size`, in the same units as size."""
    total = 0.0
    for ch in text:
        adv, _ = GLYPHS.get(ch, (DEFAULT_ADVANCE, _FALLBACK[1]))
        total += (adv + tracking) * size
    return total


def draw_text(draw_stroke, origin_x: float, baseline_y: float, text: str,
              size: float, rng, slant: float = 0.0, tracking: float = 0.06) -> float:
    """Draw `text` as pen strokes. Returns the x advance used.

    `draw_stroke(points, width_scale)` receives a list of (x, y) in page space,
    already sloped and jittered, and is expected to ink it with the same
    wobbling pen the rest of the marking uses - which is what makes each
    instance of a letter differ from the last.
    """
    import math

    x = origin_x
    drift = 0.0
    lean = math.tan(math.radians(slant))
    for ch in text:
        adv, strokes = GLYPHS.get(ch, (DEFAULT_ADVANCE, _FALLBACK[1]))
        if ch == " " or not strokes:
            x += (adv + tracking) * size * rng.uniform(0.95, 1.05)
            continue
        # The hand wanders off the line gradually, and letters vary in size.
        # The reference hand is consistent, not wobbly: repeated words measure
        # within a pixel of each other. Tight variation reads as a fast, even
        # teacher print; the wide jitter I had been using reads as scribble.
        drift = max(-0.035, min(0.035, drift + rng.uniform(-0.012, 0.012)))
        h = size * _Y_STRETCH * rng.uniform(0.985, 1.015)
        w = size * rng.uniform(0.985, 1.015)
        rot = math.radians(rng.uniform(-1.0, 1.0))
        cs, sn = math.cos(rot), math.sin(rot)
        for stroke in strokes:
            # Per-instance shape noise BEFORE smoothing, so the same letter
            # comes out a different shape each time rather than the same
            # outline nudged. A critic measured repeated glyphs at 0.034-0.13
            # apart against a 0.435 median for genuinely different letters -
            # i.e. the same stamp. The jitter is proportional to the glyph, so
            # it stays legible at any size.
            # Barely any. The reference renders the same letter the same way
            # every time - "Good" appears twice with letter widths matching
            # within 1px - so heavy per-instance noise is wrong for this style.
            j = 0.004
            noisy = [(gx + rng.uniform(-j, j), gy + rng.uniform(-j, j)) for gx, gy in stroke]
            smooth = _smooth(noisy)
            pts = []
            for gx, gy in smooth:
                px = gx * w
                py = gy * h
                rx = px * cs - py * sn
                ry = px * sn + py * cs
                # y grows upward in glyph space, downward on the page
                fx = x + rx + (gy * h) * lean
                fy = baseline_y - ry + drift * size
                pts.append((fx, fy))
            draw_stroke(pts, rng.uniform(0.85, 1.2))
        x += (adv + tracking) * size * rng.uniform(0.99, 1.01)
    return x - origin_x
