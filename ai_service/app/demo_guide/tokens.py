"""Visitor session tokens of the demo guide.

HS256 over ``DEMO_GUIDE_TOKEN_SECRET`` only: there is NO fallback to another
secret, so a missing variable means no token can be minted or verified (the
guide answers 503 ``disabled``). Audience ``demo-guide``, claims
{sid, product, vid, exp}, 12 hours. A Site Assistant token (other secret,
other audience) is never a demo-guide token and vice versa.
"""
from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from jose import jwt

from ..site_assistant.tokens import bearer, visitor_id  # same header / visitor-id rules  # noqa: F401
from .settings import SESSION_TTL_SECONDS

ALGORITHM = "HS256"
AUDIENCE = "demo-guide"
MIN_SECRET_CHARS = 16


class TokenSecretMissing(RuntimeError):
    """DEMO_GUIDE_TOKEN_SECRET is not set (or too short to be a secret)."""


def secret() -> Optional[bytes]:
    raw = (os.getenv("DEMO_GUIDE_TOKEN_SECRET") or "").strip()
    return raw.encode() if len(raw) >= MIN_SECRET_CHARS else None


def configured() -> bool:
    return secret() is not None


@dataclass(frozen=True)
class SessionClaims:
    sid: str
    product: str
    vid: str
    exp: int


def mint(*, sid: str, product: str, vid: str, now: Optional[int] = None) -> Dict[str, Any]:
    key = secret()
    if key is None:
        raise TokenSecretMissing("DEMO_GUIDE_TOKEN_SECRET is not set")
    now = int(now if now is not None else time.time())
    exp = now + SESSION_TTL_SECONDS
    claims = {"sid": sid, "product": product, "vid": vid, "exp": exp, "iat": now, "aud": AUDIENCE}
    return {"token": jwt.encode(claims, key, algorithm=ALGORITHM), "exp": exp}


def verify(token: Optional[str]) -> Optional[SessionClaims]:
    """Claims of a valid, unexpired demo-guide token, else None."""
    key = secret()
    if not token or key is None:
        return None
    try:
        c = jwt.decode(token, key, algorithms=[ALGORITHM], audience=AUDIENCE)
        if c.get("aud") != AUDIENCE:      # python-jose lets a token with NO aud claim through
            return None
        return SessionClaims(sid=str(c["sid"]), product=str(c["product"]), vid=str(c["vid"]), exp=int(c["exp"]))
    except Exception:  # noqa: BLE001 - any invalid token is simply not a session
        return None


def ip_hash(ip: str) -> str:
    """The only form in which a visitor's address is kept or compared. Salted
    with the token secret, so the hash cannot be reversed by listing addresses
    without it."""
    salt = secret() or b"demo-guide"
    return hashlib.sha256(salt + b":ip:" + (ip or "").encode()).hexdigest()
