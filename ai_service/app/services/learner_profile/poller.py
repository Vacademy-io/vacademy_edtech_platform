"""Background poller: idle Student AI chats → learner_profile_signal rows.

Every tick (started from the app lifespan, safe on every replica):
  1. picks chats of allowlisted institutes idle for IDLE_MINUTES with learner
     messages past their cursor (learner_profile_cursor),
  2. claims each by upserting its cursor to RUNNING (one replica wins; a
     RUNNING row older than STALE_MINUTES is a dead worker's and is re-taken),
  3. reads the new messages, asks the model (extract.py), saves what survives
     validation, and moves the cursor past what it read.

Free to institutes: usage is recorded for the platform, never charged.
Switched by learner_profile.enabled + learner_profile.institutes.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import bindparam, text

from ...db import db_session
from . import extract

logger = logging.getLogger(__name__)

_TASK = None

USE_CASE = "learner_profile"
BATCH_SIZE = 4
IDLE_MINUTES = 20          # a chat is read once the learner has left it this long
LOOKBACK_DAYS = 3          # older chats are never picked up
STALE_MINUTES = 30         # a RUNNING cursor this old belongs to a dead worker
MAX_ATTEMPTS = 3           # consecutive failures before a chat is left alone
MAX_NEW_MESSAGES = 60      # read per pass; a longer chat continues next pass
EARLIER_MESSAGES = 4
KNOWN_SIGNALS = 25
IDLE_SLEEP_S = 120
BUSY_SLEEP_S = 5
ERROR_SLEEP_S = 120
READ_TYPES = tuple(extract.ROLE_LABELS)

_CANDIDATES_SQL = """
SELECT s.id AS session_id, s.institute_id, s.user_id
  FROM chat_sessions s
  LEFT JOIN learner_profile_cursor c ON c.session_id = s.id
 WHERE {institutes}
   AND s.last_active < (now() AT TIME ZONE 'UTC') - make_interval(mins => :idle)
   AND s.last_active > (now() AT TIME ZONE 'UTC') - make_interval(days => :lookback)
   AND (c.session_id IS NULL
        OR (c.status = 'IDLE' AND c.attempts < :max_attempts)
        OR (c.status = 'RUNNING' AND c.updated_at < now() - make_interval(mins => :stale)))
   AND EXISTS (SELECT 1 FROM chat_messages m
                WHERE m.session_id = s.id AND m.message_type = 'user'
                  AND m.id > COALESCE(c.last_message_id, 0))
 ORDER BY s.last_active
 LIMIT :batch
"""

# Upsert-to-RUNNING; RETURNING yields a row only when this replica won the claim
# (psycopg 3 reports rowcount -1 for INSERT ... ON CONFLICT, so never read it).
_CLAIM_SQL = text("""
INSERT INTO learner_profile_cursor (session_id, institute_id, user_id, status, updated_at)
VALUES (:session_id, :institute_id, :user_id, 'RUNNING', now())
ON CONFLICT (session_id) DO UPDATE SET status = 'RUNNING', updated_at = now()
 WHERE learner_profile_cursor.status = 'IDLE'
    OR learner_profile_cursor.updated_at < now() - make_interval(mins => :stale)
RETURNING last_message_id
""")

_NEW_SQL = text("""
SELECT id, message_type, content FROM chat_messages
 WHERE session_id = :session_id AND id > :after
 ORDER BY id LIMIT :limit
""")

_EARLIER_SQL = text("""
SELECT id, message_type, content FROM chat_messages
 WHERE session_id = :session_id AND id <= :after AND message_type IN :types
 ORDER BY id DESC LIMIT :limit
""").bindparams(bindparam("types", expanding=True))

_KNOWN_SQL = text("""
SELECT kind, topic, detail FROM learner_profile_signal
 WHERE institute_id = :institute_id AND user_id = :user_id AND status = 'ACTIVE'
 ORDER BY observed_at DESC LIMIT :limit
""")

_INSERT_SQL = text("""
INSERT INTO learner_profile_signal
    (institute_id, user_id, source, kind, topic, detail, confidence, stated,
     evidence_session_id, evidence_message_ids, evidence_quote, model, observed_at)
VALUES (:institute_id, :user_id, 'CHAT', :kind, :topic, :detail, :confidence, :stated,
        :session_id, CAST(:message_ids AS jsonb), :quote, :model, :observed_at)
""")

_DONE_SQL = text("""
UPDATE learner_profile_cursor
   SET status = 'IDLE', last_message_id = GREATEST(last_message_id, :last_id),
       attempts = 0, last_error = NULL, updated_at = now()
 WHERE session_id = :session_id
""")

_FAILED_SQL = text("""
UPDATE learner_profile_cursor
   SET status = 'IDLE', attempts = attempts + 1, last_error = :error, updated_at = now()
 WHERE session_id = :session_id
""")


def _allowlist():
    """Institutes whose chats are read: ALL_INSTITUTES, a set, or empty (off).
    A settings outage reads as off."""
    from ..course_knowledge.flags import parse_allowlist
    from ..platform_settings_service import get_platform_setting

    try:
        enabled = get_platform_setting("learner_profile.enabled", default=False)
        if not (enabled is True or str(enabled).strip().lower() in ("1", "true", "yes", "on")):
            return frozenset()
        return parse_allowlist(get_platform_setting("learner_profile.institutes", default="[]"))
    except Exception:  # noqa: BLE001
        return frozenset()


def _claim_batch() -> List[Dict[str, Any]]:
    from ..course_knowledge.flags import ALL_INSTITUTES

    allowed = _allowlist()
    if not allowed:
        return []
    params: Dict[str, Any] = {"idle": IDLE_MINUTES, "lookback": LOOKBACK_DAYS, "max_attempts": MAX_ATTEMPTS,
                              "stale": STALE_MINUTES, "batch": BATCH_SIZE}
    if allowed == ALL_INSTITUTES:
        stmt = text(_CANDIDATES_SQL.format(institutes="TRUE"))
    else:
        stmt = text(_CANDIDATES_SQL.format(institutes="s.institute_id IN :institutes")).bindparams(
            bindparam("institutes", expanding=True))
        params["institutes"] = sorted(allowed)
    claimed: List[Dict[str, Any]] = []
    with db_session() as db:
        for row in db.execute(stmt, params).mappings().all():
            won = db.execute(_CLAIM_SQL, {**row, "stale": STALE_MINUTES}).first()
            if won is not None:
                claimed.append({**row, "after": int(won[0] or 0)})
        db.commit()
    return claimed


def _load(job: Dict[str, Any]):
    with db_session() as db:
        new = [extract.Message(int(r.id), r.message_type, r.content or "") for r in db.execute(
            _NEW_SQL, {"session_id": job["session_id"], "after": job["after"], "limit": MAX_NEW_MESSAGES})]
        earlier = [extract.Message(int(r.id), r.message_type, r.content or "") for r in db.execute(
            _EARLIER_SQL, {"session_id": job["session_id"], "after": job["after"],
                           "types": list(READ_TYPES), "limit": EARLIER_MESSAGES})][::-1]
        known = [dict(r) for r in db.execute(
            _KNOWN_SQL, {"institute_id": job["institute_id"], "user_id": job["user_id"],
                         "limit": KNOWN_SIGNALS}).mappings()]
    return new, earlier, known


def _models() -> List[str]:
    from ...config import get_settings
    from ..model_selection import resolve_model_sync

    settings = get_settings()
    primary, fallbacks = resolve_model_sync(USE_CASE, hard_fallback=settings.llm_default_model)
    return [primary, *fallbacks]


def _record_usage(job: Dict[str, Any], model: str, usage: Dict[str, Any]) -> None:
    try:
        from ...models.ai_token_usage import ApiProvider, RequestType
        from ..ai_billing import UC, metering_kwargs, metering_system, supported_kwargs
        from ..call_intelligence_service import _llm_cost_usd
        from ..token_usage_service import TokenUsageService

        meter = metering_kwargs(UC.LEARNER_ASSISTANT, metering_system(surface="INTERNAL"),
                                {"session_id": job["session_id"], "leg": USE_CASE})
        with db_session() as db:
            tus = TokenUsageService(db)
            tus.record_usage(
                api_provider=ApiProvider.OPENAI,
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
                total_tokens=int(usage.get("total_tokens") or 0),
                request_type=RequestType.ANALYTICS, institute_id=job["institute_id"], user_id=job["user_id"],
                model=model, request_id=job["session_id"], total_price=_llm_cost_usd(model, usage),
                metadata={"leg": USE_CASE, "session_id": job["session_id"]},
                **supported_kwargs(tus.record_usage, {**meter, "free_reason": "POLICY_FREE"}))
    except Exception:  # noqa: BLE001 - accounting must never fail the extraction
        logger.warning("learner-profile: could not record usage for %s", job["session_id"], exc_info=True)


def _save(job: Dict[str, Any], signals: List[extract.Signal], model: Optional[str], last_id: int) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with db_session() as db:
        for s in signals:
            db.execute(_INSERT_SQL, {
                "institute_id": job["institute_id"], "user_id": job["user_id"], "kind": s.kind,
                "topic": s.topic, "detail": s.detail, "confidence": s.confidence, "stated": s.stated,
                "session_id": job["session_id"], "message_ids": json.dumps(s.message_ids),
                "quote": s.evidence_quote, "model": model, "observed_at": now,
            })
        db.execute(_DONE_SQL, {"session_id": job["session_id"], "last_id": last_id})
        db.commit()


async def process_one(job: Dict[str, Any]) -> int:
    """Read one claimed chat; returns how many signals were saved."""
    from .. import llm_json

    try:
        new, earlier, known = await asyncio.to_thread(_load, job)
        last_id = max((m.id for m in new), default=job["after"])
        readable = [m for m in new if m.role in READ_TYPES and (m.content or "").strip()]
        if extract.learner_chars(readable) < extract.MIN_LEARNER_CHARS:
            await asyncio.to_thread(_save, job, [], None, last_id)
            return 0
        prompt = extract.build_prompt(readable, earlier, known)
        models = await asyncio.to_thread(_models)
        raw, model, usage = await llm_json.generate_json(prompt, models, label="learner_profile")
        await asyncio.to_thread(_record_usage, job, model, dict(usage or {}))
        signals = extract.parse_signals(raw, readable)
        await asyncio.to_thread(_save, job, signals, model, last_id)
        logger.info("learner-profile: session %s → %d signal(s) (%s)", job["session_id"], len(signals), model)
        return len(signals)
    except Exception as exc:  # noqa: BLE001
        logger.warning("learner-profile: session %s failed: %s", job["session_id"], exc)
        try:
            await asyncio.to_thread(_fail, job["session_id"], str(exc)[:500])
        except Exception:  # noqa: BLE001
            logger.exception("learner-profile: could not release session %s", job["session_id"])
        return 0


def _fail(session_id: str, error: str) -> None:
    with db_session() as db:
        db.execute(_FAILED_SQL, {"session_id": session_id, "error": error})
        db.commit()


async def _drain_once() -> int:
    claimed = await asyncio.to_thread(_claim_batch)
    if claimed:
        await asyncio.gather(*(process_one(j) for j in claimed))
    return len(claimed)


async def _loop() -> None:
    logger.info("learner-profile poller started")
    while True:
        try:
            n = await _drain_once()
            await asyncio.sleep(BUSY_SLEEP_S if n >= BATCH_SIZE else IDLE_SLEEP_S)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("learner-profile poller: tick failed")
            await asyncio.sleep(ERROR_SLEEP_S)


def start_learner_profile_poller() -> None:
    """Start the poller task (idempotent). It idles while learner_profile.enabled is off."""
    global _TASK
    if _TASK is not None and not _TASK.done():
        return
    _TASK = asyncio.create_task(_loop(), name="learner-profile-poller")
