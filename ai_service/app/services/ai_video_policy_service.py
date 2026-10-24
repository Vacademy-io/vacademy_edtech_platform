"""Per-institute AI video policy (LMS AI Video): read, write, usage, checks.

Storage: ``institutes.setting_json`` → ``setting[AI_VIDEO_POLICY]`` in the same
SettingDto envelope admin_core writes (``{"key", "name", "data"}``), read through
``institute_setting_reader.load_institute_setting_data`` and written the way
``InstituteSettingsService.update_video_branding`` writes VIDEO_BRANDING (whole
``setting_json`` read-modify-write), under a row lock so a concurrent settings
save cannot drop the key.

Usage (all UTC):
- month_credits_used: this calendar month's USAGE_DEDUCTION credits on the video
  request types whose batch is an AI video (batch_id = ai_gen_video.video_id —
  image / TTS / stock charges of other features share those request types but
  not that batch), minus the REFUND rows for those same batches (a video's
  charges and its refund share batch_id = video_id).
- running_now: ai_gen_video rows of the institute in PENDING / IN_PROGRESS that
  moved within the last RUNNING_WINDOW_HOURS, plus rows between stages
  (COMPLETED at an early stage) that moved within BETWEEN_STAGES_WINDOW_MINUTES.
- videos_this_month: ai_gen_video rows of the institute created this month.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..constants.ai_video_policy import (
    AI_VIDEO_POLICY_KEY,
    AI_VIDEO_POLICY_NAME,
    AI_VIDEO_QUALITIES,
    BETWEEN_STAGES,
    BETWEEN_STAGES_WINDOW_MINUTES,
    CODE_DISABLED,
    CODE_MONTHLY_CAP,
    CODE_TEACHER_NOT_ALLOWED,
    CODE_TIER_NOT_ALLOWED,
    CODE_TOO_LONG,
    CODE_TOO_MANY_RUNNING,
    DEFAULT_AI_VIDEO_POLICY,
    DURATION_MAX_MINUTES,
    MAX_CONCURRENT_RANGE,
    MAX_MINUTES_RANGE,
    POLICY_AUDIT_FIELDS,
    POLICY_FIELDS,
    RUNNING_STATUSES,
    RUNNING_WINDOW_HOURS,
    VIDEO_REQUEST_TYPES,
)
from .institute_setting_reader import load_institute_setting_data

logger = logging.getLogger(__name__)

QUALITY_LABELS = {"standard": "Standard", "premium": "Premium", "ultra": "Best"}


class InstituteNotFound(LookupError):
    pass


# ── normalising ──────────────────────────────────────────────────────────────

def _int_in(value: Any, lo: int, hi: int, default: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return n if lo <= n <= hi else default


def normalize_policy(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Defaults overlaid with whatever valid values `raw` carries. Invalid stored
    values fall back to the default for that field (never raise on read)."""
    out = dict(DEFAULT_AI_VIDEO_POLICY)
    out["allowed_qualities"] = list(DEFAULT_AI_VIDEO_POLICY["allowed_qualities"])
    if not isinstance(raw, dict):
        return out
    if isinstance(raw.get("enabled"), bool):
        out["enabled"] = raw["enabled"]
    if isinstance(raw.get("teacher_allowed"), bool):
        out["teacher_allowed"] = raw["teacher_allowed"]
    q = raw.get("allowed_qualities")
    if isinstance(q, list):
        wanted = {str(x).strip().lower() for x in q}
        out["allowed_qualities"] = [x for x in AI_VIDEO_QUALITIES if x in wanted]
    out["max_minutes_per_video"] = _int_in(
        raw.get("max_minutes_per_video"), *MAX_MINUTES_RANGE, DEFAULT_AI_VIDEO_POLICY["max_minutes_per_video"])
    out["max_concurrent"] = _int_in(
        raw.get("max_concurrent"), *MAX_CONCURRENT_RANGE, DEFAULT_AI_VIDEO_POLICY["max_concurrent"])
    if "monthly_credit_cap" in raw:
        cap = raw.get("monthly_credit_cap")
        if cap is None:
            out["monthly_credit_cap"] = None
        else:
            try:
                cap_f = float(cap)
                out["monthly_credit_cap"] = cap_f if cap_f >= 0 else None
            except (TypeError, ValueError):
                out["monthly_credit_cap"] = None
    for k in POLICY_AUDIT_FIELDS:
        if raw.get(k) is not None:
            out[k] = raw[k]
    return out


def public_policy(policy: Dict[str, Any]) -> Dict[str, Any]:
    """The six policy fields only (what the LMS dialog sees — no audit notes)."""
    return {k: policy.get(k, DEFAULT_AI_VIDEO_POLICY[k]) for k in POLICY_FIELDS}


# ── read / write ─────────────────────────────────────────────────────────────

def load_policy(db: Session, institute_id: str) -> Tuple[Dict[str, Any], bool]:
    """(policy, is_default). A missing key — or an unreadable blob — is the
    platform defaults."""
    data = load_institute_setting_data(db, institute_id, AI_VIDEO_POLICY_KEY)
    if not isinstance(data, dict) or not data:
        return normalize_policy(None), True
    return normalize_policy(data), False


def _lock_settings(db: Session, institute_id: str) -> Dict[str, Any]:
    row = db.execute(
        text("SELECT setting_json FROM institutes WHERE id = :id FOR UPDATE"),
        {"id": institute_id},
    ).first()
    if not row:
        raise InstituteNotFound(institute_id)
    raw = row[0]
    if not raw:
        return {}
    try:
        blob = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError):
        # Never overwrite a blob we cannot parse: every other setting lives in it.
        raise ValueError("institutes.setting_json is not valid JSON; refusing to overwrite it")
    return dict(blob) if isinstance(blob, dict) else {}


def _write_settings(db: Session, institute_id: str, blob: Dict[str, Any]) -> None:
    db.execute(
        text("UPDATE institutes SET setting_json = :s WHERE id = :id"),
        {"s": json.dumps(blob), "id": institute_id},
    )
    db.commit()


def save_policy(db: Session, institute_id: str, policy_data: Dict[str, Any]) -> Dict[str, Any]:
    """Store `policy_data` (six fields + audit fields) as the institute's policy."""
    try:
        blob = _lock_settings(db, institute_id)
        container = blob.get("setting")
        if not isinstance(container, dict):
            container = {}
        container[AI_VIDEO_POLICY_KEY] = {
            "key": AI_VIDEO_POLICY_KEY,
            "name": AI_VIDEO_POLICY_NAME,
            "data": policy_data,
        }
        blob["setting"] = container
        _write_settings(db, institute_id, blob)
    except Exception:
        db.rollback()
        raise
    return normalize_policy(policy_data)


def delete_policy(db: Session, institute_id: str) -> bool:
    """Drop the key (back to platform defaults). True if a policy was removed."""
    try:
        blob = _lock_settings(db, institute_id)
        container = blob.get("setting")
        removed = False
        if isinstance(container, dict) and AI_VIDEO_POLICY_KEY in container:
            container.pop(AI_VIDEO_POLICY_KEY, None)
            removed = True
        if AI_VIDEO_POLICY_KEY in blob:  # legacy top-level shape
            blob.pop(AI_VIDEO_POLICY_KEY, None)
            removed = True
        if removed:
            _write_settings(db, institute_id, blob)
        else:
            db.rollback()
        return removed
    except Exception:
        db.rollback()
        raise


def merge_policy_update(current: Dict[str, Any], changes: Dict[str, Any]) -> Dict[str, Any]:
    """Policy fields of `current` with `changes` applied (only keys present in
    `changes`). Validation is the caller's (the request schema)."""
    merged = public_policy(current)
    for k in POLICY_FIELDS:
        if k in changes:
            merged[k] = changes[k]
    q = merged.get("allowed_qualities") or []
    wanted = {str(x).strip().lower() for x in q}
    merged["allowed_qualities"] = [x for x in AI_VIDEO_QUALITIES if x in wanted]
    return merged


# ── usage ────────────────────────────────────────────────────────────────────

def month_start_utc(now: Optional[datetime] = None) -> datetime:
    """First instant of the current UTC calendar month (aware)."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


_MONTH_CREDITS_SQL = text("""
    WITH ded AS (
        SELECT ct.amount, ct.batch_id
        FROM credit_transactions ct
        WHERE ct.institute_id = :inst
          AND ct.transaction_type = 'USAGE_DEDUCTION'
          AND ct.request_type = ANY(:types)
          AND ct.created_at >= :since
          AND ct.batch_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM ai_gen_video v WHERE v.video_id = ct.batch_id)
    )
    SELECT
        COALESCE((SELECT SUM(ABS(amount)) FROM ded), 0) AS used,
        COALESCE((
            SELECT SUM(ABS(r.amount))
            FROM credit_transactions r
            WHERE r.institute_id = :inst
              AND r.transaction_type = 'REFUND'
              AND r.created_at >= :since
              AND r.batch_id IS NOT NULL
              AND r.batch_id IN (SELECT DISTINCT batch_id FROM ded WHERE batch_id IS NOT NULL)
        ), 0) AS refunded
""")

_RUNNING_SQL = text("""
    SELECT COUNT(*)
    FROM ai_gen_video
    WHERE metadata->>'institute_id' = :inst
      AND (
            (status = ANY(:statuses) AND updated_at >= :since)
         OR (status = 'COMPLETED' AND current_stage = ANY(:between) AND updated_at >= :since_between)
      )
""")

_VIDEOS_MONTH_SQL = text("""
    SELECT COUNT(*)
    FROM ai_gen_video
    WHERE metadata->>'institute_id' = :inst
      AND created_at >= :since
""")


def month_credits_used(db: Session, institute_id: str, *, now: Optional[datetime] = None) -> float:
    # credit_transactions.created_at is a NAIVE UTC timestamp (utcnow()).
    since = month_start_utc(now).replace(tzinfo=None)
    row = db.execute(_MONTH_CREDITS_SQL, {
        "inst": institute_id, "types": list(VIDEO_REQUEST_TYPES), "since": since,
    }).first()
    if not row:
        return 0.0
    used = float(row[0] or 0)
    refunded = float(row[1] or 0)
    return round(max(0.0, used - refunded), 4)


def running_now(db: Session, institute_id: str, *, now: Optional[datetime] = None) -> int:
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(hours=RUNNING_WINDOW_HOURS)
    return int(db.execute(_RUNNING_SQL, {
        "inst": institute_id, "statuses": list(RUNNING_STATUSES), "since": since,
        "between": list(BETWEEN_STAGES),
        "since_between": now - timedelta(minutes=BETWEEN_STAGES_WINDOW_MINUTES),
    }).scalar() or 0)


def videos_this_month(db: Session, institute_id: str, *, now: Optional[datetime] = None) -> int:
    return int(db.execute(_VIDEOS_MONTH_SQL, {
        "inst": institute_id, "since": month_start_utc(now),
    }).scalar() or 0)


def usage(db: Session, institute_id: str) -> Dict[str, Any]:
    return {
        "month_credits_used": month_credits_used(db, institute_id),
        "running_now": running_now(db, institute_id),
        "videos_this_month": videos_this_month(db, institute_id),
    }


# ── checks ───────────────────────────────────────────────────────────────────

def static_block(
    policy: Dict[str, Any],
    *,
    quality: str,
    teacher_requested: bool,
    duration: str,
) -> Optional[Tuple[str, str]]:
    """(code, detail) for the checks that need no DB, in the contract's order:
    enabled, quality, teacher, length."""
    if not policy.get("enabled", True):
        return CODE_DISABLED, "AI video generation is turned off for this institute. Contact Vacademy support to enable it."
    allowed = policy.get("allowed_qualities") or []
    if quality not in allowed:
        names = ", ".join(QUALITY_LABELS.get(q, q) for q in allowed) or "none"
        return (CODE_TIER_NOT_ALLOWED,
                f"{QUALITY_LABELS.get(quality, quality)} quality is not available for this institute "
                f"(allowed: {names}).")
    if teacher_requested and not policy.get("teacher_allowed", True):
        return (CODE_TEACHER_NOT_ALLOWED,
                "On-screen AI teachers are not available for this institute. Pick a format without a teacher.")
    minutes = DURATION_MAX_MINUTES.get(duration)
    limit = int(policy.get("max_minutes_per_video") or DEFAULT_AI_VIDEO_POLICY["max_minutes_per_video"])
    if minutes is not None and minutes > limit:
        return (CODE_TOO_LONG,
                f"Videos are limited to {limit} minute{'s' if limit != 1 else ''} for this institute; "
                f"pick a shorter length than {duration}.")
    return None


def usage_block(
    policy: Dict[str, Any],
    *,
    expected_credits: float,
    month_used: float,
    running: int,
) -> Optional[Tuple[str, str]]:
    """(code, detail) for the monthly cap and the concurrency limit."""
    cap = policy.get("monthly_credit_cap")
    if cap is not None:
        cap_f = float(cap)
        if month_used + float(expected_credits or 0) > cap_f:
            left = max(0.0, cap_f - month_used)
            return (CODE_MONTHLY_CAP,
                    f"This video (~{expected_credits:.0f} credits) would pass the institute's monthly AI video "
                    f"limit of {cap_f:.0f} credits ({month_used:.0f} used, {left:.0f} left this month).")
    max_running = int(policy.get("max_concurrent") or DEFAULT_AI_VIDEO_POLICY["max_concurrent"])
    if running >= max_running:
        return (CODE_TOO_MANY_RUNNING,
                f"{running} AI video{'s are' if running != 1 else ' is'} already being generated for this "
                f"institute (limit {max_running}). Wait for one to finish, then try again.")
    return None


__all__ = [
    "InstituteNotFound", "normalize_policy", "public_policy", "load_policy", "save_policy",
    "delete_policy", "merge_policy_update", "month_start_utc", "month_credits_used", "running_now",
    "videos_this_month", "usage", "static_block", "usage_block",
]
