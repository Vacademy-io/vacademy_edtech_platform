"""Release 2 — every feature's model from the DB, GLM by default, super-admin control.

Covers, offline (no DB, no network):
  * model_selection: GLM hard fallback, the NON_GLM tail, the 30 s per-use-case
    cache (hit / TTL / invalidate / failed reads not cached), resolve_model_sync
  * llm_router.chat_with_chain: reasoning low + max_tokens headroom on BOTH the
    Isoquant and the OpenRouter leg, walking to the next model on failure or an
    empty answer, ChainExhausted, registry id + usage in the result
  * /super-admin/v1/models/* (catalog, PATCH defaults, bulk, stages, change log,
    overrides) against an in-memory DB double, incl. the staff gate and the 503
    while ai_model_change_log is missing
  * /models/v2 route order (PATCH /defaults/{use_case} no longer shadowed) and
    update_use_case_default's 404 / explicit-null fixes
  * /internal/llm/v1/complete and the /chat/v1/complete + /ask auth fix
  * the V569 Flyway seed list matches the catalog

Run from the repo root:
    <venv>/bin/python -m pytest ai_service/tests/test_model_defaults_r2.py -q
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")
os.environ.setdefault("ISOQUANT_API_KEY", "iq-key")
REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from ai_service.app.config import get_settings  # noqa: E402
from ai_service.app.constants import model_use_cases as muc  # noqa: E402
from ai_service.app.constants.model_defaults import GLM_DEFAULT, NON_GLM_FALLBACK  # noqa: E402
from ai_service.app.core.security import get_current_user  # noqa: E402
from ai_service.app.db import db_dependency  # noqa: E402
from ai_service.app.schemas.auth import CustomUserDetails  # noqa: E402
from ai_service.app.services import llm_router, model_selection as ms  # noqa: E402

GLM = GLM_DEFAULT
GEMINI = NON_GLM_FALLBACK
STAFF = "staff-1"
INST = "11111111-1111-1111-1111-111111111111"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    ms.invalidate_cache()
    llm_router._FAILED_UNTIL.clear()
    s = get_settings()
    monkeypatch.setattr(s, "super_admin_user_ids", STAFF, raising=False)
    monkeypatch.setattr(s, "internal_service_token", "svc-token", raising=False)
    monkeypatch.setattr(s, "openrouter_api_key", "or-platform", raising=False)
    monkeypatch.setattr(s, "isoquant_api_key", "iq-key", raising=False)
    monkeypatch.setattr(llm_router, "model_routes", lambda: llm_router.parse_routes({GLM: "isoquant"}))
    yield
    ms.invalidate_cache()


class _Res:
    def __init__(self, rows=(), scalar=None):
        self._rows = list(rows)
        self._scalar = scalar

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._scalar


# ── resolver ────────────────────────────────────────────────────────────────

class RowDB:
    """Answers the resolver's single ai_model_defaults read; counts reads."""

    def __init__(self, rows=None, fail=False, active=()):
        self.rows = rows or {}
        self.fail = fail
        self.reads = 0
        self.active = set(active)

    def execute(self, stmt, params=None):
        sql = getattr(stmt, "text", str(stmt))
        if "FROM ai_model_defaults" in sql:
            self.reads += 1
            if self.fail:
                raise RuntimeError("db down")
            row = self.rows.get(params["uc"])
            return _Res([SimpleNamespace(default_model_id=row[0], fallback_model_id=row[1])] if row else [])
        raise AssertionError(sql)


@pytest.fixture
def _no_registry(monkeypatch):
    class _Svc:
        def __init__(self, db):
            self.db = db

        def get_model_by_id(self, model_id):
            return SimpleNamespace(is_active=model_id in getattr(self.db, "active", ()))

    monkeypatch.setattr(ms, "AIModelsService", _Svc)


def test_missing_row_resolves_glm_then_non_glm(_no_registry):
    assert ms.DEFAULT_HARD_FALLBACK == GLM
    assert ms.resolve_models(RowDB(), "kb_companion") == (GLM, [GEMINI])


def test_row_chain_is_kept_and_tail_only_added_when_all_glm(_no_registry):
    db = RowDB({"chat": (GLM, GEMINI), "x": (GLM, "z-ai/glm-5.3-flash:batch"), "y": ("openai/gpt-5.6-luna", GLM)})
    assert ms.resolve_models(db, "chat") == (GLM, [GEMINI])
    assert ms.resolve_models(db, "x") == (GLM, ["z-ai/glm-5.3-flash:batch", GEMINI])
    assert ms.resolve_models(db, "y") == ("openai/gpt-5.6-luna", [GLM])


def test_preferred_active_model_first_and_custom_hard_fallback(_no_registry):
    db = RowDB({"page_builder": (GLM, None)}, active={"anthropic/claude-sonnet-5"})
    assert ms.resolve_models(db, "page_builder", "anthropic/claude-sonnet-5") == (
        "anthropic/claude-sonnet-5", [GLM])
    assert ms.resolve_models(db, "page_builder", "dead/model") == (GLM, [GEMINI])
    assert ms.resolve_models(RowDB(), "reels_selection", hard_fallback="anthropic/claude-3-5-haiku") == (
        "anthropic/claude-3-5-haiku", [])


def test_cache_ttl_and_invalidate(_no_registry, monkeypatch):
    db = RowDB({"chat": (GLM, GEMINI)})
    clock = [1000.0]
    monkeypatch.setattr(ms.time, "monotonic", lambda: clock[0])
    ms.resolve_models(db, "chat")
    db.rows["chat"] = (GEMINI, None)
    assert ms.resolve_models(db, "chat") == (GLM, [GEMINI]) and db.reads == 1, "cached within 30 s"
    clock[0] += ms.CACHE_TTL_SECONDS + 1
    assert ms.resolve_models(db, "chat")[0] == GEMINI and db.reads == 2, "TTL expired"
    db.rows["chat"] = (GLM, None)
    ms.invalidate_cache("chat")
    assert ms.resolve_models(db, "chat") == (GLM, [GEMINI]) and db.reads == 3


def test_failed_read_is_not_cached(_no_registry):
    db = RowDB({"chat": (GEMINI, None)}, fail=True)
    assert ms.resolve_models(db, "chat") == (GLM, [GEMINI])
    db.fail = False
    assert ms.resolve_models(db, "chat") == (GEMINI, [GLM])


def test_resolve_model_sync(monkeypatch, _no_registry):
    from contextlib import contextmanager
    import ai_service.app.db as dbmod

    db = RowDB({"html_document": ("qwen/qwen3.6-27b", None)})

    @contextmanager
    def fake_session():
        yield db

    monkeypatch.setattr(dbmod, "db_session", fake_session)
    assert ms.resolve_model_sync("html_document") == ("qwen/qwen3.6-27b", [GLM])
    assert ms.resolve_model_sync("html_document") == ("qwen/qwen3.6-27b", [GLM]) and db.reads == 1

    @contextmanager
    def broken():
        raise RuntimeError("no DATABASE_URL")
        yield  # pragma: no cover

    monkeypatch.setattr(dbmod, "db_session", broken)
    ms.invalidate_cache()
    assert ms.resolve_model_sync("anything") == (GLM, [GEMINI])


# ── chat_with_chain ─────────────────────────────────────────────────────────

def _completion(content="ok", model="glm-5.3-flash"):
    return {"model": model, "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7}}


def _run_chain(handler, payload, **kw):
    calls = []

    def wrapped(request):
        calls.append((str(request.url), json.loads(request.content or b"{}")))
        return handler(request)

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(wrapped)) as client:
            return await llm_router.chat_with_chain(payload, client=client, **kw)

    return asyncio.run(go()), calls


def test_chain_glm_on_isoquant_gets_low_effort_and_headroom():
    result, calls = _run_chain(lambda r: httpx.Response(200, json=_completion("hi")),
                               {"messages": [{"role": "user", "content": "x"}], "max_tokens": 300},
                               models=[GLM, GEMINI])
    url, wire = calls[0]
    assert url.startswith("https://api.isoquant.ai/")
    assert wire["model"] == "glm-5.3-flash" and wire["reasoning_effort"] == "low"
    assert wire["max_tokens"] == 3000 + 2000, "max(300,3000) + min(max(300,2000),12000)"
    assert result.content == "hi" and result.model == GLM and result.router == "isoquant"
    assert result.usage["total_tokens"] == 7 and len(calls) == 1


def test_chain_openrouter_leg_also_sends_reasoning_low():
    def handler(request):
        if "isoquant" in str(request.url):
            return httpx.Response(503, text="down")
        return httpx.Response(200, json=_completion("from or", GLM))

    result, calls = _run_chain(handler, {"messages": [], "max_tokens": 8000}, models=[GLM, GEMINI])
    assert len(calls) == 2
    or_wire = calls[1][1]
    assert or_wire["model"] == GLM
    assert or_wire["reasoning"] == {"enabled": True, "effort": "low"}
    assert or_wire["max_tokens"] == 8000 + 8000
    assert result.model == GLM and result.router == "openrouter"


def test_chain_walks_to_non_glm_on_failure_and_on_empty_answer():
    def handler(request):
        body = json.loads(request.content)
        if body["model"] in ("glm-5.3-flash", GLM):
            return httpx.Response(200, json={"choices": [{"message": {"content": ""}, "finish_reason": "length"}]})
        return httpx.Response(200, json=_completion("gemini says", GEMINI))

    payload = {"messages": [{"role": "user", "content": "x"}], "max_tokens": 50, "temperature": 0.2}
    result, calls = _run_chain(handler, payload, models=[GLM, GEMINI])
    assert result.model == GEMINI and result.content == "gemini says"
    gem_wire = calls[-1][1]
    assert "reasoning" not in gem_wire and gem_wire["max_tokens"] == 50, "non-GLM payload untouched"
    assert result.attempts and result.attempts[0][0] == GLM
    assert payload == {"messages": [{"role": "user", "content": "x"}], "max_tokens": 50, "temperature": 0.2}


def test_chain_exhausted_and_transport_errors():
    def handler(request):
        if "isoquant" in str(request.url):
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(500, text="boom")

    with pytest.raises(llm_router.ChainExhausted) as e:
        _run_chain(handler, {"messages": []}, models=[GLM, GEMINI], use_case="chat")
    assert [m for m, _ in e.value.attempts] == [GLM, GEMINI]


def test_chain_resolves_use_case_with_session(monkeypatch):
    seen = {}

    def fake_resolve(db, use_case, preferred_model=None, hard_fallback=None):
        seen.update(db=db, use_case=use_case, preferred=preferred_model)
        return GEMINI, [GLM]

    monkeypatch.setattr(ms, "resolve_models", fake_resolve)
    sentinel = object()
    result, calls = _run_chain(lambda r: httpx.Response(200, json=_completion("x", GEMINI)),
                               {"messages": []}, use_case="class_report", db=sentinel, preferred_model="p/m")
    assert seen == {"db": sentinel, "use_case": "class_report", "preferred": "p/m"}
    assert result.model == GEMINI and calls[0][1]["model"] == GEMINI


def test_chain_resolves_use_case_without_session(monkeypatch):
    seen = []
    monkeypatch.setattr(ms, "resolve_model_sync",
                        lambda use_case, preferred_model=None, hard_fallback=None: seen.append(use_case) or (GLM, [GEMINI]))
    result, calls = _run_chain(lambda r: httpx.Response(200, json=_completion("x")), {"messages": []},
                               use_case="assistant")
    assert seen == ["assistant"] and result.model == GLM


def test_chain_explicit_reasoning_effort_and_sync_variant(monkeypatch):
    p = llm_router.chain_payload(GLM, {"messages": [], "max_tokens": 100}, reasoning_effort="high")
    assert p["reasoning"] == {"enabled": True, "effort": "high"}
    assert llm_router.chain_payload(GEMINI, {"messages": []}, reasoning_effort="high") == {
        "messages": [], "model": GEMINI}

    def fake_post_sync(payload, api_key=None, timeout=60.0):
        req = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
        if payload["model"] == GLM:
            return httpx.Response(429, text="rate", request=req)
        return httpx.Response(200, json=_completion("sync", GEMINI), request=req)

    monkeypatch.setattr(llm_router, "post_chat_sync", fake_post_sync)
    out = llm_router.chat_with_chain_sync({"messages": []}, models=[GLM, GEMINI])
    assert out.model == GEMINI and out.content == "sync"


# ── super-admin model endpoints ─────────────────────────────────────────────

NOW = datetime(2026, 10, 13, 9, 0, tzinfo=timezone.utc)


def _model(model_id, category="general", active=True, inp="0.075000", out="0.250000", order=10):
    return SimpleNamespace(model_id=model_id, name=model_id.split("/")[-1], provider=model_id.split("/")[0],
                           category=category, input_price_per_1m=Decimal(inp), output_price_per_1m=Decimal(out),
                           is_active=active, display_order=order)


class ModelDB:
    """In-memory ai_models / ai_model_defaults / stage matrix / change log /
    ai_api_keys, answering model_defaults_admin's statements by their text."""

    def __init__(self, change_log=True):
        self.models = {m.model_id: m for m in (
            _model(GLM), _model(GEMINI, inp="0.3", out="2.5"), _model("openai/gpt-5.6-luna"),
            _model("old/dead-model", active=False), _model("qwen/qwen-image-3", category="image"),
        )}
        self.defaults = {
            "chat": {"default_model_id": GLM, "fallback_model_id": GEMINI, "free_tier_model_id": None},
            "analytics": {"default_model_id": GEMINI, "fallback_model_id": "openai/gpt-5.6-luna",
                          "free_tier_model_id": None},
            "student_report": {"default_model_id": "openai/gpt-5.6-luna", "fallback_model_id": GLM,
                               "free_tier_model_id": None},
            "image": {"default_model_id": "qwen/qwen-image-3", "fallback_model_id": None, "free_tier_model_id": None},
            "legacy_thing": {"default_model_id": GEMINI, "fallback_model_id": None, "free_tier_model_id": None},
        }
        for v in self.defaults.values():
            v["updated_at"] = NOW
        self.stages = [SimpleNamespace(stage_id=s, quality_tier=t, model_id=GEMINI, fallback_model_id=None,
                                       user_overridable=s == "shot_planner", is_active=True, updated_at=NOW)
                       for s in ("shot_planner", "vision_review") for t in ("ultra", "free", "standard")]
        self.stages[-1].model_id = GLM  # vision_review/standard already GLM
        self.change_log_exists = change_log
        self.log = []
        self.api_keys = [
            SimpleNamespace(id="k1", institute_id=INST, user_id=None, default_model="xiaomi/mimo-v2-flash:free",
                            openai_key=None, gemini_key=None, is_active=True),
            SimpleNamespace(id="k2", institute_id=None, user_id="u-9", default_model="google/gemini-2.5-pro",
                            openai_key="sk-secret", gemini_key=None, is_active=True),
        ]
        self.commits = 0
        self.rollbacks = 0
        self.writes = []
        self.statements = []

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def _default_row(self, uc):
        d = self.defaults[uc]
        return SimpleNamespace(use_case=uc, **d)

    def execute(self, stmt, params=None):
        sql = " ".join(getattr(stmt, "text", str(stmt)).split())
        p = params or {}
        self.statements.append(sql)
        if sql.startswith("SELECT to_regclass"):
            return _Res(scalar=self.change_log_exists)
        if sql.startswith("SELECT use_case, default_model_id") and "FROM ai_model_defaults" in sql:
            if "WHERE use_case = :uc" in sql:
                return _Res([self._default_row(p["uc"])] if p["uc"] in self.defaults else [])
            return _Res([self._default_row(k) for k in self.defaults])
        if sql.startswith("SELECT model_id, name, provider"):
            return _Res(sorted(self.models.values(), key=lambda m: (m.display_order, m.name)))
        if sql.startswith("SELECT model_id, is_active, category FROM ai_models"):
            m = self.models.get(p["m"])
            return _Res([m] if m else [])
        if sql.startswith("INSERT INTO ai_model_defaults"):
            self.writes.append(("insert", p["uc"]))
            self.defaults[p["uc"]] = {"default_model_id": p["d"], "fallback_model_id": p["f"],
                                      "free_tier_model_id": p["ft"], "updated_at": NOW}
            return _Res()
        if sql.startswith("UPDATE ai_model_defaults SET"):
            self.writes.append(("update", p["uc"]))
            row = self.defaults[p["uc"]]
            if "default_model_id = :d," in sql:
                row["default_model_id"], row["fallback_model_id"] = p["d"], p["f"]
            else:
                for f in ("default_model_id", "fallback_model_id", "free_tier_model_id"):
                    if f in p:
                        row[f] = p[f]
            return _Res()
        if sql.startswith("INSERT INTO ai_model_change_log"):
            if not self.change_log_exists:
                raise RuntimeError("relation ai_model_change_log does not exist")
            self.log.append(SimpleNamespace(
                id=len(self.log) + 1, table_name=p["table_name"], row_key=p["row_key"], old_value=p["old_value"],
                new_value=p["new_value"], reason=p["reason"], actor=p["actor"], created_at=NOW))
            return _Res()
        if "FROM ai_model_change_log" in sql:
            if not self.change_log_exists:
                raise RuntimeError("relation ai_model_change_log does not exist")
            rows = list(reversed(self.log))
            if sql.startswith("SELECT DISTINCT ON"):
                rows = [r for r in rows if r.table_name == "ai_model_defaults"
                        and (not p.get("uc") or r.row_key == p["uc"])]
                latest = {}
                for r in rows:
                    latest.setdefault(r.row_key, r)
                return _Res(list(latest.values()))
            if p.get("uc"):
                rows = [r for r in rows if r.row_key == p["uc"] or r.row_key.startswith(p["uc"] + "/")]
            return _Res(rows[: p["limit"]])
        if sql.startswith("SELECT stage_id, quality_tier"):
            return _Res(sorted(self.stages, key=lambda r: (r.stage_id, r.quality_tier)) if p["uc"] == "video" else [])
        if sql.startswith("UPDATE ai_model_stage_assignments"):
            for r in self.stages:
                if r.quality_tier == p["tier"] and r.stage_id == p["stage"]:
                    r.model_id = p["m"]
            self.writes.append(("stage", p["tier"], p["stage"]))
            return _Res()
        if "FROM ai_api_keys" in sql:
            return _Res([SimpleNamespace(id=k.id, institute_id=k.institute_id, user_id=k.user_id,
                                         default_model=k.default_model,
                                         has_own_key=bool(k.openai_key or k.gemini_key))
                         for k in self.api_keys if k.default_model])
        raise AssertionError(f"unexpected statement {sql!r}")


def _app(db, user_id=STAFF):
    from ai_service.app.routers.super_admin_models import router

    app = FastAPI()
    app.include_router(router, prefix="/ai-service")
    app.dependency_overrides[db_dependency] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: CustomUserDetails(username="u", user_id=user_id)
    return TestClient(app)


BASE = "/ai-service/super-admin/v1/models"


@pytest.mark.parametrize("method,path,body", [
    ("get", "/catalog", None),
    ("patch", "/defaults/chat", {"default_model_id": GLM, "reason": "x"}),
    ("post", "/defaults/bulk", {"model_id": GLM, "dry_run": True, "reason": "x"}),
    ("get", "/stages?use_case=video", None),
    ("patch", "/stages", {"use_case": "video", "stage_id": "shot_planner", "quality_tiers": ["*"],
                          "model_id": GLM, "reason": "x"}),
    ("post", "/stages/bulk", {"use_case": "video", "model_id": GLM, "dry_run": True, "reason": "x"}),
    ("get", "/change-log", None),
    ("get", "/overrides", None),
])
def test_every_endpoint_is_staff_only(method, path, body):
    db = ModelDB()
    client = _app(db, user_id="institute-admin")
    resp = getattr(client, method)(BASE + path, **({"json": body} if body is not None else {}))
    assert resp.status_code == 403
    assert not db.writes and not db.log


def test_catalog_merges_rows_models_routes_and_last_change():
    db = ModelDB()
    client = _app(db)
    client.patch(f"{BASE}/defaults/chat", json={"fallback_model_id": None, "reason": "no fallback"})
    data = client.get(f"{BASE}/catalog").json()
    by = {u["use_case"]: u for u in data["use_cases"]}
    assert set(muc.USE_CASE_CATALOG) <= set(by)
    assert by["legacy_thing"]["group"] == "Other" and by["legacy_thing"]["row"]["default_model_id"] == GEMINI
    assert by["kb_companion"]["row"] is None and by["kb_companion"]["group"] == "Learner AI"
    chat = by["chat"]
    assert chat["row"] == {"default_model_id": GLM, "fallback_model_id": None, "free_tier_model_id": None,
                           "updated_at": NOW.isoformat()}
    assert chat["last_change"]["reason"] == "no fallback" and chat["last_change"]["actor"] == STAFF
    assert by["student_report"]["held_reason"].startswith("GLM timed out >170 s")
    assert by["copy_check_deduction"]["description"] == "Re-reads cropped handwritten marks — affects student marks"
    assert by["copy_check_deduction"]["kind"] == "vision"
    assert all(u["kind"] in ("chat", "vision", "image") for u in data["use_cases"])
    assert all(set(u) >= {"use_case", "label", "group", "service", "kind", "description", "consumers",
                          "held_reason", "row", "last_change"} for u in data["use_cases"])
    glm = next(m for m in data["models"] if m["model_id"] == GLM)
    assert glm["input_price_per_1m"] == "0.075000" and glm["output_price_per_1m"] == "0.250000"
    assert set(glm) == {"model_id", "name", "provider", "category", "input_price_per_1m",
                        "output_price_per_1m", "is_active"}
    assert data["routes"] == {GLM: "isoquant"}
    assert data["platform_default_model"] == GLM


def test_catalog_works_without_change_log_table():
    data = _app(ModelDB(change_log=False)).get(f"{BASE}/catalog").json()
    assert all(u["last_change"] is None for u in data["use_cases"])


def test_patch_only_present_fields_and_explicit_null():
    db = ModelDB()
    client = _app(db)
    resp = client.patch(f"{BASE}/defaults/analytics", json={"default_model_id": GLM, "reason": "cheaper"})
    assert resp.status_code == 200, resp.text
    assert db.defaults["analytics"]["fallback_model_id"] == "openai/gpt-5.6-luna", "untouched"
    body = resp.json()
    assert body["use_case"] == "analytics" and body["row"]["default_model_id"] == GLM
    log = db.log[-1]
    assert log.table_name == "ai_model_defaults" and log.row_key == "analytics" and log.actor == STAFF
    assert json.loads(log.old_value)["default_model_id"] == GEMINI
    assert json.loads(log.new_value) == {"default_model_id": GLM, "fallback_model_id": "openai/gpt-5.6-luna",
                                         "free_tier_model_id": None}
    client.patch(f"{BASE}/defaults/analytics", json={"fallback_model_id": None, "reason": "clear"})
    assert db.defaults["analytics"]["fallback_model_id"] is None
    assert db.defaults["analytics"]["default_model_id"] == GLM


def test_patch_creates_missing_row_and_busts_cache(_no_registry):
    db = ModelDB()
    client = _app(db)
    # Prime the resolver cache with the "no row" answer.
    assert ms.resolve_models(RowDB(), "copy_check_deduction") == (GLM, [GEMINI])
    resp = client.patch(f"{BASE}/defaults/copy_check_deduction", json={"fallback_model_id": GEMINI, "reason": "x"})
    assert resp.status_code == 422 and "default_model_id is required" in resp.json()["detail"]
    resp = client.patch(f"{BASE}/defaults/copy_check_deduction",
                        json={"default_model_id": GEMINI, "reason": "revert marks re-check"})
    assert resp.status_code == 200
    assert db.defaults["copy_check_deduction"]["default_model_id"] == GEMINI
    assert db.log[-1].old_value is None
    assert ms._cache_get("copy_check_deduction") is None, "this pod's cache was invalidated"


@pytest.mark.parametrize("body,status,frag", [
    ({"default_model_id": "nope/x", "reason": "x"}, 422, "unknown model"),
    ({"default_model_id": "old/dead-model", "reason": "x"}, 422, "not active"),
    ({"default_model_id": "qwen/qwen-image-3", "reason": "x"}, 422, "not a chat model"),
    ({"default_model_id": GLM, "reason": "   "}, 422, "reason is required"),
    ({"default_model_id": None, "reason": "x"}, 422, "cannot be cleared"),
    ({"reason": "x"}, 422, "nothing to change"),
])
def test_patch_validation(body, status, frag):
    db = ModelDB()
    resp = _app(db).patch(f"{BASE}/defaults/chat", json=body)
    assert resp.status_code == status and frag in resp.json()["detail"]
    assert not db.writes


def test_patch_missing_reason_and_unknown_use_case():
    client = _app(ModelDB())
    assert client.patch(f"{BASE}/defaults/chat", json={"default_model_id": GLM}).status_code == 422
    assert client.patch(f"{BASE}/defaults/no_such_case", json={"default_model_id": GLM, "reason": "x"}).status_code == 404


def test_patch_503_when_change_log_missing_and_nothing_written():
    db = ModelDB(change_log=False)
    resp = _app(db).patch(f"{BASE}/defaults/chat", json={"default_model_id": GEMINI, "reason": "x"})
    assert resp.status_code == 503 and "ai_model_change_log" in resp.json()["detail"]
    assert not db.writes and db.defaults["chat"]["default_model_id"] == GLM


def test_bulk_dry_run_holds_and_never_writes():
    db = ModelDB()
    resp = _app(db).post(f"{BASE}/defaults/bulk", json={
        "model_id": GLM, "fallback_model_id": GEMINI, "dry_run": True, "reason": "dry-run preview"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["applied"] is False and not db.writes and not db.log
    held = {h["use_case"]: h["reason"] for h in data["held"]}
    assert {"student_report", "image", "embedding", "tts"} <= set(held)
    assert "reels_selection" not in held, "routed through chat_with_chain in this release"
    changed = {(c["use_case"], c["field"]) for c in data["changes"]}
    assert ("analytics", "default_model_id") in changed
    assert ("analytics", "fallback_model_id") not in changed, "analytics fallback is a deliberate pick"
    assert ("chat", "default_model_id") not in changed, "already GLM + gemini"
    assert ("kb_companion", "default_model_id") in changed and ("kb_companion", "fallback_model_id") in changed
    assert ("legacy_thing", "default_model_id") in changed
    assert not any(c["use_case"] in held for c in data["changes"])


def test_bulk_apply_creates_rows_and_logs_each():
    db = ModelDB()
    resp = _app(db).post(f"{BASE}/defaults/bulk", json={
        "model_id": GLM, "use_cases": ["analytics", "kb_companion", "student_report", "chat"],
        "dry_run": False, "reason": "GLM everywhere"})
    data = resp.json()
    assert data["applied"] is True
    assert [h["use_case"] for h in data["held"]] == ["student_report"]
    assert db.defaults["analytics"] == {**db.defaults["analytics"], "default_model_id": GLM,
                                       "fallback_model_id": "openai/gpt-5.6-luna"}
    assert db.defaults["kb_companion"]["default_model_id"] == GLM
    assert db.defaults["kb_companion"]["fallback_model_id"] == GEMINI, "new rows get the non-GLM fallback"
    assert db.defaults["student_report"]["default_model_id"] == "openai/gpt-5.6-luna"
    assert sorted(r.row_key for r in db.log) == ["analytics", "kb_companion"]
    assert all(r.reason == "GLM everywhere" for r in db.log)


def test_bulk_validation():
    client = _app(ModelDB())
    assert client.post(f"{BASE}/defaults/bulk", json={"model_id": "qwen/qwen-image-3", "dry_run": True,
                                                      "reason": "x"}).status_code == 422
    assert client.post(f"{BASE}/defaults/bulk", json={"model_id": GLM, "use_cases": ["typo"], "dry_run": True,
                                                      "reason": "x"}).status_code == 422
    assert client.post(f"{BASE}/defaults/bulk", json={"model_id": GLM, "dry_run": False,
                                                      "reason": ""}).status_code == 422


def test_bulk_explicit_null_fallback_clears():
    db = ModelDB()
    _app(db).post(f"{BASE}/defaults/bulk", json={"model_id": GLM, "fallback_model_id": None,
                                                 "use_cases": ["chat"], "dry_run": False, "reason": "x"})
    assert db.defaults["chat"]["fallback_model_id"] is None


def test_stages_list_patch_and_bulk():
    db = ModelDB()
    client = _app(db)
    data = client.get(f"{BASE}/stages", params={"use_case": "video"}).json()
    assert data["tiers"] == ["free", "standard", "ultra"]
    s = data["stages"][0]
    assert set(s) == {"stage_id", "label", "quality_tier", "model_id", "fallback_model_id",
                      "user_overridable", "is_active", "updated_at"}
    assert s["label"] == "Shot planner"

    resp = client.patch(f"{BASE}/stages", json={"use_case": "video", "stage_id": "shot_planner",
                                                 "quality_tiers": ["ultra"], "model_id": GLM, "reason": "x"})
    assert resp.json() == {"updated": 1}
    assert db.log[-1].table_name == "ai_model_stage_assignments" and db.log[-1].row_key == "video/ultra/shot_planner"
    resp = client.patch(f"{BASE}/stages", json={"use_case": "video", "stage_id": "shot_planner",
                                                 "quality_tiers": ["*"], "model_id": GLM, "reason": "x"})
    assert resp.json() == {"updated": 2}
    assert client.patch(f"{BASE}/stages", json={"use_case": "video", "stage_id": "nope", "quality_tiers": ["*"],
                                                "model_id": GLM, "reason": "x"}).status_code == 404

    dry = client.post(f"{BASE}/stages/bulk", json={"use_case": "video", "model_id": GLM, "dry_run": True,
                                                   "reason": "dry-run preview"}).json()
    assert dry["applied"] is False
    assert {(c["quality_tier"], c["stage_id"]) for c in dry["changes"]} == {
        ("free", "vision_review"), ("ultra", "vision_review")}
    n_log = len(db.log)
    applied = client.post(f"{BASE}/stages/bulk", json={"use_case": "video", "model_id": GLM, "dry_run": False,
                                                       "reason": "all GLM"}).json()
    assert applied["applied"] is True and len(db.log) == n_log + 2
    assert all(r.model_id == GLM for r in db.stages)


def test_change_log_filter_and_503():
    db = ModelDB()
    client = _app(db)
    client.patch(f"{BASE}/defaults/chat", json={"default_model_id": GEMINI, "reason": "a"})
    client.patch(f"{BASE}/stages", json={"use_case": "video", "stage_id": "shot_planner", "quality_tiers": ["*"],
                                         "model_id": GLM, "reason": "b"})
    entries = client.get(f"{BASE}/change-log", params={"limit": 50}).json()["entries"]
    assert len(entries) == 4
    assert set(entries[0]) == {"id", "table_name", "row_key", "old_value", "new_value", "reason", "actor",
                               "created_at"}
    assert isinstance(entries[0]["new_value"], dict)
    vid = client.get(f"{BASE}/change-log", params={"use_case": "video"}).json()["entries"]
    assert {e["table_name"] for e in vid} == {"ai_model_stage_assignments"} and len(vid) == 3
    assert _app(ModelDB(change_log=False)).get(f"{BASE}/change-log").status_code == 503


def test_overrides_never_select_key_columns():
    db = ModelDB()
    rows = _app(db).get(f"{BASE}/overrides").json()["api_key_defaults"]
    assert rows == [
        {"id": "k1", "institute_id": INST, "user_id": None, "default_model": "xiaomi/mimo-v2-flash:free",
         "has_own_key": False},
        {"id": "k2", "institute_id": None, "user_id": "u-9", "default_model": "google/gemini-2.5-pro",
         "has_own_key": True},
    ]
    sql = next(s for s in db.statements if "FROM ai_api_keys" in s)
    select_list = sql.split(" FROM ")[0]
    # The key columns only appear inside the boolean expression, never as output columns.
    assert re.sub(r"\(COALESCE.*?AS has_own_key", "", select_list).count("_key") == 0
    assert "sk-secret" not in json.dumps(rows)


# ── /models/v2 route order + update_use_case_default fixes ──────────────────

def test_ai_models_patch_defaults_not_shadowed():
    from ai_service.app.routers import ai_models as am

    hits = []

    class FakeSvc:
        def update_use_case_default(self, use_case, request):
            hits.append(("defaults", use_case, request.model_fields_set))
            return {"use_case": use_case, "default_model_id": GLM, "fallback_model_id": None,
                    "free_tier_model_id": None, "description": None}

        def update_model(self, model_id, request):
            hits.append(("model", model_id))
            return None

    app = FastAPI()
    app.include_router(am.router, prefix="/ai-service")
    app.dependency_overrides[am.get_models_service] = lambda: FakeSvc()
    app.dependency_overrides[get_current_user] = lambda: CustomUserDetails(username="u", user_id=STAFF)
    client = TestClient(app)
    resp = client.patch("/ai-service/models/v2/defaults/agent", json={"fallback_model_id": None})
    assert resp.status_code == 200, resp.text
    assert hits[-1] == ("defaults", "agent", {"fallback_model_id"})
    assert client.patch("/ai-service/models/v2/google/gemini-2.5-flash", json={}).status_code == 404
    assert hits[-1] == ("model", "google/gemini-2.5-flash")


def test_update_use_case_default_missing_row_and_explicit_null():
    from ai_service.app.services.ai_models_service import AIModelsService
    from ai_service.app.schemas.ai_models import UpdateUseCaseDefaultRequest

    db = ModelDB()

    class LegacyDB(ModelDB):
        def execute(self, stmt, params=None):
            sql = " ".join(getattr(stmt, "text", str(stmt)).split())
            p = params or {}
            if sql.startswith("SELECT 1 FROM ai_model_defaults"):
                return _Res([1] if p["use_case"] in self.defaults else [])
            if sql.startswith("UPDATE ai_model_defaults SET"):
                row = self.defaults[p["use_case"]]
                for col, key in (("default_model_id", "default"), ("fallback_model_id", "fallback"),
                                 ("free_tier_model_id", "free")):
                    if f"{col} = :{key}" in sql:
                        row[col] = p[key]
                return _Res()
            if sql.startswith("SELECT use_case, default_model_id, fallback_model_id, free_tier_model_id, description"):
                d = self.defaults.get(p["use_case"])
                return _Res([SimpleNamespace(use_case=p["use_case"], description=None, **{
                    k: d[k] for k in ("default_model_id", "fallback_model_id", "free_tier_model_id")})] if d else [])
            return super().execute(stmt, params)

    db = LegacyDB()
    svc = AIModelsService(db)
    assert svc.update_use_case_default("nope", UpdateUseCaseDefaultRequest(default_model_id=GLM)) is None
    out = svc.update_use_case_default("analytics", UpdateUseCaseDefaultRequest(fallback_model_id=None))
    assert out.fallback_model_id is None and out.default_model_id == GEMINI
    with pytest.raises(ValueError):
        svc.update_use_case_default("analytics", UpdateUseCaseDefaultRequest(default_model_id=None))


# ── internal completion + chat_bot auth ─────────────────────────────────────

def _fake_chain(monkeypatch, seen, content="answer", model=GLM, fail=False):
    async def fake(payload, use_case=None, models=None, **kw):
        seen.append({"payload": payload, "use_case": use_case, **kw})
        if fail:
            raise llm_router.ChainExhausted(use_case, [(GLM, "HTTP 503"), (GEMINI, "HTTP 500")])
        return llm_router.ChainResult(content=content, model=model, router="isoquant",
                                      usage={"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13},
                                      finish_reason="stop")

    monkeypatch.setattr(llm_router, "chat_with_chain", fake)


def _fake_usage(monkeypatch, recorded):
    from ai_service.app.services import token_usage_service as tus

    class FakeTUS:
        def __init__(self, db):
            pass

        def record_usage(self, **kw):
            recorded.append(("record", kw))

        def record_usage_and_deduct_credits(self, **kw):
            recorded.append(("charge", kw))

    monkeypatch.setattr(tus, "TokenUsageService", FakeTUS)


def _internal_app():
    from ai_service.app.routers.internal_llm import router

    app = FastAPI()
    app.include_router(router, prefix="/ai-service")
    app.dependency_overrides[db_dependency] = lambda: object()
    return TestClient(app)


INTERNAL = "/ai-service/internal/llm/v1/complete"


def test_internal_complete_requires_token(monkeypatch):
    client = _internal_app()
    body = {"use_case": "class_report", "messages": [{"role": "user", "content": "x"}]}
    assert client.post(INTERNAL, json=body).status_code == 401
    assert client.post(INTERNAL, json=body, headers={"X-Internal-Service-Token": "wrong"}).status_code == 401
    monkeypatch.setattr(get_settings(), "internal_service_token", None, raising=False)
    assert client.post(INTERNAL, json=body, headers={"X-Internal-Service-Token": "svc-token"}).status_code == 503


def test_internal_complete_resolves_use_case_and_records_without_charge(monkeypatch):
    seen, recorded = [], []
    _fake_chain(monkeypatch, seen)
    _fake_usage(monkeypatch, recorded)
    resp = _internal_app().post(INTERNAL, headers={"X-Internal-Service-Token": "svc-token"}, json={
        "use_case": "class_report", "messages": [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}],
        "response_format": {"type": "json_object"}, "max_tokens": 900, "reasoning_effort": "low",
        "institute_id": INST, "record_usage_only": True})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"content": "answer", "model": GLM,
                           "usage": {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13},
                           "finish_reason": "stop"}
    call = seen[0]
    assert call["use_case"] == "class_report" and call["reasoning_effort"] == "low"
    assert call["payload"]["max_tokens"] == 900 and call["payload"]["response_format"] == {"type": "json_object"}
    assert [k for k, _ in recorded] == ["record"], "usage recorded, never charged"
    assert recorded[0][1]["model"] == GLM and recorded[0][1]["institute_id"] == INST


def test_internal_complete_errors(monkeypatch):
    seen = []
    client = _internal_app()
    h = {"X-Internal-Service-Token": "svc-token"}
    assert client.post(INTERNAL, headers=h, json={"use_case": "nope", "messages": [
        {"role": "user", "content": "x"}]}).status_code == 422
    assert client.post(INTERNAL, headers=h, json={"use_case": "image", "messages": [
        {"role": "user", "content": "x"}]}).status_code == 422
    assert client.post(INTERNAL, headers=h, json={"use_case": "chat", "messages": []}).status_code == 422
    _fake_chain(monkeypatch, seen, fail=True)
    resp = client.post(INTERNAL, headers=h, json={"use_case": "live_session_summary", "messages": [
        {"role": "user", "content": "x"}]})
    assert resp.status_code == 502 and "live_session_summary" in resp.json()["detail"]


def _chat_app(user_id="learner-1"):
    from ai_service.app.routers.chat_bot import router

    app = FastAPI()
    app.include_router(router, prefix="/ai-service")
    app.dependency_overrides[db_dependency] = lambda: object()
    if user_id:
        app.dependency_overrides[get_current_user] = lambda: CustomUserDetails(username="u", user_id=user_id)
    return TestClient(app)


def test_chat_complete_needs_internal_token(monkeypatch):
    seen = []
    _fake_chain(monkeypatch, seen)
    client = _chat_app()
    body = {"prompt": "hello", "institute_id": INST}
    assert client.post("/ai-service/chat/v1/complete", json=body).status_code == 401
    assert not seen


def test_chat_complete_ignores_model_unless_staff_and_bills_resolved_id(monkeypatch):
    seen, recorded = [], []
    _fake_chain(monkeypatch, seen, model=GLM)
    _fake_usage(monkeypatch, recorded)
    client = _chat_app()
    h = {"X-Internal-Service-Token": "svc-token"}
    resp = client.post("/ai-service/chat/v1/complete", headers=h, json={
        "prompt": "hello", "model": "anthropic/claude-opus-5", "use_case": "parent_assistant",
        "institute_id": INST, "user_id": "parent-1"})
    assert resp.status_code == 200 and resp.json() == {"content": "answer"}
    assert seen[-1]["use_case"] == "parent_assistant" and seen[-1]["preferred_model"] is None
    kind, kw = recorded[-1]
    assert kind == "charge" and kw["model"] == GLM, "billed under the registry id, never 'default'"

    client.post("/ai-service/chat/v1/complete", headers=h, json={
        "prompt": "hello", "model": "anthropic/claude-opus-5", "user_id": STAFF})
    assert seen[-1]["preferred_model"] == "anthropic/claude-opus-5" and seen[-1]["use_case"] == "chat"
    client.post("/ai-service/chat/v1/complete", headers=h, json={"prompt": "x", "use_case": "student_report"})
    assert seen[-1]["use_case"] == "chat", "only chat / parent_assistant may be named"


def test_chat_ask_requires_user_and_pins_user_id(monkeypatch):
    seen, recorded = [], []
    _fake_chain(monkeypatch, seen)
    _fake_usage(monkeypatch, recorded)
    anon = _chat_app(user_id=None)
    assert anon.post("/ai-service/chat/v1/ask", json={"prompt": "hi"}).status_code == 401
    client = _chat_app(user_id="learner-1")
    resp = client.post("/ai-service/chat/v1/ask", json={"prompt": "hi", "user_id": "someone-else"})
    assert resp.status_code == 200 and resp.json()["content"] == "answer"
    assert seen[-1]["use_case"] == "chat"
    assert recorded[-1][1]["user_id"] == "learner-1" and recorded[-1][1]["model"] == GLM
    # Billing another institute needs membership of it (no JWT here -> 403).
    assert client.post("/ai-service/chat/v1/ask", json={"prompt": "hi", "institute_id": INST}).status_code == 403


# ── migration seed list ─────────────────────────────────────────────────────

def test_flyway_seed_matches_catalog():
    mig = REPO / "admin_core_service/src/main/resources/db/migration"
    files = list(mig.glob("V*__Ai_model_change_log_and_use_case_seeds.sql"))
    assert len(files) == 1
    sql = files[0].read_text()
    seeded = set(re.findall(r"\('([a-z_]+)', 'z-ai/glm-5\.3-flash', 'google/gemini-2\.5-flash'", sql))
    assert seeded == set(muc.SEEDED_IN_RELEASE_2) and len(seeded) == 23
    assert "student_report" not in seeded
    assert "ON CONFLICT (use_case) DO NOTHING" in sql
    assert "CREATE TABLE IF NOT EXISTS ai_model_change_log" in sql
    spec_keys = {"platform_default", "assistant", "course_assist", "transcript_notes", "html_document",
                 "engagement_plan", "brand_kit", "image_keyword", "reels_preview", "reels_director", "studio_plan",
                 "kb_companion", "copy_check_deduction", "call_intelligence", "admin_agent", "chatbot_flow",
                 "engagement", "workflow_draft", "agent_assist", "parent_assistant", "class_report",
                 "live_session_summary", "reels_selection"}
    assert seeded == spec_keys
    existing = {"agent", "analytics", "content", "copilot", "embedding", "evaluation", "image",
                "knowledge_base_figure", "knowledge_base_qa", "knowledge_base_summary", "lecture", "outline",
                "questions", "student_report", "translation", "tts", "video", "video_regenerate", "chat",
                "incident", "presentation", "question_metadata", "page_builder"}
    assert (spec_keys | existing) <= set(muc.USE_CASE_CATALOG)
    assert {u.group for u in muc.USE_CASES} <= set(muc.GROUPS)
