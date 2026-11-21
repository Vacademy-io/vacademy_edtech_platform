"""V600 (course knowledge) on a REAL Postgres 16 + pgvector, applied on top of
the real V435/V443/V445/V517 KB migrations (course_knowledge_pg_helpers), then
applied a SECOND time to prove it is idempotent.

What must hold:
  * purpose 'course_content' is allowed, at most one per institute;
  * source_kind 'SLIDE' is allowed, one source per (knowledge_base_id, slide_id);
  * a course chunk carries its vector ONLY in embedding_768_scoped (embedding_768
    NULL); both set or neither set is rejected; legacy chunks still insert;
  * the queue status CHECK and the budget non-negative CHECK hold;
  * pricing rows and the course_knowledge catalog row are seeded.

Needs a Postgres: set AI_LIMITS_PG_URL or AI_LIMITS_PGDATA (see the helper).
Skipped otherwise. Run from the repo root:
  AI_LIMITS_PGDATA=<dir> <venv>/bin/python -m pytest ai_service/tests/test_course_knowledge_migration_pg.py -q
"""
from __future__ import annotations

import json
import re
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

from course_knowledge_pg_helpers import (  # noqa: E402
    make_course,
    make_enrolment,
    migration_sql,
    pg_session_factory,
)

MODEL = "google/gemini-embedding-001"


@pytest.fixture(scope="module")
def Session():
    factory = pg_session_factory()
    factory.apply("V600")          # second run: must be a clean no-op
    yield factory
    factory.close()


def _vec(seed: float = 0.1) -> str:
    return str([seed] * 768)


def _kb(db, institute_id: str, purpose: str = "general") -> str:
    kb_id = db.execute(text(
        "INSERT INTO knowledge_base (institute_id, name, purpose, embedding_model, embedding_dim) "
        "VALUES (:i, :n, :p, :m, 768) RETURNING id"),
        {"i": institute_id, "n": f"KB {purpose}", "p": purpose, "m": MODEL}).scalar_one()
    db.commit()
    return kb_id


def _source(db, kb_id: str, institute_id: str, *, kind: str = "SLIDE", slide_id=None) -> str:
    sid = db.execute(text(
        "INSERT INTO knowledge_base_source (knowledge_base_id, institute_id, source_kind, title, slide_id, "
        "index_state) VALUES (:kb, :i, :k, 'Lesson', :s, :st) RETURNING id"),
        {"kb": kb_id, "i": institute_id, "k": kind, "s": slide_id,
         "st": "READY" if slide_id else None}).scalar_one()
    db.commit()
    return sid


def _chunk(db, kb_id, source_id, institute_id, *, legacy=None, scoped=None):
    return db.execute(text(
        "INSERT INTO kb_chunk (knowledge_base_id, source_id, institute_id, content_text, embedding_model, "
        "embedding_dim, embedding_768, embedding_768_scoped) VALUES (:kb, :s, :i, 'text', :m, 768, "
        "CAST(:legacy AS vector), CAST(:scoped AS vector)) RETURNING id"),
        {"kb": kb_id, "s": source_id, "i": institute_id, "m": MODEL, "legacy": legacy,
         "scoped": scoped}).scalar_one()


def _rejected(db, sql: str, params: dict, constraint: str) -> None:
    with pytest.raises(IntegrityError) as err:
        db.execute(text(sql), params)
        db.flush()
    db.rollback()
    assert constraint in str(err.value), err.value


def _inst() -> str:
    return f"inst-{uuid.uuid4().hex[:8]}"


def test_kb_chunk_statements_are_the_last_ddl():
    sql = migration_sql("V600")
    statements = [s.strip() for s in re.sub(r"--[^\n]*", "", sql).split(";") if s.strip()]
    first_chunk = next(i for i, s in enumerate(statements) if "kb_chunk" in s)
    assert first_chunk > 0
    assert all(s.startswith("ALTER TABLE kb_chunk") for s in statements[first_chunk:])
    assert statements[0].startswith("SET LOCAL lock_timeout") and statements[1].startswith("SET LOCAL statement_timeout")
    assert "VALIDATE CONSTRAINT kb_chunk" not in sql
    assert "${" not in sql          # no Flyway placeholders


def test_all_new_tables_exist(Session):
    with Session() as db:
        names = {r[0] for r in db.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))}
    assert {"course_knowledge_setting", "content_index_queue", "course_knowledge_run",
            "course_knowledge_budget", "course_extract_cache", "course_knowledge_link"} <= names


def test_course_content_purpose_once_per_institute(Session):
    inst = _inst()
    with Session() as db:
        _kb(db, inst, "course_content")
        _kb(db, inst, "general")                     # other purposes stay unlimited
        _kb(db, _inst(), "course_content")           # another institute has its own
        _rejected(db, "INSERT INTO knowledge_base (institute_id, name, purpose, embedding_model, embedding_dim) "
                      "VALUES (:i, 'again', 'course_content', :m, 768)", {"i": inst, "m": MODEL},
                  "uq_kb_course_content")
        _rejected(db, "INSERT INTO knowledge_base (institute_id, name, purpose, embedding_model, embedding_dim) "
                      "VALUES (:i, 'bad', 'not_a_purpose', :m, 768)", {"i": inst, "m": MODEL},
                  "knowledge_base_purpose_valid")
        # ON CONFLICT DO NOTHING on the partial index (the ensure_course_kb pattern) returns no row.
        again = db.execute(text(
            "INSERT INTO knowledge_base (institute_id, name, purpose, embedding_model, embedding_dim) "
            "VALUES (:i, 'again', 'course_content', :m, 768) ON CONFLICT DO NOTHING RETURNING id"),
            {"i": inst, "m": MODEL}).first()
        db.commit()
        assert again is None


def test_slide_source_kind_and_one_source_per_slide(Session):
    inst = _inst()
    with Session() as db:
        kb = _kb(db, inst, "course_content")
        other_kb = _kb(db, inst, "general")
        _source(db, kb, inst, slide_id="slide-1")
        _source(db, other_kb, inst, slide_id="slide-1")   # unique per KB, not global
        _source(db, kb, inst, kind="PDF")                  # legacy sources keep slide_id NULL, unlimited
        _source(db, kb, inst, kind="PDF")
        _rejected(db, "INSERT INTO knowledge_base_source (knowledge_base_id, institute_id, source_kind, title, "
                      "slide_id) VALUES (:kb, :i, 'SLIDE', 'dup', 'slide-1')", {"kb": kb, "i": inst},
                  "uq_kb_source_slide")
        _rejected(db, "INSERT INTO knowledge_base_source (knowledge_base_id, institute_id, source_kind, title, "
                      "slide_id, index_state) VALUES (:kb, :i, 'SLIDE', 'x', 'slide-2', 'BOGUS')",
                  {"kb": kb, "i": inst}, "kb_source_index_state_valid")
        _rejected(db, "INSERT INTO knowledge_base_source (knowledge_base_id, institute_id, source_kind, title) "
                      "VALUES (:kb, :i, 'VIDEO', 'x')", {"kb": kb, "i": inst}, "kb_source_kind_valid")
        db.execute(text("UPDATE knowledge_base_source SET centroid_768 = CAST(:v AS vector) "
                        "WHERE knowledge_base_id = :kb AND slide_id = 'slide-1'"), {"v": _vec(), "kb": kb})
        db.commit()


def test_kb_chunk_vector_rules(Session):
    inst = _inst()
    with Session() as db:
        kb = _kb(db, inst, "course_content")
        src = _source(db, kb, inst, slide_id="slide-v")
        scoped = _chunk(db, kb, src, inst, legacy=None, scoped=_vec(0.2))
        db.commit()
        row = db.execute(text("SELECT embedding_768 IS NULL, embedding_768_scoped IS NOT NULL FROM kb_chunk "
                              "WHERE id = :id"), {"id": scoped}).one()
        assert tuple(row) == (True, True)

        base = ("INSERT INTO kb_chunk (knowledge_base_id, source_id, institute_id, content_text, embedding_model, "
                "embedding_dim, embedding_768, embedding_768_scoped) VALUES (:kb, :s, :i, 't', :m, 768, "
                "CAST(:legacy AS vector), CAST(:scoped AS vector))")
        p = {"kb": kb, "s": src, "i": inst, "m": MODEL}
        _rejected(db, base, dict(p, legacy=_vec(0.3), scoped=_vec(0.3)), "kb_chunk_scoped_vector_exclusive")
        _rejected(db, base, dict(p, legacy=None, scoped=None), "kb_chunk_vector_matches_dim")

        legacy_kb = _kb(db, inst, "general")
        legacy_src = _source(db, legacy_kb, inst, kind="TEXT")
        _chunk(db, legacy_kb, legacy_src, inst, legacy=_vec(0.4), scoped=None)
        db.commit()


def test_legacy_reader_filter_never_sees_course_chunks(Session):
    """The isolation rule in its rawest form: the legacy `embedding_768 IS NOT NULL` filter."""
    inst = _inst()
    with Session() as db:
        kb = _kb(db, inst, "course_content")
        src = _source(db, kb, inst, slide_id="slide-iso")
        _chunk(db, kb, src, inst, scoped=_vec(0.5))
        db.commit()
        seen = db.execute(text("SELECT count(*) FROM kb_chunk WHERE institute_id = :i AND embedding_768 IS NOT NULL"),
                          {"i": inst}).scalar_one()
        assert seen == 0


def test_queue_status_and_budget_checks(Session):
    inst = _inst()
    with Session() as db:
        db.execute(text("INSERT INTO content_index_queue (institute_id, slide_id) VALUES (:i, 's1')"), {"i": inst})
        db.commit()
        st = db.execute(text("SELECT status, generation, allow_paid FROM content_index_queue "
                             "WHERE institute_id = :i AND slide_id = 's1'"), {"i": inst}).one()
        assert tuple(st) == ("PENDING", 1, False)
        _rejected(db, "INSERT INTO content_index_queue (institute_id, slide_id, status) VALUES (:i, 's2', 'BOGUS')",
                  {"i": inst}, "ciq_status_valid")
        for status in ("PROCESSING", "DONE", "FAILED", "SKIPPED"):
            db.execute(text("UPDATE content_index_queue SET status = :st WHERE institute_id = :i"),
                       {"st": status, "i": inst})
        db.commit()

        db.execute(text("INSERT INTO course_knowledge_budget (id, institute_id, kind, cap_credits) "
                        "VALUES (:id, :i, 'RUN', 10)"), {"id": f"run:{uuid.uuid4()}", "i": inst})
        db.commit()
        _rejected(db, "UPDATE course_knowledge_budget SET reserved_credits = reserved_credits - 1 "
                      "WHERE institute_id = :i", {"i": inst}, "ckb_nonneg")
        _rejected(db, "INSERT INTO course_knowledge_budget (id, institute_id, kind) VALUES ('x', :i, 'WEEK')",
                  {"i": inst}, "ckb_kind_valid")
        _rejected(db, "INSERT INTO course_knowledge_setting (institute_id, monthly_auto_cap_credits) "
                      "VALUES (:i, -1)", {"i": inst}, "cks_cap_nonneg")


def test_setting_defaults_keep_everything_off(Session):
    inst = _inst()
    with Session() as db:
        db.execute(text("INSERT INTO course_knowledge_setting (institute_id) VALUES (:i)"), {"i": inst})
        db.commit()
        row = db.execute(text("SELECT enabled, auto_paid_enabled, monthly_auto_cap_credits "
                              "FROM course_knowledge_setting WHERE institute_id = :i"), {"i": inst}).one()
        assert tuple(row) == (False, False, 0)


def test_link_defaults_and_active_uniqueness(Session):
    inst = _inst()
    with Session() as db:
        kb = _kb(db, inst, "teaching")
        db.execute(text("INSERT INTO course_knowledge_link (institute_id, package_id, knowledge_base_id) "
                        "VALUES (:i, 'pkg', :kb)"), {"i": inst, "kb": kb})
        db.commit()
        row = db.execute(text("SELECT role, grounding_mode, use_in, provenance, status FROM course_knowledge_link "
                              "WHERE knowledge_base_id = :kb"), {"kb": kb}).one()
        assert (row[0], row[1], list(row[2]), row[3], row[4]) == ("GROUNDING", "STRICT", ["tutor", "chatbot"],
                                                                  "ADMIN", "ACTIVE")
        _rejected(db, "INSERT INTO course_knowledge_link (institute_id, package_id, knowledge_base_id) "
                      "VALUES (:i, 'pkg', :kb)", {"i": inst, "kb": kb}, "uq_ckl_package_kb")
        db.execute(text("UPDATE course_knowledge_link SET status = 'REMOVED' WHERE knowledge_base_id = :kb"),
                   {"kb": kb})
        db.execute(text("INSERT INTO course_knowledge_link (institute_id, package_id, knowledge_base_id) "
                        "VALUES (:i, 'pkg', :kb)"), {"i": inst, "kb": kb})
        db.commit()
        db.execute(text("DELETE FROM knowledge_base WHERE id = :kb"), {"kb": kb})
        db.commit()
        left = db.execute(text("SELECT count(*) FROM course_knowledge_link WHERE knowledge_base_id = :kb"),
                          {"kb": kb}).scalar_one()
        assert left == 0


def test_extract_cache_tier_check(Session):
    with Session() as db:
        db.execute(text("INSERT INTO course_extract_cache (pointer_kind, pointer_key, extractor_version, tier) "
                        "VALUES ('file', 'f1', 1, 'FREE'), ('file', 'f1', 1, 'PAID')"))
        db.commit()
        _rejected(db, "INSERT INTO course_extract_cache (pointer_kind, pointer_key, extractor_version, tier) "
                      "VALUES ('file', 'f2', 1, 'GOLD')", {}, "cec_tier_valid")


def test_pricing_rows_seeded(Session):
    with Session() as db:
        rows = {r[0]: r for r in db.execute(text(
            "SELECT tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json "
            "FROM ai_tool_pricing WHERE tool_key LIKE 'course_kb_%'"))}
    assert set(rows) == {"course_kb_ocr_page", "course_kb_transcribe_minute"}
    ocr, tr = rows["course_kb_ocr_page"], rows["course_kb_transcribe_minute"]
    assert (ocr[1], float(ocr[2]), float(ocr[3]), ocr[4]) == ("knowledge_base", 0.0, 0.5, "pages")
    assert (tr[1], float(tr[2]), float(tr[3]), tr[4]) == ("transcription", 0.0, 0.5, "audio_minutes")
    ocr_params = ocr[5] if isinstance(ocr[5], dict) else json.loads(ocr[5])
    tr_params = tr[5] if isinstance(tr[5], dict) else json.loads(tr[5])
    assert ocr_params == {"fixed_price": True}
    assert tr_params == {"fixed_price": True, "min_credits": "1"}


def test_catalog_row_seeded_with_billing_feature(Session):
    with Session() as db:
        row = db.execute(text(
            "SELECT feature_group, tool_keys, legacy_request_types, default_surface, unit_kind, billing_feature_key, "
            "updated_by FROM ai_use_case_catalog WHERE use_case = 'course_knowledge'")).one()
    assert row[0] == "kb"
    assert list(row[1]) == ["course_kb_ocr_page", "course_kb_transcribe_minute"]
    assert list(row[2]) == []
    assert (row[3], row[4], row[5], row[6]) == ("ADMIN_APP", "MIXED", "kb_ingest", "V600")


def test_billing_feature_key_update_never_overwrites(Session):
    with Session() as db:
        db.execute(text("UPDATE ai_use_case_catalog SET billing_feature_key = 'portal_choice' "
                        "WHERE use_case = 'course_knowledge'"))
        db.commit()
    Session.apply("V600")
    with Session() as db:
        key = db.execute(text("SELECT billing_feature_key FROM ai_use_case_catalog "
                              "WHERE use_case = 'course_knowledge'")).scalar_one()
        db.execute(text("UPDATE ai_use_case_catalog SET billing_feature_key = 'kb_ingest' "
                        "WHERE use_case = 'course_knowledge'"))
        db.commit()
    assert key == "portal_choice"


def test_make_course_and_enrolment_helpers(Session):
    inst = _inst()
    with Session() as db:
        ids = make_course(db, inst, 3)
        assert len(ids.slide_ids) == 3
        visible = db.execute(text(
            "SELECT s.id FROM chapter_package_session_mapping cpsm "
            "JOIN chapter ch ON ch.id = cpsm.chapter_id AND ch.status = 'ACTIVE' "
            "JOIN module_chapter_mapping mcm ON mcm.chapter_id = ch.id "
            "JOIN modules m ON m.id = mcm.module_id AND m.status = 'ACTIVE' "
            "JOIN subject_module_mapping smm ON smm.module_id = m.id "
            "JOIN subject_session ss ON ss.subject_id = smm.subject_id AND ss.session_id = cpsm.package_session_id "
            "JOIN chapter_to_slides cts ON cts.chapter_id = ch.id AND cts.status IN ('PUBLISHED','UNSYNC') "
            "JOIN slide s ON s.id = cts.slide_id AND s.status IN ('PUBLISHED','UNSYNC') "
            "WHERE cpsm.package_session_id = :ps AND cpsm.status = 'ACTIVE' ORDER BY cts.slide_order"),
            {"ps": ids.package_session_id}).scalars().all()
        assert visible == ids.slide_ids

        enrol = make_enrolment(db, "user-1", ids.package_session_id, inst, type="PAYMENT_FAILED")
        row = db.execute(text("SELECT status, type, expiry_date FROM student_session_institute_group_mapping "
                              "WHERE id = :id"), {"id": enrol}).one()
        assert (row[0], row[1], row[2]) == ("ACTIVE", "PAYMENT_FAILED", None)
