"""The shared caption cache: rows in course_extract_cache (V600), no new table.

Keys (pointer_kind 'yt_captions', extractor_version CACHE_VERSION, tier 'FREE'):
  vid          default language
  vid:<r>      language r requested (r = base code)
  vid:<r>:t    language r requested strictly (native r or a translation into r)

segments use the course Segment.to_dict shape ({"text", "anchor": "time",
"t_start_ms", "t_end_ms"}), so course code can reuse Segment.from_dict.
probe holds {outcome, language, kind, translated_from, route, available,
snippets, fetched_at, expires_at?, supadata_credits?, bytes?, lib}.

OK rows are kept until a refresh; NO_CAPTIONS 14 days, UNAVAILABLE 30 days,
PRIVATE / AGE_RESTRICTED 3 days; transient results are never cached. The
upsert never lets a negative result overwrite a good row, and its decision
comes from RETURNING (psycopg 3 reports rowcount -1 for ON CONFLICT).

Supadata spend: every Supadata call writes one small usage row
('yt_cap_usage', 'supadata:<day>:<uuid>'; pointer_kind is VARCHAR(16)), and the daily cap is the sum
of today's usage rows, so it holds across replicas. (Summing only usage rows,
rather than cache rows plus usage rows, counts each credit exactly once even
when a cached row is overwritten the same day.)

Proxy spend: every proxy run (one video, all its attempts) writes one usage
row the same way ('proxy:<day>:<uuid>', probe.proxy_bytes), and the daily
proxy byte budget is the sum of today's rows.

Unconfirmed definitive results (CaptionResult.confirmed False) are never
cached: they came only from a server IP that may be served degraded answers.

Every function is synchronous and opens its own short ``with db_session()``
block: call them through asyncio.to_thread, never while holding a session.
CAST(:x AS jsonb), never ``::`` after a bind.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text

from ...db import db_session
from . import languages
from .types import DEFINITIVE, CaptionResult, CaptionSegment, Outcome, logger
from .youtube_lib import LIB_VERSION

POINTER_KIND = "yt_captions"
USAGE_KIND = "yt_cap_usage"       # pointer_kind is VARCHAR(16)
LEGACY_KIND = "youtube"           # the course extractor's pre-service rows
LEGACY_VERSION = 1                # course EXTRACTOR_VERSION those rows were written at
CACHE_VERSION = 1
TIER = "FREE"
USAGE_KEEP_DAYS = 7

NEGATIVE_TTL_DAYS = {
    Outcome.NO_CAPTIONS: 14,
    Outcome.UNAVAILABLE: 30,
    Outcome.PRIVATE: 3,
    Outcome.AGE_RESTRICTED: 3,
}


def cache_key(video_id: str, language: Optional[str] = None, strict: bool = False) -> str:
    r = languages.base(language) if language else ""
    if not r:
        return video_id
    return f"{video_id}:{r}:t" if strict else f"{video_id}:{r}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _json(raw: Any, default: Any) -> Any:
    if raw is None:
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return default


def _segments_from(raw: Any) -> Tuple[CaptionSegment, ...]:
    out: List[CaptionSegment] = []
    for s in _json(raw, []):
        if not isinstance(s, dict):
            continue
        t = str(s.get("text") or "").strip()
        if not t:
            continue
        try:
            start = int(s.get("t_start_ms") or 0)
            end = int(s.get("t_end_ms") if s.get("t_end_ms") is not None else start)
        except (TypeError, ValueError):
            start, end = 0, 0
        out.append(CaptionSegment(start_ms=start, end_ms=max(start, end), text=t))
    return tuple(out)


def _segments_to(segments: Tuple[CaptionSegment, ...]) -> List[Dict[str, Any]]:
    return [{"text": s.text, "anchor": "time", "t_start_ms": int(s.start_ms), "t_end_ms": int(s.end_ms)}
            for s in segments]


def _from_row(video_id: str, segments: Any, probe: Dict[str, Any], route: str) -> Optional[CaptionResult]:
    try:
        outcome = Outcome(str(probe.get("outcome") or "OK"))
    except ValueError:
        return None
    if outcome is Outcome.OK:
        segs = _segments_from(segments)
        if not segs:
            return None
        return CaptionResult(
            video_id=video_id, outcome=Outcome.OK, segments=segs, language=probe.get("language"),
            kind=probe.get("kind") or "unknown", translated_from=probe.get("translated_from"), route=route,
            available=tuple(probe.get("available") or ()),
        )
    if outcome not in DEFINITIVE:
        return None
    expires = probe.get("expires_at")
    try:
        if not expires or datetime.fromisoformat(str(expires)) <= _now():
            return None
    except ValueError:
        return None
    return CaptionResult(video_id=video_id, outcome=outcome, route=route,
                         available=tuple(probe.get("available") or ()))


_READ_SQL = text("""
    SELECT pointer_kind, pointer_key, segments, probe
      FROM course_extract_cache
     WHERE tier = :tier
       AND ((pointer_kind = :kind AND extractor_version = :v AND pointer_key IN (:own, :dflt))
            OR (pointer_kind = :legacy_kind AND extractor_version = :lv AND pointer_key = :vid))
""")


def read(video_id: str, language: Optional[str] = None, strict: bool = False) -> Optional[CaptionResult]:
    """The cached result for this request, or None (a miss, an expired negative
    row, or a DB error: a cache problem is never an error)."""
    own_key = cache_key(video_id, language, strict)
    try:
        with db_session() as db:
            rows = db.execute(_READ_SQL, {
                "tier": TIER, "kind": POINTER_KIND, "v": CACHE_VERSION, "own": own_key, "dflt": video_id,
                "legacy_kind": LEGACY_KIND, "lv": LEGACY_VERSION, "vid": video_id,
            }).fetchall()
    except Exception:  # noqa: BLE001
        logger.warning("yt_captions: cache read failed for %s", video_id, exc_info=True)
        return None
    own = default = legacy = None
    for kind, key, segments, probe in rows:
        p = _json(probe, {})
        p = p if isinstance(p, dict) else {}
        if kind == LEGACY_KIND:
            legacy = (segments, p)
        elif key == own_key:
            own = (segments, p)
        elif key == video_id:
            default = (segments, p)

    if own is not None and str(own[1].get("outcome") or "OK") == "OK":
        hit = _from_row(video_id, own[0], own[1], "cache")
        if hit is not None:
            return hit
    if language and default is not None and str(default[1].get("outcome") or "OK") == "OK":
        r = languages.base(language)
        if languages.base(default[1].get("language")) == r and default[1].get("kind") != "translated":
            hit = _from_row(video_id, default[0], default[1], "cache")
            if hit is not None:
                return hit
    if own is not None:
        hit = _from_row(video_id, own[0], own[1], "cache")
        if hit is not None:
            return hit
    if not language and legacy is not None:
        segs = _segments_from(legacy[0])
        if segs:
            return CaptionResult(video_id=video_id, outcome=Outcome.OK, segments=segs, kind="unknown",
                                 route="legacy_cache")
    return None


_UPSERT_SQL = text("""
    INSERT INTO course_extract_cache (pointer_kind, pointer_key, extractor_version, tier, segments, text_chars, probe)
    VALUES (:kind, :key, :v, :tier, CAST(:segments AS jsonb), :chars, CAST(:probe AS jsonb))
    ON CONFLICT (pointer_kind, pointer_key, extractor_version, tier)
    DO UPDATE SET segments = EXCLUDED.segments, text_chars = EXCLUDED.text_chars, probe = EXCLUDED.probe
     WHERE course_extract_cache.probe->>'outcome' IS DISTINCT FROM 'OK'
        OR EXCLUDED.probe->>'outcome' = 'OK'
    RETURNING pointer_key
""")


def cacheable(result: CaptionResult) -> bool:
    if result.transient:
        return False
    if result.outcome is not Outcome.OK and not result.confirmed:
        return False
    if result.outcome is Outcome.OK:
        return bool(result.segments) and result.route not in ("cache", "legacy_cache")
    return result.outcome in NEGATIVE_TTL_DAYS and result.route not in ("cache", "legacy_cache")


def write(result: CaptionResult, *, language: Optional[str] = None, strict: bool = False,
          extra: Optional[Dict[str, Any]] = None) -> bool:
    """Store an OK or definitive result. True when the row was written."""
    if not cacheable(result):
        return False
    now = _now()
    probe: Dict[str, Any] = {
        "outcome": result.outcome.value, "language": result.language, "kind": result.kind,
        "translated_from": result.translated_from, "route": result.route, "available": list(result.available),
        "snippets": len(result.segments), "fetched_at": now.isoformat(), "lib": LIB_VERSION,
    }
    ttl = NEGATIVE_TTL_DAYS.get(result.outcome)
    if ttl:
        probe["expires_at"] = (now + timedelta(days=ttl)).isoformat()
    probe.update({k: v for k, v in (extra or {}).items() if v is not None})
    segs = _segments_to(result.segments) if result.outcome is Outcome.OK else []
    params = {
        "kind": POINTER_KIND, "key": cache_key(result.video_id, language, strict)[:512], "v": CACHE_VERSION,
        "tier": TIER, "segments": json.dumps(segs, ensure_ascii=False),
        "chars": sum(len(s["text"]) for s in segs),
        "probe": json.dumps(probe, ensure_ascii=False, default=str),
    }
    try:
        with db_session() as db:
            row = db.execute(_UPSERT_SQL, params).first()
            db.commit()
        return row is not None
    except Exception:  # noqa: BLE001 - losing a cache write only costs a re-fetch
        logger.warning("yt_captions: cache write failed for %s", result.video_id, exc_info=True)
        return False


_USAGE_SQL = text("""
    INSERT INTO course_extract_cache (pointer_kind, pointer_key, extractor_version, tier, segments, text_chars, probe)
    VALUES (:kind, :key, :v, :tier, CAST('[]' AS jsonb), 0, CAST(:probe AS jsonb))
    ON CONFLICT (pointer_kind, pointer_key, extractor_version, tier) DO NOTHING
    RETURNING pointer_key
""")

_CREDITS_TODAY_SQL = text("""
    SELECT COALESCE(SUM(CAST(probe->>'supadata_credits' AS INTEGER)), 0)
      FROM course_extract_cache
     WHERE pointer_kind = :kind AND tier = :tier AND extractor_version = :v
       AND pointer_key LIKE :prefix
""")

_PROXY_BYTES_TODAY_SQL = text("""
    SELECT COALESCE(SUM(CAST(probe->>'proxy_bytes' AS BIGINT)), 0)
      FROM course_extract_cache
     WHERE pointer_kind = :kind AND tier = :tier AND extractor_version = :v
       AND pointer_key LIKE :prefix
""")

_PURGE_USAGE_SQL = text("""
    DELETE FROM course_extract_cache
     WHERE pointer_kind = :kind AND tier = :tier
       AND created_at < now() - (CAST(:days AS integer) * interval '1 day')
    RETURNING pointer_key
""")


def _day(now: Optional[datetime] = None) -> str:
    return (now or _now()).strftime("%Y-%m-%d")


def today() -> str:
    """The UTC day the spend counters use."""
    return _day()


def seconds_to_utc_midnight() -> int:
    now = _now()
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((tomorrow - now).total_seconds()))


def record_supadata_usage(credits: int, video_id: str, outcome: Outcome) -> bool:
    """One usage row per Supadata call (206s and failures included)."""
    if credits <= 0:
        return False
    now = _now()
    probe = {"supadata_credits": int(credits), "video_id": video_id, "outcome": outcome.value,
             "fetched_at": now.isoformat()}
    try:
        with db_session() as db:
            row = db.execute(_USAGE_SQL, {
                "kind": USAGE_KIND, "key": f"supadata:{_day(now)}:{uuid.uuid4().hex}", "v": CACHE_VERSION,
                "tier": TIER, "probe": json.dumps(probe),
            }).first()
            db.commit()
        return row is not None
    except Exception:  # noqa: BLE001
        logger.warning("yt_captions: could not record Supadata usage for %s", video_id, exc_info=True)
        return False


def supadata_credits_today() -> Optional[int]:
    """Platform-wide Supadata credits spent today (UTC); None when unreadable
    (the caller then treats the cap as reached: spend fails closed)."""
    try:
        with db_session() as db:
            n = db.execute(_CREDITS_TODAY_SQL, {"kind": USAGE_KIND, "tier": TIER, "v": CACHE_VERSION,
                                                "prefix": f"supadata:{_day()}:%"}).scalar()
        return int(n or 0)
    except Exception:  # noqa: BLE001
        logger.warning("yt_captions: could not read today's Supadata usage", exc_info=True)
        return None


def record_proxy_usage(bytes_in: int, video_id: str, outcome: Outcome) -> bool:
    """One usage row per proxy run (every attempt for one video together)."""
    if bytes_in <= 0:
        return False
    now = _now()
    probe = {"proxy_bytes": int(bytes_in), "video_id": video_id, "outcome": outcome.value,
             "fetched_at": now.isoformat()}
    try:
        with db_session() as db:
            row = db.execute(_USAGE_SQL, {
                "kind": USAGE_KIND, "key": f"proxy:{_day(now)}:{uuid.uuid4().hex}", "v": CACHE_VERSION,
                "tier": TIER, "probe": json.dumps(probe),
            }).first()
            db.commit()
        return row is not None
    except Exception:  # noqa: BLE001
        logger.warning("yt_captions: could not record proxy usage for %s", video_id, exc_info=True)
        return False


def proxy_bytes_today() -> Optional[int]:
    """Platform-wide proxy bytes today (UTC); None when unreadable (the caller
    then treats the budget as spent: spend fails closed)."""
    try:
        with db_session() as db:
            n = db.execute(_PROXY_BYTES_TODAY_SQL, {"kind": USAGE_KIND, "tier": TIER, "v": CACHE_VERSION,
                                                    "prefix": f"proxy:{_day()}:%"}).scalar()
        return int(n or 0)
    except Exception:  # noqa: BLE001
        logger.warning("yt_captions: could not read today's proxy usage", exc_info=True)
        return None


def purge_usage(keep_days: int = USAGE_KEEP_DAYS) -> int:
    try:
        with db_session() as db:
            rows = db.execute(_PURGE_USAGE_SQL, {"kind": USAGE_KIND, "tier": TIER, "days": int(keep_days)}).fetchall()
            db.commit()
        return len(rows)
    except Exception:  # noqa: BLE001
        logger.warning("yt_captions: purging old usage rows failed", exc_info=True)
        return 0


__all__ = ["POINTER_KIND", "USAGE_KIND", "CACHE_VERSION", "NEGATIVE_TTL_DAYS", "cache_key", "read", "write",
           "cacheable", "record_supadata_usage", "supadata_credits_today", "record_proxy_usage",
           "proxy_bytes_today", "today", "seconds_to_utc_midnight", "purge_usage"]
