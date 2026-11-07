"""SCORM packages: their HTML pages and iSpring content free, slides drawn as
images through paid OCR (spec §6.5).

The package root is the launch URL minus its launch_path (dirname of the
launch URL when the path does not match). imsmanifest.xml there lists the
files. Everything is fetched under the same https scheme, host and path
prefix, with no redirects (so a manifest cannot point the server at another
host), with byte and count caps on every kind of file.

Free, in this order:
- the .html / .htm pages (launch page first), at most 40 files / 5 MB;
- iSpring Page courses (res/data-1.json): every section's text;
- iSpring Suite slides (res/data/slideN.js): the text each slide keeps as text.

iSpring Suite renders text it cannot keep as text INTO the slide's PNGs. A
slide with (almost) no text of its own and at least one image that is not a
flat colour is an IMAGE SLIDE: the free pass reports NEEDS_PAID with one OCR
unit per image slide (course_kb_ocr_page, the PPT_ANIM deck's price and kind).
With a PaidPermit, each image slide is composed into ONE picture (its images
painted at their positions, ispring.compose_slide) and read once, by MathPix
or a vision model (platform setting course_knowledge.scorm_ocr_engine). The
result is cached PAID under the package key, so the tutor and course
knowledge pay for a package once between them.

A package with neither (a player that draws everything with scripts) is EMPTY
when under 200 characters.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import posixpath
import re
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import unquote, urljoin, urlsplit

from ....constants.model_defaults import GLM_DEFAULT
from ...tutor.slide_source import html_to_text
from . import cache, ispring
from .documents import fetch_https, within_prefix
from .types import (
    SCORM_EXTRACTOR_VERSION, Extraction, PaidDelivered, PaidNeed, PaidPermit, Segment, SlideRef, TOOL_OCR_PAGE,
)

logger = logging.getLogger(__name__)

MAX_FILES = 40
MAX_TOTAL_BYTES = 5 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
FETCH_TIMEOUT = 10.0
MIN_TEXT_CHARS = 200
SCRIPTED_NOTE = "Interactive package shows its text as images or draws it with scripts: only the title is used"
OVER_APPROVED_NOTE = "Over the approved amount"

# iSpring caps.
MAX_SLIDES = 300                         # slideN.js read per package
MAX_SLIDE_JS_BYTES = 2 * 1024 * 1024
MAX_SLIDE_JS_TOTAL = 24 * 1024 * 1024
MAX_DATA_JSON_BYTES = 8 * 1024 * 1024
MAX_IMAGE_BYTES = 4 * 1024 * 1024        # one slide image
MAX_IMAGES_PER_SLIDE = 30
MAX_SLIDE_IMAGE_BYTES = 12 * 1024 * 1024
MAX_DETECT_BYTES = 32 * 1024 * 1024      # images the free pass may download to tell image slides apart
SLIDE_TEXT_MIN = 40                      # a slide with less text of its own may be text drawn as pixels
MIN_IMAGE_AREA = 2500                    # px² at slide scale: smaller pictures are icons and bullets
FETCH_CONCURRENCY = 6
OCR_CONCURRENCY = 4

VISION_MODEL = GLM_DEFAULT                # copy_check reads pages with the same model
VISION_USD_PER_SLIDE = 0.001             # provider cost estimate for one composed slide
VISION_PROMPT = (
    "Transcribe ALL text visible in this presentation slide, exactly as written, in its original "
    "language and script (Hindi stays in Devanagari, English in Latin letters). Keep the reading order: "
    "title first, then top to bottom, left to right; one line per line of text. Do not translate, "
    "correct, summarise, describe pictures or add anything. If the slide has no text, reply with nothing."
)

# The fallback page authoring tools (iSpring, Articulate, Captivate) put in the HTML for
# browsers they do not support. It is not lesson text: iSpring packages render every
# slide's text as images, so without this filter they read as READY with only this.
_BOILERPLATE_RE = re.compile(
    r"page not available|this browser is not supported|browser is not supported|"
    r"to view this (?:page|content|presentation)[^.]*?(?:browsers?|below)[^.]*\.?|"
    r"please use one of (?:these|the following) browsers[^.]*\.?|"
    r"(?:google )?chrome|mozilla firefox|firefox|microsoft edge|safari|opera|internet explorer|"
    r"javascript is (?:disabled|required)[^.]*\.?|enable javascript[^.]*\.?|loading\.{0,3}|"
    r"the viewing is complete\.?|you may close this window\.?",
    re.IGNORECASE,
)


def strip_boilerplate(text: str) -> str:
    """The page text without the unsupported-browser fallback wording."""
    return re.sub(r"\s+", " ", _BOILERPLATE_RE.sub(" ", text or "")).strip()

_HREF_RE = re.compile(r"<(?:[\w-]+:)?(?:resource|file)\b[^>]*?\bhref\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)


def package_root(launch_url: str, launch_path: Optional[str]) -> Optional[str]:
    url = (launch_url or "").strip()
    if urlsplit(url).scheme != "https":
        return None
    path = (launch_path or "").strip().lstrip("/")
    clean = url.split("?", 1)[0].split("#", 1)[0]
    if path and clean.endswith("/" + path):
        root = clean[: -len(path)]
    else:
        root = clean.rsplit("/", 1)[0] + "/"
    return root if root.endswith("/") else root + "/"


def manifest_hrefs(xml: str) -> List[str]:
    return [h.strip() for h in _HREF_RE.findall(xml or "") if h.strip()]


def allowed_pages(root: str, hrefs: List[str], launch_path: Optional[str]) -> List[str]:
    """Absolute https URLs of the package's HTML pages, launch page first, deduped."""
    ordered = ([launch_path] if launch_path else []) + hrefs
    out: List[str] = []
    seen = set()
    for href in ordered:
        href = (href or "").strip()
        if not href:
            continue
        absolute = urljoin(root, href).split("#", 1)[0]
        path = urlsplit(absolute).path.lower()
        if not (path.endswith(".html") or path.endswith(".htm")):
            continue
        if not within_prefix(absolute, root):
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        out.append(absolute)
    return out


def cache_key(ref: SlideRef) -> str:
    """course_extract_cache key of a package (also the PaidNeed pointer, so
    meta.paid, coverage and the tutor all find the paid text by it)."""
    return f"v{SCORM_EXTRACTOR_VERSION}:{ref.pointer_key or ''}"


def billing_key(key: str) -> str:
    return "scorm:" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:40]


def image_slides_note(n: int) -> str:
    return f"Slides are images: {n} slide{'s' if n != 1 else ''} need{'s' if n == 1 else ''} reading"


# ── reading the package ──────────────────────────────────────────────────────

@dataclass
class _Slide:
    number: int
    layout: ispring.SlideLayout
    base: str                                    # what the slide's image srcs resolve against
    images: Dict[str, bytes] = field(default_factory=dict)
    image_slide: bool = False

    def url(self, src: str) -> str:
        return urljoin(self.base, src).split("#", 1)[0]


@dataclass
class _Package:
    root: str
    pages: int = 0
    fetched: int = 0
    total: int = 0
    missing: int = 0                             # slide scripts that failed to download
    html: List[Segment] = field(default_factory=list)
    sections: List[Segment] = field(default_factory=list)
    slides: List[_Slide] = field(default_factory=list)

    def probe(self, image_slides: List[int]) -> Dict:
        return {"pages": self.pages, "bytes": self.total, "slides": len(self.slides), "ocr_slides": image_slides}


async def _fetch(url: str, max_bytes: int, root: str) -> Optional[bytes]:
    try:
        return await fetch_https(url, max_bytes=max_bytes, timeout=FETCH_TIMEOUT, allow_prefix=root)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - one broken file must not drop the package
        logger.info("SCORM file %s skipped: %s", url, exc)
        return None


async def _read_html(pkg: _Package, pages: List[str]) -> None:
    for idx, url in enumerate(pages, start=1):
        if pkg.total >= MAX_TOTAL_BYTES:
            break
        data = await _fetch(url, MAX_TOTAL_BYTES - pkg.total, pkg.root)
        if not data:
            continue
        pkg.fetched += 1
        pkg.total += len(data)
        body = html_to_text(data.decode("utf-8", errors="replace"))
        if body and len(strip_boilerplate(body)) < 40:
            body = ""   # only the unsupported-browser fallback page
        if body:
            name = unquote(posixpath.basename(urlsplit(url).path)) or f"page {idx}"
            pkg.html.append(Segment(text=body, anchor="page", page=idx, label=name))


async def _read_sections(pkg: _Package, hrefs: List[str]) -> None:
    for href in ispring.data_json_hrefs(hrefs)[:4]:
        url = urljoin(pkg.root, href)
        if not within_prefix(url, pkg.root):
            continue
        data = await _fetch(url, MAX_DATA_JSON_BYTES, pkg.root)
        if not data:
            continue
        pkg.fetched += 1
        try:
            pkg.sections.extend(ispring.page_sections(json.loads(data.decode("utf-8", errors="replace"))))
        except Exception:  # noqa: BLE001 - not an iSpring Page file after all
            logger.info("SCORM %s is not readable iSpring Page data", url)


async def _read_slides(pkg: _Package, hrefs: List[str]) -> None:
    scripts = [(n, urljoin(pkg.root, h)) for n, h in ispring.slide_scripts(hrefs)]
    scripts = [(n, u) for n, u in scripts if within_prefix(u, pkg.root)][:MAX_SLIDES]
    if not scripts:
        return
    sem = asyncio.Semaphore(FETCH_CONCURRENCY)
    budget = {"left": MAX_SLIDE_JS_TOTAL}

    async def one(number: int, url: str) -> Optional[_Slide]:
        async with sem:
            if budget["left"] <= 0:
                return None
            data = await _fetch(url, min(MAX_SLIDE_JS_BYTES, budget["left"]), pkg.root)
        if not data:
            pkg.missing += 1
            return None
        budget["left"] -= len(data)
        layout = ispring.parse_slide_js(data.decode("utf-8", errors="replace"))
        if layout is None:
            return None
        # srcs are relative to the player page that loads res/data/slideN.js (res/).
        base = url.rsplit("/data/", 1)[0] + "/"
        return _Slide(number=number, layout=layout, base=base)

    for slide in await asyncio.gather(*(one(n, u) for n, u in scripts)):
        if slide is not None:
            pkg.fetched += 1
            pkg.slides.append(slide)


async def _read_package(ref: SlideRef, root: str) -> _Package:
    launch_url = str(ref.extras.get("launch_url") or "")
    launch_path = ref.extras.get("launch_path")
    pkg = _Package(root=root)
    hrefs: List[str] = []
    raw = await _fetch(root + "imsmanifest.xml", MAX_MANIFEST_BYTES, root)
    if raw:
        hrefs = manifest_hrefs(raw.decode("utf-8", errors="replace"))
    if not launch_path:
        # The launch file itself, relative to the root, when the manifest is silent.
        rel = launch_url.split("?", 1)[0][len(root):] if launch_url.startswith(root) else ""
        launch_path = rel or None
    pages = allowed_pages(root, hrefs, launch_path)[:MAX_FILES]
    pkg.pages = len(pages)
    await _read_html(pkg, pages)
    await _read_sections(pkg, hrefs)
    await _read_slides(pkg, hrefs)
    return pkg


def _candidate_images(slide: _Slide) -> List[ispring.ImageOp]:
    return [op for op in slide.layout.images if op.w * op.h >= MIN_IMAGE_AREA][:MAX_IMAGES_PER_SLIDE]


async def _download_images(slide: _Slide, root: str, sem: asyncio.Semaphore, budget: Dict[str, int]) -> bool:
    """Fetch the slide's images into slide.images (capped per image, per slide
    and by the shared budget). False when any of them is still missing."""
    total = sum(len(b) for b in slide.images.values())
    complete = True
    for op in slide.layout.images[:MAX_IMAGES_PER_SLIDE]:
        if op.src in slide.images:
            continue
        url = slide.url(op.src)
        if not within_prefix(url, root):
            continue                         # never fetched, never painted
        cap = min(MAX_IMAGE_BYTES, MAX_SLIDE_IMAGE_BYTES - total, budget["left"])
        if cap <= 0:
            return False
        async with sem:
            data = await _fetch(url, cap, root)
        if not data:
            complete = False
            continue
        slide.images[op.src] = data
        total += len(data)
        budget["left"] -= len(data)
    return complete


async def _mark_image_slides(pkg: _Package) -> List[int]:
    """Slide numbers whose text is drawn as pixels: (almost) no text of their
    own and at least one sizeable image that is not a flat colour. Flatness
    needs the image, so only such slides' images are downloaded; past the
    download budget a slide with a sizeable image is assumed to need reading."""
    sem = asyncio.Semaphore(FETCH_CONCURRENCY)
    budget = {"left": MAX_DETECT_BYTES}
    thin = [s for s in pkg.slides if len(s.layout.text.strip()) < SLIDE_TEXT_MIN and _candidate_images(s)]

    async def judge(slide: _Slide) -> None:
        complete = await _download_images(slide, pkg.root, sem, budget)
        have = [slide.images[op.src] for op in _candidate_images(slide) if op.src in slide.images]
        flat = await asyncio.to_thread(lambda: [ispring.is_flat(b) for b in have])
        # An image that could not be fetched (or judged within the budget) may
        # carry text: the slide is quoted, and a slide with nothing to paint
        # is never read, so never charged.
        slide.image_slide = (not complete) or not all(flat)

    await asyncio.gather(*(judge(s) for s in thin))
    return [s.number for s in pkg.slides if s.image_slide]


def _segments(pkg: _Package, read: Optional[Dict[int, str]] = None) -> List[Segment]:
    """HTML pages, iSpring Page sections, then one segment per slide (its own
    text plus what was read from its picture), cited as Slide N."""
    out: List[Segment] = list(pkg.html) + list(pkg.sections)
    for slide in sorted(pkg.slides, key=lambda s: s.number):
        parts = [slide.layout.text.strip(), ((read or {}).get(slide.number) or "").strip()]
        body = "\n".join(p for p in parts if p)
        if body:
            out.append(Segment(text=body, anchor="step", step=slide.number, label=f"Slide {slide.number}"))
    return out


def _readable_chars(segs: List[Segment]) -> int:
    return sum(len(strip_boilerplate(s.text)) for s in segs)


def _need(key: str, units: int) -> PaidNeed:
    return PaidNeed(kind="deck_images", tool_key=TOOL_OCR_PAGE, unit_field="pages", units=int(units),
                    approx=False, pointer_kind="scorm", pointer_key=key)


# ── entry point ──────────────────────────────────────────────────────────────

async def extract_scorm(ref: SlideRef, permit: Optional[PaidPermit] = None) -> Extraction:
    key = cache_key(ref)
    hit = await asyncio.to_thread(cache.get, "scorm", key)
    if hit is not None:
        if hit.tier == "PAID":
            return Extraction(ref.slide_id, "scorm", segments=hit.segments,
                              status="READY" if hit.segments else "EMPTY",
                              note=None if hit.segments else "The slides have no readable text",
                              detail={"scorm_ocr": True})
        waiting = hit.probe.get("ocr_slides") if isinstance(hit.probe, dict) else None
        if not waiting:
            if hit.segments:
                return Extraction(ref.slide_id, "scorm", segments=hit.segments, status="READY")
            return Extraction(ref.slide_id, "scorm", status="EMPTY", note=SCRIPTED_NOTE)
        need = _need(key, len(waiting))
        if permit is None or not permit.allows("deck_images"):
            return Extraction(ref.slide_id, "scorm", segments=hit.segments, status="NEEDS_PAID", paid_need=need,
                              note=image_slides_note(need.units))
        if need.units > permit.limit("deck_images"):
            return Extraction(ref.slide_id, "scorm", segments=hit.segments, status="NEEDS_PAID", paid_need=need,
                              note=OVER_APPROVED_NOTE)
        # A paid pass needs the slide images: read the package again below.

    root = package_root(str(ref.extras.get("launch_url") or ""), ref.extras.get("launch_path"))
    if root is None:
        return Extraction(ref.slide_id, "scorm", status="UNSUPPORTED", note="The package is not on a secure (https) link")

    pkg = await _read_package(ref, root)
    image_slides = await _mark_image_slides(pkg) if pkg.slides else []
    segs = _segments(pkg)
    # Only a package that was actually (and wholly) read is remembered; a
    # failed fetch is tried again next time.
    remember = pkg.fetched > 0 and pkg.missing == 0

    if not image_slides:
        if _readable_chars(segs) < MIN_TEXT_CHARS:
            if remember:
                await asyncio.to_thread(cache.put, "scorm", key, "FREE", [], pkg.probe([]))
            return Extraction(ref.slide_id, "scorm", status="EMPTY", note=SCRIPTED_NOTE)
        if remember:
            await asyncio.to_thread(cache.put, "scorm", key, "FREE", segs, pkg.probe([]))
        return Extraction(ref.slide_id, "scorm", segments=segs, status="READY")

    need = _need(key, len(image_slides))
    if remember:
        await asyncio.to_thread(cache.put, "scorm", key, "FREE", segs, pkg.probe(image_slides))
    if permit is None or not permit.allows("deck_images"):
        return Extraction(ref.slide_id, "scorm", segments=segs, status="NEEDS_PAID", paid_need=need,
                          note=image_slides_note(need.units))
    if need.units > permit.limit("deck_images"):
        return Extraction(ref.slide_id, "scorm", segments=segs, status="NEEDS_PAID", paid_need=need,
                          note=OVER_APPROVED_NOTE)
    return await _read_image_slides(ref, permit, pkg, key, need, segs)


# ── the paid pass ────────────────────────────────────────────────────────────

Reader = Callable[[bytes, str], Awaitable[Tuple[bool, str]]]


class _StaticKeys:
    """Pre-resolved keys for ChatLLMClient (no DB session during the call)."""

    def __init__(self, key: str) -> None:
        self._key = key

    def resolve_keys(self, institute_id=None, user_id=None, request_model=None, **_ignored):
        return self._key, None, VISION_MODEL


def _clean(text: str) -> str:
    body = (text or "").strip()
    if body.startswith("```"):
        body = body.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return body


async def _mathpix_reader() -> Tuple[Reader, Callable[[], Awaitable[None]], str, float]:
    from ...mathpix_service import MathpixService
    from ...provider_rates import ocr_cost_usd
    service = MathpixService()

    async def read(data: bytes, mime: str) -> Tuple[bool, str]:
        res = await service.ocr_image_base64(base64.b64encode(data).decode("ascii"), mime)
        if not isinstance(res, dict) or res.get("error"):
            return False, ""
        return True, _clean(str(res.get("text") or res.get("latex") or ""))

    async def close() -> None:
        return None

    return read, close, "mathpix", ocr_cost_usd(1)


async def _vision_reader(institute_id: str) -> Optional[Tuple[Reader, Callable[[], Awaitable[None]], str, float]]:
    from ...tutor import source_text
    key = await asyncio.to_thread(source_text._openrouter_key, institute_id, None)
    if not key:
        return None
    from ...chat_llm_client import ChatLLMClient
    client = ChatLLMClient(_StaticKeys(key))

    async def read(data: bytes, mime: str) -> Tuple[bool, str]:
        try:
            resp = await client.chat_completion(
                messages=[{"role": "user", "content": VISION_PROMPT, "attachments": [
                    {"type": "image", "url": f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"}]}],
                temperature=0.0, max_tokens=3000, institute_id=institute_id, model=VISION_MODEL,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - a failed read is not delivered
            logger.info("SCORM vision read failed: %s", exc)
            return False, ""
        return True, _clean(str((resp or {}).get("content") or ""))

    return read, client.close, f"vision:{VISION_MODEL}", VISION_USD_PER_SLIDE


async def slide_reader(institute_id: str) -> Tuple[Reader, Callable[[], Awaitable[None]], str, float]:
    """(read, close, model label, provider USD per slide) for the configured engine."""
    from .. import flags
    if flags.scorm_ocr_engine() == "vision":
        vision = await _vision_reader(institute_id)
        if vision is not None:
            return vision
        logger.warning("SCORM vision reader has no OpenRouter key for %s; using MathPix", institute_id)
    return await _mathpix_reader()


async def _read_image_slides(ref: SlideRef, permit: PaidPermit, pkg: _Package, key: str, need: PaidNeed,
                             free: List[Segment]) -> Extraction:
    slides = [s for s in pkg.slides if s.image_slide]
    read, close, model, usd_per_slide = await slide_reader(permit.institute_id)
    sem = asyncio.Semaphore(OCR_CONCURRENCY)
    fetch_sem = asyncio.Semaphore(FETCH_CONCURRENCY)
    budget = {"left": MAX_SLIDE_IMAGE_BYTES * max(1, len(slides))}

    async def one(slide: _Slide) -> Tuple[int, bool, str]:
        # A few slides at a time end to end, so at most that many slides'
        # images are in memory.
        async with sem:
            await _download_images(slide, pkg.root, fetch_sem, budget)
            picture, mime, _painted = await asyncio.to_thread(ispring.compose_slide, slide.layout, slide.images)
            slide.images.clear()             # composed: free the source bytes
            if picture is None:
                return slide.number, False, ""
            ok, text = await read(picture, mime)
            return slide.number, ok, text

    try:
        results = await asyncio.gather(*(one(s) for s in slides))
    finally:
        try:
            await close()
        except Exception:  # noqa: BLE001
            pass
    called = sum(1 for _n, ok, _t in results if ok)
    if called == 0:
        # Every read failed: nothing delivered, never charged. The free text stays.
        return Extraction(ref.slide_id, "scorm", segments=free, status="FAILED", paid_need=need,
                          note="OCR could not read the slides")
    texts = {n: t for n, ok, t in results if ok and t}
    segs = _segments(pkg, texts)
    await asyncio.to_thread(cache.put, "scorm", key, "PAID", segs,
                            {**pkg.probe([s.number for s in slides]), "ocr_slides_read": called, "model": model})
    delivered = PaidDelivered(
        tool_key=TOOL_OCR_PAGE, unit_field="pages", units=called,
        provider_cost_usd=round(usd_per_slide * called, 6), model=model,
        idempotency_key=f"course_kb_imgocr:{permit.institute_id}:{billing_key(key)}",
    )
    return Extraction(ref.slide_id, "scorm", segments=segs, status="READY" if segs else "EMPTY",
                      paid_delivered=delivered, note=None if segs else "The slides have no readable text",
                      detail={"scorm_ocr": True})


__all__ = [
    "extract_scorm", "package_root", "manifest_hrefs", "allowed_pages", "strip_boilerplate", "SCRIPTED_NOTE",
    "cache_key", "billing_key", "image_slides_note", "slide_reader", "OVER_APPROVED_NOTE",
]
