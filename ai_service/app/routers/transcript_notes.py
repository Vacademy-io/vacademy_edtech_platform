"""
Router for turning a lecture transcript into clean, structured study notes.

Used by the "View Transcript → Study Notes" tab in the live-session UI.
Returns Markdown so the caller can render with react-markdown in the
browser. We deliberately do NOT return a JSON outline — students/teachers
read these as notes, not parse them.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from ..services.llm_router import chat_with_chain
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..core.security import get_current_user
from ..db import db_dependency
from ..models.ai_token_usage import RequestType
from ..services.ai_billing import preflight_tool_credits, record_tool_billing


def _role_from_user(user) -> str:
    """Map an authenticated user to a ledger user_role. Treats any staff member
    as TEACHER vs ADMIN by their roles/authorities; defaults to ADMIN."""
    if user is None:
        return "ADMIN"
    raw = getattr(user, "roles", None) or getattr(user, "authorities", None)
    if raw is None and isinstance(user, dict):
        raw = user.get("roles") or user.get("authorities")
    roles = {str(r).upper() for r in (raw or [])}
    if "ADMIN" in roles or any("ADMIN" in r for r in roles):
        return "ADMIN"
    if "TEACHER" in roles or any("TEACHER" in r for r in roles):
        return "TEACHER"
    return "ADMIN"

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transcript", tags=["transcript-notes"])


class GenerateNotesRequest(BaseModel):
    transcript_text: str = Field(..., min_length=10)
    # Optional hints — UI may forward the recording title and the detected
    # language so the model produces notes in the right tongue with a
    # sensible top-level heading.
    title_hint: Optional[str] = None
    target_language: str = Field(
        default="en",
        description="ISO code. Output notes will be in this language.",
    )
    institute_id: Optional[str] = Field(
        None,
        description=(
            "Institute to charge for these notes (academy-credits). When "
            "omitted, generation still runs but no credits are deducted."
        ),
    )
    user_id: Optional[str] = Field(
        None,
        description="DEPRECATED for attribution — the actor is now derived from "
                    "the authenticated JWT, not this field. Kept for back-compat.",
    )
    idempotency_key: Optional[str] = Field(
        None,
        description="Dedup key so a retry can't double-charge. FE sends "
                    "'notes:{recordingId}'.",
    )


class GenerateNotesResponse(BaseModel):
    markdown: str
    model: str


# OpenRouter is the sole provider — it isn't subject to per-project Google
# Cloud restrictions, and the direct-Gemini fallback was retired (that key
# was free-tier with a zero image quota; text now runs through OpenRouter
# only, using Google's model via the billed OpenRouter account).
#
# The model comes from the 'transcript_notes' use case (ai_model_defaults, set
# in the super-admin portal; GLM by default) and fails over through its chain.
_USE_CASE = "transcript_notes"

# Placeholder the LLM emits on a line after each visual-concept H2 section
# (see the prompt rule #10). Format: `<!--IMG: search query-->`. Captured
# group is trimmed before being handed to Serper. Cap below limits Serper
# calls per notes document — anything beyond 5 just clutters the page.
_IMG_PLACEHOLDER_RE = re.compile(r"<!--\s*IMG\s*:\s*(.+?)\s*-->", re.IGNORECASE)
_MAX_IMAGES_PER_NOTES = 5


_LANG_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "pa": "Punjabi",
    "ur": "Urdu",
}


def _build_prompt(transcript: str, title_hint: Optional[str], target_language: str) -> str:
    lang_name = _LANG_NAMES.get(target_language.lower(), "English")
    title_line = (
        f"Suggested top-level title: {title_hint}\n"
        if title_hint
        else "Pick a concise top-level title that summarises the lecture.\n"
    )
    return (
        f"You are an expert study-notes editor. Convert the following "
        f"lecture transcript into rich, well-structured study notes in "
        f"{lang_name} that a student can revise from. Write clean Markdown "
        "following these rules strictly:\n\n"
        "STRUCTURE\n"
        "1. Start with a single H1 (`# Title`) line — a concise topic "
        "title (NOT 'Study Notes' or the recording id).\n"
        "2. Use H2 (`##`) for each major topic / concept covered in the "
        "lecture. Aim for 3–7 H2 sections depending on lecture length.\n"
        "3. Use H3 (`###`) for sub-topics within a section.\n"
        "4. End each H2 section with a `> Key takeaway:` blockquote — a "
        "one-line summary a student can re-read just before an exam.\n\n"
        "VOICE & CONTENT\n"
        "5. Prefer tight bullet points (`-`) over long paragraphs. Each "
        "bullet should hold ONE idea, ~12–25 words.\n"
        "6. Bold every key term on first appearance with `**term**` "
        "(e.g. `**hypotonic solution**`).\n"
        "7. When the transcript explicitly *defines* something, format "
        "it as `**Term**: definition` on its own bullet.\n"
        "8. When the transcript gives an *example*, format it as "
        "`*Example*: …` on its own bullet.\n"
        "9. Skip filler ('um', 'so', 'right'), repetition, false starts, "
        "and audio glitches. Compress redundant explanations.\n"
        "10. Do not invent facts. If the transcript is too short or noisy "
        "to produce real notes, output a short Markdown paragraph saying "
        "so politely.\n\n"
        "COMPARISONS — USE TABLES\n"
        "11. When the lecture compares 2+ items along the same axes "
        "(e.g. hypertonic vs hypotonic vs isotonic; mitosis vs meiosis; "
        "DNA vs RNA), output a Markdown table:\n"
        "    | Feature | Item A | Item B | Item C |\n"
        "    | --- | --- | --- | --- |\n"
        "    | Property 1 | … | … | … |\n"
        "    Tables make comparisons scannable — use them whenever 2+ "
        "items share a structure. Don't force tables when only one "
        "concept is being explained.\n\n"
        "FORMULAS & CODE\n"
        "12. Use fenced code blocks (```) only for actual code, "
        "equations, or step-by-step procedures. Don't wrap regular "
        "definitions in code blocks.\n\n"
        "IMAGES\n"
        "13. For each H2 section that has a CONCRETE visual concept "
        "(diagram, anatomy, process, equipment, historical figure, "
        "location, chart), add ONE image placeholder on a line of its "
        "own immediately after the H2 heading, in the exact format:\n"
        "    <!--IMG: short English search query-->\n"
        "    Pick queries that would return clear educational "
        "illustrations (e.g. `photosynthesis diagram`, `chloroplast "
        "structure`, `Newton's third law`, `mitosis stages`). ALWAYS "
        "write the query in English even when the notes are in another "
        "language. Skip the placeholder for purely conceptual sections "
        "(Q&A recap, homework, history of who-coined-the-term, etc.) — "
        "max one image per section, no images in introductions or "
        "closing summaries.\n\n"
        "CLEANLINESS\n"
        "14. No stray HTML, no horizontal rules, no triple-backtick "
        "wrapper around the whole document.\n"
        "15. Maintain consistent terminology — pick one variant of each "
        "term and stick with it (e.g. always 'hypertonic' not "
        "alternating 'hyper-tonic' / 'hypertonic').\n\n"
        f"{title_line}\n"
        "--- TRANSCRIPT ---\n"
        f"{transcript}\n"
        "--- END TRANSCRIPT ---\n\n"
        "Respond with the Markdown only — no preamble, no commentary, "
        "no triple-backtick wrapper around the whole document."
    )


async def _call_openrouter(prompt: str, api_key: str, db: Optional[Session] = None) -> tuple[str, str]:
    """One notes generation through the 'transcript_notes' model chain (GLM
    gets reasoning low and max_tokens headroom on both gateway legs). Returns
    (markdown, registry model id that answered). Raises ChainExhausted when
    every model failed or returned nothing."""
    result = await chat_with_chain(
        {
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 8192,
        },
        _USE_CASE,
        db=db,
        api_key=api_key,
        timeout=120.0,
    )
    return result.content, result.model


def _enrich_with_images(markdown: str) -> str:
    """Replace every `<!--IMG:query-->` placeholder the LLM emitted with a
    real markdown image referencing a Serper search hit.

    Best-effort: when Serper isn't configured (settings.serper_api_keys empty)
    OR the search returns no results, the placeholder is silently dropped so
    the notes still render cleanly. Falling back to "image missing" UX is
    always better than surfacing the broken placeholder to the user.

    Capped at {_MAX_IMAGES_PER_NOTES} images per document — that's enough for
    a typical 60-90min lecture without making the PDF download huge.

    Lazy-imports the Serper client because it lives under the ai-video-gen
    namespace (the codebase keeps it there to avoid polluting top-level
    services). Skipping all the way through when no key is configured means
    we never pay even the import cost in unrelated environments.
    """
    settings = get_settings()
    serper_keys: str = (getattr(settings, "serper_api_keys", "") or "").strip()
    if not serper_keys:
        # Strip placeholders so they don't leak into the rendered markdown.
        return _IMG_PLACEHOLDER_RE.sub("", markdown)

    matches = list(_IMG_PLACEHOLDER_RE.finditer(markdown))
    if not matches:
        return markdown

    # Lazy import — see docstring.
    try:
        # `ai-video-gen-main` is a directory with a hyphen, so it's not a
        # regular python package. The pipeline brings it in via sys.path
        # manipulation. Repeat the same pattern here, scoped to this call.
        import sys
        from pathlib import Path
        avg_path = str(Path(__file__).resolve().parents[1] / "ai-video-gen-main")
        if avg_path not in sys.path:
            sys.path.insert(0, avg_path)
        from serper_service import SerperService  # type: ignore
    except Exception as e:
        logger.warning("[transcript-notes] could not load SerperService: %s", e)
        return _IMG_PLACEHOLDER_RE.sub("", markdown)

    svc = SerperService(serper_keys)

    # Build replacements in one pass keyed by original-match-text so we don't
    # call Serper twice for the same query if the LLM happened to repeat it.
    replacements: dict[str, str] = {}
    used = 0
    for m in matches:
        if used >= _MAX_IMAGES_PER_NOTES:
            break
        original = m.group(0)
        if original in replacements:
            continue
        query = m.group(1).strip()
        if not query:
            replacements[original] = ""
            continue
        try:
            img = svc.best_image(query, orientation="landscape")
        except Exception as e:
            logger.warning("[transcript-notes] Serper search failed for %r: %s", query, e)
            img = None
        if img and img.get("url"):
            # Markdown image. Alt text doubles as a caption-ish line for PDFs
            # rendered without image-loading (e.g. text-only fallback).
            alt = query.replace("]", "").replace("[", "")
            replacements[original] = f"![{alt}]({img['url']})"
            used += 1
        else:
            replacements[original] = ""

    # Replace each unique placeholder once. We do the substitution by re-running
    # the regex with a function so we leave any *extra* placeholders (past the
    # cap, or duplicates) cleanly stripped.
    def _sub(m: re.Match) -> str:
        original = m.group(0)
        return replacements.get(original, "")

    return _IMG_PLACEHOLDER_RE.sub(_sub, markdown)


def _strip_outer_markdown_fence(text: str) -> str:
    """If the model wrapped the whole document in ```markdown fences, strip them
    so react-markdown doesn't render a single huge code block."""
    stripped = text.strip()
    if not stripped.startswith("```"):
        return text
    first_newline = stripped.find("\n")
    if first_newline == -1 or not stripped.rstrip().endswith("```"):
        return text
    inner = stripped[first_newline + 1:].rstrip()
    if inner.endswith("```"):
        inner = inner[:-3].rstrip()
    return inner


@router.post("/generate-notes", response_model=GenerateNotesResponse)
async def generate_notes(
    body: GenerateNotesRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
) -> GenerateNotesResponse:
    # Require a verified user (this endpoint runs billable LLM calls and deducts
    # credits). Without auth a caller could drain any institute's credits and run
    # an unauthenticated LLM proxy.
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    actor_user_id = getattr(current_user, "user_id", None)
    if actor_user_id is None and isinstance(current_user, dict):
        actor_user_id = current_user.get("user_id")
    # Trust the institute from the verified token; fall back to the body only when
    # the token doesn't carry one (e.g. a service-to-service caller).
    token_institute = getattr(current_user, "institute_id", None)
    if token_institute is None and isinstance(current_user, dict):
        token_institute = current_user.get("institute_id")
    institute_id = token_institute or body.institute_id
    actor_role = _role_from_user(current_user)

    settings = get_settings()
    openrouter_key: Optional[str] = getattr(settings, "openrouter_api_key", None)

    if not openrouter_key:
        raise HTTPException(
            status_code=503,
            detail="No LLM provider configured. Set OPENROUTER_API_KEY on ai-service.",
        )

    # Pre-flight credit gate (academy-credits). notes cost is parametric on
    # transcript length. Only gates when an institute_id is resolved.
    notes_params = {"transcript_chars": len(body.transcript_text or "")}
    estimate = preflight_tool_credits(
        db, tool_key="notes", tool_params=notes_params, institute_id=institute_id
    )
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits: these notes need ~{estimate['estimated_credits']} "
                f"credits but the balance is {estimate.get('current_balance')}."
            ),
        )

    prompt = _build_prompt(
        transcript=body.transcript_text,
        title_hint=body.title_hint,
        target_language=body.target_language,
    )

    # Track per-provider failures so the final HTTPException tells the caller
    # exactly which providers were tried and why each rejected the request —
    # otherwise users get a generic 502 and operators have to grep logs.
    failures: list[str] = []
    markdown: Optional[str] = None
    used_model: Optional[str] = None

    # OpenRouter is the sole provider. It works around per-project Google API
    # restrictions because OpenRouter holds the upstream Google relationship,
    # not us (the direct-Gemini fallback was retired).
    if openrouter_key:
        try:
            markdown, used_model = await _call_openrouter(prompt, openrouter_key, db)
        except Exception as e:  # ChainExhausted carries every model's reason
            logger.warning("[transcript-notes] openrouter failed: %s", e)
            failures.append(f"OpenRouter: {e}")
    else:
        failures.append("OpenRouter: no key configured")

    if markdown is None:
        raise HTTPException(
            status_code=502,
            detail="All LLM providers failed - " + "; ".join(failures),
        )

    cleaned_markdown = _strip_outer_markdown_fence(markdown)
    # Best-effort image enrichment: replaces <!--IMG:query--> placeholders the
    # LLM emitted with real Serper hits. Silently strips placeholders when
    # Serper isn't configured so the notes still render cleanly.
    enriched_markdown = _enrich_with_images(cleaned_markdown)

    # Charge credits (parametric on transcript length). Best-effort — notes are
    # already generated. No token usage is surfaced by the provider helpers, so
    # this is parametric-only (charge = parametric).
    record_tool_billing(
        tool_key="notes",
        tool_params=notes_params,
        request_type=RequestType.NOTES,
        model=used_model,
        institute_id=institute_id,
        user_id=actor_user_id,
        user_role=actor_role if actor_user_id else None,
        idempotency_key=body.idempotency_key,
    )

    return GenerateNotesResponse(
        markdown=enriched_markdown,
        model=used_model,
    )
