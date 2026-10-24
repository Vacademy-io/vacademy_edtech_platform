"""
Tool Cost Estimator — parametric, predictable credit estimates for AI tools.

This is the *single source of truth* shared by:
  • the cost PREVIEW the admin sees before running a tool ("≈ N credits"), and
  • (Phase 2) the floor of the actual charge — the deduction is
    `max(parametric_estimate, actual_token_cost)`, so the user is never
    charged below the previewed number.

Unlike `CreditService.calculate_credits` (which converts real model USD token
cost → credits), this estimator computes credits *directly* from a small set of
user-controlled inputs (number of questions, audio minutes, transcript length,
lecture toggles). That makes the number stable and explainable — "10 questions
= 10 credits" — which is exactly what the preview UI wants.

Rates are DB-tunable via the `ai_tool_pricing` table (created by an admin_core
Flyway migration). If the table is missing/empty (pre-migration environments),
we fall back to `DEFAULT_TOOL_PRICING` below — the same pattern as
`CreditService._get_pricing` / `DEFAULT_PRICING`.
"""
from __future__ import annotations

import json
import logging
from decimal import Decimal, ROUND_CEILING
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# ============================================================================
# Default parametric rates (fallback if `ai_tool_pricing` table not seeded).
#
# All numbers are in CREDITS (not USD). `request_type` is the bucket the
# Phase-2 deduction records on `credit_transactions.request_type`.
#
def _slab_credits(slabs: list, count: int) -> Decimal:
    """Price of `count` units under a slab table; the last slab (upto null)
    catches everything above the ceilings."""
    for slab in slabs:
        upto = slab.get("upto") if isinstance(slab, dict) else None
        if upto is None or count <= int(upto):
            return _d((slab or {}).get("credits"))
    return _d(slabs[-1].get("credits")) if isinstance(slabs[-1], dict) else Decimal("0")


# unit_field drives the formula:
#   "questions"     → flat_base + num_questions × per_unit
#                     (+ num_questions × params.image_unit_credits if images)
#   "audio_minutes" → flat_base + minutes × per_unit  (minutes from
#                     duration_seconds or audio_minutes), floored at params.min_credits
#   "chars"         → flat_base + ceil(transcript_chars / params.chars_per_unit) × per_unit
#   "images"        → flat_base + num_images × per_unit
#   "flat"          → flat_base (+ params.questions_add / homework_add toggles)
# ============================================================================
DEFAULT_TOOL_PRICING: Dict[str, Dict[str, Any]] = {
    "assessment": {
        "request_type": "assessment",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("1"),
        "unit_field": "questions",
        "params": {"image_unit_credits": "0.5"},
    },
    # AI evaluation of one uploaded answer copy (copy-check): OCR + per-question
    # rubric-grounded grading. Priced per copy as flat + per graded question so
    # the quote is known before upload; the actual charge is
    # max(this, real token cost), so premium models (Opus/GPT) add overage on
    # long answers while flash copies stay at the quoted rate.
    #
    # THE LIVE RATE IS THE `copy_check_evaluation` ROW IN ai_tool_pricing —
    # change prices there (no release); this entry is only the fallback for an
    # environment without that row and must mirror it (set 2026-09-21: the old
    # 0 + 1/question made a 64-question one-word paper cost 64 credits/copy).
    "copy_check_evaluation": {
        "request_type": "evaluation",
        "flat_base_credits": Decimal("1"),
        "per_unit_credits": Decimal("0.2"),
        "unit_field": "questions",
        "params": {},
    },
    # AI evaluation through the partner API (spec 10.1): a FIXED price per
    # page of the graded handwritten copy (the evalezy.com price), and for a
    # typed attempt `typed_per_answer` per non-blank long answer. fixed_price
    # = the quote is the charge, no real-token overage. The live default is
    # the `copy_check_evaluation_api` row in ai_tool_pricing (admin_core V545
    # seeds it); a partner's own price is an institute_tool_pricing row.
    "copy_check_evaluation_api": {
        "request_type": "evaluation",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("1"),
        "unit_field": "pages",
        "params": {"fixed_price": True, "typed_per_answer": 1},
    },
    # Vsmart Extract: digitising an EXISTING paper (mode=extract on
    # pdf-to-questions). A digital PDF is read locally for free, so the only
    # cost is the model (≈ ₹3 for a 60-question paper with solutions) — priced
    # flat + per question actually extracted; the charge is max(this, real
    # token cost). Mirrors ai_tool_pricing row `extract_questions` (V527) —
    # tune the DB row, not this.
    "extract_questions": {
        "request_type": "pdf_questions",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "questions",
        # One price per band of questions (model cost ≈ ₹0.5 for 40 questions,
        # ₹1.2 for 60 with solutions). Tune the DB row's params_json.
        "params": {"slabs": [
            {"upto": 20, "credits": "2"},
            {"upto": 50, "credits": "3"},
            {"upto": 100, "credits": "5"},
            {"upto": None, "credits": "7"},
        ]},
    },
    # …and only when the file had no text layer (a scan) and went through
    # MathPix OCR, which bills per page: a surcharge covering that cost.
    "extract_questions_ocr": {
        "request_type": "pdf_questions",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("0.5"),
        "unit_field": "pages",
        "params": {},
    },
    "coding_question": {
        # One AI-authored coding question (problem + test cases + starter code
        # per language + a reference solution). A single LLM call — priced flat
        # for predictable, FE/BE-identical estimates. Tunable via ai_tool_pricing.
        "request_type": "coding_question",
        "flat_base_credits": Decimal("4"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    "transcription": {
        "request_type": "transcription",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("0.5"),
        "unit_field": "audio_minutes",
        "params": {"min_credits": "2"},
    },
    "notes": {
        "request_type": "notes",
        "flat_base_credits": Decimal("3"),
        "per_unit_credits": Decimal("1"),
        "unit_field": "chars",
        "params": {"chars_per_unit": "2000"},
    },
    "lecture": {
        "request_type": "lecture",
        "flat_base_credits": Decimal("4"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {"questions_add": "2", "homework_add": "2"},
    },
    # ---- AI course creation (copilot) ------------------------------------
    # One outline generation = one large LLM call authoring the whole course
    # tree. Charged as max(flat, actual token cost).
    "course_outline": {
        "request_type": "outline",
        "flat_base_credits": Decimal("2"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # Per-slide content generation charges. AI_VIDEO / AI_SLIDES /
    # AI_STORYBOOK slides are NOT covered by these — the video pipeline
    # already meters their actual usage (video/tts/image/stock).
    "course_slide_document": {
        "request_type": "content",
        "flat_base_credits": Decimal("1"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    "course_slide_assessment": {
        "request_type": "content",
        "flat_base_credits": Decimal("1"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # YouTube search (VIDEO) or search + code example (VIDEO_CODE).
    "course_slide_video": {
        "request_type": "content",
        "flat_base_credits": Decimal("1"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # HTML Document slide AI authoring — one large creative-HTML LLM call
    # (see _DEFAULT_MODEL in routers/html_document.py, up to ~32k output
    # tokens), flat per call, charged as
    # max(flat, actual). A full CREATE costs more than a conversational EDIT
    # (which reuses the existing page), so they are priced separately.
    # AI engagement planner — ONE structured call drafts a whole run of daily
    # tasks (questions, polls, prompts, readings, flashcard decks). Priced by
    # size: base + per task, where tasks = days × tasks per day. The preview
    # quotes the tasks REQUESTED (params.num_questions — the "questions" unit,
    # which the admin's local cost mirror already understands); the charge uses
    # the tasks DELIVERED, as max(estimate, actual × markup). The usual week at
    # 2 a day (14 tasks) stays 10 credits; one day of 3 is 5; a month of 3 a
    # day is 50. Readings come back with image placeholders only; pictures are
    # a separate opt-in charge (html_document_image) so a fortnight of
    # illustrated pages is never billed before the teacher has reviewed it.
    "engagement_plan": {
        "request_type": "content",
        "flat_base_credits": Decimal("3"),
        "per_unit_credits": Decimal("0.5"),
        "unit_field": "questions",
        "params": {},
    },
    # Regenerate ONE task inside a draft (any type, a flashcards deck included)
    # — a small call, priced so a teacher can
    # reject and retry a few items without it costing as much as the plan.
    "engagement_item": {
        "request_type": "content",
        "flat_base_credits": Decimal("2"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    "html_document": {          # first generation (create)
        "request_type": "content",
        "flat_base_credits": Decimal("15"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    "html_document_edit": {     # conversational edit of an existing page
        "request_type": "content",
        "flat_base_credits": Decimal("3"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # Per-page surcharge for grounding an HTML doc in an uploaded PDF (MathPix
    # conversion cost). Charged as num_pages × per_unit, on top of the
    # generation charge — deters dumping very large PDFs.
    "html_document_pdf": {
        "request_type": "content",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("0.5"),
        "unit_field": "pages",
        "params": {},
    },
    # Per generated textbook illustration on an HTML doc page (real image-model
    # spend). Charged as num_images × per_unit for the pictures that actually
    # came back, on top of the generation charge.
    "html_document_image": {
        "request_type": "image",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("2"),
        "unit_field": "images",
        "params": {},
    },
    # AI Page Builder — one wizard run composes a full catalogue page as
    # schema-bound JSON (one large LLM call + validation/repair round-trips).
    # Charged as max(flat, actual token cost).
    #
    # PRICED ON VALUE, NOT TOKENS (2026-07-29): the old 10-credit flat was ~₹6
    # for a themed, CRM-connected, SEO-served page — cheaper than a cup of
    # chai for something an institute would otherwise pay a freelancer tens of
    # thousands and three weeks for. That reads as worthless to a first-time
    # buyer, and made regenerating feel free while costing real tokens. 100
    # credits (~₹58/page) is still a rounding error against the alternative.
    "page_generate": {
        "request_type": "content",
        "flat_base_credits": Decimal("100"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # AI Page Builder copilot — one conversational edit returns a small op list
    # (insert/update/remove/move) against the current page. Cheaper than a full
    # generate (reuses the existing page as context, smaller output).
    # One conversational edit. Raised with generate (2026-07-29) to keep the
    # ratio sane: an edit is ~1/7th of a full page build, not 1/3rd.
    "page_edit": {
        "request_type": "content",
        "flat_base_credits": Decimal("15"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # AI Page Builder assistive intake — one chat turn of the website
    # interview (small vision-capable call). Cheap so a 6-8 turn interview
    # costs less than the generate it feeds.
    "page_intake": {
        "request_type": "content",
        "flat_base_credits": Decimal("1"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # AI Page Builder brand kit — one small LLM call proposing 2-3 ThemePacks
    # (color/atmosphere/fonts) from the institute's brand. Cheap.
    "page_brand_kit": {
        "request_type": "content",
        "flat_base_credits": Decimal("2"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # AI Page Builder site languages — translate a batch of site texts
    # (POST /page-builder/v1/translate). Priced like translate_strings: per 100
    # characters actually sent to the model (translation-memory hits are free),
    # charged once per request; the estimate floors at one whole credit.
    "page_translate": {
        "request_type": "translation",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("0.01"),
        "unit_field": "chars",
        "params": {"chars_per_unit": "100"},
    },
    # ---- Content translation (i18n Phase 1, V384) --------------------------
    # Ops-tunable placeholders — MUST agree with the V384 ai_tool_pricing seeds.
    # TM (translation_memory) hits are free; only LLM-translated items bill.
    "translate_rich_text": {   # per rich-text / entity-field item (per 100 chars)
        "request_type": "translation",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("0.02"),
        "unit_field": "chars",
        "params": {"chars_per_unit": "100"},
    },
    "translate_question": {    # per question (future per-question endpoint)
        "request_type": "translation",
        "flat_base_credits": Decimal("0.3"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    "translate_course": {      # whole-course job base (backs the 402 preflight)
        "request_type": "translation",
        "flat_base_credits": Decimal("25"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    "translate_strings": {     # synchronous UI/notification batch (per 100 chars of misses)
        "request_type": "translation",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("0.01"),
        "unit_field": "chars",
        "params": {"chars_per_unit": "100"},
    },
    "dub_video": {             # audio dubbing per minute (no code path yet — later wave)
        "request_type": "translation",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("3.0"),
        "unit_field": "audio_minutes",
        "params": {},
    },
    # ---- Knowledge Base (V435) ---------------------------------------------
    # MUST agree with the V435 ai_tool_pricing seeds AND computeToolCredits in
    # frontend-admin-dashboard/src/services/ai-credits/get-ai-credits.ts.
    #
    # Per ingested page: covers parse (free PyMuPDF for digital pages, paid
    # MathPix OCR only for scanned ones), figure extraction + S3 re-host,
    # chunking, embedding and the summary tree. 0.5 cr/page ≈ ₹0.29 against
    # ~₹0.26 real cost on a scanned regional-language book, and far above cost
    # on a digital English one — so the digital majority subsidises the
    # expensive scans rather than every scan being individually penalised.
    "kb_ingest_page": {
        "request_type": "knowledge_base",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("0.5"),
        "unit_field": "pages",
        "params": {},
    },
    # One web page or YouTube transcript — scrape/fetch + embed, no OCR, so page
    # count is meaningless and this is flat. (YouTube captions come from the
    # shared caption service, services/youtube_captions; its proxy / Supadata
    # cost is a platform cost and is not passed through here.)
    "kb_ingest_url": {
        "request_type": "knowledge_base",
        "flat_base_credits": Decimal("2"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # One grounded, cited question against a KB. Deliberately cheap: this is how
    # an admin learns whether the corpus is any good, and metering it heavily
    # would suppress exactly the behaviour that builds trust in the feature.
    "kb_ask": {
        "request_type": "knowledge_base",
        "flat_base_credits": Decimal("1"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # ---- KB companions for learners (V535) ----------------------------------
    # The institute pays; lessons and practice sets are compiled once per topic
    # and shared by every learner, so only Ask and uncached speech are per-learner.
    # MUST agree with the V535 seeds and FE computeToolCredits.
    "kb_companion_lesson": {
        "request_type": "knowledge_base",
        "flat_base_credits": Decimal("5"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    "kb_companion_practice": {
        "request_type": "knowledge_base",
        "flat_base_credits": Decimal("2"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    "kb_companion_ask": {
        "request_type": "knowledge_base",
        "flat_base_credits": Decimal("1"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    "kb_companion_speech": {
        "request_type": "knowledge_base",
        "flat_base_credits": Decimal("1"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # Site Assistant (public website chatbot): exactly 1 credit per produced
    # answer, never a token overage (PRD: "1 credit per answer"). request_type
    # 'chatbot' is already in the ai_token_usage CHECK (V501).
    "site_assistant_answer": {
        "request_type": "chatbot",
        "flat_base_credits": Decimal("1"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {"fixed_price": True},
    },
    # ---- Question papers from a knowledge base (V441) -----------------------
    # request_type 'assessment' is already in the ai_token_usage CHECK — reusing
    # it avoids another DROP+ADD of that constraint (the V325/V435 trap).
    # MUST agree with the V441 seeds and FE computeToolCredits.
    "kb_paper_blueprint": {
        "request_type": "assessment",
        "flat_base_credits": Decimal("2"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # Priced per question so the preview reads "60 questions ≈ 95 credits".
    # flat_base covers retrieval + the post-generation validation pass.
    "kb_paper_questions": {
        "request_type": "assessment",
        "flat_base_credits": Decimal("5"),
        "per_unit_credits": Decimal("1.5"),
        "unit_field": "questions",
        "params": {},
    },
    "kb_paper_regenerate": {
        "request_type": "assessment",
        "flat_base_credits": Decimal("2"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # A question paper PDF (the one a teacher attaches to an offline test) read
    # into real questions with marks, so an uploaded answer sheet can be checked
    # question by question. Priced like the other PDF reads: per page for the
    # MathPix pass, plus a flat base for the extraction call(s). Charged only
    # when questions actually come back.
    "paper_digitise": {
        "request_type": "assessment",
        "flat_base_credits": Decimal("2"),
        "per_unit_credits": Decimal("0.5"),
        "unit_field": "pages",
        "params": {},
    },
    # One-time, permanent unlock of a curated library (V445). Deliberately low:
    # nothing in the catalogue can be sampled before purchase, so the first
    # unlock is bought on faith. Keep in sync with the V445 seed and with
    # computeToolCredits on the frontend.
    "kb_library_unlock": {
        "request_type": "knowledge_base",
        "flat_base_credits": Decimal("50"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # ── Course knowledge (V600) ───────────────────────────────────────────
    # Paid reading of course lessons into the institute's course knowledge
    # base: scanned pages and image-only slides (OCR, per page); uploaded video
    # and audio minutes (transcription, per started minute, min 1 credit).
    # Text content is free. Fixed price: the quote shown before "Process" is
    # what is charged. Keep in sync with the V600 ai_tool_pricing seed.
    "course_kb_ocr_page": {
        "request_type": "knowledge_base",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("0.5"),
        "unit_field": "pages",
        "params": {"fixed_price": True},
    },
    "course_kb_transcribe_minute": {
        "request_type": "transcription",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("0.5"),
        "unit_field": "audio_minutes",
        "params": {"fixed_price": True, "min_credits": "1"},
    },
    # ── Live AI tutor (V494) ──────────────────────────────────────────────
    # One strong-model compile call per slide, charged as max(flat, actual).
    # Reuses request_type 'content' so no ai_token_usage CHECK change is needed.
    # Prepared voice: every spoken line of a compiled slide synthesised once
    # per language (cost review 2026-09-07). Measured on prod: ~5,000
    # characters per slide per language (narration, recap, questions, hints,
    # predict prompts and the fixed lines) ≈ $0.13 on Smallest; charged 15
    # credits per slide per language, one time.
    "tutor_voice_prepare": {
        "request_type": "tts_premium",
        "flat_base_credits": Decimal("15"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # Premium teacher avatar (Spatius): per started lesson minute while the
    # avatar is on, on top of tutor_live_minute. Vendor ≈ $0.0072/min.
    "tutor_avatar_minute": {
        "request_type": "conversation",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("1"),
        "unit_field": "audio_minutes",
        "params": {"min_credits": "0"},
    },
    # Custom teacher assets, charged once to the institute (owner decision
    # 2026-09-07): a cloned voice when the clone is made; an animated avatar
    # when the request is fulfilled (Spatius Studio today, API later).
    "tutor_voice_clone": {
        "request_type": "tts_premium",
        "flat_base_credits": Decimal("200"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    "tutor_avatar_create": {
        "request_type": "conversation",
        "flat_base_credits": Decimal("1000"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    "tutor_compile_slide": {
        "request_type": "content",
        "flat_base_credits": Decimal("2"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # Charged once per generated image (one charge per media row), so it stays
    # a flat rate rather than needing an 'images' unit.
    "tutor_media_image": {
        "request_type": "image",
        "flat_base_credits": Decimal("1"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {},
    },
    # Voice lessons: one charge per started minute (TTS + STT + the turn
    # overhead), keyed tutor_live:{session}:{minute}. Text lessons bill per
    # decision turn instead. Rate lives on the ai_tool_pricing row (V496).
    "tutor_live_minute": {
        "request_type": "conversation",
        "flat_base_credits": Decimal("0"),
        "per_unit_credits": Decimal("3"),
        "unit_field": "audio_minutes",
        "params": {"min_credits": 0},
    },
    # One AI-written analysis per ASSESSMENT, charged once; the stored report is
    # re-downloadable free afterwards. assessment_service sends zero token
    # counts so max(parametric, actual) resolves to exactly this flat number —
    # the teacher is quoted a price and billed that price. Rate also lives on
    # the ai_tool_pricing row (admin_core V500); this entry is the half that
    # must never be missing, because without it estimate-tool 400s, the FE
    # badge renders nothing and `sufficient` stays null (which reads as
    # "allowed"), so the report generates and nobody is charged.
    "assessment_class_ai_report": {
        "request_type": "assessment",
        "flat_base_credits": Decimal("10"),
        "per_unit_credits": Decimal("0"),
        "unit_field": "flat",
        "params": {"min_credits": 0},
    },
}

# Tool keys this estimator knows about (used for validation / FE discovery).
KNOWN_TOOLS = tuple(DEFAULT_TOOL_PRICING.keys())

# The partner API's evaluation key (spec 10.1). Always charged at a fixed price.
COPY_CHECK_API_TOOL_KEY = "copy_check_evaluation_api"

# rate_source values (spec 10.3), written into the credit transaction
# description so reconciliation can tell which price a charge used.
RATE_SOURCE_DEFAULT = "default"
RATE_SOURCE_GLOBAL = "global"
RATE_SOURCE_SNAPSHOT = "snapshot"
OVERRIDE_PREFIX = "override:"


def _truthy(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def is_fixed_price(tool_key: str, pricing: Dict[str, Any]) -> bool:
    """True when the charge must be exactly the parametric quote, with no
    real-token overage: `params.fixed_price` / `params.no_token_overage` on the
    resolved row, `no_token_overage` on an institute override, and always for
    the partner API key (spec 10.3)."""
    if tool_key == COPY_CHECK_API_TOOL_KEY:
        return True
    params = pricing.get("params") or {}
    return (
        _truthy(params.get("fixed_price"))
        or _truthy(params.get("no_token_overage"))
        or _truthy(pricing.get("no_token_overage"))
    )


def _d(value: Any, default: str = "0") -> Decimal:
    """Coerce mixed JSON/None/number values to Decimal safely."""
    if value is None:
        return Decimal(default)
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


def _ceil_whole(value: Decimal) -> Decimal:
    """Round UP to a whole credit so the headline number stays clean ("5", "28")."""
    return value.quantize(Decimal("1"), rounding=ROUND_CEILING)


def _json_dict(value: Any) -> Dict[str, Any]:
    """params_json as a dict, whether the driver returned JSONB parsed or as text."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return {}
    return dict(value) if isinstance(value, dict) else {}


def apply_override(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """The global/default rate with an institute override laid over it: each
    non-null override field replaces the global value; override params are
    merged over the global params key by key (so a partner price that sets
    only a per-page rate keeps the row's fixed_price / typed_per_answer)."""
    out = dict(base)
    if override.get("flat_base_credits") is not None:
        out["flat_base_credits"] = _d(override["flat_base_credits"])
    if override.get("per_unit_credits") is not None:
        out["per_unit_credits"] = _d(override["per_unit_credits"])
    if override.get("params") is not None:
        out["params"] = {**(base.get("params") or {}), **(override.get("params") or {})}
    out["no_token_overage"] = bool(override.get("no_token_overage"))
    out["override_id"] = override.get("id")
    out["rate_source"] = f"{OVERRIDE_PREFIX}{override.get('id')}"
    return out


def _usable_snapshot(tool_key: str, snapshot: Any) -> Optional[Dict[str, Any]]:
    """The snapshot as a dict when it prices this tool, else None (a pydantic
    model is accepted too)."""
    if snapshot is None:
        return None
    if hasattr(snapshot, "model_dump"):
        snapshot = snapshot.model_dump()
    if not isinstance(snapshot, dict):
        return None
    snap_key = snapshot.get("tool_key")
    if snap_key and snap_key != tool_key:
        logger.warning("rate_snapshot for %s ignored when pricing %s", snap_key, tool_key)
        return None
    return snapshot


def rate_snapshot_of(tool_key: str, pricing: Dict[str, Any]) -> Dict[str, Any]:
    """The resolved rate in the grade request's `rate_snapshot` shape (spec
    10.3, C4): what a caller stores at enqueue and sends back at completion so
    the charge uses this quote. An override's no_token_overage travels in
    params, the only place the snapshot has for it."""
    params = dict(pricing.get("params") or {})
    if pricing.get("no_token_overage"):
        params["no_token_overage"] = True
    return {
        "tool_key": tool_key,
        "flat_base_credits": float(_d(pricing.get("flat_base_credits"))),
        "per_unit_credits": float(_d(pricing.get("per_unit_credits"))),
        "unit_field": pricing.get("unit_field"),
        "params": params,
        "rate_source": pricing.get("rate_source") or RATE_SOURCE_DEFAULT,
    }


def apply_snapshot(base: Dict[str, Any], snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """The rate quoted at enqueue replaces the resolved rate. The snapshot's
    params are the full resolved params at that time, so they replace (not
    merge into) today's. request_type, and unit_field when the snapshot has
    none, come from the resolved row."""
    out = dict(base)
    out["flat_base_credits"] = _d(snapshot.get("flat_base_credits"))
    out["per_unit_credits"] = _d(snapshot.get("per_unit_credits"))
    if snapshot.get("unit_field"):
        out["unit_field"] = snapshot["unit_field"]
    out["params"] = dict(snapshot.get("params") or {})
    out["no_token_overage"] = _truthy(out["params"].get("no_token_overage"))
    out["rate_source"] = snapshot.get("rate_source") or RATE_SOURCE_SNAPSHOT
    return out


class ToolCostEstimator:
    """Computes predictable parametric credit estimates for AI tools."""

    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------
    # Rate resolution (institute override → DB global → code default)
    # ------------------------------------------------------------------
    def get_tool_pricing(
        self,
        tool_key: Optional[str] = None,
        institute_id: Optional[str] = None,
    ) -> Dict[str, Dict[str, Any]]:
        """Return active parametric rates, keyed by tool_key.

        Resolution (spec 10.3): the institute's open `institute_tool_pricing`
        row for the exact tool_key (its non-null fields replace the global
        values) → the global `ai_tool_pricing` row → DEFAULT_TOOL_PRICING.
        Without `institute_id` this is the global rate card, as before. Pass a
        tool_key to fetch just one (still merged with the fallback).

        Every entry carries `rate_source`: "override:<id>", "global" or
        "default"; an overridden entry also carries `override_id` and
        `no_token_overage`.
        """
        rows_by_key: Dict[str, Dict[str, Any]] = {}
        try:
            query = text(
                """
                SELECT tool_key, request_type, flat_base_credits, per_unit_credits,
                       unit_field, params_json
                FROM ai_tool_pricing
                WHERE is_active = TRUE
                """
            )
            for row in self.db.execute(query).fetchall():
                rows_by_key[row.tool_key] = {
                    "request_type": row.request_type,
                    "flat_base_credits": _d(row.flat_base_credits),
                    "per_unit_credits": _d(row.per_unit_credits),
                    "unit_field": row.unit_field,
                    "params": _json_dict(row.params_json),
                    "rate_source": RATE_SOURCE_GLOBAL,
                }
        except Exception as exc:  # table missing in pre-migration envs
            logger.warning("ai_tool_pricing lookup failed (%s); using defaults", exc)

        merged: Dict[str, Dict[str, Any]] = {
            key: {**cfg, "rate_source": RATE_SOURCE_DEFAULT} for key, cfg in DEFAULT_TOOL_PRICING.items()
        }
        merged.update(rows_by_key)

        if institute_id:
            for key, override in self.institute_overrides(institute_id, tool_key).items():
                if key in merged:
                    merged[key] = apply_override(merged[key], override)

        if tool_key is not None:
            single = merged.get(tool_key)
            return {tool_key: single} if single else {}
        return merged

    def institute_overrides(
        self,
        institute_id: str,
        tool_key: Optional[str] = None,
    ) -> Dict[str, Dict[str, Any]]:
        """The institute's OPEN override rows (effective_to IS NULL), keyed by
        tool_key. Read inside a SAVEPOINT: on an environment without the table
        (ai_service deployed before admin_core V545) the failed statement must
        not abort the caller's transaction (charge_tool deducts on the same
        session right after). Any failure = no overrides."""
        sql = (
            "SELECT id, tool_key, flat_base_credits, per_unit_credits, params_json, no_token_overage "
            "FROM institute_tool_pricing "
            "WHERE institute_id = :institute_id AND effective_to IS NULL"
        )
        bind: Dict[str, Any] = {"institute_id": str(institute_id)}
        if tool_key is not None:
            sql += " AND tool_key = :tool_key"
            bind["tool_key"] = tool_key
        out: Dict[str, Dict[str, Any]] = {}
        try:
            with self.db.begin_nested():
                rows = self.db.execute(text(sql), bind).fetchall()
            for row in rows:
                out[row.tool_key] = {
                    "id": str(row.id),
                    "flat_base_credits": None if row.flat_base_credits is None else _d(row.flat_base_credits),
                    "per_unit_credits": None if row.per_unit_credits is None else _d(row.per_unit_credits),
                    "params": None if row.params_json is None else _json_dict(row.params_json),
                    "no_token_overage": bool(row.no_token_overage),
                }
        except Exception as exc:  # noqa: BLE001 - table missing / DB blip: global price applies
            logger.warning("institute_tool_pricing lookup failed for %s (%s); using global rates",
                           institute_id, exc)
        return out

    # ------------------------------------------------------------------
    # Estimation
    # ------------------------------------------------------------------
    def estimate(
        self,
        tool_key: str,
        params: Optional[Dict[str, Any]] = None,
        institute_id: Optional[str] = None,
        rate_snapshot: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Estimate the parametric credit cost of one tool invocation.

        `institute_id` applies that institute's override (spec 10.3).
        `rate_snapshot` - the rate quoted when the work was queued
        ({tool_key, flat_base_credits, per_unit_credits, unit_field, params,
        rate_source}) - replaces the resolved rate, so an edit made while the
        work waited never changes its price. A snapshot for another tool_key
        is ignored.

        Returns: {tool_key, request_type, estimated_credits (float),
                  breakdown: [{component, detail, credits}], unit_field,
                  rate_source, fixed_price}.
        Raises ValueError for an unknown tool_key.
        """
        params = params or {}
        pricing = self.get_tool_pricing(tool_key, institute_id=institute_id).get(tool_key)
        if not pricing:
            raise ValueError(f"Unknown tool_key '{tool_key}'. Known: {', '.join(KNOWN_TOOLS)}")
        snapshot = _usable_snapshot(tool_key, rate_snapshot)
        if snapshot is not None:
            pricing = apply_snapshot(pricing, snapshot)

        unit_field = pricing["unit_field"]
        flat_base = pricing["flat_base_credits"]
        per_unit = pricing["per_unit_credits"]
        extra = pricing.get("params", {}) or {}

        breakdown: List[Dict[str, Any]] = []
        total = Decimal("0")

        typed_per_answer = extra.get("typed_per_answer")
        if (str(params.get("answer_mode") or "").upper() == "TYPED"
                and typed_per_answer is not None):
            # A typed attempt has no pages (spec 10.1): credits = non-blank
            # long answers x typed_per_answer, nothing else.
            answers = max(0, int(params.get("num_answers") or 0))
            rate = _d(typed_per_answer)
            answer_credits = Decimal(answers) * rate
            total += answer_credits
            breakdown.append({
                "component": "answers",
                "detail": f"{answers} typed answer(s) × {rate}",
                "credits": float(answer_credits),
            })
            unit_field = "answers"
            return self._result(tool_key, pricing, unit_field, total, breakdown)

        if flat_base > 0:
            total += flat_base
            breakdown.append({"component": "base", "detail": "base cost", "credits": float(flat_base)})

        if unit_field == "questions":
            num_q = max(0, int(params.get("num_questions") or 0))
            slabs = extra.get("slabs")
            if isinstance(slabs, list) and slabs:
                # Range pricing: params.slabs = [{"upto": 20, "credits": 1.5},
                # {"upto": 50, "credits": 3}, …, {"upto": null, "credits": 6.5}]
                # — the first slab whose `upto` the count does not exceed
                # (null = no ceiling). One price per band, so a teacher knows
                # the cost of a 40-question paper before uploading it.
                q_credits = _slab_credits(slabs, num_q)
                total += q_credits
                breakdown.append({
                    "component": "questions",
                    "detail": f"{num_q} question(s), slab price",
                    "credits": float(q_credits),
                })
            else:
                q_credits = Decimal(num_q) * per_unit
                total += q_credits
                breakdown.append({
                    "component": "questions",
                    "detail": f"{num_q} question(s) × {per_unit}",
                    "credits": float(q_credits),
                })
            # Image add-on. An explicit `image_count` (charge time — the images
            # actually delivered) takes precedence; otherwise `include_images`
            # means "up to one per question", the preview upper bound. This is
            # why a preview can be slightly higher than the final charge: the LLM
            # only illustrates the questions it tags (and some may fail).
            img_unit = _d(extra.get("image_unit_credits"))
            if params.get("image_count") is not None:
                num_images = max(0, int(params.get("image_count") or 0))
            elif params.get("include_images"):
                num_images = num_q
            else:
                num_images = 0
            if num_images > 0 and img_unit > 0:
                img_credits = Decimal(num_images) * img_unit
                total += img_credits
                breakdown.append({
                    "component": "images",
                    "detail": f"{num_images} image(s) × {img_unit}",
                    "credits": float(img_credits),
                })

        elif unit_field == "audio_minutes":
            minutes = self._resolve_minutes(params)
            min_credits = _d(extra.get("min_credits"))
            raw = flat_base + (Decimal(str(minutes)) * per_unit)
            total = max(min_credits, raw)
            breakdown.append({
                "component": "audio",
                "detail": f"{minutes} min × {per_unit} (min {min_credits})",
                "credits": float(max(min_credits - flat_base, Decimal(str(minutes)) * per_unit)),
            })

        elif unit_field == "chars":
            chars = max(0, int(params.get("transcript_chars") or 0))
            divisor = _d(extra.get("chars_per_unit"), "2000")
            if divisor <= 0:
                divisor = Decimal("2000")
            units = (Decimal(chars) / divisor).quantize(Decimal("1"), rounding=ROUND_CEILING)
            char_credits = units * per_unit
            total += char_credits
            breakdown.append({
                "component": "length",
                "detail": f"{chars} chars → {units} unit(s) × {per_unit}",
                "credits": float(char_credits),
            })

        elif unit_field == "images":
            num_images = max(0, int(params.get("num_images") or 0))
            image_credits = Decimal(num_images) * per_unit
            total += image_credits
            breakdown.append({
                "component": "images",
                "detail": f"{num_images} image(s) × {per_unit}",
                "credits": float(image_credits),
            })

        elif unit_field == "pages":
            pages = max(0, int(params.get("num_pages") or 0))
            page_credits = Decimal(pages) * per_unit
            total += page_credits
            breakdown.append({
                "component": "pdf_pages",
                "detail": f"{pages} page(s) × {per_unit}",
                "credits": float(page_credits),
            })

        elif unit_field == "flat":
            if params.get("generate_questions"):
                add = _d(extra.get("questions_add"))
                total += add
                breakdown.append({"component": "questions", "detail": "question generation", "credits": float(add)})
            if params.get("generate_homework"):
                add = _d(extra.get("homework_add"))
                total += add
                breakdown.append({"component": "homework", "detail": "homework generation", "credits": float(add)})

        else:
            logger.warning("Unknown unit_field '%s' for tool '%s'", unit_field, tool_key)

        return self._result(tool_key, pricing, unit_field, total, breakdown)

    @staticmethod
    def _result(
        tool_key: str,
        pricing: Dict[str, Any],
        unit_field: str,
        total: Decimal,
        breakdown: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        estimated = _ceil_whole(total)
        return {
            "tool_key": tool_key,
            "request_type": pricing["request_type"],
            "unit_field": unit_field,
            "estimated_credits": float(estimated),
            "breakdown": breakdown,
            "rate_source": pricing.get("rate_source") or RATE_SOURCE_DEFAULT,
            "fixed_price": is_fixed_price(tool_key, pricing),
            "rate_snapshot": rate_snapshot_of(tool_key, pricing),
        }

    def estimate_with_balance(
        self,
        tool_key: str,
        params: Optional[Dict[str, Any]],
        institute_id: Optional[str],
    ) -> Dict[str, Any]:
        """estimate() at the institute's price + its current balance / affordability."""
        result = self.estimate(tool_key, params, institute_id=institute_id)
        estimated = Decimal(str(result["estimated_credits"]))
        result["current_balance"] = None
        result["balance_after"] = None
        result["sufficient"] = None
        if institute_id:
            # Local import avoids a circular import at module load.
            from .credit_service import CreditService
            balance = CreditService(self.db).get_balance(institute_id)
            if balance:
                current = balance.current_balance
                result["current_balance"] = float(current)
                result["balance_after"] = float(current - estimated)
                result["sufficient"] = current >= estimated
        return result

    @staticmethod
    def _resolve_minutes(params: Dict[str, Any]) -> int:
        """Audio minutes (rounded UP) from either duration_seconds or audio_minutes."""
        if params.get("duration_seconds") is not None:
            seconds = _d(params.get("duration_seconds"))
            minutes = (seconds / Decimal("60")).quantize(Decimal("1"), rounding=ROUND_CEILING)
            return int(minutes)
        return int(_d(params.get("audio_minutes")).quantize(Decimal("1"), rounding=ROUND_CEILING))
