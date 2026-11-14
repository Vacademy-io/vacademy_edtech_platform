"""
The "has a course here" lookup behind the admission rule on a move to CONVERTED
(crm_lead_edit set_status / log_interaction), run through psycopg 3 on a
throwaway schema (set AI_LIMITS_PG_URL=postgresql+psycopg://...). The tables
hold only the columns the statement reads.

A person has a course when they, or a student linked to them on one of their
leads in the institute, hold an open plan through one of the institute's enrol
invites or an enrolment that counts in one of its batches, the admissions
report's own rules.
"""
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.services import assistant_tool_registry as registry  # noqa: E402,F401  (loads the tool modules in order)
from app.services import assistant_tools_crm_lead_edit as m  # noqa: E402
from app.services import institute_setting_reader as isr  # noqa: E402
from crm_fakes import make_ctx  # noqa: E402

_DDL = """
CREATE TABLE audience (id varchar(255) PRIMARY KEY, institute_id varchar(255));
CREATE TABLE audience_response (id varchar(255) PRIMARY KEY, audience_id varchar(255), user_id varchar(255),
                                student_user_id varchar(255));
CREATE TABLE enroll_invite (id varchar(255) PRIMARY KEY, institute_id varchar(255));
CREATE TABLE user_plan (id varchar(255) PRIMARY KEY, user_id varchar(255), status varchar(255),
                        enroll_invite_id varchar(255));
CREATE TABLE package (id varchar(255) PRIMARY KEY);
CREATE TABLE package_session (id varchar(255) PRIMARY KEY, package_id varchar(255));
CREATE TABLE student_session_institute_group_mapping (id varchar(255) PRIMARY KEY, user_id varchar(255),
                                                      institute_id varchar(255), status varchar(255),
                                                      source varchar(255), package_session_id varchar(255));
"""

_SEED = """
INSERT INTO audience VALUES ('list-i', 'I'), ('list-i2', 'I'), ('list-x', 'X');
INSERT INTO enroll_invite VALUES ('inv-i', 'I'), ('inv-x', 'X');
INSERT INTO package VALUES ('pkg');
INSERT INTO package_session VALUES ('ps-i', 'pkg');
INSERT INTO audience_response VALUES
  ('r-plan', 'list-i', 'u-plan', NULL),
  ('r-pending', 'list-i', 'u-pending', NULL),
  ('r-ended', 'list-i', 'u-ended', NULL),
  ('r-otherinst', 'list-i', 'u-otherinst', NULL),
  ('r-enr', 'list-i', 'u-enr', NULL),
  ('r-completed', 'list-i', 'u-completed', NULL),
  ('r-invited', 'list-i', 'u-invited', NULL),
  ('r-invited-term', 'list-i', 'u-invited-term', NULL),
  ('r-deleted-enr', 'list-i', 'u-deleted-enr', NULL),
  ('r-linked', 'list-i', 'u-parent', 'u-child'),
  ('r-linked-other', 'list-i', 'u-p2', NULL),
  ('r-p2-second', 'list-i2', 'u-p2', 'u-c2'),
  ('r-reverse', 'list-i', 'u-c3', NULL),
  ('r-p3', 'list-i2', 'u-p3', 'u-c3'),
  ('r-link-elsewhere', 'list-i', 'u-p4', NULL),
  ('r-p4-x', 'list-x', 'u-p4', 'u-c4'),
  ('r-bare', 'list-i', NULL, NULL),
  ('r-foreign', 'list-x', 'u-plan', NULL);
INSERT INTO user_plan VALUES
  ('up-1', 'u-plan', 'ACTIVE', 'inv-i'),
  ('up-2', 'u-pending', 'PENDING_FOR_PAYMENT', 'inv-i'),
  ('up-3', 'u-ended', 'TERMINATED', 'inv-i'),
  ('up-4', 'u-ended', 'PAYMENT_FAILED', 'inv-i'),
  ('up-5', 'u-otherinst', 'ACTIVE', 'inv-x'),
  ('up-6', 'u-child', 'ACTIVE', 'inv-i'),
  ('up-7', 'u-c2', 'ACTIVE', 'inv-i'),
  ('up-8', 'u-p3', 'ACTIVE', 'inv-i'),
  ('up-9', 'u-c4', 'ACTIVE', 'inv-i');
INSERT INTO student_session_institute_group_mapping VALUES
  ('s-1', 'u-enr', 'I', 'ACTIVE', NULL, 'ps-i'),
  ('s-2', 'u-completed', 'I', 'COMPLETED', NULL, 'ps-i'),
  ('s-3', 'u-invited', 'I', 'INVITED', 'LEAD', 'ps-i'),
  ('s-4', 'u-invited-term', 'I', 'INVITED', 'TERMINATED', 'ps-i'),
  ('s-5', 'u-deleted-enr', 'I', 'DELETED', NULL, 'ps-i'),
  ('s-6', 'u-otherinst', 'X', 'ACTIVE', NULL, 'ps-i');
"""


@pytest.fixture
def pg_ctx(monkeypatch):
    url = os.environ.get("AI_LIMITS_PG_URL")
    if not url:
        pytest.skip("set AI_LIMITS_PG_URL to run on a throwaway Postgres")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    schema = "crm_admit_" + uuid.uuid4().hex[:12]
    admin = create_engine(url)
    with admin.begin() as c:
        c.exec_driver_sql(f"CREATE SCHEMA {schema}")
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    assert engine.dialect.driver == "psycopg"
    with engine.begin() as c:
        c.exec_driver_sql(_DDL)
        c.exec_driver_sql(_SEED)
    db = Session(bind=engine, future=True)
    try:
        yield make_ctx(db=db, institute_id="I")
    finally:
        db.close()
        engine.dispose()
        with admin.begin() as c:
            c.exec_driver_sql(f"DROP SCHEMA {schema} CASCADE")
        admin.dispose()


def test_who_has_no_course_here(pg_ctx, monkeypatch):
    monkeypatch.setattr(isr, "load_institute_setting_data",
                        lambda db, inst, key: {"admissionCourseRule": {"mode": "WARN"}})
    leads = ["r-plan", "r-pending", "r-ended", "r-otherinst", "r-enr", "r-completed", "r-invited", "r-invited-term",
             "r-deleted-enr", "r-linked", "r-linked-other", "r-reverse", "r-link-elsewhere", "r-bare", "r-foreign"]
    out = m._admission_check(pg_ctx, {"status_key": "CONVERTED"}, leads)
    assert out["mode"] == "WARN"
    # r-foreign is another institute's lead, so it is never reported; a link made on another institute's lead
    # (r-link-elsewhere) does not count here.
    assert sorted(out["missing"]) == ["r-bare", "r-deleted-enr", "r-ended", "r-invited-term", "r-link-elsewhere",
                                      "r-otherinst"]


def test_another_status_or_rule_off_runs_no_query(pg_ctx, monkeypatch):
    monkeypatch.setattr(isr, "load_institute_setting_data", lambda db, inst, key: None)
    assert m._admission_check(pg_ctx, {"status_key": "CONVERTED"}, ["r-bare"]) == {"mode": "OFF", "missing": []}
    monkeypatch.setattr(isr, "load_institute_setting_data",
                        lambda db, inst, key: {"admissionCourseRule": {"mode": "BLOCK"}})
    assert m._admission_check(pg_ctx, {"status_key": "INTERESTED"}, ["r-bare"]) == {"mode": "OFF", "missing": []}
    assert m._admission_check(pg_ctx, {"status_key": "CONVERTED"}, ["r-bare"]) == {"mode": "BLOCK",
                                                                                  "missing": ["r-bare"]}
