"""Paid AI plans in the plan engine (services/metering/plans.py) on SQLite, plus
the pure proration / price helpers of routers/plans_billing_internal.py.

  * engine gate: a source=PAYMENT subscription gives benefits only for a PAID
    (or WAIVED) period; no period row / DUE / REFUNDED = CHARGED (reason UNPAID),
    GRACE included; the engine never opens a PAYMENT period lazily;
  * MANUAL / COMPLIMENTARY decisions are unchanged (period opened lazily);
  * the global switch cannot strip benefits from a LIVE paid plan (critique #9),
    and with every flag at its default nothing changes: PLANS_OFF, no refresh,
    no thread, zero statements;
  * proration: day-based in IST (first / last day, 28-31-day months, < Re 1
    free, allowance delta), tax-inclusive base.

Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_plans_payment_engine.py -q -p no:cacheprovider
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")

import test_plans_engine as base  # noqa: E402

from ai_service.app.routers import plans_billing_internal as pb  # noqa: E402
from ai_service.app.services import model_selection  # noqa: E402
from ai_service.app.services.metering import cache as mcache  # noqa: E402
from ai_service.app.services.metering import limits as L  # noqa: E402
from ai_service.app.services.metering import plans as P  # noqa: E402

INST = base.INST
GLM = base.GLM
UTC = timezone.utc
D = Decimal
LA = {"learner_assistant": {"mode": "INCLUDED"}}


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    P.reset_for_tests()
    L.reset_for_tests()
    mcache.reset_cache()
    model_selection.invalidate_cache()
    settings = {"billing.plans.enabled": True, "billing.inr_per_usd": 86, "metering.events.enabled": True,
                "billing.subscriptions.payments.enabled": False}
    monkeypatch.setattr(mcache, "setting_value", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(mcache, "peek_setting", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(P, "_maybe_refresh_index", lambda: None)
    yield settings
    P.reset_for_tests()
    mcache.reset_cache()
    model_selection.invalidate_cache()


@pytest.fixture
def w():
    world = base.World()
    yield world
    world.engine.dispose()
    try:
        os.unlink(world.path)
    except OSError:
        pass


def _period(w, sid, vid, start, end, status):
    """Through the Core table (the same DateTime binding the engine uses on SQLite)."""
    from sqlalchemy import insert

    from ai_service.app.services.metering.plan_models import PERIOD_TABLE
    with w.engine.begin() as c:
        c.execute(insert(PERIOD_TABLE).values(
            id=str(uuid.uuid4()), subscription_id=sid, period_start=start, period_end=end, plan_version_id=vid,
            price_minor_snapshot=500000, allowance_credits=0, allowance_used=0, payment_status=status,
            created_at=datetime.now(UTC)))
    P.invalidate()


def _window(days_ago=3):
    start = datetime.now(UTC) - timedelta(days=days_ago)
    return start, P.period_window(start, 1, datetime.now(UTC))


# ── engine gate ──────────────────────────────────────────────────────────────

def test_paid_plan_without_a_period_row_is_charged_and_opens_none(w):
    vid = w.plan(LA)
    start, (ps, pe) = _window()
    sid = w.subscribe(vid, source="PAYMENT", start=start)
    d = w.decide()
    assert (d.billing_mode, d.reason, d.wallet_credits) == ("CHARGED", "UNPAID", D("1.0000"))
    assert w.all("SELECT * FROM ai_subscription_period WHERE subscription_id = :s", s=sid) == []   # never lazily
    pre = P.precheck(w.Session(), institute_id=INST, use_case="learner_assistant", estimate=1)
    assert pre["covered"] is False and pre["reason"] == "UNPAID"


@pytest.mark.parametrize("status,covered", [("DUE", False), ("REFUNDED", False), ("PAID", True), ("WAIVED", True)])
def test_paid_plan_benefits_follow_the_period_payment_status(w, status, covered):
    vid = w.plan(LA)
    start, (ps, pe) = _window()
    sid = w.subscribe(vid, source="PAYMENT", start=start)
    _period(w, sid, vid, ps, pe, status)
    d = w.decide()
    if covered:
        assert d.billing_mode == "INCLUDED" and d.subscription_id == sid
    else:
        assert (d.billing_mode, d.reason) == ("CHARGED", "UNPAID")


def test_grace_with_unpaid_period_is_charged_even_if_grace_is_included(w):
    vid = w.plan(LA, grace_behaviour="INCLUDED")
    start, (ps, pe) = _window(40)
    sid = w.subscribe(vid, source="PAYMENT", start=start, status="GRACE")
    d = w.decide()
    assert (d.billing_mode, d.reason) == ("CHARGED", "UNPAID")
    # a MANUAL subscription keeps V588 grace semantics (INCLUDED grace opens the period lazily)
    other = "inst-manual"
    w.subscribe(vid, inst=other, start=datetime.now(UTC) - timedelta(days=2), status="GRACE")
    assert w.decide(institute_id=other).billing_mode == "INCLUDED"
    assert sid


def test_paid_period_in_grace_status_still_gives_benefits(w):
    """A renewal paid a moment before the roll flips GRACE back: the PAID period decides."""
    vid = w.plan(LA)
    start, (ps, pe) = _window()
    sid = w.subscribe(vid, source="PAYMENT", start=start, status="GRACE")
    _period(w, sid, vid, ps, pe, "PAID")
    assert w.decide().billing_mode == "INCLUDED"


def test_manual_subscription_unchanged_period_opened_lazily(w):
    vid = w.plan(LA)
    start, (ps, pe) = _window()
    sid = w.subscribe(vid, source="MANUAL", start=start)
    d = w.decide()
    assert d.billing_mode == "INCLUDED"
    rows = w.all("SELECT payment_status FROM ai_subscription_period WHERE subscription_id = :s", s=sid)
    assert [r["payment_status"] for r in rows] == ["DUE"]
    # COMPLIMENTARY likewise
    sid2 = w.subscribe(vid, source="COMPLIMENTARY", inst="inst-comp", start=start)
    assert w.decide(institute_id="inst-comp").billing_mode == "INCLUDED"
    assert [r["payment_status"] for r in w.all("SELECT payment_status FROM ai_subscription_period WHERE "
                                               "subscription_id = :s", s=sid2)] == ["COMPLIMENTARY"]


def test_may_open_is_false_for_paid_plans():
    now = datetime.now(UTC)
    sub = P.Sub(id="s", institute_id="i", plan_version_id="v", status="ACTIVE", enforcement="LIVE", source="PAYMENT",
                anchor_at=now, start_at=now, end_at=None, period_months=1, auto_renew=True, grace_days=7,
                cancel_at_period_end=False, pending_plan_version_id=None, price_override_minor=None, updated_at=now)
    assert P._may_open(sub, now - timedelta(hours=1), now + timedelta(days=30)) is False  # noqa: SLF001
    manual = P.Sub(**{**sub.__dict__, "source": "MANUAL"})
    assert P._may_open(manual, now - timedelta(hours=1), now + timedelta(days=30)) is True  # noqa: SLF001


# ── the global switch cannot strip paid benefits (critique #9) ───────────────

def test_switch_off_keeps_live_paid_plans_and_stops_the_others(w, _isolate):
    vid = w.plan(LA)
    start, (ps, pe) = _window()
    paid_sid = w.subscribe(vid, source="PAYMENT", start=start, inst="inst-paid")
    _period(w, paid_sid, vid, ps, pe, "PAID")
    w.subscribe(vid, source="MANUAL", start=start, inst="inst-manual")
    w.subscribe(vid, source="PAYMENT", start=start, inst="inst-paid-shadow", enforcement="SHADOW")
    P.set_index_for_tests(["inst-paid", "inst-manual", "inst-paid-shadow"], paid=["inst-paid"])
    _isolate["billing.plans.enabled"] = False
    assert w.decide(institute_id="inst-paid").billing_mode == "INCLUDED"
    d = w.decide(institute_id="inst-manual")
    assert (d.billing_mode, d.reason) == ("CHARGED", "PLANS_OFF")
    d = w.decide(institute_id="inst-paid-shadow")
    assert (d.billing_mode, d.reason) == ("CHARGED", "PLANS_OFF")
    s = w.Session()
    assert P.precheck(s, institute_id="inst-paid", use_case="learner_assistant", estimate=1)["covered"] is True
    assert P.precheck(s, institute_id="inst-manual", use_case="learner_assistant", estimate=1)["covered"] is False
    s.close()


def test_index_refresh_records_live_paid_institutes(w):
    vid = w.plan(LA)
    start, _ = _window()
    w.subscribe(vid, source="PAYMENT", start=start, inst="inst-paid")
    w.subscribe(vid, source="PAYMENT", start=start, inst="inst-paid-shadow", enforcement="SHADOW")
    w.subscribe(vid, source="MANUAL", start=start, inst="inst-manual")
    w.subscribe(vid, source="PAYMENT", start=start, inst="inst-pending", status="PENDING")
    assert P.refresh_index()
    assert P._index.paid_ids == frozenset({"inst-paid"})  # noqa: SLF001
    assert "inst-pending" not in P._index.ids  # noqa: SLF001 - PENDING is never live
    P.invalidate("inst-paid", live=False)
    assert "inst-paid" not in P._index.paid_ids  # noqa: SLF001


def test_defaults_switch_off_no_paid_plans_zero_io(w, _isolate, monkeypatch):
    """Every flag at its default: exactly V588 behaviour, no thread, no statement."""
    vid = w.plan(LA)
    w.subscribe(vid)
    _isolate["billing.plans.enabled"] = False
    started = []
    monkeypatch.setattr(P, "_maybe_refresh_index", base._REAL_MAYBE_REFRESH)
    monkeypatch.setattr(P, "_background", lambda target, name: started.append(name))
    P._index.attempted_at = None  # noqa: SLF001
    s = w.Session()
    w.statements.clear()
    for _ in range(3):
        assert P.has_live_subscription(INST) is False
        assert P.decide(s, institute_id=INST, list_credits=5, use_case="learner_assistant").reason == "PLANS_OFF"
    assert started == [] and w.statements == []
    s.close()


def test_switch_off_with_payments_on_refreshes_in_the_background(w, _isolate, monkeypatch):
    _isolate["billing.plans.enabled"] = False
    _isolate["billing.subscriptions.payments.enabled"] = True
    started = []
    monkeypatch.setattr(P, "_maybe_refresh_index", base._REAL_MAYBE_REFRESH)
    monkeypatch.setattr(P, "_background", lambda target, name: started.append(name))
    P._index.attempted_at = None  # noqa: SLF001
    assert P.has_live_subscription("anyone") is False
    assert started == ["ai-plans-index"]


# ── proration and prices (pure) ──────────────────────────────────────────────

IST = pb.IST


def _ist(y, m, d, hh=10, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IST).astimezone(UTC)


def test_prorate_first_and_last_day_and_month_lengths():
    ps, pe = _ist(2026, 11, 1), _ist(2026, 12, 1)                   # 30 IST days
    q = pb.prorate(500000, 800000, 2000, 3000, ps, pe, _ist(2026, 11, 1, 11))
    assert (q["period_days"], q["remaining_days"]) == (30, 30)
    assert (q["credit_minor"], q["new_minor"], q["base_minor"]) == (500000, 800000, 300000)
    assert q["allowance_delta"] == 1000.0
    q = pb.prorate(500000, 800000, 2000, 3000, ps, pe, _ist(2026, 11, 16, 12))
    assert q["remaining_days"] == 15 and q["base_minor"] == 150000 and q["allowance_delta"] == 500.0
    q = pb.prorate(500000, 800000, 2000, 3000, ps, pe, _ist(2026, 11, 30, 23, 59))
    assert q["remaining_days"] == 1 and q["base_minor"] == 10000
    q = pb.prorate(500000, 800000, 0, 0, ps, pe, _ist(2026, 12, 1, 9))  # the end day itself: nothing left
    assert q["remaining_days"] == 0 and q["base_minor"] == 0 and q["free"] is True
    for (a, b), days in ((((2027, 2, 1), (2027, 3, 1)), 28), (((2026, 1, 1), (2026, 2, 1)), 31),
                         (((2028, 2, 1), (2028, 3, 1)), 29)):
        q = pb.prorate(310000, 620000, 0, 0, _ist(*a), _ist(*b), _ist(*a))
        assert q["period_days"] == days and q["base_minor"] == 310000


def test_prorate_rounds_each_term_and_never_goes_negative():
    ps, pe = _ist(2026, 11, 1), _ist(2026, 12, 1)
    q = pb.prorate(100001, 100002, 0, 0, ps, pe, _ist(2026, 11, 21))     # 10/30 days
    assert q["credit_minor"] == 33334 and q["new_minor"] == 33334 and q["base_minor"] == 0 and q["free"]
    q = pb.prorate(800000, 500000, 0, 0, ps, pe, _ist(2026, 11, 21))
    assert q["base_minor"] == 0                                          # a downgrade never pays back
    q = pb.prorate(500000, 500290, 0, 0, ps, pe, _ist(2026, 11, 21))     # 166667 - 166667 + 96.67 -> 96
    assert q["base_minor"] == 96 and q["free"] is True                    # below Re 1: applied free


def test_prorate_uses_ist_days_not_utc():
    ps, pe = _ist(2026, 11, 1, 0, 30), _ist(2026, 12, 1, 0, 30)
    # 30 Nov 19:00 UTC = 1 Dec 00:30 IST: the IST calendar says the period is over
    q = pb.prorate(300000, 600000, 0, 0, ps, pe, datetime(2026, 11, 30, 19, 0, tzinfo=UTC))
    assert q["remaining_days"] == 0
    q = pb.prorate(300000, 600000, 0, 0, ps, pe, datetime(2026, 11, 30, 18, 0, tzinfo=UTC))   # 23:30 IST 30 Nov
    assert q["remaining_days"] == 1


def test_base_of_tax_inclusive_price():
    assert pb.base_of(590000, False) == 590000
    assert pb.base_of(590000, True) == 500000
    assert pb.base_of(100, True) == 85            # tax = total - base = 15, never recomputed on the base
    for total in (1, 99, 101, 117, 118, 999999, 1180001):
        base = pb.base_of(total, True)
        assert 0 <= base <= total and abs(base * 1.18 - total) <= 1


def test_describe_uses_ist_dates_and_no_brand():
    ch = {"kind": "PERIOD", "service_start": _ist(2026, 11, 1, 0, 0), "service_end": _ist(2026, 12, 1, 0, 0)}
    assert pb.describe(ch, {"plan_name": "AI Pro"}) == "AI Pro subscription, 01-11-2026 to 30-11-2026"
    up = {"kind": "UPGRADE", "service_start": _ist(2026, 11, 16, 12), "service_end": _ist(2026, 12, 1, 0, 0)}
    assert pb.describe(up, {"plan_name": "AI Max"}, {"plan_name": "AI Pro"}) == \
        "Upgrade AI Pro to AI Max, 16-11-2026 to 30-11-2026"
