"""
Text-to-speech engines for the learner voice call.

The call used to be hard-wired to Sarvam. The engine is now a platform setting
(`chatbot.voice.tts_provider`, set from the super-admin portal) and this module
is the one place that knows how to drive each one.

Every engine returns a complete, independently playable audio file plus its
MIME type — the browser decodes each spoken segment on its own, so WAV from
Sarvam and MP3 from Google/Edge are equally fine. A failing engine falls back to
Sarvam for that line: a misconfigured vendor must degrade to a different voice,
never to a silent call.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

from .sarvam_service import SarvamService

logger = logging.getLogger(__name__)

# Voices proven on the AI-calling side (voice_bot_service config) plus Edge's
# published Indian-locale neural voices. Chirp3-HD voice names are shared across
# Google locales, so the same suffix works for every language we offer.
_GOOGLE_DEFAULT_SUFFIX = "Chirp3-HD-Achird"
_EDGE_DEFAULT_VOICES = {
    "en-IN": "en-IN-NeerjaNeural",
    "hi-IN": "hi-IN-SwaraNeural",
    "bn-IN": "bn-IN-TanishaaNeural",
    "ta-IN": "ta-IN-PallaviNeural",
    "te-IN": "te-IN-ShrutiNeural",
    "kn-IN": "kn-IN-SapnaNeural",
    "ml-IN": "ml-IN-SobhanaNeural",
    "mr-IN": "mr-IN-AarohiNeural",
    "gu-IN": "gu-IN-DhwaniNeural",
}

# Smallest.ai Lightning v3.1 (owner's choice for the tutor: cloning, rates).
# REST synthesis (docs.smallest.ai, model card lightning-v-3-1) and the
# instant voice-clone API (docs.smallest.ai/waves/documentation/voice-cloning).
SMALLEST_TTS_URL = "https://api.smallest.ai/waves/v1/tts"
SMALLEST_CLONE_URL = "https://api.smallest.ai/waves/v1/voice-cloning"
SMALLEST_MODEL = "lightning_v3.1"
SMALLEST_DEFAULT_VOICE = os.environ.get("SMALLEST_VOICE") or "nirupma"
SMALLEST_LANG = {"en-IN": "en", "hi-IN": "hi", "ta-IN": "ta", "te-IN": "te", "kn-IN": "kn", "ml-IN": "ml",
                 "mr-IN": "mr", "gu-IN": "gu", "bn-IN": "bn", "pa-IN": "pa"}


def smallest_available() -> bool:
    return bool(os.environ.get("SMALLEST_API_KEY"))


# Smallest's `speed` is not the ratio it names. Measured 2026-09-04 on
# lightning_v3.1 / nirupma with a 6.9 s sentence (speed → actual duration
# ratio): 0.9 only made it 4% longer, 0.8 16%, while 1.25 made it 17% shorter.
# The pace an admin picks is the ratio they expect, so it is mapped through
# this table (piecewise-linear inverse) before it becomes the engine's speed.
_SMALLEST_SPEED_TABLE = (  # (engine speed, measured duration ratio)
    (0.5, 0.55), (0.6, 0.67), (0.7, 0.77), (0.8, 0.86), (0.9, 0.96), (1.0, 1.0),
    (1.25, 1.21), (1.5, 1.45), (1.75, 1.68), (2.0, 1.96),
)


def smallest_speed_for_ratio(ratio: float) -> float:
    """Engine `speed` that yields the wanted duration ratio (1.0 = natural)."""
    r = max(_SMALLEST_SPEED_TABLE[0][1], min(_SMALLEST_SPEED_TABLE[-1][1], float(ratio)))
    for (s0, r0), (s1, r1) in zip(_SMALLEST_SPEED_TABLE, _SMALLEST_SPEED_TABLE[1:]):
        if r0 <= r <= r1:
            if r1 == r0:
                return s0
            return round(s0 + (s1 - s0) * (r - r0) / (r1 - r0), 3)
    return 1.0


_smallest_voice_cache: Dict[str, Any] = {"at": 0.0, "voices": []}


async def list_smallest_voices() -> List[Dict[str, Any]]:
    """Smallest lightning_v3.1 voice catalogue (234 voices; cached an hour):
    [{id, name, gender, languages, age, accent}]."""
    import time as _time
    import httpx

    key = os.environ.get("SMALLEST_API_KEY", "")
    if not key:
        return []
    if _smallest_voice_cache["voices"] and _time.time() - _smallest_voice_cache["at"] < 3600:
        return list(_smallest_voice_cache["voices"])
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get("https://api.smallest.ai/waves/v1/lightning-v3.1/get_voices",
                             headers={"Authorization": f"Bearer {key}"})
        if r.status_code >= 400:
            raise RuntimeError(f"Smallest voices {r.status_code}: {r.text[:200]}")
        payload = r.json()
    items = payload.get("voices") if isinstance(payload, dict) else payload
    out: List[Dict[str, Any]] = []
    for v in items or []:
        if not isinstance(v, dict) or not v.get("voiceId"):
            continue
        tags = v.get("tags") or {}
        out.append({
            "id": str(v["voiceId"]), "name": v.get("displayName") or v["voiceId"],
            "gender": (tags.get("gender") or "").lower() or None,
            "languages": [str(x).lower() for x in (tags.get("language") or [])],
            "age": tags.get("age") or None, "accent": tags.get("accent") or None,
        })
    out.sort(key=lambda x: ((x["gender"] or "z"), x["name"].lower()))
    _smallest_voice_cache.update(at=_time.time(), voices=out)
    return list(out)


SARVAM_FEMALE = {"ritu", "priya", "neha", "pooja", "simran", "kavya", "ishita", "shreya", "roopa", "tanya", "shruti",
                 "suhani", "kavitha", "rupali"}


def sarvam_voice_catalogue() -> List[Dict[str, Any]]:
    return [{"id": v, "name": v.capitalize(), "gender": "female" if v in SARVAM_FEMALE else "male",
             "languages": ["english", "hindi"]}
            for v in sorted(SARVAM_V3_SPEAKERS, key=lambda x: (x not in SARVAM_FEMALE, x))]


TTS_PROVIDERS: Dict[str, Dict[str, Any]] = {
    "smallest": {
        "label": "Smallest.ai Lightning v3.1",
        "note": "Indian-language specialist with instant voice cloning; needs SMALLEST_API_KEY on ai-service.",
    },
    "sarvam": {
        "label": "Sarvam Bulbul v3",
        "note": "Indian-language specialist; uses the institute's configured voice.",
    },
    "google": {
        "label": "Google Cloud Chirp3-HD",
        "note": "Needs GOOGLE_APPLICATION_CREDENTIALS_JSON on ai-service (same as the video pipeline).",
    },
    "edge": {
        "label": "Microsoft Edge neural (free)",
        "note": "No key and no per-character charge; quality a notch below the paid engines.",
    },
}


# Speakers Sarvam's bulbul:v3 accepts (its 400 lists them). Any other name —
# a v2 voice such as "anushka", a Smallest.ai voice typed into the admin card
# — is silently replaced, because a wrong speaker means a SILENT lesson.
SARVAM_V3_SPEAKERS = frozenset({
    "aditya", "ritu", "ashutosh", "priya", "neha", "rahul", "pooja", "rohan", "simran", "kavya", "amit", "dev",
    "ishita", "shreya", "ratan", "varun", "manan", "sumit", "roopa", "kabir", "aayan", "shubh", "advait", "anand",
    "tanya", "tarun", "sunny", "mani", "gokul", "vijay", "shruti", "suhani", "mohit", "kavitha", "rehan", "soham",
    "rupali",
})
SARVAM_DEFAULT_FEMALE = "priya"


def sarvam_speaker(voice: Optional[str], default: str = "shubh") -> str:
    v = (voice or "").strip().lower()
    return v if v in SARVAM_V3_SPEAKERS else default


def default_voice_for(provider: str, language: str) -> str:
    lang = (language or "en-IN").strip()
    if provider == "google":
        return f"{lang}-{_GOOGLE_DEFAULT_SUFFIX}"
    if provider == "edge":
        return _EDGE_DEFAULT_VOICES.get(lang) or _EDGE_DEFAULT_VOICES["en-IN"]
    if provider == "smallest":
        return SMALLEST_DEFAULT_VOICE
    return "shubh"


def _google_available() -> bool:
    return bool(
        os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
        or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    )


def list_tts_providers() -> List[Dict[str, Any]]:
    """Catalogue for the super-admin portal, with whether each engine can run here."""
    out = []
    for pid, meta in TTS_PROVIDERS.items():
        available = True
        if pid == "sarvam":
            available = bool(os.environ.get("SARVAM_API_KEY"))
        elif pid == "smallest":
            available = smallest_available()
        elif pid == "google":
            available = _google_available()
        out.append(
            {
                "id": pid,
                "label": meta["label"],
                "note": meta["note"],
                "available": available,
                "default_voice_example": default_voice_for(pid, "hi-IN"),
            }
        )
    return out


# --------------------------------------------------------------------------
# Engines
# --------------------------------------------------------------------------

async def _sarvam(text: str, language: str, voice: str, pace: Optional[float] = None) -> Tuple[bytes, str]:
    voice = sarvam_speaker(voice, "shubh")
    audio = await SarvamService().text_to_speech(text=text, language=language, voice=voice or "shubh", pace=pace)
    return audio, "audio/wav"


def _google_sync(text: str, language: str, voice: str) -> bytes:
    from google.cloud import texttospeech  # heavy import, only when used
    from google.oauth2 import service_account

    creds = None
    raw_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    if raw_json:
        info = json.loads(raw_json)
        pk = info.get("private_key", "")
        if "\\n" in pk and "\n" not in pk:
            info["private_key"] = pk.replace("\\n", "\n")
        creds = service_account.Credentials.from_service_account_info(info)
    # Otherwise fall through to ADC (GOOGLE_APPLICATION_CREDENTIALS file path).
    client = texttospeech.TextToSpeechClient(credentials=creds)

    voice_name = voice or default_voice_for("google", language)
    # The locale is encoded in the voice name (hi-IN-Chirp3-HD-Achird).
    parts = voice_name.split("-")
    language_code = "-".join(parts[:2]) if len(parts) >= 2 else (language or "en-IN")
    response = client.synthesize_speech(
        input=texttospeech.SynthesisInput(text=text),
        voice=texttospeech.VoiceSelectionParams(language_code=language_code, name=voice_name),
        # No speaking_rate: Chirp3-HD returns 400 if the field is present at all.
        audio_config=texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3),
    )
    return bytes(response.audio_content or b"")


async def _google(text: str, language: str, voice: str, pace: Optional[float] = None) -> Tuple[bytes, str]:
    audio = await asyncio.to_thread(_google_sync, text, language, voice)
    return audio, "audio/mpeg"


async def _edge(text: str, language: str, voice: str, pace: Optional[float] = None) -> Tuple[bytes, str]:
    import edge_tts  # lazy: only when the engine is selected

    kwargs = {}
    if pace and abs(pace - 1.0) >= 0.05:
        kwargs["rate"] = f"{'+' if pace > 1 else '-'}{int(round(abs(pace - 1.0) * 100))}%"
    communicate = edge_tts.Communicate(text, voice or default_voice_for("edge", language), **kwargs)
    buf = bytearray()
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            buf.extend(chunk["data"])
    return bytes(buf), "audio/mpeg"


async def _smallest(text: str, language: str, voice: str, pace: Optional[float] = None) -> Tuple[bytes, str]:
    """One REST call → WAV. A voice id that the model does not serve comes
    back as a 4xx, which the caller turns into the Sarvam fallback."""
    import httpx  # lazy: keeps this module import-light for the settings page

    key = os.environ.get("SMALLEST_API_KEY", "")
    if not key:
        raise RuntimeError("SMALLEST_API_KEY is not set")
    body: Dict[str, Any] = {
        "text": text,
        "voice_id": (voice or SMALLEST_DEFAULT_VOICE).strip(),
        "model": SMALLEST_MODEL,
        "sample_rate": 24000,
        "output_format": "wav",
        "language": SMALLEST_LANG.get(language, "auto"),
    }
    if pace and abs(pace - 1.0) >= 0.02:
        body["speed"] = smallest_speed_for_ratio(max(0.5, min(2.0, pace)))
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(SMALLEST_TTS_URL, json=body,
                              headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        if r.status_code >= 400:
            raise RuntimeError(f"Smallest TTS {r.status_code}: {r.text[:200]}")
        return r.content, "audio/wav"


async def clone_voice_smallest(*, audio: bytes, filename: str, display_name: str,
                               language: Optional[str] = None, description: Optional[str] = None) -> Dict[str, Any]:
    """Instant clone from a 5-15 s sample (< 5 MB; mp3/wav/mp4/webm).
    Returns {"voice_id", "raw"}; raises RuntimeError with the vendor's message."""
    import httpx

    key = os.environ.get("SMALLEST_API_KEY", "")
    if not key:
        raise RuntimeError("Voice cloning is not configured on this server (SMALLEST_API_KEY missing)")
    data = {"displayName": display_name[:80], "model": "lightning-v3.1"}
    if language:
        data["language"] = language
    if description:
        data["description"] = description[:300]
    async with httpx.AsyncClient(timeout=90.0) as client:
        r = await client.post(SMALLEST_CLONE_URL, data=data,
                              files={"file": (filename or "sample.wav", audio)},
                              headers={"Authorization": f"Bearer {key}"})
        if r.status_code >= 400:
            raise RuntimeError(f"Smallest clone {r.status_code}: {r.text[:300]}")
        payload = r.json() if r.content else {}
    voice_id = ((payload.get("data") or {}).get("voiceId") if isinstance(payload, dict) else None) or payload.get("voiceId")
    if not voice_id:
        raise RuntimeError(f"Smallest clone: no voiceId in response ({str(payload)[:200]})")
    return {"voice_id": str(voice_id), "raw": payload}


async def list_cloned_voices_smallest() -> List[Dict[str, Any]]:
    import httpx

    key = os.environ.get("SMALLEST_API_KEY", "")
    if not key:
        return []
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(SMALLEST_CLONE_URL, headers={"Authorization": f"Bearer {key}"})
        if r.status_code >= 400:
            raise RuntimeError(f"Smallest voices {r.status_code}: {r.text[:200]}")
        payload = r.json()
    items = payload.get("data") if isinstance(payload, dict) else payload
    return [i for i in (items or []) if isinstance(i, dict)]


_ENGINES = {"sarvam": _sarvam, "google": _google, "edge": _edge, "smallest": _smallest}


async def synthesize_speech(
    text: str,
    language: str,
    voice: Optional[str],
    provider: str,
    pace: Optional[float] = None,
) -> Tuple[bytes, str, str]:
    """
    Speak `text` with `provider`. Returns (audio_bytes, mime_type, provider_used) —
    provider_used differs from `provider` when the engine failed and Sarvam
    covered the line, so metering records what actually ran. `pace` is a
    speed multiplier (0.5–2.0; 1.0 = normal) honoured by Sarvam and Edge;
    Google Chirp3-HD rejects a rate field, so it is ignored there.
    """
    provider = (provider or "sarvam").strip().lower()
    engine = _ENGINES.get(provider, _sarvam)
    if not text.strip():
        return b"", "audio/wav", provider
    if pace is not None:
        pace = max(0.5, min(2.0, float(pace)))

    try:
        audio, mime = await asyncio.wait_for(engine(text, language, voice or "", pace), timeout=30)
        if audio:
            return audio, mime, provider
        logger.warning("TTS engine %s returned no audio; falling back to Sarvam", provider)
    except Exception:
        logger.exception("TTS engine %s failed; falling back to Sarvam", provider)

    try:
        # Second try on Sarvam with its default speaker: a bad voice name must
        # degrade to a different voice, never to silence.
        audio, mime = await _sarvam(text, language, "", pace)
        return audio, mime, "sarvam"
    except Exception:
        logger.exception("Sarvam fallback failed too")
        return b"", "audio/wav", "sarvam"


__all__ = ["SARVAM_DEFAULT_FEMALE", "SARVAM_V3_SPEAKERS", "SMALLEST_DEFAULT_VOICE", "TTS_PROVIDERS", "clone_voice_smallest",
           "default_voice_for", "list_cloned_voices_smallest", "list_smallest_voices", "list_tts_providers",
           "sarvam_speaker", "sarvam_voice_catalogue", "smallest_available", "smallest_speed_for_ratio", "synthesize_speech"]
