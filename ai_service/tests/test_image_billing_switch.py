"""billing.image_registry_pricing: off (default) / shadow / on.

off    — the deduction call is exactly what it was (no precomputed credits,
         same model label, same metadata).
shadow — charged exactly as off; would_be_credits lands in the usage metadata
         (or an INFO log where there is no metadata).
on     — precomputed_credits = image_cost_usd(model that ran) x credit ratio.
A settings read error, or an unknown value, is off. No network, no DB.

Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_image_billing_switch.py -q
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services import image_model_resolver as imr  # noqa: E402
from ai_service.app.services import platform_settings_service as pss  # noqa: E402

GEMINI_IMG = "google/gemini-3.1-flash-image"
RATIO = Decimal("150")
PRICES = {GEMINI_IMG: 0.067, "recraft/recraft-v4.1-flash": 0.007}


@pytest.fixture
def billing(monkeypatch):
    """Mode via the real get_platform_setting path, registry price via stubbed
    image_cost_usd / usd_to_credits / db_session, and every deduction call
    captured from TokenUsageService."""
    from ai_service.app import db as app_db
    from ai_service.app.services import credit_service, provider_rates, token_usage_service

    state = SimpleNamespace(mode=None, setting_error=False, price_error=False, calls=[], sessions=0)

    def fake_setting(key, default=None, db=None):
        assert key == imr.IMAGE_PRICING_SETTING and db is None, "never on the caller's session"
        if state.setting_error:
            raise RuntimeError("ai_platform_settings unavailable")
        return default if state.mode is None else state.mode

    @contextmanager
    def fake_session():
        state.sessions += 1
        yield object()

    def fake_cost(model_id, db=None):
        if state.price_error:
            raise RuntimeError("ai_models unreadable")
        return PRICES.get(model_id, 0.04)

    def fake_usd_to_credits(self, usd):
        return (Decimal(str(usd)) * RATIO).quantize(Decimal("0.0001"))

    class FakeTokenUsage:
        def __init__(self, db):
            self.db = db

        def record_usage_and_deduct_credits(self, **kwargs):
            state.calls.append(kwargs)

    monkeypatch.setattr(pss, "get_platform_setting", fake_setting)
    monkeypatch.setattr(app_db, "db_session", fake_session)
    monkeypatch.setattr(provider_rates, "image_cost_usd", fake_cost)
    monkeypatch.setattr(credit_service.CreditService, "usd_to_credits", fake_usd_to_credits)
    monkeypatch.setattr(token_usage_service, "TokenUsageService", FakeTokenUsage)
    return state


# ── mode parsing ─────────────────────────────────────────────────────────────

def test_mode_defaults_to_off_and_unknown_values_are_off(billing):
    assert imr.image_pricing_mode() == "off"
    for raw, want in (("shadow", "shadow"), (" ON ", "on"), ("true", "off"), ("", "off"), (1, "off")):
        billing.mode = raw
        assert imr.image_pricing_mode() == want


def test_a_settings_read_error_is_off(billing):
    billing.mode = "on"
    billing.setting_error = True
    assert imr.image_pricing_mode() == "off"
    assert imr.plan_image_charge(GEMINI_IMG) == imr.ImageCharge("off")


def test_the_spec_is_registered_with_off_as_default():
    spec = pss.SETTING_SPECS["billing.image_registry_pricing"]
    assert spec.type == "enum" and spec.options == ("off", "shadow", "on") and spec.default() == "off"


def test_off_does_no_pricing_work_at_all(billing):
    assert imr.plan_image_charge(GEMINI_IMG, 3) == imr.ImageCharge("off")
    assert billing.sessions == 0


def test_registry_credits_scale_with_count(billing):
    assert imr.registry_image_credits(GEMINI_IMG, 1) == Decimal("10.0500")
    assert imr.registry_image_credits("recraft/recraft-v4.1-flash", 3) == Decimal("3.1500")
    assert imr.registry_image_credits(GEMINI_IMG, 0) is None


def test_metadata_is_untouched_when_off():
    base = {"feature": "x"}
    assert imr.ImageCharge("off").metadata(base) is base
    assert imr.ImageCharge("off").metadata(None) is None
    shadow = imr.ImageCharge("shadow", None, Decimal("10.05")).metadata(base)
    assert shadow == {"feature": "x", "would_be_credits": 10.05, "image_pricing_mode": "shadow"}
    assert base == {"feature": "x"}, "the caller's dict is not mutated"


# ── page builder ─────────────────────────────────────────────────────────────

def _pb(monkeypatch):
    from ai_service.app.routers import page_builder as pb

    monkeypatch.setattr(pb, "_image_model", lambda: GEMINI_IMG)
    return pb


def test_page_builder_off_is_exactly_todays_call(billing, monkeypatch):
    pb = _pb(monkeypatch)
    pb._bill_image(object(), "inst-1", "user-1")
    (call,) = billing.calls
    assert call["model"] == GEMINI_IMG
    assert call["metadata"] == {"feature": "page_builder_image"}
    assert call["precomputed_credits"] is None
    assert call["prompt_tokens"] == call["completion_tokens"] == call["total_tokens"] == 0
    assert call["institute_id"] == "inst-1" and call["user_id"] == "user-1"


def test_page_builder_shadow_charges_as_before_and_records_would_be(billing, monkeypatch):
    pb = _pb(monkeypatch)
    billing.mode = "shadow"
    pb._bill_image(object(), "inst-1", "user-1")
    (call,) = billing.calls
    assert call["precomputed_credits"] is None, "shadow never changes the charge"
    assert call["model"] == GEMINI_IMG
    assert call["metadata"] == {"feature": "page_builder_image", "would_be_credits": 10.05,
                                "image_pricing_mode": "shadow"}


def test_page_builder_on_charges_the_registry_price_of_the_model_that_ran(billing, monkeypatch):
    pb = _pb(monkeypatch)
    billing.mode = "on"
    pb._bill_image(object(), "inst-1", "user-1", model="recraft/recraft-v4.1-flash")
    (call,) = billing.calls
    assert call["precomputed_credits"] == Decimal("1.0500")
    assert call["model"] == "recraft/recraft-v4.1-flash"


def test_page_builder_on_without_a_registry_price_bills_as_before(billing, monkeypatch):
    pb = _pb(monkeypatch)
    billing.mode = "on"
    billing.price_error = True
    pb._bill_image(object(), "inst-1", "user-1")
    (call,) = billing.calls
    assert call["precomputed_credits"] is None
    assert call["metadata"] == {"feature": "page_builder_image"}


def test_page_builder_no_institute_still_bills_nothing(billing, monkeypatch):
    pb = _pb(monkeypatch)
    billing.mode = "on"
    pb._bill_image(object(), None, "user-1")
    assert billing.calls == []


# ── course assist ────────────────────────────────────────────────────────────

def test_course_assist_flat_five_unless_on(billing):
    from ai_service.app.routers import course_assist as ca

    assert ca._image_cost(GEMINI_IMG) == Decimal("5")
    billing.mode = "shadow"
    assert ca._image_cost(GEMINI_IMG) == Decimal("5")
    billing.mode = "on"
    assert ca._image_cost(GEMINI_IMG) == Decimal("10.0500")
    billing.price_error = True
    assert ca._image_cost(GEMINI_IMG) == Decimal("5")


# ── course outline banners ───────────────────────────────────────────────────

def _outline(monkeypatch):
    from ai_service.app.services import course_outline_service as cos
    from ai_service.app.services import image_service, token_usage_service

    monkeypatch.setattr(image_service, "resolve_image_model", lambda override=None: "recraft/recraft-v4.1-flash")
    # The module imported the class by name; point it at the fixture's stub.
    monkeypatch.setattr(cos, "TokenUsageService", token_usage_service.TokenUsageService)
    svc = object.__new__(cos.CourseOutlineGenerationService)
    svc._db_session = object()
    return svc


_REQ = SimpleNamespace(institute_id="inst-1", user_id="user-1")
_URLS = ["https://b", "https://p", None]


def test_outline_off_keeps_the_gemini_label_and_the_zero_token_skip(billing, monkeypatch):
    svc = _outline(monkeypatch)
    svc._bill_outline_images(_REQ, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}, _URLS)
    assert billing.calls == [], "zero tokens: unbilled, exactly as before"
    svc._bill_outline_images(_REQ, {"prompt_tokens": 3, "completion_tokens": 7, "total_tokens": 10}, _URLS,
                             request_id="r1")
    (call,) = billing.calls
    assert call["model"] == GEMINI_IMG and "precomputed_credits" not in call
    assert call["metadata"] is None and call["request_id"] == "r1"
    assert call["total_tokens"] == 10


def test_outline_shadow_bills_as_before(billing, monkeypatch):
    svc = _outline(monkeypatch)
    billing.mode = "shadow"
    svc._bill_outline_images(_REQ, {"total_tokens": 0}, _URLS)
    assert billing.calls == []
    svc._bill_outline_images(_REQ, {"prompt_tokens": 3, "completion_tokens": 7, "total_tokens": 10}, _URLS)
    (call,) = billing.calls
    assert call["model"] == GEMINI_IMG and "precomputed_credits" not in call
    assert call["metadata"]["would_be_credits"] == 2.1


def test_outline_on_charges_every_image_even_with_zero_tokens(billing, monkeypatch):
    svc = _outline(monkeypatch)
    billing.mode = "on"
    svc._bill_outline_images(_REQ, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}, _URLS,
                             request_id="r2")
    (call,) = billing.calls
    assert call["model"] == "recraft/recraft-v4.1-flash", "the resolved model, not the gemini label"
    assert call["precomputed_credits"] == Decimal("2.1000")  # 2 images x 0.007 x 150
    assert call["metadata"]["image_count"] == 2 and call["request_id"] == "r2"


def test_outline_on_with_no_images_bills_nothing(billing, monkeypatch):
    svc = _outline(monkeypatch)
    billing.mode = "on"
    svc._bill_outline_images(_REQ, {"total_tokens": 0}, [None, None, None])
    assert billing.calls == []
