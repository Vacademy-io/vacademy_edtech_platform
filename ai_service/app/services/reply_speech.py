"""
Read a tutor reply aloud (the answer toolbelt's Read aloud).

Markdown, LaTeX and emoji are turned into speakable text, the reply is capped,
and it is spoken in sentence-sized segments (the TTS engines limit request
length). The app plays the segments in order.
"""
from __future__ import annotations

import base64
import logging
import re
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

MAX_SPOKEN_CHARS = 900
SEGMENT_CHARS = 420

_MATH_WORDS = [
    (r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"\1 over \2"),
    (r"\\times", " times "), (r"\\div", " divided by "), (r"\\pi", " pi "), (r"\\theta", " theta "),
    (r"\\sqrt\{([^{}]+)\}", r"square root of \1"), (r"\^2", " squared"), (r"\^3", " cubed"),
    (r"\\(left|right|cdot)", " "), (r"\\[a-zA-Z]+", " "),
]


def speakable(text: str) -> str:
    t = text or ""
    t = re.sub(r"```.*?```", " (code shown on screen) ", t, flags=re.S)
    t = re.sub(r"\|.*\|", " ", t)  # table rows: on screen only
    t = re.sub(r"\$\$?(.+?)\$\$?", lambda m: " " + m.group(1) + " ", t, flags=re.S)
    for pat, rep in _MATH_WORDS:
        t = re.sub(pat, rep, t)
    t = re.sub(r"[*_`#>~{}\[\]]", "", t)
    t = re.sub(r"\(https?://\S+\)", "", t)
    t = re.sub(r"[\U0001F000-\U0001FAFF\u2600-\u27BF]", "", t)  # emoji
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) > MAX_SPOKEN_CHARS:
        cut = t[:MAX_SPOKEN_CHARS]
        t = cut[: max(cut.rfind(". "), cut.rfind("। "), MAX_SPOKEN_CHARS // 2) + 1]
    return t


def segments_of(text: str) -> List[str]:
    parts = re.split(r"(?<=[.!?।])\s+", text)
    out: List[str] = []
    cur = ""
    for p in parts:
        if len(cur) + len(p) + 1 <= SEGMENT_CHARS:
            cur = f"{cur} {p}".strip()
        else:
            if cur:
                out.append(cur)
            cur = p[:SEGMENT_CHARS]
    if cur:
        out.append(cur)
    return out


async def speak_reply(content: str, ui_language: Optional[str]) -> List[Dict[str, str]]:
    from .platform_settings_service import get_platform_setting
    from .voice_tts import synthesize_speech

    text = speakable(content)
    if not text:
        return []
    hindi = bool(re.search(r"[\u0900-\u097F]", text)) or str(ui_language or "").lower().startswith("hi")
    language = "hi-IN" if hindi else "en-IN"
    provider = str(get_platform_setting("chatbot.voice.tts_provider", default="sarvam") or "sarvam")
    out: List[Dict[str, str]] = []
    for seg in segments_of(text):
        try:
            audio, mime, _used = await synthesize_speech(seg, language, None, provider)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"read-aloud segment failed: {e}")
            break
        if audio:
            out.append({"audio_base64": base64.b64encode(audio).decode("ascii"), "mime": mime})
    return out


__all__ = ["speak_reply", "speakable", "segments_of"]
