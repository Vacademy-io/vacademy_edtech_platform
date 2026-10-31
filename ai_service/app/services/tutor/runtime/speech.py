"""How the tutor turns text into speech segments, and how a segment's audio
is keyed — shared by the live socket and the compile-time voice warm-up so
a prepared line is a cache hit in the lesson (design: cost review 2026-09-07).
"""
from __future__ import annotations

import hashlib
import re
from typing import List, Optional, Tuple

# The learner's own pace: fast / normal (medium) / slow / slower.
PACE_MULTIPLIER = {"slower": 0.7, "slow": 0.85, "normal": 1.0, "fast": 1.2}
PACE_ORDER = ["slower", "slow", "normal", "fast"]
# Spoken rhythm: a sentence per segment where possible, never a sentence
# split; definitions a touch slower.
TUTOR_SEGMENT_MAX_CHARS = 200
DEFINITION_PACE = 0.92
_DEFINITION_RE = re.compile(r"\b(means|is called|is defined|definition|refers to|in other words)\b", re.IGNORECASE)
_SENTENCE_END = re.compile(r"(?<=[.!?…।])\s+|\n+")


def tutor_segments(text_: str, max_chars: Optional[int] = None) -> List[Tuple[str, int, int]]:
    """(segment, first sentence index, sentence count): sentences packed up to
    `max_chars`, never cut mid-sentence, so the board can follow the words."""
    max_chars = max_chars or TUTOR_SEGMENT_MAX_CHARS
    sentences = [x.strip() for x in _SENTENCE_END.split((text_ or "").strip()) if x and x.strip()]
    out: List[Tuple[str, int, int]] = []
    buf, start, count = "", 0, 0
    for i, sent in enumerate(sentences):
        if buf and len(buf) + 1 + len(sent) > max_chars:
            out.append((buf, start, count))
            buf, start, count = sent, i, 1
        else:
            buf = f"{buf} {sent}".strip()
            count += 1
            if count == 1:
                start = i
    if buf:
        out.append((buf, start, count))
    return out


def step_pace(pace: str, delta: int) -> str:
    i = PACE_ORDER.index(pace) if pace in PACE_ORDER else PACE_ORDER.index("normal")
    return PACE_ORDER[max(0, min(len(PACE_ORDER) - 1, i + delta))]


def effective_pace(base_pace: float, learner_pace: str, segment: str = "") -> float:
    """Course/institute voice speed × the learner's pace × a touch slower on
    a definition, clamped to what the engines accept."""
    slow = DEFINITION_PACE if segment and _DEFINITION_RE.search(segment) else 1.0
    return round(max(0.5, min(2.0, float(base_pace or 1.0) * PACE_MULTIPLIER.get(learner_pace, 1.0) * slow)), 2)


def cache_key(provider: str, voice: str, lang: str, pace: str, text_: str) -> str:
    return hashlib.sha256(f"{provider}|{voice}|{lang}|{pace}|{text_}".encode("utf-8")).hexdigest()


# ── what the voice actually says ─────────────────────────────────────────────
# Engines read "9/16" as September 16th and "m/s²" as gibberish. The board and
# the transcript keep the notation; only the audio gets the spoken form.

_WORDS = {
    "en": {"by": " by ", "into": " into ", "div": " divided by ", "eq": " equals ", "neq": " is not equal to ",
           "plus": " plus ", "minus": " minus ", "sq": " squared", "cube": " cubed", "pow": " to the power ",
           "root": " root ", "pct": " percent", "ge": " greater than or equal to ", "le": " less than or equal to ",
           "gives": " gives ", "isto": " is to ", "mps": " metres per second", "kmph": " kilometres per hour",
           "mps2": " metres per second squared"},
    "hi": {"by": " बटा ", "into": " गुणा ", "div": " भाग ", "eq": " बराबर ", "neq": " बराबर नहीं ",
           "plus": " जमा ", "minus": " घटा ", "sq": " का वर्ग", "cube": " का घन", "pow": " की घात ",
           "root": " का वर्गमूल ", "pct": " प्रतिशत", "ge": " से बड़ा या बराबर ", "le": " से छोटा या बराबर ",
           "gives": " से मिलता है ", "isto": " अनुपात ", "mps": " मीटर प्रति सेकंड", "kmph": " किलोमीटर प्रति घंटा",
           "mps2": " मीटर प्रति सेकंड वर्ग"},
}
_FRACTION = re.compile(r"(?<![\d/.])(\d+)\s*/\s*(\d+)(?![\d/])")
_RATIO3 = re.compile(r"\b(\d+(?:\s*:\s*\d+){2,})\b")
_POW = re.compile(r"\^\s*\(?(-?\w+)\)?")
# "2 + 3", "x² + 2x", "(k - 4)": an operator between two MATHS operands — a
# number, a single letter (optionally with a power), a bracketed group or a
# LaTeX command. "JEE Main 2026 - Maths Question" is a separator, not a
# subtraction, and "well-known" keeps its hyphen.
_OPERAND = r"(?:\d[\d.,]*|[A-Za-zα-ω](?:\^\w+|²|³)?|[)\]]|\\[a-zA-Z]+)"
_OPERAND_R = r"(?:\d[\d.,]*|[A-Za-zα-ω](?:\^\w+|²|³)?\b|[(\[]|\\[a-zA-Z]+)"
# Left operand, the operator, right operand — with any spacing. Applied until
# nothing changes so "a - b - c" resolves both signs.
_MATH_OP = re.compile(rf"(?<![A-Za-z\d])({_OPERAND})\s*([+\-−–])\s*(?={_OPERAND_R})")


def _spell_operators(t: str, plus: str, minus: str) -> str:
    for _ in range(6):
        new = _MATH_OP.sub(lambda m: f"{m.group(1)}{plus if m.group(2) == '+' else minus}", t)
        if new == t:
            return t
        t = new
    return t


# A spaced dash that is not an operator (a title separator, an aside) is a
# pause for the voice, never the word "minus".
_SEPARATOR_DASH = re.compile(r"\s+[-–—]\s+")
# Acronyms are spelled letter by letter ("J E E") unless they are said as a
# word; Roman numerals in class names are read as numbers.
_SAY_AS_WORD = {"NEET", "NASA", "ISRO", "CAT", "GATE", "SAT", "AIIMS", "NIIT", "UNESCO", "UNICEF", "AIDS", "LASER", "RADAR", "SCUBA"}
_ROMAN = {"I": "1", "II": "2", "III": "3", "IV": "4", "V": "5", "VI": "6", "VII": "7", "VIII": "8", "IX": "9", "X": "10", "XI": "11", "XII": "12"}
_ACRONYM = re.compile(r"\b([A-Z]{2,6})(?![a-z])\b")


def _spell_acronyms(t: str) -> str:
    def one(m: "re.Match[str]") -> str:
        a = m.group(1)
        if a in _SAY_AS_WORD:
            return a
        if a in _ROMAN:
            return _ROMAN[a]
        return " ".join(a)
    return _ACRONYM.sub(one, t)


def spoken_form(text_: str, lang: str = "en") -> str:
    """The text handed to the voice engine: fractions, operators, powers,
    percentages and the common physics units in words."""
    if not text_:
        return text_
    w = _WORDS["hi" if str(lang).startswith("hi") else "en"]
    t = text_
    t = t.replace("m/s²", w["mps2"]).replace("m/s^2", w["mps2"]).replace(" m/s", w["mps"]).replace("km/h", w["kmph"])
    t = _RATIO3.sub(lambda m: w["isto"].join(x.strip() for x in m.group(1).split(":")), t)
    t = _FRACTION.sub(lambda m: f"{m.group(1)}{w['by']}{m.group(2)}", t)
    t = t.replace("×", w["into"]).replace("÷", w["div"]).replace("≠", w["neq"]).replace("≥", w["ge"]).replace("≤", w["le"])
    # Operators first, while operands still look like maths (x^2, x²).
    t = _spell_operators(t, w["plus"], w["minus"])
    t = t.replace("²", w["sq"]).replace("³", w["cube"]).replace("√", w["root"]).replace("→", w["gives"])
    t = _POW.sub(lambda m: w["sq"] if m.group(1) == "2" else w["cube"] if m.group(1) == "3" else f"{w['pow']}{m.group(1)}", t)
    t = _SEPARATOR_DASH.sub(", ", t)
    t = t.replace(">=", w["ge"]).replace("<=", w["le"])
    t = re.sub(r"(?<![=<>!])\s*=\s*(?!=)", w["eq"], t)
    t = re.sub(r"(?<=\d)\s*%", w["pct"], t)
    t = _spell_acronyms(t)
    return re.sub(r"[ \t]{2,}", " ", t).strip()
