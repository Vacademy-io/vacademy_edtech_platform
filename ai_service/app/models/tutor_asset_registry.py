"""Registry of teacher voices and avatars the Live AI Tutor may use.

One row per asset: a cloned voice (Smallest.ai) or an animated avatar
(Spatius). `institute_id` NULL marks platform stock every institute may pick;
otherwise the row belongs to one institute and nobody else sees it. Until
Spatius enables API creation, avatar rows sit in `requested` for a super
admin to fulfil from Spatius Studio.

Created by ai_service itself (idempotent DDL at startup, like
tutor_tts_cache) so it does not wait on admin_core's Flyway."""
from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

KINDS = ("voice", "avatar")
STATUSES = ("requested", "processing", "ready", "failed", "disabled")

_ENSURE = [
    """
    CREATE TABLE IF NOT EXISTS tutor_asset_registry (
        id              VARCHAR(36) PRIMARY KEY,
        kind            VARCHAR(16) NOT NULL,
        provider        VARCHAR(32) NOT NULL,
        external_id     VARCHAR(160),
        display_name    VARCHAR(120) NOT NULL,
        institute_id    VARCHAR(255),
        status          VARCHAR(16) NOT NULL DEFAULT 'ready',
        gender          VARCHAR(16),
        languages       VARCHAR(120),
        preview_url     TEXT,
        source_file_id  VARCHAR(255),
        consent         BOOLEAN NOT NULL DEFAULT FALSE,
        requested_by    VARCHAR(255),
        vendor_job_id   VARCHAR(160),
        credits_charged NUMERIC(12,4) NOT NULL DEFAULT 0,
        error           TEXT,
        notes           TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        fulfilled_at    TIMESTAMPTZ
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_tutor_asset_inst ON tutor_asset_registry(institute_id, kind, status)",
    "CREATE INDEX IF NOT EXISTS idx_tutor_asset_ext ON tutor_asset_registry(kind, provider, external_id)",
]


def ensure_tutor_asset_registry_schema(db: Session) -> None:
    try:
        for stmt in _ENSURE:
            db.execute(text(stmt))
        db.commit()
        logger.info("tutor_asset_registry schema ensured.")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("ensure_tutor_asset_registry_schema failed: %s", exc)
