"""The website preview waits for SCORM players (scormViewer frames) before its
screenshot; it used to shoot 400 ms after scrolling and showed an empty frame."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from app.services import page_preview  # noqa: E402


class _Page:
    def __init__(self, frames):
        self.frames, self.calls = frames, []

    async def evaluate(self, js, *a):
        self.calls.append(("evaluate", js))
        return self.frames

    async def wait_for_function(self, js, timeout=None):
        self.calls.append(("wait_for_function", js, timeout))

    async def wait_for_timeout(self, ms):
        self.calls.append(("wait_for_timeout", ms))


@pytest.mark.asyncio
async def test_no_scorm_frame_no_wait():
    page = _Page(0)
    await page_preview._settle_embeds(page)
    assert [c[0] for c in page.calls] == ["evaluate"]


@pytest.mark.asyncio
async def test_scorm_frame_waits_for_load_then_paint():
    page = _Page(1)
    await page_preview._settle_embeds(page)
    kinds = [c[0] for c in page.calls]
    assert kinds == ["evaluate", "wait_for_function", "wait_for_timeout"]
    assert "data-scorm-frame" in page.calls[1][1] and "data-loaded" in page.calls[1][1]
    assert page.calls[1][2] == page_preview._EMBED_WAIT_MS


@pytest.mark.asyncio
async def test_a_slow_package_still_gets_its_screenshot():
    page = _Page(1)

    async def _timeout(js, timeout=None):
        raise TimeoutError("still loading")
    page.wait_for_function = _timeout
    await page_preview._settle_embeds(page)   # does not raise
    assert page.calls[-1] == ("wait_for_timeout", page_preview._EMBED_PAINT_MS)
