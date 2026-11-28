"""Prepared teacher audio: one row per spoken segment × provider × voice ×
language × pace, pointing at an mp3 in S3. Filled at compile time (voice
warm-up) and by live lessons on a miss; read by every lesson first, so a
course's narration is synthesised once, not once per learner.

Created by ai_service itself (idempotent DDL at startup, like
file_conversion) so it does not wait on admin_core's Flyway."""
from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text, text
from sqlalchemy.orm import Session, declarative_base

Base = declarative_base()
logger = logging.getLogger(__name__)


class TutorTtsCache(Base):
    __tablename__ = "tutor_tts_cache"

    cache_key = Column(String(64), primary_key=True)
    provider = Column(String(32), nullable=False)
    voice = Column(String(120), nullable=True)
    language = Column(String(10), nullable=False)
    pace = Column(String(8), nullable=False)
    chars = Column(Integer, nullable=False, default=0)
    text_head = Column(Text, nullable=True)
    url = Column(Text, nullable=False)
    mime = Column(String(32), nullable=False, default="audio/mpeg")
    bytes = Column(Integer, nullable=False, default=0)
    hits = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    last_used_at = Column(DateTime(timezone=True), nullable=True)


_ENSURE = [
    """
    CREATE TABLE IF NOT EXISTS tutor_tts_cache (
        cache_key     VARCHAR(64) PRIMARY KEY,
        provider      VARCHAR(32) NOT NULL,
        voice         VARCHAR(120),
        language      VARCHAR(10) NOT NULL,
        pace          VARCHAR(8) NOT NULL,
        chars         INTEGER NOT NULL DEFAULT 0,
        text_head     TEXT,
        url           TEXT NOT NULL,
        mime          VARCHAR(32) NOT NULL DEFAULT 'audio/mpeg',
        bytes         INTEGER NOT NULL DEFAULT 0,
        hits          INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at  TIMESTAMPTZ
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_tutor_tts_cache_voice ON tutor_tts_cache(provider, voice, language)",
]


def ensure_tutor_tts_cache_schema(db: Session) -> None:
    try:
        for stmt in _ENSURE:
            db.execute(text(stmt))
        db.commit()
        logger.info("tutor_tts_cache schema ensured.")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("ensure_tutor_tts_cache_schema failed: %s", exc)
