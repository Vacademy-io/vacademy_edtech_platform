"""SQLAlchemy model + repo for the file-conversion cache.

Mirrors media_service FileConversionStatus: caches the converted HTML (PDF→HTML
via MathPix) / transcript text keyed by the vendor's file id (pdfId/audioId), so
a given upload is converted once. Lives in the admin_core DB alongside ai_task.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import Column, String, Text, DateTime, text
from sqlalchemy.orm import Session, declarative_base

Base = declarative_base()


class FileConversion(Base):
    __tablename__ = "file_conversion"

    id = Column(String(255), primary_key=True, default=lambda: str(uuid4()))
    vendor_file_id = Column(String(255), nullable=False, index=True)  # pdfId / audioId
    vendor = Column(String(64), nullable=True)  # "mathpix" / "transcription" / ...
    file_id = Column(String(255), nullable=True)  # source media fileId
    status = Column(String(32), nullable=True)  # INIT / SUCCESS
    html_text = Column(Text, nullable=True)  # converted HTML or transcript text
    file_type = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


_ENSURE = [
    """
    CREATE TABLE IF NOT EXISTS file_conversion (
        id              VARCHAR(255) PRIMARY KEY,
        vendor_file_id  VARCHAR(255) NOT NULL,
        vendor          VARCHAR(64),
        file_id         VARCHAR(255),
        status          VARCHAR(32),
        html_text       TEXT,
        file_type       VARCHAR(64),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_file_conversion_vendor_file_id ON file_conversion(vendor_file_id)",
]

logger = logging.getLogger(__name__)


def ensure_file_conversion_schema(db: Session) -> None:
    try:
        for stmt in _ENSURE:
            db.execute(text(stmt))
        db.commit()
        logger.info("file_conversion schema ensured.")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("ensure_file_conversion_schema failed: %s", exc)


class FileConversionRepository:
    def __init__(self, db: Session):
        self.db = db

    def find_by_vendor_file_id(self, vendor_file_id: str) -> Optional[FileConversion]:
        return (
            self.db.query(FileConversion)
            .filter(FileConversion.vendor_file_id == vendor_file_id)
            .order_by(FileConversion.created_at.desc())
            .first()
        )

    def find_success_by_source_file_id(self, file_id: str) -> Optional[FileConversion]:
        """Most recent already-converted row for a source media fileId. Lets a
        re-ingest of the same upload reuse the cached HTML instead of paying for
        another MathPix conversion."""
        return (
            self.db.query(FileConversion)
            .filter(
                FileConversion.file_id == file_id,
                FileConversion.status == "SUCCESS",
                FileConversion.html_text.isnot(None),
            )
            .order_by(FileConversion.created_at.desc())
            .first()
        )

    def find_success_by_vendor_and_file_id(self, vendor: str, file_id: str) -> Optional[FileConversion]:
        """Most recent converted row for a source fileId written by ONE vendor.

        The table is shared: the same PDF can also hold a tutor probe row (JSON
        page counts) or MathPix HTML. A reader that wants a specific kind of
        text must say which, or it gets whichever vendor wrote last."""
        return (
            self.db.query(FileConversion)
            .filter(
                FileConversion.vendor == vendor,
                FileConversion.file_id == file_id,
                FileConversion.status == "SUCCESS",
                FileConversion.html_text.isnot(None),
            )
            .order_by(FileConversion.created_at.desc())
            .first()
        )

    def find_latest_by_source_file_id(self, file_id: str) -> Optional[FileConversion]:
        """Most recent row (any status) for a source fileId. Lets a re-ingest
        reuse an in-flight conversion's vendor pdfId (re-poll) instead of
        submitting a second MathPix job."""
        return (
            self.db.query(FileConversion)
            .filter(FileConversion.file_id == file_id)
            .order_by(FileConversion.created_at.desc())
            .first()
        )

    def start(
        self, vendor_file_id: str, vendor: str, file_id: Optional[str], file_type: Optional[str] = None,
    ) -> FileConversion:
        row = FileConversion(
            id=str(uuid4()), vendor_file_id=vendor_file_id, vendor=vendor,
            file_id=file_id, status="INIT", file_type=file_type,
        )
        self.db.add(row)
        self.db.commit()
        return row

    def store_success(
        self, vendor_file_id: str, vendor: str, file_id: Optional[str], html: str,
        file_type: Optional[str] = None,
    ) -> FileConversion:
        """Insert one finished row in a single commit. Unlike start() +
        cache_html(), which re-finds the row by vendor_file_id alone, this can
        never land the text on another vendor's row that shares the key."""
        row = FileConversion(
            id=str(uuid4()), vendor_file_id=vendor_file_id, vendor=vendor,
            file_id=file_id, status="SUCCESS", html_text=html, file_type=file_type,
        )
        self.db.add(row)
        self.db.commit()
        return row

    def cache_html(self, vendor_file_id: str, html: str) -> None:
        row = self.find_by_vendor_file_id(vendor_file_id)
        if row is None:
            row = FileConversion(id=str(uuid4()), vendor_file_id=vendor_file_id)
            self.db.add(row)
        row.html_text = html
        row.status = "SUCCESS"
        self.db.commit()
