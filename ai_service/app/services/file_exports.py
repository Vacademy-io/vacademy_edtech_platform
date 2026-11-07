"""
Private file exports — the ONE way an MCP / Assistant tool hands the admin a
file that must not go through the AI chat (credentials, PII exports, fee
statements …).

How a tool uses it::

    from .file_exports import create_export, link_result

    handle = create_export(ctx.db, institute_id=..., user_id=..., source_tool="learner_enroll",
                           kind="ENROLMENT_CREDENTIALS", file_name="logins.csv", content=csv_text,
                           metadata={"learners": 12})
    return {"credentials_file": link_result(handle)}

The model only ever sees the link ``{public}/ai-service/exports/{id}/{key}``;
the file never enters the chat transcript or the AI provider.

A new kind of file is added to ``EXPORT_KINDS`` (or ``register_kind``) with its
own policy — lifetime, download cap, size cap, allowed content types — so
every sensitive export is a deliberate decision, not a free-for-all.

Protection (table ``mcp_file_export``, Flyway V565):

* the content is encrypted with a key derived from BOTH the random secret in
  the link and a server secret — the row alone cannot be read; only a SHA-256
  of the link secret is stored, compared in constant time;
* a wrong key reveals nothing and does not use up a download;
* once used up, expired or revoked, the ciphertext is wiped immediately; the
  row stays as metadata-only audit (who generated what, from which tool, how
  often it was downloaded) and is deleted after ``RETENTION_DAYS``;
* responses are ``no-store`` / ``no-referrer`` / ``nosniff`` attachments.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple, Union
from urllib.parse import quote

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import db_dependency

logger = logging.getLogger(__name__)

EXPORT_PATH_PREFIX = "/ai-service/exports"
RETENTION_DAYS = 90
#: Hard ceiling for any kind: exports live inline in Postgres, not in object storage.
ABSOLUTE_MAX_BYTES = 20 * 1024 * 1024

STATUS_ACTIVE, STATUS_CONSUMED, STATUS_EXPIRED, STATUS_REVOKED = "ACTIVE", "CONSUMED", "EXPIRED", "REVOKED"

_ID_RE = re.compile(r"^[0-9a-f-]{36}$")
_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{30,100}$")
_FILE_NAME_RE = re.compile(r"[^\w.\- ]+", re.UNICODE)


@dataclass(frozen=True)
class ExportKind:
    """The policy for one kind of private file."""
    label: str                       # shown to the admin, e.g. "learner logins"
    ttl_minutes: int                 # how long the link works
    max_downloads: int               # downloads before the file is wiped (≥2: link unfurlers may take one)
    max_bytes: int                   # size cap (≤ ABSOLUTE_MAX_BYTES)
    content_types: Tuple[str, ...]   # allowed MIME types


#: Every kind of file a tool may export privately. Add one here (or with
#: register_kind from the tool's module) together with the tool that makes it.
EXPORT_KINDS: Dict[str, ExportKind] = {
    "ENROLMENT_CREDENTIALS": ExportKind(label="learner logins (usernames and passwords)", ttl_minutes=30,
                                        max_downloads=3, max_bytes=5 * 1024 * 1024, content_types=("text/csv",)),
}


def register_kind(name: str, kind: ExportKind) -> None:
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{2,63}", name):
        raise ValueError(f"export kind {name!r} must be UPPER_SNAKE_CASE")
    if kind.max_bytes > ABSOLUTE_MAX_BYTES or kind.ttl_minutes <= 0 or kind.max_downloads <= 0 or not kind.content_types:
        raise ValueError(f"export kind {name!r} has an invalid policy")
    EXPORT_KINDS[name] = kind


class ExportError(ValueError):
    """A tool asked for an export its kind's policy does not allow."""


@dataclass(frozen=True)
class ExportHandle:
    export_id: str
    url: str
    kind: str
    label: str
    file_name: str
    size_bytes: int
    expires_at: datetime
    max_downloads: int


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _fernet(key: str) -> Fernet:
    secret = get_settings().resolve_mcp_encryption_key().encode()
    digest = hmac.new(secret, key.encode(), hashlib.sha256).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _key_hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _clean_name(file_name: str) -> str:
    name = _FILE_NAME_RE.sub("_", str(file_name or "")).strip(" .")[:120]
    return name or "export"


def export_url(export_id: str, key: str) -> str:
    base = get_settings().ai_service_public_url.rstrip("/")
    return f"{base}{EXPORT_PATH_PREFIX}/{export_id}/{key}"


# ── lifecycle ────────────────────────────────────────────────────────────

def purge(db: Session) -> None:
    """Wipe the content of expired files and drop audit rows past retention. Cheap; run on every create."""
    now = _now()
    db.execute(text("""
        UPDATE mcp_file_export SET status = :expired, ciphertext = NULL, updated_at = :now
        WHERE status = :active AND expires_at <= :now
    """), {"expired": STATUS_EXPIRED, "active": STATUS_ACTIVE, "now": now})
    db.execute(text("DELETE FROM mcp_file_export WHERE created_at < :cutoff"),
               {"cutoff": now - timedelta(days=RETENTION_DAYS)})


def create_export(db: Session, *, institute_id: str, user_id: str, source_tool: str, kind: str, file_name: str,
                  content: Union[bytes, str], content_type: Optional[str] = None,
                  metadata: Optional[Dict[str, Any]] = None, ttl_minutes: Optional[int] = None,
                  max_downloads: Optional[int] = None) -> ExportHandle:
    """
    Store an encrypted file and return its one-off link. ``ttl_minutes`` / ``max_downloads`` may only
    TIGHTEN the kind's policy. ``metadata`` must be non-sensitive (counts, ids) — it is stored in clear.
    Raises ExportError on a policy violation; DB errors propagate (the caller decides what to tell the admin).
    """
    policy = EXPORT_KINDS.get(kind)
    if policy is None:
        raise ExportError(f"unknown export kind {kind!r} — add it to EXPORT_KINDS first")
    content_type = content_type or policy.content_types[0]
    if content_type not in policy.content_types:
        raise ExportError(f"{kind} exports may be {', '.join(policy.content_types)}, not {content_type}")
    data = content.encode("utf-8") if isinstance(content, str) else bytes(content)
    if len(data) > policy.max_bytes:
        raise ExportError(f"{kind} export is {len(data)} bytes; the limit is {policy.max_bytes}")
    ttl = min(ttl_minutes or policy.ttl_minutes, policy.ttl_minutes)
    cap = min(max_downloads or policy.max_downloads, policy.max_downloads)
    if not (institute_id and user_id and source_tool):
        raise ExportError("institute_id, user_id and source_tool are required")

    export_id, key, now = str(uuid.uuid4()), secrets.token_urlsafe(32), _now()
    expires_at = now + timedelta(minutes=ttl)
    name = _clean_name(file_name)
    purge(db)
    db.execute(text("""
        INSERT INTO mcp_file_export (id, institute_id, created_by_user_id, source_tool, kind, file_name, content_type,
                                     size_bytes, ciphertext, key_hash, status, download_count, max_downloads,
                                     expires_at, metadata_json, created_at, updated_at)
        VALUES (:id, :inst, :user, :tool, :kind, :name, :ctype, :size, :ct, :kh, :active, 0, :cap, :exp, :meta,
                :now, :now)
    """), {"id": export_id, "inst": institute_id, "user": user_id, "tool": source_tool[:100], "kind": kind,
           "name": name, "ctype": content_type, "size": len(data),
           "ct": _fernet(key).encrypt(data).decode("ascii"), "kh": _key_hash(key), "active": STATUS_ACTIVE,
           "cap": cap, "exp": expires_at, "meta": json.dumps(metadata, default=str) if metadata else None,
           "now": now})
    db.commit()
    logger.info("file export %s created: kind=%s tool=%s institute=%s bytes=%s", export_id, kind, source_tool,
                institute_id, len(data))
    return ExportHandle(export_id=export_id, url=export_url(export_id, key), kind=kind, label=policy.label,
                        file_name=name, size_bytes=len(data), expires_at=expires_at, max_downloads=cap)


def link_result(handle: ExportHandle, **extra: Any) -> Dict[str, Any]:
    """The standard tool-result block for a private file — same wording for every tool."""
    minutes = max(1, round((handle.expires_at - _now()).total_seconds() / 60))
    return {
        "status": "ready",
        "download_url": handle.url,
        "file_name": handle.file_name,
        "contains": handle.label,
        "expires_at": handle.expires_at.isoformat(),
        "expires_in_minutes": minutes,
        "max_downloads": handle.max_downloads,
        **extra,
        "note": (f"This file holds {handle.label}, so it is NOT shown in the chat. Give the admin this link exactly "
                 f"as is and do not open, fetch or summarise it yourself. It works for {minutes} minutes and "
                 f"{handle.max_downloads} downloads; after that ask again to create a new one."),
    }


def read_export(db: Session, export_id: str, key: str) -> Optional[Tuple[str, str, bytes]]:
    """(file_name, content_type, bytes) with one download counted, or None (unknown / wrong key / expired / used up)."""
    if not _ID_RE.match(export_id or "") or not _KEY_RE.match(key or ""):
        return None
    now = _now()
    # Atomic claim of one download; the CASE sees the pre-increment count.
    row = db.execute(text("""
        UPDATE mcp_file_export
        SET download_count = download_count + 1, last_downloaded_at = :now, updated_at = :now,
            status = CASE WHEN download_count + 1 >= max_downloads THEN :consumed ELSE status END
        WHERE id = :id AND status = :active AND expires_at > :now AND ciphertext IS NOT NULL
        RETURNING file_name, content_type, ciphertext, key_hash, status
    """), {"id": export_id, "now": now, "consumed": STATUS_CONSUMED, "active": STATUS_ACTIVE}).mappings().first()
    if row is None or not hmac.compare_digest(row["key_hash"], _key_hash(key)):
        db.rollback()  # a wrong key must not use up a download
        return None
    try:
        content = _fernet(key).decrypt(row["ciphertext"].encode("ascii"))
    except InvalidToken:
        db.rollback()
        return None
    if row["status"] == STATUS_CONSUMED:
        db.execute(text("UPDATE mcp_file_export SET ciphertext = NULL WHERE id = :id"), {"id": export_id})
    db.commit()
    return row["file_name"], row["content_type"], content


def revoke_export(db: Session, export_id: str, institute_id: str) -> bool:
    """Kill a link now (e.g. the admin shared it by mistake). Scoped to the institute that created it."""
    result = db.execute(text("""
        UPDATE mcp_file_export SET status = :revoked, ciphertext = NULL, updated_at = :now
        WHERE id = :id AND institute_id = :inst AND status = :active
    """), {"revoked": STATUS_REVOKED, "now": _now(), "id": export_id, "inst": institute_id, "active": STATUS_ACTIVE})
    db.commit()
    return bool(result.rowcount)


# ── download route ───────────────────────────────────────────────────────

router = APIRouter(prefix=EXPORT_PATH_PREFIX, tags=["exports"])

_GONE = "This download link has expired or was already used. Ask the AI assistant to create a new one."
_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex"}


def _disposition(file_name: str) -> str:
    ascii_name = file_name.encode("ascii", "ignore").decode() or "export"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(file_name)}"


@router.get("/{export_id}/{key}", include_in_schema=False)
def download_export(export_id: str, key: str, db: Session = Depends(db_dependency)) -> Response:
    found = read_export(db, export_id, key)
    if found is None:
        return Response(_GONE, status_code=status.HTTP_410_GONE, media_type="text/plain", headers=dict(_HEADERS))
    file_name, content_type, content = found
    return Response(content, media_type=content_type,
                    headers={**_HEADERS, "Content-Disposition": _disposition(file_name)})


__all__ = ["ExportKind", "ExportHandle", "ExportError", "EXPORT_KINDS", "register_kind", "create_export",
           "link_result", "read_export", "revoke_export", "purge", "export_url", "router", "EXPORT_PATH_PREFIX",
           "RETENTION_DAYS", "STATUS_ACTIVE", "STATUS_CONSUMED", "STATUS_EXPIRED", "STATUS_REVOKED"]
