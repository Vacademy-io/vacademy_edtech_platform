"""
Content translation pipeline (i18n Phase 1 Wave 1 — Arabic-first).

Stage machine per job (mirrors video_generation_service's resume-from-stage +
AWAITING_INPUT human gate, at ai_task_service's reliability bar):

    PENDING → EXTRACT → TRANSLATE → REVIEW → WRITE_BACK → COMPLETED

  EXTRACT    read-only SQL against the admin_core DB for the package session's
             content tree. v1 covers: slide.title / slide.description for every
             non-deleted slide; document_slide.published_data when type='HTML';
             and every rich_text_data row referenced by QUESTION / QUIZ /
             ASSIGNMENT slides (question stem/explanation/parent text, options,
             quiz description). v1 SKIPS: VIDEO / VIDEO_QUESTION / AUDIO /
             SCORM / ASSESSMENT slides, DOC/DOCX/PDF/PPT_ANIM documents (Yoopta
             JSON & binary assets), and all media variants (dubs / captions —
             later wave). The item manifest is stored in job.artifacts.
  TRANSLATE  per item: translation_memory exact-hash hit is used free; misses
             go to the LLM (model from resolve_models(db, 'translation')) with
             an HTML-preserving, glossary-constrained prompt. A post-check
             requires the output's HTML tag sequence to equal the source's —
             mangled HTML is never written. Each LLM item is billed
             (request_type 'translation', idempotency '{job_id}:{item_id}:{target_locale}').
  REVIEW     mode=DRAFT parks the job with status AWAITING_INPUT (resumed by
             POST /translation/v1/job/{id}/approve); AUTO_PUBLISH skips it.
  WRITE_BACK POSTs the shared batch-upsert contract to admin_core's internal
             endpoint (sidecar rows on canonical IDs — ai_service never writes
             the Java-owned tables directly). state=DRAFT for DRAFT mode,
             PUBLISHED for AUTO_PUBLISH.

Jobs are resumable by stage (schedule_job(job_id, start_stage=...)); a
boot-time stale sweep is intentionally NOT part of v1 (noted as a follow-up).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import re
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import uuid4

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import db_session
from ..models.ai_token_usage import RequestType
from ..models.ai_translation_job import (
    AiTranslationJob,
    TranslationJobMode,
    TranslationJobStage,
    TranslationJobStatus,
)
from .ai_billing import provider_for_model
from .llm_json import generate_json
from .model_selection import resolve_models

logger = logging.getLogger(__name__)

# Resumable stage order (PENDING/COMPLETED are states, not runnable stages).
STAGE_ORDER = ["EXTRACT", "TRANSLATE", "REVIEW", "WRITE_BACK"]

# Bounds so one job can't monopolize the LLM budget / DB / event loop.
MAX_ITEMS_PER_JOB = 2000
MAX_ITEM_CHARS = 150_000          # single item cap (a full HTML doc slide fits)
MAX_STRING_ITEMS = 200            # /translation/v1/strings synchronous cap
LLM_ITEM_CONCURRENCY = 4          # concurrent LLM calls within one job
MAX_CONCURRENT_JOBS = 2           # concurrent jobs per pod
WRITE_BACK_BATCH_SIZE = 100       # items per batch-upsert POST

_job_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)
# Strong refs so the event loop doesn't GC in-flight jobs (asyncio.create_task
# keeps only a weak ref) — same pattern as ai_task_service.
_running: Set[asyncio.Task] = set()

_BATCH_UPSERT_ROUTE = "/admin-core-service/internal/translations/v1/batch-upsert"

LOCALE_NAMES = {
    "en": "English", "ar": "Arabic", "hi": "Hindi", "ta": "Tamil",
    "te": "Telugu", "bn": "Bengali", "mr": "Marathi", "gu": "Gujarati",
    "kn": "Kannada", "ml": "Malayalam", "pa": "Punjabi", "or": "Odia",
    "as": "Assamese", "es": "Spanish", "fr": "French",
}


def sha256_text(value: str) -> str:
    """sha256 hex of the source text — the TM key and the sidecar source_hash
    (staleness detection compares this against a re-hash of the source)."""
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Protected-content masking (placeholders / data-code / LaTeX)
# ---------------------------------------------------------------------------

# Masked BEFORE the LLM call and restored verbatim after, so the model can
# never mangle them (and big base64 data-code payloads don't burn tokens).
_PROTECTED_PATTERNS = [
    re.compile(r"\{\{[^{}]*\}\}"),                 # {{template placeholders}}
    re.compile(r'data-code="[^"]*"'),              # base64 code payloads (HTML-doc contract)
    re.compile(r"\$\$.*?\$\$", re.DOTALL),         # $$ display math $$
    re.compile(r"\\\[.*?\\\]", re.DOTALL),         # \[ display math \]
    re.compile(r"\\\(.*?\\\)", re.DOTALL),         # \( inline math \)
]

_TAG_RE = re.compile(r"<\s*(/?)\s*([a-zA-Z][a-zA-Z0-9-]*)")


def mask_protected(value: str) -> Tuple[str, Dict[str, str]]:
    """Replace protected segments with __PH_n__ tokens. Returns (masked, mapping)."""
    mapping: Dict[str, str] = {}
    counter = 0
    masked = value

    def _sub(match: "re.Match[str]") -> str:
        nonlocal counter
        token = f"__PH_{counter}__"
        counter += 1
        mapping[token] = match.group(0)
        return token

    for pattern in _PROTECTED_PATTERNS:
        masked = pattern.sub(_sub, masked)
    return masked, mapping


def restore_protected(value: str, mapping: Dict[str, str]) -> str:
    for token, original in mapping.items():
        value = value.replace(token, original)
    return value


def tag_sequence(value: str) -> List[str]:
    """Ordered list of HTML tag names (with a leading '/' for closers), text
    stripped. Two documents with equal sequences have identical structure."""
    return [m.group(1) + m.group(2).lower() for m in _TAG_RE.finditer(value or "")]


# ---------------------------------------------------------------------------
# Glossary (NAMING_SETTING + TRANSLATION_SETTING)
# ---------------------------------------------------------------------------

def build_glossary_lines(db: Session, institute_id: Optional[str], target_locale: str) -> List[str]:
    """Constraint lines injected into every prompt.

    • TRANSLATION_SETTING.data.glossary: {term: "<fixed translation>"} or
      {term: {"<locale>": "<fixed translation>"}} or {term: "DO_NOT_TRANSLATE"}.
    • NAMING_SETTING custom terms (customValue differing from systemValue are
      institute-branded nouns) default to DO_NOT_TRANSLATE unless the glossary
      overrides them.
    Best-effort — a missing/broken setting yields an empty glossary.
    """
    lines: List[str] = []
    if not institute_id:
        return lines
    try:
        row = db.execute(
            text("SELECT setting_json FROM institutes WHERE id = :i"), {"i": institute_id}
        ).fetchone()
        if not row or not row[0]:
            return lines
        settings = json.loads(row[0]) if isinstance(row[0], str) else row[0]
        setting_map = (settings or {}).get("setting") or {}

        covered: Set[str] = set()
        trans_raw = setting_map.get("TRANSLATION_SETTING") or {}
        trans_data = trans_raw.get("data") if isinstance(trans_raw.get("data"), dict) else {}
        glossary = trans_data.get("glossary") if isinstance(trans_data, dict) else None
        if isinstance(glossary, dict):
            for term, val in glossary.items():
                if not term:
                    continue
                if isinstance(val, dict):
                    val = val.get(target_locale)
                covered.add(term)
                if isinstance(val, str) and val and val != "DO_NOT_TRANSLATE":
                    lines.append(f'- "{term}" must always be translated as "{val}"')
                else:
                    lines.append(f'- "{term}" must be kept EXACTLY as-is (do not translate)')

        naming_raw = setting_map.get("NAMING_SETTING") or {}
        naming_data = naming_raw.get("data") if isinstance(naming_raw.get("data"), dict) else {}
        naming_list = naming_data.get("data") if isinstance(naming_data, dict) else None
        if isinstance(naming_list, list):
            for entry in naming_list:
                if not isinstance(entry, dict):
                    continue
                custom = entry.get("customValue")
                system = entry.get("systemValue")
                if custom and custom != system and custom not in covered:
                    covered.add(custom)
                    lines.append(
                        f'- "{custom}" is an institute-branded term — keep it EXACTLY as-is'
                    )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Glossary build failed for institute %s: %s", institute_id, exc)
    return lines


def _build_item_prompt(
    masked_text: str,
    source_locale: str,
    target_locale: str,
    glossary_lines: List[str],
) -> str:
    src = LOCALE_NAMES.get(source_locale, source_locale)
    tgt = LOCALE_NAMES.get(target_locale, target_locale)
    glossary_block = (
        "GLOSSARY (hard constraints):\n" + "\n".join(glossary_lines) + "\n"
        if glossary_lines
        else ""
    )
    register_line = (
        "Use Modern Standard Arabic (الفصحى) with a clear instructional register.\n"
        if target_locale == "ar"
        else ""
    )
    return f"""You are a professional educational-content translator.
Translate the CONTENT below from {src} to {tgt}.

STRICT RULES:
1. Preserve ALL HTML tags and attributes EXACTLY — same tags, same order, same attributes. Translate ONLY the human-readable text between tags.
2. Tokens like __PH_0__, __PH_1__ are protected placeholders — copy each one through UNCHANGED, exactly once, in its logical position.
3. Do NOT translate code, LaTeX/MathJax math, URLs, file paths, or identifiers.
4. Do not add, drop, or reorder any HTML element. Do not add commentary.
{glossary_block}{register_line}
Return ONLY a JSON object: {{"translation": "<the translated content>"}}

CONTENT:
<<<
{masked_text}
>>>"""


# ---------------------------------------------------------------------------
# Translation memory
# ---------------------------------------------------------------------------

def tm_lookup(
    db: Session,
    institute_id: Optional[str],
    source_locale: str,
    target_locale: str,
    source_hash: str,
) -> Optional[str]:
    """Exact-hash TM hit. Institute-specific rows beat global rows; a
    HUMAN_REVIEWED row beats a plain AI one."""
    row = db.execute(
        text(
            """
            SELECT target_text
            FROM translation_memory
            WHERE source_hash = :h
              AND source_locale = :s
              AND target_locale = :t
              AND (institute_id = :inst OR institute_id IS NULL)
            ORDER BY (institute_id IS NULL) ASC, (quality = 'AI') ASC
            LIMIT 1
            """
        ),
        {"h": source_hash, "s": source_locale, "t": target_locale, "inst": institute_id},
    ).fetchone()
    return row[0] if row else None


def tm_write(
    db: Session,
    *,
    institute_id: Optional[str],
    source_locale: str,
    target_locale: str,
    source_hash: str,
    source_text_value: str,
    target_text_value: str,
    domain: str,
    quality: str = "AI",
) -> None:
    """Best-effort TM insert. Targetless ON CONFLICT DO NOTHING covers both the
    4-column UNIQUE and the global (institute_id IS NULL) partial index."""
    db.execute(
        text(
            """
            INSERT INTO translation_memory
                (id, institute_id, source_locale, target_locale, source_hash,
                 source_text, target_text, quality, domain)
            VALUES (:id, :inst, :s, :t, :h, :src, :tgt, :q, :d)
            ON CONFLICT DO NOTHING
            """
        ),
        {
            "id": str(uuid4()),
            "inst": institute_id,
            "s": source_locale,
            "t": target_locale,
            "h": source_hash,
            "src": source_text_value,
            "tgt": target_text_value,
            "q": quality,
            "d": domain,
        },
    )


# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------

def _charge_llm_item(
    *,
    job_id: str,
    item_id: str,
    target_locale: str,
    chars: int,
    model: str,
    usage: Dict[str, int],
    institute_id: str,
    user_id: Optional[str],
) -> None:
    """Charge one LLM-translated item: max(parametric fraction, actual token cost).

    Deliberately does NOT go through record_tool_billing/charge_tool: those
    round the PARAMETRIC floor up to a whole credit per invocation, which is
    right for one-shot tools but would multiply a 500-item course's floor to
    ≥500 credits (vs the seeded 0.02/100-chars intent). This keeps the
    fractional per-item rate from ai_tool_pricing while preserving the exact
    idempotency contract '{job_id}:{item_id}:{target_locale}' and the
    max(parametric, actual) + allow_negative semantics of charge_tool.
    Best-effort: the translation already happened; billing must never fail the item.
    """
    try:
        from .credit_service import CreditService
        from .token_usage_service import TokenUsageService
        from .tool_cost_estimator import ToolCostEstimator, _d

        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)

        with db_session() as db:
            pricing = ToolCostEstimator(db).get_tool_pricing("translate_rich_text").get(
                "translate_rich_text"
            ) or {}
            per_unit = _d(pricing.get("per_unit_credits"), "0.02")
            flat_base = _d(pricing.get("flat_base_credits"), "0")
            chars_per_unit = _d((pricing.get("params") or {}).get("chars_per_unit"), "100")
            if chars_per_unit <= 0:
                chars_per_unit = Decimal("100")
            units = Decimal(math.ceil(Decimal(max(chars, 0)) / chars_per_unit))
            parametric = flat_base + units * per_unit

            actual = Decimal("0")
            if prompt_tokens or completion_tokens:
                actual = CreditService(db).calculate_credits(
                    request_type=RequestType.TRANSLATION.value,
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                )
            charge = max(parametric, actual)

            from .ai_billing import metering_kwargs, metering_user, supported_kwargs
            tus = TokenUsageService(db)
            tus.record_usage_and_deduct_credits(
                api_provider=provider_for_model(model),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
                request_type=RequestType.TRANSLATION,
                institute_id=institute_id,
                user_id=user_id,
                model=model,
                request_id=job_id,
                precomputed_credits=charge,
                idempotency_key=f"{job_id}:{item_id}:{target_locale}",
                user_role="ADMIN" if user_id else None,
                # Post-paid: the item was already translated — never silently
                # drop the charge if a concurrent spend dipped the balance.
                allow_negative=True,
                # Usage-event attribution only (the ledger role above is unchanged).
                **supported_kwargs(tus.record_usage_and_deduct_credits, metering_kwargs(
                    "translation", metering_user(user_id, surface="ADMIN_APP"),
                    {"job_id": job_id, "item_id": item_id, "target_locale": target_locale},
                )),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Translation item billing failed (job=%s item=%s): %s", job_id, item_id, exc
        )


# ---------------------------------------------------------------------------
# EXTRACT — read-only content-tree queries (admin_core DB)
# ---------------------------------------------------------------------------

# Shared FROM/WHERE fragment: every non-deleted slide of every non-deleted
# chapter of the package session. Extra JOINs are appended per query.
_TREE_JOIN = """
FROM chapter_package_session_mapping cpsm
JOIN chapter_to_slides cts ON cts.chapter_id = cpsm.chapter_id
JOIN slide s ON s.id = cts.slide_id
"""
_TREE_WHERE = """
WHERE cpsm.package_session_id = :psid
  AND COALESCE(cpsm.status, '') <> 'DELETED'
  AND COALESCE(cts.status, '') <> 'DELETED'
  AND COALESCE(s.status, '') <> 'DELETED'
"""

_SLIDES_SQL = f"""
SELECT s.id AS slide_id, s.title, s.description,
       ds.type AS doc_type, ds.published_data
{_TREE_JOIN}
LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
{_TREE_WHERE}
ORDER BY s.id
LIMIT :lim
"""

# rich_text_data referenced by QUESTION / QUIZ / ASSIGNMENT slides. `"option"`
# is quoted — it's a reserved word. rt.id IN (col, col, ...) fans one row per
# referenced FK; DISTINCT dedupes shared rich texts.
_RICH_TEXT_SQLS = [
    # question slide: stem / parent / explanation
    f"""
    SELECT DISTINCT rt.id AS rich_text_id, rt.content
    {_TREE_JOIN}
    JOIN question_slide q ON q.id = s.source_id AND s.source_type = 'QUESTION'
    JOIN rich_text_data rt ON rt.id IN (q.parent_rich_text_id, q.text_id, q.explanation_text_id)
    {_TREE_WHERE}
    """,
    # question slide options
    f"""
    SELECT DISTINCT rt.id AS rich_text_id, rt.content
    {_TREE_JOIN}
    JOIN question_slide q ON q.id = s.source_id AND s.source_type = 'QUESTION'
    JOIN "option" o ON o.question_id = q.id
    JOIN rich_text_data rt ON rt.id IN (o.text_id, o.explanation_text_id)
    {_TREE_WHERE}
    """,
    # quiz slide description (quiz_slide.description IS the rich-text FK)
    f"""
    SELECT DISTINCT rt.id AS rich_text_id, rt.content
    {_TREE_JOIN}
    JOIN quiz_slide qs ON qs.id = s.source_id AND s.source_type = 'QUIZ'
    JOIN rich_text_data rt ON rt.id = qs.description
    {_TREE_WHERE}
    """,
    # quiz questions
    f"""
    SELECT DISTINCT rt.id AS rich_text_id, rt.content
    {_TREE_JOIN}
    JOIN quiz_slide qs ON qs.id = s.source_id AND s.source_type = 'QUIZ'
    JOIN quiz_slide_question qq ON qq.quiz_slide_id = qs.id
    JOIN rich_text_data rt ON rt.id IN (qq.parent_rich_text_id, qq.text_id, qq.explanation_text_id)
    {_TREE_WHERE}
    """,
    # quiz question options
    f"""
    SELECT DISTINCT rt.id AS rich_text_id, rt.content
    {_TREE_JOIN}
    JOIN quiz_slide qs ON qs.id = s.source_id AND s.source_type = 'QUIZ'
    JOIN quiz_slide_question qq ON qq.quiz_slide_id = qs.id
    JOIN quiz_slide_question_options qo ON qo.quiz_slide_question_id = qq.id
    JOIN rich_text_data rt ON rt.id IN (qo.text_id, qo.explanation_text_id)
    {_TREE_WHERE}
    """,
    # assignment slide texts
    f"""
    SELECT DISTINCT rt.id AS rich_text_id, rt.content
    {_TREE_JOIN}
    JOIN assignment_slide a ON a.id = s.source_id AND s.source_type = 'ASSIGNMENT'
    JOIN rich_text_data rt ON rt.id IN (a.parent_rich_text_id, a.text_id)
    {_TREE_WHERE}
    """,
    # assignment questions
    f"""
    SELECT DISTINCT rt.id AS rich_text_id, rt.content
    {_TREE_JOIN}
    JOIN assignment_slide a ON a.id = s.source_id AND s.source_type = 'ASSIGNMENT'
    JOIN assignment_slide_question aq ON aq.assignment_slide_id = a.id
    JOIN rich_text_data rt ON rt.id = aq.text_id
    {_TREE_WHERE}
    """,
]


def _usable(value: Optional[str]) -> bool:
    return bool(value) and bool(value.strip()) and len(value) <= MAX_ITEM_CHARS


def extract_items(db: Session, package_session_id: str) -> List[Dict[str, Any]]:
    """Build the v1 item manifest for one package session. Read-only, bounded
    (MAX_ITEMS_PER_JOB / MAX_ITEM_CHARS). Each item carries the source text +
    its sha256 so TRANSLATE and WRITE_BACK never re-read the source rows."""
    items: List[Dict[str, Any]] = []
    seen: Set[str] = set()

    def _add(item_id: str, item: Dict[str, Any]) -> None:
        if item_id in seen or len(items) >= MAX_ITEMS_PER_JOB:
            return
        seen.add(item_id)
        item["item_id"] = item_id
        item["source_hash"] = sha256_text(item["text"])
        item["chars"] = len(item["text"])
        items.append(item)

    params = {"psid": package_session_id, "lim": MAX_ITEMS_PER_JOB}
    for row in db.execute(text(_SLIDES_SQL), params).fetchall():
        if _usable(row.title):
            _add(f"EF:SLIDE:{row.slide_id}:title", {
                "target_type": "ENTITY_FIELD", "entity_type": "SLIDE",
                "entity_id": row.slide_id, "field": "title", "text": row.title,
            })
        if _usable(row.description):
            _add(f"EF:SLIDE:{row.slide_id}:description", {
                "target_type": "ENTITY_FIELD", "entity_type": "SLIDE",
                "entity_id": row.slide_id, "field": "description", "text": row.description,
            })
        if row.doc_type == "HTML" and _usable(row.published_data):
            _add(f"EF:DOCUMENT_SLIDE:{row.slide_id}:published_data", {
                "target_type": "ENTITY_FIELD", "entity_type": "DOCUMENT_SLIDE",
                "entity_id": row.slide_id, "field": "published_data",
                "text": row.published_data,
            })

    for sql in _RICH_TEXT_SQLS:
        for row in db.execute(text(sql), {"psid": package_session_id}).fetchall():
            if _usable(row.content):
                _add(f"RT:{row.rich_text_id}", {
                    "target_type": "RICH_TEXT", "rich_text_id": row.rich_text_id,
                    "text": row.content,
                })

    return items


# ---------------------------------------------------------------------------
# Job row helpers (short-lived sessions — the machine runs outside any request)
# ---------------------------------------------------------------------------

def _load_job(job_id: str) -> Optional[Dict[str, Any]]:
    with db_session() as db:
        job = db.get(AiTranslationJob, job_id)
        if not job:
            return None
        return {
            "id": job.id,
            "institute_id": job.institute_id,
            "package_session_id": job.package_session_id,
            "source_locale": job.source_locale,
            "target_locale": job.target_locale,
            "scope": job.scope,
            "mode": job.mode,
            "status": job.status,
            "current_stage": job.current_stage,
            "items_total": job.items_total,
            "items_done": job.items_done,
            "artifacts": dict(job.artifacts or {}),
            "created_by": job.created_by,
        }


def _update_job(job_id: str, **fields: Any) -> None:
    with db_session() as db:
        job = db.get(AiTranslationJob, job_id)
        if not job:
            return
        for key, value in fields.items():
            setattr(job, key, value)
        job.updated_at = datetime.utcnow()


def _bump_items_done(job_id: str) -> None:
    try:
        with db_session() as db:
            db.execute(
                text(
                    "UPDATE ai_translation_job "
                    "SET items_done = items_done + 1, updated_at = now() "
                    "WHERE id = :id"
                ),
                {"id": job_id},
            )
    except Exception:  # noqa: BLE001
        logger.warning("items_done bump failed for job %s", job_id, exc_info=True)


# ---------------------------------------------------------------------------
# Stage machine
# ---------------------------------------------------------------------------

def schedule_job(job_id: str, start_stage: str = "EXTRACT") -> None:
    """Fire-and-forget one stage-machine leg (ai_task_service.schedule pattern)."""
    bg = asyncio.create_task(_run_job(job_id, start_stage))
    _running.add(bg)
    bg.add_done_callback(_running.discard)


async def _run_job(job_id: str, start_stage: str) -> None:
    async with _job_semaphore:
        try:
            await _run_stages(job_id, start_stage)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Translation job %s failed", job_id)
            try:
                await asyncio.to_thread(
                    _update_job,
                    job_id,
                    status=TranslationJobStatus.FAILED.value,
                    error_message=str(exc)[:2000],
                )
            except Exception:  # noqa: BLE001
                logger.exception("Failed to persist FAILED status for job %s", job_id)


async def _run_stages(job_id: str, start_stage: str) -> None:
    job = await asyncio.to_thread(_load_job, job_id)
    if not job:
        logger.error("Translation job %s not found; dropping leg", job_id)
        return

    start_idx = STAGE_ORDER.index(start_stage) if start_stage in STAGE_ORDER else 0
    artifacts: Dict[str, Any] = job["artifacts"] or {}

    await asyncio.to_thread(
        _update_job, job_id, status=TranslationJobStatus.IN_PROGRESS.value
    )

    # --- EXTRACT ---------------------------------------------------------
    if start_idx <= STAGE_ORDER.index("EXTRACT"):
        def _extract() -> List[Dict[str, Any]]:
            with db_session() as db:
                return extract_items(db, job["package_session_id"])

        items = await asyncio.to_thread(_extract)
        artifacts["manifest"] = items
        await asyncio.to_thread(
            _update_job,
            job_id,
            artifacts=artifacts,
            items_total=len(items),
            items_done=0,
            current_stage=TranslationJobStage.EXTRACT.value,
        )
        if not items:
            await asyncio.to_thread(
                _update_job,
                job_id,
                status=TranslationJobStatus.COMPLETED.value,
                current_stage=TranslationJobStage.COMPLETED.value,
                error_message=None,
            )
            logger.info("Translation job %s: nothing to translate; completed.", job_id)
            return
    else:
        items = artifacts.get("manifest") or []

    # --- TRANSLATE -------------------------------------------------------
    if start_idx <= STAGE_ORDER.index("TRANSLATE"):
        translations, failed = await _translate_items(job, items)
        artifacts["translations"] = translations
        artifacts["failed_items"] = failed
        await asyncio.to_thread(
            _update_job,
            job_id,
            artifacts=artifacts,
            current_stage=TranslationJobStage.TRANSLATE.value,
        )
    else:
        translations = artifacts.get("translations") or {}

    # --- REVIEW (human gate — DRAFT mode only) ----------------------------
    if job["mode"] == TranslationJobMode.DRAFT.value and start_idx <= STAGE_ORDER.index("REVIEW"):
        await asyncio.to_thread(
            _update_job,
            job_id,
            status=TranslationJobStatus.AWAITING_INPUT.value,
            current_stage=TranslationJobStage.REVIEW.value,
        )
        logger.info("Translation job %s parked at REVIEW (AWAITING_INPUT).", job_id)
        return

    # --- WRITE_BACK --------------------------------------------------------
    result = await _write_back(job, items, translations, artifacts.get("rejected_items"))
    artifacts["write_back"] = result
    await asyncio.to_thread(
        _update_job,
        job_id,
        artifacts=artifacts,
        current_stage=TranslationJobStage.WRITE_BACK.value,
    )

    await asyncio.to_thread(
        _update_job,
        job_id,
        status=TranslationJobStatus.COMPLETED.value,
        current_stage=TranslationJobStage.COMPLETED.value,
        error_message=None,
    )
    logger.info(
        "Translation job %s completed (%s items, %s upserted).",
        job_id, len(items), result.get("upserted"),
    )


async def _translate_items(
    job: Dict[str, Any], items: List[Dict[str, Any]]
) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, str]]]:
    """TRANSLATE stage: TM hit → free; miss → LLM + validation + billing + TM write."""
    job_id = job["id"]
    source_locale = job["source_locale"]
    target_locale = job["target_locale"]
    institute_id = job["institute_id"]

    def _prep() -> Tuple[List[str], List[str]]:
        with db_session() as db:
            primary, fallbacks = resolve_models(db, "translation", None)
            glossary = build_glossary_lines(db, institute_id, target_locale)
        return [primary, *fallbacks], glossary

    models, glossary_lines = await asyncio.to_thread(_prep)

    translations: Dict[str, Dict[str, Any]] = {}
    failed: List[Dict[str, str]] = []
    item_semaphore = asyncio.Semaphore(LLM_ITEM_CONCURRENCY)

    async def _one(item: Dict[str, Any]) -> None:
        item_id = item["item_id"]
        source_text_value = item["text"]
        async with item_semaphore:
            try:
                def _lookup() -> Optional[str]:
                    with db_session() as db:
                        return tm_lookup(
                            db, institute_id, source_locale, target_locale,
                            item["source_hash"],
                        )

                cached = await asyncio.to_thread(_lookup)
                if cached is not None:
                    # TM hits are free — no billing.
                    translations[item_id] = {
                        "content": cached,
                        "translated_by": "AI:translation-memory",
                        "tm_hit": True,
                    }
                    return

                masked, mapping = mask_protected(source_text_value)
                prompt = _build_item_prompt(masked, source_locale, target_locale, glossary_lines)
                raw_json, model, usage = await generate_json(
                    prompt, models, label=f"translation:{job_id}"
                )
                data = json.loads(raw_json)
                out = data.get("translation") if isinstance(data, dict) else None
                if not isinstance(out, str) or not out.strip():
                    raise ValueError("LLM returned no 'translation' string")
                for token in mapping:
                    if token not in out:
                        raise ValueError(f"protected placeholder {token} was dropped")
                restored = restore_protected(out, mapping)
                # Structural gate: identical tag sequence or the item fails —
                # mangled HTML is never written back.
                if tag_sequence(restored) != tag_sequence(source_text_value):
                    raise ValueError("HTML tag structure mismatch between source and output")

                await asyncio.to_thread(
                    _charge_llm_item,
                    job_id=job_id,
                    item_id=item_id,
                    target_locale=target_locale,
                    chars=item.get("chars") or len(source_text_value),
                    model=model,
                    usage=usage or {},
                    institute_id=institute_id,
                    user_id=job.get("created_by"),
                )

                def _persist_tm() -> None:
                    with db_session() as db:
                        tm_write(
                            db,
                            institute_id=institute_id,
                            source_locale=source_locale,
                            target_locale=target_locale,
                            source_hash=item["source_hash"],
                            source_text_value=source_text_value,
                            target_text_value=restored,
                            domain="CONTENT",
                        )

                try:
                    await asyncio.to_thread(_persist_tm)
                except Exception:  # noqa: BLE001
                    logger.warning("TM write failed (job=%s item=%s)", job_id, item_id, exc_info=True)

                translations[item_id] = {
                    "content": restored,
                    "translated_by": f"AI:{model}",
                    "tm_hit": False,
                }
            except Exception as exc:  # noqa: BLE001
                logger.warning("Translation item failed (job=%s item=%s): %s", job_id, item_id, exc)
                failed.append({"item_id": item_id, "reason": str(exc)[:300]})
            finally:
                await asyncio.to_thread(_bump_items_done, job_id)

    await asyncio.gather(*(_one(item) for item in items))
    return translations, failed


async def _write_back(
    job: Dict[str, Any],
    items: List[Dict[str, Any]],
    translations: Dict[str, Dict[str, Any]],
    rejected_items: Optional[List[str]],
) -> Dict[str, Any]:
    """POST the shared batch-upsert contract to admin_core (sidecar rows)."""
    state = (
        "PUBLISHED"
        if job["mode"] == TranslationJobMode.AUTO_PUBLISH.value
        else "DRAFT"
    )
    rejected = set(rejected_items or [])
    payload_items: List[Dict[str, Any]] = []
    for item in items:
        item_id = item["item_id"]
        if item_id in rejected:
            continue
        tr = translations.get(item_id)
        if not tr or not tr.get("content"):
            continue
        entry: Dict[str, Any] = {
            "target_type": item["target_type"],
            "locale": job["target_locale"],
            "content": tr["content"],
            "state": state,
            "source_locale": job["source_locale"],
            "source_hash": item["source_hash"],
            "translated_by": tr.get("translated_by") or "AI:unknown",
        }
        if item["target_type"] == "RICH_TEXT":
            entry["rich_text_id"] = item["rich_text_id"]
        else:  # ENTITY_FIELD
            entry["entity_type"] = item["entity_type"]
            entry["entity_id"] = item["entity_id"]
            entry["field"] = item["field"]
            entry["json_value"] = None
        payload_items.append(entry)

    if not payload_items:
        return {"upserted": 0, "batches": 0, "state": state}

    from .internal_auth import internal_auth_headers

    settings = get_settings()
    url = settings.admin_core_service_base_url.rstrip("/") + _BATCH_UPSERT_ROUTE
    headers = await internal_auth_headers({"Content-Type": "application/json"})

    upserted = 0
    batches = 0
    async with httpx.AsyncClient(timeout=120.0) as client:
        for i in range(0, len(payload_items), WRITE_BACK_BATCH_SIZE):
            chunk = payload_items[i : i + WRITE_BACK_BATCH_SIZE]
            body = {"items": chunk, "package_session_id": job["package_session_id"]}
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code != 200:
                raise RuntimeError(
                    f"batch-upsert failed (HTTP {resp.status_code}): {resp.text[:300]}"
                )
            batches += 1
            try:
                upserted += int(resp.json().get("upserted") or 0)
            except Exception:  # noqa: BLE001
                logger.warning("batch-upsert returned non-JSON body; counting chunk size")
                upserted += len(chunk)

    return {"upserted": upserted, "batches": batches, "state": state}


def apply_review_decisions(
    job_id: str, item_decisions: Optional[Dict[str, Any]], acting_user: Optional[str]
) -> None:
    """Record per-item review decisions before resuming WRITE_BACK.

    item_decisions: {item_id: "REJECT"} or
                    {item_id: {"action": "REJECT" | "EDIT", "content": "..."}}.
    REJECT drops the item from write-back; EDIT overrides the translated text
    (translated_by flips to USER:<id> per the contract).
    """
    if not item_decisions:
        return
    with db_session() as db:
        job = db.get(AiTranslationJob, job_id)
        if not job:
            return
        artifacts = dict(job.artifacts or {})
        translations = dict(artifacts.get("translations") or {})
        rejected = list(artifacts.get("rejected_items") or [])
        for item_id, decision in item_decisions.items():
            action = decision if isinstance(decision, str) else (decision or {}).get("action")
            action = (action or "").upper()
            if action == "REJECT":
                if item_id not in rejected:
                    rejected.append(item_id)
            elif action == "EDIT":
                content = (decision or {}).get("content") if isinstance(decision, dict) else None
                if isinstance(content, str) and content.strip() and item_id in translations:
                    entry = dict(translations[item_id])
                    entry["content"] = content
                    entry["translated_by"] = f"USER:{acting_user}" if acting_user else "USER:unknown"
                    translations[item_id] = entry
        artifacts["translations"] = translations
        artifacts["rejected_items"] = rejected
        job.artifacts = artifacts
        job.updated_at = datetime.utcnow()


# ---------------------------------------------------------------------------
# Synchronous UI/notification string translation (/translation/v1/strings)
# ---------------------------------------------------------------------------

async def translate_strings(
    *,
    items: List[Dict[str, str]],
    source_locale: str,
    target_locale: str,
    institute_id: Optional[str],
    domain: str,
) -> Dict[str, Any]:
    """TM-first batch string translation. One batched LLM call covers all TM
    misses; successful misses are written to the TM (quality AI) and charged as
    translate_strings on the missed chars. Returns
    {translations: {key: text}, failed_keys, tm_hits, model_used}."""
    results: Dict[str, str] = {}
    failed_keys: List[str] = []
    misses: List[Dict[str, str]] = []

    def _lookup_all() -> None:
        with db_session() as db:
            for it in items:
                key, text_value = it["key"], it["text"]
                if not text_value or not text_value.strip():
                    results[key] = text_value
                    continue
                cached = tm_lookup(
                    db, institute_id, source_locale, target_locale, sha256_text(text_value)
                )
                if cached is not None:
                    results[key] = cached
                else:
                    misses.append(it)

    await asyncio.to_thread(_lookup_all)
    tm_hits = len(results)
    model_used: Optional[str] = None

    if misses:
        def _prep() -> Tuple[List[str], List[str]]:
            with db_session() as db:
                primary, fallbacks = resolve_models(db, "translation", None)
                glossary = build_glossary_lines(db, institute_id, target_locale)
            return [primary, *fallbacks], glossary

        models, glossary_lines = await asyncio.to_thread(_prep)

        # Alias keys as s0..sN so odd client keys can't collide with JSON keys
        # the model invents; mask {{placeholders}} per string.
        aliased: Dict[str, Dict[str, Any]] = {}
        payload: Dict[str, str] = {}
        for idx, it in enumerate(misses):
            alias = f"s{idx}"
            masked, mapping = mask_protected(it["text"])
            aliased[alias] = {"key": it["key"], "text": it["text"], "mapping": mapping}
            payload[alias] = masked

        src = LOCALE_NAMES.get(source_locale, source_locale)
        tgt = LOCALE_NAMES.get(target_locale, target_locale)
        glossary_block = (
            "GLOSSARY (hard constraints):\n" + "\n".join(glossary_lines) + "\n"
            if glossary_lines
            else ""
        )
        register_line = (
            "Use Modern Standard Arabic (الفصحى).\n" if target_locale == "ar" else ""
        )
        prompt = f"""You are a professional UI/notification string translator.
Translate every value in the JSON object below from {src} to {tgt}.

STRICT RULES:
1. Keys must be returned UNCHANGED; translate values only.
2. Tokens like __PH_0__ are protected placeholders — copy them through unchanged.
3. Keep the tone short and natural for product UI.
{glossary_block}{register_line}
Return ONLY a JSON object with the same keys.

STRINGS:
{json.dumps(payload, ensure_ascii=False, indent=2)}"""

        raw_json, model_used, usage = await generate_json(prompt, models, label="translation:strings")
        parsed = json.loads(raw_json)
        if not isinstance(parsed, dict):
            raise RuntimeError("String translation returned a non-object JSON payload")

        def _persist() -> None:
            with db_session() as db:
                for alias, meta in aliased.items():
                    out = parsed.get(alias)
                    if not isinstance(out, str) or not out.strip():
                        failed_keys.append(meta["key"])
                        continue
                    if any(token not in out for token in meta["mapping"]):
                        failed_keys.append(meta["key"])
                        continue
                    restored = restore_protected(out, meta["mapping"])
                    results[meta["key"]] = restored
                    tm_write(
                        db,
                        institute_id=institute_id,
                        source_locale=source_locale,
                        target_locale=target_locale,
                        source_hash=sha256_text(meta["text"]),
                        source_text_value=meta["text"],
                        target_text_value=restored,
                        domain=domain,
                    )

        await asyncio.to_thread(_persist)

        missed_chars = sum(len(it["text"]) for it in misses)
        from .ai_billing import record_tool_billing

        record_tool_billing(
            tool_key="translate_strings",
            tool_params={"transcript_chars": missed_chars},
            request_type=RequestType.TRANSLATION,
            model=model_used,
            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
            completion_tokens=int((usage or {}).get("completion_tokens") or 0),
            institute_id=institute_id,
        )

    return {
        "translations": results,
        "failed_keys": failed_keys,
        "tm_hits": tm_hits,
        "model_used": model_used,
    }


# ---------------------------------------------------------------------------
# Estimation (parametric — shared by /estimate and the course 402 preflight)
# ---------------------------------------------------------------------------

def estimate_translation(
    db: Session,
    *,
    scope: str,
    package_session_id: Optional[str],
    item_counts: Optional[Dict[str, Any]],
    institute_id: Optional[str],
) -> Dict[str, Any]:
    """Parametric estimate + balance. item_counts (chars / questions /
    strings_chars) short-circuits the DB walk; otherwise a package_session_id
    triggers the same bounded read-only extraction EXTRACT uses."""
    from .tool_cost_estimator import ToolCostEstimator

    estimator = ToolCostEstimator(db)
    counts = dict(item_counts or {})
    chars = counts.get("chars") or counts.get("rich_text_chars")
    questions = counts.get("questions")
    items_found: Optional[int] = None

    if chars is None and package_session_id:
        items = extract_items(db, package_session_id)
        chars = sum(item["chars"] for item in items)
        items_found = len(items)

    breakdown: List[Dict[str, Any]] = []
    total = Decimal("0")
    scope_upper = (scope or "FULL").upper()

    if scope_upper == "STRINGS":
        est = estimator.estimate(
            "translate_strings", {"transcript_chars": int(counts.get("strings_chars") or chars or 0)}
        )
        total += Decimal(str(est["estimated_credits"]))
        breakdown.extend(est["breakdown"])
    elif scope_upper == "QUESTIONS":
        per_q = Decimal(str(estimator.estimate("translate_question", {})["estimated_credits"]))
        q = int(questions or 0)
        total += per_q * q
        breakdown.append({
            "component": "questions",
            "detail": f"{q} question(s) × {per_q}",
            "credits": float(per_q * q),
        })
    else:  # FULL course
        base = estimator.estimate("translate_course", {})
        total += Decimal(str(base["estimated_credits"]))
        breakdown.extend(base["breakdown"])
        if chars:
            per_chars = estimator.estimate("translate_rich_text", {"transcript_chars": int(chars)})
            total += Decimal(str(per_chars["estimated_credits"]))
            breakdown.extend(per_chars["breakdown"])

    result: Dict[str, Any] = {
        "scope": scope_upper,
        "estimated_credits": float(total),
        "breakdown": breakdown,
        "chars_considered": int(chars) if chars else 0,
        "items_found": items_found,
        "current_balance": None,
        "balance_after": None,
        "sufficient": None,
    }
    if institute_id:
        from .credit_service import CreditService

        balance = CreditService(db).get_balance(institute_id)
        if balance:
            current = balance.current_balance
            result["current_balance"] = float(current)
            result["balance_after"] = float(current - total)
            result["sufficient"] = current >= total
    return result


# ---------------------------------------------------------------------------
# Website builder: site texts (POST /page-builder/v1/translate)
# ---------------------------------------------------------------------------
#
# A catalogue site keeps its other languages as dictionaries keyed by the
# EXACT base-language text (globalSettings.i18n.strings[locale]), so every
# result here is keyed by the exact source string the caller sent.
#
# Website copy differs from UI strings and course content: short headings and
# buttons sit next to whole HTML blocks with links, prices and dates. Besides
# mask_protected's spans (placeholders, data-code, LaTeX — its patterns are
# reused read-only, its code is untouched) every single-brace text-pattern
# placeholder ({stream}, {title}), HTML tag (attributes byte-exact), raw-text
# element (style/script/pre/code, whole), URL, email, entity and digit run is
# masked as a __PH_n__ token. A translation is accepted only when every token
# comes back exactly once, the markup is intact (inline spans may move — Hindi
# word order — block structure may not), the numbers are unchanged (no
# Devanagari digits) and the {placeholders} are the same. Anything else is
# reported as failed, never "fixed".

WEBSITE_TM_DOMAIN = "WEBSITE"
WEBSITE_MAX_STRINGS = 200            # texts per request
WEBSITE_MAX_STRING_CHARS = 30_000    # one text (an htmlBlock's html is capped at 30k)
WEBSITE_MAX_TOTAL_CHARS = 120_000    # all texts of one request
WEBSITE_LONG_CHARS = 1_500           # a longer (masked) text gets an LLM call of its own
WEBSITE_BATCH_CHARS = 4_000          # masked characters per batched call
WEBSITE_BATCH_ITEMS = 25             # texts per batched call
WEBSITE_LLM_CONCURRENCY = 3          # LLM calls in flight per request

_WEBSITE_TOKEN_RE = re.compile(r"__PH_\d+__")
# A text pattern's placeholder ("Explore {stream}", "Categories in {stream}"):
# the site fills it per item at render time, by its ASCII name, so the name
# must come back exactly as typed — '{धारा}' would show literally.
_WEBSITE_TEXT_PLACEHOLDER_RE = re.compile(r"\{[A-Za-z_][A-Za-z0-9_]*\}")


def _scoped(pattern: "re.Pattern[str]") -> str:
    """`pattern` as a group carrying its own flags, to join it into one regex."""
    letters = "".join(
        letter
        for flag, letter in ((re.IGNORECASE, "i"), (re.MULTILINE, "m"), (re.DOTALL, "s"), (re.VERBOSE, "x"))
        if pattern.flags & flag
    )
    return f"(?{letters}:{pattern.pattern})" if letters else f"(?:{pattern.pattern})"


# ONE left-to-right pass where the leftmost span wins, so no masked span ever
# holds a token: a placeholder inside a tag or link (`<img src="{{course.image}}">`,
# `https://x.org/{{id}}`) stays inside that tag's/link's token byte-exact, and
# digits inside a placeholder or LaTeX (`{{step2}}`, `{step2}`, `$$x^2$$`) stay
# inside theirs. (Masking one kind after another nests tokens, and the reply can
# then never carry every token exactly once.) Where two spans start at the same
# place, the order below decides: a literal token already in the source,
# mask_protected's spans (so `{{name}}` stays one placeholder), text-pattern
# placeholders (`{stream}`), comments, raw-text elements whose content is never
# prose (style, script, pre, code — masked whole, so CSS/JS is neither sent
# nor translated), tags, links, emails, entities, digit runs.
_WEBSITE_MASK_RE = re.compile(
    "|".join(
        [r"__PH_\d+__"]
        + [_scoped(p) for p in _PROTECTED_PATTERNS]
        + [_scoped(_WEBSITE_TEXT_PLACEHOLDER_RE)]
        + [r"(?s:<!--.*?-->)"]
        + [rf"(?is:<{tag}\b[^>]*>.*?</{tag}\s*>)" for tag in ("style", "script", "pre", "code")]
        + [
            r"<[^<>]+>",
            r"https?://[^\s<>\"']+",
            r"www\.[^\s<>\"']+",
            r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+",
            r"&(?:[A-Za-z]+|#[0-9]+|#x[0-9A-Fa-f]+);",
            r"[0-9]+(?:[.,:/-][0-9]+)*",
        ]
    )
)
_ANY_DIGITS_RE = re.compile(r"\d+")  # Unicode-aware: catches १२३ as well as 123
_VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "param", "source", "track", "wbr",
}
# Inline elements a translation may move within the sentence (word order).
_INLINE_TAGS = {
    "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "font", "i",
    "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time",
    "u", "var",
}


def mask_website_text(value: str) -> Tuple[str, Dict[str, str]]:
    """mask_protected's spans plus the website spans ({word} text-pattern
    placeholders, comments, style/script/pre/code elements, tags, URLs, emails,
    entities, digit runs), each as a __PH_n__ token, in one pass — every token
    stands for source text, none for another token. Returns (masked, token →
    original); undo with restore_website_tokens."""
    mapping: Dict[str, str] = {}

    def _sub(match: "re.Match[str]") -> str:
        token = f"__PH_{len(mapping)}__"
        mapping[token] = match.group(0)
        return token

    return _WEBSITE_MASK_RE.sub(_sub, value), mapping


def restore_website_tokens(masked: str, mapping: Dict[str, str]) -> str:
    """Puts every token back in one pass, so restored text is never scanned
    again (a source that itself contains '__PH_3__' comes back as written)."""
    return _WEBSITE_TOKEN_RE.sub(lambda m: mapping.get(m.group(0), m.group(0)), masked)


def _tags_balanced(sequence: List[str]) -> bool:
    stack: List[str] = []
    for tag in sequence:
        if tag.startswith("/"):
            if not stack or stack[-1] != tag[1:]:
                return False
            stack.pop()
        elif tag not in _VOID_TAGS:
            stack.append(tag)
    return not stack


def _same_markup(source: str, translated: str) -> bool:
    src = tag_sequence(source)
    out = tag_sequence(translated)
    if src == out:
        return True
    if sorted(src) != sorted(out) or not _tags_balanced(src) or not _tags_balanced(out):
        return False
    block = lambda seq: [t for t in seq if t.lstrip("/") not in _INLINE_TAGS]  # noqa: E731
    return block(src) == block(out)


def website_translation_problem(source: str, translated: str) -> Optional[str]:
    """None when `translated` is safe to show in place of `source`; otherwise why not.
    Checks the restored text: markup, numbers and {word} placeholders. (Token checks
    happen before restore; these also screen remembered translations.)"""
    if not isinstance(translated, str) or not translated.strip():
        return "the translation is empty"
    if not _same_markup(source, translated):
        return "the HTML markup changed"
    if sorted(_ANY_DIGITS_RE.findall(source)) != sorted(_ANY_DIGITS_RE.findall(translated)):
        return "the numbers changed"
    if sorted(_WEBSITE_TEXT_PLACEHOLDER_RE.findall(source)) != sorted(
        _WEBSITE_TEXT_PLACEHOLDER_RE.findall(translated)
    ):
        return "the {placeholders} changed"
    return None


def _restore_website_translation(source: str, masked_out: Any, mapping: Dict[str, str]) -> Tuple[Optional[str], Optional[str]]:
    """(restored text, None) or (None, reason)."""
    if not isinstance(masked_out, str) or not masked_out.strip():
        return None, "the AI returned no translation"
    for token in mapping:
        if masked_out.count(token) != 1:
            return None, "a protected part (markup, link, number or placeholder) was dropped or repeated"
    stray = _WEBSITE_TOKEN_RE.findall(masked_out)
    if any(token not in mapping for token in stray):
        return None, "the AI invented a placeholder"
    restored = restore_website_tokens(masked_out, mapping)
    problem = website_translation_problem(source, restored)
    if problem:
        return None, problem
    # Keep the source's own surrounding whitespace (the dictionary key is exact).
    lead = source[: len(source) - len(source.lstrip())]
    trail = source[len(source.rstrip()):]
    return f"{lead}{restored.strip()}{trail}", None


def _build_website_batch_prompt(
    payload: Dict[str, str],
    source_locale: str,
    target_locale: str,
    glossary_lines: List[str],
) -> str:
    src = LOCALE_NAMES.get(source_locale, source_locale)
    tgt = LOCALE_NAMES.get(target_locale, target_locale)
    glossary_block = (
        "GLOSSARY (hard constraints):\n" + "\n".join(glossary_lines) + "\n"
        if glossary_lines
        else ""
    )
    return f"""You translate the text of an education institute's WEBSITE from {src} to {tgt}.
Translate every value in the JSON object below.

RULES:
1. Return the SAME keys; translate the values only. Every value stays one string.
2. Tokens like __PH_0__ stand for markup, links, numbers or placeholders. Copy every token
   EXACTLY once, unchanged, where it belongs in the {tgt} sentence. Never translate, drop,
   merge or invent tokens.
3. Write natural, fluent {tgt} website copy: headings stay short, buttons stay short, keep
   the tone of the original.
4. Keep brand names, people's names and exam or course codes (NEET, JEE, UPSC) as they are.
5. Do not add quotes, notes or explanations.
{glossary_block}
Return ONLY a JSON object with the same keys.

TEXTS:
{json.dumps(payload, ensure_ascii=False, indent=2)}"""


def _website_batches(
    items: List[Tuple[str, str, Dict[str, str]]],
) -> Tuple[List[Tuple[str, str, Dict[str, str]]], List[List[Tuple[str, str, Dict[str, str]]]]]:
    """(texts that get a call of their own, batches of the rest)."""
    singles = [it for it in items if len(it[1]) > WEBSITE_LONG_CHARS]
    batches: List[List[Tuple[str, str, Dict[str, str]]]] = []
    current: List[Tuple[str, str, Dict[str, str]]] = []
    chars = 0
    for it in items:
        if len(it[1]) > WEBSITE_LONG_CHARS:
            continue
        if current and (len(current) >= WEBSITE_BATCH_ITEMS or chars + len(it[1]) > WEBSITE_BATCH_CHARS):
            batches.append(current)
            current, chars = [], 0
        current.append(it)
        chars += len(it[1])
    if current:
        batches.append(current)
    return singles, batches


async def lookup_website_memory(
    *,
    strings: List[str],
    source_locale: str,
    target_locale: str,
    institute_id: Optional[str],
) -> Dict[str, str]:
    """Remembered translations (translation memory) of `strings` that still
    pass the website checks, keyed by the exact source. Free to serve — the
    route pre-flights credits on the texts NOT found here."""
    def _lookup_all() -> Dict[str, str]:
        hits: Dict[str, str] = {}
        with db_session() as db:
            for s in strings:
                cached = tm_lookup(db, institute_id, source_locale, target_locale, sha256_text(s))
                if cached is not None:
                    hits[s] = cached
        return hits

    try:
        memory = await asyncio.to_thread(_lookup_all)
    except Exception as exc:  # noqa: BLE001 — memory is an optimisation, never a failure
        logger.warning("Website TM lookup failed: %s", exc)
        return {}
    # A remembered translation still has to pass the website checks.
    return {s: t for s, t in memory.items() if website_translation_problem(s, t) is None}


async def translate_website_strings(
    *,
    strings: List[str],
    source_locale: str,
    target_locale: str,
    institute_id: Optional[str],
    use_memory: bool = True,
    memory: Optional[Dict[str, str]] = None,
    preferred_model: Optional[str] = None,
) -> Dict[str, Any]:
    """Translate website texts, translation memory first (domain WEBSITE; skip
    with use_memory=False, or pass the result of lookup_website_memory as
    `memory`), the rest through the LLM in parallel chunks.

    Does NOT bill: the caller charges once per request from `usage` and
    `llm_chars`. Returns {translations: {source: text}, failed: [{source,
    reason}], tm_hits, model_used, usage: {prompt_tokens, completion_tokens},
    llm_chars, llm_calls, completed_calls}.
    """
    results: Dict[str, str] = {}
    failed: List[Dict[str, str]] = []
    pending: List[str] = []
    tm_hits = 0

    if memory is None:
        memory = (
            await lookup_website_memory(
                strings=strings,
                source_locale=source_locale,
                target_locale=target_locale,
                institute_id=institute_id,
            )
            if use_memory
            else {}
        )

    for s in strings:
        cached = memory.get(s)
        # A remembered translation still has to pass the website checks.
        if cached is not None and website_translation_problem(s, cached) is None:
            results[s] = cached
            tm_hits += 1
        else:
            pending.append(s)

    usage_total = {"prompt_tokens": 0, "completion_tokens": 0}
    model_used: Optional[str] = None
    llm_chars = 0
    llm_calls = 0
    completed_calls = 0
    fresh: List[Tuple[str, str]] = []

    if pending:
        def _prep() -> Tuple[List[str], List[str]]:
            with db_session() as db:
                primary, fallbacks = resolve_models(db, "translation", preferred_model)
                glossary = build_glossary_lines(db, institute_id, target_locale)
            return [primary, *fallbacks], glossary

        models, glossary_lines = await asyncio.to_thread(_prep)
        prepared = [(s, *mask_website_text(s)) for s in pending]
        singles, batches = _website_batches(prepared)
        semaphore = asyncio.Semaphore(WEBSITE_LLM_CONCURRENCY)

        def _account(model: str, usage: Optional[Dict[str, int]], chars: int) -> None:
            nonlocal model_used, llm_chars, completed_calls
            completed_calls += 1
            model_used = model_used or model
            llm_chars += chars
            for k in usage_total:
                usage_total[k] += int((usage or {}).get(k) or 0)

        def _accept(source: str, masked_out: Any, mapping: Dict[str, str]) -> None:
            restored, reason = _restore_website_translation(source, masked_out, mapping)
            if restored is None:
                failed.append({"source": source, "reason": reason or "rejected"})
            else:
                results[source] = restored
                fresh.append((source, restored))

        async def _call(prompt: str, label: str) -> Tuple[Any, str, Dict[str, int]]:
            async with semaphore:
                raw_json, model, usage = await generate_json(prompt, models, label=label)
            return json.loads(raw_json), model, usage

        async def _one(item: Tuple[str, str, Dict[str, str]]) -> None:
            source, masked, mapping = item
            try:
                data, model, usage = await _call(
                    _build_item_prompt(masked, source_locale, target_locale, glossary_lines),
                    "page-translate:item",
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Website translation call failed (single): %s", exc)
                failed.append({"source": source, "reason": "the AI call failed"})
                return
            _account(model, usage, len(source))
            _accept(source, data.get("translation") if isinstance(data, dict) else None, mapping)

        async def _batch(batch: List[Tuple[str, str, Dict[str, str]]]) -> None:
            payload = {f"s{i}": masked for i, (_, masked, _) in enumerate(batch)}
            try:
                data, model, usage = await _call(
                    _build_website_batch_prompt(payload, source_locale, target_locale, glossary_lines),
                    "page-translate:batch",
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Website translation call failed (batch of %d): %s", len(batch), exc)
                failed.extend({"source": s, "reason": "the AI call failed"} for s, _, _ in batch)
                return
            _account(model, usage, sum(len(s) for s, _, _ in batch))
            for i, (source, _, mapping) in enumerate(batch):
                _accept(source, data.get(f"s{i}") if isinstance(data, dict) else None, mapping)

        llm_calls = len(singles) + len(batches)
        await asyncio.gather(*(_one(it) for it in singles), *(_batch(b) for b in batches))

    if fresh:
        def _persist() -> None:
            with db_session() as db:
                for source, translated in fresh:
                    tm_write(
                        db,
                        institute_id=institute_id,
                        source_locale=source_locale,
                        target_locale=target_locale,
                        source_hash=sha256_text(source),
                        source_text_value=source,
                        target_text_value=translated,
                        domain=WEBSITE_TM_DOMAIN,
                    )

        try:
            await asyncio.to_thread(_persist)
        except Exception:  # noqa: BLE001
            logger.warning("Website TM write failed", exc_info=True)

    order = {s: i for i, s in enumerate(strings)}
    failed.sort(key=lambda f: order.get(f["source"], len(order)))
    return {
        "translations": {s: results[s] for s in strings if s in results},
        "failed": failed,
        "tm_hits": tm_hits,
        "model_used": model_used,
        "usage": usage_total,
        "llm_chars": llm_chars,
        "llm_calls": llm_calls,
        "completed_calls": completed_calls,
    }
