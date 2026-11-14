"""Pacing intents recognised without a model call (design §6.7)."""
from __future__ import annotations

import re
import unicodedata
from typing import Optional

_PHRASES = {
    "repeat": [r"\brepeat\b", r"\bsay (that|it) again\b", r"\bagain\b", r"\bdobara\b", r"\bphir se\b", r"फिर से", r"दोबारा", r"\bone more time\b",
               r"আবার বলুন", r"আর একবার", r"ಮತ್ತೆ ಹೇಳಿ", r"ಇನ್ನೊಮ್ಮೆ", r"ಮತ್ತೊಮ್ಮೆ"],
    "skip": [r"\bskip\b", r"\bnext\b", r"\bmove on\b", r"\baage\b", r"आगे", r"\bchhodo\b", r"छोड़ो",
             r"এগিয়ে যান", r"পরেরটা", r"বাদ দিন", r"ಮುಂದೆ ಹೋಗೋಣ", r"ಮುಂದಿನದು", r"ಬಿಟ್ಟುಬಿಡಿ"],
    "slower": [r"\bslow(er| down)\b", r"\btoo fast\b", r"\bdheere\b", r"धीरे", r"আস্তে", r"ধীরে", r"ನಿಧಾನ"],
    "faster": [r"\bfaster\b", r"\bspeed up\b", r"\btoo slow\b", r"\bjaldi\b", r"जल्दी", r"\btez\b", r"तेज़", r"তাড়াতাড়ি", r"ಬೇಗ ಬೇಗ", r"ವೇಗವಾಗಿ"],
    "doubt": [r"\bi have a (doubt|question)\b", r"\bdoubt\b", r"\bexplain\b", r"\bwhat do you mean\b", r"\bsamajh nahi\b", r"समझ नहीं", r"\bdon'?t understand\b", r"\bnot clear\b",
              r"বুঝতে পারিনি", r"বুঝিনি", r"বুঝলাম না", r"ಅರ್ಥ ಆಗಿಲ್ಲ", r"ಅರ್ಥ ಆಗಲಿಲ್ಲ", r"ಅರ್ಥ ಆಗ್ಲಿಲ್ಲ"],
    "pause": [r"^\s*(pause|wait|ruko|रुको|hold on|থামুন|দাঁড়ান|ನಿಲ್ಲಿಸಿ|ಸ್ವಲ್ಪ ತಡೀರಿ)\s*[.!।]?\s*$"],
    "resume": [r"^\s*(resume|continue|go on|chalo|चलो|start|চলুন|শুরু করুন|ಮುಂದುವರಿಸಿ|ಶುರು ಮಾಡಿ)\s*[.!।]?\s*$"],
    "done": [r"^\s*(done|finished|i'?m done|dekh liya|देख लिया|padh liya|पढ़ लिया|watched it|read it|ho gaya|हो गया|দেখে নিয়েছি|পড়ে নিয়েছি|হয়ে গেছে|ನೋಡಿದೆ|ಓದಿದೆ|ಆಯ್ತು|ಮುಗೀತು|ಮುಗಿಯಿತು)\s*[.!।]?\s*$"],
}
# NFC on both sides: Bengali য় / ড় arrive composed or decomposed depending
# on the STT engine and keyboard.
_COMPILED = {k: [re.compile(unicodedata.normalize("NFC", p), re.I) for p in v] for k, v in _PHRASES.items()}
_MAX_INTENT_WORDS = 6


def detect_intent(text: str) -> Optional[str]:
    """Only short utterances count: a 30-word answer that happens to contain
    'next' is an answer, not a command."""
    t = unicodedata.normalize("NFC", (text or "").strip())
    if not t or len(t.split()) > _MAX_INTENT_WORDS:
        return None
    for intent, patterns in _COMPILED.items():
        if any(p.search(t) for p in patterns):
            return intent
    return None
