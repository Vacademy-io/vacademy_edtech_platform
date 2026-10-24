"""LMS AI Video router (/lms-video/v1): auth, tenancy, policy blocks, credits,
format mapping, source grounding, completion notifications, and the shared
background runner extracted from the external router.

No DB, no network: every collaborator is stubbed; the routes run through a
FastAPI app with dependency overrides so the real request/response contract is
exercised.
"""
from __future__ import annotations

import asyncio
import contextlib
import os
import sys
import types
from decimal import Decimal
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:  # the routers import s3_service → boto3; stub it where it isn't installed
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover - depends on the test venv
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.constants.ai_video_policy import DEFAULT_AI_VIDEO_POLICY
from app.core.security import get_pinned_principal
from app.db import db_dependency
from app.routers import external_video_generation as ext
from app.routers import lms_video as lms
from app.schemas.auth import PinnedPrincipal
from app.schemas.credits import CreditCheckResponse
from app.services import ai_video_policy_service as policy_svc

INST = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
USER = "user-1"
AVATAR = "spatius-avatar-123"
PREFIX = lms.router.prefix

ESTIMATE_RESULT = {
    "selections": {},
    "estimate": {
        "expected_credits": 40.0, "low_credits": 30.0, "high_credits": 55.0,
        "breakdown": [{"component": "LLM — per-shot generation", "detail": "x", "cost_usd": 0.1, "credits": 30.0},
                      {"component": "TTS (standard)", "detail": "y", "cost_usd": 0.0, "credits": 10.0}],
    },
    "balance": {"current": 500.0},
}


def _policy(**over):
    p = policy_svc.normalize_policy(None)
    p.update(over)
    return p


class FakeCredits:
    sufficient = True
    calls = []

    def __init__(self, db):
        pass

    def check_video_tier_credits(self, **kw):
        FakeCredits.calls.append(kw)
        if FakeCredits.sufficient:
            return CreditCheckResponse(has_sufficient_credits=True, current_balance=Decimal("500"),
                                       estimated_cost=Decimal("40"), balance_after=Decimal("460"), message="ok")
        return CreditCheckResponse(has_sufficient_credits=False, current_balance=Decimal("12.5"),
                                   estimated_cost=Decimal("40"), balance_after=Decimal("-27.5"),
                                   message="Insufficient credits for standard tier.")


@pytest.fixture
def env(monkeypatch):
    """App + stubs. `state` lets a test tweak policy / usage / roles."""
    state = SimpleNamespace(
        policy=_policy(), is_default=True, month_used=0.0, running=0,
        roles=["TEACHER"], is_root=False, started=[], estimate=dict(ESTIMATE_RESULT),
        lesson_checks=[], merged=[],
    )
    monkeypatch.setattr(lms.policy_svc, "load_policy", lambda db, inst: (state.policy, state.is_default))
    monkeypatch.setattr(lms, "_usage_numbers", lambda db, inst: (state.month_used, state.running))
    monkeypatch.setattr(lms, "_estimate", lambda db, inst, req: state.estimate)
    FakeCredits.sufficient = True
    FakeCredits.calls = []
    import app.services.credit_service as cs_mod
    monkeypatch.setattr(cs_mod, "CreditService", FakeCredits)

    import app.services.lesson_plan_service as lps

    def fake_resolve(lesson, *, institute_id, host=None, db=None):
        state.lesson_checks.append((lesson, institute_id))
        return {"teacher": lesson.teacher.model_dump() if lesson.teacher else None}

    monkeypatch.setattr(lps, "resolve_lesson_plan", fake_resolve)

    def fake_start(payload, video_id, target_stage, institute_id, **kw):
        state.started.append(SimpleNamespace(payload=payload, video_id=video_id, target_stage=target_stage,
                                             institute_id=institute_id, kw=kw))

        async def _sim():
            await kw["on_event"]({"type": "progress", "stage": "PENDING", "video_id": video_id})
        asyncio.get_running_loop().create_task(_sim())
        return kw.get("queue")

    monkeypatch.setattr(ext, "start_video_generation", fake_start)
    monkeypatch.setattr(lms, "_merge_metadata", lambda vid, extra: state.merged.append((vid, extra)) or True)
    # Reference-file URLs are address-checked (services/safe_http); no real DNS in tests.
    import app.services.safe_http as safe_http

    async def fake_resolve_host(host, port):
        return ["10.0.0.7"] if host.endswith("cluster-svc.example") else ["93.184.216.34"]
    monkeypatch.setattr(safe_http, "_resolve_host", fake_resolve_host)

    app = FastAPI()
    app.include_router(lms.router)
    app.dependency_overrides[get_pinned_principal] = lambda: PinnedPrincipal(
        user_id=USER, institute_id=INST, roles=state.roles, is_root_user=state.is_root)
    app.dependency_overrides[db_dependency] = lambda: object()
    with TestClient(app) as client:
        state.client = client
        yield state


def _body(**over):
    b = {"topic": "Photosynthesis", "format": "board_explainer", "duration": "2-3 minutes", "quality": "standard"}
    b.update(over)
    return b


# ── auth ─────────────────────────────────────────────────────────────────────

def test_learner_is_refused(env):
    env.roles = ["STUDENT"]
    r = env.client.post(PREFIX + "/generate", json=_body())
    assert r.status_code == 403
    assert not env.started


def test_root_flag_alone_is_not_staff(env):
    env.roles, env.is_root = ["STUDENT"], True
    assert env.client.post(PREFIX + "/estimate", json=_body()).status_code == 403


def test_staff_roles_in_platform_spelling_pass(env):
    env.roles = ["CONTENT CREATOR"]
    assert env.client.post(PREFIX + "/estimate", json=_body()).status_code == 200


def test_missing_token_is_401():
    app = FastAPI()
    app.include_router(lms.router)
    app.dependency_overrides[db_dependency] = lambda: object()
    with TestClient(app) as client:
        r = client.post(PREFIX + "/estimate", json=_body(), headers={"clientId": INST})
    assert r.status_code == 401


# ── policy blocks (403 {detail, code}) ───────────────────────────────────────

@pytest.mark.parametrize("policy_over, usage, body_over, code", [
    ({"enabled": False}, (0.0, 0), {}, "AI_VIDEO_DISABLED"),
    ({"allowed_qualities": ["standard"]}, (0.0, 0), {"quality": "ultra"}, "TIER_NOT_ALLOWED"),
    ({"teacher_allowed": False}, (0.0, 0),
     {"format": "lesson_teacher", "teacher": {"avatar_id": AVATAR}}, "TEACHER_NOT_ALLOWED"),
    ({"max_minutes_per_video": 5}, (0.0, 0), {"duration": "5-8 minutes"}, "TOO_LONG"),
    ({"monthly_credit_cap": 100}, (70.0, 0), {}, "MONTHLY_CAP"),          # 70 used + 40 expected > 100
    ({"max_concurrent": 2}, (0.0, 2), {}, "TOO_MANY_RUNNING"),
])
def test_each_policy_block(env, policy_over, usage, body_over, code):
    env.policy = _policy(**policy_over)
    env.month_used, env.running = usage
    r = env.client.post(PREFIX + "/generate", json=_body(**body_over))
    assert r.status_code == 403, r.text
    body = r.json()
    assert body["code"] == code and isinstance(body["detail"], str) and body["detail"]
    assert not env.started and not FakeCredits.calls

    e = env.client.post(PREFIX + "/estimate", json=_body(**body_over)).json()
    assert e["allowed"] is False and e["blocked_code"] == code and e["blocked_reason"]


def test_monthly_cap_allows_when_it_fits(env):
    env.policy = _policy(monthly_credit_cap=100)
    env.month_used = 60.0                       # 60 + 40 == 100: fits
    assert env.client.post(PREFIX + "/generate", json=_body()).status_code == 200


def test_problem_walkthrough_teacher_is_policy_checked(env):
    env.policy = _policy(teacher_allowed=False)
    r = env.client.post(PREFIX + "/generate", json=_body(format="problem_walkthrough",
                                                          teacher={"avatar_id": AVATAR}))
    assert r.status_code == 403 and r.json()["code"] == "TEACHER_NOT_ALLOWED"
    # Without a teacher it runs on the board.
    assert env.client.post(PREFIX + "/generate", json=_body(format="problem_walkthrough")).status_code == 200


# ── credits (402) and validation (422) ───────────────────────────────────────

def test_insufficient_credits_is_402_with_amounts(env):
    FakeCredits.sufficient = False
    r = env.client.post(PREFIX + "/generate", json=_body())
    assert r.status_code == 402
    assert r.json() == {"detail": "Insufficient credits for standard tier.", "code": "INSUFFICIENT_CREDITS",
                        "required": 40.0, "balance": 12.5}
    assert not env.started


def test_preflight_gets_the_estimator_selections(env):
    env.client.post(PREFIX + "/generate", json=_body(format="lesson_teacher", teacher={"avatar_id": AVATAR},
                                                     duration="3-5 minutes", quality="premium"))
    call = FakeCredits.calls[-1]
    assert call["quality_tier"] == "premium" and call["partial_run_factor"] == 1.0
    params = call["estimate_params"]
    assert params["target_duration"] == "3-5 minutes"
    assert params["lesson"]["teacher"]["avatar_id"] == AVATAR


def test_lesson_teacher_without_teacher_is_422(env):
    r = env.client.post(PREFIX + "/generate", json=_body(format="lesson_teacher"))
    assert r.status_code == 422 and r.json()["code"] == "TEACHER_REQUIRED"
    e = env.client.post(PREFIX + "/estimate", json=_body(format="lesson_teacher")).json()
    assert e["allowed"] is False and e["blocked_code"] == "TEACHER_REQUIRED"


def test_unavailable_teacher_is_422(env, monkeypatch):
    import app.services.lesson_plan_service as lps

    def refuse(lesson, **kw):
        raise lps.LessonConfigError("That teacher avatar is not available to this institute.")
    monkeypatch.setattr(lps, "resolve_lesson_plan", refuse)
    r = env.client.post(PREFIX + "/generate", json=_body(format="lesson_teacher", teacher={"avatar_id": AVATAR}))
    assert r.status_code == 422 and r.json()["code"] == "TEACHER_NOT_AVAILABLE"
    assert not env.started


def test_schema_validation_is_422(env):
    assert env.client.post(PREFIX + "/generate", json=_body(format="podcast")).status_code == 422
    assert env.client.post(PREFIX + "/generate", json=_body(topic="x" * 501)).status_code == 422
    assert env.client.post(PREFIX + "/generate", json={"format": "board_explainer"}).status_code == 422


def test_run_rejected_before_start_is_422(env, monkeypatch):
    def fake_start(payload, video_id, target_stage, institute_id, **kw):
        async def _sim():
            await kw["on_event"]({"type": "error", "message": "Lesson mode could not be set up"})
        asyncio.get_running_loop().create_task(_sim())
    monkeypatch.setattr(ext, "start_video_generation", fake_start)
    r = env.client.post(PREFIX + "/generate", json=_body())
    assert r.status_code == 422 and r.json()["code"] == "GENERATION_REJECTED"


# ── generate: response + metadata + runner wiring ────────────────────────────

def test_generate_starts_the_shared_runner_with_lms_metadata(env):
    r = env.client.post(PREFIX + "/generate", json=_body(
        context={"chapter_id": "ch-1", "chapter_name": "Plants", "course_id": "c-1"}))
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"video_id", "estimate", "code_editor", "warnings"}
    assert body["estimate"] == {"expected_credits": 40.0, "low_credits": 30.0, "high_credits": 55.0,
                                "rows": [{"label": "LLM — per-shot generation", "credits": 30.0},
                                         {"label": "TTS (standard)", "credits": 10.0}]}
    started = env.started[-1]
    assert started.video_id == body["video_id"] == started.payload.video_id
    assert started.target_stage == "HTML" and started.institute_id == INST
    assert started.kw["user_id"] == USER and started.kw["track_concurrency"] is False
    vid, extra = env.merged[-1]
    assert vid == body["video_id"]
    assert extra["source"] == "lms" and extra["created_by_user_id"] == USER and extra["institute_id"] == INST
    assert extra["format"] == "board_explainer"
    assert extra["context"] == {"chapter_id": "ch-1", "chapter_name": "Plants", "course_id": "c-1"}


def test_estimate_shape(env):
    r = env.client.post(PREFIX + "/estimate", json=_body())
    assert r.status_code == 200
    body = r.json()
    assert body["allowed"] is True and body["blocked_reason"] is None
    assert body["balance"] == {"current_balance": 500.0}
    assert body["policy"] == DEFAULT_AI_VIDEO_POLICY
    assert body["estimate"]["expected_credits"] == 40.0 and len(body["estimate"]["rows"]) == 2
    assert not env.started


def test_estimate_blocks_when_balance_is_short(env):
    env.estimate = {**ESTIMATE_RESULT, "balance": {"current": 10.0}}
    body = env.client.post(PREFIX + "/estimate", json=_body()).json()
    assert body["allowed"] is False and body["blocked_code"] == "INSUFFICIENT_CREDITS"
    assert "40" in body["blocked_reason"]


# ── format → VideoGenerationRequest ──────────────────────────────────────────

@pytest.mark.parametrize("fmt, extra, expect", [
    ("lesson_teacher", {"teacher": {"avatar_id": AVATAR, "name": "Asha"}},
     dict(lesson=True, layout="corner", teacher=True, worked=True, recap=True, orientation="landscape",
          duration="2-3 minutes", code=False)),
    ("board_explainer", {}, dict(lesson=True, layout="board", teacher=False, orientation="landscape",
                                 duration="2-3 minutes", code=False)),
    ("problem_walkthrough", {"include_worked_example": False},
     dict(lesson=True, layout="board", teacher=False, worked=True, code=False, duration="2-3 minutes")),
    ("quick_concept", {"duration": None}, dict(lesson=True, layout="board", recap=True, worked=False,
                                               duration="1-2 minutes", code=False)),
    ("revision_short", {"duration": None}, dict(lesson=True, layout="board", orientation="portrait",
                                                duration="1-2 minutes", recap=True, code=False)),
    ("storybook", {}, dict(lesson=False, orientation="landscape", code=False)),
    ("conversation", {}, dict(lesson=False, orientation="landscape", code=False)),
    ("code_lesson", {}, dict(lesson=True, layout="board", teacher=False, code=True)),
])
def test_format_mapping(env, fmt, extra, expect):
    body = _body(format=fmt, **extra)
    if body.get("duration") is None:
        body.pop("duration")
    r = env.client.post(PREFIX + "/generate", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["code_editor"] is expect["code"]
    p = env.started[-1].payload
    assert p.content_type == "VIDEO" and p.quality_tier == "standard" and p.visual_style == "standard"
    assert p.host is None and p.dialogue_scenes_enabled is False and p.ai_video_enabled is False
    assert "Topic: Photosynthesis" in p.prompt
    if expect["lesson"]:
        assert p.lesson is not None and p.lesson.enabled
        assert p.lesson.layout == expect["layout"]
        if "teacher" in expect:
            assert (p.lesson.teacher is not None) is expect["teacher"]
        if "worked" in expect:
            assert p.lesson.include_worked_example is expect["worked"]
        if "recap" in expect:
            assert p.lesson.include_recap is expect["recap"]
    else:
        assert p.lesson is None
    if "orientation" in expect:
        assert p.orientation == expect["orientation"]
    if "duration" in expect:
        assert p.target_duration == expect["duration"]


def test_problem_walkthrough_with_teacher_sits_in_the_corner(env):
    env.client.post(PREFIX + "/generate", json=_body(format="problem_walkthrough", teacher={"avatar_id": AVATAR}))
    p = env.started[-1].payload
    assert p.lesson.layout == "corner" and p.lesson.teacher.avatar_id == AVATAR
    assert "step by step" in p.prompt


def test_explicit_choices_win_over_format_defaults(env):
    env.client.post(PREFIX + "/generate", json=_body(
        format="lesson_teacher", teacher={"avatar_id": AVATAR}, layout="presenter", orientation="portrait",
        include_recap=False, quality="ultra", voice_gender="male", language="Hindi", audience="Class 8",
        captions_enabled=False, background_music_enabled=False, subject="Biology",
        reference_files=[{"url": "https://cdn.example/notes.pdf", "name": "notes.pdf", "type": "pdf"}]))
    p = env.started[-1].payload
    assert p.lesson.layout == "presenter" and p.lesson.include_recap is False and p.lesson.subject == "Biology"
    assert p.orientation == "portrait" and p.quality_tier == "ultra" and p.voice_gender == "male"
    assert p.language == "Hindi" and p.target_audience == "Class 8"
    assert p.captions_enabled is False and p.background_music_enabled is False
    assert p.tts_provider == "premium"
    assert p.reference_files[0].url == "https://cdn.example/notes.pdf"


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "http://cdn.example/notes.pdf",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.5/notes.pdf",
    "https://localhost/notes.pdf",
    "https://ai-service.default.svc.cluster.local/x.pdf",
    "https://files.cluster-svc.example/notes.pdf",
])
def test_reference_file_urls_must_be_public_https(env, url):
    r = env.client.post(PREFIX + "/generate", json=_body(
        reference_files=[{"url": url, "name": "notes.pdf", "type": "pdf"}]))
    assert r.status_code == 422 and r.json()["code"] == "INVALID_REFERENCE_FILE", r.text
    assert "notes.pdf" in r.json()["detail"]
    assert not env.started


def test_lesson_switch_defaults_match_the_dashboard_mirror():
    """frontend-admin-dashboard …/ai-video/ai-video-form.ts LESSON_FORMAT_DEFAULTS
    mirrors these; change both together."""
    got = {k: (v.worked_example, v.force_worked_example, v.recap) for k, v in lms.FORMATS.items() if v.lesson}
    assert got == {
        "lesson_teacher": (True, False, True),
        "board_explainer": (True, False, True),
        "problem_walkthrough": (True, True, True),
        "quick_concept": (False, False, True),
        "revision_short": (False, False, True),
        "code_lesson": (True, False, True),
    }


def test_teacher_ignored_for_formats_without_one(env):
    r = env.client.post(PREFIX + "/generate", json=_body(format="storybook", teacher={"avatar_id": AVATAR}))
    assert r.status_code == 200
    assert any("teacher" in w for w in r.json()["warnings"])
    assert env.started[-1].payload.lesson is None
    assert not env.lesson_checks


def test_tts_provider_follows_the_voice():
    base = lms.LmsVideoRequest(**_body())
    assert lms._tts_provider(base) == "standard"
    assert lms._tts_provider(base.model_copy(update={"quality": "premium"})) == "premium"
    assert lms._tts_provider(base.model_copy(update={"voice_id": "en-IN-NeerjaNeural", "quality": "ultra"})) == "standard"
    assert lms._tts_provider(base.model_copy(update={"voice_id": "ritu"})) == "premium"


# ── sources ──────────────────────────────────────────────────────────────────

def _src(slide_id, title, text_, kind="document"):
    return SimpleNamespace(slide_id=slide_id, title=title, text=text_, kind=kind, text_note=None,
                           video_description=None)


def test_source_slides_are_grounded_and_capped(env, monkeypatch):
    import app.services.tutor.slide_source as ss
    import app.services.tutor.source_text as st
    slides = {
        "s1": _src("s1", "Light reactions", "A" * 15_000),
        "s2": _src("s2", "Calvin cycle", "B" * 10_000),
        "pdf": _src("pdf", "Chapter PDF", "", kind="pdf"),
        "draft": None,
    }
    monkeypatch.setattr(ss, "slide_belongs_to_institute", lambda db, sid, inst: sid != "foreign")
    monkeypatch.setattr(ss, "load_slide_source", lambda db, sid: slides.get(sid))
    resolved = []

    async def fake_free(src):
        resolved.append(src.slide_id)
        src.text = "PDF TEXT"
    monkeypatch.setattr(st, "resolve_free_text", fake_free)

    r = env.client.post(PREFIX + "/generate", json=_body(source_slide_ids=["pdf", "s1", "s2", "draft", "foreign"]))
    assert r.status_code == 200, r.text
    warnings = r.json()["warnings"]
    assert resolved == ["pdf"]
    assert any("trimmed" in w and "20,000" in w for w in warnings)
    assert any("2 selected slides were skipped" in w for w in warnings)
    prompt = env.started[-1].payload.prompt
    assert "### Chapter PDF\nPDF TEXT" in prompt and "### Light reactions" in prompt
    source_part = prompt.split("do not contradict it):\n", 1)[1]
    assert len(source_part) == lms.SOURCE_TEXT_CAP


def test_estimate_checks_sources_without_extracting(env, monkeypatch):
    import app.services.tutor.slide_source as ss
    import app.services.tutor.source_text as st
    monkeypatch.setattr(ss, "slide_belongs_to_institute", lambda db, sid, inst: True)
    monkeypatch.setattr(ss, "load_slide_source", lambda db, sid: None)

    async def boom(src):
        raise AssertionError("estimate must not extract")
    monkeypatch.setattr(st, "resolve_free_text", boom)
    body = env.client.post(PREFIX + "/estimate", json=_body(source_slide_ids=["d1"])).json()
    assert any("1 selected slide was skipped" in w for w in body["warnings"])


# ── status + cancel: tenancy ─────────────────────────────────────────────────

class FakeRepo:
    records = {}

    def __init__(self, session=None):
        pass

    def get_by_video_id(self, vid):
        return FakeRepo.records.get(vid)


def _record(owner, status_="IN_PROGRESS"):
    return SimpleNamespace(extra_metadata=({"institute_id": owner} if owner else {}), status=status_)


@pytest.fixture
def records(monkeypatch):
    FakeRepo.records = {"mine": _record(INST), "theirs": _record(OTHER), "legacy": _record(None),
                        "done": _record(INST, "COMPLETED")}
    monkeypatch.setattr(lms, "AiVideoRepository", FakeRepo)
    return FakeRepo.records


def test_status_is_tenant_checked(env, records, monkeypatch):
    monkeypatch.setattr(lms, "_video_status_dict", lambda db, vid: {
        "status": "IN_PROGRESS", "current_stage": "HTML", "updated_at": "2026-10-13T10:00:00",
        "generation_progress": {"shots_completed": 3, "shots_total": 12, "sub_stage": "Shot 3/12 ready"},
        "s3_urls": {}, "error_message": None})
    for vid in ("theirs", "legacy", "missing"):
        assert env.client.get(PREFIX + f"/status/{vid}").status_code == 404
    r = env.client.get(PREFIX + "/status/mine")
    assert r.status_code == 200
    assert r.json() == {"video_id": "mine", "status": "IN_PROGRESS", "current_stage": "HTML", "percentage": 35,
                        "sub_stage": "Shot 3/12 ready", "shots_completed": 3, "shots_total": 12,
                        "error_message": None, "html_url": None, "audio_url": None,
                        "updated_at": "2026-10-13T10:00:00"}


def test_build_status_completed_and_between_stages():
    done = lms.build_status("v", {"status": "COMPLETED", "current_stage": "HTML",
                                  "s3_urls": {"timeline": "https://s3/t.json", "audio": "https://s3/a.mp3"}})
    assert done["percentage"] == 100 and done["html_url"] == "https://s3/t.json" and done["audio_url"]
    mid = lms.build_status("v", {"status": "COMPLETED", "current_stage": "SCRIPT", "s3_urls": {}})
    assert mid["status"] == "IN_PROGRESS" and mid["percentage"] < 100
    failed = lms.build_status("v", {"status": "FAILED", "current_stage": "HTML", "error_message": "boom"})
    assert failed["status"] == "FAILED" and failed["error_message"] == "boom"


def test_cancel_is_tenant_checked_and_reuses_the_shared_cancel(env, records, monkeypatch):
    @contextlib.contextmanager
    def fake_session():
        yield object()
    monkeypatch.setattr(ext, "make_db_session", fake_session)
    assert env.client.post(PREFIX + "/cancel/theirs").status_code == 404
    assert env.client.post(PREFIX + "/cancel/legacy").status_code == 404
    r = env.client.post(PREFIX + "/cancel/done")
    assert r.status_code == 200 and r.json() == {"status": "COMPLETED", "video_id": "done", "stopped": False}

    stopped = []
    monkeypatch.setattr(ext.cancellation_registry, "signal_stop", lambda vid: stopped.append(vid) or True)
    monkeypatch.setattr(ext, "AiVideoRepository", lambda session=None: SimpleNamespace(
        update_stage=lambda vid, stage, status: stopped.append((vid, status))))
    import app.services.token_usage_service as tus
    monkeypatch.setattr(tus, "TokenUsageService", lambda s: SimpleNamespace(
        refund_video_credits=lambda vid, inst: stopped.append(("refund", vid, inst))))
    r = env.client.post(PREFIX + "/cancel/mine")
    assert r.json() == {"status": "CANCELLED", "video_id": "mine", "stopped": True}
    assert stopped == ["mine", ("mine", "CANCELLED"), ("refund", "mine", INST)]


# ── completion notification ──────────────────────────────────────────────────

@pytest.fixture
def alerts(monkeypatch):
    sent = []
    import app.services.staff_notify as sn

    async def fake_alert(institute_id, user_ids, title, body, *, source, source_id=None, data=None):
        sent.append(dict(institute_id=institute_id, user_ids=list(user_ids), title=title, body=body,
                         source=source, source_id=source_id, data=data))
        return True
    monkeypatch.setattr(sn, "system_alert", fake_alert)
    return sent


def _run(final_status, monkeypatch):
    monkeypatch.setattr(lms, "_finish_record", lambda *a, **k: final_status)

    async def go():
        run = lms._LmsRun(video_id="vid-1", institute_id=INST, user_id=USER, topic="Photosynthesis",
                          context={"chapter_id": "ch-1", "chapter_name": "Plants"}, extra={},
                          prompt="p", language="English")
        run.merged = True
        await run.on_finished(None)
    asyncio.run(go())


def test_notifies_creator_when_ready(monkeypatch, alerts):
    _run("COMPLETED", monkeypatch)
    assert len(alerts) == 1
    a = alerts[0]
    assert a["institute_id"] == INST and a["user_ids"] == [USER]
    assert a["source"] == "lms_ai_video" and a["source_id"] == "vid-1"
    assert a["title"] == "Your AI video is ready" and "Photosynthesis" in a["body"] and "Plants" in a["body"]
    assert a["data"] == {"video_id": "vid-1", "status": "COMPLETED", "chapter_id": "ch-1"}


def test_notifies_creator_when_failed(monkeypatch, alerts):
    _run("FAILED", monkeypatch)
    assert alerts[0]["title"] == "Your AI video couldn't be generated"
    assert "credits refunded" in alerts[0]["body"]


def test_no_row_or_notification_for_a_run_generate_rejected(monkeypatch, alerts):
    seen = []
    monkeypatch.setattr(lms, "_finish_record", lambda vid, failure, extra, responded, *a: seen.append(responded) or "FAILED")

    async def go():
        run = lms._LmsRun(video_id="vid-1", institute_id=INST, user_id=USER, topic="T", context={},
                          extra={}, prompt="p", language="English")
        await run.on_event({"type": "error", "message": "Lesson mode could not be set up"})
        run.responded = True            # /generate answered 422 with that error
        await run.on_finished(None)
        return run
    run = asyncio.run(go())
    assert run.rejected is True and seen == [False] and alerts == []


def test_a_failure_after_generate_answered_still_notifies(monkeypatch, alerts):
    monkeypatch.setattr(lms, "_finish_record", lambda *a: "FAILED")

    async def go():
        run = lms._LmsRun(video_id="vid-1", institute_id=INST, user_id=USER, topic="T", context={},
                          extra={}, prompt="p", language="English")
        run.responded = True            # /generate timed out waiting and answered 200
        await run.on_event({"type": "error", "message": "boom"})
        await run.on_finished(None)
        return run
    run = asyncio.run(go())
    assert run.rejected is False and len(alerts) == 1


@pytest.mark.parametrize("final", ["CANCELLED", "IN_PROGRESS", None])
def test_no_notification_otherwise(monkeypatch, alerts, final):
    _run(final, monkeypatch)
    assert alerts == []


class FinishRepo:
    def __init__(self, rec):
        self.rec, self.failed, self.created = rec, [], []

    def __call__(self, session=None):
        return self

    def get_by_video_id(self, vid):
        return self.rec

    def mark_failed(self, video_id, error_message, current_stage=None):
        self.failed.append((video_id, error_message))

    def create(self, **kw):
        self.created.append(kw)


@pytest.fixture
def fake_db_session(monkeypatch):
    @contextlib.contextmanager
    def fake_session():
        yield object()
    monkeypatch.setattr(lms, "make_db_session", fake_session)


def test_finish_marks_a_raised_run_failed(monkeypatch, fake_db_session):
    repo = FinishRepo(SimpleNamespace(status="IN_PROGRESS"))
    monkeypatch.setattr(lms, "AiVideoRepository", repo)
    assert lms._finish_record("v", RuntimeError("boom"), {}, True, "p", "English") == "FAILED"
    assert repo.failed == [("v", "Generation failed: boom")]


def test_finish_keeps_terminal_status(monkeypatch, fake_db_session):
    for st in ("COMPLETED", "FAILED", "CANCELLED"):
        repo = FinishRepo(SimpleNamespace(status=st))
        monkeypatch.setattr(lms, "AiVideoRepository", repo)
        assert lms._finish_record("v", None, {}, True, "p", "English") == st
        assert repo.failed == []


def test_finish_creates_a_failed_row_only_after_generate_answered(monkeypatch, fake_db_session):
    repo = FinishRepo(None)
    monkeypatch.setattr(lms, "AiVideoRepository", repo)
    assert lms._finish_record("v", None, {"source": "lms"}, False, "p", "English") is None
    assert repo.created == []
    assert lms._finish_record("v", None, {"source": "lms"}, True, "p", "English") == "FAILED"
    assert repo.created[0]["metadata"] == {"source": "lms"} and repo.failed


# ── the shared runner (external router) ──────────────────────────────────────

@pytest.fixture
def runner(monkeypatch):
    calls = SimpleNamespace(refunds=[], events=[])

    @contextlib.contextmanager
    def fake_session():
        yield object()
    monkeypatch.setattr(ext, "make_bg_db_session", fake_session)
    monkeypatch.setattr(ext, "make_db_session", fake_session)
    monkeypatch.setattr(ext, "AiVideoRepository", lambda session=None: object())
    monkeypatch.setattr(ext, "S3Service", lambda: object())
    import app.services.token_usage_service as tus
    monkeypatch.setattr(tus, "TokenUsageService", lambda s: SimpleNamespace(
        refund_video_credits=lambda vid, inst: calls.refunds.append((vid, inst))))
    calls.mode = "ok"

    class FakeService:
        def __init__(self, repository, s3_service):
            pass

        async def generate_till_stage(self, **kw):
            calls.kwargs = kw
            yield {"type": "progress", "stage": "PENDING"}
            if calls.mode == "raise":
                raise RuntimeError("pipeline exploded")
            if calls.mode == "cancel":
                raise asyncio.CancelledError()
            yield {"type": "completed"}
    monkeypatch.setattr(ext, "VideoGenerationService", FakeService)
    return calls


def _drive(runner, *, user_id=None):
    from app.schemas.video_generation import VideoGenerationRequest
    finished = []

    async def on_event(ev):
        runner.events.append(ev)

    async def on_finished(exc):
        finished.append(exc)

    async def go():
        q = ext.start_video_generation(VideoGenerationRequest(prompt="x"), "vid-r", "HTML", INST,
                                       user_id=user_id, on_event=on_event, on_finished=on_finished)
        task = ext._generation_tasks["vid-r"]
        assert "vid-r" in ext._institute_active_tasks[INST]
        try:
            await task
        except asyncio.CancelledError:
            pass
        items = []
        while not q.empty():
            items.append(q.get_nowait())
        return items
    items = asyncio.run(go())
    return items, finished


def test_runner_streams_events_and_reports_completion(runner):
    items, finished = _drive(runner, user_id=USER)
    assert [e["type"] for e in runner.events] == ["progress", "completed"]
    assert items[-1] is None and len(items) == 3            # two events + the sentinel
    assert finished == [None] and runner.refunds == []
    assert runner.kwargs["user_id"] == USER and runner.kwargs["target_stage"] == "HTML"
    assert "vid-r" not in ext._generation_tasks and "vid-r" not in ext._institute_active_tasks[INST]


def test_runner_refunds_and_reports_a_failure(runner):
    runner.mode = "raise"
    items, finished = _drive(runner)
    assert runner.refunds == [("vid-r", INST)]
    assert isinstance(finished[0], RuntimeError)
    assert '"type": "error"' in items[-2] and items[-1] is None
    assert runner.kwargs["user_id"] is None                  # external callers: unchanged


def test_runner_does_not_report_a_cancel(runner):
    runner.mode = "cancel"
    _, finished = _drive(runner)
    assert finished == [] and runner.refunds == []


def test_status_reports_html_while_shots_are_being_drawn():
    from ai_service.app.routers.lms_video import build_status

    st = {"status": "IN_PROGRESS", "current_stage": "WORDS",
          "generation_progress": {"shots_completed": 11, "shots_total": 14}}
    out = build_status("v1", st)
    assert out["current_stage"] == "HTML"
    assert 15 < out["percentage"] < 100
    # before any shot exists the stored stage is kept
    early = build_status("v1", {"status": "IN_PROGRESS", "current_stage": "WORDS"})
    assert early["current_stage"] == "WORDS"
