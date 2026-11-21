"""Kinds of organisations a run leaves out ("Schools & playschools", "Colleges & universities", or
any type the salesperson types), matched against industries and organisation names.

Mirrors leftOutBy() in web/src/lib/guided.ts, which hides left-out industries in the form.
"""

from __future__ import annotations

import re

# "School of Design", "business school", "coding school": training institutes, not K-12 schools.
_TRAINING_SCHOOL = re.compile(
    r"\b(?:business|design|coding|programming|music|dance|art|arts|film|acting|language|driving|flying|aviation|"
    r"culinary|cooking|beauty|fashion|management|computer|it|tech|data|digital|marketing)\s+schools?\b"
    r"|\bschools?\s+of\b",
    re.I,
)
_SCHOOL = re.compile(r"\b(?:k\s*-?\s*12|play\s*-?\s*schools?|pre\s*-?\s*schools?|kindergartens?|montessori|nursery|"
                     r"vidyalaya|schools?)\b", re.I)
_COLLEGE = re.compile(r"\b(?:colleges?|universit(?:y|ies)|higher\s+education)\b", re.I)
_FILLER = {"and", "the", "for", "with", "other", "all", "any", "only"}


def _pattern(phrase: str) -> re.Pattern | None:
    lowered = phrase.lower()
    if re.search(r"school|k-?12|kindergarten|montessori|nursery", lowered):
        return _SCHOOL
    if re.search(r"college|universit|higher education", lowered):
        return _COLLEGE
    words = [re.sub(r"(?:es|s)$", "", w) for w in re.findall(r"[a-z]{4,}", lowered) if w not in _FILLER]
    if not words:
        return None
    return re.compile(r"\b(?:" + "|".join(re.escape(w) for w in words) + r")(?:e?s)?\b", re.I)


def left_out(text: str, phrases: list[str] | None) -> str | None:
    """The leave-out phrase that this text (an industry or an organisation's name) falls under, if any."""
    for phrase in phrases or []:
        pattern = _pattern(phrase)
        if pattern is None:
            continue
        subject = _TRAINING_SCHOOL.sub(" ", text) if pattern is _SCHOOL else text
        if pattern.search(subject):
            return phrase
    return None


def kept_industries(industries: list[dict], phrases: list[str] | None) -> list[dict]:
    """The run's industries without left-out ones (all of them if every one would be left out)."""
    kept = [i for i in industries if not left_out(f"{i.get('name', '')} {i.get('search_term', '')}", phrases)]
    return kept or industries
