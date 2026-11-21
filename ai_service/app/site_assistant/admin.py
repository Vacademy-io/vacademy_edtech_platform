"""Staff views and writes (SPEC §4.6). The institute is always the staff
member's pinned institute; ids from the URL are only looked up inside it."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status

from ..db import db_session
from . import billing
from . import internal_client as ac
from . import knowledge as K
from . import repository as repo
from . import settings as S
from .service import Staff, clean_tag, public_history

KINDS = ("FAQ", "NOTICE")


def _deny(code: int, error: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": error, "message": message})


def require_admin(staff: Staff) -> None:
    if not staff.is_admin:
        raise _deny(status.HTTP_403_FORBIDDEN, "forbidden", "Only institute admins can change the assistant.")


def _parse_dt(v: Any, field: str) -> Optional[datetime]:
    if v in (None, ""):
        return None
    if not isinstance(v, str):
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", f"{field} must be an ISO date-time.")
    try:
        dt = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
    except ValueError:
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", f"{field} must be an ISO date-time.")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def _check_site(institute_id: str, tag: Optional[str]) -> Optional[str]:
    if tag in (None, ""):
        return None
    tag = clean_tag(tag)
    if not await ac.published_catalogue(institute_id, tag):
        raise _deny(status.HTTP_404_NOT_FOUND, "not_found", "No published site with this tag.")
    return tag


def _knowledge_fields(body: Dict[str, Any], *, partial: bool) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if "kind" in body or not partial:
        kind = str(body.get("kind") or "").upper()
        if kind not in KINDS:
            raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", "kind must be FAQ or NOTICE.")
        out["kind"] = kind
    for key, cap in (("title", 500), ("body", 4000)):
        if key in body or not partial:
            v = " ".join(str(body.get(key) or "").split()) if key == "title" else str(body.get(key) or "").strip()
            if not v:
                raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", f"{key} is required.")
            out[key] = v[:cap]
    if "active" in body:
        out["active"] = bool(body.get("active"))
    elif not partial:
        out["active"] = True
    for key in ("starts_at", "ends_at"):
        if key in body or not partial:
            out[key] = _parse_dt(body.get(key), key)
    if out.get("starts_at") and out.get("ends_at") and out["ends_at"] <= out["starts_at"]:
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", "ends_at must be after starts_at.")
    return out


def list_knowledge(staff: Staff, site_tag: Optional[str], kind: Optional[str]) -> Dict[str, Any]:
    k = kind.upper() if isinstance(kind, str) and kind.upper() in KINDS else None
    with db_session() as db:
        items = repo.list_knowledge(db, staff.institute_id, site_tag=site_tag or None, kind=k)
    return {"items": items}


async def create_knowledge(staff: Staff, body: Dict[str, Any]) -> Dict[str, Any]:
    require_admin(staff)
    fields = _knowledge_fields(body, partial=False)
    tag = await _check_site(staff.institute_id, body.get("site_tag"))
    with db_session() as db:
        kid = repo.create_knowledge(db, staff.institute_id, site_tag=tag, kind=fields["kind"], title=fields["title"],
                                    body=fields["body"], active=fields["active"], starts_at=fields["starts_at"],
                                    ends_at=fields["ends_at"], created_by=staff.user_id)
    embedded = await K.embed_knowledge(staff.institute_id, kid, fields["title"], fields["body"])
    with db_session() as db:
        item = repo.get_knowledge(db, staff.institute_id, kid)
    return {"item": item, "embedded": embedded}


async def update_knowledge(staff: Staff, kid: str, body: Dict[str, Any]) -> Dict[str, Any]:
    require_admin(staff)
    fields = _knowledge_fields(body, partial=True)
    if "site_tag" in body:
        fields["site_tag"] = await _check_site(staff.institute_id, body.get("site_tag"))
    with db_session() as db:
        current = repo.get_knowledge(db, staff.institute_id, kid)
        if not current:
            raise _deny(status.HTTP_404_NOT_FOUND, "not_found", "No such FAQ or notice.")
        repo.update_knowledge(db, staff.institute_id, kid, fields)
    embedded = None
    if "title" in fields or "body" in fields:
        embedded = await K.embed_knowledge(staff.institute_id, kid, fields.get("title", current["title"]),
                                           fields.get("body", current["body"]))
    with db_session() as db:
        item = repo.get_knowledge(db, staff.institute_id, kid)
    return {"item": item, "embedded": embedded}


def delete_knowledge(staff: Staff, kid: str) -> Dict[str, Any]:
    require_admin(staff)
    with db_session() as db:
        if not repo.delete_knowledge(db, staff.institute_id, kid):
            raise _deny(status.HTTP_404_NOT_FOUND, "not_found", "No such FAQ or notice.")
    return {"status": "deleted"}


def list_conversations(staff: Staff, site_tag: Optional[str], lead: Optional[str], page: int, size: int,
                       include_empty: bool = False) -> Dict[str, Any]:
    page = max(0, int(page or 0))
    size = max(1, min(int(size or 20), 100))
    lead_filter = lead.upper() if isinstance(lead, str) and lead.upper() in ("SALES", "SUPPORT") else (
        "any" if lead in ("true", "any", "1") else None)
    with db_session() as db:
        out = repo.list_conversations(db, staff.institute_id, site_tag=site_tag or None, lead=lead_filter,
                                      page=page, size=size, include_empty=bool(include_empty))
    out["total_pages"] = (int(out["total"]) + size - 1) // size
    return out


def get_conversation(staff: Staff, cid: str) -> Dict[str, Any]:
    with db_session() as db:
        conv = repo.get_conversation(db, cid)
        if not conv or conv["institute_id"] != staff.institute_id:
            raise _deny(status.HTTP_404_NOT_FOUND, "not_found", "No such conversation.")
        rows = repo.transcript(db, cid, include_tools=True)
    conv.pop("ip_hash", None)
    conv.pop("visitor_id", None)
    messages = []
    for m in public_history(rows):
        m.setdefault("cards", None)
        m.setdefault("answered", None)
        m.setdefault("feedback", None)
        messages.append(m)
    tools = [{"id": r["id"], "tool_name": r.get("tool_name"), "created_at": r.get("created_at")}
             for r in rows if r.get("role") == "tool"]
    return {**conv, "messages": messages, "tool_calls": tools}


_PUNCT = re.compile(r"[^\w\sऀ-ॿ]")
_STOP = {"the", "a", "an", "is", "are", "do", "does", "you", "your", "i", "me", "my", "please", "can", "to", "of",
         "for", "in", "on", "it", "this", "that", "what", "how", "have", "has", "any", "there", "we", "be",
         "kya", "hai", "ka", "ki", "ke"}
SIMILAR = 0.5   # Jaccard overlap of content words that puts two questions in one group


def question_words(q: str) -> frozenset:
    return frozenset(w for w in _PUNCT.sub(" ", (q or "").lower()).split() if w not in _STOP)


def _similar(x: frozenset, y: frozenset) -> bool:
    if not x or not y:
        return x == y
    return len(x & y) / len(x | y) >= SIMILAR


def unanswered(staff: Staff, site_tag: Optional[str], days: int) -> List[Dict[str, Any]]:
    """Questions the assistant could not answer, grouped by similar wording, most asked first."""
    days = max(1, min(int(days or 30), 180))
    with db_session() as db:
        rows = repo.unanswered_questions(db, staff.institute_id, site_tag=site_tag or None, days=days)
    groups: List[Dict[str, Any]] = []
    for r in rows:   # newest first, so a group's question is its latest wording
        q = (r.get("question") or "").strip()
        if not q:
            continue
        words = question_words(q) or frozenset({q.lower()})
        g = next((g for g in groups if _similar(words, g["_words"])), None)
        if g is None:
            g = {"question": q, "count": 0, "last_asked_at": r.get("created_at"), "site_tag": r.get("site_tag"),
                 "conversation_ids": [], "examples": [], "_words": words}
            groups.append(g)
        g["count"] += 1
        if r["conversation_id"] not in g["conversation_ids"] and len(g["conversation_ids"]) < 5:
            g["conversation_ids"].append(r["conversation_id"])
        if q not in g["examples"] and len(g["examples"]) < 3:
            g["examples"].append(q)
        if len(groups) >= 300:
            break
    for g in groups:
        g.pop("_words", None)
    groups.sort(key=lambda g: (g["count"], str(g["last_asked_at"] or "")), reverse=True)
    return groups[:200]


async def site_status(staff: Staff, site_tag: str) -> Dict[str, Any]:
    tag = clean_tag(site_tag)
    published = await ac.published_catalogue(staff.institute_id, tag)
    cfg = S.from_catalogue(published["catalogue"]) if published else None
    with db_session() as db:
        state = repo.index_state(db, staff.institute_id, tag)
        today = repo.site_answers_today(db, staff.institute_id, tag)
    fp_now = K.site_fingerprint(staff.institute_id, published["catalogue"]) if published else None
    credits = billing.balance_warning(staff.institute_id)
    low = credits.get("sufficient") is False
    platform_on = not S.kill_switch_on()
    state = state or {}
    return {
        "site_tag": tag,
        "enabled": bool(cfg and cfg["enabled"]) and platform_on,
        "published": bool(published),
        "embed_enabled": bool(cfg and cfg["embed"]["enabled"]),
        "platform_enabled": platform_on,
        "index": {"status": state.get("status") or "NOT_INDEXED", "chunks": state.get("chunks") or 0,
                  "updated_at": state.get("updated_at"), "error": state.get("error"),
                  "up_to_date": bool(fp_now and state.get("fingerprint") == fp_now and state.get("status") == "READY")},
        "today": {"answers": today,
                  "cap": (cfg or {}).get("limits", {}).get("dailyAnswers", S.SITE_DAILY_ANSWERS)},
        "credits": {"low": low,
                    "warning": ("Your institute is out of AI credits: visitors see the contact form instead of "
                                "answers. Top up AI credits to turn answers back on.") if low else None,
                    "balance": credits.get("balance")},
    }


async def reindex(staff: Staff, site_tag: str) -> Dict[str, Any]:
    require_admin(staff)
    tag = clean_tag(site_tag)
    published = await ac.published_catalogue(staff.institute_id, tag)
    if not published:
        raise _deny(status.HTTP_404_NOT_FOUND, "not_found", "No published site with this tag.")
    result = await K.index_site(staff.institute_id, tag, published["catalogue"], force=True)
    if result.get("status") == "skipped":
        return {"status": "INDEXING", "message": "Indexing is already running for this site."}
    return result
