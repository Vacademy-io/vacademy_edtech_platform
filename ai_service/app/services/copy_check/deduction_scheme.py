"""A paper's printed mark-deduction scheme, applied the way its examiner does.

Some answer sheets print their own marking rule - a symbol per kind of mistake
and the marks each costs - and a table on the first page for the examiner to
fill in. A translation test, for example, prints

    X  1 mark    wrong synonym, grammatical mistake, spelling mistake, omitted word
    /  1/2 mark  punctuation, careless repetition, omitted article
    #  5 marks   wrong translation (a whole sentence)

The institute declares that rule on the assessment (exam_context.deduction_scheme):

    [{"symbol": "X", "marks": 1, "label": "1-mark deduction",
      "covers": ["wrong synonym", "grammar", "spelling", "omitted word"]},
     {"symbol": "/", "marks": 0.5, "covers": ["punctuation", "repetition", "omitted article"]},
     {"symbol": "#", "marks": 5, "scope": "sentence", "covers": ["wrong translation"]}]

and the copy is then marked in it: every mistake the language pass finds is
classified into one entry, written on the copy with that entry's symbol, and a
written answer scores max - sum of its deductions (never below 0). Without a
scheme nothing here runs and the language pass never touches marks.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

# A symbol is a short mark an examiner writes: "X", "/", "#", "XX" is two of X.
_MAX_SYMBOL_LEN = 3
_MAX_ENTRIES = 8
# One error never costs more than this many of its symbol ("XX" for a phrase
# that is two mistakes); a model claiming more is capped.
MAX_COUNT_PER_ERROR = 3


@dataclass(frozen=True)
class Entry:
    symbol: str
    marks: float
    label: str = ""
    covers: tuple[str, ...] = ()
    # "sentence": the entry judges a whole sentence (wrong or omitted
    # translation), not a word or two.
    scope: str = "word"


@dataclass
class Tally:
    """One answer's deductions under the scheme."""
    counts: dict[str, int] = field(default_factory=dict)
    deducted: float = 0.0
    max_marks: float = 0.0
    # The mark came from the paragraph-wise check, not from these counts: the
    # table must not show counts that do not add up to the deduction.
    paragraph_wise: bool = False

    @property
    def awarded(self) -> float:
        return max(0.0, round(self.max_marks - self.deducted, 2))


def _num(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip()
    m = re.fullmatch(r"(\d+)\s*/\s*(\d+)", text)
    if m and int(m.group(2)):
        return int(m.group(1)) / int(m.group(2))
    try:
        return float(text)
    except ValueError:
        return None


def parse(exam_context: Any) -> list[Entry]:
    """The scheme declared on the paper, validated; [] when there is none or it
    is unusable (a scheme that cannot be applied exactly is not applied)."""
    ctx = exam_context if isinstance(exam_context, dict) else {}
    raw = ctx.get("deduction_scheme")
    if not isinstance(raw, list) or not raw:
        return []
    out: list[Entry] = []
    seen: set[str] = set()
    for item in raw[:_MAX_ENTRIES]:
        if not isinstance(item, dict):
            return []
        symbol = str(item.get("symbol") or "").strip()
        marks = _num(item.get("marks"))
        if not symbol or len(symbol) > _MAX_SYMBOL_LEN or symbol in seen or marks is None or marks <= 0:
            return []
        seen.add(symbol)
        covers = item.get("covers") or []
        if isinstance(covers, str):
            covers = [covers]
        scope = str(item.get("scope") or "word").strip().lower()
        out.append(Entry(
            symbol=symbol, marks=marks, label=str(item.get("label") or "").strip()[:60],
            covers=tuple(str(c).strip()[:60] for c in covers if str(c).strip())[:8],
            scope="sentence" if scope == "sentence" else "word",
        ))
    return out


def _fmt(x: float) -> str:
    if float(x).is_integer():
        return str(int(x))
    return "½" if abs(x - 0.5) < 1e-9 else f"{x:g}"


def prompt_block(scheme: list[Entry]) -> str:
    """The scheme as the language pass is told it."""
    lines = []
    for e in scheme:
        what = ", ".join(e.covers) or e.label or "mistake"
        unit = "mark" if e.marks == 1 else "marks"
        span = " (a WHOLE sentence)" if e.scope == "sentence" else ""
        lines.append(f'- "{e.symbol}" = {_fmt(e.marks)} {unit}{span}: {what}')
    return "\n".join(lines)


# Fallback classification when the model names no symbol of the scheme: the
# error's kind matched against what each entry covers.
_KIND_WORDS = {
    "spelling": ("spelling",),
    "grammar": ("grammar", "grammatical"),
    "punctuation": ("punctuation",),
    "sentence": ("translation", "sentence"),
    "word": ("synonym", "word"),
    "article": ("article",),
    "repetition": ("repetition", "repeat"),
    "omission": ("omission", "omitted", "omit"),
}


def entry_for(scheme: list[Entry], symbol: Any, kind: Any = None) -> Optional[Entry]:
    """The scheme entry an error belongs to: the symbol the model chose when it
    is one of the scheme's, else the first entry whose `covers` names the
    error's kind, else the cheapest word-level entry."""
    if not scheme:
        return None
    sym = str(symbol or "").strip()
    # "XX" is two of "X".
    for e in scheme:
        if sym == e.symbol or (sym and set(sym) == {e.symbol} and len(e.symbol) == 1):
            return e
    words = _KIND_WORDS.get(str(kind or "").strip().lower(), ())
    for e in scheme:
        hay = " ".join(e.covers + (e.label,)).lower()
        if any(w in hay for w in words):
            return e
    word_level = [e for e in scheme if e.scope != "sentence"] or scheme
    return min(word_level, key=lambda e: e.marks)


def count_of(symbol: Any, entry: Entry, count: Any = None) -> int:
    """How many of `entry` one error costs: "XX" or count=2 is two."""
    n = _num(count)
    if n is None:
        sym = str(symbol or "").strip()
        n = len(sym) if len(entry.symbol) == 1 and sym and set(sym) == {entry.symbol} else 1
    return max(1, min(MAX_COUNT_PER_ERROR, int(n)))


def tally(scheme: list[Entry], errors: list[dict[str, Any]], max_marks: float) -> Tally:
    """The deductions of one answer. Each error carries `symbol` (a scheme
    symbol) and `count` (set by the language pass)."""
    t = Tally(counts={e.symbol: 0 for e in scheme}, max_marks=float(max_marks or 0))
    marks = {e.symbol: e.marks for e in scheme}
    for err in errors:
        sym = err.get("symbol")
        if sym not in marks:
            continue
        n = int(err.get("count") or 1)
        t.counts[sym] += n
        t.deducted += marks[sym] * n
    t.deducted = round(t.deducted, 2)
    return t


def summary_text(scheme: list[Entry], t: Tally) -> str:
    """"Deductions: X ×12 (−12), / ×3 (−1.5), # ×1 (−5) = −18.5; 50 − 18.5 = 31.5"."""
    parts = [f"{e.symbol} ×{t.counts.get(e.symbol, 0)} (−{_fmt(e.marks * t.counts.get(e.symbol, 0))})"
             for e in scheme]
    tail = f"{_fmt(t.max_marks)} − {_fmt(t.deducted)} = {_fmt(t.awarded)}"
    if t.awarded == 0.0 and t.deducted > t.max_marks:
        tail += " (not below 0)"
    return f"Deductions: {', '.join(parts)} = −{_fmt(t.deducted)}; {tail}."


def apply(verdict: dict[str, Any], scheme: list[Entry], errors: list[dict[str, Any]]) -> Tally:
    """Mark one written answer by the scheme, in place: marks_awarded, a single
    criteria row that adds up to it, the summary line in the feedback, and the
    score written on the copy. Returns the tally."""
    mx = float(verdict.get("max_marks") or 0)
    t = tally(scheme, errors, mx)
    verdict["marks_awarded"] = t.awarded
    line = summary_text(scheme, t)
    verdict["criteria_breakdown"] = [{
        "criteria_name": "Deductions by the paper's marking scheme",
        "marks": t.awarded, "max": mx, "reason": line,
    }]
    base = str(verdict.get("feedback") or "").rstrip()
    verdict["feedback"] = f"{base}\n\n{line}" if base else line
    score = f"{_fmt_plain(t.awarded)}/{_fmt_plain(mx)}"
    anns = []
    for a in verdict.get("annotations") or []:
        if isinstance(a, dict) and a.get("style") == "score":
            a = dict(a, text=score, marks=t.awarded)
        anns.append(a)
    verdict["annotations"] = anns
    return t


def _fmt_plain(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:g}"


def table_rows(scheme: list[Entry], parts: list[tuple[str, Tally]]) -> dict[str, Any]:
    """What the evaluation table on page 1 is filled with: one row per part,
    in paper order."""
    rows = []
    for label, t in parts:
        pct = round(100.0 * t.awarded / t.max_marks, 1) if t.max_marks else 0.0
        rows.append({
            "part": label, "counts": {e.symbol: t.counts.get(e.symbol, 0) for e in scheme},
            "deducted": t.deducted, "obtained": t.awarded, "max": t.max_marks, "percent": pct,
        })
        if t.paragraph_wise:
            rows[-1]["paragraph_wise"] = True
            rows[-1]["remarks"] = "Para-wise"
    total_max = sum(t.max_marks for _l, t in parts)
    total = sum(t.awarded for _l, t in parts)
    return {
        "symbols": [e.symbol for e in scheme],
        "marks": {e.symbol: e.marks for e in scheme},
        "rows": rows,
        "total": {"obtained": round(total, 2), "max": total_max,
                  "percent": round(100.0 * total / total_max, 1) if total_max else 0.0},
    }


def mark_deductions(verdicts: list[dict[str, Any]], marks: dict[str, Any],
                    skip: Any = ()) -> None:
    """Put `deduct` (marks) on every language annotation that carries a scheme
    symbol: "X" -> 1, "XX" -> 2, "/" -> 0.5, "#×2" -> 10. In place. `skip`:
    question ids whose mark is not the scheme's (paragraph-wise)."""
    skip = {str(q) for q in skip or ()}
    for v in verdicts:
        if str(v.get("question_id")) in skip:
            continue
        for a in v.get("annotations") or []:
            sym = str(a.get("symbol") or "")
            if a.get("style") != "language" or not sym:
                continue
            if "×" in sym:
                base, _x, n = sym.partition("×")
                count = int(n) if n.isdigit() else 1
            else:
                base, count = sym[0], len(sym) if len(set(sym)) == 1 else 1
            per = _num(marks.get(base))
            if per is not None:
                a["deduct"] = round(per * count, 2)


def part_label(index: int) -> str:
    """A, B, C ... for the n-th written answer under the scheme."""
    return chr(ord("A") + index) if index < 26 else str(index + 1)
