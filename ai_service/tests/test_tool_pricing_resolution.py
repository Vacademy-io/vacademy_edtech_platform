"""Per-institute AI tool pricing and API billing (docs/AI_EVALUATION_PUBLIC_API.md
10.1, 10.3, 10.8; T1.9, T1.11, T1.12).

No DB: a fake session answers the two pricing reads (global ai_tool_pricing,
the institute's open institute_tool_pricing rows) by statement text.

- resolution order: institute override -> global row -> DEFAULT_TOOL_PRICING,
  with rate_source "override:<id>" / "global" / "default";
- copy_check_evaluation_api: 1 credit per page, typed 1 per non-blank answer,
  always fixed price (no token overage);
- the rate snapshot quoted at enqueue wins over today's rate;
- charge_tool: fixed price skips the actual-cost floor, rate_source lands in
  the transaction description, billing actor on the ledger;
- /credits/v1/tool-pricing merges overrides only for members of clientId.
"""
import base64
import sys
from contextlib import contextmanager
from decimal import Decimal
from types import SimpleNamespace

import pytest
from jose import jwt

import app.services.credit_service  # noqa: F401 - the tests patch it through sys.modules
from app.config import get_settings
from app.services import ai_billing
from app.services import tool_cost_estimator as tce
from app.services.tool_cost_estimator import COPY_CHECK_API_TOOL_KEY, ToolCostEstimator

INST = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


class _Rows:
    def __init__(self, rows):
        self._rows = list(rows)

    def fetchall(self):
        return list(self._rows)


class FakeDB:
    """ai_tool_pricing rows + institute_tool_pricing rows; either table can be
    'missing' (the statement raises)."""

    def __init__(self, global_rows=(), overrides=(), global_missing=False, overrides_missing=False):
        self.global_rows = list(global_rows)
        self.overrides = list(overrides)
        self.global_missing = global_missing
        self.overrides_missing = overrides_missing
        self.savepoints = 0
        self.statements = []

    @contextmanager
    def begin_nested(self):
        self.savepoints += 1
        yield

    def execute(self, stmt, params=None):
        sql = getattr(stmt, "text", str(stmt))
        self.statements.append(sql)
        if "FROM ai_tool_pricing" in sql:
            if self.global_missing:
                raise RuntimeError("relation ai_tool_pricing does not exist")
            return _Rows(self.global_rows)
        if "FROM institute_tool_pricing" in sql:
            if self.overrides_missing:
                raise RuntimeError("relation institute_tool_pricing does not exist")
            rows = [r for r in self.overrides if r.institute_id == params["institute_id"]
                    and (params.get("tool_key") is None or r.tool_key == params["tool_key"])]
            return _Rows(rows)
        raise AssertionError(f"unexpected statement {sql!r}")


def g_row(tool_key, flat, per_unit, unit_field, params=None, request_type="evaluation"):
    return SimpleNamespace(tool_key=tool_key, request_type=request_type, flat_base_credits=flat,
                           per_unit_credits=per_unit, unit_field=unit_field, params_json=params or {})


def o_row(tool_key, flat=None, per_unit=None, params=None, no_token_overage=False, institute_id=INST, id="ov-1"):
    return SimpleNamespace(id=id, institute_id=institute_id, tool_key=tool_key, flat_base_credits=flat,
                           per_unit_credits=per_unit, params_json=params, no_token_overage=no_token_overage)


def _est(db, tool_key=COPY_CHECK_API_TOOL_KEY, params=None, **kw):
    return ToolCostEstimator(db).estimate(tool_key, params if params is not None else {"num_pages": 12}, **kw)


# ── resolution order ────────────────────────────────────────────────────────

def test_api_default_is_one_credit_per_page_fixed_price():
    est = _est(FakeDB(global_missing=True), institute_id=INST)
    assert est["estimated_credits"] == 12
    assert est["rate_source"] == "default" and est["fixed_price"] is True
    assert est["unit_field"] == "pages"
    row = tce.DEFAULT_TOOL_PRICING[COPY_CHECK_API_TOOL_KEY]
    assert (row["flat_base_credits"], row["per_unit_credits"], row["unit_field"]) == (0, 1, "pages")
    assert row["params"] == {"fixed_price": True, "typed_per_answer": 1}


def test_global_row_beats_the_default():
    db = FakeDB(global_rows=[g_row(COPY_CHECK_API_TOOL_KEY, 0, 2, "pages", {"fixed_price": True})])
    est = _est(db, institute_id=INST)
    assert est["estimated_credits"] == 24 and est["rate_source"] == "global"


def test_institute_override_beats_global_and_keeps_the_rows_params():
    db = FakeDB(
        global_rows=[g_row(COPY_CHECK_API_TOOL_KEY, 0, 1, "pages", {"fixed_price": True, "typed_per_answer": 1})],
        overrides=[o_row(COPY_CHECK_API_TOOL_KEY, per_unit=Decimal("0.5"))],
    )
    est = _est(db, institute_id=INST)
    assert est["estimated_credits"] == 6
    assert est["rate_source"] == "override:ov-1" and est["fixed_price"] is True
    # Overrides are read inside a SAVEPOINT so a failure cannot abort the caller's transaction.
    assert db.savepoints == 1
    pricing = ToolCostEstimator(db).get_tool_pricing(COPY_CHECK_API_TOOL_KEY, institute_id=INST)
    assert pricing[COPY_CHECK_API_TOOL_KEY]["params"] == {"fixed_price": True, "typed_per_answer": 1}


def test_null_override_fields_inherit_the_global_value():
    db = FakeDB(
        global_rows=[g_row("copy_check_evaluation", 1, Decimal("0.2"), "questions")],
        overrides=[o_row("copy_check_evaluation", flat=Decimal("0"))],
    )
    est = _est(db, "copy_check_evaluation", {"num_questions": 40}, institute_id=INST)
    assert est["estimated_credits"] == 8          # 0 + 40 x 0.2 (per_unit inherited)
    assert est["fixed_price"] is False


def test_another_institutes_override_is_never_applied():
    db = FakeDB(overrides=[o_row(COPY_CHECK_API_TOOL_KEY, per_unit=Decimal("0.1"), institute_id=OTHER)])
    assert _est(db, institute_id=INST)["estimated_credits"] == 12
    assert _est(db, institute_id=OTHER)["estimated_credits"] == 2   # ceil(1.2)


def test_without_institute_no_override_is_read():
    db = FakeDB(overrides=[o_row(COPY_CHECK_API_TOOL_KEY, per_unit=Decimal("0.1"))])
    assert _est(db)["estimated_credits"] == 12
    assert not any("institute_tool_pricing" in s for s in db.statements)


def test_missing_override_table_falls_back_to_global():
    db = FakeDB(global_rows=[g_row(COPY_CHECK_API_TOOL_KEY, 0, 2, "pages")], overrides_missing=True)
    est = _est(db, institute_id=INST)
    assert est["estimated_credits"] == 24 and est["rate_source"] == "global"


def test_override_for_an_unknown_tool_is_ignored():
    db = FakeDB(overrides=[o_row("no_such_tool", per_unit=5)])
    pricing = ToolCostEstimator(db).get_tool_pricing(institute_id=INST)
    assert "no_such_tool" not in pricing


def test_defaults_are_not_mutated_by_an_override():
    db = FakeDB(global_missing=True, overrides=[o_row(COPY_CHECK_API_TOOL_KEY, per_unit=Decimal("3"))])
    _est(db, institute_id=INST)
    assert tce.DEFAULT_TOOL_PRICING[COPY_CHECK_API_TOOL_KEY]["per_unit_credits"] == 1
    assert "rate_source" not in tce.DEFAULT_TOOL_PRICING[COPY_CHECK_API_TOOL_KEY]


# ── per-page, typed, dashboard math ─────────────────────────────────────────

@pytest.mark.parametrize("pages,credits", [(12, 12), (32, 32), (50, 50), (3, 3), (0, 0)])
def test_api_examples_from_the_spec(pages, credits):
    assert _est(FakeDB(global_missing=True), params={"num_pages": pages})["estimated_credits"] == credits


def test_typed_api_copy_is_priced_per_non_blank_answer():
    est = _est(FakeDB(global_missing=True), params={"answer_mode": "TYPED", "num_answers": 4, "num_pages": 30})
    assert est["estimated_credits"] == 4 and est["unit_field"] == "answers"
    assert est["breakdown"][0]["component"] == "answers"


def test_typed_rate_follows_the_override():
    db = FakeDB(overrides=[o_row(COPY_CHECK_API_TOOL_KEY, params={"typed_per_answer": 0.5})])
    est = _est(db, params={"answer_mode": "TYPED", "num_answers": 5}, institute_id=INST)
    assert est["estimated_credits"] == 3      # ceil(2.5)


def test_typed_rule_needs_typed_per_answer_on_the_row():
    # The dashboard key has no typed_per_answer: answer_mode changes nothing.
    est = _est(FakeDB(global_missing=True), "copy_check_evaluation",
               {"answer_mode": "TYPED", "num_questions": 10, "num_answers": 2})
    assert est["estimated_credits"] == 3      # 1 + 10 x 0.2


def test_dashboard_key_is_unchanged():
    est = _est(FakeDB(global_missing=True), "copy_check_evaluation", {"num_questions": 64})
    assert est["estimated_credits"] == 14     # ceil(1 + 12.8)
    assert est["fixed_price"] is False and est["rate_source"] == "default"


# ── rate snapshot ───────────────────────────────────────────────────────────

SNAP = {"tool_key": COPY_CHECK_API_TOOL_KEY, "flat_base_credits": 0, "per_unit_credits": 3,
        "unit_field": "pages", "params": {"fixed_price": True, "typed_per_answer": 2},
        "rate_source": "override:ov-old"}


def test_snapshot_wins_over_todays_override():
    db = FakeDB(overrides=[o_row(COPY_CHECK_API_TOOL_KEY, per_unit=Decimal("0.5"))])
    est = _est(db, institute_id=INST, rate_snapshot=SNAP)
    assert est["estimated_credits"] == 36 and est["rate_source"] == "override:ov-old"
    typed = _est(db, params={"answer_mode": "TYPED", "num_answers": 4}, institute_id=INST, rate_snapshot=SNAP)
    assert typed["estimated_credits"] == 8


def test_snapshot_for_another_tool_is_ignored():
    est = _est(FakeDB(global_missing=True), rate_snapshot=dict(SNAP, tool_key="copy_check_evaluation"))
    assert est["estimated_credits"] == 12 and est["rate_source"] == "default"


def test_snapshot_without_source_reads_snapshot():
    est = _est(FakeDB(global_missing=True), rate_snapshot=dict(SNAP, rate_source=None))
    assert est["rate_source"] == "snapshot"


def test_unknown_tool_still_raises():
    with pytest.raises(ValueError):
        ToolCostEstimator(FakeDB(global_missing=True)).estimate("nope", {})


def test_estimate_with_balance_prices_at_the_institute_rate(monkeypatch):
    credit_mod = sys.modules["app.services.credit_service"]
    monkeypatch.setattr(credit_mod, "CreditService", lambda db: SimpleNamespace(
        get_balance=lambda iid: SimpleNamespace(current_balance=Decimal("10"))), raising=False)
    db = FakeDB(overrides=[o_row(COPY_CHECK_API_TOOL_KEY, per_unit=Decimal("0.5"))])
    res = ToolCostEstimator(db).estimate_with_balance(COPY_CHECK_API_TOOL_KEY, {"num_pages": 12}, INST)
    assert res["estimated_credits"] == 6 and res["sufficient"] is True and res["balance_after"] == 4


# ── charge_tool ─────────────────────────────────────────────────────────────

@pytest.fixture
def ledger(monkeypatch):
    calls = {"deduct": [], "usage": []}

    class FakeUsage:
        def __init__(self, db):
            pass

        def record_usage_and_deduct_credits(self, **kw):
            calls["deduct"].append(kw)

        def record_usage(self, **kw):
            calls["usage"].append(kw)

    credit_mod = sys.modules["app.services.credit_service"]
    monkeypatch.setattr(credit_mod, "CreditService", lambda db: SimpleNamespace(
        calculate_credits=lambda **kw: Decimal("50")), raising=False)
    monkeypatch.setattr(ai_billing, "TokenUsageService", FakeUsage)
    return calls


def _charge(db, tool_key=COPY_CHECK_API_TOOL_KEY, params=None, **kw):
    return ai_billing.charge_tool(
        db, tool_key=tool_key, tool_params=params if params is not None else {"num_pages": 12},
        request_type="evaluation", model="glm", prompt_tokens=90000, completion_tokens=9000,
        institute_id=INST, idempotency_key="proc-1", **kw)


def test_api_charge_is_the_quote_without_token_overage(ledger):
    charged = _charge(FakeDB(global_missing=True), user_id="apikey:key-1", user_role="API_KEY")
    assert charged == Decimal("12")                       # actual 50 ignored
    d = ledger["deduct"][0]
    assert d["precomputed_credits"] == Decimal("12") and d["allow_negative"] is True
    assert d["user_id"] == "apikey:key-1" and d["user_role"] == "API_KEY"
    assert d["idempotency_key"] == "proc-1"
    assert "copy_check_evaluation_api" in d["description"] and "rate default" in d["description"]


def test_dashboard_charge_keeps_max_of_quote_and_actual(ledger):
    charged = _charge(FakeDB(global_missing=True), "copy_check_evaluation", {"num_questions": 10})
    assert charged == Decimal("50")
    assert ledger["deduct"][0]["description"].startswith("evaluation using glm")


def test_no_token_overage_override_charges_the_quote(ledger):
    db = FakeDB(overrides=[o_row("copy_check_evaluation", no_token_overage=True, id="ov-9")])
    charged = _charge(db, "copy_check_evaluation", {"num_questions": 10})
    assert charged == Decimal("3")
    assert "rate override:ov-9" in ledger["deduct"][0]["description"]


def test_charge_uses_the_snapshot(ledger):
    db = FakeDB(overrides=[o_row(COPY_CHECK_API_TOOL_KEY, per_unit=Decimal("0.5"))])
    assert _charge(db, rate_snapshot=SNAP) == Decimal("36")
    assert "rate override:ov-old" in ledger["deduct"][0]["description"]


def test_charge_uses_the_institute_override(ledger):
    db = FakeDB(overrides=[o_row(COPY_CHECK_API_TOOL_KEY, per_unit=Decimal("0.5"))])
    assert _charge(db) == Decimal("6")


def test_zero_fixed_price_records_usage_without_a_deduction(ledger):
    assert _charge(FakeDB(global_missing=True), params={"num_pages": 0}) == Decimal("0")
    assert ledger["deduct"] == [] and len(ledger["usage"]) == 1


def test_record_tool_billing_passes_the_snapshot_and_actor(monkeypatch):
    seen = {}

    @contextmanager
    def fake_session():
        yield object()

    monkeypatch.setattr(ai_billing, "db_session", fake_session)
    monkeypatch.setattr(ai_billing, "charge_tool", lambda db, **kw: seen.update(kw))
    ai_billing.record_tool_billing(tool_key=COPY_CHECK_API_TOOL_KEY, tool_params={"num_pages": 3},
                                   request_type="evaluation", model="m", institute_id=INST,
                                   user_id="apikey:k", user_role="API_KEY", rate_snapshot=SNAP)
    assert seen["rate_snapshot"] == SNAP and seen["user_id"] == "apikey:k"


def test_record_tool_billing_still_skips_without_institute(monkeypatch):
    monkeypatch.setattr(ai_billing, "charge_tool", lambda db, **kw: pytest.fail("charged"))
    ai_billing.record_tool_billing(tool_key=COPY_CHECK_API_TOOL_KEY, tool_params={}, request_type="e", model="m")


# ── /credits/v1/tool-pricing ────────────────────────────────────────────────

def _token(authorities):
    secret = get_settings().jwt_secret_key
    secret += "=" * (-len(secret) % 4)
    claims = {"sub": "alice", "username": "alice", "user": "u1", "authorities": authorities}
    return "Bearer " + jwt.encode(claims, base64.b64decode(secret), algorithm="HS256")


class _Req:
    def __init__(self, headers):
        self.headers = headers


class _SpyEstimator:
    def __init__(self):
        self.institute = "unset"

    def get_tool_pricing(self, tool_key=None, institute_id=None):
        self.institute = institute_id
        return {"copy_check_evaluation_api": {"request_type": "evaluation", "flat_base_credits": Decimal("0"),
                                              "per_unit_credits": Decimal("1"), "unit_field": "pages",
                                              "params": {}, "rate_source": "default"}}


@pytest.mark.parametrize("headers,auth_inst,expected", [
    ({"clientId": INST}, INST, INST),        # member: overrides merged
    ({"clientId": INST}, OTHER, None),       # not a member: global rates
    ({}, INST, None),                        # no clientId: global
    ({"clientId": INST}, None, None),        # anonymous: global
])
def test_tool_pricing_merges_overrides_only_for_members(headers, auth_inst, expected):
    from app.routers import credits

    spy = _SpyEstimator()
    auth = _token({auth_inst: {"roles": ["ADMIN"]}}) if auth_inst else None
    out = credits.get_tool_pricing(_Req(headers), estimator=spy, authorization=auth)
    assert spy.institute == expected
    assert out["tools"][0]["rate_source"] == "default"


# ── the estimate carries the snapshot to store at enqueue ───────────────────

def test_estimate_returns_a_replayable_rate_snapshot():
    db = FakeDB(overrides=[o_row(COPY_CHECK_API_TOOL_KEY, per_unit=Decimal("0.5"))])
    typed = _est(db, params={"answer_mode": "TYPED", "num_answers": 4}, institute_id=INST)
    snap = typed["rate_snapshot"]
    assert snap == {"tool_key": COPY_CHECK_API_TOOL_KEY, "flat_base_credits": 0.0, "per_unit_credits": 0.5,
                    "unit_field": "pages", "params": {"fixed_price": True, "typed_per_answer": 1},
                    "rate_source": "override:ov-1"}
    # Replayed after the override is gone, the snapshot still prices 12 pages at 0.5.
    replay = _est(FakeDB(global_missing=True), institute_id=INST, rate_snapshot=snap)
    assert replay["estimated_credits"] == 6 and replay["rate_source"] == "override:ov-1"


def test_no_token_overage_survives_the_snapshot(ledger):
    db = FakeDB(overrides=[o_row("copy_check_evaluation", no_token_overage=True, id="ov-9")])
    snap = _est(db, "copy_check_evaluation", {"num_questions": 10}, institute_id=INST)["rate_snapshot"]
    assert snap["params"]["no_token_overage"] is True
    charged = _charge(FakeDB(global_missing=True), "copy_check_evaluation", {"num_questions": 10},
                      rate_snapshot=snap)
    assert charged == Decimal("3")             # no overage although actual is 50
