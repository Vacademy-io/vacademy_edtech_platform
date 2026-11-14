"""Offline tests for the budget-aware LLM key pool (services/llm_providers/key_pool.py).

Covers selection math (weight x remaining budget, the soft cap, the per-call
estimate), every per-key error rule (401 / 402 / billing_error / 400 usage
limit / 403 / 429 org-wide / 5xx), metering (cache read 0.1x, cache write
1.25x, pending spend counted until the write lands), the encryption secret
(the public JWT fallback never counts), tables-absent safety, and that the
SQLAlchemy models match the admin_core migration. No network, no database.
"""
from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest  # noqa: E402

from ai_service.app.config import _LEGACY_JWT_SECRET_FALLBACK, get_settings  # noqa: E402
from ai_service.app.services.llm_providers import key_pool  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
MIGRATIONS = REPO / "admin_core_service" / "src" / "main" / "resources" / "db" / "migration"


def _key(kid, budget=200.0, pct=95, weight=1, spent=0.0, org=None, **kw):
    return key_pool.PoolKey(id=kid, provider="anthropic", label=kid, org_label=org, key_hint="…" + kid[-4:],
                            api_key=f"sk-ant-{kid}", monthly_budget_usd=budget, soft_limit_pct=pct,
                            weight=weight, metered_usd=spent, **kw)


@pytest.fixture
def pool(monkeypatch):
    """A pool served from memory; background writes are captured, not run."""
    key_pool._reset_for_tests()
    state = {"keys": [], "writes": []}
    monkeypatch.setattr(key_pool, "_load_from_db", lambda provider: list(state["keys"]))
    monkeypatch.setattr(key_pool, "_submit", lambda fn, *args: state["writes"].append((fn.__name__, args)))
    monkeypatch.setattr(key_pool, "_price", lambda model: (3.0, 15.0))
    yield state
    key_pool._reset_for_tests()


def test_no_keys_means_none(pool):
    assert key_pool.select_key("anthropic") is None


def test_inactive_cooling_exhausted_and_capped_keys_are_skipped(pool):
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    pool["keys"] = [
        _key("disabled", status="disabled"),
        _key("authfail", status="auth_failed"),
        _key("cooling", cooldown_until=future),
        _key("exhausted", exhausted_until=future),
        _key("capped", budget=100, pct=95, spent=95.0),       # at the soft cap
        _key("zeroweight", weight=0),
        _key("ok", cooldown_until=past, exhausted_until=past),
    ]
    for _ in range(30):
        assert key_pool.select_key("anthropic").id == "ok"


def test_estimate_pushes_a_key_over_its_cap(pool):
    pool["keys"] = [_key("near", budget=100, pct=95, spent=94.0)]
    assert key_pool.select_key("anthropic", est_usd=0.5).id == "near"
    assert key_pool.select_key("anthropic", est_usd=1.0) is None


def test_selection_is_weighted_by_remaining_budget(pool, monkeypatch):
    # cap 100 each; a has 90% left, b 10% left, weight 1 -> scores 0.9 / 0.1
    pool["keys"] = [_key("a", budget=100, pct=100, spent=10), _key("b", budget=100, pct=100, spent=90)]
    monkeypatch.setattr(key_pool.random, "uniform", lambda lo, hi: hi * 0.85)
    assert key_pool.select_key("anthropic").id == "a"
    monkeypatch.setattr(key_pool.random, "uniform", lambda lo, hi: hi * 0.95)
    assert key_pool.select_key("anthropic").id == "b"
    # weight multiplies the score: b at weight 9 -> 0.9 vs 0.9
    pool["keys"] = [_key("a", budget=100, pct=100, spent=10), _key("b", budget=100, pct=100, spent=90, weight=9)]
    key_pool.invalidate()
    monkeypatch.setattr(key_pool.random, "uniform", lambda lo, hi: hi * 0.49)
    assert key_pool.select_key("anthropic").id == "a"
    monkeypatch.setattr(key_pool.random, "uniform", lambda lo, hi: hi * 0.51)
    assert key_pool.select_key("anthropic").id == "b"


def test_exclude_skips_tried_keys(pool):
    pool["keys"] = [_key("a"), _key("b")]
    assert key_pool.select_key("anthropic", exclude=["a"]).id == "b"
    assert key_pool.select_key("anthropic", exclude=["a", "b"]) is None


def test_401_marks_auth_failed_and_moves_on(pool):
    pool["keys"] = [_key("a"), _key("b")]
    out = key_pool.note_failure("a", 401, {}, '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')
    assert out == key_pool.NEXT_KEY
    name, args = pool["writes"][-1]
    assert name == "_write_failure" and args[2] == "auth_failed"
    for _ in range(20):
        assert key_pool.select_key("anthropic").id == "b"


@pytest.mark.parametrize("status,body", [
    (402, '{"error":{"type":"billing_error","message":"pay up"}}'),
    (400, '{"error":{"type":"billing_error","message":"billing"}}'),
    (400, '{"error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-11-01"}}'),
    (400, '{"error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'),
])
def test_limit_errors_exhaust_the_key_until_next_month(pool, status, body):
    pool["keys"] = [_key("a"), _key("b")]
    assert key_pool.note_failure("a", status, {}, body) == key_pool.NEXT_KEY
    name, args = pool["writes"][-1]
    assert name == "_write_failure"
    until = args[4]
    assert until == key_pool.next_month_start() and until.day == 1 and until.tzinfo is not None
    assert key_pool.select_key("anthropic", exclude=[]).id == "b"


def test_plain_400_is_not_the_keys_fault(pool):
    pool["keys"] = [_key("a")]
    out = key_pool.note_failure("a", 400, {}, '{"error":{"type":"invalid_request_error","message":"messages: roles must alternate"}}')
    assert out == key_pool.FAIL_OVER
    assert key_pool.select_key("anthropic").id == "a"


def test_403_cools_the_key_for_ten_minutes(pool):
    pool["keys"] = [_key("a"), _key("b")]
    assert key_pool.note_failure("a", 403, {}, '{"error":{"type":"permission_error","message":"no"}}') == key_pool.NEXT_KEY
    name, args = pool["writes"][-1]
    cooldown = args[3]
    left = (cooldown - datetime.now(timezone.utc)).total_seconds()
    assert 590 < left <= 600
    assert key_pool.select_key("anthropic").id == "b"


def test_429_cools_every_key_of_the_same_org(pool):
    pool["keys"] = [_key("a1", org="org-A"), _key("a2", org="org-A"), _key("b1", org="org-B")]
    out = key_pool.note_failure("a1", 429, {"retry-after": "30"}, '{"error":{"type":"rate_limit_error"}}')
    assert out == key_pool.NEXT_KEY
    for _ in range(20):
        assert key_pool.select_key("anthropic").id == "b1"
    left = key_pool._local_until["a2"] - __import__("time").time()
    assert 25 < left <= 30


@pytest.mark.parametrize("header,expected", [("1", 5), ("600", 120), (None, 5), ("junk", 5), ("42", 42)])
def test_retry_after_is_clamped(header, expected):
    headers = {} if header is None else {"retry-after": header}
    assert key_pool._retry_after(headers) == expected


def test_429_without_org_cools_only_that_key(pool):
    pool["keys"] = [_key("a"), _key("b")]
    key_pool.note_failure("a", 429, {}, "")
    assert key_pool.select_key("anthropic").id == "b"
    assert "b" not in key_pool._local_until


@pytest.mark.parametrize("status", [500, 529, 404, None])
def test_vendor_side_failures_fail_over_without_blocking_the_key(pool, status):
    pool["keys"] = [_key("a")]
    assert key_pool.note_failure("a", status, {}, "overloaded") == key_pool.FAIL_OVER
    assert key_pool.select_key("anthropic").id == "a"
    assert pool["writes"][-1][0] == "_write_failure"  # the error is still counted


def test_cost_counts_cache_reads_and_writes():
    usage = {"prompt_tokens": 1_000_000 + 2_000_000 + 400_000, "completion_tokens": 100_000,
             "cache_read_input_tokens": 2_000_000, "cache_creation_input_tokens": 400_000}
    assert key_pool.split_usage(usage) == (1_000_000, 100_000, 2_000_000, 400_000)
    key_pool._prices.clear()
    key_pool._prices["m"] = (__import__("time").monotonic(), (3.0, 15.0))
    # 1M x 3 + 2M x 0.3 + 0.4M x 3.75 + 0.1M x 15
    assert key_pool.cost_usd("m", usage) == pytest.approx(3.0 + 0.6 + 1.5 + 1.5)
    key_pool._prices.clear()


def test_raw_anthropic_usage_is_understood():
    raw = {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 7}
    assert key_pool.split_usage(raw) == (10, 5, 100, 7)


def test_recorded_spend_counts_toward_the_cap_before_the_write_lands(pool):
    pool["keys"] = [_key("a", budget=10, pct=100, spent=9.0)]
    assert key_pool.select_key("anthropic").id == "a"
    # 1M output tokens at $15/1M = $15 -> over the $10 cap
    key_pool.record_usage("a", "anthropic/claude-sonnet-4.5", {"prompt_tokens": 0, "completion_tokens": 1_000_000})
    assert pool["writes"][-1][0] == "_write_spend"
    assert key_pool.select_key("anthropic") is None


def test_record_usage_never_raises(pool, monkeypatch):
    monkeypatch.setattr(key_pool, "_price", lambda m: (_ for _ in ()).throw(RuntimeError("db down")))
    key_pool.record_usage("a", "m", {"completion_tokens": 3})  # no exception
    assert key_pool.note_failure(None, 401) == key_pool.FAIL_OVER


def test_estimate_uses_prompt_size_and_max_tokens(pool):
    est = key_pool.estimate_usd("m", {"messages": [{"role": "user", "content": "x" * 4000}], "max_tokens": 1000})
    assert 0.0175 < est < 0.0185  # ~1000 input tokens x $3 + 1000 output x $15, per 1M


def test_tables_absent_means_no_keys_logged_once(monkeypatch, caplog):
    key_pool._reset_for_tests()
    calls = []

    def boom(provider):
        calls.append(provider)
        raise RuntimeError('relation "llm_provider_keys" does not exist')

    monkeypatch.setattr(key_pool, "_load_from_db", boom)
    with caplog.at_level("WARNING"):
        assert key_pool.select_key("anthropic") is None
        assert key_pool.select_key("anthropic") is None
    assert len(calls) == 1, "a missing table is retried after a minute, not per request"
    assert sum("unavailable" in r.message for r in caplog.records) == 1
    key_pool._reset_for_tests()


def test_month_boundaries():
    assert key_pool.next_month_start(datetime(2026, 12, 31, 23, 0, tzinfo=timezone.utc)) == \
        datetime(2027, 1, 1, tzinfo=timezone.utc)
    assert str(key_pool.current_period(datetime(2026, 10, 15, tzinfo=timezone.utc))) == "2026-10-01"


def test_encryption_secret_is_the_dedicated_key_only(monkeypatch):
    settings = get_settings()
    monkeypatch.delenv("LLM_KEY_ENCRYPTION_KEY", raising=False)
    monkeypatch.setattr(settings, "internal_service_token", "svc-token")
    monkeypatch.setattr(settings, "jwt_secret_key", "jwt-secret-x")
    # Shared secrets never stand in for it.
    assert key_pool.encryption_ready() is False
    with pytest.raises(ValueError):
        key_pool.cipher()
    for shared in ("svc-token", "jwt-secret-x", _LEGACY_JWT_SECRET_FALLBACK):
        monkeypatch.setenv("LLM_KEY_ENCRYPTION_KEY", shared)
        assert key_pool.encryption_ready() is False, shared
    monkeypatch.setenv("LLM_KEY_ENCRYPTION_KEY", "dedicated")
    assert key_pool.encryption_ready() is True
    token = key_pool.cipher().encrypt("sk-ant-secret")
    assert key_pool.cipher().decrypt(token) == "sk-ant-secret"
    monkeypatch.setenv("LLM_KEY_ENCRYPTION_KEY", "rotated")
    assert key_pool.cipher().decrypt(token) is None, "a changed secret cannot read old keys (fails safe)"
    assert key_pool.key_hint("sk-ant-abcdWXYZ") == "…WXYZ"


def test_pool_key_repr_hides_the_secret():
    assert "sk-ant-" not in repr(_key("abcd"))


# ── schema parity with the admin_core migration ─────────────────────────────

def _migration_sql():
    for f in sorted(MIGRATIONS.glob("V*.sql")):
        body = f.read_text(encoding="utf-8")
        if "CREATE TABLE IF NOT EXISTS llm_provider_keys" in body:
            return re.sub(r"--[^\n]*", "", body)
    return None


def _sql_columns(sql, table):
    body = re.search(rf"CREATE TABLE IF NOT EXISTS {table} \((.*?)\n\);", sql, re.S)
    assert body, f"CREATE TABLE IF NOT EXISTS {table} not found"
    cols = {}
    for line in body.group(1).splitlines():
        line = line.strip().rstrip(",")
        if not line or line.upper().startswith("PRIMARY KEY"):
            continue
        name, sql_type, *rest = line.split()
        cols[name] = {"type": sql_type.lower(), "not_null": "NOT NULL" in " ".join(rest).upper()
                      or "PRIMARY KEY" in " ".join(rest).upper()}
    return cols


def _model_type(col):
    from sqlalchemy import BigInteger, Date, DateTime, Integer, Numeric, String, Text

    t = col.type
    if isinstance(t, Text):
        return "text"
    if isinstance(t, String):
        return f"varchar({t.length})"
    if isinstance(t, BigInteger):
        return "bigint"
    if isinstance(t, Integer):
        return "integer"
    if isinstance(t, Numeric):
        return f"numeric({t.precision},{t.scale})"
    if isinstance(t, DateTime):
        return "timestamptz" if t.timezone else "timestamp"
    if isinstance(t, Date):
        return "date"
    raise AssertionError(f"unmapped type {t!r}")


def test_models_match_the_migration():
    sql = _migration_sql()
    if sql is None:
        pytest.skip("llm_provider_keys migration not in this checkout yet")
    from ai_service.app.models.llm_provider_key import LlmKeySpend, LlmProviderKey

    for model in (LlmProviderKey, LlmKeySpend):
        expected = _sql_columns(sql, model.__tablename__)
        actual = {c.name: {"type": _model_type(c), "not_null": not c.nullable} for c in model.__table__.columns}
        assert actual == expected, model.__tablename__


# ── DB-backed blocks follow the row once it is written (multi-replica re-activation) ──

def test_limit_block_is_released_when_another_replica_reactivates_the_key(pool):
    body = '{"error":{"type":"invalid_request_error","message":"You have reached your specified workspace API usage limits"}}'
    pool["keys"] = [_key("k1")]
    assert key_pool.note_failure("k1", 400, {}, body) == key_pool.NEXT_KEY
    name, args = pool["writes"][-1]
    assert name == "_write_failure" and args[-1] is True
    assert key_pool.select_key("anthropic") is None, "blocked in-process before the write lands"
    # Before the write lands a reload must NOT drop the block (the row may not show it yet).
    key_pool.invalidate()
    assert key_pool.select_key("anthropic") is None
    # The write lands; the operator re-activates on replica A (row active, no exhausted_until);
    # this replica reloads on its TTL and must follow the row.
    key_pool._mark_block_landed("k1")
    key_pool.invalidate()
    assert key_pool.select_key("anthropic").id == "k1"
    assert "k1" not in key_pool._db_blocks


def test_landed_block_keeps_holding_while_the_row_still_shows_it(pool):
    future = datetime.now(timezone.utc) + timedelta(days=10)
    pool["keys"] = [_key("k1")]
    key_pool.note_failure("k1", 402, {}, '{"error":{"type":"billing_error","message":"pay"}}')
    key_pool._mark_block_landed("k1")
    pool["keys"] = [_key("k1", exhausted_until=future)]  # what the landed write left in the row
    key_pool.invalidate()
    assert key_pool.select_key("anthropic") is None


@pytest.mark.parametrize("status,body", [(401, ""), (403, '{"error":{"type":"permission_error","message":"no"}}')])
def test_auth_and_forbidden_blocks_also_follow_the_row(pool, status, body):
    pool["keys"] = [_key("k1")]
    key_pool.note_failure("k1", status, {}, body)
    assert key_pool.select_key("anthropic") is None
    key_pool._mark_block_landed("k1")
    key_pool.invalidate()
    assert key_pool.select_key("anthropic").id == "k1"


def test_org_cooldown_stays_in_process_across_reloads(pool):
    pool["keys"] = [_key("a1", org="org-A")]
    key_pool.note_failure("a1", 429, {"retry-after": "60"}, "")
    key_pool.invalidate()
    assert key_pool.select_key("anthropic") is None


# ── long-prompt rate card (Claude Haiku 5.5) ──

def test_haiku_5_5_long_prompt_is_metered_on_the_higher_rate_card(monkeypatch):
    monkeypatch.setattr(key_pool, "_price", lambda model: (0.10, 0.50))
    short = {"prompt_tokens": 100_000, "completion_tokens": 1_000}
    long = {"prompt_tokens": 150_000, "completion_tokens": 1_000}
    assert key_pool.cost_usd("anthropic/claude-haiku-5.5", short) == pytest.approx((100_000 * 0.10 + 1_000 * 0.50) / 1e6)
    assert key_pool.cost_usd("anthropic/claude-haiku-5.5", long) == pytest.approx((150_000 * 0.50 + 1_000 * 2.50) / 1e6)
    # cache reads count toward the threshold and are 0.1x the long input rate
    cached = {"prompt_tokens": 150_000, "completion_tokens": 0, "cache_read_input_tokens": 140_000}
    assert key_pool.cost_usd("claude-haiku-5-5", cached) == pytest.approx((10_000 * 0.50 + 140_000 * 0.05) / 1e6)
    # other models keep the flat registry rate
    assert key_pool.cost_usd("anthropic/claude-sonnet-4.5", long) == pytest.approx((150_000 * 0.10 + 1_000 * 0.50) / 1e6)


def test_haiku_5_5_long_prompt_estimate_uses_the_higher_rate(monkeypatch):
    monkeypatch.setattr(key_pool, "_price", lambda model: (0.10, 0.50))
    big = {"messages": [{"role": "user", "content": "x" * 800_000}], "max_tokens": 1000}
    est = key_pool.estimate_usd("anthropic/claude-haiku-5.5", big)
    assert est > (200_000 * 0.50) / 1e6 * 0.99
