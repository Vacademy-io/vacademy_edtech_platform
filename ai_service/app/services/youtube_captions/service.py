"""Shared YouTube caption service: one fallback chain for every caller.

get_captions(video, purpose=...) runs, in order:
  1. settings (30 s cache) read before any network call; enabled=false or
     network=False -> cache only, DISABLED (transient) on a miss
  2. cache: own key, the default-language row when its language matches, the
     legacy course 'youtube' row (default language only), unexpired negatives
  3. single-flight lock per cache key, cache re-read, a purpose-pool slot
     (BUSY after 60 s interactive / 300 s batch)
  4. direct (no proxy): one attempt, direct breaker (only when a fallback
     route is configured: with nothing else to try, every request tries
     direct, as before the service existed)
  5. proxy: library retries (new IP each) + outer retries with a fresh client
     (fewer of both for interactive callers), within the platform-wide daily
     proxy byte budget (youtube_captions.proxy_daily_mb)
  6. Supadata (secondary, off by default): after a transient result or when
     no proxy is usable; never after a trusted NO_CAPTIONS / UNAVAILABLE /
     PRIVATE; capped per day platform-wide
  7. final outcome by precedence, cache write, counters, one log line

Time: every network request inside the worker threads is cut to the call's
deadline (45 s interactive / 180 s batch, counted from the slot), so a hung
proxy or YouTube never holds a thread (or the caller) much past it.

Trust rule: a definitive answer (NO_CAPTIONS / UNAVAILABLE / PRIVATE) from
the DIRECT route counts only when direct had an OK in the last hour; blocked
IPs can be served degraded player responses, so otherwise the chain goes on.
With NO fallback route configured there is nothing to confirm it with: the
answer is returned as definitive (today's behaviour) but flagged
confirmed=False and never negative-cached.

Never raises for a YouTube outcome; never holds a DB session across a network
call (cache functions open their own short sessions in a thread).
"""
from __future__ import annotations

import asyncio
import os
import random
import socket
import time
from dataclasses import dataclass, field, replace
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from . import cache, guard, supadata, youtube_lib
from .types import (
    BATCH_PURPOSES, DEFINITIVE, PURPOSES, TRUSTED_FINAL, CaptionResult, CaptionsError, Outcome,
    logger, note_for, register_secrets,
)
from .youtube_lib import ProxySettings, RouteAttempt

INTERACTIVE_SLOT_WAIT_S = 60
BATCH_SLOT_WAIT_S = 300
INTERACTIVE_DEADLINE_S = 45
BATCH_DEADLINE_S = 180
SUPADATA_POLL_INTERACTIVE_S = 60
SUPADATA_POLL_BATCH_S = 120
OUTER_BACKOFF_S = (1.0, 3.0)
OUTER_JITTER = 0.3
# Interactive callers (tutor, KB ingest) get fewer proxy retries: a person waits.
INTERACTIVE_LIB_RETRIES = 2
INTERACTIVE_OUTER_RETRIES = 1
# Today's proxy bytes are re-read from the DB at most this often per pod (the
# local spend since is added on top), so the budget costs ~1 query a minute.
PROXY_SPEND_REFRESH_S = 60
MAX_PROBE_IDS = 10
PROBE_ROUTES = ("direct", "proxy", "supadata")

# Outer proxy retries (a fresh client) for these outcomes.
RETRYABLE = frozenset({Outcome.BLOCKED, Outcome.TIMEOUT, Outcome.NETWORK, Outcome.EMPTY_BODY, Outcome.PO_TOKEN})
# Supadata runs after these (or when no proxy is usable / its breaker is open).
SUPADATA_AFTER = frozenset({
    Outcome.BLOCKED, Outcome.PO_TOKEN, Outcome.UNPARSABLE, Outcome.EMPTY_BODY, Outcome.TIMEOUT,
    Outcome.NETWORK, Outcome.PROXY_AUTH, Outcome.UNPLAYABLE, Outcome.AGE_RESTRICTED,
})
# Most informative transient first.
TRANSIENT_ORDER = (Outcome.PO_TOKEN, Outcome.UNPARSABLE, Outcome.PROXY_AUTH, Outcome.BLOCKED, Outcome.EMPTY_BODY,
                   Outcome.UNPLAYABLE, Outcome.TIMEOUT, Outcome.NETWORK, Outcome.BUSY, Outcome.DISABLED)


# ── configuration ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Config:
    enabled: bool = True
    direct_enabled: bool = True
    proxy_enabled: bool = True
    proxy: ProxySettings = field(default_factory=ProxySettings)
    outer_retries: int = 2
    supadata_enabled: bool = False
    supadata_key: Optional[str] = None
    supadata_daily_cap: int = 300
    max_concurrent_batch: int = 3
    max_concurrent_interactive: int = 2
    max_per_minute: int = 30
    canary_video_ids: Tuple[str, ...] = ()
    requeue_enabled: bool = True
    requeue_per_sweep: int = 300
    proxy_daily_mb: int = 1024

    @property
    def proxy_usable(self) -> bool:
        return self.proxy_enabled and self.proxy.mode != "off" and self.proxy.configured

    @property
    def supadata_usable(self) -> bool:
        return self.supadata_enabled and bool(self.supadata_key)

    @property
    def fallback_configured(self) -> bool:
        """Some route other than direct can be tried (breakers aside)."""
        return self.proxy_usable or self.supadata_usable


def _platform(key: str, default: Any) -> Any:
    try:
        from ..platform_settings_service import get_platform_setting
        value = get_platform_setting(key, default=default)
        return default if value in (None, "") else value
    except Exception:  # noqa: BLE001 - a settings outage reads as the declared default
        return default


def _bool(key: str, default: bool) -> bool:
    v = _platform(key, default)
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    return bool(v)


def _int(key: str, default: int, lo: int, hi: int) -> int:
    try:
        n = int(float(_platform(key, default)))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _csv(raw: Any) -> Tuple[str, ...]:
    return tuple(x.strip() for x in str(raw or "").replace(";", ",").split(",") if x.strip())


def _env(name: str) -> Optional[str]:
    try:
        from ...config import get_settings
        v = getattr(get_settings(), name.lower(), None)
    except Exception:  # noqa: BLE001
        v = None
    if v is None:
        v = os.getenv(name.upper())
    v = (str(v).strip() if v is not None else "") or None
    return v


def load_config() -> Config:
    """Platform settings (portal, 30 s cache) + env / k8s secret. Blocking (the
    settings cache may refresh from the DB): call it through asyncio.to_thread."""
    mode = (_env("yt_captions_proxy") or "off").lower()
    if mode not in youtube_lib.PROXY_MODES:
        logger.warning("yt_captions: YT_CAPTIONS_PROXY=%r is not webshare/generic/off; proxy disabled", mode)
        mode = "off"
    user, password = _env("webshare_proxy_username"), _env("webshare_proxy_password")
    http_url, https_url = _env("yt_captions_proxy_http_url"), _env("yt_captions_proxy_https_url")
    key = _env("supadata_api_key")
    register_secrets(user, password, http_url, https_url, key)
    countries = tuple(c.lower() for c in _csv(_platform("youtube_captions.proxy_countries", "in,us")))
    proxy = ProxySettings(
        mode=mode, username=user, password=password, http_url=http_url, https_url=https_url,
        countries=countries, retries_when_blocked=_int("youtube_captions.proxy_retries_when_blocked", 4, 0, 10),
    )
    return Config(
        enabled=_bool("youtube_captions.enabled", True),
        direct_enabled=_bool("youtube_captions.direct_enabled", True),
        proxy_enabled=_bool("youtube_captions.proxy_enabled", True),
        proxy=proxy,
        outer_retries=_int("youtube_captions.outer_retries", 2, 0, 3),
        supadata_enabled=_bool("youtube_captions.supadata_enabled", False),
        supadata_key=key,
        supadata_daily_cap=_int("youtube_captions.supadata_daily_cap", 300, 0, 1_000_000),
        max_concurrent_batch=_int("youtube_captions.max_concurrent_batch", 3, 1, 8),
        max_concurrent_interactive=_int("youtube_captions.max_concurrent_interactive", 2, 1, 4),
        max_per_minute=_int("youtube_captions.max_per_minute", 30, 1, 600),
        canary_video_ids=_csv(_platform("youtube_captions.canary_video_ids", "")),
        requeue_enabled=_bool("youtube_captions.requeue_enabled", True),
        requeue_per_sweep=_int("youtube_captions.requeue_per_sweep", 300, 0, 2000),
        proxy_daily_mb=_int("youtube_captions.proxy_daily_mb", 1024, 0, 1_000_000),
    )


# ── helpers ──────────────────────────────────────────────────────────────────

def _video_id(video: str) -> Optional[str]:
    from ..kb.parsing import youtube_video_id
    return youtube_video_id(video or "")


def _is_batch(purpose: str) -> bool:
    return purpose in BATCH_PURPOSES


def _limit_fn(purpose: str, cfg: Config):
    if _is_batch(purpose):
        return lambda: cfg.max_concurrent_batch
    return lambda: cfg.max_concurrent_interactive


def _result(vid: str, outcome: Outcome, purpose: str, *, transient: Optional[bool] = None,
            attempt: Optional[RouteAttempt] = None, route: Optional[str] = None,
            retry_after_s: Optional[int] = None) -> CaptionResult:
    is_transient = (outcome not in DEFINITIVE and outcome is not Outcome.OK) if transient is None else transient
    a = attempt
    return CaptionResult(
        video_id=vid, outcome=outcome, segments=a.segments if a and outcome is Outcome.OK else (),
        language=a.language if a else None, kind=a.kind if a else None,
        translated_from=a.translated_from if a else None, route=route or (a.route if a else None),
        available=a.available if a else (), transient=is_transient, retry_after_s=retry_after_s,
        note=note_for(outcome, purpose, transient=is_transient),
    )


def _with_note(result: CaptionResult, purpose: str) -> CaptionResult:
    return replace(result, note=note_for(result.outcome, purpose, transient=result.transient))


@dataclass
class _Run:
    """What one chain did, for the final pick and the log line."""
    attempts: Dict[str, int] = field(default_factory=lambda: {"direct": 0, "proxy": 0, "supadata": 0})
    results: List[Tuple[RouteAttempt, bool]] = field(default_factory=list)   # (attempt, trusted)
    bytes_in: int = 0
    retry_after: Optional[int] = None
    supadata_credits: int = 0
    proxy_retries: int = 0
    breaker_skipped: bool = False      # a route was skipped because its breaker is open
    unconfirmed: bool = False          # a direct definitive answer accepted with no route to confirm it

    def add(self, a: RouteAttempt, trusted: bool = True) -> None:
        self.results.append((a, trusted))
        self.bytes_in += a.bytes_in


def _pick(run: _Run) -> Tuple[Optional[RouteAttempt], Outcome, bool]:
    """(attempt, outcome, transient) by precedence: OK > trusted definitive >
    AGE_RESTRICTED > the most informative transient > unconfirmed definitive."""
    for a, _ in run.results:
        if a.outcome is Outcome.OK:
            return a, Outcome.OK, False
    for a, trusted in run.results:
        if trusted and a.outcome in TRUSTED_FINAL:
            return a, a.outcome, False
    for a, trusted in run.results:
        if a.outcome is Outcome.AGE_RESTRICTED:
            return a, a.outcome, False
    for oc in TRANSIENT_ORDER:
        for a, _ in run.results:
            if a.outcome is oc:
                return a, oc, True
    for a, trusted in run.results:
        if not trusted and a.outcome in DEFINITIVE:
            return a, a.outcome, True          # unconfirmed: transient, never cached
    # Nothing ran: every usable route sits behind an open breaker (BLOCKED,
    # retry later) or no route is configured at all (DISABLED).
    return None, (Outcome.BLOCKED if run.breaker_skipped else Outcome.DISABLED), True


async def _lib_attempt(vid: str, route: str, cfg: Config, language: Optional[str], strict: bool,
                       deadline: Optional[float] = None, proxy: Optional[ProxySettings] = None) -> RouteAttempt:
    return await asyncio.to_thread(
        youtube_lib.fetch_route, vid, route, (proxy or cfg.proxy) if route == "proxy" else None,
        language=language, strict=strict, deadline=deadline,
    )


# ── proxy byte budget (platform-wide, per UTC day) ───────────────────────────

_PROXY_SPEND: Dict[str, Any] = {"day": None, "at": 0.0, "db": 0, "local": 0}
_last_budget_log = 0.0


async def proxy_bytes_today(force: bool = False) -> Optional[int]:
    """Today's proxy bytes, platform-wide: the DB sum (re-read every
    PROXY_SPEND_REFRESH_S) plus what this pod spent since. None = unreadable."""
    st = _PROXY_SPEND
    day, now = cache.today(), time.monotonic()
    if force or st["day"] != day or now - st["at"] >= PROXY_SPEND_REFRESH_S:
        n = await asyncio.to_thread(cache.proxy_bytes_today)
        if n is None:
            return None
        st.update(day=day, at=now, db=int(n), local=0)
    return int(st["db"]) + int(st["local"])


async def _proxy_budget(cfg: Config) -> Tuple[bool, Optional[int], str]:
    """(within budget, seconds until it resets when not, reason)."""
    global _last_budget_log
    limit = int(cfg.proxy_daily_mb) * 1024 * 1024
    spent = await proxy_bytes_today()
    if spent is not None and spent < limit:
        return True, None, ""
    why = ("proxy usage unreadable" if spent is None
           else f"daily proxy budget reached ({spent / 1048576:.0f}/{cfg.proxy_daily_mb} MB)")
    if time.monotonic() - _last_budget_log > 600:
        _last_budget_log = time.monotonic()
        logger.warning("yt_captions: proxy skipped: %s (youtube_captions.proxy_daily_mb)", why)
    return False, cache.seconds_to_utc_midnight() if spent is not None else 300, why


async def _record_proxy_spend(vid: str, bytes_in: int, outcome: Outcome) -> None:
    if bytes_in <= 0:
        return
    await asyncio.to_thread(cache.record_proxy_usage, bytes_in, vid, outcome)
    if _PROXY_SPEND["day"] == cache.today():
        _PROXY_SPEND["local"] = int(_PROXY_SPEND["local"]) + int(bytes_in)


def _jitter(base: float) -> float:
    return max(0.0, base * (1.0 + random.uniform(-OUTER_JITTER, OUTER_JITTER)))


# Proxy outcomes that count against the proxy breaker (after the retries): a
# blocked pool, and a proxy that refuses / drops / hangs (NETWORK, TIMEOUT).
PROXY_FAILURES = frozenset({Outcome.BLOCKED, Outcome.TIMEOUT, Outcome.NETWORK})


async def _run_proxy(vid: str, cfg: Config, language: Optional[str], strict: bool, deadline: float,
                     run: _Run, *, outer: Optional[int] = None, interactive: bool = False) -> RouteAttempt:
    """The proxy route with outer retries (a fresh client each time). Records
    the run's bytes as one usage row (the daily proxy budget)."""
    retries = cfg.outer_retries if outer is None else outer
    proxy = cfg.proxy
    if interactive:
        retries = min(retries, INTERACTIVE_OUTER_RETRIES)
        proxy = replace(proxy, retries_when_blocked=min(proxy.retries_when_blocked, INTERACTIVE_LIB_RETRIES))
    last: Optional[RouteAttempt] = None
    spent = 0
    try:
        for i in range(1 + max(0, retries)):
            if i > 0:
                pause = _jitter(OUTER_BACKOFF_S[min(i - 1, len(OUTER_BACKOFF_S) - 1)])
                if time.monotonic() + pause >= deadline:
                    break
                await asyncio.sleep(pause)
                run.proxy_retries += 1
            await guard.BUCKET.take(cfg.max_per_minute, deadline)
            last = await _lib_attempt(vid, "proxy", cfg, language, strict, deadline=deadline, proxy=proxy)
            run.attempts["proxy"] += 1
            run.bytes_in += last.bytes_in
            spent += last.bytes_in
            if last.outcome is Outcome.PROXY_AUTH:
                logger.error("yt_captions: the caption proxy rejected our credentials (HTTP 407 / proxy auth); "
                             "proxy paused for %d min. Check WEBSHARE_PROXY_* / YT_CAPTIONS_PROXY_*_URL.",
                             guard.PROXY_AUTH_OPEN_S // 60)
                guard.breaker("proxy").trip(guard.PROXY_AUTH_OPEN_S, "proxy credentials rejected")
                return last
            if last.outcome not in RETRYABLE or youtube_lib.is_deadline(last):
                break
        assert last is not None
        if not youtube_lib.is_deadline(last):        # our budget ran out: not the proxy's fault
            guard.breaker("proxy").record(last.outcome in PROXY_FAILURES, last.outcome.value)
        return last
    finally:
        if spent:
            await _record_proxy_spend(vid, spent, last.outcome if last is not None else Outcome.NETWORK)


async def _supadata_allowed(cfg: Config) -> Tuple[bool, str]:
    if not cfg.supadata_usable:
        return False, "not configured"
    ok, left = guard.breaker("supadata").allow()
    if not ok:
        return False, f"breaker open ({left}s)"
    spent = await asyncio.to_thread(cache.supadata_credits_today)
    if spent is None or spent >= cfg.supadata_daily_cap:
        # The half-open slot (if one was taken) must not stay claimed.
        b = guard.breaker("supadata")
        if b.state == "half_open":
            b.half_open_at = None
        return False, f"daily cap reached ({spent}/{cfg.supadata_daily_cap})"
    return True, ""


async def _run_supadata(vid: str, cfg: Config, language: Optional[str], purpose: str, deadline: float,
                        run: _Run) -> RouteAttempt:
    await guard.BUCKET.take(cfg.max_per_minute, deadline)
    budget = SUPADATA_POLL_BATCH_S if _is_batch(purpose) else SUPADATA_POLL_INTERACTIVE_S
    a = await supadata.fetch(vid, cfg.supadata_key or "", language=language, poll_budget_s=budget,
                             deadline=deadline)
    run.attempts["supadata"] += 1
    run.supadata_credits += a.credits
    if a.credits:
        await asyncio.to_thread(cache.record_supadata_usage, a.credits, vid, a.outcome)
    b = guard.breaker("supadata")
    if a.open_breaker_s:
        b.trip(a.open_breaker_s, a.detail or "supadata refused")
    else:
        b.record(False)
    return a


def _note_retry_after(run: _Run, left: Optional[int]) -> None:
    if left is None:
        return
    run.retry_after = left if run.retry_after is None else min(run.retry_after, left)


async def _chain(vid: str, cfg: Config, language: Optional[str], strict: bool, purpose: str,
                 deadline: float, run: _Run) -> None:
    proxy_skipped = False
    fallback = cfg.fallback_configured

    # 4. direct (behind its breaker only when something else can be tried)
    if cfg.direct_enabled:
        allowed, left = guard.breaker("direct").allow() if fallback else (True, None)
        if allowed:
            await guard.BUCKET.take(cfg.max_per_minute, deadline)
            a = await _lib_attempt(vid, "direct", cfg, language, strict, deadline=deadline)
            run.attempts["direct"] += 1
            if not youtube_lib.is_deadline(a):
                guard.breaker("direct").record(a.outcome is Outcome.BLOCKED, a.outcome.value)
            if a.outcome is Outcome.OK:
                guard.note_direct_ok()
                run.add(a)
                return
            trusted = a.outcome not in TRUSTED_FINAL or guard.direct_trusted()
            if a.outcome in TRUSTED_FINAL and not trusted and not fallback:
                # Nothing could confirm it: answer as before the service existed,
                # but never negative-cache it (get_captions sets confirmed=False).
                trusted, run.unconfirmed = True, True
            run.add(a, trusted)
            if a.outcome in TRUSTED_FINAL and trusted:
                return
        else:
            _note_retry_after(run, left)
            run.breaker_skipped = True

    last = run.results[-1][0].outcome if run.results else None

    # 5. proxy (skipped after AGE_RESTRICTED: the answer is about the video)
    if cfg.proxy_usable and last is not Outcome.AGE_RESTRICTED and time.monotonic() < deadline:
        allowed, left = guard.breaker("proxy").allow()
        within, reset_in, _ = (await _proxy_budget(cfg)) if allowed else (True, None, "")
        if allowed and not within:
            b = guard.breaker("proxy")
            if b.state == "half_open":        # the half-open slot must not stay claimed
                b.half_open_at = None
            allowed, left = False, reset_in
        if allowed:
            a = await _run_proxy(vid, cfg, language, strict, deadline, run, interactive=not _is_batch(purpose))
            run.results.append((a, True))
            if a.outcome is Outcome.OK or a.outcome in TRUSTED_FINAL:
                return
            last = a.outcome
        else:
            proxy_skipped = True
            run.breaker_skipped = True
            _note_retry_after(run, left)

    # 6. Supadata
    no_proxy = not cfg.proxy_usable or proxy_skipped
    wanted = (last in SUPADATA_AFTER) or no_proxy
    if cfg.supadata_usable and wanted and time.monotonic() < deadline:
        allowed, why = await _supadata_allowed(cfg)
        if allowed:
            a = await _run_supadata(vid, cfg, language, purpose, deadline, run)
            run.add(a)
        else:
            if why.startswith("breaker"):
                run.breaker_skipped = True
            logger.info("yt_captions: Supadata skipped for %s: %s", vid, why)


def _log_line(vid: str, purpose: str, result: CaptionResult, run: Optional[_Run], ms: int, cache_hit: bool) -> None:
    attempts = run.attempts if run else {"direct": 0, "proxy": 0, "supadata": 0}
    level = logger.warning if result.transient else logger.info
    level("yt_captions video=%s purpose=%s outcome=%s route=%s lang=%s kind=%s attempts=direct:%d,proxy:%d,"
          "supadata:%d ms=%d chars=%d bytes=%d cache=%s",
          vid, purpose, result.outcome.value, result.route or "-", result.language or "-", result.kind or "-",
          attempts["direct"], attempts["proxy"], attempts["supadata"], ms, len(result.text),
          run.bytes_in if run else 0, "hit" if cache_hit else "miss")


# ── public API ───────────────────────────────────────────────────────────────

async def get_captions(video: str, *, language: Optional[str] = None, purpose: str,
                       strict_language: bool = False, refresh: bool = False,
                       network: bool = True) -> CaptionResult:
    """Captions for one video through the shared chain. Never raises for a
    YouTube outcome: read ``result.outcome`` / ``result.transient``."""
    if purpose not in PURPOSES:
        raise ValueError(f"unknown purpose {purpose!r}")
    t0 = time.monotonic()
    lang = (language or "").strip() or None
    strict = bool(strict_language and lang)
    vid = _video_id(video)
    if not vid:
        return _result(str(video or "")[:64], Outcome.UNAVAILABLE, purpose)

    cfg = await asyncio.to_thread(load_config)

    if not refresh:
        hit = await asyncio.to_thread(cache.read, vid, lang, strict)
        if hit is not None:
            hit = _with_note(hit, purpose)
            guard.record(hit.outcome, hit.kind, hit.route, int((time.monotonic() - t0) * 1000))
            _log_line(vid, purpose, hit, None, int((time.monotonic() - t0) * 1000), True)
            return hit

    if not cfg.enabled or not network:
        res = replace(_result(vid, Outcome.DISABLED, purpose, transient=True),
                      fallback_configured=cfg.fallback_configured)
        _log_line(vid, purpose, res, None, int((time.monotonic() - t0) * 1000), False)
        return res

    batch = _is_batch(purpose)
    deadline = t0 + (BATCH_DEADLINE_S if batch else INTERACTIVE_DEADLINE_S)
    wait = BATCH_SLOT_WAIT_S if batch else INTERACTIVE_SLOT_WAIT_S
    run = _Run()
    key = cache.cache_key(vid, lang, strict)
    result: Optional[CaptionResult] = None
    try:
        async with guard.key_lock(key, wait):
            if not refresh:
                hit = await asyncio.to_thread(cache.read, vid, lang, strict)
                if hit is not None:
                    result = _with_note(hit, purpose)
            if result is None:
                # The deadline counts from the slot, so a long queue never eats the fetch budget.
                async with guard.slot(purpose, _limit_fn(purpose, cfg), wait):
                    deadline = time.monotonic() + (BATCH_DEADLINE_S if batch else INTERACTIVE_DEADLINE_S)
                    await _chain(vid, cfg, lang, strict, purpose, deadline, run)
                a, outcome, transient = _pick(run)
                result = _result(vid, outcome, purpose, transient=transient, attempt=a,
                                 retry_after_s=run.retry_after if transient else None)
    except guard.Busy as exc:
        logger.info("yt_captions: %s busy (%s)", vid, exc)
        a, outcome, transient = _pick(run)
        if a is not None and outcome is Outcome.OK:
            result = _result(vid, outcome, purpose, attempt=a)
        else:
            result = _result(vid, Outcome.BUSY, purpose, transient=True)

    ms = int((time.monotonic() - t0) * 1000)
    from_cache = result.route in ("cache", "legacy_cache")
    if not from_cache:
        result = replace(result, fallback_configured=cfg.fallback_configured,
                         confirmed=not (run.unconfirmed and result.outcome in DEFINITIVE))
    if not from_cache and cache.cacheable(result):
        extra = {"bytes": run.bytes_in or None, "supadata_credits": run.supadata_credits or None}
        await asyncio.to_thread(cache.write, result, language=lang, strict=strict, extra=extra)
    guard.record(result.outcome, result.kind, result.route, ms, retries=run.proxy_retries,
                 supadata_used=run.attempts["supadata"] > 0)
    _log_line(vid, purpose, result, run, ms, from_cache)
    return result


async def require_captions(video: str, **kw: Any) -> CaptionResult:
    """get_captions, raising CaptionsError (a ValueError whose text is the
    user note) unless the outcome is OK."""
    result = await get_captions(video, **kw)
    if result.outcome is not Outcome.OK:
        raise CaptionsError(result)
    return result


async def probe(video_ids: Sequence[str], routes: Optional[Iterable[str]] = None,
                language: Optional[str] = None, *, write_cache: bool = True,
                outer_retries: Optional[int] = None) -> List[Dict[str, Any]]:
    """Staff / probe: each route on its own per video, bypassing the cache and
    the breakers (still taking an interactive slot and rate tokens; Supadata
    still respects its daily cap). Writes the cache only on OK."""
    cfg = await asyncio.to_thread(load_config)
    wanted = [r for r in (routes or PROBE_ROUTES) if r in PROBE_ROUTES]
    out: List[Dict[str, Any]] = []
    lang = (language or "").strip() or None
    for raw in list(video_ids)[:MAX_PROBE_IDS]:
        vid = _video_id(raw)
        for route in wanted:
            row: Dict[str, Any] = {"video_id": vid or raw, "route": route}
            if not vid:
                row.update(outcome=Outcome.UNAVAILABLE.value, note="not a YouTube video id")
                out.append(row)
                continue
            if route == "proxy" and not cfg.proxy.configured:
                row.update(outcome=Outcome.DISABLED.value, note="proxy not configured")
                out.append(row)
                continue
            if route == "proxy":
                within, _, why = await _proxy_budget(cfg)
                if not within:
                    row.update(outcome=Outcome.DISABLED.value, note=why)
                    out.append(row)
                    continue
            if route == "supadata":
                if not cfg.supadata_key:
                    row.update(outcome=Outcome.DISABLED.value, note="SUPADATA_API_KEY not set")
                    out.append(row)
                    continue
                spent = await asyncio.to_thread(cache.supadata_credits_today)
                if spent is None or spent >= cfg.supadata_daily_cap:
                    row.update(outcome=Outcome.DISABLED.value, note=f"Supadata daily cap reached ({spent})")
                    out.append(row)
                    continue
            run = _Run()
            deadline = time.monotonic() + BATCH_DEADLINE_S
            t0 = time.monotonic()
            try:
                async with guard.slot("probe", _limit_fn("probe", cfg), INTERACTIVE_SLOT_WAIT_S):
                    if route == "direct":
                        await guard.BUCKET.take(cfg.max_per_minute, deadline)
                        a = await _lib_attempt(vid, "direct", cfg, lang, False, deadline=deadline)
                        run.attempts["direct"] += 1
                    elif route == "proxy":
                        a = await _run_proxy(vid, cfg, lang, False, deadline, run, outer=outer_retries)
                    else:
                        a = await _run_supadata(vid, cfg, lang, "probe", deadline, run)
            except guard.Busy:
                row.update(outcome=Outcome.BUSY.value, ms=int((time.monotonic() - t0) * 1000))
                out.append(row)
                continue
            text = " ".join(s.text for s in a.segments)
            row.update(
                outcome=a.outcome.value, language=a.language, kind=a.kind, translated_from=a.translated_from,
                available=list(a.available), snippets=len(a.segments), ms=a.ms, bytes=run.bytes_in or a.bytes_in,
                retries=run.proxy_retries, supadata_credits=a.credits, detail=a.detail, sample=text[:200],
            )
            out.append(row)
            if write_cache and a.outcome is Outcome.OK and not lang:
                res = _result(vid, Outcome.OK, "probe", attempt=a)
                await asyncio.to_thread(cache.write, res, extra={"bytes": a.bytes_in or None,
                                                                 "supadata_credits": a.credits or None})
            guard.record(a.outcome, a.kind, a.route, a.ms, retries=run.proxy_retries,
                         supadata_used=route == "supadata")
    return out


async def canary_ok(cfg: Optional[Config] = None) -> bool:
    """True when the proxy / Supadata path works right now: at least half of
    the canary videos come back OK. Per video, Supadata is tried only when the
    proxy did not succeed (so a healthy proxy spends no Supadata credit)."""
    cfg = cfg or await asyncio.to_thread(load_config)
    ids = list(cfg.canary_video_ids)[:MAX_PROBE_IDS]
    if not ids or not (cfg.proxy_usable or cfg.supadata_usable):
        return False
    ok = 0
    for vid in ids:
        rows: List[Dict[str, Any]] = []
        if cfg.proxy_usable:
            rows = await probe([vid], ["proxy"], write_cache=True, outer_retries=1)
        if not any(r.get("outcome") == "OK" for r in rows) and cfg.supadata_usable:
            rows = await probe([vid], ["supadata"], write_cache=True)
        if any(r.get("outcome") == "OK" for r in rows):
            ok += 1
    passed = ok * 2 >= len(ids)
    (logger.info if passed else logger.warning)("yt_captions canary %d/%d OK -> %s", ok, len(ids),
                                                "pass" if passed else "fail")
    return passed


def health_snapshot(include_db: bool = False) -> Dict[str, Any]:
    """This pod's view. Secrets appear only as booleans. Blocking when
    include_db (today's Supadata credits): call it through asyncio.to_thread."""
    cfg = load_config()
    snap: Dict[str, Any] = {
        "pod": socket.gethostname(),
        "library_version": youtube_lib.LIB_VERSION,
        "enabled": cfg.enabled,
        "direct_enabled": cfg.direct_enabled,
        "proxy_mode": cfg.proxy.mode,
        "proxy_enabled": cfg.proxy_enabled,
        "proxy_configured": cfg.proxy.configured,
        "proxy_countries": list(cfg.proxy.countries),
        "proxy_retries_when_blocked": cfg.proxy.retries_when_blocked,
        "outer_retries": cfg.outer_retries,
        "supadata_enabled": cfg.supadata_enabled,
        "supadata_key_present": bool(cfg.supadata_key),
        "supadata_daily_cap": cfg.supadata_daily_cap,
        "proxy_daily_mb": cfg.proxy_daily_mb,
        "fallback_configured": cfg.fallback_configured,
        "limits": {"max_concurrent_batch": cfg.max_concurrent_batch,
                   "max_concurrent_interactive": cfg.max_concurrent_interactive,
                   "max_per_minute": cfg.max_per_minute},
        "canary_video_ids": list(cfg.canary_video_ids),
        "requeue_enabled": cfg.requeue_enabled,
        "breakers": {name: b.snapshot() for name, b in guard.BREAKERS.items()},
        "direct_trusted": guard.direct_trusted(),
        "last_hour": guard.window_stats(),
    }
    if include_db:
        snap["supadata_credits_today"] = cache.supadata_credits_today()
        used = cache.proxy_bytes_today()
        snap["proxy_mb_today"] = round(used / 1048576, 1) if used is not None else None
    return snap


__all__ = ["Config", "load_config", "get_captions", "require_captions", "probe", "canary_ok", "health_snapshot",
           "proxy_bytes_today", "MAX_PROBE_IDS", "PROBE_ROUTES"]
