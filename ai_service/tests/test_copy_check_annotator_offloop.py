"""The checked copy is drawn off the event loop (T0.27), and its summary page
adds up only the counted questions when the paper has internal choice (T1.36)."""
import asyncio
import threading
import time

import pytest

from app.services.copy_check import annotator


def test_render_runs_in_a_worker_thread_and_leaves_the_loop_free(monkeypatch):
    seen = {}

    async def fake_fetch(url):
        return b"%PDF-1.4"

    def slow_build(pdf_bytes, layout_map, verdicts):
        seen["build_thread"] = threading.current_thread()
        time.sleep(0.3)  # CPU-bound drawing stands in as a blocking sleep
        return b"annotated"

    def fake_shrink(pdf):
        seen["shrink_thread"] = threading.current_thread()
        return pdf + b"-small"

    async def fake_upload(content, filename):
        seen["uploaded"] = content
        return "file-1"

    monkeypatch.setattr(annotator, "_fetch_pdf", fake_fetch)
    monkeypatch.setattr(annotator, "build_annotated_pdf", slow_build)
    monkeypatch.setattr(annotator, "shrink_scans", fake_shrink)
    monkeypatch.setattr(annotator, "_upload", fake_upload)

    async def main():
        ticks = 0
        done = asyncio.Event()

        async def ticker():
            nonlocal ticks
            while not done.is_set():
                ticks += 1
                await asyncio.sleep(0.02)

        t = asyncio.create_task(ticker())
        file_id = await annotator.render_and_upload("https://x/copy.pdf", {"pages": []}, [], "att-1")
        done.set()
        await t
        return file_id, ticks

    file_id, ticks = asyncio.run(main())
    assert file_id == "file-1"
    assert seen["uploaded"] == b"annotated-small"
    assert seen["build_thread"] is not threading.main_thread()
    assert seen["shrink_thread"] is seen["build_thread"]
    # The loop kept running while the copy was drawn.
    assert ticks >= 5


def test_render_failure_still_returns_none(monkeypatch):
    async def fake_fetch(url):
        return b"%PDF-1.4"

    def broken_build(*a):
        raise RuntimeError("draw failed")

    monkeypatch.setattr(annotator, "_fetch_pdf", fake_fetch)
    monkeypatch.setattr(annotator, "build_annotated_pdf", broken_build)
    assert asyncio.run(annotator.render_and_upload("u", {"pages": []}, [], "a")) is None


def test_summary_page_totals_counted_questions_only():
    fitz = pytest.importorskip("fitz")
    if getattr(fitz, "__file__", None) is None:  # a stub module in an offline harness
        pytest.skip("PyMuPDF not installed")
    doc = fitz.open()
    verdicts = [
        {"question_number": 1, "marks_awarded": 3, "max_marks": 5, "feedback": "", "confidence": 1.0},
        {"question_number": 2, "marks_awarded": 4, "max_marks": 5, "feedback": "", "confidence": 1.0,
         "counted": False},
    ]
    annotator._append_summary(doc, verdicts)
    text = doc[-1].get_text()
    assert "Total: 3 / 5" in text
    assert "not counted" in text
