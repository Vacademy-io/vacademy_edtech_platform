"""Repository for the copy_check_rubric table."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.copy_check import CopyCheckQuestionAnswer, CopyCheckRubric

# A question patch: {"rubric": {...} | None, "model_answer": "..." | None}.
# A key that is absent leaves that field alone; a key present with None deletes it.
QuestionPatch = dict[str, Any]


class RubricInstituteMismatch(Exception):
    """A write named a different institute than the one that owns the rubric row."""


class RubricVersionMismatch(Exception):
    """`if_match` named a rubric_version other than the current one."""

    def __init__(self, current: int):
        super().__init__(f"rubric version is {current}")
        self.current = current


def _loads_map(raw: Optional[str]) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def merge_question_patches(
    rubric: dict[str, Any],
    model_answers: dict[str, Any],
    patches: dict[str, QuestionPatch],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Apply per-question patches to copies of the two stored maps.

    For each question: a `rubric` key replaces that question's rubric (None
    removes it); a `model_answer` key does the same for its model answer. A
    question not named, or a key not sent, is left exactly as stored - the
    old full-replace upsert silently dropped every question the caller did
    not resend.
    """
    rubric = dict(rubric)
    model_answers = dict(model_answers)
    for qid, patch in patches.items():
        if "rubric" in patch:
            if patch["rubric"] is None:
                rubric.pop(qid, None)
            else:
                rubric[qid] = patch["rubric"]
        if "model_answer" in patch:
            if patch["model_answer"] is None:
                model_answers.pop(qid, None)
            else:
                model_answers[qid] = patch["model_answer"]
    return rubric, model_answers


def ensure_same_institute(row: Optional[CopyCheckRubric], institute_id: Optional[str]) -> None:
    """Raise RubricInstituteMismatch when an existing row belongs to another institute."""
    if row is not None and str(row.institute_id) != str(institute_id):
        raise RubricInstituteMismatch(
            f"rubric for assessment {row.assessment_id} belongs to another institute"
        )


class CopyCheckRubricRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, assessment_id: str) -> Optional[CopyCheckRubric]:
        return self.db.query(CopyCheckRubric).filter_by(assessment_id=assessment_id).first()

    def get_for_update(self, assessment_id: str) -> Optional[CopyCheckRubric]:
        """The row under SELECT ... FOR UPDATE: concurrent writers (a patch, a
        per-question PUT, a sibling job merging generated rubrics) queue on it
        instead of overwriting each other's read-modify-write."""
        return (
            self.db.query(CopyCheckRubric)
            .filter_by(assessment_id=assessment_id)
            .with_for_update()
            .first()
        )

    def upsert(
        self,
        assessment_id: str,
        institute_id: str,
        rubric: dict[str, Any],
        model_answers: Optional[dict[str, str]] = None,
        created_by: Optional[str] = None,
    ) -> CopyCheckRubric:
        """Legacy full replace behind POST /copy-check/rubric (the dashboard's
        pass-through): the body is the whole rubric, so a question it leaves
        out is removed. New callers use patch_questions()."""
        existing = self.get_for_update(assessment_id)
        try:
            ensure_same_institute(existing, institute_id)
        except RubricInstituteMismatch:
            self.db.rollback()  # release the row lock
            raise
        if existing:
            existing.rubric_version = existing.rubric_version + 1
            existing.rubric_json = json.dumps(rubric)
            existing.model_answers_json = json.dumps(model_answers or {})
            existing.updated_at = datetime.utcnow()
            row = existing
        else:
            row = CopyCheckRubric(
                assessment_id=assessment_id,
                institute_id=institute_id,
                rubric_version=1,
                rubric_json=json.dumps(rubric),
                model_answers_json=json.dumps(model_answers or {}),
                created_by=created_by,
            )
            self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def patch_questions(
        self,
        assessment_id: str,
        institute_id: str,
        patches: dict[str, QuestionPatch],
        if_match: Optional[int] = None,
        updated_by: Optional[str] = None,
    ) -> CopyCheckRubric:
        """Merge per-question rubric / model-answer changes under a row lock and
        bump rubric_version exactly once, in one transaction (spec 7.4.1).

        Creates the row (version 1) when the assessment has none yet, owned by
        `institute_id`: the first writer takes tenancy, so the caller must have
        verified that the assessment belongs to that institute. Raises
        RubricInstituteMismatch when the row belongs to another institute and
        RubricVersionMismatch when `if_match` is not the current version (no
        row = version 0); either way nothing is written.

        A field written here also clears the same field on the question's
        per-question override row (copy_check_question_answer), which
        load_snapshot() ranks above the assessment rubric: otherwise an older
        override would silently win over the newer patch.
        """
        try:
            return self._patch_questions_once(assessment_id, institute_id, patches, if_match, updated_by)
        except IntegrityError:
            # A concurrent writer created the row between our locked read (no
            # row to lock) and our insert. Retry once against its row.
            self.db.rollback()
            return self._patch_questions_once(assessment_id, institute_id, patches, if_match, updated_by)

    def _patch_questions_once(
        self,
        assessment_id: str,
        institute_id: str,
        patches: dict[str, QuestionPatch],
        if_match: Optional[int],
        updated_by: Optional[str],
    ) -> CopyCheckRubric:
        row = self.get_for_update(assessment_id)
        try:
            ensure_same_institute(row, institute_id)
            current_version = int(row.rubric_version or 0) if row is not None else 0
            if if_match is not None and int(if_match) != current_version:
                raise RubricVersionMismatch(current_version)
        except (RubricInstituteMismatch, RubricVersionMismatch):
            self.db.rollback()  # release the row lock
            raise
        current_rubric = _loads_map(row.rubric_json) if row is not None else {}
        current_answers = _loads_map(row.model_answers_json) if row is not None else {}
        rubric, answers = merge_question_patches(current_rubric, current_answers, patches)
        now = datetime.utcnow()
        if row is None:
            row = CopyCheckRubric(
                assessment_id=assessment_id,
                institute_id=institute_id,
                rubric_version=1,
                rubric_json=json.dumps(rubric),
                model_answers_json=json.dumps(answers),
                created_by=updated_by,
            )
            self.db.add(row)
        else:
            row.rubric_version = current_version + 1
            row.rubric_json = json.dumps(rubric)
            row.model_answers_json = json.dumps(answers)
            row.updated_at = now
        self._clear_shadowing_overrides(assessment_id, patches, now)
        self.db.commit()
        self.db.refresh(row)
        return row

    def _clear_shadowing_overrides(
        self, assessment_id: str, patches: dict[str, QuestionPatch], now: datetime,
    ) -> None:
        for qid, patch in patches.items():
            touches_rubric = "rubric" in patch
            touches_answer = "model_answer" in patch
            if not (touches_rubric or touches_answer):
                continue
            override = (
                self.db.query(CopyCheckQuestionAnswer)
                .filter_by(assessment_id=assessment_id, question_id=qid)
                .first()
            )
            if override is None:
                continue
            if touches_rubric:
                override.step_rubric_json = None
            if touches_answer:
                override.model_answer = None
            override.updated_at = now

    def bump_version(
        self,
        assessment_id: str,
        institute_id: Optional[str],
        updated_by: Optional[str] = None,
        commit: bool = True,
    ) -> Optional[int]:
        """One version bump under the row lock, for writes stored outside
        rubric_json (the per-question override PUT). Creates an empty row at
        version 1 when none exists and the institute is known, so the first
        override still gets a version results can be compared against.
        Returns the new version, or None when there is no row and no institute.
        Raises RubricInstituteMismatch when the row belongs to another institute.
        """
        row = self.get_for_update(assessment_id)
        if institute_id:
            try:
                ensure_same_institute(row, institute_id)
            except RubricInstituteMismatch:
                self.db.rollback()
                raise
        if row is None:
            if not institute_id:
                return None
            row = CopyCheckRubric(
                assessment_id=assessment_id,
                institute_id=institute_id,
                rubric_version=1,
                rubric_json=json.dumps({}),
                model_answers_json=json.dumps({}),
                created_by=updated_by,
            )
            self.db.add(row)
        else:
            row.rubric_version = int(row.rubric_version or 0) + 1
            row.updated_at = datetime.utcnow()
        if commit:
            self.db.commit()
        return int(row.rubric_version)

    def merge_generated_rubrics(
        self,
        assessment_id: str,
        institute_id: str,
        generated: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        """Merge AI-generated per-question rubrics into the assessment's fixed
        rubric, first-writer-wins (an existing question entry is never
        overwritten), so every student's job grades against identical criteria
        instead of re-inventing a rubric per copy.

        Concurrency-safe: if a sibling job created the row first, we retry the
        merge against the now-existing row. Returns the authoritative rubric map
        for the given question_ids (the DB-stored version where present), so the
        calling job converges on the same criteria as every other job.

        Raises RubricInstituteMismatch (and writes nothing) when the row belongs
        to another institute; the orchestrator then grades with in-memory rubrics.
        """
        def _merge_into(current: dict[str, Any]) -> bool:
            added = False
            for qid, rub in generated.items():
                if qid not in current:
                    current[qid] = rub
                    added = True
            return added

        def _authoritative(current: dict[str, Any]) -> dict[str, dict[str, Any]]:
            return {qid: current.get(qid, generated[qid]) for qid in generated}

        try:
            existing = self.get_for_update(assessment_id)
            try:
                ensure_same_institute(existing, institute_id)
            except RubricInstituteMismatch:
                self.db.rollback()  # release the row lock
                raise
            if existing:
                current = json.loads(existing.rubric_json) if existing.rubric_json else {}
                if _merge_into(current):
                    existing.rubric_json = json.dumps(current)
                    existing.rubric_version = (existing.rubric_version or 1) + 1
                    existing.updated_at = datetime.utcnow()
                self.db.commit()
                return _authoritative(current)
            row = CopyCheckRubric(
                assessment_id=assessment_id,
                institute_id=institute_id,
                rubric_version=1,
                rubric_json=json.dumps(dict(generated)),
                model_answers_json=json.dumps({}),
            )
            self.db.add(row)
            self.db.commit()
            return dict(generated)
        except IntegrityError:
            # A sibling job inserted the row between our get() and commit().
            self.db.rollback()
            existing = self.get_for_update(assessment_id)
            if existing is None:
                return dict(generated)
            try:
                ensure_same_institute(existing, institute_id)
            except RubricInstituteMismatch:
                self.db.rollback()
                raise
            current = json.loads(existing.rubric_json) if existing.rubric_json else {}
            if _merge_into(current):
                existing.rubric_json = json.dumps(current)
                existing.rubric_version = (existing.rubric_version or 1) + 1
                existing.updated_at = datetime.utcnow()
                self.db.commit()
            return _authoritative(current)

    def delete(self, assessment_id: str) -> bool:
        row = self.get(assessment_id)
        if not row:
            return False
        self.db.delete(row)
        self.db.commit()
        return True
