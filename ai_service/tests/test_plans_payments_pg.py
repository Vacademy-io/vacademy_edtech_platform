"""Paid AI plans (payments design 2026-10-16, contract [A]) on a REAL Postgres 16
with the real Flyway migrations V586 + V587 + V588 + V590, through SQLAlchemy +
psycopg 3:

  internal   /internal/plans/v1/{storefront/catalog, subscriptions/quote|checkout|{id}/change,
             charges, charges/{id}, charges/{id}/paid|refunded|void|waive}, /roll
  super admin  source=PAYMENT assignment, billing timeline, send-link, listing,
             audience, segments, storefront switches, preview
  tenant     /credits/v2/institutes/{id}/plan billing block, switch-off protection

Covers every charge / subscription transition, idempotent and concurrent /paid,
amount mismatch 409, duplicate / late payments, wrong vendor_payment_id refund
409, grace and expiry timing, the roll never pre-creating periods, upgrades
(pro-rata, re-priced renewal, refund revert), downgrades, cancel / resume,
checkout expiry and late activation, the storefront gate, no USD / caps in the
catalog, and MANUAL subscriptions rolling exactly as before next to paid ones.

Needs a Postgres: AI_LIMITS_PG_URL or AI_LIMITS_PGDATA (see test_plans_api.py).
Skipped otherwise, or while V590 is not in the checkout.
"""
from __future__ import annotations

import os
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import test_plans_api as base  # noqa: E402

from ai_service.app import config as app_config  # noqa: E402
from ai_service.app import dependencies as app_deps  # noqa: E402
from ai_service.app.config import get_settings  # noqa: E402
from ai_service.app.core import security  # noqa: E402
from ai_service.app.db import db_dependency  # noqa: E402
from ai_service.app.routers import credits_plan as cp  # noqa: E402
from ai_service.app.routers import plans_admin as pa  # noqa: E402
from ai_service.app.routers import plans_billing_internal as pb  # noqa: E402
from ai_service.app.routers import plans_internal as pi  # noqa: E402
from ai_service.app.services.metering import plans as engine_mod  # noqa: E402

UTC = timezone.utc
SA = "/super-admin/v1/plans"
IN = "/internal/plans/v1"
TOKEN = base.TOKEN
H = {"X-Internal-Service-Token": TOKEN}

PLATFORM_STUBS = """
CREATE TABLE IF NOT EXISTS platform_invoice (id VARCHAR(255) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS platform_payment (id VARCHAR(255) PRIMARY KEY, vendor_payment_id VARCHAR(64));
CREATE TABLE IF NOT EXISTS platform_payment_item (id VARCHAR(255) PRIMARY KEY, pack_id VARCHAR(255) NOT NULL);
CREATE TABLE IF NOT EXISTS platform_payment_config (id VARCHAR(255) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS institute_suborg (id VARCHAR(255) PRIMARY KEY, institute_id VARCHAR(255),
    suborg_id VARCHAR(255), status VARCHAR(255));
"""


@pytest.fixture(scope="module")
def pg():
    url = base._server_url()  # noqa: SLF001
    if not url:
        pytest.skip("no Postgres: set AI_LIMITS_PG_URL or AI_LIMITS_PGDATA")
    if not sorted(base.MIGRATIONS.glob("V590__*.sql")):
        pytest.skip("V590 not in this checkout")
    name = f"plpay_{uuid.uuid4().hex[:10]}"
    admin = create_engine(url, isolation_level="AUTOCOMMIT", future=True)
    template = os.environ.get("AI_LIMITS_PG_TEMPLATE")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"' + (f' TEMPLATE "{template}"' if template else "")))
    db_url = url.replace("/postgres?", f"/{name}?") if "/postgres?" in url else url.rsplit("/", 1)[0] + f"/{name}"
    engine = create_engine(db_url, pool_size=20, max_overflow=10, future=True)
    with engine.begin() as c:
        c.exec_driver_sql(base.STUBS)
        c.exec_driver_sql(PLATFORM_STUBS)
    for prefix in ("V586", "V587", "V588", "V590", "V590"):        # V590 twice: idempotent
        sql = base._migration(prefix)  # noqa: SLF001
        raw = engine.raw_connection()
        try:
            cur = raw.cursor()
            cur.execute(sql)
            raw.commit()
        finally:
            raw.close()
    yield engine
    engine.dispose()
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


class FakeEngine:
    period_window = staticmethod(engine_mod.period_window)

    def __init__(self):
        self.calls = []

    def invalidate(self, institute_id=None, *, live=None, paid=None, version_id=None):
        self.calls.append((institute_id, live, paid))


@pytest.fixture
def env(pg, monkeypatch):
    real = get_settings()
    stub = SimpleNamespace(jwt_secret_key=real.jwt_secret_key, jwt_algorithm=real.jwt_algorithm,
                           super_admin_user_ids=base.STAFF, internal_service_token=TOKEN, client_secret=None,
                           client_name=getattr(real, "client_name", None),
                           auth_service_base_url=getattr(real, "auth_service_base_url", None))
    monkeypatch.setattr(security, "get_settings", lambda: stub)
    import ai_service.app.routers.super_admin as sa_mod
    monkeypatch.setattr(sa_mod, "get_settings", lambda: stub)
    monkeypatch.setattr(app_deps, "get_settings", lambda: stub)
    fake = FakeEngine()
    state = {"enabled": True, "payments": True, "autopay": False, "mode": "ALL"}
    monkeypatch.setattr(pa, "get_plans_engine", lambda: fake)
    monkeypatch.setattr(pa, "plans_enabled", lambda: state["enabled"])
    monkeypatch.setattr(pb, "payments_enabled", lambda: state["payments"])
    monkeypatch.setattr(pb, "autopay_enabled", lambda: state["autopay"])
    monkeypatch.setattr(pb, "storefront_mode", lambda: state["mode"])
    monkeypatch.setattr(cp, "_default_chain_models", lambda db, key: ["z-ai/glm-5.3-flash"])
    pa.reset_for_tests()
    pb.reset_for_tests()
    with pg.begin() as c:
        for t in ("ai_subscription_charge", "ai_subscription_mandate", "ai_storefront_audience",
                  "ai_storefront_institute", "ai_institute_segment", "ai_subscription_event",
                  "ai_subscription_override", "ai_subscription_period", "institute_ai_subscription",
                  "ai_usage_counter", "ai_model_change_log", "institute_suborg"):
            c.execute(text(f"DELETE FROM {t}"))
        c.execute(text("UPDATE ai_plan SET listed = false"))
    Session = sessionmaker(bind=pg, future=True)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    for r in (pa.router, cp.router, pi.router, pb.router):
        app.include_router(r)
    app.dependency_overrides[db_dependency] = _db
    app.dependency_overrides[app_config.get_settings] = lambda: stub
    return SimpleNamespace(client=TestClient(app), engine=pg, fake=fake, state=state, Session=Session)


# ── helpers ─────────────────────────────────────────────────────────────────

def staff():
    return base.staff()


def _inst(env, name="Paid Institute"):
    return base._inst(env, name)  # noqa: SLF001


def _q(env, sql, **params):
    """Rows of a SELECT / RETURNING statement; [] for a plain UPDATE / DELETE."""
    with env.engine.begin() as c:
        res = c.execute(text(sql), params)
        return [dict(r._mapping) for r in res] if res.returns_rows else []  # noqa: SLF001


def _published(env, price=500000, allowance=2000, listed=True, audience="ALL", name=None, **terms):
    pid, vid = base._published(env, price_minor=price, allowance_credits=allowance, **terms)  # noqa: SLF001
    if name:
        _q(env, "UPDATE ai_plan SET name = :n WHERE id = CAST(:p AS UUID)", n=name, p=pid)
    if listed:
        r = env.client.patch(f"{SA}/plans/{pid}/listing", json={"listed": True, "audience_mode": audience,
                                                                "tagline": "Everyday AI", "reason": "t"},
                             headers=staff())
        assert r.status_code == 200, r.text
    return pid, vid


def _checkout(env, iid, vid, key=None):
    return env.client.post(f"{IN}/subscriptions/checkout", headers=H,
                           json={"institute_id": iid, "plan_version_id": vid, "actor": "buyer-1",
                                 "idempotency_key": key})


def _price(env, cid, base_minor=500000, pos="27", **extra):
    tax = round(base_minor * 18 / 100)
    body = {"tax_minor": tax, "total_minor": base_minor + tax, "place_of_supply": pos,
            "tax_head": "CGST_SGST" if pos == "23" else "IGST", **extra}
    r = env.client.patch(f"{IN}/charges/{cid}", headers=H, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _pay(env, cid, amount, vendor, pp="pp-1"):
    return env.client.post(f"{IN}/charges/{cid}/paid", headers=H,
                           json={"platform_payment_id": pp, "vendor_payment_id": vendor, "amount_minor": amount})


def _active(env, iid, vid, base_minor=500000):
    r = _checkout(env, iid, vid)
    assert r.status_code == 200, r.text
    cid = r.json()["charge_id"]
    ch = _price(env, cid, base_minor)
    r = _pay(env, cid, ch["total_minor"], f"pay_{uuid.uuid4().hex[:10]}")
    assert r.status_code == 200 and r.json()["action"] == "ACTIVATED", r.text
    return r.json()


def _call(env, fn, *args, **kw):
    s = env.Session()
    try:
        out = fn(s, *args, **kw)
        s.commit()
        return out
    finally:
        s.close()


def _roll(env, now, institute_id=None):
    s = env.Session()
    try:
        return pi.roll(s, now=now, institute_id=institute_id)
    finally:
        s.close()


def _sub(env, sid):
    return _q(env, "SELECT * FROM institute_ai_subscription WHERE id = CAST(:s AS UUID)", s=sid)[0]


def _periods(env, sid):
    return _q(env, "SELECT * FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID) "
                   "ORDER BY period_start", s=sid)


def _charges(env, sid):
    return _q(env, "SELECT * FROM ai_subscription_charge WHERE subscription_id = CAST(:s AS UUID) "
                   "ORDER BY created_at", s=sid)


def _no_usd(obj, path="$"):
    if isinstance(obj, dict):
        for k, v in obj.items():
            assert "usd" not in str(k).lower() and not str(k).endswith("_cap"), f"{path}.{k}"
            _no_usd(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _no_usd(v, f"{path}[{i}]")


# ── auth ────────────────────────────────────────────────────────────────────

def test_internal_billing_routes_need_the_service_token(env):
    c = env.client
    for method, path in (("GET", f"{IN}/storefront/catalog?institute_id=x"), ("GET", f"{IN}/charges"),
                         ("POST", f"{IN}/subscriptions/checkout"), ("POST", f"{IN}/charges/{uuid.uuid4()}/paid")):
        assert c.request(method, path, json={}).status_code == 401
        assert c.request(method, path, json={}, headers=staff()).status_code == 401
    assert c.get(f"{IN}/charges", headers=H).status_code == 200


# ── checkout ────────────────────────────────────────────────────────────────

def test_checkout_pending_charge_replay_and_supersede(env):
    iid = _inst(env)
    _, vid = _published(env)
    _, vid2 = _published(env, price=800000)
    r = _checkout(env, iid, vid, key="k1")
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j["status"], j["kind"], j["base_minor"], j["total_minor"], j["replayed"]) == \
        ("PENDING", "PERIOD", 500000, None, False)
    sub = _sub(env, j["subscription_id"])
    assert (sub["status"], sub["source"], sub["enforcement"]) == ("PENDING", "PAYMENT", "LIVE")
    assert _periods(env, j["subscription_id"]) == []                      # nothing before the money
    ch = _charges(env, j["subscription_id"])[0]
    assert (ch["institute_id"], ch["idempotency_key"], ch["status"]) == (iid, "k1", "DUE")
    assert ch["description"].startswith("Plan ") and "subscription" in ch["description"]
    assert _checkout(env, iid, vid, key="k1").json()["charge_id"] == j["charge_id"]          # same key
    again = _checkout(env, iid, vid, key="k2").json()                                       # same version
    assert again["charge_id"] == j["charge_id"] and again["replayed"] is True
    other = _checkout(env, iid, vid2, key="k3").json()
    assert other["subscription_id"] != j["subscription_id"]
    assert [x["charge_id"] for x in other["superseded"]] == [j["charge_id"]]
    assert _sub(env, j["subscription_id"])["status"] == "CANCELLED"
    old = _charges(env, j["subscription_id"])[0]
    assert (old["status"], old["void_reason"]) == ("VOID", "SUPERSEDED")
    assert _q(env, "SELECT count(*) AS n FROM institute_ai_subscription WHERE institute_id = :i AND status = "
                   "'PENDING'", i=iid)[0]["n"] == 1
    # PENDING is never live: the tenant sees no plan, the engine index none
    r = env.client.get(f"/credits/v2/institutes/{iid}/plan", headers=base._hdr(iid))  # noqa: SLF001
    assert r.json()["plan"] is None


def test_checkout_gates(env):
    c = env.client
    iid = _inst(env)
    pid, vid = _published(env)
    env.state["payments"] = False
    r = _checkout(env, iid, vid)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "PAYMENTS_OFF"
    env.state["payments"] = True
    env.state["mode"] = "OFF"
    r = _checkout(env, iid, vid)
    assert r.status_code == 404 and r.json()["detail"]["code"] == "STOREFRONT_OFF"
    env.state["mode"] = "ALLOWLIST"
    assert _checkout(env, iid, vid).status_code == 404
    r = c.put(f"{SA}/storefront/audience", json={"institute_ids": [iid], "reason": "pilot"}, headers=staff())
    assert r.status_code == 200, r.text
    # plan audience ALLOWLIST without this institute: not offered
    assert c.patch(f"{SA}/plans/{pid}/listing", json={"audience_mode": "ALLOWLIST", "reason": "t"},
                   headers=staff()).status_code == 200
    r = _checkout(env, iid, vid)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "NOT_OFFERED"
    assert c.put(f"{SA}/plans/{pid}/audience", json={"institute_ids": [iid], "reason": "t"},
                 headers=staff()).status_code == 200
    assert _checkout(env, iid, vid).status_code == 200
    # per-institute switch off wins; segment exclusion wins
    iid2 = _inst(env)
    env.state["mode"] = "SEGMENTS"
    assert c.put(f"{SA}/storefront/segments/coaching", json={"institute_ids": [iid2], "reason": "t"},
                 headers=staff()).status_code == 200
    assert c.put(f"{SA}/storefront/audience", json={"segments": ["coaching"], "reason": "t"},
                 headers=staff()).status_code == 200
    assert c.patch(f"{SA}/plans/{pid}/listing", json={"audience_mode": "SEGMENT", "reason": "t"},
                   headers=staff()).status_code == 200
    assert c.put(f"{SA}/plans/{pid}/audience", json={"segments": ["coaching"], "reason": "t"},
                 headers=staff()).status_code == 200
    cat = c.get(f"{IN}/storefront/catalog?institute_id={iid2}", headers=H).json()
    assert cat["storefront"]["allowed"] is True and cat["storefront"]["reason"] == "SEGMENT"
    assert [p["plan_id"] for p in cat["plans"]] == [pid]
    assert c.put(f"{SA}/storefront/institutes/{iid2}", json={"storefront_enabled": False, "reason": "t"},
                 headers=staff()).status_code == 200
    assert c.get(f"{IN}/storefront/catalog?institute_id={iid2}", headers=H).json()["storefront"]["reason"] == \
        "INSTITUTE_OFF"
    assert c.put(f"{SA}/storefront/institutes/{iid2}", json={"storefront_enabled": None, "reason": "t"},
                 headers=staff()).status_code == 200
    assert c.put(f"{SA}/storefront/audience", json={"segments": ["coaching"], "exclude_institute_ids": [iid2],
                                                     "reason": "t"}, headers=staff()).status_code == 200
    assert c.get(f"{IN}/storefront/catalog?institute_id={iid2}", headers=H).json()["storefront"]["reason"] == \
        "EXCLUDED"
    # a sub-org never buys (the parent does)
    child = _inst(env)
    _q(env, "INSERT INTO institute_suborg (id, institute_id, suborg_id, status) VALUES (:id, :p, :c, 'ACTIVE')",
       id=str(uuid.uuid4()), p=iid, c=child)
    env.state["mode"] = "ALL"
    assert c.get(f"{IN}/storefront/catalog?institute_id={child}", headers=H).json()["storefront"]["reason"] == "SUBORG"
    r = _checkout(env, child, vid)
    assert r.status_code == 404 and r.json()["detail"]["reason"] == "SUBORG"
    # already on a (sales-led) plan: change it instead
    iid3 = _inst(env)
    _, vid3 = _published(env, name="Open to all")
    assert base._assign(env, iid3, vid3, enforcement="LIVE").status_code == 200  # noqa: SLF001
    r = _checkout(env, iid3, vid3)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ALREADY_SUBSCRIBED"


# ── paying ──────────────────────────────────────────────────────────────────

def test_paid_activates_once_amount_checked_duplicates_flagged(env):
    iid = _inst(env)
    _, vid = _published(env)
    cid = _checkout(env, iid, vid).json()["charge_id"]
    r = _pay(env, cid, 590000, "pay_A")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "TOTAL_NOT_SET"
    bad = env.client.patch(f"{IN}/charges/{cid}", headers=H, json={"tax_minor": 1, "total_minor": 5})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "TOTAL_MISMATCH"
    ch = _price(env, cid, 500000, pos="27", payment_link_id="plink_1", payment_link_url="https://rzp.io/x",
                status="LINK_SENT", platform_payment_id="pp-1")
    assert (ch["status"], ch["total_minor"], ch["tax_head"]) == ("LINK_SENT", 590000, "IGST")
    # the amount of a charge with a live link changes only with a new link
    r = env.client.patch(f"{IN}/charges/{cid}", headers=H, json={"tax_minor": 45000, "total_minor": 545000})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "AMOUNT_LOCKED"
    r = _pay(env, cid, 589999, "pay_A")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "AMOUNT_MISMATCH"
    assert _sub(env, ch["subscription_id"])["status"] == "PENDING"
    assert _q(env, "SELECT count(*) AS n FROM ai_subscription_event WHERE event_type = 'PAYMENT_AMOUNT_MISMATCH'")[0]["n"] == 1
    t0 = datetime.now(UTC)
    r = _pay(env, cid, 590000, "pay_A")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["action"] == "ACTIVATED" and j["invoice"]["sac_code"] and j["invoice"]["total_minor"] == 590000
    sub = _sub(env, j["subscription_id"])
    assert sub["status"] == "ACTIVE" and abs((sub["anchor_at"] - t0).total_seconds()) < 60
    periods = _periods(env, sub["id"])
    assert [(p["payment_status"], p["price_minor_snapshot"]) for p in periods] == [("PAID", 500000)]
    assert periods[0]["period_start"] == sub["anchor_at"]
    row = _charges(env, sub["id"])[0]
    assert (row["status"], row["vendor_payment_id"], row["paid_minor"], str(row["period_id"])) == \
        ("PAID", "pay_A", 590000, str(periods[0]["id"]))
    assert (iid, True, True) in env.fake.calls
    # idempotent replay, then a second payment for the same charge
    r = _pay(env, cid, 590000, "pay_A")
    assert r.json()["action"] == "ALREADY_PROCESSED"
    r = _pay(env, cid, 590000, "pay_B")
    assert r.status_code == 200 and r.json()["action"] == "DUPLICATE" and r.json()["refund_minor"] == 590000
    assert len(_periods(env, sub["id"])) == 1
    # the same Razorpay payment can never pay a second charge
    iid2 = _inst(env)
    cid2 = _checkout(env, iid2, vid).json()["charge_id"]
    _price(env, cid2)
    r = _pay(env, cid2, 590000, "pay_A")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "VENDOR_PAYMENT_REUSED"


def test_concurrent_paid_calls_activate_once(env):
    iid = _inst(env)
    _, vid = _published(env)
    cid = _checkout(env, iid, vid).json()["charge_id"]
    _price(env, cid)
    results, errors = [], []

    def worker(vendor):
        try:
            results.append(_pay(env, cid, 590000, vendor).json()["action"])
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=("pay_SAME",)) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors and sorted(results) == ["ACTIVATED"] + ["ALREADY_PROCESSED"] * 7, results
    results.clear()
    threads = [threading.Thread(target=worker, args=(f"pay_OTHER{i}",)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == ["DUPLICATE"] * 4
    sid = _q(env, "SELECT subscription_id::text AS s FROM ai_subscription_charge WHERE id = CAST(:c AS UUID)",
             c=cid)[0]["s"]
    assert len(_periods(env, sid)) == 1


def test_refunds_need_the_charge_payment_and_cancel_the_current_period(env):
    iid = _inst(env)
    _, vid = _published(env)
    j = _active(env, iid, vid)
    cid, sid, vendor = j["charge"]["id"], j["subscription_id"], j["charge"]["vendor_payment_id"]
    c = env.client
    r = c.post(f"{IN}/charges/{cid}/refunded", headers=H, json={"vendor_payment_id": "pay_WRONG", "amount_minor": 100})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "VENDOR_PAYMENT_MISMATCH"
    r = c.post(f"{IN}/charges/{cid}/refunded", headers=H, json={"vendor_payment_id": vendor, "amount_minor": 999999})
    assert r.status_code == 422
    r = c.post(f"{IN}/charges/{cid}/refunded", headers=H,
               json={"vendor_payment_id": vendor, "amount_minor": 90000, "refund_id": "rfnd_1"})
    assert r.json()["action"] == "PARTIALLY_REFUNDED"
    assert _sub(env, sid)["status"] == "ACTIVE"
    r = c.post(f"{IN}/charges/{cid}/refunded", headers=H,
               json={"vendor_payment_id": vendor, "amount_minor": 90000, "total_refunded_minor": 90000})
    assert r.json()["action"] == "ALREADY_PROCESSED"
    r = c.post(f"{IN}/charges/{cid}/refunded", headers=H,
               json={"vendor_payment_id": vendor, "amount_minor": 500000, "total_refunded_minor": 590000})
    assert r.status_code == 200 and r.json()["action"] == "REFUNDED"
    sub = _sub(env, sid)
    assert sub["status"] == "CANCELLED" and sub["end_at"] is not None and sub["auto_renew"] is False
    assert [p["payment_status"] for p in _periods(env, sid)] == ["REFUNDED"]
    ch = _charges(env, sid)[0]
    assert (ch["status"], ch["refunded_minor"]) == ("REFUNDED", 590000)
    assert (iid, False, None) in env.fake.calls
    r = c.post(f"{IN}/charges/{cid}/refunded", headers=H, json={"vendor_payment_id": vendor, "amount_minor": 1})
    assert r.json()["action"] == "ALREADY_PROCESSED"
    # an unpaid charge has nothing to refund
    cid2 = _checkout(env, _inst(env), vid).json()["charge_id"]
    r = c.post(f"{IN}/charges/{cid2}/refunded", headers=H, json={"vendor_payment_id": "x", "amount_minor": 1})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "CHARGE_NOT_PAID"


# ── the roll ────────────────────────────────────────────────────────────────

def test_roll_renewal_charge_grace_pay_and_expiry(env):
    iid = _inst(env)
    _, vid = _published(env)
    j = _active(env, iid, vid)
    sid = j["subscription_id"]
    p1 = _periods(env, sid)[0]
    p_end = p1["period_end"]
    rep = _roll(env, p_end - timedelta(days=8))
    assert not [c for c in rep["changed"] if c["subscription_id"] == sid]
    rep = _roll(env, p_end - timedelta(days=7) + timedelta(hours=1))
    assert {"subscription_id": sid, "actions": ["CHARGE_CREATED"]} in rep["changed"]
    assert [c["service_start"] for c in rep["charges_created"]] == [p_end.astimezone(UTC).isoformat()]
    _roll(env, p_end - timedelta(days=6))                                  # idempotent
    charges = _charges(env, sid)
    assert [(c["kind"], c["status"]) for c in charges] == [("PERIOD", "PAID"), ("PERIOD", "DUE")]
    renewal = charges[1]
    assert renewal["service_start"] == p_end and renewal["plan_version_id"] == p1["plan_version_id"]
    assert len(_periods(env, sid)) == 1                                    # never pre-created
    # the charge is now what admin_core must collect
    listed = env.client.get(f"{IN}/charges?needs_collection=true&institute_id={iid}", headers=H).json()["charges"]
    assert [c["id"] for c in listed] == [str(renewal["id"])] and listed[0]["is_renewal"] is True
    assert listed[0]["collection_mode"] == "LINK"
    # unpaid at the period end: GRACE (benefits pause in the engine), still one period
    rep = _roll(env, p_end + timedelta(hours=1))
    assert {"subscription_id": sid, "actions": ["GRACE_STARTED"]} in rep["changed"]
    assert _sub(env, sid)["status"] == "GRACE" and len(_periods(env, sid)) == 1
    # admin_core's facade reads `subscription.id` and the top-level `open_charge` of the catalog
    cat = env.client.get(f"{IN}/storefront/catalog?institute_id={iid}", headers=H).json()
    assert cat["subscription"]["id"] == sid and cat["subscription"]["status"] == "GRACE"
    oc = cat["open_charge"]
    assert (oc["id"], oc["subscription_status"], oc["institute_id"], oc["grace_days"]) == (
        str(renewal["id"]), "GRACE", iid, 7)
    _roll(env, p_end + timedelta(hours=2))
    assert _q(env, "SELECT count(*) AS n FROM ai_subscription_event WHERE subscription_id = CAST(:s AS UUID) "
                   "AND event_type = 'GRACE_STARTED'", s=sid)[0]["n"] == 1
    # paid during grace: back to ACTIVE, the period keeps the anchor (late payment never moves the date)
    _price(env, str(renewal["id"]))
    out, live = _call(env, pb.do_paid, str(renewal["id"]),
                      pb.PaidBody(vendor_payment_id="pay_R1", amount_minor=590000, platform_payment_id="pp-2"),
                      p_end + timedelta(days=2))
    assert out["action"] == "GRACE_CLEARED" and live is None
    periods = _periods(env, sid)
    assert [(p["period_start"], p["payment_status"]) for p in periods] == [(p1["period_start"], "PAID"),
                                                                          (p_end, "PAID")]
    assert _sub(env, sid)["status"] == "ACTIVE"
    # next cycle never paid: GRACE then EXPIRED after grace_days, its charge voided
    p2_end = periods[1]["period_end"]
    _roll(env, p2_end + timedelta(hours=1))
    assert _sub(env, sid)["status"] == "GRACE"
    rep = _roll(env, p2_end + timedelta(days=6, hours=23))
    assert _sub(env, sid)["status"] == "GRACE"
    rep = _roll(env, p2_end + timedelta(days=7, minutes=1))
    sub = _sub(env, sid)
    assert (sub["status"], sub["end_at"]) == ("EXPIRED", p2_end)
    last = _charges(env, sid)[-1]
    assert (last["status"], last["void_reason"]) == ("VOID", "UNPAID_EXPIRED")
    assert [v["charge_id"] for v in rep["charges_voided"]] == [str(last["id"])]
    assert len(_periods(env, sid)) == 2
    # a payment for the voided renewal is refunded
    _q(env, "UPDATE ai_subscription_charge SET total_minor = 590000, tax_minor = 90000 WHERE id = CAST(:c AS UUID)",
       c=str(last["id"]))
    r = _pay(env, str(last["id"]), 590000, "pay_LATE")
    assert r.json()["action"] == "REFUND_REQUIRED" and r.json()["code"] == "CHARGE_VOID"


def test_checkout_expiry_and_late_payment(env):
    iid = _inst(env)
    _, vid = _published(env)
    j = _checkout(env, iid, vid).json()
    sid, cid = j["subscription_id"], j["charge_id"]
    created = _sub(env, sid)["created_at"]
    _roll(env, created + timedelta(hours=48, minutes=59))         # 48 h + 1 h slack not over
    assert _sub(env, sid)["status"] == "PENDING"
    rep = _roll(env, created + timedelta(hours=49, minutes=1))
    assert {"subscription_id": sid, "actions": ["CHARGES_VOIDED", "CHECKOUT_EXPIRED"]} in rep["changed"]
    assert _sub(env, sid)["status"] == "EXPIRED"
    assert _charges(env, sid)[0]["void_reason"] == "CHECKOUT_EXPIRED"
    # paid late (card payment captured after the link expired): nothing else open -> activate
    _q(env, "UPDATE ai_subscription_charge SET total_minor = 590000, tax_minor = 90000 WHERE id = CAST(:c AS UUID)",
       c=cid)
    r = _pay(env, cid, 590000, "pay_LATE1")
    assert r.json()["action"] == "ACTIVATED" and r.json()["late"] is True
    assert _sub(env, sid)["status"] == "ACTIVE" and len(_periods(env, sid)) == 1
    # the same, but the institute got another plan meanwhile: refund
    iid2 = _inst(env)
    j2 = _checkout(env, iid2, vid).json()
    _roll(env, _sub(env, j2["subscription_id"])["created_at"] + timedelta(hours=50))
    assert base._assign(env, iid2, vid, enforcement="LIVE").status_code == 200  # noqa: SLF001
    _q(env, "UPDATE ai_subscription_charge SET total_minor = 590000, tax_minor = 90000 WHERE id = CAST(:c AS UUID)",
       c=j2["charge_id"])
    r = _pay(env, j2["charge_id"], 590000, "pay_LATE2")
    assert r.json()["action"] == "REFUND_REQUIRED"
    # admin_core voids a checkout whose link lapsed (reason CHECKOUT_EXPIRED): expired, not
    # cancelled, so a payment captured at the last moment still activates it
    iid3 = _inst(env)
    j3 = _checkout(env, iid3, vid).json()
    r = env.client.post(f"{IN}/charges/{j3['charge_id']}/void", headers=H,
                        json={"reason": "CHECKOUT_EXPIRED", "actor": "system:ai-plans-billing"})
    assert r.status_code == 200 and _sub(env, j3["subscription_id"])["status"] == "EXPIRED"
    _q(env, "UPDATE ai_subscription_charge SET total_minor = 590000, tax_minor = 90000 WHERE id = CAST(:c AS UUID)",
       c=j3["charge_id"])
    r = _pay(env, j3["charge_id"], 590000, "pay_LATE3")
    assert r.json()["action"] == "ACTIVATED" and r.json()["late"] is True


def test_manual_subscriptions_roll_exactly_as_before_next_to_paid_ones(env):
    iid_m, iid_p = _inst(env), _inst(env)
    _, vid = _published(env)
    now = datetime.now(UTC)
    r = base._assign(env, iid_m, vid, start_at=now - timedelta(days=40))  # noqa: SLF001
    assert r.status_code == 200
    msid = r.json()["id"]
    j = _active(env, iid_p, vid)
    # the assignment opened the manual plan's current period [now-10d, now+21d); 22 days on, it renews.
    # The paid plan's period ends ~a month from now: 22 days on is before its T-7 renewal charge.
    rep = _roll(env, now + timedelta(days=22))
    manual = [c for c in rep["changed"] if c["subscription_id"] == msid]
    assert manual == [{"subscription_id": msid, "actions": ["RENEWED"]}]
    assert [p["payment_status"] for p in _periods(env, msid)] == ["DUE", "DUE"]
    assert not [c for c in rep["changed"] if c["subscription_id"] == j["subscription_id"]]
    assert len(_periods(env, j["subscription_id"])) == 1            # never pre-created for the paid plan
    assert rep["charges_created"] == [] and rep["errors"] == []
    assert _q(env, "SELECT count(*) AS n FROM ai_subscription_charge WHERE institute_id = :i", i=iid_m)[0]["n"] == 0


# ── plan changes ────────────────────────────────────────────────────────────

def test_upgrade_prorated_paid_switches_now_reprices_renewal_and_refund_reverts(env):
    iid = _inst(env)
    pro_pid, pro = _published(env, price=500000, allowance=2000, name="AI Pro")
    max_pid, mx = _published(env, price=800000, allowance=3000, name="AI Max")
    j = _active(env, iid, pro)
    sid = j["subscription_id"]
    p1 = _periods(env, sid)[0]
    cat = env.client.get(f"{IN}/storefront/catalog?institute_id={iid}", headers=H).json()
    _no_usd(cat)
    actions = {p["plan_id"]: p["action"] for p in cat["plans"]}
    assert actions == {pro_pid: "CURRENT", max_pid: "UPGRADE"}
    card = [p for p in cat["plans"] if p["plan_id"] == max_pid][0]
    assert card["upgrade_quote"]["proration"]["period_days"] == card["upgrade_quote"]["period_days"]
    assert card["upgrade_quote"]["service_end"] == p1["period_end"].astimezone(UTC).isoformat()
    assert cat["current"]["status"] == "ACTIVE" and cat["current"]["renews_at"] == p1["period_end"].astimezone(UTC).isoformat()
    # a renewal charge exists (T-6 days) before the upgrade: it gets re-priced
    t_up = p1["period_end"] - timedelta(days=6)
    _roll(env, t_up)
    renewal = _charges(env, sid)[-1]
    assert renewal["base_minor"] == 500000
    exp = pb.prorate(500000, 800000, 2000, 3000, p1["period_start"], p1["period_end"], t_up)
    out = _call(env, pb.do_change, sid, pb.ChangeBody(action="UPGRADE", plan_version_id=mx, actor="admin-1"), t_up)
    assert out["charge"]["base_minor"] == exp["base_minor"] > 0 and out["charge"]["kind"] == "UPGRADE"
    assert out["description"].startswith("Upgrade AI Pro to AI Max")
    # a second quote supersedes the first (one open upgrade at a time)
    out2 = _call(env, pb.do_change, sid, pb.ChangeBody(action="UPGRADE", plan_version_id=mx), t_up)
    assert [v["charge_id"] for v in out2["voided_charges"]] == [out["charge"]["id"]]
    up_id = out2["charge"]["id"]
    _price(env, up_id, exp["base_minor"])
    total = exp["base_minor"] + round(exp["base_minor"] * 18 / 100)
    res, _ = _call(env, pb.do_paid, up_id, pb.PaidBody(vendor_payment_id="pay_UP", amount_minor=total), t_up)
    assert res["action"] == "UPGRADED"
    period = _periods(env, sid)[0]
    assert str(period["plan_version_id"]) == mx and str(_sub(env, sid)["plan_version_id"]) == mx
    assert float(period["allowance_credits"]) == 2000 + exp["allowance_delta"]
    assert period["price_minor_snapshot"] == 500000 + exp["base_minor"]
    charges = {str(c["id"]): c for c in _charges(env, sid)}
    assert charges[str(renewal["id"])]["status"] == "VOID" and charges[str(renewal["id"])]["void_reason"] == "REPRICED"
    assert [c["base_minor"] for c in res["repriced_charges"]] == [800000]
    # refund of the upgrade in full: back to Pro for the rest of the period
    r = env.client.post(f"{IN}/charges/{up_id}/refunded", headers=H,
                        json={"vendor_payment_id": "pay_UP", "amount_minor": total})
    assert r.json()["action"] == "REFUNDED"
    period = _periods(env, sid)[0]
    assert str(period["plan_version_id"]) == pro and float(period["allowance_credits"]) == 2000
    assert str(_sub(env, sid)["plan_version_id"]) == pro


def test_free_upgrade_applies_at_once_and_gates(env):
    iid = _inst(env)
    _, pro = _published(env, price=500000)
    _, tiny = _published(env, price=500050)
    _, annual = _published(env, price=5000000, period_months=12)
    j = _active(env, iid, pro)
    sid = j["subscription_id"]
    out = _call(env, pb.do_change, sid, pb.ChangeBody(action="UPGRADE", plan_version_id=tiny))
    assert out["applied"] is True and out["free"] is True and out["charge"] is None
    assert str(_sub(env, sid)["plan_version_id"]) == tiny
    r = env.client.post(f"{IN}/subscriptions/{sid}/change", headers=H, json={"action": "UPGRADE",
                                                                           "plan_version_id": annual})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "DIFFERENT_BILLING_TERMS"
    r = env.client.post(f"{IN}/subscriptions/quote", headers=H,
                        json={"institute_id": iid, "plan_version_id": pro, "action": "UPGRADE"})
    assert r.status_code == 409 and r.json()["detail"]["possible"] == "DOWNGRADE"
    # a sales-led plan is changed by the platform team only
    iid2 = _inst(env)
    s2 = base._assign(env, iid2, pro, enforcement="LIVE").json()["id"]  # noqa: SLF001
    r = env.client.post(f"{IN}/subscriptions/{s2}/change", headers=H, json={"action": "CANCEL"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOT_A_PAID_PLAN"


def test_downgrade_cancel_resume_and_plan_switch_at_renewal(env):
    iid = _inst(env)
    _, pro = _published(env, price=500000)
    _, mx = _published(env, price=800000)
    j = _active(env, iid, mx, base_minor=800000)
    sid = j["subscription_id"]
    p_end = _periods(env, sid)[0]["period_end"]
    c = env.client
    r = c.post(f"{IN}/subscriptions/{sid}/change", headers=H, json={"action": "DOWNGRADE", "plan_version_id": pro})
    assert r.status_code == 200 and r.json()["effective_at"] == p_end.astimezone(UTC).isoformat()
    assert str(_sub(env, sid)["pending_plan_version_id"]) == pro
    _roll(env, p_end - timedelta(days=6))
    renewal = _charges(env, sid)[-1]
    assert (renewal["base_minor"], str(renewal["plan_version_id"])) == (500000, pro)
    r = c.post(f"{IN}/subscriptions/{sid}/change", headers=H, json={"action": "CANCEL"})
    assert r.status_code == 200 and [v["charge_id"] for v in r.json()["voided_charges"]] == [str(renewal["id"])]
    assert _sub(env, sid)["cancel_at_period_end"] is True
    r = c.post(f"{IN}/subscriptions/{sid}/change", headers=H, json={"action": "RESUME"})
    assert r.status_code == 200 and _sub(env, sid)["cancel_at_period_end"] is False
    _roll(env, p_end - timedelta(days=5))
    renewal = _charges(env, sid)[-1]
    assert renewal["status"] == "DUE" and renewal["base_minor"] == 500000
    _price(env, str(renewal["id"]))
    out, _ = _call(env, pb.do_paid, str(renewal["id"]), pb.PaidBody(vendor_payment_id="pay_R", amount_minor=590000),
                   p_end - timedelta(days=4))
    assert out["action"] == "RENEWAL_PAID"
    assert str(_sub(env, sid)["plan_version_id"]) == mx                    # switches when the period starts
    r = c.post(f"{IN}/subscriptions/{sid}/change", headers=H, json={"action": "DOWNGRADE", "plan_version_id": pro})
    assert r.status_code == 409          # paid ahead: the next period cannot change now
    rep = _roll(env, p_end + timedelta(hours=1))
    assert {"subscription_id": sid, "actions": ["PLAN_CHANGED"]} in rep["changed"]
    sub = _sub(env, sid)
    assert str(sub["plan_version_id"]) == pro and sub["pending_plan_version_id"] is None
    # cancel at period end then the roll cancels it at the end
    c.post(f"{IN}/subscriptions/{sid}/change", headers=H, json={"action": "CANCEL"})
    p2_end = _periods(env, sid)[-1]["period_end"]
    _roll(env, p2_end + timedelta(minutes=1))
    sub = _sub(env, sid)
    assert (sub["status"], sub["end_at"]) == ("CANCELLED", p2_end)


def test_cancel_pending_void_and_waive(env):
    c = env.client
    _, vid = _published(env)
    iid = _inst(env)
    j = _checkout(env, iid, vid).json()
    r = c.post(f"{IN}/subscriptions/{j['subscription_id']}/change", headers=H, json={"action": "CANCEL"})
    assert r.status_code == 200 and _sub(env, j["subscription_id"])["status"] == "CANCELLED"
    j = _checkout(env, iid, vid).json()
    r = c.post(f"{IN}/charges/{j['charge_id']}/void", headers=H, json={"reason": "sales asked"})
    assert r.json()["action"] == "VOIDED" and _sub(env, j["subscription_id"])["status"] == "CANCELLED"
    assert c.post(f"{IN}/charges/{j['charge_id']}/void", headers=H, json={"reason": "again"}).json()["action"] == \
        "ALREADY_PROCESSED"
    # waive: the period opens WAIVED, no money, no invoice data needed
    j = _checkout(env, iid, vid).json()
    r = c.post(f"{IN}/charges/{j['charge_id']}/waive", headers=H, json={"reason": "goodwill", "actor": "staff-1"})
    assert r.status_code == 200 and r.json()["action"] == "WAIVED", r.text
    assert [p["payment_status"] for p in _periods(env, j["subscription_id"])] == ["WAIVED"]
    assert _sub(env, j["subscription_id"])["status"] == "ACTIVE"
    ch = _charges(env, j["subscription_id"])[0]
    assert (ch["status"], ch["void_reason"], ch["vendor_payment_id"]) == ("VOID", "WAIVED", None)
    # admin_core's ops waiver: PATCH {status: WAIVED, void_reason, actor} = the same waiver (renewal here)
    sid = j["subscription_id"]
    p_end = _periods(env, sid)[0]["period_end"]
    _roll(env, p_end - timedelta(days=6))
    renewal = _charges(env, sid)[-1]
    assert renewal["status"] == "DUE"
    assert c.patch(f"{IN}/charges/{renewal['id']}", headers=H, json={"status": "WAIVED"}).status_code == 422
    r = c.patch(f"{IN}/charges/{renewal['id']}", headers=H,
                json={"status": "WAIVED", "void_reason": "partner deal", "actor": "staff-2"})
    assert r.status_code == 200 and r.json()["action"] == "WAIVED", r.text
    assert [p["payment_status"] for p in _periods(env, sid)] == ["WAIVED", "WAIVED"]


# ── collection helpers ──────────────────────────────────────────────────────

def test_patch_debit_rules_and_autopay_collection_mode(env):
    iid = _inst(env)
    _, vid = _published(env)
    j = _active(env, iid, vid)
    sid = j["subscription_id"]
    p_end = _periods(env, sid)[0]["period_end"]
    _roll(env, p_end - timedelta(days=6))
    renewal = _charges(env, sid)[-1]
    cid = str(renewal["id"])
    _price(env, cid)
    mid = str(uuid.uuid4())
    _q(env, "INSERT INTO ai_subscription_mandate (id, institute_id, subscription_id, token_id, method, "
            "max_amount_minor, status) VALUES (CAST(:m AS UUID), :i, CAST(:s AS UUID), 'token_1', 'CARD', 1500000, "
            "'ACTIVE')", m=mid, i=iid, s=sid)
    env.state["autopay"] = True
    listed = env.client.get(f"{IN}/charges?needs_collection=true&institute_id={iid}", headers=H).json()
    assert listed["charges"][0]["collection_mode"] == "MANDATE" and listed["charges"][0]["mandate"]["id"] == mid
    now = datetime.now(UTC)
    r = env.client.patch(f"{IN}/charges/{cid}", headers=H, json={
        "status": "DEBIT_SCHEDULED", "mandate_id": mid, "pre_debit_notice_sent_at": now.isoformat(),
        "next_attempt_at": (now + timedelta(hours=23)).isoformat()})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "PRE_DEBIT_NOTICE"
    r = env.client.patch(f"{IN}/charges/{cid}", headers=H, json={
        "status": "DEBIT_SCHEDULED", "mandate_id": mid, "pre_debit_notice_sent_at": now.isoformat(),
        "next_attempt_at": (now + timedelta(hours=24)).isoformat()})
    assert r.status_code == 200 and r.json()["status"] == "DEBIT_SCHEDULED" and r.json()["mandate_id"] == mid
    # a scheduled debit is still listed for collection (admin_core raises it at next_attempt_at)
    listed = env.client.get(f"{IN}/charges?status=DUE&needs_collection=true&institute_id={iid}",
                            headers=H).json()["charges"]
    assert [(c["id"], c["status"]) for c in listed] == [(cid, "DEBIT_SCHEDULED")]
    # UPI Autopay: Razorpay notifies the customer when the debit is raised and charges ~25 h later,
    # so admin_core may raise it any time after its own notice (never before it)
    _q(env, "UPDATE ai_subscription_mandate SET method = 'UPI' WHERE id = CAST(:m AS UUID)", m=mid)
    r = env.client.patch(f"{IN}/charges/{cid}", headers=H, json={
        "pre_debit_notice_sent_at": now.isoformat(), "next_attempt_at": (now - timedelta(hours=1)).isoformat()})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "PRE_DEBIT_NOTICE"
    r = env.client.patch(f"{IN}/charges/{cid}", headers=H, json={
        "pre_debit_notice_sent_at": now.isoformat(), "next_attempt_at": (now + timedelta(hours=2)).isoformat()})
    assert r.status_code == 200, r.text
    # the charge by id (admin_core: GET /charges?charge_id=)
    one = env.client.get(f"{IN}/charges?charge_id={cid}", headers=H).json()["charges"]
    assert [c["id"] for c in one] == [cid]
    r = env.client.patch(f"{IN}/charges/{cid}", headers=H, json={"status": "FAILED", "debit_attempts": 1,
                                                                 "last_error": "insufficient funds"})
    assert r.status_code == 200 and r.json()["status"] == "FAILED"
    listed = env.client.get(f"{IN}/charges?needs_collection=true&institute_id={iid}", headers=H).json()["charges"]
    assert [c["id"] for c in listed] == [cid]
    assert listed[0]["collection_mode"] == "LINK"          # a failed debit falls back to a payment link (D5)
    # above the mandate / Rs 15,000 AFA ceiling: never a debit
    _q(env, "UPDATE ai_subscription_mandate SET max_amount_minor = 100000 WHERE id = CAST(:m AS UUID)", m=mid)
    r = env.client.patch(f"{IN}/charges/{cid}", headers=H, json={
        "status": "DEBIT_SCHEDULED", "pre_debit_notice_sent_at": now.isoformat(),
        "next_attempt_at": (now + timedelta(hours=25)).isoformat()})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "ABOVE_MANDATE_LIMIT"
    for bad in ({"status": "PAID"}, {"status": "VOID"}, {"place_of_supply": "MH"}):
        assert env.client.patch(f"{IN}/charges/{cid}", headers=H, json=bad).status_code == 422


# ── super admin + tenant ────────────────────────────────────────────────────

def test_super_admin_paid_assignment_timeline_send_link_and_listing_lint(env):
    c = env.client
    pid, vid = _published(env)
    iid = _inst(env)
    env.state["payments"] = False
    r = base._assign(env, iid, vid, source="PAYMENT")  # noqa: SLF001
    assert r.status_code == 409
    env.state["payments"] = True
    r = base._assign(env, iid, vid, source="PAYMENT", start_at=datetime.now(UTC) + timedelta(days=1))  # noqa: SLF001
    assert r.status_code == 422
    r = base._assign(env, iid, vid, source="PAYMENT", price_override_minor=400000)  # noqa: SLF001
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j["status"], j["source"], j["enforcement"], j["charge"]["base_minor"]) == ("PENDING", "PAYMENT", "LIVE",
                                                                                       400000)
    assert j["charge"]["next_attempt_at"] is not None                  # queued for admin_core's billing job
    sid = j["id"]
    r = c.get(f"{SA}/subscriptions/{sid}/billing", headers=staff())
    assert r.status_code == 200 and [x["status"] for x in r.json()["charges"]] == ["DUE"]
    assert "CHECKOUT_CREATED" in [e["event_type"] for e in r.json()["events"]]
    cid = j["charge"]["id"]
    _price(env, cid, 400000, status="LINK_SENT", payment_link_url="https://rzp.io/l/x", payment_link_id="plink_x")
    r = c.post(f"{SA}/subscriptions/{sid}/charges/{cid}/send-link", json={"reason": "lost the email"},
               headers=staff())
    assert r.status_code == 200 and r.json()["charge"]["status"] == "DUE"
    # a paid plan is always LIVE and priced by its charges
    r = c.patch(f"{SA}/subscriptions/{sid}", json={"enforcement": "SHADOW", "reason": "t"}, headers=staff())
    assert r.status_code == 409
    # staff cancel of the pending checkout voids its charge
    r = c.post(f"{SA}/subscriptions/{sid}/cancel", json={"reason": "deal lost"}, headers=staff())
    assert r.status_code == 200 and r.json()["immediate"] is True and r.json()["voided_charges"][0]["charge_id"] == cid
    # listing copy is white-label
    r = c.patch(f"{SA}/plans/{pid}/listing", json={"tagline": "Vacademy AI for all", "reason": "t"}, headers=staff())
    assert r.status_code == 422
    r = c.patch(f"{SA}/plans/{pid}/listing", json={"highlights": ["ok", "by Vidyayatan"], "reason": "t"},
                headers=staff())
    assert r.status_code == 422
    r = c.patch(f"{SA}/plans/{pid}/listing", json={"highlights": ["Unlimited tutor chat"], "badge": "Popular",
                                                   "sort_order": 5, "reason": "t"}, headers=staff())
    assert r.status_code == 200 and r.json()["listing"]["highlights"] == ["Unlimited tutor chat"]
    r = c.patch("/super-admin/v1/plans/features/admin_assistant", json={"tenant_label": "Vacademy helper",
                                                                        "reason": "t"}, headers=staff())
    assert r.status_code == 422
    r = c.patch("/super-admin/v1/plans/features/tutor_chat", json={"tenant_label": "Tutor chat", "reason": "t"},
                headers=staff())
    assert r.status_code == 200 and r.json()["tenant_label"] == "Tutor chat"
    prev = c.get(f"{SA}/storefront/preview?institute_id={iid}", headers=staff()).json()
    card = [p for p in prev["plans"] if p["plan_id"] == pid][0]
    assert card["badge"] == "Popular" and "Tutor chat" in [f["label"] for f in card["features"]]
    _no_usd(prev)


def test_tenant_view_billing_block_and_switch_off_protection(env):
    iid = _inst(env)
    _, vid = _published(env)
    j = _active(env, iid, vid)
    url = f"/credits/v2/institutes/{iid}/plan"
    r = env.client.get(url, headers=base._hdr(iid))  # noqa: SLF001
    body = r.json()
    assert body["plan"]["payment_status"] == "PAID" and body["plan"]["benefits_paused"] is False
    assert body["billing"]["source"] == "PAYMENT" and body["billing"]["renews_at"]
    member = env.client.get(url, headers=base._hdr(iid, ("TEACHER",), base.MEMBER)).json()  # noqa: SLF001
    assert "billing" not in member
    _no_usd(body)
    env.state["enabled"] = False                       # the global switch off: a paid LIVE plan stays visible
    r = env.client.get(url, headers=base._hdr(iid))  # noqa: SLF001
    assert r.json()["plan"] is not None
    iid2 = _inst(env)
    base._assign(env, iid2, vid, enforcement="LIVE")  # noqa: SLF001
    assert env.client.get(f"/credits/v2/institutes/{iid2}/plan", headers=base._hdr(iid2)).json()["plan"] is None  # noqa: SLF001
    assert j["subscription_id"]


# ── review fixes (2026-10-16): offer check on changes, in-flight debits, SAC default ──

def _new_version(env, pid, **terms):
    r = env.client.post(f"{SA}/plans/{pid}/versions", json={"copy_latest": True, "reason": "t"}, headers=staff())
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    if terms:
        r = env.client.patch(f"{SA}/versions/{vid}", json={**terms, "reason": "t"}, headers=staff())
        assert r.status_code == 200, r.text
    return vid


def test_self_serve_change_only_to_the_version_on_offer(env):
    iid = _inst(env)
    pro_pid, pro1 = _published(env, price=500000, name="AI Pro")
    pro2 = _new_version(env, pro_pid, price_minor=700000)
    r = env.client.post(f"{SA}/versions/{pro2}/publish", json={"reason": "t"}, headers=staff())
    assert r.status_code == 200, r.text
    # publishing v2 does not retire v1: it stays PUBLISHED at the old, lower price
    assert _q(env, "SELECT status FROM ai_plan_version WHERE id = CAST(:v AS UUID)", v=pro1)[0]["status"] == "PUBLISHED"
    sid = _active(env, iid, pro2, base_minor=700000)["subscription_id"]
    c = env.client

    def refused(body, quote_action=None):
        r = c.post(f"{IN}/subscriptions/{sid}/change", headers=H, json=body)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "NOT_OFFERED", r.text
        if quote_action:
            q = c.post(f"{IN}/subscriptions/quote", headers=H, json={"institute_id": iid, "action": quote_action,
                                                                    "plan_version_id": body["plan_version_id"]})
            assert q.status_code == 403 and q.json()["detail"]["code"] == "NOT_OFFERED", q.text

    # the older, cheaper, still-PUBLISHED version of the same plan: never offered
    refused({"action": "DOWNGRADE", "plan_version_id": pro1}, "DOWNGRADE")
    # an unlisted plan, and a plan for another audience
    _, hidden = _published(env, price=300000, listed=False)
    refused({"action": "DOWNGRADE", "plan_version_id": hidden}, "DOWNGRADE")
    _, private = _published(env, price=900000, audience="ALLOWLIST")
    refused({"action": "UPGRADE", "plan_version_id": private}, "UPGRADE")
    sub = _sub(env, sid)
    assert sub["pending_plan_version_id"] is None and str(sub["plan_version_id"]) == pro2
    assert [ch["kind"] for ch in _charges(env, sid)] == ["PERIOD"]
    # the listed version of a listed plan is fine; a staff (sales-led) change may pick any version
    _, lite = _published(env, price=300000)
    r = c.post(f"{IN}/subscriptions/{sid}/change", headers=H, json={"action": "DOWNGRADE", "plan_version_id": lite})
    assert r.status_code == 200, r.text
    out = _call(env, pb.do_change, sid, pb.ChangeBody(action="DOWNGRADE", plan_version_id=pro1, self_serve=False))
    assert out["applied"] is True and str(_sub(env, sid)["pending_plan_version_id"]) == pro1


def test_no_change_voids_or_reprices_a_renewal_whose_debit_is_raised(env):
    iid = _inst(env)
    _, pro = _published(env, price=500000, name="AI Pro")
    _, mx = _published(env, price=800000, name="AI Max")
    _, lite = _published(env, price=300000, name="AI Lite")
    sid = _active(env, iid, pro)["subscription_id"]
    p_end = _periods(env, sid)[0]["period_end"]
    _roll(env, p_end - timedelta(days=6))
    renewal = _charges(env, sid)[-1]
    cid = str(renewal["id"])
    _price(env, cid)
    mid = str(uuid.uuid4())
    _q(env, "INSERT INTO ai_subscription_mandate (id, institute_id, subscription_id, token_id, method, "
            "max_amount_minor, status) VALUES (CAST(:m AS UUID), :i, CAST(:s AS UUID), 'token_inflight', 'UPI', "
            "1500000, 'ACTIVE')", m=mid, i=iid, s=sid)
    env.state["autopay"] = True
    now = datetime.now(UTC)
    c = env.client
    # an upgrade quoted BEFORE the debit is raised (allowed: nothing is at Razorpay yet)
    up = _call(env, pb.do_change, sid, pb.ChangeBody(action="UPGRADE", plan_version_id=mx), now)
    up_id = up["charge"]["id"]
    _price(env, up_id, up["charge"]["base_minor"])
    up_total = up["charge"]["base_minor"] + round(up["charge"]["base_minor"] * 18 / 100)
    # notice sent and the charge scheduled, debit not raised yet (debit_attempts 0): not in flight
    r = c.patch(f"{IN}/charges/{cid}", headers=H, json={
        "status": "DEBIT_SCHEDULED", "mandate_id": mid, "pre_debit_notice_sent_at": (now - timedelta(hours=30)).isoformat(),
        "next_attempt_at": (now + timedelta(hours=1)).isoformat()})
    assert r.status_code == 200, r.text
    assert pb.debit_in_flight(_charges(env, sid)[1]) is False
    # admin_core claims the charge for the debit BEFORE calling Razorpay
    r = c.patch(f"{IN}/charges/{cid}", headers=H, json={
        "platform_payment_id": "pp-debit-1", "status": "DEBIT_SCHEDULED", "debit_attempts": 1,
        "next_attempt_at": (now + timedelta(hours=37)).isoformat()})
    assert r.status_code == 200, r.text
    assert pb.debit_in_flight([x for x in _charges(env, sid) if str(x["id"]) == cid][0]) is True
    for body in ({"action": "DOWNGRADE", "plan_version_id": lite}, {"action": "UPGRADE", "plan_version_id": mx},
                 {"action": "CANCEL"}):
        r = c.post(f"{IN}/subscriptions/{sid}/change", headers=H, json=body)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "DEBIT_IN_PROGRESS", (body, r.text)
    ch = [x for x in _charges(env, sid) if str(x["id"]) == cid][0]
    assert (ch["status"], ch["plan_version_id"]) == ("DEBIT_SCHEDULED", renewal["plan_version_id"])
    sub = _sub(env, sid)
    assert sub["cancel_at_period_end"] is False and sub["pending_plan_version_id"] is None
    # the upgrade quoted earlier and paid now: refunded, the renewal under debit stays as it is
    res, _ = _call(env, pb.do_paid, up_id, pb.PaidBody(vendor_payment_id="pay_up_late", amount_minor=up_total), now)
    assert (res["action"], res["code"]) == ("REFUND_REQUIRED", "DEBIT_IN_PROGRESS")
    assert str(_sub(env, sid)["plan_version_id"]) == pro
    ch = [x for x in _charges(env, sid) if str(x["id"]) == cid][0]
    assert ch["status"] == "DEBIT_SCHEDULED"
    # the debit failed (admin_core patches FAILED): changes are possible again
    r = c.patch(f"{IN}/charges/{cid}", headers=H, json={"status": "FAILED", "last_error": "insufficient funds"})
    assert r.status_code == 200, r.text
    # an upgrade paid an hour after its quote: the invoice period starts at the payment
    up2 = _call(env, pb.do_change, sid, pb.ChangeBody(action="UPGRADE", plan_version_id=mx), now)
    _price(env, up2["charge"]["id"], up2["charge"]["base_minor"])
    total2 = up2["charge"]["base_minor"] + round(up2["charge"]["base_minor"] * 18 / 100)
    later = now + timedelta(hours=1)
    res, _ = _call(env, pb.do_paid, up2["charge"]["id"], pb.PaidBody(vendor_payment_id="pay_up_2",
                                                                     amount_minor=total2), later)
    assert res["action"] == "UPGRADED", res
    paid = [x for x in _charges(env, sid) if str(x["id"]) == up2["charge"]["id"]][0]
    assert abs((paid["service_start"] - later).total_seconds()) < 1
    assert res["invoice"]["service_start"] == pa.iso(paid["service_start"])
    assert [str(x["charge_id"]) for x in res["voided_charges"]] == [cid]       # the failed renewal is re-priced


def test_new_versions_carry_sac_998315(env):
    pid, vid = _published(env)
    assert _q(env, "SELECT sac_code FROM ai_plan_version WHERE id = CAST(:v AS UUID)", v=vid)[0]["sac_code"] == "998315"
    # copied from a version with another code: the owner default still wins (a DRAFT can be PATCHed)
    d = _new_version(env, pid, sac_code="998313")
    assert _q(env, "SELECT sac_code FROM ai_plan_version WHERE id = CAST(:v AS UUID)", v=d)[0]["sac_code"] == "998313"
    r = env.client.post(f"{SA}/plans/{pid}/versions", json={"copy_from_version_id": d, "reason": "t"}, headers=staff())
    assert r.status_code == 200, r.text
    assert r.json()["sac_code"] == "998315"
    # the column default (V590) for any other writer
    dflt = _q(env, "SELECT column_default FROM information_schema.columns WHERE table_name = 'ai_plan_version' "
                   "AND column_name = 'sac_code'")[0]["column_default"]
    assert dflt.startswith("'998315'"), dflt
    # and a charge carries it to the invoice
    iid = _inst(env)
    j = _checkout(env, iid, vid).json()
    assert j["sac_code"] == "998315"
