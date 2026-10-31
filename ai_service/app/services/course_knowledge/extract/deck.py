"""PPT_ANIM decks: a .pptx converted to build-step images (render_worker
pptx_anim.py) under a public base URL with a manifest.json:
{"slides": [[step image, …], …], "steps_per_slide", "aspect", "overlays"}.

Free when the manifest also carries per-slide text ("slide_texts", aligned
with "slides"; each entry a string or a list of step strings). Otherwise the
deck is only pixels: one OCR call per slide on its LAST build step (the
fully built slide), charged as course_kb_ocr_page per slide, cached PAID
under (deck, sha256(base)[:40]).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from typing import Any, List, Optional, Tuple

from . import cache
from .documents import fetch_https
from .types import Extraction, PaidDelivered, PaidNeed, PaidPermit, Segment, SlideRef, TOOL_OCR_PAGE

logger = logging.getLogger(__name__)

MAX_MANIFEST_BYTES = 2 * 1024 * 1024
MANIFEST_TIMEOUT = 20.0
OCR_CONCURRENCY = 4
OVER_APPROVED_NOTE = "Over the approved amount"


def deck_base(raw: Optional[str]) -> Optional[str]:
    base = (raw or "").strip()
    if not base.lower().startswith("https://"):
        return None
    return base if base.endswith("/") else base + "/"


def deck_key(base: str) -> str:
    return hashlib.sha256(base.encode("utf-8")).hexdigest()[:40]


def _slide_texts(manifest: dict, n: int) -> List[str]:
    raw = manifest.get("slide_texts")
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    for i in range(n):
        entry: Any = raw[i] if i < len(raw) else ""
        if isinstance(entry, list):
            entry = "\n".join(str(t).strip() for t in entry if str(t or "").strip())
        out.append(str(entry or "").strip())
    return out


def _last_steps(manifest: dict) -> List[Optional[str]]:
    slides = manifest.get("slides")
    if not isinstance(slides, list):
        return []
    out: List[Optional[str]] = []
    for group in slides:
        steps = [s for s in group if isinstance(s, str) and s.strip()] if isinstance(group, list) else []
        out.append(steps[-1].strip() if steps else None)
    return out


async def _manifest(base: str) -> Optional[dict]:
    data = await fetch_https(base + "manifest.json", max_bytes=MAX_MANIFEST_BYTES, timeout=MANIFEST_TIMEOUT,
                             allow_prefix=base)
    if data is None:
        return None
    try:
        manifest = json.loads(data.decode("utf-8", errors="replace"))
    except Exception:  # noqa: BLE001
        return None
    return manifest if isinstance(manifest, dict) else None


async def extract_deck(ref: SlideRef, permit: Optional[PaidPermit] = None) -> Extraction:
    base = deck_base(ref.pointer_key)
    if base is None:
        return Extraction(ref.slide_id, "deck", status="UNSUPPORTED", note="The slide deck is not on a secure (https) link")
    key = deck_key(base)
    hit = await asyncio.to_thread(cache.get, "deck", key)
    if hit is not None:
        return Extraction(ref.slide_id, "deck", segments=hit.segments, status="READY" if hit.segments else "EMPTY")

    manifest = await _manifest(base)
    if manifest is None:
        return Extraction(ref.slide_id, "deck", status="FAILED", note="The slide deck's manifest could not be read")
    steps = _last_steps(manifest)
    n = len(steps)
    if n == 0:
        return Extraction(ref.slide_id, "deck", status="EMPTY", note="The slide deck has no slides")

    texts = _slide_texts(manifest, n)
    if any(texts):
        segs = [Segment(text=t, anchor="step", step=i + 1, label=f"Slide {i + 1}") for i, t in enumerate(texts) if t]
        await asyncio.to_thread(cache.put, "deck", key, "FREE", segs, {"slides": n, "source": "manifest"})
        return Extraction(ref.slide_id, "deck", segments=segs, status="READY")

    # The pointer is the CACHE key, not the URL: meta.paid, the sibling
    # re-queue, coverage's "already processed" lookup and the per-pointer lock
    # all look the paid text up by it in course_extract_cache.
    need = PaidNeed(kind="deck_images", tool_key=TOOL_OCR_PAGE, unit_field="pages", units=n, approx=False,
                    pointer_kind="deck", pointer_key=key)
    if permit is None or not permit.allows("deck_images"):
        return Extraction(ref.slide_id, "deck", status="NEEDS_PAID", paid_need=need,
                          note=f"{n} slide{'s' if n != 1 else ''} are images: reading them needs OCR")
    if n > permit.limit("deck_images"):
        return Extraction(ref.slide_id, "deck", status="NEEDS_PAID", paid_need=need, note=OVER_APPROVED_NOTE)
    return await _ocr(ref, permit, base, key, steps, need)


async def _ocr(ref: SlideRef, permit: PaidPermit, base: str, key: str, steps: List[Optional[str]],
               need: PaidNeed) -> Extraction:
    from ...mathpix_service import MathpixService
    service = MathpixService()
    sem = asyncio.Semaphore(OCR_CONCURRENCY)

    async def one(i: int, path: Optional[str]) -> Tuple[int, bool, str]:
        if not path:
            return i, False, ""
        async with sem:
            res = await service.ocr_image(base + path.lstrip("/"))
        if not isinstance(res, dict) or res.get("error"):
            return i, False, ""
        return i, True, str(res.get("text") or res.get("latex") or "").strip()

    results = await asyncio.gather(*(one(i, p) for i, p in enumerate(steps)))
    called = sum(1 for _i, ok, _t in results if ok)
    segs = [Segment(text=t, anchor="step", step=i + 1, label=f"Slide {i + 1}")
            for i, ok, t in sorted(results) if ok and t]
    if called == 0:
        # Every call failed: not delivered, never charged.
        return Extraction(ref.slide_id, "deck", status="FAILED", paid_need=need, note="OCR could not read the slides")
    await asyncio.to_thread(cache.put, "deck", key, "PAID", segs, {"slides": len(steps), "ocr_slides": called})
    from ...provider_rates import ocr_cost_usd
    delivered = PaidDelivered(
        tool_key=TOOL_OCR_PAGE, unit_field="pages", units=called, provider_cost_usd=ocr_cost_usd(called),
        model="mathpix", idempotency_key=f"course_kb_imgocr:{permit.institute_id}:{key}",
    )
    return Extraction(ref.slide_id, "deck", segments=segs, status="READY" if segs else "EMPTY",
                      paid_delivered=delivered, note=None if segs else "The slides have no readable text")


__all__ = ["extract_deck", "deck_base", "deck_key"]
