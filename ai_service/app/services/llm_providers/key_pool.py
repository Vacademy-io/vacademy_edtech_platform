"""
Budget-aware pool of vendor API keys for llm_router (today: Anthropic).

Keys live in `llm_provider_keys` (admin_core Flyway; Fernet ciphertext only),
their month-to-date spend in `llm_key_spend`. Both are edited from the
super-admin portal (routers/llm_keys_admin.py). The pool is consulted ONLY for
a model the route map sends to a pooled gateway ("anthropic"), so with no such
route nothing here runs at all.

Selection (`select_key`): among keys that are active, not cooling down, not
exhausted for the month and whose month spend + this call's estimate stays
under budget x soft_limit_pct, a weighted random pick with
score = weight x (fraction of the capped budget still left). Two
organisations' keys therefore drain roughly together, and a key near its cap
gets fewer calls before it stops getting any.

After every call (`record_usage` / `note_failure`) the outcome is written in
the background — never on the request's path, never raising into it:
  401                                  -> status auth_failed, try the next key
  402 / billing_error / 400 "usage limit" -> exhausted until the 1st of next month (UTC)
  403                                  -> this key cools down 10 min
  429                                  -> every key of the same org cools for retry-after (5-120 s)
The first three are the key row's state (status / exhausted_until /
cooldown_until); this process also holds them only until its next reload after
the write lands, so a portal re-activation frees the key on every replica. The
429 cooldown lives in-process only.
  anything else (5xx, 529, 404, 400)   -> the caller fails over (OpenRouter)

Tables absent (ai_service deployed before admin_core), a DB error or no
LLM_KEY_ENCRYPTION_KEY (a secret only ai-service holds; see _encryption_secret): the pool has no keys, so the route falls back to OpenRouter
exactly as before. That is logged once per outage, not per request.
"""
from __future__ import annotations

import json
import logging
import os
import random
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import text

logger = logging.getLogger(__name__)

PROVIDER_ANTHROPIC = "anthropic"

CACHE_TTL_SECONDS = 10.0
# Tables missing / DB down: look again after this, not every request.
_UNAVAILABLE_RETRY_SECONDS = 60.0
_PRICE_TTL_SECONDS = 300.0

FORBIDDEN_COOLDOWN_SECONDS = 600.0
AUTH_FAILED_LOCAL_SECONDS = 600.0
RATE_LIMIT_MIN_SECONDS = 5.0
RATE_LIMIT_MAX_SECONDS = 120.0

NEXT_KEY = "next_key"
FAIL_OVER = "fail_over"

# Used when the registry has no price for the model: deliberately Opus-level,
# so a missing row makes the budget stop EARLY rather than never.
_FALLBACK_PRICE_PER_1M = (5.0, 25.0)
_CACHE_READ_FACTOR = 0.1
_CACHE_WRITE_FACTOR = 1.25

# Models Anthropic bills on a second, higher rate card once the prompt (every
# input token: uncached + cache reads + cache writes) is longer than a
# threshold. The registry row holds the short-prompt price only.
#   bare model id -> (prompt-token threshold, (input, output) USD per 1M above it)
LONG_PROMPT_RATES: Dict[str, Tuple[int, Tuple[float, float]]] = {
    "claude-haiku-5-5": (100_000, (0.50, 2.50)),
}

_LIMIT_MESSAGE_RE = re.compile(r"(usage|spend|spending)\s+limit|credit balance", re.IGNORECASE)


@dataclass
class PoolKey:
    id: str
    provider: str
    label: str
    org_label: Optional[str]
    key_hint: str
    api_key: str = field(repr=False)
    monthly_budget_usd: float = 200.0
    soft_limit_pct: int = 95
    weight: int = 1
    status: str = "active"
    cooldown_until: Optional[datetime] = None
    exhausted_until: Optional[datetime] = None
    metered_usd: float = 0.0  # this month, as last loaded (+ writes this process made since)

    @property
    def cap_usd(self) -> float:
        return float(self.monthly_budget_usd) * float(self.soft_limit_pct) / 100.0


@dataclass
class _ProviderCache:
    loaded_at: Optional[float] = None
    keys: List[PoolKey] = field(default_factory=list)
    retry_after: float = CACHE_TTL_SECONDS


_lock = threading.Lock()
_cache: Dict[str, _ProviderCache] = {}
# Spend recorded in-process whose DB write has not landed yet (key_id -> USD).
_pending_spend: Dict[str, float] = {}
# In-process 429 org cooldowns (key_id -> epoch seconds). Short, never in the DB.
_local_until: Dict[str, float] = {}
# The DB-backed blocks (auth_failed, exhausted for the month, 403 cooldown),
# held in-process only until the DB write has landed AND a later load has read
# the row back: key_id -> [until epoch, monotonic time the write landed or 0].
# From then on the row alone decides, so re-activating a key in the portal
# frees it on every replica at its next reload, not only on the one that
# served the PATCH.
_db_blocks: Dict[str, List[float]] = {}
_unavailable_logged = False
_prices: Dict[str, Tuple[float, Tuple[float, float]]] = {}
_missing_price_logged: set = set()

_executor: Optional[ThreadPoolExecutor] = None
_executor_lock = threading.Lock()


# --------------------------------------------------------------------------
# Encryption
# --------------------------------------------------------------------------

_shared_secret_logged = False


def _encryption_secret() -> Optional[str]:
    """LLM_KEY_ENCRYPTION_KEY, and nothing else.

    The stored keys are only as secret as this passphrase, and the table is
    readable by more DB roles than ai_service's own. INTERNAL_SERVICE_TOKEN and
    JWT_SECRET_KEY are shared with admin_core, assessment, community and CI, so
    neither may stand in for it, and a value equal to either is refused. With
    no usable secret the pool has no keys (every call stays on OpenRouter) and
    the portal cannot add one. Changing it later makes the stored keys
    undecryptable (they are skipped and logged): add them again."""
    global _shared_secret_logged
    from ...config import _LEGACY_JWT_SECRET_FALLBACK, get_settings

    secret = (os.getenv("LLM_KEY_ENCRYPTION_KEY") or "").strip()
    if not secret:
        return None
    settings = get_settings()
    if secret in (settings.internal_service_token, settings.jwt_secret_key, _LEGACY_JWT_SECRET_FALLBACK):
        if not _shared_secret_logged:
            _shared_secret_logged = True
            logger.error("LLM_KEY_ENCRYPTION_KEY equals a secret other services hold; ignored. "
                         "Set a value only ai-service knows.")
        return None
    return secret


def encryption_ready() -> bool:
    return _encryption_secret() is not None


def cipher():
    """TokenCipher over the pool's secret. Raises ValueError when none is set."""
    from ...mcp.crypto import TokenCipher

    secret = _encryption_secret()
    if not secret:
        raise ValueError("no encryption secret: set LLM_KEY_ENCRYPTION_KEY on ai-service")
    return TokenCipher(secret)


def key_hint(api_key: str) -> str:
    tail = (api_key or "").strip()[-4:]
    return f"…{tail}" if tail else "…"


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def current_period(now: Optional[datetime] = None) -> date:
    now = now or datetime.now(timezone.utc)
    return now.astimezone(timezone.utc).date().replace(day=1)


def next_month_start(now: Optional[datetime] = None) -> datetime:
    first = current_period(now)
    if first.month == 12:
        nxt = first.replace(year=first.year + 1, month=1)
    else:
        nxt = first.replace(month=first.month + 1)
    return datetime(nxt.year, nxt.month, 1, tzinfo=timezone.utc)


_LOAD_SQL = (
    "SELECT k.id, k.provider, k.label, k.org_label, k.key_ciphertext, k.key_hint, "
    "k.monthly_budget_usd, k.soft_limit_pct, k.weight, k.status, k.cooldown_until, "
    "k.exhausted_until, COALESCE(s.metered_usd, 0) AS metered_usd "
    "FROM llm_provider_keys k "
    "LEFT JOIN llm_key_spend s ON s.key_id = k.id AND s.period_month = :pm "
    "WHERE k.provider = :p ORDER BY k.created_at"
)


def _aware(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


def _load_from_db(provider: str) -> List[PoolKey]:
    from ...db import db_session

    secret_cipher = cipher()  # ValueError when no secret: treated like "no keys"
    with db_session() as db:
        rows = db.execute(text(_LOAD_SQL), {"p": provider, "pm": current_period()}).fetchall()
    keys: List[PoolKey] = []
    for r in rows:
        plain = secret_cipher.decrypt(r.key_ciphertext)
        if not plain:
            logger.error("LLM key %s (%s) could not be decrypted (encryption secret changed?); skipped",
                         r.key_hint, r.label)
            continue
        keys.append(PoolKey(
            id=str(r.id), provider=r.provider, label=r.label, org_label=r.org_label,
            key_hint=r.key_hint, api_key=plain,
            monthly_budget_usd=float(r.monthly_budget_usd or 0), soft_limit_pct=int(r.soft_limit_pct or 0),
            weight=int(r.weight or 0), status=str(r.status or ""),
            cooldown_until=_aware(r.cooldown_until), exhausted_until=_aware(r.exhausted_until),
            metered_usd=float(r.metered_usd or 0),
        ))
    return keys


def _keys(provider: str) -> List[PoolKey]:
    """The provider's keys, reloaded at most every CACHE_TTL_SECONDS. Never raises."""
    global _unavailable_logged
    now = time.monotonic()
    entry = _cache.get(provider)
    if entry is not None and entry.loaded_at is not None and now - entry.loaded_at < entry.retry_after:
        return entry.keys
    with _lock:
        entry = _cache.setdefault(provider, _ProviderCache())
        if entry.loaded_at is not None and now - entry.loaded_at < entry.retry_after:
            return entry.keys
        try:
            load_started = time.monotonic()
            entry.keys = _load_from_db(provider)
            entry.retry_after = CACHE_TTL_SECONDS
            _drop_landed_blocks(load_started)
            if _unavailable_logged:
                logger.info("LLM key pool loaded again (%d %s key(s))", len(entry.keys), provider)
            _unavailable_logged = False
        except Exception as exc:  # noqa: BLE001
            entry.keys = []
            entry.retry_after = _UNAVAILABLE_RETRY_SECONDS
            if not _unavailable_logged:
                logger.warning("LLM key pool unavailable (%s: %s); routed %s models stay on OpenRouter",
                               type(exc).__name__, str(exc)[:200], provider)
                _unavailable_logged = True
        entry.loaded_at = time.monotonic()
        return entry.keys


def _drop_landed_blocks(load_started: float) -> None:
    """Forget the in-process copy of every DB-backed block whose write landed
    before this load began: the rows just read already carry it (or an
    operator has cleared it since)."""
    for kid, (until, landed) in list(_db_blocks.items()):
        if landed and landed <= load_started:
            _db_blocks.pop(kid, None)


def _block_until_written(key_id: str, until_epoch: float) -> None:
    _db_blocks[key_id] = [until_epoch, 0.0]


def _mark_block_landed(key_id: str) -> None:
    entry = _db_blocks.get(key_id)
    if entry is not None:
        entry[1] = time.monotonic()


def invalidate(provider: Optional[str] = None) -> None:
    """Reload on the next lookup (after a portal edit)."""
    with _lock:
        if provider is None:
            _cache.clear()
        else:
            _cache.pop(provider, None)


def clear_local_state(key_id: str) -> None:
    """Forget this process's blocks for a key (it was re-activated)."""
    _local_until.pop(key_id, None)
    _db_blocks.pop(key_id, None)


def get_key(key_id: Optional[str], provider: str = PROVIDER_ANTHROPIC) -> Optional[PoolKey]:
    if not key_id:
        return None
    for k in _keys(provider):
        if k.id == key_id:
            return k
    return None


# --------------------------------------------------------------------------
# Selection
# --------------------------------------------------------------------------

def _eligible(k: PoolKey, est_usd: float, now_dt: datetime, now_epoch: float) -> Optional[float]:
    """The key's selection score, or None when it must not be used."""
    if k.status != "active":
        return None
    if k.cooldown_until and k.cooldown_until > now_dt:
        return None
    if k.exhausted_until and k.exhausted_until > now_dt:
        return None
    if _local_until.get(k.id, 0.0) > now_epoch:
        return None
    blocked = _db_blocks.get(k.id)
    if blocked is not None and blocked[0] > now_epoch:
        return None
    cap = k.cap_usd
    spent = k.metered_usd + _pending_spend.get(k.id, 0.0)
    if cap <= 0 or spent + max(est_usd, 0.0) >= cap:
        return None
    score = max(k.weight, 0) * ((cap - spent) / cap)
    return score if score > 0 else None


def select_key(provider: str, est_usd: float = 0.0, exclude: Iterable[str] = ()) -> Optional[PoolKey]:
    """A key to send one call with, or None (the caller stays on OpenRouter)."""
    try:
        keys = _keys(provider)
        if not keys:
            return None
        skip = set(exclude or ())
        now_dt, now_epoch = datetime.now(timezone.utc), time.time()
        scored = []
        for k in keys:
            if k.id in skip:
                continue
            score = _eligible(k, est_usd, now_dt, now_epoch)
            if score is not None:
                scored.append((k, score))
        if not scored:
            return None
        total = sum(s for _, s in scored)
        pick = random.uniform(0, total)
        upto = 0.0
        for k, s in scored:
            upto += s
            if pick <= upto:
                return k
        return scored[-1][0]
    except Exception:  # noqa: BLE001
        logger.exception("LLM key selection failed; staying on OpenRouter")
        return None


def has_active_key(provider: str) -> bool:
    return select_key(provider) is not None


# --------------------------------------------------------------------------
# Pricing
# --------------------------------------------------------------------------

def _price(registry_model: str) -> Tuple[float, float]:
    """(input, output) USD per 1M tokens of the REGISTRY model, cached."""
    now = time.monotonic()
    hit = _prices.get(registry_model)
    if hit and now - hit[0] < _PRICE_TTL_SECONDS:
        return hit[1]
    price: Optional[Tuple[float, float]] = None
    try:
        from ...db import db_session
        with db_session() as db:
            row = db.execute(text(
                "SELECT input_price_per_1m, output_price_per_1m FROM ai_models "
                "WHERE model_id = :m LIMIT 1"
            ), {"m": registry_model}).fetchone()
        if row and row[0] is not None and row[1] is not None and (float(row[0]) > 0 or float(row[1]) > 0):
            price = (float(row[0]), float(row[1]))
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM key pool: price lookup for %s failed (%s)", registry_model, exc)
        if hit:
            return hit[1]
    if price is None:
        if registry_model not in _missing_price_logged:
            logger.warning("LLM key pool: no ai_models price for %s; metering at $%.0f/$%.0f per 1M",
                           registry_model, *_FALLBACK_PRICE_PER_1M)
            _missing_price_logged.add(registry_model)
        price = _FALLBACK_PRICE_PER_1M
    _prices[registry_model] = (now, price)
    return price


def split_usage(usage: Optional[Dict[str, Any]]) -> Tuple[int, int, int, int]:
    """(uncached input, output, cache read, cache write) from OpenAI-shaped
    usage as anthropic_adapter.usage_to_openai builds it."""
    u = usage or {}

    def n(key: str) -> int:
        try:
            return max(int(u.get(key) or 0), 0)
        except (TypeError, ValueError):
            return 0

    cache_read = n("cache_read_input_tokens")
    cache_write = n("cache_creation_input_tokens")
    prompt = n("prompt_tokens") or n("input_tokens")
    if "input_tokens" in u and "prompt_tokens" not in u:  # raw Anthropic usage
        uncached = n("input_tokens")
    else:
        uncached = max(prompt - cache_read - cache_write, 0)
    output = n("completion_tokens") or n("output_tokens")
    return uncached, output, cache_read, cache_write


def _bare(model: str) -> str:
    m = (model or "").strip().lower()
    if m.startswith("anthropic/"):
        m = m[len("anthropic/"):]
    return m.split(":", 1)[0].replace(".", "-")


def _rates(registry_model: str, prompt_tokens: float) -> Tuple[float, float]:
    """(input, output) USD per 1M for a call with this many prompt tokens."""
    tier = LONG_PROMPT_RATES.get(_bare(registry_model))
    if tier is not None and prompt_tokens > tier[0]:
        return tier[1]
    return _price(registry_model)


def cost_usd(registry_model: str, usage: Optional[Dict[str, Any]]) -> float:
    uncached, output, cache_read, cache_write = split_usage(usage)
    in_rate, out_rate = _rates(registry_model, uncached + cache_read + cache_write)
    return (uncached * in_rate
            + cache_read * in_rate * _CACHE_READ_FACTOR
            + cache_write * in_rate * _CACHE_WRITE_FACTOR
            + output * out_rate) / 1_000_000


def estimate_usd(registry_model: str, payload: Optional[Dict[str, Any]]) -> float:
    """Rough upper estimate for one call: prompt chars / 4 at the input rate
    plus max_tokens at the output rate. Only used to keep a key under its cap."""
    try:
        p = payload or {}
        chars = len(json.dumps(p.get("messages") or [], ensure_ascii=False, default=str))
        if p.get("tools"):
            chars += len(json.dumps(p["tools"], ensure_ascii=False, default=str))
        in_rate, out_rate = _rates(registry_model, chars / 4.0)
        max_tokens = int(p.get("max_tokens") or p.get("max_completion_tokens") or 4096)
        return (chars / 4.0 * in_rate + max_tokens * out_rate) / 1_000_000
    except Exception:  # noqa: BLE001
        return 0.0


# --------------------------------------------------------------------------
# Outcomes
# --------------------------------------------------------------------------

def _submit(fn, *args) -> None:
    """Run a DB write off the request path. Never raises."""
    global _executor
    try:
        if _executor is None:
            with _executor_lock:
                if _executor is None:
                    _executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="llm-key-pool")
        _executor.submit(_guarded, fn, *args)
    except Exception:  # noqa: BLE001
        logger.warning("LLM key pool: could not queue a background write", exc_info=True)


def _guarded(fn, *args) -> None:
    try:
        fn(*args)
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM key pool: background write %s failed: %s", getattr(fn, "__name__", fn), exc)


_SPEND_UPSERT = (
    "INSERT INTO llm_key_spend (key_id, period_month, metered_usd, calls, errors, input_tokens, "
    "output_tokens, cache_read_tokens, cache_write_tokens, updated_at) "
    "VALUES (:k, :pm, :usd, :calls, :errors, :inp, :out, :cr, :cw, now()) "
    "ON CONFLICT (key_id, period_month) DO UPDATE SET "
    "metered_usd = llm_key_spend.metered_usd + EXCLUDED.metered_usd, "
    "calls = llm_key_spend.calls + EXCLUDED.calls, "
    "errors = llm_key_spend.errors + EXCLUDED.errors, "
    "input_tokens = llm_key_spend.input_tokens + EXCLUDED.input_tokens, "
    "output_tokens = llm_key_spend.output_tokens + EXCLUDED.output_tokens, "
    "cache_read_tokens = llm_key_spend.cache_read_tokens + EXCLUDED.cache_read_tokens, "
    "cache_write_tokens = llm_key_spend.cache_write_tokens + EXCLUDED.cache_write_tokens, "
    "updated_at = now()"
)


def _write_spend(key_id: str, period: date, usd: float, inp: int, out: int, cr: int, cw: int) -> None:
    from ...db import db_session

    with db_session() as db:
        db.execute(text(_SPEND_UPSERT), {"k": key_id, "pm": period, "usd": usd, "calls": 1, "errors": 0,
                                         "inp": inp, "out": out, "cr": cr, "cw": cw})
        db.execute(text("UPDATE llm_provider_keys SET last_used_at = now() WHERE id = :k"), {"k": key_id})
    # Landed: move it from "pending" into the cached month total, so the
    # budget check keeps counting it until the next load reads it back.
    with _lock:
        _pending_spend[key_id] = max(_pending_spend.get(key_id, 0.0) - usd, 0.0)
        for entry in _cache.values():
            for k in entry.keys:
                if k.id == key_id and current_period() == period:
                    k.metered_usd += usd


def record_usage(key_id: Optional[str], registry_model: str, usage: Optional[Dict[str, Any]]) -> None:
    """Meter one successful call against its key. Never raises, never blocks."""
    if not key_id:
        return
    try:
        usd = cost_usd(registry_model, usage)
        inp, out, cr, cw = split_usage(usage)
        with _lock:
            _pending_spend[key_id] = _pending_spend.get(key_id, 0.0) + usd
        _submit(_write_spend, key_id, current_period(), usd, inp, out, cr, cw)
    except Exception:  # noqa: BLE001
        logger.warning("LLM key pool: could not meter a call on key %s", key_id, exc_info=True)


def _write_failure(key_id: str, period: date, status: Optional[str], cooldown_until: Optional[datetime],
                   exhausted_until: Optional[datetime], error: str, block: bool = False) -> None:
    from ...db import db_session

    sets = ["last_error = :e", "last_error_at = now()", "updated_at = now()"]
    params: Dict[str, Any] = {"k": key_id, "e": error[:1000]}
    if status:
        # Never resurrect a key an operator disabled meanwhile.
        sets.append("status = CASE WHEN status = 'disabled' THEN status ELSE :s END")
        params["s"] = status
    if cooldown_until is not None:
        sets.append("cooldown_until = :cu")
        params["cu"] = cooldown_until
    if exhausted_until is not None:
        sets.append("exhausted_until = :xu")
        params["xu"] = exhausted_until
    with db_session() as db:
        db.execute(text(f"UPDATE llm_provider_keys SET {', '.join(sets)} WHERE id = :k"), params)
        db.execute(text(_SPEND_UPSERT), {"k": key_id, "pm": period, "usd": 0, "calls": 0, "errors": 1,
                                         "inp": 0, "out": 0, "cr": 0, "cw": 0})
    if block:
        _mark_block_landed(key_id)


def _error_parts(body_text: str) -> Tuple[Optional[str], str]:
    try:
        data = json.loads(body_text or "")
        err = data.get("error") if isinstance(data, dict) else None
        if isinstance(err, dict):
            return err.get("type"), str(err.get("message") or "")
    except (ValueError, TypeError, AttributeError):
        pass
    return None, (body_text or "")[:300]


def _retry_after(headers: Any) -> float:
    try:
        raw = headers.get("retry-after") if headers is not None else None
        secs = float(raw) if raw not in (None, "") else RATE_LIMIT_MIN_SECONDS
    except (TypeError, ValueError):
        secs = RATE_LIMIT_MIN_SECONDS
    return min(max(secs, RATE_LIMIT_MIN_SECONDS), RATE_LIMIT_MAX_SECONDS)


def is_limit_error(status: int, err_type: Optional[str], message: str) -> bool:
    """The key's account is out of money or over its spend limit."""
    if status == 402 or err_type == "billing_error":
        return True
    return status == 400 and bool(_LIMIT_MESSAGE_RE.search(message or ""))


def note_failure(key_id: Optional[str], status: Optional[int], headers: Any = None, body_text: str = "",
                 provider: str = PROVIDER_ANTHROPIC) -> str:
    """Apply the per-key rule for one failed call. Returns NEXT_KEY when another
    key of the provider may succeed, FAIL_OVER when the caller should move on
    (OpenRouter). Never raises."""
    try:
        err_type, message = _error_parts(body_text)
        error = f"HTTP {status}: {message}" if status is not None else (body_text or "transport error")
        period = current_period()
        now_epoch = time.time()
        if not key_id:
            return FAIL_OVER
        if status == 401:
            _block_until_written(key_id, now_epoch + AUTH_FAILED_LOCAL_SECONDS)
            _submit(_write_failure, key_id, period, "auth_failed", None, None, error, True)
            return NEXT_KEY
        if status is not None and is_limit_error(status, err_type, message):
            until = next_month_start()
            _block_until_written(key_id, until.timestamp())
            _submit(_write_failure, key_id, period, None, None, until, error, True)
            return NEXT_KEY
        if status == 403:
            _block_until_written(key_id, now_epoch + FORBIDDEN_COOLDOWN_SECONDS)
            until = datetime.now(timezone.utc) + timedelta(seconds=FORBIDDEN_COOLDOWN_SECONDS)
            _submit(_write_failure, key_id, period, None, until, None, error, True)
            return NEXT_KEY
        if status == 429:
            secs = _retry_after(headers)
            me = get_key(key_id, provider)
            org = me.org_label if me else None
            for k in _keys(provider):
                if k.id == key_id or (org and k.org_label == org):
                    _local_until[k.id] = max(_local_until.get(k.id, 0.0), now_epoch + secs)
            _submit(_write_failure, key_id, period, None, None, None, error)
            return NEXT_KEY
        _submit(_write_failure, key_id, period, None, None, None, error)
        return FAIL_OVER
    except Exception:  # noqa: BLE001
        logger.warning("LLM key pool: could not apply the failure rule", exc_info=True)
        return FAIL_OVER


def _reset_for_tests() -> None:
    global _unavailable_logged
    with _lock:
        _cache.clear()
        _pending_spend.clear()
        _local_until.clear()
        _db_blocks.clear()
        _prices.clear()
        _missing_price_logged.clear()
    _unavailable_logged = False


__all__ = [
    "PROVIDER_ANTHROPIC", "PoolKey", "NEXT_KEY", "FAIL_OVER",
    "encryption_ready", "cipher", "key_hint", "current_period", "next_month_start",
    "select_key", "has_active_key", "get_key", "invalidate", "clear_local_state",
    "record_usage", "note_failure", "cost_usd", "estimate_usd", "split_usage", "is_limit_error",
]
