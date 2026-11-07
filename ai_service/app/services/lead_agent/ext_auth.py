"""Chrome extension pairing tokens (spec §4.1).

An admin pairs an extension from the dashboard: a random token
(secrets.token_urlsafe(32)) is shown ONCE; only its sha256 hex is stored in
lead_agent_worker.token_hash. The extension sends it as `X-Lead-Agent-Token`;
an unknown or revoked token is 401.
"""
from __future__ import annotations

import asyncio
import hashlib
import secrets
from typing import Any, Dict, Optional, Tuple

from fastapi import Header, HTTPException, status

from . import db as ladb
from . import store

TOKEN_HEADER = "X-Lead-Agent-Token"


def new_token() -> Tuple[str, str]:
    """(token, sha256 hex)."""
    token = secrets.token_urlsafe(32)
    return token, token_hash(token)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.strip().encode("utf-8")).hexdigest()


def pair(*, institute_id: str, user_id: str, label: Optional[str]) -> Dict[str, Any]:
    token, digest = new_token()
    with ladb.session() as db:
        worker = store.insert_worker(db, institute_id=institute_id, user_id=user_id, label=label, token_hash=digest)
    return {"token": token, "worker_id": worker["id"]}


def _lookup(token: str) -> Optional[Dict[str, Any]]:
    with ladb.session() as db:
        return store.worker_by_token_hash(db, token_hash(token))


async def extension_worker(x_lead_agent_token: Optional[str] = Header(None, alias=TOKEN_HEADER)) -> Dict[str, Any]:
    """FastAPI dependency: the paired worker row, or 401."""
    token = (x_lead_agent_token or "").strip()
    if not token or len(token) > 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid extension token")
    worker = await asyncio.to_thread(_lookup, token)
    if worker is None or worker.get("revoked_at") is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown or revoked extension token")
    return worker


__all__ = ["TOKEN_HEADER", "new_token", "token_hash", "pair", "extension_worker"]
