"""The teacher's pen for a checked copy: ink colour, darkness, handwriting face, size.

An institute (Settings -> Assessment -> AI copy check) or a teacher re-drawing
one copy picks these; ``None`` everywhere draws the usual copy (red ballpoint,
the default natural hand, page-scaled sizes).

The style is set for the duration of one render with :func:`applied`. Renders
run on annotator's single-worker pool, so one module-level holder is enough
(the same pattern as annotator's ``_PEN`` / ``_LINE_H`` holders).

Accepted request shape (every key optional, unknown values ignored)::

    {"ink": "BLUE" | "#1f3fa0", "font": "PATRICK_HAND", "size": "LARGE", "darkness": 70}
"""
from __future__ import annotations

import re
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Iterator, Optional

# RGB on PyMuPDF's 0-1 scale. RED is the default copy (None = unchanged).
PRESET_INKS: dict[str, Optional[tuple[float, float, float]]] = {
    "RED": None,
    "BLUE": (0.09, 0.24, 0.62),
    "GREEN": (0.07, 0.43, 0.21),
    "BLACK": (0.12, 0.12, 0.14),
    "PURPLE": (0.42, 0.16, 0.55),
}

# Bundled, OFL-licensed faces in ./fonts. DAWNING_OF_A_NEW_DAY is the default copy; the
# natural hands are bent as they are written (hand_render._natural_text), the three
# classic ones are set letter by letter as they always were.
FONTS: dict[str, Optional[str]] = {
    "DAWNING_OF_A_NEW_DAY": None,
    "COVERED_BY_YOUR_GRACE": "CoveredByYourGrace.ttf",
    "OVER_THE_RAINBOW": "OvertheRainbow.ttf",
    "CAVEAT": "Caveat.ttf",
    "CEDARVILLE_CURSIVE": "Cedarville-Cursive.ttf",
    "KALAM": "Kalam.ttf",
    "PATRICK_HAND": "PatrickHand.ttf",
    "ARCHITECTS_DAUGHTER": "ArchitectsDaughter.ttf",
}

# Multiplier on the size the placement ladder chose. Kept modest: notes are
# fitted into the gaps between the student's lines, and a much larger pen
# stops fitting there.
SIZES: dict[str, float] = {"SMALL": 0.85, "MEDIUM": 1.0, "LARGE": 1.15}

_HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")

# 0 (lightest) .. 100 (darkest); 50 leaves the ink as it is. The ends stop short of
# white and black so a remark stays readable on the student's page.
DARKNESS_NEUTRAL = 50
_MAX_LIGHTEN = 0.38
_MAX_DARKEN = 0.34
# The usual pen's ink (hand_render.INK), for a darkness chosen without a colour.
_USUAL_INK = (214 / 255.0, 28 / 255.0, 40 / 255.0)


@dataclass(frozen=True)
class PenStyle:
    ink: Optional[tuple[float, float, float]] = None
    font_file: Optional[str] = None
    scale: float = 1.0
    darkness: int = DARKNESS_NEUTRAL

    @property
    def is_default(self) -> bool:
        return (self.ink is None and self.font_file is None and abs(self.scale - 1.0) < 1e-9
                and self.darkness == DARKNESS_NEUTRAL)


def _parse_ink(raw: Any) -> Optional[tuple[float, float, float]]:
    if not isinstance(raw, str) or not raw.strip():
        return None
    key = raw.strip().upper()
    if key in PRESET_INKS:
        return PRESET_INKS[key]
    m = _HEX.match(raw.strip())
    if not m:
        return None
    h = m.group(1)
    return tuple(round(int(h[i:i + 2], 16) / 255.0, 4) for i in (0, 2, 4))  # type: ignore[return-value]


def _parse_darkness(raw: Any) -> int:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return DARKNESS_NEUTRAL
    return int(max(0, min(100, round(raw))))


def _shade(rgb: tuple[float, float, float], darkness: int) -> tuple[float, float, float]:
    """`rgb` mixed towards white below neutral, scaled towards black above it."""
    if darkness < DARKNESS_NEUTRAL:
        t = _MAX_LIGHTEN * (DARKNESS_NEUTRAL - darkness) / DARKNESS_NEUTRAL
        return tuple(round(c + (1.0 - c) * t, 4) for c in rgb)  # type: ignore[return-value]
    if darkness > DARKNESS_NEUTRAL:
        k = 1.0 - _MAX_DARKEN * (darkness - DARKNESS_NEUTRAL) / DARKNESS_NEUTRAL
        return tuple(round(c * k, 4) for c in rgb)  # type: ignore[return-value]
    return rgb


def parse(raw: Any) -> Optional[PenStyle]:
    """A PenStyle from the request dict, or None when it changes nothing."""
    if not isinstance(raw, dict):
        return None
    ink = _parse_ink(raw.get("ink"))
    font = FONTS.get(str(raw.get("font") or "").strip().upper())
    scale = SIZES.get(str(raw.get("size") or "").strip().upper(), 1.0)
    style = PenStyle(ink=ink, font_file=font, scale=scale, darkness=_parse_darkness(raw.get("darkness")))
    return None if style.is_default else style


_CURRENT: list[Optional[PenStyle]] = [None]


@contextmanager
def applied(style: Optional[PenStyle]) -> Iterator[None]:
    prev = _CURRENT[0]
    _CURRENT[0] = style
    try:
        yield
    finally:
        _CURRENT[0] = prev


def ink() -> Optional[tuple[float, float, float]]:
    """The chosen ink at the chosen darkness (0-1 RGB), or None for the usual colours."""
    s = _CURRENT[0]
    if s is None:
        return None
    if s.ink is None and s.darkness == DARKNESS_NEUTRAL:
        return None
    return _shade(s.ink or _USUAL_INK, s.darkness)


def ink_255() -> Optional[tuple[int, int, int]]:
    c = ink()
    return None if c is None else (int(round(c[0] * 255)), int(round(c[1] * 255)), int(round(c[2] * 255)))


def font_file() -> Optional[str]:
    """File name (in ./fonts) of the chosen hand, or None for the usual one."""
    s = _CURRENT[0]
    return s.font_file if s else None


def scale() -> float:
    s = _CURRENT[0]
    return s.scale if s else 1.0


def colour(default: Any) -> Any:
    """The chosen ink when one is set, else ``default`` (call sites keep their colour)."""
    c = ink()
    return default if c is None else c
