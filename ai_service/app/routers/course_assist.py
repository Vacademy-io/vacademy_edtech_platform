"""
Course Field AI Assist — inline "generate with AI" on the manual Add Course form.

Two small prompt-in endpoints:
  POST /course/assist/v1/text   → rich-HTML copy for one course field
  POST /course/assist/v1/image  → preview/banner/media artwork, returned base64

Pricing is flat by product spec: any text = 1 credit, any image = 5 credits
(with billing.image_registry_pricing = on, an image is priced from the model
registry instead).
Affordability is gated up-front (402); the charge lands post-success as a
precomputed deduction (allow_negative, so delivered work is never silently
unbilled if a concurrent spend raced the pre-flight). Both the pre-flight and
the charge run on short-lived sessions so a billing failure can never leave a
half-applied balance write on the request session.

The image comes back base64 rather than as an S3 URL so the frontend can push
it through the normal media-service upload flow and store a fileId exactly
like a manual upload — the course DTO never learns a second image shape.
"""
from __future__ import annotations

import base64
import logging
import os
import re
import uuid
from decimal import Decimal
from typing import Any, Optional

import httpx
from ..services.llm_router import ChainExhausted, chat_with_chain, post_chat
from ..services.use_case_chat import models_for

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..db import db_session
from ..models.ai_token_usage import RequestType
from ..schemas.credits import CreditDeductRequest  # noqa: F401
from ..services.ai_billing import UC
from ..services.credit_service import CreditService
from ..services.image_model_resolver import (
    COURSE_ASSIST_IMAGE, PRICING_ON, PRICING_SHADOW, image_model_for, plan_image_charge,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/course/assist", tags=["course-assist"])

# Copywriting runs on the 'course_assist' use case (ai_model_defaults, set in
# the super-admin portal; GLM by default) with its fallback chain;
# COURSE_ASSIST_TEXT_MODEL, when set, is tried first (emergency override).
# Images route the Google image model through OpenRouter's billed account
# (free-tier direct quota is 0). COURSE_ASSIST_IMAGE_MODEL (env) wins, else the
# 'course_assist_image' use case, else the literal; chat-completions image
# models only (the call sends `modalities`).
_TEXT_USE_CASE = "course_assist"
_TEXT_MODEL_ENV = "COURSE_ASSIST_TEXT_MODEL"
_IMAGE_MODEL_ENV = os.getenv("COURSE_ASSIST_IMAGE_MODEL")
_IMAGE_MODEL_DEFAULT = "google/gemini-3.1-flash-image"
_IMAGE_MODEL = _IMAGE_MODEL_ENV or _IMAGE_MODEL_DEFAULT
_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

_TEXT_COST = Decimal("1")
_IMAGE_COST = Decimal("5")


def _image_model() -> str:
    return _IMAGE_MODEL_ENV or image_model_for(COURSE_ASSIST_IMAGE, _IMAGE_MODEL_DEFAULT)


def _image_cost(model: str) -> Decimal:
    """Credits for one image: the flat product price, unless
    billing.image_registry_pricing is 'on' and the registry can price the
    model ('shadow' only logs the registry figure). Never raises."""
    try:
        charge = plan_image_charge(model, 1, feature="course_assist_image")
    except Exception as e:  # noqa: BLE001
        logger.warning("[course-assist] image pricing plan failed (%s); flat price", e)
        return _IMAGE_COST
    if charge.mode == PRICING_SHADOW and charge.would_be_credits is not None:
        logger.info("[course-assist] image would_be_credits=%s (charged %s)", charge.would_be_credits, _IMAGE_COST)
    if charge.mode == PRICING_ON and charge.precomputed_credits is not None:
        return charge.precomputed_credits
    return _IMAGE_COST

_IMAGE_ASPECTS = {"16:9", "4:3", "1:1", "3:4", "9:16", "3:2", "2:3"}

# Per-field editorial guidance. Keys mirror the step-1 form field names.
_FIELD_BRIEFS = {
    "description": (
        "a course description for the course card and detail page: an engaging "
        "opening line, then 2-3 short paragraphs covering what the course is, "
        "how it is taught, and why it matters. 80-150 words."
    ),
    "learningOutcome": (
        "a 'What learners will gain' section: one short lead-in sentence "
        "followed by a bullet list of 4-6 concrete, skill-focused outcomes."
    ),
    "aboutCourse": (
        "an 'About this course' section: 2-3 paragraphs on the syllabus scope, "
        "teaching approach, and any certification or practical work. 100-180 words."
    ),
    "targetAudience": (
        "a 'Who should join' section: one lead-in sentence followed by a bullet "
        "list of 3-5 learner profiles this course fits."
    ),
}
_GENERIC_BRIEF = "well-structured marketing copy for a course page section."

_IMAGE_KIND_BRIEFS = {
    "preview": "a course card thumbnail (wide landscape, subject clearly readable at small sizes)",
    "banner": "a wide banner background for the top of a course detail page (calm composition with safe space for overlaid text)",
    "media": "an illustrative feature image for a course page",
}

_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*|```\s*$")


class AssistTextRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000, description="Admin's instruction for the copy")
    field: Optional[str] = Field(None, max_length=64, description="Form field key (description|learningOutcome|aboutCourse|targetAudience)")
    course_name: Optional[str] = Field(None, max_length=255)
    existing_html: Optional[str] = Field(None, max_length=20000, description="Current field content, when refining instead of writing fresh")


class AssistTextResponse(BaseModel):
    html: str
    model: str
    # float, not Decimal — pydantic v2 serializes Decimal as a JSON string.
    credits_charged: float


_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")


class AssistImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    kind: Optional[str] = Field(None, max_length=32, description="preview|banner|media — picks default framing")
    course_name: Optional[str] = Field(None, max_length=255)
    aspect_ratio: Optional[str] = Field(None, max_length=8)
    # Institute branding (opt-in from the FE): palette hints woven into the
    # prompt, and the logo passed to the image model as a reference input.
    brand_colors: Optional[list[str]] = Field(None, max_length=4, description="Hex colors like #1B73E8")
    logo_url: Optional[str] = Field(None, max_length=2000, description="Public https URL of the institute logo")


class AssistImageResponse(BaseModel):
    image_base64: str
    mime_type: str
    model: str
    credits_charged: float


def _principal(current_user) -> tuple[str, Optional[str]]:
    """Institute comes ONLY from the authenticated principal — never from the
    body, so a caller can't bill (or probe) another institute's credits."""
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    institute_id = getattr(current_user, "institute_id", None)
    if not institute_id:
        raise HTTPException(status_code=400, detail="No institute context on this session.")
    return institute_id, getattr(current_user, "user_id", None)


def _metering(request: Optional[Request], institute_id: str, current_user: Any, user_id: Optional[str]) -> Any:
    """Usage-event attribution (never changes a charge)."""
    from ..services.ai_billing import metering_from_request, metering_user
    return metering_from_request(request, institute_id, user=current_user) or metering_user(user_id, surface="ADMIN_APP")


def _require_balance(institute_id: str, cost: Decimal, label: str) -> None:
    """Pre-flight affordability gate on a short-lived session, so no
    transaction stays open across the (up to 90s) provider call."""
    with db_session() as db:
        balance = CreditService(db).ensure_credits_exist(institute_id)
        current = balance.current_balance
    if current < cost:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits: {label} needs {cost} credits "
                f"but the balance is {current}."
            ),
        )


def _charge(
    institute_id: str,
    user_id: Optional[str],
    cost: Decimal,
    request_type: RequestType,
    model: str,
    description: str,
    run_id: str,
    *,
    use_case: Optional[str] = None,
    metering: Any = None,
    usage_context: Optional[dict] = None,
) -> Decimal:
    """Flat post-success charge on a fresh session (mirrors ai_billing) — a
    failed deduction rolls back whole, never leaving a balance decrement
    without its ledger row. Best-effort: delivered work is still returned.

    Returns what the wallet was actually charged: 0 when an AI plan includes
    the use or its allowance paid (the list price is still metered), the
    flat cost when the deduction failed (as reported before)."""
    try:
        from ..services.ai_billing import build_deduct_request, metering_kwargs
        # Usage-event attribution only (optional request fields; the charge and
        # the ledger row are exactly as before).
        meter = metering_kwargs(use_case, metering, usage_context)
        with db_session() as db:
            res = CreditService(db).deduct_credits(build_deduct_request(
                meter,
                institute_id=institute_id,
                request_type=request_type.value,
                model=model,
                precomputed_credits=cost,
                description=description,
                idempotency_key=f"course-assist:{run_id}",
                user_id=user_id,
                allow_negative=True,
            ))
        deducted = getattr(res, "credits_deducted", None)
        return Decimal(str(deducted)) if deducted is not None else cost
    except Exception as e:  # noqa: BLE001
        logger.error("[course-assist] charge failed (institute=%s, %s): %s", institute_id, description, e)
        return cost


def _sanitize_html(value: str) -> str:
    """Output lands in a TipTap editor and is later rendered on learner pages —
    scrub it like every other model-authored rich-text string."""
    value = _FENCE_RE.sub("", value.strip()).strip()
    try:
        import nh3
        return nh3.clean(value)
    except Exception:  # noqa: BLE001 — sanitizer unavailable: strip all tags
        return re.sub(r"<[^>]*>", "", value)


def _build_text_prompt(body: AssistTextRequest) -> str:
    brief = _FIELD_BRIEFS.get(body.field or "", _GENERIC_BRIEF)
    parts = [
        "You are a copywriter for an online education platform. Write", brief,
        "\n\nReturn ONLY an HTML fragment — no markdown, no code fences, no <html>/<head>/<body>, "
        "no inline styles or classes. Allowed tags: <p>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <h3>, <br>. "
        "Plain professional English unless the instruction asks for another language or tone.",
    ]
    if body.course_name:
        parts.append(f"\n\nCourse name: {body.course_name}")
    if body.existing_html:
        parts.append(
            "\n\nCurrent content (rewrite/improve it per the instruction rather than starting from scratch):\n"
            + body.existing_html
        )
    parts.append(f"\n\nAdmin's instruction:\n{body.prompt}")
    return " ".join(parts[:2]) + "".join(parts[2:])


async def _openrouter_chat(payload: dict) -> httpx.Response:
    from ..config import get_settings
    key = getattr(get_settings(), "openrouter_api_key", None)
    if not key:
        raise HTTPException(status_code=503, detail="AI provider is not configured.")
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            return await post_chat(client, payload, key)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Generation timed out. Please try again.")
    except httpx.HTTPError as e:
        logger.error("[course-assist] OpenRouter request failed: %s", e)
        raise HTTPException(status_code=502, detail="Generation failed. Please try again.")


async def _text_chat(payload: dict):
    """One copywriting call through the model chain (GLM gets reasoning low and
    max_tokens headroom on both gateway legs). Raises 503/502 HTTPExceptions."""
    from ..config import get_settings
    key = getattr(get_settings(), "openrouter_api_key", None)
    if not key:
        raise HTTPException(status_code=503, detail="AI provider is not configured.")
    try:
        return await chat_with_chain(
            payload, _TEXT_USE_CASE, models=models_for(_TEXT_USE_CASE, env=_TEXT_MODEL_ENV),
            api_key=key, timeout=90.0,
        )
    except ChainExhausted as e:
        logger.error("[course-assist] text generation failed: %s", e)
        raise HTTPException(status_code=502, detail="Text generation failed. Please try again.")


@router.post("/v1/text", response_model=AssistTextResponse)
async def generate_field_text(
    body: AssistTextRequest,
    current_user=Depends(get_current_user),
    request: Request = None,
) -> AssistTextResponse:
    institute_id, user_id = _principal(current_user)
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="A prompt is required.")
    _require_balance(institute_id, _TEXT_COST, "generating this text")

    result = await _text_chat({
        "messages": [{"role": "user", "content": _build_text_prompt(body)}],
        "temperature": 0.7,
    })
    html = _sanitize_html(result.content)
    if not html:
        raise HTTPException(status_code=502, detail="Text generation returned no content. Please try again.")

    run_id = uuid.uuid4().hex
    charged = _charge(
        institute_id, user_id, _TEXT_COST, RequestType.CONTENT, result.model,
        f"Course field AI assist: {body.field or 'text'}", run_id,
        use_case=UC.COURSE_ASSIST, metering=_metering(request, institute_id, current_user, user_id),
        usage_context={"field": body.field, "course_name": body.course_name, "run_id": run_id},
    )
    return AssistTextResponse(html=html, model=result.model, credits_charged=float(charged))


@router.post("/v1/image", response_model=AssistImageResponse)
async def generate_field_image(
    body: AssistImageRequest,
    current_user=Depends(get_current_user),
    request: Request = None,
) -> AssistImageResponse:
    institute_id, user_id = _principal(current_user)
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="A prompt is required.")
    image_model = _image_model()
    image_cost = _image_cost(image_model)
    _require_balance(institute_id, image_cost, "generating this image")

    kind_brief = _IMAGE_KIND_BRIEFS.get(body.kind or "", _IMAGE_KIND_BRIEFS["media"])
    prompt = (
        f"Generate {kind_brief} for an online course"
        + (f" named \"{body.course_name}\"" if body.course_name else "")
        + f". {body.prompt.strip()}. "
        "High quality, cohesive palette, no watermarks; no embedded text unless explicitly requested."
    )

    brand_colors = [c for c in (body.brand_colors or []) if _HEX_COLOR_RE.match(c)]
    if brand_colors:
        prompt += (
            f" Build the color scheme around the institute's brand palette ({', '.join(brand_colors)}) — "
            "use these hues prominently but harmoniously."
        )
    logo_url = body.logo_url if body.logo_url and body.logo_url.startswith("https://") else None
    if logo_url:
        prompt += (
            " The attached image is the institute's logo: incorporate it tastefully and legibly "
            "(e.g. small placement in a corner or subtly worked into the composition), keeping its "
            "exact shape, colors and proportions — never redraw, distort or recolor it."
        )
    aspect = body.aspect_ratio if body.aspect_ratio in _IMAGE_ASPECTS else "16:9"

    content: object = prompt
    if logo_url:
        content = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": logo_url}},
        ]
    resp = await _openrouter_chat({
        "model": image_model,
        "messages": [{"role": "user", "content": content}],
        "modalities": ["image"],
        "image_config": {"aspect_ratio": aspect},
    })
    if resp.status_code != 200:
        logger.error("[course-assist] image %s: %s", resp.status_code, resp.text[:300])
        raise HTTPException(status_code=502, detail="Image generation failed. Please try again.")

    try:
        resp_data = resp.json()
    except Exception:  # noqa: BLE001 — 200 with a truncated/non-JSON body
        logger.error("[course-assist] image response not JSON: %s", resp.text[:300])
        raise HTTPException(status_code=502, detail="Image generation failed. Please try again.")

    image_b64 = None
    mime_type = "image/png"
    for choice in resp_data.get("choices") or []:
        for image in (choice.get("message") or {}).get("images", []) or []:
            url = (image.get("image_url") or {}).get("url", "")
            if url:
                if "," in url:
                    header, image_b64 = url.split(",", 1)
                    match = re.match(r"^data:([^;]+);", header)
                    if match:
                        mime_type = match.group(1)
                else:
                    image_b64 = url
                break
        if image_b64:
            break
    if not image_b64:
        raise HTTPException(status_code=502, detail="Image generation returned no image. Please try again.")
    # Lenient decode (mirrors image_service): providers may wrap/pad the b64.
    image_b64 = re.sub(r"\s+", "", image_b64)
    try:
        decoded = base64.b64decode(image_b64)
        if not decoded:
            raise ValueError("empty image payload")
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Image generation returned malformed data. Please try again.")

    run_id = uuid.uuid4().hex
    charged = _charge(
        institute_id, user_id, image_cost, RequestType.IMAGE, image_model,
        f"Course image AI assist: {body.kind or 'image'}", run_id,
        use_case=UC.COURSE_ASSIST_IMAGE, metering=_metering(request, institute_id, current_user, user_id),
        usage_context={"kind": body.kind, "course_name": body.course_name, "run_id": run_id},
    )
    return AssistImageResponse(
        image_base64=image_b64, mime_type=mime_type, model=image_model, credits_charged=float(charged),
    )
