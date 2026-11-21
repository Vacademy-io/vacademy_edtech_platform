"""SQL for the two demo-guide tables (created by admin_core Flyway, SPEC 2.4).

``demo_guide_session`` and ``demo_guide_message`` only. Caps are counted from
these tables (no counter table), in single statements so a check and its
increment cannot be separated by another request of the same session.
Plain statements only: nothing session-scoped (the database sits behind
pgbouncer) and no reliance on rowcount.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

DAY_START_SQL = "date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'"

_SESSION_COLS = ("id, product, lang, visitor_id, ip_hash, origin, page_url, utm, qualification, tours, lead_id, "
                 "turns, speech_chars, listen_seconds, created_at, last_at")
_MSG_COLS = "id, session_id, role, kind, text, actions, created_at"


def _j(value: Any) -> Optional[str]:
    return None if value is None else json.dumps(value, ensure_ascii=False, default=str)


def _iso(v: Any) -> Any:
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat()
    return v


def _row(r: Any) -> Dict[str, Any]:
    return {k: _iso(v) for k, v in dict(r._mapping).items()}


# ── sessions ──────────────────────────────────────────────────────────────

def create_session(db: Session, *, product: str, lang: str, visitor_id: str, ip_hash: str, origin: Optional[str],
                   page_url: Optional[str], utm: Optional[Dict[str, Any]], ip_cap: int) -> Optional[str]:
    """A new session, or None when this network already opened `ip_cap` today.
    The count and the insert are one statement."""
    sid = str(uuid.uuid4())
    r = db.execute(text(f"""
        INSERT INTO demo_guide_session (id, product, lang, visitor_id, ip_hash, origin, page_url, utm)
        SELECT CAST(:id AS varchar), CAST(:product AS varchar), CAST(:lang AS varchar), CAST(:vid AS varchar),
               CAST(:iph AS varchar), CAST(:origin AS varchar), CAST(:page AS text), CAST(:utm AS jsonb)
         WHERE (SELECT count(*) FROM demo_guide_session
                 WHERE ip_hash = CAST(:iph AS varchar) AND created_at >= {DAY_START_SQL}) < :cap
        RETURNING id
    """), {"id": sid, "product": product, "lang": lang, "vid": visitor_id, "iph": ip_hash,
           "origin": (origin or None) and origin[:255], "page": (page_url or None) and page_url[:2000],
           "utm": _j(utm or None), "cap": int(ip_cap)}).first()
    return sid if r is not None else None


def get_session(db: Session, session_id: str) -> Optional[Dict[str, Any]]:
    r = db.execute(text(f"SELECT {_SESSION_COLS} FROM demo_guide_session WHERE id = :id"), {"id": session_id}).first()
    return _row(r) if r else None


def set_lang(db: Session, session_id: str, lang: str) -> None:
    db.execute(text("UPDATE demo_guide_session SET lang = :l, last_at = now() WHERE id = :id"),
               {"l": lang, "id": session_id})


def take_turn(db: Session, session_id: str, ip_hash: Optional[str], *, session_cap: int, ip_cap: int,
              daily_cap: int) -> Optional[int]:
    """Count one turn; the new turn number, or None when a cap is reached
    (this session, this network today, or all visitors today). Turns of a day
    are the turns of the sessions active that day."""
    r = db.execute(text(f"""
        UPDATE demo_guide_session s SET turns = s.turns + 1, last_at = now()
         WHERE s.id = :id AND s.turns < :scap
           AND (SELECT COALESCE(sum(x.turns), 0) FROM demo_guide_session x
                 WHERE x.ip_hash = :iph AND x.last_at >= {DAY_START_SQL}) < :icap
           AND (SELECT COALESCE(sum(y.turns), 0) FROM demo_guide_session y
                 WHERE y.last_at >= {DAY_START_SQL}) < :dcap
        RETURNING s.turns
    """), {"id": session_id, "iph": ip_hash or "", "scap": int(session_cap), "icap": int(ip_cap),
           "dcap": int(daily_cap)}).first()
    return int(r[0]) if r is not None else None


def give_turn_back(db: Session, session_id: str) -> None:
    """The model never ran for a counted turn: do not hold it against the visitor."""
    db.execute(text("UPDATE demo_guide_session SET turns = GREATEST(turns - 1, 0) WHERE id = :id"), {"id": session_id})


def add_tour(db: Session, session_id: str, tour_id: str) -> None:
    entry = [{"id": tour_id, "at": datetime.now(timezone.utc).isoformat(), "finished": None}]
    db.execute(text("""
        UPDATE demo_guide_session SET tours = COALESCE(tours, '[]'::jsonb) || CAST(:t AS jsonb), last_at = now()
         WHERE id = :id
    """), {"t": _j(entry), "id": session_id})


def finish_tour(db: Session, session_id: str, tour_id: str, finished: bool) -> None:
    """Mark the last play of `tour_id` as finished / stopped (appends one when the guide never recorded it)."""
    r = db.execute(text("SELECT tours FROM demo_guide_session WHERE id = :id"), {"id": session_id}).first()
    tours = list(r[0]) if r is not None and isinstance(r[0], list) else []
    for entry in reversed(tours):
        if isinstance(entry, dict) and entry.get("id") == tour_id and entry.get("finished") is None:
            entry["finished"] = bool(finished)
            break
    else:
        tours.append({"id": tour_id, "at": datetime.now(timezone.utc).isoformat(), "finished": bool(finished)})
    db.execute(text("UPDATE demo_guide_session SET tours = CAST(:t AS jsonb), last_at = now() WHERE id = :id"),
               {"t": _j(tours[-50:]), "id": session_id})


def merge_qualification(db: Session, session_id: str, fields: Dict[str, Any]) -> None:
    db.execute(text("""
        UPDATE demo_guide_session
           SET qualification = COALESCE(qualification, '{}'::jsonb) || CAST(:q AS jsonb), last_at = now()
         WHERE id = :id
    """), {"q": _j(fields), "id": session_id})


def add_speech_chars(db: Session, session_id: str, chars: int, cap: int) -> bool:
    """Reserve `chars` of speech for the session; False (nothing added) past the cap."""
    r = db.execute(text("""
        UPDATE demo_guide_session SET speech_chars = speech_chars + :n
         WHERE id = :id AND speech_chars + :n <= :cap
        RETURNING speech_chars
    """), {"n": int(chars), "id": session_id, "cap": int(cap)}).first()
    return r is not None


def add_listen_seconds(db: Session, session_id: str, seconds: int) -> None:
    db.execute(text("UPDATE demo_guide_session SET listen_seconds = listen_seconds + :n, last_at = now() "
                    "WHERE id = :id"), {"n": max(int(seconds), 0), "id": session_id})


def set_lead(db: Session, session_id: str, lead_id: str) -> None:
    db.execute(text("UPDATE demo_guide_session SET lead_id = :l, last_at = now() WHERE id = :id"),
               {"l": str(lead_id)[:64], "id": session_id})


def leads_from_ip_today(db: Session, ip_hash: str) -> int:
    return int(db.execute(text(f"""
        SELECT count(*) FROM demo_guide_session
         WHERE ip_hash = :h AND lead_id IS NOT NULL AND last_at >= {DAY_START_SQL}
    """), {"h": ip_hash}).scalar() or 0)


# ── messages ──────────────────────────────────────────────────────────────

def add_message(db: Session, session_id: str, role: str, kind: str, text_: str, *, actions: Any = None,
                message_id: Optional[str] = None) -> str:
    mid = message_id or str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO demo_guide_message (id, session_id, role, kind, text, actions, created_at)
        VALUES (:id, :sid, :role, :kind, :text, CAST(:actions AS jsonb), clock_timestamp())
    """), {"id": mid, "sid": session_id, "role": role, "kind": kind[:24], "text": text_ or "",
           "actions": _j(actions)})
    return mid


def update_message(db: Session, message_id: str, text_: str, actions: Any) -> None:
    db.execute(text("UPDATE demo_guide_message SET text = :text, actions = CAST(:actions AS jsonb) WHERE id = :id"),
               {"text": text_ or "", "actions": _j(actions), "id": message_id})


def get_message(db: Session, session_id: str, message_id: str) -> Optional[Dict[str, Any]]:
    r = db.execute(text(f"SELECT {_MSG_COLS} FROM demo_guide_message WHERE id = :id AND session_id = :sid"),
                   {"id": message_id, "sid": session_id}).first()
    return _row(r) if r else None


def history(db: Session, session_id: str, limit: int = 14) -> List[Dict[str, Any]]:
    """The last `limit` messages, oldest first."""
    rows = db.execute(text(f"""
        SELECT {_MSG_COLS} FROM demo_guide_message WHERE session_id = :sid
         ORDER BY created_at DESC, id DESC LIMIT :n
    """), {"sid": session_id, "n": int(limit)}).fetchall()
    return [_row(r) for r in reversed(rows)]


def transcript(db: Session, session_id: str, limit: int = 400) -> List[Dict[str, Any]]:
    rows = db.execute(text(f"""
        SELECT {_MSG_COLS} FROM demo_guide_message WHERE session_id = :sid ORDER BY created_at, id LIMIT :n
    """), {"sid": session_id, "n": int(limit)}).fetchall()
    return [_row(r) for r in rows]


def forms_shown(db: Session, session_id: str) -> int:
    return int(db.execute(text("""
        SELECT count(*) FROM demo_guide_message
         WHERE session_id = :sid AND role = 'assistant' AND actions ? 'form'
    """), {"sid": session_id}).scalar() or 0)


# ── staff views ───────────────────────────────────────────────────────────

def list_sessions(db: Session, products: Sequence[str], *, page: int, size: int,
                  lead: Optional[bool] = None) -> Dict[str, Any]:
    """Sessions of these products that had at least one turn, newest first."""
    products = [p for p in products if p]
    if not products:
        return {"items": [], "page": page, "size": size, "total": 0}
    clauses = ["product = ANY(:products)", "turns > 0"]
    if lead is True:
        clauses.append("lead_id IS NOT NULL")
    elif lead is False:
        clauses.append("lead_id IS NULL")
    where = " AND ".join(clauses)
    params: Dict[str, Any] = {"products": list(products)}
    total = int(db.execute(text(f"SELECT count(*) FROM demo_guide_session WHERE {where}"), params).scalar() or 0)
    params.update({"lim": int(size), "off": int(page) * int(size)})
    rows = db.execute(text(f"""
        SELECT id, product, lang, origin, page_url, utm, qualification, tours, turns, speech_chars, listen_seconds,
               lead_id IS NOT NULL AS lead, lead_id, created_at, last_at
          FROM demo_guide_session WHERE {where}
         ORDER BY created_at DESC LIMIT :lim OFFSET :off
    """), params).fetchall()
    return {"items": [_row(r) for r in rows], "page": page, "size": size, "total": total}
