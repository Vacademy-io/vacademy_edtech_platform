"""Callers pass usage-event attribution (contract K2) without changing a charge.

Each test drives a real billing path down to the CreditDeductRequest (or the
record-only record_usage call) and checks two things:
  * the metering fields are there: use_case + actor/surface/context;
  * the legacy ledger fields are byte-identical to a run without metering
    (user_id / user_role / subject_user_id / amount / description / keys).
"""
from __future__ import annotations

import base64
from contextlib import contextmanager
from decimal import Decimal
from types import SimpleNamespace

import pytest
from jose import jwt

from ai_service.app.config import get_settings
from ai_service.app.models.ai_token_usage import ApiProvider, RequestType
from ai_service.app.services import ai_billing
from ai_service.app.services import credit_service as credit_service_mod
from ai_service.app.services import tool_cost_estimator as tce
from ai_service.app.services.token_usage_service import TokenUsageService

INST = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"

METERING_KEYS = set(ai_billing.METERING_FIELD_NAMES) | {"subject_user_id"}
# Captured at import: test_question_gen_parity overwrites ai_billing.record_llm_billing
# without monkeypatch, so a later lookup can find its stub.
_RECORD_LLM_BILLING = ai_billing.record_llm_billing


# ── fakes ──────────────────────────────────────────────────────────────────

class _Ledger:
    """Captures the CreditDeductRequest a real TokenUsageService builds."""

    def __init__(self):
        self.deducts = []
        self.usage = []


@pytest.fixture
def ledger(monkeypatch):
    led = _Ledger()

    def fake_record_usage(self, **kw):
        led.usage.append(kw)
        return SimpleNamespace(id="usage-1", total_price=kw.get("total_price"))

    class FakeCredits:
        def __init__(self, db):
            pass

        def deduct_credits(self, request):
            led.deducts.append(request)
            return SimpleNamespace(success=True, credits_deducted=Decimal("1"), new_balance=Decimal("9"),
                                   message="ok")

        def calculate_credits(self, **kw):
            return Decimal("0.5")

    class FakeEstimator:
        def __init__(self, db):
            pass

        def estimate(self, tool_key, tool_params, institute_id=None, rate_snapshot=None):
            return {"estimated_credits": 2, "fixed_price": False, "rate_source": "global"}

    monkeypatch.setattr(TokenUsageService, "record_usage", fake_record_usage)
    monkeypatch.setattr(credit_service_mod, "CreditService", FakeCredits)
    monkeypatch.setattr(tce, "ToolCostEstimator", FakeEstimator)

    @contextmanager
    def fake_session():
        yield SimpleNamespace()

    monkeypatch.setattr(ai_billing, "db_session", fake_session)
    return led


def _legacy(req) -> dict:
    """The deduct request minus every metering field: what the ledger sees."""
    return {k: v for k, v in req.model_dump().items() if k not in METERING_KEYS}


def _token(authorities, fullname="Asha Rao"):
    secret = get_settings().jwt_secret_key
    secret += "=" * (-len(secret) % 4)
    claims = {"sub": "asha", "username": "asha", "user": USER, "fullname": fullname,
              "authorities": authorities}
    return "Bearer " + jwt.encode(claims, base64.b64decode(secret), algorithm="HS256")


class _Req:
    def __init__(self, headers):
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.state = SimpleNamespace()


# ── 1. tool charges (ai_billing.charge_tool → TokenUsageService → deduct) ──

def test_tool_charge_carries_use_case_actor_and_keeps_the_ledger_identical(ledger):
    req = _Req({"Authorization": _token({INST: {"roles": ["TEACHER"]}}),
                "Origin": "https://dash.vacademy.io"})
    meter = ai_billing.metering_from_request(req, INST, user={"user_id": USER})
    base = dict(tool_key="html_document", tool_params={}, request_type=RequestType.CONTENT, model="m",
                prompt_tokens=10, completion_tokens=5, institute_id=INST, user_id=USER, user_role="ADMIN",
                idempotency_key="k1")

    ai_billing.record_tool_billing(**base)
    ai_billing.record_tool_billing(**base, use_case=ai_billing.UC.HTML_DOCUMENT, metering=meter,
                                   usage_context={"slide_id": "s1"})

    plain, metered = ledger.deducts
    assert _legacy(plain) == _legacy(metered), "ledger fields must not change"
    assert metered.user_role == "ADMIN"  # the legacy literal stays in the ledger
    assert metered.use_case == "html_document"
    assert metered.tool_key == "html_document"
    assert metered.actor_kind == "USER" and metered.actor_user_id == USER
    assert metered.actor_role_class == "TEACHER" and metered.role_source == "JWT"
    assert metered.actor_display_name == "Asha Rao"
    assert metered.surface == "ADMIN_APP"
    assert metered.usage_context == {"slide_id": "s1"}
    assert plain.use_case is None and plain.actor_kind is None


# ── 2. LLM billing (tutor runtime turn) ────────────────────────────────────

def test_tutor_turn_llm_billing_is_attributed_to_the_learner(ledger):
    _RECORD_LLM_BILLING(
        request_type=RequestType.CONVERSATION, model="m", prompt_tokens=3, completion_tokens=4,
        total_tokens=7, institute_id=INST, user_id=USER, request_id="ts-1",
        use_case=ai_billing.UC.TUTOR_CHAT, metering=ai_billing.metering_user(USER, surface="LEARNER_APP"),
        usage_context={"tutor_session_id": "ts-1"},
    )
    (req,) = ledger.deducts
    assert req.use_case == "tutor_chat" and req.surface == "LEARNER_APP"
    assert req.actor_kind == "USER" and req.actor_user_id == USER
    assert req.role_source == "UNRESOLVED"  # filled in later by the nightly lookup
    assert req.user_role is None  # record_llm_billing never set a ledger role
    assert req.usage_context == {"tutor_session_id": "ts-1"}


# ── 3. course assist (direct CreditService.deduct_credits) ─────────────────

def test_course_assist_charge_carries_attribution(monkeypatch):
    from ai_service.app.routers import course_assist

    seen = []

    class FakeCredits:
        def __init__(self, db):
            pass

        def deduct_credits(self, request):
            seen.append(request)

    @contextmanager
    def fake_session():
        yield object()

    monkeypatch.setattr(course_assist, "CreditService", FakeCredits)
    monkeypatch.setattr(course_assist, "db_session", fake_session)
    req = _Req({"Authorization": _token({INST: {"roles": ["ADMIN", "TEACHER"]}})})
    meter = course_assist._metering(req, INST, {"user_id": USER}, USER)
    course_assist._charge(INST, USER, Decimal("1"), RequestType.CONTENT, "m", "desc", "run1")
    course_assist._charge(INST, USER, Decimal("1"), RequestType.CONTENT, "m", "desc", "run1",
                          use_case=ai_billing.UC.COURSE_ASSIST, metering=meter,
                          usage_context={"field": "about"})
    plain, metered = seen
    assert _legacy(plain) == _legacy(metered)
    assert metered.use_case == "course_assist" and metered.actor_role_class == "ADMIN"
    assert metered.actor_roles_raw == ["ADMIN", "TEACHER"]


# ── 4. partner API copy check ──────────────────────────────────────────────

def test_copy_check_api_charge_is_an_api_key_actor():
    from ai_service.app.services.copy_check import orchestrator

    req = {"assessment_id": "a1", "attempt_id": "t1", "process_id": "p1", "answer_mode": "HANDWRITTEN"}
    api = orchestrator.charge_metering({"billing_actor": "apikey:key-9"}, req)
    fields = ai_billing.metering_kwargs(api["use_case"], api["metering"], api["usage_context"])
    assert fields["use_case"] == "evaluation"
    assert fields["actor_kind"] == "API_KEY" and fields["actor_user_id"] == "apikey:key-9"
    assert fields["surface"] == "PARTNER_API"
    assert fields["usage_context"]["assessment_id"] == "a1"

    dash = orchestrator.charge_metering({"billing_actor": None}, req)
    dfields = ai_billing.metering_kwargs(dash["use_case"], dash["metering"], dash["usage_context"])
    assert dfields["surface"] == "ADMIN_APP" and dfields["actor_kind"] == "UNKNOWN"
    # The plan (legacy ledger args) is untouched by the metering kwargs.
    plan = orchestrator.charge_plan({"billing_actor": "apikey:key-9", "page_count": 3}, typed=False,
                                    num_questions=4)
    assert plan["user_role"] == "API_KEY" and not (set(plan) & set(api))


# ── 5. video stage billing ─────────────────────────────────────────────────

class _FakeTokenService:
    def __init__(self):
        self.calls = []

    def record_usage_and_deduct_credits(self, api_provider, prompt_tokens, completion_tokens, total_tokens,
                                        request_type, institute_id=None, user_id=None, model=None,
                                        request_id=None, metadata=None, total_price=None, character_count=None,
                                        batch_id=None, precomputed_credits=None, allow_negative=False,
                                        tts_provider=None, *, use_case=None, actor_kind=None,
                                        actor_user_id=None, surface=None, usage_context=None,
                                        role_source=None, source_service=None):
        self.calls.append(("deduct", dict(locals())))

    def record_usage(self, **kw):
        self.calls.append(("record", kw))


def _bill_video(meter):
    from ai_service.app.services.video_generation_service import _bill_video_stage_usage

    ts = _FakeTokenService()
    _bill_video_stage_usage(
        ts, usage={"prompt_tokens": 100, "completion_tokens": 50, "stock_count": 2},
        cost_breakdown=None, usd_to_credits=lambda usd: Decimal("1"), image_unit_usd=lambda m: 0.04,
        institute_id=INST, user_id=USER, video_id="vid-1", stage="script", resolved_model="z-ai/glm",
        tts_provider=None, tts_provider_resolved=None, language="English", meter=meter,
    )
    return ts.calls


def test_video_stage_billing_carries_the_video_and_keeps_ledger_args():
    from ai_service.app.services.video_generation_service import video_meter

    meter = video_meter(use_case="lesson_video", video_id="vid-1", user_id=USER,
                        prompt="Photosynthesis basics\nmore detail", content_type="VIDEO", quality_tier="ultra",
                        stage="script")
    plain, metered = _bill_video(None), _bill_video(meter)
    (_, p_deduct), (_, m_deduct) = plain[0], metered[0]
    strip = lambda d: {k: v for k, v in d.items() if k not in METERING_KEYS and k != "self"}  # noqa: E731
    assert strip(p_deduct) == strip(m_deduct)
    assert m_deduct["batch_id"] == "vid-1"
    assert m_deduct["use_case"] == "lesson_video" and m_deduct["actor_user_id"] == USER
    assert m_deduct["usage_context"]["video_id"] == "vid-1"
    assert m_deduct["usage_context"]["video_title"] == "Photosynthesis basics"
    # Only the parameters this token service accepts were passed.
    assert "actor_display_name" not in m_deduct
    # The free stock row is a bundled record-only event.
    (_, stock) = metered[1]
    assert stock["use_case"] == "lesson_video" and stock["free_reason"] == "BUNDLED"
    assert "use_case" not in plain[1][1]


# ── 6. internal LLM (record-only, Java/assessment callers) ─────────────────

def test_internal_llm_records_use_case_source_service_and_subject(monkeypatch):
    from ai_service.app.routers import internal_llm

    seen = []
    monkeypatch.setattr(TokenUsageService, "record_usage", lambda self, **kw: seen.append(kw))
    body = internal_llm.InternalCompletionRequest(
        use_case="analytics", messages=[{"role": "user", "content": "x"}], institute_id=INST,
        subject_user_id="learner-7", usage_context={"report_id": "r1"},
    )
    result = SimpleNamespace(usage={"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
                             model="z-ai/glm", router="isoquant")
    internal_llm._record_usage(object(), body, result, source_service="assessment")
    (kw,) = seen
    assert kw["use_case"] == "learner_analytics"
    assert kw["source_service"] == "assessment" and kw["surface"] == "INTERNAL"
    assert kw["actor_kind"] == "SYSTEM" and kw["subject_user_id"] == "learner-7"
    assert kw["usage_context"] == {"report_id": "r1", "model_use_case": "analytics"}
    assert kw["user_id"] is None and kw["institute_id"] == INST  # legacy columns as before


# ── 7. learner chat agent (no request in scope) ────────────────────────────

def test_learner_chat_agent_usage_is_a_learner_app_event(monkeypatch):
    from ai_service.app.services import ai_chat_agent_service as mod

    seen = []

    class FakeTUS:
        def __init__(self, db):
            pass

        def record_usage_and_deduct_credits(self, **kw):
            seen.append(kw)

    @contextmanager
    def fake_db():
        yield object()

    monkeypatch.setattr(mod, "TokenUsageService", FakeTUS)
    svc = mod.AiChatAgentService.__new__(mod.AiChatAgentService)
    svc._get_db = fake_db
    svc._record_token_usage({"usage": {"prompt_tokens": 4, "completion_tokens": 2, "total_tokens": 6},
                             "provider": "openrouter", "model": "m"}, INST, USER)
    (kw,) = seen
    assert kw["use_case"] == "learner_assistant" and kw["surface"] == "LEARNER_APP"
    assert kw["user_id"] == USER and kw["request_type"] == RequestType.AGENT
    assert "user_role" not in kw  # the ledger role stays unset, as before


# ── 8. fail-soft guarantees ────────────────────────────────────────────────

def test_metering_helpers_never_raise_and_never_touch_ledger_fields():
    class Boom:
        def as_fields(self):
            raise RuntimeError("bad context")

    assert ai_billing.metering_kwargs("x", Boom()) == {}
    fields = ai_billing.metering_kwargs(
        "content", {"user_id": "u", "user_role": "ADMIN", "subject_user_id": "s", "actor_kind": "USER",
                    "surface": "X" * 100, "bogus": 1},
        {"title": "t" * 500, "n": 3, "none": None},
    )
    assert "user_id" not in fields and "user_role" not in fields and "subject_user_id" not in fields
    assert "bogus" not in fields and len(fields["surface"]) == 24
    assert fields["usage_context"] == {"title": "t" * 200, "n": 3, "subject_user_id": "s"}
    assert ai_billing.metering_kwargs("c", None, {"s": "x"}, keep_subject=True) == {
        "use_case": "c", "usage_context": {"s": "x"}}


def test_supported_kwargs_filters_for_old_signatures_and_bad_requests_fall_back():
    def old(a, b=None):
        return None

    def new(a, *, use_case=None, **kw):
        return None

    assert ai_billing.supported_kwargs(old, {"use_case": "x"}) == {}
    assert ai_billing.supported_kwargs(new, {"use_case": "x", "surface": "y"}) == {"use_case": "x", "surface": "y"}
    assert ai_billing.supported_kwargs(None, {"use_case": "x"}) == {}
    req = ai_billing.build_deduct_request({"byo_key": object()}, institute_id=INST, request_type="content",
                                          model="m")
    assert req.institute_id == INST and req.byo_key is None


# ── 9. every explicit key is a seeded catalog row ──────────────────────────

def test_every_caller_use_case_is_seeded_in_the_catalog():
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parents[2]
    migration_dir = root / "admin_core_service/src/main/resources/db/migration"
    migrations = sorted(migration_dir.glob("V*__ai_usage_metering.sql"))
    assert migrations, "metering migration missing"
    # The base catalog lives in the metering migration; later features (V598 site
    # assistant, V600 course knowledge, ...) seed their own rows in their own migration.
    seeded = set()
    for path in sorted(migration_dir.glob("V*.sql")):
        sql = path.read_text(encoding="utf-8")
        for part in sql.split("INSERT INTO ai_use_case_catalog")[1:]:
            block = part.split("ON CONFLICT", 1)[0]
            seeded |= set(re.findall(r"^\s*(?:VALUES\s*)?\('([a-z_]+)'", block, re.M))
    keys = {v for k, v in vars(ai_billing.UC).items() if k.isupper()}
    # Literal keys passed outside ai_billing.UC (video, internal_llm, assessment/coding/
    # paper-digitise/question-extract/lecture/translation callers).
    keys |= {"lesson_video", "avatar_video", "learner_analytics", "assessment_generation", "questions",
             "lecture", "translation"}
    assert keys - seeded == set()
