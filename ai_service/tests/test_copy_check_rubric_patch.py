"""Rubric store PATCH semantics (spec 7.4.1, T0.20, gate G5).

The old store had one write: a full replace of the assessment's rubric map,
so a partner editing one question had to resend all of them, and the
per-question PUT nulled the step rubric whenever only a model answer was sent.
Now: per-question merge under a row lock with one version bump, `if_match`,
institute mismatch refused, and the PUT only touches the fields it was sent.
No DB: an in-memory session double stands in for SQLAlchemy.
"""
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db import db_dependency
from app.dependencies import require_internal_service_token
from app.models.copy_check import CopyCheckQuestionAnswer, CopyCheckRubric
from app.repositories.copy_check_rubric_repository import (
    CopyCheckRubricRepository,
    RubricInstituteMismatch,
    RubricVersionMismatch,
    merge_question_patches,
)
from app.routers import copy_check as router_module

INST_A = "inst-a"
INST_B = "inst-b"
RUBRIC = {"max_marks": 5.0, "partial_marking_enabled": True, "evaluation_instructions": "",
          "rubric": [{"criteria_name": "Point", "max_marks": 5.0, "keywords": [], "evaluation_guidelines": ""}]}


class _Query:
    def __init__(self, db, model):
        self.db, self.model, self.filters, self.locked = db, model, {}, False

    def filter_by(self, **kw):
        self.filters.update(kw)
        return self

    def with_for_update(self):
        self.locked = True
        self.db.locks += 1
        return self

    def first(self):
        for row in self.db.rows:
            if isinstance(row, self.model) and all(getattr(row, k, None) == v for k, v in self.filters.items()):
                return row
        return None


class FakeDb:
    """Enough of a Session for the rubric repositories."""

    def __init__(self, *rows):
        self.rows = list(rows)
        self.commits = 0
        self.rollbacks = 0
        self.locks = 0

    def query(self, model):
        return _Query(self, model)

    def add(self, row):
        self.rows.append(row)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def refresh(self, _row):
        pass

    def delete(self, row):
        self.rows.remove(row)


def _rubric_row(institute_id=INST_A, version=3, rubric=None, answers=None):
    return CopyCheckRubric(
        assessment_id="asmt-1", institute_id=institute_id, rubric_version=version,
        rubric_json=json.dumps(rubric if rubric is not None else {"q1": RUBRIC, "q2": RUBRIC}),
        model_answers_json=json.dumps(answers if answers is not None else {"q1": "old q1", "q2": "old q2"}),
    )


# ── pure merge ──────────────────────────────────────────────────────────────

def test_merge_leaves_unnamed_questions_and_missing_keys_alone():
    rubric, answers = merge_question_patches(
        {"q1": {"a": 1}, "q2": {"b": 2}}, {"q1": "x", "q2": "y"},
        {"q1": {"model_answer": "new"}},
    )
    assert rubric == {"q1": {"a": 1}, "q2": {"b": 2}}
    assert answers == {"q1": "new", "q2": "y"}


def test_merge_null_deletes_and_value_replaces():
    rubric, answers = merge_question_patches(
        {"q1": {"a": 1}}, {"q1": "x"},
        {"q1": {"rubric": None, "model_answer": None}, "q3": {"rubric": {"c": 3}}},
    )
    assert rubric == {"q3": {"c": 3}}
    assert answers == {}


def test_merge_does_not_mutate_its_inputs():
    stored_rubric, stored_answers = {"q1": {"a": 1}}, {"q1": "x"}
    merge_question_patches(stored_rubric, stored_answers, {"q1": {"rubric": None, "model_answer": None}})
    assert stored_rubric == {"q1": {"a": 1}} and stored_answers == {"q1": "x"}


# ── repository ──────────────────────────────────────────────────────────────

def test_patch_bumps_the_version_once_for_many_questions_under_a_lock():
    db = FakeDb(_rubric_row(version=3))
    row = CopyCheckRubricRepository(db).patch_questions(
        "asmt-1", INST_A,
        {"q1": {"model_answer": "new q1"}, "q2": {"rubric": None}, "q3": {"rubric": RUBRIC}},
    )
    assert row.rubric_version == 4
    assert db.commits == 1 and db.locks >= 1
    assert json.loads(row.rubric_json) == {"q1": RUBRIC, "q3": RUBRIC}
    assert json.loads(row.model_answers_json) == {"q1": "new q1", "q2": "old q2"}


def test_patch_creates_the_row_at_version_one():
    db = FakeDb()
    row = CopyCheckRubricRepository(db).patch_questions("asmt-1", INST_A, {"q1": {"rubric": RUBRIC}})
    assert row.rubric_version == 1 and row.institute_id == INST_A
    assert json.loads(row.rubric_json) == {"q1": RUBRIC}
    assert json.loads(row.model_answers_json) == {}


def test_patch_refuses_another_institutes_row_and_writes_nothing():
    db = FakeDb(_rubric_row(institute_id=INST_A))
    with pytest.raises(RubricInstituteMismatch):
        CopyCheckRubricRepository(db).patch_questions("asmt-1", INST_B, {"q1": {"model_answer": "x"}})
    row = db.rows[0]
    assert row.rubric_version == 3 and json.loads(row.model_answers_json)["q1"] == "old q1"
    assert db.commits == 0 and db.rollbacks == 1


def test_patch_if_match_must_equal_the_current_version():
    db = FakeDb(_rubric_row(version=3))
    repo = CopyCheckRubricRepository(db)
    with pytest.raises(RubricVersionMismatch) as e:
        repo.patch_questions("asmt-1", INST_A, {"q1": {"model_answer": "x"}}, if_match=2)
    assert e.value.current == 3 and db.commits == 0
    assert repo.patch_questions("asmt-1", INST_A, {"q1": {"model_answer": "x"}}, if_match=3).rubric_version == 4


def test_patch_if_match_on_a_missing_row_is_version_zero():
    with pytest.raises(RubricVersionMismatch):
        CopyCheckRubricRepository(FakeDb()).patch_questions("asmt-1", INST_A, {"q1": {"rubric": RUBRIC}}, if_match=1)
    row = CopyCheckRubricRepository(FakeDb()).patch_questions(
        "asmt-1", INST_A, {"q1": {"rubric": RUBRIC}}, if_match=0)
    assert row.rubric_version == 1


def test_patch_clears_the_older_per_question_override_it_supersedes():
    override = CopyCheckQuestionAnswer(id="o1", assessment_id="asmt-1", question_id="q1",
                                       model_answer="override answer", step_rubric_json=json.dumps(RUBRIC))
    db = FakeDb(_rubric_row(), override)
    CopyCheckRubricRepository(db).patch_questions("asmt-1", INST_A, {"q1": {"model_answer": "patched"}})
    # Only the field the patch wrote is cleared on the override.
    assert override.model_answer is None
    assert override.step_rubric_json == json.dumps(RUBRIC)


def test_legacy_upsert_still_full_replaces_but_takes_the_lock():
    db = FakeDb(_rubric_row(version=3))
    row = CopyCheckRubricRepository(db).upsert("asmt-1", INST_A, {"q9": RUBRIC})
    assert row.rubric_version == 4 and json.loads(row.rubric_json) == {"q9": RUBRIC}
    assert db.locks >= 1


def test_bump_version_creates_an_empty_row_only_when_the_institute_is_known():
    db = FakeDb()
    assert CopyCheckRubricRepository(db).bump_version("asmt-1", None) is None
    assert db.rows == []
    assert CopyCheckRubricRepository(db).bump_version("asmt-1", INST_A) == 1
    assert json.loads(db.rows[0].rubric_json) == {}
    assert CopyCheckRubricRepository(db).bump_version("asmt-1", INST_A) == 2
    with pytest.raises(RubricInstituteMismatch):
        CopyCheckRubricRepository(db).bump_version("asmt-1", INST_B)


# ── routes ──────────────────────────────────────────────────────────────────

def _client(db):
    app = FastAPI()
    app.include_router(router_module.router)
    app.dependency_overrides[require_internal_service_token] = lambda: None
    app.dependency_overrides[db_dependency] = lambda: db
    return TestClient(app)


def test_patch_route_merges_and_returns_the_version():
    db = FakeDb(_rubric_row(version=3))
    resp = _client(db).patch("/copy-check/rubric/asmt-1", json={
        "institute_id": INST_A,
        "questions": {"q1": {"model_answer": "new"}, "q2": {"rubric": None}},
    })
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"version": 4}
    row = db.rows[0]
    assert set(json.loads(row.rubric_json)) == {"q1"}
    assert json.loads(row.model_answers_json) == {"q1": "new", "q2": "old q2"}


def test_patch_route_status_codes():
    db = FakeDb(_rubric_row(version=3))
    client = _client(db)
    body = {"institute_id": INST_B, "questions": {"q1": {"model_answer": "x"}}}
    assert client.patch("/copy-check/rubric/asmt-1", json=body).status_code == 409
    body = {"institute_id": INST_A, "questions": {"q1": {"model_answer": "x"}}, "if_match": 1}
    assert client.patch("/copy-check/rubric/asmt-1", json=body).status_code == 412
    # Empty patch and a malformed rubric are refused before any write.
    assert client.patch("/copy-check/rubric/asmt-1", json={"institute_id": INST_A, "questions": {}}).status_code == 422
    bad = {"institute_id": INST_A, "questions": {"q1": {"rubric": {"rubric": []}}}}
    assert client.patch("/copy-check/rubric/asmt-1", json=bad).status_code == 422
    assert db.rows[0].rubric_version == 3


def test_put_question_sending_only_a_model_answer_keeps_the_step_rubric_and_bumps():
    override = CopyCheckQuestionAnswer(id="o1", assessment_id="asmt-1", question_id="q1",
                                       model_answer="old", step_rubric_json=json.dumps(RUBRIC))
    db = FakeDb(_rubric_row(version=3), override)
    resp = _client(db).put("/copy-check/rubric/asmt-1/question/q1?institute_id=" + INST_A,
                           json={"model_answer": "new"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["rubric_version"] == 4 and resp.json()["model_answer"] == "new"
    assert override.step_rubric_json == json.dumps(RUBRIC)
    assert db.commits == 1


def test_put_question_null_clears_a_field():
    override = CopyCheckQuestionAnswer(id="o1", assessment_id="asmt-1", question_id="q1",
                                       model_answer="old", step_rubric_json=json.dumps(RUBRIC))
    db = FakeDb(_rubric_row(version=3), override)
    resp = _client(db).put("/copy-check/rubric/asmt-1/question/q1?institute_id=" + INST_A,
                           json={"step_rubric": None})
    assert resp.status_code == 200
    assert override.step_rubric_json is None and override.model_answer == "old"


def test_put_question_bumps_even_when_no_rubric_row_existed():
    db = FakeDb()
    resp = _client(db).put("/copy-check/rubric/asmt-1/question/q1?institute_id=" + INST_A,
                           json={"model_answer": "first"})
    assert resp.status_code == 200
    assert resp.json()["rubric_version"] == 1
    assert any(isinstance(r, CopyCheckRubric) for r in db.rows)


def test_put_question_refuses_another_institute_without_writing_the_override():
    db = FakeDb(_rubric_row(institute_id=INST_A, version=3))
    resp = _client(db).put("/copy-check/rubric/asmt-1/question/q1?institute_id=" + INST_B,
                           json={"model_answer": "evil"})
    assert resp.status_code == 403
    assert not any(isinstance(r, CopyCheckQuestionAnswer) for r in db.rows)
    assert db.rows[0].rubric_version == 3


class _RaceDb(FakeDb):
    """First commit loses the race: another request created the rubric row
    between our locked read (nothing to lock) and our insert."""

    def __init__(self):
        super().__init__()
        self.raced = False

    def commit(self):
        if not self.raced:
            self.raced = True
            from sqlalchemy.exc import IntegrityError
            self.rows = [_rubric_row(version=1, rubric={}, answers={})]   # the winner's row only
            raise IntegrityError("duplicate key value violates unique constraint", None, None)
        super().commit()


def test_put_question_retries_once_when_two_first_writes_race():
    db = _RaceDb()
    resp = _client(db).put("/copy-check/rubric/asmt-1/question/q1?institute_id=" + INST_A,
                           json={"model_answer": "second"})
    assert resp.status_code == 200, resp.text
    # The retry locked the winner's row and bumped it, instead of a 500.
    assert resp.json()["rubric_version"] == 2 and resp.json()["model_answer"] == "second"
    assert db.rollbacks >= 1 and db.commits == 1
    assert sum(isinstance(r, CopyCheckRubric) for r in db.rows) == 1
