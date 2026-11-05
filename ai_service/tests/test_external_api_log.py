"""Serper queries reach external_api_call_log, and key accounts never expose a key.

Offline: no database and no network. Modules load from their files so these tests do not
need the service's dependencies.

Run from the repo root:
    <venv>/bin/python -m pytest ai_service/tests/test_external_api_log.py -q
"""
from __future__ import annotations

import importlib.util
import io
import json
import sys
import types
import urllib.error
from pathlib import Path

import pytest

APP_DIR = Path(__file__).resolve().parent.parent / "app"
KEY = "sk-serper-secret-value-ab12"
OTHER_KEY = "sk-serper-secret-value-cd34"


def _load(name: str, path: Path, package: str = ""):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    module.__package__ = package
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def key_modules():
    package = types.ModuleType("keys_pkg")
    package.__path__ = [str(APP_DIR / "services")]
    sys.modules["keys_pkg"] = package
    _load("keys_pkg.external_api_log", APP_DIR / "services" / "external_api_log.py", "keys_pkg")
    return _load("keys_pkg.external_api_keys", APP_DIR / "services" / "external_api_keys.py", "keys_pkg")


@pytest.fixture()
def serper(monkeypatch):
    calls = []
    package = types.ModuleType("app.services.external_api_log")
    package.record_external_call = lambda **kwargs: calls.append(kwargs) or True
    monkeypatch.setitem(sys.modules, "app", types.ModuleType("app"))
    monkeypatch.setitem(sys.modules, "app.services", types.ModuleType("app.services"))
    monkeypatch.setitem(sys.modules, "app.services.external_api_log", package)
    module = _load("serper_service_under_test", APP_DIR / "ai-video-gen-main" / "serper_service.py")
    monkeypatch.setattr(module.time, "sleep", lambda _: None)
    return module, calls


class _Response(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def _answer(module, monkeypatch, *outcomes):
    queue = list(outcomes)

    def fake_urlopen(_req, timeout=None):
        outcome = queue.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return _Response(json.dumps(outcome).encode())

    monkeypatch.setattr(module.urllib.request, "urlopen", fake_urlopen)


def test_success_is_logged_once_and_cache_hit_is_not(serper, monkeypatch):
    module, calls = serper
    svc = module.SerperService(KEY)
    svc.set_run_context("inst-1")
    svc._run_id = "run-1"
    _answer(module, monkeypatch, {"images": [{}, {}], "credits": 2})

    payload = {"q": "strait of hormuz", "num": 20}
    assert svc._request(module.SerperService.IMAGES_URL, payload)["credits"] == 2
    assert svc._request(module.SerperService.IMAGES_URL, payload)["credits"] == 2

    assert len(calls) == 1
    call = calls[0]
    assert call["vendor"] == "serper"
    assert call["operation"] == "images"
    assert call["status"] == "SUCCESS"
    assert call["http_status"] == 200
    assert call["institute_id"] == "inst-1"
    assert call["run_id"] == "run-1"
    assert call["request_summary"] == payload
    assert call["response_summary"] == {"images": 2, "credits": 2}
    assert call["credential"] == "SERPER_API_KEYS"
    assert call["credits"] == 2


def test_every_attempt_is_logged_when_a_key_is_rotated(serper, monkeypatch):
    module, calls = serper
    svc = module.SerperService(f"{KEY},{OTHER_KEY}")
    limited = urllib.error.HTTPError("u", 429, "Too Many", {}, None)
    _answer(module, monkeypatch, limited, {"organic": []})

    svc._request(module.SerperService.SEARCH_URL, {"q": "x"})

    assert [c["status"] for c in calls] == ["FAILED", "SUCCESS"]
    assert [c["api_key"] for c in calls] == [KEY, OTHER_KEY]
    assert calls[0]["http_status"] == 429


def test_a_broken_logger_does_not_break_the_search(serper, monkeypatch):
    module, _ = serper

    def boom(**_):
        raise RuntimeError("no database")

    monkeypatch.setattr(sys.modules["app.services.external_api_log"], "record_external_call", boom)
    svc = module.SerperService(KEY)
    _answer(module, monkeypatch, {"images": []})

    assert svc._request(module.SerperService.IMAGES_URL, {"q": "x"}) == {"images": []}


def test_key_rows_hold_a_hint_but_never_the_key(key_modules):
    env = {"SERPER_API_KEYS": f"{KEY}, {OTHER_KEY}", "FAL_API_KEY": "short"}
    rows = key_modules.platform_key_rows(env, {})

    assert KEY not in json.dumps(rows) and OTHER_KEY not in json.dumps(rows) and "short" not in json.dumps(rows)
    serper_rows = [r for r in rows if r["credential"] == "SERPER_API_KEYS"]
    assert [r["key_hint"] for r in serper_rows] == ["ab12", "cd34"]
    assert next(r for r in rows if r["credential"] == "FAL_API_KEY")["key_hint"] == "****"


def test_owner_is_unknown_unless_someone_declared_it(key_modules):
    details = {
        "SERPER_API_KEYS:ab12": {"account": "ops@example.com", "price": 0.001, "price_unit": "credit", "currency": "USD"},
        "FAL_API_KEY": {"account": "media@example.com"},
    }
    env = {"SERPER_API_KEYS": f"{KEY},{OTHER_KEY}", "FAL_API_KEY": "fal-secret-value-9999"}
    rows = key_modules.platform_key_rows(env, details)

    by_hint = {r["key_hint"]: r for r in rows if r["credential"] == "SERPER_API_KEYS"}
    assert (by_hint["ab12"]["owner"], by_hint["ab12"]["owner_source"]) == ("ops@example.com", "declared")
    assert by_hint["ab12"]["price"] == 0.001
    assert by_hint["ab12"]["details_key"] == "SERPER_API_KEYS:ab12"
    assert (by_hint["cd34"]["owner"], by_hint["cd34"]["owner_source"], by_hint["cd34"]["price"]) == (None, "unknown", None)
    assert next(r for r in rows if r["credential"] == "FAL_API_KEY")["owner"] == "media@example.com"


def test_owner_on_the_key_outranks_one_entered_by_staff(key_modules):
    row = key_modules.key_row(
        vendor="anthropic", credential="llm_provider_keys: Main", service="ai", configured=True, hint="a1b2",
        entry={"account": "typed by staff", "price": 5, "price_unit": "month", "currency": "USD"},
        stored_owner="Anthropic org", details_credential="llm_provider_keys",
    )

    assert (row["owner"], row["owner_source"]) == ("Anthropic org", "stored")
    assert row["details_key"] == "llm_provider_keys:a1b2"
    assert row["price"] == 5


@pytest.mark.parametrize(
    "unit, credits, expected",
    [
        ("credit", 2, 0.02),
        ("1000_credits", 2, 0.00002),
        ("request", 2, 0.01),
        ("1000_requests", 2, 0.00001),
        ("month", 2, None),
        ("other", 2, None),
    ],
)
def test_per_call_cost_follows_the_price_unit(key_modules, unit, credits, expected):
    entry = {"price": 0.01, "price_unit": unit, "currency": "INR"}
    cost = key_modules.per_call_cost(entry, credits=credits)

    if expected is None:
        assert cost is None
    else:
        assert cost == (pytest.approx(expected), "INR")


@pytest.mark.parametrize("entry", [{}, {"price": 0, "price_unit": "credit", "currency": "USD"}, {"price": 1, "price_unit": "credit"}])
def test_no_price_means_no_cost(key_modules, entry):
    assert key_modules.per_call_cost(entry) is None


def test_key_price_falls_back_to_its_variable(key_modules):
    details = {"SERPER_API_KEYS": {"price": 1}, "SERPER_API_KEYS:ab12": {"price": 2}}

    assert key_modules.resolve_details(details, "SERPER_API_KEYS", "ab12")["price"] == 2
    assert key_modules.resolve_details(details, "SERPER_API_KEYS", "cd34")["price"] == 1
    assert key_modules.resolve_details(details, "FAL_API_KEY", "ab12") == {}


def _clean(key_modules, **overrides):
    values = {"account": None, "price": None, "price_unit": None, "currency": None, "notes": None, "secrets": [KEY]}
    return key_modules.clean_details(**{**values, **overrides})


def test_clean_details_keeps_what_was_filled_in(key_modules):
    entry = _clean(key_modules, account=" ops@example.com ", price=0.5, price_unit="month", currency="INR", notes=" plan ")

    assert entry == {"account": "ops@example.com", "notes": "plan", "price": 0.5, "price_unit": "month", "currency": "INR"}
    assert _clean(key_modules, account="  ") == {}


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"account": f"mine {KEY}"}, "API key"),
        ({"notes": KEY}, "API key"),
        ({"price": 1, "currency": "USD"}, "per"),
        ({"price": 1, "price_unit": "credit"}, "currency"),
        ({"price": -1, "price_unit": "credit", "currency": "USD"}, "between"),
        ({"account": "x" * 201}, "Account"),
    ],
)
def test_clean_details_refuses_bad_input(key_modules, overrides, message):
    with pytest.raises(ValueError, match=message):
        _clean(key_modules, **overrides)


def test_unset_key_and_other_service_key_are_reported_honestly(key_modules):
    rows = key_modules.platform_key_rows({}, {})

    assert next(r for r in rows if r["credential"] == "SERPER_API_KEYS")["configured"] is False
    assert next(r for r in rows if r["credential"] == "cloudflare.api.token")["configured"] is None


@pytest.mark.parametrize("raw", ["not json", "[1]", None, '{"A": "not an entry"}'])
def test_unreadable_details_setting_means_nothing_entered(key_modules, raw):
    assert key_modules.parse_details(raw) == {}


def test_openrouter_identity_drops_the_label(key_modules):
    identity = key_modules.openrouter_identity({"data": {"label": "sk-or-v1-abc...", "creator_user_id": "user_1"}})

    assert identity["creator_user_id"] == "user_1"
    assert "label" not in identity


def test_find_openrouter_key_matches_only_its_own_hint(key_modules):
    env = {"OPENROUTER_API_KEY": KEY}

    assert key_modules.find_openrouter_key("ab12", env) == KEY
    assert key_modules.find_openrouter_key("zzzz", env) is None
