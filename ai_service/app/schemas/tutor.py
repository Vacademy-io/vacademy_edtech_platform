"""Live AI Tutor — request/response and plan schemas.

The plan schema doubles as the contract the compile model must return; the
validator (services/tutor/plan_validator.py) enforces the rules Pydantic
cannot express (board size, id uniqueness, cross-references).
"""
from __future__ import annotations

from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Board operations ─────────────────────────────────────────────────────────
# Every op that adds an element carries a stable `id`; ops that act on an
# element carry `target`. `anim` and `say_index` drive the learner-side reveal.

Anim = Literal["write", "fade", "pop"]


class _OpBase(BaseModel):
    anim: Optional[Anim] = None
    after: Optional[str] = None
    # Index of the sentence in `say` this op is revealed with (0-based).
    say_index: Optional[int] = None


class HeadingOp(_OpBase):
    op: Literal["heading"]
    id: str
    text: str
    level: int = 2


class TextOp(_OpBase):
    op: Literal["text"]
    id: str
    text: str


class BulletOp(_OpBase):
    op: Literal["bullet"]
    id: str
    items: List[str]


class FormulaOp(_OpBase):
    op: Literal["formula"]
    id: str
    latex: str
    caption: Optional[str] = None


class SvgPart(BaseModel):
    id: str
    label: str
    # 0 = drawn with the diagram; 1, 2, 3… = revealed in that order while the
    # teacher speaks, so a diagram builds up instead of landing whole.
    step: int = Field(default=0, ge=0, le=12)


class SvgOp(_OpBase):
    op: Literal["svg"]
    id: str
    svg: str
    description: str
    parts: List[SvgPart] = Field(default_factory=list)


class ImageOp(_OpBase):
    op: Literal["image"]
    id: str
    url: Optional[str] = None
    media_id: Optional[str] = None
    # When the compiler is allowed to generate images, an op may arrive with a
    # `generate` prompt instead of a url; the media stage fills the url in.
    generate: Optional[str] = None
    description: str
    caption: Optional[str] = None


class VideoOp(_OpBase):
    op: Literal["video"]
    id: str
    url: Optional[str] = None
    media_id: Optional[str] = None
    description: str
    start: Optional[float] = None
    end: Optional[float] = None
    muted: bool = True


class MediaTaskOp(_OpBase):
    op: Literal["media_task"]
    id: str
    kind: Literal["video", "pdf"]
    url: Optional[str] = None
    file_id: Optional[str] = None
    description: str


class TableOp(_OpBase):
    op: Literal["table"]
    id: str
    rows: List[List[str]]


class CalloutOp(_OpBase):
    op: Literal["callout"]
    id: str
    text: str
    kind: Literal["tip", "warning", "definition", "example"] = "tip"


class AnnotateOp(_OpBase):
    op: Literal["annotate"]
    id: str
    target: str
    text: str
    position: Literal["right", "below", "above", "left"] = "right"


class ArrowOp(_OpBase):
    op: Literal["arrow"]
    id: str
    from_: str = Field(alias="from")
    to: str
    text: Optional[str] = None

    model_config = {"populate_by_name": True}


class HighlightOp(_OpBase):
    op: Literal["highlight"]
    target: str
    style: Literal["pulse", "underline", "box"] = "pulse"


class UnhighlightOp(_OpBase):
    op: Literal["unhighlight"]
    target: str


class RevealOp(_OpBase):
    op: Literal["reveal"]
    target: str


class ClearOp(_OpBase):
    op: Literal["clear"]


class ColumnsOp(_OpBase):
    """Two or three columns side by side (compare-and-contrast). Each column
    is a short list of element ops; nested ops carry their own ids."""
    op: Literal["columns"]
    id: str
    columns: List[List[Dict[str, Any]]] = Field(min_length=2, max_length=3)


# Discriminated on "op": a malformed op produces one targeted error instead of
# one error per union member, which keeps the repair prompt readable.
BoardOp = Annotated[
    Union[
        HeadingOp, TextOp, BulletOp, FormulaOp, SvgOp, ImageOp, VideoOp, MediaTaskOp,
        TableOp, CalloutOp, AnnotateOp, ArrowOp, HighlightOp, UnhighlightOp, RevealOp, ClearOp, ColumnsOp,
    ],
    Field(discriminator="op"),
]

# Ops that put a new element on the board (and therefore carry an id).
ELEMENT_OPS = {
    "heading", "text", "bullet", "formula", "svg", "image", "video", "media_task",
    "table", "callout", "annotate", "arrow", "columns",
}
# Ops allowed inside a column.
COLUMN_CHILD_OPS = {"heading", "text", "bullet", "formula", "table", "callout"}
# Ops that only make sense during a live session; the compiler must not emit them.
LIVE_ONLY_OPS = {"highlight", "unhighlight", "reveal"}
VISUAL_OPS = {"svg", "image", "video", "media_task"}


# ── Plan ─────────────────────────────────────────────────────────────────────

class Misconception(BaseModel):
    pattern: str
    hint: str


class Check(BaseModel):
    # Default "none": a concept that omits its check (allowed for the first
    # concept of a board) must not turn into an empty "open" check that the
    # validator then rejects — that bug cost three model calls per slide.
    type: Literal["open", "mcq", "numeric", "none"] = "none"
    prompt: Optional[str] = None
    options: List[str] = Field(default_factory=list)
    expected: Optional[str] = None
    rubric: Optional[str] = None
    misconceptions: List[Misconception] = Field(default_factory=list)
    pass_threshold: float = 0.7
    # Pre-written nudge the teacher gives when the learner stalls or asks
    # for help (never the answer itself).
    hint: Optional[str] = None
    # Spoken lines in the other course language, like say_i18n.
    prompt_i18n: Dict[str, str] = Field(default_factory=dict)
    hint_i18n: Dict[str, str] = Field(default_factory=dict)
    # Quiz slides only: the source question and its option ids in the same
    # order as `options`, so a tutor answer can be written back as a quiz
    # activity log (learner_tracking) when the slide is done.
    question_id: Optional[str] = None
    option_ids: List[str] = Field(default_factory=list)

    # A rubric is prose for the grader, but when the source lists criteria
    # ("Look for: a hook; under 15 words; …") the model mirrors them as a
    # list or an object. Rejecting that failed whole compiles after three
    # calls (2026-09-23, speaking-skills demos) — flatten it instead.
    @field_validator("rubric", mode="before")
    @classmethod
    def _rubric_as_text(cls, v):
        if v is None or isinstance(v, str):
            return v
        if isinstance(v, dict):
            return "; ".join(f"{k}: {_flatten_text(val)}" for k, val in v.items() if val not in (None, "", [], {}))
        if isinstance(v, (list, tuple)):
            return "; ".join(_flatten_text(x) for x in v if x not in (None, "", [], {}))
        return str(v)


def _flatten_text(v) -> str:
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, dict):
        return ", ".join(f"{k}: {_flatten_text(x)}" for k, x in v.items())
    if isinstance(v, (list, tuple)):
        return ", ".join(_flatten_text(x) for x in v)
    return str(v)


class ConceptDraft(BaseModel):
    id: str
    title: str
    concept_tags: List[str] = Field(default_factory=list)
    prerequisites: List[str] = Field(default_factory=list)
    board_ops: List[BoardOp] = Field(default_factory=list)
    say: str
    say_i18n: Dict[str, str] = Field(default_factory=dict)
    teach_notes: Optional[str] = None
    check: Check = Field(default_factory=Check)
    # Predict-then-reveal: a one-line guess question the teacher asks BEFORE
    # this concept's board appears (first concept of a topic), graded lightly.
    predict: Optional[str] = None
    predict_i18n: Dict[str, str] = Field(default_factory=dict)

    # "No check" arrives from the model as null, "none", false or {} at least
    # as often as it arrives omitted; all of them mean the default Check, and
    # a schema that rejects them fails the whole compile after three calls
    # (2026-09-22, a first concept with "check": null).
    # The title is a label for the admin outline and the learner's progress
    # list, never spoken. The model occasionally drops it (or names it
    # "name"/"concept") on long practice plans; that used to fail the compile.
    @model_validator(mode="before")
    @classmethod
    def _title_is_derivable(cls, data):
        if not isinstance(data, dict) or (isinstance(data.get("title"), str) and data["title"].strip()):
            return data
        for alt in ("name", "concept", "heading", "label"):
            if isinstance(data.get(alt), str) and data[alt].strip():
                return {**data, "title": data[alt].strip()[:120]}
        say = data.get("say")
        if isinstance(say, str) and say.strip():
            words = say.strip().split()
            return {**data, "title": " ".join(words[:6]).rstrip(".,;:!?") + ("…" if len(words) > 6 else "")}
        if isinstance(data.get("id"), str) and data["id"].strip():
            return {**data, "title": data["id"].replace("-", " ").replace("_", " ").strip().capitalize()}
        return data

    @field_validator("check", mode="before")
    @classmethod
    def _no_check_means_none(cls, v):
        if v is None or v is False or v == {} or (isinstance(v, str) and v.strip().lower() in ("", "none", "null")):
            return {}
        return v


class TopicDraft(BaseModel):
    id: str
    title: str
    estimated_seconds: Optional[int] = None
    concepts: List[ConceptDraft]
    summary_ops: List[BoardOp] = Field(default_factory=list)
    # The spoken recap that closes the topic (1-3 sentences).
    summary_say: Optional[str] = None
    summary_say_i18n: Dict[str, str] = Field(default_factory=dict)


class KeyTerm(BaseModel):
    term: str
    meaning: str


class TeachingPlanDraft(BaseModel):
    """What the compile model returns (and what quiz / media-task compilers build)."""
    language: str = "en"
    objectives: List[str] = Field(default_factory=list)
    key_terms: List[KeyTerm] = Field(default_factory=list)
    topics: List[TopicDraft]


# ── Requests / responses ─────────────────────────────────────────────────────

class CompileKbGrounding(BaseModel):
    knowledge_base_id: str
    mode: Literal["STRICT", "BLENDED"] = "STRICT"


_RUN_ID = r"^[A-Za-z0-9_.:-]{1,64}$"


class CompileOptions(BaseModel):
    """Options shared by compile and recompile."""
    language: str = Field(default="en", pattern=r"^(en|hi)$", description="Course language")
    teacher_name: str = Field(default="Asha", min_length=1, max_length=60)
    # Let the compiler request AI-generated images (billed per image).
    generate_images: bool = False
    kb_grounding: Optional[CompileKbGrounding] = None
    # Uploaded videos without a transcript: run speech-to-text (per-minute
    # credits) so they compile like documents; off = park them for a description.
    transcribe_videos: bool = True
    # Scanned PDFs (no text layer): MathPix OCR, charged per page; off = park.
    ocr_pdfs: bool = True
    # Stable across transport retries; keys idempotent charges.
    compile_run_id: Optional[str] = Field(default=None, pattern=_RUN_ID)


class CompileRequest(CompileOptions):
    package_id: str = Field(..., min_length=1, max_length=255)
    slide_ids: List[str] = Field(default_factory=list, max_length=400)
    # Recompile even when a READY plan matches the current content hash.
    force: bool = False


class RecompileOptions(CompileOptions):
    """Body of POST /slides/{id}/recompile — everything optional."""


class SourceDescriptionRequest(BaseModel):
    description: str = Field(..., min_length=10, max_length=8000)


class PlanStatusItem(BaseModel):
    slide_id: str
    slide_title: Optional[str] = None
    source_type: Optional[str] = None
    chapter_id: Optional[str] = None
    chapter_name: Optional[str] = None
    plan_id: Optional[str] = None
    version: Optional[int] = None
    status: str
    error: Optional[str] = None
    # The READY plan learners would be taught from (may differ from the newest row).
    serving_plan_id: Optional[str] = None
    topics: int = 0
    concepts: int = 0
    updated_at: Optional[str] = None
    # document | pdf | quiz | ai_video | youtube | video_upload | video_link | other
    source_kind: Optional[str] = None
    # What the newest plan was compiled from: script | captions | transcript | pdf | None
    text_kind: Optional[str] = None
    # Board-quality asks the compiler let go (a dense derivation, an abstract
    # board with no diagram). The plan is READY and teachable; these are advice.
    quality_notes: List[str] = Field(default_factory=list)


class PackagePlansResponse(BaseModel):
    package_id: str
    counts: Dict[str, int]
    slides: List[PlanStatusItem]


class ConceptView(BaseModel):
    id: str
    order: int
    title: str
    concept_tags: List[str]
    board_ops: List[Dict[str, Any]]
    board_html: str
    say: str
    say_i18n: Dict[str, str]
    teach_notes: Optional[str]
    check: Optional[Dict[str, Any]]


class TopicView(BaseModel):
    id: str
    order: int
    title: str
    estimated_seconds: Optional[int]
    summary_html: Optional[str]
    concepts: List[ConceptView]


class PlanView(BaseModel):
    plan_id: str
    slide_id: str
    version: int
    status: str
    language: str
    model: Optional[str]
    objectives: List[str]
    key_terms: List[Dict[str, str]]
    source_description: Optional[str]
    error: Optional[str]
    topics: List[TopicView]
    media: List[Dict[str, Any]]
