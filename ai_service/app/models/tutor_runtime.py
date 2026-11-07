"""Live AI Tutor — learner runtime tables (V494 §5-7)."""
from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB

from .ai_gen_video import Base


def _uuid() -> str:
    return str(uuid4())


class TutorLearnerState(Base):
    __tablename__ = "tutor_learner_state"

    id = Column(String(255), primary_key=True, default=_uuid)
    user_id = Column(String(255), nullable=False)
    package_session_id = Column(String(255), nullable=False)
    institute_id = Column(String(255), nullable=False)
    current_slide_id = Column(String(255), nullable=True)
    current_topic_id = Column(String(255), nullable=True)
    current_concept_id = Column(String(255), nullable=True)
    # V497: where in the slide (teach | await_answer | remediate | media_task |
    # topic_summary | slide_done) and one position per slide.
    current_phase = Column(String(32), nullable=True)
    progress_json = Column(JSONB, nullable=False, default=dict)
    mastery_json = Column(JSONB, nullable=False, default=dict)
    misconceptions_json = Column(JSONB, nullable=False, default=list)
    weak_concepts_json = Column(JSONB, nullable=False, default=list)
    rolling_summary = Column(Text, nullable=True)
    preferred_language = Column(String(20), nullable=True)
    pace = Column(String(10), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class TutorSession(Base):
    __tablename__ = "tutor_session"

    id = Column(String(255), primary_key=True, default=_uuid)
    user_id = Column(String(255), nullable=False)
    institute_id = Column(String(255), nullable=False)
    package_session_id = Column(String(255), nullable=False)
    chat_session_id = Column(String(255), nullable=True)
    mode = Column(String(10), nullable=False, default="TEXT")
    tts_provider = Column(String(20), nullable=True)
    tts_voice = Column(String(80), nullable=True)
    language = Column(String(20), nullable=True)
    started_slide_id = Column(String(255), nullable=True)
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    status = Column(String(20), nullable=False, default="ACTIVE")
    minutes_billed = Column(Integer, nullable=False, default=0)
    summary_json = Column(JSONB, nullable=True)


class TutorConceptAttempt(Base):
    __tablename__ = "tutor_concept_attempt"

    id = Column(String(255), primary_key=True, default=_uuid)
    tutor_session_id = Column(String(255), ForeignKey("tutor_session.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(255), nullable=False)
    concept_id = Column(String(255), nullable=False)
    attempt_no = Column(Integer, nullable=False, default=1)
    student_answer = Column(Text, nullable=True)
    score = Column(Numeric(4, 3), nullable=True)
    misconception = Column(Text, nullable=True)
    action_taken = Column(String(20), nullable=True)
    session_ops_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
