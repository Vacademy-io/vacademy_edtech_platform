"""
Repository for the AI video editor's saved media library (editor_media_asset).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import select, delete, or_
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError, PendingRollbackError

from ..models.editor_media_asset import EditorMediaAsset
from ..db import get_engine

logger = logging.getLogger(__name__)

# Schema note: the `editor_media_asset` table is created by admin_core_service
# Flyway (V306__Create_editor_media_asset_table.sql). admin_core_service is the
# single source of truth for this shared database's schema — the same place
# ai_gen_video (V65) and ai_reels (V245) are defined. ai_service does not
# create tables itself.


def _is_connection_error(exc: Exception) -> bool:
    if isinstance(exc, (OperationalError, PendingRollbackError)):
        return True
    msg = str(exc).lower()
    return any(s in msg for s in (
        "server closed the connection", "connection was reset",
        "ssl connection has been closed", "could not connect", "broken pipe",
    ))


class EditorMediaAssetRepository:
    """CRUD for per-institute editor media assets."""

    def __init__(self, session: Optional[Session] = None):
        self.session = session
        self._engine = get_engine()

    def _get_session(self) -> Session:
        return self.session or Session(self._engine)

    # ── CREATE (dedup on (institute_id, url)) ──────────────────────────────
    def create(
        self,
        *,
        institute_id: str,
        url: str,
        kind: str,
        source: str,
        thumb_url: Optional[str] = None,
        prompt: Optional[str] = None,
        source_url: Optional[str] = None,
        photographer: Optional[str] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        duration: Optional[float] = None,
        created_by_user_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> EditorMediaAsset:
        session = self._get_session()
        try:
            existing = session.execute(
                select(EditorMediaAsset).where(
                    EditorMediaAsset.institute_id == institute_id,
                    EditorMediaAsset.url == url,
                )
            ).scalar_one_or_none()
            if existing is not None:
                return existing
            record = EditorMediaAsset(
                institute_id=institute_id,
                url=url,
                kind=kind,
                source=source,
                thumb_url=thumb_url,
                prompt=prompt,
                source_url=source_url,
                photographer=photographer,
                width=width,
                height=height,
                duration=duration,
                created_by_user_id=created_by_user_id,
            )
            # Only set when given, so existing callers keep the column defaults.
            if tags is not None:
                record.tags = list(tags)
            if metadata is not None:
                record.extra_metadata = dict(metadata)
            session.add(record)
            session.commit()
            session.refresh(record)
            return record
        except Exception:
            session.rollback()
            raise
        finally:
            if not self.session:
                session.close()

    # ── FIND by metadata (e.g. the website importer's origin / source hash) ─
    def list_by_metadata(self, institute_id: str, *, limit: int = 60, **fields: str) -> List[EditorMediaAsset]:
        """The institute's assets whose metadata has every given key = value, newest first."""
        session = self._get_session()
        try:
            stmt = select(EditorMediaAsset).where(EditorMediaAsset.institute_id == institute_id)
            for key, value in fields.items():
                stmt = stmt.where(EditorMediaAsset.extra_metadata[key].astext == str(value))
            stmt = stmt.order_by(EditorMediaAsset.created_at.desc()).limit(limit)
            return list(session.execute(stmt).scalars().all())
        finally:
            if not self.session:
                session.close()

    def find_by_metadata(self, institute_id: str, **fields: str) -> Optional[EditorMediaAsset]:
        rows = self.list_by_metadata(institute_id, limit=1, **fields)
        return rows[0] if rows else None

    # ── LIST ───────────────────────────────────────────────────────────────
    def list_by_institute(
        self,
        institute_id: str,
        *,
        kind: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = 60,
        offset: int = 0,
    ) -> List[EditorMediaAsset]:
        session = self._get_session()
        try:
            stmt = select(EditorMediaAsset).where(
                EditorMediaAsset.institute_id == institute_id
            )
            if kind in ("image", "video"):
                stmt = stmt.where(EditorMediaAsset.kind == kind)
            if q:
                like = f"%{q.strip()}%"
                stmt = stmt.where(
                    or_(
                        EditorMediaAsset.prompt.ilike(like),
                        EditorMediaAsset.source_url.ilike(like),
                        EditorMediaAsset.photographer.ilike(like),
                    )
                )
            stmt = stmt.order_by(EditorMediaAsset.created_at.desc()).limit(limit).offset(offset)
            return list(session.execute(stmt).scalars().all())
        finally:
            if not self.session:
                session.close()

    # ── DELETE (institute-scoped) ──────────────────────────────────────────
    def delete_by_id(self, asset_id: str, institute_id: str) -> bool:
        session = self._get_session()
        try:
            result = session.execute(
                delete(EditorMediaAsset).where(
                    EditorMediaAsset.id == asset_id,
                    EditorMediaAsset.institute_id == institute_id,
                )
            )
            session.commit()
            return (result.rowcount or 0) > 0
        except Exception:
            session.rollback()
            raise
        finally:
            if not self.session:
                session.close()
