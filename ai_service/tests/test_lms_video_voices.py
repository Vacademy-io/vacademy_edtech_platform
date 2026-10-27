"""LMS AI Video narration voices: the picker catalogue (/voices), cached
previews, the institute default voice (admins only; applied in estimate and
generate), tts_provider plumbing, Smallest / Navana in the pipeline and the
vendor rates the estimate and billing use.

No DB and no network: vendors, S3 and settings storage are faked.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import types
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest

AI_SERVICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AI_SERVICE))

try:  # the routers import s3_service → boto3; stub it where it isn't installed
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover - depends on the test venv
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.constants.ai_video_policy import AI_VIDEO_DEFAULTS_KEY, AI_VIDEO_POLICY_KEY  # noqa: E402
from app.core.security import get_pinned_principal  # noqa: E402
from app.db import db_dependency  # noqa: E402
from app.routers import external_video_generation as ext  # noqa: E402
from app.routers import lms_video as lms  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.schemas.credits import CreditCheckResponse  # noqa: E402
from app.services import ai_video_policy_service as policy_svc  # noqa: E402
from app.services import lms_voice_catalog as cat  # noqa: E402
from app.services import provider_rates, rest_tts  # noqa: E402
from app.services import video_generation_service as vgs  # noqa: E402

INST = "11111111-1111-1111-1111-111111111111"
USER = "user-1"
PREFIX = lms.router.prefix
RATIO = 150.0

SMALLEST_CATALOGUE = [
    {"id": "nirupma", "name": "Nirupma", "gender": "female", "languages": ["english", "hindi", "tamil"],
     "accent": "indian"},
    {"id": "kaustubh", "name": "Kaustubh", "gender": "male", "languages": ["english", "hindi"], "accent": "indian"},
    {"id": "emily", "name": "Emily", "gender": "female", "languages": ["english", "spanish"], "accent": "american"},
    {"id": "pablo", "name": "Pablo", "gender": "male", "languages": ["spanish"], "accent": "mexican-latin-american"},
]

ESTIMATE_RESULT = {
    "selections": {},
    "estimate": {
        "expected_credits": 40.0, "low_credits": 30.0, "high_credits": 55.0,
        "breakdown": [{"component": "LLM — per-shot generation", "detail": "x", "cost_usd": 0.1, "credits": 30.0},
                      {"component": "TTS (sarvam)", "detail": "y", "cost_usd": 0.03, "credits": 5.0}],
    },
    "balance": {"current": 500.0},
}


class FakeCredits:
    def __init__(self, db):
        pass

    def check_video_tier_credits(self, **kw):
        return CreditCheckResponse(has_sufficient_credits=True, current_balance=Decimal("500"),
                                   estimated_cost=Decimal("40"), balance_after=Decimal("460"), message="ok")


class FakeS3:
    """The S3Service surface the preview cache uses."""

    def __init__(self):
        self.objects = {}
        self.public_bucket = "bucket"
        outer = self

        class _Client:
            def get_object(self, Bucket, Key):
                if Key not in outer.objects:
                    raise KeyError("NoSuchKey")
                return {"Body": SimpleNamespace(read=lambda: outer.objects[Key])}

        self.s3_client = _Client()

    def upload_file_content(self, content, filename, s3_key=None, content_type=None):
        assert content_type == "audio/mpeg"
        self.objects[s3_key] = content
        return f"https://cdn/{s3_key}"


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "s")
    monkeypatch.setenv("SMALLEST_API_KEY", "m")
    monkeypatch.delenv("NAVANA_API_KEY", raising=False)
    monkeypatch.delenv("BODHI_API_KEY", raising=False)

    async def fake_catalogue():
        return [dict(v) for v in SMALLEST_CATALOGUE]
    monkeypatch.setattr(cat, "_smallest_catalogue", fake_catalogue)
    monkeypatch.setattr(cat, "usd_to_credit_ratio", lambda db: RATIO)


@pytest.fixture
def env(monkeypatch, keys):
    state = SimpleNamespace(roles=["TEACHER"], default=None, estimates=[], started=[], blob={},
                            synth=[], s3=FakeS3())
    monkeypatch.setattr(cat, "load_default", lambda db, inst: state.default)
    monkeypatch.setattr(lms.policy_svc, "load_policy", lambda db, inst: (policy_svc.normalize_policy(None), True))
    monkeypatch.setattr(lms, "_usage_numbers", lambda db, inst: (0.0, 0))

    def fake_estimate(db, inst, req):
        state.estimates.append(req)
        return ESTIMATE_RESULT
    monkeypatch.setattr(lms, "_estimate", fake_estimate)
    import app.services.credit_service as cs_mod
    monkeypatch.setattr(cs_mod, "CreditService", FakeCredits)

    def fake_start(payload, video_id, target_stage, institute_id, **kw):
        state.started.append(payload)

        async def _sim():
            await kw["on_event"]({"type": "progress", "stage": "PENDING", "video_id": video_id})
        asyncio.get_running_loop().create_task(_sim())
        return kw.get("queue")
    monkeypatch.setattr(ext, "start_video_generation", fake_start)
    monkeypatch.setattr(lms, "_merge_metadata", lambda vid, extra: True)

    # institutes.setting_json, held in memory
    monkeypatch.setattr(policy_svc, "_lock_settings", lambda db, inst: json.loads(json.dumps(state.blob)))
    monkeypatch.setattr(policy_svc, "_write_settings", lambda db, inst, blob: setattr(state, "blob", blob))

    # previews
    monkeypatch.setattr(cat, "_s3", lambda: state.s3)

    def fake_synth(provider, text, language, voice_id, pace=1.0):
        state.synth.append((provider, text, language, voice_id))
        return b"ID3" + f"{provider}:{voice_id}".encode()
    monkeypatch.setattr(rest_tts, "synthesize_mp3", fake_synth)
    cat._preview_hits.clear()

    app = FastAPI()
    app.include_router(lms.router)
    app.dependency_overrides[get_pinned_principal] = lambda: PinnedPrincipal(
        user_id=USER, institute_id=INST, roles=state.roles, is_root_user=False)
    app.dependency_overrides[db_dependency] = lambda: SimpleNamespace(rollback=lambda: None, commit=lambda: None)
    with TestClient(app) as client:
        state.client = client
        yield state


def _body(**over):
    b = {"topic": "Photosynthesis", "format": "board_explainer", "duration": "2-3 minutes", "quality": "standard"}
    b.update(over)
    return b


def _providers(r):
    return {p["id"]: p for p in r.json()["providers"]}


# ── GET /voices ──────────────────────────────────────────────────────────────

def test_voices_shape_order_and_availability(env):
    r = env.client.get(PREFIX + "/voices", params={"language": "English"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"language", "providers", "default", "can_set_default"}
    assert body["language"] == "English" and body["default"] is None and body["can_set_default"] is False
    assert [p["id"] for p in body["providers"]] == ["edge", "sarvam", "smallest", "navana"]
    for p in body["providers"]:
        assert set(p) == {"id", "label", "description", "available", "unavailable_reason", "credits_per_minute",
                          "voices"}
        for v in p["voices"]:
            assert set(v) == {"id", "name", "gender", "accent", "sample_url"}
            assert v["gender"] in ("female", "male", None)
    ps = _providers(r)
    assert ps["edge"]["available"] and ps["sarvam"]["available"] and ps["smallest"]["available"]
    assert ps["navana"]["available"] is False and ps["navana"]["voices"] == []
    assert "set up" in ps["navana"]["unavailable_reason"]
    assert ps["edge"]["unavailable_reason"] is None


def test_credits_per_minute_is_vendor_rate_times_600_chars_times_ratio(env):
    ps = _providers(env.client.get(PREFIX + "/voices"))
    for pid in ("edge", "sarvam", "smallest", "navana"):
        want = round(provider_rates.TTS_USD_PER_1K_CHARS[pid] * 0.6 * RATIO, 1)
        assert ps[pid]["credits_per_minute"] == want
    assert ps["edge"]["credits_per_minute"] == 0
    assert ps["sarvam"]["credits_per_minute"] == 3.2          # $0.036/1K × 0.6 × 150
    assert ps["navana"]["credits_per_minute"] == 1.3          # ₹12/10K = $0.0144/1K


def test_bare_english_lists_indian_us_and_uk_edge_voices(env):
    ps = _providers(env.client.get(PREFIX + "/voices", params={"language": "English"}))
    edge = ps["edge"]["voices"]
    ids = [v["id"] for v in edge]
    assert ids[:2] == ["en-IN-NeerjaNeural", "en-IN-PrabhatNeural"]          # Indian first
    assert {"en-US-AriaNeural", "en-GB-SoniaNeural"} <= set(ids)
    accents = {v["accent"] for v in edge}
    assert {"Indian", "American", "British"} <= accents
    neerja = edge[0]
    assert neerja["name"] == "Neerja" and neerja["gender"] == "female" and neerja["sample_url"].startswith("https://")
    # Smallest: English voices only, Indian accent first
    sm = [v["id"] for v in ps["smallest"]["voices"]]
    assert sm == ["kaustubh", "nirupma", "emily"]
    # Sarvam: bulbul:v3 speakers only (amelia / sophia are v2)
    sv = {v["id"] for v in ps["sarvam"]["voices"]}
    assert "ritu" in sv and "shubh" in sv and "amelia" not in sv and "sophia" not in sv


def test_language_filters_voices(env, monkeypatch):
    ps = _providers(env.client.get(PREFIX + "/voices", params={"language": "Hindi"}))
    assert {v["id"] for v in ps["edge"]["voices"]} == {"hi-IN-SwaraNeural", "hi-IN-MadhurNeural"}
    assert {v["id"] for v in ps["smallest"]["voices"]} == {"nirupma", "kaustubh"}
    assert ps["sarvam"]["available"]

    ps = _providers(env.client.get(PREFIX + "/voices", params={"language": "English (India)"}))
    assert {v["id"] for v in ps["edge"]["voices"]} == {"en-IN-NeerjaNeural", "en-IN-PrabhatNeural"}

    monkeypatch.setenv("NAVANA_API_KEY", "k1,k2")
    ps = _providers(env.client.get(PREFIX + "/voices", params={"language": "French"}))
    assert ps["edge"]["available"] and ps["edge"]["voices"][0]["id"].startswith("fr-")
    assert ps["sarvam"]["available"] is False and "French" in ps["sarvam"]["unavailable_reason"]
    assert ps["navana"]["available"] is False and ps["navana"]["voices"] == []
    assert ps["smallest"]["available"] is False                # no French voice in the (fake) catalogue

    ps = _providers(env.client.get(PREFIX + "/voices", params={"language": "Tamil"}))
    assert ps["navana"]["available"] and len(ps["navana"]["voices"]) == 55
    assert [v["id"] for v in ps["smallest"]["voices"]] == ["nirupma"]


def test_voices_reports_the_default_and_admin_flag(env):
    env.roles = ["ADMIN"]
    env.default = {"tts_provider": "sarvam", "voice_id": "ritu", "voice_gender": "female"}
    body = env.client.get(PREFIX + "/voices").json()
    assert body["can_set_default"] is True and body["default"] == env.default


def test_learners_cannot_list_voices(env):
    env.roles = ["STUDENT"]
    assert env.client.get(PREFIX + "/voices").status_code == 403


# ── POST /voices/preview ─────────────────────────────────────────────────────

def test_preview_renders_once_then_serves_the_cached_bytes(env):
    body = {"tts_provider": "smallest", "voice_id": "nirupma", "language": "English"}
    r1 = env.client.post(PREFIX + "/voices/preview", json=body)
    assert r1.status_code == 200, r1.text
    assert r1.headers["content-type"] == "audio/mpeg" and r1.headers["x-preview-cache"] == "miss"
    assert r1.content == b"ID3smallest:nirupma"
    (call,) = env.synth
    assert call == ("smallest", cat.SAMPLE_TEXT["english"], "English", "nirupma")
    key = cat.preview_key("smallest", "nirupma", "English", cat.SAMPLE_TEXT["english"])
    assert key.startswith("ai-videos/voice-previews/") and key.endswith(".mp3")
    assert env.s3.objects == {key: b"ID3smallest:nirupma"}

    r2 = env.client.post(PREFIX + "/voices/preview", json=body)
    assert r2.status_code == 200 and r2.headers["x-preview-cache"] == "hit"
    assert r2.content == r1.content and len(env.synth) == 1          # vendor not called again


def test_preview_key_covers_provider_voice_language_and_text():
    k = cat.preview_key("sarvam", "ritu", "Hindi", "a")
    assert k != cat.preview_key("sarvam", "ritu", "Hindi", "b")
    assert k != cat.preview_key("sarvam", "priya", "Hindi", "a")
    assert k != cat.preview_key("sarvam", "ritu", "Tamil", "a")
    assert k != cat.preview_key("smallest", "ritu", "Hindi", "a")
    assert k == cat.preview_key("sarvam", "ritu", " hindi ", "a")    # language is case-insensitive


def test_preview_uses_the_language_sample_or_the_callers_text(env):
    env.client.post(PREFIX + "/voices/preview", json={"tts_provider": "sarvam", "voice_id": "Ritu", "language": "Hindi"})
    assert env.synth[-1] == ("sarvam", cat.SAMPLE_TEXT["hindi"], "Hindi", "ritu")
    env.client.post(PREFIX + "/voices/preview", json={"tts_provider": "edge", "voice_id": "hi-IN-SwaraNeural",
                                                      "language": "Hindi", "text": "Namaste"})
    assert env.synth[-1] == ("edge", "Namaste", "Hindi", "hi-IN-SwaraNeural")


@pytest.mark.parametrize("body, status_, code", [
    ({"tts_provider": "sarvam", "voice_id": "nirupma"}, 422, "INVALID_VOICE"),            # not a Sarvam voice
    ({"tts_provider": "navana", "voice_id": "bhavana"}, 422, "VOICE_UNAVAILABLE"),          # no key here
    ({"tts_provider": "edge", "voice_id": "hi-IN-SwaraNeural", "language": "French"}, 422, "VOICE_UNAVAILABLE"),
    ({"tts_provider": "smallest", "voice_id": "pablo", "language": "English"}, 422, "VOICE_UNAVAILABLE"),
    ({"tts_provider": "google", "voice_id": "x"}, 422, None),                               # not offered
    ({"tts_provider": "edge", "voice_id": "en-IN-NeerjaNeural", "text": "x" * 201}, 422, None),
])
def test_preview_rejects_what_cannot_be_played(env, body, status_, code):
    r = env.client.post(PREFIX + "/voices/preview", json=body)
    assert r.status_code == status_
    if code:
        assert r.json()["code"] == code
    assert env.synth == []


def test_preview_is_rate_limited_per_institute_but_cache_hits_are_free(env, monkeypatch):
    monkeypatch.setattr(cat, "PREVIEW_RATE_LIMIT", 2)
    for text in ("one", "two"):
        assert env.client.post(PREFIX + "/voices/preview", json={
            "tts_provider": "edge", "voice_id": "en-IN-NeerjaNeural", "text": text}).status_code == 200
    r = env.client.post(PREFIX + "/voices/preview", json={
        "tts_provider": "edge", "voice_id": "en-IN-NeerjaNeural", "text": "three"})
    assert r.status_code == 429 and r.json()["code"] == "RATE_LIMITED"
    again = env.client.post(PREFIX + "/voices/preview", json={
        "tts_provider": "edge", "voice_id": "en-IN-NeerjaNeural", "text": "one"})
    assert again.status_code == 200 and again.headers["x-preview-cache"] == "hit"


def test_preview_vendor_failure_is_a_502_not_a_crash(env, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("vendor down")
    monkeypatch.setattr(rest_tts, "synthesize_mp3", boom)
    r = env.client.post(PREFIX + "/voices/preview", json={"tts_provider": "sarvam", "voice_id": "ritu"})
    assert r.status_code == 502 and r.json()["code"] == "PREVIEW_FAILED"
    assert env.s3.objects == {}


# ── PUT / DELETE /voices/default ─────────────────────────────────────────────

def test_only_admins_set_or_clear_the_default(env):
    env.roles = ["TEACHER"]
    assert env.client.put(PREFIX + "/voices/default", json={"tts_provider": "sarvam", "voice_id": "ritu"}).status_code == 403
    assert env.client.delete(PREFIX + "/voices/default").status_code == 403
    assert env.blob == {}


@pytest.mark.parametrize("role", ["ADMIN", "ADMIN_NON_ROOT", "SUPER_ADMIN"])
def test_admin_sets_the_default_under_its_own_key(env, role):
    env.roles = [role]
    env.blob = {"setting": {AI_VIDEO_POLICY_KEY: {"key": AI_VIDEO_POLICY_KEY, "name": "x", "data": {"enabled": True}}}}
    r = env.client.put(PREFIX + "/voices/default", json={"tts_provider": "smallest", "voice_id": "kaustubh"})
    assert r.status_code == 200, r.text
    assert r.json()["default"] == {"tts_provider": "smallest", "voice_id": "kaustubh", "voice_gender": "male"}
    saved = env.blob["setting"][AI_VIDEO_DEFAULTS_KEY]
    assert saved["key"] == AI_VIDEO_DEFAULTS_KEY
    assert saved["data"]["tts_provider"] == "smallest" and saved["data"]["voice_id"] == "kaustubh"
    assert saved["data"]["voice_gender"] == "male" and saved["data"]["updated_by"] == USER
    # the super-admin policy is untouched
    assert env.blob["setting"][AI_VIDEO_POLICY_KEY]["data"] == {"enabled": True}


def test_default_validates_provider_and_voice(env, monkeypatch):
    env.roles = ["ADMIN"]
    r = env.client.put(PREFIX + "/voices/default", json={"tts_provider": "edge", "voice_id": "ritu"})
    assert r.status_code == 422 and r.json()["code"] == "INVALID_VOICE"
    r = env.client.put(PREFIX + "/voices/default", json={"tts_provider": "navana", "voice_id": "bhavana"})
    assert r.status_code == 422 and r.json()["code"] == "VOICE_UNAVAILABLE"
    assert env.client.put(PREFIX + "/voices/default", json={"tts_provider": "google", "voice_id": "x"}).status_code == 422
    monkeypatch.setenv("NAVANA_API_KEY", "k")
    r = env.client.put(PREFIX + "/voices/default", json={"tts_provider": "navana", "voice_id": "Bhavana",
                                                         "voice_gender": "female"})
    assert r.status_code == 200 and r.json()["default"]["voice_id"] == "bhavana"


def test_admin_clears_the_default(env):
    env.roles = ["ADMIN"]
    env.client.put(PREFIX + "/voices/default", json={"tts_provider": "sarvam", "voice_id": "ritu"})
    assert AI_VIDEO_DEFAULTS_KEY in env.blob["setting"]
    r = env.client.delete(PREFIX + "/voices/default")
    assert r.status_code == 200 and r.json() == {"default": None, "removed": True}
    assert AI_VIDEO_DEFAULTS_KEY not in env.blob["setting"]


def test_load_default_reads_the_setting(monkeypatch):
    monkeypatch.setattr(cat, "load_institute_setting_data",
                        lambda db, inst, key: {"tts_provider": "Sarvam", "voice_id": "ritu", "voice_gender": "x"}
                        if key == AI_VIDEO_DEFAULTS_KEY else None)
    assert cat.load_default(None, INST) == {"tts_provider": "sarvam", "voice_id": "ritu", "voice_gender": None}
    monkeypatch.setattr(cat, "load_institute_setting_data", lambda db, inst, key: {"tts_provider": "google"})
    assert cat.load_default(None, INST) is None


# ── the default in estimate / generate; tts_provider plumbing ────────────────

def test_estimate_applies_the_institute_default(env):
    env.default = {"tts_provider": "sarvam", "voice_id": "ritu", "voice_gender": "female"}
    r = env.client.post(PREFIX + "/estimate", json=_body())
    assert r.status_code == 200, r.text
    req = env.estimates[-1]
    assert req.tts_provider == "sarvam" and req.voice_id == "ritu" and req.voice_gender == "female"
    rows = r.json()["estimate"]["rows"]
    assert rows[-1] == {"label": "Narration (Sarvam)", "credits": 5.0}


def test_generate_applies_the_institute_default(env):
    env.default = {"tts_provider": "smallest", "voice_id": "kaustubh", "voice_gender": "male"}
    r = env.client.post(PREFIX + "/generate", json=_body(voice_gender="female"))
    assert r.status_code == 200, r.text
    started = env.started[-1]
    assert started.tts_provider == "smallest" and started.voice_id == "kaustubh"
    assert started.voice_gender == "male"                       # the default voice's own gender
    assert env.estimates[-1].tts_provider == "smallest"


def test_an_explicit_choice_beats_the_default(env):
    env.default = {"tts_provider": "sarvam", "voice_id": "ritu", "voice_gender": "female"}
    env.client.post(PREFIX + "/generate", json=_body(tts_provider="edge", voice_id="en-GB-RyanNeural"))
    assert (env.started[-1].tts_provider, env.started[-1].voice_id) == ("edge", "en-GB-RyanNeural")
    # a voice alone (no engine) keeps today's inference and skips the default
    env.client.post(PREFIX + "/generate", json=_body(voice_id="en-IN-NeerjaNeural"))
    assert (env.started[-1].tts_provider, env.started[-1].voice_id) == ("standard", "en-IN-NeerjaNeural")
    # an engine alone uses that engine's default voice in the pipeline
    env.client.post(PREFIX + "/generate", json=_body(tts_provider="smallest"))
    assert (env.started[-1].tts_provider, env.started[-1].voice_id) == ("smallest", None)


def test_a_default_on_an_unconfigured_engine_is_ignored(env):
    env.default = {"tts_provider": "navana", "voice_id": "bhavana", "voice_gender": "female"}
    env.client.post(PREFIX + "/generate", json=_body(quality="premium"))
    assert env.started[-1].tts_provider == "premium" and env.started[-1].voice_id is None


def test_a_default_that_cannot_speak_the_language_is_skipped(env):
    env.default = {"tts_provider": "sarvam", "voice_id": "ritu", "voice_gender": "female"}
    r = env.client.post(PREFIX + "/generate", json=_body(language="French"))
    assert r.status_code == 200, r.text
    assert env.started[-1].tts_provider == "standard" and env.started[-1].voice_id is None


def test_a_picked_voice_id_is_canonicalised(env):
    env.client.post(PREFIX + "/generate", json=_body(tts_provider="sarvam", voice_id="Ritu"))
    assert (env.started[-1].tts_provider, env.started[-1].voice_id) == ("sarvam", "ritu")


def test_generate_refuses_a_voice_the_engine_cannot_use(env):
    r = env.client.post(PREFIX + "/generate", json=_body(tts_provider="navana", voice_id="bhavana"))
    assert r.status_code == 422 and r.json()["code"] == "VOICE_UNAVAILABLE"
    r = env.client.post(PREFIX + "/estimate", json=_body(tts_provider="sarvam", voice_id="en-IN-NeerjaNeural"))
    assert r.status_code == 422 and r.json()["code"] == "INVALID_VOICE"
    assert not env.started


def test_tts_provider_reaches_the_video_request_and_estimate_params():
    req = lms.LmsVideoRequest(**_body(tts_provider="navana", voice_id="bhavana"))
    assert lms._tts_provider(req) == "navana"
    plan = lms.resolve_format(req)
    vr = lms.build_video_request(req, plan, "p", video_id="v", institute_id=INST, user_id=USER)
    assert vr.tts_provider == "navana" and vr.voice_id == "bhavana"
    params = lms.estimate_params_for(vr)
    assert params["tts_provider"] == "navana" and params["voice_id"] == "bhavana"
    with pytest.raises(Exception):
        lms.LmsVideoRequest(**_body(tts_provider="google"))


@pytest.mark.parametrize("vendor, label", [("edge", "Free voice"), ("sarvam", "Sarvam"), ("smallest", "Smallest"),
                                           ("navana", "Navana"), ("google", "Google")])
def test_estimate_row_is_labelled_with_the_engine(vendor, label):
    req = lms.LmsVideoRequest(**_body(tts_provider=vendor if vendor != "google" else None, quality="premium"))
    plan = lms.resolve_format(req)
    vr = lms.build_video_request(req, plan, "p", video_id="v", institute_id=INST, user_id=USER)
    view = lms._estimate_view(ESTIMATE_RESULT, vr)
    assert view["rows"][-1]["label"] == f"Narration ({label})"
    assert view["rows"][0]["label"] == "LLM — per-shot generation"


# ── estimator + billing vendors ──────────────────────────────────────────────

def test_estimator_prices_the_chosen_engine():
    from app.services import video_estimation_service as est

    assert est._resolve_tts_provider("smallest", "English") == "smallest"
    assert est._resolve_tts_provider("navana", "Hindi") == "navana"
    assert est._resolve_tts_provider("edge", "Hindi") == "edge"
    assert est._resolve_tts_provider("premium", "Hindi") == "sarvam"
    assert provider_rates.tts_cost_usd("navana", 10_000) == pytest.approx(0.144)   # ₹12 at ₹83.3/$
    assert provider_rates.TTS_USD_PER_1K_CHARS["sarvam"] / provider_rates.TTS_USD_PER_1K_CHARS["navana"] == \
        pytest.approx(30 / 12)


def test_estimate_breakdown_charges_navana_at_its_rate(monkeypatch):
    from app.constants.model_defaults import GLM_DEFAULT
    from app.services import credit_service as cs_mod
    from app.services import video_estimation_service as est
    from app.services.credit_service import CreditService

    monkeypatch.setattr(est, "_resolve_stage_models", lambda db, tier, model: (GLM_DEFAULT, GLM_DEFAULT))
    monkeypatch.setattr(est, "_get_llm_pricing", lambda db, m: (0.027, 0.49, False))
    monkeypatch.setattr(est, "_get_image_unit_price", lambda db, m=est._VIDEO_IMAGE_MODEL_ID: 0.04)
    monkeypatch.setattr(est, "_get_video_second_price", lambda db, m: None)
    monkeypatch.setattr(CreditService, "_effective_usd_to_credit_ratio", lambda self: Decimal("150"))
    monkeypatch.setattr(CreditService, "_get_pricing", lambda self, rt: cs_mod.DEFAULT_PRICING.get(
        rt, cs_mod.DEFAULT_PRICING["content"]))
    result = est.estimate_video_generation(None, quality_tier="standard", target_duration="2-3 minutes",
                                           tts_provider="navana", language="Hindi")
    row = next(r for r in result["estimate"]["breakdown"] if r["component"].startswith("TTS ("))
    assert "navana" in row["detail"]
    assert row["credits"] == pytest.approx(provider_rates.tts_cost_usd("navana", 1500) * 150, abs=0.01)


class _Ledger:
    def __init__(self):
        self.deducted, self.recorded = [], []

    def record_usage_and_deduct_credits(self, **kw):
        self.deducted.append(kw)

    def record_usage(self, **kw):
        self.recorded.append(kw)


def _bill(tts_provider, resolved):
    ts = _Ledger()
    vgs._bill_video_stage_usage(
        ts, usage={"tts_character_count": 1000}, cost_breakdown=None,
        usd_to_credits=lambda usd: (Decimal(str(usd)) * 150).quantize(Decimal("0.0001")),
        image_unit_usd=lambda m: 0.04, institute_id=INST, user_id=None, video_id="vid_1", stage="html",
        resolved_model="z-ai/glm-5.3-flash", tts_provider=tts_provider, tts_provider_resolved=resolved,
        language="Hindi")
    return ts


@pytest.mark.parametrize("vendor, model", [("smallest", "smallest-tts"), ("navana", "navana-tts")])
def test_billing_charges_smallest_and_navana_at_their_rates(vendor, model):
    assert vgs._resolve_tts_billing(None, vendor, "English") == (vendor, model)
    assert vgs._resolve_tts_billing(vendor, "premium", "English") == (vendor, model)
    for ts in (_bill(vendor, vendor), _bill(vendor, None)):
        (row,) = ts.deducted
        usd = provider_rates.tts_cost_usd(vendor, 1000)
        assert row["model"] == model and row["tts_provider"] == vendor and row["total_price"] == usd
        assert row["precomputed_credits"] == (Decimal(str(usd)) * 150).quantize(Decimal("0.0001"))


def test_a_smallest_request_that_fell_back_to_edge_is_free():
    ts = _bill("smallest", "edge")
    assert ts.deducted == [] and ts.recorded[0]["model"] == "edge-tts"


# ── rest_tts ─────────────────────────────────────────────────────────────────

def test_vendor_language_codes():
    assert rest_tts.smallest_language("English") == "en"           # never "hi" for English (drone)
    assert rest_tts.smallest_language("English (India)") == "en"
    assert rest_tts.smallest_language("Hindi") == "hi"
    assert rest_tts.smallest_language("Japanese") is None
    assert rest_tts.navana_language("English (US)") == "en"
    assert rest_tts.navana_language("Odia") == "or"
    assert rest_tts.navana_language("Punjabi") is None
    assert rest_tts.sarvam_language("Odia") == "od-IN" and rest_tts.sarvam_language("English") == "en-IN"


def test_chunks_respect_the_limit_and_keep_every_word():
    text = " ".join(f"Sentence number {i} is here." for i in range(80))
    chunks = rest_tts.chunk_text(text, 500)
    assert len(chunks) > 1 and all(len(c) <= 500 for c in chunks)
    assert " ".join(chunks).split() == text.split()
    assert all(c.endswith(".") for c in chunks)


def test_navana_keys_parse():
    assert rest_tts.navana_keys(' "k1", k2 ,k1,, ') == ["k1", "k2"]


class _Resp:
    def __init__(self, status, content=b"", text="", headers=None):
        self.status_code, self.content, self.text = status, content, text
        self.headers = headers or {}


def test_navana_retries_concurrency_refusals_on_the_next_key(monkeypatch):
    monkeypatch.setattr(rest_tts.time, "sleep", lambda s: None)
    calls = []

    class Client:
        def post(self, url, json, headers):
            calls.append(headers["X-API-Key"])
            if len(calls) == 1:
                return _Resp(429, text="concurrency limit reached")
            return _Resp(200, content=b"\x00\x01" * 10, headers={"X-Sample-Rate": "22050"})

    pcm, rate = rest_tts._navana_one(Client(), ["ka", "kb"], {"text": "hi"})
    assert pcm == b"\x00\x01" * 10 and rate == 22050
    assert len(calls) == 2 and calls[0] != calls[1]                 # moved to the other key
    for k in ("ka", "kb"):                                           # every stream slot released
        sem = rest_tts._navana_sem(k)
        assert sem.acquire(blocking=False) and sem.acquire(blocking=False)
        sem.release()
        sem.release()


def test_navana_allows_two_streams_per_key():
    sem = rest_tts._navana_sem("only-key")
    assert rest_tts._navana_acquire(["only-key"]) == "only-key"
    assert rest_tts._navana_acquire(["only-key"]) == "only-key"
    with pytest.raises(RuntimeError):
        rest_tts._navana_acquire(["only-key"], wait_seconds=0.05)
    sem.release()
    sem.release()


def test_navana_synth_sends_language_and_voice_and_encodes_mp3(monkeypatch):
    monkeypatch.setenv("NAVANA_API_KEY", "k1")
    bodies = []

    class Client:
        def __init__(self, timeout):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json, headers):
            bodies.append(json)
            return _Resp(200, content=b"\x00\x00" * 4, headers={"X-Sample-Rate": "24000"})

    import httpx
    monkeypatch.setattr(httpx, "Client", Client)
    monkeypatch.setattr(rest_tts, "pcm16_to_mp3", lambda pcm, rate: b"MP3" + bytes([len(pcm)]))
    out = rest_tts.synth_navana_mp3("Namaste duniya.", "Hindi", "bhavana")
    assert out == b"MP3\x08"
    assert bodies == [{"text": "Namaste duniya.", "lang": "hi", "voice": "bhavana", "output_format": "24000:pcm16"}]


def test_smallest_synth_sends_en_for_english(monkeypatch):
    monkeypatch.setenv("SMALLEST_API_KEY", "m")
    bodies = []

    class Client:
        def __init__(self, timeout):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json, headers):
            bodies.append(json)
            return _Resp(200, content=b"\xff\xf3mp3")

    import httpx
    monkeypatch.setattr(httpx, "Client", Client)
    assert rest_tts.synth_smallest_mp3("Hello there.", "English", "nirupma") == b"\xff\xf3mp3"
    assert bodies[0]["language"] == "en" and bodies[0]["voice_id"] == "nirupma"
    assert bodies[0]["model"] == "lightning_v3.1" and bodies[0]["output_format"] == "mp3"
    assert "speed" not in bodies[0]
    with pytest.raises(RuntimeError):
        rest_tts.synth_smallest_mp3("Konnichiwa", "Japanese", "nirupma")


# ── pipeline: provider mapping + voice honouring ─────────────────────────────

@pytest.fixture
def pipeline(monkeypatch, tmp_path):
    sys.path.insert(0, str(AI_SERVICE / "app" / "ai-video-gen-main"))
    import automation_pipeline as ap

    p = object.__new__(ap.VideoGenerationPipeline)
    script = tmp_path / "script.txt"
    script.write_text("Plants make food from sunlight.")
    monkeypatch.setattr(ap, "_whisper_align", lambda path, lang, script_text=None: [
        {"word": w, "start": i * 0.5, "end": i * 0.5 + 0.4} for i, w in enumerate(script_text.split())])
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS_JSON", raising=False)
    edge_voices = []

    class FakeCommunicate:
        def __init__(self, text, voice, **kw):
            edge_voices.append(voice)
            raise RuntimeError("edge stopped by the test")

    import edge_tts
    monkeypatch.setattr(edge_tts, "Communicate", FakeCommunicate)
    return SimpleNamespace(ap=ap, p=p, script=script, run_dir=tmp_path, edge_voices=edge_voices)


@pytest.mark.parametrize("provider, voice_id, gender, want_voice", [
    ("smallest", "emily", "female", "emily"),
    ("smallest", None, "male", "kaustubh"),
    ("navana", None, "female", "bhavana"),
    ("navana", "anirban", "female", "anirban"),
])
def test_pipeline_narrates_with_smallest_and_navana(pipeline, monkeypatch, provider, voice_id, gender, want_voice):
    calls = []
    monkeypatch.setattr(rest_tts, "synthesize_mp3",
                        lambda prov, text, lang, voice, pace=1.0: calls.append((prov, text, lang, voice)) or b"ID3x")
    out = pipeline.p._synthesize_voice(pipeline.script, pipeline.run_dir, language="English",
                                       voice_gender=gender, tts_provider=provider, voice_id=voice_id)
    assert calls == [(provider, "Plants make food from sunlight.", "English", want_voice)]
    assert out["resolved_provider"] == provider and out["resolved_voice_id"] == want_voice
    assert pipeline.p._tts_provider_resolved == provider
    assert (pipeline.run_dir / "narration.mp3").read_bytes() == b"ID3x"
    align = json.loads((pipeline.run_dir / "narration_raw.json").read_text())["alignment"]
    assert "".join(align["characters"]).split() == ["Plants", "make", "food", "from", "sunlight."]
    assert pipeline.edge_voices == []


def test_a_failing_smallest_run_falls_back_to_edge(pipeline, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("Smallest TTS 500")
    monkeypatch.setattr(rest_tts, "synthesize_mp3", boom)
    with pytest.raises(Exception):
        pipeline.p._synthesize_voice(pipeline.script, pipeline.run_dir, language="Hindi",
                                     voice_gender="female", tts_provider="smallest", voice_id="nirupma")
    assert pipeline.edge_voices == ["hi-IN-SwaraNeural"]           # Edge's default, not the Smallest name


def test_pipeline_honours_an_edge_voice_by_name(pipeline):
    with pytest.raises(Exception):
        pipeline.p._synthesize_voice(pipeline.script, pipeline.run_dir, language="English",
                                     voice_gender="female", tts_provider="edge", voice_id="en-GB-RyanNeural")
    assert pipeline.edge_voices == ["en-GB-RyanNeural"]
    with pytest.raises(Exception):
        pipeline.p._synthesize_voice(pipeline.script, pipeline.run_dir, language="English",
                                     voice_gender="female", tts_provider="standard", voice_id="ritu")
    assert pipeline.edge_voices[-1] == "en-US-AriaNeural"           # a non-Edge name is not an Edge voice


def test_pipeline_honours_a_sarvam_voice_of_either_gender(pipeline, monkeypatch):
    bodies = []

    class FakeAsyncClient:
        def __init__(self, timeout=None):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers, json):
            bodies.append(json)
            import base64
            return SimpleNamespace(status_code=200, text="", json=lambda: {"audios": [base64.b64encode(b"ID3s").decode()]})

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setenv("SARVAM_API_KEY", "s")
    out = pipeline.p._synthesize_voice(pipeline.script, pipeline.run_dir, language="Hindi",
                                       voice_gender="female", tts_provider="sarvam", voice_id="Shubh")
    assert bodies[0]["speaker"] == "shubh"                           # a male voice with gender=female
    assert out["resolved_provider"] == "sarvam" and out["resolved_voice_id"] == "shubh"
    json.loads((pipeline.run_dir / "narration_raw.json").read_text())["alignment"]["characters"]


def test_word_budget_stash_resolves_the_new_engines(pipeline):
    """__init__ resolves the engine before the script is written (per-voice
    words-per-second); it must map smallest / navana like the dispatcher."""
    src = (AI_SERVICE / "app" / "ai-video-gen-main" / "automation_pipeline.py").read_text()
    assert 'elif _tier_for_tts in ("sarvam", "smallest", "navana"):' in src
    assert 'elif tier in ("sarvam", "smallest", "navana"):' in src
    ap = pipeline.ap
    assert ap._resolve_voice_wps("smallest", "emily") == ap._VOICE_WPS["smallest:_default"]
    assert ap._resolve_voice_wps("navana", "bhavana") == ap._VOICE_WPS["navana:_default"]
