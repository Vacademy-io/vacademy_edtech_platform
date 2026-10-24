"""
AI planner for daily engagement — drafts a whole plan for a teacher to review.

Endpoints, priced separately on purpose:

  POST /engagement/plan/draft       one structured call drafts every day's tasks
                                    (questions, polls, written prompts, readings,
                                    flashcard decks) and returns it in the same
                                    request. Kept for the wizard that predates the
                                    jobs flow.
  POST /engagement/plan/draft/jobs  the same draft as a background job: returns a
                                    job id at once; GET …/draft/jobs/{id} polls
                                    ("day 3 of 7 drafted"), …/cancel stops it,
                                    …/active re-attaches after the teacher left,
                                    …/ack stops offering a finished result.
                                    Also served under /engagement/plan/jobs…
                                    (the path the admin wizard calls).
  POST /engagement/plan/illustrate  turns ONE reading into an illustrated visual
                                    note by generating its pictures. Charged per
                                    picture that actually came back.

Splitting drafting from pictures is the cost plan: a fortnight of illustrated
pages would cost 14 × (page + images) before the teacher had seen anything. The
draft is cheap; pictures are opt-in per task.

Nothing here publishes. The draft comes back in the composer's own request shape
and the teacher saves it through the normal engagement API after review.

Billing only follows a usable result, exactly once. A regenerate that comes back
empty, or as a different kind of task than the one being replaced, is a 422 with
no charge; a job that fails or is cancelled is never charged, and a job is billed
under one idempotency key however often it is polled.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Coroutine, Dict, List, Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from ..config import get_settings
from ..core.security import get_current_user
from ..db import db_dependency, db_session
from ..models.ai_task import AiTask, AiTaskInputType, AiTaskStatus
from ..models.ai_token_usage import RequestType
from ..repositories.ai_task_repository import AiTaskRepository
from ..services import ai_task_service
from ..services.ai_billing import preflight_tool_credits, record_tool_billing
from ..services.document_postprocess import illustrate_document
from ..services.engagement_plan_service import (
    assemble_grounding,
    build_prompt,
    call_model,
    drafted_days,
    model_name,
    normalise_draft,
    normalise_single_item,
    parse_draft_reply,
    parse_weekdays,
    plan_dates,
    single_item_target,
    stream_model,
    MAX_DAYS,
    MAX_ITEMS_PER_DAY,
)

logger = logging.getLogger(__name__)


class _PlainDetailRoute(APIRoute):
    """Validation errors as one readable sentence in `detail`.

    FastAPI's default 422 puts a list of error objects in `detail`; the wizard
    shows `detail` as text, so a list would render as nothing useful (or crash
    the view). The field-level list is still returned under `errors`.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def route_handler(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError as exc:
                return JSONResponse(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    content={"detail": _validation_message(exc), "errors": jsonable_encoder(exc.errors())},
                )

        return route_handler


def _validation_message(exc: RequestValidationError) -> str:
    # The field is the last NAME in the error's location; list indexes and the
    # character offset of a JSON syntax error are numbers and name nothing.
    fields = set()
    for err in exc.errors():
        names = [str(p) for p in (err.get("loc") or ()) if isinstance(p, str) and p != "body"]
        if names:
            fields.add(names[-1])
    if "start_date" in fields:
        return "Pick a valid start date for the plan (yyyy-MM-dd)."
    if "weekdays" in fields:
        return "Pick the weekdays the plan runs on (Mon to Sun)."
    if "dates" in fields:
        return f"Pick between 1 and {MAX_DAYS} valid run dates (yyyy-MM-dd)."
    named = ", ".join(sorted(fields))
    return f"Check the brief: {named} is not valid." if named else "Check the brief and try again."


router = APIRouter(prefix="/engagement/plan", tags=["engagement-plan"], route_class=_PlainDetailRoute)

# Draft credits = max(estimate, actual token cost × markup). A whole plan is one
# big call; the markup covers retries and the review that follows.
_USAGE_MARKUP = 2
# Pictures per illustrated reading. Enough for a textbook-style page; capped so one
# task cannot quietly become the most expensive thing in the plan.
_MAX_IMAGES_PER_READING = 3
# A regenerate that produced nothing usable of the requested kind. Refused before
# billing, so the sentence can promise the teacher was not charged.
_UNUSABLE_ITEM = "The AI didn't return a usable task. Try again; you weren't charged."
_UNUSABLE_DECK = "The AI didn't return a usable card deck. Try again; you weren't charged."
_EMPTY_PLAN = "The draft came back empty. Try a narrower topic or fewer days."
_UNREADABLE_PLAN = "Could not draft a plan from that brief. Try a clearer topic."
_PROVIDER_REJECTED = "The AI provider rejected the request. Try again."
_TOO_SLOW = "The AI took too long. Try fewer days or a shorter topic."


class GroundingText(BaseModel):
    title: Optional[str] = None
    text: str


class Mix(BaseModel):
    question_of_day: bool = True
    text_question: bool = False
    poll: bool = False
    reading: bool = True
    flashcards: bool = False
    # The wizard before native flashcards sends `game` for the same toggle. It is
    # an alias, so a deployed old wizard keeps getting decks.
    game: bool = Field(False, description="Deprecated alias of `flashcards`.")

    @model_validator(mode="after")
    def _legacy_game_means_flashcards(self) -> "Mix":
        if self.game:
            self.flashcards = True
        return self


class DraftRequest(BaseModel):
    institute_id: Optional[str] = Field(None, description="Institute to charge (academy-credits).")
    title: Optional[str] = None
    topic: Optional[str] = Field(None, description="What to cover, in the teacher's words.")
    audience: Optional[str] = None
    language: str = "English"
    difficulty: str = "medium"
    # A real date, so an empty or malformed one is a 422 before the paid call —
    # it used to reach date.fromisoformat() only after the paid model call (a 500).
    start_date: date = Field(..., description="yyyy-MM-dd, institute-local")
    days: int = Field(7, ge=1, le=MAX_DAYS, description="Calendar days from start_date the plan spans.")
    # Typed Any so a bad value is ONE error on `weekdays` (a Union type would report
    # it under "int"/"str" and the readable message could not name the field).
    weekdays: Any = Field(
        None,
        description=(
            "Weekdays the plan runs on inside the span: ISO numbers (Mon=1 … Sun=7; 0 is also "
            "Sunday), names ('mon'), or a dowMask integer (Mon=1 … Sun=64). Omitted = every day."
        ),
    )
    # The exact run dates (institute-local), as the wizard computes them from its
    # span and weekday chips. When sent they win over days/weekdays: the wizard
    # sends `days` as the COUNT of these dates, not the calendar span.
    dates: Optional[List[date]] = Field(
        None,
        max_length=MAX_DAYS,
        description="Exact yyyy-MM-dd run dates; overrides days/weekdays when non-empty.",
    )
    per_day_items: int = Field(2, ge=1, le=MAX_ITEMS_PER_DAY)
    start_time: str = "06:00"
    end_time: str = "20:00"
    reveal_time: Optional[str] = "20:00"
    notify_time: Optional[str] = "06:00"
    completion_points: int = 10
    correct_points: int = 20
    mix: Mix = Mix()
    grounding_texts: List[GroundingText] = Field(default_factory=list, description="Slide text the teacher selected.")
    kb_id: Optional[str] = Field(None, description="Knowledge base to retrieve from, if any.")
    idempotency_key: Optional[str] = None
    # Regenerate ONE task instead of a plan: forces days=1, one item of this type,
    # and a much smaller charge.
    single_item_type: Optional[str] = None
    avoid_title: Optional[str] = Field(None, description="The rejected task's title, so the replacement differs.")

    @field_validator("weekdays")
    @classmethod
    def _weekdays(cls, v: Any) -> Optional[List[int]]:
        return parse_weekdays(v)


class DraftResponse(BaseModel):
    title: str
    slots: List[Dict[str, Any]]
    model: str
    # Delivered…
    days_planned: int
    items_planned: int
    grounded: bool
    # …against what the brief asked for. The review warns when they differ and
    # marks the dates that came back empty or short.
    days_requested: int = 0
    items_requested: int = 0
    missing_dates: List[str] = Field(default_factory=list)
    short_dates: List[str] = Field(default_factory=list)
    dropped_items: int = 0


class IllustrateRequest(BaseModel):
    institute_id: Optional[str] = None
    title: str = "Reading"
    content_html: str
    max_images: int = Field(2, ge=1, le=_MAX_IMAGES_PER_READING)
    idempotency_key: Optional[str] = None


class IllustrateResponse(BaseModel):
    content_html: str
    images_generated: int


def _actor(current_user, body_institute: Optional[str]):
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    user_id = getattr(current_user, "user_id", None)
    if user_id is None and isinstance(current_user, dict):
        user_id = current_user.get("user_id")
    token_institute = getattr(current_user, "institute_id", None)
    if token_institute is None and isinstance(current_user, dict):
        token_institute = current_user.get("institute_id")
    raw = getattr(current_user, "roles", None) or getattr(current_user, "authorities", None)
    if raw is None and isinstance(current_user, dict):
        raw = current_user.get("roles") or current_user.get("authorities")
    roles = _flatten_roles(raw)
    # Staff only. Both endpoints spend the institute's credits, so the caller must
    # hold a teaching or admin authority — a learner token must NOT fall through to
    # a default role the way some older routers allow.
    if any("ADMIN" in r for r in roles):
        role = "ADMIN"
    elif any("TEACHER" in r for r in roles):
        role = "TEACHER"
    else:
        raise HTTPException(status_code=403, detail="Planning engagement needs a teacher or admin account.")
    return user_id, (token_institute or body_institute), role


def _flatten_roles(raw) -> set:
    """Roles arrive either as a flat list or as the JWT's per-institute map
    {instituteId: {roles: [...]}}; accept both."""
    out = set()
    if isinstance(raw, dict):
        for v in raw.values():
            inner = v.get("roles") if isinstance(v, dict) else v
            for r in inner or []:
                out.add(str(r).upper())
    else:
        for r in raw or []:
            out.add(str(r).upper())
    return out


def _gate(
    db: Session,
    tool_key: str,
    institute_id: Optional[str],
    what: str,
    params: Optional[Dict[str, Any]] = None,
) -> None:
    """402 before spending anything, so a teacher on an empty balance learns it up
    front rather than after a two-minute wait."""
    if not institute_id:
        return
    estimate = preflight_tool_credits(db, tool_key=tool_key, tool_params=params or {}, institute_id=institute_id)
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits: {what} needs ~{estimate['estimated_credits']} credits "
                f"but the balance is {estimate.get('current_balance')}."
            ),
        )


# ── one draft, from brief to billed result ───────────────────────────────────


@dataclass
class _Draft:
    """Everything a draft needs, resolved (and refused) before any spend."""

    user_id: Optional[str]
    institute_id: Optional[str]
    role: str
    api_key: str
    base_url: str
    model: str
    is_single: bool
    single_item_type: Optional[str]
    tool_key: str
    brief: Dict[str, Any]
    prompt: str
    grounded: bool
    days_requested: int
    items_requested: int
    idempotency_key: Optional[str]


async def _prepare(body: DraftRequest, current_user, db: Session) -> _Draft:
    """Auth, brief checks, the credit pre-flight, grounding and the prompt. Every
    refusal here (401/403/400/402/503) happens before the model is called."""
    user_id, institute_id, role = _actor(current_user, body.institute_id)
    settings = get_settings()
    api_key = getattr(settings, "openrouter_api_key", None)
    if not api_key:
        raise HTTPException(status_code=503, detail="No LLM provider configured. Set OPENROUTER_API_KEY.")
    base_url = getattr(settings, "llm_base_url", "https://openrouter.ai/api/v1/chat/completions")

    if not (body.topic and body.topic.strip()) and not body.grounding_texts and not body.kb_id:
        raise HTTPException(status_code=400, detail="Give a topic, pick some course content, or choose a knowledge base.")

    is_single = bool(body.single_item_type and body.single_item_type.strip())
    if is_single and single_item_target(body.single_item_type) is None:
        raise HTTPException(
            status_code=400,
            detail=f"Can't regenerate a task of type {body.single_item_type.strip()[:40]}.",
        )
    if is_single:
        body.days = 1
        body.per_day_items = 1
        days_requested = 1
    else:
        days_requested = len(plan_dates(body.model_dump()))
        if days_requested == 0:
            raise HTTPException(
                status_code=400,
                detail="None of the chosen weekdays falls in those days. Add days or pick more weekdays.",
            )
    items_requested = days_requested * body.per_day_items
    tool_key = "engagement_item" if is_single else "engagement_plan"
    _gate(
        db,
        tool_key,
        institute_id,
        "regenerating this task" if is_single else "drafting this plan",
        None if is_single else _plan_charge_params(days_requested, items_requested),
    )

    # Grounding: teacher-picked slide text first; then KB retrieval keyed on the
    # topic, so the questions come from the institute's own material.
    kb_hits: List[Dict[str, Any]] = []
    if body.kb_id and institute_id:
        try:
            from ..services.kb.retrieval import KbRetrievalService

            query = (body.topic or body.title or "key concepts").strip()
            kb_hits = await KbRetrievalService(db).search(
                kb_id=body.kb_id, institute_id=institute_id, query=query, top_k=12
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[engagement-plan] KB retrieval skipped: %s", e)

    grounding = assemble_grounding([g.model_dump() for g in body.grounding_texts], kb_hits)
    brief = body.model_dump()
    return _Draft(
        user_id=user_id,
        institute_id=institute_id,
        role=role,
        api_key=api_key,
        base_url=base_url,
        model=model_name(),
        is_single=is_single,
        single_item_type=body.single_item_type,
        tool_key=tool_key,
        brief=brief,
        prompt=build_prompt(brief, grounding),
        grounded=bool(grounding),
        days_requested=days_requested,
        items_requested=items_requested,
        idempotency_key=body.idempotency_key,
    )


def _plan_charge_params(days: int, tasks: int) -> Dict[str, Any]:
    # engagement_plan is priced per task (tool_cost_estimator: unit_field
    # "questions"), so the pre-flight quotes the size the teacher asked for and
    # the charge uses the size that came back.
    return {"days": days, "num_questions": tasks}


def _unusable_single(single_item_type: Optional[str]) -> str:
    target = single_item_target(single_item_type)
    return _UNUSABLE_DECK if target and target[1] == "FLASHCARDS" else _UNUSABLE_ITEM


def _finish(d: _Draft, text: str) -> Dict[str, Any]:
    """The model's reply → a normalised draft, or the HTTPException that refuses
    it. Parsing AND normalising sit inside a try: anything in the reply that
    trips them fails here as a clean 422/502 and before billing, never a 500."""
    try:
        raw = parse_draft_reply(text)
        draft = normalise_single_item(raw, d.brief) if d.is_single else normalise_draft(raw, d.brief)
    except Exception as e:  # noqa: BLE001
        logger.error("[engagement-plan] unreadable draft: %s", e)
        if d.is_single:
            raise HTTPException(status_code=422, detail=_unusable_single(d.single_item_type))
        raise HTTPException(status_code=502, detail=_UNREADABLE_PLAN)

    if d.is_single and draft is None:
        # Empty, or a different kind of task than the one being replaced.
        logger.warning("[engagement-plan] regenerate returned no usable %s; not billed", d.single_item_type)
        raise HTTPException(status_code=422, detail=_unusable_single(d.single_item_type))
    if not draft["slots"]:
        raise HTTPException(status_code=422, detail=_EMPTY_PLAN)
    return draft


def _bill(d: _Draft, usage: Dict[str, Any], draft: Dict[str, Any]) -> None:
    """Bill after success, best-effort: the draft exists; a billing hiccup must not
    take it away from the teacher. The idempotency key makes a retry free."""
    items = sum(len(s["items"]) for s in draft["slots"])
    try:
        record_tool_billing(
            tool_key=d.tool_key,
            tool_params={} if d.is_single else _plan_charge_params(len(draft["slots"]), items),
            request_type=RequestType.CONTENT,
            model=d.model,
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            institute_id=d.institute_id,
            user_id=d.user_id,
            user_role=d.role if d.user_id else None,
            idempotency_key=d.idempotency_key,
            usage_markup=_USAGE_MARKUP,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[engagement-plan] billing skipped: %s", e)


def _response(d: _Draft, draft: Dict[str, Any]) -> DraftResponse:
    return DraftResponse(
        title=draft["title"],
        slots=draft["slots"],
        model=d.model,
        days_planned=len(draft["slots"]),
        items_planned=sum(len(s["items"]) for s in draft["slots"]),
        grounded=d.grounded,
        days_requested=int(draft.get("requested_days") or d.days_requested),
        items_requested=int(draft.get("requested_items") or d.items_requested),
        missing_dates=list(draft.get("missing_dates") or []),
        short_dates=list(draft.get("short_dates") or []),
        dropped_items=int(draft.get("dropped_items") or 0),
    )


def _model_failure(e: BaseException) -> HTTPException:
    """A failed model call as the refusal the teacher sees. The status stays 502
    for the old wizard; the sentence says what actually went wrong."""
    if isinstance(e, httpx.HTTPStatusError):
        logger.error("[engagement-plan] model call failed: %s", e)
        return HTTPException(status_code=502, detail=_PROVIDER_REJECTED)
    if isinstance(e, (httpx.TimeoutException, asyncio.TimeoutError)):
        logger.error("[engagement-plan] model call timed out: %s", e)
        return HTTPException(status_code=502, detail=_TOO_SLOW)
    logger.error("[engagement-plan] draft failed: %s", e)
    return HTTPException(status_code=502, detail=_UNREADABLE_PLAN)


@router.post("/draft", response_model=DraftResponse)
async def draft_plan(
    body: DraftRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(db_dependency),
):
    """Draft in the request. Kept for the wizard that predates the jobs flow."""
    d = await _prepare(body, current_user, db)
    try:
        text, usage = await call_model(d.prompt, d.api_key, d.base_url, d.model)
    except Exception as e:  # noqa: BLE001
        raise _model_failure(e)
    draft = _finish(d, text)
    _bill(d, usage, draft)
    return _response(d, draft)


# ── background jobs ──────────────────────────────────────────────────────────
#
# A week-long draft is minutes of model time; inside one request it died with the
# tab and showed no progress. Here the kickoff returns a job id at once and the
# draft runs detached (ai_task_service), streaming, with its progress — phase and
# days written so far — flushed to the ai_task row every couple of seconds. Any
# pod can answer a poll (prod runs 2 replicas). Cancel flips the row to FAILED;
# the worker notices on its next flush, aborts the model stream and is not billed.
# A row that stops heartbeating (the pod died mid-run) reads as INTERRUPTED.

JOB_TYPE = "ENGAGEMENT_PLAN_DRAFT"
_JOB_FLUSH_SECONDS = 2.0
_JOB_STALE_SECONDS = 90
_JOB_QUEUED_STALE_SECONDS = 600
_JOB_REATTACH_HOURS = 6
_CANCELLED_MSG = "Cancelled by user"
_JOB_FAILED_FALLBACK = "Could not draft the plan. Try again; you weren't charged."


def _job_timeout_seconds() -> float:
    """Wall-clock cap on one job's model call (ENGAGEMENT_PLAN_JOB_TIMEOUT_SECONDS)."""
    try:
        return max(30.0, float(os.getenv("ENGAGEMENT_PLAN_JOB_TIMEOUT_SECONDS", "600")))
    except ValueError:
        return 600.0


class _JobCancelled(Exception):
    def __str__(self) -> str:
        return _CANCELLED_MSG


class _JobFailed(Exception):
    """A refusal inside a job. str() is what ai_task_service stores as the row's
    status_message: JSON the poll turns back into {error, error_code}."""

    def __init__(self, code: int, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail

    def __str__(self) -> str:
        return json.dumps({"code": self.code, "detail": self.detail})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _loads(raw: Optional[str]) -> Dict[str, Any]:
    try:
        data = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_progress(task_id: str, progress: Dict[str, Any]) -> bool:
    """Heartbeat write. False when the row is no longer PROGRESS (the teacher
    cancelled), so the worker stops."""
    with db_session() as db:
        n = (
            db.query(AiTask)
            .filter(AiTask.id == task_id, AiTask.status == AiTaskStatus.PROGRESS.value)
            .update(
                {AiTask.status_message: json.dumps(progress), AiTask.updated_at: _now()},
                synchronize_session=False,
            )
        )
        return (n or 0) > 0


def _still_running(task_id: str) -> bool:
    """Last look before billing, so a cancel that landed after the final
    heartbeat is honoured and not charged."""
    with db_session() as db:
        task = db.get(AiTask, task_id)
        return bool(task and task.status == AiTaskStatus.PROGRESS.value)


async def _run_job(task_id: str, d: _Draft) -> str:
    state: Dict[str, Any] = {
        "phase": "thinking",
        "days_done": 0,
        "days_total": d.days_requested,
        "reasoning_chars": 0,
        "content_chars": 0,
    }
    pieces: List[str] = []
    cancelled = asyncio.Event()
    finished = asyncio.Event()

    def on_delta(kind: str, value: Any) -> None:
        if kind == "content":
            pieces.append(value)
            state["phase"] = "writing"
            state["content_chars"] += len(value)
        elif kind == "reasoning":
            state["reasoning_chars"] += int(value or 0)

    async def heartbeat() -> None:
        while not finished.is_set():
            if state["phase"] == "writing":
                state["days_done"] = drafted_days("".join(pieces), d.days_requested)
            try:
                if not await asyncio.to_thread(_write_progress, task_id, dict(state)):
                    cancelled.set()
                    return
            except Exception:  # noqa: BLE001
                logger.warning("[engagement-plan] progress write failed for %s", task_id, exc_info=True)
            try:
                await asyncio.wait_for(finished.wait(), timeout=_JOB_FLUSH_SECONDS)
            except asyncio.TimeoutError:
                pass

    beat = asyncio.create_task(heartbeat())
    model_call = asyncio.create_task(stream_model(d.prompt, d.api_key, d.base_url, d.model, on_delta))
    deadline = time.monotonic() + _job_timeout_seconds()
    try:
        while True:
            done, _ = await asyncio.wait({model_call}, timeout=0.5)
            if done:
                break
            if cancelled.is_set():
                raise _JobCancelled()
            if time.monotonic() > deadline:
                raise _JobFailed(504, _TOO_SLOW)
        try:
            text, usage = model_call.result()
        except Exception as e:  # noqa: BLE001
            refusal = _model_failure(e)
            raise _JobFailed(refusal.status_code, str(refusal.detail))

        state["phase"] = "checking"
        try:
            draft = _finish(d, text)
        except HTTPException as refusal:
            raise _JobFailed(refusal.status_code, str(refusal.detail))
        if cancelled.is_set() or not await asyncio.to_thread(_still_running, task_id):
            raise _JobCancelled()

        await asyncio.to_thread(_bill, d, usage, draft)
        result = _response(d, draft)
        logger.info(
            "[engagement-plan] job %s done: %d/%d days, %d/%d tasks, usage=%s",
            task_id, result.days_planned, result.days_requested,
            result.items_planned, result.items_requested, usage,
        )
        return json.dumps({"draft": result.model_dump(), "charged": True})
    except _JobFailed:
        # A failure that lands after the teacher cancelled must not overwrite
        # "Cancelled" with an error the teacher never waited for.
        try:
            gone = cancelled.is_set() or not await asyncio.to_thread(_still_running, task_id)
        except Exception:  # noqa: BLE001 — the failure itself is what to report
            gone = False
        if gone:
            raise _JobCancelled() from None
        raise
    finally:
        finished.set()
        if not model_call.done():
            # Aborts the provider stream: a cancelled or timed-out draft stops
            # spending tokens now, not when the model would have finished.
            model_call.cancel()
        await asyncio.gather(beat, model_call, return_exceptions=True)


def _job_view(task: AiTask) -> Dict[str, Any]:
    """The poll payload. `result` is the finished draft (the /draft response
    shape); `charged` is true only for a finished draft — a failed, cancelled or
    interrupted job was never billed."""
    status_ = task.status or ""
    dyn = _loads(task.dynamic_values_map)
    progress: Dict[str, Any] = {}
    error = ""
    error_code: Optional[int] = None
    result = None
    charged = False
    now = _now()
    created, updated = _aware(task.created_at), _aware(task.updated_at)

    if status_ == AiTaskStatus.PROGRESS.value:
        progress = _loads(task.status_message)
        # A job still waiting for a worker slot (ai_task_service runs 16 at a
        # time, shared with every other AI job) has no heartbeat yet; give it
        # longer before calling it dead.
        stale_after = (
            _JOB_QUEUED_STALE_SECONDS if progress.get("phase") == "queued" else _JOB_STALE_SECONDS
        )
        if updated and (now - updated).total_seconds() > stale_after:
            status_ = "INTERRUPTED"
            error = "The draft stopped before it finished. Try again; you weren't charged."
    elif status_ == AiTaskStatus.FAILED.value:
        if (task.status_message or "") == _CANCELLED_MSG:
            status_ = "CANCELLED"
        else:
            failure = _loads(task.status_message)
            error = str(failure.get("detail") or _JOB_FAILED_FALLBACK)
            code = failure.get("code")
            error_code = int(code) if isinstance(code, int) else None
    elif status_ == AiTaskStatus.COMPLETED.value:
        data = _loads(task.result_json)
        result = data.get("draft")
        charged = bool(data.get("charged"))
        total = int((result or {}).get("days_requested") or dyn.get("days_requested") or 0)
        progress = {"phase": "done", "days_done": int((result or {}).get("days_planned") or 0), "days_total": total}

    return {
        "task_id": task.id,
        "status": status_,
        "kind": dyn.get("kind") or "plan",
        "single_item_type": dyn.get("single_item_type"),
        "progress": progress,
        "result": result,
        "error": error,
        "error_code": error_code,
        "charged": charged,
        "acknowledged": bool(dyn.get("acked")),
        "created_at": created.isoformat() if created else None,
        "elapsed_seconds": int((now - created).total_seconds()) if created else 0,
    }


def _mine(q, institute_id: Optional[str], user_id: Optional[str]):
    q = q.filter(AiTask.task_type == JOB_TYPE)
    if institute_id:
        q = q.filter(AiTask.institute_id == institute_id)
    if user_id:
        q = q.filter(AiTask.input_id == user_id)
    return q


def _load_job(db: Session, task_id: str, current_user) -> AiTask:
    """The caller's own job, or 404 (never another teacher's or institute's)."""
    user_id, institute_id, _ = _actor(current_user, None)
    task = AiTaskRepository(db).get(task_id)
    if (
        not task
        or task.task_type != JOB_TYPE
        or (institute_id and task.institute_id and task.institute_id != institute_id)
        or (user_id and task.input_id and task.input_id != user_id)
    ):
        raise HTTPException(status_code=404, detail="Draft not found.")
    return task


def _set_acked(db: Session, task: AiTask) -> None:
    dyn = _loads(task.dynamic_values_map)
    dyn["acked"] = True
    task.dynamic_values_map = json.dumps(dyn)
    db.commit()


def _reusable_job(db: Session, d: _Draft) -> Optional[AiTask]:
    """A double-click or a retried start with the same idempotency key gets the
    job already running (or finished) for it, not a second paid draft. A failed
    or cancelled one does not count: that retry must actually run."""
    if not d.idempotency_key:
        return None
    since = _now() - timedelta(hours=_JOB_REATTACH_HOURS)
    fragment = f'"idempotency_key": {json.dumps(d.idempotency_key)}'
    q = _mine(db.query(AiTask), d.institute_id, d.user_id).filter(
        AiTask.created_at >= since,
        AiTaskRepository.dynamic_values_contains(fragment),
        AiTask.status.in_([AiTaskStatus.PROGRESS.value, AiTaskStatus.COMPLETED.value]),
    )
    for task in q.order_by(AiTask.created_at.desc()).limit(5).all():
        if _loads(task.dynamic_values_map).get("idempotency_key") != d.idempotency_key:
            continue
        if _job_view(task)["status"] in (AiTaskStatus.PROGRESS.value, AiTaskStatus.COMPLETED.value):
            return task
    return None


@router.post("/draft/jobs")
@router.post("/jobs", include_in_schema=False)
async def start_draft_job(
    body: DraftRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    """Start a draft that keeps running if the teacher leaves. The same brief as
    POST /draft; auth, brief checks and the credit pre-flight still fail fast
    here (401/403/400/402/422/503)."""
    d = await _prepare(body, current_user, db)
    existing = _reusable_job(db, d)
    if existing is not None:
        return _job_view(existing)

    now = _now()
    task = AiTask(
        id=str(uuid4()),
        task_type=JOB_TYPE,
        status=AiTaskStatus.PROGRESS.value,
        institute_id=d.institute_id or "",
        input_id=d.user_id or "",
        input_type=AiTaskInputType.PROMPT_ID.value,
        task_name=(body.title or body.topic or "Engagement plan").strip()[:200] or "Engagement plan",
        status_message=json.dumps(
            {"phase": "queued", "days_done": 0, "days_total": d.days_requested}
        ),
        dynamic_values_map=json.dumps(
            {
                "kind": "item" if d.is_single else "plan",
                "single_item_type": d.single_item_type if d.is_single else None,
                "model": d.model,
                "days_requested": d.days_requested,
                "items_requested": d.items_requested,
                "idempotency_key": d.idempotency_key,
            }
        ),
        created_at=now,
        updated_at=now,
    )
    AiTaskRepository(db).create(task)
    # One charge per job, however it is retried or polled.
    if not d.idempotency_key:
        d.idempotency_key = f"engagement-plan-job:{task.id}"

    async def _work() -> str:
        return await _run_job(task.id, d)

    ai_task_service.schedule(task.id, _work)
    logger.info(
        "[engagement-plan] job %s started (%s, %d days, model=%s)",
        task.id, "item" if d.is_single else "plan", d.days_requested, d.model,
    )
    return _job_view(task)


@router.get("/draft/jobs/active")
@router.get("/jobs/active", include_in_schema=False)
async def get_active_draft_job(
    kind: str = "plan",
    current_user=Depends(get_current_user),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    """The caller's latest draft the wizard hasn't picked up yet — running,
    finished while they were away, or failed/interrupted. {"job": null} when
    there is nothing to show. `kind` is plan (default), item or any."""
    user_id, institute_id, _ = _actor(current_user, None)
    since = _now() - timedelta(hours=_JOB_REATTACH_HOURS)
    q = _mine(db.query(AiTask), institute_id, user_id).filter(AiTask.created_at >= since)
    if kind in ("plan", "item"):
        q = q.filter(AiTaskRepository.dynamic_values_contains(f'"kind": "{kind}"'))
    task = q.order_by(AiTask.created_at.desc()).first()
    if not task:
        return {"job": None}
    view = _job_view(task)
    if view["acknowledged"] or view["status"] == "CANCELLED":
        return {"job": None}
    return {"job": view}


@router.get("/draft/jobs/{task_id}")
@router.get("/jobs/{task_id}", include_in_schema=False)
async def get_draft_job(
    task_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    return _job_view(_load_job(db, task_id, current_user))


@router.post("/draft/jobs/{task_id}/cancel")
@router.post("/jobs/{task_id}/cancel", include_in_schema=False)
async def cancel_draft_job(
    task_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    """Stop a running draft. Nothing is charged for it. A draft that already
    finished stays finished (and charged) — the view says which happened."""
    task = _load_job(db, task_id, current_user)
    if task.status == AiTaskStatus.PROGRESS.value:
        task.status = AiTaskStatus.FAILED.value
        task.status_message = _CANCELLED_MSG
        task.updated_at = _now()
    _set_acked(db, task)
    return _job_view(task)


@router.post("/draft/jobs/{task_id}/ack")
@router.post("/jobs/{task_id}/ack", include_in_schema=False)
async def ack_draft_job(
    task_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    """The wizard applied (or dismissed) this result — stop offering it."""
    _set_acked(db, _load_job(db, task_id, current_user))
    return {"ok": True}


# ── pictures ─────────────────────────────────────────────────────────────────


@router.post("/illustrate", response_model=IllustrateResponse)
async def illustrate_reading(
    body: IllustrateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(db_dependency),
):
    """Generate the pictures a drafted reading asked for, turning it into a visual
    note. Charged per picture that actually came back — a failed generation costs
    nothing."""
    user_id, institute_id, role = _actor(current_user, body.institute_id)
    if "data-img-prompt" not in body.content_html:
        return IllustrateResponse(content_html=body.content_html, images_generated=0)

    _gate(db, "html_document_image", institute_id, "illustrating this reading", {"num_images": body.max_images})

    try:
        html, count = await illustrate_document(
            body.content_html, slide_path="engagement", max_images=body.max_images
        )
    except Exception as e:  # noqa: BLE001
        logger.error("[engagement-plan] illustrate failed: %s", e)
        raise HTTPException(status_code=502, detail="Could not generate the pictures. Try again.")

    if count > 0:
        try:
            record_tool_billing(
                tool_key="html_document_image",
                # `num_images` is the estimator's unit for this key; the old
                # `images` key priced every picture at 0.
                tool_params={"num_images": count},
                request_type=RequestType.IMAGE,
                model="qwen/qwen-image-3",
                institute_id=institute_id,
                user_id=user_id,
                user_role=role if user_id else None,
                idempotency_key=body.idempotency_key,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[engagement-plan] image billing skipped: %s", e)

    return IllustrateResponse(content_html=html, images_generated=count)
