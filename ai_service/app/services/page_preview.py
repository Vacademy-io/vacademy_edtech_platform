"""
Screenshot a DRAFT page as the learner site renders it.

The learner app has a preview mode for the editor's live panel:
``<learner host>/<tag>?preview=true`` announces ``PREVIEW_READY`` and then
accepts the full catalogue config over ``postMessage`` (``CATALOGUE_CONFIG_UPDATE``)
instead of fetching it. That is exactly what a headless browser needs: load the
page, post the draft, wait for it to paint, screenshot. No new frontend route,
and the render is the real one — same components, same style engine.

Shared with the reference-site capture in ``routers/page_builder.py`` in spirit
(Playwright, blocked third-party hosts, bounded timeouts); kept separate because
this one injects our own data and never follows the page's links.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

logger = logging.getLogger(__name__)

VIEWPORTS = {"desktop": {"width": 1280, "height": 800}, "mobile": {"width": 390, "height": 844}}
_NAV_TIMEOUT_MS = 25_000
_TOTAL_TIMEOUT_S = 60
_SETTLE_MS = 1_800
_MAX_FULL_HEIGHT = 6_000
_JPEG_QUALITY = 72
_PREVIEW_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 VacademyPreview"

# ── fidelity mode (any of width / lang / sections / click_text / max_height) ──
# For matching a page against a design: any width a design frame has (Figma
# desktop frames are 1440), the site in another language, the box of every
# top-level section, a menu opened first, and pages up to 16000px returned as
# tiles. A call without those options takes the original path above, unchanged.
FIDELITY_DEFAULT_WIDTH = 1440
MIN_WIDTH, MAX_WIDTH = 320, 1920
MAX_TILED_HEIGHT = 16_000
TILE_HEIGHT = 1_800
_FIDELITY_TIMEOUT_S = 90
_FULL_JPEG_QUALITY = 85
_SECTION_TEXT_CAP = 4_000
_CLICK_TEXT_MAX = 80
LANG_RE = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$")
_HOME_ROUTES = ("", "/", "home", "homepage")

#: Chromium is ~400 MB a page here; at most two renders at once per process.
BROWSER_SLOTS = asyncio.Semaphore(2)
#: How long a preview waits for a free slot before answering ``preview_busy``
#: (the wait is outside the render timeout, so a queued call never "times out").
_SLOT_WAIT_S = 45


async def render_preview(*, base_url: str, tag_name: str, page_route: str, config: Dict[str, Any],
                         section_id: Optional[str] = None, viewport: str = "desktop",
                         width: Optional[int] = None, lang: Optional[str] = None, sections: bool = False,
                         section_text: bool = False, click_text: Optional[str] = None,
                         max_height: Optional[int] = None, full_image: bool = False) -> Dict[str, Any]:
    """``{png_base64, width, height}`` (JPEG bytes despite the name, for size) or ``{error, message}``.

    With any fidelity option (``width``, ``lang``, ``sections``, ``click_text``,
    ``max_height``, ``full_image``) the page is rendered by ``_render_fidelity``
    and the result also carries ``tiles`` (top to bottom), ``page_height``,
    ``truncated``, ``sections`` ([{id, top, height, text?}] when asked) and,
    with ``full_image``, the whole capture as ``full_jpeg`` bytes.
    """
    fidelity = (width is not None or bool(lang) or sections or section_text or bool(click_text)
                or max_height is not None or full_image)
    if fidelity:
        try:
            opts = _fidelity_options(width, lang, click_text, max_height)
        except ValueError as exc:
            return {"error": "bad_request", "message": str(exc)}
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return {"error": "preview_unavailable", "message": "Screenshots need Playwright on the server."}
    slots = BROWSER_SLOTS
    try:
        await asyncio.wait_for(slots.acquire(), _SLOT_WAIT_S)
    except asyncio.TimeoutError:
        return {"error": "preview_busy",
                "message": "Other previews are rendering right now; try again in a minute."}
    try:
        if fidelity:
            try:
                return await asyncio.wait_for(
                    _render_fidelity(async_playwright, base_url, tag_name, page_route, config, section_id,
                                     sections=sections or section_text, section_text=section_text,
                                     full_image=full_image, **opts),
                    _FIDELITY_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                return {"error": "preview_timeout", "message": f"The page did not render within {_FIDELITY_TIMEOUT_S}s."}
            except Exception as exc:  # noqa: BLE001
                logger.warning("fidelity preview failed for %s/%s at %s: %r", tag_name, page_route, base_url, exc)
                reason = (str(exc).strip().splitlines() or [type(exc).__name__])[0][:300]
                return {"error": "preview_failed", "message": f"The page could not be rendered: {reason}"}
        try:
            return await asyncio.wait_for(
                _render(async_playwright, base_url, tag_name, page_route, config, section_id, viewport),
                _TOTAL_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            return {"error": "preview_timeout", "message": "The page did not render within 60s."}
        except Exception as exc:  # noqa: BLE001
            logger.warning("preview render failed for %s/%s at %s: %r", tag_name, page_route, base_url, exc)
            # First line only: Playwright appends a multi-line call log.
            reason = (str(exc).strip().splitlines() or [type(exc).__name__])[0][:300]
            return {"error": "preview_failed", "message": f"The page could not be rendered: {reason}"}
    finally:
        slots.release()


def _preview_url(base_url: str, tag_name: str) -> str:
    # Institute domains are stored as bare hosts ("learn.example.com"); a
    # scheme-less URL is not navigable, so every such preview failed.
    base = (base_url or "").strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        base = f"https://{base}"
    return f"{base}/{quote(tag_name, safe='')}?preview=true"


def _as_root_page(config: Dict[str, Any], page_route: str) -> Dict[str, Any]:
    wanted = str(page_route or "").strip("/").lower()
    pages = [p for p in config.get("pages") or [] if isinstance(p, dict)]
    target = next((p for p in pages if str(p.get("route") or "").strip("/").lower() == wanted), pages[0] if pages else None)
    if target is None:
        return config
    root = {**target, "id": "home", "route": "homepage"}
    others = [{**p, "id": p.get("id") if p.get("id") != "home" else f"{p.get('id')}-x",
               "route": p.get("route") if str(p.get("route") or "") != "homepage" else "homepage-x"}
              for p in pages if p is not target]
    return {**config, "pages": [root, *others]}


async def _render(async_playwright: Any, base_url: str, tag_name: str, page_route: str, config: Dict[str, Any],
                  section_id: Optional[str], viewport: str) -> Dict[str, Any]:
    vp = VIEWPORTS.get(viewport) or VIEWPORTS["desktop"]
    # Only the root catalogue page listens for preview config, and it renders
    # the page whose route is "homepage" (or id "home"). We post the config, so
    # we simply present the wanted page AS that root page — any page previews
    # through the one route that supports it, and section ids are untouched.
    payload = json.dumps({"type": "CATALOGUE_CONFIG_UPDATE", "payload": _as_root_page(config, page_route)})
    url = _preview_url(base_url, tag_name)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
        try:
            context = await browser.new_context(viewport=vp, user_agent=_PREVIEW_UA, locale="en-US",
                                                device_scale_factor=1, is_mobile=viewport == "mobile")
            page = await context.new_page()
            # The preview handler is registered on mount and posts PREVIEW_READY to
            # its parent; standalone, parent === window, so we just post the config
            # ourselves once the app is up — and again after a beat, in case the
            # first arrived before the page component mounted.
            await page.goto(url, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT_MS)
            for delay in (800, 1500):
                await page.wait_for_timeout(delay)
                await page.evaluate("msg => window.postMessage(JSON.parse(msg), '*')", payload)
            await page.wait_for_timeout(_SETTLE_MS)
            try:
                await page.evaluate("document.fonts && document.fonts.ready")
            except Exception:  # noqa: BLE001
                pass

            if section_id:
                el = await page.query_selector(f'[data-cid="{section_id}"], [data-component-id="{section_id}"]')
                if el is None:
                    return {"error": "section_not_rendered", "message": "That section is not on the rendered page."}
                await el.scroll_into_view_if_needed()
                await page.wait_for_timeout(400)
                data = await el.screenshot(type="jpeg", quality=_JPEG_QUALITY)
                box = await el.bounding_box() or {}
                return {"png_base64": base64.b64encode(data).decode(), "width": int(box.get("width") or vp["width"]),
                        "height": int(box.get("height") or 0)}

            # Size the viewport to the page (capped) and shoot it top-down; a
            # full_page capture with a clip can come back scrolled.
            height = int(await page.evaluate("Math.min(document.documentElement.scrollHeight, %d)" % _MAX_FULL_HEIGHT))
            height = max(height, vp["height"])
            await page.set_viewport_size({"width": vp["width"], "height": height})
            await page.evaluate("window.scrollTo(0, 0)")
            await page.wait_for_timeout(600)
            data = await page.screenshot(type="jpeg", quality=_JPEG_QUALITY, full_page=False)
            return {"png_base64": base64.b64encode(data).decode(), "width": vp["width"], "height": height}
        finally:
            await browser.close()


def _fidelity_options(width: Optional[int], lang: Optional[str], click_text: Optional[str],
                      max_height: Optional[int]) -> Dict[str, Any]:
    """Validated fidelity options; ValueError names the bad one."""
    try:
        w = FIDELITY_DEFAULT_WIDTH if width is None else int(width)
    except (TypeError, ValueError):
        raise ValueError("width must be a number of pixels.") from None
    if not MIN_WIDTH <= w <= MAX_WIDTH:
        raise ValueError(f"width must be between {MIN_WIDTH} and {MAX_WIDTH}.")
    code = str(lang or "").strip()
    if code and not LANG_RE.match(code):
        raise ValueError("lang must be a language code such as 'hi' or 'en'.")
    text = " ".join(str(click_text or "").split())
    if len(text) > _CLICK_TEXT_MAX:
        raise ValueError(f"click_text is at most {_CLICK_TEXT_MAX} characters.")
    try:
        cap = MAX_TILED_HEIGHT if max_height is None else int(max_height)
    except (TypeError, ValueError):
        raise ValueError("max_height must be a number of pixels.") from None
    cap = max(400, min(cap, MAX_TILED_HEIGHT))
    return {"width": w, "lang": code or None, "click_text": text or None, "max_height": cap}


def preview_path_of(page_route: str) -> str:
    """The shown page's real route ("" = home), sent as ``previewPath`` like the editor's
    LiveSiteFrame.previewPathOf: the page still renders as the root page, but the
    header marks the right nav item and blocks that ask "am I on the home page?"
    (CatalogHero's breadcrumb / title band) answer for the real route."""
    route = str(page_route or "").strip("/")
    return "" if route.lower() in _HOME_ROUTES else route


def fidelity_message(config: Dict[str, Any], page_route: str, lang: Optional[str]) -> Dict[str, Any]:
    """The CATALOGUE_CONFIG_UPDATE the editor would send for this page (LiveSiteFrame.framePayload):
    the page as root, its real route, and languages switched on when one is asked for (the site
    honours ?lang= only when they are; an admin may preview a translation before going live)."""
    root = _as_root_page(config, page_route)
    gs = root.get("globalSettings")
    i18n = gs.get("i18n") if isinstance(gs, dict) else None
    if lang and isinstance(i18n, dict) and not i18n.get("enabled"):
        root = {**root, "globalSettings": {**gs, "i18n": {**i18n, "enabled": True}}}
    return {"type": "CATALOGUE_CONFIG_UPDATE", "payload": root, "previewPath": preview_path_of(page_route)}


def _fidelity_url(base_url: str, tag_name: str, lang: Optional[str]) -> str:
    url = _preview_url(base_url, tag_name)
    return f"{url}&lang={quote(lang, safe='-')}" if lang else url


# A section's box in page pixels. A wrapper of height 0 (the site header's,
# whose bar is position:fixed inside it) is measured by what it contains.
_RECT_OF_JS = """const rectOf = (el, depth) => { const r = el.getBoundingClientRect();
    if (r.height > 0) return { top: r.top, bottom: r.bottom };
    if (depth >= 4) return null;
    let top = Infinity, bottom = -Infinity;
    for (const child of Array.from(el.children)) { const c = rectOf(child, depth + 1);
      if (c) { top = Math.min(top, c.top); bottom = Math.max(bottom, c.bottom); } }
    return bottom > top ? { top, bottom } : null; };"""

# Top-level sections only: a block nested in another block's slot is part of it.
_SECTIONS_JS = """(withText) => { %s
  return Array.from(document.querySelectorAll('[data-cid]'))
  .filter(el => !(el.parentElement && el.parentElement.closest('[data-cid]')))
  .map(el => { const r = rectOf(el, 0); if (!r) return null;
    return { id: el.getAttribute('data-cid'), top: Math.round(r.top + window.scrollY), height: Math.round(r.bottom - r.top),
             text: withText ? (el.innerText || '').slice(0, %d) : undefined }; })
  .filter(s => s && s.height > 0); }""" % (_RECT_OF_JS, _SECTION_TEXT_CAP)

_BOX_JS = """(id) => { %s const el = Array.from(document.querySelectorAll('[data-cid], [data-component-id]'))
  .find(e => e.getAttribute('data-cid') === id || e.getAttribute('data-component-id') === id);
  if (!el) return null; const r = rectOf(el, 0); if (!r) return null;
  return { top: Math.round(r.top + window.scrollY), height: Math.round(r.bottom - r.top) }; }""" % _RECT_OF_JS

# What a click changed: open menus / panels and the size of the visible page.
_DOM_STATE_JS = """() => [document.querySelectorAll('[aria-expanded="true"], [data-state="open"], details[open], [role="menu"], [role="dialog"]').length,
  document.getElementsByTagName('*').length, document.body ? (document.body.innerText || '').length : 0]"""

# Unframed there is no editor to hold a navigation, so a click on a nav item
# could take the page off the posted draft: cancel anything but a #hash jump.
_NAV_GUARD_JS = """() => { if (!window.navigation || window.__vacademyPreviewGuard) return;
  window.__vacademyPreviewGuard = true;
  window.navigation.addEventListener('navigate', (e) => { try {
    const to = new URL(e.destination.url);
    if (e.cancelable && (to.pathname !== location.pathname || to.search !== location.search)) e.preventDefault();
  } catch (_) {} }); }"""


async def _click_text(page: Any, text: str) -> bool:
    """Click the first visible element whose text is ``text`` (exact first, then contained)."""
    for exact in (True, False):
        loc = page.get_by_text(text, exact=exact)
        count = min(await loc.count(), 12)
        for i in range(count):
            target = loc.nth(i)
            try:
                if await target.is_visible():
                    await target.click(timeout=4_000)
                    return True
            except Exception:  # noqa: BLE001
                continue
    return False


def _tiles(image: Any, cv2: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for top in range(0, image.shape[0], TILE_HEIGHT):
        part = image[top: top + TILE_HEIGHT]
        ok, buf = cv2.imencode(".jpg", part, [int(cv2.IMWRITE_JPEG_QUALITY), _JPEG_QUALITY])
        if ok:
            out.append({"png_base64": base64.b64encode(buf.tobytes()).decode(), "top": top,
                        "height": int(part.shape[0])})
    return out


async def _render_fidelity(async_playwright: Any, base_url: str, tag_name: str, page_route: str,
                           config: Dict[str, Any], section_id: Optional[str], *, width: int, lang: Optional[str],
                           click_text: Optional[str], max_height: int, sections: bool, section_text: bool,
                           full_image: bool) -> Dict[str, Any]:
    import cv2
    import numpy as np

    payload = json.dumps(fidelity_message(config, page_route, lang))
    url = _fidelity_url(base_url, tag_name, lang)
    mobile = width <= 480
    vp = {"width": width, "height": 844 if mobile else 900}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
        try:
            context = await browser.new_context(viewport=vp, user_agent=_PREVIEW_UA, locale="en-US",
                                                device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
            page = await context.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT_MS)
            for delay in (800, 1500):
                await page.wait_for_timeout(delay)
                await page.evaluate("msg => window.postMessage(JSON.parse(msg), '*')", payload)
            await page.wait_for_timeout(_SETTLE_MS)
            try:
                await page.evaluate("document.fonts && document.fonts.ready")
            except Exception:  # noqa: BLE001
                pass

            # Walk down the page once so lazy images load and entrance
            # animations finish, then shoot from the top.
            total = int(await page.evaluate("document.documentElement.scrollHeight"))
            for y in range(0, min(total, max_height), vp["height"]):
                await page.evaluate("y => window.scrollTo(0, y)", y)
                await page.wait_for_timeout(120)
            await page.evaluate("window.scrollTo(0, 0)")
            await page.wait_for_timeout(500)

            clicked: Optional[bool] = None
            click_changed: Optional[bool] = None
            if click_text:
                # Browse mode: the site's own menus and tabs respond to clicks.
                await page.evaluate("() => window.postMessage({type: 'PREVIEW_INTERACT', on: true}, '*')")
                await page.evaluate(_NAV_GUARD_JS)
                await page.wait_for_timeout(300)
                start_url = page.url
                before = await page.evaluate(_DOM_STATE_JS)
                clicked = await _click_text(page, click_text)
                await page.wait_for_timeout(1_500)
                if page.url.split("#")[0] != start_url.split("#")[0]:
                    return {"error": "click_navigated",
                            "message": f"Clicking \"{click_text}\" left the page; preview that page instead."}
                # "Clicked" only says something was clicked; this says whether anything opened.
                click_changed = bool(clicked) and (await page.evaluate(_DOM_STATE_JS)) != before

            boxes = await page.evaluate(_SECTIONS_JS, section_text) if sections else None
            box = await page.evaluate(_BOX_JS, section_id) if section_id else None
            if section_id and not box:
                return {"error": "section_not_rendered", "message": "That section is not on the rendered page."}

            page_height = int(await page.evaluate(
                "Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)"))
            if box:
                # Shoot the section's own box, wherever it is on the page.
                top = max(0, int(box["top"]))
                height = min(int(box["height"]), page_height - top, max_height)
                if height <= 0:
                    return {"error": "section_not_rendered",
                            "message": "That section has no visible height on the rendered page."}
                shot_height = height
                clip = {"x": 0, "y": top, "width": width, "height": height}
            else:
                shot_height = max(1, min(page_height, max_height))
                clip = {"x": 0, "y": 0, "width": width, "height": shot_height}
            data = await page.screenshot(type="jpeg", quality=_FULL_JPEG_QUALITY, full_page=True, clip=clip)
        finally:
            await browser.close()

    truncated = (int(box["height"]) > shot_height) if box else page_height > shot_height
    if full_image:
        # compare decodes the capture itself, in its worker thread: no decode or tiles here.
        out: Dict[str, Any] = {"png_base64": "", "tiles": [], "width": int(clip["width"]),
                               "height": int(clip["height"]), "page_height": page_height, "truncated": truncated,
                               "full_jpeg": data}
        if boxes is not None:
            out["sections"] = boxes
        if clicked is not None:
            out["clicked"] = clicked
            out["click_changed"] = bool(click_changed)
        return out

    def _decode_and_tile() -> Optional[Tuple[List[Dict[str, Any]], int, int]]:
        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return None
        return _tiles(image, cv2), int(image.shape[1]), int(image.shape[0])

    # Off the event loop: a 1920x16000 decode + JPEG tiles would stall every other request.
    decoded = await asyncio.to_thread(_decode_and_tile)
    if decoded is None:
        return {"error": "preview_failed", "message": "The screenshot could not be read."}
    tiles, img_w, img_h = decoded
    out = {
        "png_base64": tiles[0]["png_base64"] if tiles else "",
        "tiles": tiles,
        "width": img_w,
        "height": img_h,
        "page_height": page_height,
        "truncated": truncated,
    }
    if boxes is not None:
        out["sections"] = boxes
    if clicked is not None:
        out["clicked"] = clicked
        out["click_changed"] = bool(click_changed)
    return out


__all__ = [
    "render_preview", "VIEWPORTS", "_as_root_page", "_preview_url", "fidelity_message", "preview_path_of",
    "BROWSER_SLOTS", "FIDELITY_DEFAULT_WIDTH", "MIN_WIDTH", "MAX_WIDTH", "MAX_TILED_HEIGHT", "LANG_RE",
]
