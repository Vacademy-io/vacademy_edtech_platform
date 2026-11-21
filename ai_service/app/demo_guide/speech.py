"""Sentences and speech.

``SentenceSplitter`` cuts the reply into sentences AS it streams, for English,
Hindi, Kannada and French, so each sentence can be spoken while the next is
still being written. ``synthesize`` turns one sentence into audio: Sarvam for
en / hi / kn, a Microsoft Edge French voice for fr, both through
services/voice_tts.synthesize_speech. Audio is cached in memory (per process).

Nothing here takes text from a caller: the speech endpoint speaks stored
sentences of the guide's own replies, the narration endpoint speaks catalogue
lines.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
import time
from typing import Dict, List, Optional, Tuple

from .settings import SPEECH_CACHE_SECONDS

# ── text for speech and for the bubble ────────────────────────────────────

_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
_MD_CHARS_RE = re.compile(r"[*`#~]|(?<!\w)_+|_+(?!\w)")
_BULLET_RE = re.compile(r"(^|\n)[ \t]*(?:[-•]|\d{1,2}[.)])[ \t]+")
# The notes prompt.history_messages adds for the model; never something to show or say.
_NOTE_RE = re.compile(r"\[(?:event|played tour|offered choices|showed the contact form)[^\]]*\]", re.IGNORECASE)


def plain(text: str) -> str:
    """A streamed chunk without markdown, links or bullets (it is shown in a bubble and spoken)."""
    t = _NOTE_RE.sub("", text or "")
    t = _MD_LINK_RE.sub(r"\1", t)
    t = _URL_RE.sub("", t)
    t = _BULLET_RE.sub(r"\1", t)
    return _MD_CHARS_RE.sub("", t)


# ── sentence splitting ────────────────────────────────────────────────────

# A dot after one of these is not the end of a sentence (English and French).
_ABBREVIATIONS = frozenset({
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "no", "nos", "inc", "ltd", "co", "approx",
    "e.g", "i.e", "eg", "ie", "a.m", "p.m", "rs", "fig",
    "m", "mme", "mlle", "mm", "p.ex", "cf", "env", "av", "bd", "tél", "n°",
})
_TERMINATORS = ".!?…।॥"
_CLOSERS = "\"'”’»)]"
MIN_SENTENCE_CHARS = 12
MAX_SENTENCE_CHARS = 240


class SentenceSplitter:
    """feed(chunk) → the sentences completed so far; flush() → the rest.

    A sentence ends at ``. ! ? …`` or a danda (``।``, Hindi) followed by
    whitespace, or at a line break. It does not end inside a number (2.5),
    after an abbreviation (Dr., e.g., M.) or a single-letter initial. A
    fragment shorter than MIN_SENTENCE_CHARS joins the next sentence ("Hi!"),
    and a run with no terminator is cut at a comma or space past
    MAX_SENTENCE_CHARS so speech never waits on an endless sentence.
    """

    def __init__(self) -> None:
        self.buffer = ""

    def feed(self, chunk: str) -> List[str]:
        self.buffer += chunk or ""
        out: List[str] = []
        while True:
            cut = self._boundary()
            if cut is None:
                break
            sentence, self.buffer = self.buffer[:cut].strip(), self.buffer[cut:].lstrip()
            if sentence:
                out.append(" ".join(sentence.split()))
        return out

    def flush(self) -> List[str]:
        rest, self.buffer = " ".join(self.buffer.split()), ""
        return [rest] if rest else []

    def _boundary(self) -> Optional[int]:
        buf = self.buffer
        n = len(buf)
        start = len(buf) - len(buf.lstrip())
        i = start
        while i < n:
            ch = buf[i]
            if ch == "\n":
                if i - start >= MIN_SENTENCE_CHARS:
                    return i + 1
            elif ch in _TERMINATORS:
                j = i + 1
                while j < n and (buf[j] in _TERMINATORS or buf[j] in _CLOSERS):
                    j += 1
                if j >= n:
                    return None                       # the next character decides: wait for it
                if buf[j].isspace() and j - start >= MIN_SENTENCE_CHARS and not self._not_an_end(buf, i):
                    return j
                i = j
                continue
            i += 1
        if n - start > MAX_SENTENCE_CHARS:
            window = buf[start:start + MAX_SENTENCE_CHARS]
            cut = max(window.rfind(", "), window.rfind("; "), window.rfind(": "))
            cut = cut + 1 if cut > MAX_SENTENCE_CHARS // 3 else window.rfind(" ")
            return start + (cut if cut > 0 else MAX_SENTENCE_CHARS)
        return None

    @staticmethod
    def _not_an_end(buf: str, i: int) -> bool:
        if buf[i] != ".":
            return False
        k = i
        while k > 0 and not buf[k - 1].isspace():
            k -= 1
        word = buf[k:i].lstrip("\"'“‘«([").lower()
        if not word:
            return True                               # a stray dot
        if word in _ABBREVIATIONS:
            return True
        if len(word) == 1 and word.isalpha() and buf[k:i].isupper():
            return True                               # an initial: "A. Sharma"
        return False


def split_sentences(text: str) -> List[str]:
    s = SentenceSplitter()
    return s.feed(text) + s.flush()


# ── voices ────────────────────────────────────────────────────────────────

# lang -> (provider, provider language code, voice)
VOICES: Dict[str, Tuple[str, str, str]] = {
    "en": ("sarvam", "en-IN", "priya"),
    "hi": ("sarvam", "hi-IN", "priya"),
    "kn": ("sarvam", "kn-IN", "priya"),
    "fr": ("edge", "fr-FR", "fr-FR-DeniseNeural"),
}


def voice_for(lang: str) -> Tuple[str, str, str]:
    return VOICES.get(lang, VOICES["en"])


def etag_for(text: str, lang: str) -> str:
    provider, code, voice = voice_for(lang)
    return hashlib.sha256(f"{provider}:{code}:{voice}:{text}".encode()).hexdigest()[:32]


# ── synthesis + in-memory cache ───────────────────────────────────────────

class _AudioCache:
    def __init__(self, ttl: float, max_items: int, max_bytes: int):
        self.ttl, self.max_items, self.max_bytes = ttl, max_items, max_bytes
        self.items: Dict[tuple, Tuple[float, bytes, str]] = {}
        self.bytes = 0

    def get(self, key: tuple) -> Optional[Tuple[bytes, str]]:
        hit = self.items.get(key)
        if not hit:
            return None
        if time.monotonic() - hit[0] > self.ttl:
            self._drop(key)
            return None
        return hit[1], hit[2]

    def put(self, key: tuple, audio: bytes, mime: str) -> None:
        self._drop(key)
        now = time.monotonic()
        for k in [k for k, v in self.items.items() if now - v[0] > self.ttl]:
            self._drop(k)
        while self.items and (len(self.items) >= self.max_items or self.bytes + len(audio) > self.max_bytes):
            self._drop(min(self.items, key=lambda k: self.items[k][0]))
        self.items[key] = (now, audio, mime)
        self.bytes += len(audio)

    def _drop(self, key: tuple) -> None:
        hit = self.items.pop(key, None)
        if hit:
            self.bytes -= len(hit[1])

    def clear(self) -> None:
        self.items.clear()
        self.bytes = 0


# Replies: per (message, n), 10 minutes. Narration: per (text hash, lang), a day
# (the catalogue rarely changes and the response is cacheable at the edge anyway).
reply_cache = _AudioCache(SPEECH_CACHE_SECONDS, max_items=400, max_bytes=96 * 1024 * 1024)
narration_cache = _AudioCache(24 * 3600.0, max_items=600, max_bytes=128 * 1024 * 1024)
_in_flight: Dict[tuple, "asyncio.Future"] = {}


async def tts(text: str, lang: str) -> Tuple[bytes, str, str]:
    """(audio, mime, provider used) for one line. Replaceable in tests. Empty audio = no engine answered."""
    from ..services.voice_tts import synthesize_speech
    provider, code, voice = voice_for(lang)
    result = await synthesize_speech(text, code, voice, provider, fallback_voice=voice)
    if not result:
        return b"", "audio/wav", provider
    audio, mime, used = result
    if provider == "edge" and used != "edge":
        return b"", mime, used                         # a Sarvam voice reading French is worse than silence
    return audio or b"", mime or "audio/wav", used


async def synthesize(cache: _AudioCache, key: tuple, text: str, lang: str,
                     before=None) -> Optional[Tuple[bytes, str, Optional[str]]]:
    """(audio, mime, provider that just synthesised it or None for a cache hit),
    or None when no audio could be made.

    `before` runs once, only when the audio really has to be synthesised (the
    caller's cap check); it returns False to refuse → PermissionError. Two
    requests for the same line share one synthesis."""
    hit = cache.get(key)
    if hit:
        return hit[0], hit[1], None
    pending = _in_flight.get(key)
    if pending is not None:
        audio, mime = await asyncio.shield(pending)
        return (audio, mime, None) if audio else None
    if before is not None and not before():
        raise PermissionError("capped")
    fut: "asyncio.Future" = asyncio.get_running_loop().create_future()
    _in_flight[key] = fut
    try:
        audio, mime, used = await tts(text, lang)
        if audio:
            cache.put(key, audio, mime)
        fut.set_result((audio, mime))
    finally:
        _in_flight.pop(key, None)
        if not fut.done():                             # failed or cancelled: waiters get "no audio"
            fut.set_result((b"", "audio/wav"))
    return (audio, mime, used) if audio else None
