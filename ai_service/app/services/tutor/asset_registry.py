"""Teacher voices and avatars an institute may use (see models/tutor_asset_registry).

Visibility: platform stock (institute_id NULL, status ready) + the caller's
own rows in any status. Validation: a saved avatar id must be a ready row the
institute may see; a saved voice id that is registered to ANOTHER institute
is refused (stock catalogue voices are not registered, so they pass).
One-time charges: `tutor_voice_clone` when a clone is made,
`tutor_avatar_create` when an avatar request is fulfilled."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...models.ai_token_usage import RequestType
from ...models.tutor_asset_registry import KINDS, STATUSES

logger = logging.getLogger(__name__)

VOICE_CLONE_TOOL = "tutor_voice_clone"
AVATAR_CREATE_TOOL = "tutor_avatar_create"

_COLS = ("id", "kind", "provider", "external_id", "display_name", "institute_id", "status", "gender", "languages",
         "preview_url", "source_file_id", "consent", "requested_by", "vendor_job_id", "credits_charged", "error",
         "notes", "created_at", "updated_at", "fulfilled_at")
_SELECT = "SELECT " + ", ".join(f"a.{c}" for c in _COLS) + " FROM tutor_asset_registry a"


def _row(r) -> Dict[str, Any]:
    d = dict(zip(_COLS, r))
    d["languages"] = [x for x in (d.get("languages") or "").split(",") if x]
    d["stock"] = d["institute_id"] is None
    d["credits_charged"] = float(d["credits_charged"] or 0)
    for k in ("created_at", "updated_at", "fulfilled_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].isoformat()
    return d


def get(db: Session, asset_id: str) -> Optional[Dict[str, Any]]:
    r = db.execute(text(_SELECT + " WHERE a.id = :i"), {"i": asset_id}).first()
    return _row(r) if r else None


def visible(db: Session, *, institute_id: str, kind: Optional[str] = None) -> List[Dict[str, Any]]:
    """Stock (ready) plus the institute's own rows, own first, newest first."""
    sql = _SELECT + """ WHERE ((a.institute_id IS NULL AND a.status = 'ready') OR a.institute_id = :inst)
                        AND a.status <> 'disabled'"""
    params: Dict[str, Any] = {"inst": institute_id}
    if kind:
        sql += " AND a.kind = :k"; params["k"] = kind
    sql += " ORDER BY (a.institute_id IS NULL), a.created_at DESC"
    return [_row(r) for r in db.execute(text(sql), params).fetchall()]


def list_all(db: Session, *, kind: Optional[str] = None, institute_id: Optional[str] = None,
             status: Optional[str] = None, stock_only: bool = False, limit: int = 500) -> List[Dict[str, Any]]:
    """Super admin: every row, with the institute's name."""
    sql = ("SELECT " + ", ".join(f"a.{c}" for c in _COLS) + ", i.name FROM tutor_asset_registry a "
           "LEFT JOIN institutes i ON i.id = a.institute_id WHERE 1=1")
    params: Dict[str, Any] = {"lim": max(1, min(limit, 2000))}
    if kind:
        sql += " AND a.kind = :k"; params["k"] = kind
    if institute_id:
        sql += " AND a.institute_id = :inst"; params["inst"] = institute_id
    if stock_only:
        sql += " AND a.institute_id IS NULL"
    if status:
        sql += " AND a.status = :s"; params["s"] = status
    sql += " ORDER BY CASE a.status WHEN 'requested' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END, a.created_at DESC LIMIT :lim"
    out = []
    for r in db.execute(text(sql), params).fetchall():
        d = _row(r[:-1]); d["institute_name"] = r[-1]; out.append(d)
    return out


def create(db: Session, *, kind: str, provider: str, display_name: str, institute_id: Optional[str],
           external_id: Optional[str] = None, status: str = "ready", gender: Optional[str] = None,
           languages: Optional[List[str]] = None, preview_url: Optional[str] = None,
           source_file_id: Optional[str] = None, consent: bool = False, requested_by: Optional[str] = None,
           vendor_job_id: Optional[str] = None, notes: Optional[str] = None) -> Dict[str, Any]:
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    asset_id = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO tutor_asset_registry (id, kind, provider, external_id, display_name, institute_id, status, gender,
            languages, preview_url, source_file_id, consent, requested_by, vendor_job_id, notes, fulfilled_at)
        VALUES (:id, :kind, :provider, :ext, :name, :inst, :status, :gender, :langs, :preview, :src, :consent,
                :by, :job, :notes, CASE WHEN CAST(:ready AS BOOLEAN) THEN now() ELSE NULL END)
    """), {"id": asset_id, "ready": status == "ready", "kind": kind, "provider": provider[:32], "ext": (external_id or None) and external_id[:160],
           "name": display_name[:120], "inst": institute_id, "status": status, "gender": gender,
           "langs": ",".join(languages or [])[:120] or None, "preview": preview_url, "src": source_file_id,
           "consent": bool(consent), "by": requested_by, "job": vendor_job_id, "notes": notes})
    db.commit()
    return get(db, asset_id)  # type: ignore[return-value]


_UPDATABLE = {"external_id", "display_name", "institute_id", "status", "gender", "languages", "preview_url",
              "vendor_job_id", "error", "notes", "consent"}


def update(db: Session, asset_id: str, **fields: Any) -> Optional[Dict[str, Any]]:
    sets, params = [], {"id": asset_id}
    for k, v in fields.items():
        if k not in _UPDATABLE:
            continue
        if k == "languages" and isinstance(v, list):
            v = ",".join(v)[:120] or None
        if k == "status" and v not in STATUSES:
            raise ValueError(f"status must be one of {STATUSES}")
        sets.append(f"{k} = :{k}"); params[k] = v
    if not sets:
        return get(db, asset_id)
    sets.append("updated_at = now()")
    if fields.get("status") == "ready":
        sets.append("fulfilled_at = COALESCE(fulfilled_at, now())")
    db.execute(text(f"UPDATE tutor_asset_registry SET {', '.join(sets)} WHERE id = :id"), params)
    db.commit()
    return get(db, asset_id)


def delete(db: Session, asset_id: str) -> bool:
    n = db.execute(text("DELETE FROM tutor_asset_registry WHERE id = :i"), {"i": asset_id}).rowcount
    db.commit()
    return bool(n)


# ── validation used by the runtime ───────────────────────────────────────────

def avatar_allowed(db: Session, *, institute_id: str, provider: str, avatar_id: str) -> bool:
    r = db.execute(text("""
        SELECT 1 FROM tutor_asset_registry
        WHERE kind = 'avatar' AND provider = :p AND external_id = :e AND status = 'ready'
          AND (institute_id IS NULL OR institute_id = :inst) LIMIT 1
    """), {"p": provider, "e": avatar_id, "inst": institute_id}).first()
    return r is not None


def voice_blocked(db: Session, *, institute_id: str, provider: str, voice_id: str) -> bool:
    """True when the voice is registered to a different institute (or is
    disabled): the caller may not speak with someone else's cloned voice."""
    rows = db.execute(text("""
        SELECT institute_id, status FROM tutor_asset_registry
        WHERE kind = 'voice' AND provider = :p AND external_id = :e
    """), {"p": provider, "e": voice_id}).fetchall()
    if not rows:
        return False
    for inst, status in rows:
        if status == "ready" and (inst is None or inst == institute_id):
            return False
    return True


# ── one-time charges ─────────────────────────────────────────────────────────

def charge_one_time(db: Session, *, asset: Dict[str, Any], tool_key: str, model: str,
                    user_id: Optional[str]) -> Decimal:
    """Charge the owning institute once for this asset (idempotent per asset)."""
    from ...services.ai_billing import UC, charge_tool, metering_user
    if not asset.get("institute_id") or float(asset.get("credits_charged") or 0) > 0:
        return Decimal("0")
    rt = RequestType.TTS_PREMIUM if asset["kind"] == "voice" else RequestType.CONVERSATION
    actor = user_id or asset.get("requested_by")
    charged = charge_tool(db, tool_key=tool_key, tool_params={}, request_type=rt, model=model,
                          institute_id=asset["institute_id"], user_id=actor,
                          user_role="ADMIN", request_id=asset["id"], idempotency_key=f"tutor_asset:{asset['id']}",
                          use_case=UC.TUTOR_SETUP,
                          metering=metering_user(actor, surface="ADMIN_APP"),
                          usage_context={"asset_id": asset["id"], "asset_kind": asset["kind"],
                                         "feature": "tutor_asset"})
    db.execute(text("UPDATE tutor_asset_registry SET credits_charged = :c, updated_at = now() WHERE id = :i"),
               {"c": charged, "i": asset["id"]})
    db.commit()
    return charged


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
