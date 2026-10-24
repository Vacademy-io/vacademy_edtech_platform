"""Daily answer caps, kept in the database so every replica sees one count.

An answer RESERVES a slot on three counters before the model runs — the
visitor (``v:``), the visitor's network (``ip:``) and the site — each with a
conditional increment, all in one transaction: if any counter is at its cap
the transaction rolls back and nothing was taken. The slot is RELEASED only
when no model call was made or the model gave nothing (engine.py). Guarded
replies (distress, abuse) never reserve, so they never count.

New chats (POST /sessions) are counted per visitor network on the same
table under an ``s:`` key, so a script cannot fill the conversation table.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from .repository import TODAY_SQL

DAILY_CAP = "daily_cap"


@dataclass(frozen=True)
class Reservation:
    visitor_key: str
    ip_key: Optional[str]
    institute_id: str
    site_tag: str


def _bump_key(db: Session, key: str, cap: int) -> bool:
    if cap <= 0:
        return False
    r = db.execute(text(f"""
        INSERT INTO site_assistant_visitor_daily (key_hash, day, answers) VALUES (:k, {TODAY_SQL}, 1)
        ON CONFLICT (key_hash, day) DO UPDATE SET answers = site_assistant_visitor_daily.answers + 1
         WHERE site_assistant_visitor_daily.answers < :cap
        RETURNING answers
    """), {"k": key, "cap": int(cap)}).first()
    return r is not None


def _bump_site(db: Session, institute_id: str, site_tag: str, cap: int) -> bool:
    if cap <= 0:
        return False
    r = db.execute(text(f"""
        INSERT INTO site_assistant_usage_daily (institute_id, site_tag, day, answers) VALUES (:iid, :tag, {TODAY_SQL}, 1)
        ON CONFLICT (institute_id, site_tag, day) DO UPDATE SET answers = site_assistant_usage_daily.answers + 1
         WHERE site_assistant_usage_daily.answers < :cap
        RETURNING answers
    """), {"iid": institute_id, "tag": site_tag, "cap": int(cap)}).first()
    return r is not None


def reserve(db: Session, *, visitor_key: str, ip_key: Optional[str], institute_id: str, site_tag: str,
            visitor_cap: int, ip_cap: int, site_cap: int) -> Optional[Reservation]:
    """Take one answer slot on every counter, or none. Commits on success."""
    ok = _bump_key(db, visitor_key, visitor_cap)
    if ok and ip_key:
        ok = _bump_key(db, ip_key, ip_cap)
    if ok:
        ok = _bump_site(db, institute_id, site_tag, site_cap)
    if not ok:
        db.rollback()
        return None
    db.commit()
    return Reservation(visitor_key=visitor_key, ip_key=ip_key, institute_id=institute_id, site_tag=site_tag)


def take_session(db: Session, key: str, cap: int) -> bool:
    """Count one new chat for this network today; False (nothing counted) at the cap. Commits."""
    ok = _bump_key(db, key, cap)
    if ok:
        db.commit()
    else:
        db.rollback()
    return ok


def release(db: Session, r: Reservation) -> None:
    """Give a reserved slot back (no answer was produced). Commits."""
    keys = [k for k in (r.visitor_key, r.ip_key) if k]
    for k in keys:
        db.execute(text(f"""
            UPDATE site_assistant_visitor_daily SET answers = GREATEST(answers - 1, 0)
             WHERE key_hash = :k AND day = {TODAY_SQL}
        """), {"k": k})
    db.execute(text(f"""
        UPDATE site_assistant_usage_daily SET answers = GREATEST(answers - 1, 0)
         WHERE institute_id = :iid AND site_tag = :tag AND day = {TODAY_SQL}
    """), {"iid": r.institute_id, "tag": r.site_tag})
    db.commit()
