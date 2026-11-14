"""
PPT-anim backfill (HOTFIX) — replace an institute's old PPT->PDF document slides
with the new animated (PPT_ANIM) decks.

Mirrors scripts/backfill_ppt_anim.py but as an in-service module driven by the
/ai/presentation/ppt-anim-backfill endpoint:
  - admin-core DB (slides) via the app's SQLAlchemy session (settings point it at
    ADMIN_CORE_SERVICE_DB_URL),
  - media-service DB (file_metadata) via a dedicated psycopg connection
    (MEDIA_SERVICE_DB_URL),
  - conversion via the render worker (presentation_service.submit_pptx_anim),
  - then UPDATE document_slide in place, matched to a .pptx by normalised title.

HOTFIX caveats (deliberate shortcuts for a one-off backfill, not architecture):
  - Assumes the app DB == the admin-core DB. If ai_service runs against a separate
    DB the slide queries fail loudly and NOTHING is written.
  - Reaches directly into the media-service DB rather than via a media API.
"""
from __future__ import annotations

import asyncio
import logging
import re
from urllib.parse import parse_qs, urlparse

import psycopg
from sqlalchemy import text

from ..config import get_settings
from ..db import get_sessionmaker
from . import presentation_service

logger = logging.getLogger(__name__)

_CONV_POLL_INTERVAL_S = 3
_CONV_POLL_MAX_TRIES = 200  # ~10 min/deck ceiling
# The render worker is single-concurrency (MAX_CONCURRENT_JOBS); a submit can be
# rejected 429 "Server busy" when another job holds the slot. Wait it out rather
# than dropping the deck. 90 * 10s = ~15 min patience for a free slot.
_SUBMIT_MAX_TRIES = 90
_SUBMIT_RETRY_WAIT_S = 10


def _norm_title(name):
    """Normalise a deck name for matching: drop extension, lowercase, spaces->_."""
    if not name:
        return ""
    n = name.strip().lower()
    n = re.sub(r"\.(pptx|ppt|pdf)$", "", n)
    n = re.sub(r"\s+", "_", n)
    return n


# media-service: original .pptx uploaded by the old PPT->PDF flow (psycopg %s).
_MEDIA_SQL = """
SELECT id, file_name, "key"
FROM file_metadata
WHERE source = 'PPT_TO_PDF' AND source_id = %s
ORDER BY created_at DESC
"""

# admin-core: the institute's PDF document slides + a Course>Subject>Module>Chapter
# label. slide.source_id == document_slide.id (NOT slide.id). module/subject are
# LEFT joins (a chapter may lack a module/subject link). SQLAlchemy named params.
_PLAN_SQL = text("""
SELECT ds.id AS id,
       ds.title AS title,
       bool_or(ds.published_data IS NOT NULL AND ds.published_data <> '') AS is_published,
       string_agg(DISTINCT pkg.package_name,  ' | ') AS courses,
       string_agg(DISTINCT subj.subject_name, ' | ') AS subjects,
       string_agg(DISTINCT m.module_name,     ' | ') AS modules,
       string_agg(DISTINCT ch.chapter_name,   ' | ') AS chapters
FROM slide s
JOIN document_slide ds ON ds.id = s.source_id
JOIN chapter_to_slides cts ON cts.slide_id = s.id AND cts.status <> 'DELETED'
JOIN chapter ch ON ch.id = cts.chapter_id
JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = ch.id AND cpsm.status <> 'DELETED'
JOIN package_session ps ON ps.id = cpsm.package_session_id AND ps.status <> 'DELETED'
JOIN package pkg ON pkg.id = ps.package_id AND pkg.status <> 'DELETED'
JOIN package_institute pi ON pi.package_id = pkg.id
LEFT JOIN module_chapter_mapping mcm ON mcm.chapter_id = ch.id
LEFT JOIN modules m ON m.id = mcm.module_id AND m.status <> 'DELETED'
LEFT JOIN subject_module_mapping smm ON smm.module_id = m.id
LEFT JOIN subject subj ON subj.id = smm.subject_id AND subj.status <> 'DELETED'
WHERE s.source_type = 'DOCUMENT'
  AND ds.type = 'PDF'
  AND pi.institute_id = :institute
  AND s.status <> 'DELETED'
GROUP BY ds.id, ds.title
""")

# Guarded UPDATE — only rows still of type PDF (idempotent / re-run safe).
_UPDATE_SQL = text("""
UPDATE document_slide
SET type = 'PPT_ANIM',
    data = :deck,
    published_data = CASE
        WHEN published_data IS NOT NULL AND published_data <> '' THEN :deck
        ELSE published_data END,
    updated_at = now()
WHERE id = :id AND type = 'PDF'
""")


def _media_conn_kwargs() -> dict:
    """psycopg connect kwargs for the media DB.

    MEDIA_SERVICE_DB_URL is typically a JDBC URL (jdbc:postgresql://host:port/db
    [?params]) with no inline credentials — psycopg can't parse that string, so
    strip the jdbc: prefix, pull host/port/db out, and fall back to DB_USERNAME/
    DB_PASSWORD for credentials (same cluster as admin-core, via pgbouncer).
    """
    settings = get_settings()
    raw = settings.media_service_db_url
    if not raw:
        raise RuntimeError("MEDIA_SERVICE_DB_URL is not configured on this server")

    url = raw[len("jdbc:"):] if raw.startswith("jdbc:") else raw
    if "://" not in url:
        url = "postgresql://" + url
    parsed = urlparse(url)
    kwargs = {
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "dbname": (parsed.path or "").lstrip("/") or "media_service",
        "user": parsed.username or settings.db_username,
        "password": parsed.password or settings.db_password,
    }
    qs = parse_qs(parsed.query)
    if "sslmode" in qs:  # keep libpq-recognised params; drop JDBC-only ones (currentSchema)
        kwargs["sslmode"] = qs["sslmode"][0]
    return kwargs


def build_plan(institute_id: str) -> dict:
    """Blocking: read both DBs and match by normalised title. No writes."""
    with psycopg.connect(**_media_conn_kwargs()) as conn, conn.cursor() as cur:
        cur.execute(_MEDIA_SQL, (institute_id,))
        pptx_rows = cur.fetchall()  # (id, file_name, key)

    pptx_by_title = {}
    for _fid, fname, key in pptx_rows:
        pptx_by_title.setdefault(_norm_title(fname), []).append(key)

    sm = get_sessionmaker()
    with sm() as session:
        slide_rows = session.execute(_PLAN_SQL, {"institute": institute_id}).mappings().all()

    matched, unmatched = [], []
    for r in slide_rows:
        nt = _norm_title(r["title"])
        loc = (f"{r['courses'] or '?'} > {r['subjects'] or '?'} > "
               f"{r['modules'] or '?'} > {r['chapters'] or '?'}")
        cand = pptx_by_title.get(nt)
        if cand:
            matched.append({"slide_id": r["id"], "title": r["title"],
                            "published": bool(r["is_published"]), "location": loc,
                            "nt": nt, "key": cand[0], "pptx_count": len(cand)})
        else:
            unmatched.append({"slide_id": r["id"], "title": r["title"], "location": loc})

    used = {m["nt"] for m in matched}
    orphans = sorted(t for t in pptx_by_title if t not in used)
    return {
        "institute_id": institute_id,
        "pptx_files": len(pptx_rows),
        "pdf_slides": len(slide_rows),
        "matched": matched,
        "unmatched": unmatched,
        "orphan_pptx_titles": orphans,
    }


def _update_slide(slide_doc_id: str, deck: str) -> int:
    sm = get_sessionmaker()
    with sm() as session:
        res = session.execute(_UPDATE_SQL, {"deck": deck, "id": slide_doc_id})
        rows = res.rowcount or 0
        if rows:
            _enqueue_course_knowledge(session, slide_doc_id)
        session.commit()
        return rows


def _enqueue_course_knowledge(session, slide_doc_id: str) -> None:
    """Queue the lessons showing this document for course-knowledge re-indexing,
    in the same transaction as the rewrite (only institutes that turned the
    feature on get rows). A failure is logged and never undoes the rewrite:
    the savepoint rolls back alone and the drift sweep catches up later."""
    from .course_knowledge.queue import enqueue_document_lessons

    try:
        with session.begin_nested():
            queued = enqueue_document_lessons(session, slide_doc_id, "PPT_ANIM_BACKFILL")
        if queued:
            logger.info(f"[ppt-anim-backfill] queued {queued} lesson(s) of {slide_doc_id} for course knowledge")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[ppt-anim-backfill] course-knowledge enqueue skipped for {slide_doc_id}: {e}")


async def _convert(pptx_url: str, dpi: int) -> str:
    """Submit a deck to the render worker and poll until done. Returns deck_base.

    Submits are retried while the worker is busy (429) so a deck isn't dropped
    just because another render held the single job slot at that moment.
    """
    job_id = None
    for _ in range(_SUBMIT_MAX_TRIES):
        try:
            job_id = await presentation_service.submit_pptx_anim(pptx_url=pptx_url, dpi=dpi)
            break
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if "429" in msg or "busy" in msg.lower():
                await asyncio.sleep(_SUBMIT_RETRY_WAIT_S)
                continue
            raise
    if not job_id:
        raise RuntimeError("render worker stayed busy — exceeded submit retries")

    for _ in range(_CONV_POLL_MAX_TRIES):
        await asyncio.sleep(_CONV_POLL_INTERVAL_S)
        st = await presentation_service.get_pptx_anim_status(job_id)
        status = st.get("status")
        if status == "completed":
            deck = (st.get("result") or {}).get("deck_base")
            if not deck:
                raise RuntimeError("conversion completed without deck_base")
            return deck
        if status == "failed":
            raise RuntimeError(st.get("error") or "conversion failed")
    raise RuntimeError("conversion timed out")


async def run_apply(job: dict, institute_id: str, limit: int, dpi: int, private_bucket: str) -> None:
    """Background: convert each matched deck + replace its slide in place. Mutates `job`."""
    try:
        plan = await asyncio.to_thread(build_plan, institute_id)
        targets = plan["matched"][:limit] if limit else plan["matched"]
        job["total"] = len(targets)
        deck_cache, ok, fail, errors = {}, 0, 0, []
        for t in targets:
            try:
                if t["nt"] not in deck_cache:
                    pptx_url = f"https://{private_bucket}.s3.amazonaws.com/{t['key']}"
                    deck_cache[t["nt"]] = await _convert(pptx_url, dpi)
                deck = deck_cache[t["nt"]]
                rows = await asyncio.to_thread(_update_slide, t["slide_id"], deck)
                ok += 1
                logger.info(f"[ppt-anim-backfill] slide {t['slide_id']} -> {deck} (rows={rows})")
            except Exception as e:  # noqa: BLE001
                fail += 1
                errors.append({"slide_id": t["slide_id"], "error": str(e)})
                logger.exception(f"[ppt-anim-backfill] slide {t['slide_id']} failed")
            job["done"] = ok + fail
        job["status"] = "completed"
        job["result"] = {"updated": ok, "failed": fail, "errors": errors}
    except Exception as e:  # noqa: BLE001
        job["status"] = "failed"
        job["error"] = str(e)
        logger.exception("[ppt-anim-backfill] run failed")
