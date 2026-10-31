"""Public 3-minute taste of the tutor for unauthenticated visitors (tutezy.ai).

A visitor gives a name and picks one of a few pre-compiled topics; we open a
real tutor session on the demo batch under a guest identity, mint a
short-lived guest JWT (same secret the socket verifies), cap the lesson at a
few minutes and do not bill it. Abuse controls: one session per IP per day
(hashed), a global daily cap, and a kill switch — all platform settings.
"""
from __future__ import annotations

import base64
from datetime import datetime
import hashlib
import ipaddress
import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional, Union

from fastapi import Request
from jose import jwt
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...config import get_settings
from ..platform_settings_service import get_platform_setting

logger = logging.getLogger(__name__)

GUEST_TOKEN_TTL_SECONDS = 20 * 60
DEFAULT_TOPICS = json.dumps([])

_ENSURE = [
    """
    CREATE TABLE IF NOT EXISTS tutor_demo_grant (
        id                VARCHAR(36) PRIMARY KEY,
        ip_hash           VARCHAR(64) NOT NULL,
        visitor_name      VARCHAR(80),
        topic_key         VARCHAR(64),
        tutor_session_id  VARCHAR(36),
        user_agent        VARCHAR(255),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_tutor_demo_grant_ip ON tutor_demo_grant(ip_hash, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_tutor_demo_grant_day ON tutor_demo_grant(created_at)",
]


_ENSURE += [
    """
    CREATE TABLE IF NOT EXISTS tutor_demo_topic (
        key          VARCHAR(64) PRIMARY KEY,
        title        VARCHAR(160) NOT NULL,
        emoji        VARCHAR(16),
        language     VARCHAR(8) NOT NULL DEFAULT 'en',
        sort_order   INTEGER NOT NULL DEFAULT 100,
        source_text  TEXT NOT NULL,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "ALTER TABLE tutor_demo_topic ADD COLUMN IF NOT EXISTS style VARCHAR(16) NOT NULL DEFAULT 'lesson'",
]

STYLES = ("lesson", "interview", "practice")

DEMO_SLIDE_PREFIX = "demo:"


def is_demo_slide(slide_id: Optional[str]) -> bool:
    return bool(slide_id) and str(slide_id).startswith(DEMO_SLIDE_PREFIX)


def slide_id_for(key: str) -> str:
    return f"{DEMO_SLIDE_PREFIX}{key}"


def ensure_tutor_demo_schema(db: Session) -> None:
    try:
        for stmt in _ENSURE:
            db.execute(text(stmt))
        db.commit()
        logger.info("tutor_demo_grant schema ensured.")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("ensure_tutor_demo_schema failed: %s", exc)


# ── configuration (platform settings, editable in the health portal) ────────

def config(db: Optional[Session] = None) -> Dict[str, Any]:
    def g(key: str, default: Any) -> Any:
        try:
            v = get_platform_setting(key, default=default, db=db)
            return default if v in (None, "") else v
        except Exception:  # noqa: BLE001
            return default
    try:
        topics = json.loads(str(g("tutor.demo.topics", DEFAULT_TOPICS)) or "[]")
    except Exception:  # noqa: BLE001
        topics = []
    topics = [t for t in topics if isinstance(t, dict) and t.get("key") and t.get("slide_id")]
    return {
        "enabled": str(g("tutor.demo.enabled", "false")).lower() in ("1", "true", "yes", "on"),
        "institute_id": str(g("tutor.demo.institute_id", "")),
        "package_session_id": str(g("tutor.demo.package_session_id", "")),
        "topics": topics,
        "minutes": max(1, min(10, int(float(g("tutor.demo.minutes", 3))))),
        "per_ip_per_day": max(0, int(float(g("tutor.demo.per_ip_per_day", 1)))),
        "daily_cap": max(0, int(float(g("tutor.demo.daily_cap", 200)))),
        "teacher_name": str(g("tutor.demo.teacher_name", "")),
    }


# ── demo topics (own table; compiled into teaching_plan under slide id "demo:<key>") ──

_TOPIC_COLS = ("key", "title", "emoji", "language", "sort_order", "source_text", "is_active", "updated_at", "style")


def list_topics(db: Session, *, active_only: bool = False, with_source: bool = False) -> List[Dict[str, Any]]:
    """Every demo topic with the state of its compiled plan."""
    from . import plan_store  # noqa: WPS433
    rows = db.execute(text("SELECT " + ", ".join(_TOPIC_COLS) + " FROM tutor_demo_topic"
                           + (" WHERE is_active" if active_only else "") + " ORDER BY sort_order, title")).fetchall()
    out = []
    for r in rows:
        d = dict(zip(_TOPIC_COLS, r))
        if isinstance(d.get("updated_at"), datetime):
            d["updated_at"] = d["updated_at"].isoformat()
        plan = plan_store.latest_plan(db, slide_id_for(d["key"]))
        d["plan_status"] = plan.status if plan else None
        d["plan_error"] = getattr(plan, "error", None) if plan else None
        d["ready"] = bool(plan and plan.status == "READY")
        d["source_chars"] = len(d.get("source_text") or "")
        if not with_source:
            d.pop("source_text", None)
        out.append(d)
    return out


def upsert_topic(db: Session, *, key: str, title: str, source_text: str, emoji: Optional[str] = None,
                 language: str = "en", sort_order: int = 100, is_active: bool = True, style: str = "lesson") -> None:
    db.execute(text("""
        INSERT INTO tutor_demo_topic (key, title, emoji, language, sort_order, source_text, is_active, style, updated_at)
        VALUES (:k, :t, :e, :l, :o, :s, :a, :st, now())
        ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, emoji = EXCLUDED.emoji, language = EXCLUDED.language,
            sort_order = EXCLUDED.sort_order, source_text = EXCLUDED.source_text, is_active = EXCLUDED.is_active,
            style = EXCLUDED.style, updated_at = now()
    """), {"k": key[:64], "t": title[:160], "e": emoji, "l": language if language in ("en", "hi") else "en",
           "o": int(sort_order), "s": source_text, "a": bool(is_active), "st": style if style in STYLES else "lesson"})
    db.commit()


def delete_topic(db: Session, key: str) -> bool:
    n = db.execute(text("DELETE FROM tutor_demo_topic WHERE key = :k"), {"k": key}).rowcount
    db.commit()
    return bool(n)


def load_demo_source(db: Session, slide_id: str):
    """A SlideSource built from the topic's authored text, so the ordinary
    compiler can produce a plan for it."""
    from .slide_source import SlideSource, _hash
    key = slide_id[len(DEMO_SLIDE_PREFIX):]
    r = db.execute(text("SELECT title, source_text, language, style FROM tutor_demo_topic WHERE key = :k"), {"k": key}).first()
    if not r:
        return None
    style = r[3] if r[3] in STYLES else "lesson"
    return SlideSource(slide_id=slide_id, title=r[0], source_type="DEMO", source_id=key, kind="document",
                       text=r[1] or "", course_name="Tutezy demo", chapter_name="Try a lesson", style=style,
                       content_hash=_hash("demo", r[0], r[1] or "", r[2], style))


def demo_title(db: Session, slide_id: str) -> Optional[str]:
    r = db.execute(text("SELECT title FROM tutor_demo_topic WHERE key = :k"), {"k": slide_id[len(DEMO_SLIDE_PREFIX):]}).first()
    return r[0] if r else None


# Topics at or above this sort_order are "unlisted": startable by a direct link
# (?topic=<key>) but absent from the public picker. Used for lessons compiled
# from a prospect's own material, which must not become a public sample.
UNLISTED_SORT_ORDER = 1000


def startable_topics(db: Session) -> List[Dict[str, Any]]:
    """Every active, compiled topic — listed or unlisted — in picker shape."""
    return [{"key": t["key"], "title": t["title"], "emoji": t.get("emoji") or "", "language": t.get("language") or "en",
             "unlisted": int(t.get("sort_order") or 0) >= UNLISTED_SORT_ORDER}
            for t in list_topics(db, active_only=True) if t["ready"]]


def public_topics(db: Optional[Session] = None) -> Dict[str, Any]:
    c = config(db)
    topics: List[Dict[str, Any]] = []
    if db is not None:
        try:
            topics = [{k: v for k, v in t.items() if k != "unlisted"} for t in startable_topics(db) if not t["unlisted"]]
        except Exception:  # noqa: BLE001
            logger.warning("demo topics unreadable", exc_info=True)
    ready = bool(c["enabled"] and c["institute_id"] and topics)
    return {"enabled": ready, "minutes": c["minutes"], "topics": topics}


# ── abuse controls ───────────────────────────────────────────────────────────

def _parsed_ip(raw: Optional[str]) -> Optional[Union[ipaddress.IPv4Address, ipaddress.IPv6Address]]:
    try:
        return ipaddress.ip_address((raw or "").strip())
    except ValueError:
        return None


def client_ip(request: Request) -> str:
    """The visitor's address, as the edge saw it.

    Production traffic arrives through Cloudflare, and our ingress does not
    rewrite forwarded headers, so the FIRST X-Forwarded-For hop can be a
    Cloudflare edge address shared by thousands of visitors (one visitor's
    cap would then throttle everyone behind that edge). Cloudflare's own
    ``CF-Connecting-IP`` is the client, so it wins when it holds an IP; then
    the first X-Forwarded-For hop; then the socket peer. IPv6 is bucketed by
    /64 so one household is one visitor.
    """
    parsed = _parsed_ip(request.headers.get("cf-connecting-ip"))
    if parsed is None:
        fwd = request.headers.get("x-forwarded-for") or ""
        parsed = _parsed_ip(fwd.split(",")[0]) if fwd else None
    if parsed is None:
        peer = request.client.host if request.client else ""
        parsed = _parsed_ip(peer)
        if parsed is None:
            return peer or "0.0.0.0"
    if isinstance(parsed, ipaddress.IPv6Address):
        return str(ipaddress.ip_network(f"{parsed}/64", strict=False).network_address)
    return str(parsed)


def ip_hash(ip: str) -> str:
    salt = (get_settings().jwt_secret_key or "tutezy")[:16]
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()


def grant_allowed(db: Session, *, iph: str, per_ip_per_day: int, daily_cap: int) -> Optional[str]:
    """None when allowed; otherwise the visitor-facing reason."""
    if daily_cap:
        n = db.execute(text("SELECT count(*) FROM tutor_demo_grant WHERE created_at > now() - interval '1 day'")).scalar() or 0
        if int(n) >= daily_cap:
            return "The free lessons for today are all taken. Book a demo and we will run one for you."
    if per_ip_per_day:
        n = db.execute(text("SELECT count(*) FROM tutor_demo_grant WHERE ip_hash = :h AND created_at > now() - interval '1 day'"),
                       {"h": iph}).scalar() or 0
        if int(n) >= per_ip_per_day:
            return "You have already had your free lesson today. Book a demo to see the whole thing."
    return None


def record_grant(db: Session, *, iph: str, name: str, topic_key: str, tutor_session_id: str, user_agent: str) -> None:
    db.execute(text("""
        INSERT INTO tutor_demo_grant (id, ip_hash, visitor_name, topic_key, tutor_session_id, user_agent)
        VALUES (:id, :h, :n, :t, :s, :ua)
    """), {"id": str(uuid.uuid4()), "h": iph, "n": name[:80], "t": topic_key[:64], "s": tutor_session_id, "ua": user_agent[:255]})
    db.commit()


# ── guest identity ───────────────────────────────────────────────────────────

def guest_user_id() -> str:
    return f"demo-{uuid.uuid4()}"


def mint_guest_token(*, user_id: str, tutor_session_id: str, institute_id: str) -> str:
    """Signed like a platform access token (the socket verifies with the same
    secret) but carrying only what the tutor socket checks: `user`."""
    settings = get_settings()
    secret = settings.jwt_secret_key
    if len(secret) % 4:
        secret += "=" * (4 - len(secret) % 4)
    now = int(time.time())
    claims = {"user": user_id, "sub": user_id, "demo": tutor_session_id, "institute_id": institute_id,
              "authorities": {}, "iat": now, "exp": now + GUEST_TOKEN_TTL_SECONDS}
    return jwt.encode(claims, base64.b64decode(secret), algorithm=settings.jwt_algorithm)


def sanitize_name(name: str) -> str:
    import unicodedata
    # Letters, digits and combining marks (Devanagari vowel signs are marks, not alnum).
    cleaned = "".join(ch for ch in (name or "")
                      if ch.isalnum() or ch in " .'-" or unicodedata.category(ch).startswith("M")).strip()
    return (cleaned[:40] or "Friend").split(" ")[0].capitalize()


def topic_by_key(topics: List[Dict[str, Any]], key: str) -> Optional[Dict[str, Any]]:
    for t in topics:
        if t.get("key") == key:
            return t
    return None
