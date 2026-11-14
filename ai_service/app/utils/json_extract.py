"""Shared JSON extraction/sanitization — Python analogue of media_service
JsonUtils.extractAndSanitizeJson. Used by every migrated AI feature that asks
an LLM for JSON and must tolerate markdown fences / surrounding prose.
"""
from __future__ import annotations

import json
import re
from typing import List, Optional

_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$", re.MULTILINE)

_HEX = set("0123456789abcdefABCDEF")
_SIMPLE_ESCAPES = set('"\\/')
# Single-letter escapes that are ALSO the first letter of common LaTeX commands:
#   \b → \beta   \f → \frac   \n → \nu   \r → \rho   \t → \theta, \times, \to
_AMBIGUOUS_ESCAPES = set("bfnrt")


def repair_invalid_escapes(text: str) -> str:
    """Escape stray backslashes so LaTeX-bearing JSON becomes parseable.

    LaTeX is made almost entirely of invalid JSON escapes — \\sqrt, \\int, \\pi,
    \\alpha, \\cdot — so a model writing "Evaluate $\\int_0^1 \\sqrt{x}dx$"
    emits JSON that json.loads rejects with "Invalid \\escape", and the whole
    generation is discarded. Prose parses fine; maths, physics and chemistry fail
    essentially always.

    A regex cannot do this correctly, for two reasons found by testing:

      * `\\f` IS a valid JSON escape (form feed), so skipping it turns `\\frac`
        into FORMFEED + "rac" — silently mangled rather than rejected, which is
        worse than the original bug. Same for `\\theta`, `\\beta`, `\\to`.
      * A correctly escaped `\\\\` must be consumed as ONE unit; matching
        backslashes individually adds a third one and corrupts valid input.

    So this walks the text, tracks whether it is inside a JSON string, and
    consumes escape sequences as units. For the ambiguous single letters
    (b/f/n/r/t) it disambiguates on the NEXT character: `\\n"` ends an escape and
    is a newline, while `\\nu` continues into letters and is a LaTeX command.

    Only ever called after normal parsing has already failed, so well-formed
    output is never rewritten.
    """
    out: List[str] = []
    i = 0
    n = len(text)
    in_string = False

    while i < n:
        ch = text[i]

        if not in_string:
            if ch == '"':
                in_string = True
            out.append(ch)
            i += 1
            continue

        if ch == '"':
            in_string = False
            out.append(ch)
            i += 1
            continue

        if ch != "\\":
            out.append(ch)
            i += 1
            continue

        # --- at a backslash inside a string ---
        nxt = text[i + 1] if i + 1 < n else ""

        if nxt in _SIMPLE_ESCAPES:
            # Valid, and consuming BOTH chars is what stops `\\` being re-processed.
            out.append(ch)
            out.append(nxt)
            i += 2
            continue

        if nxt == "u" and all(c in _HEX for c in text[i + 2 : i + 6]) and i + 6 <= n:
            out.append(text[i : i + 6])
            i += 6
            continue

        if nxt in _AMBIGUOUS_ESCAPES:
            after = text[i + 2] if i + 2 < n else ""
            if not after.isalpha():
                # `\n"` / `\t,` — a real control escape.
                out.append(ch)
                out.append(nxt)
                i += 2
                continue
            # `\frac`, `\theta`, `\nu` — a LaTeX command; escape the backslash.
            out.append("\\\\")
            i += 1
            continue

        # Anything else after a backslash is invalid JSON: \sqrt, \pi, \alpha…
        out.append("\\\\")
        i += 1

    return "".join(out)


# A control character that came from a JSON escape, mapped back to the LaTeX
# command it almost certainly was.
_CONTROL_TO_LATEX = {
    "\r": "\\r",   # \right, \rho, \rangle
    "\n": "\\n",   # \nu, \nabla, \neq
    "\t": "\\t",   # \theta, \times, \to, \text
    "\b": "\\b",   # \beta, \binom, \bar
    "\f": "\\f",   # \frac, \forall
}
# `$$…$$` / `$…$` / `\[…\]` / `\(…\)`. Generators pick their own delimiters, and
# the LaTeX-style ones are what the question generator's prompts ask for, so
# restricting this to dollars left every `\(…\)` paper unrepaired.
_MATH_SPAN_RE = re.compile(
    r"\$\$.*?\$\$|\$[^$]*\$|\\\[.*?\\\]|\\\(.*?\\\)", re.DOTALL
)


def restore_math_control_chars(text: Optional[str]) -> str:
    """Undo LaTeX that JSON silently ate as control characters.

    THIS IS A DIFFERENT BUG from the unparseable one repair_invalid_escapes
    fixes, and it is nastier because the JSON parses cleanly. `\\r`, `\\n`,
    `\\t`, `\\b` and `\\f` ARE valid JSON escapes, so a model writing
    `"$\\right)$"` with a single backslash produces valid JSON whose value is
    CARRIAGE-RETURN + "ight)". Nothing errors; the paper just prints "ight)".
    Observed live in a generated JEE paper.

    A control character immediately followed by a letter, INSIDE a math span
    (`$…$`, `$$…$$`, `\\(…\\)` or `\\[…\\]`), cannot be anything but this — real
    formatting never appears mid-formula. The restriction to math spans is what
    keeps a genuine "line1\\nline2" in prose untouched.
    """
    if not text or not any(c in text for c in _CONTROL_TO_LATEX):
        return text or ""

    def fix_span(match: "re.Match[str]") -> str:
        span = match.group(0)
        out: List[str] = []
        for i, ch in enumerate(span):
            replacement = _CONTROL_TO_LATEX.get(ch)
            nxt = span[i + 1] if i + 1 < len(span) else ""
            out.append(replacement if (replacement and nxt.isalpha()) else ch)
        return "".join(out)

    return _MATH_SPAN_RE.sub(fix_span, text)


def extract_and_sanitize_json(raw: Optional[str]) -> Optional[str]:
    """Strip markdown fences, extract the outermost {...} (or [...]) span, and
    validate it parses. Returns the JSON string, or None if nothing valid found.

    Falls back to repairing invalid backslash escapes (LaTeX) only AFTER normal
    parsing has failed, so output that already parses is never rewritten.
    """
    if not raw:
        return None

    text = _FENCE_RE.sub("", raw).strip()

    obj_start = text.find("{")
    arr_start = text.find("[")

    candidates: List[str] = []
    if arr_start != -1 and (obj_start == -1 or arr_start < obj_start):
        end = text.rfind("]")
        if end > arr_start:
            candidates.append(text[arr_start : end + 1])
    if obj_start != -1:
        end = text.rfind("}")
        if end > obj_start:
            candidates.append(text[obj_start : end + 1])
    candidates.append(text)  # clean JSON with no prose

    for candidate in candidates:
        try:
            json.loads(candidate)
            return candidate
        except Exception:  # noqa: BLE001
            continue

    # Second pass: same candidates, with stray escapes repaired.
    for candidate in candidates:
        repaired = repair_invalid_escapes(candidate)
        if repaired == candidate:
            continue
        try:
            json.loads(repaired)
            return repaired
        except Exception:  # noqa: BLE001
            continue
    return None
