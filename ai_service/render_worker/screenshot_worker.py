"""Single-shot screenshot worker for the vision-review path.

Loads the same harness as generate_video.py (via render_harness.py) and uses
Playwright to capture PNGs of one shot's HTML at N timestamps. The harness is
shared so what the vision reviewer sees equals what the production MP4 will
look like.

Used by main.py's POST /screenshot endpoint.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import sys
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger("render-worker.screenshot")

# render_harness.py lives next to generate_video.py in ai-video-gen-main/. The
# build script (build.sh) copies that directory into the worker's image.
_HARNESS_DIR = Path(__file__).parent / "ai-video-gen-main"
if str(_HARNESS_DIR) not in sys.path:
    sys.path.insert(0, str(_HARNESS_DIR))


class ScreenshotWorker:
    """Reusable Playwright browser for the vision-review screenshot path.

    Launches one Chromium instance lazily and reuses it across calls — Playwright
    cold-start is ~1s, so amortising it across reviews keeps p95 latency low.
    Each call gets a fresh context+page so harness state doesn't bleed between
    shots.
    """

    def __init__(self):
        self._playwright = None
        self._browser = None
        self._lock = asyncio.Lock()

    async def _ensure_browser(self):
        if self._browser is not None:
            return
        async with self._lock:
            if self._browser is not None:
                return
            from playwright.async_api import async_playwright
            self._playwright = await async_playwright().start()
            # Use Google Chrome (channel="chrome") not Playwright's bundled
            # Chromium — the Docker image only installs Chrome (for H.264/AAC
            # proprietary codecs that bundled Chromium lacks). Without this,
            # launch fails with "Executable doesn't exist at .../headless_shell".
            self._browser = await self._playwright.chromium.launch(
                channel="chrome",
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            logger.info("ScreenshotWorker: Chrome launched (channel=chrome)")

    async def close(self):
        if self._browser is not None:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._playwright is not None:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

    async def screenshot_shot(
        self,
        *,
        html: str,
        width: int,
        height: int,
        timestamps: List[float],
        background: str = "#0a0e27",
    ) -> List[Dict[str, object]]:
        """Render `html` in the harness, screenshot at each timestamp, return base64 PNGs.

        Returns: [{"t": float, "image_b64": str}] — one entry per requested timestamp,
        in the order requested.
        """
        if not html or not html.strip():
            raise ValueError("html is required")
        if width <= 0 or height <= 0:
            raise ValueError("width and height must be positive")
        if not timestamps:
            raise ValueError("at least one timestamp required")

        from render_harness import build_harness_html  # imported lazily after sys.path setup

        await self._ensure_browser()

        harness_html = build_harness_html(background)
        context = await self._browser.new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=1,
        )
        page = await context.new_page()
        results: List[Dict[str, object]] = []
        try:
            # Load the harness as a data URL so there is no temp file. The harness
            # itself loads libraries from CDNs; domcontentloaded fires before those
            # finish, but we wait for the GSAP global to appear separately below.
            await page.set_content(harness_html, wait_until="domcontentloaded")

            # Wait until the harness libraries have loaded. GSAP is the most
            # important — without it, gsap.globalTimeline.totalTime() can't seek.
            try:
                await page.wait_for_function(
                    "() => typeof window.gsap === 'object' && window.gsap !== null",
                    timeout=10_000,
                )
            except Exception:
                logger.warning("ScreenshotWorker: gsap not present after 10s — proceeding anyway")

            # Install the shadow-DOM dispatcher (window.__updateSnippets etc.).
            # This is the SAME JS the production renderer installs in
            # generate_video.py:_prepare_page — without it, __updateSnippets
            # is undefined and our shot HTML never gets injected (tests caught
            # this: every screenshot returned a blank harness, no defects flagged).
            from dispatcher_install_js import get_dispatcher_install_js
            await page.evaluate(get_dispatcher_install_js(libs=""))

            # Sanity check the install — without it, the shot HTML silently
            # fails to render and the reviewer would pass-through blanks.
            try:
                await page.wait_for_function(
                    "() => typeof window.__updateSnippets === 'function'",
                    timeout=5_000,
                )
            except Exception as exc:
                logger.error(f"ScreenshotWorker: __updateSnippets failed to install — {exc}")
                raise

            # Inject the shot using the same dispatcher the renderer uses. inTime=0
            # means tween delays inside the shot HTML compose against globalTimeline=0,
            # which is exactly what we want for screenshot timestamps that are
            # shot-relative seconds.
            # x/y/w/h are not optional. __updateSnippets sizes the shot's host
            # from them (`e.w | 0`), so an entry without them gets a 0x0 host
            # and a shot laid out as 100% of its container collapses: every
            # frame came back as the bare background colour. The vision
            # reviewer and creativity critic were judging blank frames — on a
            # 2026-10-01 run all 21 review screenshots were one identical
            # single-colour PNG. The preview-MP4 path below already passed them.
            await page.evaluate(
                "async (entries) => { await window.__updateSnippets(entries); }",
                [{"id": "screenshot-shot", "html": html, "inTime": 0,
                  "x": 0, "y": 0, "w": int(width), "h": int(height)}],
            )

            # Wait for shadow-DOM stylesheets and document fonts — same sequence
            # the renderer runs after a segment change. Without these waits we
            # capture frames with fallback fonts, which makes the reviewer flag
            # legibility issues that won't appear in the final MP4.
            try:
                await page.evaluate(
                    """async () => {
                        const links = [];
                        document.querySelectorAll('[id^="snippet-"],[id^="segment-"],[id^="shot-"],[id="screenshot-shot"]').forEach(host => {
                            const root = host.shadowRoot;
                            if (!root) return;
                            root.querySelectorAll('link[rel="stylesheet"]').forEach(l => links.push(l));
                        });
                        document.head.querySelectorAll('link[rel="stylesheet"]').forEach(l => links.push(l));
                        const waits = links.map(l => {
                            try { if (l.sheet) return Promise.resolve(); } catch (e) {}
                            return new Promise(resolve => {
                                let done = false;
                                const finish = () => { if (!done) { done = true; resolve(); } };
                                l.addEventListener('load', finish, { once: true });
                                l.addEventListener('error', finish, { once: true });
                                setTimeout(finish, 3000);
                            });
                        });
                        await Promise.all(waits);
                    }"""
                )
            except Exception as exc:
                logger.debug(f"stylesheet wait failed (non-fatal): {exc}")
            try:
                await page.evaluate("() => document.fonts.ready")
            except Exception:
                pass

            # Wait for <img> subresources (bounded) — support-visual photos
            # load from S3; capturing before they arrive produced empty gaps
            # the vision reviewer flagged as layout defects, and best-of-N
            # judged image-rich candidates on unloaded frames.
            try:
                await page.evaluate("""async () => {
                    const ps = [];
                    document.querySelectorAll('*').forEach(host => {
                        const root = host.shadowRoot;
                        if (!root) return;
                        root.querySelectorAll('img').forEach(img => {
                            if (!img.complete) ps.push(new Promise(r => {
                                img.addEventListener('load', r, {once:true});
                                img.addEventListener('error', r, {once:true});
                                setTimeout(r, 2500);
                            }));
                        });
                    });
                    document.querySelectorAll('img').forEach(img => {
                        if (!img.complete) ps.push(new Promise(r => {
                            img.addEventListener('load', r, {once:true});
                            img.addEventListener('error', r, {once:true});
                            setTimeout(r, 2500);
                        }));
                    });
                    await Promise.all(ps);
                }""")
            except Exception:
                pass

            # Per-timestamp: seek the global timeline + the anime.js registry, wait
            # one paint, then screenshot. Two RAFs match the renderer's seek pattern
            # (line ~2385 of generate_video.py).
            for t in timestamps:
                try:
                    await page.evaluate(
                        """(t) => {
                            try { if (window.gsap) gsap.globalTimeline.totalTime(t); } catch (e) {}
                            try { if (window._animeSeek) window._animeSeek(t); } catch (e) {}
                        }""",
                        t,
                    )
                    await page.evaluate(
                        "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
                    )
                    png = await page.screenshot(type="png", full_page=False)
                    results.append({"t": float(t), "image_b64": base64.b64encode(png).decode("ascii")})
                except Exception as exc:
                    logger.warning(f"ScreenshotWorker: failed to capture t={t}: {exc}")
                    raise
        finally:
            try:
                await context.close()
            except Exception:
                pass

        return results


    async def bbox_check_shot(
        self,
        *,
        html: str,
        width: int,
        height: int,
        timestamps: List[float],
        background: str = "#0a0e27",
        keep_out: Optional[List[Dict[str, object]]] = None,
        check_squeeze: bool = False,
    ) -> List[Dict[str, object]]:
        """Render `html` in the harness and check whether any visible text or
        media overflows the viewport at each timestamp.

        `keep_out` (optional): canvas rects `{l, t, r, b, name}` the shot must
        leave empty — e.g. a lesson's teacher corner or caption strip. Visible
        text / media overlapping one is reported with `zone=name`. Full-canvas
        backgrounds (> half the canvas) are exempt.

        `check_squeeze`: also report text squeezed into a column so narrow its
        words break letter by letter (zone="squeezed") — a lesson recap once
        shipped "Veri / fy / the / 90°" one syllable per line.

        Returns a list of violation dicts:
            {"t": float, "selector": str, "rect": {l, t, r, b}, "text": str}
        — one entry per (timestamp, overflowing element) pair. Empty list means
        every text/media element renders fully within the canvas at every
        sampled timestamp.

        Mirrors the harness/dispatcher setup of `screenshot_shot` so what we
        measure equals what the production MP4 will render. The key difference:
        no `page.screenshot()` call — we evaluate `getBoundingClientRect()` on
        every visible element inside the shot's shadow root and collect the
        ones that cross the viewport bounds.

        Used by the deterministic post-render bbox lint (Tier 2 — kills the
        TEXT_CLIPPED bug class that the LLM-based vision reviewer is
        probabilistic about). See `vid_1778774930857_w8cwa1y` audit: shot 2's
        "THE ULTIMATE / ECOSYSTEM." headline clipped at the left edge and the
        v2 vision rubric had no rule to catch it.
        """
        if not html or not html.strip():
            raise ValueError("html is required")
        if width <= 0 or height <= 0:
            raise ValueError("width and height must be positive")
        if not timestamps:
            raise ValueError("at least one timestamp required")

        from render_harness import build_harness_html  # imported lazily after sys.path setup
        from dispatcher_install_js import get_dispatcher_install_js  # type: ignore

        await self._ensure_browser()

        harness_html = build_harness_html(background)
        context = await self._browser.new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=1,
        )
        page = await context.new_page()
        violations: List[Dict[str, object]] = []
        try:
            # Setup: identical sequence to screenshot_shot — harness, gsap wait,
            # dispatcher install, shot injection, stylesheet+font wait. Kept
            # inline (not factored) so divergence between the two paths is
            # always obvious from a side-by-side diff.
            await page.set_content(harness_html, wait_until="domcontentloaded")
            try:
                await page.wait_for_function(
                    "() => typeof window.gsap === 'object' && window.gsap !== null",
                    timeout=10_000,
                )
            except Exception:
                logger.warning("bbox_check_shot: gsap not present after 10s — proceeding anyway")

            await page.evaluate(get_dispatcher_install_js(libs=""))
            try:
                await page.wait_for_function(
                    "() => typeof window.__updateSnippets === 'function'",
                    timeout=5_000,
                )
            except Exception as exc:
                logger.error(f"bbox_check_shot: __updateSnippets failed to install — {exc}")
                raise

            # Same as /screenshot: without x/y/w/h the host is 0x0 and the
            # overflow check measures a collapsed shot, so it cannot see the
            # overflow it exists to catch.
            await page.evaluate(
                "async (entries) => { await window.__updateSnippets(entries); }",
                [{"id": "bbox-check-shot", "html": html, "inTime": 0,
                  "x": 0, "y": 0, "w": int(width), "h": int(height)}],
            )

            # Stylesheet + font load. Without these waits the bbox check fires
            # against fallback fonts (which can mismeasure widths by 10–20%) and
            # we'd flag false-positive overflows. Same sequence as screenshot.
            try:
                await page.evaluate(
                    """async () => {
                        const links = [];
                        document.querySelectorAll('[id^="snippet-"],[id^="segment-"],[id^="shot-"],[id="bbox-check-shot"]').forEach(host => {
                            const root = host.shadowRoot;
                            if (!root) return;
                            root.querySelectorAll('link[rel="stylesheet"]').forEach(l => links.push(l));
                        });
                        document.head.querySelectorAll('link[rel="stylesheet"]').forEach(l => links.push(l));
                        const waits = links.map(l => {
                            try { if (l.sheet) return Promise.resolve(); } catch (e) {}
                            return new Promise(resolve => {
                                let done = false;
                                const finish = () => { if (!done) { done = true; resolve(); } };
                                l.addEventListener('load', finish, { once: true });
                                l.addEventListener('error', finish, { once: true });
                                setTimeout(finish, 3000);
                            });
                        });
                        await Promise.all(waits);
                    }"""
                )
            except Exception as exc:
                logger.debug(f"bbox stylesheet wait failed (non-fatal): {exc}")
            try:
                await page.evaluate("() => document.fonts.ready")
            except Exception:
                pass

            # Wait for <img> subresources (bounded) — support-visual photos
            # load from S3; capturing before they arrive produced empty gaps
            # the vision reviewer flagged as layout defects, and best-of-N
            # judged image-rich candidates on unloaded frames.
            try:
                await page.evaluate("""async () => {
                    const ps = [];
                    document.querySelectorAll('*').forEach(host => {
                        const root = host.shadowRoot;
                        if (!root) return;
                        root.querySelectorAll('img').forEach(img => {
                            if (!img.complete) ps.push(new Promise(r => {
                                img.addEventListener('load', r, {once:true});
                                img.addEventListener('error', r, {once:true});
                                setTimeout(r, 2500);
                            }));
                        });
                    });
                    document.querySelectorAll('img').forEach(img => {
                        if (!img.complete) ps.push(new Promise(r => {
                            img.addEventListener('load', r, {once:true});
                            img.addEventListener('error', r, {once:true});
                            setTimeout(r, 2500);
                        }));
                    });
                    await Promise.all(ps);
                }""")
            except Exception:
                pass

            # Per-timestamp: seek + double-RAF + walk shadow DOM for overflow.
            # The walker filters by computed visibility (display:none, opacity≈0)
            # so mid-flight elements that haven't faded in yet don't generate
            # false positives. Only flag elements with visible text content or
            # raster media (img/svg/canvas/video) — wrapper divs without their
            # own text are skipped to avoid duplicate reports.
            # NOTE — single-arg signature: Playwright >= 1.40 dropped multi-
            # positional `Page.evaluate(expression, arg1, arg2, …)`; only ONE
            # argument is now accepted. The previous call site passed `width`
            # + `height` as two positional args, triggering
            # `Page.evaluate() takes from 2 to 3 positional arguments but 4
            # were given` (Met-Gala incident — bbox-lint silently skipped on
            # EVERY shot of the run). Pack both dimensions into a single
            # object argument and destructure on the JS side.
            walker_js = """
                ({W, H, KO, SQ}) => {
                    function cssPath(el) {
                        if (!el) return '?';
                        if (el.id) return '#' + el.id;
                        let p = el.tagName ? el.tagName.toLowerCase() : '?';
                        if (el.className && typeof el.className === 'string') {
                            const classes = el.className.trim().split(/\\s+/).slice(0, 2);
                            if (classes.length && classes[0]) p += '.' + classes.join('.');
                        }
                        return p;
                    }
                    const out = [];
                    const hosts = document.querySelectorAll('[id="bbox-check-shot"]');
                    hosts.forEach(host => {
                        const root = host.shadowRoot;
                        if (!root) return;
                        const all = root.querySelectorAll('*');
                        const view = root.host.ownerDocument.defaultView;
                        all.forEach(el => {
                            // Skip script/style/link nodes — they have no visual.
                            const tag = (el.tagName || '').toUpperCase();
                            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' ||
                                tag === 'META' || tag === 'HEAD') return;
                            let cs;
                            try { cs = view.getComputedStyle(el); }
                            catch (e) { return; }
                            if (!cs) return;
                            if (cs.display === 'none' || cs.visibility === 'hidden') return;
                            const op = parseFloat(cs.opacity);
                            if (!isNaN(op) && op < 0.05) return;  // effectively invisible

                            const r = el.getBoundingClientRect();
                            if (r.width <= 0 || r.height <= 0) return;

                            const text = (el.textContent || '').trim();
                            const isMedia = ['IMG', 'SVG', 'CANVAS', 'VIDEO'].includes(tag);
                            const isLeafText = text.length > 0 && el.children.length === 0;
                            // Wrapper divs with text children would otherwise double-report;
                            // only flag a wrapper if it has NO text-bearing descendants.
                            const isWrapperText = text.length > 0 && !isLeafText;
                            let wrapperHasTextDescendant = false;
                            if (isWrapperText) {
                                const descendants = el.querySelectorAll('*');
                                for (let i = 0; i < descendants.length; i++) {
                                    const d = descendants[i];
                                    if ((d.textContent || '').trim().length > 0 && d.children.length === 0) {
                                        wrapperHasTextDescendant = true;
                                        break;
                                    }
                                }
                            }
                            if (isWrapperText && wrapperHasTextDescendant) return;
                            if (!isLeafText && !isMedia && !isWrapperText) return;

                            // 1-pixel tolerance on each edge — sub-pixel rendering and
                            // text antialiasing routinely push fractional pixels past
                            // the canvas edge without any visible glyph clip.
                            // Squeezed text: a multi-line text block narrower than
                            // ~2.5 characters breaks words letter by letter.
                            if (SQ && isLeafText && text.length >= 6) {
                                const fs = parseFloat(cs.fontSize) || 16;
                                const lh = parseFloat(cs.lineHeight) || fs * 1.2;
                                if (r.width < fs * 2.5 && r.height >= lh * 2.6) {
                                    out.push({
                                        selector: cssPath(el),
                                        rect: {
                                            l: Math.round(r.left * 10) / 10,
                                            t: Math.round(r.top * 10) / 10,
                                            r: Math.round(r.right * 10) / 10,
                                            b: Math.round(r.bottom * 10) / 10,
                                        },
                                        text: text.slice(0, 80),
                                        is_media: false,
                                        zone: 'squeezed',
                                    });
                                    return;
                                }
                            }
                            // Keep-out zones (lesson teacher area / caption strip).
                            const area = r.width * r.height;
                            if (KO && KO.length && area < 0.5 * W * H) {
                                for (const z of KO) {
                                    const ix = Math.min(r.right, z.r) - Math.max(r.left, z.l);
                                    const iy = Math.min(r.bottom, z.b) - Math.max(r.top, z.t);
                                    if (ix > 8 && iy > 8 && ix * iy > 0.15 * area) {
                                        out.push({
                                            selector: cssPath(el),
                                            rect: {
                                                l: Math.round(r.left * 10) / 10,
                                                t: Math.round(r.top * 10) / 10,
                                                r: Math.round(r.right * 10) / 10,
                                                b: Math.round(r.bottom * 10) / 10,
                                            },
                                            text: text.slice(0, 80),
                                            is_media: isMedia,
                                            zone: String(z.name || 'keep_out'),
                                        });
                                        return;
                                    }
                                }
                            }
                            if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) {
                                out.push({
                                    selector: cssPath(el),
                                    rect: {
                                        l: Math.round(r.left * 10) / 10,
                                        t: Math.round(r.top * 10) / 10,
                                        r: Math.round(r.right * 10) / 10,
                                        b: Math.round(r.bottom * 10) / 10,
                                    },
                                    text: text.slice(0, 80),
                                    is_media: isMedia,
                                });
                            }
                        });
                    });
                    return out;
                }
            """

            for t in timestamps:
                try:
                    await page.evaluate(
                        """(t) => {
                            try { if (window.gsap) gsap.globalTimeline.totalTime(t); } catch (e) {}
                            try { if (window._animeSeek) window._animeSeek(t); } catch (e) {}
                        }""",
                        t,
                    )
                    await page.evaluate(
                        "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
                    )
                    rows = await page.evaluate(
                        walker_js, {"W": width, "H": height, "KO": list(keep_out or []),
                                    "SQ": bool(check_squeeze)}
                    )
                    for row in rows or []:
                        violations.append({
                            "t": float(t),
                            "selector": str(row.get("selector") or "?"),
                            "rect": dict(row.get("rect") or {}),
                            "text": str(row.get("text") or ""),
                            "is_media": bool(row.get("is_media")),
                            "zone": str(row.get("zone") or ""),
                        })
                except Exception as exc:
                    logger.warning(f"bbox_check_shot: failed at t={t}: {exc}")
                    raise
        finally:
            try:
                await context.close()
            except Exception:
                pass

        return violations


    async def record_shot_mp4(
        self,
        *,
        html: str,
        width: int,
        height: int,
        duration_seconds: float,
        fps: int = 25,
        background: str = "#0a0e27",
        shot_type: Optional[str] = None,
    ) -> bytes:
        """Render `html` in the harness for `duration_seconds` and return an MP4.

        Captures every frame at `fps`, then ffmpeg-assembles into H.264 MP4
        (no audio). Same harness/seek pattern as the production /jobs path,
        so visual fidelity matches what the full-video render would produce
        for this shot — useful for iterating on a single shot's HTML
        without paying the cost of a full video re-render.
        """
        if not html or not html.strip():
            raise ValueError("html is required")
        if width <= 0 or height <= 0:
            raise ValueError("width and height must be positive")
        if duration_seconds <= 0 or duration_seconds > 60:
            raise ValueError("duration_seconds must be in (0, 60]")
        if fps not in (15, 20, 25, 30, 60):
            raise ValueError("fps must be one of: 15, 20, 25, 30, 60")

        import shutil
        import subprocess
        import tempfile
        import time as _time
        from render_harness import build_harness_html  # type: ignore
        from dispatcher_install_js import get_dispatcher_install_js  # type: ignore
        from shot_preprocess import preprocess_shot_html  # type: ignore

        if shutil.which("ffmpeg") is None:
            raise RuntimeError("ffmpeg not installed on render worker")

        await self._ensure_browser()

        total_frames = int(round(duration_seconds * fps))
        harness_html = build_harness_html(background)

        # Apply the same HTML preprocessing the production /jobs path runs —
        # vx-timescale extraction, stage-drift / GSAP CDN strip, vx-shot
        # CSS-to-GSAP conversion. Returns (cleaned_html, timescale); we attach
        # the timescale to the timeline entry so the dispatcher creates a
        # per-shot child timeline at the right scale (Fix-2 architecture).
        html, _shot_timescale = preprocess_shot_html(html, shot_type=shot_type)

        workdir = Path(tempfile.mkdtemp(prefix="shot_preview_"))
        frames_dir = workdir / "frames"
        frames_dir.mkdir()

        context = await self._browser.new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=1,
        )
        page = await context.new_page()
        try:
            await page.set_content(harness_html, wait_until="domcontentloaded")
            try:
                await page.wait_for_function(
                    "() => typeof window.gsap === 'object' && window.gsap !== null",
                    timeout=10_000,
                )
            except Exception:
                logger.warning("record_shot_mp4: gsap not present after 10s — proceeding anyway")

            # Install the SAME dispatcher that production /jobs uses — shared
            # via dispatcher_install_js.get_dispatcher_install_js so byte-for-byte
            # the JS is identical. Without this, window.__updateSnippets doesn't
            # exist and the shot never gets injected (resulting in a black MP4).
            # `libs` is empty because the preview path doesn't render the
            # character-mouth overlay (audio-driven, not relevant for a static
            # shot preview).
            await page.evaluate(get_dispatcher_install_js(""))

            # Inject the shot using the same dispatcher entry point the
            # production renderer uses. Pass an entry shaped like a timeline
            # entry: id + html + inTime + x/y/w/h cover the full host sizing
            # path inside __updateSnippets, so the host fills the viewport.
            # `timescale` is forwarded only when the shot had a vx-timescale
            # tag — the dispatcher creates a per-shot child timeline at that
            # scale, identical to production /jobs behavior.
            _entry = {
                "id": "preview-shot",
                "html": html,
                "inTime": 0,
                "x": 0,
                "y": 0,
                "w": width,
                "h": height,
                "z": 1,
            }
            if abs(_shot_timescale - 1.0) > 1e-6:
                _entry["timescale"] = _shot_timescale
            await page.evaluate(
                """async (entries) => { await window.__updateSnippets(entries); }""",
                [_entry],
            )

            # Stylesheet + fonts wait — same sequence the production renderer
            # runs after a segment change. Without this, early frames render
            # with fallback fonts.
            try:
                await page.evaluate(
                    """async () => {
                        const links = [];
                        document.querySelectorAll('[id^="snippet-"],[id^="segment-"],[id^="shot-"],[id="preview-shot"]').forEach(host => {
                            const root = host.shadowRoot;
                            if (!root) return;
                            root.querySelectorAll('link[rel="stylesheet"]').forEach(l => links.push(l));
                        });
                        document.head.querySelectorAll('link[rel="stylesheet"]').forEach(l => links.push(l));
                        const waits = links.map(l => {
                            try { if (l.sheet) return Promise.resolve(); } catch (e) {}
                            return new Promise(resolve => {
                                let done = false;
                                const finish = () => { if (!done) { done = true; resolve(); } };
                                l.addEventListener('load', finish, { once: true });
                                l.addEventListener('error', finish, { once: true });
                                setTimeout(finish, 3000);
                            });
                        });
                        await Promise.all(waits);
                    }"""
                )
            except Exception as exc:
                logger.debug(f"stylesheet wait failed (non-fatal): {exc}")
            try:
                await page.evaluate("() => document.fonts.ready")
            except Exception:
                pass

            # Wait for <img> subresources (bounded) — support-visual photos
            # load from S3; capturing before they arrive produced empty gaps
            # the vision reviewer flagged as layout defects, and best-of-N
            # judged image-rich candidates on unloaded frames.
            try:
                await page.evaluate("""async () => {
                    const ps = [];
                    document.querySelectorAll('*').forEach(host => {
                        const root = host.shadowRoot;
                        if (!root) return;
                        root.querySelectorAll('img').forEach(img => {
                            if (!img.complete) ps.push(new Promise(r => {
                                img.addEventListener('load', r, {once:true});
                                img.addEventListener('error', r, {once:true});
                                setTimeout(r, 2500);
                            }));
                        });
                    });
                    document.querySelectorAll('img').forEach(img => {
                        if (!img.complete) ps.push(new Promise(r => {
                            img.addEventListener('load', r, {once:true});
                            img.addEventListener('error', r, {once:true});
                            setTimeout(r, 2500);
                        }));
                    });
                    await Promise.all(ps);
                }""")
            except Exception:
                pass

            # Per-frame seek + screenshot.
            capture_start = _time.monotonic()
            for i in range(total_frames):
                t = i / float(fps)
                await page.evaluate(
                    """(t) => {
                        try { if (window.gsap) gsap.globalTimeline.totalTime(t); } catch (e) {}
                        try { if (window._animeSeek) window._animeSeek(t); } catch (e) {}
                    }""",
                    t,
                )
                await page.evaluate(
                    "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
                )
                frame_path = frames_dir / f"frame_{i:06d}.jpg"
                await page.screenshot(
                    path=str(frame_path),
                    type="jpeg",
                    quality=92,
                    full_page=False,
                )
            capture_ms = int((_time.monotonic() - capture_start) * 1000)
            logger.info(
                f"record_shot_mp4: captured {total_frames} frames in {capture_ms}ms "
                f"({total_frames * 1000 // max(capture_ms, 1)} fps capture)"
            )

            # ffmpeg-assemble. Single thread, veryfast preset — encode time
            # is dominated by the per-frame screenshot loop above so encode
            # tuning here is moot. yuv420p for QuickTime / browser playback.
            output_path = workdir / "output.mp4"
            ffmpeg_cmd = [
                "ffmpeg", "-y",
                "-framerate", str(fps),
                "-i", str(frames_dir / "frame_%06d.jpg"),
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-preset", "veryfast",
                "-crf", "20",
                str(output_path),
            ]
            encode_start = _time.monotonic()
            result = subprocess.run(
                ffmpeg_cmd, capture_output=True, timeout=120,
            )
            encode_ms = int((_time.monotonic() - encode_start) * 1000)
            if result.returncode != 0 or not output_path.exists():
                stderr = result.stderr.decode("utf-8", errors="replace")[-1500:]
                raise RuntimeError(f"ffmpeg failed (rc={result.returncode}): {stderr}")
            logger.info(f"record_shot_mp4: encoded MP4 in {encode_ms}ms")

            return output_path.read_bytes()
        finally:
            try:
                await context.close()
            except Exception:
                pass
            try:
                shutil.rmtree(workdir, ignore_errors=True)
            except Exception:
                pass


# Module-level singleton — reused across requests in main.py
_worker_singleton: Optional[ScreenshotWorker] = None


def get_screenshot_worker() -> ScreenshotWorker:
    global _worker_singleton
    if _worker_singleton is None:
        _worker_singleton = ScreenshotWorker()
    return _worker_singleton
