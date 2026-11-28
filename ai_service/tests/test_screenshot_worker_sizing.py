"""The render worker's /screenshot and /bbox-check must render the shot at full size.

They injected the shot into the dispatcher as {id, html, inTime} with no x/y/w/h.
__updateSnippets sizes the shot's host from those (`e.w | 0`), so the host was 0x0 and a
shot laid out as 100% of its container collapsed to nothing. On a 2026-10-01 run all 21
vision-review screenshots (7 shots x 3 frames) were one identical single-colour PNG: the
page background. The vision reviewer and creativity critic were judging blank frames, and
the overflow check was measuring a collapsed shot. The preview-MP4 path already passed the
size fields; these two did not.

The behavioural tests drive the real ScreenshotWorker in a real browser and skip when
Playwright/Chromium is not installed (they run in the ai-service and render-worker images).

Run:  cd ai_service && PYTHONPATH=.. python -m pytest tests/test_screenshot_worker_sizing.py
"""
from __future__ import annotations

import asyncio
import base64
import io
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
WORKER = HERE.parent / "render_worker" / "screenshot_worker.py"
sys.path.insert(0, str(HERE.parent / "app" / "ai-video-gen-main"))   # what build.sh copies beside it
sys.path.insert(0, str(HERE.parent / "render_worker"))

# Laid out like a real shot: everything is relative to the container.
SHOT = (
    '<div id="shot-root" style="position:absolute;inset:0;width:100%;height:100%;background:#123456">'
    '<div style="position:absolute;left:10%;top:40%;width:100%;height:20%;background:#d00;'
    'color:#fff;font:700 64px sans-serif;white-space:nowrap">A HEADLINE THAT RUNS OFF THE RIGHT EDGE</div>'
    "</div>"
)


def test_both_endpoints_size_the_shot():
    src = WORKER.read_text()
    for shot_id in ("screenshot-shot", "bbox-check-shot"):
        entry = src[src.index('"id": "%s"' % shot_id):][:220]
        assert '"w": int(width)' in entry and '"h": int(height)' in entry, shot_id


def _worker():
    try:
        import playwright  # noqa: F401
        from screenshot_worker import ScreenshotWorker
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"playwright / worker not importable here: {exc}")
    return ScreenshotWorker()


def _run(coro_fn):
    async def go():
        w = _worker()
        try:
            return await coro_fn(w)
        except Exception as exc:  # pragma: no cover - no chromium binary
            if "Executable doesn't exist" in str(exc) or "browserType.launch" in str(exc):
                pytest.skip(f"chromium not available: {exc}")
            raise
        finally:
            try:
                await w.close()
            except Exception:
                pass
    return asyncio.run(go())


def test_a_real_shot_screenshot_is_not_just_the_background():
    from PIL import Image

    frames = _run(lambda w: w.screenshot_shot(html=SHOT, width=1920, height=1080,
                                              timestamps=[0.5], background="#FFF8F0"))
    png = base64.b64decode(frames[0]["image_b64"])
    im = Image.open(io.BytesIO(png)).convert("RGB")
    colours = im.getcolors(maxcolors=4096)
    assert colours is None or len(colours) > 1, "frame is a single colour - the shot did not render"
    # The shot's own background must fill the frame, not the harness background.
    assert im.getpixel((960, 100)) == (0x12, 0x34, 0x56), im.getpixel((960, 100))


def test_the_overflow_check_sees_a_shot_that_overflows():
    """A 100%-wide block offset by 10% overflows by ~192px. In a collapsed 0x0
    host it has no size at all, so the check could not see it."""
    violations = _run(lambda w: w.bbox_check_shot(html=SHOT, width=1920, height=1080,
                                                  timestamps=[0.5], background="#FFF8F0"))
    assert violations, "an element overflowing the right edge must be reported"
