"""Super-admin pricing endpoints (docs/AI_EVALUATION_PUBLIC_API.md 10.5, 10.7;
T1.10): per-institute overrides (append-only), history, the overrides list,
reason required on the global PUT, and the platform-staff guard on all of them.

No DB: an in-memory institute_tool_pricing / ai_tool_pricing_history double
answers by statement text.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import super_admin
from app.schemas.auth import CustomUserDetails
from app.services import tool_pricing_admin as tpa
from app.services.tool_pricing_admin import PricingAdminError

INST = "11111111-1111-1111-1111-111111111111"
STAFF_ID = "staff-1"


class _Res:
    def __init__(self, rows=()):
        self._rows = list(rows)

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._rows[0] if self._rows else None


class PricingDB:
    def __init__(self, history_missing=False):
        self.overrides = []
        self.history = []
        self.global_upserts = []
        self.clock = datetime(2026, 10, 1, 10, 0, 0)
        self.commits = 0
        self.rollbacks = 0
        self.history_missing = history_missing
        self._ids = iter(f"ov-{i}" for i in range(1, 100))

    @contextmanager
    def begin_nested(self):
        yield

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def _tick(self):
        self.clock += timedelta(seconds=1)
        return self.clock

    def execute(self, stmt, params=None):
        sql = getattr(stmt, "text", str(stmt)).strip()
        p = params or {}
        if sql.startswith("SELECT tool_key, is_active, updated_at FROM ai_tool_pricing"):
            return _Res()
        if "FROM ai_tool_pricing" in sql and "history" not in sql:
            raise RuntimeError("no ai_tool_pricing table")        # defaults apply
        if sql.startswith("INSERT INTO ai_tool_pricing ("):
            self.global_upserts.append(p)
            return _Res()
        if sql.startswith("UPDATE institute_tool_pricing"):
            closed = []
            for r in self.overrides:
                if r.institute_id == p["institute_id"] and r.tool_key == p["tool_key"] and r.effective_to is None:
                    r.effective_to, r.ended_by = self._tick(), p["actor"]
                    closed.append(r)
            return _Res(closed)
        if sql.startswith("INSERT INTO institute_tool_pricing"):
            if any(r.institute_id == p["institute_id"] and r.tool_key == p["tool_key"] and r.effective_to is None
                   for r in self.overrides):
                from sqlalchemy.exc import IntegrityError
                raise IntegrityError("ux_itp_open")
            now = self._tick()
            row = SimpleNamespace(id=next(self._ids), institute_id=p["institute_id"], tool_key=p["tool_key"],
                                  flat_base_credits=p["flat"], per_unit_credits=p["per_unit"],
                                  params_json=p["params"], no_token_overage=p["no_token_overage"],
                                  effective_from=now, effective_to=None, reason=p["reason"],
                                  created_by=p["actor"], created_at=now, ended_by=None)
            self.overrides.append(row)
            return _Res([row])
        if sql.startswith("INSERT INTO ai_tool_pricing_history"):
            if self.history_missing:
                raise RuntimeError("relation ai_tool_pricing_history does not exist")
            self.history.append(dict(p, changed_at=self._tick()))
            return _Res()
        if "FROM institute_tool_pricing" in sql:
            rows = [r for r in self.overrides
                    if (p.get("institute_id") is None or r.institute_id == p["institute_id"])
                    and (p.get("tool_key") is None or r.tool_key == p["tool_key"])]
            if "COUNT(*)" in sql:
                counts = {}
                for r in rows:
                    if r.effective_to is None:
                        counts[r.tool_key] = counts.get(r.tool_key, 0) + 1
                return _Res([SimpleNamespace(tool_key=k, n=v) for k, v in counts.items()])
            if "effective_to IS NULL" in sql:
                rows = [r for r in rows if r.effective_to is None]
            if "ORDER BY created_at DESC" in sql:
                rows = sorted(rows, key=lambda r: r.created_at, reverse=True)
            return _Res(rows)
        if "FROM ai_tool_pricing_history" in sql:
            import json
            rows = [h for h in self.history if p.get("tool_key") is None or h["tool_key"] == p["tool_key"]]
            if p.get("institute_id"):
                rows = [h for h in rows
                        if json.loads(h["new_json"]).get("institute_id") in (None, p["institute_id"])]
            return _Res([SimpleNamespace(id=str(i), tool_key=h["tool_key"], old_json=h["old_json"],
                                         new_json=h["new_json"], changed_by=h["actor"], reason=h["reason"],
                                         changed_at=h["changed_at"]) for i, h in enumerate(rows)])
        raise AssertionError(f"unexpected statement {sql!r}")


API = "copy_check_evaluation_api"


# ── service rules ───────────────────────────────────────────────────────────

def test_set_override_returns_effective_price_and_examples():
    db = PricingDB()
    out = tpa.set_override(db, INST, API, per_unit_credits=0.5, reason="Contract EV-7", actor=STAFF_ID)
    assert out["effective"]["per_unit"] == 0.5 and out["effective"]["fixed_price"] is True
    assert out["effective"]["rate_source"] == "override:ov-1"
    assert out["override"]["reason"] == "Contract EV-7" and out["override"]["created_by"] == STAFF_ID
    by_pages = {e.get("num_pages"): e for e in out["examples"] if "num_pages" in e}
    assert by_pages[12] == {"num_pages": 12, "credits": 6, "global_credits": 12}
    typed = [e for e in out["examples"] if "typed_answers" in e][0]
    assert typed == {"typed_answers": 4, "credits": 4, "global_credits": 4}
    assert all(isinstance(v, (int, float)) for e in out["examples"] for v in e.values())
    assert db.commits == 1


def test_dashboard_examples_use_question_counts():
    out = tpa.set_override(PricingDB(), INST, "copy_check_evaluation", flat_base_credits=0,
                           reason="pilot", actor=STAFF_ID)
    assert [(e["num_questions"], e["credits"], e["global_credits"]) for e in out["examples"]] == [
        (10, 2, 3), (40, 8, 9), (64, 13, 14)]


def test_edit_closes_the_open_row_and_inserts_a_new_one():
    db = PricingDB()
    tpa.set_override(db, INST, API, per_unit_credits=0.5, reason="v1", actor=STAFF_ID)
    tpa.set_override(db, INST, API, per_unit_credits=0.8, reason="v2", actor="staff-2")
    assert len(db.overrides) == 2
    first, second = db.overrides
    assert first.effective_to is not None and first.ended_by == "staff-2"
    assert second.effective_to is None and float(second.per_unit_credits) == 0.8


@pytest.mark.parametrize("kwargs,status", [
    ({"per_unit_credits": 1, "reason": "  "}, 422),
    ({"per_unit_credits": 1, "reason": None}, 422),
    ({"per_unit_credits": -1, "reason": "x"}, 422),
    ({"flat_base_credits": 10001, "reason": "x"}, 422),
    ({"reason": "x"}, 422),                                  # nothing to override
    ({"params": ["not", "a", "dict"], "reason": "x"}, 422),
])
def test_set_override_validation(kwargs, status):
    with pytest.raises(PricingAdminError) as e:
        tpa.set_override(PricingDB(), INST, API, actor=STAFF_ID, **kwargs)
    assert e.value.status_code == status


def test_unknown_tool_is_404():
    with pytest.raises(PricingAdminError) as e:
        tpa.set_override(PricingDB(), INST, "no_such_tool", per_unit_credits=1, reason="x", actor=STAFF_ID)
    assert e.value.status_code == 404


def test_concurrent_edit_is_409(monkeypatch):
    db = PricingDB()
    real_execute = db.execute

    def racing(stmt, params=None):
        sql = getattr(stmt, "text", "")
        if sql.startswith("UPDATE institute_tool_pricing"):
            # The other edit's row appears after our UPDATE ran.
            out = real_execute(stmt, params)
            db.overrides.append(SimpleNamespace(institute_id=INST, tool_key=API, effective_to=None))
            return out
        return real_execute(stmt, params)

    monkeypatch.setattr(db, "execute", racing)
    with pytest.raises(PricingAdminError) as e:
        tpa.set_override(db, INST, API, per_unit_credits=1, reason="x", actor=STAFF_ID)
    assert e.value.status_code == 409 and db.rollbacks == 1


def test_end_override_reverts_to_global_and_keeps_the_reason():
    db = PricingDB()
    tpa.set_override(db, INST, API, per_unit_credits=0.5, reason="v1", actor=STAFF_ID)
    out = tpa.end_override(db, INST, API, reason="contract ended", actor=STAFF_ID)
    assert out["ended"]["id"] == "ov-1" and out["effective"]["per_unit"] == 1.0
    assert out["effective"]["rate_source"] == "default"
    assert db.history[-1]["reason"] == "contract ended" and '"institute"' in db.history[-1]["new_json"]
    with pytest.raises(PricingAdminError) as e:
        tpa.end_override(db, INST, API, reason="again", actor=STAFF_ID)
    assert e.value.status_code == 404
    with pytest.raises(PricingAdminError) as e:
        tpa.end_override(db, INST, API, reason="", actor=STAFF_ID)
    assert e.value.status_code == 422


def test_list_institute_pricing_shows_global_override_and_effective():
    db = PricingDB()
    tpa.set_override(db, INST, API, per_unit_credits=0.5, reason="v1", actor=STAFF_ID)
    rows = {r["tool_key"]: r for r in tpa.list_institute_pricing(db, INST, super_admin.TOOL_LABELS)}
    api = rows[API]
    assert api["label"] == "AI evaluation — API partners (fixed price)"
    assert api["global"]["per_unit"] == 1.0 and api["override"]["per_unit"] == 0.5
    assert api["effective"]["per_unit"] == 0.5 and api["source"] == "override"
    assert rows["copy_check_evaluation"]["override"] is None
    assert rows["copy_check_evaluation"]["source"] == "default"


def test_history_and_overrides_list():
    db = PricingDB()
    tpa.set_override(db, INST, API, per_unit_credits=0.5, reason="v1", actor=STAFF_ID)
    tpa.set_override(db, INST, API, per_unit_credits=0.7, reason="v2", actor=STAFF_ID)
    tpa.end_override(db, INST, API, reason="end", actor=STAFF_ID)
    tpa.set_override(db, "other-inst", API, per_unit_credits=0.9, reason="o", actor=STAFF_ID)
    tpa.record_global_change(db, API, old={"per_unit": 1}, new={"per_unit": 2}, actor=STAFF_ID, reason="card")
    hist = tpa.history(db, tool_key=API, institute_id=INST)["history"]
    assert [(e["scope"], e["reason"]) for e in hist] == [
        ("global", "card"), ("override_revert", "end"), ("override", "v2"), ("override", "v1")]
    assert hist[0]["new_json"] == {"per_unit": 2} and hist[1]["institute_id"] == INST
    assert hist[2]["effective_to"] is not None and hist[2]["ended_by"] == STAFF_ID
    everyone = tpa.history(db, tool_key=API)["history"]
    assert {e.get("institute_id") for e in everyone if e["scope"] == "override"} == {INST, "other-inst"}
    active = tpa.active_overrides(db, tool_key=API)
    assert [o["institute_id"] for o in active] == ["other-inst"]


def test_global_history_failure_never_blocks_the_price_edit():
    db = PricingDB(history_missing=True)
    assert tpa.record_global_change(db, API, old={}, new={"per_unit": 2}, actor=STAFF_ID, reason="r") is False


# ── router: guard + reason ──────────────────────────────────────────────────

def _user(user_id="user-1"):
    return CustomUserDetails(username="alice", user_id=user_id, is_root_user=True, roles=["ADMIN"])


@pytest.fixture
def staff(monkeypatch):
    stub = SimpleNamespace(super_admin_user_ids=STAFF_ID)
    from app.core import security
    monkeypatch.setattr(security, "get_settings", lambda: stub)
    monkeypatch.setattr(super_admin, "get_settings", lambda: stub)


ROUTES = [
    lambda db, u: super_admin.super_institute_tool_pricing(INST, db=db, current_user=u),
    lambda db, u: super_admin.super_put_institute_tool_pricing(
        INST, API, super_admin.InstituteToolPricingUpdate(per_unit_credits=0.5, reason="x"),
        db=db, current_user=u),
    lambda db, u: super_admin.super_delete_institute_tool_pricing(INST, API, reason="x", db=db, current_user=u),
    lambda db, u: super_admin.super_tool_pricing_history(tool_key=None, institute_id=None, limit=10,
                                                         db=db, current_user=u),
    lambda db, u: super_admin.super_tool_pricing_overrides(tool_key=None, db=db, current_user=u),
    lambda db, u: super_admin.super_put_tool_pricing(API, super_admin.ToolPricingUpdate(per_unit_credits=2,
                                                                                       reason="x"),
                                                     db=db, current_user=u),
]


@pytest.mark.parametrize("route", ROUTES)
def test_every_pricing_route_refuses_non_staff(staff, route):
    # An institute admin with is_root_user and ADMIN is not platform staff.
    db = PricingDB()
    with pytest.raises(HTTPException) as e:
        route(db, _user("user-1"))
    assert e.value.status_code == 403
    assert db.overrides == [] and db.global_upserts == []


def test_staff_can_set_and_end_an_institute_price(staff):
    db = PricingDB()
    out = super_admin.super_put_institute_tool_pricing(
        INST, API, super_admin.InstituteToolPricingUpdate(per_unit_credits=0.5, reason="EV-7"),
        db=db, current_user=_user(STAFF_ID))
    assert out["effective"]["per_unit"] == 0.5 and db.overrides[0].created_by == STAFF_ID
    with pytest.raises(HTTPException) as e:
        super_admin.super_put_institute_tool_pricing(
            INST, API, super_admin.InstituteToolPricingUpdate(per_unit_credits=0.5, reason=" "),
            db=db, current_user=_user(STAFF_ID))
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        super_admin.super_delete_institute_tool_pricing(INST, API, reason=None, db=db,
                                                        current_user=_user(STAFF_ID))
    assert e.value.status_code == 422
    out = super_admin.super_delete_institute_tool_pricing(INST, API, reason="ended", db=db,
                                                          current_user=_user(STAFF_ID))
    assert out["effective"]["rate_source"] == "default"


def test_global_put_requires_a_reason_and_writes_history(staff):
    db = PricingDB()
    with pytest.raises(HTTPException) as e:
        super_admin.super_put_tool_pricing(API, super_admin.ToolPricingUpdate(per_unit_credits=2),
                                           db=db, current_user=_user(STAFF_ID))
    assert e.value.status_code == 422 and db.global_upserts == []
    out = super_admin.super_put_tool_pricing(
        API, super_admin.ToolPricingUpdate(per_unit_credits=2, reason="new card"),
        db=db, current_user=_user(STAFF_ID))
    assert out["tool_key"] == API and db.global_upserts[0]["per"] == 2 and db.commits == 1
    assert db.history[0]["reason"] == "new card" and db.history[0]["actor"] == STAFF_ID


def test_global_rate_card_counts_overrides(staff):
    db = PricingDB()
    tpa.set_override(db, INST, API, per_unit_credits=0.5, reason="v1", actor=STAFF_ID)
    tools = {t["tool_key"]: t for t in super_admin.super_tool_pricing(db=db, current_user=_user(STAFF_ID))["tools"]}
    assert tools[API]["override_count"] == 1 and tools["copy_check_evaluation"]["override_count"] == 0
