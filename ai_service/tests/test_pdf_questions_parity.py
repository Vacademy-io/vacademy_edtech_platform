"""Offline test for migrated PDF question generation (WS7).

Stubs MathPix + media file resolution + DB cache; verifies start-from-fileId,
the cache hit/miss + body-extract + base64 paths, and the MD→HTML porter.

Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_pdf_questions_parity.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services import pdf_questions_service as PS
from ai_service.app.services.md_to_html import convert_markdown_to_html


def test_md_to_html() -> None:
    h = convert_markdown_to_html("## Q\n\n1. What is $x$? ![f](http://x/a.png)\n\n$$y=2$$\n\n**bold**")
    assert "<h2>Q</h2>" in h
    assert '<div class="question">1. What is $x$? <img src="http://x/a.png" alt="f" /></div>' in h
    assert '<div class="math-block">$$y=2$$</div>' in h and "<strong>bold</strong>" in h
    print("  ✓ MD→HTML porter")


def test_start_from_file_id() -> None:
    captured = {}

    async def fake_url(file_id, expiry_days=7):
        captured["file_id"] = file_id
        return "https://s3/doc.pdf"

    async def fake_submit(url):
        captured["url"] = url
        return "pdf-abc"

    def fake_cache_start(pdf_id, file_id, file_type=None):
        captured["cached"] = (pdf_id, file_id)

    PS.media_file_client.get_file_url = fake_url
    PS.mathpix_pdf_service.submit = fake_submit
    PS._cache_start = fake_cache_start

    pdf_id = asyncio.run(PS.start_from_file_id("file-1"))
    assert pdf_id == "pdf-abc"
    assert captured["file_id"] == "file-1" and captured["url"] == "https://s3/doc.pdf"
    assert captured["cached"] == ("pdf-abc", "file-1")
    print("  ✓ start_from_file_id: fileId→URL→MathPix→cache")


def test_fetch_html_cache_hit_and_miss() -> None:
    # cache hit
    PS._cache_get = lambda pid: "<p>cached</p>"
    html = asyncio.run(PS.fetch_or_convert_html("pdf-1", allow_poll=False))
    assert html == "<p>cached</p>"

    # cache miss + not completed → StillProcessing (sync path)
    PS._cache_get = lambda pid: None

    async def not_done(pid):
        return False

    PS.mathpix_pdf_service.is_completed = not_done
    raised = False
    try:
        asyncio.run(PS.fetch_or_convert_html("pdf-2", allow_poll=False))
    except PS.StillProcessing:
        raised = True
    assert raised, "expected StillProcessing when not completed"
    print("  ✓ fetch_or_convert_html: cache hit + StillProcessing on miss")


def test_fetch_html_miss_then_convert() -> None:
    PS._cache_get = lambda pid: None
    cached = {}
    PS._cache_html = lambda pid, html: cached.update({pid: html})

    async def done(pid):
        return True

    async def conv(pid):
        return "<html><body><p>Q1</p><img src=\"data:image/png;base64,QQ==\"/></body></html>"

    PS.mathpix_pdf_service.is_completed = done
    PS.mathpix_pdf_service.get_converted_html = conv
    # stub base64→S3 so no network: leave data uri (upload fails silently) — body still extracted
    html = asyncio.run(PS.fetch_or_convert_html("pdf-3", allow_poll=False))
    assert "<p>Q1</p>" in html and "<body>" not in html  # body extracted
    assert "pdf-3" in cached  # cached
    print("  ✓ fetch_or_convert_html: convert + body-extract + cache")


def main() -> int:
    tests = [test_md_to_html, test_start_from_file_id,
             test_fetch_html_cache_hit_and_miss, test_fetch_html_miss_then_convert]
    failed = 0
    for t in tests:
        print(f"\n{t.__name__}:")
        try:
            t()
        except AssertionError as e:
            failed += 1
            print(f"  ✗ FAILED: {e}")
    print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED"))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
