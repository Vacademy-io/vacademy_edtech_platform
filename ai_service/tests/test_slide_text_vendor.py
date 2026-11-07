"""slide_text_service reads and writes only its own vendor's rows (CK-19).

`file_conversion` is shared by MathPix HTML, the tutor caches and the learner
chatbot's slide text. The chatbot used to read the newest SUCCESS row of ANY
vendor for a fileId, so a PDF the tutor had already probed served the probe
JSON ({"pages": .., "text_chars": ..}) to the learner as slide text.

What must hold:
  * a probe row plus a slide_pdf_text row -> the slide_pdf_text text, even when
    the probe row is newer;
  * only a probe (or MathPix) row -> None, so the caller schedules extraction;
  * the background warm writes its own row when only another vendor's row
    exists, and never touches that row (same vendor_file_id key).

Runs on a throwaway database on the real Postgres when AI_LIMITS_PG_URL is set
(postgresql+psycopg://..., the prod driver); otherwise on in-memory SQLite.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from ai_service.app.models.file_conversion import (  # noqa: E402
    Base,
    FileConversion,
    FileConversionRepository,
    ensure_file_conversion_schema,
)
from ai_service.app.services import slide_text_service as sts  # noqa: E402

PROBE_VENDOR = "tutor_pdf_probe"  # services/tutor/source_text.VENDOR_PDF_PROBE
PROBE_JSON = json.dumps({"pages": 12, "text_chars": 4810, "scanned_pages": 0})


@pytest.fixture(scope="module")
def engine():
    base = os.environ.get("AI_LIMITS_PG_URL")
    if not base:
        eng = create_engine("sqlite://", future=True)
        Base.metadata.create_all(eng)
        yield eng
        eng.dispose()
        return
    name = f"slide_vendor_{uuid.uuid4().hex[:10]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT", future=True)
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"'))
    url = base.replace("/postgres?", f"/{name}?") if "/postgres?" in base else base.rsplit("/", 1)[0] + f"/{name}"
    eng = create_engine(url, future=True)
    s = sessionmaker(bind=eng, future=True)()
    try:
        ensure_file_conversion_schema(s)  # the boot-time DDL prod runs
    finally:
        s.close()
    yield eng
    eng.dispose()
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


@pytest.fixture()
def session_factory(engine):
    return sessionmaker(bind=engine, future=True, expire_on_commit=False)


def _add(session_factory, vendor, file_id, html, *, age_s=0, vendor_file_id=None, status="SUCCESS"):
    s = session_factory()
    try:
        s.add(FileConversion(
            id=str(uuid.uuid4()), vendor_file_id=vendor_file_id or file_id, vendor=vendor,
            file_id=file_id, status=status, html_text=html, file_type="text",
            created_at=datetime.utcnow() - timedelta(seconds=age_s),
        ))
        s.commit()
    finally:
        s.close()


def _rows(session_factory, file_id):
    s = session_factory()
    try:
        return [(r.vendor, r.status, r.html_text) for r in
                s.query(FileConversion).filter(FileConversion.file_id == file_id)
                .order_by(FileConversion.created_at).all()]
    finally:
        s.close()


def _read(session_factory, file_id):
    s = session_factory()
    try:
        return sts.get_cached_slide_text(s, file_id)
    finally:
        s.close()


def test_slide_row_wins_over_newer_probe_row(session_factory):
    fid = str(uuid.uuid4())
    _add(session_factory, sts.SLIDE_TEXT_VENDOR, fid, "Photosynthesis converts light energy", age_s=60)
    _add(session_factory, PROBE_VENDOR, fid, PROBE_JSON, age_s=0)  # newest row is the probe
    assert _read(session_factory, fid) == "Photosynthesis converts light energy"


def test_only_probe_row_reads_none(session_factory):
    fid = str(uuid.uuid4())
    _add(session_factory, PROBE_VENDOR, fid, PROBE_JSON)
    assert _read(session_factory, fid) is None


def test_mathpix_html_and_unfinished_slide_rows_are_not_slide_text(session_factory):
    fid = str(uuid.uuid4())
    _add(session_factory, "mathpix", fid, "<div class='mmd'>converted</div>", vendor_file_id=f"pdf-{fid}")
    _add(session_factory, sts.SLIDE_TEXT_VENDOR, fid, None, status="INIT")
    assert _read(session_factory, fid) is None


def test_repository_filters_by_vendor(session_factory):
    fid = str(uuid.uuid4())
    _add(session_factory, sts.SLIDE_TEXT_VENDOR, fid, "old slide text", age_s=120)
    _add(session_factory, sts.SLIDE_TEXT_VENDOR, fid, "new slide text", age_s=60)
    _add(session_factory, PROBE_VENDOR, fid, PROBE_JSON, age_s=0)
    s = session_factory()
    try:
        repo = FileConversionRepository(s)
        assert repo.find_success_by_vendor_and_file_id(sts.SLIDE_TEXT_VENDOR, fid).html_text == "new slide text"
        assert repo.find_success_by_vendor_and_file_id(PROBE_VENDOR, fid).html_text == PROBE_JSON
        assert repo.find_success_by_vendor_and_file_id("tutor_pdf_text", fid) is None
        # The vendor-blind read is unchanged for its other callers.
        assert repo.find_success_by_source_file_id(fid).html_text == PROBE_JSON
    finally:
        s.close()


def _patch_extraction(monkeypatch, session_factory, body):
    from ai_service.app.services import media_file_client
    from ai_service.app.services.kb import parsing

    async def _url(_fid):
        return "https://files.example/slide.pdf"

    async def _download(_url):
        return b"%PDF-1.4 stub"

    @contextmanager
    def _bg_session():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    monkeypatch.setattr(media_file_client, "get_public_file_url", _url)
    monkeypatch.setattr(media_file_client, "get_file_url", _url)
    monkeypatch.setattr(sts, "_download_capped", _download)
    monkeypatch.setattr(sts, "background_db_session", _bg_session)
    monkeypatch.setattr(parsing, "_extract_sync",
                        lambda _b, _figs: SimpleNamespace(pages=[SimpleNamespace(text=body)]))


def test_extraction_caches_own_row_when_only_probe_exists(monkeypatch, session_factory):
    fid = str(uuid.uuid4())
    _add(session_factory, PROBE_VENDOR, fid, PROBE_JSON, age_s=5)
    _patch_extraction(monkeypatch, session_factory, "Cell membrane structure")

    asyncio.run(sts._extract_and_cache(fid))

    rows = _rows(session_factory, fid)
    assert (PROBE_VENDOR, "SUCCESS", PROBE_JSON) in rows  # probe row untouched
    assert (sts.SLIDE_TEXT_VENDOR, "SUCCESS", "Cell membrane structure") in rows
    assert len(rows) == 2
    assert _read(session_factory, fid) == "Cell membrane structure"


def test_extraction_skips_when_own_row_cached(monkeypatch, session_factory):
    fid = str(uuid.uuid4())
    _add(session_factory, sts.SLIDE_TEXT_VENDOR, fid, "already cached", age_s=5)
    _patch_extraction(monkeypatch, session_factory, "fresh text")

    asyncio.run(sts._extract_and_cache(fid))

    assert _rows(session_factory, fid) == [(sts.SLIDE_TEXT_VENDOR, "SUCCESS", "already cached")]
