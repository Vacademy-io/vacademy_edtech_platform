"""Checks that a quote the model cites really appears on the page it cites."""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "})
# Share of the quote that must match contiguously when it is not an exact substring
# (tolerates spacing or punctuation differences, not invented text).
FUZZY_THRESHOLD = 0.85
MIN_QUOTE_CHARS = 8


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_QUOTES).lower()
    return re.sub(r"\s+", " ", text).strip()


def quote_is_supported(quote: str, page_text: str) -> bool:
    q = normalise(quote).rstrip("…").rstrip(".").strip()
    if len(q) < MIN_QUOTE_CHARS:
        return False
    page = normalise(page_text)
    if q in page:
        return True
    # Ignore punctuation entirely, then allow a near-complete contiguous match.
    q_bare = re.sub(r"[^\w ]", "", q)
    page_bare = re.sub(r"[^\w ]", "", page)
    if q_bare and q_bare in page_bare:
        return True
    match = SequenceMatcher(None, page_bare, q_bare, autojunk=False).find_longest_match(0, len(page_bare), 0, len(q_bare))
    return match.size >= FUZZY_THRESHOLD * len(q_bare)
