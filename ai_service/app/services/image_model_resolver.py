"""Image model per feature, and the switch that prices images from the registry.

Image models used to be string literals in each feature (page builder, course
assist, quiz figures, document illustrations, the video pipeline). They now
read their own `ai_model_defaults` row, so the super-admin portal can change
them without a deploy:

    page_builder_image     google/gemini-3.1-flash-image
    course_assist_image    google/gemini-3.1-flash-image
    quiz_image             google/gemini-3.1-flash-image
    document_image         qwen/qwen-image-3
    video_image            recraft/recraft-v4.1
    video_support_visual   bytedance-seed/seedream-4.5

Each call site passes TODAY's literal as `hard_default`, and the Flyway seed
writes the same literal, so with the row present or absent nothing changes.

`image_model_for` reads ONLY `default_model_id`. It deliberately does not go
through `model_selection.resolve_models`, which appends text-model fallbacks
(GLM, gemini-2.5-flash) that are meaningless for an image call. Env overrides
(PAGE_IMAGE_MODEL, COURSE_ASSIST_IMAGE_MODEL, DOC_IMAGE_MODEL) and explicit
`model_override` arguments stay at the call site and keep winning.

`billing.image_registry_pricing` (platform setting, default "off"):
  * off    — charge exactly as before (flat `credit_pricing['image']`, or the
             feature's own flat price).
  * shadow — charge as before, and log/record what registry pricing WOULD
             charge (`would_be_credits`) so it can be compared first.
  * on     — charge `ai_models.image_price_per_unit` x the live credit ratio.
A settings read error never changes billing: it reads as "off".
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import text

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 30.0

PAGE_BUILDER_IMAGE = "page_builder_image"
COURSE_ASSIST_IMAGE = "course_assist_image"
QUIZ_IMAGE = "quiz_image"
DOCUMENT_IMAGE = "document_image"
VIDEO_IMAGE = "video_image"
VIDEO_SUPPORT_VISUAL = "video_support_visual"

# use_case -> (monotonic stamp, default_model_id or None for "no row / blank").
_CACHE: Dict[str, Tuple[float, Optional[str]]] = {}
_CACHE_LOCK = threading.Lock()
# Use cases with a background refresh in flight.
_REFRESHING: set = set()


def invalidate_cache(use_case: Optional[str] = None) -> None:
    """Drop the cached row for one use case (or all), on this process only."""
    with _CACHE_LOCK:
        if use_case is None:
            _CACHE.clear()
        else:
            _CACHE.pop(use_case, None)


def _lookup(db: Any, use_case: str) -> Optional[str]:
    """default_model_id for `use_case` (None when the row is missing or blank).
    Raises on a DB error so the caller can keep the last good value."""
    query = text("SELECT default_model_id FROM ai_model_defaults WHERE use_case = :uc")
    if db is not None:
        row = db.execute(query, {"uc": use_case}).fetchone()
    else:
        from ..db import db_session

        with db_session() as session:
            row = session.execute(query, {"uc": use_case}).fetchone()
    value = str(row[0]).strip() if row and row[0] is not None else ""
    return value or None


def _on_event_loop() -> bool:
    """True when called from a thread that is running an asyncio loop."""
    try:
        import asyncio

        asyncio.get_running_loop()
        return True
    except RuntimeError:
        return False


def _refresh(use_case: str, db: Any, hit: Optional[Tuple[float, Optional[str]]]) -> Optional[str]:
    """Read the row and store it. A failed read keeps the last good value."""
    try:
        value = _lookup(db, use_case)
    except Exception as exc:  # noqa: BLE001 - table missing, pool busy, DB down
        value = hit[1] if hit is not None else None
        logger.warning("Image model lookup failed for '%s' (%s); keeping %s",
                       use_case, exc, value or "the built-in default")
    with _CACHE_LOCK:
        _CACHE[use_case] = (time.monotonic(), value)
    return value


def _refresh_in_background(use_case: str, hit: Optional[Tuple[float, Optional[str]]]) -> None:
    """One background read per use case at a time; never raises."""
    with _CACHE_LOCK:
        if use_case in _REFRESHING:
            return
        _REFRESHING.add(use_case)

    def run() -> None:
        try:
            _refresh(use_case, None, hit)
        finally:
            with _CACHE_LOCK:
                _REFRESHING.discard(use_case)

    try:
        threading.Thread(target=run, name=f"image-model-{use_case}", daemon=True).start()
    except Exception as exc:  # noqa: BLE001
        with _CACHE_LOCK:
            _REFRESHING.discard(use_case)
        logger.warning("Image model refresh for '%s' could not start (%s)", use_case, exc)


def image_model_for(use_case: str, hard_default: str, db: Any = None) -> str:
    """The image model for `use_case`: its ai_model_defaults.default_model_id,
    else `hard_default`. Cached 30 s per use case. A failed read keeps the last
    good value (or `hard_default`) and is retried after the TTL. Never raises.

    Called on an event loop without a session (the async image routes), a stale
    or empty cache is refreshed on a background thread and this call answers
    from the cache (or `hard_default`, which the seed row equals) — so a request
    never waits on a DB connection here. With a session, or off the loop (the
    video pipeline's worker threads), the read is synchronous as before."""
    now = time.monotonic()
    with _CACHE_LOCK:
        hit = _CACHE.get(use_case)
    if hit is not None and now - hit[0] < CACHE_TTL_SECONDS:
        return hit[1] or hard_default
    if db is None and _on_event_loop():
        _refresh_in_background(use_case, hit)
        return (hit[1] if hit is not None else None) or hard_default
    return _refresh(use_case, db, hit) or hard_default


# --------------------------------------------------------------------------
# billing.image_registry_pricing
# --------------------------------------------------------------------------

IMAGE_PRICING_SETTING = "billing.image_registry_pricing"
PRICING_OFF = "off"
PRICING_SHADOW = "shadow"
PRICING_ON = "on"
PRICING_MODES = (PRICING_OFF, PRICING_SHADOW, PRICING_ON)


def image_pricing_mode() -> str:
    """"off" | "shadow" | "on". Anything unreadable or unknown is "off".

    Never given the caller's session: a failed read on it would abort the
    transaction the caller is about to bill on."""
    try:
        from .platform_settings_service import get_platform_setting

        raw = get_platform_setting(IMAGE_PRICING_SETTING, default=PRICING_OFF)
    except Exception as exc:  # noqa: BLE001
        logger.warning("%s unreadable (%s); billing images as before", IMAGE_PRICING_SETTING, exc)
        return PRICING_OFF
    mode = str(raw or "").strip().lower()
    return mode if mode in PRICING_MODES else PRICING_OFF


def registry_image_credits(model_id: Optional[str], count: int = 1) -> Optional[Decimal]:
    """Credits for `count` images of `model_id` at registry prices:
    provider_rates.image_cost_usd (ai_models.image_price_per_unit, with its
    fallbacks) x the live USD->credit ratio (CreditService.usd_to_credits).
    None when it cannot be computed. Runs on its own short session for the
    same reason as `image_pricing_mode`."""
    if count <= 0:
        return None
    try:
        from ..db import db_session
        from .credit_service import CreditService
        from .provider_rates import image_cost_usd

        with db_session() as session:
            unit_usd = image_cost_usd(model_id, db=session)
            per_image = CreditService(session).usd_to_credits(unit_usd)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Registry image price unavailable for %s (%s)", model_id, exc)
        return None
    if per_image is None or per_image <= 0:
        return None
    return (per_image * count).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class ImageCharge:
    """What an image charge should do under the current mode.

    `precomputed_credits` is what to pass to the deduction (None = price it
    exactly as before); `would_be_credits` is the registry amount when it was
    computed (shadow and on), for metadata and logs."""

    mode: str
    precomputed_credits: Optional[Decimal] = None
    would_be_credits: Optional[Decimal] = None

    def metadata(self, base: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """`base` plus the shadow figures; `base` itself, untouched, when off."""
        if self.mode == PRICING_OFF or self.would_be_credits is None:
            return base
        out = dict(base or {})
        out["would_be_credits"] = float(self.would_be_credits)
        out["image_pricing_mode"] = self.mode
        return out


def plan_image_charge(model_id: Optional[str], count: int = 1, feature: str = "image") -> ImageCharge:
    """Decide how to charge `count` images of `model_id` (the model that
    actually ran). Off does no extra work at all. On without a usable registry
    price falls back to the old pricing rather than charging nothing."""
    mode = image_pricing_mode()
    if mode == PRICING_OFF:
        return ImageCharge(PRICING_OFF)
    credits = registry_image_credits(model_id, count)
    if credits is None:
        logger.warning("[image-billing] %s: no registry price for %s; charging as before", feature, model_id)
        return ImageCharge(mode)
    logger.info(
        "[image-billing] %s mode=%s model=%s count=%d would_be_credits=%s",
        feature, mode, model_id, count, credits,
    )
    if mode == PRICING_SHADOW:
        return ImageCharge(mode, None, credits)
    return ImageCharge(mode, credits, credits)


__all__ = [
    "CACHE_TTL_SECONDS", "PAGE_BUILDER_IMAGE", "COURSE_ASSIST_IMAGE", "QUIZ_IMAGE",
    "DOCUMENT_IMAGE", "VIDEO_IMAGE", "VIDEO_SUPPORT_VISUAL",
    "image_model_for", "invalidate_cache",
    "IMAGE_PRICING_SETTING", "PRICING_OFF", "PRICING_SHADOW", "PRICING_ON", "PRICING_MODES",
    "image_pricing_mode", "registry_image_credits", "ImageCharge", "plan_image_charge",
]
