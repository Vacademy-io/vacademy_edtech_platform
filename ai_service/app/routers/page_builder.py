"""
AI Page Builder — composes catalogue pages as schema-bound JSON.

The admin page-builder's pages are pure JSON (typed components + a token-driven
style engine), so the composer never writes HTML/CSS: it emits a Page object
against the checked-in schema catalog (app/data/catalogue_schema_catalog.json,
regenerated from the editor's component templates via
scripts/export-catalogue-schema-catalog.mjs). Output is validated/sanitized
server-side — unknown component types are dropped and image URLs are
whitelisted to the assets the admin actually provided. htmlBlock is a governed
ESCAPE HATCH for bespoke sections: its html/css pass through a strict nh3
profile + CSS scrub here, and the renderers re-sanitize (DOMPurify) and render
it inside a contained shadow root (see catalogue-html.ts in both frontends).

Phase A scope: one page per run (wizard). Copilot ops come in Phase B.
"""
from __future__ import annotations

import asyncio
from urllib.parse import urlparse
import base64
import json
import logging
import math
import os
import re
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.security import get_current_user
from ..db import db_dependency
from ..models.ai_token_usage import RequestType
from ..services.ai_billing import (
    UC, metering_from_request, metering_kwargs, metering_user, preflight_tool_credits, record_tool_billing,
    supported_kwargs,
)
from ..services.figma_links import FIGMA_LINK_GUIDANCE, find_figma_url, is_figma_url
from ..services.image_model_resolver import PAGE_BUILDER_IMAGE, ImageCharge, image_model_for, plan_image_charge
from ..services.llm_json import generate_json
from ..constants.model_defaults import GLM_DEFAULT
from ..services.model_selection import resolve_models
from ..services.page_audit import audit_component, audit_page, audit_reference_fidelity
from ..services.catalogue_summary import job_slug
from ..utils.json_extract import extract_and_sanitize_json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/page-builder", tags=["page-builder"])

# The model comes from the 'page_builder' use case (ai_model_defaults, set in
# the super-admin portal); a request's preferred_model still wins. This is only
# the hard fallback for a missing row / unreachable DB — the platform default
# (GLM), overridable via env for emergencies.
_DEFAULT_MODEL = os.getenv("PAGE_BUILDER_MODEL") or GLM_DEFAULT
_USAGE_MARKUP = Decimal("2")
_TOOL_KEY = "page_generate"

_CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "catalogue_schema_catalog.json"

_SLUG_RE = re.compile(r"[^a-z0-9-]+")

# Prop keys whose string values are image/media URLs — anything not in the
# provided-asset allowlist is stripped so the model can never hotlink or
# hallucinate an image URL.
_IMAGE_KEYS = {
    "image", "src", "logo", "avatar", "photo", "backgroundimage", "posterimage",
    "thumbnail", "icontype_image", "imageurl",
}
_IMAGE_LIST_KEYS = {"avatars", "imagecollage", "images"}
# Newer widgets name their art after what it is (filterSidebar.promo.screenImage,
# heroSection coverImage, previewImageUrl…). A fixed key list let those slip past
# BOTH the stripper here and the MCP's allow-list, so a model could hotlink any
# URL through them. Any key ending in one of these is an image key too.
_IMAGE_KEY_SUFFIXES = ("image", "imageurl", "src")


def is_image_key(key: Any) -> bool:
    """A prop key whose string value is an image URL (allow-list-keep).

    THE shared rule: page_builder's stripper and the MCP's asset allow-list
    (assistant_tools_website_edit._asset_urls_in) both call this, so a key can
    never be stripped on one side and unrecognised on the other."""
    if not isinstance(key, str):
        return False
    lk = key.lower()
    return lk in _IMAGE_KEYS or lk.endswith(_IMAGE_KEY_SUFFIXES)


def is_image_list_key(key: Any) -> bool:
    """A prop key holding a list of image URLs (string items are allow-list-keep)."""
    return isinstance(key, str) and key.lower() in _IMAGE_LIST_KEYS

# Hostile URL schemes — browsers strip embedded control chars/whitespace before
# parsing a scheme, so "java\tscript:" still fires; normalize first.
_HOSTILE_SCHEME_RE = re.compile(r"^(javascript|data|vbscript)\s*:", re.IGNORECASE)
_CTRL_WS_RE = re.compile(r"[\x00-\x20]")


def _strip_hostile(value: str) -> str:
    normalized = _CTRL_WS_RE.sub("", value)
    return "" if _HOSTILE_SCHEME_RE.match(normalized) else value


_RICH_TEXT_RE = re.compile(r"<[a-zA-Z/!]")


def _sanitize_html(value: str) -> str:
    """Rich-text props are rendered via dangerouslySetInnerHTML on both the
    admin canvas and the published learner page — scrub any markup-bearing
    string through an HTML sanitizer (nh3/ammonia defaults: no scripts,
    no event handlers, no hostile URLs)."""
    if not _RICH_TEXT_RE.search(value):
        return value
    try:
        import nh3
        return nh3.clean(value)
    except Exception:  # noqa: BLE001 — sanitizer unavailable: strip all tags
        return re.sub(r"<[^>]*>", "", value)


# ─── Custom-HTML sections (htmlBlock escape hatch) ──────────────────────────
# Contract mirrored by catalogue-html.ts in both frontends (defense in depth):
# structural/text tags only, class-based styling via a separate scrubbed CSS
# blob, images only from vetted URLs, no scripts/iframes/svg/forms/media.

# del/ins/strike: a struck-through original price is the commonest thing a
# marketing section needs and <del> is what authors write for it. nh3 keeps a
# disallowed tag's CHILDREN, so omitting it turned "<del>₹1,599</del>" into
# bare "₹1,599" and left the matching `del { … }` CSS rule dead — a silent
# no-op that reads as "the edit did not save". No scripting surface; their
# "cite" attribute stays disallowed (it is a URL).
_CUSTOM_HTML_TAGS = {
    "a", "article", "aside", "b", "blockquote", "br", "button", "caption",
    "cite", "code", "dd", "del", "div", "dl", "dt", "em", "figcaption",
    "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
    "i", "img", "ins", "li", "mark", "nav", "ol", "p", "pre", "s", "section",
    "small", "span", "strike", "strong", "sub", "sup", "table", "tbody", "td",
    "tfoot", "th", "thead", "time", "tr", "u", "ul",
}
_CUSTOM_HTML_ATTRS = {
    "*": {"class", "id", "style", "title", "role", "aria-label", "aria-hidden"},
    # NOTE: no "rel" here — nh3 REJECTS an explicit rel allowance when
    # link_rel is set (it manages rel itself); allowing it raises ValueError,
    # which the fallback would turn into "every htmlBlock dropped".
    "a": {"href", "target"},
    "img": {"src", "alt", "width", "height", "loading"},
    "time": {"datetime"},
    "th": {"colspan", "rowspan", "scope"},
    "td": {"colspan", "rowspan"},
}
_MAX_CUSTOM_HTML = 30000
_MAX_CUSTOM_CSS = 20000
_MAX_HTML_BLOCKS_PER_PAGE = 3

_CSS_COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
_CSS_URL_RE = re.compile(r"url\s*\([^)]*\)", re.I)
_CSS_BANNED_RE = re.compile(r"@import\b|expression\s*\(|(?<![\w-])behavior\s*:|-moz-binding|javascript\s*:", re.I)
_IMG_SRC_RE = re.compile(r'(<img\b[^>]*?\bsrc=")([^"]*)(")', re.I)


def _scrub_css(css: str, warnings: List[str]) -> str:
    """Scrub a custom-CSS blob: no imports, no url() (assets belong in vetted
    <img> tags), no legacy script vectors, and no '</' so the blob can't break
    out of the <style> tag the renderers inject it into."""
    if len(css) > _MAX_CUSTOM_CSS:
        warnings.append("Custom CSS truncated to size cap")
        css = css[:_MAX_CUSTOM_CSS]
    css = _CSS_COMMENT_RE.sub("", css)
    if _CSS_URL_RE.search(css):
        warnings.append("Removed url() from custom CSS")
        css = _CSS_URL_RE.sub("none", css)
    css = _CSS_BANNED_RE.sub("", css)
    return css.replace("</", " ")


def _sanitize_custom_html(html: str, allowed_urls: set, warnings: List[str]) -> str:
    """nh3-clean an htmlBlock's markup with the custom-HTML profile, then
    enforce the image allowlist and scrub style attributes (same banned
    constructs as the CSS blob — inline styles pass through nh3 untouched)."""
    if len(html) > _MAX_CUSTOM_HTML:
        warnings.append("Custom HTML truncated to size cap")
        html = html[:_MAX_CUSTOM_HTML]
    try:
        import nh3
        cleaned = nh3.clean(
            html,
            tags=_CUSTOM_HTML_TAGS,
            attributes=_CUSTOM_HTML_ATTRS,
            url_schemes={"https", "mailto", "tel"},
            link_rel="noopener noreferrer",
        )
    except Exception:  # noqa: BLE001 — sanitizer unavailable: refuse the block
        warnings.append("HTML sanitizer unavailable — custom HTML dropped")
        return ""

    def _check_src(m: "re.Match[str]") -> str:
        url = m.group(2)
        if url and url not in allowed_urls:
            warnings.append("Stripped unknown image URL from custom HTML")
            return f'{m.group(1)}{m.group(3)}'
        return m.group(0)

    cleaned = _IMG_SRC_RE.sub(_check_src, cleaned)
    # Neutralize banned CSS constructs that may sit inside style="" attributes.
    return _CSS_BANNED_RE.sub("", _CSS_URL_RE.sub("none", cleaned))


def _load_catalog() -> Dict[str, Any]:
    with open(_CATALOG_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


# ─── Image generation (logos / hero art / illustrations) ────────────────────

# PAGE_IMAGE_MODEL (env) wins; else the 'page_builder_image' use case
# (super-admin portal), else this literal. Chat-completions image models only
# (the call below sends `modalities`).
_IMAGE_MODEL_ENV = os.getenv("PAGE_IMAGE_MODEL")
_IMAGE_MODEL_DEFAULT = "google/gemini-3.1-flash-image"
_IMAGE_MODEL = _IMAGE_MODEL_ENV or _IMAGE_MODEL_DEFAULT
_IMAGE_API_URL = "https://openrouter.ai/api/v1/chat/completions"
_IMAGE_ASPECTS = {"16:9", "4:3", "1:1", "3:4", "9:16", "3:2", "2:3"}
# Auto-generated images per page. Was 5, which quietly became the binding
# constraint once featureGrid's per-feature image became discoverable to the
# composer: a hero plus a three-illustration row exhausts it, so a photo-card
# grid of a dozen programs falls back to icons. They are generated
# concurrently, so the cost is linear but the latency is not.
_MAX_AUTO_IMAGES = 14

# Below this, an explicit vertical padding on a section that paints a background
# is treated as a mistake rather than a choice — see sanitize_component.
_MIN_BAND_PADDING_PX = 32.0
# Value sentinel the composer uses in an image field to request generation.
_GEN_PREFIX = "gen:"


def _image_model() -> str:
    """The page-builder image model right now (cached 30 s by the resolver)."""
    return _IMAGE_MODEL_ENV or image_model_for(PAGE_BUILDER_IMAGE, _IMAGE_MODEL_DEFAULT)


async def _openrouter_image(prompt: str, aspect: str, model: Optional[str] = None) -> Optional[bytes]:
    """One image via OpenRouter (same call the course/doc image path uses).
    Returns raw PNG bytes or None."""
    from ..config import get_settings
    key = getattr(get_settings(), "openrouter_api_key", None)
    if not key:
        logger.warning("[page-image] no OpenRouter key")
        return None
    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            _IMAGE_API_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": model or _image_model(),
                "messages": [{"role": "user", "content": prompt}],
                "modalities": ["image"],
                "image_config": {"aspect_ratio": aspect if aspect in _IMAGE_ASPECTS else "16:9"},
            },
        )
    if resp.status_code != 200:
        logger.error("[page-image] OpenRouter %s: %s", resp.status_code, resp.text[:200])
        return None
    for choice in resp.json().get("choices") or []:
        for image in (choice.get("message") or {}).get("images", []) or []:
            url = (image.get("image_url") or {}).get("url", "")
            if url:
                b64 = url.split(",", 1)[1] if "," in url else url
                try:
                    return base64.b64decode(b64)
                except Exception:  # noqa: BLE001
                    return None
    return None


def _upload_image(data: bytes, kind: str) -> Optional[str]:
    from ..services.s3_service import S3Service
    try:
        s3 = S3Service()
        key = f"page-builder/{kind}-{uuid.uuid4().hex}.png"
        return s3.upload_file_content(data, f"{kind}.png", s3_key=key, content_type="image/png")
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-image] upload failed: %s", e)
        return None


def _page_metering(request: Optional[Request], institute_id: Optional[str], user: Any, user_id: Optional[str]) -> Any:
    """Usage-event attribution for a page-builder call (never changes a charge)."""
    return metering_from_request(request, institute_id, user=user) or metering_user(user_id, surface="ADMIN_APP")


def _bill_image(db, institute_id: Optional[str], user_id: Optional[str], model: Optional[str] = None,
                metering: Any = None) -> None:
    if not institute_id:
        return
    model = model or _image_model()
    # billing.image_registry_pricing: off (default) charges the flat image
    # rate exactly as before; shadow adds would_be_credits to the usage
    # metadata; on charges the registry price of the model that ran.
    try:
        charge = plan_image_charge(model, 1, feature="page_builder_image")
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-image] image pricing plan failed (%s); billing as before", e)
        charge = ImageCharge("off")
    try:
        from ..services.token_usage_service import TokenUsageService
        from ..models.ai_token_usage import ApiProvider
        tus = TokenUsageService(db)
        tus.record_usage_and_deduct_credits(
            api_provider=ApiProvider.OPENAI,  # via OpenRouter
            prompt_tokens=0, completion_tokens=0, total_tokens=0,
            request_type=RequestType.IMAGE,
            institute_id=institute_id, user_id=user_id,
            model=model, metadata=charge.metadata({"feature": "page_builder_image"}),
            precomputed_credits=charge.precomputed_credits,
            **supported_kwargs(tus.record_usage_and_deduct_credits, metering_kwargs(
                UC.PAGE_BUILDER_IMAGE,
                metering if metering is not None else metering_user(user_id, surface="ADMIN_APP"),
            )),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-image] billing skipped: %s", e)


async def _generate_and_upload_image(
    prompt: str, aspect: str, kind: str, db, institute_id: Optional[str], user_id: Optional[str],
    metering: Any = None,
) -> Optional[str]:
    """Generate → upload → bill one image. Returns the public URL or None."""
    model = _image_model()
    data = await _openrouter_image(prompt, aspect, model)
    if not data:
        return None
    url = _upload_image(data, kind)
    if url:
        _bill_image(db, institute_id, user_id, model, **supported_kwargs(_bill_image, {"metering": metering}))
    return url


# Scalar image keys the composer may fill with a "gen:<prompt>" sentinel.
_GEN_KEYS = {"image", "src", "logo", "avatar", "photo", "backgroundimage", "posterimage", "thumbnail"}
_GEN_ASPECT = {"logo": "1:1", "avatar": "1:1", "photo": "4:3", "backgroundimage": "16:9", "thumbnail": "4:3"}


async def _autogen_images(page: Any, db, institute_id: Optional[str], user_id: Optional[str],
                          metering: Any = None) -> set:
    """Walk the page for image fields set to 'gen:<prompt>', generate each
    (concurrently, capped), upload, and replace the value with the real URL
    (or '' on failure). Returns the set of generated URLs to allowlist."""
    refs: List[tuple] = []  # (container_dict, key, prompt, aspect, kind)

    def collect(node: Any) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                lk = k.lower()
                if lk in _GEN_KEYS and isinstance(v, str) and v.startswith(_GEN_PREFIX):
                    prompt = v[len(_GEN_PREFIX):].strip()
                    if prompt:
                        refs.append((node, k, prompt, _GEN_ASPECT.get(lk, "16:9"), lk))
                else:
                    collect(v)
        elif isinstance(node, list):
            for item in node:
                collect(item)

    collect(page)
    if not refs:
        return set()
    refs = refs[:_MAX_AUTO_IMAGES]
    generated: set = set()

    async def one(container: Dict[str, Any], key: str, prompt: str, aspect: str, kind: str) -> None:
        url = await _generate_and_upload_image(prompt, aspect, kind, db, institute_id, user_id,
                                               **supported_kwargs(_generate_and_upload_image, {"metering": metering}))
        container[key] = url or ""
        if url:
            generated.add(url)

    await asyncio.gather(*[one(*r) for r in refs], return_exceptions=True)
    return generated


def _is_public_http_host(target: str) -> bool:
    """SSRF guard shared by site-import and image-inlining: only public
    http(s) hosts — blocks localhost / .local / private / link-local ranges."""
    try:
        import socket
        from urllib.parse import urlparse

        from ..services.safe_http import host_is_blocked_name, is_public_address
        if not target.startswith(("http://", "https://")):
            return False
        host = (urlparse(target).hostname or "").lower()
        if host_is_blocked_name(host):
            return False
        # Same address rules as safe_fetch (adds CGNAT, NAT64 and v4-mapped
        # private addresses to the old private/loopback/link-local list). This
        # is only a PRE-check for callers that cannot pin the connection
        # (Playwright); anything we download ourselves goes through safe_fetch.
        infos = socket.getaddrinfo(host, None)
        return bool(infos) and all(is_public_address(info[4][0]) for info in infos)
    except Exception:  # noqa: BLE001 — guard failure = treat as non-public
        return False


_MAX_INLINE_IMAGE_BYTES = 6_000_000


# How many reference screenshots the design pass reads. Was 3 — a payload
# guess, not a model limit — which silently dropped half of a six-shot upload.
_MAX_INSPIRATION_IMAGES = 6
# Vision models downsample to roughly this edge internally, so sending a 3000px
# screenshot costs bandwidth and latency for no extra detail.
_VISION_MAX_EDGE = 1568


def _downscale_for_vision(raw: bytes, ctype: str) -> tuple[bytes, str]:
    """Shrink an oversized screenshot before it is inlined as a data URL.

    The reference-design pass used to accept only 3 images because six raw
    screenshots (1-2 MB each) made an unreasonably large request. Downscaling
    first removes that constraint: a full-page 3022px screenshot lands around
    150 KB at the edge the model actually uses, so more of the reference fits in
    a smaller payload.

    Best-effort — Pillow is present transitively (moviepy) and already lazily
    imported elsewhere in this service, but any failure returns the original
    bytes rather than losing the image."""
    try:
        import io

        from PIL import Image

        img = Image.open(io.BytesIO(raw))
        width, height = img.size
        if max(width, height) <= _VISION_MAX_EDGE and len(raw) <= 400_000:
            return raw, ctype
        scale = min(1.0, _VISION_MAX_EDGE / float(max(width, height)))
        if scale < 1.0:
            img = img.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.LANCZOS)
        # Flatten transparency onto white rather than letting JPEG turn alpha
        # black — logos reach this path too, via the copilot's attachment pass.
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            flat = Image.new("RGB", img.size, (255, 255, 255))
            flat.paste(img, mask=img.split()[-1])
            img = flat
        elif img.mode != "RGB":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=82, optimize=True)
        out = buf.getvalue()
        return (out, "image/jpeg") if len(out) < len(raw) else (raw, ctype)
    except Exception as e:  # noqa: BLE001 — never lose an image to a resize
        logger.warning("[page-builder] vision downscale skipped: %s", e)
        return raw, ctype


async def _inline_image_data_url(url: str) -> tuple[Optional[str], Optional[str]]:
    """Fetch an admin-uploaded image OURSELVES and inline it as a data: URL,
    so the LLM provider never has to fetch it — media-service links can be
    presigned/short-lived or served with non-image content types, which
    providers reject. SSRF-guarded. Returns (data_url, None) on success or
    (None, reason) on failure."""
    from ..services.safe_http import WEB_PORTS, SafeFetchError, safe_fetch
    if not isinstance(url, str) or not _is_public_http_host(url):
        return None, "blocked non-public host"
    try:
        # Pinned to the validated address, every redirect hop re-checked, body
        # capped while streaming (the pre-check above alone could be rebound).
        try:
            resp = await safe_fetch(
                url, max_bytes=_MAX_INLINE_IMAGE_BYTES, timeout=12.0, total_timeout=30.0, allow_http=True,
                allowed_ports=WEB_PORTS,  # the old fetch took any port; keep :8080 / :8443 working
            )
        except SafeFetchError as exc:
            if exc.code == "too_large":
                return None, "bad size (over limit)"
            if exc.code in ("blocked_host", "blocked_address"):
                return None, "blocked non-public host"
            return None, f"fetch error: {exc.code}"
        if resp.status_code != 200:
            return None, f"http {resp.status_code}"
        if not resp.content:
            return None, f"bad size {len(resp.content)}"
        ctype = resp.content_type
        if not ctype.startswith("image/"):
            head = resp.content[:12]
            if head.startswith(b"\x89PNG"):
                ctype = "image/png"
            elif head.startswith(b"\xff\xd8"):
                ctype = "image/jpeg"
            elif head[:6] in (b"GIF87a", b"GIF89a"):
                ctype = "image/gif"
            elif head[:4] == b"RIFF" and resp.content[8:12] == b"WEBP":
                ctype = "image/webp"
            else:
                return None, f"not an image ({ctype or 'no content-type'})"
        payload, ctype = _downscale_for_vision(resp.content, ctype)
        return f"data:{ctype};base64,{base64.b64encode(payload).decode()}", None
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-builder] image inline failed for %s: %s", url[:120], e)
        return None, f"fetch error: {type(e).__name__}"


# Reference-site capture. One desktop viewport, a scroll-through so lazy
# sections mount, then a full-page PNG sliced into viewport-tall tiles: the
# vision pass reads at most _MAX_INSPIRATION_IMAGES images, and one 9000px
# strip downscaled to 1568px tall is unreadable, while six 1600px tiles keep
# every section legible. Everything here is best-effort — a capture failure
# degrades to "no reference", never to a failed build.
_REFERENCE_VIEWPORT = {"width": 1440, "height": 900}
_REFERENCE_TILE_HEIGHT = 1600
_REFERENCE_NAV_TIMEOUT_MS = 20_000
_REFERENCE_IDLE_TIMEOUT_MS = 8_000
_REFERENCE_SETTLE_MS = 1_200
_REFERENCE_GROWTH_POLL_MS = 500
_REFERENCE_GROWTH_MAX_MS = 10_000
# Hard ceiling on one capture (navigation + settle + scroll + screenshot).
_REFERENCE_TOTAL_TIMEOUT_S = 75
# Chromium costs ~400 MB per capture; the pod has 3 GiB with ~1 GiB in use.
_REFERENCE_CAPTURE_SLOTS = asyncio.Semaphore(2)
_REFERENCE_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
# Automation tells that make sites swap their real page for a "browser not
# supported" interstitial (Khan Academy did, on navigator.webdriver).
_REFERENCE_INIT_SCRIPT = "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"


async def _wait_for_reference_to_settle(page: Any) -> None:
    """Poll the document's height + text length until two consecutive reads
    agree (or the budget runs out). A page that is still a spinner keeps
    changing; a rendered one holds still within a second or two."""
    last: Optional[tuple] = None
    waited = 0
    while waited < _REFERENCE_GROWTH_MAX_MS:
        try:
            cur = tuple(await page.evaluate(
                "() => [document.body ? document.body.scrollHeight : 0, document.body ? document.body.innerText.length : 0]"
            ))
        except Exception:  # noqa: BLE001
            return
        # "Settled" needs real content: a blank splash (no text) never counts.
        if last is not None and cur == last and cur[1] > 80:
            return
        last = cur
        await page.wait_for_timeout(_REFERENCE_GROWTH_POLL_MS)
        waited += _REFERENCE_GROWTH_POLL_MS


_CONSENT_BUTTON_RE = r"^(accept( all)?( cookies)?|allow( all)?( cookies)?|i agree|agree|got it|ok(ay)?|accept & close|accept and close)$"


async def _dismiss_consent_banner(page: Any) -> None:
    """Click the first visible 'Accept cookies'-style button, if any. A consent
    modal over the hero would otherwise be what the vision pass describes.
    Best-effort; never raises."""
    try:
        clicked = await page.evaluate(
            """(re) => {
                const rx = new RegExp(re, 'i');
                const els = [...document.querySelectorAll('button, [role="button"], a')];
                for (const el of els) {
                    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
                    if (!t || t.length > 40 || !rx.test(t)) continue;
                    const r = el.getBoundingClientRect();
                    if (r.width < 20 || r.height < 12) continue;
                    el.click(); return t;
                }
                return null;
            }""",
            _CONSENT_BUTTON_RE,
        )
        if clicked:
            await page.wait_for_timeout(600)
    except Exception:  # noqa: BLE001
        pass


def _slice_screenshot(png: bytes, tile_height: int = _REFERENCE_TILE_HEIGHT, max_tiles: int = _MAX_INSPIRATION_IMAGES) -> List[bytes]:
    """Cut a full-page PNG into top-to-bottom tiles (PNG bytes). A short page
    yields one tile; a very long one is truncated at max_tiles — the fold and
    the first few bands carry the design language, the footer rarely does."""
    from io import BytesIO
    from PIL import Image

    img = Image.open(BytesIO(png))
    img.load()
    width, height = img.size
    if width <= 0 or height <= 0:
        return []
    tiles: List[bytes] = []
    top = 0
    while top < height and len(tiles) < max_tiles:
        bottom = min(height, top + tile_height)
        # Drop a sliver at the end (< 15% of a tile) — a footer strip on its
        # own is a wasted image slot.
        if tiles and (bottom - top) < tile_height * 0.15:
            break
        buf = BytesIO()
        img.crop((0, top, width, bottom)).save(buf, format="PNG", optimize=True)
        tiles.append(buf.getvalue())
        top = bottom
    return tiles


async def _capture_reference_screenshots(url: str, warnings: List[str]) -> List[str]:
    """Screenshot a reference website → data: URLs the vision pass can read
    directly. SSRF-guarded like every other fetch here — for the first URL AND
    for every request the page makes afterwards (redirects, images, XHR): the
    browser runs inside the cluster, so an unguarded <img src=http://internal>
    would paint an internal response into a screenshot the admin can see.
    Returns [] on any failure and says why in warnings."""
    target = (url or "").strip()
    if not target:
        return []
    # A figma.com file opened without the owner's session is Figma's login
    # wall: capturing it "designed" pages from a sign-in form. No server-side
    # Figma (product decision 1) — say what works instead.
    if is_figma_url(target):
        warnings.append(FIGMA_LINK_GUIDANCE)
        return []
    if not target.lower().startswith(("http://", "https://")):
        target = "https://" + target
    if not _is_public_http_host(target):
        warnings.append("Reference site skipped: not a public http(s) host")
        return []
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        warnings.append("Reference site skipped: screenshot engine unavailable")
        return []
    try:
        async with _REFERENCE_CAPTURE_SLOTS:
            png = await asyncio.wait_for(_capture_reference_png(target, async_playwright), _REFERENCE_TOTAL_TIMEOUT_S)
    except asyncio.TimeoutError:
        warnings.append("Reference site could not be captured (timed out)")
        return []
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-builder] reference capture failed for %s: %s", target[:120], e)
        warnings.append(f"Reference site could not be captured ({type(e).__name__})")
        return []
    if not png:
        warnings.append("Reference site produced no screenshot")
        return []
    tiles = _slice_screenshot(png)
    out: List[str] = []
    for tile in tiles:
        payload, ctype = _downscale_for_vision(tile, "image/png")
        out.append(f"data:{ctype};base64,{base64.b64encode(payload).decode()}")
    if out:
        warnings.append(f"Captured the reference site as {len(out)} screenshot tile(s)")
    return out


async def _capture_reference_png(target: str, async_playwright: Any) -> Optional[bytes]:
    """One guarded browser session → full-page PNG (or None)."""
    host_ok: Dict[str, bool] = {}

    async def guard(route: Any, request: Any) -> None:
        # One DNS check per host per capture; anything non-public is aborted.
        try:
            host = (urlparse(request.url).hostname or "").lower()
            if host not in host_ok:
                host_ok[host] = _is_public_http_host(request.url)
            if host_ok[host]:
                await route.continue_()
            else:
                await route.abort("blockedbyclient")
        except Exception:  # noqa: BLE001
            try:
                await route.abort("blockedbyclient")
            except Exception:  # noqa: BLE001
                pass

    png: Optional[bytes] = None
    if True:
        async with async_playwright() as pw:
            # Full Chromium (new headless), not the headless shell: sites that
            # fingerprint the shell answer with "browser not supported" banners.
            # The shell is the fallback where only it is installed.
            try:
                browser = await pw.chromium.launch(headless=True, channel="chromium", args=["--disable-dev-shm-usage"])
            except Exception:  # noqa: BLE001
                browser = await pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
            try:
                context = await browser.new_context(viewport=_REFERENCE_VIEWPORT, user_agent=_REFERENCE_UA, locale="en-US")
                await context.add_init_script(_REFERENCE_INIT_SCRIPT)
                await context.route("**/*", guard)
                page = await context.new_page()
                try:
                    await page.goto(target, wait_until="domcontentloaded", timeout=_REFERENCE_NAV_TIMEOUT_MS)
                except Exception as e:  # noqa: BLE001 — partial DOM still screenshots
                    logger.info("[page-builder] reference nav timed out, capturing anyway: %s", e)
                # SPA-aware readiness. domcontentloaded fires while a React/Vue
                # site is still a loading bar (the7cs.co.in captured as a 5 KB
                # blank), so wait — briefly — for the network to quieten, then
                # until the document stops growing.
                try:
                    await page.wait_for_load_state("networkidle", timeout=_REFERENCE_IDLE_TIMEOUT_MS)
                except Exception:  # noqa: BLE001 — ad/analytics-heavy sites never go idle
                    pass
                await _wait_for_reference_to_settle(page)
                await _dismiss_consent_banner(page)
                # Scroll through so IntersectionObserver-gated sections mount,
                # then return to the top so the fold is the first tile.
                try:
                    await page.evaluate(
                        """async () => {
                            const step = 700; const max = Math.min(document.body.scrollHeight, 12000);
                            for (let y = 0; y < max; y += step) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
                            window.scrollTo(0, 0);
                        }"""
                    )
                except Exception:  # noqa: BLE001
                    pass
                await page.wait_for_timeout(_REFERENCE_SETTLE_MS)
                png = await page.screenshot(full_page=True, type="png")
            finally:
                await browser.close()
    return png


async def _resolve_inspiration_sources(body: "GeneratePageRequest", warnings: List[str]) -> List[str]:
    """Admin-uploaded screenshots first (they chose those deliberately), then
    the captured reference site, within the vision pass's image budget."""
    urls = [u for u in (body.inspiration_image_urls or []) if isinstance(u, str) and u]
    if body.reference_url and is_figma_url(body.reference_url):
        # Checked before the budget so the admin learns why, not "budget full".
        warnings.append(FIGMA_LINK_GUIDANCE)
    elif body.reference_url:
        room = _MAX_INSPIRATION_IMAGES - len(urls)
        if room <= 0:
            warnings.append("Reference site skipped: the screenshot budget is already full")
        else:
            urls += (await _capture_reference_screenshots(body.reference_url, warnings))[:room]
    return urls[:_MAX_INSPIRATION_IMAGES]


async def _import_site(url: str) -> str:
    """Best-effort fetch of the institute's own site → a compact text corpus
    (title, headings, paragraphs) so the rebuilt page keeps their REAL copy.
    Returns '' on any failure — never blocks generation."""
    if not url or not url.strip():
        return ""
    target = url.strip()
    # A Figma file link fetches Figma's login page, not anyone's copy.
    if is_figma_url(target):
        return ""
    if not target.startswith(("http://", "https://")):
        target = "https://" + target
    # SSRF guard: only public http(s) hosts — block localhost / link-local /
    # private ranges / non-http schemes so this can't probe internal services.
    try:
        import ipaddress
        import socket
        from urllib.parse import urlparse
        host = (urlparse(target).hostname or "").lower()
        if not host or host in ("localhost",) or host.endswith(".local") or host.endswith(".internal"):
            return ""
        try:
            for info in socket.getaddrinfo(host, None):
                ip = ipaddress.ip_address(info[4][0])
                if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                    logger.warning("[page-builder] site import blocked non-public host: %s", host)
                    return ""
        except socket.gaierror:
            return ""
    except Exception:  # noqa: BLE001 — never let the guard itself break generation
        return ""
    try:
        # No redirect-following: a public URL could 30x to an internal one,
        # sidestepping the DNS check above.
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
            resp = await client.get(target, headers={"User-Agent": "Mozilla/5.0 (compatible; VacademyBot/1.0)"})
        if resp.status_code != 200 or "text/html" not in resp.headers.get("content-type", ""):
            return ""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(resp.text[:800_000], "html.parser")
        for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
            tag.decompose()
        parts: List[str] = []
        title = (soup.title.string if soup.title else "") or ""
        if title.strip():
            parts.append(f"TITLE: {title.strip()[:200]}")
        for el in soup.find_all(["h1", "h2", "h3", "li", "p"]):
            txt = " ".join(el.get_text(" ", strip=True).split())
            if 3 <= len(txt) <= 400:
                tag = el.name.upper()
                parts.append(f"{tag}: {txt}" if tag.startswith("H") else txt)
            if len(parts) >= 120:
                break
        corpus = "\n".join(parts)
        return corpus[:6000]
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-builder] site import failed: %s", e)
        return ""


def _vision_models(db) -> tuple[str, List[str]]:
    """The page_builder chain for the two vision passes. They used to ride the
    platform env default through ApiKeyResolver, so a super-admin change to the
    page_builder use case never reached them. The use-case default is passed
    as an explicit model (with its chain for failover); a request's
    preferred_model is deliberately NOT applied here — a text model an admin
    picked for composition may not read images."""
    return resolve_models(db, "page_builder", hard_fallback=_DEFAULT_MODEL)


async def _describe_attachments(
    image_urls: List[str], db, institute_id: Optional[str], user_id: Optional[str]
) -> str:
    """Vision pass over images the admin attached to a COPILOT instruction.

    The copilot's prompt previously listed attachments as bare URLs, so the
    model literally could not see them and answered "I couldn't see an actual
    section attached" when an admin pasted a screenshot of a section they
    wanted built (real field report). Images are inlined as data URLs because
    provider-side fetching of our media URLs is unreliable.

    Unlike _analyze_inspiration (mood only, never content), this transcribes
    UI screenshots — the admin is asking us to REBUILD what they attached, so
    the structure and copy are the point. Best-effort: returns '' on failure.
    """
    from ..services.chat_llm_client import ChatLLMClient
    from ..services.api_key_resolver import ApiKeyResolver

    urls = [u for u in image_urls if isinstance(u, str) and u.startswith("https://")][:3]
    if not urls:
        return ""
    inlined = await asyncio.gather(*(_inline_image_data_url(u) for u in urls))
    attachments = [{"type": "image", "url": d} for d, _ in inlined if d]
    if not attachments:
        # Fall back to the raw URLs — the provider may still fetch them.
        attachments = [{"type": "image", "url": u} for u in urls]

    client = ChatLLMClient(ApiKeyResolver(db))
    primary, fallbacks = _vision_models(db)
    messages = [{
        "role": "user",
        "content": (
            "An education-institute admin attached these image(s) to a request to edit their "
            "website. For EACH image, first classify it as A) a SCREENSHOT/MOCKUP of ONE web "
            "section, B) a PHOTO / logo / graphic meant to be placed on the page, or C) a FULL-PAGE "
            "DESIGN (a whole landing page mockup, or a TEMPLATE SHEET showing several alternative "
            "designs side by side).\n"
            "If A: describe the section precisely enough to rebuild it — layout (columns, order), "
            "every piece of visible TEXT verbatim (headings, subheadings, body, badges/chips, "
            "button labels, stats and their labels), and the visual treatment (card style, dark or "
            "light band, icon usage, alignment).\n"
            "If B: one line on what it depicts and where it would fit.\n"
            "If C: say 'FULL-PAGE DESIGN'. When the sheet shows SEVERAL variants, pick exactly ONE — "
            "the one labelled recommended/selected/default, otherwise the first — name it, and describe "
            "ONLY that variant. Then give: (1) PALETTE as hex — if the image carries a colour legend, "
            "copy its values exactly; primary = the colour of the main BUTTONS/links (never the dark "
            "header/footer or hero surface — that is a surface colour, report it separately), plus "
            "the hero band colour, the page background, and any accent; (2) HEADER: nav labels in "
            "order and the CTA button label; (3) SECTIONS top-to-bottom, one line each: role "
            "(hero / feature strip / course grid / stats / steps / testimonials / cta / footer), "
            "layout (split image-right, 4 icon tiles, etc.), whether the band is dark or light, and "
            "every visible text verbatim (headline, subheading, tile labels, button labels, "
            "section title and any 'View all' link); (4) FOOTER columns if visible.\n"
            "Be concise but complete. No preamble."
        ),
        "attachments": attachments,
    }]
    try:
        resp = await client.chat_completion(
            messages, temperature=0.2, max_tokens=2200, institute_id=institute_id, user_id=user_id,
            model=primary, fallback_models=fallbacks,
        )
        return _clean_string((resp.get("content") or "").strip())
    except Exception as e:  # noqa: BLE001 — never block the edit on the vision pass
        logger.warning("[page-copilot] attachment vision pass failed: %s", e)
        return ""


async def _analyze_inspiration(
    image_urls: List[str], db, institute_id: Optional[str], user_id: Optional[str]
) -> Dict[str, Any]:
    """Vision pass over inspiration screenshots → a STRUCTURED design spec.

    This used to return 4–6 prose bullets of mood adjectives capped at 400
    tokens, which is why "build me something like this" produced pages that
    resembled the reference only in vibe: the composer received no palette, no
    section order and no layout detail — while the copilot's attachment pass
    (_describe_attachments) transcribed all of that. The fidelity was inverted,
    worst exactly where the admin cares most (the first build).

    Returns a dict the composer can act on mechanically — real hex colours for
    theme.primaryColor, enum values it can copy into globalSettings, and a
    section-by-section blueprint. Empty dict on any failure (never blocks the
    build). Structure and treatment only: their COPY, logos and images stay
    theirs.
    """
    from ..services.chat_llm_client import ChatLLMClient
    from ..services.api_key_resolver import ApiKeyResolver

    client = ChatLLMClient(ApiKeyResolver(db))
    primary, fallbacks = _vision_models(db)
    urls = [u for u in image_urls if isinstance(u, str) and u][:_MAX_INSPIRATION_IMAGES]
    if not urls:
        return {}
    # Inline as data URLs for the same reason the copilot pass does: provider-side
    # fetching of our media URLs is unreliable, and a silently unseen screenshot
    # produces confident nonsense.
    # A captured reference site arrives already inlined (data: URLs) — only
    # remote URLs need fetching.
    async def _as_data_url(u: str) -> tuple[Optional[str], Optional[str]]:
        if u.startswith("data:image/"):
            return u, None
        return await _inline_image_data_url(u)

    inlined = await asyncio.gather(*(_as_data_url(u) for u in urls))
    attachments = [{"type": "image", "url": d} for d, _ in inlined if d] or [
        {"type": "image", "url": u} for u in urls if not u.startswith("data:")
    ]

    messages = [{
        "role": "user",
        "content": (
            "These are screenshots of website(s) an education institute wants their new site to look "
            "like. Reverse-engineer the DESIGN so it can be rebuilt. Ignore anything that is not part of "
            "the page's own design: cookie/consent dialogs, 'browser not supported' or announcement "
            "strips, chat widgets and popups — never list those as sections. Return ONLY JSON:\n"
            "{\n"
            '  "pickedVariant": "<only when an image is a TEMPLATE SHEET showing several alternative designs: '
            'the label of the ONE you describe — the variant marked recommended/selected/default, else the '
            'first; omit for a single design>",\n'
            '  "mood": "<one line: e.g. editorial and calm / bold and high-contrast / warm community>",\n'
            '  "palette": {"primary": "#rrggbb", "accent": "#rrggbb", "background": "#rrggbb", "ink": "#rrggbb", '
            '"surface": "#rrggbb"},\n'
            '  "typography": {"heading": "serif"|"sans"|"display", "body": "serif"|"sans", '
            '"scale": "editorial"|"default"|"compact", "weight": "light"|"regular"|"bold"},\n'
            '  "shape": {"radius": "sharp"|"rounded"|"pill", "density": "airy"|"balanced"|"dense", '
            '"borders": "hairline"|"none"|"heavy", "shadows": "none"|"soft"|"strong"},\n'
            '  "atmosphere": {"canvas": "flat"|"soft"|"mesh"|"aurora", "intensity": "subtle"|"medium"|"bold"},\n'
            '  "sections": [{"role": "<hero|logos|features|stats|steps|courses|testimonials|faq|cta|'
            'directory|table|gallery|team|pricing|contact>", "layout": "<split image right | centered | '
            'full-bleed | 3-column cards | 2-column | horizontal rail | bordered table | accordion>", '
            '"notes": "<what makes this band look the way it does>"}],\n'
            '  "signatureMoves": ["<the 3–6 specific details that give this design its character — e.g. '
            'oversized numerals, hairline dividers, pill badges above headings, dark inverted CTA band, '
            'generous whitespace, tinted card headers>"],\n'
            '  "avoid": ["<treatments that would BREAK this look — e.g. gradients, glassmorphism, drop shadows>"]\n'
            "}\n"
            "Rules: palette colours MUST be real hex values sampled from the screenshot. If the image "
            "carries an explicit COLOUR LEGEND / palette strip (swatches with hex codes and roles), copy "
            "those values exactly and map their roles: 'buttons/headings' → primary, 'icons/highlights' → "
            "accent, 'background' → background, 'text' → ink, 'header/footer' → surface.\n"
            "  primary = the colour a visitor would name as THIS BRAND'S colour: the most saturated, "
            "characterful hue, the one carrying decorative shapes, badges, highlights and KEY BUTTONS. "
            "Do NOT simply take the nav/link colour — if the links are a muted or near-neutral blue "
            "while the page's character comes from a warmer or brighter hue, the warmer hue is the "
            "primary. (A rebuild that copies the link colour is technically the same blue and looks "
            "nothing like the original.) A DARK NAVY/BLACK header, hero or footer band is NEVER the "
            "primary — it is a surface: report it as `surface` and note the dark band in `sections`.\n"
            "  accent = the second most characterful hue.\n"
            "  background = the dominant page surface. Say so precisely when it is an off-white, cream, "
            "or tinted paper rather than pure white — that tint is a deliberate choice and a large part "
            "of how the design feels.\n"
            "  ink = body text.\n"
            "  surface = the dark band colour used for the header/hero/footer, if the design has one.\n"
            "TEMPLATE SHEETS: if an image shows several alternative designs side by side (labelled "
            "'Template 1', 'Option B', colour variants…), describe exactly ONE — the one marked "
            "recommended/selected/default, otherwise the first — set `pickedVariant` to its label, and "
            "ignore the others completely; never blend them.\n"
            "List `sections` in the order they appear, top to bottom, one entry per visible band, and say "
            "in `notes` whether the band is dark or light and what it holds (e.g. '4 icon tiles', "
            "'4 course tiles with a View all link', 'split hero, image right'). "
            "Describe STRUCTURE AND TREATMENT ONLY — do NOT transcribe their headlines, marketing copy, "
            "brand name or logo, and never suggest reusing their images."
        ),
        "attachments": attachments,
    }]
    resp = await client.chat_completion(
        # Room for a section blueprint across up to six screenshots; a truncated
        # reply loses the tail of `sections`, which is the part that matters.
        messages, temperature=0.2, max_tokens=2600, institute_id=institute_id, user_id=user_id,
        model=primary, fallback_models=fallbacks,
    )
    return _coerce_inspiration_spec(resp.get("content") or "")


_INSPO_SECTION_ROLES = {
    "hero", "logos", "features", "stats", "steps", "courses", "testimonials", "faq", "cta",
    "directory", "table", "gallery", "team", "pricing", "contact", "about", "video", "banner",
}


def _coerce_inspiration_spec(raw: str) -> Dict[str, Any]:
    """Parse + clamp the vision pass's JSON. Enum fields are validated against
    the values the theme engine actually supports so the composer can copy them
    into globalSettings verbatim; colours must be real hex. Free-text fields are
    scrubbed and length-capped. Falls back to {"notes": <prose>} when the model
    ignored the JSON contract, so a malformed reply still carries direction."""
    text = (raw or "").strip()
    if not text:
        return {}
    data: Any = None
    try:
        cleaned = extract_and_sanitize_json(text)
        if cleaned:
            data = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError, TypeError):
        data = None
    if not isinstance(data, dict):
        return {"notes": _clean_string(text)[:1200]}

    spec: Dict[str, Any] = {}
    mood = data.get("mood")
    if isinstance(mood, str) and mood.strip():
        spec["mood"] = _clean_string(mood)[:160]
    picked = data.get("pickedVariant")
    if isinstance(picked, str) and picked.strip():
        spec["pickedVariant"] = _clean_string(picked)[:120]

    palette_in = data.get("palette")
    if isinstance(palette_in, dict):
        palette = {
            k: coerce_hex_color(palette_in.get(k))
            for k in ("primary", "accent", "background", "ink", "surface")
        }
        palette = {k: v for k, v in palette.items() if v}
        if palette:
            spec["palette"] = palette

    typo_in = data.get("typography")
    if isinstance(typo_in, dict):
        typo = {}
        if typo_in.get("heading") in ("serif", "sans", "display"):
            typo["heading"] = typo_in["heading"]
        if typo_in.get("body") in ("serif", "sans"):
            typo["body"] = typo_in["body"]
        if typo_in.get("scale") in _HEADING_SCALES:
            typo["scale"] = typo_in["scale"]
        if typo_in.get("weight") in ("light", "regular", "bold"):
            typo["weight"] = typo_in["weight"]
        if typo:
            spec["typography"] = typo

    shape_in = data.get("shape")
    if isinstance(shape_in, dict):
        shape = {}
        if shape_in.get("radius") in _RADII:
            shape["radius"] = shape_in["radius"]
        if shape_in.get("density") in ("airy", "balanced", "dense"):
            shape["density"] = shape_in["density"]
        if shape_in.get("borders") in ("hairline", "none", "heavy"):
            shape["borders"] = shape_in["borders"]
        if shape_in.get("shadows") in ("none", "soft", "strong"):
            shape["shadows"] = shape_in["shadows"]
        if shape:
            spec["shape"] = shape

    atm_in = data.get("atmosphere")
    if isinstance(atm_in, dict):
        atm = {}
        if atm_in.get("canvas") in _ATMOSPHERES:
            atm["canvas"] = atm_in["canvas"]
        if atm_in.get("intensity") in _INTENSITIES:
            atm["intensity"] = atm_in["intensity"]
        if atm:
            spec["atmosphere"] = atm

    sections_in = data.get("sections")
    if isinstance(sections_in, list):
        sections = []
        for item in sections_in[:14]:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip().lower()
            entry: Dict[str, Any] = {"role": role if role in _INSPO_SECTION_ROLES else "section"}
            for key, cap in (("layout", 80), ("notes", 220)):
                val = item.get(key)
                if isinstance(val, str) and val.strip():
                    entry[key] = _clean_string(val)[:cap]
            sections.append(entry)
        if sections:
            spec["sections"] = sections

    for key, cap, limit in (("signatureMoves", 160, 8), ("avoid", 120, 6)):
        val = data.get(key)
        if isinstance(val, list):
            items = [_clean_string(str(x))[:cap] for x in val[:limit] if isinstance(x, str) and x.strip()]
            if items:
                spec[key] = items

    return spec


# ─── Request / response models ──────────────────────────────────────────────

class PageImage(BaseModel):
    url: str
    caption: Optional[str] = None
    kind: Optional[str] = None  # logo | photo | banner


class CourseSnapshotItem(BaseModel):
    name: str
    price: Optional[str] = None
    level: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None


class GeneratePageRequest(BaseModel):
    brief: str = Field(..., description="The admin's natural-language description of the page")
    page_type: Optional[str] = Field(None, description="homepage | course-landing | about | admissions | contact")
    route_slug: Optional[str] = None
    institute_name: Optional[str] = None
    images: List[PageImage] = Field(default_factory=list)
    # Screenshots of sites the admin wants theirs to look like — reverse-
    # engineered into a structured design spec (palette hexes, typography, a
    # section-by-section blueprint) that the composer builds against. Their
    # CONTENT is never copied; only the design is.
    inspiration_image_urls: List[str] = Field(default_factory=list)
    # Pin the design language (see _DESIGN_LANGUAGES) instead of letting the
    # model choose — lets the wizard offer "same brief, different direction".
    design_language: Optional[str] = None
    # The institute's OWN existing website — we extract its real copy so the
    # rebuilt page keeps their actual content ("rebuild my site").
    source_url: Optional[str] = None
    # SOMEONE ELSE'S website whose LAYOUT the admin wants ("make mine look like
    # that"). We screenshot it server-side and feed the tiles to the same vision
    # pass as inspiration_image_urls. Their content is never copied; and with
    # global_settings pinned, neither are their colours — only the structure.
    reference_url: Optional[str] = None
    # Compact snapshot of real courses, passed by the admin FE so copy and
    # data-bound components reference real offerings (no new cross-service call).
    courses: List[CourseSnapshotItem] = Field(default_factory=list)
    # Institute Naming Settings overrides, e.g. {"course": "Program"}
    terminology: Optional[Dict[str, str]] = None
    # A distinct design angle for "try another direction" re-runs.
    direction: Optional[str] = None
    preferred_model: Optional[str] = None
    # Header/footer are site chrome; the composer may only emit them when the
    # caller explicitly opts in (Phase B copilot).
    allow_chrome: bool = False
    # Auto-generate a hero image + a few section visuals during composition.
    auto_images: bool = True
    # Audit the composed page for visible defects and spend one extra model call
    # repairing them. Off only for callers that want the raw composition.
    self_check: bool = True
    # The site's EXISTING theme. Send it when adding a page to a site that
    # already has a look: the composer then designs INTO that palette — picking
    # section tints and card styles that sit on it — instead of proposing a
    # fresh theme the admin has to remember not to apply. Without this there was
    # no way to say "same theme as my other pages" for a single page; only
    # multi-page site generation pinned a shared theme, and it did so internally.
    global_settings: Optional[Dict[str, Any]] = None


class GeneratePageResponse(BaseModel):
    page: Dict[str, Any]
    # A matching site theme (globalSettings) the composer chose for this page —
    # the wizard applies it so the page renders premium, not on the plain
    # default. None when the model omitted it.
    global_settings: Optional[Dict[str, Any]] = None
    run_id: str
    model: str
    warnings: List[str] = Field(default_factory=list)


# Font LABEL → CSS stack (globalSettings.fonts.family is stored as a stack).
_FONT_STACKS: Dict[str, str] = {
    "Inter": "Inter, sans-serif",
    "Roboto": "Roboto, sans-serif",
    "Open Sans": '"Open Sans", sans-serif',
    "Poppins": "Poppins, sans-serif",
    "Lato": "Lato, sans-serif",
    "Montserrat": "Montserrat, sans-serif",
    "Mulish": "Mulish, sans-serif",
    "Figtree": "Figtree, sans-serif",
    "Outfit": "Outfit, sans-serif",
    "Nunito": "Nunito, sans-serif",
    "Space Grotesk": '"Space Grotesk", sans-serif',
    "Playfair Display": '"Playfair Display", serif',
    "Fraunces": "Fraunces, serif",
    "Newsreader": "Newsreader, serif",
    "Lora": "Lora, serif",
    "DM Serif Display": '"DM Serif Display", serif',
    # Rounded/friendly faces for family, pre-school and kids brands — without
    # these every warm childcare reference was rebuilt in Nunito or Inter,
    # close in weight and wrong in character.
    "Rubik": "Rubik, sans-serif",
    "Quicksand": "Quicksand, sans-serif",
    "Baloo 2": '"Baloo 2", sans-serif',
    # Devanagari faces (mirrors catalogue-fonts.ts) for Hindi / Marathi sites.
    "Noto Sans Devanagari": '"Noto Sans Devanagari", sans-serif',
    "Mukta": "Mukta, sans-serif",
    "Hind": "Hind, sans-serif",
    "Noto Serif Devanagari": '"Noto Serif Devanagari", serif',
    "Tiro Devanagari Hindi": '"Tiro Devanagari Hindi", serif',
}

# One compact, VALID exemplar page showing the premium vocabulary in-schema —
# few-shot so the model produces designed pages (eyebrow badges, stat chips,
# highlighted headings, glass cards, ornaments, marquee, atmosphere theme)
# instead of plain stacked sections on the default theme.
_PREMIUM_EXEMPLAR = json.dumps({
    "globalSettings": {
        "theme": {"preset": "forest", "atmosphere": {"canvas": "mesh", "intensity": "medium"}, "headingScale": "editorial", "borderRadius": "rounded"},
        "fonts": {"enabled": True, "family": "Inter, sans-serif", "headingFamily": "Playfair Display, serif"},
        "motion": {"personality": "calm"},
    },
    "page": {
        "title": "GATE & ISRO Coaching",
        "route": "home",
        "components": [
            {
                "id": "hero", "type": "heroSection", "enabled": True,
                "props": {
                    "layout": "split",
                    "eyebrow": {"text": "Trivandrum's premier engineering institute", "style": "badge"},
                    "left": {
                        "title": "Train for GATE, ISRO, PSC — and land your career",
                        "description": "<p>IIT & NIT alumni-led coaching across every engineering branch — from GATE and ISRO to Kerala PSC and campus placements.</p>",
                        "buttons": [
                            {"text": "Explore all programs", "action": "navigate", "target": "#courses", "variant": "primary"},
                            {"text": "View branches", "action": "navigate", "target": "#branches", "variant": "secondary"},
                        ],
                    },
                    "right": {"image": "gen:A warm, bright photograph of focused engineering students collaborating over laptops and circuit boards at a modern lab bench, natural window light, shallow depth of field"},
                    "statChips": [
                        {"value": "30K+", "label": "Students trained"},
                        {"value": "5K+", "label": "Placements / year"},
                        {"value": "85%", "label": "Selection rate"},
                    ],
                },
                "style": {"layout": {"width": "wide"}, "minHeight": "80vh", "contentAlign": "center"},
            },
            {
                "id": "ticker", "type": "logoCloud", "enabled": True,
                "props": {"layout": "marquee", "display": "label-pill", "marqueeSpeed": "slow", "logos": [
                    {"label": "GATE 2025 batches open"}, {"label": "ISRO / BARC post-GATE"}, {"label": "Kerala PSC technical coaching"},
                ]},
            },
            {
                "id": "why", "type": "sectionHeading", "enabled": True,
                "props": {"eyebrow": "Why choose us", "title": "Coaching that actually converts", "highlight": {"text": "converts", "style": "gradient"}, "lead": "Outcome-first programs built around real exam patterns.", "align": "center", "size": "lg"},
            },
            {
                "id": "features", "type": "featureGrid", "enabled": True,
                "props": {"columns": 3, "style": "glass", "align": "left", "features": [
                    {"iconName": "Trophy", "title": "Proven results", "description": "Consistent top ranks across GATE and PSC.", "chips": ["30K+ trained"]},
                    {"iconName": "UsersThree", "title": "Alumni mentors", "description": "Taught by IIT/NIT alumni who cleared these exams."},
                    {"iconName": "Target", "title": "Exam-pattern drills", "description": "Weekly mocks tuned to the latest paper pattern."},
                ]},
                "style": {"ornaments": [{"preset": "glow-orb", "x": "72%", "y": "-10%", "size": "420px", "opacity": 0.22, "blur": 40}]},
            },
            {"id": "courses", "type": "courseCatalog", "enabled": True, "props": {"title": "Explore our programs"}},
            {
                "id": "cta", "type": "ctaBanner", "enabled": True,
                # Must match CtaBannerRenderer's actual contract ({heading, subheading, button}).
                # It previously taught {headerText, description, buttonText, buttonAction}, none of
                # which the renderer reads — a model that copied the exemplar faithfully produced an
                # empty coloured band.
                "props": {"heading": "Ready to start?", "subheading": "Book a free demo class this week.",
                          "layout": "centered",
                          "button": {"enabled": True, "text": "Book a free demo", "action": "navigate",
                                     "target": "contact", "style": "white"}},
                "style": {"layout": {"width": "full"}, "backgroundLayers": [{"type": "linear", "from": "hsl(var(--primary-500))", "to": "hsl(var(--primary-400))", "angle": 120}]},
            },
        ],
    },
}, ensure_ascii=False)


# ─── Prompt ──────────────────────────────────────────────────────────────────

# Shared by every prompt that lists the vocabulary. `exampleProps` is the
# editor's default template for a component, and treating it as the component's
# limit is the single biggest cause of flat output: the composer would emit grey
# icons because the featureGrid example shows iconName, never learning that each
# feature also takes a real image, bullets, a badge or a link.
_VOCAB_HEADER = (
    "## COMPONENT VOCABULARY\n"
    "For each type: `exampleProps` is ONE valid arrangement (the editor's default), NOT the limit of "
    "what the component can do. `capabilities`, where present, is the full prop surface the renderer "
    "actually reads, with the allowed values — prefer it when choosing how to build a section. "
    "`usage` says when to reach for the component; `dataBound` marks components that render LIVE "
    "institute data and must not have content invented for them. Props outside these lists are "
    "ignored by the renderer, so inventing one produces a section that silently renders without it.\n"
)


# Preset brand colours (learner catalogue-themes.css --primary-500), used to
# derive a dark band surface when a pinned theme names a preset but no hex.
_PRESET_PRIMARY_HEX = {
    "default": "#0EA5E9", "ocean": "#0EA5E9", "forest": "#22C55E", "sunset": "#F97316",
    "midnight": "#7C3AED", "rose": "#E11D48", "violet": "#8B5CF6", "amber": "#F59E0B", "slate": "#283E70",
}


def _derive_dark_surface(theme: Any) -> str:
    """The dark band colour a pinned theme implies: its brand hue taken down to
    a deep shade (L≈14%). A navy brand gives a navy band, a forest brand a deep
    green — so bands the reference paints dark come out dark in THIS site's
    colour, not the reference's. Falls back to a neutral near-black."""
    import colorsys

    theme = theme if isinstance(theme, dict) else {}
    primary = coerce_hex_color(theme.get("primaryColor")) or _PRESET_PRIMARY_HEX.get(str(theme.get("preset") or "").lower())
    if not primary:
        return "#111827"
    r, g, b = (int(primary[i:i + 2], 16) / 255.0 for i in (1, 3, 5))
    h, l, sat = colorsys.rgb_to_hls(r, g, b)
    rr, gg, bb = colorsys.hls_to_rgb(h, 0.14, min(sat, 0.55))
    return "#%02X%02X%02X" % (round(rr * 255), round(gg * 255), round(bb * 255))


def _hex_distance(a: str, b: str) -> int:
    """Manhattan distance in RGB between two #rrggbb strings (0 = identical)."""
    return sum(abs(int(a[i:i + 2], 16) - int(b[i:i + 2], 16)) for i in (1, 3, 5))


def _recolour_reference_palette(node: Any, ref_palette: Dict[str, Any], surface: str, _tol: int = 48) -> int:
    """Theme-locked builds: scrub every colour prop that is (near) a colour
    sampled from the reference. A dark background becomes the site's own dark
    surface; anything else is dropped so the theme tokens take over. Near-white
    is left alone (it is the canvas, not a brand cue). Mutates; returns the
    number of props touched."""
    refs = [h for h in (coerce_hex_color(v) for v in (ref_palette or {}).values()) if h]
    refs = [h for h in refs if not _is_near_white(h)]
    if not refs:
        return 0
    touched = 0

    def visit(obj: Any) -> None:
        nonlocal touched
        if isinstance(obj, dict):
            for key in list(obj.keys()):
                val = obj[key]
                if isinstance(val, (dict, list)):
                    visit(val)
                    continue
                if not (isinstance(key, str) and key.lower().endswith("color")):
                    continue
                hexv = coerce_hex_color(val)
                if not hexv or _is_near_white(hexv) or not any(_hex_distance(hexv, r) <= _tol for r in refs):
                    continue
                if key.lower().endswith("backgroundcolor") and is_hex_dark(hexv):
                    obj[key] = surface
                else:
                    del obj[key]
                touched += 1
        elif isinstance(obj, list):
            for item in obj:
                visit(item)

    visit(node)
    return touched


def _is_near_white(hexv: str) -> bool:
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.93


def _inspiration_block(inspiration: Any, theme_locked: bool = False, locked_surface: Optional[str] = None) -> str:
    """Render the reverse-engineered reference design as a STRUCTURAL constraint.

    The old version pasted mood adjectives under a heading that said "direction
    ONLY", which the model reasonably read as "ignore the layout". The spec is
    now the page's plan: its section list becomes the section list, its palette
    becomes theme.primaryColor, its typography becomes the font pairing.

    theme_locked ("make mine look like THAT site, but in MY colours"): the
    site already has a theme, so every colour and font line is replaced by an
    explicit instruction to take structure only — the reference's palette must
    not leak into the page through any prop."""
    if isinstance(inspiration, str):
        text = inspiration.strip()
        return (
            "## REFERENCE DESIGN (screenshots the admin wants their site to look like)\n" + text
            + "\nMatch this direction. Never reuse their copy, logo or images."
        ) if text else ""
    if not isinstance(inspiration, dict) or not inspiration:
        return ""

    if theme_locked:
        # Strip the sampled colours from what the model sees: a hex in the
        # spec is a hex it will reach for, whatever the prose says.
        inspiration = {k: v for k, v in inspiration.items() if k not in ("palette", "typography")}
    lines = [
        "## REFERENCE DESIGN — MATCH THIS" if not theme_locked else
        "## REFERENCE LAYOUT — MATCH ITS STRUCTURE (colours and fonts come from the FIXED SITE THEME below)",
        "The admin gave screenshots of the site they want theirs to look like; a vision pass "
        "reverse-engineered it into the spec below. Treat it as the PLAN for this page, not as vague "
        "inspiration — a visitor should recognise the same design language. The one thing you must NOT "
        "reuse is their CONTENT: every headline, sentence, statistic, logo and image comes from this "
        "institute's own brief and provided assets.",
        json.dumps(inspiration, ensure_ascii=False),
        "HOW TO APPLY IT:",
    ]
    if inspiration.get("pickedVariant"):
        lines.append(
            f"- VARIANT: the reference was a template sheet; build \"{inspiration['pickedVariant']}\" and "
            "nothing from the other variants."
        )
    palette = inspiration.get("palette") if isinstance(inspiration.get("palette"), dict) else {}
    primary = palette.get("primary")
    surface = palette.get("surface")
    if theme_locked:
        band = locked_surface or "#111827"
        lines.append(
            "- COLOURS: this site already has a theme. Do NOT set globalSettings.theme.primaryColor, do NOT "
            "set page.backgroundColor, and do NOT paint any section, card, chip or button with a colour "
            "taken from the reference — buttons and links pick up the theme's brand colour by themselves. "
            "Section tints, if the layout alternates them, are the theme's own light tints."
        )
        lines.append(
            f"- DARK BANDS: where the reference paints a band dark (header, hero, CTA, footer), paint it "
            f"with props.backgroundColor \"{band}\" — this site's own dark surface, derived from its brand "
            "colour (the renderer switches the band's ink to light). Never the reference's surface colour."
        )
        lines.append(
            "- TYPE: keep the theme's fonts. Copy only the reference's SCALE — an oversized hero headline, "
            "a small tracked eyebrow, tight card titles — via headingScale and the components' own props."
        )
    if surface and not theme_locked:
        lines.append(
            f"- DARK BANDS: the reference's header/hero/footer surface is \"{surface}\". Paint those bands "
            f"with props.backgroundColor \"{surface}\" (the renderer switches their ink to light) — this "
            "is a SURFACE, never theme.primaryColor."
        )
    if theme_locked:
        pass
    elif primary:
        lines.append(
            f"- BRAND COLOUR: set globalSettings.theme.primaryColor to \"{primary}\" (the reference's own "
            "brand colour) and choose the preset whose family sits closest to it. This is the single "
            "strongest cue that the page matches — do not substitute a preset colour for it."
        )
    else:
        lines.append(
            "- BRAND COLOUR: no reliable colour was sampled — pick the preset that best fits the mood, and "
            "set theme.primaryColor only if the institute's own brand colour is known."
        )
    background = palette.get("background")
    if theme_locked:
        background = None
    if background and background.lower() not in ("#ffffff", "#fefefe"):
        lines.append(
            f"- CANVAS: the reference does NOT sit on white — its page surface is \"{background}\". Set "
            f"page.backgroundColor to \"{background}\". A cream or tinted paper rebuilt on pure white "
            "loses most of its warmth even when every other choice is right, and alternating section "
            "tints should be picked to sit on THAT surface, not on white."
        )
    if palette.get("ink") and not theme_locked:
        lines.append(
            f"- INK: body and heading text in the reference reads as \"{palette['ink']}\". Where you set a "
            "textColor explicitly, stay close to it, and keep every text/background pair you author at a "
            "contrast ratio of at least 4.5:1."
        )
    if palette.get("accent") and not theme_locked:
        lines.append(
            f"- SECONDARY: \"{palette['accent']}\" is the reference's second colour — use it for ornaments, "
            "chips or a single contrasting band rather than as the brand colour."
        )
    typo = inspiration.get("typography") if isinstance(inspiration.get("typography"), dict) else {}
    if typo and not theme_locked:
        head = typo.get("heading")
        want = (
            "a SERIF display face (Playfair Display / Fraunces / DM Serif Display)" if head == "serif"
            else "a distinctive display sans (Space Grotesk / Outfit)" if head == "display"
            else "a clean sans (Inter / Figtree / Mulish)"
        )
        lines.append(
            f"- TYPE: the reference's headings read '{head or 'sans'}' — use {want} for fonts.headingFamily "
            f"over a sans body, and headingScale '{typo.get('scale', 'default')}'."
        )
    shape = inspiration.get("shape") if isinstance(inspiration.get("shape"), dict) else {}
    if shape.get("radius"):
        lines.append(f"- SHAPE: borderRadius '{shape['radius']}'; density reads '{shape.get('density', 'balanced')}'.")
    atm = inspiration.get("atmosphere") if isinstance(inspiration.get("atmosphere"), dict) else {}
    if atm.get("canvas"):
        lines.append(
            f"- SURFACE: atmosphere canvas '{atm['canvas']}', intensity '{atm.get('intensity', 'subtle')}'. "
            "If the reference is flat and paper-like, DO honour that — forcing a mesh gradient onto a "
            "deliberately flat design is the most common way a rebuild stops looking like its reference."
        )
    sections = inspiration.get("sections") if isinstance(inspiration.get("sections"), list) else []
    if sections:
        lines.append(
            "- STRUCTURE: build the page in the SAME ORDER as `sections`, mapping each role onto the "
            "closest component in the vocabulary (hero→heroSection, logos→logoCloud, features→featureGrid, "
            "stats→statsHighlights, steps→stepsProcess, courses→featureGrid with style 'photo' when the "
            "reference shows PICTURE cards (add layout 'carousel' for a swipeable row) or courseCatalog "
            "when it shows a plain live grid, testimonials→"
            "testimonialSection, faq→tabsAccordion, cta→ctaBanner, directory/table→detailBlocks or "
            "htmlBlock, gallery→imageGallery, team→teamSection, pricing→pricingTable, contact→contactForm "
            "or leadForm). Honour each entry's `layout`. Drop a section only when this institute has no "
            "content for it, and add one only when the brief needs it — do not silently fall back to the "
            "default landing-page rhythm. PEOPLE ARE NEVER INVENTED: a testimonials/team/logos band is "
            "built only from names, quotes and partners that appear in the brief or the imported site; "
            "if there are none, OMIT that band (it will be removed anyway)."
        )
    moves = inspiration.get("signatureMoves") if isinstance(inspiration.get("signatureMoves"), list) else []
    if moves:
        lines.append(
            "- SIGNATURE DETAILS: reproduce these with our style vocabulary (chips, eyebrows, "
            "sectionHeading highlights, featureGrid style/headerVariant, ornaments, surface tints): "
            + "; ".join(moves)
            + "\n  For flat overlapping discs of colour, use the 'circles-playful' or 'circles-corner' "
            "ornament preset — NOT glow-orb, which is a soft blurred glow and will read as a faint "
            "wash where the reference has crisp shapes."
        )
    avoid = inspiration.get("avoid") if isinstance(inspiration.get("avoid"), list) else []
    if avoid:
        lines.append(
            "- DO NOT USE (these would break the look, even where the design rules below suggest them): "
            + "; ".join(avoid)
        )
    if inspiration.get("notes"):
        lines.append("- NOTES: " + str(inspiration["notes"]))
    return "\n".join(lines)


# A LIBRARY of design languages, not one house style. With a single exemplar and
# an imperative doctrine ("ALWAYS open with a badge + 3 stat chips + a marquee"),
# every brief converged on the same page — competent but unmistakably templated,
# and unable to follow a reference that looked nothing like it. The model now
# commits to ONE language chosen for the brand, so a law academy and a coding
# bootcamp come out looking like different studios made them.
_DESIGN_LANGUAGES: List[Dict[str, str]] = [
    {
        "id": "editorial-serif",
        "fits": "premium, established or story-led brands; law/UPSC/medical academies; anything selling credibility",
        "theme": "preset default|slate|forest, atmosphere soft + subtle, headingScale editorial, borderRadius rounded",
        "fonts": "headingFamily Playfair Display | Fraunces | DM Serif Display over an Inter or Mulish body",
        "moves": "one oversized serif headline with lots of air; sectionHeading highlight style 'underline' (not gradient); "
                 "restrained single accent; statsHighlights as plain large numerals; featureGrid style 'tinted' or plain cards; "
                 "photography over illustration",
        "avoid": "glass cards, gradient text, marquee tickers, glow orbs — they cheapen an editorial page",
    },
    {
        "id": "swiss-minimal",
        "fits": "clarity-first technical coaching, exam prep, engineering; briefs heavy on facts, schedules or syllabi",
        "theme": "preset slate|default, atmosphere flat + subtle, headingScale compact, borderRadius sharp",
        "fonts": "Inter or Figtree for both heading and body — no display face",
        "moves": "strict grid; everything left-aligned; hairline borders (detailBlocks); dense label:value strips; "
                 "monochrome or no icons; tight vertical rhythm; tables over cards",
        "avoid": "gradients, drop shadows, glassmorphism, ornaments, decorative badges",
    },
    {
        "id": "bold-modern",
        "fits": "energetic outcome-driven programs; placement training, bootcamps, skilling, cohort courses",
        "theme": "preset ocean|violet, atmosphere mesh + medium, headingScale default, borderRadius rounded",
        "fonts": "headingFamily Space Grotesk | Outfit over an Inter body",
        "moves": "hero with eyebrow badge, two CTAs and three statChips; featureGrid style 'panel' with ONE headerVariant "
                 "'solid' pillar; logoCloud in 'marquee' as a ticker; gradient CTA band; a single glow-orb ornament",
        "avoid": "serif display faces, hairline-table layouts",
    },
    {
        "id": "dark-tech",
        "fits": "engineering, AI/ML, coding and cybersecurity programs; audiences who read as developers",
        "theme": "preset midnight, atmosphere aurora + medium, headingScale default, borderRadius rounded",
        "fonts": "headingFamily Space Grotesk over an Inter body",
        "moves": "dark hero that fills the fold; featureGrid style 'glass' or 'gradient-border'; technical chips "
                 "(languages, tools, versions); glow-orb ornaments; stepsProcess variant 'timeline-cards'",
        "avoid": "pastel tints, warm pills, light paper surfaces",
    },
    {
        "id": "warm-community",
        "fits": "schools, pre-schools, arts, music, sports, hobby classes, NGOs; parent and child audiences",
        "theme": "preset sunset|amber|rose, atmosphere soft + medium, headingScale default, borderRadius pill",
        "fonts": "headingFamily Fraunces | Nunito over a Mulish or Nunito body",
        "moves": "rounded pill shapes everywhere; hero with an image collage; testimonialSection with ratings; "
                 "featureGrid style 'tinted' with friendly iconName; generous colour; flat overlapping discs via "
                 "the 'circles-playful' ornament preset over a cream page.backgroundColor (this pairing IS the "
                 "look — a blurred glow-orb on white is a different, blander design)",
        "avoid": "dark inverted bands, sharp corners, corporate greys, blurred glow ornaments",
    },
    {
        "id": "corporate-trust",
        "fits": "B2B training, universities, certification bodies, placement/HR-facing pages",
        "theme": "preset slate|ocean, atmosphere soft + subtle, headingScale default, borderRadius rounded",
        "fonts": "Inter | Lato | Open Sans body, optionally a Newsreader heading",
        "moves": "logoCloud as a STATIC partner grid (not a marquee); a stats band of verifiable numbers; teamSection "
                 "with credentials; pricingTable; one muted accent used sparingly",
        "avoid": "playful ornaments, aurora canvases, gradient text, countdown timers",
    },
    {
        "id": "directory-reference",
        "fits": "catalogues, book stores, program indexes, fee tables, syllabus and policy pages — information, not persuasion",
        "theme": "preset default|slate, atmosphere flat + subtle, headingScale compact, borderRadius rounded",
        "fonts": "Inter or Figtree for both",
        "moves": "NO hero — the fold belongs to the content; detailBlocks hairline grids; label:value spec strips; "
                 "an anchor list at the top; one well-built htmlBlock for a dense bordered table",
        "avoid": "marketing heroes, stat chips, gradients, testimonials, countdowns",
    },
]


def _design_language_block(preferred: Optional[str] = None) -> str:
    lines = [
        "## DESIGN LANGUAGES — pick exactly ONE and commit to it",
        "These are seven different houses, not a ranking. Choose the one that genuinely fits THIS "
        "institute's subject, audience and brief, then apply its theme, fonts and signature moves "
        "consistently and respect its `avoid` list even where the DESIGN RULES below suggest otherwise. "
        "Do NOT blend two languages, and do NOT default to bold-modern because it is listed third — a "
        "law academy, a pre-school and a cybersecurity bootcamp must not come out looking alike. "
        "When a REFERENCE DESIGN is supplied, it wins: pick the language closest to it and let the "
        "reference override any conflicting detail.",
    ]
    for lang in _DESIGN_LANGUAGES:
        lines.append(
            f"- **{lang['id']}** — fits: {lang['fits']}\n"
            f"  theme: {lang['theme']}\n  fonts: {lang['fonts']}\n"
            f"  signature moves: {lang['moves']}\n  avoid: {lang['avoid']}"
        )
    # Allowlist, never the raw string: design_language arrives from the client and
    # is interpolated into the prompt, so an unknown value must be dropped rather
    # than echoed (a free-text field that reaches a prompt is an injection surface).
    if preferred in {lang["id"] for lang in _DESIGN_LANGUAGES}:
        lines.append(f"The admin explicitly asked for the '{preferred}' language — use it.")
    return "\n".join(lines)


_PREMIUM_DOCTRINE = [
    "Design like a senior product designer for a premium education brand — NOT a generic template. "
    "Compare your output to award-winning cohort/coaching landing pages: confident, editorial, spacious.",
    "ALWAYS return globalSettings, and take theme, atmosphere, headingScale, borderRadius and the FONT PAIRING from the "
    "DESIGN LANGUAGE you chose — that section, not this one, decides the look. Two rules hold across all languages: "
    "(1) a font PAIRING (a display/serif heading over a sans body) reads more designed than one family used for everything, "
    "unless the language explicitly calls for a single family; (2) when the institute's real brand colour or a reference "
    "design's accent colour is known, set theme.primaryColor to that exact hex — the 9 presets are starting points, and a "
    "page in the brand's own colour is immediately more convincing than a page in ours. Motion: calm or balanced.",
    "A heroSection on a section shell MUST use style.layout.width 'full', on every page type. The hero paints its own "
    "surface and already centres its content, so any narrower shell clips that surface into an inset card with gutters "
    "down both sides. Constrain other sections, never this one.",
    "On a LANDING page, open with a heroSection that FILLS THE FOLD: put it on a section shell (style.layout.width 'full') "
    "with minHeight '80vh' + contentAlign 'center'. The chosen language decides the treatment — whether it is split with an "
    "image, centered, or full-bleed; whether an eyebrow badge and statChips belong (they suit bold-modern, they cheapen "
    "editorial-serif and swiss-minimal); and how many CTAs. Always give the headline something SPECIFIC to say. "
    "On a DIRECTORY/reference page the fold belongs to the CONTENT, not to a hero — see the ARCHETYPE section, which overrides this.",
    "Introduce dense sections with a sectionHeading rather than letting cards start cold. A highlight on ONE key phrase is what "
    "makes a page feel designed — but match its style to the language: 'gradient' for bold-modern and dark-tech, 'underline' for "
    "editorial-serif and corporate-trust, and no highlight at all for swiss-minimal or directory-reference.",
    "For a DIVISIONS / two-pillars / plan-comparison / 'what you get' section, use featureGrid with style 'panel' (columns 2 or 3): each feature is a card with a "
    "tinted HEADER band (props: badge, iconName, title, description) over a body of `bullets`. Make ONE pillar stand out by setting its headerVariant 'solid' "
    "(brand-colored header, white text) while the others stay headerVariant 'tint' — this is the single most 'designed' section pattern. Do NOT use plain 'cards' "
    "for divisions/comparisons.",
    "Reach past the plainest form of every component, in the direction your language points: featureGrid has style "
    "'glass'/'gradient-border'/'tinted'/'panel' and per-feature chips; stepsProcess has variant 'timeline-cards' and "
    "'alternating' plus nodeStyle 'icon' (bare numbered steps look dated in every language); logoCloud has a 'marquee' ticker "
    "layout and a static grid; testimonialSection has ratings; trustChip exists. Restraint is a legitimate choice — "
    "swiss-minimal and editorial-serif look BETTER plain — but plainness must be the language's decision, never a default. "
    "NEVER use the plain 'banner' component for a hero.",
    "Feature/accordion icons: ALWAYS set iconName from the icon library (GraduationCap, Rocket, Target, UsersThree, Code, Brain, Trophy, Lightbulb, ShieldCheck, "
    "ChartLineUp, Clock, Star, BookOpen, Certificate, ChatsCircle, Wrench, Sparkle, Medal, Briefcase, Globe) — never rely on the emoji 'icon' field; emojis read cheap.",
    "Theme preset: commit to a COLOR that fits the brand's subject (ocean/midnight = tech & engineering, forest = growth & science, sunset/amber = energetic, "
    "rose/violet = creative, slate = corporate). Prefer an exact theme.primaryColor over a preset whenever the brand's real "
    "colour is known; use 'default' with no primaryColor only when the institute's own configured colour should shine through unchanged.",
    "Depth is language-dependent, and one accent per section is the ceiling in all of them: glow-orb ornaments and gradient CTA "
    "bands belong to bold-modern and dark-tech; editorial-serif wants whitespace and a hairline rule instead; swiss-minimal and "
    "directory-reference want NO decoration at all. A flat page is not automatically cheap — an undecided page is.",
    "Rhythm: AT MOST ONE hero; alternate section surface tints; end with a CTA (and contact if a contact page). "
    "Section count and whether a live courseCatalog belongs at all are decided by the ARCHETYPE and COMMERCE sections below — "
    "never add courseCatalog, cartComponent or any price/enrol element to a page whose brief says it is informational.",
    "Copy: concise, benefit-led, specific to THIS institute (use real course names + the provided stats/claims). Never lorem ipsum, never generic filler. Mirror the brief's language.",
    "htmlBlock — when a design genuinely cannot be expressed with the typed components (a bespoke bento grid, an unusual editorial "
    "layout, decorative hero art, or a DENSE INFORMATION TABLE such as a hairline-bordered spec grid or a label:value detail strip), "
    "use htmlBlock: props {html, css, prompt}. It is NOT a last resort for information-heavy reference pages — for those it is often the "
    "RIGHT choice, because the typed components are built for marketing sections and cannot render a bordered no-gap data table. "
    "ONE htmlBlock may contain MANY repeated blocks (e.g. every offering on a directory page), so prefer one well-built htmlBlock over "
    "several. Budget: AT MOST THREE htmlBlock components per page. Hard rules: (1) style ONLY via the css "
    "prop with class selectors — never <style> tags in the html; (2) ALL colors and fonts MUST come from the site theme variables — var(--primary-500), "
    "var(--primary-400), var(--primary-50), var(--catalogue-text-primary), var(--catalogue-text-secondary), var(--catalogue-bg), var(--catalogue-border), "
    "font-family: var(--catalogue-heading-font, inherit) for display text — NEVER literal hex colors, so re-theming still works; (3) MUST be responsive: "
    "include @media (max-width: 640px) rules; (4) no scripts, iframes, svg, forms or external assets — <img> only with PROVIDED image URLs; animation via "
    "CSS only (the section renders in a sandbox that strips everything else); (5) set props.prompt to a one-line brief of the section's intent so it can be "
    "regenerated later; (6) include generous padding (the section renders full-bleed with no outer spacing of its own). Prefer typed components whenever they fit.",
]


# ── Page archetypes ────────────────────────────────────────────────────────────
# The doctrine above describes a persuasive LANDING page. Applied to a reference
# page it produces the wrong artefact: an Edzumo admin who asked for "details of
# programs, no enroll flow just data" got an 80vh hero, three generic feature
# grids that collapsed 25 offerings into 3 buckets, and a live enrol grid. The
# archetype block below is appended per page_type and OVERRIDES the landing-page
# rhythm rules, so structure follows the admin's actual intent.
_ARCHETYPE_RULES: Dict[str, str] = {
    "homepage": (
        "LANDING. Persuasive arc: hero → proof → what you get → how it works → social proof → CTA. "
        "The hero owns the fold. 6–12 sections."
    ),
    "courses": (
        "DIRECTORY / REFERENCE. This page's job is to DOCUMENT what the institute offers — densely, "
        "scannably, in the order given. Rules:\n"
        "  (1) NO tall hero. Open with a compact page header (a sectionHeading, or a heroSection with NO "
        "minHeight) so real content is visible in the fold.\n"
        "  (2) ONE self-contained block PER offering. Do NOT merge several offerings into one card and "
        "do NOT summarise the list into 2–4 generic buckets — an admin who lists 25 offerings expects to "
        "find all 25 on the page, each by its REAL name. If there are more than 12, group them under "
        "sectionHeadings by theme, but every offering still gets its own titled block.\n"
        "  (3) Each block carries: a short uppercase eyebrow/tag, the offering's real name as the "
        "heading, a 1–2 sentence description, 4–6 concrete detail items (what is covered/included), and "
        "a strip of 3–4 label:value specs (eligibility, mode, duration, level…). Give exactly ONE block "
        "a visually distinct accent treatment if one offering is the flagship.\n"
        "  (4) USE `detailBlocks` for this — it exists for exactly this page. ONE detailBlocks component "
        "whose `blocks` array holds one entry per offering (tag, title, description, items[], specs[], "
        "optional note, optional anchor). Do NOT reach for sectionHeading+featureGrid here: featureGrid "
        "renders gapped marketing cards and has no spec strip. htmlBlock stays available only if a layout "
        "genuinely needs something detailBlocks cannot express.\n"
        "  (5) Coverage beats verbosity: if space is tight, shorten each block rather than dropping "
        "offerings. Never invent a detail you were not given — omit a spec you do not know rather than "
        "guessing eligibility, duration, fees or outcomes for a real programme.\n"
        "  (6) Testimonial, logoCloud and marquee sections are NOISE here — omit them. End with ONE CTA."
    ),
    "course-landing": (
        "SINGLE-OFFERING SALES PAGE. One offering only: hero → outcomes → curriculum/what's included → "
        "proof → pricing/enrol → FAQ → CTA. Depth over breadth."
    ),
    "about": (
        "STORY. Narrative order: who we are → origin → what we believe → the people → proof/milestones "
        "→ a soft CTA. Prose-led; prefer readable measure over dense grids."
    ),
    "admissions": (
        "PROCESS. Lead with a stepsProcess of the actual admission steps, then eligibility and dates as "
        "label:value detail, then required documents, then FAQ, then the apply CTA."
    ),
    "contact": (
        "CONTACT. Address/phone/email and a contactForm high on the page, a mapEmbed, hours, and a short "
        "FAQ. No hero taller than the content."
    ),
}

# Phrases an admin uses when they want a reference page with no commerce on it.
_INFO_ONLY_MARKERS = (
    "no enroll", "no enrol", "no enrollment", "no enrolment", "without enroll", "without enrol",
    "no signup", "no sign up", "no sign-up", "no registration",
    "just data", "only data", "just info", "just information", "information only", "informational",
    "details only", "just details", "no price", "no prices", "no pricing", "no fee", "no fees",
    "no payment", "no checkout", "no cart", "no buy", "not for sale", "no selling",
)


def _is_info_only(brief: str) -> bool:
    """True when the admin explicitly asked for an informational page.

    Drives the COMMERCE directive: the doctrine used to tell the composer to
    always place a live courseCatalog, so "no enroll flow just data" still came
    back with an enrol grid.
    """
    lowered = (brief or "").lower()
    return any(marker in lowered for marker in _INFO_ONLY_MARKERS)


# Platform defaults for the Naming Settings labels the admin FE sends. An entry
# whose value still equals its default is NOT a rename — the admin simply never
# touched it — so it must produce no instruction at all. Edzumo's payload was
# {"course": "Question Set", "learner": "Student", "level": "Level",
#  "session": "Session", "batch": "Batch"}: only TWO real renames, yet the old
# "use these words in all copy" line made the model dutifully work the untouched
# words into prose too ("Multi-Session programs, Batch-wise schedule").
_TERM_DEFAULTS: Dict[str, str] = {
    "course": "Course", "level": "Level", "session": "Session",
    "subject": "Subject", "module": "Module", "chapter": "Chapter",
    "slide": "Slide", "livesession": "Live Session", "batch": "Batch",
    "package": "Package", "populartag": "Popular Tag", "learner": "Learner",
    "teacher": "Teacher", "admin": "Admin", "evaluator": "Evaluator",
    "coursecreator": "Course Creator", "assessmentcreator": "Assessment Creator",
    "invite": "Invite", "audiencelist": "Audience List", "inventory": "Inventory",
    "suborg": "Sub-Org",
}

_TERMINOLOGY_RULES = (
    "\nHOW TO APPLY IT — a substitution is correct ONLY where the text names that entity type as a "
    "generic noun. Everywhere else, write normal natural English.\n"
    "1. UI LABELS (nav items, section headings, button text, filter labels, table headers, tabs): use "
    "the value EXACTLY as written above, in its given Title Case.\n"
    "2. RUNNING PROSE (any sentence, paragraph or description): write the term in LOWER CASE — "
    "\"browse our question sets\", \"built for students and graduates\". NEVER paste a Title Case label "
    "mid-sentence: \"engineering Students & graduates\" is WRONG, \"engineering students & graduates\" is "
    "right. Keep the given capitalisation only for acronyms (MBA, IIT, GATE).\n"
    "3. PLURALS: use only a plural form listed above. If none is listed, do NOT invent one — this "
    "institute may spell its plural differently. Rewrite instead: singular attributively (\"Question Set "
    "details\"), or a determiner (\"every Question Set\").\n"
    "4. NEVER rename a PROPER NOUN. Real course / program / exam / company names are reproduced "
    "verbatim. \"Placement-focused Question Sets for MakeMyTrip\" is WRONG — MakeMyTrip is the NAME of a "
    "program, so write \"MakeMyTrip placement program\" in the brief's own words. A heading or card title "
    "carrying a real offering's name is never rewritten, re-bucketed or re-labelled.\n"
    "5. Entities NOT listed above were never renamed, so you have NO instruction about them. Do not "
    "force words like \"Session\", \"Batch\" or \"Level\" into copy where a person writing about this "
    "institute would not use them. \"Multi-Session programs, Batch-wise schedule\" is robot copy.\n"
    "6. THE ADMIN'S BRIEF WINS. Mirror the words the admin used for their own offerings. This glossary "
    "only fixes what the PLATFORM's entities are CALLED in labels. If applying a term would make a "
    "phrase read awkwardly, do not apply it."
)

_TERMINOLOGY_INTAKE_NOTE = (
    "\n7. IN THIS INTERVIEW: use these labels when talking to the admin, and restate them verbatim in "
    "one short 'vocabulary' line of the brief so the composer receives them — but write the rest of the "
    "brief in the ADMIN'S OWN words, never in glossary words."
)


def _terminology_block(raw: Optional[Dict[str, str]], intake: bool = False) -> Optional[str]:
    """Render only the institute's RENAMED entity labels as instructions, or None.

    The values are Title-Case UI labels, not a prose vocabulary. The old
    instruction ("use these words in all copy") produced "Browse All Question
    Sets", "Placement-focused Question Sets for MakeMyTrip" and "engineering
    Students & graduates". Entries still at the platform default are dropped so
    the model gets no licence to force untouched words into copy.
    """
    lines: List[str] = []
    for key, value in (raw or {}).items():
        k = str(key).strip()
        lk = k.lower()
        if not isinstance(value, str) or lk.endswith("plural"):
            continue
        singular = value.strip()
        if not singular:
            continue
        default = _TERM_DEFAULTS.get(lk)
        if default and singular.casefold() == default.casefold():
            continue  # not a rename → no instruction
        plural = ""
        for cand_key in (f"{k}Plural", f"{k}_plural", f"{lk}plural", f"{lk}_plural"):
            cand = (raw or {}).get(cand_key)
            if isinstance(cand, str) and cand.strip():
                plural = cand.strip()
                break
        noun = default or lk
        if plural:
            lines.append(f'- what the platform calls a {noun} is called "{singular}" here (plural: "{plural}")')
        else:
            lines.append(
                f'- what the platform calls a {noun} is called "{singular}" here '
                f'(NO plural form was configured — see rule 3, do not invent one)'
            )
    if not lines:
        return None
    block = (
        "## INSTITUTE VOCABULARY (a LABEL glossary — NOT a list of words to force into the copy)\n"
        "This institute has renamed some of the platform's built-in entity labels:\n"
        + "\n".join(lines)
        + "\n"
        + _TERMINOLOGY_RULES
    )
    return block + _TERMINOLOGY_INTAKE_NOTE if intake else block


# Appended when the admin asked for an informational page. The doctrine used to
# say "place a live courseCatalog where offerings belong" unconditionally.
_NO_COMMERCE_RULE = (
    "## COMMERCE: OFF FOR THIS PAGE\n"
    "The admin explicitly asked for an informational page. Do NOT emit courseCatalog, bookCatalogue, "
    "cartComponent, productPageOffer, pricingTable, buyRentSection or any price, fee, discount, "
    "'Enrol now'/'Buy'/'Add to cart' element. Describe the offerings as information only. A single "
    "soft CTA at the end (talk to us / book a counselling call / contact) is welcome — a purchase path "
    "is not."
)


#: Pattern components that are page sections the composer may emit (header /
#: footer are site chrome, globalSettings patterns are site settings).
_PATTERN_CARD_SKIP = frozenset({"header", "footer", "globalSettings"})

_PATTERN_CARDS_RULES = (
    "## DESIGN PATTERNS — opt-in looks of our blocks (use one ONLY when the REFERENCE DESIGN shows it)\n"
    "Each card is a named look of a component in the vocabulary: what it looks like, when NOT to use it, and the props "
    "that produce it (merge `props` into that component's props). When a reference section matches a card, build it "
    "from the card instead of the nearest generic look — e.g. a course grid of text-led cards with a stream label and "
    "format chips is courseCatalog with render.cardStyle 'editorial', not a default grid. Several courseCatalog cards "
    "combine into ONE courseCatalog: deep-merge their props (objects key by key, arrays concatenated). Text in "
    "<angle brackets> is a placeholder: write your own copy from the brief, or leave the field empty. Every id "
    "(libraryId, audienceId, productPageCode, course ids) stays EMPTY — the admin links them in the editor. Never "
    "write numbers the widgets compute live (stats kinds, counts, prices). A card the reference does not show stays "
    "off: the block's ordinary look is the default."
)


_CARD_IMAGE_PLACEHOLDER = "<image: a PROVIDED IMAGES url, 'gen:<prompt>' when IMAGE GENERATION is on, or empty>"
_CARD_ROUTE_PLACEHOLDER = "<route: of a page this site has, or an #anchor on this page>"


def _composer_card_props(value: Any, key: str = "") -> Any:
    """
    A pattern's ``minimal`` props as the composer may use them. The registry's
    placeholders are written for MCP callers (website(list_media),
    website_edit(link_lead_form)), tools this composer does not have, and its
    example routes (/login, /learning-paths) may not exist on this site.
    """
    if isinstance(value, dict):
        return {k: _composer_card_props(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_composer_card_props(v, key) for v in value]
    if not isinstance(value, str):
        return value
    if value.startswith("<") and ("website(" in value or "website_edit(" in value):
        if "image" in value.lower():
            return _CARD_IMAGE_PLACEHOLDER
        name = value[1:].split(":", 1)[0].strip()
        return f"<{name}: leave empty — the admin picks it in the editor>"
    if key == "target" and value.startswith("/"):
        return _CARD_ROUTE_PLACEHOLDER
    return value


def _pattern_cards_block(catalog: Dict[str, Any], vocab_types: set) -> str:
    """Compact pattern cards for the components this page may contain, or "" when the catalog has none."""
    cards = []
    for p in catalog.get("patterns") or []:
        if not isinstance(p, dict) or not p.get("id"):
            continue
        component = p.get("component")
        if component in _PATTERN_CARD_SKIP or component not in vocab_types:
            continue
        card = {"id": p["id"], "component": component, "looks": p.get("looksLike"), "avoid": p.get("avoidWhen"),
                "props": _composer_card_props(p.get("minimal"))}
        cards.append({k: v for k, v in card.items() if v not in (None, "", [], {})})
    if not cards:
        return ""
    return _PATTERN_CARDS_RULES + "\n" + json.dumps(cards, ensure_ascii=False)


def _build_prompt(req: GeneratePageRequest, catalog: Dict[str, Any], inspiration: Any = None, site_corpus: str = "", fixed_global: Optional[Dict[str, Any]] = None) -> str:
    parts: List[str] = []
    parts.append(
        "You are the page composer for Vacademy's catalogue website builder. You produce ONE page as "
        "pure JSON against the component vocabulary below. Typed components are the default for every "
        "section; the htmlBlock escape hatch (see DESIGN RULES) exists for the rare bespoke section the "
        "vocabulary cannot express. Study the PREMIUM EXEMPLAR: match that level of polish and richness."
    )
    vocab = catalog["components"]
    if not req.allow_chrome:
        # The site provides global header/footer — keep them out of the
        # vocabulary so prompt and sanitizer agree.
        vocab = [c for c in vocab if c.get("type") not in ("header", "footer")]
    parts.append(_VOCAB_HEADER + json.dumps(vocab, ensure_ascii=False))
    parts.append("## STYLE VOCABULARY\n" + json.dumps(catalog["styleSchema"], ensure_ascii=False))
    parts.append(_design_language_block(req.design_language))
    parts.append("## DESIGN RULES\n- " + "\n- ".join(_PREMIUM_DOCTRINE))
    parts.append(
        "## STRUCTURAL EXEMPLAR — read for SHAPE, not for style\n"
        "Valid in-schema JSON at the level of polish you must hit: study how it nests props, puts the hero "
        "on a section shell, sets iconName rather than emoji, and uses ctaBanner's real contract. Its own "
        "styling choices are illustrative only and blend more than one language — do NOT carry over its "
        "forest/mesh/Playfair theme, its marquee ticker or its stat chips unless the language you chose "
        "calls for them. Never copy its content.\n"
        + _PREMIUM_EXEMPLAR
    )

    if req.institute_name:
        parts.append(f"## INSTITUTE\nName: {req.institute_name}")
    term_block = _terminology_block(req.terminology)
    if term_block:
        parts.append(term_block)
    if req.courses:
        parts.append(
            "## REAL COURSES (reference these by name; use courseCatalog for the live grid)\n"
            + json.dumps([c.model_dump(exclude_none=True) for c in req.courses], ensure_ascii=False)
        )
    if req.images:
        parts.append(
            "## PROVIDED IMAGES (real URLs you may use — place them where their caption fits)\n"
            + json.dumps([i.model_dump(exclude_none=True) for i in req.images], ensure_ascii=False)
        )
    if req.auto_images:
        parts.append(
            "## IMAGE GENERATION\nYou may request AI-generated images: set an image field to "
            '"gen:<a vivid, specific photography/illustration prompt>" and it will be generated and '
            "filled in for you. Use it for the HERO right.image, for PER-FEATURE illustrations or "
            "photos whenever the design shows pictures rather than icons, and for key section visuals. "
            "Do NOT gen: logos of real brands or people. Keep total gen: fields ≤ 12, and write the "
            "prompts so the set reads as ONE art direction rather than a dozen unrelated stock photos — "
            "name the same medium, palette and mood in every one. "
            "Leave an image field empty ('') rather than gen: when a real provided image fits or none is needed."
        )
    if site_corpus:
        parts.append(
            "## EXISTING SITE CONTENT (the institute's OWN current website — REBUILD it in our system: "
            "keep their real facts, program names, numbers and about-us copy; improve the writing and "
            "structure, do NOT invent different facts)\n" + site_corpus
        )
    if inspiration:
        parts.append(_inspiration_block(
            inspiration,
            theme_locked=bool(fixed_global),
            locked_surface=_derive_dark_surface((fixed_global or {}).get("theme")) if fixed_global else None,
        ))
        # Only with a reference design: the cards name looks to MATCH, so a
        # page composed from a brief alone is prompted exactly as before.
        cards = _pattern_cards_block(catalog, {c.get("type") for c in vocab})
        if cards:
            parts.append(cards)
    if req.direction:
        parts.append(f"## DESIGN DIRECTION\n{req.direction}")

    if fixed_global:
        parts.append(
            "## FIXED SITE THEME (this multi-page site already has a theme — reuse EXACTLY this "
            "globalSettings for a consistent look; do NOT propose a different one)\n"
            + json.dumps(fixed_global, ensure_ascii=False)
        )

    page_type = req.page_type or "homepage"
    parts.append(
        f"## TASK\nPage type: {page_type} — {_PAGE_TYPE_LABELS.get(page_type, 'a page of this site')}\n"
        f"Admin brief (mirror its language in the page copy):\n{req.brief.strip()}"
    )
    # The archetype OVERRIDES the landing-page rhythm rules in DESIGN RULES. Without
    # it every page_type came out shaped like a homepage.
    archetype_rule = _ARCHETYPE_RULES.get(page_type)
    if archetype_rule:
        # Precedence, stated where it will be read. The REFERENCE DESIGN block
        # claims to win, but the archetype block comes later and says it
        # "governs the page's STRUCTURE" — so for a reference that was a warm
        # marketing page, the directory archetype won and produced dense spec
        # tables with no hero, no social proof and no founder section. Later
        # and more forceful beats earlier and more polite.
        ref_sections = inspiration.get("sections") if isinstance(inspiration, dict) else None
        ref_sections = ref_sections if isinstance(ref_sections, list) and ref_sections else []
        if ref_sections:
            parts.append(
                "## PAGE ARCHETYPE — SECONDARY to the REFERENCE DESIGN above\n"
                "The admin supplied a reference design with its own section order, and it OUTRANKS this "
                "archetype wherever the two disagree — including on whether the page opens with a hero, "
                "and on how offerings are presented (photo cards vs dense blocks). Use the archetype only "
                "for what the reference is silent about: which of the institute's real offerings must all "
                "appear, how much detail each carries, and what must NOT appear.\n"
                + (
                    "CONCRETELY: the reference's first band IS a hero, so this page opens with a "
                    "heroSection, and any rule below telling you to open with a compact page header is "
                    "overridden. Keep the archetype's coverage requirement — every real offering still "
                    "gets its own block further down.\n"
                    if str((ref_sections[0] or {}).get("role", "")).lower() == "hero"
                    else ""
                )
                + archetype_rule
            )
        else:
            parts.append(f"## PAGE ARCHETYPE — this governs the page's STRUCTURE\n{archetype_rule}")
    if _is_info_only(req.brief):
        parts.append(_NO_COMMERCE_RULE)
    parts.append(
        "## OUTPUT CONTRACT\nReturn ONLY a JSON object of this exact shape (no markdown, no commentary):\n"
        '{"globalSettings": {"theme": {"preset": "...", "primaryColor": "#rrggbb (optional — see below)", '
        '"atmosphere": {"canvas": "...", "intensity": "..."}, '
        '"headingScale": "...", "borderRadius": "..."}, "fonts": {"enabled": true, "family": "<sans body font '
        'label>", "headingFamily": "<serif/display heading font label — omit to reuse the body font>"}, '
        '"motion": {"personality": "..."}}, '
        '"page": {"id": "<kebab-id>", "title": "<short page title>", "route": "<kebab-slug>", '
        '"backgroundColor": "#rrggbb (optional — the page canvas; set it when the design calls for a '
        'cream, tinted or dark surface instead of white)", '
        '"components": [{"id": "<kebab-id>", "type": "<type>", "enabled": true, "props": {…}, "style": {…}?}, …]}}\n'
        "6–12 components. Do NOT include header or footer components — the site provides global ones. "
        "globalSettings is REQUIRED — a plain default theme makes the page look cheap.\n"
        "Allowed globalSettings values:\n" + _theme_value_reference()
    )
    return "\n\n".join(parts)


# ─── Validation / sanitization ───────────────────────────────────────────────

def _clean_string(value: str) -> str:
    return _sanitize_html(_strip_hostile(value))


def clean_urls(node: Any, allowed_urls: set, warnings: List[str]) -> Any:
    """Deep-scrub any props/style subtree: image keys become allowlist-keep,
    every string loses hostile URL schemes + embedded markup. Shared by the
    generate (whole page) and edit (patches/inserts) paths."""
    if isinstance(node, dict):
        out: Dict[str, Any] = {}
        for k, v in node.items():
            lk = k.lower()
            # Image keys: pure allowlist-keep — empty, or exactly a provided
            # URL; everything else (data:, //host, HTTP, hallucinated) stripped.
            if is_image_key(k) and isinstance(v, str):
                if v and v not in allowed_urls:
                    warnings.append(f"Stripped unknown image URL from '{k}'")
                    out[k] = ""
                else:
                    out[k] = v
            elif is_image_list_key(k) and isinstance(v, list):
                kept = [u for u in v if not (isinstance(u, str) and u and u not in allowed_urls)]
                if len(kept) != len(v):
                    warnings.append(f"Stripped unknown image URL(s) from '{k}'")
                out[k] = clean_urls(kept, allowed_urls, warnings)
            # mediaShowcase media[]: image items must use provided URLs; video
            # items (YouTube/Vimeo links) pass through untouched.
            elif lk == "media" and isinstance(v, list):
                cleaned_items = []
                for item in v:
                    if (
                        isinstance(item, dict)
                        and str(item.get("type", "")).lower() == "image"
                        and isinstance(item.get("url"), str)
                        and item["url"]
                        and item["url"] not in allowed_urls
                    ):
                        warnings.append("Stripped unknown image URL from 'media'")
                        item = {**item, "url": ""}
                    cleaned_items.append(clean_urls(item, allowed_urls, warnings))
                out[k] = cleaned_items
            # style.backgroundLayers[]: image layers must use provided URLs
            elif lk == "backgroundlayers" and isinstance(v, list):
                kept_layers = []
                for layer in v:
                    if (
                        isinstance(layer, dict)
                        and layer.get("type") == "image"
                        and isinstance(layer.get("url"), str)
                        and layer["url"]
                        and layer["url"] not in allowed_urls
                    ):
                        warnings.append("Dropped background image layer with unknown URL")
                        continue
                    kept_layers.append(clean_urls(layer, allowed_urls, warnings))
                out[k] = kept_layers
            else:
                out[k] = clean_urls(v, allowed_urls, warnings)
        return out
    if isinstance(node, list):
        return [clean_urls(v, allowed_urls, warnings) for v in node]
    if isinstance(node, str):
        # Every string: kill hostile schemes (javascript:/data:/vbscript:) and
        # sanitize embedded markup (rich-text props reach dangerouslySetInnerHTML).
        return _clean_string(node)
    return node


# The learner renderer's icon set (FEATURE_ICON_MAP in JsonRenderer.tsx —
# Phosphor names). featureGrid reads features[].iconName and draws nothing for
# any other name, silently. (stepsProcess reads steps[].icon instead, and that
# key is dual-purpose — a library name OR a raw emoji — so it is left alone.)
# The composer is told this list, but the copilot's edit prompt was not, and a
# model that has seen more Lucide than Phosphor reaches for "MessageSquare",
# "Users", "Monitor", "Award" — a whole feature strip then ships iconless
# (field case: Smart AI Academy, 2026-09-14). Normalise instead of trusting.
_FEATURE_ICONS = {
    "GraduationCap", "Rocket", "Target", "UsersThree", "Code", "Brain", "Trophy", "Lightbulb",
    "ShieldCheck", "ChartLineUp", "Clock", "Star", "BookOpen", "Certificate", "ChatsCircle",
    "Wrench", "Sparkle", "Medal", "Briefcase", "Globe",
}
_FEATURE_ICON_ALIASES = {
    # Lucide / Heroicons / Font Awesome / Material names the models emit most
    "messagesquare": "ChatsCircle", "messagecircle": "ChatsCircle", "message": "ChatsCircle",
    "chat": "ChatsCircle", "chatbubble": "ChatsCircle", "comments": "ChatsCircle", "bot": "ChatsCircle",
    "users": "UsersThree", "user": "UsersThree", "usercog": "UsersThree", "usercheck": "UsersThree",
    "group": "UsersThree", "people": "UsersThree", "team": "UsersThree", "usergroup": "UsersThree",
    "monitor": "Globe", "laptop": "Code", "desktop": "Globe", "computer": "Code", "video": "Globe",
    "award": "Medal", "badge": "Medal", "badgecheck": "Certificate", "ribbon": "Medal",
    "certificate": "Certificate", "scroll": "Certificate", "filecheck": "Certificate", "diploma": "Certificate",
    "book": "BookOpen", "bookmarked": "BookOpen", "library": "BookOpen", "notebook": "BookOpen",
    "graduation": "GraduationCap", "school": "GraduationCap", "academiccap": "GraduationCap",
    "cap": "GraduationCap", "mortarboard": "GraduationCap",
    "zap": "Lightbulb", "bolt": "Lightbulb", "idea": "Lightbulb", "bulb": "Lightbulb", "flash": "Lightbulb",
    "sparkles": "Sparkle", "wand": "Sparkle", "magic": "Sparkle", "stars": "Sparkle",
    "cpu": "Brain", "chip": "Brain", "brain": "Brain", "robot": "Brain", "ai": "Brain", "network": "Brain",
    "shield": "ShieldCheck", "lock": "ShieldCheck", "security": "ShieldCheck", "check": "ShieldCheck",
    "checkcircle": "ShieldCheck", "circlecheck": "ShieldCheck",
    "trendingup": "ChartLineUp", "chart": "ChartLineUp", "barchart": "ChartLineUp", "linechart": "ChartLineUp",
    "growth": "ChartLineUp", "analytics": "ChartLineUp", "presentation": "ChartLineUp",
    "clock": "Clock", "timer": "Clock", "calendar": "Clock", "schedule": "Clock", "hourglass": "Clock",
    "settings": "Wrench", "tool": "Wrench", "tools": "Wrench", "cog": "Wrench", "gear": "Wrench",
    "hammer": "Wrench", "build": "Wrench",
    "briefcase": "Briefcase", "work": "Briefcase", "business": "Briefcase", "building": "Briefcase",
    "globe": "Globe", "world": "Globe", "earth": "Globe", "language": "Globe", "wifi": "Globe",
    "rocket": "Rocket", "launch": "Rocket", "trending": "Rocket",
    "target": "Target", "crosshair": "Target", "goal": "Target", "focus": "Target",
    "trophy": "Trophy", "cup": "Trophy", "winner": "Trophy",
    "star": "Star", "favorite": "Star", "heart": "Star",
    "code": "Code", "terminal": "Code", "braces": "Code", "coding": "Code",
    "facebook": "Globe", "instagram": "Globe", "twitter": "Globe", "linkedin": "Globe", "youtube": "Globe",
    "tiktok": "Globe", "whatsapp": "ChatsCircle", "phone": "ChatsCircle", "mail": "ChatsCircle",
    "email": "ChatsCircle", "envelope": "ChatsCircle", "handshake": "UsersThree", "partner": "UsersThree",
}
# When the name gives nothing away, the card's own title usually does.
_FEATURE_ICON_KEYWORDS = (
    (("certif", "diploma", "credential"), "Certificate"),
    (("teach", "mentor", "expert", "guid", "instructor", "faculty", "coach", "community"), "UsersThree"),
    (("chat", "gpt", "conversation", "support", "assistant"), "ChatsCircle"),
    (("prompt", "code", "coding", "develop", "program", "engineer"), "Code"),
    (("ai", "brain", "intellig", "machine learning", "neural"), "Brain"),
    (("class", "online", "flexible", "anytime", "pace", "schedule", "time", "hour"), "Clock"),
    (("practic", "hands-on", "project", "workshop", "tool"), "Wrench"),
    (("career", "job", "business", "professional", "work"), "Briefcase"),
    (("grow", "result", "analytic", "data", "progress", "outcome"), "ChartLineUp"),
    (("secur", "safe", "trust", "responsib", "ethic", "privacy"), "ShieldCheck"),
    (("student", "learn", "course", "lesson", "study", "curriculum"), "BookOpen"),
    (("global", "world", "internation", "language", "remote"), "Globe"),
    (("idea", "innov", "creat", "insight"), "Lightbulb"),
    (("award", "medal", "recogni", "achieve"), "Medal"),
    (("win", "top", "rank", "champion", "success"), "Trophy"),
    (("launch", "start", "fast", "accelerat", "boost"), "Rocket"),
    (("goal", "target", "focus", "exam", "mission"), "Target"),
    (("new", "featured", "premium", "special", "magic"), "Sparkle"),
    (("rating", "review", "quality", "favourite", "favorite"), "Star"),
    (("school", "academy", "degree", "graduat", "universit", "educat"), "GraduationCap"),
)


def normalize_icon_name(name: Any, title: Any = "") -> Optional[str]:
    """Map a model-supplied iconName onto the renderer's icon set.

    Exact (case-insensitive) library names pass through; known aliases from
    other icon libraries are translated; otherwise the card's title picks a
    fitting icon by keyword; None when nothing fits (the caller drops the key,
    which renders no icon — honest, and the same thing an unknown name did)."""
    raw = str(name or "").strip()
    if raw:
        for lib in _FEATURE_ICONS:
            if lib.lower() == raw.lower():
                return lib
        key = re.sub(r"[^a-z]", "", raw.lower())
        for prefix in ("lucide", "phosphor", "heroicons", "heroicon", "mdi"):
            if key.startswith(prefix) and key[len(prefix):]:
                key = key[len(prefix):]
        for suffix in ("icon", "outline", "solid", "fill", "duotone", "bold", "regular", "light", "thin", "rounded"):
            if key.endswith(suffix) and key[: -len(suffix)]:
                key = key[: -len(suffix)]
        if key in _FEATURE_ICON_ALIASES:
            return _FEATURE_ICON_ALIASES[key]
        if len(key) >= 4:
            for alias, lib in _FEATURE_ICON_ALIASES.items():
                if len(alias) >= 4 and (alias in key or key in alias):
                    return lib
    # Title keywords match at a word start only: a bare substring made "ai"
    # claim "Training" and "art" claim "Smart".
    hay = f"{raw} {title or ''}".lower()
    for needles, lib in _FEATURE_ICON_KEYWORDS:
        if any(re.search(r"\b" + re.escape(n), hay) for n in needles):
            return lib
    return None


def _normalize_icon_names(ctype: str, props: Dict[str, Any], warnings: List[str]) -> None:
    """Rewrite featureGrid.features[].iconName in place — the one key the
    renderer resolves ONLY through the icon library."""
    key = {"featureGrid": "features"}.get(ctype)
    if not key or not isinstance(props.get(key), list):
        return
    fixed: List[str] = []
    for item in props[key]:
        if not isinstance(item, dict) or not item.get("iconName"):
            continue
        original = str(item["iconName"])
        resolved = normalize_icon_name(original, item.get("title"))
        if resolved == original:
            continue
        if resolved is None:
            item.pop("iconName", None)
        else:
            item["iconName"] = resolved
        fixed.append(f"{original}→{resolved or 'none'}")
    if fixed:
        warnings.append(f"Mapped {ctype} icon names onto the icon library: " + ", ".join(fixed[:8]))


def is_hex_dark(hex_color: Any) -> bool:
    """Mirror of the learner renderer's isHexDark (Rec. 601 luminance < 0.55)."""
    value = coerce_hex_color(hex_color)
    if not value:
        return False
    r, g, b = (int(value[i:i + 2], 16) for i in (1, 3, 5))
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55


def _apply_dark_band(ctype: str, props: Dict[str, Any], style: Optional[Dict[str, Any]], warnings: List[str]) -> Optional[Dict[str, Any]]:
    """A hero on a dark author colour must flip its ink to light.

    heroSection paints its title/description with theme TOKEN classes, which a
    props.textColor does not override — so a navy hero with textColor #FFFFFF
    still renders navy-on-navy (field case: Smart AI Academy copilot build).
    The renderer flips tokens for any wrapper carrying the `dark` class, so
    mark the band. sectionHeading additionally needs its colour mirrored onto
    style.backgroundColor or a 56px seam of page colour shows above it."""
    bg = props.get("backgroundColor")
    if ctype not in ("heroSection", "sectionHeading") or not isinstance(bg, str) or not coerce_hex_color(bg):
        return style
    style = dict(style) if isinstance(style, dict) else {}
    if not any(style.get(k) for k in ("backgroundColor", "background", "backgroundImage", "backgroundLayers")):
        style["backgroundColor"] = bg
    has_bg_image = bool(props.get("backgroundImage")) or any(
        style.get(k) for k in ("backgroundImage", "backgroundLayers")
    )
    if ctype == "heroSection" and is_hex_dark(bg) and not has_bg_image:
        classes = [c for c in str(style.get("customClass") or "").split() if c]
        if "dark" not in classes:
            classes.append("dark")
            style["customClass"] = " ".join(classes)
            warnings.append("Marked the dark hero band 'dark' so its headline renders in light ink")
    return style


# ─── jobOpenings (careers) ───────────────────────────────────────────────────
# Contract mirrored by the learner's -utils/job-openings.ts and the editor's
# jobs/job-templates.ts: the template ids, and the slug rule (each job's page
# lives at /<page>/<slug>, so a slug must be stable and unique per section).
JOB_TEMPLATES = ("classic", "poster", "list", "editorial", "dark", "minimal", "spotlight", "split")
_MAX_JOBS = 60
_SAFE_ROUTE_RE = re.compile(r"^#?[A-Za-z0-9][A-Za-z0-9_\-/#]*$")


def _https_link(value: Any) -> str:
    """An external form link: https only (http is upgraded); anything else is ''."""
    url = str(value or "").strip()
    if re.match(r"^http://", url, re.I):
        url = "https://" + url[7:]
    return url if re.match(r"^https://[^\s/]+", url, re.I) else ""


def _normalize_job_openings(props: Dict[str, Any], warnings: List[str]) -> None:
    """jobOpenings props after the generic scrub: a known template, columns 1-4,
    and jobs whose apply links are external https, with stable unique slugs."""
    template = props.get("template")
    if template not in JOB_TEMPLATES:
        if template:
            warnings.append(f"jobOpenings: unknown template '{template}', using 'classic'")
        props["template"] = "classic"
    try:
        props["columns"] = min(4, max(1, int(props.get("columns") or 2)))
    except (TypeError, ValueError):
        props["columns"] = 2
    raw = props.get("jobs")
    jobs = [j for j in raw if isinstance(j, dict)] if isinstance(raw, list) else []
    if len(jobs) > _MAX_JOBS:
        warnings.append(f"jobOpenings: kept the first {_MAX_JOBS} jobs")
        jobs = jobs[:_MAX_JOBS]
    used: set = set()
    for i, job in enumerate(jobs):
        if not str(job.get("id") or "").strip():
            job["id"] = f"job-{uuid.uuid4().hex[:6]}"
        apply_raw = str(job.get("applyUrl") or "").strip()
        job["applyUrl"] = _https_link(apply_raw)
        if apply_raw and not job["applyUrl"]:
            warnings.append(f"jobOpenings: dropped a non-https apply link on '{job.get('title') or job['id']}'")
        second = str(job.get("secondaryUrl") or "").strip()
        if second and not (_https_link(second) or _SAFE_ROUTE_RE.match(second)):
            job["secondaryUrl"] = ""
        elif second.lower().startswith("http"):
            job["secondaryUrl"] = _https_link(second)
        details = job.get("details")
        if details is not None:
            job["details"] = [
                {"label": str(d.get("label") or ""), "value": str(d.get("value") or "")}
                for d in (details if isinstance(details, list) else [])
                if isinstance(d, dict) and str(d.get("value") or "").strip()
            ]
        # A visible job's slug is fixed here, so its address survives a title edit.
        if job.get("enabled") is False or not str(job.get("title") or "").strip():
            continue
        root = job_slug(job.get("slug")) or job_slug(job.get("title")) or f"job-{i + 1}"
        slug, n = root, 2
        while slug in used:
            slug, n = f"{root}-{n}", n + 1
        used.add(slug)
        job["slug"] = slug
    props["jobs"] = jobs


def sanitize_component(
    comp: Any, allowed_types: set, allow_chrome: bool, seen_ids: set, allowed_urls: set, warnings: List[str]
) -> Optional[Dict[str, Any]]:
    """Validate + scrub one component; returns None (with a warning) when the
    type is forbidden/unknown or props are missing. Recurses columnLayout slots."""
    if not isinstance(comp, dict):
        return None
    ctype = comp.get("type")
    if ctype in ("header", "footer") and not allow_chrome:
        warnings.append(f"Dropped {ctype} (site provides global chrome)")
        return None
    if ctype not in allowed_types:
        warnings.append(f"Dropped unknown component type '{ctype}'")
        return None
    props = comp.get("props")
    if not isinstance(props, dict):
        warnings.append(f"Dropped '{ctype}' with missing props")
        return None
    cid = str(comp.get("id") or f"{ctype}-{uuid.uuid4().hex[:6]}")
    cid = _SLUG_RE.sub("-", cid.lower()).strip("-") or f"{ctype}-{uuid.uuid4().hex[:6]}".lower()
    while cid in seen_ids:
        cid = f"{cid}-{uuid.uuid4().hex[:4]}"
    seen_ids.add(cid)
    if ctype == "htmlBlock":
        # Escape hatch: html/css get the dedicated custom-HTML pipeline INSTEAD
        # of the generic string cleaner (whose default nh3 profile would strip
        # the class attributes the section's CSS targets). Only the contract
        # keys survive — anything else the model added is dropped.
        html = props.get("html")
        if not isinstance(html, str) or not html.strip():
            warnings.append("Dropped htmlBlock with empty html")
            return None
        cleaned_html = _sanitize_custom_html(html, allowed_urls, warnings)
        if not cleaned_html.strip():
            warnings.append("Dropped htmlBlock — nothing survived sanitization")
            return None
        html_props: Dict[str, Any] = {"html": cleaned_html}
        if isinstance(props.get("css"), str) and props["css"].strip():
            html_props["css"] = _scrub_css(props["css"], warnings)
        if isinstance(props.get("prompt"), str) and props["prompt"].strip():
            html_props["prompt"] = _clean_string(props["prompt"])[:500]
        cleaned_block: Dict[str, Any] = {"id": cid, "type": ctype, "enabled": True, "props": html_props}
        if isinstance(comp.get("style"), dict) and comp["style"]:
            cleaned_block["style"] = clean_urls(comp["style"], allowed_urls, warnings)
        return cleaned_block
    cleaned_props = clean_urls(props, allowed_urls, warnings)
    # columnLayout nests component arrays in props.slots — recurse so the type
    # filter / htmlBlock ban can't be smuggled past via slots.
    slots = cleaned_props.get("slots")
    if isinstance(slots, list):
        cleaned_props["slots"] = [
            [c for c in (sanitize_component(ch, allowed_types, allow_chrome, seen_ids, allowed_urls, warnings) for ch in slot) if c is not None]
            if isinstance(slot, list) else []
            for slot in slots
        ]
    _normalize_icon_names(ctype, cleaned_props, warnings)
    if ctype == "jobOpenings":
        _normalize_job_openings(cleaned_props, warnings)
    # The editor template offers hero left.subheading and its preview shows
    # it, but the LEARNER never renders it — so a model that puts the tagline
    # there (as the copilot did) ships a hero with no copy under the title.
    # Fold it into description, the field the live page reads, when that is
    # empty; when both exist the subheading stays (harmless, preview-only).
    if ctype == "heroSection":
        left = cleaned_props.get("left")
        if isinstance(left, dict):
            sub = left.get("subheading")
            desc = left.get("description")
            if isinstance(sub, str) and sub.strip() and not (isinstance(desc, str) and desc.strip()):
                left["description"] = sub.strip()  # already cleaned by clean_urls; plain text like every AI-written description
                left.pop("subheading", None)
                warnings.append("Moved the hero subheading into description (the live hero renders description, not subheading)")
    cleaned: Dict[str, Any] = {
        "id": cid,
        "type": ctype,
        # Keep an explicit opt-out: forcing True made set_layout unable to
        # switch the site header/footer off (a custom htmlBlock replaces them).
        "enabled": comp.get("enabled") is not False,
        "props": cleaned_props,
    }
    # anchorId is a COMPONENT field (the wrapper renders it as the DOM id);
    # models keep filing it under props, where nothing reads it — so a hero
    # button targeting '#courses' scrolled nowhere. Hoist it.
    props_anchor = cleaned_props.pop("anchorId", None)
    anchor = comp.get("anchorId") or props_anchor
    if isinstance(anchor, str) and anchor.strip():
        slug = _anchor_slug(anchor)
        if slug:
            cleaned["anchorId"] = slug
    if isinstance(comp.get("style"), dict) and comp["style"]:
        cleaned["style"] = clean_urls(comp["style"], allowed_urls, warnings)
    dark_style = _apply_dark_band(ctype, cleaned_props, cleaned.get("style"), warnings)
    if dark_style:
        cleaned["style"] = dark_style
    # Surface color belongs on the STYLE layer when a section shell is used:
    # props.backgroundColor only paints the inner content column, so a shell
    # section would render as an inset card with page-color gutters. Copy it
    # up so the full-bleed canvas owns the color (field bug, Edzumo hero).
    style = cleaned.get("style")
    # A hero's shell must be FULL-BLEED. heroSection paints its own opaque
    # surface (.catalogue-hero-surface: background-color + mesh gradients) and
    # already centres its content at max-w-7xl, so a shell width constraint adds
    # nothing except clipping that surface to the content column — the hero then
    # renders as an inset card with page-coloured gutters down both sides (field
    # bug, The 7Cs /courses, where the model emitted width 'default'). Same
    # family as the backgroundColor promotion below.
    if (
        ctype == "heroSection"
        and isinstance(style, dict)
        and isinstance(style.get("layout"), dict)
        and style["layout"].get("width") not in (None, "full")
    ):
        style["layout"]["width"] = "full"
        warnings.append("Widened the hero to full-bleed (a constrained hero renders as an inset card)")
    # A section that PAINTS A BAND must keep the design system's vertical
    # rhythm. The composer likes to add paddingTop/paddingBottom in the 16-24px
    # range, which is fine on a transparent section and wrong on a coloured one:
    # the band then hugs its cards, and an asymmetric pair (16 top, 48 bottom)
    # reads as a mistake rather than a choice. Dropping the too-small value
    # restores .catalogue-section's padding-block, which already scales with the
    # site's density setting.
    if isinstance(style, dict):
        paints_band = bool(style.get("backgroundColor") or cleaned_props.get("backgroundColor"))
        if paints_band:
            for key in ("paddingTop", "paddingBottom"):
                raw_pad = style.get(key)
                if not isinstance(raw_pad, str):
                    continue
                m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)px\s*", raw_pad)
                if m and float(m.group(1)) < _MIN_BAND_PADDING_PX:
                    style.pop(key, None)
                    warnings.append(
                        f"Dropped a {raw_pad} {key} on '{ctype}' — it paints a background band, so it "
                        "keeps the section's own vertical rhythm"
                    )
    if isinstance(style, dict) and isinstance(style.get("layout"), dict):
        prop_bg = cleaned_props.get("backgroundColor")
        if (
            isinstance(prop_bg, str) and prop_bg
            and not any(style.get(k) for k in ("backgroundColor", "background", "backgroundImage", "backgroundLayers"))
        ):
            style["backgroundColor"] = prop_bg
    return cleaned


_HEX6_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_HEX3_RE = re.compile(r"^#[0-9a-fA-F]{3}$")


def coerce_hex_color(value: Any) -> Optional[str]:
    """Normalize a model-supplied brand color to the `#rrggbb` form the
    renderers accept (catalogue-theme.ts matches /^#[0-9a-fA-F]{6}$/ exactly, so
    a 3-digit or upper-case hex would be silently ignored). Returns None for
    anything that is not a hex color — colour NAMES are rejected on purpose:
    'blue' would be dropped by the renderer anyway, and passing it through would
    make the editor's swatch show a value the page never uses."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if _HEX6_RE.match(v):
        return v.lower()
    if _HEX3_RE.match(v):
        return ("#" + "".join(c * 2 for c in v[1:])).lower()
    return None


# globalSettings.theme.palette: named hex colours + applyToTokens. The renderer
# reads 16 known names (catalogue-palette.ts PALETTE_KEYS) and accepts #rgb or
# #rrggbb in any case; the editor's palette card also shows other authored
# names, so any identifier-like key with a hex value is kept AS AUTHORED (no
# re-casing — a round trip must not rewrite the admin's values).
_PALETTE_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_PALETTE_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,39}$")
_PALETTE_MAX_KEYS = 40
# globalSettings.theme.contentMaxWidth: px of content, the range the renderer
# honours (resolveContentMaxWidth).
_CONTENT_MAX_WIDTH_RANGE = (320, 2400)


def _clean_palette(raw: Any) -> Dict[str, Any]:
    """The valid entries of a palette object ({} for anything else)."""
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Any] = {}
    for key, value in raw.items():
        if len(out) >= _PALETTE_MAX_KEYS:
            break
        if key == "applyToTokens":
            if isinstance(value, bool):
                out[key] = value
        elif isinstance(key, str) and _PALETTE_KEY_RE.match(key) and isinstance(value, str):
            v = value.strip()
            if _PALETTE_HEX_RE.match(v):
                out[key] = v
    return out


def _clean_content_max_width(raw: Any) -> Optional[int]:
    """A content width in px the renderer honours, else None.

    Same rule as resolveContentMaxWidth (and the editor's palette card): round,
    then 320–2400 or nothing. NOT a clamp — the renderer ignores 3000 and
    shows the default width, so clamping it to 2400 would visibly narrow the
    page on an unrelated edit."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, str):
        try:
            raw = float(raw.strip())
        except ValueError:
            return None
    if not isinstance(raw, (int, float)) or raw != raw or raw in (float("inf"), float("-inf")):
        return None
    px = int(math.floor(raw + 0.5))  # Math.round, not banker's rounding
    lo, hi = _CONTENT_MAX_WIDTH_RANGE
    return px if lo <= px <= hi else None


def _carry_theme_extras(
    theme_in: Dict[str, Any], base_theme: Dict[str, Any], allow_new: bool = True
) -> Dict[str, Any]:
    """theme.palette / theme.contentMaxWidth for the clamp's output.

    Incoming wins over base, per colour for the palette (so "change the accent"
    keeps the other 15). An explicit null clears the key, the same contract as
    primaryColor; a null colour inside an incoming palette removes that colour.

    `allow_new=False` is for input that is the MODEL's own proposal (unpinned
    generation, the chrome assistant): it may edit a palette / width the site
    already has, but never add one to a site that has none — both are opt-in."""
    out: Dict[str, Any] = {}

    base_palette = _clean_palette(base_theme.get("palette"))
    if "palette" in theme_in and theme_in.get("palette") is None:
        palette: Dict[str, Any] = {}
    else:
        palette = dict(base_palette)
        incoming = theme_in.get("palette")
        if not allow_new and not base_palette:
            incoming = None
        if isinstance(incoming, dict):
            for key, value in incoming.items():
                if value is None:
                    palette.pop(key, None)
            palette.update(_clean_palette(incoming))
    if palette:
        out["palette"] = palette

    base_width = _clean_content_max_width(base_theme.get("contentMaxWidth"))
    if "contentMaxWidth" in theme_in and (allow_new or base_width is not None or theme_in.get("contentMaxWidth") is None):
        width = _clean_content_max_width(theme_in.get("contentMaxWidth"))
        if width is None and theme_in.get("contentMaxWidth") is not None:
            # Junk from the model: keep the site's own width rather than drop it.
            width = base_width
    else:
        width = base_width
    if width is not None:
        out["contentMaxWidth"] = width
    return out


def _coerce_global_settings(
    raw: Any, base: Optional[Dict[str, Any]] = None, *, model_proposed: bool = False
) -> Optional[Dict[str, Any]]:
    """Clamp the model's globalSettings to valid values (the theme presets,
    atmospheres, fonts, etc. the renderers actually support). Font label OR a
    known stack maps to a stack; anything else falls back to Inter.

    `base` is the settings already on the site. Keys the model DIDN'T send fall
    back to the base instead of to a hardcoded default — required by the chrome
    editor, whose prompt says "include ONLY the keys you actually changed": with
    no base, "switch the theme to ocean" also reset atmosphere, heading scale,
    radius and the brand color to defaults.

    `model_proposed=True` marks `raw` as the model's own output (not the
    caller's pinned settings): it may then change a palette / content width
    the base already has, but cannot introduce either."""
    if not isinstance(raw, dict):
        return None
    theme_in = raw.get("theme") if isinstance(raw.get("theme"), dict) else {}
    atm_in = theme_in.get("atmosphere") if isinstance(theme_in.get("atmosphere"), dict) else {}
    fonts_in = raw.get("fonts") if isinstance(raw.get("fonts"), dict) else {}
    motion_in = raw.get("motion") if isinstance(raw.get("motion"), dict) else {}

    base = base if isinstance(base, dict) else {}
    base_theme = base.get("theme") if isinstance(base.get("theme"), dict) else {}
    base_atm = base_theme.get("atmosphere") if isinstance(base_theme.get("atmosphere"), dict) else {}
    base_fonts = base.get("fonts") if isinstance(base.get("fonts"), dict) else {}
    base_motion = base.get("motion") if isinstance(base.get("motion"), dict) else {}

    def _pick(incoming: Any, allowed: set, previous: Any, fallback: str) -> str:
        if incoming in allowed:
            return incoming
        return previous if previous in allowed else fallback

    _known_stacks = set(_FONT_STACKS.values())

    def _stack(label: Any) -> Optional[str]:
        return _FONT_STACKS.get(label) or (label if label in _known_stacks else None)

    font_stack = _stack(fonts_in.get("family")) or _stack(base_fonts.get("family")) or "Inter, sans-serif"
    # Optional separate heading font (serif display over sans body).
    head_stack = _stack(fonts_in.get("headingFamily"))
    if head_stack is None and "headingFamily" not in fonts_in:
        head_stack = _stack(base_fonts.get("headingFamily"))

    fonts_out: Dict[str, Any] = {"enabled": True, "family": font_stack}
    if head_stack and head_stack != font_stack:
        fonts_out["headingFamily"] = head_stack

    theme_out: Dict[str, Any] = {
        "preset": _pick(theme_in.get("preset"), _THEME_PRESETS, base_theme.get("preset"), "default"),
        "atmosphere": {
            "canvas": _pick(atm_in.get("canvas"), _ATMOSPHERES, base_atm.get("canvas"), "soft"),
            "intensity": _pick(atm_in.get("intensity"), _INTENSITIES, base_atm.get("intensity"), "subtle"),
        },
        "headingScale": _pick(theme_in.get("headingScale"), _HEADING_SCALES, base_theme.get("headingScale"), "default"),
        "borderRadius": _pick(theme_in.get("borderRadius"), _RADII, base_theme.get("borderRadius"), "rounded"),
    }
    # Exact brand color. Supported end-to-end by both renderers
    # (applyCataloguePrimaryColor / buildPrimaryScaleVars) and by the editor's
    # color picker, but until now this clamp DROPPED it — so the AI could only
    # ever choose one of the 9 presets while a human could match a brand exactly.
    # An explicit null/"" clears it back to the preset's own palette.
    if "primaryColor" in theme_in:
        primary = coerce_hex_color(theme_in.get("primaryColor"))
        if primary:
            theme_out["primaryColor"] = primary
    elif coerce_hex_color(base_theme.get("primaryColor")):
        theme_out["primaryColor"] = coerce_hex_color(base_theme.get("primaryColor"))

    # Opt-in site palette + content width (learner -utils/catalogue-palette.ts).
    # The clamp above rebuilds `theme` from scratch, so these were silently
    # DROPPED by every path that runs it: the wizard's pinned theme (applied
    # over the site's theme) and the chrome assistant's merge both wiped a
    # 16-colour palette on "add a page" or "make the corners sharper". Carry
    # them through (incoming wins, base fills in), validated the way the
    # renderer reads them; a site without either still gets neither.
    theme_out.update(_carry_theme_extras(theme_in, base_theme, allow_new=not model_proposed))

    return {
        "theme": theme_out,
        "fonts": fonts_out,
        "motion": {"personality": _pick(motion_in.get("personality"), _MOTIONS, base_motion.get("personality"), "calm")},
    }


def _apply_ops_to_page(page: Dict[str, Any], ops: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Apply already-sanitized edit ops to a page, server-side.

    Mirrors applyOps in the admin's ai-page-service.ts. Only used by the repair
    pass, which must hand back a finished page rather than a list of operations
    the wizard would have to apply. Ops referencing unknown ids are skipped —
    _sanitize_ops has already scrubbed the payload, so a miss here means the
    model invented an id, not that the input is hostile."""
    components: List[Dict[str, Any]] = list(page.get("components") or [])

    def _index_of(cid: Any) -> int:
        return next((i for i, c in enumerate(components) if c.get("id") == cid), -1)

    for op in ops:
        kind = op.get("op")
        if kind == "insert":
            comp = op.get("component")
            if not isinstance(comp, dict):
                continue
            after = op.get("afterId")
            if after is None:
                components.insert(0, comp)
            else:
                idx = _index_of(after)
                components.append(comp) if idx < 0 else components.insert(idx + 1, comp)
        elif kind == "update":
            idx = _index_of(op.get("id"))
            if idx < 0:
                continue
            target = components[idx]
            props_patch = op.get("propsPatch")
            style_patch = op.get("stylePatch")
            if isinstance(props_patch, dict):
                target = {**target, "props": {**(target.get("props") or {}), **props_patch}}
            if isinstance(style_patch, dict):
                target = {**target, "style": {**(target.get("style") or {}), **style_patch}}
            components[idx] = target
        elif kind == "remove":
            idx = _index_of(op.get("id"))
            if idx >= 0:
                components.pop(idx)
        elif kind == "move":
            idx = _index_of(op.get("id"))
            if idx < 0:
                continue
            comp = components.pop(idx)
            after = op.get("afterId")
            if after is None:
                components.insert(0, comp)
            else:
                dest = _index_of(after)
                components.append(comp) if dest < 0 else components.insert(dest + 1, comp)

    return {**page, "components": components}


def _build_repair_prompt(page: Dict[str, Any], issues: List[Dict[str, Any]], catalog: Dict[str, Any]) -> str:
    """Ask for the SMALLEST set of ops that clears a specific defect list.

    Deliberately narrow: the model is not invited to redesign, re-theme or
    improve anything, because a repair pass with latitude will happily rewrite a
    page that was already fine. Every line it is given is a defect a visitor
    would see, decided by code, not by taste."""
    lines = [
        "You are the quality gate for Vacademy's catalogue website builder. A page has just been "
        "composed and an automated check found concrete defects in it. Return the SMALLEST set of "
        "operations that fixes exactly these defects.",
        "RULES:\n"
        "- Fix ONLY what is listed. Do not restyle, re-theme, reorder or reword anything else.\n"
        "- Prefer filling a section with real content over deleting it; delete only when the defect "
        "says the component cannot work at all.\n"
        "- New copy must be specific to THIS institute and consistent with the page's existing "
        "content and tone — never generic filler, never lorem ipsum.\n"
        "- Do not add images: you may only reference image URLs already present in the page.\n"
        "- If a defect genuinely cannot be fixed with the component vocabulary, leave it and say so "
        "in `reply`.",
        _VOCAB_HEADER
        + json.dumps([c for c in catalog["components"] if c.get("type") not in ("header", "footer")],
                     ensure_ascii=False),
        "## DEFECTS TO FIX\n" + "\n".join(
            f"- [{i.get('code')}] {'component ' + i['component_id'] + ': ' if i.get('component_id') else ''}"
            f"{i.get('message')} FIX: {i.get('hint')}"
            for i in issues
        ),
        "## CURRENT PAGE\n" + json.dumps(page, ensure_ascii=False),
        "## OUTPUT CONTRACT\nReturn ONLY JSON, no markdown:\n"
        '{"reply": "<one sentence>", "ops": [\n'
        '  {"op": "update", "id": "<existing-id>", "propsPatch": {…}?, "stylePatch": {…}?, "note": "<why>"},\n'
        '  {"op": "remove", "id": "<existing-id>", "note": "<why>"},\n'
        '  {"op": "insert", "component": {"id":"<kebab>","type":"<type>","enabled":true,"props":{…}}, '
        '"afterId": "<existing-id or null>", "note": "<why>"}\n'
        "]}\n"
        "propsPatch is SHALLOW-merged into the component's existing props, so a nested object you send "
        "REPLACES the whole existing one — include every key of any nested object you touch.",
    ]
    return "\n\n".join(lines)


async def _repair_page(
    page: Dict[str, Any], issues: List[Dict[str, Any]], req: GeneratePageRequest,
    catalog: Dict[str, Any], db,
) -> tuple[Dict[str, Any], List[str], Dict[str, int]]:
    """One repair round. Returns (page, warnings, usage). Never raises — a page
    with known defects still beats no page, so a failed repair degrades to
    returning the defects as warnings."""
    prompt = _build_repair_prompt(page, issues, catalog)
    primary, fallbacks = resolve_models(
        db, "page_builder", preferred_model=req.preferred_model, hard_fallback=_DEFAULT_MODEL
    )
    try:
        raw_json, _model, usage = await generate_json(prompt, [primary, *fallbacks], label="page-repair")
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-builder] repair pass failed: %s", e)
        return page, [], {}

    warnings: List[str] = []
    try:
        edit_req = EditPageRequest(
            page=page, instruction="repair", images=req.images, auto_images=False,
        )
        ops, _reply, op_warnings = _sanitize_ops(raw_json, edit_req, catalog)
        warnings.extend(op_warnings)
    except HTTPException as e:
        logger.warning("[page-builder] repair produced unusable ops: %s", e.detail)
        return page, [], usage or {}

    if not ops:
        return page, warnings, usage or {}
    return _apply_ops_to_page(page, ops), warnings, usage or {}


_ANCHOR_ROLE_HINTS = {
    # '#target' → words that identify the section it means, by id/title/type
    "courses": ("course", "program", "catalog", "catalogue", "offering"),
    "programs": ("program", "course", "catalog", "catalogue"),
    "features": ("feature", "offer", "why", "benefit"),
    "about": ("about", "story", "mission"),
    "contact": ("contact", "enquir", "inquir", "lead", "form"),
    "pricing": ("pricing", "plan", "fee"),
    "faq": ("faq", "question"),
    "testimonials": ("testimonial", "review", "stories"),
    "team": ("team", "faculty", "mentor"),
    "gallery": ("gallery", "photo"),
}


def _anchor_slug(value: Any) -> str:
    """One spelling for anchors and the '#targets' that point at them. The
    learner scrolls with document.getElementById (case-sensitive), so both
    sides must be slugged the same way."""
    return _SLUG_RE.sub("-", str(value or "").strip().lstrip("#").lower()).strip("-")


def resolve_dead_anchors(components: List[Dict[str, Any]], warnings: List[str], stampable: Optional[List[Dict[str, Any]]] = None) -> None:
    """Give every '#target' button a section to land on.

    The composer writes hero CTAs like {"target": "#courses"} and then never
    sets anchorId "courses" on anything, so the page's main button scrolls
    nowhere (a long-standing field bug — see the 7Cs home page). Rather than
    trusting the model to close that loop, pick the section it evidently
    meant: an exact id match, then an id/title containing the target word,
    then a component whose id/title/type matches the target's role hints —
    and stamp the anchor on it. Existing anchors are never moved. Mutates.
    `stampable` limits which components may receive an anchor (the copilot
    can only stamp the sections it is inserting)."""
    if not components:
        return
    anchors = {c.get("anchorId") for c in components if c.get("anchorId")}
    targets: List[str] = []

    def take(btn: Any, key: str) -> None:
        # Slug the target the way anchorId is slugged, and write that spelling
        # back so '#Courses' / '#Top Courses' land on 'courses' / 'top-courses'.
        if not isinstance(btn, dict):
            return
        t = str(btn.get(key) or "").strip()
        if not (t.startswith("#") and len(t) > 1):
            return
        slug = _anchor_slug(t)
        if not slug:
            return
        if t != f"#{slug}":
            btn[key] = f"#{slug}"
        targets.append(slug)

    for c in components:
        left = (c.get("props") or {}).get("left") or {}
        for b in list(left.get("buttons") or []) + ([left["button"]] if isinstance(left.get("button"), dict) else []):
            take(b, "target")
        if c.get("type") in ("ctaBanner", "buttonBlock"):
            btn = (c.get("props") or {}).get("button")
            take(btn, "target" if isinstance(btn, dict) and btn.get("target") else "url")
    for target in dict.fromkeys(targets):
        if target in anchors:
            continue

        def text_of(c: Dict[str, Any]) -> str:
            p = c.get("props") or {}
            return " ".join(str(x) for x in (c.get("id"), c.get("type"), p.get("title"), p.get("headerText"), p.get("eyebrow"), p.get("heading")) if x).lower()

        pool = stampable if stampable is not None else components
        candidates = [c for c in pool if c.get("type") != "heroSection" and not c.get("anchorId")]
        pick = next((c for c in candidates if str(c.get("id", "")).lower() == target), None)
        if pick is None:
            pick = next((c for c in candidates if target in text_of(c)), None)
        if pick is None:
            hints = _ANCHOR_ROLE_HINTS.get(target, ())
            pick = next((c for c in candidates if any(h in text_of(c) for h in hints)), None)
        if pick is None:
            warnings.append(f"Button target '#{target}' has no matching section on the page")
            continue
        pick["anchorId"] = target
        anchors.add(target)
        warnings.append(f"Pointed '#{target}' at section '{pick.get('id')}'")


def _sanitize_page(
    raw_json: str, req: GeneratePageRequest, catalog: Dict[str, Any], extra_allowed: Optional[set] = None
) -> tuple[Dict[str, Any], Optional[Dict[str, Any]], List[str]]:
    warnings: List[str] = []
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Model returned invalid JSON: {e}")

    global_settings = (
        _coerce_global_settings(data.get("globalSettings"), model_proposed=True) if isinstance(data, dict) else None
    )
    page = data.get("page") if isinstance(data, dict) else None
    if page is None and isinstance(data, dict) and "components" in data:
        page = data  # model returned the page object directly
    if not isinstance(page, dict) or not isinstance(page.get("components"), list):
        raise HTTPException(status_code=502, detail="Model output did not contain a page with components.")

    allowed_types = {c["type"] for c in catalog["components"]}
    # Provided images + any we auto-generated (already uploaded to our S3).
    allowed_urls = {i.url for i in req.images} | (extra_allowed or set())
    seen_ids: set = set()

    components: List[Dict[str, Any]] = []
    html_blocks = 0
    for comp in page["components"]:
        cleaned = sanitize_component(comp, allowed_types, req.allow_chrome, seen_ids, allowed_urls, warnings)
        if cleaned is None:
            continue
        if cleaned["type"] == "htmlBlock":
            html_blocks += 1
            if html_blocks > _MAX_HTML_BLOCKS_PER_PAGE:
                warnings.append(f"Dropped htmlBlock beyond the {_MAX_HTML_BLOCKS_PER_PAGE}-per-page cap")
                continue
        components.append(cleaned)

    if len(components) < 2:
        raise HTTPException(status_code=502, detail="Generation produced too few usable sections — please retry.")
    resolve_dead_anchors(components, warnings)

    slug_source = req.route_slug or page.get("route") or req.page_type or "ai-page"
    route = _SLUG_RE.sub("-", str(slug_source).lower()).strip("-") or "ai-page"

    result = {
        "id": f"page-{uuid.uuid4().hex[:8]}",
        "title": page.get("title") or page.get("name"),
        "route": route,
        "components": components,
    }
    # The page canvas. Rendered by the learner (CourseCataloguePage applies it to
    # <main>) and editable in the admin, but this rebuild-from-scratch dropped it
    # — the same silent loss that hid theme.primaryColor. A cream or tinted
    # surface is a large part of how a reference design feels, so losing it
    # rebuilt every warm-paper design on stark white.
    page_bg = coerce_hex_color(page.get("backgroundColor"))
    if page_bg:
        result["backgroundColor"] = page_bg
    return result, global_settings, warnings


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/v1/estimate")
async def estimate_page_generation(
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Credit cost preview + balance check for the wizard's confirm step.
    Institute comes ONLY from the authenticated principal — a caller must
    never be able to read another institute's balance by naming it."""
    institute_id = getattr(current_user, "institute_id", None)
    if not institute_id:
        raise HTTPException(status_code=400, detail="No institute context on this session.")
    return preflight_tool_credits(db, tool_key=_TOOL_KEY, tool_params={}, institute_id=institute_id)


_PEOPLE_SECTIONS = {"testimonialSection": "testimonials", "teamSection": "members"}


# Role words the composer uses AS names when it has none ("Founder",
# "Team Member", "Student"). They match ordinary prose, so they never count.
_NAME_STOPWORDS = {
    "founder", "cofounder", "team", "member", "student", "students", "teacher", "parent", "learner",
    "director", "ceo", "cto", "head", "principal", "admin", "staff", "user", "customer", "client",
    "name", "your", "our", "the", "and", "mentor", "trainer", "instructor", "professional", "alumni",
}


def _name_tokens(name: Any) -> List[str]:
    """Significant words of a person's name ("Aditi R." → ["aditi"]); role
    words are not names."""
    return [w for w in re.findall(r"[^\W\d_]{3,}", str(name or "").lower()) if w not in _NAME_STOPWORDS]


def strip_fabricated_people(page: Dict[str, Any], evidence: str, warnings: List[str]) -> int:
    """Drop testimonials and team members whose names appear nowhere in what
    the admin actually gave us (brief, imported site, institute name).

    The doctrine says never invent a detail; a reference site with a quotes
    band still makes the composer write "Aditi R., Student — 'I went from…'"
    (the7cs reference, 2026-09-15). A fabricated review on a live school site
    is a trust problem, not a design one, so this is enforced, not requested.
    A section left empty is removed. Returns the number of entries dropped."""
    if not isinstance(page, dict):
        return 0
    # Punctuation → spaces so "Priya," and "(Li Na)" still match as words.
    corpus = " " + re.sub(r"[^\w]+", " ", str(evidence or "").lower()) + " "
    dropped = 0
    kept: List[Dict[str, Any]] = []
    for comp in page.get("components") or []:
        key = _PEOPLE_SECTIONS.get(str((comp or {}).get("type") or ""))
        props = (comp or {}).get("props") if isinstance(comp, dict) else None
        if not key or not isinstance(props, dict) or not isinstance(props.get(key), list):
            kept.append(comp)
            continue
        real = []
        for entry in props[key]:
            name = str((entry or {}).get("name") or "").strip().lower() if isinstance(entry, dict) else ""
            words = re.findall(r"[^\W\d_]{3,}", name)
            tokens = _name_tokens(name)
            # A name is "given" when one of its (non-role) words occurs in the
            # evidence. A name made only of role words ("Founder") never is. A
            # name with no 3-letter word at all ("Li Na") is checked whole.
            if words:
                given = any(f" {t}" in corpus for t in tokens)
            else:
                whole = re.sub(r"[^\w]+", " ", name)
                given = bool(name) and f" {whole} " in corpus
            if given:
                real.append(entry)
            else:
                dropped += 1
        props[key] = real
        if real:
            kept.append(comp)
        else:
            warnings.append(
                f"Removed the '{comp.get('type')}' section: its {key} were not in your brief. "
                "Add real ones in the editor if you have them — nothing is invented."
            )
    page["components"] = kept
    if dropped:
        warnings.append(f"Dropped {dropped} invented name(s) from testimonials/team")
    return dropped


async def _compose_one_page(
    body: GeneratePageRequest, catalog: Dict[str, Any], db, institute_id: str, actor_user_id: Optional[str],
    fixed_global: Optional[Dict[str, Any]] = None,
    inspiration: Optional[Dict[str, Any]] = None,
    metering: Any = None,
) -> tuple[Dict[str, Any], Optional[Dict[str, Any]], List[str], str, str]:
    """Compose ONE page end-to-end: inspiration/site-import → prompt → LLM →
    auto-images → sanitize → bill. Returns (page, global_settings, warnings,
    model, run_id). Raises HTTPException(502) if the LLM call fails.
    When fixed_global is set, the theme is pinned (multi-page consistency)."""
    # A caller composing several pages analyses the screenshots once and passes
    # the spec in — the vision pass is the same for every page of a site.
    inspiration = dict(inspiration or {})
    pre_warnings: List[str] = []
    if not inspiration and (body.inspiration_image_urls or body.reference_url):
        try:
            sources = await _resolve_inspiration_sources(body, pre_warnings)
            if sources:
                inspiration = await _analyze_inspiration(sources, db, institute_id, actor_user_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("[page-builder] inspiration analysis skipped: %s", e)

    site_corpus = ""
    if body.source_url and is_figma_url(body.source_url):
        if FIGMA_LINK_GUIDANCE not in pre_warnings:
            pre_warnings.append(FIGMA_LINK_GUIDANCE)
    elif body.source_url:
        try:
            site_corpus = await _import_site(body.source_url)
        except Exception as e:  # noqa: BLE001
            logger.warning("[page-builder] site import skipped: %s", e)

    prompt = _build_prompt(body, catalog, inspiration, site_corpus, fixed_global)
    run_id = uuid.uuid4().hex

    primary, fallbacks = resolve_models(
        db, "page_builder", preferred_model=body.preferred_model, hard_fallback=_DEFAULT_MODEL
    )
    try:
        raw_json, model_used, usage = await generate_json(prompt, [primary, *fallbacks], label="page-builder")
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-builder] generation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Page generation failed: {e}")

    generated_urls: set = set()
    if body.auto_images:
        try:
            data = json.loads(raw_json)
            page_obj = data.get("page") if isinstance(data, dict) else None
            if isinstance(page_obj, dict):
                generated_urls = await _autogen_images(page_obj, db, institute_id, actor_user_id,
                                                       **supported_kwargs(_autogen_images, {"metering": metering}))
                raw_json = json.dumps(data)
        except Exception as e:  # noqa: BLE001
            logger.warning("[page-builder] auto-image pass skipped: %s", e)

    page, global_settings, warnings = _sanitize_page(raw_json, body, catalog, extra_allowed=generated_urls)
    warnings[:0] = pre_warnings
    # Backstop for the reference colour: if we sampled a real accent hex from the
    # admin's screenshots and the model still returned a bare preset, apply it.
    # Matching the reference's colour is the cue people judge first, and it is
    # the cheapest one to get right, so it should not depend on the model
    # remembering one line of the prompt.
    ref_palette = (inspiration.get("palette") or {}) if inspiration else {}
    ref_primary = coerce_hex_color(ref_palette.get("primary"))
    if fixed_global is not None:
        # Theme locked: the reference contributes LAYOUT only. Neither backstop
        # may run, and any reference hex the model still painted is remapped.
        ref_primary = None
        ref_palette_locked, ref_palette = ref_palette, {}
        moved = _recolour_reference_palette(page, ref_palette_locked, _derive_dark_surface(fixed_global.get("theme")))
        if moved:
            warnings.append(f"Kept the site's own theme: remapped {moved} reference colour(s) the composer had painted")
    strip_fabricated_people(
        page,
        " ".join(filter(None, [body.brief, site_corpus, body.institute_name, *(i.caption or "" for i in body.images)])),
        warnings,
    )
    if ref_primary and isinstance(global_settings, dict):
        theme = global_settings.get("theme")
        if isinstance(theme, dict) and not theme.get("primaryColor"):
            theme["primaryColor"] = ref_primary
            warnings.append(f"Applied the reference design's accent colour ({ref_primary})")
    # Same backstop for the canvas. The colour one demonstrably works — two runs
    # in a row came back with primaryColor set — while the canvas, which is only
    # ever asked for in prose, came back null both times even though the model
    # clearly understood the warmth (it painted #FFF7ED onto a section instead).
    # A tinted page surface is not something a composer reliably remembers to
    # set, so stop relying on it remembering.
    ref_bg = coerce_hex_color(ref_palette.get("background"))
    if ref_bg and ref_bg not in ("#ffffff", "#fefefe") and not page.get("backgroundColor"):
        page["backgroundColor"] = ref_bg
        warnings.append(f"Applied the reference design's page background ({ref_bg})")
    if fixed_global is not None:
        global_settings = fixed_global  # pin the shared theme across the site

    # ── Self-check ────────────────────────────────────────────────────────────
    # Until now nothing looked at the composed page: the sanitizer proves it is
    # SAFE, never that it is any good, so every blank band and empty CTA shipped
    # until a human opened the published page. audit_page decides visible
    # defects from the JSON alone (no model, no taste), and one repair round
    # clears them. Advisory findings ride out as warnings for the admin.
    repair_usage: Dict[str, int] = {}
    if body.self_check:
        try:
            issues = audit_page(
                page, global_settings,
                page_type=body.page_type or "homepage",
                info_only=_is_info_only(body.brief),
                inspiration=inspiration or None,
            )
            # Did it actually adopt the reference? Until now nothing asked, so
            # the only detector was the admin looking at the published page.
            issues += audit_reference_fidelity(page, global_settings, inspiration, theme_locked=fixed_global is not None)
            fixable = [i for i in issues if i["severity"] == "fix"]
            if fixable:
                logger.info("[page-builder] self-check found %d defect(s): %s",
                            len(fixable), ", ".join(i["code"] for i in fixable))
                page, repair_warnings, repair_usage = await _repair_page(
                    page, fixable, body, catalog, db
                )
                warnings.extend(repair_warnings)
                # Re-audit: what the repair could not clear is the admin's to
                # judge, and saying so is more useful than silently shipping it.
                issues = audit_page(
                    page, global_settings,
                    page_type=body.page_type or "homepage",
                    info_only=_is_info_only(body.brief),
                    inspiration=inspiration or None,
                ) + audit_reference_fidelity(page, global_settings, inspiration, theme_locked=fixed_global is not None)
            warnings.extend(f"{i['message']} {i['hint']}" for i in issues)
        except Exception as e:  # noqa: BLE001 — a page with defects beats no page
            logger.warning("[page-builder] self-check skipped: %s", e)

    try:
        record_tool_billing(
            tool_key=_TOOL_KEY,
            tool_params={"page_type": body.page_type or "homepage"},
            request_type=RequestType.CONTENT,
            model=model_used,
            # The repair call's tokens are billed with the generation's — it is
            # one page, one flat charge, and the usage-markup floor must see the
            # real total rather than only the first call.
            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0)
            + int(repair_usage.get("prompt_tokens") or 0),
            completion_tokens=int((usage or {}).get("completion_tokens") or 0)
            + int(repair_usage.get("completion_tokens") or 0),
            institute_id=institute_id,
            user_id=actor_user_id,
            user_role=None,
            idempotency_key=f"{_TOOL_KEY}:{run_id}",
            usage_markup=_USAGE_MARKUP,
            use_case=UC.PAGE_BUILDER,
            metering=metering,
            usage_context={"run_id": run_id, "page_type": body.page_type or "homepage"},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-builder] billing skipped: %s", e)

    return page, global_settings, warnings, model_used, run_id


@router.post("/v1/generate", response_model=GeneratePageResponse)
async def generate_page(
    body: GeneratePageRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
    request: Request = None,
) -> GeneratePageResponse:
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    if not body.brief or not body.brief.strip():
        raise HTTPException(status_code=400, detail="A brief describing the page is required.")

    # Institute comes ONLY from the authenticated principal — never from the
    # body, so a caller can't bill (or probe) another institute's credits.
    institute_id = getattr(current_user, "institute_id", None)
    if not institute_id:
        raise HTTPException(status_code=400, detail="No institute context on this session.")
    actor_user_id = getattr(current_user, "user_id", None)

    # Pre-flight credit gate — flat per run; charged only after success.
    estimate = preflight_tool_credits(db, tool_key=_TOOL_KEY, tool_params={}, institute_id=institute_id)
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits: generating this page needs ~{estimate['estimated_credits']} "
                f"credits but the balance is {estimate.get('current_balance')}."
            ),
        )

    catalog = _load_catalog()
    # Clamped to theme/fonts/motion: the caller's globalSettings also carries
    # tracking ids, lead-capture config and payment settings, none of which
    # belong in a prompt or in a response the editor merges back.
    pinned = _coerce_global_settings(body.global_settings) if body.global_settings else None
    page, global_settings, warnings, model_used, run_id = await _compose_one_page(
        body, catalog, db, institute_id, actor_user_id, fixed_global=pinned,
        **supported_kwargs(_compose_one_page,
                           {"metering": _page_metering(request, institute_id, current_user, actor_user_id)}),
    )
    return GeneratePageResponse(
        page=page, global_settings=global_settings, run_id=run_id, model=model_used, warnings=warnings
    )


# ─── Copilot (conversational edit) ──────────────────────────────────────────

_EDIT_TOOL_KEY = "page_edit"
_ALLOWED_GLOBAL_KEYS = {"theme", "motion", "fonts"}


class ChatTurn(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class EditPageRequest(BaseModel):
    # Current page the admin is editing (id + components). Sent verbatim so the
    # model edits what's on screen, not a stale copy.
    page: Dict[str, Any]
    instruction: str
    selected_component_id: Optional[str] = None
    institute_name: Optional[str] = None
    images: List[PageImage] = Field(default_factory=list)
    terminology: Optional[Dict[str, str]] = None
    # Prior turns for context (kept short by the FE).
    history: List[ChatTurn] = Field(default_factory=list)
    allow_chrome: bool = False
    # Allow the copilot to request generated images via gen:<prompt> sentinels.
    auto_images: bool = True
    preferred_model: Optional[str] = None


class EditPageResponse(BaseModel):
    ops: List[Dict[str, Any]]
    reply: str
    run_id: str
    model: str
    warnings: List[str] = Field(default_factory=list)


def _build_edit_prompt(req: EditPageRequest, catalog: Dict[str, Any], attachment_brief: str = "") -> str:
    parts: List[str] = []
    parts.append(
        "You are the copilot for Vacademy's catalogue website builder. The admin has an existing "
        "page (JSON, typed components) and asks for a change in plain language. You respond with a "
        "SMALL LIST OF OPERATIONS that transform the page — never a whole new page. Keep edits "
        "surgical: touch only what the request implies."
    )
    vocab = catalog["components"]
    if not req.allow_chrome:
        vocab = [c for c in vocab if c.get("type") not in ("header", "footer")]
    parts.append(_VOCAB_HEADER + json.dumps(vocab, ensure_ascii=False))
    parts.append("## STYLE VOCABULARY\n" + json.dumps(catalog["styleSchema"], ensure_ascii=False))

    term_block = _terminology_block(req.terminology)
    if term_block:
        parts.append(term_block)
    if req.images:
        parts.append(
            "## PROVIDED IMAGES (the ONLY image URLs you may use)\n"
            + json.dumps([i.model_dump(exclude_none=True) for i in req.images], ensure_ascii=False)
        )
    if attachment_brief:
        parts.append(
            "## WHAT THE ADMIN ATTACHED (read by a vision pass — you cannot see the raw image)\n"
            + attachment_brief
            + "\n\nHOW TO USE IT: if the attachment is a SCREENSHOT/MOCKUP of a section, BUILD that "
              "section with our components (match its structure, copy and treatment as closely as the "
              "vocabulary allows) and insert it where the instruction asks — never say you cannot see "
              "the image, and never place the screenshot itself as a page image. If it is a PHOTO/logo, "
              "place it using its URL from PROVIDED IMAGES.\n"
              "MAPPING HINTS for a transcribed card grid: a small category label above each card title "
              "is the card's `chips` (do NOT drop it — it is what makes the grid scannable); a per-card "
              "link like 'View details' is the card's `link` {text,url}; when the reference shows an "
              "icon or pictogram on a tile (most icon strips and course/category tiles do), set "
              "`iconName` from the ICON LIBRARY — an iconless tile next to iconed ones looks unfinished; "
              "leave `icon`/`iconName` UNSET only when the reference clearly shows text-only cards (an "
              "unset icon renders nothing — never substitute a decorative emoji); a tinted header band "
              "above each card's body means featureGrid style 'panel' with headerVariant.\n"
              "IF IT IS A FULL-PAGE DESIGN (or the admin asks to make the page 'like this'): REBUILD "
              "THE WHOLE PAGE from it — this is the one case where a large ops list is right. "
              "(a) `remove` every placeholder/template component already on the page that the design "
              "does not have. (b) Emit one `insert` per section IN TOP-TO-BOTTOM ORDER; the first with "
              "afterId null, every following one with afterId = the id of the section you inserted "
              "just before it (a new id is a valid anchor). (c) Map sections onto the vocabulary: hero → "
              "heroSection layout 'split' (right.image \"gen:…\" when the design shows art) with the "
              "design's headline, subheading and both button labels; an icon strip → featureGrid "
              "columns 4 style 'cards' with a one-line description per tile (never leave description "
              "empty); a 'Popular Courses / View All' band → a sectionHeading (eyebrow = the band's "
              "label, anchorId 'courses') followed by a featureGrid style 'tinted' whose tiles carry "
              "the course names with a short description and a `link` {text:'View course', url:…}; "
              "stats → statsHighlights; steps → stepsProcess; final band → ctaBanner. Every tile that "
              "shows an icon in the design gets an iconName from the ICON LIBRARY (course tiles "
              "included). A button whose target does not exist on the page (a 'Watch Intro' with no "
              "video, a '#section' that is not built) is DROPPED, not left pointing nowhere. A "
              "full-bleed hero keeps styles.roundedEdges false. The attached screenshot is a "
              "REFERENCE — never set it as right.image or any other image field; leave the field "
              "empty (or use \"gen:…\" when IMAGE GENERATION is on). (d) COLOURS: a "
              "dark hero/footer is a SURFACE — put it in that component's props.backgroundColor "
              "(the renderer switches the ink to light automatically) and NEVER in theme.primaryColor; "
              "theme.primaryColor is the BUTTON colour from the design's palette (send it with "
              "updateGlobalSettings, hex only). Give alternating sections a light tint "
              "(e.g. #F8FAFC) so the bands read like the design. (e) The site header and footer are "
              "global chrome edited elsewhere — do not insert header/footer components; in `reply`, "
              "tell the admin which nav labels and footer columns the design shows so they can set "
              "them under Site chrome."
        )
    parts.append(
        "## ICON LIBRARY\nfeatureGrid features[].iconName accepts ONLY these names (Phosphor): "
        "GraduationCap, Rocket, Target, UsersThree, Code, Brain, Trophy, Lightbulb, ShieldCheck, ChartLineUp, "
        "Clock, Star, BookOpen, Certificate, ChatsCircle, Wrench, Sparkle, Medal, Briefcase, Globe. Any other "
        "name (Lucide/Material names like MessageSquare, Users, Monitor, Award) renders NO icon. Pick the "
        "closest one from this list. stepsProcess uses steps[].icon (same names, or an emoji) and only when "
        "nodeStyle is 'icon'."
    )
    if req.history:
        convo = "\n".join(f"{t.role}: {t.content}" for t in req.history[-6:])
        parts.append("## RECENT CONVERSATION\n" + convo)

    parts.append("## CURRENT PAGE\n" + json.dumps(req.page, ensure_ascii=False))
    if req.selected_component_id:
        parts.append(
            f"## FOCUS\nThe admin has selected component id '{req.selected_component_id}'. "
            "If the request is about 'this'/'the selected' section, scope your ops to it."
        )
    if req.auto_images:
        parts.append(
            "## IMAGE GENERATION\nWhen the request needs a NEW image (replace a photo, add a hero visual, "
            "an illustration), set that image field to \"gen:<a vivid, specific photography/illustration "
            "prompt>\" inside your op and it will be generated and filled in. Max 2 gen: fields per edit. "
            "Never gen: real-brand logos or real people."
        )
    parts.append("## REQUEST\n" + req.instruction.strip())
    parts.append(
        "## OUTPUT CONTRACT\nReturn ONLY JSON of this shape (no markdown, no commentary):\n"
        '{"reply": "<one friendly sentence summarizing what you changed>", "ops": [\n'
        '  {"op": "insert", "component": {"id":"<kebab>","type":"<type>","enabled":true,"props":{…},"style":{…}?}, "afterId": "<existing-id, the id of an insert earlier in this list, or null to prepend>", "note": "<plain-language>"},\n'
        '  {"op": "update", "id": "<existing-id>", "propsPatch": {…}?, "stylePatch": {…}?, "note": "<plain-language>"},\n'
        '  {"op": "remove", "id": "<existing-id>", "note": "<plain-language>"},\n'
        '  {"op": "move", "id": "<existing-id>", "afterId": "<existing-id or null>", "note": "<plain-language>"},\n'
        '  {"op": "updateGlobalSettings", "patch": {"theme"|"motion"|"fonts": …}, "note": "<plain-language>"}\n'
        "]}\n"
        "updateGlobalSettings is how you change the SITE-WIDE look (theme colour, atmosphere, fonts, "
        "motion). Send only the keys that change — omitted keys keep their current value. Allowed values:\n"
        + _theme_value_reference() + "\n"
        "propsPatch/stylePatch are SHALLOW-merged into the component's existing props/style — send only "
        "the keys that change. Reference only ids that exist in CURRENT PAGE (except insert's new id). "
        "If the request cannot be satisfied with the vocabulary, return an empty ops list and explain in reply."
    )
    return "\n\n".join(parts)


def _mockup_urls_from_brief(brief: str, image_urls: List[str]) -> set:
    """Attachment URLs the vision pass classified as a screenshot / mockup /
    template sheet (class A or C) rather than a photo/logo (class B). With ONE
    attachment the classification is unambiguous; with several, the brief
    does not map lines to URLs, so only an all-mockup brief excludes them.
    Fails SAFE: anything ambiguous (both kinds of words, no class marker)
    keeps the images usable — a stripped photo the admin meant to place is
    worse than a mockup that slips through."""
    text = (brief or "").strip()
    if not text or not image_urls:
        return set()
    head = text[:160].upper()
    marker = re.match(r"^\s*(?:IMAGE\s*\d+\s*[:\-]\s*)?[\(\[]?([ABC])[\)\]:.\-]", head)
    cls = marker.group(1) if marker else None
    mock_words = ("FULL-PAGE DESIGN", "TEMPLATE SHEET", "SCREENSHOT", "MOCKUP", "MOCK-UP", "WIREFRAME")
    photo_words = ("PHOTO", "LOGO", "GRAPHIC", "ILLUSTRATION", "PICTURE", "PORTRAIT", "HEADSHOT")
    is_mockup = cls in ("A", "C") or any(w in head for w in mock_words)
    is_photo = cls == "B" or any(w in head for w in photo_words)
    if is_mockup and not is_photo:
        return set(image_urls)
    return set()


def _sanitize_ops(raw_json: str, req: EditPageRequest, catalog: Dict[str, Any], extra_allowed: Optional[set] = None, mockup_urls: Optional[set] = None) -> tuple[List[Dict[str, Any]], str, List[str]]:
    warnings: List[str] = []
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Model returned invalid JSON: {e}")
    if not isinstance(data, dict) or not isinstance(data.get("ops"), list):
        raise HTTPException(status_code=502, detail="Model output did not contain an ops list.")

    reply = str(data.get("reply") or "").strip()
    allowed_types = {c["type"] for c in catalog["components"]}
    # A screenshot/mockup the admin attached is a REFERENCE, never page art:
    # with image generation off the model reached for the only URL it had and
    # put the whole template sheet in the hero. Keep it out of the allowlist.
    allowed_urls = ({i.url for i in req.images} - (mockup_urls or set())) | (extra_allowed or set())
    # Images ALREADY on the page are trusted (the variants endpoint uses the
    # same rule): a patch that re-sends a section's object — say the whole
    # filterSidebar with its promo.screenImage — must not blank its own art.
    allowed_urls |= _collect_page_image_urls(req.page, set()) - (mockup_urls or set())
    # Ids that exist on the page (top-level + slot children) — ops may only
    # reference these (inserts bring their own new id).
    existing_ids: set = set()
    type_by_id: Dict[str, str] = {}

    def collect(components: Any) -> None:
        for c in components if isinstance(components, list) else []:
            if isinstance(c, dict) and c.get("id"):
                existing_ids.add(c["id"])
                type_by_id[c["id"]] = str(c.get("type") or "")
                slots = (c.get("props") or {}).get("slots")
                if isinstance(slots, list):
                    for slot in slots:
                        collect(slot)

    collect(req.page.get("components"))

    clean_ops: List[Dict[str, Any]] = []
    seen_ids = set(existing_ids)
    # Ids created by earlier inserts in THIS batch. The editor applies ops in
    # order and `afterId: null` means PREPEND, so a page rebuilt as several
    # inserts that all say null lands in REVERSE order (hero at the bottom —
    # field case: Smart AI Academy, 2026-09-14). Two fixes: an insert may now
    # anchor on an id inserted just before it, and a null afterId following
    # another insert is read as "continue the sequence", not "start over".
    inserted_ids: List[str] = []
    for op in data["ops"]:
        if not isinstance(op, dict):
            continue
        kind = op.get("op")
        note = _clean_string(str(op.get("note") or ""))
        if kind == "insert":
            comp = sanitize_component(op.get("component"), allowed_types, req.allow_chrome, seen_ids, allowed_urls, warnings)
            if comp is None:
                continue
            after = op.get("afterId")
            if after is not None and after not in existing_ids and after not in inserted_ids:
                warnings.append("insert.afterId not on page — appended to end")
                after = None
            if after is None and inserted_ids:
                after = inserted_ids[-1]
            inserted_ids.append(comp["id"])
            clean_ops.append({"op": "insert", "component": comp, "afterId": after, "note": note})
        elif kind == "update":
            oid = op.get("id")
            if oid not in existing_ids:
                warnings.append(f"update skipped — unknown id '{oid}'")
                continue
            entry: Dict[str, Any] = {"op": "update", "id": oid, "note": note}
            if isinstance(op.get("propsPatch"), dict):
                raw_patch = dict(op["propsPatch"])
                custom_html: Dict[str, Any] = {}
                if type_by_id.get(oid) == "htmlBlock":
                    # html/css take the custom-HTML pipeline, NOT the generic
                    # cleaner (whose default nh3 profile strips class attrs).
                    if isinstance(raw_patch.get("html"), str):
                        custom_html["html"] = _sanitize_custom_html(raw_patch.pop("html"), allowed_urls, warnings)
                    if isinstance(raw_patch.get("css"), str):
                        custom_html["css"] = _scrub_css(raw_patch.pop("css"), warnings)
                patch = clean_urls(raw_patch, allowed_urls, warnings)
                patch.update(custom_html)
                # A propsPatch may set columnLayout slots — type-filter nested
                # components so htmlBlock/unknown types can't be smuggled in via
                # an update (the insert path already recurses slots).
                slots = patch.get("slots")
                if isinstance(slots, list):
                    patch["slots"] = [
                        [c for c in (sanitize_component(ch, allowed_types, req.allow_chrome, seen_ids, allowed_urls, warnings) for ch in slot) if c is not None]
                        if isinstance(slot, list) else []
                        for slot in slots
                    ]
                entry["propsPatch"] = patch
            if isinstance(op.get("stylePatch"), dict):
                entry["stylePatch"] = clean_urls(op["stylePatch"], allowed_urls, warnings)
            if "propsPatch" not in entry and "stylePatch" not in entry:
                continue
            clean_ops.append(entry)
        elif kind == "remove":
            oid = op.get("id")
            if oid not in existing_ids:
                warnings.append(f"remove skipped — unknown id '{oid}'")
                continue
            clean_ops.append({"op": "remove", "id": oid, "note": note})
        elif kind == "move":
            oid = op.get("id")
            if oid not in existing_ids:
                warnings.append(f"move skipped — unknown id '{oid}'")
                continue
            after = op.get("afterId")
            if after is not None and after not in existing_ids and after not in inserted_ids:
                after = None
            clean_ops.append({"op": "move", "id": oid, "afterId": after, "note": note})
        elif kind == "updateGlobalSettings":
            patch = op.get("patch")
            if not isinstance(patch, dict):
                continue
            # Only theme/motion/fonts may be touched conversationally.
            safe = {k: clean_urls(v, allowed_urls, warnings) for k, v in patch.items() if k in _ALLOWED_GLOBAL_KEYS}
            # ...and only with values the renderers understand. The patch is
            # shallow-merged straight into globalSettings by the editor, so an
            # invented preset name ("navy") or a non-hex colour would land in the
            # saved config and quietly render as no theme at all.
            safe = _validate_global_patch(safe, warnings)
            if not safe:
                warnings.append("updateGlobalSettings skipped — no allowed keys")
                continue
            clean_ops.append({"op": "updateGlobalSettings", "patch": safe, "note": note})
        else:
            warnings.append(f"Dropped unknown op '{kind}'")

    # Anchors can only be stamped on components we are inserting (an update op
    # patches props/style, not the component's anchorId), so resolve against
    # the page as it will look with the inserts applied and let the resolver
    # pick among the new sections; existing sections keep their anchors.
    inserted = [op["component"] for op in clean_ops if op["op"] == "insert"]
    if inserted:
        existing = [c for c in (req.page.get("components") or []) if isinstance(c, dict)]
        resolve_dead_anchors(existing + inserted, warnings, stampable=inserted)

    return clean_ops, reply, warnings


@router.post("/v1/edit", response_model=EditPageResponse)
async def edit_page(
    body: EditPageRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
    request: Request = None,
) -> EditPageResponse:
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    if not body.instruction or not body.instruction.strip():
        raise HTTPException(status_code=400, detail="An instruction is required.")
    if not isinstance(body.page, dict) or not isinstance(body.page.get("components"), list):
        raise HTTPException(status_code=400, detail="A current page with components is required.")

    institute_id = getattr(current_user, "institute_id", None)
    if not institute_id:
        raise HTTPException(status_code=400, detail="No institute context on this session.")
    actor_user_id = getattr(current_user, "user_id", None)
    meter_ctx = _page_metering(request, institute_id, current_user, actor_user_id)

    estimate = preflight_tool_credits(db, tool_key=_EDIT_TOOL_KEY, tool_params={}, institute_id=institute_id)
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits: this edit needs ~{estimate['estimated_credits']} "
                f"credits but the balance is {estimate.get('current_balance')}."
            ),
        )

    catalog = _load_catalog()
    # Vision pass first: without it the model receives attachments as bare URLs
    # and cannot see them (field report: "I couldn't see an actual section
    # attached" when an admin pasted a screenshot of the section they wanted).
    attachment_brief = ""
    if body.images:
        try:
            attachment_brief = await _describe_attachments(
                [i.url for i in body.images], db, institute_id, actor_user_id
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[page-copilot] attachment description skipped: %s", e)
    prompt = _build_edit_prompt(body, catalog, attachment_brief)
    run_id = uuid.uuid4().hex

    primary, fallbacks = resolve_models(
        db, "page_builder", preferred_model=body.preferred_model, hard_fallback=_DEFAULT_MODEL
    )
    try:
        raw_json, model_used, usage = await generate_json(
            prompt, [primary, *fallbacks], label="page-copilot"
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-copilot] edit failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Edit failed: {e}")

    # Generate any gen:<prompt> images the copilot requested in its ops
    # (insert components / propsPatch) BEFORE sanitizing, so the fresh URLs
    # pass the image allowlist.
    generated_urls: set = set()
    if body.auto_images:
        try:
            data = json.loads(raw_json)
            if isinstance(data, dict) and isinstance(data.get("ops"), list):
                generated_urls = await _autogen_images(data["ops"], db, institute_id, actor_user_id,
                                                       **supported_kwargs(_autogen_images, {"metering": meter_ctx}))
                raw_json = json.dumps(data)
        except Exception as e:  # noqa: BLE001
            logger.warning("[page-copilot] auto-image pass skipped: %s", e)

    ops, reply, warnings = _sanitize_ops(
        raw_json, body, catalog, extra_allowed=generated_urls,
        mockup_urls=_mockup_urls_from_brief(attachment_brief, [i.url for i in body.images]),
    )

    try:
        record_tool_billing(
            tool_key=_EDIT_TOOL_KEY,
            tool_params={"op_count": len(ops)},
            request_type=RequestType.CONTENT,
            model=model_used,
            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
            completion_tokens=int((usage or {}).get("completion_tokens") or 0),
            institute_id=institute_id,
            user_id=actor_user_id,
            user_role=None,
            idempotency_key=f"{_EDIT_TOOL_KEY}:{run_id}",
            usage_markup=_USAGE_MARKUP,
            use_case=UC.PAGE_BUILDER,
            metering=meter_ctx,
            usage_context={"run_id": run_id},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-copilot] billing skipped: %s", e)

    return EditPageResponse(ops=ops, reply=reply, run_id=run_id, model=model_used, warnings=warnings)


# ─── Section variants (regenerate ONE section, several ways) ────────────────
#
# The smallest unit of iteration used to be the whole page: /v1/generate at 100
# credits, or /v1/edit for a described change. When one section came out wrong
# the admin either hand-fixed it or re-rolled the page and lost the parts that
# were right — so quality depended on the first attempt being good. This makes
# it a CHOICE instead: three treatments of one section, side by side, applied in
# place. Billed as an edit, because that is what it is.

class SectionVariantsRequest(BaseModel):
    # The page is context, not the target: variants must fit the sections
    # around them (no repeated headings, consistent tone and surface rhythm).
    page: Dict[str, Any]
    component_id: str
    # Optional steer. Empty means "same section, better / different".
    instruction: Optional[str] = None
    variant_count: int = 3
    institute_name: Optional[str] = None
    images: List[PageImage] = Field(default_factory=list)
    terminology: Optional[Dict[str, str]] = None
    global_settings: Optional[Dict[str, Any]] = None
    # Let a variant switch component type when the intent calls for it (a plain
    # card grid becoming a comparison panel, say).
    allow_type_change: bool = True
    preferred_model: Optional[str] = None


class SectionVariant(BaseModel):
    label: str
    rationale: str
    component: Dict[str, Any]


class SectionVariantsResponse(BaseModel):
    variants: List[SectionVariant]
    run_id: str
    model: str
    warnings: List[str] = Field(default_factory=list)


def _collect_page_image_urls(node: Any, out: set, depth: int = 0) -> set:
    """Every image URL already on the page. Variants may reuse these and
    nothing else — the model cannot invent an image, and this endpoint does not
    generate them, so the allowlist is exactly what is already trusted."""
    if depth > 8:
        return out
    if isinstance(node, dict):
        for k, v in node.items():
            if is_image_key(k) and isinstance(v, str) and v:
                out.add(v)
            elif is_image_list_key(k) and isinstance(v, list):
                out.update(u for u in v if isinstance(u, str) and u)
            else:
                _collect_page_image_urls(v, out, depth + 1)
    elif isinstance(node, list):
        for v in node:
            _collect_page_image_urls(v, out, depth + 1)
    elif isinstance(node, str) and node.startswith("https://"):
        pass
    return out


def _find_component(page: Dict[str, Any], component_id: str) -> Optional[Dict[str, Any]]:
    for comp in page.get("components") or []:
        if not isinstance(comp, dict):
            continue
        if comp.get("id") == component_id:
            return comp
        for slot in (comp.get("props") or {}).get("slots") or []:
            if isinstance(slot, list):
                for child in slot:
                    if isinstance(child, dict) and child.get("id") == component_id:
                        return child
    return None


def _page_outline(page: Dict[str, Any], focus_id: str) -> List[Dict[str, Any]]:
    """Types + headings of the surrounding sections. Sending the whole page
    again would double the prompt for context the model barely needs; what it
    must not do is repeat a neighbour's heading or clash with the rhythm."""
    outline: List[Dict[str, Any]] = []
    for comp in page.get("components") or []:
        if not isinstance(comp, dict):
            continue
        props = comp.get("props") or {}
        heading = None
        for key in ("headerText", "title", "heading"):
            if isinstance(props.get(key), str) and props[key].strip():
                heading = props[key].strip()[:80]
                break
        entry = {"id": comp.get("id"), "type": comp.get("type")}
        if heading:
            entry["heading"] = heading
        if comp.get("id") == focus_id:
            entry["THIS_IS_THE_SECTION_YOU_ARE_REPLACING"] = True
        outline.append(entry)
    return outline


def _build_variants_prompt(
    req: SectionVariantsRequest, target: Dict[str, Any], catalog: Dict[str, Any], count: int
) -> str:
    parts: List[str] = [
        f"You are the section designer for Vacademy's catalogue website builder. Produce {count} "
        "genuinely DIFFERENT versions of ONE section of an existing page, so the admin can pick.",
        "WHAT 'DIFFERENT' MEANS: different LAYOUT, density, emphasis and structure — a compact "
        "3-column grid vs an editorial two-column with a lead paragraph vs a bordered panel with a "
        "highlighted first item. Three recolourings of the same arrangement are a wasted choice. "
        "Every version must still: keep the page's existing theme and tone, say something specific "
        "about THIS institute, avoid repeating a heading used by a neighbouring section, and be "
        "complete (no empty lists, no placeholder text).",
    ]
    vocab = [c for c in catalog["components"] if c.get("type") not in ("header", "footer")]
    if not req.allow_type_change:
        vocab = [c for c in vocab if c.get("type") == target.get("type")]
        parts.append(f"KEEP THE COMPONENT TYPE: every version must be a '{target.get('type')}'.")
    else:
        parts.append(
            f"The current section is a '{target.get('type')}'. Prefer keeping that type; switch to a "
            "different component only when the instruction genuinely calls for a different kind of "
            "section, and never to header, footer, productPageOffer, folderBrowser or learningPath (an admin "
            "must bind those to a product page / folder library by hand, so a generated one renders as nothing)."
        )
    parts.append(_VOCAB_HEADER + json.dumps(vocab, ensure_ascii=False))
    parts.append("## STYLE VOCABULARY\n" + json.dumps(catalog["styleSchema"], ensure_ascii=False))

    if req.institute_name:
        parts.append(f"## INSTITUTE\nName: {req.institute_name}")
    term_block = _terminology_block(req.terminology)
    if term_block:
        parts.append(term_block)
    if req.global_settings:
        theme = {k: v for k, v in (req.global_settings or {}).items() if k in ("theme", "fonts", "motion")}
        if theme:
            parts.append(
                "## SITE THEME (already chosen — match it, do not propose a new one)\n"
                + json.dumps(theme, ensure_ascii=False)
            )
    if req.images:
        parts.append(
            "## PROVIDED IMAGES (the ONLY image URLs you may use, besides those already in the section)\n"
            + json.dumps([i.model_dump(exclude_none=True) for i in req.images], ensure_ascii=False)
        )
    parts.append(
        "## THE PAGE AROUND IT (types and headings only)\n"
        + json.dumps(_page_outline(req.page, req.component_id), ensure_ascii=False)
    )
    parts.append("## THE SECTION TO REPLACE\n" + json.dumps(target, ensure_ascii=False))

    # htmlBlock stores the intent it was built from precisely so it can be
    # regenerated later. Nothing consumed it until now.
    if target.get("type") == "htmlBlock":
        original_prompt = (target.get("props") or {}).get("prompt")
        if isinstance(original_prompt, str) and original_prompt.strip():
            parts.append(
                "## WHAT THIS CUSTOM SECTION WAS FOR (its stored intent — honour it)\n"
                + original_prompt.strip()
            )

    if req.instruction and req.instruction.strip():
        parts.append("## WHAT THE ADMIN ASKED FOR\n" + req.instruction.strip())
    else:
        parts.append(
            "## WHAT THE ADMIN ASKED FOR\nNo specific instruction — they want to see this section done "
            "better, and differently. Keep its PURPOSE and its facts; rethink its presentation."
        )

    parts.append(
        "## OUTPUT CONTRACT\nReturn ONLY JSON, no markdown:\n"
        '{"variants": [{"label": "<2-3 words, e.g. Editorial split>", '
        '"rationale": "<one sentence on what makes this one different>", '
        '"component": {"id": "%s", "type": "<type>", "enabled": true, "props": {…}, "style": {…}?}}]}\n'
        "Every component MUST reuse the id \"%s\" — these replace the section in place. "
        "Return exactly %d variants."
        % (req.component_id, req.component_id, count)
    )
    return "\n\n".join(parts)


@router.post("/v1/section", response_model=SectionVariantsResponse)
async def generate_section_variants(
    body: SectionVariantsRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
    request: Request = None,
) -> SectionVariantsResponse:
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    if not isinstance(body.page, dict) or not isinstance(body.page.get("components"), list):
        raise HTTPException(status_code=400, detail="A current page with components is required.")

    institute_id = getattr(current_user, "institute_id", None)
    if not institute_id:
        raise HTTPException(status_code=400, detail="No institute context on this session.")
    actor_user_id = getattr(current_user, "user_id", None)
    meter_ctx = _page_metering(request, institute_id, current_user, actor_user_id)

    target = _find_component(body.page, body.component_id)
    if target is None:
        raise HTTPException(status_code=404, detail="That section is not on this page.")

    count = max(2, min(4, body.variant_count or 3))

    estimate = preflight_tool_credits(db, tool_key=_EDIT_TOOL_KEY, tool_params={}, institute_id=institute_id)
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits: this needs ~{estimate['estimated_credits']} credits but the "
                f"balance is {estimate.get('current_balance')}."
            ),
        )

    catalog = _load_catalog()
    prompt = _build_variants_prompt(body, target, catalog, count)
    run_id = uuid.uuid4().hex
    primary, fallbacks = resolve_models(
        db, "page_builder", preferred_model=body.preferred_model, hard_fallback=_DEFAULT_MODEL
    )
    try:
        raw_json, model_used, usage = await generate_json(prompt, [primary, *fallbacks], label="page-section")
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-section] generation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Section generation failed: {e}")

    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Model returned invalid JSON: {e}")

    allowed_urls = _collect_page_image_urls(body.page, set())
    allowed_urls.update(i.url for i in body.images if i.url)
    allowed_types = {c["type"] for c in catalog["components"]}
    warnings: List[str] = []

    clean: List[SectionVariant] = []
    rejected = 0
    for raw in (data.get("variants") or [])[:count]:
        if not isinstance(raw, dict):
            continue
        comp_in = raw.get("component")
        if not isinstance(comp_in, dict):
            continue
        # productPageOffer needs an admin-chosen product page, so a generated
        # one is guaranteed to render as nothing (audit rule 'offer-unbound').
        if comp_in.get("type") in ("productPageOffer", "folderBrowser", "learningPath") and comp_in.get("type") != target.get("type"):
            rejected += 1
            continue
        # Fresh seen_ids per variant: they are alternatives, not siblings, so
        # they must all keep the original id to swap in place.
        comp = sanitize_component(
            comp_in, allowed_types, allow_chrome=False, seen_ids=set(),
            allowed_urls=allowed_urls, warnings=warnings,
        )
        if comp is None:
            rejected += 1
            continue
        comp["id"] = body.component_id
        defects = [i for i in audit_component(comp) if i["severity"] == "fix"]
        if defects:
            # Offering a choice that includes a broken option is worse than
            # offering fewer options.
            rejected += 1
            logger.info("[page-section] dropped a variant: %s", ", ".join(d["code"] for d in defects))
            continue
        clean.append(SectionVariant(
            label=_clean_string(str(raw.get("label") or "Alternative"))[:40],
            rationale=_clean_string(str(raw.get("rationale") or ""))[:200],
            component=comp,
        ))

    if rejected:
        warnings.append(f"{rejected} version(s) were discarded for rendering problems.")
    if not clean:
        raise HTTPException(
            status_code=502,
            detail="No usable versions came back — try again, or describe the change you want.",
        )

    try:
        record_tool_billing(
            tool_key=_EDIT_TOOL_KEY,
            tool_params={"mode": "section_variants"},
            request_type=RequestType.CONTENT,
            model=model_used,
            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
            completion_tokens=int((usage or {}).get("completion_tokens") or 0),
            institute_id=institute_id,
            user_id=actor_user_id,
            user_role=None,
            idempotency_key=f"{_EDIT_TOOL_KEY}:{run_id}",
            usage_markup=_USAGE_MARKUP,
            use_case=UC.PAGE_BUILDER,
            metering=meter_ctx,
            usage_context={"run_id": run_id},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-section] billing skipped: %s", e)

    return SectionVariantsResponse(variants=clean, run_id=run_id, model=model_used, warnings=warnings)


# ─── Brand kit (theme proposals) ────────────────────────────────────────────

_BRAND_TOOL_KEY = "page_brand_kit"
_THEME_PRESETS = {"default", "ocean", "forest", "sunset", "midnight", "rose", "violet", "amber", "slate"}
_FONT_FAMILIES = {
    "Inter", "Roboto", "Open Sans", "Poppins", "Lato", "Montserrat", "Mulish", "Figtree",
    "Outfit", "Nunito", "Space Grotesk", "Playfair Display", "Fraunces", "Newsreader",
    "Lora", "DM Serif Display", "Rubik", "Quicksand", "Baloo 2",
    "Noto Sans Devanagari", "Mukta", "Hind", "Noto Serif Devanagari", "Tiro Devanagari Hindi",
}
_ATMOSPHERES = {"flat", "soft", "mesh", "aurora"}
_INTENSITIES = {"subtle", "medium", "bold"}
_HEADING_SCALES = {"default", "editorial", "compact"}
_RADII = {"sharp", "rounded", "pill"}
_MOTIONS = {"none", "calm", "balanced", "dynamic"}


def _theme_value_reference() -> str:
    """The allowed theme values, listed for the model. The exported catalog only
    carries a terse shape string, so without this the model had to guess preset
    and atmosphere names — and had no way to know primaryColor exists at all."""
    return (
        f"- theme.preset: {sorted(_THEME_PRESETS)}\n"
        f"- theme.primaryColor: an exact brand hex like \"#1D4ED8\" (optional). Set it whenever the "
        f"brand's or the reference design's real colour is known — it overrides the preset's hue and "
        f"re-tints buttons, links and accents across the site. Presets are only 9 fixed palettes; this "
        f"is how a page matches a brand EXACTLY. Omit it to use the preset's own colour.\n"
        f"- theme.atmosphere.canvas: {sorted(_ATMOSPHERES)}; .intensity: {sorted(_INTENSITIES)}\n"
        f"- theme.headingScale: {sorted(_HEADING_SCALES)}; theme.borderRadius: {sorted(_RADII)}\n"
        f"- motion.personality: {sorted(_MOTIONS)}\n"
        f"- fonts.family (body) and fonts.headingFamily (headings): {sorted(_FONT_FAMILIES)}"
    )


#: globalSettings.theme.palette keys (learner -utils/catalogue-palette.ts PALETTE_KEYS).
_PATCH_PALETTE_KEYS = (
    "text", "body", "muted", "muted2", "primary", "gold", "accent", "olive", "cream", "canvas",
    "sand", "border", "borderStrong", "accentOnDark", "bodyOnDark", "outline",
)
#: globalSettings.theme.contentMaxWidth range (resolveContentMaxWidth).
_PATCH_WIDTH_MIN, _PATCH_WIDTH_MAX = 320, 2400


def _validate_palette_patch(raw: Any, warnings: List[str]) -> Dict[str, Any]:
    """A theme.palette PATCH: known keys with a hex value (None removes one) and applyToTokens."""
    if not isinstance(raw, dict):
        warnings.append("Ignored theme.palette — not an object of named colours")
        return {}
    out: Dict[str, Any] = {}
    for key, value in raw.items():
        if key == "applyToTokens":
            if isinstance(value, bool) or value is None:
                out[key] = value
            else:
                warnings.append("Ignored theme.palette.applyToTokens — not true/false")
        elif key not in _PATCH_PALETTE_KEYS:
            warnings.append(f"Ignored unknown theme.palette key '{key}'")
        elif value is None:
            out[key] = None
        elif coerce_hex_color(value):
            out[key] = coerce_hex_color(value)
        else:
            warnings.append(f"Ignored theme.palette.{key} — not a hex colour")
    return out


def _validate_global_patch(patch: Dict[str, Any], warnings: List[str]) -> Dict[str, Any]:
    """Drop invalid values out of a conversational globalSettings PATCH.

    Patch semantics, not clamp semantics: an unrecognised value is REMOVED (so
    the editor's shallow merge leaves the site's current value alone) rather than
    replaced with a default, which would silently undo settings the admin never
    mentioned."""
    out: Dict[str, Any] = {}

    theme_in = patch.get("theme")
    if isinstance(theme_in, dict):
        theme_out: Dict[str, Any] = {}
        for key, allowed in (
            ("preset", _THEME_PRESETS),
            ("headingScale", _HEADING_SCALES),
            ("borderRadius", _RADII),
        ):
            if key in theme_in:
                if theme_in[key] in allowed:
                    theme_out[key] = theme_in[key]
                else:
                    warnings.append(f"Ignored unsupported theme.{key} '{theme_in[key]}'")
        if "primaryColor" in theme_in:
            primary = coerce_hex_color(theme_in["primaryColor"])
            if primary:
                theme_out["primaryColor"] = primary
            elif theme_in["primaryColor"] in (None, ""):
                theme_out["primaryColor"] = None  # explicit reset to the preset palette
            else:
                warnings.append("Ignored theme.primaryColor — not a hex colour")
        atm_in = theme_in.get("atmosphere")
        if isinstance(atm_in, dict):
            atm_out = {
                k: v for k, v in atm_in.items()
                if (k == "canvas" and v in _ATMOSPHERES) or (k == "intensity" and v in _INTENSITIES)
            }
            if atm_out:
                theme_out["atmosphere"] = atm_out
        # Opt-in design tokens (learner -utils/catalogue-palette.ts): the named
        # palette and the content column width. Kept only when valid; the
        # merge (applyOps / website_edit) folds a palette in key by key.
        if "palette" in theme_in:
            palette_out = _validate_palette_patch(theme_in.get("palette"), warnings)
            if palette_out:
                theme_out["palette"] = palette_out
        if "contentMaxWidth" in theme_in:
            width = theme_in.get("contentMaxWidth")
            if width is None:
                theme_out["contentMaxWidth"] = None  # explicit reset to the default width
            elif (not isinstance(width, bool) and isinstance(width, (int, float)) and width == int(width)
                  and _PATCH_WIDTH_MIN <= int(width) <= _PATCH_WIDTH_MAX):
                theme_out["contentMaxWidth"] = int(width)
            else:
                warnings.append(
                    f"Ignored theme.contentMaxWidth — not a whole px value from {_PATCH_WIDTH_MIN} to {_PATCH_WIDTH_MAX}"
                )
        if theme_out:
            out["theme"] = theme_out

    fonts_in = patch.get("fonts")
    if isinstance(fonts_in, dict):
        _known_stacks = set(_FONT_STACKS.values())
        fonts_out: Dict[str, Any] = {}
        for key in ("family", "headingFamily"):
            if key not in fonts_in:
                continue
            label = fonts_in[key]
            stack = _FONT_STACKS.get(label) or (label if label in _known_stacks else None)
            if stack:
                fonts_out[key] = stack
            else:
                warnings.append(f"Ignored unregistered font '{label}'")
        if fonts_out:
            fonts_out["enabled"] = True
            out["fonts"] = fonts_out

    motion_in = patch.get("motion")
    if isinstance(motion_in, dict) and motion_in.get("personality") in _MOTIONS:
        out["motion"] = {"personality": motion_in["personality"]}

    return out


class BrandKitRequest(BaseModel):
    institute_name: Optional[str] = None
    brief: Optional[str] = None
    # A short description of the brand vibe or existing colors (from the admin
    # or a future scrape) — free text.
    brand_notes: Optional[str] = None
    preferred_model: Optional[str] = None


class BrandKit(BaseModel):
    label: str
    themePreset: str
    # Exact brand hex — overrides the preset's hue when the institute's real
    # colour is known. Optional: omitted means "use the preset's own palette".
    primaryColor: Optional[str] = None
    atmosphere: Dict[str, str]
    headingScale: str
    borderRadius: str
    motion: str
    fontFamily: str          # body
    headingFontFamily: str   # heading (may equal fontFamily = no separate heading font)
    rationale: str


class BrandKitResponse(BaseModel):
    kits: List[BrandKit]
    run_id: str
    model: str


def _coerce_kit(raw: Any) -> Optional[BrandKit]:
    if not isinstance(raw, dict):
        return None
    preset = raw.get("themePreset") if raw.get("themePreset") in _THEME_PRESETS else "default"
    atm = raw.get("atmosphere") if isinstance(raw.get("atmosphere"), dict) else {}
    canvas = atm.get("canvas") if atm.get("canvas") in _ATMOSPHERES else "soft"
    intensity = atm.get("intensity") if atm.get("intensity") in _INTENSITIES else "subtle"
    return BrandKit(
        label=_clean_string(str(raw.get("label") or "Brand theme"))[:40],
        themePreset=preset,
        primaryColor=coerce_hex_color(raw.get("primaryColor")),
        atmosphere={"canvas": canvas, "intensity": intensity},
        headingScale=raw.get("headingScale") if raw.get("headingScale") in _HEADING_SCALES else "default",
        borderRadius=raw.get("borderRadius") if raw.get("borderRadius") in _RADII else "rounded",
        motion=raw.get("motion") if raw.get("motion") in _MOTIONS else "calm",
        fontFamily=raw.get("fontFamily") if raw.get("fontFamily") in _FONT_FAMILIES else "Inter",
        headingFontFamily=raw.get("headingFontFamily") if raw.get("headingFontFamily") in _FONT_FAMILIES
        else (raw.get("fontFamily") if raw.get("fontFamily") in _FONT_FAMILIES else "Inter"),
        rationale=_clean_string(str(raw.get("rationale") or ""))[:240],
    )


@router.post("/v1/brand-kit", response_model=BrandKitResponse)
async def derive_brand_kit(
    body: BrandKitRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
    request: Request = None,
) -> BrandKitResponse:
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    institute_id = getattr(current_user, "institute_id", None)
    if not institute_id:
        raise HTTPException(status_code=400, detail="No institute context on this session.")
    actor_user_id = getattr(current_user, "user_id", None)
    meter_ctx = _page_metering(request, institute_id, current_user, actor_user_id)

    estimate = preflight_tool_credits(db, tool_key=_BRAND_TOOL_KEY, tool_params={}, institute_id=institute_id)
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits: this needs ~{estimate['estimated_credits']} "
                f"credits but the balance is {estimate.get('current_balance')}."
            ),
        )

    prompt = (
        "You are a brand designer for education websites. Propose EXACTLY 3 distinct, tasteful theme "
        "options for the institute below, choosing ONLY from these allowed values:\n"
        f"- themePreset: {sorted(_THEME_PRESETS)}\n"
        f"- atmosphere.canvas: {sorted(_ATMOSPHERES)}; atmosphere.intensity: {sorted(_INTENSITIES)}\n"
        f"- headingScale: {sorted(_HEADING_SCALES)}; borderRadius: {sorted(_RADII)}; motion: {sorted(_MOTIONS)}\n"
        f"- fontFamily (body) and headingFontFamily (headings): {sorted(_FONT_FAMILIES)}\n"
        "You may also set primaryColor to an exact hex like \"#1D4ED8\" — do this when the brand notes name "
        "or imply a real brand colour, because matching it beats any of the 9 presets. Omit primaryColor "
        "when no real colour is known. Even with primaryColor set, still pick the closest preset.\n"
        "Make the three genuinely different (e.g. one editorial-serif, one bold-modern, one calm-minimal). "
        "For editorial/premium options pair a SERIF headingFontFamily (Playfair Display / Fraunces / DM Serif "
        "Display) with a SANS fontFamily body — serif headings over sans body reads premium. Set "
        "headingFontFamily equal to fontFamily when no separate heading font is wanted. "
        "Pick presets/colors that suit the institute's subject and audience.\n\n"
        f"Institute: {body.institute_name or 'an education institute'}\n"
        f"Context: {(body.brief or '')[:600]}\n"
        f"Brand notes: {(body.brand_notes or 'none')[:300]}\n\n"
        'Return ONLY JSON: {"kits": [{"label": "...", "themePreset": "...", '
        '"primaryColor": "#rrggbb (optional)", '
        '"atmosphere": {"canvas": "...", "intensity": "..."}, "headingScale": "...", '
        '"borderRadius": "...", "motion": "...", "fontFamily": "...", "headingFontFamily": "...", '
        '"rationale": "one sentence"}]}'
    )
    run_id = uuid.uuid4().hex
    primary, fallbacks = resolve_models(
        db, "page_builder", preferred_model=body.preferred_model, hard_fallback=_DEFAULT_MODEL
    )
    try:
        raw_json, model_used, usage = await generate_json(prompt, [primary, *fallbacks], label="brand-kit")
    except Exception as e:  # noqa: BLE001
        logger.warning("[brand-kit] failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Brand kit generation failed: {e}")

    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Model returned invalid JSON: {e}")
    kits = [k for k in (_coerce_kit(x) for x in (data.get("kits") or [])) if k is not None][:3]
    if not kits:
        raise HTTPException(status_code=502, detail="No usable brand kits — please retry.")

    try:
        record_tool_billing(
            tool_key=_BRAND_TOOL_KEY,
            tool_params={},
            request_type=RequestType.CONTENT,
            model=model_used,
            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
            completion_tokens=int((usage or {}).get("completion_tokens") or 0),
            institute_id=institute_id,
            user_id=actor_user_id,
            user_role=None,
            idempotency_key=f"{_BRAND_TOOL_KEY}:{run_id}",
            usage_markup=_USAGE_MARKUP,
            use_case=UC.PAGE_BUILDER,
            metering=meter_ctx,
            usage_context={"run_id": run_id},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[brand-kit] billing skipped: %s", e)

    return BrandKitResponse(kits=kits, run_id=run_id, model=model_used)


# ─── On-demand image / logo generation ──────────────────────────────────────

# kind → (prompt wrapper, default aspect). Logos get a clean, mark-focused brief.
_IMAGE_KIND_STYLE = {
    "logo": ("A clean, modern, minimal logo mark for {p}. Centered on a plain white background, "
             "flat vector style, simple geometric forms, high contrast, no photorealism, no extra text.", "1:1"),
    "hero": ("A polished, editorial hero photograph: {p}. Natural light, shallow depth of field, premium feel.", "16:9"),
    "banner": ("A wide banner image: {p}. Clean composition with room for text overlay.", "16:9"),
    "illustration": ("A modern flat vector illustration: {p}. Cohesive limited palette, friendly, professional.", "4:3"),
    "photo": ("A high-quality photograph: {p}. Natural, authentic, well-lit.", "4:3"),
    "image": ("{p}", "16:9"),
}


class GenerateImageRequest(BaseModel):
    prompt: str
    kind: str = "image"          # logo | hero | banner | illustration | photo | image
    aspect_ratio: Optional[str] = None
    count: int = 1               # 1–3 (logos often want a few options)


class GenerateImageResponse(BaseModel):
    urls: List[str]
    model: str


@router.post("/v1/image", response_model=GenerateImageResponse)
async def generate_page_image(
    body: GenerateImageRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
    request: Request = None,
) -> GenerateImageResponse:
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    if not body.prompt or not body.prompt.strip():
        raise HTTPException(status_code=400, detail="An image prompt is required.")
    institute_id = getattr(current_user, "institute_id", None)
    if not institute_id:
        raise HTTPException(status_code=400, detail="No institute context on this session.")
    actor_user_id = getattr(current_user, "user_id", None)
    meter_ctx = _page_metering(request, institute_id, current_user, actor_user_id)

    wrapper, default_aspect = _IMAGE_KIND_STYLE.get(body.kind, _IMAGE_KIND_STYLE["image"])
    prompt = wrapper.format(p=body.prompt.strip())
    aspect = body.aspect_ratio if body.aspect_ratio in _IMAGE_ASPECTS else default_aspect
    n = max(1, min(3, body.count))

    results = await asyncio.gather(
        *[_generate_and_upload_image(prompt, aspect, body.kind, db, institute_id, actor_user_id,
                                     **supported_kwargs(_generate_and_upload_image, {"metering": meter_ctx}))
          for _ in range(n)],
        return_exceptions=True,
    )
    urls = [r for r in results if isinstance(r, str) and r]
    if not urls:
        raise HTTPException(status_code=502, detail="Image generation failed — please try again.")
    return GenerateImageResponse(urls=urls, model=_image_model())


# ─── Multi-page site (one brief → several coherent pages) ────────────────────

# Canonical page-type vocabulary — the SINGLE source for the intake validator
# and the whole-site generator.
#
# These two used to diverge: "courses" was valid for a site build but absent from
# the intake validator's allowlist, and "course-landing" was the reverse. Since
# the intake validator silently coerces anything unrecognised to "homepage", a
# request like "a page that has details of programs" was classified "courses",
# rejected, and rebuilt as a LANDING page — hero, feature grids and a live
# enrol grid instead of a dense directory. Keep this list authoritative.
_PAGE_TYPE_LABELS = {
    "homepage": "the main landing page",
    "courses": "a programs/offerings DIRECTORY page — one detailed block per offering",
    "course-landing": "a sales page for ONE offering",
    "about": "an about-us / our-story page",
    "admissions": "an admissions / how-to-enroll page",
    "contact": "a contact page (address, form, map)",
}
_SITE_PAGE_LABELS = _PAGE_TYPE_LABELS


class GenerateSiteRequest(BaseModel):
    brief: str
    page_types: List[str] = Field(default_factory=lambda: ["homepage", "about", "contact"])
    institute_name: Optional[str] = None
    images: List[PageImage] = Field(default_factory=list)
    courses: List[CourseSnapshotItem] = Field(default_factory=list)
    terminology: Optional[Dict[str, str]] = None
    source_url: Optional[str] = None
    auto_images: bool = True
    preferred_model: Optional[str] = None
    # Reference screenshots for the WHOLE site. Analysed once and shared across
    # every page — a per-page vision pass would cost N times as much for an
    # identical answer, and could hand each page a slightly different palette.
    inspiration_image_urls: List[str] = Field(default_factory=list)
    # A website whose LAYOUT the whole site should follow — captured once,
    # shared by every page (see GeneratePageRequest.reference_url).
    reference_url: Optional[str] = None
    design_language: Optional[str] = None
    # The site's EXISTING theme (theme/fonts/motion). When set, every page is
    # composed INTO it and the reference contributes structure only.
    global_settings: Optional[Dict[str, Any]] = None


class SitePageOut(BaseModel):
    page_type: str
    page: Dict[str, Any]


class GenerateSiteResponse(BaseModel):
    pages: List[SitePageOut]
    global_settings: Optional[Dict[str, Any]] = None
    model: str
    warnings: List[str] = Field(default_factory=list)


@router.post("/v1/site", response_model=GenerateSiteResponse)
async def generate_site(
    body: GenerateSiteRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
    request: Request = None,
) -> GenerateSiteResponse:
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    if not body.brief or not body.brief.strip():
        raise HTTPException(status_code=400, detail="A brief describing the site is required.")
    institute_id = getattr(current_user, "institute_id", None)
    if not institute_id:
        raise HTTPException(status_code=400, detail="No institute context on this session.")
    actor_user_id = getattr(current_user, "user_id", None)
    meter_ctx = _page_metering(request, institute_id, current_user, actor_user_id)

    # De-dup, keep order, always lead with homepage, cap at 5 pages.
    seen: set = set()
    page_types: List[str] = []
    for pt in ["homepage", *body.page_types]:
        if pt not in seen and pt in _SITE_PAGE_LABELS:
            seen.add(pt)
            page_types.append(pt)
    page_types = page_types[:5]

    # Pre-flight for the whole run (N × the per-page flat cost).
    estimate = preflight_tool_credits(
        db, tool_key=_TOOL_KEY, tool_params={}, institute_id=institute_id
    )
    per_page = float(estimate.get("estimated_credits") or 0)
    balance = float(estimate.get("current_balance") or 0)
    if per_page * len(page_types) > balance:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits: this {len(page_types)}-page site needs ~{per_page * len(page_types):.0f} "
                f"credits but the balance is {balance:.0f}."
            ),
        )

    catalog = _load_catalog()
    pages: List[SitePageOut] = []
    warnings: List[str] = []
    shared_global: Optional[Dict[str, Any]] = None
    model_used = _DEFAULT_MODEL

    # "Keep my theme" for a whole site: the field was accepted and then never
    # read, so every multi-page build proposed a fresh theme regardless.
    if body.global_settings:
        shared_global = _coerce_global_settings(body.global_settings)

    # One vision pass for the whole site, reused by every page below.
    shared_inspiration: Dict[str, Any] = {}
    if body.inspiration_image_urls or body.reference_url:
        try:
            sources = await _resolve_inspiration_sources(body, warnings)
            if sources:
                shared_inspiration = await _analyze_inspiration(sources, db, institute_id, actor_user_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("[page-builder] site inspiration analysis skipped: %s", e)

    for i, pt in enumerate(page_types):
        sub = GeneratePageRequest(
            brief=f"{body.brief.strip()}\n\nThis is {_SITE_PAGE_LABELS[pt]} of the site.",
            page_type=pt,
            institute_name=body.institute_name,
            images=body.images,
            # Only import the source site + real courses on the homepage — other
            # pages inherit the theme and brief (keeps cost/latency down).
            source_url=body.source_url if i == 0 else None,
            courses=body.courses if pt in ("homepage", "courses") else [],
            terminology=body.terminology,
            auto_images=body.auto_images,
            preferred_model=body.preferred_model,
            design_language=body.design_language,
        )
        try:
            page, gs, w, model_used, _ = await _compose_one_page(
                sub, catalog, db, institute_id, actor_user_id, fixed_global=shared_global,
                inspiration=shared_inspiration,
                **supported_kwargs(_compose_one_page, {"metering": meter_ctx}),
            )
        except HTTPException:
            if pages:
                break  # keep what we have if a later page fails
            raise
        if shared_global is None:
            shared_global = gs
        page["route"] = pt if pt != "homepage" else (page.get("route") or "home")
        pages.append(SitePageOut(page_type=pt, page=page))
        # The Figma guidance can come from the shared reference AND the
        # homepage's source_url — say it once.
        warnings.extend(x for x in w if not (x == FIGMA_LINK_GUIDANCE and x in warnings))

    if not pages:
        raise HTTPException(status_code=502, detail="Site generation produced no pages — please retry.")
    return GenerateSiteResponse(pages=pages, global_settings=shared_global, model=model_used, warnings=warnings)


# ─── Assistive intake (chat-style website interview) ────────────────────────
# The wizard's conversational mode: instead of one brief textarea, the
# assistant interviews the admin turn by turn — asking for facts, proof
# points, tone, and REQUESTING uploads (logo / photos / inspiration
# screenshots) when they would lift the result — then assembles a rich,
# composer-ready brief. Uploaded images ride along as vision attachments so
# the assistant can react to what it was given.

_INTAKE_TOOL_KEY = "page_intake"
_INTAKE_UPLOAD_KINDS = {"logo", "photo", "inspiration"}
_MAX_INTAKE_TURNS = 40


class IntakeTurn(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str = ""
    # Images the admin uploaded WITH this turn (already on our S3).
    image_urls: List[str] = Field(default_factory=list)


class IntakeRequest(BaseModel):
    history: List[IntakeTurn]
    institute_name: Optional[str] = None
    courses: List[CourseSnapshotItem] = Field(default_factory=list)
    terminology: Optional[Dict[str, str]] = None
    preferred_model: Optional[str] = None


class IntakeResponse(BaseModel):
    reply: str
    chips: List[str] = Field(default_factory=list)
    # When set, the FE opens the matching uploader inline: logo|photo|inspiration
    request_upload: Optional[str] = None
    # How the assistant classified images in the admin's LATEST message —
    # the FE routes them into content images vs inspiration accordingly
    # (an unprompted website screenshot must land in inspiration, not on the page).
    received_image_kind: Optional[str] = None
    ready: bool = False
    # Composer-ready brief — final when ready=true, best-effort draft before.
    brief: Optional[str] = None
    page_type: Optional[str] = None
    whole_site: bool = False
    run_id: str
    model: str
    warnings: List[str] = Field(default_factory=list)


def _build_intake_prompt(req: IntakeRequest) -> str:
    parts: List[str] = []
    parts.append(
        "You are the website-creation assistant for Vacademy: you interview an education-institute "
        "admin (often non-technical) and gather everything needed to build them a world-class website. "
        "You do NOT build the page yourself — a separate composer will receive your final brief.\n"
        "STYLE: warm, plain language, ONE question per turn, never a form. Mirror the admin's language "
        "(Hindi in → Hindi out). Keep replies to 1–3 short sentences.\n"
        "WHAT TO LEARN (adapt order, skip what you already know): 1) what the site is for + what makes "
        "this institute different; 2) concrete PROOF (results, years, student counts, toppers, records — "
        "numbers make pages persuasive); 3) tone/style direction and any sites they admire — ask them to "
        "upload SCREENSHOTS of sites they like (request_upload='inspiration'); 4) their LOGO "
        "(request_upload='logo') and real photos of campus/classes/students (request_upload='photo') — "
        "real photos beat stock; 5) whether they want one homepage or a whole site (home+about+contact).\n"
        "UPLOAD REQUESTS: set request_upload to logo|photo|inspiration ONLY when that is what you are "
        "asking for this turn; the admin sees an upload button. If they upload, the images appear as "
        "attachments — react to them specifically (e.g. comment on the logo's colors) and use them to "
        "sharpen the design direction. Never demand uploads; offering to skip is fine. Whenever the "
        "admin's LATEST message includes an image, ALSO set received_image_kind: a screenshot of a "
        "website/app they want to look like = 'inspiration'; their brand mark = 'logo'; a real "
        "campus/class/people photo = 'photo'.\n"
        "PACE: aim to be ready within 5–8 of your turns. The admin can say 'just build it' at any time — "
        "then set ready=true immediately with the best brief you can.\n"
        "WHEN READY (ready=true): write `brief` as a RICH composer brief in the admin's language: "
        "identity + differentiators, every real number/proof point gathered, the section plan, tone, "
        "color/style direction (including anything learned from uploaded logo/inspiration), and which "
        "uploaded photos exist. Be specific — the composer only knows what the brief says. Keep the "
        "brief under 350 words — dense, no filler.\n"
        "ALWAYS return `brief` as your best current draft even before ready (the admin can jump ahead).\n"
        "FIGMA LINKS: nothing here can open a figma.com link (it shows Figma's sign-in page). If the admin "
        f"shares one, say: \"{FIGMA_LINK_GUIDANCE}\" and ask for screenshots of the frames "
        "(request_upload='inspiration'). Never claim to have seen a Figma design."
    )
    if req.institute_name:
        parts.append(f"## INSTITUTE\nName: {req.institute_name}")
    if req.courses:
        parts.append(
            "## REAL COURSES (already known — do not ask for a course list again)\n"
            + json.dumps([c.model_dump(exclude_none=True) for c in req.courses], ensure_ascii=False)
        )
    term_block = _terminology_block(req.terminology, intake=True)
    if term_block:
        parts.append(term_block)
    parts.append(
        "## OUTPUT CONTRACT\nReturn ONLY a JSON object (no markdown fences):\n"
        '{"reply": "<your next message>", "chips": ["<2-4 short tap-to-answer suggestions>"], '
        '"request_upload": "logo"|"photo"|"inspiration"|null, '
        '"received_image_kind": "logo"|"photo"|"inspiration"|null, "ready": true|false, '
        '"brief": "<current composer brief draft>", '
        '"page_type": ' + "|".join(f'"{k}"' for k in _PAGE_TYPE_LABELS) + ', '
        '"whole_site": true|false}\n'
        "PAGE TYPE — pick the one that matches what the admin actually asked for; this decides the "
        "page's whole STRUCTURE, so getting it wrong produces the wrong page:\n"
        + "\n".join(f"  - {k}: {v}" for k, v in _PAGE_TYPE_LABELS.items())
        + "\nIf the admin asks to list/detail what they offer (\"details of my programs\", \"all our "
        "courses\", \"what we teach\"), that is `courses` — NOT `homepage`.\n"
        "If the admin says the page is informational only (\"just data\", \"no enrolment\", \"no "
        "prices\"), say so explicitly in `brief` — the composer omits all commerce when it reads that."
    )
    return "\n\n".join(parts)


def _latest_user_figma_link(history: List[IntakeTurn]) -> Optional[str]:
    """The figma.com link in the admin's LATEST message, if any."""
    for turn in reversed(history):
        if turn.role != "assistant":
            return find_figma_url(turn.content or "")
    return None


_FIGMA_SCREENSHOT_ASK = "Could you upload screenshots of the frames you want the page to follow?"
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _drop_figma_sentences(text: str) -> str:
    """``text`` without any sentence that mentions Figma — a model that ignored
    the FIGMA LINKS rule ("I've looked at your Figma design…", "match the Figma
    file") must not reach the admin or the composer. Line breaks are kept."""
    lines = []
    for line in (text or "").splitlines():
        kept = [s for s in _SENTENCE_SPLIT_RE.split(line) if "figma" not in s.lower()]
        lines.append(" ".join(kept).rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _latest_user_has_images(history: List[IntakeTurn]) -> bool:
    """The admin's LATEST message came with uploaded images (e.g. the frames' screenshots)."""
    for turn in reversed(history):
        if turn.role != "assistant":
            # Only https uploads are sent to the model (see intake_turn's attachments).
            return any(isinstance(u, str) and u.startswith("https://") for u in turn.image_urls or [])
    return False


def _apply_figma_link_guard(reply: str, request_upload: Optional[str],
                            screenshots_attached: bool = False) -> tuple[str, Optional[str]]:
    """The admin just pasted a Figma link: the reply opens with the guidance,
    keeps only the model's sentences that don't talk about Figma (it cannot
    have seen the design), asks for screenshots when nothing else is left, and
    the screenshot uploader opens. When the same message already carries
    screenshots, the model HAS seen the frames: only the guidance is added."""
    if screenshots_attached:
        rest = reply.replace(FIGMA_LINK_GUIDANCE, "").strip()
        return (f"{FIGMA_LINK_GUIDANCE}\n\n{rest}" if rest else FIGMA_LINK_GUIDANCE), request_upload
    rest = _drop_figma_sentences(reply.replace(FIGMA_LINK_GUIDANCE, ""))
    return f"{FIGMA_LINK_GUIDANCE}\n\n{rest or _FIGMA_SCREENSHOT_ASK}", request_upload or "inspiration"


def _parse_intake_json(raw: str) -> Dict[str, Any]:
    """Tolerant parse: strip code fences / leading prose around the JSON."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in intake reply")
    return json.loads(text[start:end + 1])


@router.post("/v1/intake", response_model=IntakeResponse)
async def intake_turn(
    body: IntakeRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
    request: Request = None,
) -> IntakeResponse:
    from ..services.chat_llm_client import ChatLLMClient
    from ..services.api_key_resolver import ApiKeyResolver

    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    institute_id = getattr(current_user, "institute_id", None)
    if not institute_id:
        raise HTTPException(status_code=400, detail="No institute context on this session.")
    actor_user_id = getattr(current_user, "user_id", None)
    meter_ctx = _page_metering(request, institute_id, current_user, actor_user_id)
    if len(body.history) > _MAX_INTAKE_TURNS:
        raise HTTPException(status_code=400, detail="This conversation is too long — please generate or start over.")

    estimate = preflight_tool_credits(db, tool_key=_INTAKE_TOOL_KEY, tool_params={}, institute_id=institute_id)
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits (balance {estimate.get('current_balance')}).",
        )

    # Conversation → chat messages. Uploaded images are fetched by US and
    # inlined as data: URLs (capped: last 4 image-bearing references) — the
    # provider never fetches admin URLs itself.
    messages: List[Dict[str, Any]] = [{"role": "system", "content": _build_intake_prompt(body)}]
    pending_attach: List[tuple] = []  # (msg, urls)
    attach_budget = 4
    for turn in body.history[-16:]:
        role = "assistant" if turn.role == "assistant" else "user"
        msg: Dict[str, Any] = {"role": role, "content": (turn.content or "")[:4000]}
        if role == "user" and turn.image_urls and attach_budget > 0:
            urls = [u for u in turn.image_urls if isinstance(u, str) and u.startswith("https://")][:attach_budget]
            if urls:
                attach_budget -= len(urls)
                pending_attach.append((msg, urls))
        messages.append(msg)
    intake_warnings: List[str] = []
    if pending_attach:
        flat_urls = [u for _, urls in pending_attach for u in urls]
        inlined = await asyncio.gather(*(_inline_image_data_url(u) for u in flat_urls))
        pos = 0
        for msg, urls in pending_attach:
            chunk = inlined[pos:pos + len(urls)]
            pos += len(urls)
            atts = []
            for u, (data_url, err) in zip(urls, chunk):
                if data_url:
                    atts.append({"type": "image", "url": data_url})
                else:
                    # Fall back to the raw URL — the provider may still be able
                    # to fetch it; the no-attachment retry covers it if not.
                    intake_warnings.append(f"image inline failed ({err}) — passed URL through")
                    atts.append({"type": "image", "url": u})
            msg["attachments"] = atts
            msg["content"] = (str(msg["content"]) + f"\n[uploaded {len(atts)} image(s)]").strip()
    if len(messages) == 1:
        messages.append({"role": "user", "content": "Hi — I want to build a website for my institute."})
    figma_link = _latest_user_figma_link(body.history)
    figma_shots = bool(figma_link) and _latest_user_has_images(body.history)
    if figma_link:
        messages[-1]["content"] = (
            str(messages[-1].get("content") or "")
            + "\n\n(The link above is a Figma file. It cannot be opened here — follow the FIGMA LINKS rule."
            + (" The admin attached screenshots with this message: use those.)" if figma_shots else ")")
        )
    # Vision turns pull chat models into prose mode ("Nice logo! …") — restate
    # the contract inside the final user message so every turn stays JSON.
    messages[-1]["content"] = (
        str(messages[-1].get("content") or "")
        + "\n\n(Reply with ONLY the JSON object per the OUTPUT CONTRACT — no text outside it.)"
    )

    primary, fallbacks = resolve_models(
        db, "page_builder", preferred_model=body.preferred_model, hard_fallback=_DEFAULT_MODEL
    )
    client = ChatLLMClient(ApiKeyResolver(db))
    run_id = uuid.uuid4().hex
    data: Optional[Dict[str, Any]] = None
    model_used = primary
    usage: Dict[str, Any] = {}
    last_err: Optional[Exception] = None
    async def _try(msgs: List[Dict[str, Any]]) -> Optional[tuple]:
        nonlocal last_err
        for model in [primary, *fallbacks][:2]:
            try:
                # NOTE: no assistant-prefill here — OpenRouter 400s on a
                # trailing assistant message for these models (live-tested).
                # max_tokens must fit reply+chips+the FULL draft brief the
                # model echoes each turn — 1200 truncated big-brief turns into
                # unparseable JSON (field bug).
                resp = await client.chat_completion(
                    msgs, temperature=0.5, max_tokens=3000,
                    institute_id=institute_id, user_id=actor_user_id, model=model,
                )
                content = resp.get("content") or ""
                try:
                    parsed = _parse_intake_json(content)
                except Exception:
                    # Contract break but a real reply — salvage the prose so
                    # the turn (and anything the model SAW) isn't lost.
                    text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", content.strip()).strip("{} \n")
                    if len(text) < 10:
                        raise
                    intake_warnings.append(f"{model} broke the JSON contract — salvaged prose reply")
                    parsed = {"reply": text[:1500]}
                return parsed, (resp.get("model") or model), (resp.get("usage") or {})
            except Exception as e:  # noqa: BLE001
                last_err = e
                # Surfaced in response warnings — pod logs are hard to reach
                # in the field and this class of failure is content-dependent.
                intake_warnings.append(f"attempt failed on {model}: {str(e)[:220]}")
                logger.warning("[page-intake] turn failed on %s: %s", model, e)
        return None

    out = await _try(messages)
    if out is None and any("attachments" in m for m in messages):
        # A dead/unfetchable image URL makes the provider reject the whole
        # call — degrade to text-only rather than failing the conversation.
        logger.warning("[page-intake] retrying without attachments: %s", last_err)
        stripped = [{k: v for k, v in m.items() if k != "attachments"} for m in messages]
        # Merge the note into the final user turn — a trailing extra user
        # message (consecutive same-role) is rejected by some providers.
        stripped[-1]["content"] = (
            "(note: my uploaded image could not be loaded — please continue without it)\n"
            + str(stripped[-1].get("content") or "")
        )
        out = await _try(stripped)
    if out is None:
        raise HTTPException(status_code=502, detail=f"Assistant turn failed: {last_err}")
    data, model_used, usage = out

    chips = [_clean_string(str(c))[:60] for c in data.get("chips") or [] if str(c).strip()][:4]
    req_upload = data.get("request_upload")
    if req_upload not in _INTAKE_UPLOAD_KINDS:
        req_upload = None
    recv_kind = data.get("received_image_kind")
    if recv_kind not in _INTAKE_UPLOAD_KINDS:
        recv_kind = None
    page_type = data.get("page_type")
    if page_type not in _PAGE_TYPE_LABELS:
        page_type = "homepage"
    reply = _clean_string(str(data.get("reply") or "")).strip()[:2000] or "Tell me about your institute!"
    ready = bool(data.get("ready"))
    brief = _clean_string(str(data.get("brief"))) if data.get("brief") else None
    if figma_link:
        reply, req_upload = _apply_figma_link_guard(reply, req_upload, screenshots_attached=figma_shots)
        if not figma_shots:
            # Nothing has been seen yet: wait for the screenshots, and keep "match
            # the Figma file" out of the brief the composer reads.
            ready = False
            brief = _drop_figma_sentences(brief or "") or None

    try:
        record_tool_billing(
            tool_key=_INTAKE_TOOL_KEY,
            tool_params={},
            request_type=RequestType.CONTENT,
            model=model_used,
            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
            completion_tokens=int((usage or {}).get("completion_tokens") or 0),
            institute_id=institute_id,
            user_id=actor_user_id,
            user_role=None,
            idempotency_key=f"{_INTAKE_TOOL_KEY}:{run_id}",
            usage_markup=_USAGE_MARKUP,
            use_case=UC.PAGE_BUILDER,
            metering=meter_ctx,
            usage_context={"run_id": run_id},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[page-intake] billing skipped: %s", e)

    return IntakeResponse(
        reply=reply,
        chips=chips,
        request_upload=req_upload,
        received_image_kind=recv_kind,
        ready=ready,
        brief=brief,
        page_type=page_type,
        whole_site=bool(data.get("whole_site")),
        run_id=run_id,
        model=model_used,
        warnings=intake_warnings,
    )


# ─── Site chrome (global settings) copilot ─────────────────────────────────────
#
# Global settings — the header, the footer, the theme — sat entirely outside AI
# reach: the copilot only emits component OPS, and these live on
# globalSettings.layout.*, not in any page's component tree. So the one screen
# where hand-entry is most tedious (a footer with four link columns; a nav that
# must mirror every page) had no assistance at all, and the AI panel just said
# "Select a page to start editing with AI".
#
# Deliberately NARROW write surface: header, footer, theme, fonts, motion.
# Tracking IDs, lead-collection wiring and the WhatsApp number are excluded on
# purpose — those are billing identifiers, campaign wiring and real contact
# details. An LLM has no business inventing any of them, and a wrong analytics
# ID fails silently for weeks.
_CHROME_TOOL_KEY = _EDIT_TOOL_KEY  # same cost class as one copilot edit

_CHROME_WRITABLE_KEYS = {"theme", "fonts", "motion"}


class SiteChromeRequest(BaseModel):
    instruction: str
    # Current globalSettings, sent verbatim so the model edits what is on screen.
    global_settings: Dict[str, Any] = Field(default_factory=dict)
    # [{route, title}] so nav/footer links can only point at pages that exist.
    pages: List[Dict[str, Any]] = Field(default_factory=list)
    institute_name: Optional[str] = None
    terminology: Optional[Dict[str, str]] = None
    history: List[ChatTurn] = Field(default_factory=list)
    preferred_model: Optional[str] = None


class SiteChromeResponse(BaseModel):
    global_settings: Dict[str, Any]
    reply: str
    run_id: str
    model: str
    warnings: List[str] = Field(default_factory=list)


def _build_chrome_prompt(req: SiteChromeRequest, catalog: Dict[str, Any]) -> str:
    parts: List[str] = []
    parts.append(
        "You are the site-chrome assistant for Vacademy's website builder. You edit a site's "
        "HEADER, FOOTER and THEME — the parts shared by every page — and return the updated "
        "settings as JSON. You never invent analytics IDs, phone numbers or campaign ids."
    )

    header_schema = next((c for c in catalog["components"] if c.get("type") == "header"), None)
    footer_schema = next((c for c in catalog["components"] if c.get("type") == "footer"), None)
    parts.append(
        "## HEADER / FOOTER SHAPE (exact prop names — anything else is ignored by the renderer)\n"
        + json.dumps({"header": header_schema, "footer": footer_schema}, ensure_ascii=False)
    )
    parts.append(
        "## HEADER RULES\n"
        "- `navigation`: [{label, route, openInSameTab, enabled}] — the main menu. `route` is a page route "
        "from the PAGES list below (use \"\" for home), an #anchor, or an absolute URL. NEVER invent "
        "a route: a menu item pointing at a page that does not exist is a dead link. `enabled: false` "
        "means the admin deliberately hid that link; carry the flag through untouched unless the "
        "instruction is to show or hide it.\n"
        "- `authLinks`: [{label, route}] — the buttons on the RIGHT. Use route 'login' for Login and "
        "'signup' for Sign Up. An enquiry/registration button that opens a campaign form needs an "
        "audienceId the ADMIN must choose, so emit it with route '' and NO audienceId; the admin "
        "picks the campaign in the editor. Do not fabricate an audienceId.\n"
        "- Keep the existing logo and title unless the instruction says to change them."
    )
    parts.append(
        "## FOOTER RULES\n"
        "- `leftSection`: {title, text, socials[]} — the brand blurb.\n"
        "- `rightSection`: {title, links[{label, route}]} — a link column.\n"
        "- `bottomNote`: the copyright line.\n"
        "- Link routes obey the same rule as the header: existing pages, anchors or absolute URLs only.\n"
        "- Never invent an address, phone number or email. If the instruction does not supply one, "
        "leave it out rather than making it up."
    )
    parts.append(
        "## THEME\n" + json.dumps(catalog["globalSettingsSchema"], ensure_ascii=False)
        + "\nAllowed values — anything else is discarded:\n"
        + _theme_value_reference()
        + "\nSend ONLY the theme keys the instruction actually changes; the rest are preserved."
    )
    if req.institute_name:
        parts.append(f"## INSTITUTE\nName: {req.institute_name}")
    term_block = _terminology_block(req.terminology)
    if term_block:
        parts.append(term_block)
    parts.append(
        "## PAGES THAT EXIST (label → route; link only to these)\n"
        + json.dumps(
            [{"title": p.get("title"), "route": p.get("route")} for p in (req.pages or [])],
            ensure_ascii=False,
        )
    )
    parts.append(
        "## CURRENT SETTINGS (edit these; preserve anything the instruction does not mention)\n"
        # The site-language dictionary (globalSettings.i18n) can be large and is not
        # chrome: keep it out of this window so it never crowds out header/footer
        # context. _merge_chrome deep-copies the full settings, so it survives.
        + json.dumps({k: v for k, v in (req.global_settings or {}).items() if k != "i18n"}, ensure_ascii=False)[:12000]
    )
    if req.history:
        parts.append(
            "## CONVERSATION SO FAR\n"
            + "\n".join(f"{t.role}: {t.content}" for t in req.history[-6:])
        )
    parts.append(f"## INSTRUCTION\n{req.instruction.strip()}")
    parts.append(
        "## OUTPUT CONTRACT\nReturn ONLY this JSON object, no markdown:\n"
        '{"globalSettings": {"layout": {"header": {"props": {...}}, "footer": {"props": {...}}}, '
        '"theme": {...}, "fonts": {...}, "motion": {...}}, '
        '"reply": "<one or two sentences on what you changed, in plain language>"}\n'
        "Include ONLY the keys you actually changed. Omit layout entirely if you changed no chrome."
    )
    return "\n\n".join(parts)


def _merge_chrome(current: Dict[str, Any], proposed: Any, warnings: List[str]) -> Dict[str, Any]:
    """Merge the model's proposal onto the live settings through a narrow gate.

    Only header/footer props and theme/fonts/motion may change. Everything else
    on globalSettings — tracking, leadCollection, whatsapp, courseCatalogeType —
    is carried over from `current` untouched, so a hallucinated analytics id or
    an invented phone number can never reach the config.
    """
    merged = json.loads(json.dumps(current or {}))  # deep copy
    if not isinstance(proposed, dict):
        warnings.append("Model returned no usable settings")
        return merged

    # Theme / fonts / motion — reuse the existing clamp so only supported
    # presets, atmospheres and font stacks survive. `merged` is passed as the
    # base because the prompt asks for ONLY the changed keys: without it,
    # "make the theme ocean" also reset atmosphere/headingScale/borderRadius and
    # wiped the brand color, because the clamp defaults every absent key.
    theme_like = {k: v for k, v in proposed.items() if k in _CHROME_WRITABLE_KEYS}
    if theme_like:
        coerced = _coerce_global_settings(theme_like, base=merged, model_proposed=True)
        if coerced:
            for k in _CHROME_WRITABLE_KEYS:
                if k in theme_like and k in coerced:
                    merged[k] = coerced[k]

    layout_in = proposed.get("layout")
    if isinstance(layout_in, dict):
        merged.setdefault("layout", {})
        for section in ("header", "footer"):
            section_in = layout_in.get(section)
            if not isinstance(section_in, dict):
                continue
            props_in = section_in.get("props")
            if not isinstance(props_in, dict):
                continue
            # Strings get the same hostile-content scrub as page props. Images
            # already in the site's chrome stay allowed (a model that echoes the
            # logo back must not blank it); any other URL is stripped.
            cleaned = clean_urls(props_in, _collect_page_image_urls(current.get("layout") if isinstance(current, dict) else None, set()), warnings)
            existing = merged["layout"].get(section)
            if isinstance(existing, dict):
                merged["layout"][section] = {
                    **existing,
                    "props": {**(existing.get("props") or {}), **cleaned},
                }
            else:
                merged["layout"][section] = {"type": section, "enabled": True, "props": cleaned}
    return merged


@router.post("/v1/site-chrome", response_model=SiteChromeResponse)
async def edit_site_chrome(
    body: SiteChromeRequest,
    db: Session = Depends(db_dependency),
    current_user=Depends(get_current_user),
    request: Request = None,
) -> SiteChromeResponse:
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    if not body.instruction or not body.instruction.strip():
        raise HTTPException(status_code=400, detail="Tell me what to change.")

    institute_id = getattr(current_user, "institute_id", None)
    if not institute_id:
        raise HTTPException(status_code=400, detail="No institute context on this session.")
    actor_user_id = getattr(current_user, "user_id", None)
    meter_ctx = _page_metering(request, institute_id, current_user, actor_user_id)

    estimate = preflight_tool_credits(
        db, tool_key=_CHROME_TOOL_KEY, tool_params={}, institute_id=institute_id
    )
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits: this change needs ~{estimate['estimated_credits']} "
                f"credits but the balance is {estimate.get('current_balance')}."
            ),
        )

    catalog = _load_catalog()
    prompt = _build_chrome_prompt(body, catalog)
    run_id = uuid.uuid4().hex
    primary, fallbacks = resolve_models(
        db, "page_builder", preferred_model=body.preferred_model, hard_fallback=_DEFAULT_MODEL
    )
    try:
        raw_json, model_used, usage = await generate_json(
            prompt, [primary, *fallbacks], label="site-chrome"
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[site-chrome] failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Could not apply that change: {e}")

    warnings: List[str] = []
    try:
        data = json.loads(raw_json)
    except Exception:
        data = {}
        warnings.append("Model output was not valid JSON")
    merged = _merge_chrome(body.global_settings, data.get("globalSettings"), warnings)
    reply = _clean_string(str(data.get("reply") or "Updated your site settings."))[:600]

    try:
        record_tool_billing(
            tool_key=_CHROME_TOOL_KEY,
            tool_params={},
            request_type=RequestType.CONTENT,
            model=model_used,
            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
            completion_tokens=int((usage or {}).get("completion_tokens") or 0),
            institute_id=institute_id,
            user_id=actor_user_id,
            user_role=None,
            idempotency_key=f"{_CHROME_TOOL_KEY}:{run_id}",
            usage_markup=_USAGE_MARKUP,
            use_case=UC.PAGE_BUILDER,
            metering=meter_ctx,
            usage_context={"run_id": run_id},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[site-chrome] billing skipped: %s", e)

    return SiteChromeResponse(
        global_settings=merged,
        reply=reply,
        run_id=run_id,
        model=model_used,
        warnings=warnings,
    )


# ─── Site languages: translate site texts ─────────────────────────────────────
#
# A site's other languages are dictionaries keyed by the EXACT base-language
# text (globalSettings.i18n.strings[locale]); the builder's Translations panel
# sends the missing texts here in batches and merges what comes back. The work
# (translation memory, masking, chunked parallel calls, safety checks) lives in
# translation_service.translate_website_strings; this route authenticates,
# pre-flights credits and charges ONCE per request on the summed usage.
#
# Auth is the pinned principal (membership of the clientId institute is
# checked), stricter than get_current_user, which trusts clientId verbatim —
# and, because it spends the institute's credits, only for the people who can
# edit the website: the builder's own write gate is ADMIN or OWNER
# (use-catalogue-permissions.ts). Platform root users pass.
from ..core.security import get_pinned_principal  # noqa: E402
from ..schemas.auth import PinnedPrincipal  # noqa: E402

_TRANSLATE_TOOL_KEY = "page_translate"


def _can_translate_site(principal: Any) -> bool:
    if getattr(principal, "is_root_user", False):
        return True
    roles = {
        str(r).strip().upper().replace("-", "_").replace(" ", "_")
        for r in (getattr(principal, "roles", None) or [])
        if r
    }
    return "OWNER" in roles or any("ADMIN" in r for r in roles)


class SiteTranslateRequest(BaseModel):
    # Exact source texts — they come back as the keys of `translations`.
    strings: List[str] = Field(default_factory=list)
    target_locale: str
    source_locale: str = "en"
    # "Translate again with AI": ignore the translation memory.
    skip_memory: bool = False
    preferred_model: Optional[str] = None


class SiteTranslateFailure(BaseModel):
    source: str
    reason: str


class SiteTranslateResponse(BaseModel):
    translations: Dict[str, str]
    failed: List[SiteTranslateFailure] = Field(default_factory=list)
    tm_hits: int = 0
    run_id: str
    model: str
    warnings: List[str] = Field(default_factory=list)


@router.post("/v1/translate", response_model=SiteTranslateResponse)
async def translate_site_strings(
    body: SiteTranslateRequest,
    db: Session = Depends(db_dependency),
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    request: Request = None,
) -> SiteTranslateResponse:
    # Imported here so loading the page builder stays light (the service pulls
    # in the translation-job models).
    from ..services import translation_service as ts

    institute_id = getattr(principal, "institute_id", None)
    if not institute_id:
        raise HTTPException(status_code=400, detail="No institute context on this session.")
    if not _can_translate_site(principal):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only institute admins can translate the website.",
        )
    actor_user_id = getattr(principal, "user_id", None)
    meter_ctx = _page_metering(request, institute_id, principal, actor_user_id)

    source = (body.source_locale or "en").strip().lower()
    target = (body.target_locale or "").strip().lower()
    if source not in ts.LOCALE_NAMES or target not in ts.LOCALE_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language. Supported: {', '.join(sorted(ts.LOCALE_NAMES))}.",
        )
    if source == target:
        raise HTTPException(status_code=400, detail="The target language is the site's base language.")

    # Exact texts, each once, in the order sent. Blank texts need no translation.
    seen: set = set()
    texts: List[str] = []
    for value in body.strings or []:
        if not isinstance(value, str) or not value.strip() or value in seen:
            continue
        seen.add(value)
        texts.append(value)
    run_id = uuid.uuid4().hex
    if not texts:
        return SiteTranslateResponse(translations={}, run_id=run_id, model="", warnings=["Nothing to translate."])
    if len(texts) > ts.WEBSITE_MAX_STRINGS:
        raise HTTPException(
            status_code=400, detail=f"Send at most {ts.WEBSITE_MAX_STRINGS} texts per request."
        )
    too_long = [s for s in texts if len(s) > ts.WEBSITE_MAX_STRING_CHARS]
    texts = [s for s in texts if len(s) <= ts.WEBSITE_MAX_STRING_CHARS]
    total_chars = sum(len(s) for s in texts)
    if total_chars > ts.WEBSITE_MAX_TOTAL_CHARS:
        raise HTTPException(
            status_code=400, detail="Too much text for one request — send the texts in smaller batches."
        )

    warnings: List[str] = []
    failures: List[Dict[str, str]] = [
        {"source": s, "reason": "too long to translate automatically — translate it by hand"} for s in too_long
    ]
    if not texts:
        return SiteTranslateResponse(
            translations={}, failed=failures, run_id=run_id, model="", warnings=warnings
        )

    # Translation memory first: remembered texts are free, so credits are
    # pre-flighted only on what goes to the model (none → no credit check).
    memory: Dict[str, str] = (
        {}
        if body.skip_memory
        else await ts.lookup_website_memory(
            strings=texts, source_locale=source, target_locale=target, institute_id=institute_id
        )
    )
    model_chars = sum(len(s) for s in texts if s not in memory)
    if model_chars:
        estimate = preflight_tool_credits(
            db,
            tool_key=_TRANSLATE_TOOL_KEY,
            tool_params={"transcript_chars": model_chars},
            institute_id=institute_id,
        )
        if estimate.get("sufficient") is False:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"Insufficient credits: translating these texts needs ~{estimate['estimated_credits']} "
                    f"credits but the balance is {estimate.get('current_balance')}."
                ),
            )

    try:
        result = await ts.translate_website_strings(
            strings=texts,
            source_locale=source,
            target_locale=target,
            institute_id=institute_id,
            memory=memory,
            preferred_model=body.preferred_model,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[translate] failed: %s", e)
        raise HTTPException(status_code=502, detail="Could not translate right now. You were not charged.")

    if result["llm_calls"] and not result["completed_calls"] and not result["translations"]:
        raise HTTPException(
            status_code=502, detail="The AI could not translate right now. You were not charged."
        )

    if result["completed_calls"]:
        usage = result.get("usage") or {}
        try:
            record_tool_billing(
                tool_key=_TRANSLATE_TOOL_KEY,
                tool_params={"transcript_chars": int(result.get("llm_chars") or 0)},
                request_type=RequestType.TRANSLATION,
                model=result.get("model_used") or "",
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
                institute_id=institute_id,
                user_id=actor_user_id,
                user_role=None,
                idempotency_key=f"{_TRANSLATE_TOOL_KEY}:{run_id}",
                usage_markup=_USAGE_MARKUP,
                use_case=UC.TRANSLATION,
                metering=meter_ctx,
                usage_context={"run_id": run_id, "feature": "site_translate"},
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[translate] billing skipped: %s", e)

    failures.extend(result.get("failed") or [])
    if failures:
        warnings.append(
            f"{len(failures)} text(s) could not be translated safely and were left untranslated."
        )
    return SiteTranslateResponse(
        translations=result.get("translations") or {},
        failed=[SiteTranslateFailure(**f) for f in failures],
        tm_hits=int(result.get("tm_hits") or 0),
        run_id=run_id,
        model=result.get("model_used") or ("translation-memory" if result.get("tm_hits") else ""),
        warnings=warnings,
    )
