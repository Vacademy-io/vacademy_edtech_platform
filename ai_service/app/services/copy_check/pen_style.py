"""The teacher's pen for a checked copy: ink colour, handwriting face, size.

An institute (Settings -> Assessment -> AI copy check) or a teacher re-drawing
one copy picks these; ``None`` everywhere keeps the copy exactly as it has
always been drawn (maroon notes, red ballpoint marks, Kalam, page-scaled sizes).

The style is set for the duration of one render with :func:`applied`. Renders
run on annotator's single-worker pool, so one module-level holder is enough
(the same pattern as annotator's ``_PEN`` / ``_LINE_H`` holders).

Accepted request shape (every key optional, unknown values ignored)::

    {"ink": "BLUE" | "#1f3fa0", "font": "PATRICK_HAND", "size": "LARGE"}
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

# Bundled, OFL-licensed faces in ./fonts. KALAM is the default copy.
FONTS: dict[str, Optional[str]] = {
    "KALAM": None,
    "PATRICK_HAND": "PatrickHand.ttf",
    "ARCHITECTS_DAUGHTER": "ArchitectsDaughter.ttf",
}

# Multiplier on the size the placement ladder chose. Kept modest: notes are
# fitted into the gaps between the student's lines, and a much larger pen
# stops fitting there.
SIZES: dict[str, float] = {"SMALL": 0.85, "MEDIUM": 1.0, "LARGE": 1.15}

_HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")


@dataclass(frozen=True)
class PenStyle:
    ink: Optional[tuple[float, float, float]] = None
    font_file: Optional[str] = None
    scale: float = 1.0

    @property
    def is_default(self) -> bool:
        return self.ink is None and self.font_file is None and abs(self.scale - 1.0) < 1e-9


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


def parse(raw: Any) -> Optional[PenStyle]:
    """A PenStyle from the request dict, or None when it changes nothing."""
    if not isinstance(raw, dict):
        return None
    ink = _parse_ink(raw.get("ink"))
    font = FONTS.get(str(raw.get("font") or "").strip().upper())
    scale = SIZES.get(str(raw.get("size") or "").strip().upper(), 1.0)
    style = PenStyle(ink=ink, font_file=font, scale=scale)
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
    """The chosen ink (0-1 RGB), or None for the usual colours."""
    s = _CURRENT[0]
    return s.ink if s else None


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
