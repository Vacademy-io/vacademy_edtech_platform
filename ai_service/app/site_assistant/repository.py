"""SQL for the Site Assistant tables (created by admin_core Flyway, SPEC §2).

Every read and write is scoped by the institute (and site where the table has
one) that the CALLER resolved from a verified session or staff token — no
function here accepts an id it then trusts without that scope.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

TODAY_SQL = "(now() AT TIME ZONE 'UTC')::date"


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


def advisory_lock(db: Session, key: str) -> None:
    """Transaction-scoped lock shared by every replica (released on commit/rollback)."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": key})


# ── conversations ─────────────────────────────────────────────────────────

_CONV_COLS = ("id, institute_id, site_tag, channel, visitor_id, user_id, ip_hash, origin_host, started_page, utm, "
              "locale, status, message_count, answers_billed, lead_status, lead_ref, created_at, last_active_at")


def create_conversation(db: Session, *, institute_id: str, site_tag: str, channel: str, visitor_id: str,
                        user_id: Optional[str], ip_hash: Optional[str], origin_host: Optional[str],
                        started_page: Optional[str], utm: Optional[Dict[str, Any]], locale: Optional[str]) -> str:
    cid = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO site_assistant_conversation
            (id, institute_id, site_tag, channel, visitor_id, user_id, ip_hash, origin_host, started_page, utm, locale)
        VALUES (:id, :iid, :tag, :ch, :vid, :uid, :iph, :host, :page, CAST(:utm AS jsonb), :loc)
    """), {"id": cid, "iid": institute_id, "tag": site_tag, "ch": channel, "vid": visitor_id, "uid": user_id,
           "iph": ip_hash, "host": (origin_host or None) and origin_host[:253], "page": started_page,
           "utm": _j(utm or None), "loc": (locale or None) and locale[:16]})
    return cid


def get_conversation(db: Session, conversation_id: str) -> Optional[Dict[str, Any]]:
    r = db.execute(text(f"SELECT {_CONV_COLS} FROM site_assistant_conversation WHERE id = :id"),
                   {"id": conversation_id}).first()
    return _row(r) if r else None


def find_resumable(db: Session, *, conversation_id: str, institute_id: str, site_tag: str, visitor_id: str,
                   channel: str, ttl_seconds: int) -> Optional[Dict[str, Any]]:
    r = db.execute(text(f"""
        SELECT {_CONV_COLS} FROM site_assistant_conversation
         WHERE id = :id AND institute_id = :iid AND site_tag = :tag AND visitor_id = :vid AND channel = :ch
           AND status = 'ACTIVE' AND last_active_at > now() - make_interval(secs => :ttl)
    """), {"id": conversation_id, "iid": institute_id, "tag": site_tag, "vid": visitor_id, "ch": channel,
           "ttl": int(ttl_seconds)}).first()
    return _row(r) if r else None


def touch_conversation(db: Session, conversation_id: str, *, messages: int = 0, billed: int = 0) -> None:
    db.execute(text("""
        UPDATE site_assistant_conversation
           SET message_count = message_count + :m, answers_billed = answers_billed + :b, last_active_at = now()
         WHERE id = :id
    """), {"id": conversation_id, "m": int(messages), "b": int(billed)})


def set_lead(db: Session, conversation_id: str, kind: str, lead_ref: Optional[str]) -> None:
    db.execute(text("""
        UPDATE site_assistant_conversation SET lead_status = :k, lead_ref = :r, last_active_at = now() WHERE id = :id
    """), {"id": conversation_id, "k": kind, "r": (lead_ref or None) and str(lead_ref)[:64]})


def recent_leads_from_ip(db: Session, institute_id: str, ip_hash: str, hours: int = 24) -> int:
    """Contacts already sent from this network today (spam brake on the lead form)."""
    return int(db.execute(text("""
        SELECT count(*) FROM site_assistant_conversation
         WHERE institute_id = :iid AND ip_hash = :h AND lead_status IS NOT NULL
           AND last_active_at > now() - make_interval(hours => :hrs)
    """), {"iid": institute_id, "h": ip_hash, "hrs": int(hours)}).scalar() or 0)


# ── messages ──────────────────────────────────────────────────────────────

_MSG_COLS = "id, conversation_id, role, content, cards, tool_name, sources, answered, feedback, page, created_at"


def add_message(db: Session, conversation_id: str, role: str, content: str, *, cards: Any = None,
                tool_name: Optional[str] = None, sources: Any = None, answered: Optional[bool] = None,
                page: Any = None) -> int:
    r = db.execute(text("""
        INSERT INTO site_assistant_message (conversation_id, role, content, cards, tool_name, sources, answered, page)
        VALUES (:cid, :role, :content, CAST(:cards AS jsonb), :tool, CAST(:sources AS jsonb), :answered,
                CAST(:page AS jsonb))
        RETURNING id
    """), {"cid": conversation_id, "role": role, "content": content or "", "cards": _j(cards),
           "tool": (tool_name or None) and tool_name[:64], "sources": _j(sources), "answered": answered,
           "page": _j(page)}).first()
    return int(r[0])


def mark_billed(db: Session, message_id: int) -> None:
    db.execute(text("""
        UPDATE site_assistant_message
           SET sources = jsonb_set(COALESCE(sources, '{}'::jsonb), '{billed}', 'true'::jsonb)
         WHERE id = :id
    """), {"id": int(message_id)})


def find_by_client_msg_id(db: Session, conversation_id: str, client_msg_id: str) -> Optional[Dict[str, Any]]:
    """The user message sent with this client_msg_id and the assistant reply that followed it (if any).

    The id is kept in the user message's `page` JSON (`client_msg_id`): the
    SPEC table has no column for it."""
    user = db.execute(text(f"""
        SELECT {_MSG_COLS} FROM site_assistant_message
         WHERE conversation_id = :cid AND role = 'user' AND page->>'client_msg_id' = :cm
         ORDER BY id LIMIT 1
    """), {"cid": conversation_id, "cm": client_msg_id}).first()
    if not user:
        return None
    reply = db.execute(text(f"""
        SELECT {_MSG_COLS} FROM site_assistant_message
         WHERE conversation_id = :cid AND role = 'assistant' AND id > :uid
           AND NOT EXISTS (SELECT 1 FROM site_assistant_message u
                            WHERE u.conversation_id = :cid AND u.role = 'user' AND u.id > :uid
                              AND u.id < site_assistant_message.id)
         ORDER BY id LIMIT 1
    """), {"cid": conversation_id, "uid": int(user.id)}).first()
    return {"user": _row(user), "reply": _row(reply) if reply else None}


def recent_user_messages(db: Session, conversation_id: str, seconds: int = 60) -> int:
    return int(db.execute(text("""
        SELECT count(*) FROM site_assistant_message
         WHERE conversation_id = :cid AND role = 'user' AND created_at > now() - make_interval(secs => :s)
    """), {"cid": conversation_id, "s": int(seconds)}).scalar() or 0)


def history(db: Session, conversation_id: str, limit: int = 8) -> List[Dict[str, Any]]:
    """Last `limit` user/assistant messages, oldest first."""
    rows = db.execute(text(f"""
        SELECT {_MSG_COLS} FROM site_assistant_message
         WHERE conversation_id = :cid AND role IN ('user', 'assistant')
         ORDER BY id DESC LIMIT :n
    """), {"cid": conversation_id, "n": int(limit)}).fetchall()
    return [_row(r) for r in reversed(rows)]


def transcript(db: Session, conversation_id: str, *, include_tools: bool = False, limit: int = 200) -> List[Dict[str, Any]]:
    roles = "('user', 'assistant', 'tool')" if include_tools else "('user', 'assistant')"
    rows = db.execute(text(f"""
        SELECT {_MSG_COLS} FROM site_assistant_message
         WHERE conversation_id = :cid AND role IN {roles}
         ORDER BY id LIMIT :n
    """), {"cid": conversation_id, "n": int(limit)}).fetchall()
    return [_row(r) for r in rows]


def tool_names_used(db: Session, conversation_id: str) -> List[str]:
    rows = db.execute(text("""
        SELECT tool_name FROM site_assistant_message WHERE conversation_id = :cid AND role = 'tool' ORDER BY id
    """), {"cid": conversation_id}).fetchall()
    return [r[0] for r in rows if r[0]]


def set_feedback(db: Session, conversation_id: str, message_id: int, rating: int) -> bool:
    n = db.execute(text("""
        UPDATE site_assistant_message SET feedback = :r
         WHERE id = :mid AND conversation_id = :cid AND role = 'assistant'
    """), {"r": int(rating), "mid": int(message_id), "cid": conversation_id}).rowcount
    return bool(n)


# ── daily usage (answers per site) ───────────────────────────────────────

def site_answers_today(db: Session, institute_id: str, site_tag: str) -> int:
    return int(db.execute(text(f"""
        SELECT answers FROM site_assistant_usage_daily
         WHERE institute_id = :iid AND site_tag = :tag AND day = {TODAY_SQL}
    """), {"iid": institute_id, "tag": site_tag}).scalar() or 0)


# ── knowledge (FAQs and notices) ─────────────────────────────────────────

_K_COLS = ("id, institute_id, site_tag, kind, title, body, active, starts_at, ends_at, created_by, created_at, "
           "updated_at, (embedding IS NOT NULL) AS embedded")


def list_knowledge(db: Session, institute_id: str, *, site_tag: Optional[str] = None, kind: Optional[str] = None,
                   limit: int = 500) -> List[Dict[str, Any]]:
    clauses = ["institute_id = :iid"]
    params: Dict[str, Any] = {"iid": institute_id, "n": int(limit)}
    if site_tag:
        clauses.append("(site_tag IS NULL OR site_tag = :tag)")
        params["tag"] = site_tag
    if kind:
        clauses.append("kind = :kind")
        params["kind"] = kind
    rows = db.execute(text(f"SELECT {_K_COLS} FROM site_assistant_knowledge WHERE {' AND '.join(clauses)} "
                           "ORDER BY kind, updated_at DESC NULLS LAST LIMIT :n"), params).fetchall()
    return [_row(r) for r in rows]


def get_knowledge(db: Session, institute_id: str, kid: str) -> Optional[Dict[str, Any]]:
    r = db.execute(text(f"SELECT {_K_COLS} FROM site_assistant_knowledge WHERE id = :id AND institute_id = :iid"),
                   {"id": kid, "iid": institute_id}).first()
    return _row(r) if r else None


def create_knowledge(db: Session, institute_id: str, *, site_tag: Optional[str], kind: str, title: str, body: str,
                     active: bool, starts_at: Any, ends_at: Any, created_by: Optional[str]) -> str:
    kid = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO site_assistant_knowledge
            (id, institute_id, site_tag, kind, title, body, active, starts_at, ends_at, created_by, created_at, updated_at)
        VALUES (:id, :iid, :tag, :kind, :title, :body, :active, :sa, :ea, :by, now(), now())
    """), {"id": kid, "iid": institute_id, "tag": site_tag, "kind": kind, "title": title, "body": body,
           "active": bool(active), "sa": starts_at, "ea": ends_at, "by": created_by})
    return kid


def update_knowledge(db: Session, institute_id: str, kid: str, fields: Dict[str, Any]) -> bool:
    allowed = ("site_tag", "kind", "title", "body", "active", "starts_at", "ends_at")
    sets = [f"{k} = :{k}" for k in allowed if k in fields]
    if not sets:
        return get_knowledge(db, institute_id, kid) is not None
    params = {k: fields[k] for k in allowed if k in fields}
    params.update({"id": kid, "iid": institute_id})
    n = db.execute(text(f"UPDATE site_assistant_knowledge SET {', '.join(sets)}, updated_at = now() "
                        "WHERE id = :id AND institute_id = :iid"), params).rowcount
    return bool(n)


def delete_knowledge(db: Session, institute_id: str, kid: str) -> bool:
    n = db.execute(text("DELETE FROM site_assistant_knowledge WHERE id = :id AND institute_id = :iid"),
                   {"id": kid, "iid": institute_id}).rowcount
    return bool(n)


def set_knowledge_embedding(db: Session, institute_id: str, kid: str, embedding: Optional[Sequence[float]]) -> None:
    db.execute(text("""
        UPDATE site_assistant_knowledge SET embedding = CAST(:e AS vector) WHERE id = :id AND institute_id = :iid
    """), {"e": str(list(embedding)) if embedding else None, "id": kid, "iid": institute_id})


_LIVE_KNOWLEDGE = """
    institute_id = :iid AND (site_tag IS NULL OR site_tag = :tag) AND active = TRUE AND kind = ANY(:kinds)
    AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
"""


def search_knowledge_vector(db: Session, institute_id: str, site_tag: str, kinds: Iterable[str],
                            embedding: Sequence[float], top_k: int = 5, threshold: float = 0.35) -> List[Dict[str, Any]]:
    rows = db.execute(text(f"""
        SELECT id, kind, title, body, ends_at, 1 - (embedding <=> CAST(:q AS vector)) AS similarity
          FROM site_assistant_knowledge
         WHERE {_LIVE_KNOWLEDGE} AND embedding IS NOT NULL
           AND 1 - (embedding <=> CAST(:q AS vector)) > :th
         ORDER BY embedding <=> CAST(:q AS vector) LIMIT :k
    """), {"iid": institute_id, "tag": site_tag, "kinds": list(kinds), "q": str(list(embedding)),
           "th": float(threshold), "k": int(top_k)}).fetchall()
    return [_row(r) for r in rows]


def search_knowledge_keyword(db: Session, institute_id: str, site_tag: str, kinds: Iterable[str],
                             words: Sequence[str], top_k: int = 5) -> List[Dict[str, Any]]:
    words = [w for w in words if w][:6]
    if not words:
        return []
    score = " + ".join(f"(CASE WHEN (title || ' ' || body) ILIKE :w{i} THEN 1 ELSE 0 END)" for i in range(len(words)))
    params: Dict[str, Any] = {"iid": institute_id, "tag": site_tag, "kinds": list(kinds), "k": int(top_k)}
    params.update({f"w{i}": f"%{w}%" for i, w in enumerate(words)})
    rows = db.execute(text(f"""
        SELECT id, kind, title, body, ends_at, ({score})::float / {len(words)} AS similarity
          FROM site_assistant_knowledge
         WHERE {_LIVE_KNOWLEDGE} AND ({score}) > 0
         ORDER BY similarity DESC, updated_at DESC LIMIT :k
    """), params).fetchall()
    return [_row(r) for r in rows]


def active_notices(db: Session, institute_id: str, site_tag: str, limit: int = 5) -> List[Dict[str, Any]]:
    rows = db.execute(text(f"""
        SELECT id, kind, title, body, ends_at FROM site_assistant_knowledge
         WHERE {_LIVE_KNOWLEDGE}
         ORDER BY COALESCE(starts_at, created_at) DESC LIMIT :n
    """), {"iid": institute_id, "tag": site_tag, "kinds": ["NOTICE"], "n": int(limit)}).fetchall()
    return [_row(r) for r in rows]


# ── page chunks + index state ────────────────────────────────────────────

def index_state(db: Session, institute_id: str, site_tag: str) -> Optional[Dict[str, Any]]:
    r = db.execute(text("""
        SELECT institute_id, site_tag, fingerprint, status, chunks, error, updated_at
          FROM site_assistant_index_state WHERE institute_id = :iid AND site_tag = :tag
    """), {"iid": institute_id, "tag": site_tag}).first()
    return _row(r) if r else None


def try_lock_index(db: Session, institute_id: str, site_tag: str, fingerprint: str, *,
                   stale_seconds: int = 900, retry_failed_seconds: int = 1800, force: bool = False) -> bool:
    """Claim the (institute, site) index for this pod. True = we own it.

    Atomic in one statement, so two pods racing on the same site cannot both
    win: the row is taken only when nobody is indexing (or the holder looks
    dead), and a FAILED run of the SAME fingerprint is not retried in a loop."""
    r = db.execute(text("""
        INSERT INTO site_assistant_index_state (institute_id, site_tag, fingerprint, status, chunks, error, updated_at)
        VALUES (:iid, :tag, :fp, 'INDEXING', 0, NULL, now())
        ON CONFLICT (institute_id, site_tag) DO UPDATE
           SET status = 'INDEXING', fingerprint = EXCLUDED.fingerprint, error = NULL, updated_at = now()
         WHERE (site_assistant_index_state.status = 'INDEXING'
                AND site_assistant_index_state.updated_at < now() - make_interval(secs => :stale))
            OR (site_assistant_index_state.status IS DISTINCT FROM 'INDEXING'
                AND (:force
                     OR site_assistant_index_state.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint
                     OR (site_assistant_index_state.status = 'FAILED'
                         AND site_assistant_index_state.updated_at < now() - make_interval(secs => :retry))))
        RETURNING 1
    """), {"iid": institute_id, "tag": site_tag, "fp": fingerprint, "stale": int(stale_seconds),
           "retry": int(retry_failed_seconds), "force": bool(force)}).first()
    return r is not None


def finish_index(db: Session, institute_id: str, site_tag: str, *, fingerprint: str, ok: bool, chunks: int = 0,
                 error: Optional[str] = None) -> None:
    db.execute(text("""
        UPDATE site_assistant_index_state
           SET status = :st, chunks = :n, error = :err, fingerprint = :fp, updated_at = now()
         WHERE institute_id = :iid AND site_tag = :tag
    """), {"st": "READY" if ok else "FAILED", "n": int(chunks), "err": (error or None) and error[:1000],
           "fp": fingerprint, "iid": institute_id, "tag": site_tag})


def replace_page_chunks(db: Session, institute_id: str, site_tag: str, fingerprint: str,
                        chunks: List[Dict[str, Any]]) -> int:
    db.execute(text("DELETE FROM site_assistant_page_chunk WHERE institute_id = :iid AND site_tag = :tag"),
               {"iid": institute_id, "tag": site_tag})
    for c in chunks:
        emb = c.get("embedding")
        db.execute(text("""
            INSERT INTO site_assistant_page_chunk
                (institute_id, site_tag, page_route, page_title, section_id, heading, content, embedding, fingerprint)
            VALUES (:iid, :tag, :route, :title, :sid, :heading, :content, CAST(:e AS vector), :fp)
        """), {"iid": institute_id, "tag": site_tag, "route": c["page_route"], "title": c.get("page_title"),
               "sid": (c.get("section_id") or None) and str(c["section_id"])[:128], "heading": c.get("heading"),
               "content": c["content"], "e": str(list(emb)) if emb else None, "fp": fingerprint})
    return len(chunks)


def blog_post_stamps(db: Session, institute_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    """Ids and edit times of the institute's published blog posts (what the page index fingerprints)."""
    rows = db.execute(text("""
        SELECT id, updated_at FROM catalogue_blog_post
         WHERE institute_id = :iid AND status = 'PUBLISHED'
         ORDER BY published_at DESC NULLS LAST, id LIMIT :n
    """), {"iid": institute_id, "n": int(limit)}).fetchall()
    return [_row(r) for r in rows]


def blog_posts(db: Session, institute_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    """The institute's published blog posts, newest first (the site's blog sections list these)."""
    rows = db.execute(text("""
        SELECT id, slug, title, excerpt, category, tags, content_html FROM catalogue_blog_post
         WHERE institute_id = :iid AND status = 'PUBLISHED'
         ORDER BY published_at DESC NULLS LAST, id LIMIT :n
    """), {"iid": institute_id, "n": int(limit)}).fetchall()
    return [_row(r) for r in rows]


def search_page_chunks_vector(db: Session, institute_id: str, site_tag: str, embedding: Sequence[float],
                              top_k: int = 4, threshold: float = 0.35) -> List[Dict[str, Any]]:
    rows = db.execute(text("""
        SELECT page_route, page_title, section_id, heading, content,
               1 - (embedding <=> CAST(:q AS vector)) AS similarity
          FROM site_assistant_page_chunk
         WHERE institute_id = :iid AND site_tag = :tag AND embedding IS NOT NULL
           AND 1 - (embedding <=> CAST(:q AS vector)) > :th
         ORDER BY embedding <=> CAST(:q AS vector) LIMIT :k
    """), {"iid": institute_id, "tag": site_tag, "q": str(list(embedding)), "th": float(threshold),
           "k": int(top_k)}).fetchall()
    return [_row(r) for r in rows]


def search_page_chunks_keyword(db: Session, institute_id: str, site_tag: str, words: Sequence[str],
                               top_k: int = 4) -> List[Dict[str, Any]]:
    words = [w for w in words if w][:6]
    if not words:
        return []
    hay = "(COALESCE(page_title, '') || ' ' || COALESCE(heading, '') || ' ' || content)"
    score = " + ".join(f"(CASE WHEN {hay} ILIKE :w{i} THEN 1 ELSE 0 END)" for i in range(len(words)))
    params: Dict[str, Any] = {"iid": institute_id, "tag": site_tag, "k": int(top_k)}
    params.update({f"w{i}": f"%{w}%" for i, w in enumerate(words)})
    rows = db.execute(text(f"""
        SELECT page_route, page_title, section_id, heading, content, ({score})::float / {len(words)} AS similarity
          FROM site_assistant_page_chunk
         WHERE institute_id = :iid AND site_tag = :tag AND ({score}) > 0
         ORDER BY similarity DESC LIMIT :k
    """), params).fetchall()
    return [_row(r) for r in rows]


# ── staff views ───────────────────────────────────────────────────────────

def list_conversations(db: Session, institute_id: str, *, site_tag: Optional[str], lead: Optional[str],
                       page: int, size: int, include_empty: bool = False) -> Dict[str, Any]:
    clauses = ["c.institute_id = :iid"]
    if not include_empty:
        # A session nobody typed into (opened the chat, left) is not a conversation.
        clauses.append("c.message_count > 0")
    params: Dict[str, Any] = {"iid": institute_id}
    if site_tag:
        clauses.append("c.site_tag = :tag")
        params["tag"] = site_tag
    if lead in ("SALES", "SUPPORT"):
        clauses.append("c.lead_status = :lead")
        params["lead"] = lead
    elif lead == "any":
        clauses.append("c.lead_status IS NOT NULL")
    where = " AND ".join(clauses)
    total = int(db.execute(text(f"SELECT count(*) FROM site_assistant_conversation c WHERE {where}"),
                           params).scalar() or 0)
    params.update({"lim": int(size), "off": int(page) * int(size)})
    rows = db.execute(text(f"""
        SELECT c.id, c.site_tag, c.channel, c.user_id IS NOT NULL AS logged_in, c.started_page, c.locale,
               c.message_count, c.answers_billed, c.lead_status, c.lead_ref, c.created_at, c.last_active_at,
               (SELECT content FROM site_assistant_message m WHERE m.conversation_id = c.id AND m.role = 'user'
                 ORDER BY m.id LIMIT 1) AS first_question,
               (SELECT count(*) FROM site_assistant_message m WHERE m.conversation_id = c.id AND m.feedback = 1) AS thumbs_up,
               (SELECT count(*) FROM site_assistant_message m WHERE m.conversation_id = c.id AND m.feedback = -1) AS thumbs_down
          FROM site_assistant_conversation c
         WHERE {where}
         ORDER BY c.created_at DESC LIMIT :lim OFFSET :off
    """), params).fetchall()
    return {"items": [_row(r) for r in rows], "page": page, "size": size, "total": total}


def unanswered_questions(db: Session, institute_id: str, *, site_tag: Optional[str], days: int,
                         limit: int = 500) -> List[Dict[str, Any]]:
    """User questions whose assistant reply had answered = false, newest first."""
    params: Dict[str, Any] = {"iid": institute_id, "days": int(days), "n": int(limit)}
    tag_clause = ""
    if site_tag:
        tag_clause = "AND c.site_tag = :tag"
        params["tag"] = site_tag
    rows = db.execute(text(f"""
        SELECT a.id AS reply_id, a.created_at, c.id AS conversation_id, c.site_tag,
               (SELECT u.content FROM site_assistant_message u
                 WHERE u.conversation_id = a.conversation_id AND u.role = 'user' AND u.id < a.id
                 ORDER BY u.id DESC LIMIT 1) AS question
          FROM site_assistant_message a
          JOIN site_assistant_conversation c ON c.id = a.conversation_id
         WHERE c.institute_id = :iid {tag_clause} AND a.role = 'assistant' AND a.answered = FALSE
           AND a.created_at > now() - make_interval(days => :days)
         ORDER BY a.id DESC LIMIT :n
    """), params).fetchall()
    return [_row(r) for r in rows]
