"""SQLAlchemy models for copy-check rubrics and per-question model answers.

These persist the "fixed test" mode — pre-authored rubrics that bypass the
LLM-derived criteria-generation path and let the grader prompt-cache the
rubric block across every student's copy.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Index, Integer, String, Text

from .ai_gen_video import Base


class CopyCheckRubric(Base):
    """One rubric per (institute, assessment). Versioned so the FE can show
    a 'rubric changed since this evaluation' badge on stale evaluations."""

    __tablename__ = "copy_check_rubric"

    assessment_id = Column(String(64), primary_key=True)
    institute_id = Column(String(64), nullable=False)
    rubric_version = Column(Integer, nullable=False, default=1)
    rubric_json = Column(Text, nullable=False)            # {question_id: CriteriaRubricDto}
    model_answers_json = Column(Text, nullable=True)      # {question_id: "model answer text"}
    created_by = Column(String(64), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_copy_check_rubric_institute", "institute_id"),
    )


class CopyCheckQuestionAnswer(Base):
    """Per-question model answer + step rubric. Lets authors edit one
    question without rewriting the whole CopyCheckRubric.rubric_json blob."""

    __tablename__ = "copy_check_question_answer"

    id = Column(String(64), primary_key=True)
    assessment_id = Column(String(64), nullable=False)
    question_id = Column(String(64), nullable=False)
    model_answer = Column(Text, nullable=True)
    step_rubric_json = Column(Text, nullable=True)        # CriteriaRubricDto
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_copy_check_qa_assessment", "assessment_id"),
        Index("idx_copy_check_qa_assessment_question", "assessment_id", "question_id", unique=True),
    )


class CopyCheckJob(Base):
    """Cross-pod claim on one grade run (spec 11.2, gate G6). Table created by
    the admin_core migration (V546); ai_service only reads and writes it, with
    raw ON CONFLICT SQL in CopyCheckJobRepository.

    One row per assessment_service process_id. The pod running it refreshes
    heartbeat_at every 30 s; another /grade for the same process gets the
    existing job back while the heartbeat is younger than 2 minutes (whatever
    the status) and takes the row over once it is older. Columns mirror V546.
    """

    __tablename__ = "copy_check_job"

    process_id = Column(String(255), primary_key=True)
    job_id = Column(String(64), nullable=False)
    pod = Column(String(255), nullable=True)
    heartbeat_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(String(16), nullable=False, default="RUNNING")   # RUNNING | COMPLETED | FAILED
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


__all__ = ["CopyCheckRubric", "CopyCheckQuestionAnswer", "CopyCheckJob"]
