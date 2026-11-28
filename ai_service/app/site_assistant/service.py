"""Sessions, ownership, contact handoff, feedback and history.

Who the visitor is talking to is decided HERE, on the server, and only here:

  HOSTED   the host comes from the Origin header (else Referer) and is
           resolved by admin_core's domain routing → institute + site; the
           body's site_tag must be what admin_core resolves for that host
           (a tag only wins there when it is a site of the host's institute).
  EMBED    a publishable Catalogue key (X-API-Key) names the institute; the
           browser's Origin must be one of its verified websites; the site
           must allow the embed.
  PREVIEW  a staff JWT pinned to the clientId institute (staff role in THAT
           institute; is_root_user is not a staff signal).

Nothing the browser sends as an institute id is ever read. Every later call
carries the signed session token, and the conversation row must agree with
every claim in it.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, status
from sqlalchemy import text as sql

from ..db import db_session
from ..services.tutor.roles import is_staff
from . import caps
from . import internal_client as ac
from . import knowledge as K
from . import repository as repo
from . import settings as S
from . import tokens as T
from .tools import SiteContext, campaign_field_map, campaign_for, short_field_key, strip_inst_suffix

logger = logging.getLogger(__name__)

STAFF_ROLES = {"ADMIN", "ADMIN_NON_ROOT", "SUPER_ADMIN", "TEACHER", "CONTENT_CREATOR", "COURSE_CREATOR"}
ADMIN_ROLES = {"ADMIN", "SUPER_ADMIN"}
_TAG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,254}$")
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$")
LEADS_PER_IP_PER_DAY = 5
_UTM_KEYS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid")


def _deny(code: int, error: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": error, "message": message})


# ── request helpers ───────────────────────────────────────────────────────

def request_host(request: Request) -> Optional[str]:
    """The browser page's host: Origin, else Referer. None for a server-side call."""
    for header in ("origin", "referer"):
        raw = request.headers.get(header)
        if not raw or raw == "null":
            continue
        try:
            host = urlsplit(raw).hostname
        except ValueError:
            host = None
        if host:
            return host.lower().rstrip(".")
    return None


def client_ip(request: Request) -> str:
    from ..services.tutor.demo import client_ip as _ip
    return _ip(request)


def clean_page(page: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if not isinstance(page, dict):
        return out
    for key, cap in (("url", 1000), ("route", 300), ("title", 200), ("course_id", 64)):
        v = page.get(key)
        if isinstance(v, (str, int)) and str(v).strip():
            out[key] = " ".join(str(v).split())[:cap]
    url = out.get("url")
    if url and not url.lower().startswith(("https://", "http://localhost", "http://127.0.0.1")):
        out.pop("url", None)
    return out


def utm_from(page: Dict[str, Any]) -> Optional[Dict[str, str]]:
    url = page.get("url")
    if not url:
        return None
    from urllib.parse import parse_qs
    try:
        qs = parse_qs(urlsplit(url).query)
    except ValueError:
        return None
    utm = {k: v[0][:200] for k, v in qs.items() if k in _UTM_KEYS and v}
    return utm or None


def clean_tag(tag: Any) -> str:
    if not isinstance(tag, str) or not _TAG_RE.match(tag.strip()):
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", "site_tag is required.")
    return tag.strip()


# ── staff identity ────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Staff:
    user_id: str
    institute_id: str
    roles: frozenset

    @property
    def is_admin(self) -> bool:
        return bool(self.roles & ADMIN_ROLES)


async def staff_from_request(request: Request) -> Staff:
    """A staff member of the clientId institute, from their verified JWT."""
    from ..config import get_settings
    from ..core.security import resolve_pinned_principal
    token = T.bearer(request.headers.get("authorization"))
    client_id = request.headers.get("clientId") or request.headers.get("client_id")
    principal = await resolve_pinned_principal(token=token, client_id=client_id, settings=get_settings())
    roles = frozenset(str(r).strip().upper().replace("-", "_").replace(" ", "_") for r in principal.roles or [])
    # Custom institute roles count as staff (the Tutor Mode rule); admin-only actions still use ADMIN_ROLES.
    if not is_staff(roles):
        raise _deny(status.HTTP_403_FORBIDDEN, "forbidden", "Only the institute's staff can do this.")
    return Staff(user_id=principal.user_id, institute_id=principal.institute_id, roles=roles)


async def _staff_or_none(request: Request) -> Optional[Staff]:
    """The staff member when the call carries clientId + a JWT that is staff in THAT
    institute. A learner's token (or any failure) is simply "not staff", never an error."""
    if not (request.headers.get("clientId") or request.headers.get("client_id")) or not request.headers.get("authorization"):
        return None
    try:
        return await staff_from_request(request)
    except Exception:  # noqa: BLE001
        return None


def learner_user_id(request: Request, institute_id: str) -> Optional[str]:
    """A logged-in learner of THIS institute (verified JWT), else None — never an error."""
    from ..core.security import decode_access_token
    token = T.bearer(request.headers.get("authorization"))
    claims = decode_access_token(token) if token else None
    if not claims:
        return None
    user_id = str(claims.get("user") or "")
    authorities = claims.get("authorities")
    if user_id and isinstance(authorities, dict) and institute_id in authorities:
        return user_id
    return None


# ── site context ──────────────────────────────────────────────────────────

def learner_portal_base(institute_id: str) -> Optional[str]:
    try:
        with db_session() as db:
            r = db.execute(sql("SELECT learner_portal_base_url FROM institutes WHERE id = :id"), {"id": institute_id}).first()
            base = (r[0] or "").strip() if r else ""
            if not base:
                rows = db.execute(sql("SELECT domain, subdomain FROM institute_domain_routing "
                                      "WHERE institute_id = :id AND role = 'LEARNER'"), {"id": institute_id}).fetchall()
                for domain, sub in rows or []:
                    d = str(domain or "").strip().lower().replace("https://", "").replace("http://", "").rstrip("/")
                    s = str(sub or "").strip().lower()
                    if d and not s.startswith("admin"):
                        base = d if (not s or s == "*") else f"{s}.{d}"
                        break
    except Exception as exc:  # noqa: BLE001
        logger.warning("site-assistant: learner portal lookup failed for %s: %s", institute_id, exc)
        return None
    if not base:
        return None
    base = base.rstrip("/")
    return base if base.startswith("https://") else ("https://" + base.replace("http://", ""))


async def load_site(institute_id: str, tag: str) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    """(catalogue, normalized siteAssistant settings, catalogue-API site view or {}). 404 when no such site."""
    published = await ac.published_catalogue(institute_id, tag)
    if not published:
        raise _deny(status.HTTP_404_NOT_FOUND, "not_found", "This site was not found.")
    catalogue = published["catalogue"]
    try:
        site = await ac.catalog_site(institute_id) or {}
    except ac.AdminCoreUnavailable:
        site = {}
    return catalogue, S.from_catalogue(catalogue), site


def _site_identity(catalogue: Dict[str, Any], site: Dict[str, Any]) -> Tuple[Optional[str], Optional[str], List[str]]:
    inst = site.get("institute") if isinstance(site.get("institute"), dict) else {}
    gs = catalogue.get("globalSettings") if isinstance(catalogue.get("globalSettings"), dict) else {}
    name = inst.get("name") or (gs.get("siteName") if isinstance(gs.get("siteName"), str) else None)
    popular = [p.get("label") for p in ((site.get("catalog") or {}).get("popular_searches") or [])
               if isinstance(p, dict) and isinstance(p.get("label"), str)]
    return name, inst.get("logo_url"), popular


# ── POST /sessions ────────────────────────────────────────────────────────

async def open_session(request: Request, body: Dict[str, Any]) -> Dict[str, Any]:
    from datetime import datetime, timezone
    if S.kill_switch_on():
        raise _deny(status.HTTP_503_SERVICE_UNAVAILABLE, "disabled", "The assistant is not available right now.")
    tag = clean_tag(body.get("site_tag"))
    page = clean_page(body.get("page"))
    host = request_host(request)
    api_key = request.headers.get("x-api-key")
    user_id: Optional[str] = None

    if api_key:
        channel = "EMBED"
        key = await ac.verify_api_key(api_key.strip(), client_ip(request))
        if not key:
            raise _deny(status.HTTP_401_UNAUTHORIZED, "invalid_api_key", "This key is not a valid publishable key.")
        institute_id = key["institute_id"]
        if not host or not await ac.origin_allowed(institute_id, host):
            raise _deny(status.HTTP_403_FORBIDDEN, "origin_not_allowed",
                        "This website is not one of the institute's verified websites.")
    elif body.get("preview") is True:
        channel = "PREVIEW"
        staff = await staff_from_request(request)
        institute_id, user_id = staff.institute_id, staff.user_id
    else:
        resolved = await ac.resolve_site(host, tag) if host else None
        if resolved and resolved["site_tag"] != tag:
            resolved = None   # the host serves this institute, but not the site the page claims
        if resolved:
            channel = "HOSTED"
            institute_id = resolved["institute_id"]
            user_id = learner_user_id(request, institute_id)
        else:
            # Not a site's own host: the admin app's preview (staff JWT + clientId,
            # the `preview` flag optional), else an unknown website.
            staff = await _staff_or_none(request)
            if staff is None:
                raise _deny(status.HTTP_403_FORBIDDEN, "unknown_site", "This website is not recognised.")
            channel, institute_id, user_id = "PREVIEW", staff.institute_id, staff.user_id

    catalogue, cfg, site = await load_site(institute_id, tag)
    if channel != "PREVIEW" and not cfg["enabled"]:
        raise _deny(status.HTTP_403_FORBIDDEN, "disabled", "The assistant is turned off for this site.")
    if channel == "EMBED" and not cfg["embed"]["enabled"]:
        raise _deny(status.HTTP_403_FORBIDDEN, "disabled", "The assistant is not enabled for embedding on this site.")

    vid = T.visitor_id(body.get("visitor_id"))
    conv = None
    history: List[Dict[str, Any]] = []
    resume = body.get("resume_session_id")
    with db_session() as db:
        if isinstance(resume, str) and resume and isinstance(body.get("visitor_id"), str):
            conv = repo.find_resumable(db, conversation_id=resume[:36], institute_id=institute_id, site_tag=tag,
                                       visitor_id=vid, channel=channel, ttl_seconds=S.SESSION_TTL_SECONDS)
        if conv:
            cid = conv["id"]
            repo.touch_conversation(db, cid)
            history = public_history(repo.transcript(db, cid))
        else:
            ip = client_ip(request)
            if channel != "PREVIEW" and not caps.take_session(db, T.hash_key("s", ip), S.ip_daily_sessions(db)):
                raise _deny(status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited",
                            "Too many chats were started from your network today. Please try again tomorrow.")
            iph = T.ip_hash(ip) if channel != "PREVIEW" else None
            locale = (request.headers.get("accept-language") or "").split(",")[0].strip()[:16] or None
            cid = repo.create_conversation(db, institute_id=institute_id, site_tag=tag, channel=channel,
                                           visitor_id=vid, user_id=user_id, ip_hash=iph, origin_host=host,
                                           started_page=page.get("url") or page.get("route"),
                                           utm=utm_from(page), locale=locale)
    K.ensure_index_background(institute_id, tag, catalogue)
    minted = T.mint(sid=cid, iid=institute_id, tag=tag, vid=vid, ch=channel)
    name, logo, popular = _site_identity(catalogue, site)
    return {
        "session_id": cid,
        "visitor_id": vid,
        "token": minted["token"],
        "expires_at": datetime.fromtimestamp(minted["exp"], tz=timezone.utc).isoformat(),
        "channel": channel,
        "assistant": S.public_view(cfg, site_name=name, logo_url=logo, popular=popular),
        "history": history,
    }


# ── ownership ─────────────────────────────────────────────────────────────

def owned_conversation(session_id: str, authorization: Optional[str]) -> Tuple[T.SessionClaims, Dict[str, Any]]:
    """The conversation this token owns — 401/403/404 otherwise."""
    claims = T.verify(T.bearer(authorization))
    if claims is None:
        raise _deny(status.HTTP_401_UNAUTHORIZED, "invalid_token", "Your chat session has expired. Please reopen it.")
    if claims.sid != session_id:
        raise _deny(status.HTTP_403_FORBIDDEN, "forbidden", "This chat belongs to another session.")
    with db_session() as db:
        conv = repo.get_conversation(db, session_id)
    if (not conv or conv["institute_id"] != claims.iid or conv["site_tag"] != claims.tag
            or conv["visitor_id"] != claims.vid or conv["channel"] != claims.ch):
        raise _deny(status.HTTP_403_FORBIDDEN, "forbidden", "This chat belongs to another session.")
    if conv.get("status") != "ACTIVE":
        raise _deny(status.HTTP_403_FORBIDDEN, "closed", "This chat is closed.")
    return claims, conv


async def site_context(conv: Dict[str, Any], page: Dict[str, Any], *, host: Optional[str]) -> SiteContext:
    catalogue, cfg, site = await load_site(conv["institute_id"], conv["site_tag"])
    name, _logo, _pop = _site_identity(catalogue, site)
    forms = 0
    with db_session() as db:
        for row in repo.transcript(db, conv["id"]):
            forms += sum(1 for c in row.get("cards") or [] if isinstance(c, dict) and c.get("type") == "contact_form")
    hosted_base = None
    if conv["channel"] != "HOSTED":
        base = learner_portal_base(conv["institute_id"])
        if base:
            from urllib.parse import quote
            hosted_base = f"{base}/{quote(conv['site_tag'], safe='')}"
    return SiteContext(
        institute_id=conv["institute_id"], site_tag=conv["site_tag"], channel=conv["channel"],
        conversation_id=conv["id"], visitor_id=conv["visitor_id"], settings=cfg,
        user_id=conv.get("user_id") if conv["channel"] != "PREVIEW" else None,
        site_name=name, site_host=conv.get("origin_host") or host, hosted_base=hosted_base,
        catalogue=catalogue, page=page, lead_status=conv.get("lead_status"), contact_forms_shown=forms,
    )


# ── history ───────────────────────────────────────────────────────────────

def public_history(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for r in rows:
        if r.get("role") not in ("user", "assistant"):
            continue
        item: Dict[str, Any] = {"id": r["id"], "role": r["role"], "content": r.get("content") or "",
                                "created_at": r.get("created_at")}
        if r["role"] == "assistant":
            item["cards"] = [c for c in r.get("cards") or [] if isinstance(c, dict)]
            item["answered"] = r.get("answered")
            item["feedback"] = r.get("feedback")
        out.append(item)
    return out


def get_history(session_id: str, authorization: Optional[str]) -> Dict[str, Any]:
    _claims, conv = owned_conversation(session_id, authorization)
    with db_session() as db:
        rows = repo.transcript(db, session_id)
    return {"session_id": session_id, "history": public_history(rows), "lead_status": conv.get("lead_status")}


def set_feedback(session_id: str, authorization: Optional[str], body: Dict[str, Any]) -> Dict[str, Any]:
    owned_conversation(session_id, authorization)
    try:
        mid = int(body.get("message_id"))
        rating = int(body.get("rating"))
    except (TypeError, ValueError):
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", "message_id and rating are required.")
    if rating not in (1, -1):
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", "rating must be 1 or -1.")
    with db_session() as db:
        ok = repo.set_feedback(db, session_id, mid, rating)
    if not ok:
        raise _deny(status.HTTP_404_NOT_FOUND, "not_found", "No such answer in this chat.")
    return {"status": "ok"}


# ── contact handoff ───────────────────────────────────────────────────────

def _clean_phone(v: Any) -> Optional[str]:
    if not isinstance(v, str) or not v.strip():
        return None
    s = v.strip()
    digits = re.sub(r"\D", "", s)
    if not 7 <= len(digits) <= 15:
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", "Please enter a valid phone number.")
    return ("+" if s.startswith("+") else "") + digits


def _clean_email(v: Any) -> Optional[str]:
    if not isinstance(v, str) or not v.strip():
        return None
    s = v.strip()
    if not _EMAIL_RE.match(s):
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", "Please enter a valid email address.")
    return s.lower()


def build_summary(rows: List[Dict[str, Any]], course_titles: List[str], page_title: Optional[str]) -> str:
    """Three lines for the counsellor: courses asked about, the questions, the page."""
    questions = [" ".join(str(r.get("content") or "").split())[:140] for r in rows if r.get("role") == "user"][-3:]
    lines = [
        "Courses asked about: " + (", ".join(course_titles[:4]) if course_titles else "none named"),
        "Questions: " + (" / ".join(questions) if questions else "none"),
        "Page: " + (page_title or "unknown"),
    ]
    return "\n".join(lines)


def _course_refs(rows: List[Dict[str, Any]]) -> Tuple[List[str], List[str]]:
    ids: List[str] = []
    titles: List[str] = []
    for r in rows:
        for c in r.get("cards") or []:
            if not isinstance(c, dict):
                continue
            items = c.get("items") if c.get("type") == "course_list" else (
                c.get("courses") if c.get("type") == "compare" else ([c] if c.get("type") == "course" else []))
            for item in items or []:
                if isinstance(item, dict) and item.get("id") and item["id"] not in ids:
                    ids.append(str(item["id"]))
                    titles.append(str(item.get("title") or ""))
    return ids, titles


# Keys admin_core sets itself (SiteAssistantLeadService + CatalogLeadService.RESERVED_FIELDS).
_LEAD_OWN_KEYS = {"full_name", "fullname", "name", "email", "phone", "mobile", "mobile_number", "message", "source",
                  "course_id", "lead_kind", "summary", "reason", "course_ids", "page_url", "conversation_id"}
_LEAD_KEY_RE = re.compile(r"^[A-Za-z0-9 _.\-]{1,64}$")


async def _campaign_values(institute_id: str, campaign_id: Optional[str], fields: Dict[str, str],
                           contact: Dict[str, Optional[str]]) -> Dict[str, str]:
    """The visitor's form answers as the lead's custom_fields, keyed the way admin_core resolves them.

    The card showed short keys (tools.campaign_fields); each stands for one custom field of the
    campaign, looked up again here and sent by its id — admin_core's saveCustomFieldValues matches
    a custom field id exactly (its "_inst_<instituteId>" field_key would be over the 64-character
    key limit). The name / email / phone the widget pulled out of the form go into the campaign's
    own name / email / phone fields too, so the lead shows them where the campaign expects them.
    A key that is not one of the campaign's fields is kept only when the lead API accepts it."""
    mapping: Dict[str, Any] = {}
    if campaign_id:
        try:
            mapping = campaign_field_map(await ac.campaign(institute_id, campaign_id))
        except ac.AdminCoreUnavailable:
            mapping = {}
    out: Dict[str, str] = {}
    for key, value in fields.items():
        spec = mapping.get(key.lower()) or mapping.get(short_field_key(key).lower())
        if spec is not None and spec.field_id:
            out[spec.field_id] = value
            continue
        # Not a campaign field: kept as sent (suffix aside) when the lead API takes the key, never cut.
        k = strip_inst_suffix(key) if spec is None else spec.card["key"]
        if k and _LEAD_KEY_RE.match(k) and k.lower() not in _LEAD_OWN_KEYS:
            out[k] = value
    for role, value in (("name", contact.get("name")), ("email", contact.get("email")), ("phone", contact.get("phone"))):
        spec = next((x for x in mapping.values() if x.role == role and x.field_id), None)
        if spec is not None and value:
            out.setdefault(spec.field_id, value)
    return dict(list(out.items())[:25])


async def submit_contact(session_id: str, authorization: Optional[str], body: Dict[str, Any]) -> Dict[str, Any]:
    _claims, conv = owned_conversation(session_id, authorization)
    kind = str(body.get("kind") or "").upper()
    if kind not in ("SALES", "SUPPORT"):
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", "kind must be SALES or SUPPORT.")
    if body.get("consent") is not True:
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", "Please agree to be contacted.")
    name = " ".join(str(body.get("full_name") or "").split())[:120]
    if not name:
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", "Please enter your name.")
    email, phone = _clean_email(body.get("email")), _clean_phone(body.get("phone"))
    if not email and not phone:
        raise _deny(status.HTTP_400_BAD_REQUEST, "invalid", "Please enter a phone number or an email address.")
    if conv.get("lead_status") == kind:
        return {"status": "duplicate"}
    if conv.get("ip_hash"):
        with db_session() as db:
            if repo.recent_leads_from_ip(db, conv["institute_id"], conv["ip_hash"]) >= LEADS_PER_IP_PER_DAY:
                raise _deny(status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited",
                            "We already have your details. Our team will be in touch.")
    fields_in = body.get("fields") if isinstance(body.get("fields"), dict) else {}
    fields = {str(k)[:200]: (" ".join(str(v).split())[:500] if not isinstance(v, (dict, list)) else None)
              for k, v in list(fields_in.items())[:20]}
    fields = {k: v for k, v in fields.items() if v}
    with db_session() as db:
        rows = repo.transcript(db, session_id)
    seen_ids, seen_titles = _course_refs(rows)
    asked = [str(x)[:64] for x in (body.get("course_ids") or []) if isinstance(x, (str, int))][:3]
    course_ids = list(dict.fromkeys(asked + seen_ids))[:5]
    last_page: Dict[str, Any] = {}
    reason = None
    card_campaign: Optional[str] = None
    for r in rows:
        if r.get("role") == "user" and isinstance(r.get("page"), dict):
            last_page = r["page"]
        for c in r.get("cards") or []:
            if isinstance(c, dict) and c.get("type") == "contact_form" and c.get("kind") == kind:
                reason = c.get("reason") or reason
                card_campaign = c.get("campaign_id") if isinstance(c.get("campaign_id"), str) else card_campaign
    ctx = await site_context(conv, {}, host=None)
    campaign_id = card_campaign if kind == "SALES" else None
    if kind == "SALES" and not campaign_id:
        stream = None
        if course_ids:
            try:
                course = await ac.catalog_course(conv["institute_id"], course_ids[0])
                stream = ((course or {}).get("stream") or {}).get("slug")
            except ac.AdminCoreUnavailable:
                stream = None
        campaign_id = campaign_for(ctx, kind, stream)
    custom = await _campaign_values(conv["institute_id"], campaign_id, fields,
                                    {"name": name, "email": email, "phone": phone})
    lead = {
        "institute_id": conv["institute_id"],
        "kind": kind,
        "campaign_id": campaign_id,
        "full_name": name,
        "email": email,
        "phone": phone,
        "course_ids": course_ids,
        "page_url": last_page.get("url") or conv.get("started_page"),
        "utm": conv.get("utm") or {},
        "summary": build_summary(rows, [t for t in seen_titles if t], last_page.get("title")),
        "reason": reason or ("Support request from the website assistant" if kind == "SUPPORT"
                             else "Enquiry from the website assistant"),
        "custom_fields": {**custom, "conversation_id": session_id},
    }
    try:
        result = await ac.submit_lead(lead)
    except ac.AdminCoreUnavailable as exc:
        logger.warning("site-assistant lead submit failed for %s: %s", session_id, exc)
        raise _deny(status.HTTP_502_BAD_GATEWAY, "internal", "We couldn't send your details. Please try again.")
    with db_session() as db:
        repo.set_lead(db, session_id, kind, result.get("lead_ref"))
    return {"status": result["status"]}
