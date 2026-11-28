"""Offline tests for the copy-check student identification stage.

The reader's output feeds name matching in assessment_service, so what
matters here is that it never invents a name, tolerates the model's many
ways of saying "nothing here", and keeps a roll number when the name is
missing. The vision call itself is stubbed.

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_copy_check_identify.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services.copy_check import identify as ident

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        failures.append(f"{label}: {detail}")
        print(f"  FAIL  {label} — {detail}")


def test_parse_tolerates_fences_and_prose() -> None:
    print("\n_parse — fenced / wrapped JSON")
    fenced = '```json\n{"student_name": "Anushka Soni", "confidence": 0.9}\n```'
    check("fenced JSON parsed", ident._parse(fenced)["student_name"] == "Anushka Soni")
    prose = 'Sure! Here is the header:\n{"student_name": null, "name_found": false} Hope this helps.'
    check("prose-wrapped JSON parsed", ident._parse(prose)["name_found"] is False)
    try:
        ident._parse("no json here")
        check("no object raises", False, "did not raise")
    except RuntimeError:
        check("no object raises", True)


def test_clean_and_confidence() -> None:
    print("\n_clean / _confidence — the model's ways of saying nothing")
    for v in (None, "", "  ", "null", "N/A", "not visible", "Unknown", "-", False):
        check(f"clean({v!r}) is None", ident._clean(v) is None, repr(ident._clean(v)))
    check("whitespace collapsed", ident._clean("  Aman   Sharma ") == "Aman Sharma")
    check("percent confidence scaled", ident._confidence(85) == 0.85)
    check("string confidence parsed", ident._confidence("0.7") == 0.7)
    check("garbage confidence is 0", ident._confidence("low") == 0.0)
    check("confidence clamped", ident._confidence(170) == 1.0)


class _StubLLM:
    """Replies in order; records how many calls were made."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = 0

    async def chat_completion(self, **kwargs):
        self.calls += 1
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return {"content": reply, "usage": {"prompt_tokens": 100, "completion_tokens": 20}}


def _run(llm, pages: int = 2):
    """Run identify_student with the file system and renderer stubbed out."""
    with mock.patch.object(ident, "_download", new=mock.AsyncMock()), \
            mock.patch.object(ident, "_page_count", return_value=pages), \
            mock.patch.object(ident, "_render_header", return_value=object()), \
            mock.patch.object(ident, "_encode_page", return_value="ZmFrZQ=="), \
            mock.patch.object(ident.asyncio, "sleep", new=mock.AsyncMock()):
        return asyncio.run(ident.identify_student("http://x/copy.pdf", llm, "model-x", "inst-1"))


def test_confident_header_stops_after_one_call() -> None:
    print("\nidentify_student — a clear header")
    llm = _StubLLM(['{"student_name": "Anushka Soni", "roll_number": "12", "class_section": "10 B", '
                    '"confidence": 0.9, "name_found": true}'])
    out = _run(llm)
    check("name read", out["student_name"] == "Anushka Soni", repr(out))
    check("roll read", out["roll_number"] == "12")
    check("one vision call", llm.calls == 1, str(llm.calls))
    check("usage summed", out["usage"]["prompt_tokens"] == 100)


def test_no_name_is_a_normal_outcome() -> None:
    print("\nidentify_student — nothing on the sheet")
    none = '{"student_name": null, "roll_number": null, "confidence": 0.0, "name_found": false}'
    llm = _StubLLM([none, none, none])
    out = _run(llm)
    check("no name, no raise", out["student_name"] is None and out["name_found"] is False, repr(out))
    check("all three attempts made", llm.calls == 3, str(llm.calls))
    check("pages read counted", out["pages_read"] == 3)


def test_roll_number_kept_when_name_missing() -> None:
    print("\nidentify_student — roll number without a name")
    llm = _StubLLM(['{"student_name": null, "roll_number": "007", "class_section": "10", "confidence": 0.0}',
                    '{"student_name": null, "roll_number": null}',
                    '{"student_name": null}'])
    out = _run(llm)
    check("roll kept", out["roll_number"] == "007", repr(out))
    check("class kept", out["class_section"] == "10")


def test_low_confidence_keeps_looking_and_keeps_best() -> None:
    print("\nidentify_student — a doubtful reading is improved by the next page")
    llm = _StubLLM(['{"student_name": "Newton", "confidence": 0.3}',
                    '{"student_name": "Aman Sharma", "confidence": 0.8}'])
    out = _run(llm)
    check("best reading wins", out["student_name"] == "Aman Sharma", repr(out))
    check("stopped once confident", llm.calls == 2, str(llm.calls))


def test_provider_hiccup_is_retried_once() -> None:
    print("\nidentify_student — one 502 then success")
    llm = _StubLLM([RuntimeError("502 Bad Gateway"),
                    '{"student_name": "Riya Verma", "confidence": 0.95}'])
    out = _run(llm)
    check("retried and read", out["student_name"] == "Riya Verma", repr(out))
    check("two calls", llm.calls == 2, str(llm.calls))


def test_single_page_copy_does_not_ask_for_page_two() -> None:
    print("\nidentify_student — one-page copy")
    none = '{"student_name": null}'
    llm = _StubLLM([none, none, none])
    with mock.patch.object(ident, "_download", new=mock.AsyncMock()), \
            mock.patch.object(ident, "_page_count", return_value=1), \
            mock.patch.object(ident, "_render_header",
                              side_effect=lambda p, i, f: object() if i == 0 else None), \
            mock.patch.object(ident, "_encode_page", return_value="ZmFrZQ=="):
        out = asyncio.run(ident.identify_student("http://x/one.pdf", llm, "m", None))
    check("page 2 skipped", llm.calls == 2, str(llm.calls))
    check("page count reported", out["page_count"] == 1)


def test_empty_file_raises() -> None:
    print("\nidentify_student — empty file")
    with mock.patch.object(ident, "_download", new=mock.AsyncMock()), \
            mock.patch.object(ident, "_page_count", return_value=0):
        try:
            asyncio.run(ident.identify_student("http://x/empty.pdf", _StubLLM([]), "m", None))
            check("raises on zero pages", False, "did not raise")
        except RuntimeError as e:
            check("raises on zero pages", "no pages" in str(e), str(e))


if __name__ == "__main__":
    test_parse_tolerates_fences_and_prose()
    test_clean_and_confidence()
    test_confident_header_stops_after_one_call()
    test_no_name_is_a_normal_outcome()
    test_roll_number_kept_when_name_missing()
    test_low_confidence_keeps_looking_and_keeps_best()
    test_provider_hiccup_is_retried_once()
    test_single_page_copy_does_not_ask_for_page_two()
    test_empty_file_raises()

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("All copy-check identify tests passed.")
