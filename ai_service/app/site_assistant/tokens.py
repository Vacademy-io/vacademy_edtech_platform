"""Visitor session tokens, visitor ids and hashed network identity.

A session token is HS256 over a key DERIVED for this purpose
(``SITE_ASSISTANT_TOKEN_SECRET``, else HMAC(<server secret>, "site-assistant/v1")),
so a visitor token can never be replayed as a platform access token and vice
versa. Claims: {sid, iid, tag, vid, ch, exp}. Every call after session start
must carry it, and the conversation row must agree with every claim.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from jose import jwt

from ..config import get_settings
from .settings import SESSION_TTL_SECONDS

ALGORITHM = "HS256"
CHANNELS = ("HOSTED", "EMBED", "PREVIEW")
_VISITOR_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_AUDIENCE = "site-assistant"


def _secret() -> bytes:
    explicit = os.getenv("SITE_ASSISTANT_TOKEN_SECRET")
    if explicit:
        return explicit.encode()
    settings = get_settings()
    base = settings.internal_service_token or settings.jwt_secret_key or ""
    return hmac.new(base.encode(), b"site-assistant/v1", hashlib.sha256).digest()


@dataclass(frozen=True)
class SessionClaims:
    sid: str
    iid: str
    tag: str
    vid: str
    ch: str
    exp: int


def mint(*, sid: str, iid: str, tag: str, vid: str, ch: str, now: Optional[int] = None) -> Dict[str, Any]:
    if ch not in CHANNELS:
        raise ValueError("bad channel")
    now = int(now if now is not None else time.time())
    exp = now + SESSION_TTL_SECONDS
    claims = {"sid": sid, "iid": iid, "tag": tag, "vid": vid, "ch": ch, "exp": exp, "iat": now, "aud": _AUDIENCE}
    return {"token": jwt.encode(claims, _secret(), algorithm=ALGORITHM), "exp": exp}


def verify(token: Optional[str]) -> Optional[SessionClaims]:
    """Claims of a valid, unexpired token, else None."""
    if not token:
        return None
    try:
        c = jwt.decode(token, _secret(), algorithms=[ALGORITHM], audience=_AUDIENCE)
    except Exception:  # noqa: BLE001 - any invalid token is simply not a session
        return None
    try:
        claims = SessionClaims(sid=str(c["sid"]), iid=str(c["iid"]), tag=str(c["tag"]), vid=str(c["vid"]),
                               ch=str(c["ch"]), exp=int(c["exp"]))
    except (KeyError, TypeError, ValueError):
        return None
    if claims.ch not in CHANNELS:
        return None
    return claims


def bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return authorization[len("Bearer "):].strip() or None


def visitor_id(raw: Any) -> str:
    """The visitor's own opaque id when well-formed, else a fresh one."""
    if isinstance(raw, str) and _VISITOR_RE.match(raw):
        return raw
    return "v_" + secrets.token_urlsafe(18)


def _salt() -> str:
    return (get_settings().jwt_secret_key or "site-assistant")[:16]


def hash_key(kind: str, value: str) -> str:
    """Cap-table key: 'v:' (visitor answers) / 'ip:' (network answers) / 's:' (network's new
    chats) + a salted hash, 64 chars max."""
    digest = hashlib.sha256(f"{_salt()}:{kind}:{value}".encode()).hexdigest()
    prefix = "v:" if kind == "v" else ("s:" if kind == "s" else "ip:")
    return (prefix + digest)[:64]


def ip_hash(ip: str) -> str:
    return hashlib.sha256(f"{_salt()}:ip:{ip}".encode()).hexdigest()
