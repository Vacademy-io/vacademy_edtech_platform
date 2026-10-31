"""
Router for the HTML Document slide type.

Unlike the legacy Yoopta/Tiptap document editors, an HTML document slide is a
piece of **pure, self-contained, creative HTML** — authored and edited entirely
by AI (an editor would constrain the animations / bespoke layouts the model can
produce). This endpoint takes a natural-language prompt (and, for edits, the
current HTML) and returns a complete standalone HTML document that the admin
preview and the learner both render inside a sandboxed iframe.
"""
from __future__ import annotations

import asyncio
import json
from html import escape as html_escape
import logging
import os
import re
from decimal import Decimal
from typing import Optional

import httpx
from ..services.llm_router import open_chat_stream, post_chat
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..constants.model_defaults import GLM_DEFAULT
from ..core.security import get_current_user
from ..db import db_dependency
from ..models.ai_token_usage import RequestType
from ..services.ai_billing import UC, metering_from_request, metering_user, preflight_tool_credits, record_tool_billing
from ..services.model_selection import resolve_models
from ..services.document_postprocess import (
    DOC_IMAGE_MODEL as _IMAGE_MODEL,
    MAX_DOC_IMAGES as _MAX_AI_IMAGES,
    adopt_foreign_images,
    count_image_placeholders,
    illustrate_document,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/html-doc", tags=["html-document"])

# The model comes from the 'html_document' use case (ai_model_defaults, set in
# the super-admin portal). HTML_DOCUMENT_MODEL, when set, still wins (emergency
# override); _DEFAULT_MODEL is only the hard fallback for a missing row.
_USE_CASE = "html_document"
_DEFAULT_MODEL = GLM_DEFAULT
# HTML documents can be long (inline CSS + markup + a little JS).
_MAX_TOKENS = 32000
# GLM-5.x reasons before it writes and the provider will not let reasoning be
# disabled. At its default effort it thought for ~8 min (13k+ hidden tokens)
# before the first byte of HTML, so the author stared at a blank "Building your
# page" for 10+ min (2026-09-25). "low" starts the HTML in ~3 s and halves the
# tokens. Override with HTML_DOCUMENT_REASONING_EFFORT (low|medium|high|"" = model default).
_REASONING_EFFORT = os.getenv("HTML_DOCUMENT_REASONING_EFFORT", "low").strip().lower()
# Usage is charged as max(flat, actual_token_cost × markup). The markup deters
# misuse (very large PDFs / huge pages) — heavy generations pay above raw cost.
_USAGE_MARKUP = Decimal("2")

# Textbook-style illustrations the page may request are capped at
# _MAX_AI_IMAGES — institutes asked for real visual learning, not walls of
# text. They use the platform-wide `data-img-prompt` placeholder contract
# (services/document_postprocess.py, shared with the course copilot's DOCUMENT
# slides): generated after the text is written, then patched into the document.

_FENCE_RE = re.compile(r"^\s*```(?:html)?\s*\n([\s\S]*?)\n?```\s*$")
_DOC_START_RE = re.compile(r"<!doctype html|<html", re.IGNORECASE)


# Content elements the admin can ask the page to include → concrete directives.
_CONTENT_TYPE_SPECS = {
    "notes": "SHORT NOTES: concise, scannable teaching notes with headings, tight bullets, and concrete examples.",
    "summary": "SUMMARY: a short, scannable recap / TL;DR of the key points as a compact card or bullet list — for quick revision.",
    "flashcards": (
        "FLASHCARDS: an INTERACTIVE flashcard deck — cards the learner clicks/taps to flip (question → answer), built with inline JS/CSS. Include the handful of most important cards. LAYOUT RULES (a flip card collapses if you get these wrong — this has shipped broken before): the card element MUST have its own explicit `width:100%` AND a `min-height` (≈170px); if the faces use `position:absolute;inset:0` they contribute NO width or height, so the card itself must define both. Lay the deck out with `grid-template-columns:repeat(auto-fit,minmax(240px,1fr))` — NEVER put a card in an `auto` grid track (it collapses to zero width and the text spills out one word per line). Put any prev/next controls on their OWN row, not in a track beside the card. Give the face text `overflow-wrap:break-word` and keep it comfortably inside the padding."
    ),
    "practical_examples": "PRACTICAL EXAMPLES: worked, real-world examples/applications showing the concept in action, step by step.",
    "interactive_games": (
        "INTERACTIVE GAME (REQUIRED when listed — never omit it): one small, genuinely playable "
        "learning game built from the material's own terms — match term to definition, order the "
        "steps of a process, sort items into categories, or a click-to-reveal/timed recall challenge. "
        "Inline JS with real state, scoring, per-answer feedback and a Reset control. Must work with "
        "mouse AND touch (if you use drag-and-drop, also support tap-to-select-then-tap-to-place)."
    ),
    "quiz": "QUIZ: an INTERACTIVE multiple-choice quiz — the learner selects answers and gets instant feedback + a score (inline JS). 3-6 questions, each with a short explanation.",
    "assignment": "ASSIGNMENT: a clearly-scoped task section — objective, step-by-step instructions, the deliverable, and a simple rubric / success criteria (static content).",
}
# PDF grounding text is truncated so the prompt stays within budget.
_MAX_GROUNDING_CHARS = 12000


class BrandKit(BaseModel):
    primary_color: Optional[str] = Field(None, description="Institute accent color (hex).")
    logo_url: Optional[str] = Field(None, description="Institute logo URL to embed.")
    name: Optional[str] = Field(None, description="Institute name.")


class GenerateHtmlRequest(BaseModel):
    prompt: str = Field("", description="What the document should be / how to change it.")
    brand: Optional[BrandKit] = Field(None, description="Institute brand kit — inject for a consistent look.")
    current_html: Optional[str] = Field(
        None,
        description="Existing HTML — when present this is an EDIT: apply the prompt to this document.",
    )
    content_types: Optional[list[str]] = Field(
        None,
        description="Sections to include, in order: notes, flashcards, practical_examples, interactive_games, quiz, assignment.",
    )
    key_points: Optional[list[str]] = Field(None, description="Optional key points/topics the page MUST cover.")
    image_urls: Optional[list[str]] = Field(None, description="Uploaded image URLs to embed where relevant.")
    reference_file_ids: Optional[list[str]] = Field(
        None, description="Uploaded PDF file ids — grounded via MathPix (real text + figures reused)."
    )
    institute_id: Optional[str] = Field(None, description="Institute to charge (academy-credits).")
    user_id: Optional[str] = Field(None, description="Deprecated for attribution; actor comes from the JWT.")
    idempotency_key: Optional[str] = Field(None, description="Dedup key so a retry can't double-charge.")


class GenerateHtmlResponse(BaseModel):
    html: str
    model: str


def _role_from_user(user) -> str:
    if user is None:
        return "ADMIN"
    raw = getattr(user, "roles", None) or getattr(user, "authorities", None)
    if raw is None and isinstance(user, dict):
        raw = user.get("roles") or user.get("authorities")
    roles = {str(r).upper() for r in (raw or [])}
    if any("ADMIN" in r for r in roles):
        return "ADMIN"
    if any("TEACHER" in r for r in roles):
        return "TEACHER"
    return "ADMIN"


_SYSTEM_DIRECTIVE = (
    "You are a world-class front-end designer AND an instructional designer. "
    "You produce ONE complete, self-contained, visually striking HTML document "
    "for a learning platform — a mini web page that teaches its topic.\n\n"
    "HARD RULES:\n"
    "1. Output a SINGLE full HTML document: `<!DOCTYPE html>` … `<html>` … "
    "`<head>` with ALL CSS in one inline `<style>` … `<body>`. Nothing before or after.\n"
    "2. Everything is inline/self-contained: inline `<style>`, and any JS in an "
    "inline `<script>` at the end of `<body>`. No build step, no imports of local files.\n"
    "3. You MAY use tasteful motion — CSS `@keyframes`/transitions and small vanilla "
    "JS (counters, interactive diagrams, canvas/SVG). CRITICAL: the page is shown at its "
    "FULL height with NO internal scrolling (the parent app scrolls), so NEVER hide content "
    "behind scroll-triggered reveals — an IntersectionObserver or scroll listener that starts "
    "sections at opacity:0 and reveals them on scroll will leave them INVISIBLE here. All "
    "content must be visible on load; entrance animations must play automatically on load, not "
    "on scroll. Keep motion smooth and honor `prefers-reduced-motion`.\n"
    "4. Responsive (mobile → desktop), accessible (semantic tags, alt text, adequate "
    "contrast — dark text on light surfaces by default), and readable CONTRAST (content has shipped INVISIBLE): set the text colour explicitly on EVERY surface (hero, card, band) for ALL its descendants — dark surfaces set light text, and a LIGHT panel nested inside a dark surface must re-set its own DARK text (white-on-pale-mint has shipped invisible). Never use muted/grey text on a coloured or gradient background. Inline emphasis (`strong`,`b`,`em`,`mark`,`span`) always INHERITS its container's colour — never a fixed colour; emphasise with weight or background instead. LAYOUT: sections/cards stack in normal flow — never absolutely position text or captions over other content, no negative-margin overlaps, no `position:absolute;bottom:0` captions inside cards with flowing content, no fixed heights that clip. Any animation touching opacity must END at opacity:1.\n"
    "5. Real, substantive content about the TOPIC — no lorem ipsum, no placeholder text. "
    "Use headings, sections, tables, callouts, diagrams as the content warrants.\n"
    "6. External resources: you MAY use Google Fonts via `<link>` and reputable CDN "
    "libraries via `<script src>` if they genuinely help (e.g. a charting or diagram lib). "
    "Never reference private/local URLs, analytics, or trackers. Prefer inline SVG for diagrams.\n"
    "7. The page renders inside a sandboxed iframe with a unique origin — do NOT rely on "
    "cookies, localStorage, or access to any parent window.\n"
    "8. RESULT REPORTING (do this whenever the page has a quiz, game, or any graded/"
    "completable activity): report the learner's outcome to the host so the platform records "
    "it. Using `window.parent.postMessage(msg, '*')`, send:\n"
    "   • progress as the learner advances: `{type:'vacademy:progress', percent:<0-100>}`\n"
    "   • exactly once when they finish (submit the quiz / win the game / complete the task): "
    "`{type:'vacademy:complete', score:<number>, maxScore:<number>, wrong:<number of wrong answers>, "
    "timesSec:[<seconds taken per question>]}`\n"
    "   Omit fields you don't have. It's a harmless no-op in preview — never wait for a response.\n"
    "9. TEACH VISUALLY — this is not optional decoration, it is how students learn. "
    "A wall of text is a FAILED page. Every major idea on the page must be carried by "
    "something a learner can SEE, the way a good textbook does it. Use BOTH of these:\n"
    "   a) INLINE SVG, which you draw yourself, for anything schematic — labelled "
    "diagrams, cross-sections, cycles and flows, timelines, comparison tables, graphs/"
    "plots, tree and hierarchy charts, number lines, annotated formulas, before/after "
    "panels. Label the parts with real `<text>` (readable size, high contrast, never "
    "overlapping the artwork), and keep them responsive with a `viewBox` and "
    "`width:100%;height:auto` — never a fixed pixel width.\n"
    "   b) GENERATED TEXTBOOK ILLUSTRATIONS for pictures you cannot draw with shapes — a "
    "realistic scene, an object, an organism, an apparatus, a historical setting, a "
    "worked real-world context. Request one by emitting EXACTLY this placeholder tag:\n"
    "      `<img src=\"placeholder.png\" data-img-prompt=\"<a precise description of the "
    "picture to draw>\" data-img-aspect=\"16:9\" alt=\"<real alt text>\">`\n"
    "   (`data-img-aspect` is optional: 16:9 | 4:3 | 1:1 | 3:4 | 9:16, default 16:9.) The "
    "platform generates the picture and replaces this tag after you finish — so NEVER invent, "
    "guess or copy an image URL for these, and never use a placeholder service. Describe the "
    "subject concretely (\"a labelled cutaway of a human heart showing the four chambers "
    "and the direction of blood flow\"), not vaguely (\"a nice picture about biology\"). "
    f"Use AT MOST {_MAX_AI_IMAGES} of these, on the ideas that most need a picture; anything "
    "schematic should be SVG instead (it is sharper, instant, and free). Wrap each one in a "
    "`<figure>` with a short `<figcaption>` that explains what to notice — so the page still "
    "teaches if an image fails to render.\n"
    "   c) VISUAL NOTES throughout: icon-led key-point cards, colour-coded callouts "
    "(definition / example / common mistake / remember), side-by-side comparisons, "
    "step-numbered process strips, mnemonic boxes and a visual summary/recap at the end. "
    "Aim for a picture, diagram or visual-note block roughly every screenful — never two "
    "long prose sections in a row.\n"
    "10. Return ONLY the raw HTML. No markdown, no ``` fences, no commentary."
)


def _content_types_block(content_types: Optional[list[str]]) -> str:
    if not content_types:
        return ""
    specs = [
        f"  {i}. {_CONTENT_TYPE_SPECS[t]}"
        for i, t in enumerate((ct for ct in content_types if ct in _CONTENT_TYPE_SPECS), start=1)
    ]
    if not specs:
        return ""
    return (
        "\n\n**Include these sections, in this order** (design them into one cohesive page, "
        "not disconnected blocks — interactive parts use inline JS and must actually work):\n"
        + "\n".join(specs)
        + "\n\nIMPORTANT — these are PRESENTATION FORMATS, not new subject matter. Any "
        "source-fidelity rule above restricts the FACTS you may state; it does NOT excuse you from "
        "building these sections. Build each one USING the supplied material's own content, and "
        "never skip a requested section because the material 'does not contain a game/quiz' — "
        "constructing the interaction is your job."
    )


def _key_points_block(key_points: Optional[list[str]]) -> str:
    pts = [p.strip() for p in (key_points or []) if p and p.strip()]
    if not pts:
        return ""
    return "\n\n**Must cover these points**:\n" + "\n".join(f"  - {p}" for p in pts)


def _images_block(image_urls: Optional[list[str]]) -> str:
    urls = [u.strip() for u in (image_urls or []) if u and u.strip()]
    if not urls:
        return ""
    listing = "\n".join(f"  - {u}" for u in urls)
    return (
        "\n\n**Uploaded images (embed the relevant ones VERBATIM using their exact URL)** — "
        "place them where they support the content, sized/styled via your CSS; never alter a URL:\n"
        + listing
    )


def _grounding_block(grounding_text: str, figures) -> str:
    block = ""
    if grounding_text and grounding_text.strip():
        text = grounding_text[:_MAX_GROUNDING_CHARS]
        truncated = " (truncated)" if len(grounding_text) > len(text) else ""
        block += (
            "\n\n**Source document (ground the content in this REAL material"
            f"{truncated}; be accurate to it, don't invent facts that contradict it)**:\n"
            f"{text}"
        )
    fig_lines = [
        f"  - {getattr(f, 'url', '')}"
        + (f" — {getattr(f, 'caption', '')}" if getattr(f, "caption", "") else "")
        for f in (figures or [])
        if getattr(f, "url", "")
    ]
    if fig_lines:
        block += (
            "\n\n**Real figures from the source document (PREFER these over generated images; "
            "embed the relevant ones VERBATIM by their exact URL)**:\n" + "\n".join(fig_lines)
        )
    return block


def _brand_block(brand: Optional[BrandKit]) -> str:
    if not brand:
        return ""
    lines = []
    if brand.primary_color and brand.primary_color.strip():
        lines.append(
            f"  - Primary/accent color: {brand.primary_color.strip()} — build a cohesive palette "
            "AROUND it (tints & shades for surfaces, accents, buttons, highlights). Use it "
            "prominently and consistently; keep text contrast accessible."
        )
    if brand.logo_url and brand.logo_url.strip():
        lines.append(
            f"  - Logo: embed `<img src=\"{brand.logo_url.strip()}\" alt=\"logo\">` (exact URL, verbatim) "
            "small and tasteful in the header/hero area."
        )
    if brand.name and brand.name.strip():
        lines.append(f"  - This page represents **{brand.name.strip()}** — keep the tone on-brand.")
    if not lines:
        return ""
    return (
        "\n\n**Brand identity (make the page visually match this institute's brand)**:\n"
        + "\n".join(lines)
    )


def _build_prompt(req: GenerateHtmlRequest, grounding_text: str = "", figures=None) -> str:
    materials = (
        _brand_block(req.brand)
        + _content_types_block(req.content_types)
        + _key_points_block(req.key_points)
        + _images_block(req.image_urls)
        + _grounding_block(grounding_text, figures)
    )
    instruction = req.prompt.strip() or (
        "Create a rich learning page covering the material and sections described below."
    )
    if req.current_html:
        return (
            f"{_SYSTEM_DIRECTIVE}\n\n"
            "TASK: EDIT the existing document below according to the instruction. "
            "Preserve everything that isn't part of the change; return the FULL updated document.\n"
            "IMAGES ON AN EDIT: every `<img src=\"https://...\">` already in the document is a "
            "REAL, already-generated picture — keep those tags and their URLs EXACTLY as they are "
            "unless the instruction is to remove or replace that picture. Only emit a NEW "
            "`placeholder.png` + `data-img-prompt` tag when the edit genuinely calls for a new "
            "illustration.\n\n"
            f"INSTRUCTION:\n{instruction}"
            f"{materials}\n\n"
            "CURRENT DOCUMENT:\n"
            f"{req.current_html}"
        )
    return (
        f"{_SYSTEM_DIRECTIVE}\n\n"
        "TASK: CREATE a new learning page.\n"
        f"REQUEST: {instruction}"
        f"{materials}"
    )


def _strip_fence(text: str) -> str:
    if not text:
        return text
    m = _FENCE_RE.match(text.strip())
    if m:
        return m.group(1).strip()
    # If the model prefixed prose, snap to the first real document start.
    start = _DOC_START_RE.search(text)
    return text[start.start():].strip() if start else text.strip()


def _llm_payload(prompt: str, model: str, stream: bool) -> dict:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
        "max_tokens": _MAX_TOKENS,
    }
    if _REASONING_EFFORT:
        payload["reasoning"] = {"effort": _REASONING_EFFORT}
    if stream:
        payload["stream"] = True
        # Ask OpenRouter to emit a final usage chunk so we can bill on
        # actual tokens (× markup), not just the flat floor.
        payload["stream_options"] = {"include_usage": True}
    return payload


async def _call_openrouter(prompt: str, api_key: str, base_url: str, model: str) -> tuple[str, dict]:
    # base_url is kept for callers; the gateway comes from the route map.
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await post_chat(client, _llm_payload(prompt, model, stream=False), api_key)
    if resp.status_code != 200:
        raise httpx.HTTPStatusError(
            f"OpenRouter {resp.status_code}: {resp.text[:500]}",
            request=resp.request,
            response=resp,
        )
    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"OpenRouter returned no choices: {str(data)[:300]}")
    content = (choices[0].get("message") or {}).get("content") or ""
    if not content.strip():
        raise RuntimeError(f"OpenRouter returned empty content: {str(data)[:300]}")
    return content, (data.get("usage") or {})


def _resolve_model(db: Session) -> str:
    """HTML_DOCUMENT_MODEL (env override) > the 'html_document' use-case
    default > GLM."""
    explicit = (os.getenv("HTML_DOCUMENT_MODEL") or "").strip()
    if explicit:
        return explicit
    primary, _fallbacks = resolve_models(db, _USE_CASE, hard_fallback=_DEFAULT_MODEL)
    return primary


async def _prepare(
    body: GenerateHtmlRequest, current_user, db: Session, ground: bool = True, request: Optional[Request] = None
) -> dict:
    """Auth + validation + preflight credit gate + PDF grounding, then build the
    prompt. Raises HTTPException (401/400/402/503) BEFORE any streaming starts.
    Returns everything both the JSON and streaming endpoints need. With
    ground=False the (slow, up to 150 s) PDF grounding is left for the caller —
    background jobs run it via `_ground` after the request has returned."""
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

    actor_user_id = getattr(current_user, "user_id", None)
    if actor_user_id is None and isinstance(current_user, dict):
        actor_user_id = current_user.get("user_id")
    token_institute = getattr(current_user, "institute_id", None)
    if token_institute is None and isinstance(current_user, dict):
        token_institute = current_user.get("institute_id")
    institute_id = token_institute or body.institute_id
    actor_role = _role_from_user(current_user)

    settings = get_settings()
    openrouter_key: Optional[str] = getattr(settings, "openrouter_api_key", None)
    openrouter_url: str = getattr(
        settings, "llm_base_url", "https://openrouter.ai/api/v1/chat/completions"
    )
    model = _resolve_model(db)
    if not openrouter_key:
        raise HTTPException(status_code=503, detail="No LLM provider configured. Set OPENROUTER_API_KEY.")

    has_input = bool(
        body.prompt.strip()
        or body.content_types
        or body.key_points
        or body.reference_file_ids
        or body.current_html
    )
    if not has_input:
        raise HTTPException(
            status_code=400,
            detail="Provide a prompt, select content sections, add key points, or attach a PDF.",
        )

    # Create vs edit are priced differently (a full create costs more than a
    # conversational edit that reuses the existing page).
    tool_key = "html_document_edit" if body.current_html else "html_document"

    # Pre-flight credit gate (academy-credits) — flat per generation. Only gates
    # when an institute is resolved; the charge is recorded after success.
    if institute_id:
        estimate = preflight_tool_credits(
            db, tool_key=tool_key, tool_params={}, institute_id=institute_id
        )
        if estimate.get("sufficient") is False:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"Insufficient credits: generating this page needs ~{estimate['estimated_credits']} "
                    f"credits but the balance is {estimate.get('current_balance')}."
                ),
            )

    ctx = {
        "prompt": "",
        "model": model,
        "openrouter_key": openrouter_key,
        "openrouter_url": openrouter_url,
        "institute_id": institute_id,
        "actor_user_id": actor_user_id,
        "actor_role": actor_role,
        "tool_key": tool_key,
        "pdf_page_count": 0,
        "allowed_image_urls": set(),
        # Usage-event attribution only (who/where); the ledger keeps actor_role.
        "metering": (metering_from_request(request, institute_id, user=current_user)
                     or metering_user(actor_user_id, surface="ADMIN_APP")),
    }
    if ground:
        await _ground(body, ctx)
    return ctx


_URL_IN_HTML_RE = re.compile(r'\ssrc=(["\'])(https?://.*?)\1', re.IGNORECASE)


async def _ground(body: GenerateHtmlRequest, ctx: dict) -> None:
    """Ground in an uploaded PDF (real text + reusable figures) — reuses the same
    MathPix ingestion the course flow uses. Bounded so a slow/failed
    conversion never hangs; generation proceeds without it. Fills ctx's
    prompt, pdf_page_count and the image URLs the model may legitimately use."""
    grounding_text, figures = "", []
    if body.reference_file_ids:
        try:
            from ..services.course_document_ingest import ingest_documents

            ingest = await asyncio.wait_for(
                ingest_documents(body.reference_file_ids, rehost_figures=True), timeout=150
            )
            grounding_text, figures = ingest.grounding_text, ingest.figures
            # Per-page surcharge is billed on CREATE only — an edit re-grounding
            # the same PDF must not re-charge for its pages.
            if not body.current_html:
                ctx["pdf_page_count"] = ingest.page_count
        except Exception as e:  # noqa: BLE001
            logger.warning("[html-doc] PDF ingest skipped: %s", e)

    allowed = set(body.image_urls or [])
    allowed.update(getattr(f, "url", "") for f in figures or [])
    if body.brand and body.brand.logo_url:
        allowed.add(body.brand.logo_url)
    if body.current_html:
        # An edit keeps the pictures already generated for this page.
        allowed.update(m.group(2) for m in _URL_IN_HTML_RE.finditer(body.current_html))
    ctx["allowed_image_urls"] = {u.strip() for u in allowed if u and u.strip()}
    ctx["prompt"] = _build_prompt(body, grounding_text, figures)
    ctx["grounding_block"] = _grounding_block(grounding_text, figures)


async def _stream_llm(ctx: dict):
    """Stream one generation from OpenRouter. Yields ("reasoning", n_chars),
    ("content", text) and finally ("usage", dict). Raises on a non-200."""
    payload = _llm_payload(ctx["prompt"], ctx["model"], stream=True)
    usage: dict = {}
    async with httpx.AsyncClient(timeout=180.0) as client:
        async with open_chat_stream(client, payload, ctx["openrouter_key"]) as resp:
            if resp.status_code != 200:
                detail = (await resp.aread()).decode(errors="ignore")[:300]
                raise RuntimeError(f"OpenRouter {resp.status_code}: {detail}")
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                chunk_str = line[len("data:"):].strip()
                if chunk_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(chunk_str)
                except Exception:  # noqa: BLE001
                    continue
                if chunk.get("usage"):
                    usage = chunk["usage"]
                choices = chunk.get("choices") or []
                delta = (choices[0].get("delta") or {}) if choices else {}
                reasoning = delta.get("reasoning") or delta.get("reasoning_content")
                if reasoning:
                    yield "reasoning", len(reasoning)
                if delta.get("content"):
                    yield "content", delta["content"]
    yield "usage", usage


async def _illustrate(ctx: dict, html_out: str, on_progress=None) -> tuple[str, int]:
    """Adopt invented image URLs as placeholders, then draw every placeholder.
    Never raises — a failed picture pass returns the text-only page."""
    html_out, _ = adopt_foreign_images(html_out, ctx.get("allowed_image_urls"))
    if not count_image_placeholders(html_out):
        return html_out, 0
    try:
        return await illustrate_document(html_out, slide_path="html-doc", on_progress=on_progress)
    except Exception as e:  # noqa: BLE001
        logger.warning("[html-doc] illustration pass failed: %s", e)
        return html_out, 0


def _meter_context(body: GenerateHtmlRequest, **extra) -> dict:
    """Small usage-event context: which slide/page this charge was for."""
    out = {"slide_id": getattr(body, "slide_id", None)}
    out.update(extra)
    return out


def _bill(ctx: dict, body: GenerateHtmlRequest, usage: Optional[dict] = None) -> None:
    """Charge credits = max(flat, actual_token_cost × 2× markup), best-effort —
    the doc is already generated; a billing hiccup must never fail the request.
    Usage-based so heavy generations (big PDFs / large pages) pay above the flat
    floor. Idempotency key dedups retries."""
    usage = usage or {}
    try:
        record_tool_billing(
            tool_key=ctx["tool_key"],
            tool_params={"is_edit": bool(body.current_html)},
            request_type=RequestType.CONTENT,
            model=ctx["model"],
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            institute_id=ctx["institute_id"],
            user_id=ctx["actor_user_id"],
            user_role=ctx["actor_role"] if ctx["actor_user_id"] else None,
            idempotency_key=body.idempotency_key,
            usage_markup=_USAGE_MARKUP,
            use_case=UC.HTML_DOCUMENT,
            metering=ctx.get("metering"),
            usage_context=_meter_context(body, is_edit=bool(body.current_html)),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[html-doc] billing skipped: %s", e)

    # Separate, transparent per-page surcharge for the grounding PDF (MathPix
    # conversion cost). Billed on create only (see _prepare).
    pages = int(ctx.get("pdf_page_count") or 0)
    if pages > 0:
        try:
            record_tool_billing(
                tool_key="html_document_pdf",
                tool_params={"num_pages": pages},
                request_type=RequestType.CONTENT,
                model=ctx["model"],
                institute_id=ctx["institute_id"],
                user_id=ctx["actor_user_id"],
                user_role=ctx["actor_role"] if ctx["actor_user_id"] else None,
                idempotency_key=(f"{body.idempotency_key}:pdf" if body.idempotency_key else None),
                use_case=UC.HTML_DOCUMENT,
                metering=ctx.get("metering"),
                usage_context=_meter_context(body, pdf_pages=pages),
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[html-doc] pdf page billing skipped: %s", e)


def _bill_images(ctx: dict, body: GenerateHtmlRequest, count: int) -> None:
    """Separate, transparent per-illustration charge — only for pictures that
    actually came back. Best-effort, like the rest of the billing here."""
    if count <= 0:
        return
    try:
        record_tool_billing(
            tool_key="html_document_image",
            tool_params={"num_images": count},
            request_type=RequestType.IMAGE,
            model=_IMAGE_MODEL,
            institute_id=ctx["institute_id"],
            user_id=ctx["actor_user_id"],
            user_role=ctx["actor_role"] if ctx["actor_user_id"] else None,
            idempotency_key=(f"{body.idempotency_key}:img" if body.idempotency_key else None),
            use_case=UC.DOCUMENT_IMAGE,
            metering=ctx.get("metering"),
            usage_context=_meter_context(body, image_count=count),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[html-doc] image billing skipped: %s", e)


@router.post("/v1/generate", response_model=GenerateHtmlResponse)
async def generate_html_document(
    body: GenerateHtmlRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
    request: Request = None,
) -> GenerateHtmlResponse:
    ctx = await _prepare(body, current_user, db, request=request)
    try:
        raw, usage = await _call_openrouter(
            ctx["prompt"], ctx["openrouter_key"], ctx["openrouter_url"], ctx["model"]
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[html-doc] generation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"HTML generation failed: {e}")

    html_out = _strip_fence(raw)
    if not html_out:
        raise HTTPException(status_code=502, detail="Model returned empty HTML.")
    html_out, images = await _illustrate(ctx, html_out)
    _bill(ctx, body, usage)
    _bill_images(ctx, body, images)
    return GenerateHtmlResponse(html=html_out, model=ctx["model"])


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj)}\n\n"


@router.post("/v1/generate/stream")
async def generate_html_document_stream(
    body: GenerateHtmlRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
    request: Request = None,
):
    """Server-Sent Events variant: streams the HTML as it is generated so the
    author watches the page build live (and can cancel by dropping the request).
    Auth / validation / preflight all run first so those surface as normal HTTP
    errors before the stream opens. Events: {delta}, {done, html, model}, {error}."""
    ctx = await _prepare(body, current_user, db, request=request)

    async def event_gen():
        collected: list[str] = []
        usage: dict = {}
        thinking_sent = False
        try:
            async for kind, value in _stream_llm(ctx):
                if kind == "content":
                    collected.append(value)
                    yield _sse({"delta": value})
                elif kind == "reasoning" and not thinking_sent and not collected:
                    # Tell the client the model is planning (no HTML yet), so
                    # the wait isn't a silent blank panel.
                    thinking_sent = True
                    yield _sse({"status": "thinking"})
                elif kind == "usage":
                    usage = value

            html_out = _strip_fence("".join(collected))
            if not html_out:
                yield _sse({"error": "Model returned empty HTML."})
                return

            # Illustration pass. The text is finished and on screen; the
            # pictures the page asked for are drawn now and patched in, so the
            # final `done` document is the one with real image URLs. Progress
            # is surfaced because this adds real seconds to the wait.
            queue: asyncio.Queue = asyncio.Queue()

            async def on_progress(done_n: int, total_n: int) -> None:
                await queue.put((done_n, total_n))

            task = asyncio.create_task(_illustrate(ctx, html_out, on_progress))
            while True:
                get = asyncio.create_task(queue.get())
                done_set, _ = await asyncio.wait(
                    {get, task}, return_when=asyncio.FIRST_COMPLETED
                )
                if get in done_set:
                    done_n, total_n = get.result()
                    # NB: never key this "done" — the client treats a
                    # truthy `done` as the final document event.
                    yield _sse({"status": "images", "completed": done_n, "total": total_n})
                    continue
                get.cancel()
                break
            html_out, images = await task

            _bill(ctx, body, usage)
            _bill_images(ctx, body, images)
            yield _sse({"done": True, "html": html_out, "model": ctx["model"]})
        except Exception as e:  # noqa: BLE001
            logger.warning("[html-doc] stream failed: %s", e)
            yield _sse({"error": f"HTML generation failed: {e}"})

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Parallel section generation (creates only).
#
# One model call writing a whole 45k-char page is bound by output speed (~40
# tok/s on GLM → 6+ min). Instead: a small PLAN call (title + section briefs),
# then the STYLIST (shared CSS + hero) and EVERY SECTION are written at the
# same time. They agree up front on a fixed class vocabulary, so no section
# waits for the CSS. Each section's pictures are drawn as soon as it lands,
# overlapping the others. Wall time ≈ plan + slowest section + its pictures.
# Edits keep the single-call path (they must see and preserve the whole page).
# ---------------------------------------------------------------------------

_PARALLEL = os.getenv("HTML_DOCUMENT_PARALLEL", "1").strip() not in ("0", "false", "no")
_MAX_SECTIONS = 8
_SECTION_ID_RE = re.compile(r"[^a-z0-9-]")

# The contract between the stylist and the section writers.
_CLASS_VOCABULARY = """\
HERO: header.hero > .hero-brand (small brand line, may hold a logo img) + h1 + p.hero-hook + ul.hero-objectives > li
LAYOUT: main.page (centered readable container) · section.section (one per section, generous spacing) ·
  .section-head (row: .section-num badge + .section-title h2 + optional .section-lead p) ·
  .grid (responsive auto-fit card grid) · .grid-2 (two columns, stacks on mobile) · .compare (side-by-side comparison, stacks on mobile)
SURFACES: .card (+ .card-title) · .key-point (icon-led card; first child .key-icon holds an emoji/SVG) · .recap (summary box) ·
  .formula (annotated formula box; big centered formula + small labels) · .figure (wraps <img>/<svg> + <figcaption>)
CALLOUTS: .callout + one of .callout-definition | .callout-example | .callout-mistake | .callout-remember ; heading inside = .callout-title
TEXT/BITS: .badge · .pill · .table-wrap > table (styled header, zebra rows, mobile scroll) · ol.steps > li.step (numbered process strip)
CONTROLS: .btn · .btn-primary · .btn-ghost
QUIZ: .quiz > .quiz-q (question block) > .quiz-option (button); state classes .is-correct / .is-wrong on options; .feedback (explanation text); .score
GAME: .game-board · .chip (tappable/draggable item) · .drop-zone (target) ; states .is-selected / .is-placed / .is-correct / .is-wrong
"""


def _plan_prompt(req: GenerateHtmlRequest, materials: str) -> str:
    wanted = [k for k in (req.content_types or []) if k in _CONTENT_TYPE_SPECS]
    wanted_line = (
        "Requested content elements (EACH gets exactly one section, in this order, after the core "
        f"teaching sections): {', '.join(wanted)}."
        if wanted
        else "No specific elements requested — choose the sections that teach this best."
    )
    return (
        "You are the lead instructional designer planning ONE learning web page that several "
        "writers will build IN PARALLEL, one section each. Plan it so the sections fit together "
        "without repeating each other.\n\n"
        f"REQUEST: {req.prompt.strip() or 'Create a rich learning page on the material below.'}"
        f"{materials}\n\n"
        f"{wanted_line}\n\n"
        "Return ONLY a JSON object (no markdown, no commentary):\n"
        '{"title": "<page title>", "hook": "<one-line hook for the hero>", '
        '"objectives": ["<3-5 learning objectives>"], "sections": [{"id": "s1-<slug>", '
        '"title": "<section heading>", "type": "<concept | one of the requested element keys>", '
        '"brief": "<3-5 sentences: exactly what this section teaches or contains — the concrete '
        "facts, examples, questions or game items — and which visual to use (inline SVG diagram, "
        'generated illustration, table, comparison, steps). Assign any uploaded image or source '
        'figure URL to the ONE section that should embed it.>"}]}\n'
        f"Rules: 3-{_MAX_SECTIONS} sections total. Start with 1-3 'concept' sections that teach the "
        "core ideas visually, then the requested elements. Distinct, non-overlapping scopes. "
        "Briefs must be specific to the topic (real facts, numbers, examples) so each writer can work "
        "alone."
    )


def _stylist_prompt(req: GenerateHtmlRequest, brand_block: str) -> str:
    """Runs in parallel with the PLAN call, so it only knows the topic."""
    topic = req.prompt.strip() or ", ".join(req.key_points or []) or "a learning page"
    return (
        "You are a world-class front-end designer. Several writers are writing the sections of a "
        "learning page in parallel using ONLY the class vocabulary below. You write the page's "
        "SHARED STYLESHEET that gives all of it one striking, cohesive look.\n\n"
        f"TOPIC: {topic}{brand_block}\n\n"
        f"CLASS VOCABULARY (style EVERY one of these; writers rely on them):\n{_CLASS_VOCABULARY}\n"
        "CSS RULES: define a palette as CSS variables on :root built around the brand colour (tints/"
        "shades for surfaces and accents); you may @import ONE Google Font at the very top; style base "
        "elements (body, h1-h4, p, a, img, svg, code, table); responsive mobile→desktop; readable "
        "CONTRAST — set text colour explicitly on every surface, dark text on light surfaces, never "
        "grey text on coloured backgrounds; inline emphasis inherits colour; no scroll-triggered "
        "reveals (content visible on load; any entrance animation plays on load and ENDS at "
        "opacity:1); honour prefers-reduced-motion; no fixed heights that clip.\n"
        "Be COMPACT: one line per rule, no comments, under ~5000 characters — it is on the critical path.\n\n"
        "Return ONLY the stylesheet as a single <style>…</style> element. No markdown, no commentary."
    )


def _build_hero(plan: dict, brand: Optional[BrandKit]) -> str:
    esc = html_escape
    brand_bits = ""
    if brand and (brand.logo_url or brand.name):
        logo = (
            f'<img src="{esc(brand.logo_url)}" alt="{esc(brand.name or "logo")}">'
            if brand.logo_url
            else ""
        )
        brand_bits = f'<span class="hero-brand">{logo}{esc(brand.name or "")}</span>'
    objectives = "".join(f"<li>{esc(str(o))}</li>" for o in (plan.get("objectives") or [])[:6])
    return (
        f'<header class="hero">{brand_bits}<h1>{esc(plan["title"])}</h1>'
        + (f'<p class="hero-hook">{esc(str(plan.get("hook") or ""))}</p>' if plan.get("hook") else "")
        + (f'<ul class="hero-objectives">{objectives}</ul>' if objectives else "")
        + "</header>"
    )


def _section_prompt(
    req: GenerateHtmlRequest, materials: str, plan: dict, idx: int, graded_id: Optional[str], image_cap: int
) -> str:
    sec = plan["sections"][idx]
    sid = sec["id"]
    outline = "\n".join(
        f"  {i + 1}. [{s['id']}] {s['title']} — {s['brief']}" for i, s in enumerate(plan["sections"])
    )
    spec = _CONTENT_TYPE_SPECS.get(sec.get("type") or "", "")
    if sid == graded_id:
        reporting = "RESULT REPORTING: rule 8 applies to THIS section (it is the page's graded activity)."
    else:
        reporting = "RESULT REPORTING: do NOT postMessage vacademy:progress/complete from this section."
    pictures = (
        "ILLUSTRATIONS: include ONE generated-illustration placeholder (hard rule 9b) for the "
        "real-world scene, object or apparatus that most helps here (at most "
        f"{image_cap}); use inline SVG for anything schematic."
        if image_cap
        else "ILLUSTRATIONS: no generated-illustration placeholders in this section (inline SVG is fine)."
    )
    # Shared prefix first (directive + materials + plan + vocabulary) so the
    # parallel calls hit the provider's prompt cache; section specifics last.
    return (
        f"{_SYSTEM_DIRECTIVE}\n\n"
        f"PAGE REQUEST: {req.prompt.strip() or 'A rich learning page on the material below.'}"
        f"{materials}\n\n"
        f"PAGE TITLE: {plan['title']}\nFULL PAGE PLAN (other writers are writing the other sections "
        f"right now — stay strictly inside YOUR scope):\n{outline}\n\n"
        f"SHARED CLASS VOCABULARY (a shared stylesheet styles these — use them for a consistent look):\n"
        f"{_CLASS_VOCABULARY}\n"
        "PARALLEL-WRITER RULES (these OVERRIDE hard rules 1, 2 and 10 above): return ONLY one fragment\n"
        f'  <section id="{sid}" class="section"> … </section>\n'
        "  - no <html>/<head>/<body>, no global CSS, no :root/body/font rules, no page title or hero, no logo.\n"
        f"  - extra CSS only in a <style> INSIDE the section whose EVERY selector starts with #{sid}.\n"
        f"  - any JS in ONE <script> at the END of the section, wrapped in an IIFE, that finds elements "
        f"only inside document.getElementById('{sid}') (never global ids/querySelector on document).\n"
        f"  - start with the .section-head (section number {idx + 1}).\n"
        f"  - {pictures}\n"
        f"  - {reporting}\n\n"
        f"YOUR SECTION: {idx + 1}. {sec['title']} (type: {sec.get('type') or 'concept'})\n"
        f"BRIEF: {sec['brief']}\n"
        + (f"ELEMENT SPEC: {spec}\n" if spec else "")
        + "Return ONLY the <section> element — no markdown fences, no commentary."
    )


def _parse_plan(raw: str, wanted: Optional[list] = None) -> Optional[dict]:
    text = _strip_fence(raw or "")
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        plan = json.loads(text[start : end + 1])
    except Exception:  # noqa: BLE001
        return None
    sections = []
    seen = set()
    for i, s in enumerate(plan.get("sections") or []):
        if not isinstance(s, dict) or not s.get("title") or not s.get("brief"):
            continue
        sid = _SECTION_ID_RE.sub("-", str(s.get("id") or f"s{i + 1}").lower()).strip("-") or f"s{i + 1}"
        if not sid.startswith("s"):
            sid = f"s{i + 1}-{sid}"
        while sid in seen:
            sid += "x"
        seen.add(sid)
        sections.append(
            {"id": sid, "title": str(s["title"])[:120], "type": str(s.get("type") or "concept"), "brief": str(s["brief"])}
        )
    if len(sections) < 2:
        return None
    for key in wanted or []:
        if not any(s["type"] == key for s in sections):
            label = key.replace("_", " ").title()
            sections.append({"id": f"s{len(sections) + 1}-{key.replace('_', '-')}", "title": label,
                             "type": key, "brief": f"{label} for this page's topic."})
    # Concept sections first (model's order), then the elements in the order
    # the author picked them.
    order = {k: i for i, k in enumerate(wanted or [])}
    sections.sort(key=lambda s: (0, 0) if s["type"] not in order else (1, order[s["type"]]))
    while len(sections) > _MAX_SECTIONS:
        concepts = [s for s in sections if s["type"] not in _CONTENT_TYPE_SPECS]
        if len(concepts) <= 1:
            break
        sections.remove(concepts[-1])
    plan["sections"] = sections[:_MAX_SECTIONS]
    plan["title"] = str(plan.get("title") or sections[0]["title"])[:150]
    return plan


def _extract_style(raw: str) -> str:
    text = _strip_fence(raw or "")
    m = re.search(r"<style[\s\S]*?</style>", text, re.IGNORECASE)
    if m:
        return m.group(0)
    # Bare CSS (or an unterminated <style>) — keep what's there.
    css = re.sub(r"</?style[^>]*>|===\w+===|```(?:css)?", "", text, flags=re.IGNORECASE).strip()
    return f"<style>\n{css}\n</style>" if "{" in css else ""


def _extract_section(raw: str, sid: str) -> str:
    text = _strip_fence(raw or "")
    start = text.lower().find("<section")
    end = text.lower().rfind("</section>")
    if start >= 0 and end > start:
        return text[start : end + len("</section>")]
    return f'<section id="{sid}" class="section">{text}</section>' if text.strip() else ""


def _assemble(title: str, style: str, hero: str, sections: list) -> str:
    body = "\n".join(s for s in sections if s)
    return (
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"<title>{html_escape(title)}</title>\n{style}\n</head>\n<body>\n<main class=\"page\">\n"
        f"{hero}\n{body}\n</main>\n</body>\n</html>"
    )


async def _complete(ctx: dict, prompt: str) -> tuple[str, dict]:
    """One streamed call collected to a string (streaming keeps the read
    timeout per-chunk, so a long section can't trip a whole-request timeout)."""
    parts: list[str] = []
    usage: dict = {}
    async for kind, value in _stream_llm({**ctx, "prompt": prompt}):
        if kind == "content":
            parts.append(value)
        elif kind == "usage":
            usage = value
    return "".join(parts), usage


def _add_usage(total: dict, usage: dict) -> None:
    for k in ("prompt_tokens", "completion_tokens"):
        total[k] = int(total.get(k) or 0) + int((usage or {}).get(k) or 0)


async def _generate_parallel(ctx: dict, body: GenerateHtmlRequest, state: dict, live: dict, cancelled: asyncio.Event):
    """Returns (html, images, usage), or None when the plan can't be made —
    the caller then falls back to the single-call path."""
    materials = (
        _content_types_block(body.content_types)
        + _key_points_block(body.key_points)
        + _images_block(body.image_urls)
        + ctx.get("grounding_block", "")
    )
    brand_block = _brand_block(body.brand)
    usage: dict = {}

    state["phase"] = "planning"
    style_hero = {"style": "", "hero": ""}
    plan: Optional[dict] = None

    async def stylist() -> None:
        raw, u2 = await _complete(ctx, _stylist_prompt(body, brand_block))
        _add_usage(usage, u2)
        style_hero["style"] = _extract_style(raw)
        if not style_hero["style"]:
            logger.warning("[html-doc] stylist returned no CSS: %r", (raw or "")[:200])
        if plan is not None:
            refresh_live()

    # The stylesheet only needs the topic — start it alongside the plan.
    style_task = asyncio.create_task(stylist())
    try:
        raw_plan, u = await _complete(ctx, _plan_prompt(body, brand_block + materials))
    except Exception:
        style_task.cancel()
        raise
    _add_usage(usage, u)
    plan = _parse_plan(raw_plan, body.content_types)
    if not plan:
        style_task.cancel()
        logger.warning("[html-doc] parallel plan unparseable; falling back. raw=%r", (raw_plan or "")[:300])
        return None
    style_hero["hero"] = _build_hero(plan, body.brand)
    sections = plan["sections"]
    n = len(sections)
    graded_id = next(
        (s["id"] for t in ("quiz", "interactive_games") for s in sections if s["type"] == t), None
    )
    no_pictures = {"quiz", "flashcards", "interactive_games", "summary"}
    state.update(phase="writing", sections_total=n, sections_done=0, section="")
    logger.info("[html-doc] parallel plan: %d sections %s", n, [s["title"] for s in sections])

    done_html: list[str] = [""] * n
    budget = {"left": _MAX_AI_IMAGES}
    budget_lock = asyncio.Lock()
    images_total = {"n": 0}

    def refresh_live() -> None:
        live["html"] = _assemble(plan["title"], style_hero["style"], style_hero["hero"], done_html)
        state["content_chars"] = len(live["html"])

    async def write(i: int) -> None:
        sec = sections[i]
        cap = 0 if sec["type"] in no_pictures else 2
        raw, u2 = "", {}
        for attempt in range(2):
            try:
                raw, u2 = await _complete(
                    ctx, _section_prompt(body, materials, plan, i, graded_id, cap)
                )
                if raw.strip():
                    break
            except Exception as e:  # noqa: BLE001
                logger.warning("[html-doc] section %s attempt %d failed: %s", sec["id"], attempt + 1, e)
        _add_usage(usage, u2)
        frag = _extract_section(raw, sec["id"])
        # Pictures for this section start now, overlapping the other writers.
        frag, _ = adopt_foreign_images(frag, ctx.get("allowed_image_urls"))
        wanted = count_image_placeholders(frag)
        async with budget_lock:
            take = min(wanted, budget["left"])
            budget["left"] -= take
            images_total["n"] += take
            state["images_total"] = images_total["n"]
        done_html[i] = frag  # text first — the preview shows it while pictures draw
        state["sections_done"] = sum(1 for h in done_html if h)
        refresh_live()
        if wanted:
            async def on_progress(done_n: int, total_n: int) -> None:
                return None

            try:
                frag, got = await illustrate_document(frag, slide_path="html-doc", max_images=take, on_progress=on_progress)
            except Exception as e:  # noqa: BLE001
                logger.warning("[html-doc] section %s illustration failed: %s", sec["id"], e)
                got = 0
            state["images_done"] = int(state.get("images_done") or 0) + got
            done_html[i] = frag
            refresh_live()
        writing = [s["title"] for j, s in enumerate(sections) if not done_html[j]]
        state["section"] = ", ".join(writing[:3])

    state["section"] = ", ".join(s["title"] for s in sections[:3])
    refresh_live()
    tasks = [style_task] + [asyncio.create_task(write(i)) for i in range(n)]
    pending = set(tasks)
    while pending:
        _, pending = await asyncio.wait(pending, timeout=1.0)
        if cancelled.is_set():
            for t in pending:
                t.cancel()
            raise _JobCancelled(_CANCELLED_MSG)
        if all(done_html) and pending:
            state["phase"] = "images"
    for t in tasks:
        if t.exception():
            logger.warning("[html-doc] parallel task failed: %s", t.exception())
    if not any(done_html):
        raise RuntimeError("No section could be generated.")
    images = int(state.get("images_done") or 0)
    html_out = _assemble(plan["title"], style_hero["style"], style_hero["hero"], done_html)
    return html_out, images, usage


# ---------------------------------------------------------------------------
# Background jobs — generation that survives the author leaving the page.
#
# A generation is 3-10 minutes. Over SSE it died with the tab. Here the kickoff
# returns a task id at once and the work runs detached (ai_task_service), with
# progress — phase, current section, partial HTML, picture count — flushed to
# the ai_task row every couple of seconds. The client polls (any pod can answer:
# prod runs 2 replicas) and, on coming back to the slide, re-attaches by slide id
# and applies the finished page. Cancel = flip the row to FAILED; the worker
# notices on its next flush and stops (so no charge for a cancelled page).
# Caveat: the coroutine lives in one pod, so a deploy/restart mid-run loses it;
# a row that stops heartbeating is reported as INTERRUPTED so the UI can offer
# a retry instead of spinning forever.
# ---------------------------------------------------------------------------

from datetime import datetime, timezone  # noqa: E402

from sqlalchemy import text as sql_text  # noqa: E402

from ..db import db_session  # noqa: E402
from ..models.ai_task import AiTask, AiTaskInputType, AiTaskStatus, AiTaskType  # noqa: E402
from ..repositories.ai_task_repository import AiTaskRepository  # noqa: E402
from ..services import ai_task_service  # noqa: E402
from ..services.ai_task_service import AiTaskService  # noqa: E402

_JOB_FLUSH_SECONDS = 2.0
# No heartbeat for this long ⇒ the pod running it died (deploy/OOM).
_JOB_STALE_SECONDS = 90
# How far back "come back to the slide and pick the result up" looks.
_JOB_REATTACH_HOURS = 6
_CANCELLED_MSG = "Cancelled by user"
_H_TAG_RE = re.compile(r"<h[12][^>]*>([\s\S]*?)</h[12]>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


class HtmlDocJobRequest(GenerateHtmlRequest):
    slide_id: Optional[str] = Field(None, description="Slide this page is for — lets the editor re-attach.")


class _JobCancelled(Exception):
    pass


def _current_section(partial_html: str) -> str:
    """Heading of the section the model is writing right now (for the status line)."""
    heads = _H_TAG_RE.findall(partial_html[-20000:])
    if not heads:
        return ""
    title = re.sub(r"\s+", " ", _TAG_RE.sub("", heads[-1])).strip()
    return title[:80]


def _write_progress(task_id: str, status_message: str, result_json: Optional[str]) -> bool:
    """Heartbeat write. Returns False when the row is no longer PROGRESS (the
    author cancelled) so the worker can stop."""
    with db_session() as db:
        res = db.execute(
            sql_text(
                "UPDATE ai_task SET status_message = :sm, "
                "result_json = COALESCE(:rj, result_json), updated_at = now() "
                "WHERE id = :id AND status = 'PROGRESS'"
            ),
            {"sm": status_message, "rj": result_json, "id": task_id},
        )
        return (res.rowcount or 0) > 0


async def _run_job(task_id: str, body: HtmlDocJobRequest, ctx: dict) -> str:
    state = {
        "phase": "reading_pdf" if body.reference_file_ids else "planning",
        "reasoning_chars": 0,
        "content_chars": 0,
        "section": "",
        "images_done": 0,
        "images_total": 0,
        "is_edit": bool(body.current_html),
        "has_pdf": bool(body.reference_file_ids),
        "expected_chars": len(body.current_html) if body.current_html else None,
    }
    collected: list[str] = []
    # Parallel mode assembles the page itself; single-call mode streams chunks.
    live: dict = {"html": None}
    cancelled = asyncio.Event()
    finished = asyncio.Event()

    async def heartbeat() -> None:
        last_len = -1
        while not finished.is_set():
            partial = live["html"] if live["html"] is not None else "".join(collected)
            if partial and live["html"] is None:
                state["section"] = _current_section(partial) or state["section"]
            rj = json.dumps({"html": partial}) if len(partial) != last_len else None
            last_len = len(partial)
            try:
                alive = await asyncio.to_thread(_write_progress, task_id, json.dumps(state), rj)
                if not alive:
                    cancelled.set()
                    return
            except Exception:  # noqa: BLE001
                logger.warning("[html-doc] progress write failed for %s", task_id, exc_info=True)
            try:
                await asyncio.wait_for(finished.wait(), timeout=_JOB_FLUSH_SECONDS)
            except asyncio.TimeoutError:
                pass

    beat = asyncio.create_task(heartbeat())
    try:
        await _ground(body, ctx)
        if cancelled.is_set():
            raise _JobCancelled(_CANCELLED_MSG)
        if _PARALLEL and not body.current_html:
            try:
                result = await _generate_parallel(ctx, body, state, live, cancelled)
            except _JobCancelled:
                raise
            except Exception as e:  # noqa: BLE001
                logger.warning("[html-doc] parallel generation failed; falling back: %s", e)
                result = None
            if result is not None:
                html_out, images, usage = result
                if cancelled.is_set():
                    raise _JobCancelled(_CANCELLED_MSG)
                _bill(ctx, body, usage)
                _bill_images(ctx, body, images)
                logger.info(
                    "[html-doc] job %s done (parallel): %d chars, %d images, usage=%s",
                    task_id, len(html_out), images, usage,
                )
                return json.dumps({"html": html_out, "model": ctx["model"], "images": images})
            live["html"] = None
            state.update(sections_total=None, sections_done=None, content_chars=0)

        state["phase"] = "planning"
        usage: dict = {}
        async for kind, value in _stream_llm(ctx):
            if cancelled.is_set():
                raise _JobCancelled(_CANCELLED_MSG)
            if kind == "content":
                collected.append(value)
                state["phase"] = "writing"
                state["content_chars"] += len(value)
            elif kind == "reasoning":
                state["reasoning_chars"] += value
            elif kind == "usage":
                usage = value

        html_out = _strip_fence("".join(collected))
        if not html_out:
            raise RuntimeError("Model returned empty HTML.")

        async def on_progress(done_n: int, total_n: int) -> None:
            state["phase"] = "images"
            state["images_done"], state["images_total"] = done_n, total_n

        html_out, images = await _illustrate(ctx, html_out, on_progress)
        if cancelled.is_set():
            raise _JobCancelled(_CANCELLED_MSG)
        _bill(ctx, body, usage)
        _bill_images(ctx, body, images)
        logger.info(
            "[html-doc] job %s done: %d chars, %d images, usage=%s",
            task_id, len(html_out), images, usage,
        )
        return json.dumps({"html": html_out, "model": ctx["model"], "images": images})
    finally:
        finished.set()
        await asyncio.gather(beat, return_exceptions=True)


def _actor_institute(current_user, fallback: Optional[str]) -> Optional[str]:
    inst = getattr(current_user, "institute_id", None)
    if inst is None and isinstance(current_user, dict):
        inst = current_user.get("institute_id")
    return inst or fallback


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _job_view(task: AiTask, since: int = 0) -> dict:
    """Poll payload. `html` is the tail after `since` while running (so a poll
    every 2 s doesn't re-download the whole page) and the full page when done."""
    now = datetime.now(timezone.utc)
    created, updated = _aware(task.created_at), _aware(task.updated_at)
    status_ = task.status or ""
    progress: dict = {}
    error = ""
    html = ""
    try:
        data = json.loads(task.result_json) if task.result_json else {}
    except Exception:  # noqa: BLE001
        data = {}
    if status_ == AiTaskStatus.PROGRESS.value:
        try:
            progress = json.loads(task.status_message or "{}")
        except Exception:  # noqa: BLE001
            progress = {}
        if updated and (now - updated).total_seconds() > _JOB_STALE_SECONDS:
            status_ = "INTERRUPTED"
    elif status_ == AiTaskStatus.FAILED.value:
        error = task.status_message or "Generation failed."
        if error == _CANCELLED_MSG:
            status_ = "CANCELLED"
    full = data.get("html") or ""
    if status_ == AiTaskStatus.COMPLETED.value:
        html = full
    elif since < len(full):
        html = full[since:]
    try:
        dyn = json.loads(task.dynamic_values_map or "{}")
    except Exception:  # noqa: BLE001
        dyn = {}
    return {
        "task_id": task.id,
        "slide_id": task.input_id,
        "status": status_,
        "progress": progress,
        "html": html,
        "html_length": len(full),
        "model": data.get("model"),
        "images": data.get("images"),
        "error": error,
        "is_edit": bool(dyn.get("is_edit")),
        "acknowledged": bool(dyn.get("acked")),
        "elapsed_seconds": int((now - created).total_seconds()) if created else 0,
    }


def _load_job(db: Session, task_id: str, institute_id: Optional[str]) -> AiTask:
    task = AiTaskRepository(db).get(task_id)
    if (
        not task
        or task.task_type != AiTaskType.HTML_DOC_GENERATE.value
        or (institute_id and task.institute_id and task.institute_id != institute_id)
    ):
        raise HTTPException(status_code=404, detail="Generation not found.")
    return task


def _set_acked(db: Session, task: AiTask) -> None:
    try:
        dyn = json.loads(task.dynamic_values_map or "{}")
    except Exception:  # noqa: BLE001
        dyn = {}
    dyn["acked"] = True
    task.dynamic_values_map = json.dumps(dyn)
    db.commit()


@router.post("/v1/jobs")
async def start_html_document_job(
    body: HtmlDocJobRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
    request: Request = None,
) -> dict:
    """Start a generation that keeps running if the author leaves. Auth, input
    validation and the credit pre-flight still fail fast here (401/400/402)."""
    ctx = await _prepare(body, current_user, db, ground=False, request=request)
    repo = AiTaskRepository(db)

    # One live generation per slide: a double-click or a second tab re-attaches
    # to the running job instead of paying for two.
    if body.slide_id:
        running = (
            db.query(AiTask)
            .filter(
                AiTask.task_type == AiTaskType.HTML_DOC_GENERATE.value,
                AiTask.input_id == body.slide_id,
                AiTask.status == AiTaskStatus.PROGRESS.value,
            )
            .order_by(AiTask.created_at.desc())
            .first()
        )
        if running and _job_view(running)["status"] == AiTaskStatus.PROGRESS.value:
            return _job_view(running)

    task = AiTaskService(repo).create(
        task_type=AiTaskType.HTML_DOC_GENERATE,
        input_id=body.slide_id or "",
        input_type=AiTaskInputType.SLIDE_ID,
        task_name=(body.prompt or "HTML document")[:200],
        institute_id=ctx["institute_id"] or "",
        dynamic_values={"model": ctx["model"], "is_edit": bool(body.current_html)},
    )
    # Retries of the same job must never double-charge.
    if not body.idempotency_key:
        body.idempotency_key = f"html-doc-job:{task.id}"

    async def _work() -> str:
        return await _run_job(task.id, body, ctx)

    ai_task_service.schedule(task.id, _work)
    logger.info("[html-doc] job %s started (slide=%s model=%s)", task.id, body.slide_id, ctx["model"])
    return _job_view(task)


@router.get("/v1/jobs/active")
async def get_active_html_document_job(
    slide_id: str,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
) -> dict:
    """The slide's latest generation the editor hasn't picked up yet — running,
    finished while the author was away, or failed/interrupted. {"job": null}
    when there is nothing to show."""
    institute_id = _actor_institute(current_user, None)
    since = datetime.now(timezone.utc).timestamp() - _JOB_REATTACH_HOURS * 3600
    q = db.query(AiTask).filter(
        AiTask.task_type == AiTaskType.HTML_DOC_GENERATE.value,
        AiTask.input_id == slide_id,
        AiTask.created_at >= datetime.fromtimestamp(since, tz=timezone.utc),
    )
    if institute_id:
        q = q.filter(AiTask.institute_id == institute_id)
    task = q.order_by(AiTask.created_at.desc()).first()
    if not task:
        return {"job": None}
    view = _job_view(task)
    if view["acknowledged"] or view["status"] == "CANCELLED":
        return {"job": None}
    return {"job": view}


@router.get("/v1/jobs/{task_id}")
async def get_html_document_job(
    task_id: str,
    since: int = 0,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
) -> dict:
    task = _load_job(db, task_id, _actor_institute(current_user, None))
    return _job_view(task, max(0, since))


@router.post("/v1/jobs/{task_id}/cancel")
async def cancel_html_document_job(
    task_id: str,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
) -> dict:
    task = _load_job(db, task_id, _actor_institute(current_user, None))
    if task.status == AiTaskStatus.PROGRESS.value:
        task.status = AiTaskStatus.FAILED.value
        task.status_message = _CANCELLED_MSG
    _set_acked(db, task)
    return _job_view(task)


@router.post("/v1/jobs/{task_id}/ack")
async def ack_html_document_job(
    task_id: str,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
) -> dict:
    """The editor applied (or dismissed) this result — stop offering it."""
    task = _load_job(db, task_id, _actor_institute(current_user, None))
    _set_acked(db, task)
    return {"ok": True}
