"""Blocking REST text-to-speech → MP3 bytes, for the AI video pipeline (which
runs in a worker thread) and the LMS voice preview (via asyncio.to_thread).

Engines: Smallest.ai Lightning v3.1, Navana (Bodhi) /tts/bytes, Sarvam
bulbul:v3 and Microsoft Edge. Long text is split at sentence boundaries into
each vendor's per-request limit and the pieces are joined into one MP3.

Navana allows 2 concurrent requests per API key. NAVANA_API_KEY may hold
several comma-separated keys; a process-wide semaphore of 2 per key keeps this
pod inside that limit, keys are taken round-robin, and a 429 / "concurrency"
refusal waits briefly and moves on to the next key. (Other pods and the voice
bot share the accounts, so a refusal can still happen — hence the retry.)
"""
from __future__ import annotations

import base64
import itertools
import logging
import os
import subprocess
import threading
import time
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

SMALLEST_TTS_URL = "https://api.smallest.ai/waves/v1/tts"
SMALLEST_MODEL = "lightning_v3.1"
NAVANA_TTS_URL = "https://tts.navana.ai/tts/bytes"
SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"

SMALLEST_CHUNK_CHARS = 500
NAVANA_CHUNK_CHARS = 500
SARVAM_CHUNK_CHARS = 500

# Voice per engine and gender when a video names an engine but no voice.
DEFAULT_VOICES: Dict[str, Dict[str, str]] = {
    "smallest": {"female": "nirupma", "male": "kaustubh"},
    "navana": {"female": "bhavana", "male": "anirban"},
}

# Base language (lower-case, accent suffix dropped) → ISO 639-1.
_ISO = {
    "english": "en", "hindi": "hi", "bengali": "bn", "tamil": "ta", "telugu": "te", "marathi": "mr",
    "kannada": "kn", "gujarati": "gu", "malayalam": "ml", "punjabi": "pa", "odia": "or",
    "spanish": "es", "french": "fr", "german": "de", "italian": "it", "dutch": "nl", "swedish": "sv",
    "portuguese": "pt", "polish": "pl", "russian": "ru",
}
# Navana speaks ten languages with every voice.
NAVANA_LANGUAGES = frozenset({"english", "hindi", "bengali", "tamil", "telugu", "marathi", "kannada",
                              "gujarati", "malayalam", "odia"})
SARVAM_LANGUAGES = frozenset({"english", "hindi", "bengali", "tamil", "telugu", "marathi", "kannada",
                              "gujarati", "malayalam", "punjabi", "odia"})
# Languages Smallest's lightning_v3.1 voices are tagged with (per voice).
SMALLEST_LANGUAGES = frozenset(_ISO)


def language_key(language: Optional[str]) -> str:
    return (language or "").strip().lower()


def base_language(language: Optional[str]) -> str:
    """"English (India)" → "english"; "Hindi" → "hindi"."""
    return language_key(language).split("(")[0].strip()


def smallest_language(language: Optional[str]) -> Optional[str]:
    """Smallest's language code, or None when it has no voices for it. English
    must be "en": a Hindi tag on English text renders a drone."""
    base = base_language(language)
    return _ISO.get(base) if base in SMALLEST_LANGUAGES else None


def navana_language(language: Optional[str]) -> Optional[str]:
    base = base_language(language)
    return _ISO.get(base) if base in NAVANA_LANGUAGES else None


def sarvam_language(language: Optional[str]) -> Optional[str]:
    base = base_language(language)
    if base not in SARVAM_LANGUAGES:
        return None
    return "od-IN" if base == "odia" else f"{_ISO[base]}-IN"


def chunk_text(text: str, max_chars: int) -> List[str]:
    """Split at the last sentence end (else the last space) inside each window."""
    chunks: List[str] = []
    remaining = (text or "").strip()
    while remaining:
        if len(remaining) <= max_chars:
            chunks.append(remaining)
            break
        window = remaining[:max_chars]
        cut = max(window.rfind(". "), window.rfind("? "), window.rfind("! "), window.rfind("। "))
        if cut == -1 or cut < max_chars // 2:
            cut = window.rfind(" ")
        cut = max_chars if cut == -1 else cut + 1
        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].lstrip()
    return [c for c in chunks if c]


def pcm16_to_mp3(pcm: bytes, sample_rate: int) -> bytes:
    """Mono 16-bit PCM → MP3 through ffmpeg (already on the ai-service image)."""
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "s16le", "-ar", str(int(sample_rate)), "-ac", "1", "-i", "pipe:0",
         "-codec:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", "pipe:1"],
        input=pcm, capture_output=True, check=False, timeout=300,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"ffmpeg PCM→MP3 failed: {proc.stderr.decode(errors='replace')[:200]}")
    return proc.stdout


# ── Smallest ─────────────────────────────────────────────────────────────────

def synth_smallest_mp3(text: str, language: str, voice_id: str, pace: float = 1.0) -> bytes:
    import httpx

    key = os.environ.get("SMALLEST_API_KEY", "")
    if not key:
        raise RuntimeError("SMALLEST_API_KEY is not set")
    lang = smallest_language(language)
    if not lang:
        raise RuntimeError(f"Smallest has no voices for {language!r}")
    speed = None
    if pace and abs(pace - 1.0) >= 0.02:
        from .voice_tts import smallest_speed_for_ratio
        speed = smallest_speed_for_ratio(max(0.5, min(2.0, pace)))
    out = bytearray()
    with httpx.Client(timeout=60.0) as client:
        for chunk in chunk_text(text, SMALLEST_CHUNK_CHARS):
            body = {"text": chunk, "voice_id": voice_id, "model": SMALLEST_MODEL, "sample_rate": 24000,
                    "output_format": "mp3", "language": lang}
            if speed is not None:
                body["speed"] = speed
            for attempt in range(4):
                r = client.post(SMALLEST_TTS_URL, json=body, headers={"Authorization": f"Bearer {key}"})
                if r.status_code == 429 and attempt < 3:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                if r.status_code >= 400:
                    raise RuntimeError(f"Smallest TTS {r.status_code}: {r.text[:200]}")
                break
            if not r.content:
                raise RuntimeError("Smallest TTS returned empty audio")
            out.extend(r.content)
    return bytes(out)


# ── Navana ───────────────────────────────────────────────────────────────────

NAVANA_STREAMS_PER_KEY = 2
_navana_lock = threading.Lock()
_navana_sems: Dict[str, threading.BoundedSemaphore] = {}
_navana_rr = itertools.count()


def navana_keys(raw: Optional[str] = None) -> List[str]:
    """NAVANA_API_KEY as a list ("k1,k2"): blanks, quotes and repeats dropped."""
    if raw is None:
        raw = os.environ.get("NAVANA_API_KEY") or os.environ.get("BODHI_API_KEY") or ""
    out: List[str] = []
    for k in raw.split(","):
        k = k.strip().strip("\"'").strip()
        if k and k not in out:
            out.append(k)
    return out


def _navana_sem(key: str) -> threading.BoundedSemaphore:
    with _navana_lock:
        sem = _navana_sems.get(key)
        if sem is None:
            sem = _navana_sems[key] = threading.BoundedSemaphore(NAVANA_STREAMS_PER_KEY)
        return sem


def _navana_acquire(keys: List[str], wait_seconds: float = 180.0) -> str:
    """A key with a free stream on this pod: round-robin, else wait on one."""
    start = next(_navana_rr)
    order = [keys[(start + i) % len(keys)] for i in range(len(keys))]
    for key in order:
        if _navana_sem(key).acquire(blocking=False):
            return key
    if _navana_sem(order[0]).acquire(timeout=wait_seconds):
        return order[0]
    raise RuntimeError("Navana: no free stream on any key")


def _navana_one(client, keys: List[str], body: Dict, max_attempts: int = 6):
    """(pcm, sample_rate) for one request, retrying capacity refusals."""
    usable = list(keys)
    for attempt in range(max_attempts):
        if not usable:
            break
        key = _navana_acquire(usable)
        try:
            r = client.post(NAVANA_TTS_URL, json=body, headers={"X-API-Key": key})
        finally:
            _navana_sem(key).release()
        if r.status_code == 200 and r.content:
            return r.content, int(r.headers.get("X-Sample-Rate") or 24000)
        detail = (r.text or "")[:200] if r.status_code != 200 else "empty audio"
        if r.status_code == 429 or "concurrency" in detail.lower():
            time.sleep(min(8.0, 1.0 * (2 ** attempt)))
            continue
        if r.status_code in (401, 402, 403) and len(usable) > 1:
            logger.warning("Navana key refused (%s); trying another key", r.status_code)
            usable.remove(key)
            continue
        raise RuntimeError(f"Navana TTS {r.status_code}: {detail}")
    raise RuntimeError("Navana TTS: every attempt was refused (concurrency limit)")


def synth_navana_mp3(text: str, language: str, voice_id: str, pace: float = 1.0) -> bytes:
    import httpx

    keys = navana_keys()
    if not keys:
        raise RuntimeError("NAVANA_API_KEY is not set")
    lang = navana_language(language)
    if not lang:
        raise RuntimeError(f"Navana does not speak {language!r}")
    pcm = bytearray()
    rate = 24000
    with httpx.Client(timeout=90.0) as client:
        for chunk in chunk_text(text, NAVANA_CHUNK_CHARS):
            body = {"text": chunk, "lang": lang, "voice": voice_id, "output_format": "24000:pcm16"}
            if pace and abs(pace - 1.0) >= 0.02:
                body["speed"] = round(max(0.5, min(2.0, pace)), 2)
            part, rate = _navana_one(client, keys, body)
            pcm.extend(part)
    return pcm16_to_mp3(bytes(pcm), rate)


# ── Sarvam / Edge (preview; the pipeline has its own paths for these) ────────

def synth_sarvam_mp3(text: str, language: str, voice_id: str, pace: float = 1.0) -> bytes:
    import httpx

    key = os.environ.get("SARVAM_API_KEY", "")
    if not key:
        raise RuntimeError("SARVAM_API_KEY is not set")
    lang = sarvam_language(language) or "en-IN"
    out = bytearray()
    with httpx.Client(timeout=60.0) as client:
        for chunk in chunk_text(text, SARVAM_CHUNK_CHARS):
            r = client.post(SARVAM_TTS_URL, headers={"api-subscription-key": key}, json={
                "inputs": [chunk], "target_language_code": lang, "speaker": voice_id, "model": "bulbul:v3",
                "speech_sample_rate": 24000, "enable_preprocessing": True, "output_audio_codec": "mp3",
                "pace": round(pace or 1.0, 2),
            })
            if r.status_code != 200:
                raise RuntimeError(f"Sarvam TTS {r.status_code}: {r.text[:200]}")
            audios = (r.json() or {}).get("audios") or []
            if audios:
                out.extend(base64.b64decode(audios[0]))
    if not out:
        raise RuntimeError("Sarvam TTS returned empty audio")
    return bytes(out)


def synth_edge_mp3(text: str, language: str, voice_id: str, pace: float = 1.0) -> bytes:
    import asyncio

    import edge_tts

    rate = f"{round(((pace or 1.0) - 1.0) * 100):+d}%"

    async def _run() -> bytes:
        buf = bytearray()
        async for chunk in edge_tts.Communicate(text, voice_id, rate=rate).stream():
            if chunk.get("type") == "audio" and chunk.get("data"):
                buf.extend(chunk["data"])
        return bytes(buf)

    audio = asyncio.run(_run())
    if not audio:
        raise RuntimeError("Edge TTS returned empty audio")
    return audio


_ENGINES = {"smallest": synth_smallest_mp3, "navana": synth_navana_mp3,
            "sarvam": synth_sarvam_mp3, "edge": synth_edge_mp3}


def synthesize_mp3(provider: str, text: str, language: str, voice_id: str, pace: float = 1.0) -> bytes:
    engine = _ENGINES.get((provider or "").strip().lower())
    if engine is None:
        raise ValueError(f"Unknown TTS provider {provider!r}")
    return engine(text, language, voice_id, pace)


__all__ = ["DEFAULT_VOICES", "NAVANA_LANGUAGES", "SARVAM_LANGUAGES", "SMALLEST_LANGUAGES", "base_language", "chunk_text",
           "language_key", "navana_keys", "navana_language", "pcm16_to_mp3", "sarvam_language",
           "smallest_language", "synth_edge_mp3", "synth_navana_mp3", "synth_sarvam_mp3",
           "synth_smallest_mp3", "synthesize_mp3"]
