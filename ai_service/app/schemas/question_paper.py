"""Question-paper schemas — mirror media_service AutoQuestionPaperResponse and
its nested DTOs (all @JsonNaming SnakeCaseStrategy → snake_case wire keys).

This is the shared output shape for ALL question-generation features
(text/html/pdf/image/audio). The frontend assessment builder parses
`auto_evaluation_json` (a JSON string) to recover correct answers, so the engine
that fills these must reproduce that structure exactly (see question_format.py).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class AssessmentRichTextDataDTO(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    type: Optional[str] = None
    content: Optional[str] = None


class OptionDTO(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    preview_id: Optional[str] = None
    question_id: Optional[str] = None
    text: Optional[AssessmentRichTextDataDTO] = None
    media_id: Optional[str] = None
    option_order: Optional[int] = None
    created_on: Optional[str] = None
    updated_on: Optional[str] = None
    explanation_text: Optional[AssessmentRichTextDataDTO] = None


class QuestionDTO(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    preview_id: Optional[str] = None
    section_id: Optional[str] = None
    question_order_in_section: Optional[int] = None
    text: Optional[AssessmentRichTextDataDTO] = None
    media_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    question_response_type: Optional[str] = None
    question_type: Optional[str] = None
    access_level: Optional[str] = None
    auto_evaluation_json: Optional[str] = None
    options_json: Optional[str] = None
    parsed_evaluation_object: Optional[Dict[str, Any]] = None
    evaluation_type: Optional[str] = None
    explanation_text: Optional[AssessmentRichTextDataDTO] = None
    default_question_time_mins: Optional[int] = None
    parent_rich_text_id: Optional[str] = None
    parent_rich_text: Optional[AssessmentRichTextDataDTO] = None
    options: List[OptionDTO] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    tags: Optional[List[str]] = None
    level: Optional[str] = None
    # Vsmart Extract: the paper's section the question was printed under and
    # its printed marks / negative marks (None when the paper says nothing).
    section_name: Optional[str] = None
    marks: Optional[float] = None
    negative_marks: Optional[float] = None


class TopicNumberMapDto(BaseModel):
    model_config = ConfigDict(extra="ignore")
    topic: Optional[str] = None
    question_numbers: Optional[List[int]] = None


class AutoQuestionPaperResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    questions: Optional[List[QuestionDTO]] = None
    title: Optional[str] = None
    tags: Optional[List[str]] = None
    difficulty: Optional[str] = None
    description: Optional[str] = None
    subjects: Optional[List[str]] = None
    classes: Optional[List[str]] = None
    topic_question_map: Optional[TopicNumberMapDto] = None
    # Vsmart Extract only: how the paper was read (parts, key found, keyed,
    # explained, credits) — shown above the preview so the teacher knows what
    # to check. Absent for generated papers.
    extraction: Optional[Dict[str, Any]] = None
