"""Read-aloud for companion cards and answers.

Reuses the Live Tutor's prepared-voice cache (`tutor_tts_cache` + S3): a card's
narration is the same for every learner, so it is synthesised once and every
later learner gets the stored mp3. Only a cache miss is billed.
"""
from __future__ import annotations

import base64
import logging
import re
from typing import Dict, Optional, Tuple

from ..tutor import voice_cache
from ..tutor.runtime.speech import cache_key, spoken_form
from ..voice_tts import default_voice_for, smallest_available, synthesize_speech

logger = logging.getLogger(__name__)

SPEECH_TOOL = "kb_companion_speech"
MAX_SPEECH_CHARS = 700
LANG_CODES = {"en": "en-IN", "hi": "hi-IN", "kn": "kn-IN"}
# Languages Sarvam voices well and the default engine may not.
SARVAM_FIRST = {"kn"}
PACE = "1.0"

_MD_RE = re.compile(r"[*_`#>|~]+")
_CITE_RE = re.compile(r"\[\d+\](?:\[\d+\])*")
_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")


def speakable(text: str) -> str:
    """Markdown answer → what a voice should say: no citation markers, no
    markdown symbols, table pipes read as pauses."""
    t = _LINK_RE.sub(r"\1", text or "")
    t = _CITE_RE.sub("", t)
    t = re.sub(r"^\s*\|?\s*-{2,}.*$", "", t, flags=re.MULTILINE)   # table rule lines
    t = _MD_RE.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:MAX_SPEECH_CHARS]


def voice_for(companion: Dict) -> Tuple[str, str, str]:
    lang = LANG_CODES.get(companion.get("language") or "en", "en-IN")
    default = "sarvam" if companion.get("language") in SARVAM_FIRST or not smallest_available() else "smallest"
    provider = (companion.get("voice_provider") or default).lower()
    voice = companion.get("voice_id") or default_voice_for(provider, lang)
    return provider, voice, lang


async def narration(text: str, companion: Dict) -> Tuple[Optional[str], bool, str]:
    """(url, cache_hit, provider_used). The url may be a data: URL when the
    audio could not be stored; None when no engine produced audio."""
    provider, voice, lang = voice_for(companion)
    said = spoken_form(text, lang)
    key = cache_key(provider, voice, lang, PACE, said)
    row = voice_cache.lookup(key)
    if row is not None and row.url:
        return row.url, True, provider
    audio, mime, used = await synthesize_speech(said, lang, voice, provider, pace=1.0)
    if not audio:
        return None, False, used
    url = await voice_cache.store(key, provider=used, voice=voice, lang=lang, pace=PACE, text_=said,
                                  audio=audio, mime=mime)
    if url:
        return url, False, used
    return f"data:{mime or 'audio/wav'};base64,{base64.b64encode(audio).decode()}", False, used
