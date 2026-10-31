"""Legacy /models/v2 registry writes record ai_model_change_log rows.

update_model, PUT free-tier, PATCH defaults and create_model each log old/new
values (actor + reason when given, a fixed reason otherwise) — and the write
itself behaves exactly as before: the free-tier reset still runs, a missing
change-log table or a failing audit insert never blocks or undoes the write.

Offline: an in-memory session double records every statement.

Run from the repo root:
    <venv>/bin/python -m pytest ai_service/tests/test_ai_models_change_log.py -q
"""
from __future__ import annotations

import json
import os
import sys
from contextlib import contextmanager
from decimal import Decimal
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.ai_models_service import AIModelsService, LEGACY_CHANGE_REASON  # noqa: E402
from app.schemas.ai_models import (  # noqa: E402
    UpdateFreeTierRequest,
    UpdateModelRequest,
    UpdateUseCaseDefaultRequest,
)


class _Res:
    def __init__(self, rows=None, scalar=None):
        self._rows = rows or []
        self._scalar = scalar

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._scalar


class DB:
    def __init__(self, change_log=True, fail_insert=False):
        self.change_log = change_log
        self.fail_insert = fail_insert
        self.statements = []
        self.logs = []
        self.commits = 0
        self.savepoints = 0
        self.models = {
            "google/gemini-2.5-flash": {"tier": "standard", "is_free": False, "is_active": True,
                                        "input_price_per_1m": Decimal("0.30"), "output_price_per_1m": Decimal("2.50")},
            "z-ai/glm-free": {"tier": "free", "is_free": True, "is_active": True,
                              "input_price_per_1m": Decimal("0"), "output_price_per_1m": Decimal("0")},
        }
        self.defaults = {"evaluation": {"default_model_id": "z-ai/glm-5.3-flash",
                                        "fallback_model_id": "google/gemini-2.5-flash",
                                        "free_tier_model_id": None}}

    @contextmanager
    def begin_nested(self):
        self.savepoints += 1
        yield

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass

    def execute(self, stmt, params=None):
        sql = " ".join(getattr(stmt, "text", str(stmt)).split())
        p = params or {}
        self.statements.append(sql)
        if sql.startswith("SELECT to_regclass('ai_model_change_log')"):
            return _Res(scalar=self.change_log)
        if sql.startswith("INSERT INTO ai_model_change_log"):
            if self.fail_insert:
                raise RuntimeError("insert failed")
            self.logs.append({**p, "old_value": json.loads(p["old_value"]) if p["old_value"] else None,
                              "new_value": json.loads(p["new_value"]) if p["new_value"] else None})
            return _Res()
        if sql.startswith("SELECT model_id, tier FROM ai_models WHERE is_free = TRUE"):
            return _Res([SimpleNamespace(model_id=k, tier=v["tier"]) for k, v in sorted(self.models.items())
                         if v["is_free"]])
        if sql.startswith("SELECT ") and "FROM ai_models WHERE model_id = :model_id" in sql:
            row = self.models.get(p["model_id"])
            return _Res([SimpleNamespace(**row)] if row else [])
        if sql.startswith("UPDATE ai_models SET is_free = FALSE, tier = 'standard'"):
            for v in self.models.values():
                if v["is_free"]:
                    v.update(is_free=False, tier="standard")
            return _Res()
        if sql.startswith("UPDATE ai_models SET is_free = TRUE, tier = 'free'"):
            if p["model_id"] in self.models:
                self.models[p["model_id"]].update(is_free=True, tier="free")
            return _Res()
        if sql.startswith("UPDATE ai_models SET"):
            row = self.models.get(p["model_id"])
            if row is not None:
                if "input_price" in p:
                    row["input_price_per_1m"] = p["input_price"]
                if "is_active" in p:
                    row["is_active"] = p["is_active"]
            return _Res()
        if sql.startswith("SELECT 1 FROM ai_model_defaults"):
            return _Res([1] if p["use_case"] in self.defaults else [])
        if sql.startswith("SELECT default_model_id, fallback_model_id, free_tier_model_id FROM ai_model_defaults"):
            d = self.defaults.get(p["use_case"])
            return _Res([SimpleNamespace(**d)] if d else [])
        if sql.startswith("UPDATE ai_model_defaults SET"):
            row = self.defaults[p["use_case"]]
            for col, key in (("default_model_id", "default"), ("fallback_model_id", "fallback"),
                             ("free_tier_model_id", "free")):
                if f"{col} = :{key}" in sql:
                    row[col] = p[key]
            return _Res()
        if sql.startswith("SELECT use_case, default_model_id"):
            d = self.defaults.get(p["use_case"])
            return _Res([SimpleNamespace(use_case=p["use_case"], description=None, **d)] if d else [])
        return _Res()


@pytest.fixture
def no_reads(monkeypatch):
    """The read-back after each write is not under test here."""
    monkeypatch.setattr(AIModelsService, "get_model_by_id", lambda self, mid: {"model_id": mid})
    monkeypatch.setattr(AIModelsService, "get_free_models", lambda self: "free-list")


def test_update_model_logs_old_and_new_prices(no_reads):
    db = DB()
    out = AIModelsService(db).update_model(
        "google/gemini-2.5-flash", UpdateModelRequest(input_price_per_1m=Decimal("0.35"), is_active=False),
        actor="user-1", reason="vendor price change",
    )
    assert out == {"model_id": "google/gemini-2.5-flash"}
    assert db.models["google/gemini-2.5-flash"]["input_price_per_1m"] == Decimal("0.35")
    [log] = db.logs
    assert log["table_name"] == "ai_models" and log["row_key"] == "google/gemini-2.5-flash"
    assert log["old_value"] == {"is_active": True, "input_price_per_1m": "0.30"}
    assert log["new_value"] == {"is_active": False, "input_price_per_1m": "0.35"}
    assert log["actor"] == "user-1" and log["reason"] == "vendor price change"
    assert db.commits == 1
    # before-values are read, and the audit written, each inside a savepoint
    assert db.savepoints >= 3


def test_update_model_default_reason_and_unknown_model_not_logged(no_reads):
    db = DB()
    AIModelsService(db).update_model("google/gemini-2.5-flash", UpdateModelRequest(is_active=False))
    assert db.logs[0]["reason"] == LEGACY_CHANGE_REASON and db.logs[0]["actor"] is None
    db = DB()
    AIModelsService(db).update_model("nope/model", UpdateModelRequest(is_active=False))
    assert db.logs == []


def test_update_model_noop_request_writes_nothing(no_reads):
    db = DB()
    AIModelsService(db).update_model("google/gemini-2.5-flash", UpdateModelRequest())
    assert db.logs == [] and db.commits == 0


def test_free_tier_keeps_reset_and_logs_both_lists(no_reads):
    db = DB()
    assert AIModelsService(db).update_free_tier(UpdateFreeTierRequest(model_ids=["google/gemini-2.5-flash"])) == "free-list"
    # behaviour unchanged: old free model reset to standard, new one free
    assert db.models["z-ai/glm-free"] == {**db.models["z-ai/glm-free"], "is_free": False, "tier": "standard"}
    assert db.models["google/gemini-2.5-flash"]["tier"] == "free"
    [log] = db.logs
    assert log["row_key"] == "free_tier"
    assert log["old_value"] == {"free_models": [{"model_id": "z-ai/glm-free", "tier": "free"}]}
    assert log["new_value"]["free_models"] == [{"model_id": "google/gemini-2.5-flash", "tier": "free"}]
    assert log["new_value"]["others_reset_to_tier"] == "standard"


def test_legacy_defaults_patch_logs_portal_shape(no_reads):
    db = DB()
    out = AIModelsService(db).update_use_case_default(
        "evaluation", UpdateUseCaseDefaultRequest(fallback_model_id=None), actor="u2")
    assert out.fallback_model_id is None
    [log] = db.logs
    assert log["table_name"] == "ai_model_defaults" and log["row_key"] == "evaluation"
    assert log["old_value"] == {"default_model_id": "z-ai/glm-5.3-flash",
                                "fallback_model_id": "google/gemini-2.5-flash", "free_tier_model_id": None}
    assert log["new_value"] == {**log["old_value"], "fallback_model_id": None}


def test_defaults_patch_same_value_not_logged(no_reads):
    db = DB()
    AIModelsService(db).update_use_case_default(
        "evaluation", UpdateUseCaseDefaultRequest(default_model_id="z-ai/glm-5.3-flash"))
    assert db.logs == [] and db.commits == 1  # the UPDATE still runs as before


def test_missing_change_log_table_write_still_happens(no_reads):
    db = DB(change_log=False)
    AIModelsService(db).update_model("google/gemini-2.5-flash", UpdateModelRequest(input_price_per_1m=Decimal("1")))
    AIModelsService(db).update_free_tier(UpdateFreeTierRequest(model_ids=[]))
    AIModelsService(db).update_use_case_default("evaluation", UpdateUseCaseDefaultRequest(fallback_model_id=None))
    assert db.logs == []
    assert db.models["google/gemini-2.5-flash"]["input_price_per_1m"] == Decimal("1")
    assert db.defaults["evaluation"]["fallback_model_id"] is None
    assert db.commits == 3


def test_failing_audit_insert_never_blocks_the_write(no_reads):
    db = DB(fail_insert=True)
    AIModelsService(db).update_model("google/gemini-2.5-flash", UpdateModelRequest(input_price_per_1m=Decimal("2")))
    assert db.models["google/gemini-2.5-flash"]["input_price_per_1m"] == Decimal("2")
    assert db.commits == 1


def test_session_without_savepoints_skips_audit(no_reads):
    class Plain(DB):
        begin_nested = None  # type: ignore[assignment]

    db = Plain()
    AIModelsService(db).update_model("google/gemini-2.5-flash", UpdateModelRequest(is_active=False))
    assert db.logs == [] and db.commits == 1
