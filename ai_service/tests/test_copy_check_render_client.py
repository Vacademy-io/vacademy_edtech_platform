"""Offline tests for the render_worker client's busy handling.

render_worker caps concurrent jobs (2 in prod) and answers 429 past that. A
copy must wait for a slot, not fail - that is the difference between a bulk
check that completes and one that drops every third copy.

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_copy_check_render_client.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services.copy_check.render_client import (
    CopyCheckRenderClient,
    OcrCancelled,
    RenderWorkerBusy,
)

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        failures.append(f"{label}: {detail}")
        print(f"  FAIL  {label} — {detail}")


def _client_with_replies(replies):
    client = CopyCheckRenderClient("http://render.invalid", "k")
    calls = {"n": 0}

    async def fake_submit(pdf_url, callback_url=None, dpi=200):
        calls["n"] += 1
        r = replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    client.submit = fake_submit  # type: ignore[method-assign]
    return client, calls


def test_busy_then_slot() -> None:
    print("\nsubmit_when_free — two 429s then a slot")
    client, calls = _client_with_replies([RenderWorkerBusy("2/2"), RenderWorkerBusy("2/2"), "job-1"])
    with mock.patch("ai_service.app.services.copy_check.render_client.asyncio.sleep", new=mock.AsyncMock()):
        job = asyncio.run(client.submit_when_free("http://x/a.pdf", retry_interval=0.01))
    check("job submitted after waiting", job == "job-1", repr(job))
    check("three attempts", calls["n"] == 3, str(calls["n"]))


def test_gives_up_after_budget() -> None:
    print("\nsubmit_when_free — worker never frees")
    client, calls = _client_with_replies([RenderWorkerBusy("2/2")] * 50)
    with mock.patch("ai_service.app.services.copy_check.render_client.asyncio.sleep", new=mock.AsyncMock()):
        try:
            asyncio.run(client.submit_when_free("http://x/a.pdf", busy_wait=0.0, retry_interval=0.01))
            check("raises TimeoutError", False, "did not raise")
        except TimeoutError as e:
            check("raises TimeoutError", "busy" in str(e), str(e))


def test_cancel_while_waiting() -> None:
    print("\nsubmit_when_free — teacher stops it while waiting")
    client, calls = _client_with_replies([RenderWorkerBusy("2/2")] * 5)
    with mock.patch("ai_service.app.services.copy_check.render_client.asyncio.sleep", new=mock.AsyncMock()):
        try:
            asyncio.run(client.submit_when_free("http://x/a.pdf", cancellation_check=lambda: True))
            check("raises OcrCancelled", False, "did not raise")
        except OcrCancelled:
            check("raises OcrCancelled", True)


def test_other_errors_still_raise() -> None:
    print("\nsubmit_when_free — a real error is not retried")
    client, calls = _client_with_replies([RuntimeError("500 boom")])
    try:
        asyncio.run(client.submit_when_free("http://x/a.pdf"))
        check("500 propagates", False, "did not raise")
    except RuntimeError as e:
        check("500 propagates", "boom" in str(e))
    check("one attempt only", calls["n"] == 1, str(calls["n"]))


if __name__ == "__main__":
    test_busy_then_slot()
    test_gives_up_after_budget()
    test_cancel_while_waiting()
    test_other_errors_still_raise()
    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("All render client tests passed.")
