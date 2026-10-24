"""CSV sheets for teacher insights (design WP9): the same rows the admin
card shows, with the row caps raised, as a file an institute can keep."""
from __future__ import annotations

import csv
import io
from typing import Any, Dict, List, Sequence

SHEETS: Dict[str, Sequence[str]] = {
    "learners": ("user_id", "name", "courses", "sessions", "minutes", "attempts", "avg_score", "weak_attempts",
                 "activeness", "last_active", "note"),
    "concepts": ("concept", "topic", "slide", "course", "attempts", "learners", "avg_score", "weak_attempts",
                 "weak_learners", "cleared_learners", "misconceptions", "concept_id", "slide_id"),
    "courses": ("package_id", "course", "sessions", "learners", "minutes", "attempts", "avg_score", "weak_attempts",
                "activeness", "last_active"),
}


# Learner names, answers and model text reach the sheet: a cell that a
# spreadsheet would evaluate as a formula is neutralised with a leading quote.
_FORMULA_LEADS = ("=", "+", "-", "@", "\t", "\r")


def _cell(v: Any) -> Any:
    if isinstance(v, (list, tuple)):
        v = " | ".join(str(x) for x in v if x is not None and str(x).strip())
    if v is None:
        return ""
    if isinstance(v, str) and v[:1] in _FORMULA_LEADS:
        return "'" + v
    return v


def insights_csv_text(data: Dict[str, Any], sheet: str) -> str:
    """One sheet of an insights payload as CSV (UTF-8 with BOM so Excel
    opens Hindi text correctly)."""
    if sheet not in SHEETS:
        raise ValueError(f"Unknown sheet {sheet}")
    cols = SHEETS[sheet]
    rows: List[Dict[str, Any]] = list(data.get(sheet) or [])
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(cols)
    for r in rows:
        if sheet == "courses":
            r = {**r, "course": r.get("name")}
        w.writerow([_cell(r.get(c)) for c in cols])
    return "\ufeff" + buf.getvalue()
