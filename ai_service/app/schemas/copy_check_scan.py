"""Scan Station analyse-load DTOs (contract C1, assessment_service -> ai_service).

assessment_service keeps the response verbatim as the load's result_json, so
field names here are the contract; change them only together with ScanPlanner.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

MAX_FILES_PER_PASS = 100

Severity = Literal["BLOCK", "REVIEW", "INFO"]
BlankClass = Literal["BLANK", "UNSURE", "WRITTEN"]
FileKind = Literal["IMAGE", "PDF"]


class ScanPassFile(BaseModel):
    file_id: str = Field(min_length=1, max_length=64)
    url: str = Field(min_length=1, max_length=4096)
    kind: FileKind
    name: Optional[str] = Field(default=None, max_length=255)


class ScanPass(BaseModel):
    pass_no: Literal[1, 2]
    # Files in clerk order; a PDF may hold several pages (the 100-page cap per
    # pass is enforced again on the real page count).
    files: list[ScanPassFile] = Field(min_length=1, max_length=MAX_FILES_PER_PASS)


class AnalyseLoadRequest(BaseModel):
    institute_id: str = Field(min_length=1, max_length=64)
    session_id: str = Field(min_length=1, max_length=64)
    load_no: int = Field(ge=1, le=10_000)
    preferred_model: Optional[str] = Field(default=None, max_length=200)
    passes: list[ScanPass] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def _one_of_each_pass(self) -> "AnalyseLoadRequest":
        if sorted(p.pass_no for p in self.passes) != [1, 2]:
            raise ValueError("passes must be pass_no 1 and pass_no 2")
        return self


class ScanShift(BaseModel):
    from_sheet: int
    offset: int


class ScanLayout(BaseModel):
    fronts_pass: Literal[1, 2]
    fronts_rotation: Literal[0, 180]
    backs_order: Literal["SAME", "REVERSED"]
    backs_rotation: Literal[0, 180]
    order_margin: float
    shift: Optional[ScanShift] = None
    blank_rule_suspect: bool = False


class ScanEvidence(BaseModel):
    first_front_label: bool = False
    last_front_label: bool = False


class ScanPage(BaseModel):
    ref: str
    pass_no: int
    file_id: str
    page_index: int
    kind: FileKind
    dpi: int
    dpi_source: Literal["JFIF", "EXIF", "PDF", "ASSUMED"]
    width_px: int
    height_px: int
    ink_per_10k: float
    blank_class: BlankClass
    error: Optional[str] = None


class ScanSheet(BaseModel):
    sheet_no: int
    front: str
    back: str
    pair_score: float
    pair_runner_up: Optional[float] = None
    pair_is_row_max: bool
    label_kind: Literal["PRINTED_FIELD", "QUESTION_TEXT", "NONE"]
    label_present: bool
    name_text: Optional[str] = None
    name_readable: bool
    roll_text: Optional[str] = None
    label_template_sim: Optional[float] = None
    back_label_like: bool
    front_blank_class: BlankClass
    back_blank_class: BlankClass


class ScanFlag(BaseModel):
    code: str
    severity: Severity
    sheet_no: Optional[int] = None
    detail: str = ""


class ScanUsage(BaseModel):
    model: str = ""
    model_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0


class AnalyseLoadResponse(BaseModel):
    analyser_version: str
    load_no: int
    status: Literal["OK", "REVIEW", "BLOCKED"]
    layout: Optional[ScanLayout] = None
    evidence: ScanEvidence
    pages: list[ScanPage]
    sheets: list[ScanSheet]
    flags: list[ScanFlag]
    usage: ScanUsage
