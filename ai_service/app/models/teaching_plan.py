"""Live AI Tutor — compiled teaching plans (V494).

One TeachingPlan per (slide, version); topics own concepts; media rows hang
off the plan. ai_service writes these rows (same ownership pattern as the
knowledge-base tables); admin_core only reads them.
"""
from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import relationship

from .ai_gen_video import Base


def _uuid() -> str:
    return str(uuid4())


class TeachingPlan(Base):
    __tablename__ = "teaching_plan"

    id = Column(String(255), primary_key=True, default=_uuid)
    slide_id = Column(String(255), nullable=False, index=True)
    institute_id = Column(String(255), nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)
    content_hash = Column(String(80), nullable=False)
    language = Column(String(20), nullable=False, default="en")
    # NEEDS_DETAILS | COMPILING | READY | FAILED | STALE | DELETED
    status = Column(String(20), nullable=False)
    source_description = Column(Text, nullable=True)
    model = Column(String(120), nullable=True)
    objectives_json = Column(JSONB, nullable=True)
    key_terms_json = Column(JSONB, nullable=True)
    raw_plan_json = Column(JSONB, nullable=True)
    error = Column(Text, nullable=True)
    created_by_user_id = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    topics = relationship(
        "TeachingTopic", back_populates="plan", cascade="all, delete-orphan",
        order_by="TeachingTopic.topic_order",
    )
    media = relationship("TeachingMedia", back_populates="plan", cascade="all, delete-orphan")


class TeachingTopic(Base):
    __tablename__ = "teaching_topic"

    id = Column(String(255), primary_key=True, default=_uuid)
    plan_id = Column(String(255), ForeignKey("teaching_plan.id", ondelete="CASCADE"), nullable=False)
    slide_id = Column(String(255), nullable=False)
    topic_order = Column(Integer, nullable=False)
    title = Column(Text, nullable=False)
    estimated_seconds = Column(Integer, nullable=True)
    summary_ops_json = Column(JSONB, nullable=True)
    summary_html = Column(Text, nullable=True)

    plan = relationship("TeachingPlan", back_populates="topics")
    concepts = relationship(
        "TeachingConcept", back_populates="topic", cascade="all, delete-orphan",
        order_by="TeachingConcept.concept_order",
    )


class TeachingConcept(Base):
    __tablename__ = "teaching_concept"

    id = Column(String(255), primary_key=True, default=_uuid)
    topic_id = Column(String(255), ForeignKey("teaching_topic.id", ondelete="CASCADE"), nullable=False)
    plan_id = Column(String(255), nullable=False)
    concept_order = Column(Integer, nullable=False)
    title = Column(Text, nullable=False)
    concept_tags = Column(ARRAY(Text), nullable=False, default=list)
    prerequisites_json = Column(JSONB, nullable=True)
    board_ops_json = Column(JSONB, nullable=False)
    board_html = Column(Text, nullable=False)
    say = Column(Text, nullable=False)
    say_i18n_json = Column(JSONB, nullable=True)
    teach_notes = Column(Text, nullable=True)
    check_json = Column(JSONB, nullable=True)

    topic = relationship("TeachingTopic", back_populates="concepts")


class TeachingMedia(Base):
    __tablename__ = "teaching_media"

    id = Column(String(255), primary_key=True, default=_uuid)
    plan_id = Column(String(255), ForeignKey("teaching_plan.id", ondelete="CASCADE"), nullable=False)
    concept_id = Column(String(255), nullable=True)
    kind = Column(String(20), nullable=False)      # svg | image | video
    source = Column(String(20), nullable=False)    # SVG | STOCK | AI_IMAGE | AI_VIDEO
    file_id = Column(String(255), nullable=True)
    url = Column(Text, nullable=True)
    description = Column(Text, nullable=False)
    parts_json = Column(JSONB, nullable=True)
    cost_credits = Column(Numeric(10, 3), nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    plan = relationship("TeachingPlan", back_populates="media")
