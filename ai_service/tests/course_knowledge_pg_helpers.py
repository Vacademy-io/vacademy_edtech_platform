"""Shared REAL-Postgres scaffolding for the course-knowledge PG tests.

pg_session_factory() creates a scratch database, enables pgvector, creates
minimal stubs of the tables the KB migrations touch but do not create (and of
the admin_core course tables the course-knowledge SQL reads), then applies the
real Flyway files V435, V443, V445, V517, V600 and V602, each in one transaction like
Flyway. Driver: SQLAlchemy + psycopg 3 (the prod driver, where INSERT .. ON
CONFLICT reports rowcount -1: decide from RETURNING).

Needs a Postgres 16 with pgvector: set AI_LIMITS_PG_URL (a server URL,
postgresql+psycopg://...; a scratch database is created and dropped), or
AI_LIMITS_PGDATA (a pgserver data directory). Callers are skipped otherwise.

Usage (module-scoped, one scratch database per test module):

    from course_knowledge_pg_helpers import make_course, make_enrolment, pg_session_factory

    @pytest.fixture(scope="module")
    def Session():
        factory = pg_session_factory()
        yield factory
        factory.close()

The admin_core stubs keep the V1 column names and types for the columns the
course-knowledge code reads (status, orders, published columns, drip JSON) but
drop the foreign keys, so a test can insert just the rows it needs. The video
lesson table is `video` (VideoSlide.java @Table(name = "video")), as on prod.
"""
from __future__ import annotations

import atexit
import os
import uuid
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import List, Optional

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

MIGRATIONS = Path(__file__).resolve().parents[2] / "admin_core_service/src/main/resources/db/migration"
KB_MIGRATIONS = ("V435", "V443", "V445", "V517", "V600", "V602")

# Pre-existing tables the KB migrations INSERT into / ALTER / read (V435 fold-in of
# knowledge_base_items + content_embeddings, the ai_token_usage CHECK swap, the
# ai_model_defaults seeds; V435/V445/V600 pricing; V600 catalog row) plus the
# ledger and institutes rows the course-knowledge code touches.
PLATFORM_STUBS = """
CREATE TABLE IF NOT EXISTS institutes (
    id           VARCHAR(255) PRIMARY KEY,
    setting_json TEXT
);
CREATE TABLE IF NOT EXISTS knowledge_base_items (
    id           VARCHAR(255) PRIMARY KEY,
    institute_id VARCHAR(255),
    title        VARCHAR(500),
    content      TEXT,
    category     VARCHAR(100),
    tags         TEXT[],
    is_active    BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS content_embeddings (
    id           VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    source_type  VARCHAR(50),
    source_id    VARCHAR(255),
    content_text TEXT,
    chunk_index  INTEGER DEFAULT 0,
    embedding    vector(768),
    meta_data    JSONB,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ai_token_usage (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id VARCHAR(255),
    request_type VARCHAR(50)
);
CREATE TABLE IF NOT EXISTS ai_model_defaults (
    use_case           VARCHAR(100) PRIMARY KEY,
    default_model_id   VARCHAR(255),
    fallback_model_id  VARCHAR(255),
    free_tier_model_id VARCHAR(255),
    description        TEXT,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ai_tool_pricing (
    tool_key          VARCHAR(64)   PRIMARY KEY,
    request_type      VARCHAR(64)   NOT NULL,
    flat_base_credits DECIMAL(10,4) NOT NULL DEFAULT 0,
    per_unit_credits  DECIMAL(10,4) NOT NULL DEFAULT 0,
    unit_field        VARCHAR(32)   NOT NULL,
    params_json       JSONB         NOT NULL DEFAULT '{}'::jsonb,
    is_active         BOOLEAN       DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS ai_use_case_catalog (
    use_case               VARCHAR(64) PRIMARY KEY,
    feature_group          VARCHAR(48) NOT NULL,
    label                  VARCHAR(128) NOT NULL,
    label_template         VARCHAR(255),
    count_unit_label       VARCHAR(32) DEFAULT 'requests',
    model_use_case         VARCHAR(64),
    legacy_request_types   TEXT[] NOT NULL DEFAULT '{}',
    tool_keys              TEXT[] NOT NULL DEFAULT '{}',
    capability_key         VARCHAR(64),
    default_surface        VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
    actor_kind             VARCHAR(16) NOT NULL DEFAULT 'USER',
    unit_kind              VARCHAR(16) NOT NULL DEFAULT 'TOKENS',
    plan_eligible          BOOLEAN NOT NULL DEFAULT TRUE,
    limit_eligible         BOOLEAN NOT NULL DEFAULT TRUE,
    reserve_on_authorize   BOOLEAN NOT NULL DEFAULT FALSE,
    intentionally_separate BOOLEAN NOT NULL DEFAULT FALSE,
    display_order          INT NOT NULL DEFAULT 100,
    updated_by             VARCHAR(255),
    billing_feature_key    VARCHAR(48)
);
CREATE TABLE IF NOT EXISTS credit_transactions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id          VARCHAR(255) NOT NULL,
    amount                DECIMAL(12,4) NOT NULL,
    transaction_type      VARCHAR(50) NOT NULL,
    external_reference_id VARCHAR(255),
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_transactions_external_reference_id
    ON credit_transactions (external_reference_id) WHERE external_reference_id IS NOT NULL;
"""

# admin_core course tables (V1 / V54 / V76 / V77 / V88 / V116 / V14 / V459 shapes, no FKs).
COURSE_STUBS = """
CREATE TABLE IF NOT EXISTS package (
    id                  VARCHAR(255) PRIMARY KEY,
    package_name        VARCHAR(255),
    status              VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    package_type        VARCHAR(50) DEFAULT 'COURSE',
    drip_condition_json TEXT,
    created_by_user_id  VARCHAR(255),
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS package_institute (
    id           VARCHAR PRIMARY KEY,
    package_id   VARCHAR(255),
    institute_id VARCHAR NOT NULL,
    group_id     VARCHAR(255),
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS session (
    id           VARCHAR(255) PRIMARY KEY,
    session_name VARCHAR(255),
    status       VARCHAR(255),
    start_date   DATE,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS package_session (
    id         VARCHAR(255) PRIMARY KEY,
    level_id   VARCHAR(255),
    session_id VARCHAR(255),
    package_id VARCHAR(255),
    group_id   VARCHAR(255),
    start_time DATE,
    status     VARCHAR(255),
    is_parent  BOOLEAN DEFAULT FALSE,
    parent_id  VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subject (
    id                 VARCHAR(255) PRIMARY KEY,
    subject_name       VARCHAR(255),
    subject_code       VARCHAR(255),
    status             VARCHAR(255),
    parent_id          VARCHAR(255),
    created_by_user_id VARCHAR(255),
    created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subject_session (
    id            VARCHAR(255) PRIMARY KEY,
    subject_id    VARCHAR(255),
    session_id    VARCHAR(255),          -- package_session.id
    subject_order INTEGER,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS modules (
    id                 VARCHAR(255) PRIMARY KEY,
    module_name        VARCHAR(255),
    status             VARCHAR(255),
    description        VARCHAR(255),
    parent_id          VARCHAR(255),
    created_by_user_id VARCHAR(255)
);
CREATE TABLE IF NOT EXISTS subject_module_mapping (
    id           VARCHAR PRIMARY KEY,
    subject_id   VARCHAR NOT NULL,
    module_id    VARCHAR NOT NULL,
    module_order INTEGER,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chapter (
    id                  VARCHAR(255) PRIMARY KEY,
    chapter_name        VARCHAR(255),
    status              VARCHAR(255),
    description         TEXT,
    file_id             VARCHAR(255),
    parent_id           VARCHAR(255),
    drip_condition_json TEXT,
    created_by_user_id  VARCHAR(255),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS module_chapter_mapping (
    id         VARCHAR PRIMARY KEY,
    chapter_id VARCHAR NOT NULL,
    module_id  VARCHAR NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chapter_package_session_mapping (
    id                 VARCHAR PRIMARY KEY,
    chapter_id         VARCHAR NOT NULL,
    package_session_id VARCHAR NOT NULL,
    status             VARCHAR(50),
    chapter_order      INTEGER,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cpsm_ps_live ON chapter_package_session_mapping (package_session_id)
    WHERE status <> 'DELETED';
CREATE TABLE IF NOT EXISTS slide (
    id                  VARCHAR(255) PRIMARY KEY,
    source_id           VARCHAR(255),
    source_type         VARCHAR(255),
    title               VARCHAR(255),
    image_file_id       VARCHAR(255),
    description         TEXT,
    status              VARCHAR(255),
    last_sync_date      TIMESTAMP,
    parent_id           VARCHAR(255),
    drip_condition_json TEXT,
    created_by_user_id  VARCHAR(255),
    created_at          TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chapter_to_slides (
    id          VARCHAR(255) PRIMARY KEY,
    chapter_id  VARCHAR(255),
    slide_id    VARCHAR(255),
    slide_order INTEGER,
    status      VARCHAR(255),
    created_at  TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cts_chapter_live ON chapter_to_slides (chapter_id) WHERE status <> 'DELETED';
CREATE INDEX IF NOT EXISTS idx_cts_slide_live ON chapter_to_slides (slide_id) WHERE status <> 'DELETED';
CREATE TABLE IF NOT EXISTS student_session_institute_group_mapping (
    id                             VARCHAR PRIMARY KEY,
    user_id                        VARCHAR(255),
    package_session_id             VARCHAR(255),
    institute_id                   VARCHAR(255),
    group_id                       VARCHAR(255),
    enrolled_date                  DATE,
    status                         VARCHAR(255),
    type                           VARCHAR(100),
    type_id                        VARCHAR(100),
    expiry_date                    TIMESTAMP,
    destination_package_session_id VARCHAR(255),
    user_plan_id                   VARCHAR(255),
    institute_enrollment_number    VARCHAR,
    created_at                     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS document_slide (
    id                             VARCHAR(255) PRIMARY KEY,
    type                           VARCHAR(255),
    data                           TEXT,
    title                          VARCHAR(255),
    cover_file_id                  VARCHAR(255),
    total_pages                    INTEGER,
    published_data                 TEXT,
    published_document_total_pages INTEGER,
    created_at                     TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    updated_at                     TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS video (
    id                     VARCHAR(255) PRIMARY KEY,
    description            VARCHAR(255),
    title                  VARCHAR(255),
    url                    VARCHAR(255),
    video_length           BIGINT,
    published_url          VARCHAR(255),
    published_video_length BIGINT,
    source_type            VARCHAR(255),
    embedded_type          VARCHAR(255),
    embedded_data          TEXT,
    created_at             TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audio_slide (
    id                               VARCHAR(255) PRIMARY KEY,
    title                            VARCHAR(255),
    description                      TEXT,
    audio_file_id                    VARCHAR(255),
    thumbnail_file_id                VARCHAR(255),
    audio_length_in_millis           BIGINT,
    published_audio_file_id          VARCHAR(255),
    published_audio_length_in_millis BIGINT,
    source_type                      VARCHAR(50),
    external_url                     VARCHAR(500),
    transcript                       TEXT,
    created_at                       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS scorm_slide (
    id               VARCHAR(255) PRIMARY KEY,
    original_file_id VARCHAR(255),
    launch_path      VARCHAR(512),
    launch_url       VARCHAR(512),
    scorm_version    VARCHAR(50),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS html_video_slide (
    id                 VARCHAR(255) PRIMARY KEY,
    ai_gen_video_id    VARCHAR(255),
    url                VARCHAR(255),
    video_length       BIGINT,
    code_editor_config JSON,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rich_text_data (
    id      VARCHAR(255) PRIMARY KEY,
    type    VARCHAR(255) NOT NULL,
    content TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quiz_slide_question (
    id                     VARCHAR PRIMARY KEY,
    parent_rich_text_id    VARCHAR,
    text_id                VARCHAR,
    explanation_text_id    VARCHAR,
    media_id               VARCHAR,
    status                 VARCHAR,
    question_response_type VARCHAR NOT NULL DEFAULT 'OPTION',
    question_type          VARCHAR NOT NULL DEFAULT 'MCQS',
    access_level           VARCHAR NOT NULL DEFAULT 'INSTITUTE',
    auto_evaluation_json   TEXT,
    evaluation_type        VARCHAR,
    question_order         INTEGER,
    quiz_slide_id          VARCHAR,
    can_skip               BOOLEAN DEFAULT TRUE,
    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS quiz_slide_question_options (
    id                     VARCHAR PRIMARY KEY,
    quiz_slide_question_id VARCHAR NOT NULL,
    text_id                VARCHAR,
    explanation_text_id    VARCHAR,
    media_id               VARCHAR,
    created_on             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_on             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS learner_operation (
    id         VARCHAR(255) PRIMARY KEY,
    user_id    VARCHAR(255),
    source     VARCHAR(255),
    source_id  VARCHAR(255),
    operation  VARCHAR(255),
    value      VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

# Factories still open at interpreter exit get their scratch database dropped.
_open_factories: List["sessionmaker"] = []


def migration_sql(prefix: str) -> str:
    """The text of the one migration file whose name starts with `<prefix>__`."""
    hits = sorted(MIGRATIONS.glob(f"{prefix}__*.sql"))
    if not hits:
        pytest.skip(f"{prefix} migration not in this checkout")
    return hits[0].read_text(encoding="utf-8")


def apply_migration(engine, prefix: str) -> None:
    """Run one Flyway file in a single transaction, as Flyway does (so SET LOCAL holds)."""
    sql = migration_sql(prefix)
    with engine.begin() as c:
        c.exec_driver_sql(sql)


def _server_url() -> Optional[str]:
    url = os.environ.get("AI_LIMITS_PG_URL")
    if url:
        return url
    data = os.environ.get("AI_LIMITS_PGDATA")
    if not data:
        return None
    try:
        import pgserver  # noqa: PLC0415

        uri = pgserver.get_server(data, cleanup_mode=None).get_uri()
    except Exception:  # noqa: BLE001
        return None
    return uri.replace("postgresql://", "postgresql+psycopg://", 1)


def _db_url(base: str, name: str) -> str:
    if "/postgres?" in base:
        return base.replace("/postgres?", f"/{name}?")
    head, _, tail = base.rpartition("/")
    query = ""
    if "?" in tail:
        query = "?" + tail.split("?", 1)[1]
    return f"{head}/{name}{query}"


def pg_session_factory(*, pool_size: int = 20):
    """A sessionmaker bound to a fresh scratch database with the KB + course-knowledge
    schema applied. Skips the calling test when no Postgres (or psycopg 3) is available.

    The returned factory also carries:
      .engine       the SQLAlchemy engine (pool sized for concurrency tests)
      .url          the scratch database URL
      .apply(p)     re-run migration `p` (e.g. "V600") in one transaction
      .close()      dispose the engine and drop the scratch database (also run at exit)
    """
    base = _server_url()
    if not base:
        pytest.skip("no Postgres: set AI_LIMITS_PG_URL or AI_LIMITS_PGDATA")
    try:
        import psycopg  # noqa: F401,PLC0415
    except Exception:  # noqa: BLE001
        pytest.skip("psycopg 3 not installed")

    name = f"ck_{uuid.uuid4().hex[:10]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT", future=True)
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"'))
    url = _db_url(base, name)
    engine = create_engine(url, pool_size=pool_size, max_overflow=5, future=True)
    try:
        with engine.begin() as c:
            try:
                c.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
            except Exception as exc:  # noqa: BLE001
                raise RuntimeError(f"pgvector is required for the course-knowledge PG tests: {exc}") from exc
        with engine.begin() as c:
            c.exec_driver_sql(PLATFORM_STUBS)
            c.exec_driver_sql(COURSE_STUBS)
        for prefix in KB_MIGRATIONS:
            apply_migration(engine, prefix)
    except BaseException:
        engine.dispose()
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()
        raise

    factory = sessionmaker(bind=engine, future=True, expire_on_commit=False)
    state = {"closed": False}

    def close() -> None:
        if state["closed"]:
            return
        state["closed"] = True
        engine.dispose()
        try:
            with admin.connect() as c:
                c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        finally:
            admin.dispose()

    factory.engine = engine
    factory.url = url
    factory.apply = lambda prefix: apply_migration(engine, prefix)
    factory.close = close
    _open_factories.append(factory)
    return factory


@atexit.register
def _drop_leftovers() -> None:
    for f in _open_factories:
        try:
            f.close()
        except Exception:  # noqa: BLE001
            pass


def _id() -> str:
    return str(uuid.uuid4())


@dataclass
class CourseIds:
    institute_id: str
    package_id: str
    session_id: str
    package_session_id: str
    subject_id: str
    module_id: str
    chapter_id: str
    slide_ids: List[str] = field(default_factory=list)
    document_ids: List[str] = field(default_factory=list)


def make_course(db, institute_id: str, n_slides: int, status: str = "PUBLISHED", *,
                start_date: Optional[date] = None, chapter_status: str = "ACTIVE") -> CourseIds:
    """Insert one course for `institute_id` and commit: package (+ package_institute),
    session (start_date, default today), batch (package_session ACTIVE), subject linked
    to the batch through subject_session, module, chapter mapped to the batch
    (chapter_package_session_mapping `chapter_status`), and `n_slides` DOCUMENT/HTML
    lessons with published_data, each slide and chapter_to_slides row in `status`.
    Returns their ids (slide_ids in slide_order)."""
    ids = CourseIds(institute_id=institute_id, package_id=_id(), session_id=_id(), package_session_id=_id(),
                    subject_id=_id(), module_id=_id(), chapter_id=_id())
    db.execute(text("INSERT INTO institutes (id, setting_json) VALUES (:i, NULL) ON CONFLICT (id) DO NOTHING"),
               {"i": institute_id})
    db.execute(text("INSERT INTO package (id, package_name, status) VALUES (:id, :n, 'ACTIVE')"),
               {"id": ids.package_id, "n": f"Course {ids.package_id[:6]}"})
    db.execute(text("INSERT INTO package_institute (id, package_id, institute_id) VALUES (:id, :p, :i)"),
               {"id": _id(), "p": ids.package_id, "i": institute_id})
    db.execute(text("INSERT INTO session (id, session_name, status, start_date) VALUES (:id, 'Session', 'ACTIVE', :d)"),
               {"id": ids.session_id, "d": start_date or date.today()})
    db.execute(text("INSERT INTO package_session (id, session_id, package_id, status) VALUES (:id, :s, :p, 'ACTIVE')"),
               {"id": ids.package_session_id, "s": ids.session_id, "p": ids.package_id})
    db.execute(text("INSERT INTO subject (id, subject_name, status) VALUES (:id, 'Subject', 'ACTIVE')"),
               {"id": ids.subject_id})
    db.execute(text("INSERT INTO subject_session (id, subject_id, session_id, subject_order) VALUES (:id, :sub, :ps, 1)"),
               {"id": _id(), "sub": ids.subject_id, "ps": ids.package_session_id})
    db.execute(text("INSERT INTO modules (id, module_name, status) VALUES (:id, 'Module', 'ACTIVE')"),
               {"id": ids.module_id})
    db.execute(text("INSERT INTO subject_module_mapping (id, subject_id, module_id, module_order) "
                    "VALUES (:id, :sub, :m, 1)"),
               {"id": _id(), "sub": ids.subject_id, "m": ids.module_id})
    db.execute(text("INSERT INTO chapter (id, chapter_name, status) VALUES (:id, 'Chapter', 'ACTIVE')"),
               {"id": ids.chapter_id})
    db.execute(text("INSERT INTO module_chapter_mapping (id, chapter_id, module_id) VALUES (:id, :c, :m)"),
               {"id": _id(), "c": ids.chapter_id, "m": ids.module_id})
    db.execute(text("INSERT INTO chapter_package_session_mapping (id, chapter_id, package_session_id, status, "
                    "chapter_order) VALUES (:id, :c, :ps, :st, 1)"),
               {"id": _id(), "c": ids.chapter_id, "ps": ids.package_session_id, "st": chapter_status})
    for n in range(1, n_slides + 1):
        slide_id, doc_id = _id(), _id()
        body = f"<h1>Lesson {n}</h1><p>Body of lesson {n}.</p>"
        db.execute(text("INSERT INTO document_slide (id, type, data, title, published_data, total_pages, "
                        "published_document_total_pages) VALUES (:id, 'HTML', :b, :t, :b, 1, 1)"),
                   {"id": doc_id, "b": body, "t": f"Lesson {n}"})
        db.execute(text("INSERT INTO slide (id, source_id, source_type, title, description, status, last_sync_date) "
                        "VALUES (:id, :src, 'DOCUMENT', :t, :d, :st, now())"),
                   {"id": slide_id, "src": doc_id, "t": f"Lesson {n}", "d": f"About lesson {n}", "st": status})
        db.execute(text("INSERT INTO chapter_to_slides (id, chapter_id, slide_id, slide_order, status) "
                        "VALUES (:id, :c, :s, :o, :st)"),
                   {"id": _id(), "c": ids.chapter_id, "s": slide_id, "o": n, "st": status})
        ids.slide_ids.append(slide_id)
        ids.document_ids.append(doc_id)
    db.commit()
    return ids


def make_enrolment(db, user_id: str, package_session_id: str, institute_id: str, **cols) -> str:
    """Insert one student_session_institute_group_mapping row (ACTIVE, enrolled today,
    no type, no expiry unless overridden by `cols`, e.g. status=, type=, expiry_date=)
    and commit. Returns its id."""
    row = {"id": _id(), "user_id": user_id, "package_session_id": package_session_id,
           "institute_id": institute_id, "status": "ACTIVE", "enrolled_date": date.today()}
    row.update(cols)
    names = list(row)
    db.execute(text(f"INSERT INTO student_session_institute_group_mapping ({', '.join(names)}) "
                    f"VALUES ({', '.join(':' + k for k in names)})"), row)
    db.commit()
    return row["id"]
