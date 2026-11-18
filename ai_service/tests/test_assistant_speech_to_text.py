"""POST /assistant/speech-to-text and the shared speech-to-text service.

No network, no DB, no ffmpeg: the real pinning path (security.resolve_pinned_principal)
runs on a stubbed token verification + JWT decode, the speech provider is a
fake, and WAV input passes through the transcode step untouched (other
containers use a stubbed transcode). The learner voice-note endpoint is
exercised through the same shared service to show its contract is unchanged.
"""
from __future__ import annotations

import logging
import os
import struct
import sys
import types
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:  # some routers import s3_service -> boto3; stub it where it isn't installed
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover - depends on the test venv
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.core.security as security
from app.core import chat_auth
from app.dependencies import get_assistant_service
from app.routers import assistant as assistant_router
from app.schemas.auth import CustomUserDetails
from app.services import audio_utils, sarvam_service
from app.services import speech_to_text as stt
from app.services.sarvam_service import SarvamService, SarvamSTTError, SarvamTranscript

INST = "inst-a"
OTHER_INST = "inst-b"
USER = "user-1"
SPOKEN = "kitne students ne aaj fees pay ki"


def wav_bytes(seconds: float, rate: int = 16000) -> bytes:
    """A silent 16-bit mono PCM WAV of the given length."""
    data = b"\x00\x00" * int(seconds * rate)
    return (
        b"RIFF" + (36 + len(data)).to_bytes(4, "little") + b"WAVE"
        + b"fmt " + (16).to_bytes(4, "little")
        + struct.pack("<HHIIHH", 1, 1, rate, rate * 2, 2, 16)
        + b"data" + len(data).to_bytes(4, "little") + data
    )


class FakeProvider:
    """Stands in for SarvamService; records what it was asked to transcribe."""

    calls: list = []
    reply: SarvamTranscript = SarvamTranscript(SPOKEN, "hi-IN")
    error: Exception | None = None

    async def transcribe(self, audio_bytes, language="auto", mime_type="audio/wav"):
        FakeProvider.calls.append({"bytes": len(audio_bytes), "language": language, "mime": mime_type})
        if FakeProvider.error is not None:
            raise FakeProvider.error
        return FakeProvider.reply

    async def speech_to_text(self, audio_bytes, language="auto", mime_type="audio/wav"):
        return (await self.transcribe(audio_bytes, language=language, mime_type=mime_type)).text


@pytest.fixture()
def env(monkeypatch):
    state = SimpleNamespace(
        is_root=False,
        authorities={INST: {"roles": ["ADMIN"], "permissions": []}},
        usage=[],
        sent=[],
        transcoded=[],
    )

    async def fake_verify(auth_header, client_id, settings, **_kw):
        return CustomUserDetails(username="u", user_id=USER, is_root_user=state.is_root)

    def fake_decode(token, settings):
        return {"user": USER, "fullname": "Asha Admin", "authorities": state.authorities}

    monkeypatch.setattr(security, "_verify_and_fetch_user", fake_verify)
    monkeypatch.setattr(security, "_decode_jwt_token", fake_decode)
    monkeypatch.setattr(chat_auth, "_rate_hits", {})

    FakeProvider.calls = []
    FakeProvider.reply = SarvamTranscript(SPOKEN, "hi-IN")
    FakeProvider.error = None
    monkeypatch.setattr(assistant_router, "SarvamService", FakeProvider)
    monkeypatch.setattr(stt, "record_stt_usage", lambda **kw: state.usage.append(kw))

    real_transcode = audio_utils.transcode_to_wav

    async def fake_transcode(audio, mime):
        # WAV goes through the real step; any browser container is "decoded" to 3 s of WAV.
        state.transcoded.append(stt.base_mime(mime))
        if stt.is_wav(mime):
            return await real_transcode(audio, mime)
        return wav_bytes(3.0), "audio/wav", f"transcoded_file:{stt.base_mime(mime)}"

    monkeypatch.setattr(audio_utils, "transcode_to_wav", fake_transcode)

    class FakeAssistant:
        async def send_message(self, *a, **kw):
            state.sent.append((a, kw))
            return 1

    app = FastAPI()
    app.include_router(assistant_router.router)
    app.dependency_overrides[get_assistant_service] = lambda: FakeAssistant()
    with TestClient(app) as client:
        state.client = client
        yield state


def _headers(institute: str = INST, token: bool = True) -> dict:
    h = {"clientId": institute}
    if token:
        h["Authorization"] = "Bearer t"
    return h


def _post(env, audio: bytes | None = None, *, mime: str = "audio/wav", language: str | None = None,
          headers: dict | None = None):
    files = {"file": ("recording", audio if audio is not None else wav_bytes(2.0), mime)}
    data = {"language": language} if language is not None else {}
    return env.client.post("/assistant/speech-to-text", files=files, data=data,
                           headers=headers if headers is not None else _headers())


# ── auth ─────────────────────────────────────────────────────────────────────

def test_without_a_token_it_is_refused(env):
    r = _post(env, headers=_headers(token=False))
    assert r.status_code == 401
    assert FakeProvider.calls == []


@pytest.mark.parametrize("roles", [["STUDENT"], ["LEARNER"], ["PARENT"]])
def test_a_learner_is_refused(env, roles):
    env.authorities = {INST: {"roles": roles, "permissions": []}}
    r = _post(env)
    assert r.status_code == 403
    assert FakeProvider.calls == []


def test_a_root_flagged_user_without_a_staff_role_is_refused(env):
    env.is_root = True
    env.authorities = {}
    r = _post(env)
    assert r.status_code == 403
    assert FakeProvider.calls == []


def test_another_institute_is_refused(env):
    r = _post(env, headers=_headers(OTHER_INST))
    assert r.status_code == 403
    assert FakeProvider.calls == []


def test_a_custom_staff_role_may_use_it(env):
    env.authorities = {INST: {"roles": ["Academic Coordinator"], "permissions": []}}
    assert _post(env).status_code == 200


# ── success: transcript returned, nothing sent ───────────────────────────────

def test_returns_the_transcript_and_sends_nothing(env):
    r = _post(env, wav_bytes(4.0))
    assert r.status_code == 200
    assert r.json() == {"transcript": SPOKEN, "language": "hi-IN", "duration_seconds": 4.0}
    assert FakeProvider.calls == [{"bytes": len(wav_bytes(4.0)), "language": "auto", "mime": "audio/wav"}]
    assert env.sent == []


def test_usage_is_recorded_for_the_pinned_institute(env):
    _post(env, wav_bytes(4.0))
    assert len(env.usage) == 1
    row = env.usage[0]
    assert row["institute_id"] == INST and row["user_id"] == USER
    assert row["seconds"] == pytest.approx(4.0)
    assert row["characters"] == len(SPOKEN)
    assert row["surface"] == "assistant"
    assert row["use_case"] == "vacademy_assistant"


@pytest.mark.parametrize("mime", ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus",
                                  "video/webm", "audio/mpeg"])
def test_browser_recordings_are_transcoded_first(env, mime):
    r = _post(env, b"\x1aE\xdf\xa3" + b"\x00" * 2000, mime=mime)
    assert r.status_code == 200, r.text
    assert env.transcoded == [stt.base_mime(mime)]
    assert FakeProvider.calls[0]["mime"] == "audio/wav"
    assert r.json()["duration_seconds"] == 3.0


@pytest.mark.parametrize("hint,sent", [("auto", "auto"), ("", "auto"), ("hi", "hi-IN"), ("en-in", "en-IN"),
                                       ("hi-IN", "hi-IN")])
def test_language_hint(env, hint, sent):
    r = _post(env, language=hint)
    assert r.status_code == 200
    assert FakeProvider.calls[0]["language"] == sent


def test_an_unsupported_language_is_refused(env):
    r = _post(env, language="xx-YY")
    assert r.status_code == 422
    assert FakeProvider.calls == []


def test_reports_the_hint_when_the_provider_names_no_language(env):
    FakeProvider.reply = SarvamTranscript("show pending fees", None)
    assert _post(env, language="en-IN").json()["language"] == "en-IN"
    FakeProvider.reply = SarvamTranscript("show pending fees", None)
    assert _post(env).json()["language"] is None


# ── limits ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("mime", ["text/plain", "application/json", "image/png", "application/octet-stream"])
def test_other_content_types_are_refused(env, mime):
    r = _post(env, b"hello", mime=mime)
    assert r.status_code == 415
    assert FakeProvider.calls == []


def test_an_oversized_upload_is_refused(env, monkeypatch):
    monkeypatch.setattr(assistant_router, "STT_MAX_UPLOAD_BYTES", 10_000)
    r = _post(env, wav_bytes(1.0))  # 32 kB
    assert r.status_code == 413
    assert FakeProvider.calls == []


def test_a_recording_over_the_duration_limit_is_refused(env, monkeypatch):
    monkeypatch.setattr(assistant_router, "STT_MAX_SECONDS", 5)
    r = _post(env, wav_bytes(5.0 + stt.DURATION_GRACE_SECONDS + 1))
    assert r.status_code == 413
    assert "2 minutes" in r.json()["detail"]
    assert FakeProvider.calls == []
    assert env.usage == []


def test_a_recording_just_at_the_limit_is_accepted(env, monkeypatch):
    monkeypatch.setattr(assistant_router, "STT_MAX_SECONDS", 5)
    assert _post(env, wav_bytes(5.5)).status_code == 200


def test_the_default_limit_is_two_minutes():
    assert assistant_router.STT_MAX_SECONDS == 120
    assert assistant_router.STT_MAX_UPLOAD_BYTES >= 4 * 1024 * 1024


def test_an_empty_upload_is_refused(env):
    assert _post(env, b"").status_code == 400
    assert FakeProvider.calls == []


def test_it_is_rate_limited_per_user(env):
    codes = [_post(env).status_code for _ in range(chat_auth._RATE_MAX + 1)]
    assert codes[:-1] == [200] * chat_auth._RATE_MAX
    assert codes[-1] == 429


# ── no speech / provider failure ─────────────────────────────────────────────

def test_no_speech_is_a_422(env):
    FakeProvider.reply = SarvamTranscript("   ", None)
    r = _post(env)
    assert r.status_code == 422
    assert "speech" in r.json()["detail"].lower()
    # The provider was called, so its use is still recorded.
    assert len(env.usage) == 1


def test_a_clip_too_short_for_a_word_skips_the_provider(env):
    r = _post(env, wav_bytes(0.2))
    assert r.status_code == 422
    assert FakeProvider.calls == []
    assert env.usage == []


def test_a_provider_failure_is_a_502_with_a_plain_message(env):
    FakeProvider.error = SarvamSTTError("Sarvam STT HTTP 500: upstream body", status=500)
    r = _post(env)
    assert r.status_code == 502
    detail = r.json()["detail"]
    assert "Sarvam" not in detail and "upstream" not in detail
    assert "try again" in detail.lower()
    assert env.usage == []


# ── logging ──────────────────────────────────────────────────────────────────

def test_the_transcript_never_reaches_the_logs(env, caplog):
    caplog.set_level(logging.DEBUG)
    assert _post(env).status_code == 200
    FakeProvider.reply = SarvamTranscript("", None)
    assert _post(env).status_code == 422
    FakeProvider.error = SarvamSTTError("failed", status=503)
    assert _post(env).status_code == 502
    assert SPOKEN not in caplog.text
    assert "kitne" not in caplog.text
    # Sizes are logged.
    assert "assistant stt" in caplog.text


# ── shared service ───────────────────────────────────────────────────────────

def test_normalize_language():
    assert stt.normalize_language(None) == "auto"
    assert stt.normalize_language("AUTO") == "auto"
    assert stt.normalize_language("hi") == "hi-IN"
    assert stt.normalize_language("or") == "od-IN"
    assert stt.normalize_language("ta-in") == "ta-IN"
    with pytest.raises(stt.UnsupportedLanguageError):
        stt.normalize_language("fr-FR")


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200
        self.text = ""

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeHttpClient:
    """httpx.AsyncClient stand-in: answers each STT request from a queue."""

    payloads: list = []
    requests: list = []

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, files=None, data=None):
        _FakeHttpClient.requests.append({"url": url, "data": dict(data or {}), "bytes": len(files["file"][1])})
        return _FakeResponse(_FakeHttpClient.payloads.pop(0))


@pytest.fixture()
def fake_http(monkeypatch):
    _FakeHttpClient.payloads = []
    _FakeHttpClient.requests = []
    monkeypatch.setattr(sarvam_service.httpx, "AsyncClient", _FakeHttpClient)
    return _FakeHttpClient


async def test_provider_transcribe_reports_the_detected_language(fake_http):
    fake_http.payloads = [{"transcript": "hello", "language_code": "en-IN"}]
    result = await SarvamService().transcribe(wav_bytes(2.0))
    assert result == SarvamTranscript("hello", "en-IN")
    assert "language_code" not in fake_http.requests[0]["data"]


async def test_provider_speech_to_text_still_returns_text(fake_http):
    fake_http.payloads = [{"transcript": "namaste", "language_code": "hi-IN"}]
    assert await SarvamService().speech_to_text(wav_bytes(2.0), language="hi-IN") == "namaste"
    assert fake_http.requests[0]["data"]["language_code"] == "hi-IN"


async def test_provider_splits_long_audio_and_keeps_the_first_language(fake_http):
    fake_http.payloads = [
        {"transcript": "first part", "language_code": "hi-IN"},
        {"transcript": "second part", "language_code": "en-IN"},
        {"transcript": "", "language_code": None},
    ]
    result = await SarvamService().transcribe(wav_bytes(65.0))
    assert len(fake_http.requests) == 3
    assert result == SarvamTranscript("first part second part", "hi-IN")


async def test_transcribe_audio_passes_wav_through(monkeypatch):
    seen = {}

    class Provider:
        async def transcribe(self, audio_bytes, language="auto", mime_type="audio/wav"):
            seen.update(bytes=len(audio_bytes), language=language, mime=mime_type)
            return SarvamTranscript("ok", "en-IN")

    audio = wav_bytes(1.5)
    result = await stt.transcribe_audio(audio, "audio/wav", language="en-IN", stt=Provider())
    assert result.transcript == "ok" and result.language == "en-IN"
    assert result.duration_seconds == pytest.approx(1.5)
    assert result.provider_called and result.transcode_note == "wav_passthrough"
    assert seen == {"bytes": len(audio), "language": "en-IN", "mime": "audio/wav"}


async def test_transcribe_audio_without_ffmpeg_still_tries_the_provider(monkeypatch):
    """Where ffmpeg is missing the original bytes go to the provider unchanged."""

    async def no_ffmpeg(audio, mime):
        return audio, mime, "transcode_failed:no_ffmpeg"

    monkeypatch.setattr(audio_utils, "transcode_to_wav", no_ffmpeg)
    seen = {}

    class Provider:
        async def transcribe(self, audio_bytes, language="auto", mime_type="audio/wav"):
            seen.update(mime=mime_type)
            return SarvamTranscript("ok", None)

    result = await stt.transcribe_audio(b"\x1aE\xdf\xa3" * 100, "audio/webm", max_seconds=120,
                                        min_speech_wav_bytes=stt.MIN_SPEECH_WAV_BYTES, stt=Provider())
    assert result.transcript == "ok" and result.duration_seconds is None
    assert seen == {"mime": "audio/webm"}


def test_usage_row_is_record_only_and_bundled(monkeypatch):
    """A usage row with the vendor cost; no credit deduction, never counted against a limit."""
    import contextlib

    import app.db as db_module
    import app.services.token_usage_service as tus_module
    from app.models.ai_token_usage import RequestType

    rows, deducted = [], []

    class FakeTUS:
        def __init__(self, db):
            pass

        def record_usage(self, api_provider, prompt_tokens, completion_tokens, total_tokens, request_type,
                         institute_id=None, user_id=None, model=None, metadata=None, total_price=None,
                         tts_provider=None, character_count=None, *, use_case=None, free_reason=None,
                         surface=None, **_kw):
            rows.append(dict(request_type=request_type, institute_id=institute_id, user_id=user_id, model=model,
                             metadata=metadata, total_price=total_price, character_count=character_count,
                             use_case=use_case, free_reason=free_reason, surface=surface))

        def record_usage_and_deduct_credits(self, *a, **kw):  # pragma: no cover - must not be called
            deducted.append(kw)

    monkeypatch.setattr(db_module, "db_session", lambda: contextlib.nullcontext(object()))
    monkeypatch.setattr(tus_module, "TokenUsageService", FakeTUS)
    stt.record_stt_usage(institute_id=INST, user_id=USER, seconds=60.0, characters=12, language="hi-IN",
                         surface="assistant", use_case="vacademy_assistant", actor_roles=["ADMIN"])
    assert deducted == []
    assert len(rows) == 1
    row = rows[0]
    assert row["request_type"] == RequestType.TRANSCRIPTION
    assert (row["institute_id"], row["user_id"], row["model"]) == (INST, USER, "sarvam:saaras-v3")
    assert row["metadata"] == {"surface": "assistant", "language": "hi-IN", "seconds": 60.0}
    assert row["total_price"] == pytest.approx(0.36 / 60)
    assert row["character_count"] == 12
    assert row["use_case"] == "vacademy_assistant" and row["free_reason"] == "BUNDLED"
    assert row["surface"] == "ADMIN_APP"


def test_usage_recording_never_raises(monkeypatch):
    import app.db as db_module

    def broken():
        raise RuntimeError("no database")

    monkeypatch.setattr(db_module, "db_session", broken)
    stt.record_stt_usage(institute_id=INST, user_id=USER, seconds=None, characters=0, language=None,
                         surface="assistant", use_case="vacademy_assistant")


# ── the learner voice-note endpoint keeps its contract ───────────────────────

@pytest.fixture()
def learner_env(monkeypatch):
    from app.dependencies import get_chat_agent_service
    from app.routers import chat_agent

    state = SimpleNamespace(sent=[])

    class FakeChatService:
        def get_session_identity(self, session_id):
            return {"user_id": "learner-1", "institute_id": INST} if session_id == "s1" else None

        async def send_message(self, session_id, message, caller_verified=False):
            state.sent.append((session_id, message, caller_verified))
            return 42, "processing"

    monkeypatch.setattr(chat_auth, "_rate_hits", {})
    FakeProvider.calls = []
    FakeProvider.reply = SarvamTranscript(SPOKEN, "hi-IN")
    FakeProvider.error = None
    monkeypatch.setattr(chat_agent, "SarvamService", FakeProvider)

    app = FastAPI()
    app.include_router(chat_agent.router)
    app.dependency_overrides[get_chat_agent_service] = lambda: FakeChatService()
    app.dependency_overrides[chat_auth.get_chat_caller] = lambda: chat_auth.ChatCaller(
        user_id="learner-1", institute_ids=frozenset({INST}))
    with TestClient(app) as client:
        state.client = client
        state.prefix = chat_agent.router.prefix
        yield state


def _learner_post(env, audio=None, **data):
    return env.client.post(
        f"{env.prefix}/session/s1/audio-message",
        files={"file": ("recording.webm", audio if audio is not None else wav_bytes(2.0), "audio/wav")},
        data=data,
    )


def test_learner_voice_note_returns_the_transcript_without_sending(learner_env):
    r = _learner_post(learner_env)
    assert r.status_code == 200
    assert r.json() == {"transcript": SPOKEN, "message_id": None, "status": "idle"}
    assert learner_env.sent == []
    assert FakeProvider.calls[0]["language"] == "auto"


def test_learner_voice_note_auto_send_still_sends(learner_env):
    r = _learner_post(learner_env, auto_send="true", language="hi-IN")
    assert r.json() == {"transcript": SPOKEN, "message_id": 42, "status": "processing"}
    assert learner_env.sent == [("s1", SPOKEN, True)]
    assert FakeProvider.calls[0]["language"] == "hi-IN"


def test_learner_voice_note_errors_are_unchanged(learner_env):
    assert _learner_post(learner_env, audio=b"").status_code == 400
    FakeProvider.reply = SarvamTranscript("", None)
    r = _learner_post(learner_env)
    assert r.status_code == 422 and "no speech detected" in r.json()["detail"]
    FakeProvider.error = SarvamSTTError("Sarvam STT HTTP 400: bad", status=400)
    r = _learner_post(learner_env)
    assert r.status_code == 502 and r.json()["detail"].startswith("Speech recognition failed:")
