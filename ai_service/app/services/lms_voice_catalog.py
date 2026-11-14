"""Narration voices for the LMS AI Video dialog: which engines can speak a
language, their voices, what a minute of narration costs in credits, the
institute's default voice, and cached audio previews.

Engines, in the order the dialog shows them: Edge (free), Sarvam, Smallest,
Navana. Google is not offered here (its billing is off on our GCP project).
An engine whose API key is missing on this server is listed as unavailable.

Default voice: ``institutes.setting_json`` → ``setting[AI_VIDEO_DEFAULTS].data``
= ``{"tts_provider", "voice_id", "voice_gender", "updated_by", "updated_at"}``,
written by institute admins (not the super-admin AI_VIDEO_POLICY).

Previews: a short sentence per language (or the caller's text, ≤ 200 chars)
synthesised once and kept in the public S3 bucket under
``ai-videos/voice-previews/<sha256(provider|voice|language|text)>.mp3``; later
requests read the stored bytes. Not billed; uncached renders are rate limited
per institute.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from ..constants.ai_video_policy import AI_VIDEO_DEFAULTS_KEY, AI_VIDEO_DEFAULTS_NAME
from . import rest_tts
from .institute_setting_reader import load_institute_setting_data

logger = logging.getLogger(__name__)

PROVIDER_ORDER: Tuple[str, ...] = ("edge", "sarvam", "smallest", "navana")

_PROVIDERS: Dict[str, Dict[str, Any]] = {
    "edge": {
        "label": "Free",
        "description": "Microsoft neural voices. Narration uses no credits.",
        "env": (),
    },
    "sarvam": {
        "label": "Sarvam",
        "description": "Natural Indian voices for English and 10 Indian languages.",
        "env": ("SARVAM_API_KEY",),
    },
    "smallest": {
        "label": "Smallest",
        "description": "Expressive Indian and international voices.",
        "env": ("SMALLEST_API_KEY",),
    },
    "navana": {
        "label": "Navana",
        "description": "Indian voices; every voice speaks 10 Indian languages.",
        "env": ("NAVANA_API_KEY", "BODHI_API_KEY"),
    },
}

ADMIN_ROLES = frozenset({"ADMIN", "ADMIN_NON_ROOT", "SUPER_ADMIN"})

_ACCENTS = {"IN": "Indian", "US": "American", "GB": "British", "AU": "Australian", "CA": "Canadian"}

# Edge voices beyond the two per locale the external router lists.
_EDGE_EXTRA_ENGLISH = {
    "english (us)": [("en-US-AvaNeural", "female"), ("en-US-EmmaNeural", "female"),
                     ("en-US-AndrewNeural", "male"), ("en-US-BrianNeural", "male")],
    "english (uk)": [("en-GB-LibbyNeural", "female"), ("en-GB-ThomasNeural", "male")],
}
_ENGLISH_ORDER = ("english (india)", "english (us)", "english (uk)", "english (australia)")

# Navana (Bodhi) publishes no genders; read from the names (voice_bot_service/app/bot.py).
_NAVANA_MALE = {"achu", "anirban", "basava", "basheer", "bijay", "chhotu", "elango", "faizal", "gurdeep", "imran",
                "kannan", "kishan", "murugan", "savio", "shivanna", "srinu", "sulaiman", "tanaji", "temjen", "vetri",
                "xavier"}
_NAVANA_FEMALE = {"ammu", "ann", "arasi", "ayesha", "bhavana", "bimla", "champa", "falguni", "flavia", "harleen",
                  "ipsita", "jayita", "jessy", "kayal", "mahadevi", "malar", "maria", "merin", "mukta", "nasrin",
                  "nayeema", "netra", "nila", "ponni", "porkavi", "rukhiya", "rukhsana", "selvi", "shabnam", "sharon",
                  "shikha", "vanaja", "yasmin", "zoya"}

# Smallest voices proven on live calls; used when its catalogue cannot be read.
_SMALLEST_INDIC = ["english", "hindi", "marathi", "gujarati", "punjabi", "bengali", "odia", "tamil", "telugu",
                   "kannada", "malayalam"]
_SMALLEST_FALLBACK = [
    {"id": vid, "name": vid.capitalize(), "gender": g, "languages": _SMALLEST_INDIC, "accent": "indian"}
    for vid, g in (("nirupma", "female"), ("imogen", "female"), ("kaustubh", "male"), ("virat", "male"),
                   ("karan", "male"), ("yash", "male"), ("devansh", "male"))
]

SAMPLE_TEXT = {
    "english": "Hello! This is the voice that will explain your lessons, one step at a time.",
    "hindi": "नमस्ते! आपके पाठ इसी आवाज़ में, एक-एक कदम करके समझाए जाएँगे।",
    "bengali": "নমস্কার! আপনার পাঠ এই কণ্ঠে ধাপে ধাপে বোঝানো হবে।",
    "tamil": "வணக்கம்! உங்கள் பாடங்கள் இந்தக் குரலில் படிப்படியாக விளக்கப்படும்.",
    "telugu": "నమస్కారం! మీ పాఠాలు ఈ స్వరంలో దశలవారీగా వివరించబడతాయి.",
    "marathi": "नमस्कार! तुमचे धडे या आवाजात टप्प्याटप्प्याने समजावले जातील.",
    "kannada": "ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಪಾಠಗಳನ್ನು ಈ ಧ್ವನಿಯಲ್ಲಿ ಹಂತ ಹಂತವಾಗಿ ವಿವರಿಸಲಾಗುತ್ತದೆ.",
    "gujarati": "નમસ્તે! તમારા પાઠ આ અવાજમાં એક પછી એક પગલે સમજાવવામાં આવશે.",
    "malayalam": "നമസ്കാരം! നിങ്ങളുടെ പാഠങ്ങൾ ഈ ശബ്ദത്തിൽ പടിപടിയായി വിശദീകരിക്കും.",
    "punjabi": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਤੁਹਾਡੇ ਪਾਠ ਇਸ ਆਵਾਜ਼ ਵਿੱਚ ਕਦਮ-ਦਰ-ਕਦਮ ਸਮਝਾਏ ਜਾਣਗੇ।",
    "odia": "ନମସ୍କାର! ଆପଣଙ୍କ ପାଠ ଏହି ସ୍ୱରରେ ଧାପେ ଧାପେ ବୁଝାଯିବ।",
    "spanish": "¡Hola! Esta es la voz que explicará tus lecciones, paso a paso.",
    "french": "Bonjour ! Voici la voix qui expliquera vos leçons, étape par étape.",
    "german": "Hallo! Das ist die Stimme, die deine Lektionen Schritt für Schritt erklärt.",
    "italian": "Ciao! Questa è la voce che spiegherà le tue lezioni, passo dopo passo.",
    "portuguese": "Olá! Esta é a voz que vai explicar as suas aulas, passo a passo.",
}

PREVIEW_TEXT_MAX = 200
PREVIEW_S3_PREFIX = "ai-videos/voice-previews"
# Uncached renders per institute per window (cache hits are free).
PREVIEW_RATE_LIMIT = 30
PREVIEW_RATE_WINDOW_SECONDS = 600
_preview_hits: Dict[str, Deque[float]] = {}


class VoiceError(ValueError):
    """A provider / voice / language the dialog cannot use: (code, detail)."""

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


# ── providers ────────────────────────────────────────────────────────────────

def provider_label(provider: str) -> str:
    meta = _PROVIDERS.get(provider)
    if meta is None:
        return (provider or "").capitalize()
    return "Free voice" if provider == "edge" else meta["label"]


def provider_available(provider: str) -> Tuple[bool, Optional[str]]:
    meta = _PROVIDERS.get(provider)
    if meta is None:
        return False, "Unknown voice provider."
    if meta["env"] and not any((os.environ.get(k) or "").strip() for k in meta["env"]):
        return False, f"{meta['label']} voices aren't set up on this server yet."
    return True, None


def credits_per_minute(provider: str, usd_to_credits: float) -> float:
    """Credits one minute of narration costs on `provider` (Edge: 0)."""
    from .provider_rates import TTS_USD_PER_1K_CHARS
    from .video_estimation_service import TTS_CHARS_PER_MINUTE

    usd = TTS_USD_PER_1K_CHARS.get(provider, 0.0) * TTS_CHARS_PER_MINUTE / 1000.0
    return round(usd * float(usd_to_credits), 1)


def usd_to_credit_ratio(db: Session) -> float:
    from .credit_service import CreditService

    try:
        return float(CreditService(db)._effective_usd_to_credit_ratio())
    except Exception:  # noqa: BLE001
        logger.warning("[LMS-Voices] credit ratio lookup failed; using 150", exc_info=True)
        return 150.0


def is_admin(roles) -> bool:
    from .tutor.roles import normalize_roles

    return bool(normalize_roles(roles) & ADMIN_ROLES)


# ── voices per engine ────────────────────────────────────────────────────────

def _voice(vid: str, name: str, gender: Optional[str], accent: Optional[str], sample_url: Optional[str] = None):
    g = (gender or "").lower()
    return {"id": vid, "name": name, "gender": g if g in ("female", "male") else None,
            "accent": accent or None, "sample_url": sample_url}


def _edge_table() -> Dict[str, Dict[str, str]]:
    from ..routers.external_video_generation import _EDGE_VOICES

    return _EDGE_VOICES


def _edge_name(voice_id: str) -> Tuple[str, Optional[str]]:
    parts = voice_id.split("-")
    name = parts[-1][:-len("Neural")] if parts[-1].endswith("Neural") else parts[-1]
    accent = _ACCENTS.get(parts[1]) if len(parts) >= 3 and parts[0] == "en" else None
    return name, accent


def edge_voices(language: str) -> List[Dict[str, Any]]:
    from ..routers.external_video_generation import _EDGE_SAMPLE_URLS

    table = _edge_table()
    key = rest_tts.language_key(language)
    base = rest_tts.base_language(language)
    if key in table:
        keys = [key]
    else:
        keys = [k for k in table if k.split("(")[0].strip() == base]
        if base == "english":
            keys.sort(key=lambda k: _ENGLISH_ORDER.index(k) if k in _ENGLISH_ORDER else len(_ENGLISH_ORDER))
    out: List[Dict[str, Any]] = []
    seen = set()
    for k in keys:
        pairs = [(table[k][g], g) for g in ("female", "male") if table[k].get(g)]
        pairs += _EDGE_EXTRA_ENGLISH.get(k, [])
        for vid, g in pairs:
            if vid in seen:
                continue
            seen.add(vid)
            name, accent = _edge_name(vid)
            out.append(_voice(vid, name, g, accent, _EDGE_SAMPLE_URLS.get(vid)))
    return out


def _all_edge_voice_ids() -> set:
    ids = {v for row in _edge_table().values() for v in row.values()}
    ids |= {vid for extras in _EDGE_EXTRA_ENGLISH.values() for vid, _ in extras}
    return ids


def _sarvam_speakers() -> List[Tuple[str, str]]:
    from .voice_tts import SARVAM_V3_SPEAKERS
    from ..routers.external_video_generation import _SARVAM_VOICES

    # bulbul:v3 rejects any other speaker (amelia / sophia are v2-only).
    return [(v["id"], g) for g in ("female", "male") for v in _SARVAM_VOICES[g] if v["id"] in SARVAM_V3_SPEAKERS]


def sarvam_voices(language: str) -> List[Dict[str, Any]]:
    from ..routers.external_video_generation import _SARVAM_SAMPLE_URLS

    if rest_tts.base_language(language) not in rest_tts.SARVAM_LANGUAGES:
        return []
    return [_voice(vid, vid.capitalize(), g, "Indian", _SARVAM_SAMPLE_URLS.get(vid)) for vid, g in _sarvam_speakers()]


async def _smallest_catalogue() -> List[Dict[str, Any]]:
    from .voice_tts import list_smallest_voices

    try:
        voices = await list_smallest_voices()
    except Exception:  # noqa: BLE001
        logger.warning("[LMS-Voices] Smallest catalogue unavailable; using the fallback list", exc_info=True)
        voices = []
    return voices or list(_SMALLEST_FALLBACK)


def _accent_rank(accent: str, language: str) -> int:
    a = (accent or "").lower()
    prefer = {"english (us)": "american", "english (uk)": "british", "english (australia)": "australian"}
    first = prefer.get(rest_tts.language_key(language), "indian")
    order = [first] + [x for x in ("indian", "american", "british") if x != first]
    return order.index(a) if a in order else len(order)


async def smallest_voices(language: str) -> List[Dict[str, Any]]:
    base = rest_tts.base_language(language)
    if not rest_tts.smallest_language(language):
        return []
    rows = [v for v in await _smallest_catalogue() if base in (v.get("languages") or [])]
    rows.sort(key=lambda v: (_accent_rank(v.get("accent") or "", language), (v.get("name") or "").lower()))
    return [_voice(v["id"], v.get("name") or v["id"], v.get("gender"),
                   (v.get("accent") or "").replace("-", " ").title() or None) for v in rows]


def navana_voices(language: str) -> List[Dict[str, Any]]:
    if not rest_tts.navana_language(language):
        return []
    rows = [(v, "female") for v in sorted(_NAVANA_FEMALE)] + [(v, "male") for v in sorted(_NAVANA_MALE)]
    return [_voice(v, v.capitalize(), g, "Indian") for v, g in rows]


async def voices_for(provider: str, language: str) -> List[Dict[str, Any]]:
    if provider == "edge":
        return edge_voices(language)
    if provider == "sarvam":
        return sarvam_voices(language)
    if provider == "smallest":
        return await smallest_voices(language)
    if provider == "navana":
        return navana_voices(language)
    return []


async def find_voice(provider: str, voice_id: str) -> Optional[Dict[str, Any]]:
    """The voice in `provider`'s full catalogue (any language), or None."""
    vid = (voice_id or "").strip()
    if not vid:
        return None
    if provider == "edge":
        if vid not in _all_edge_voice_ids():
            return None
        name, accent = _edge_name(vid)
        gender = next((g for row in _edge_table().values() for g, v in row.items() if v == vid), None)
        if gender is None:
            gender = next((g for extras in _EDGE_EXTRA_ENGLISH.values() for v, g in extras if v == vid), None)
        return _voice(vid, name, gender, accent)
    low = vid.lower()
    if provider == "sarvam":
        g = dict(_sarvam_speakers()).get(low)
        return _voice(low, low.capitalize(), g, "Indian") if g else None
    if provider == "navana":
        if low in _NAVANA_FEMALE or low in _NAVANA_MALE:
            return _voice(low, low.capitalize(), "female" if low in _NAVANA_FEMALE else "male", "Indian")
        return None
    if provider == "smallest":
        for v in await _smallest_catalogue():
            if v["id"] == vid or v["id"] == low:
                return _voice(v["id"], v.get("name") or v["id"], v.get("gender"),
                              (v.get("accent") or "").replace("-", " ").title() or None)
        return None
    return None


async def check_voice(provider: str, voice_id: Optional[str], language: Optional[str]) -> Optional[Dict[str, Any]]:
    """Raise VoiceError unless `provider` is configured, speaks `language` and
    (when given) has `voice_id`. Returns the voice (None without a voice_id)."""
    if provider not in _PROVIDERS:
        raise VoiceError("INVALID_VOICE", "Choose one of the listed voice providers.")
    ok, reason = provider_available(provider)
    if not ok:
        raise VoiceError("VOICE_UNAVAILABLE", reason or "This voice provider is not available.")
    label = _PROVIDERS[provider]["label"]
    if language is not None and not await voices_for(provider, language):
        raise VoiceError("VOICE_UNAVAILABLE", f"{label} voices can't speak {language}. Pick another voice.")
    if not voice_id:
        return None
    voice = await find_voice(provider, voice_id)
    if voice is None:
        raise VoiceError("INVALID_VOICE", f"“{voice_id}” is not a {label} voice.")
    if language is not None and provider == "smallest":
        if voice["id"] not in {v["id"] for v in await smallest_voices(language)}:
            raise VoiceError("VOICE_UNAVAILABLE", f"{voice['name']} can't speak {language}. Pick another voice.")
    if language is not None and provider == "edge":
        if voice["id"] not in {v["id"] for v in edge_voices(language)}:
            raise VoiceError("VOICE_UNAVAILABLE", f"{voice['name']} can't speak {language}. Pick another voice.")
    return voice


async def catalogue(db: Session, language: str) -> List[Dict[str, Any]]:
    ratio = usd_to_credit_ratio(db)
    out = []
    for pid in PROVIDER_ORDER:
        meta = _PROVIDERS[pid]
        ok, reason = provider_available(pid)
        voices = await voices_for(pid, language) if ok else []
        if ok and not voices:
            ok, reason = False, f"{meta['label']} voices can't speak {language}."
        out.append({
            "id": pid, "label": meta["label"], "description": meta["description"],
            "available": ok, "unavailable_reason": reason,
            "credits_per_minute": credits_per_minute(pid, ratio),
            "voices": voices,
        })
    return out


# ── institute default ────────────────────────────────────────────────────────

def load_default(db: Session, institute_id: str) -> Optional[Dict[str, Any]]:
    data = load_institute_setting_data(db, institute_id, AI_VIDEO_DEFAULTS_KEY)
    if not isinstance(data, dict):
        return None
    provider = str(data.get("tts_provider") or "").strip().lower()
    voice_id = str(data.get("voice_id") or "").strip()
    if provider not in _PROVIDERS or not voice_id:
        return None
    gender = data.get("voice_gender")
    return {"tts_provider": provider, "voice_id": voice_id,
            "voice_gender": gender if gender in ("female", "male") else None}


def save_default(db: Session, institute_id: str, *, tts_provider: str, voice_id: str,
                 voice_gender: Optional[str], user_id: Optional[str]) -> Dict[str, Any]:
    from .ai_video_policy_service import save_setting

    data = {"tts_provider": tts_provider, "voice_id": voice_id, "voice_gender": voice_gender,
            "updated_by": user_id, "updated_at": datetime.now(timezone.utc).isoformat()}
    save_setting(db, institute_id, AI_VIDEO_DEFAULTS_KEY, AI_VIDEO_DEFAULTS_NAME, data)
    return {"tts_provider": tts_provider, "voice_id": voice_id, "voice_gender": voice_gender}


def clear_default(db: Session, institute_id: str) -> bool:
    from .ai_video_policy_service import delete_setting

    return delete_setting(db, institute_id, AI_VIDEO_DEFAULTS_KEY)


# ── preview ──────────────────────────────────────────────────────────────────

def sample_text(language: str) -> str:
    return SAMPLE_TEXT.get(rest_tts.base_language(language)) or SAMPLE_TEXT["english"]


def preview_key(provider: str, voice_id: str, language: str, text: str) -> str:
    raw = "|".join([provider, voice_id, rest_tts.language_key(language), text])
    return f"{PREVIEW_S3_PREFIX}/{hashlib.sha256(raw.encode('utf-8')).hexdigest()}.mp3"


def take_preview_slot(institute_id: str, now: Optional[float] = None) -> bool:
    """False once the institute has rendered PREVIEW_RATE_LIMIT uncached
    previews in the window (per pod; enough to stop a runaway loop)."""
    now = time.monotonic() if now is None else now
    hits = _preview_hits.setdefault(institute_id, deque())
    while hits and now - hits[0] > PREVIEW_RATE_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= PREVIEW_RATE_LIMIT:
        return False
    hits.append(now)
    return True


def _s3():
    from .s3_service import S3Service

    try:
        return S3Service()
    except Exception:  # noqa: BLE001
        logger.warning("[LMS-Voices] S3 not configured; previews are not cached", exc_info=True)
        return None


def _cache_get(s3, key: str) -> Optional[bytes]:
    try:
        obj = s3.s3_client.get_object(Bucket=str(s3.public_bucket), Key=key)
        return obj["Body"].read()
    except Exception:  # noqa: BLE001  (NoSuchKey and transport errors alike)
        return None


def _cache_put(s3, key: str, audio: bytes) -> None:
    try:
        s3.upload_file_content(audio, "preview.mp3", s3_key=key, content_type="audio/mpeg")
    except Exception:  # noqa: BLE001
        logger.warning("[LMS-Voices] could not cache preview %s", key, exc_info=True)


class PreviewRateLimited(Exception):
    pass


async def preview_audio(institute_id: str, provider: str, voice_id: str, language: str,
                        text: Optional[str]) -> Tuple[bytes, bool]:
    """(mp3 bytes, cache_hit). Raises PreviewRateLimited or the engine's error."""
    text = (text or "").strip() or sample_text(language)
    key = preview_key(provider, voice_id, language, text)
    s3 = await asyncio.to_thread(_s3)
    if s3 is not None:
        cached = await asyncio.to_thread(_cache_get, s3, key)
        if cached:
            return cached, True
    if not take_preview_slot(institute_id):
        raise PreviewRateLimited()
    audio = await asyncio.wait_for(
        asyncio.to_thread(rest_tts.synthesize_mp3, provider, text, language, voice_id), timeout=60)
    if s3 is not None:
        await asyncio.to_thread(_cache_put, s3, key, audio)
    return audio, False


__all__ = ["ADMIN_ROLES", "PROVIDER_ORDER", "PreviewRateLimited", "VoiceError", "catalogue",
           "check_voice", "clear_default", "credits_per_minute", "find_voice", "is_admin", "load_default",
           "preview_audio", "provider_available", "provider_label", "sample_text", "save_default",
           "take_preview_slot", "voices_for"]
