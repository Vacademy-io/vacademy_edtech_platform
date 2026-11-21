"""Refuse a copy written in Devanagari before it is graded (spec 7.6, T1.15).

Row OCR is English-only (render_worker/pdf_ocr/layout_ocr.py) and no Hindi
evaluation set has passed yet, so a Hindi copy must never be graded as if it
were English. After the vision transcript, if more than 20% of the letters the
student wrote are Devanagari, the copy fails with `language_not_supported`
(not billed).

Letters only (Unicode category L*): Devanagari vowel signs are combining marks
and Latin has none, so counting marks would tilt the share. Printed question
text is left out (a bilingual question paper is not a Hindi answer), and so are
rows the reader marked illegible.
"""
from __future__ import annotations

import os
import unicodedata
from typing import Any

DEVANAGARI_SHARE_LIMIT = 0.20
# Below this many letters there is too little writing to judge the language;
# the readability gate decides those copies.
MIN_LETTERS = 30


def _is_devanagari(ch: str) -> bool:
    cp = ord(ch)
    return 0x0900 <= cp <= 0x097F or 0xA8E0 <= cp <= 0xA8FF


def letter_counts(text: str) -> tuple[int, int]:
    """(devanagari letters, all letters) in `text`."""
    deva = total = 0
    for ch in text or "":
        if not unicodedata.category(ch).startswith("L"):
            continue
        total += 1
        if _is_devanagari(ch):
            deva += 1
    return deva, total


def student_text(layout_map: dict[str, Any]) -> str:
    """What the student wrote: the transcript rows minus printed and illegible
    ones. A page whose rows carry no text falls back to its vision reading."""
    parts: list[str] = []
    for page in (layout_map or {}).get("pages") or []:
        rows = [str(line.get("text") or "") for line in page.get("lines") or []
                if not line.get("printed") and not line.get("illegible")]
        if any(r.strip() for r in rows):
            parts.extend(rows)
        elif page.get("vision_text"):
            parts.append(str(page.get("vision_text")))
    return "\n".join(parts)


def devanagari_share(layout_map: dict[str, Any]) -> tuple[float, int]:
    """(share of letters that are Devanagari, letters counted)."""
    deva, total = letter_counts(student_text(layout_map))
    return (deva / total if total else 0.0), total


def is_unsupported_language(layout_map: dict[str, Any]) -> bool:
    share, letters = devanagari_share(layout_map)
    return letters >= MIN_LETTERS and share > DEVANAGARI_SHARE_LIMIT


def applies_to(billing_actor: Any) -> bool:
    """API runs always. Dashboard runs only when
    COPY_CHECK_REFUSE_DEVANAGARI_ALL is on: dashboard institutes grade Hindi
    papers today, and refusing them is a product decision, not this check's."""
    if isinstance(billing_actor, str) and billing_actor.startswith("apikey:"):
        return True
    return os.getenv("COPY_CHECK_REFUSE_DEVANAGARI_ALL", "").strip().lower() in ("1", "true", "yes", "on")
