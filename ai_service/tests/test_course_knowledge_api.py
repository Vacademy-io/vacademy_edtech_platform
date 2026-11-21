"""Course knowledge admin API (CK-09): status, settings, coverage and quote,
scan / process (Make course AI-ready), runs, cancel, retry, preview, delete.

What must hold:
  * staff by ROLES only: a learner token with is_root_user=true is 403 on
    every route; a teacher reads coverage and scans but cannot process,
    change settings, cancel or delete;
  * the quote SUMS per-lesson estimates (each rounded up to a whole credit):
    three one-page scans at 0.5 cost 3 credits, not 2; estimates are
    memoized per (tool, units);
  * a file shared by two lessons is charged once, a pointer already in the
    PAID cache costs 0;
  * process: 409 QUOTE_CHANGED when the quote rose, the 402 shape of the KB
    preflight, a null balance (no wallet row) is allowed, only the quoted
    lessons are queued with allow_paid under a run budget capped at the quote;
  * cancel detaches the PENDING rows and caps the budget at charged + reserved;
  * a not-available institute is 403 not_available; a disabled one 409
    not_enabled on writes (PUT /settings still works).

The tests drive the real router through FastAPI's TestClient on a REAL
Postgres 16 + pgvector with the real migrations (course_knowledge_pg_helpers;
skipped without AI_LIMITS_PG_URL / AI_LIMITS_PGDATA). Only the JWT check, the
platform flags and (for the preview) the retrieval call are faked.
"""
from __future__ import annotations

import contextlib
import sys
import uuid
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

import app.core.security as security  # noqa: E402
from app.db import db_dependency  # noqa: E402
from app.routers import course_knowledge as ck_router  # noqa: E402
from app.schemas.auth import CustomUserDetails  # noqa: E402
from app.services.course_knowledge import billing, budget, flags, retrieval, settings_store, store  # noqa: E402
from app.services.course_knowledge.extract.types import EXTRACTOR_VERSION  # noqa: E402
from app.services.metering import limit_gate  # noqa: E402

USER = "user-1"
BASE = "/course-knowledge/v1"


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def Session():
    from course_knowledge_pg_helpers import pg_session_factory

    factory = pg_session_factory()
    with factory() as db:
        # The wallet table CreditService reads (not in the platform stubs).
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS institute_credits (
                id                    VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
                institute_id          VARCHAR(255) NOT NULL UNIQUE,
                total_credits         NUMERIC(12,2) NOT NULL DEFAULT 0,
                used_credits          NUMERIC(12,2) NOT NULL DEFAULT 0,
                current_balance       NUMERIC(12,2) NOT NULL DEFAULT 0,
                low_balance_threshold NUMERIC(12,2) NOT NULL DEFAULT 0,
                created_at            TIMESTAMP NOT NULL DEFAULT now(),
                updated_at            TIMESTAMP NOT NULL DEFAULT now()
            )
            """
        ))
        # In-video questions: describe_slides reads them for uploaded videos.
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS video_slide_question (
                id VARCHAR PRIMARY KEY, parent_rich_text_id VARCHAR, text_id VARCHAR, explanation_text_id VARCHAR,
                media_id VARCHAR, status VARCHAR, question_response_type VARCHAR NOT NULL DEFAULT 'OPTION',
                question_type VARCHAR NOT NULL DEFAULT 'MCQS', access_level VARCHAR NOT NULL DEFAULT 'INSTITUTE',
                auto_evaluation_json TEXT, evaluation_type VARCHAR, question_order INT, question_time_in_millis BIGINT,
                video_slide_id VARCHAR, can_skip BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        ))
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS video_slide_question_options (
                id VARCHAR PRIMARY KEY, video_slide_question_id VARCHAR NOT NULL, text_id VARCHAR,
                explanation_text_id VARCHAR, media_id VARCHAR,
                created_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        ))
        db.commit()
    yield factory
    factory.close()


@pytest.fixture
def world(Session):
    """A fresh institute with one enabled, published 3-lesson course."""
    from course_knowledge_pg_helpers import make_course

    inst = f"inst-{uuid.uuid4().hex[:8]}"
    with Session() as db:
        course = make_course(db, inst, 3)
        settings_store.put_setting(db, inst, {"enabled": True}, USER)
    return SimpleNamespace(inst=inst, course=course, pkg=course.package_id, slides=course.slide_ids)


@pytest.fixture
def api(Session, world, monkeypatch):
    state = SimpleNamespace(
        is_root=False, authorities={world.inst: {"roles": ["ADMIN"], "permissions": []}},
        available=True, paid=True,
    )

    async def fake_verify(auth_header, client_id, settings):
        return CustomUserDetails(username="u", user_id=USER, is_root_user=state.is_root)

    def fake_decode(token, settings):
        return {"user": USER, "authorities": state.authorities}

    monkeypatch.setattr(security, "_verify_and_fetch_user", fake_verify)
    monkeypatch.setattr(security, "_decode_jwt_token", fake_decode)
    monkeypatch.setattr(flags, "available", lambda inst: state.available and bool(inst))
    monkeypatch.setattr(flags, "platform_enabled", lambda: state.available)
    monkeypatch.setattr(flags, "paid_enabled", lambda: state.paid)
    monkeypatch.setattr(flags, "links_enabled", lambda: False)
    monkeypatch.setattr(flags, "retrieval_mode", lambda: "off")
    monkeypatch.setattr(flags, "max_monthly_auto_cap", lambda: 5000)

    def _db():
        db = Session()
        try:
            yield db
            db.commit()
        finally:
            db.close()

    @contextlib.contextmanager
    def _short_session():
        db = Session()
        try:
            yield db
            db.commit()
        finally:
            db.close()

    monkeypatch.setattr(ck_router, "db_session", _short_session)

    app = FastAPI()
    app.include_router(ck_router.router)
    app.dependency_overrides[db_dependency] = _db
    for exc_type in limit_gate.limit_exceeded_types():
        app.add_exception_handler(exc_type, limit_gate.limit_exceeded_handler)
    with TestClient(app) as client:
        state.client = client
        state.headers = {"Authorization": "Bearer t", "clientId": world.inst}
        yield state


def _roles(api, world, roles, *, root=False):
    api.is_root = root
    api.authorities = {world.inst: {"roles": roles, "permissions": []}}


# ── builders ─────────────────────────────────────────────────────────────────

def _kb(db, inst):
    return store.ensure_course_kb(db, inst)


def needs_ocr(db, inst, slide_id, pages, pointer_key=None, *, kind="ocr_pages", approx=False, note=None):
    """A lesson whose free pass is done and whose scanned pages need OCR."""
    kb = _kb(db, inst)
    tool = "course_kb_transcribe_minute" if kind == "transcribe_minutes" else "course_kb_ocr_page"
    store.set_source_state(
        db, kb=kb, slide_id=slide_id, title="t", index_state="NEEDS_PROCESSING", status="PENDING",
        meta={"text_kind": "pdf", "anchor_kind": "page", "note": note, "paid": {
            "kind": kind, "tool_key": tool, "units": pages, "approx": approx,
            "pointer_kind": "file", "pointer_key": pointer_key or f"file-{uuid.uuid4().hex[:10]}",
            "idempotency_key": None, "delivered_at": None, "charged": None,
        }},
    )


def set_state(db, inst, slide_id, index_state, note=None):
    kb = _kb(db, inst)
    store.set_source_state(
        db, kb=kb, slide_id=slide_id, title="t", index_state=index_state,
        status="FAILED" if index_state == "FAILED" else "PENDING",
        meta={"text_kind": "lesson", "anchor_kind": "none", "note": note, "paid": None},
    )


def set_balance(db, inst, amount):
    db.execute(text(
        """
        INSERT INTO institute_credits (institute_id, total_credits, current_balance)
        VALUES (:i, CAST(:b AS NUMERIC), CAST(:b AS NUMERIC))
        ON CONFLICT (institute_id) DO UPDATE SET current_balance = EXCLUDED.current_balance
        """
    ), {"i": inst, "b": str(amount)})
    db.commit()


def cache_paid(db, pointer_key):
    db.execute(text(
        """
        INSERT INTO course_extract_cache (pointer_kind, pointer_key, extractor_version, tier, segments, text_chars)
        VALUES ('file', :k, :v, 'PAID', CAST(:s AS jsonb), 10)
        ON CONFLICT DO NOTHING
        """
    ), {"k": pointer_key, "v": EXTRACTOR_VERSION, "s": '[{"text": "ocr text", "anchor": "page", "page": 1}]'})
    db.commit()


def queue_rows(db, inst):
    rows = db.execute(text(
        "SELECT slide_id, status, allow_paid, run_id, reason FROM content_index_queue WHERE institute_id = :i"
    ), {"i": inst}).mappings().all()
    return {r["slide_id"]: dict(r) for r in rows}


def runs_of(db, inst):
    return db.execute(text(
        "SELECT id, kind, status, quoted_credits FROM course_knowledge_run WHERE institute_id = :i ORDER BY created_at"
    ), {"i": inst}).mappings().all()


def make_video(db, slide_id, length_ms):
    vid = str(uuid.uuid4())
    db.execute(text(
        "INSERT INTO video (id, published_url, published_video_length) VALUES (:v, :u, :l)"
    ), {"v": vid, "u": str(uuid.uuid4()), "l": length_ms})
    db.execute(text("UPDATE slide SET source_type = 'VIDEO', source_id = :v WHERE id = :s"),
               {"v": vid, "s": slide_id})
    db.commit()


def lessons_by_id(body):
    return {l["slide_id"]: l for l in body["lessons"]}


# ── auth ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("roles", [["STUDENT"], ["LEARNER"], []])
def test_root_learner_token_is_rejected_everywhere(api, world, Session, roles):
    _roles(api, world, roles, root=True)
    c, h, pkg = api.client, api.headers, world.pkg
    calls = [
        c.get(f"{BASE}/status", headers=h),
        c.get(f"{BASE}/settings", headers=h),
        c.put(f"{BASE}/settings", json={"enabled": False}, headers=h),
        c.get(f"{BASE}/packages/{pkg}/coverage", headers=h),
        c.post(f"{BASE}/packages/{pkg}/scan", headers=h),
        c.post(f"{BASE}/packages/{pkg}/process", json={"expected_credits": 100}, headers=h),
        c.get(f"{BASE}/runs/x", headers=h),
        c.post(f"{BASE}/runs/x/cancel", headers=h),
        c.post(f"{BASE}/packages/{pkg}/lessons/{world.slides[0]}/retry", headers=h),
        c.post(f"{BASE}/packages/{pkg}/preview-search", json={"query": "q"}, headers=h),
        c.delete(f"{BASE}/data", headers=h),
    ]
    for r in calls:
        assert r.status_code == 403, (r.request.method, r.request.url, r.text)
        assert r.json()["detail"]["code"] == "forbidden"
    with Session() as db:
        assert queue_rows(db, world.inst) == {}
        assert runs_of(db, world.inst) == []
        assert settings_store.get_setting(db, world.inst).enabled is True


def test_teacher_reads_and_scans_but_cannot_manage(api, world, Session):
    _roles(api, world, ["TEACHER"])
    c, h, pkg = api.client, api.headers, world.pkg
    status_body = c.get(f"{BASE}/status", headers=h).json()
    assert status_body["can_manage"] is False and status_body["enabled"] is True

    r = c.get(f"{BASE}/packages/{pkg}/coverage", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["totals"]["not_scanned"] == 3

    r = c.post(f"{BASE}/packages/{pkg}/scan", headers=h)
    assert r.status_code == 202, r.text
    run_id = r.json()["run_id"]
    assert r.json()["lessons_queued"] == 3

    for r in (
        c.post(f"{BASE}/packages/{pkg}/process", json={"expected_credits": 10}, headers=h),
        c.put(f"{BASE}/settings", json={"enabled": False}, headers=h),
        c.post(f"{BASE}/runs/{run_id}/cancel", headers=h),
        c.delete(f"{BASE}/data", headers=h),
    ):
        assert r.status_code == 403, (r.request.url, r.text)
    assert c.get(f"{BASE}/runs/{run_id}", headers=h).status_code == 200
    with Session() as db:
        assert settings_store.get_setting(db, world.inst).enabled is True


def test_other_institutes_course_and_run_are_404(api, world, Session):
    from course_knowledge_pg_helpers import make_course

    other = f"inst-{uuid.uuid4().hex[:8]}"
    with Session() as db:
        foreign = make_course(db, other, 1)
        settings_store.put_setting(db, other, {"enabled": True}, USER)
    r = api.client.get(f"{BASE}/packages/{foreign.package_id}/coverage", headers=api.headers)
    assert r.status_code == 404 and r.json()["detail"]["code"] == "course_not_found"
    assert api.client.post(f"{BASE}/packages/{foreign.package_id}/scan", headers=api.headers).status_code == 404

    # A run of the other institute is invisible.
    api.authorities = {other: {"roles": ["ADMIN"], "permissions": []}}
    oh = {"Authorization": "Bearer t", "clientId": other}
    run_id = api.client.post(f"{BASE}/packages/{foreign.package_id}/scan", headers=oh).json()["run_id"]
    api.authorities = {world.inst: {"roles": ["ADMIN"], "permissions": []}}
    assert api.client.get(f"{BASE}/runs/{run_id}", headers=api.headers).status_code == 404
    assert api.client.post(f"{BASE}/runs/{run_id}/cancel", headers=api.headers).status_code == 404


# ── availability and enablement ──────────────────────────────────────────────

def test_not_available_institute_gets_403(api, world, Session):
    api.available = False
    c, h, pkg = api.client, api.headers, world.pkg
    r = c.get(f"{BASE}/status", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False and body["enabled"] is False
    assert set(body) == {
        "available", "enabled", "learner_answers_enabled", "auto_paid_enabled", "monthly_auto_cap_credits",
        "month_auto_spent_credits", "max_monthly_auto_cap", "allow_ocr", "allow_transcription",
        "paid_available", "links_enabled", "retrieval_mode", "can_manage",
    }
    for r in (
        c.put(f"{BASE}/settings", json={"enabled": True}, headers=h),
        c.get(f"{BASE}/packages/{pkg}/coverage", headers=h),
        c.post(f"{BASE}/packages/{pkg}/scan", headers=h),
        c.post(f"{BASE}/packages/{pkg}/process", json={"expected_credits": 5}, headers=h),
        c.post(f"{BASE}/packages/{pkg}/lessons/{world.slides[0]}/retry", headers=h),
        c.post(f"{BASE}/packages/{pkg}/preview-search", json={"query": "q"}, headers=h),
        c.delete(f"{BASE}/data", headers=h),
    ):
        assert r.status_code == 403, (r.request.url, r.text)
        assert r.json()["detail"]["code"] == "not_available"
    with Session() as db:
        assert queue_rows(db, world.inst) == {}


def test_disabled_institute_gets_409_but_can_turn_it_on(api, world, Session):
    with Session() as db:
        settings_store.put_setting(db, world.inst, {"enabled": False}, USER)
    c, h, pkg = api.client, api.headers, world.pkg
    for r in (
        c.post(f"{BASE}/packages/{pkg}/scan", headers=h),
        c.post(f"{BASE}/packages/{pkg}/process", json={"expected_credits": 5}, headers=h),
        c.post(f"{BASE}/packages/{pkg}/lessons/{world.slides[0]}/retry", headers=h),
    ):
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == "not_enabled"
    r = c.put(f"{BASE}/settings", json={"enabled": True, "monthly_auto_cap_credits": 99999, "allow_ocr": False},
              headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["enabled"] is True and body["allow_ocr"] is False
    assert body["monthly_auto_cap_credits"] == 5000          # clamped to the platform max
    assert c.get(f"{BASE}/settings", headers=h).json()["enabled"] is True
    r = c.put(f"{BASE}/settings", json={"monthly_auto_cap_credits": "lots"}, headers=h)
    assert r.status_code == 422


def test_status_reports_month_spend(api, world, Session):
    with Session() as db:
        budget_id = budget.ensure_month_budget(db, world.inst, 500)
        budget.reserve(db, budget_id, 40)
        budget.settle(db, budget_id, 40, 35)
        db.commit()
    body = api.client.get(f"{BASE}/status", headers=api.headers).json()
    assert body["available"] is True and body["month_auto_spent_credits"] == 35
    assert body["paid_available"] is True and body["can_manage"] is True
    assert body["max_monthly_auto_cap"] == 5000 and body["retrieval_mode"] == "off"


# ── coverage and quote ───────────────────────────────────────────────────────

def test_quote_sums_per_lesson_ceilings(api, world, Session, monkeypatch):
    with Session() as db:
        for sid in world.slides:
            needs_ocr(db, world.inst, sid, 1)
        set_balance(db, world.inst, 100)
    calls = []
    real = billing.quote_credits

    def spy(db, inst, tool, units):
        calls.append((tool, units))
        return real(db, inst, tool, units)

    monkeypatch.setattr(billing, "quote_credits", spy)
    r = api.client.get(f"{BASE}/packages/{world.pkg}/coverage", headers=api.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    # 0.5 per page, rounded up per lesson: 1 + 1 + 1, never ceil(3 x 0.5) = 2.
    assert body["quote"]["credits"] == 3
    assert body["quote"]["items"] == [{"kind": "ocr_pages", "units": 3, "credits": 3, "lessons": 3}]
    assert body["quote"]["approx"] is False
    assert body["totals"]["needs_processing"] == 3 and body["totals"]["credits_required"] == 3
    assert body["balance"] == {"current_balance": 100, "balance_after": 97, "sufficient": True}
    assert body["active_run"] is None
    assert calls == [("course_kb_ocr_page", 1)]                  # memoized per (tool, units)
    lesson = lessons_by_id(body)[world.slides[0]]
    assert lesson["state"] == "NEEDS_PROCESSING" and lesson["units"] == 1 and lesson["credits"] == 1
    assert lesson["doc_type"] == "HTML" and lesson["chapter_id"] == world.course.chapter_id
    assert lesson["reason"] == "Scanned PDF · 1 page need reading"
    assert set(lesson) == {
        "slide_id", "title", "chapter_id", "chapter_name", "source_type", "doc_type", "state", "reason",
        "units", "credits", "credits_charged", "chunk_count", "anchor_kind", "updated_at", "kept_transcript",
    }


def test_shared_file_is_charged_once_and_cached_file_is_free(api, world, Session):
    shared, cached = f"file-{uuid.uuid4().hex[:8]}", f"file-{uuid.uuid4().hex[:8]}"
    with Session() as db:
        needs_ocr(db, world.inst, world.slides[0], 4, shared)
        needs_ocr(db, world.inst, world.slides[1], 4, shared)
        needs_ocr(db, world.inst, world.slides[2], 6, cached)
        cache_paid(db, cached)
    body = api.client.get(f"{BASE}/packages/{world.pkg}/coverage", headers=api.headers).json()
    lessons = lessons_by_id(body)
    assert body["quote"]["credits"] == 2                         # 4 pages x 0.5, once
    assert body["quote"]["items"] == [{"kind": "ocr_pages", "units": 4, "credits": 2, "lessons": 1}]
    assert lessons[world.slides[0]]["credits"] == 2
    assert lessons[world.slides[1]]["credits"] == 0
    assert lessons[world.slides[1]]["reason"] == "Uses the same file as Lesson 1"
    assert lessons[world.slides[2]]["credits"] == 0
    assert lessons[world.slides[2]]["reason"] == "Already processed"
    assert body["balance"]["sufficient"] is None                 # no wallet row


def test_coverage_states_and_media_quote(api, world, Session):
    from course_knowledge_pg_helpers import make_course

    with Session() as db:
        course = make_course(db, world.inst, 6)
        s = course.slide_ids
        set_state(db, world.inst, s[0], "READY")
        set_state(db, world.inst, s[1], "UNSUPPORTED", note="Word file: upload it as PDF to make it readable")
        set_state(db, world.inst, s[2], "FAILED", note="Download failed")
        db.execute(text("UPDATE slide SET source_type = 'ASSESSMENT' WHERE id = :s"), {"s": s[3]})
        db.commit()
        make_video(db, s[4], 125_000)                            # 2 min 5 s -> 3 min
        make_video(db, s[5], None)                               # unknown -> 10 min, approx
        db.execute(text(
            "INSERT INTO content_index_queue (institute_id, slide_id, status) VALUES (:i, :s, 'PENDING')"
        ), {"i": world.inst, "s": s[0]})
        db.commit()
    body = api.client.get(f"{BASE}/packages/{course.package_id}/coverage", headers=api.headers).json()
    lessons = lessons_by_id(body)
    assert lessons[s[0]]["state"] == "PROCESSING"
    assert lessons[s[1]]["state"] == "CANT_READ"
    assert lessons[s[1]]["reason"].startswith("Word file")
    assert lessons[s[2]]["state"] == "FAILED" and lessons[s[2]]["reason"] == "Download failed"
    assert lessons[s[3]]["state"] == "EXCLUDED"
    assert lessons[s[4]]["state"] == "NOT_SCANNED" and lessons[s[4]]["units"] == 3
    assert lessons[s[5]]["units"] == 10 and "about 10 min" in lessons[s[5]]["reason"]
    t = body["totals"]
    assert (t["lessons"], t["processing"], t["cant_read"], t["failed"], t["excluded"], t["not_scanned"]) == \
        (6, 1, 1, 1, 1, 2)
    # 3 min -> ceil(1.5) = 2, 10 min -> 5: 7 credits, approximate.
    assert body["quote"] == {"credits": 7, "approx": True, "items": [
        {"kind": "transcribe_minutes", "units": 13, "credits": 7, "lessons": 2}]}


def test_kinds_switched_off_in_settings_are_not_quoted(api, world, Session):
    with Session() as db:
        needs_ocr(db, world.inst, world.slides[0], 2)
        settings_store.put_setting(db, world.inst, {"allow_ocr": False}, USER)
    body = api.client.get(f"{BASE}/packages/{world.pkg}/coverage", headers=api.headers).json()
    assert body["quote"]["credits"] == 0
    assert lessons_by_id(body)[world.slides[0]]["reason"] == "Reading scanned pages is turned off in Settings"


# ── scan ─────────────────────────────────────────────────────────────────────

def test_scan_queues_every_readable_lesson_free_and_is_rate_limited(api, world, Session):
    with Session() as db:
        db.execute(text("UPDATE slide SET source_type = 'ASSESSMENT' WHERE id = :s"), {"s": world.slides[2]})
        db.commit()
    r = api.client.post(f"{BASE}/packages/{world.pkg}/scan", headers=api.headers)
    assert r.status_code == 202, r.text
    run_id = r.json()["run_id"]
    assert r.json()["lessons_queued"] == 2
    with Session() as db:
        rows = queue_rows(db, world.inst)
        assert set(rows) == set(world.slides[:2])
        assert all(not row["allow_paid"] and row["run_id"] == run_id and row["reason"] == "MAKE_READY_SCAN"
                   for row in rows.values())
        assert [(x["kind"], x["status"]) for x in runs_of(db, world.inst)] == [("SCAN", "RUNNING")]

    r = api.client.post(f"{BASE}/packages/{world.pkg}/scan", headers=api.headers)
    assert r.status_code == 409 and r.json()["detail"] == {
        "code": "scan_running", "run_id": run_id, "message": "This course is already being scanned."}

    run = api.client.get(f"{BASE}/runs/{run_id}", headers=api.headers).json()
    assert (run["kind"], run["status"], run["total"], run["pending"]) == ("SCAN", "RUNNING", 2, 2)
    assert run["quoted_credits"] == 0 and run["finished_at"] is None

    cov = api.client.get(f"{BASE}/packages/{world.pkg}/coverage", headers=api.headers).json()
    assert cov["active_run"]["id"] == run_id and cov["active_run"]["pending"] == 2
    assert cov["totals"]["processing"] == 2

    with Session() as db:   # the sweep closed it
        db.execute(text("UPDATE course_knowledge_run SET status = 'DONE', finished_at = now() WHERE id = :r"),
                   {"r": run_id})
        db.commit()
    r = api.client.post(f"{BASE}/packages/{world.pkg}/scan", headers=api.headers)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "scan_rate_limited"
    assert int(r.headers["Retry-After"]) > 0


# ── process ──────────────────────────────────────────────────────────────────

def test_process_409_when_the_quote_changed(api, world, Session):
    with Session() as db:
        for sid in world.slides:
            needs_ocr(db, world.inst, sid, 1)
    r = api.client.post(f"{BASE}/packages/{world.pkg}/process", json={"expected_credits": 2}, headers=api.headers)
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "QUOTE_CHANGED" and detail["quote"]["credits"] == 3
    with Session() as db:
        assert runs_of(db, world.inst) == [] and queue_rows(db, world.inst) == {}


def test_process_402_has_the_kb_preflight_shape(api, world, Session):
    with Session() as db:
        for sid in world.slides:
            needs_ocr(db, world.inst, sid, 1)
        set_balance(db, world.inst, 1)
    r = api.client.post(f"{BASE}/packages/{world.pkg}/process", json={"expected_credits": 3}, headers=api.headers)
    assert r.status_code == 402, r.text
    detail = r.json()["detail"]
    assert set(detail) == {"message", "estimate"}
    assert "3 credits" in detail["message"] and "only 1" in detail["message"]
    assert detail["estimate"] == {"estimated_credits": 3, "current_balance": 1, "balance_after": -2,
                                  "sufficient": False}
    with Session() as db:
        assert runs_of(db, world.inst) == []


def test_plan_covered_preflight_passes_a_short_balance(api, world, Session, monkeypatch):
    with Session() as db:
        needs_ocr(db, world.inst, world.slides[0], 2)
        set_balance(db, world.inst, 0)
    monkeypatch.setattr(ck_router, "preflight_tool_credits",
                        lambda db, **kw: {"estimated_credits": 1, "sufficient": True, "plan_covered": "INCLUDED"})
    r = api.client.post(f"{BASE}/packages/{world.pkg}/process", json={"expected_credits": 1}, headers=api.headers)
    assert r.status_code == 202, r.text


def test_null_balance_is_allowed_and_only_quoted_lessons_get_allow_paid(api, world, Session, monkeypatch):
    shared, cached = f"file-{uuid.uuid4().hex[:8]}", f"file-{uuid.uuid4().hex[:8]}"
    from course_knowledge_pg_helpers import make_course

    with Session() as db:
        extra = make_course(db, world.inst, 1).slide_ids[0]      # other course: untouched
        needs_ocr(db, world.inst, world.slides[0], 3, shared)
        needs_ocr(db, world.inst, world.slides[1], 3, shared)
        needs_ocr(db, world.inst, world.slides[2], 5, cached)
        needs_ocr(db, world.inst, extra, 5)
        cache_paid(db, cached)
    preflights = []
    real = ck_router.preflight_tool_credits

    def spy(db, **kw):
        preflights.append(kw)
        return real(db, **kw)

    monkeypatch.setattr(ck_router, "preflight_tool_credits", spy)
    r = api.client.post(f"{BASE}/packages/{world.pkg}/process", json={"expected_credits": 2}, headers=api.headers)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["quoted_credits"] == 2 and body["lessons_queued"] == 1    # 3 pages x 0.5 -> 2, once
    run_id = body["run_id"]
    assert len(preflights) == 1
    assert preflights[0]["tool_key"] == "course_kb_ocr_page" and preflights[0]["tool_params"] == {"num_pages": 3}
    assert preflights[0]["use_case"] == "course_knowledge" and preflights[0]["institute_id"] == world.inst
    meter = preflights[0]["metering"]
    field = (lambda k: meter.get(k)) if isinstance(meter, dict) else (lambda k: getattr(meter, k, None))
    assert field("actor_user_id") == USER and field("surface") == "ADMIN_APP"
    with Session() as db:
        rows = queue_rows(db, world.inst)
        assert rows[world.slides[0]]["allow_paid"] is True and rows[world.slides[0]]["run_id"] == run_id
        assert rows[world.slides[0]]["reason"] == "MAKE_READY_PROCESS"
        assert world.slides[1] not in rows                       # shared file: re-queued after delivery
        assert rows[world.slides[2]]["allow_paid"] is False and rows[world.slides[2]]["run_id"] is None
        assert extra not in rows
        run = runs_of(db, world.inst)[-1]
        assert (run["kind"], run["status"], Decimal(run["quoted_credits"])) == ("PROCESS", "RUNNING", Decimal("2"))
        cap = db.execute(text("SELECT cap_credits, kind FROM course_knowledge_budget WHERE id = :id"),
                         {"id": budget.run_budget_id(run_id)}).fetchone()
        assert (Decimal(cap[0]), cap[1]) == (Decimal("2"), "RUN")

    # A second click while the run is queued: nothing left to pay for.
    r = api.client.post(f"{BASE}/packages/{world.pkg}/process", json={"expected_credits": 2}, headers=api.headers)
    assert r.status_code == 200 and r.json()["run_id"] is None


def test_process_with_paid_off_or_nothing_to_do(api, world, Session):
    r = api.client.post(f"{BASE}/packages/{world.pkg}/process", json={"expected_credits": 0}, headers=api.headers)
    assert r.status_code == 200 and r.json()["run_id"] is None and r.json()["message"]
    with Session() as db:
        needs_ocr(db, world.inst, world.slides[0], 2)
    api.paid = False
    r = api.client.post(f"{BASE}/packages/{world.pkg}/process", json={"expected_credits": 1}, headers=api.headers)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "paid_not_available"


def test_usage_limit_429_propagates(api, world, Session, monkeypatch):
    with Session() as db:
        needs_ocr(db, world.inst, world.slides[0], 2)
    exc_type = limit_gate.limit_exceeded_types()[-1]

    def blocked(db, **kw):
        raise exc_type({"error": "AI_USAGE_LIMIT", "message": "Monthly limit reached"}, 60)

    monkeypatch.setattr(ck_router, "preflight_tool_credits", blocked)
    r = api.client.post(f"{BASE}/packages/{world.pkg}/process", json={"expected_credits": 1}, headers=api.headers)
    assert r.status_code == 429, r.text
    with Session() as db:
        assert runs_of(db, world.inst) == []


# ── cancel ───────────────────────────────────────────────────────────────────

def test_cancel_releases_the_budget(api, world, Session):
    with Session() as db:
        for sid in world.slides[:2]:
            needs_ocr(db, world.inst, sid, 1)
    run_id = api.client.post(f"{BASE}/packages/{world.pkg}/process", json={"expected_credits": 2},
                             headers=api.headers).json()["run_id"]
    bid = budget.run_budget_id(run_id)
    in_flight = world.slides[0]
    with Session() as db:   # the worker claimed one lesson and reserved its quote
        db.execute(text("UPDATE content_index_queue SET status = 'PROCESSING' WHERE institute_id = :i AND slide_id = :s"),
                   {"i": world.inst, "s": in_flight})
        assert budget.reserve(db, bid, 1, institute_id=world.inst, slide_id=in_flight)
        db.commit()

    r = api.client.post(f"{BASE}/runs/{run_id}/cancel", headers=api.headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "CANCELLED" and r.json()["finished_at"]
    with Session() as db:
        rows = queue_rows(db, world.inst)
        assert rows[world.slides[1]]["allow_paid"] is False and rows[world.slides[1]]["run_id"] is None
        assert rows[in_flight]["run_id"] == run_id               # in flight: settles within the cap
        cap, reserved, charged = db.execute(text(
            "SELECT cap_credits, reserved_credits, charged_credits FROM course_knowledge_budget WHERE id = :id"
        ), {"id": bid}).fetchone()
        assert Decimal(cap) == Decimal("1") and Decimal(reserved) == Decimal("1") and Decimal(charged) == 0
        assert budget.reserve(db, bid, 1) is False               # no new spending
        db.rollback()
    # Cancelling again returns the run unchanged.
    again = api.client.post(f"{BASE}/runs/{run_id}/cancel", headers=api.headers)
    assert again.status_code == 200 and again.json()["status"] == "CANCELLED"


# ── retry, preview, delete ───────────────────────────────────────────────────

def test_retry_queues_one_lesson_free(api, world, Session):
    with Session() as db:
        set_state(db, world.inst, world.slides[1], "FAILED", note="boom")
    r = api.client.post(f"{BASE}/packages/{world.pkg}/lessons/{world.slides[1]}/retry", headers=api.headers)
    assert r.status_code == 202 and r.json() == {"slide_id": world.slides[1], "queued": True}
    with Session() as db:
        rows = queue_rows(db, world.inst)
        assert set(rows) == {world.slides[1]} and rows[world.slides[1]]["allow_paid"] is False
    r = api.client.post(f"{BASE}/packages/{world.pkg}/lessons/not-a-lesson/retry", headers=api.headers)
    assert r.status_code == 404


def test_preview_search_uses_the_staff_scope_and_no_llm(api, world, Session, monkeypatch):
    seen = {}

    async def fake_search(*, scope, query, mode, query_vec=None, top_k=None):
        seen.update(scope=scope, query=query, mode=mode)
        hit = retrieval.CourseHit(
            slide_id=world.slides[0], chunk_id="c1", source_id="s1", title="Lesson 1", chapter_title="Chapter",
            chapter_id=world.course.chapter_id, package_id=world.pkg, package_session_id=world.course.package_session_id,
            source_type="DOCUMENT", excerpt="Body of lesson 1.", similarity=0.8, score=0.91234, tier=3,
            page_start=4, page_end=4, t_start_ms=None, href="/x?page=4", badge="p. 4", icon="pdf",
            label="Chapter › Lesson 1 (p. 4)",
        )
        return retrieval.CourseSearchResult(hits=(hit,), signposts=(), kb_hits=(), latency_ms=3, truncated=False,
                                            mode=mode, error=None, leak_blocked=0)

    monkeypatch.setattr(retrieval, "search_course", fake_search)
    r = api.client.post(f"{BASE}/packages/{world.pkg}/preview-search", json={"query": "lesson body"},
                        headers=api.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["note"] == "Preview searches every published lesson and ignores drip locks."
    assert body["hits"] == [{"slide_id": world.slides[0], "title": "Lesson 1", "chapter_name": "Chapter",
                             "excerpt": "Body of lesson 1.", "page": 4, "t_start_ms": None, "score": 0.9123,
                             "href": "/x?page=4"}]
    assert seen["mode"] == "preview" and seen["query"] == "lesson body"
    assert seen["scope"].open_ids() == world.slides and seen["scope"].drip_mode == "staff_preview"
    r = api.client.post(f"{BASE}/packages/not-mine/preview-search", json={"query": "x"}, headers=api.headers)
    assert r.status_code == 404


def test_delete_data_drops_the_index_queue_and_setting(api, world, Session):
    with Session() as db:
        needs_ocr(db, world.inst, world.slides[0], 1)
    api.client.post(f"{BASE}/packages/{world.pkg}/scan", headers=api.headers)
    r = api.client.delete(f"{BASE}/data", headers=api.headers)
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] is True and r.json()["runs_cancelled"] == 1
    with Session() as db:
        assert store.get_course_kb(db, world.inst) is None
        assert queue_rows(db, world.inst) == {}
        assert settings_store.get_setting(db, world.inst).enabled is False
        assert {x["status"] for x in runs_of(db, world.inst)} == {"CANCELLED"}
