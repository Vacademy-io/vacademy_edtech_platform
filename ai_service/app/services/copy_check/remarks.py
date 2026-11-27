"""The remark a teacher writes beside every mark that was cut.

The grader explains each rubric line in criteria_breakdown[].reason ("1 mark
deducted because Section 4/6 definition of partnership not stated (p6_r7)"),
but the checked copy only ever carried one short note per question plus the
score - so a student saw 6/10 and four ticks, and nothing that said where the
other four marks went. Here every line that lost marks becomes a short pen
remark, "Section 4/6 definition of partnership not stated (-1)", anchored on the
row its reason names. Lines for parts the student never wrote are gathered into
one remark ("5(a)(i), 5(a)(ii) not attempted (-6)").

Render-time only: the verdict that is stored is not touched, so a saved copy
drawn again gets the same remarks as a fresh check.
"""
from __future__ import annotations

import re
from typing import Any, Iterable, Optional

# Remarks per question, besides the "not attempted" one. A ten-line rubric can
# lose marks on every line; past this many the margin becomes a wall of text.
MAX_REMARKS = 6
# A remark is a margin note, not the reason paragraph. Longer ones are cut at a
# clause boundary (see _short).
MAX_REMARK_CHARS = 84

_ROW = re.compile(r"\bp\d+_[a-z]+\d+\b")
# A row reference with the words that glue it into the sentence:
# "(p6_r7)", "[p2_r4]", "(p3_r25 area)", "at p5_r13", "on p6_r1-p6_r5",
# "(p1_r17 onwards)".
_ROW_REF = re.compile(
    r"\s*[\(\[]\s*(?:at |on |in |see )?p\d+_[a-z]+\d+(?:\s*[-–,]\s*(?:p\d+_)?[a-z]*\d+)*"
    r"(?:\s+(?:area|onwards))?\s*[\)\]]"
    r"|\s*\b(?:at|on|in|from)\s+p\d+_[a-z]+\d+(?:\s*[-–]\s*(?:p\d+_)?[a-z]*\d+)?(?:\s+onwards)?"
    r"|\bp\d+_[a-z]+\d+(?:\s*[-–]\s*(?:p\d+_)?[a-z]*\d+)?",
    re.I)
_MARKS_LEAD = re.compile(
    r"^\s*(?:re-?checked against the handwriting\s*:\s*)?"
    r"(?:\d+(?:\.\d+)?\s*marks?(?:\(s\))?\s+(?:deducted|lost|cut)\s*(?:because|as|since|for)?\s*[:\-–]?\s*"
    r"|(?:no marks?|half marks?|partial(?: marks| credit)?|marks? deducted(?: because)?|deducted(?: because)?)"
    r"\s*[:\-–]?\s*"
    # "0 deducted because" + a Hindi reason: a grader on a Hindi copy dropped
    # the word "mark" (only before Devanagari - English remarks are unchanged).
    r"|\d+(?:\.\d+)?\s+deducted\s+because\s*[:\-–]?\s*(?=[\u0900-\u097F])"
    # The same lead written in Hindi: "0.5 अंक कटे क्योंकि", "1 अंक काटा गया:".
    r"|\d+(?:\.\d+)?\s*अंक\s*(?:कटे|कटा|काटे गए|काटा गया|कम किए गए|कम किया गया)\s*(?:क्योंकि|,)?\s*[:\-–]?\s*)?",
    re.I)
_RECHECK_LEAD = re.compile(r"^\s*re-?checked against the handwriting\s*:\s*", re.I)
# The part of "X stated but Y missing" that says what is wrong.
_CONTRAST = re.compile(r"\s+(?:but|though|although|however|लेकिन|परंतु|परन्तु|किंतु|किन्तु)\s+", re.I)
# No \b around the Hindi words: a vowel sign (matra) is not a word character
# to Python's re, so \b falls inside most Hindi words.
_NOT_ATTEMPTED = re.compile(
    r"\b(?:not attempted|unattempted|not answered|not found in the copy|not in the copy|"
    r"no answer)\b"
    # Whole-answer phrases only: "भावार्थ नहीं मिला" (a point missing) or
    # "सही उत्तर नहीं लिखा" (a wrong answer) are cuts with their own remark.
    r"|अनुत्तरित|(?<!सही )उत्तर\s+नहीं\s+मिला|(?<!सही )उत्तर\s+नहीं\s+दिया|लिखा\s+ही\s+नहीं|लिखी\s+ही\s+नहीं",
    re.I)
_FAULT = re.compile(
    r"\b(?:missing|not|never|wrong(?:ly)?|lack(?:s|ing)?|absent|vague|incorrect|omitted)\b"
    r"|नहीं|गलत|अधूर|छूट|अशुद्ध|अस्पष्ट|अनुपस्थित|उल्टा|उलटा|गायब", re.I)
_DEVANAGARI = re.compile("[ऀ-ॿ]")


def _mostly_devanagari(text: str) -> bool:
    """More Devanagari than Latin letters (a Devanagari letter carries about
    half an English letter's worth of a word, hence the 2x)."""
    return len(_DEVANAGARI.findall(text)) > 2 * sum(1 for ch in text if ch.isascii() and ch.isalpha())
# "5(a)(i)", "2(b)", "Question 3(b)(ii)".
_PART = re.compile(r"\b(\d+\s*\([a-z]\)(?:\s*\([ivx]+\))?)", re.I)


def _fmt(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:g}"


def _num(v: Any) -> Optional[float]:
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def reason_text(reason: str) -> str:
    """A cut's reason as the teacher would say it, whole: without the "1 mark
    deducted because" lead and the row ids, nothing else changed (the comments
    panel has the room a margin remark does not)."""
    s = " ".join(str(reason or "").split())
    s = _RECHECK_LEAD.sub("", s)
    s = _ROW_REF.sub("", s)
    s = _MARKS_LEAD.sub("", s, count=1)
    s = re.sub(r"\s+([,;:.])", r"\1", s).strip(" ,;:-–")
    return (s[0].upper() + s[1:]) if s else ""


def _short(reason: str) -> str:
    """The reason as a margin remark: no marks arithmetic, no row ids, the
    part that says what is missing, one clause when it runs long."""
    s = " ".join(str(reason or "").split())
    s = _RECHECK_LEAD.sub("", s)
    s = _ROW_REF.sub("", s)
    s = _MARKS_LEAD.sub("", s, count=1)
    parts = _CONTRAST.split(s)
    if len(parts) > 1 and len(parts[-1].split()) >= 2:
        s = parts[-1]
    s = s.strip(" ,;:.-–")
    if len(s) > MAX_REMARK_CHARS:
        for sep in (";", " - ", " – ", ", only", ", "):
            if sep not in s:
                continue
            clauses = [c.strip(" ,;:.-") for c in s.split(sep)]
            clauses = [c for c in clauses if len(c.split()) >= 3]
            if clauses:
                # The clause that says what is wrong, not the one that says
                # what was right: "only 'no fixed period' stated; 'no
                # provision for determination' condition missing".
                s = next((c for c in clauses if _FAULT.search(c)), clauses[0])
                break
    if len(s) > MAX_REMARK_CHARS:
        s = s[:MAX_REMARK_CHARS].rsplit(" ", 1)[0].rstrip(" ,;:-")
    if s.lower().startswith("the "):
        s = s[4:]
    s = re.sub(r"\s+([,;:.])", r"\1", s).strip()
    return (s[0].upper() + s[1:]) if s else ""


def _anchor(verdict: dict[str, Any], valid: set[str]) -> Optional[str]:
    """Where a remark with no row of its own goes: the end of the answer, as
    the grader marked it - its score's row, else its note's, else the last
    tick or cross."""
    anns = [a for a in verdict.get("annotations") or [] if isinstance(a, dict)]
    for styles in (("score",), ("margin_note", "region_note"), ("tick", "cross")):
        rows = [str(a.get("target")) for a in anns
                if a.get("style") in styles and str(a.get("target")) in valid]
        if rows:
            return rows[-1]
    return None


def add_cut_remarks(verdict: dict[str, Any], valid_rows: Iterable[str]) -> int:
    """Add a `deduction_reason` annotation for every rubric line that lost
    marks; returns how many were added.

    The grader's own summary note (margin_note) is dropped when remarks are
    added - the remarks say the same thing line by line, and the summary was
    sometimes praise ("You earned credit for ..."). A verdict that already
    carries deduction reasons (a deduction-scheme copy) is left alone, and so is
    a row the grader could not read for sure (review.unclear_reads): a remark
    saying the answer is wrong is exactly what a misread must not produce."""
    if str(verdict.get("status") or "").upper() == "FAILED":
        return 0
    anns = verdict.get("annotations")
    if not isinstance(anns, list):
        return 0
    if any(isinstance(a, dict) and a.get("style") == "deduction_reason" for a in anns):
        return 0
    valid = set(valid_rows)
    unsure = {str(r.get("row")) for r in verdict.get("unclear_reads") or []
              if isinstance(r, dict) and r.get("row")}
    anchor = _anchor(verdict, valid)

    remarks: list[tuple[str, str]] = []           # (row, text)
    seen: set[str] = set()
    missing_lost = 0.0
    missing_parts: list[str] = []
    missing_reasons: list[str] = []
    for item in verdict.get("criteria_breakdown") or []:
        if not isinstance(item, dict):
            continue
        marks = _num(item.get("marks"))
        ceiling = _num(item.get("max", item.get("max_marks")))
        if marks is None or ceiling is None or ceiling <= 0 or marks >= ceiling - 1e-9:
            continue
        lost = ceiling - max(0.0, marks)
        reason = str(item.get("reason") or "")
        if _NOT_ATTEMPTED.search(reason) and marks <= 0:
            missing_lost += lost
            missing_reasons.append(reason)
            for p in _PART.findall(reason):
                p = re.sub(r"\s+", "", p)
                if p not in missing_parts:
                    missing_parts.append(p)
            continue
        rows = [r for r in _ROW.findall(reason) if r in valid]
        if any(r in unsure for r in _ROW.findall(reason)):
            continue
        row = rows[0] if rows else anchor
        text = _short(reason)
        if not row or not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        remarks.append((row, f"{text} (-{_fmt(lost)})"))

    remarks = remarks[:MAX_REMARKS]
    if missing_lost > 0 and anchor:
        if missing_reasons and all(_mostly_devanagari(reason_text(r)) for r in missing_reasons):
            # A Hindi copy gets the grader's own Hindi words ("भावार्थ लिखा ही
            # नहीं"), each different one once, not an English "Parts not attempted".
            what = ", ".join(missing_parts[:4])
            said_all: list[str] = []
            for r in missing_reasons:
                short = _short(r)
                if short and short not in said_all:
                    said_all.append(short)
            said = "; ".join(said_all[:3]) or "उत्तर नहीं लिखा"
            text = f"{what}: {said}" if what and what not in said else said
        else:
            what = ", ".join(missing_parts[:4]) if missing_parts else "Parts"
            text = f"{what} not attempted"
        remarks.append((anchor, f"{text} (-{_fmt(missing_lost)})"))
    if not remarks:
        return 0
    verdict["annotations"] = [a for a in anns
                              if not (isinstance(a, dict) and a.get("style") == "margin_note")]
    for row, text in remarks:
        verdict["annotations"].append({"style": "deduction_reason", "target": row, "text": text})
    return len(remarks)
