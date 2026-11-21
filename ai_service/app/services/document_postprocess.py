"""Post-processing for AI-generated DOCUMENT slide HTML.

Two concerns, both best-effort (any failure returns the input unchanged):

1. normalize_code_blocks — rewrites <pre><code> blocks into the canonical
   form the admin editor's code plugin round-trips losslessly:
   <pre data-code="<base64 utf-8>" data-language="x"><code class="language-x">escaped</code></pre>
   The base64 data-code attribute is what the FE deserializer prefers, so
   indentation/newlines survive any later HTML re-parsing (the historical
   "flattened code" bug).

2. illustrate_document — finds <img data-img-prompt="..."> placeholders the
   LLM emitted (same contract as the assessment/video pipelines), generates
   real images via OpenRouter (routed through ImageGenerationService, which
   knows that dedicated image models like Qwen answer on /api/v1/images while
   Gemini/GPT image models answer on chat/completions — calling the wrong one
   is a 404 that reads like "model missing"), uploads them to S3 and swaps the
   src. Failed/over-cap placeholders are stripped so no broken images reach the
   editor.

   Both the course copilot's DOCUMENT slides and the manual HTML Document slide
   author use this one contract, so there is a single way to say "draw a picture
   here" across the platform.
"""
from __future__ import annotations

import asyncio
import base64
import html as html_lib
import logging
import os
import re
from typing import Awaitable, Callable, Optional, Tuple
from uuid import uuid4

from ..config import get_settings
from .image_model_resolver import DOCUMENT_IMAGE, image_model_for
from .s3_service import S3Service

logger = logging.getLogger(__name__)

# Max AI illustrations generated per document slide (flat-rate credits apply per
# image). Raised from 2 after institute feedback that AI pages were walls of
# text: students learn visually, and two pictures cannot carry a whole lesson.
MAX_DOC_IMAGES = 6
# Bound concurrent image calls across parallel document todos.
_IMAGE_SEMAPHORE = asyncio.Semaphore(4)
_IMAGE_TIMEOUT_SECONDS = 90.0
# Image model via OpenRouter. DOC_IMAGE_MODEL (env) wins, else the
# 'document_image' use case (super-admin portal), else this literal. The
# constant is today's static value, kept for importers; the generation path
# resolves through doc_image_model().
_DOC_IMAGE_MODEL_ENV = os.getenv("DOC_IMAGE_MODEL")
_DOC_IMAGE_MODEL_DEFAULT = "qwen/qwen-image-3"
DOC_IMAGE_MODEL = _DOC_IMAGE_MODEL_ENV or _DOC_IMAGE_MODEL_DEFAULT


def doc_image_model() -> str:
    """The document-illustration image model right now (cached 30 s)."""
    return _DOC_IMAGE_MODEL_ENV or image_model_for(DOCUMENT_IMAGE, _DOC_IMAGE_MODEL_DEFAULT)
# Pixel dims per aspect, handed to the image service (it maps them to the
# provider's aspect ratio); the page CSS decides the displayed size.
_ASPECT_DIMS = {
    "16:9": (1280, 720),
    "4:3": (1024, 768),
    "1:1": (1024, 1024),
    "3:4": (768, 1024),
    "9:16": (720, 1280),
}
_DEFAULT_ASPECT = "16:9"

# Same tag contract as automation_pipeline._process_generated_images.
_IMG_PROMPT_RE = re.compile(r'<img[^>]+data-img-prompt=(["\'])(.*?)\1[^>]*>', re.IGNORECASE)
_ALT_RE = re.compile(r'alt=(["\'])(.*?)\1', re.IGNORECASE)
_ASPECT_RE = re.compile(r'data-img-aspect=(["\'])(.*?)\1', re.IGNORECASE)

_PRE_CODE_RE = re.compile(
    r'<pre([^>]*)>\s*<code([^>]*)>([\s\S]*?)</code>\s*</pre>', re.IGNORECASE
)
_LANG_CLASS_RE = re.compile(r'class=(["\'])[^"\']*language-([\w+#-]+)[^"\']*\1', re.IGNORECASE)
_LANG_ATTR_RE = re.compile(r'data-language=(["\'])([\w+#-]+)\1', re.IGNORECASE)
_WRAPPING_FENCE_RE = re.compile(r'^\s*```(?:html)?\s*\n([\s\S]*?)\n?```\s*$')
# Any leftover placeholder img (unmatched prompt attr, malformed tag, over-cap)
# must never reach the editor. [^>]* inside a character class matches newlines.
_PLACEHOLDER_IMG_RE = re.compile(r'<img[^>]*src=(["\'])placeholder\.png\1[^>]*>', re.IGNORECASE)


def strip_wrapping_fence(text: str) -> str:
    """Unwrap LLM output that arrives as one ```html fenced block despite the
    HTML-only instruction (a common Gemini slip). Only fires when the ENTIRE
    payload is a single fence."""
    if not text:
        return text
    match = _WRAPPING_FENCE_RE.match(text)
    return match.group(1) if match else text


def _escape_code(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def normalize_code_blocks(html: str) -> str:
    """Rewrite every <pre><code> block into the editor's lossless canonical form."""
    if not html or "<pre" not in html:
        return html

    def _rebuild(match: "re.Match[str]") -> str:
        pre_attrs, code_attrs, body = match.group(1), match.group(2), match.group(3)
        lang_match = (
            _LANG_CLASS_RE.search(code_attrs or "")
            or _LANG_CLASS_RE.search(pre_attrs or "")
            or _LANG_ATTR_RE.search(pre_attrs or "")
        )
        language = lang_match.group(2) if lang_match else None
        # The LLM may have escaped entities (or not); unescape to recover the
        # real code text, then re-escape uniformly.
        code_text = html_lib.unescape(body).strip("\n")
        encoded = base64.b64encode(code_text.encode("utf-8")).decode("ascii")
        lang_attr = f' data-language="{language}"' if language else ""
        code_class = f' class="language-{language}"' if language else ""
        return (
            f'<pre data-code="{encoded}"{lang_attr} style="white-space: pre;">'
            f"<code{code_class}>{_escape_code(code_text)}</code></pre>"
        )

    try:
        return _PRE_CODE_RE.sub(_rebuild, html)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Code-block normalization failed, keeping original HTML: %s", exc)
        return html


async def _generate_one_image(
    prompt: str, aspect: str = _DEFAULT_ASPECT, model: Optional[str] = None
) -> Optional[str]:
    """Generate one illustration and return its public S3 URL (None on failure)."""
    settings = get_settings()
    key = getattr(settings, "openrouter_api_key", None)
    if not key:
        logger.info("OPENROUTER_API_KEY not configured; skipping document illustration")
        return None
    styled = (
        f"A clean, modern educational textbook illustration for study notes: {prompt}. "
        "Clear, simple, and informative; flat vector style; generous light background; "
        "labelled where it helps; no watermark and no gibberish text."
    )
    width, height = _ASPECT_DIMS.get(aspect, _ASPECT_DIMS[_DEFAULT_ASPECT])
    # Routed through ImageGenerationService so the call lands on whichever of
    # OpenRouter's two image APIs serves this model (see module docstring).
    from .image_service import ImageGenerationService

    svc = ImageGenerationService(openrouter_api_key=key)
    try:
        async with _IMAGE_SEMAPHORE:
            image_bytes, _usage = await asyncio.wait_for(
                svc._call_image_generation_llm(
                    styled, width, height, model=model or doc_image_model()
                ),
                timeout=_IMAGE_TIMEOUT_SECONDS,
            )
        if not image_bytes:
            logger.warning("Document illustration returned no image for prompt %r", prompt[:60])
            return None
        is_png = image_bytes[:8] == b"\x89PNG\r\n\x1a\n"
        ext, ctype = ("png", "image/png") if is_png else ("jpg", "image/jpeg")
        return await asyncio.to_thread(
            S3Service().upload_file_content,
            image_bytes,
            f"illustration.{ext}",
            f"ai-course-docs/{uuid4()}.{ext}",
            ctype,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Document illustration failed for prompt %r: %s", prompt[:60], exc)
        return None
    finally:
        try:
            await svc._http_client.aclose()
        except Exception:  # noqa: BLE001
            pass


_ANY_IMG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_SRC_RE = re.compile(r'\ssrc=(["\'])(.*?)\1', re.IGNORECASE)
# An alt this short ("image", "photo") is not a usable drawing prompt.
_MIN_ALT_PROMPT_CHARS = 12


def adopt_foreign_images(html: str, allowed_urls: Optional[set] = None) -> Tuple[str, int]:
    """Turn images the model INVENTED into proper illustration placeholders.

    Despite the prompt, models sometimes emit `<img src="https://…/rocket.png">`
    (a guessed/hallucinated URL) instead of the `data-img-prompt` contract —
    nothing generates those, so they reach the learner as a broken-image icon
    with the alt text showing. Any <img> whose src is not one we handed the
    model (uploads, PDF figures, logo, images already in an edited page) or an
    inline data: URI is rewritten into a placeholder drawn from its alt text;
    with no usable alt it is dropped. Returns (html, adopted_count)."""
    if not html or "<img" not in html.lower():
        return html, 0
    allowed = {u.strip() for u in (allowed_urls or set()) if u and u.strip()}
    adopted = 0

    def _fix(m: "re.Match[str]") -> str:
        nonlocal adopted
        tag = m.group(0)
        if "data-img-prompt" in tag.lower():
            return tag
        src_m = _SRC_RE.search(tag)
        src = (src_m.group(2) if src_m else "").strip()
        if src == "placeholder.png" or src.startswith("data:") or src in allowed:
            return tag
        alt_m = _ALT_RE.search(tag)
        alt = (alt_m.group(2) if alt_m else "").strip()
        if len(alt) < _MIN_ALT_PROMPT_CHARS:
            logger.info("Dropping invented image with no usable alt: %s", src[:80])
            return ""
        adopted += 1
        safe = html_lib.escape(html_lib.unescape(alt), quote=True)
        return (
            f'<img src="placeholder.png" data-img-prompt="{safe}" '
            f'data-img-aspect="{_aspect_of(tag)}" alt="{safe}">'
        )

    out = _ANY_IMG_RE.sub(_fix, html)
    if adopted:
        logger.info("Adopted %d invented image URL(s) as illustration placeholders", adopted)
    return out, adopted


def count_image_placeholders(html: str) -> int:
    """How many illustrations this document asks for (before the cap) — so a
    caller can tell the user a picture pass is about to add real seconds."""
    if not html or "data-img-prompt" not in html:
        return 0
    return len(_IMG_PROMPT_RE.findall(html))


def _aspect_of(tag: str) -> str:
    match = _ASPECT_RE.search(tag)
    aspect = (match.group(2) if match else "").strip()
    return aspect if aspect in _ASPECT_DIMS else _DEFAULT_ASPECT


async def illustrate_document(
    html: str,
    slide_path: str = "",
    model: Optional[str] = None,
    max_images: int = MAX_DOC_IMAGES,
    on_progress: Optional[Callable[[int, int], Awaitable[None]]] = None,
) -> Tuple[str, int]:
    """Generate images for data-img-prompt placeholders.

    Returns (processed_html, generated_image_count). Placeholders past the
    `max_images` cap, or whose generation fails, are removed entirely — never
    leave a placeholder.png in the output. `on_progress(completed, total)` is
    awaited as pictures land, for callers that show a progress indicator.
    """
    if not html:
        return html, 0
    if "data-img-prompt" not in html:
        return _PLACEHOLDER_IMG_RE.sub("", html), 0

    settings = get_settings()
    matches = list(_IMG_PROMPT_RE.finditer(html))
    if not matches:
        return _PLACEHOLDER_IMG_RE.sub("", html), 0

    urls: list[Optional[str]] = [None] * len(matches)
    # Gate on the OpenRouter key — image gen was moved off the direct Gemini
    # image API (free-tier, zero image quota) to OpenRouter. Gating on
    # gemini_api_key here would strip every illustration once that key is
    # retired, even though OpenRouter can still generate them.
    if settings.openrouter_api_key:
        # One model for every picture in this document.
        model = model or doc_image_model()
        capped = matches[:max_images]
        if len(matches) > max_images:
            logger.info(
                "Document %s requested %d illustrations; capping at %d",
                slide_path, len(matches), max_images,
            )
        total = len(capped)
        done = 0
        lock = asyncio.Lock()

        async def one(index: int, match: "re.Match[str]") -> Optional[str]:
            nonlocal done
            url = await _generate_one_image(match.group(2), _aspect_of(match.group(0)), model)
            async with lock:
                done += 1
                completed = done
            if on_progress:
                try:
                    await on_progress(completed, total)
                except Exception:  # noqa: BLE001
                    logger.debug("illustration progress callback failed", exc_info=True)
            return url

        if on_progress and total:
            try:
                await on_progress(0, total)
            except Exception:  # noqa: BLE001
                logger.debug("illustration progress callback failed", exc_info=True)
        generated = await asyncio.gather(*[one(i, m) for i, m in enumerate(capped)])
        urls[: len(generated)] = list(generated)
    else:
        logger.info("OPENROUTER_API_KEY not configured; stripping document image placeholders")

    generated_count = 0
    # Replace from the end so match offsets stay valid.
    for match, url in reversed(list(zip(matches, urls))):
        if url:
            alt_match = _ALT_RE.search(match.group(0))
            alt = html_lib.escape(alt_match.group(2) if alt_match else "Illustration", quote=True)
            replacement = (
                f'<img src="{html_lib.escape(url, quote=True)}" alt="{alt}" '
                f'style="max-width:100%;height:auto;border-radius:8px;margin:12px 0;">'
            )
            generated_count += 1
        else:
            replacement = ""
        html = html[: match.start()] + replacement + html[match.end():]

    # Final sweep: kill any placeholder img the prompt-attr regex couldn't
    # match (newlines in attributes, '>' in an attribute value, etc.).
    return _PLACEHOLDER_IMG_RE.sub("", html), generated_count


__all__ = [
    "normalize_code_blocks",
    "illustrate_document",
    "adopt_foreign_images",
    "count_image_placeholders",
    "strip_wrapping_fence",
    "MAX_DOC_IMAGES",
    "DOC_IMAGE_MODEL",
    "doc_image_model",
]
