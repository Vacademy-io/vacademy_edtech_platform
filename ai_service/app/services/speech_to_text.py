"""
Speech-to-text for an uploaded recording, in one place.

Every HTTP surface that turns a recorded clip into text calls
``transcribe_audio`` (the learner chat's voice notes, the admin assistant's
microphone), so a new surface — another admin screen, an MCP tool — needs no
provider integration of its own:

  1. normalise the browser's container (webm/opus, ogg, mp4/aac from Safari,
     mp3, wav) to 16 kHz mono WAV with ffmpeg (``audio_utils.transcode_to_wav``;
     ffmpeg ships in the ai_service image);
  2. optionally refuse a clip over the caller's duration limit;
  3. optionally skip the provider for a clip too short to hold a word;
  4. transcribe with Sarvam Saaras, which splits long WAVs into <=29 s pieces.

Provider failures propagate as ``SarvamSTTError`` so each caller keeps its own
error contract. Nothing here logs audio or transcript text — sizes, durations
and the transcode outcome only.

``record_stt_usage`` writes the usage row for a transcription the same way
the voice call and the live tutor do: a record of the vendor cost, no credit
deduction.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Iterable, Optional

from . import audio_utils
from .audio_utils import base_mime, is_wav, wav_duration_seconds
from .sarvam_service import SarvamService

logger = logging.getLogger(__name__)

#: A 16 kHz mono 16-bit WAV shorter than ~0.4 s cannot hold a word; such a clip
#: is answered as "no speech" without a provider call.
MIN_SPEECH_WAV_BYTES = int(44 + 16000 * 2 * 0.4)

#: Containers a browser recorder (or an uploaded voice clip) produces and that
#: ffmpeg in the image decodes. MediaRecorder labels audio-only recordings as
#: video/* in some browsers, so those are accepted too.
ACCEPTED_AUDIO_TYPES = frozenset({
    "audio/webm", "video/webm",
    "audio/ogg", "application/ogg",
    "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "video/mp4",
    "audio/mpeg", "audio/mp3",
    "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave",
})

#: Allowance over a caller's duration limit: a recorder stopped exactly at the
#: limit can report a slightly longer container duration.
DURATION_GRACE_SECONDS = 3.0

#: Language hints the provider accepts ("auto" = detect). Short codes map to the
#: Indian locale, which is what the provider models.
SUPPORTED_LANGUAGES = frozenset({
    "en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN",
    "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
})
_SHORT_LANGUAGE = {code.split("-")[0]: code for code in SUPPORTED_LANGUAGES}
_SHORT_LANGUAGE["or"] = "od-IN"


class SpeechTooLongError(ValueError):
    """The recording is longer than the caller allows."""

    def __init__(self, duration_seconds: float, max_seconds: float):
        super().__init__(f"recording is {duration_seconds:.1f}s, limit {max_seconds:.0f}s")
        self.duration_seconds = duration_seconds
        self.max_seconds = max_seconds


class UnsupportedLanguageError(ValueError):
    """The language hint is not one the provider accepts."""


@dataclass(frozen=True)
class SpeechToTextResult:
    transcript: str
    #: BCP-47 code the provider reported (detected for "auto"), else None.
    language: Optional[str]
    #: Length of the normalised audio, when it could be measured.
    duration_seconds: Optional[float]
    input_bytes: int
    #: What the transcode step did (wav_passthrough, transcoded_file:<mime>, transcode_failed:<why>).
    transcode_note: Optional[str]
    #: True when the provider was called (and so cost something).
    provider_called: bool


def is_accepted_audio_type(mime: Optional[str]) -> bool:
    return base_mime(mime) in ACCEPTED_AUDIO_TYPES


def normalize_language(value: Optional[str]) -> str:
    """"auto", or a provider language code. Accepts "hi", "hi-in", "hi-IN"."""
    raw = (value or "").strip()
    if not raw or raw.lower() in ("auto", "unknown"):
        return "auto"
    if "-" not in raw and raw.lower() in _SHORT_LANGUAGE:
        return _SHORT_LANGUAGE[raw.lower()]
    lang, _, region = raw.partition("-")
    code = f"{lang.lower()}-{region.upper()}"
    if code in SUPPORTED_LANGUAGES:
        return code
    raise UnsupportedLanguageError(raw[:16])


async def transcribe_audio(
    audio: bytes,
    mime: Optional[str],
    *,
    language: str = "auto",
    max_seconds: Optional[float] = None,
    min_speech_wav_bytes: int = 0,
    stt: Optional[SarvamService] = None,
) -> SpeechToTextResult:
    """Transcode ``audio`` to WAV and transcribe it.

    ``stt`` is the provider (default SarvamService): its ``transcribe()`` also
    reports the language; one with only ``speech_to_text()`` works too.
    ``max_seconds`` refuses longer clips with SpeechTooLongError (checked on
    the normalised WAV; a clip ffmpeg could not decode has no measured length
    and is bounded by the caller's upload size). ``min_speech_wav_bytes``
    returns an empty transcript for shorter WAVs without calling the provider.
    Raises SarvamSTTError when the provider fails.
    """
    wav, wav_mime, note = await audio_utils.transcode_to_wav(audio, mime)
    duration = wav_duration_seconds(wav) if is_wav(wav_mime) else None

    if max_seconds is not None and duration is not None and duration > max_seconds + DURATION_GRACE_SECONDS:
        raise SpeechTooLongError(duration, max_seconds)

    if min_speech_wav_bytes and is_wav(wav_mime) and len(wav) < min_speech_wav_bytes:
        return SpeechToTextResult("", None, duration, len(audio), note, provider_called=False)

    service = stt or SarvamService()
    transcribe = getattr(service, "transcribe", None)
    if transcribe is not None:
        result = await transcribe(audio_bytes=wav, language=language, mime_type=wav_mime)
        text, detected = result.text, result.language_code
    else:  # a provider with only speech_to_text() reports no language
        text = await service.speech_to_text(audio_bytes=wav, language=language, mime_type=wav_mime)
        detected = None
    return SpeechToTextResult(
        transcript=text or "",
        language=detected,
        duration_seconds=duration,
        input_bytes=len(audio),
        transcode_note=note,
        provider_called=True,
    )


def record_stt_usage(
    *,
    institute_id: str,
    user_id: str,
    seconds: Optional[float],
    characters: int,
    language: Optional[str],
    surface: str,
    use_case: str,
    metering_surface: str = "ADMIN_APP",
    actor_roles: Optional[Iterable[Any]] = None,
    actor_display_name: Optional[str] = None,
) -> None:
    """Usage row for one transcription: provider cost, no credit deduction.

    Same shape as the voice call's and the live tutor's STT rows (request type
    TRANSCRIPTION, model sarvam:saaras-v3); the usage event is BUNDLED, so it
    never counts against a usage limit. Blocking (runs its own DB session):
    call it off the event loop. Never raises.
    """
    try:
        from ..db import db_session
        from ..models.ai_token_usage import ApiProvider, RequestType
        from .ai_billing import metering_kwargs, metering_user, supported_kwargs
        from .provider_rates import stt_cost_usd
        from .token_usage_service import TokenUsageService

        meter = metering_kwargs(
            use_case,
            metering_user(
                user_id,
                surface=metering_surface,
                display_name=actor_display_name,
                roles_raw=list(actor_roles or []),
            ),
            {"feature": f"{surface}_stt"},
            free_reason="BUNDLED",
        )
        metadata: dict = {"surface": surface, "language": language}
        if seconds:
            metadata["seconds"] = round(float(seconds), 1)
        with db_session() as db:
            tus = TokenUsageService(db)
            tus.record_usage(
                # The api_provider CHECK constraint allows google_tts for
                # speech rows; tts_provider carries the real vendor.
                api_provider=ApiProvider.GOOGLE_TTS,
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                request_type=RequestType.TRANSCRIPTION,
                institute_id=institute_id,
                user_id=user_id,
                model="sarvam:saaras-v3",
                tts_provider="sarvam",
                character_count=max(int(characters or 0), 0),
                total_price=stt_cost_usd("sarvam", seconds or 0.0),
                metadata=metadata,
                **supported_kwargs(tus.record_usage, meter),
            )
    except Exception:  # noqa: BLE001 - metering must never fail the request
        logger.warning("speech-to-text usage not recorded (surface=%s)", surface, exc_info=True)


__all__ = [
    "ACCEPTED_AUDIO_TYPES",
    "DURATION_GRACE_SECONDS",
    "MIN_SPEECH_WAV_BYTES",
    "SUPPORTED_LANGUAGES",
    "SpeechToTextResult",
    "SpeechTooLongError",
    "UnsupportedLanguageError",
    "is_accepted_audio_type",
    "normalize_language",
    "record_stt_usage",
    "transcribe_audio",
]
