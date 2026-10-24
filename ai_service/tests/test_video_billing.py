"""AI-video billing: every charge is vendor USD × the live credit ratio.

Owner decisions (2026-10-13) these tests pin:
- every in-run video deduction passes allow_negative=True (the vendor has been
  paid; a short balance goes negative and the video finishes);
- LLM tokens are billed whenever usage OR the cost breakdown has them — the v3
  script stage's usage has no total_tokens, and vision-review tokens only
  reach the breakdown;
- one IMAGE row per generated image on the model that made it, priced from the
  vendor's usage.cost or ai_models.image_price_per_unit (never the flat 0.30);
  host identity images too, one per real Seedream call (the host block bills
  only avatar seconds — it used to charge one image per completed host shot);
- Edge TTS and Pexels stock are free: usage rows, no deduction;
- the lesson teacher is ceil(video seconds) × spatius/video's price × ratio;
- the start-of-run check requires the estimator's expected credits.

No DB and no network: fakes stand in for the session and the services.
"""
import json
import os
import sys
import types
from decimal import Decimal
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:  # the service imports s3_service → boto3; stub it where it isn't installed
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover - depends on the test venv
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from app.constants.model_defaults import GLM_DEFAULT
from app.models.ai_token_usage import RequestType
from app.services import credit_service as cs_mod
from app.services import provider_rates
from app.services import video_estimation_service as est
from app.services import video_generation_service as vgs
from app.services.credit_service import CreditService

RATIO = Decimal("150")
INST = "11111111-1111-1111-1111-111111111111"


def _usd_to_credits(usd):
    return (Decimal(str(usd)) * RATIO).quantize(Decimal("0.0001"))


class FakeTokenService:
    """Records every call; `deducted` are record_usage_and_deduct_credits calls,
    `recorded` are usage-only record_usage calls."""

    def __init__(self):
        self.deducted = []
        self.recorded = []

    def record_usage_and_deduct_credits(self, **kw):
        self.deducted.append(kw)

    def record_usage(self, **kw):
        self.recorded.append(kw)


def _bill(usage, breakdown=None, *, tts_provider="standard", resolved_tts=None,
          language="English", image_prices=None, resolved_model="z-ai/glm-5.3-flash"):
    ts = FakeTokenService()
    prices = image_prices or {}
    summary = vgs._bill_video_stage_usage(
        ts,
        usage=usage,
        cost_breakdown=breakdown,
        usd_to_credits=_usd_to_credits,
        image_unit_usd=lambda m: prices.get(m, 0.04),
        institute_id=INST,
        user_id=None,
        video_id="vid_1",
        stage="html",
        resolved_model=resolved_model,
        tts_provider=tts_provider,
        tts_provider_resolved=resolved_tts,
        language=language,
    )
    return ts, summary


def _llm(model, pt, ct, stage="per_shot_html"):
    return {"kind": "llm", "model": model, "stage": stage, "prompt_tokens": pt, "completion_tokens": ct}


def _img(model, purpose="support_visual", cost_usd=None):
    ev = {"kind": "image", "model": model, "stage": "support_visual_3", "purpose": purpose}
    if cost_usd is not None:
        ev["cost_usd"] = cost_usd
    return ev


# ── usd_to_credits / image price ─────────────────────────────────────────────

def test_usd_to_credits_uses_the_live_ratio(monkeypatch):
    svc = CreditService(db=None)
    monkeypatch.setattr(svc, "_effective_usd_to_credit_ratio", lambda: Decimal("150"))
    assert svc.usd_to_credits(0.04) == Decimal("6.0000")
    assert svc.usd_to_credits(Decimal("0.126")) == Decimal("18.9000")
    monkeypatch.setattr(svc, "_effective_usd_to_credit_ratio", lambda: Decimal("120"))
    assert svc.usd_to_credits(0.04) == Decimal("4.8000")


@pytest.mark.parametrize("bad", [None, 0, -1, "x", float("nan")])
def test_usd_to_credits_is_zero_for_nothing_to_charge(bad):
    svc = CreditService(db=None)
    svc._effective_usd_to_credit_ratio = lambda: Decimal("150")
    assert svc.usd_to_credits(bad) == Decimal("0")


class _PriceDB:
    def __init__(self, rows):
        self.rows = rows
        self.sql = []

    def execute(self, stmt, params=None):
        self.sql.append(str(stmt))
        wanted = {params["m"], params["f"]}
        return SimpleNamespace(fetchall=lambda: [r for r in self.rows if r[0] in wanted])


def test_image_price_reads_the_model_then_recraft_then_the_default():
    db = _PriceDB([("bytedance-seed/seedream-4.5", 0.05), ("recraft/recraft-v4.1", 0.035)])
    assert provider_rates.image_cost_usd("bytedance-seed/seedream-4.5", db=db) == 0.05
    assert provider_rates.image_cost_usd("some/unpriced-model", db=db) == 0.035
    assert provider_rates.image_cost_usd(None, db=db) == 0.035
    assert "is_active = TRUE" in db.sql[0]
    assert provider_rates.image_cost_usd("x", db=_PriceDB([])) == provider_rates.IMAGE_USD_DEFAULT
    assert provider_rates.image_cost_usd("x", db=_PriceDB([("x", None), ("recraft/recraft-v4.1", 0)])) == 0.04


# ── LLM rows ────────────────────────────────────────────────────────────────

def test_script_stage_usage_without_total_tokens_is_billed():
    """v3 shot planning returns prompt/completion but no total_tokens."""
    usage = {"prompt_tokens": 12000, "completion_tokens": 3000, "image_count": 0}
    ts, summary = _bill(usage, {"stages": [_llm(GLM_DEFAULT, 12000, 3000, stage="shot_planner")]})
    assert summary["llm_rows"] == 1
    row = ts.deducted[0]
    assert row["request_type"] == RequestType.VIDEO
    assert (row["model"], row["prompt_tokens"], row["completion_tokens"], row["total_tokens"]) == (
        GLM_DEFAULT, 12000, 3000, 15000)
    assert row["allow_negative"] is True


def test_tokens_only_the_breakdown_has_are_billed_on_their_own_model():
    """Vision review runs through html_client.chat, so it reaches the breakdown
    but never `usage`; a single-model stage used to drop it."""
    usage = {"prompt_tokens": 100000, "completion_tokens": 50000, "total_tokens": 150000}
    breakdown = {"stages": [
        _llm(GLM_DEFAULT, 90000, 45000),
        _llm("google/gemini-2.5-flash", 8000, 1000, stage="vision_review_shot_2"),
    ]}
    ts, _ = _bill(usage, breakdown)
    rows = {r["model"]: (r["prompt_tokens"], r["completion_tokens"]) for r in ts.deducted}
    # The usage leftover (100000-98000, 50000-46000) goes onto the dominant model.
    assert rows == {GLM_DEFAULT: (92000, 49000), "google/gemini-2.5-flash": (8000, 1000)}
    assert all(r["allow_negative"] for r in ts.deducted)


def test_a_single_model_breakdown_takes_the_split_path():
    usage = {"prompt_tokens": 1000, "completion_tokens": 500}
    ts, _ = _bill(usage, {"stages": [_llm(GLM_DEFAULT, 1500, 200)]})
    assert len(ts.deducted) == 1
    r = ts.deducted[0]
    assert (r["prompt_tokens"], r["completion_tokens"]) == (1500, 500)  # max per dimension
    assert r["metadata"]["attributed_model_source"] == "cost_breakdown_split"


def test_no_breakdown_bills_usage_on_the_resolved_model():
    ts, _ = _bill({"prompt_tokens": 10, "completion_tokens": 5}, None, resolved_model="z-ai/glm-5.3-flash")
    assert [(r["model"], r["total_tokens"]) for r in ts.deducted] == [("z-ai/glm-5.3-flash", 15)]
    assert ts.deducted[0]["metadata"]["attributed_model_source"] == "resolved_model"


def test_a_stage_with_nothing_bills_nothing():
    ts, summary = _bill({"prompt_tokens": 0, "completion_tokens": 0}, {"stages": []})
    assert ts.deducted == [] and ts.recorded == [] and summary["llm_rows"] == 0


# ── images ──────────────────────────────────────────────────────────────────

def test_each_image_is_billed_on_its_model_at_cost_times_ratio():
    breakdown = {"stages": [
        _img("recraft/recraft-v4.1", cost_usd=0.036),                      # vendor-reported cost
        _img("bytedance-seed/seedream-4.5", purpose="thumbnail"),         # unit price
        _img("bytedance-seed/seedream-4.5", purpose="host_identity", cost_usd=0.04),
    ]}
    ts, summary = _bill({"image_count": 1}, breakdown,
                        image_prices={"bytedance-seed/seedream-4.5": 0.05})
    images = [r for r in ts.deducted if r["request_type"] == RequestType.IMAGE]
    assert [(r["model"], r["precomputed_credits"], r["metadata"]["purpose"]) for r in images] == [
        ("recraft/recraft-v4.1", Decimal("5.4000"), "support_visual"),
        ("bytedance-seed/seedream-4.5", Decimal("7.5000"), "thumbnail"),
        ("bytedance-seed/seedream-4.5", Decimal("6.0000"), "host_identity"),
    ]
    assert images[0]["metadata"]["price_source"] == "usage.cost"
    assert images[1]["metadata"]["price_source"] == "ai_models"
    assert all(r["allow_negative"] for r in images)
    assert summary["image_shortfall"] == 0


def test_images_counted_without_cost_events_are_billed_at_the_recraft_price():
    ts, summary = _bill({"image_count": 3}, {"stages": [_img("recraft/recraft-v4.1")]},
                        image_prices={"recraft/recraft-v4.1": 0.04})
    images = [r for r in ts.deducted if r["request_type"] == RequestType.IMAGE]
    assert len(images) == 3 and summary["image_shortfall"] == 2
    assert {r["model"] for r in images} == {provider_rates.IMAGE_FALLBACK_MODEL_ID}
    assert all(r["precomputed_credits"] == Decimal("6.0000") for r in images)
    assert [r["metadata"]["purpose"] for r in images].count("unrecorded") == 2


def test_image_rows_never_land_on_the_llm_model():
    ts, _ = _bill({"prompt_tokens": 10, "completion_tokens": 10, "image_count": 2}, {"stages": [
        _llm(GLM_DEFAULT, 10, 10)]})
    images = [r for r in ts.deducted if r["request_type"] == RequestType.IMAGE]
    assert len(images) == 2 and all(r["model"] != GLM_DEFAULT for r in images)


# ── free vendors / TTS ──────────────────────────────────────────────────────

def test_edge_tts_and_pexels_record_usage_but_never_deduct():
    ts, summary = _bill({"tts_character_count": 1500, "stock_count": 4}, None, tts_provider="standard")
    assert ts.deducted == []
    models = {r["model"]: r for r in ts.recorded}
    assert set(models) == {"edge-tts", "pexels-stock-api"}
    assert models["edge-tts"]["character_count"] == 1500 and models["edge-tts"]["total_price"] == 0.0
    assert models["pexels-stock-api"]["metadata"]["stock_count"] == 4
    assert summary["tts_model"] == "edge-tts"


def test_premium_tts_is_billed_on_the_resolved_vendor_rate():
    ts, _ = _bill({"tts_character_count": 1500}, None, tts_provider="premium", resolved_tts="google")
    (row,) = ts.deducted
    usd = provider_rates.tts_cost_usd("google", 1500)
    assert row["request_type"] == RequestType.TTS_PREMIUM and row["model"] == "google-cloud-tts"
    assert row["precomputed_credits"] == _usd_to_credits(usd) and row["total_price"] == usd
    assert row["allow_negative"] is True


def test_premium_request_that_fell_back_to_edge_is_free():
    ts, _ = _bill({"tts_character_count": 900}, None, tts_provider="premium", resolved_tts="edge")
    assert ts.deducted == [] and ts.recorded[0]["model"] == "edge-tts"


def test_premium_without_a_resolved_vendor_mirrors_the_pipeline():
    ts, _ = _bill({"tts_character_count": 1000}, None, tts_provider="premium", language="Hindi")
    assert ts.deducted[0]["model"] == "sarvam-bulbul-v3"
    assert ts.deducted[0]["precomputed_credits"] == _usd_to_credits(provider_rates.tts_cost_usd("sarvam", 1000))


# ── cost breakdown merge ────────────────────────────────────────────────────

def test_stage_breakdowns_merge_into_one_report():
    script = {"video_id": "v", "tier": "standard", "pipeline_version": "v3",
              "run_started_at": "2026-10-13T10:00:00Z", "run_completed_at": "2026-10-13T10:02:00Z",
              "summary": {"total_usd": 0.1, "base_usd": 0.1, "regen_usd": 0, "retry_usd": 0, "non_llm_usd": 0.04},
              "stages": [_llm(GLM_DEFAULT, 1, 1, stage="shot_planner")], "anomalies": ["a"]}
    html = {**script, "run_started_at": "2026-10-13T10:05:00Z", "run_completed_at": "2026-10-13T10:30:00Z",
            "summary": {"total_usd": 0.3, "base_usd": 0.2, "regen_usd": 0.1, "retry_usd": 0, "non_llm_usd": 0},
            "stages": [_llm(GLM_DEFAULT, 2, 2), _img("recraft/recraft-v4.1")], "anomalies": ["b"]}
    merged = vgs._merge_cost_breakdowns({"script": script, "html": html})
    assert [e["pipeline_stage"] for e in merged["stages"]] == ["script", "html", "html"]
    assert merged["summary"]["total_usd"] == 0.4 and merged["summary"]["regen_pct"] == 25.0
    assert merged["run_started_at"] == "2026-10-13T10:00:00Z"
    assert merged["run_completed_at"] == "2026-10-13T10:30:00Z"
    assert merged["anomalies"] == ["a", "b"] and set(merged["by_stage"]) == {"script", "html"}
    json.dumps(merged)


# ── lesson teacher ──────────────────────────────────────────────────────────

def test_teacher_is_charged_for_the_vendors_video_seconds():
    credits, usd, source = vgs._lesson_teacher_charge(
        {"video_seconds": 167.4, "audio_seconds": 165.6, "vendor_usd": 0.1256},
        video_price_per_second=Decimal("0.00075"), usd_to_credits=_usd_to_credits,
    )
    assert source == "ai_models" and credits == Decimal("18.9000") and usd == pytest.approx(0.126)


def test_teacher_falls_back_to_vendor_usd_then_the_legacy_rate():
    credits, usd, source = vgs._lesson_teacher_charge(
        {"video_seconds": 147.5, "vendor_usd": 0.1106}, video_price_per_second=None,
        usd_to_credits=_usd_to_credits)
    assert (credits, usd, source) == (Decimal("16.5900"), 0.1106, "vendor_usd")
    credits, usd, source = vgs._lesson_teacher_charge(
        {"audio_seconds": 145.7}, video_price_per_second=None, usd_to_credits=_usd_to_credits)
    assert (credits, usd, source) == (Decimal("24"), None, "legacy_per_minute")
    assert vgs._lesson_teacher_charge({}, video_price_per_second=None,
                                      usd_to_credits=_usd_to_credits)[0] == Decimal("0")


def test_the_merged_lesson_block_is_json_serialisable():
    """Decimal in extra_metadata made update_metadata raise, so the lesson
    outputs (teacher clips, billed_at, errors) were never saved."""
    credits, usd, source = vgs._lesson_teacher_charge(
        {"video_seconds": 120.2}, video_price_per_second=Decimal("0.00075"), usd_to_credits=_usd_to_credits)
    lesson_out = {"teacher": {"video_seconds": 120.2, "platform_credits": 13.5}, "clips_ok": 4}
    block = {"plan": {"teacher": {"avatar_id": "a" * 10}},
             "outputs": vgs._lesson_billing_record(lesson_out, credits=credits, vendor_usd=usd,
                                                   price_source=source, billed_at="2026-10-13T10:00:00")}
    decoded = json.loads(json.dumps({"lesson": block}))
    assert decoded["lesson"]["outputs"]["billed_credits"] == float(credits) == 13.6125
    assert decoded["lesson"]["outputs"]["billed_price_source"] == "ai_models"


class _TeacherDB:
    """Answers the full-refund count the teacher's idempotency key reads."""

    def __init__(self, refunds=0, boom=False):
        self.refunds, self.boom, self.sql = refunds, boom, []

    def execute(self, stmt, params=None):
        self.sql.append((str(stmt), params))
        if self.boom:
            raise RuntimeError("db hiccup")
        return SimpleNamespace(scalar=lambda: self.refunds)


class _FakeCredits:
    def __init__(self, response=None, boom=False):
        self.requests, self.response, self.boom = [], response, boom

    def deduct_credits(self, request):
        self.requests.append(request)
        if self.boom:
            raise RuntimeError("deduct failed")
        return self.response


def _charge_teacher(db, credits_svc):
    ts = FakeTokenService()
    ts.record_usage = lambda **kw: ts.recorded.append(kw) or SimpleNamespace(id="usage-1")
    charged = vgs._charge_lesson_teacher(
        db, teacher_out={"video_seconds": 167.4, "audio_seconds": 165.6, "vendor_usd": 0.1256},
        credits=Decimal("18.9000"), teacher_usd=0.126, price_source="ai_models",
        institute_id=INST, user_id="u1", video_id="vid_1",
        token_usage_service=ts, credit_service=credits_svc)
    return charged, ts


def test_the_teacher_charge_returns_what_was_actually_deducted():
    cs = _FakeCredits(SimpleNamespace(success=True, credits_deducted=Decimal("18.9000"), message="ok"))
    charged, ts = _charge_teacher(_TeacherDB(), cs)
    assert charged == Decimal("18.9000")
    req = cs.requests[0]
    assert req.idempotency_key == "vid_1:lesson-teacher" and req.allow_negative is True
    assert req.precomputed_credits == Decimal("18.9000") and req.seconds == 168
    assert req.batch_id == "vid_1" and req.usage_log_id == "usage-1"
    assert ts.recorded[0]["total_price"] == 0.1256 and ts.deducted == []


@pytest.mark.parametrize("credits_svc", [
    _FakeCredits(SimpleNamespace(success=True, credits_deducted=Decimal("0"),
                                 message="Already processed (idempotent no-op)")),
    _FakeCredits(SimpleNamespace(success=False, credits_deducted=Decimal("0"), message="Insufficient")),
    _FakeCredits(boom=True),
])
def test_a_teacher_no_op_or_failed_deduct_reports_zero(credits_svc):
    """The caller stamps billed_* only when this is > 0 — metadata must never
    report a teacher charge that didn't happen."""
    charged, _ = _charge_teacher(_TeacherDB(), credits_svc)
    assert charged == Decimal("0")


def test_after_a_full_refund_the_teacher_gets_a_fresh_key():
    """refund_video_credits refunds the teacher row too; a retry that re-runs
    the html stage must be able to bill the teacher again."""
    db = _TeacherDB(refunds=1)
    cs = _FakeCredits(SimpleNamespace(success=True, credits_deducted=Decimal("18.9000"), message="ok"))
    _charge_teacher(db, cs)
    assert cs.requests[0].idempotency_key == "vid_1:lesson-teacher:refund1"
    sql, params = db.sql[0]
    assert "REFUND" in sql and params["d"].startswith("Full refund for failed video generation")
    assert vgs._lesson_teacher_idempotency_key(_TeacherDB(boom=True), "vid_1", INST) == "vid_1:lesson-teacher"


def test_the_refund_description_the_key_counts_is_the_one_refunds_write():
    src = open(os.path.join(os.path.dirname(__file__), "..", "app", "services", "token_usage_service.py"),
               encoding="utf-8").read()
    assert f'description=f"{vgs._FULL_VIDEO_REFUND_DESCRIPTION_PREFIX} {{video_id}}"' in src


def test_the_host_block_bills_only_avatar_seconds():
    """Seedream identity images are billed from their host_identity events (one
    per real call: one per run for custom avatars, none for argil/veed) — the
    host block used to charge one per completed host SHOT on top."""
    assert vgs._IMAGE_PURPOSES_BILLED_ELSEWHERE == frozenset()
    src = open(vgs.__file__, encoding="utf-8").read()
    block = src[src.index("# ── Deduct credits for avatar-host work ──"):
                src.index("# ── Lesson mode: teacher outputs")]
    assert "RequestType.IMAGE" not in block and "RequestType.AVATAR_VIDEO" in block


# ── default model ───────────────────────────────────────────────────────────

def test_video_default_model_falls_back_to_glm(monkeypatch):
    class Boom:
        def __init__(self, db):
            raise RuntimeError("registry down")

    import app.services.ai_models_service as ams
    monkeypatch.setattr(ams, "AIModelsService", Boom)
    assert vgs._video_default_model_id(db=object()) == GLM_DEFAULT

    class Registry:
        def __init__(self, db):
            pass

        def get_models_for_use_case(self, use_case):
            return SimpleNamespace(default_model=SimpleNamespace(model_id="z-ai/glm-6"))

        def get_default_model_id_for_use_case(self, use_case):
            return None

    monkeypatch.setattr(ams, "AIModelsService", Registry)
    assert vgs._video_default_model_id(db=object()) == "z-ai/glm-6"
    assert vgs._video_default_model_id(db=object(), use_case="video_regenerate") == GLM_DEFAULT


def test_no_gemini_flash_literal_is_left_in_video_routing():
    import inspect
    src = inspect.getsource(vgs)
    assert "gemini-3-flash-preview" not in src
    assert "_TIER_FLASH_MODEL" not in src


# ── pre-flight ──────────────────────────────────────────────────────────────

class _BalanceDB:
    def begin_nested(self):
        return SimpleNamespace(commit=lambda: None, rollback=lambda: None)


def _svc(monkeypatch, balance):
    svc = CreditService(_BalanceDB())
    monkeypatch.setattr(svc, "get_balance", lambda i: SimpleNamespace(current_balance=Decimal(str(balance))))
    monkeypatch.setattr(svc, "_effective_usd_to_credit_ratio", lambda: RATIO)
    return svc


def test_the_start_check_requires_the_full_estimate(monkeypatch):
    seen = {}

    def fake_estimate(db, **kw):
        seen.update(kw)
        return {"estimate": {"expected_credits": 172.5}}

    monkeypatch.setattr(est, "estimate_video_generation", fake_estimate)
    params = {"target_duration": "2-3 minutes", "lesson": {"teacher": {"avatar_id": "x" * 8}},
              "not_an_estimator_arg": 1, "model": None}
    check = _svc(monkeypatch, 100).check_video_tier_credits(INST, "standard", estimate_params=params)
    assert check.has_sufficient_credits is False and check.estimated_cost == Decimal("172.5000")
    assert seen["quality_tier"] == "standard" and seen["ai_video_enabled"] is False
    assert "not_an_estimator_arg" not in seen and "model" not in seen
    assert "estimated cost" in check.message

    ok = _svc(monkeypatch, 200).check_video_tier_credits(INST, "standard", estimate_params=params,
                                                          partial_run_factor=0.4)
    assert ok.has_sufficient_credits and ok.estimated_cost == Decimal("69.0000")


def test_the_floor_is_used_only_when_the_estimator_fails(monkeypatch):
    def boom(db, **kw):
        raise RuntimeError("db hiccup")

    monkeypatch.setattr(est, "estimate_video_generation", boom)
    check = _svc(monkeypatch, 100).check_video_tier_credits(INST, "ultra", estimate_params={})
    assert check.estimated_cost == Decimal("30.0000")
    legacy = _svc(monkeypatch, 100).check_video_tier_credits(INST, "premium")
    assert legacy.estimated_cost == Decimal("20.0000")


def test_the_veo_hold_stays_on_top_of_the_estimate(monkeypatch):
    monkeypatch.setattr(est, "estimate_video_generation", lambda db, **kw: {"estimate": {"expected_credits": 100}})
    from app.services.ai_video_constants import AI_VIDEO_PER_VIDEO_COST_CAP_USD, AI_VIDEO_PREFLIGHT_HOLD_FRACTION
    hold = (Decimal(str(AI_VIDEO_PER_VIDEO_COST_CAP_USD)) * Decimal(str(AI_VIDEO_PREFLIGHT_HOLD_FRACTION))
            * RATIO).quantize(Decimal("0.0001"))
    check = _svc(monkeypatch, 0).check_video_tier_credits(INST, "ultra", ai_video_enabled=True,
                                                          estimate_params={})
    assert check.estimated_cost == Decimal("100.0000") + hold


# ── estimator ───────────────────────────────────────────────────────────────

@pytest.fixture
def priced_estimator(monkeypatch):
    """Estimator with ai_models / credit_pricing / ratio answered in-process."""
    monkeypatch.setattr(est, "_resolve_stage_models", lambda db, tier, model: (GLM_DEFAULT, GLM_DEFAULT))
    monkeypatch.setattr(est, "_get_llm_pricing", lambda db, m: (0.027, 0.49, False))
    prices = {"recraft/recraft-v4.1": 0.04, "bytedance-seed/seedream-4.5": 0.05}
    monkeypatch.setattr(est, "_get_image_unit_price", lambda db, m=est._VIDEO_IMAGE_MODEL_ID: prices[m])
    per_second = {"spatius/video": 0.00075, "fal-ai/kling-video/ai-avatar/v2/standard": 0.0562}
    monkeypatch.setattr(est, "_get_video_second_price", lambda db, m: per_second.get(m))
    monkeypatch.setattr(CreditService, "_effective_usd_to_credit_ratio", lambda self: RATIO)
    monkeypatch.setattr(CreditService, "_get_pricing", lambda self, rt: cs_mod.DEFAULT_PRICING.get(
        rt, cs_mod.DEFAULT_PRICING["content"]))
    return est


def _rows(result):
    return {r["component"]: r for r in result["estimate"]["breakdown"]}


def test_estimate_prices_a_lesson_like_the_runtime_charges(priced_estimator):
    result = est.estimate_video_generation(
        None, quality_tier="standard", target_duration="2-3 minutes", tts_provider="standard",
        lesson={"enabled": True, "teacher": {"avatar_id": "avatar-123"}}, background_music_enabled=True,
    )
    rows = _rows(result)
    img = rows["Image generation"]
    assert "recraft" in img["detail"]
    assert img["credits"] == 17 * 6.0                                 # 17 images × $0.04 × 150, no 0.30 base
    assert rows["Thumbnail"]["credits"] == 6.0                        # one AI thumbnail per VIDEO run
    teacher = rows["Lesson teacher (Spatius avatar)"]
    assert teacher["credits"] == pytest.approx(152 * 0.00075 * 150)   # ceil(150 s + 1.8 s tail)
    assert rows["TTS (standard)"]["credits"] == 0.0                   # Edge is free
    assert rows["Background music (Lyria)"]["credits"] == 0.0         # music is not charged
    seg = rows["LLM — script + segment shots"]
    usd = 538000 / 1e6 * 0.027 + 651000 / 1e6 * 0.49
    assert seg["credits"] == pytest.approx(float(Decimal("0.05") + Decimal(str(usd)) * RATIO), abs=0.01)
    assert result["estimate"]["expected_credits"] == pytest.approx(sum(r["credits"] for r in rows.values()))


@pytest.mark.parametrize("tier", ["standard", "premium", "ultra"])
def test_a_2_to_3_minute_lesson_estimate_covers_what_a_glm_run_is_charged(priced_estimator, tier):
    """The start check requires this estimate and in-run charges may go
    negative, so it must not sit far below the measured run: vid_lesson_sq_2245
    (150 s, GLM) ≈ html 435,899 / 509,663 tokens + script ~60k / 90k, 17
    images, a thumbnail and the teacher — about 175-210 credits. The table
    before the recalibration asked for ~32 (standard)."""
    result = est.estimate_video_generation(
        None, quality_tier=tier, target_duration="2-3 minutes", tts_provider="standard",
        lesson={"enabled": True, "teacher": {"avatar_id": "avatar-123"}},
    )
    measured_llm_usd = (435899 + 60000) / 1e6 * 0.027 + (509663 + 90000) / 1e6 * 0.49
    measured = (measured_llm_usd + 17 * 0.04 + 0.04 + 152 * 0.00075) * 150
    assert measured * 0.95 <= result["estimate"]["expected_credits"] <= measured * 1.35


def test_a_non_video_run_has_no_thumbnail_row(priced_estimator):
    rows = _rows(est.estimate_video_generation(None, content_type="SLIDES"))
    assert "Thumbnail" not in rows


def test_the_start_check_leaves_out_the_dialogue_budget(monkeypatch):
    """The dialogue row is the whole per-video clip budget (~900 credits for
    storybook) and AiVideoLedger demotes a clip the balance can't cover."""
    seen = {}

    def fake_estimate(db, **kw):
        seen.update(kw)
        return {"estimate": {"expected_credits": 50}}

    monkeypatch.setattr(est, "estimate_video_generation", fake_estimate)
    check = _svc(monkeypatch, 60).check_video_tier_credits(
        INST, "standard", estimate_params={"dialogue_scenes_enabled": True, "dialogue_mode": "storybook"})
    assert seen["dialogue_scenes_enabled"] is False
    assert check.has_sufficient_credits and check.estimated_cost == Decimal("50.0000")


def test_estimate_prices_premium_tts_and_host_images(priced_estimator):
    result = est.estimate_video_generation(
        None, quality_tier="ultra", target_duration="1-2 minutes", tts_provider="premium", language="Hindi",
        host={"type": "avatar", "host_in_video_percentage": 100, "avatar": {}},
    )
    rows = _rows(result)
    tts = rows["TTS (premium)"]
    assert "sarvam" in tts["detail"]
    assert tts["credits"] == pytest.approx(provider_rates.tts_cost_usd("sarvam", 900) * 150, abs=0.01)
    host_imgs = rows["Avatar reference images (host)"]
    assert host_imgs["credits"] == pytest.approx(15 * 0.05 * 150)    # 90 s / 6 s per shot, Seedream price
    host = rows["Avatar video synthesis (host)"]                      # avatar_video pricing, as charged
    assert host["credits"] == pytest.approx(0.05 + 90 * 0.0562 * 150, abs=0.01)


def test_estimate_without_a_teacher_has_no_teacher_row(priced_estimator):
    rows = _rows(est.estimate_video_generation(None, lesson={"enabled": True, "teacher": None}))
    assert "Lesson teacher (Spatius avatar)" not in rows


# ── router pre-flight wiring (fastapi-free: helpers extracted by AST) ───────

_ROUTER = os.path.join(os.path.dirname(__file__), "..", "app", "routers", "external_video_generation.py")


def _router_helpers():
    import ast
    import typing

    tree = ast.parse(open(_ROUTER, encoding="utf-8").read())
    wanted = {"_ESTIMATE_SELECTION_KEYS", "_video_estimate_params", "_persisted_estimate_params"}
    nodes = [n for n in tree.body
             if (isinstance(n, ast.FunctionDef) and n.name in wanted)
             or (isinstance(n, ast.Assign) and any(getattr(t, "id", None) in wanted for t in n.targets))]
    ns = {"Any": typing.Any, "Dict": typing.Dict, "Optional": typing.Optional}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), _ROUTER, "exec"), ns)
    return ns, tree


def test_every_estimate_selection_is_an_estimator_argument():
    import inspect
    ns, _ = _router_helpers()
    accepted = set(inspect.signature(est.estimate_video_generation).parameters)
    assert set(ns["_ESTIMATE_SELECTION_KEYS"]) <= accepted


def test_resume_legs_estimate_from_the_persisted_selections_and_lesson_plan():
    ns, _ = _router_helpers()
    meta = {
        "user_selections": {"quality_tier": "ultra", "target_duration": "3-5 minutes", "tts_provider": "premium",
                            "language": "Hindi", "model": None, "prompt": "not an estimator arg"},
        "lesson": {"plan": {"teacher": {"avatar_id": "avatar-123"}}, "outputs": {}},
        "host": {"type": "avatar", "outputs": {}},   # a HostPlan snapshot: left out
    }
    params = ns["_persisted_estimate_params"](meta)
    assert params == {"target_duration": "3-5 minutes", "tts_provider": "premium", "language": "Hindi",
                      "lesson": {"teacher": {"avatar_id": "avatar-123"}}}
    assert ns["_persisted_estimate_params"](None) == {}


def test_every_video_preflight_passes_the_estimate():
    import ast
    _, tree = _router_helpers()
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
             and getattr(n.func, "attr", None) == "check_video_tier_credits"]
    assert len(calls) == 4
    assert all(any(k.arg == "estimate_params" for k in c.keywords) for c in calls)


def test_inserted_shots_use_the_video_default_not_a_flash_literal():
    src = open(_ROUTER, encoding="utf-8").read()
    assert "gemini-3-flash-preview" not in src and "_TIER_FLASH_MODEL" not in src


def test_estimator_prices_the_stage_matrix_models(monkeypatch):
    import app.services.ai_models_service as ams
    seen = {}

    class Registry:
        def __init__(self, db):
            pass

        def get_stage_model_map(self, *, use_case, quality_tier, overrides=None):
            seen["overrides"] = overrides
            return {"director": SimpleNamespace(model_id=GLM_DEFAULT),
                    "per_shot_html": SimpleNamespace(model_id="google/gemini-3.7-flash")}

    monkeypatch.setattr(ams, "AIModelsService", Registry)
    assert est._resolve_stage_models(None, "ultra", "google/gemini-3.7-flash") == (
        GLM_DEFAULT, "google/gemini-3.7-flash")
    assert seen["overrides"] == {"default": "google/gemini-3.7-flash"}   # user model on overridable stages

    class Empty(Registry):
        def get_stage_model_map(self, **kw):
            return {}

        def get_models_for_use_case(self, use_case):
            raise RuntimeError("registry down")

    monkeypatch.setattr(ams, "AIModelsService", Empty)
    assert est._resolve_stage_models(None, "standard", None) == (GLM_DEFAULT, GLM_DEFAULT)


# ── Resume-safe billing (2026-10: generation survives deploys) ──────────────

class _KeyedTokenService(FakeTokenService):
    """Dedupes on idempotency_key like CreditService (credit_transactions
    external_reference_id is UNIQUE): a replayed key is a no-op."""

    def __init__(self):
        super().__init__()
        self.keys = set()
        self.noops = []

    def record_usage_and_deduct_credits(self, **kw):
        key = kw.get("idempotency_key")
        if key and key in self.keys:
            self.noops.append(key)
            return None
        if key:
            self.keys.add(key)
        self.deducted.append(kw)


def _bill_keyed(ts, db, usage, breakdown):
    key_fn, gen = vgs._stage_charge_key_fn(db, "vid_1", INST, "html")
    vgs._bill_video_stage_usage(
        ts, usage=usage, cost_breakdown=breakdown, usd_to_credits=_usd_to_credits,
        image_unit_usd=lambda m: 0.04, institute_id=INST, user_id=None, video_id="vid_1",
        stage="html", resolved_model="z-ai/glm-5.3-flash", tts_provider="premium",
        tts_provider_resolved="google", language="English", idempotency_key_fn=key_fn,
    )
    return gen


def test_a_stage_billed_twice_in_one_refund_generation_charges_once():
    usage = {"prompt_tokens": 1000, "completion_tokens": 500, "image_count": 2, "tts_character_count": 900}
    breakdown = {"stages": [_llm("z-ai/glm-5", 1000, 500), _img("seedream", cost_usd=0.03),
                            _img("seedream", cost_usd=0.03)]}
    ts = _KeyedTokenService()
    _bill_keyed(ts, _TeacherDB(refunds=0), usage, breakdown)
    first = [d["idempotency_key"] for d in ts.deducted]
    assert first == ["vid_1:stage:html:llm:z-ai/glm-5", "vid_1:stage:html:img:0",
                     "vid_1:stage:html:img:1", "vid_1:stage:html:tts"]
    # kill between billing and the stage's COMPLETED write → the stage re-runs
    _bill_keyed(ts, _TeacherDB(refunds=0), usage, breakdown)
    assert len(ts.deducted) == 4 and sorted(ts.noops) == sorted(first)
    # after a full refund (generation 1) the re-run is billable again
    gen = _bill_keyed(ts, _TeacherDB(refunds=1), usage, breakdown)
    assert gen == 1 and len(ts.deducted) == 8
    assert all(d["idempotency_key"].endswith(":refund1") for d in ts.deducted[4:])


def test_without_a_key_function_nothing_changes():
    ts, _ = _bill({"prompt_tokens": 10, "completion_tokens": 5}, {"stages": [_llm("z-ai/glm-5", 10, 5)]})
    assert "idempotency_key" not in ts.deducted[0]


def test_resumed_tts_characters_are_never_billed():
    """The past-TTS resume branch reports tts_character_count_resumed (cost
    report only) — no premium TTS row may come from it."""
    ts, summary = _bill({"tts_character_count_resumed": 5000}, tts_provider="premium", resolved_tts="google")
    assert ts.deducted == [] and summary["tts_model"] is None


def test_lesson_teacher_key_is_the_generic_charge_key():
    assert vgs._video_charge_key(_TeacherDB(refunds=0), "vid_1", INST, "lesson-teacher") == "vid_1:lesson-teacher"
    assert vgs._video_charge_key(_TeacherDB(refunds=2), "vid_1", INST, "host:abc") == "vid_1:host:abc:refund2"


def test_ai_video_ledger_charge_replay_is_a_noop_but_a_refunded_shot_bills_again(monkeypatch):
    import contextlib
    import app.db as app_db
    import app.services.credit_rate_service as crs
    from app.services import ai_video_ledger as led

    state = SimpleNamespace(refund_rows=0, ledger={}, requests=[])

    class _DB:
        def execute(self, stmt, params=None):
            return SimpleNamespace(scalar=lambda: state.refund_rows)

    @contextlib.contextmanager
    def fake_session():
        yield _DB()

    class _Credits:
        def __init__(self, db):
            pass

        def deduct_credits(self, req):
            state.requests.append(req)
            if req.idempotency_key in state.ledger:
                return SimpleNamespace(success=True, credits_deducted=Decimal("0"),
                                       message="Already processed (idempotent no-op)")
            state.ledger[req.idempotency_key] = req.precomputed_credits
            return SimpleNamespace(success=True, credits_deducted=req.precomputed_credits, message="ok")

    monkeypatch.setattr(app_db, "db_session", fake_session)
    monkeypatch.setattr(crs, "CreditRateService", lambda db: SimpleNamespace(get_effective_ratio=lambda: RATIO))
    monkeypatch.setattr(cs_mod, "CreditService", _Credits)

    ledger = led.AiVideoLedger(institute_id=INST, video_id="vid_1")
    ledger.charge(cost_usd=0.5, shot_idx=3, duration_s=6, audio_on=False)
    assert state.requests[-1].idempotency_key == "vid_1:aivideo:3:x:c0:r0"
    # a second charge of the same shot in the SAME leg (another inline
    # <aivideo> tag) is a separate, billable charge
    ledger.charge(cost_usd=0.5, shot_idx=3, duration_s=6, audio_on=False)
    assert state.requests[-1].idempotency_key == "vid_1:aivideo:3:x:c1:r0" and len(state.ledger) == 2
    # the resumed leg (a new ledger) charges the shot again → replayed key, no new debit
    resumed = led.AiVideoLedger(institute_id=INST, video_id="vid_1")
    resumed.charge(cost_usd=0.5, shot_idx=3, duration_s=6, audio_on=False)
    assert state.requests[-1].idempotency_key == "vid_1:aivideo:3:x:c0:r0" and len(state.ledger) == 2
    # a segment has its own key
    resumed.charge(cost_usd=0.5, shot_idx=3, duration_s=6, audio_on=False, segment_idx=0)
    assert state.requests[-1].idempotency_key == "vid_1:aivideo:3:0:c0:r0" and len(state.ledger) == 3
    # after the shot was refunded (one REFUND row) it is billable again
    state.refund_rows = 1
    again = led.AiVideoLedger(institute_id=INST, video_id="vid_1")
    again.charge(cost_usd=0.5, shot_idx=3, duration_s=6, audio_on=False)
    assert state.requests[-1].idempotency_key == "vid_1:aivideo:3:x:c0:r1" and len(state.ledger) == 4
    # a contact-sheet re-render of a sent-back shot is a new charge too
    state.refund_rows = 0
    regen = led.AiVideoLedger(institute_id=INST, video_id="vid_1")
    regen.regen_shots = {3}
    regen.charge(cost_usd=0.5, shot_idx=3, duration_s=6, audio_on=False)
    assert state.requests[-1].idempotency_key == "vid_1:aivideo:3:regen:x:c0:r0" and len(state.ledger) == 5
