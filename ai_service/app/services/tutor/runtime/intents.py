"""Pacing intents recognised without a model call (design §6.7)."""
from __future__ import annotations

import re
from typing import Optional

_PHRASES = {
    "repeat": [r"\brepeat\b", r"\bsay (that|it) again\b", r"\bagain\b", r"\bdobara\b", r"\bphir se\b", r"फिर से", r"दोबारा", r"\bone more time\b"],
    "skip": [r"\bskip\b", r"\bnext\b", r"\bmove on\b", r"\baage\b", r"आगे", r"\bchhodo\b", r"छोड़ो"],
    "slower": [r"\bslow(er| down)\b", r"\btoo fast\b", r"\bdheere\b", r"धीरे"],
    "faster": [r"\bfaster\b", r"\bspeed up\b", r"\btoo slow\b", r"\bjaldi\b", r"जल्दी", r"\btez\b", r"तेज़"],
    "doubt": [r"\bi have a (doubt|question)\b", r"\bdoubt\b", r"\bexplain\b", r"\bwhat do you mean\b", r"\bsamajh nahi\b", r"समझ नहीं", r"\bdon'?t understand\b", r"\bnot clear\b"],
    "pause": [r"^\s*(pause|wait|ruko|रुको|hold on)\s*[.!]?\s*$"],
    "resume": [r"^\s*(resume|continue|go on|chalo|चलो|start)\s*[.!]?\s*$"],
    "done": [r"^\s*(done|finished|i'?m done|dekh liya|देख लिया|padh liya|पढ़ लिया|watched it|read it|ho gaya|हो गया)\s*[.!]?\s*$"],
}
_COMPILED = {k: [re.compile(p, re.I) for p in v] for k, v in _PHRASES.items()}
_MAX_INTENT_WORDS = 6


def detect_intent(text: str) -> Optional[str]:
    """Only short utterances count: a 30-word answer that happens to contain
    'next' is an answer, not a command."""
    t = (text or "").strip()
    if not t or len(t.split()) > _MAX_INTENT_WORDS:
        return None
    for intent, patterns in _COMPILED.items():
        if any(p.search(t) for p in patterns):
            return intent
    return None
