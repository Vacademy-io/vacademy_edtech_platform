"""Pydantic DTOs for the copy-check pipeline. Shapes mirror what the Java
assessment_service sends in /trigger-evaluation and what we POST back via
the callbacks (progress / question / complete / failed)."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


# ----------------------------- Layout map shape ------------------------------
# Echoes what render_worker /pdf-ocr-jobs returns. We re-declare it here
# instead of importing from render_worker so ai_service stays decoupled.

class LayoutLine(BaseModel):
    line_id: str
    text: str
    box: list[int]                    # [x, y, w, h] in full_res px
    conf: float
    needs_math_fallback: bool = False


class LayoutRegion(BaseModel):
    region_id: str
    type: str
    box: list[int]


class LayoutPage(BaseModel):
    page_id: str
    page_index: int
    width: int
    height: int
    dpi: int
    lines: list[LayoutLine]
    regions: list[LayoutRegion] = []


class LayoutMap(BaseModel):
    pdf_url: str
    ocr_engine: str
    dpi: int
    duration_ms: int
    pages: list[LayoutPage]


# --------------------------- Grade request (in) -----------------------------

class GradeQuestionInput(BaseModel):
    question_id: str
    question_text: str
    # MCQ | ONE_WORD | LONG_ANSWER | CODING | CBE_RESPONSE. CBE_RESPONSE
    # (spreadsheet & written response, TYPED only): student_answer = JSON of
    # the answer {parts}, model_answer = JSON of the full config data
    # (solution + marking scheme); see services/copy_check/cbe_render.py.
    question_type: str
    max_marks: float
    subject: Optional[str] = None     # used by criteria-gen prompt (#22)
    options: Optional[list[dict[str, Any]]] = None
    correct_answer: Optional[str] = None
    # Where the answer sits on the sheet, from the caller's knowledge of the paper:
    # 1-based position, the number printed next to the question ("2", "3(a)")
    # — which repeats across sections — and that section's heading.
    question_number: Optional[int] = None
    paper_label: Optional[str] = None
    section: Optional[str] = None
    # answer_mode TYPED only: what the learner typed in the online player.
    student_answer: Optional[str] = None
    # The question's own reference answer (typed mode). A model answer stored
    # with the assessment rubric takes precedence over it.
    model_answer: Optional[str] = None


class ExamContext(BaseModel):
    """What the paper is: fed to the criteria-generation prompt so a generated
    rubric is pitched at the right level (spec 7.4, T0.24). Every field is
    optional plain text supplied by the institute or partner."""
    level: Optional[str] = None             # "CBSE Class X", "B.Com Sem III", "UPSC GS2"
    subject: Optional[str] = None
    instructions: Optional[str] = None
    answer_language: Optional[str] = None
    # HIGHLIGHT = mark spelling/grammar errors with corrections, no marks
    # deducted (language_feedback.py). Absent or anything else = off.
    language_feedback: Optional[str] = None
    # The mark-deduction scheme printed on the sheet: [{symbol, marks, label,
    # covers, scope}], validated by copy_check/deduction_scheme.py. Without
    # this field pydantic dropped it and the scheme never reached the run.
    deduction_scheme: Optional[list[dict[str, Any]]] = None


class RateSnapshot(BaseModel):
    """The price quoted when the copy was queued (spec 10.3). Carried with
    the run so the charge at completion uses the quote, not whatever the rate
    card says by then. Consumed by the billing step."""
    tool_key: str = Field(..., min_length=1)
    flat_base_credits: float = 0.0
    per_unit_credits: float = 0.0
    unit_field: Optional[str] = None
    params: dict[str, Any] = Field(default_factory=dict)
    rate_source: Optional[str] = None


class ChoiceGroup(BaseModel):
    """Internal choice on the paper (spec 7.2): of `question_ids`, only
    `attempt` count toward the total. `first` = the first attempted in answer
    order (CBSE Maths), `best` = the highest marks (CBSE Accountancy)."""
    question_ids: list[str] = Field(..., min_length=1)
    attempt: int = Field(..., ge=1)
    policy: Literal["first", "best"] = "first"


class CopyCheckGradeRequest(BaseModel):
    process_id: str
    attempt_id: str
    assessment_id: str
    # Required: billing, the rubric store's tenant check and the generated
    # rubric's persistence all key on it. assessment_service always sends it
    # (assessment_user_registration.institute_id is NOT NULL).
    institute_id: str = Field(..., min_length=1)
    # COPY = a scanned/uploaded answer sheet at pdf_url (OCR + annotated copy).
    # TYPED = an online attempt: each question carries student_answer, no PDF.
    answer_mode: Literal["COPY", "TYPED"] = "COPY"
    pdf_url: Optional[str] = None
    questions: list[GradeQuestionInput]
    preferred_model: Optional[str] = None
    callback_base_url: str = Field(..., description="Base URL Java exposes for /copy-check/callback/* callbacks")
    exam_context: Optional[ExamContext] = None
    # Who is billed: "apikey:<key_id>" for API runs; None = the institute
    # (dashboard). Plumbed for the billing step (spec 10.8).
    billing_actor: Optional[str] = Field(None, max_length=200)
    rate_snapshot: Optional[RateSnapshot] = None
    # Pages of the uploaded copy as counted at upload (/copy-check/inspect);
    # the per-page API price is charged on it.
    page_count: Optional[int] = Field(None, ge=0)
    # Only for the credit history line ("which copy was this charge for"). Never
    # sent to a model. No length limit here: a long name must not refuse a copy.
    assessment_name: Optional[str] = None
    student_name: Optional[str] = None
    # Internal choice (spec 7.2, T1.36). Totals and enforcement count only the
    # chosen questions; each question callback carries `counted`.
    choice_groups: Optional[list[ChoiceGroup]] = None
    # The paper's maximum (sum of ungrouped max + per group the top `attempt`
    # maxima). Used for the grand total; derived from choice_groups when absent.
    paper_max: Optional[float] = Field(None, gt=0)
    # True = grade every question against the whole copy, without the answer-
    # location pass. Sent by assignment AI evaluation, where the single question's
    # answer IS the whole copy. Absent/False keeps the usual behaviour.
    skip_answer_location: bool = False
    # True = a copy written in another language than its paper stops and waits
    # for the teacher (language_needs_confirmation). Sent only for Bulk AI check
    # copies, whose panel offers "Check in <language>"; every other caller
    # (single-copy checks, partner API) is checked exactly as before.
    confirm_other_language: bool = False
    # Checked-copy template. INSIDE = remarks written on the copy in pen;
    # OUTSIDE = marks on the copy, remarks typed in a "Teacher comments" panel
    # beside it. Absent (or any other value) keeps the usual behaviour - never a
    # reason to refuse a copy.
    comment_placement: Optional[str] = None
    # The teacher's pen on the checked copy: {"ink": "BLUE" | "#1f3fa0",
    # "font": "KALAM" | "PATRICK_HAND" | "ARCHITECTS_DAUGHTER",
    # "size": "SMALL" | "MEDIUM" | "LARGE"}. Absent or unknown values keep the
    # usual red pen (services/copy_check/pen_style.py).
    pen_style: Optional[dict[str, Any]] = None

    @model_validator(mode="after")
    def _copy_needs_pdf(self) -> "CopyCheckGradeRequest":
        if self.answer_mode == "COPY" and not self.pdf_url:
            raise ValueError("pdf_url is required when answer_mode is COPY")
        return self


class CbeSyncGradeRequest(BaseModel):
    """POST /copy-check/v1/grade-cbe-sync (docs/CBE_RESPONSE_QUESTION.md 5.2):
    admin_core grades a learner's Spreadsheet & Written Response answer on an
    LMS question slide and waits for the result. `user_id` is the learner,
    taken by admin_core from the learner's token."""
    institute_id: str = Field(..., min_length=1, max_length=255)
    user_id: str = Field(..., min_length=1, max_length=255)
    source_id: str = Field(..., min_length=1, max_length=255)   # the slide id
    question_text: Optional[str] = None
    scenario_text: Optional[str] = None
    # The FULL config ({type, data} or data; with solution + marking scheme),
    # as an object or its JSON string.
    config: Any = None
    # The learner's answer {parts: {...}} (or the whole responseData), object or JSON string.
    answer: Any = None
    max_marks: Optional[float] = Field(None, ge=0)
    preferred_model: Optional[str] = Field(None, max_length=200)
    # Optional caller id for the charge; derived from source/user/answer when absent.
    request_id: Optional[str] = Field(None, max_length=200)


class CbeCriterionResult(BaseModel):
    criteria_name: str
    marks: float
    max_marks: Optional[float] = None
    reason: str = ""


class CbeSyncGradeResponse(BaseModel):
    marks_awarded: float
    max_marks: float
    verdict: str                      # CORRECT | PARTIAL | WRONG | UNATTEMPTED
    feedback: str = ""
    confidence: float = 0.0
    criteria_breakdown: list[CbeCriterionResult] = Field(default_factory=list)
    credits_charged: float = 0.0


class CopyCheckGradeResponse(BaseModel):
    job_id: str
    status: str = "PROCESSING"


class CopyCheckIdentifyRequest(BaseModel):
    """Read the student's handwritten identification header off a copy."""
    pdf_url: str
    institute_id: Optional[str] = None
    preferred_model: Optional[str] = None


class CopyCheckIdentifyResponse(BaseModel):
    student_name: Optional[str] = None
    student_name_latin: Optional[str] = None
    roll_number: Optional[str] = None
    class_section: Optional[str] = None
    other_identifiers: list[str] = Field(default_factory=list)
    confidence: float = 0.0
    name_found: bool = False
    page_count: int = 0
    pages_read: int = 0


# --------------------------- Annotation shape -------------------------------

class Annotation(BaseModel):
    target: str                       # line_id or region_id from LayoutMap
    style: str                        # tick | cross | circle | underline | margin_note | region_note
    page_id: str
    text: Optional[str] = None


# --------------------------- Per-question verdict ---------------------------

class CriteriaBreakdownItem(BaseModel):
    criteria_name: str
    marks: float
    reason: str
    # The criterion's maximum in the rubric the question was graded against
    # (T1.13). None when the grader's criterion matches no rubric criterion.
    max: Optional[float] = None


class QuestionVerdict(BaseModel):
    question_id: str
    marks_awarded: float
    max_marks: float
    extracted_answer: str
    feedback: str
    confidence: float = 0.0
    criteria_breakdown: list[CriteriaBreakdownItem] = []
    annotations: list[Annotation] = []
    status: str = "COMPLETED"          # COMPLETED | FAILED


# --------------------------- Callback payloads (out) ------------------------

class ProgressCallback(BaseModel):
    process_id: str
    job_id: str
    step: str                          # LAYOUT_OCR_DONE | GRADING | ...
    progress: Optional[float] = None
    layout_map_url: Optional[str] = None
    layout_map: Optional[LayoutMap] = None


class QuestionCallback(BaseModel):
    process_id: str
    job_id: str
    question_id: str
    marks_awarded: float
    max_marks: float
    feedback: str
    extracted_answer: str
    criteria_breakdown: list[CriteriaBreakdownItem] = []
    annotations: list[Annotation] = []
    confidence: float = 0.0
    rubric_version: Optional[int] = None
    status: str = "COMPLETED"            # COMPLETED | FAILED
    error_detail: Optional[str] = None
    # False = an internal-choice question outside the chosen `attempt` of its
    # group: graded and shown, but not part of the total (T1.36).
    counted: bool = True


class CompleteCallback(BaseModel):
    process_id: str
    job_id: str
    total_marks_awarded: float
    total_max_marks: float
    questions_evaluated: int


# Machine codes for a failed copy (spec 8.3). ai_service emits the ones it can
# detect; the rest are set by assessment_service.
CopyFailureCode = Literal[
    "copy_unreadable", "language_not_supported", "language_needs_confirmation", "file_missing", "file_unavailable",
    "no_gradable_questions", "timed_out", "cancelled", "insufficient_credits",
    "engine_unavailable", "identify_failed",
]


class FailedCallback(BaseModel):
    process_id: str
    job_id: str
    error_message: str
    error_code: Optional[CopyFailureCode] = None


# --------------------------- Rubric CRUD shapes -----------------------------

class CriteriaRubricItem(BaseModel):
    criteria_name: str
    max_marks: float
    keywords: list[str] = []
    evaluation_guidelines: str = ""


class CriteriaRubric(BaseModel):
    max_marks: float
    partial_marking_enabled: bool = True
    evaluation_instructions: str = ""
    rubric: list[CriteriaRubricItem] = []


class UpsertRubricRequest(BaseModel):
    assessment_id: str
    institute_id: str
    rubric: dict[str, CriteriaRubric]          # question_id -> rubric
    model_answers: Optional[dict[str, str]] = None
    created_by: Optional[str] = None


class RubricResponse(BaseModel):
    assessment_id: str
    institute_id: str
    rubric_version: int
    rubric: dict[str, CriteriaRubric]
    model_answers: dict[str, str] = {}
    updated_at: str


class UpsertQuestionAnswerRequest(BaseModel):
    """PATCH semantics (spec 7.4.1): a key left out is left alone; a key sent
    as null deletes that field. Read presence through `model_fields_set`."""
    model_answer: Optional[str] = None
    step_rubric: Optional[CriteriaRubric] = None


class RubricQuestionPatch(BaseModel):
    """One question in PATCH /copy-check/rubric/{assessment_id}. Missing key =
    leave alone, null = delete (presence via `model_fields_set`)."""
    rubric: Optional[CriteriaRubric] = None
    model_answer: Optional[str] = None


class PatchRubricRequest(BaseModel):
    institute_id: str = Field(..., min_length=1)
    questions: dict[str, RubricQuestionPatch] = Field(..., min_length=1)
    # The rubric_version the caller last read; a different current version
    # answers 412 and writes nothing. Null = no check.
    if_match: Optional[int] = None
    updated_by: Optional[str] = None


class PatchRubricResponse(BaseModel):
    version: int


# --------------------------- Upload inspection ------------------------------

class ReRenderAnnotationEdit(BaseModel):
    """A teacher's change to one pen mark the AI drew. The mark is found by the
    fields it was stored with (style, target, page_id, text)."""
    style: Optional[str] = None
    target: Optional[str] = None
    page_id: Optional[str] = None
    text: Optional[str] = None
    # DELETE = leave it off the copy; EDIT = write `new_text` instead.
    action: Literal["DELETE", "EDIT"] = "DELETE"
    new_text: Optional[str] = None


class ReRenderQuestionOverride(BaseModel):
    question_id: str
    marks_awarded: Optional[float] = None
    feedback: Optional[str] = None
    annotation_edits: list[ReRenderAnnotationEdit] = Field(default_factory=list)


class ReRenderRequest(BaseModel):
    """Re-draw a checked copy from its saved render inputs with the teacher's
    corrections. Every current correction is sent each time (the saved inputs
    stay the AI's original), so a re-render is idempotent."""
    process_id: str
    institute_id: Optional[str] = None
    attempt_id: Optional[str] = None
    # A fresh link to the student's original PDF (links expire; never stored).
    pdf_url: str
    overrides: list[ReRenderQuestionOverride] = Field(default_factory=list)
    # None = the pen the copy was first drawn with.
    pen_style: Optional[dict[str, Any]] = None
    # None = the template the copy was first drawn with.
    comment_placement: Optional[str] = None
    # What the system stores after the teacher's changes (gate G9): per question,
    # whether an "any N of M" group counts it, and the attempt total. None = the
    # copy's own (no choice groups / an older caller).
    counted: Optional[dict[str, bool]] = None
    total_marks_awarded: Optional[float] = None


class ReRenderResponse(BaseModel):
    evaluated_file_id: str
    total_marks_awarded: float
    total_max_marks: float


class InspectRequest(BaseModel):
    pdf_url: str = Field(..., min_length=1)


class InspectResponse(BaseModel):
    pages: Optional[int] = None
    encrypted: bool = False
    error: Optional[Literal["unparseable", "too_many_pages", "fetch_failed"]] = None
