"""Sessions, ownership, speech, microphone, contact handoff and the staff views.

Who the visitor talks to is decided on the server: the product names a
settings entry, and the browser's Origin must be one of that product's
``stage_origins`` (localhost only outside production). After POST /sessions
every call carries the signed session token, and the session row must agree
with every claim in it. Nothing the browser sends as an institute, a lead
list or a text to speak is ever read.
"""
from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException, Request, status

from ..db import db_session
from . import app_session
from . import caps
from . import catalog as cat
from . import internal_client as ac
from . import repository as repo
from . import settings as S
from . import speech as SP
from . import tokens as T
from . import usage

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$")
_UTM_KEYS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content")
_UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


def deny(code: int, error: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": error, "message": message})


def client_ip(request: Request) -> str:
    from ..site_assistant.service import client_ip as _ip      # CF-Connecting-IP first, as Site Assistant does
    return _ip(request)


# ── origin ────────────────────────────────────────────────────────────────

def request_origin(request: Request) -> Optional[str]:
    """The browser page's origin: the Origin header, else the Referer's origin."""
    return S.normalize_origin(request.headers.get("origin")) or S.normalize_origin(request.headers.get("referer"))


def require_origin(request: Request, product: S.Product, *, optional: bool = False) -> Optional[str]:
    """403 unless the page is one of the product's stage origins. `optional`:
    a request with no Origin and no Referer passes (an <audio> element sends
    neither for a media fetch); a present one must still be allowed."""
    origin = request_origin(request)
    if origin is None and optional:
        return None
    if not product.origin_allowed(origin):
        raise deny(status.HTTP_403_FORBIDDEN, "origin_not_allowed", "This page cannot use the demo guide.")
    return origin


def require_enabled() -> None:
    if not S.enabled() or not T.configured():
        if S.enabled():
            logger.error("demo-guide: enabled but DEMO_GUIDE_TOKEN_SECRET is not set")
        raise deny(status.HTTP_503_SERVICE_UNAVAILABLE, "disabled", "The demo guide is not available right now.")


# ── POST /sessions ────────────────────────────────────────────────────────

def _https_url(raw: Any, cap: int = 2000) -> Optional[str]:
    if not isinstance(raw, str) or not raw.strip():
        return None
    url = raw.strip()[:cap]
    return url if url.lower().startswith(("https://", "http://localhost", "http://127.0.0.1")) else None


def clean_utm(raw: Any, page_url: Optional[str], referrer: Optional[str]) -> Optional[Dict[str, str]]:
    """UTM tags from the body, else from the page URL's query; plus the referrer."""
    out: Dict[str, str] = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            key = str(k).strip().lower()
            if key in _UTM_KEYS and isinstance(v, (str, int)) and str(v).strip():
                out[key] = " ".join(str(v).split())[:191]
    if not out and page_url:
        try:
            qs = parse_qs(urlsplit(page_url).query)
        except ValueError:
            qs = {}
        out = {k: v[0][:191] for k, v in qs.items() if k in _UTM_KEYS and v and v[0]}
    if referrer:
        out["referrer"] = referrer[:500]
    return out or None


async def open_session(request: Request, body: Dict[str, Any]) -> Dict[str, Any]:
    require_enabled()
    product = S.product(body.get("product"))
    if product is None:
        raise deny(status.HTTP_404_NOT_FOUND, "unknown_product", "This demo is not known.")
    origin = require_origin(request, product)
    if await cat.load_catalog(product.catalog_url) is None:
        raise deny(status.HTTP_503_SERVICE_UNAVAILABLE, "disabled", "The demo guide is not available right now.")
    lang = S.clean_lang(body.get("lang"))
    vid = T.visitor_id(body.get("visitor_id"))
    page_url = _https_url(body.get("page_url"))
    referrer = _https_url(body.get("referrer"), 500)
    iph = T.ip_hash(client_ip(request))
    with db_session() as db:
        sid = repo.create_session(db, product=product.key, lang=lang, visitor_id=vid, ip_hash=iph, origin=origin,
                                  page_url=page_url, utm=clean_utm(body.get("utm"), page_url, referrer),
                                  ip_cap=S.cap("sessions_per_ip_per_day", db))
    if sid is None:
        raise deny(status.HTTP_429_TOO_MANY_REQUESTS, "capped",
                   "Too many demos were started from your network today. Please try again tomorrow.")
    minted = T.mint(sid=sid, product=product.key, vid=vid)
    try:
        app = await app_session.app_tokens(product.app_institute_id)
    except Exception:  # noqa: BLE001 - the session still works without the framed app
        logger.exception("demo-guide: demo user sign-in failed")
        app = None
    return {"session_id": sid, "token": minted["token"], "lang": lang, "app": app}


# ── ownership ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Owned:
    claims: T.SessionClaims
    session: Dict[str, Any]
    product: S.Product


def owned_session(session_id: str, token: Optional[str]) -> Owned:
    """The session this token owns, and its product: 401 / 403 / 404 otherwise."""
    claims = T.verify(token)
    if claims is None:
        raise deny(status.HTTP_401_UNAUTHORIZED, "invalid_token", "Your demo session has expired. Please reload.")
    if claims.sid != session_id:
        raise deny(status.HTTP_403_FORBIDDEN, "forbidden", "This demo belongs to another session.")
    with db_session() as db:
        session = repo.get_session(db, session_id)
    if not session or session["product"] != claims.product or session["visitor_id"] != claims.vid:
        raise deny(status.HTTP_403_FORBIDDEN, "forbidden", "This demo belongs to another session.")
    product = S.product(claims.product)
    if product is None:
        raise deny(status.HTTP_404_NOT_FOUND, "unknown_product", "This demo is not known.")
    return Owned(claims=claims, session=session, product=product)


# ── speech ────────────────────────────────────────────────────────────────

async def reply_speech(request: Request, session_id: str, message_id: str, n: int,
                       token: Optional[str]) -> Tuple[bytes, str]:
    """Audio of sentence `n` of one of the guide's own replies in this session."""
    require_enabled()
    owned = owned_session(session_id, token)
    require_origin(request, owned.product, optional=True)
    if not _UUID_RE.match(message_id or "") or n < 0 or n > 200:
        raise deny(status.HTTP_404_NOT_FOUND, "not_found", "No such sentence.")
    key = (session_id, message_id, n)
    hit = SP.reply_cache.get(key)
    if hit:
        return hit
    with db_session() as db:
        msg = repo.get_message(db, session_id, message_id)
    actions = (msg or {}).get("actions") if isinstance((msg or {}).get("actions"), dict) else {}
    sentences = actions.get("sentences") if isinstance(actions.get("sentences"), list) else []
    if not msg or msg.get("role") != "assistant" or n >= len(sentences) or not str(sentences[n]).strip():
        raise deny(status.HTTP_404_NOT_FOUND, "not_found", "No such sentence.")
    text = str(sentences[n]).strip()[:1000]
    lang = S.clean_lang(actions.get("lang"), default=owned.session.get("lang") or "en")

    def reserve() -> bool:
        with db_session() as db:
            return caps.take_speech(db, session_id, len(text))

    try:
        result = await SP.synthesize(SP.reply_cache, key, text, lang, before=reserve)
    except PermissionError:
        raise deny(status.HTTP_429_TOO_MANY_REQUESTS, "capped", "The guide's voice has reached its limit for this demo.")
    if result is None:
        raise deny(status.HTTP_502_BAD_GATEWAY, "speech_unavailable", "The voice is not available right now.")
    audio, mime, provider = result
    if provider:
        usage.record_speech(institute_id=owned.product.lead_institute_id, provider=provider, characters=len(text),
                            lang=lang, product=owned.product.key, session_id=session_id, feature="demo_guide_speech")
    return audio, mime


async def narration(request: Request, product_key: str, tour_id: str, step: int,
                    lang: Optional[str]) -> Tuple[bytes, str, str]:
    """(audio, mime, etag) of a tour step's `say` line. The text comes from the
    catalogue only; the caller picks which line, never what is said."""
    require_enabled()
    product = S.product(product_key)
    if product is None:
        raise deny(status.HTTP_404_NOT_FOUND, "unknown_product", "This demo is not known.")
    if not caps.take_narration(T.ip_hash(client_ip(request))):
        raise deny(status.HTTP_429_TOO_MANY_REQUESTS, "capped", "Too many requests today.")
    catalogue = await cat.load_catalog(product.catalog_url)
    line = cat.step_say(catalogue, tour_id, step, S.clean_lang(lang)) if catalogue else None
    if line is None:
        raise deny(status.HTTP_404_NOT_FOUND, "not_found", "No such tour step.")
    text, text_lang = line                      # a missing language falls back to the English line, English voice
    etag = SP.etag_for(text, text_lang)
    if etag in _etags(request.headers.get("if-none-match")):
        return b"", "", etag
    result = await SP.synthesize(SP.narration_cache, (etag, text_lang), text, text_lang)
    if result is None:
        raise deny(status.HTTP_502_BAD_GATEWAY, "speech_unavailable", "The voice is not available right now.")
    audio, mime, provider = result
    if provider:
        usage.record_speech(institute_id=product.lead_institute_id, provider=provider, characters=len(text),
                            lang=text_lang, product=product.key, session_id=None, feature="demo_guide_narration")
    return audio, mime, etag


def _etags(header: Optional[str]) -> List[str]:
    return [p.strip().removeprefix("W/").strip('"') for p in (header or "").split(",") if p.strip()]


# ── microphone ────────────────────────────────────────────────────────────

def listen_begin(request: Request, session_id: str, authorization: Optional[str]) -> Tuple[Owned, float]:
    """Everything that can refuse a recording BEFORE its body is read: the
    switch, the token, the origin, the language, the declared size and the
    session's remaining seconds. → (session, seconds left)."""
    require_enabled()
    owned = owned_session(session_id, T.bearer(authorization))
    require_origin(request, owned.product)
    if (owned.session.get("lang") or "en") not in S.LISTEN_LANGS:
        raise deny(status.HTTP_422_UNPROCESSABLE_ENTITY, "language_not_supported",
                   "The microphone is not available in this language yet.")
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared > S.LISTEN_MAX_BYTES + 64 * 1024:          # the audio plus the multipart envelope
        raise deny(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "too_large", "The recording is too large.")
    with db_session() as db:
        left = caps.listen_left(db, owned.session)
    if left <= 0:
        raise deny(status.HTTP_429_TOO_MANY_REQUESTS, "capped", "The microphone has reached its limit for this demo.")
    return owned, left


async def listen(owned: Owned, left: float, audio: bytes, mime: Optional[str]) -> Dict[str, Any]:
    session_id = owned.session["id"]
    lang = owned.session.get("lang") or "en"
    if not audio:
        raise deny(status.HTTP_400_BAD_REQUEST, "invalid", "No audio was sent.")
    if len(audio) > S.LISTEN_MAX_BYTES:
        raise deny(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "too_large", "The recording is too large.")
    from ..services import speech_to_text as stt
    if not stt.is_accepted_audio_type(mime):
        raise deny(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "invalid", "This audio format is not supported.")
    try:
        result = await stt.transcribe_audio(audio, mime, language=stt.normalize_language(lang),
                                            max_seconds=min(S.LISTEN_MAX_SECONDS, left), require_decoded=True,
                                            min_speech_wav_bytes=stt.MIN_SPEECH_WAV_BYTES)
    except stt.SpeechTooLongError:
        raise deny(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "too_long", "The recording is too long.")
    except (stt.UndecodableAudioError, stt.UnsupportedLanguageError):
        raise deny(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid", "The recording could not be read.")
    except Exception as exc:  # noqa: BLE001 - provider failure
        logger.warning("demo-guide: transcription failed (session %s): %s", session_id, type(exc).__name__)
        raise deny(status.HTTP_502_BAD_GATEWAY, "listen_unavailable", "The microphone is not available right now.")
    seconds = int(math.ceil(result.duration_seconds or 0))
    text = " ".join((result.transcript or "").split())[:S.MAX_TEXT_CHARS]
    with db_session() as db:
        repo.add_listen_seconds(db, session_id, seconds)
    if result.provider_called:
        usage.record_listen(institute_id=owned.product.lead_institute_id, seconds=result.duration_seconds,
                            characters=len(text), lang=lang)
    return {"text": text, "lang": lang}


# ── contact handoff ───────────────────────────────────────────────────────

def clean_contact(body: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """The validated form: consent, a name and a phone or an email. 400 otherwise."""
    bad = status.HTTP_400_BAD_REQUEST
    if body.get("consent") is not True:
        raise deny(bad, "invalid", "Please agree to be contacted.")
    name = " ".join(str(body.get("name") or "").split())[:120] if isinstance(body.get("name"), str) else ""
    if len(name) < 2:
        raise deny(bad, "invalid", "Please enter your name.")
    email = phone = None
    raw_email = body.get("email")
    if isinstance(raw_email, str) and raw_email.strip():
        if not _EMAIL_RE.match(raw_email.strip()):
            raise deny(bad, "invalid", "Please enter a valid email address.")
        email = raw_email.strip().lower()
    raw_phone = body.get("phone")
    if isinstance(raw_phone, str) and raw_phone.strip():
        digits = re.sub(r"\D", "", raw_phone)
        if not 7 <= len(digits) <= 15:
            raise deny(bad, "invalid", "Please enter a valid phone number.")
        phone = ("+" if raw_phone.strip().startswith("+") else "") + digits
    if not email and not phone:
        raise deny(bad, "invalid", "Please enter a phone number or an email address.")
    org = body.get("organisation") if isinstance(body.get("organisation"), str) else body.get("organization")
    organisation = " ".join(str(org).split())[:200] if isinstance(org, str) and org.strip() else None
    return {"name": name, "email": email, "phone": phone, "organisation": organisation}


def build_summary(session: Dict[str, Any], rows: List[Dict[str, Any]], catalogue: Optional[Dict[str, Any]],
                  organisation: Optional[str]) -> str:
    """A few lines for the salesperson: audience, what they asked, tours watched, notes, page, UTM."""
    q = session.get("qualification") if isinstance(session.get("qualification"), dict) else {}
    asked = [" ".join(str(r.get("text") or "").split())[:140] for r in rows
             if r.get("role") == "user" and r.get("kind") in ("text", "choice") and r.get("text")][-4:]
    tours: List[str] = []
    for t in session.get("tours") or []:
        if isinstance(t, dict) and t.get("id"):
            title = cat.tour_title(catalogue, t["id"])
            label = title + (" (stopped early)" if t.get("finished") is False else "")
            if label not in tours:
                tours.append(label)
    notes = [f"{k.replace('_', ' ')}: {v}" for k, v in q.items() if k != "audience" and v]
    utm = session.get("utm") if isinstance(session.get("utm"), dict) else {}
    lines = [
        "Demo guide lead (" + str(session.get("product")) + ", language " + str(session.get("lang")) + ")",
        "Audience: " + (str(q.get("audience")) if q.get("audience") else "not stated"),
        "Organisation: " + (organisation or "not stated"),
        "Asked: " + (" / ".join(asked) if asked else "nothing typed"),
        "Tours watched: " + (", ".join(tours[:8]) if tours else "none"),
        "Notes: " + ("; ".join(notes)[:500] if notes else "none"),
        "Page: " + str(session.get("page_url") or "unknown"),
        "UTM: " + (", ".join(f"{k}={v}" for k, v in utm.items()) if utm else "none"),
    ]
    return "\n".join(lines)[:1900]


async def submit_contact(request: Request, session_id: str, authorization: Optional[str],
                         body: Dict[str, Any]) -> Dict[str, Any]:
    require_enabled()
    owned = owned_session(session_id, T.bearer(authorization))
    require_origin(request, owned.product)
    contact = clean_contact(body)
    session, product = owned.session, owned.product
    if session.get("lead_id"):
        return {"ok": True}                       # sent already in this session
    with db_session() as db:
        if not caps.contact_allowed(db, session.get("ip_hash")):
            raise deny(status.HTTP_429_TOO_MANY_REQUESTS, "capped",
                       "We already have your details. Our team will be in touch.")
        rows = repo.transcript(db, session_id)
    catalogue = await cat.load_catalog(product.catalog_url)
    reason = None
    for r in rows:
        form = (r.get("actions") or {}).get("form") if isinstance(r.get("actions"), dict) else None
        if isinstance(form, dict) and form.get("reason"):
            reason = str(form["reason"])
    utm = {k: v for k, v in (session.get("utm") or {}).items() if k in _UTM_KEYS} if isinstance(session.get("utm"), dict) else {}
    custom = {"conversation_id": session_id, "demo_product": product.key}
    if contact["organisation"]:
        custom["organisation"] = contact["organisation"]
    lead = {
        "institute_id": product.lead_institute_id,
        "kind": "SALES",
        "campaign_id": product.audience_id,
        "full_name": contact["name"],
        "email": contact["email"],
        "phone": contact["phone"],
        "page_url": session.get("page_url"),
        "utm": utm,
        "summary": build_summary(session, rows, catalogue, contact["organisation"]),
        "reason": (reason or "Asked for a call from the product demo")[:480],
        "custom_fields": custom,
    }
    try:
        result = await ac.submit_lead(lead)
    except ac.AdminCoreUnavailable as exc:
        logger.warning("demo-guide: lead submit failed for %s: %s", session_id, exc)
        raise deny(status.HTTP_502_BAD_GATEWAY, "internal", "We couldn't send your details. Please try again.")
    with db_session() as db:
        repo.set_lead(db, session_id, result.get("lead_ref") or result["status"])
    return {"ok": True}


# ── staff ─────────────────────────────────────────────────────────────────

async def staff_products(request: Request) -> List[str]:
    """Products whose leads belong to the caller's institute. The caller must be
    an ADMIN of the clientId institute (verified JWT pinned to it)."""
    from ..site_assistant import service as sa
    staff = await sa.staff_from_request(request)
    if not staff.is_admin:
        raise deny(status.HTTP_403_FORBIDDEN, "forbidden", "Only an admin can see the demo conversations.")
    mine = [p.key for p in S.products().values() if p.lead_institute_id == staff.institute_id]
    if not mine:
        raise deny(status.HTTP_403_FORBIDDEN, "forbidden", "No demo belongs to this institute.")
    return mine


def _session_view(row: Dict[str, Any]) -> Dict[str, Any]:
    tours = [t for t in (row.get("tours") or []) if isinstance(t, dict)]
    return {
        "id": row["id"], "product": row.get("product"), "lang": row.get("lang"), "origin": row.get("origin"),
        "page_url": row.get("page_url"), "utm": row.get("utm") or {}, "qualification": row.get("qualification") or {},
        "turns": row.get("turns") or 0, "tours": tours, "lead": bool(row.get("lead") or row.get("lead_id")),
        "lead_id": row.get("lead_id"), "speech_chars": row.get("speech_chars") or 0,
        "listen_seconds": row.get("listen_seconds") or 0, "created_at": row.get("created_at"),
        "last_at": row.get("last_at"),
    }


def admin_sessions(products: List[str], page: int, size: int, lead: Optional[bool]) -> Dict[str, Any]:
    with db_session() as db:
        found = repo.list_sessions(db, products, page=page, size=size, lead=lead)
    return {**found, "items": [_session_view(r) for r in found["items"]]}


def admin_session(products: List[str], session_id: str) -> Dict[str, Any]:
    with db_session() as db:
        row = repo.get_session(db, session_id)
        if not row or row.get("product") not in products:
            raise deny(status.HTTP_404_NOT_FOUND, "not_found", "No such demo conversation.")
        rows = repo.transcript(db, session_id)
    transcript = []
    for r in rows:
        actions = r.get("actions") if isinstance(r.get("actions"), dict) else {}
        item: Dict[str, Any] = {"id": r["id"], "role": r["role"], "kind": r.get("kind"), "text": r.get("text") or "",
                                "created_at": r.get("created_at")}
        shown = {k: actions[k] for k in ("choices", "tour", "form", "choice_id", "tour_id", "finished", "spoken",
                                         "fixed", "error") if k in actions}
        if shown:
            item["actions"] = shown
        transcript.append(item)
    return {"session": _session_view(row), "transcript": transcript}
