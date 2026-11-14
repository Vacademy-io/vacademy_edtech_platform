"""Offline tests for the answer-location pass (copy_check/locate.py).

What it protects:
  - a grading call for one question carries only that answer's pages
    (cost is pages + questions again, not pages × questions)
  - a wrong or missing location can never cost the student the marks:
    unplaced questions fall back to the window between their paper
    neighbours, then to the whole copy; a narrowed call that finds nothing
    is re-run against the full transcript
  - sloppy locator output (code fences, "3" for "p3", invented pages,
    unknown question numbers) is tolerated, not trusted

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_copy_check_locate.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services.copy_check import locate
from ai_service.app.services.copy_check.grader import CopyCheckGrader
from ai_service.app.services.copy_check.prompt_builder import (
    _transcript_for_prompt,
    build_grading_prompt,
)

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        failures.append(f"{label}: {detail}")
        print(f"  FAIL  {label} — {detail}")


def _layout(n_pages: int, chars_per_page: int = 600) -> dict[str, Any]:
    pages = []
    for i in range(1, n_pages + 1):
        text = f"page {i} prose " * (chars_per_page // 14)
        pages.append({
            "page_id": f"p{i}",
            "vision_text": text,
            "lines": [
                {"line_id": f"p{i}_r1", "text": f"row one of page {i}"},
                {"line_id": f"p{i}_r2", "text": f"row two of page {i}"},
            ],
        })
    return {"pages": pages}


def _questions(n: int) -> list[dict[str, Any]]:
    return [
        {"question_id": f"q{i}", "question_text": f"Question number {i} text", "question_type": "LONG_ANSWER",
         "max_marks": 5, "question_number": i}
        for i in range(1, n + 1)
    ]


def test_parse_tolerates_sloppy_output() -> None:
    print("\nparse_locate_response — sloppy but usable output")
    qs = _questions(4)
    lm = _layout(5)
    content = '```json\n{"locations": {"1": ["p2"], "#2": [3, "p2"], "3": ["p9", "page 4"], "4": [], "7": ["p1"]}}\n```'
    got = locate.parse_locate_response(content, qs, lm)
    check("code fence stripped, q1 placed", got.get("q1") == ["p2"], str(got))
    check("'#2' and bare ints accepted, pages in copy order", got.get("q2") == ["p2", "p3"], str(got))
    check("invented p9 dropped, 'page 4' normalised", got.get("q3") == ["p4"], str(got))
    check("explicit [] kept as unattempted", got.get("q4") == [], str(got))
    check("unknown question number ignored", "q7" not in got and len(got) == 4, str(got))


def test_parse_bare_map_and_garbage() -> None:
    print("\nparse_locate_response — bare map / garbage")
    qs = _questions(2)
    lm = _layout(3)
    got = locate.parse_locate_response('Sure! {"1": ["p1"], "2": ["p3"]}', qs, lm)
    check("prose before JSON tolerated, bare map accepted", got == {"q1": ["p1"], "q2": ["p3"]}, str(got))
    try:
        locate.parse_locate_response("no json here", qs, lm)
        check("garbage raises", False, "no exception")
    except Exception:
        check("garbage raises", True)


def test_pages_for_question_window() -> None:
    print("\npages_for_question — located, neighbour window, whole copy")
    pages = [f"p{i}" for i in range(1, 11)]
    order = ["q1", "q2", "q3", "q4", "q5"]
    located = {"q1": ["p1"], "q2": ["p3", "p4"], "q4": ["p8"], "q5": []}
    check("located q2 gets p3-p4 ±1", locate.pages_for_question("q2", located, order, pages) == ["p2", "p3", "p4", "p5"],
          str(locate.pages_for_question("q2", located, order, pages)))
    check("first page clamps at p1", locate.pages_for_question("q1", located, order, pages) == ["p1", "p2"],
          str(locate.pages_for_question("q1", located, order, pages)))
    got = locate.pages_for_question("q3", located, order, pages)
    check("unplaced q3 → window between q2 (p4) and q4 (p8), ±1", got == ["p3", "p4", "p5", "p6", "p7", "p8", "p9"], str(got))
    got = locate.pages_for_question("q5", located, order, pages)
    check("explicit [] q5 → from q4 (p8) to end", got == ["p7", "p8", "p9", "p10"], str(got))
    check("no locations at all → None (whole copy)", locate.pages_for_question("q1", {}, order, pages) is None)
    check("unknown question → None", locate.pages_for_question("zz", located, order, pages) is None)
    only_last = {"q5": ["p9"]}
    got = locate.pages_for_question("q1", only_last, order, pages)
    check("nothing before → from p1 up to next placed", got == pages[:10] and got[0] == "p1", str(got))


def test_paper_order() -> None:
    print("\npaper_order — printed labels beat the (shuffled) request order")
    qs = [
        {"question_id": "a", "paper_label": "18", "question_number": 1},
        {"question_id": "b", "paper_label": "6", "question_number": 2},
        {"question_id": "c", "paper_label": "1", "question_number": 3},
        {"question_id": "d", "paper_label": "2.", "question_number": 4},
    ]
    check("sorted by printed number", locate.paper_order(qs) == ["c", "d", "b", "a"], str(locate.paper_order(qs)))
    qs2 = [{"question_id": "x", "question_number": 3}, {"question_id": "y", "question_number": 1}, {"question_id": "z"}]
    check("falls back to question_number then position", locate.paper_order(qs2) == ["y", "x", "z"], str(locate.paper_order(qs2)))
    qs3 = [
        {"question_id": "b2", "section": "B", "paper_label": "2"},
        {"question_id": "a1", "section": "A", "paper_label": "1"},
        {"question_id": "b1", "section": "B", "paper_label": "1"},
        {"question_id": "a2", "section": "A", "paper_label": "2"},
    ]
    check("sections stay together", locate.paper_order(qs3) == ["b1", "b2", "a1", "a2"], str(locate.paper_order(qs3)))


def test_transcript_is_narrowed() -> None:
    print("\n_transcript_for_prompt / build_grading_prompt — only the chosen pages go in")
    lm = _layout(40)
    full = _transcript_for_prompt(lm)
    narrow = _transcript_for_prompt(lm, ["p3", "p4"])
    check("full transcript lists every page", full.count("---- Page ") == 40, str(full.count("---- Page ")))
    check("narrowed lists two pages", narrow.count("---- Page ") == 2, str(narrow.count("---- Page ")))
    check("narrowed says which pages of how many", "p3, p4 of 40 pages" in narrow, narrow[:200])
    check("narrowed is an order of magnitude smaller", len(narrow) * 10 < len(full), f"{len(narrow)} vs {len(full)}")
    check("row ids of shown pages survive", "[p4_r2]" in narrow and "[p9_r1]" not in narrow)
    check("all pages requested → no note", "only the" not in _transcript_for_prompt(lm, [f"p{i}" for i in range(1, 41)]))
    check("unknown page ids only → falls back to every page", _transcript_for_prompt(lm, ["zz"]).count("---- Page ") == 40)

    q = _questions(1)[0]
    rubric = {"max_marks": 5, "rubric": [{"criteria_name": "c", "max_marks": 5}]}
    p_full = build_grading_prompt(q, rubric, lm)
    p_narrow = build_grading_prompt(q, rubric, lm, page_ids=["p3", "p4"])
    check("grading prompt honours page_ids", p_narrow.count("---- Page ") == 2 and p_full.count("---- Page ") == 40)


class _FakeLLM:
    """Records prompts; answers the locate call and grading calls from a script."""

    def __init__(self, locate_reply: str, grade_replies: list[str]) -> None:
        self.locate_reply = locate_reply
        self.grade_replies = list(grade_replies)
        self.calls: list[dict[str, Any]] = []

    async def chat_completion(self, messages, **kw):
        user = messages[-1]["content"]
        self.calls.append({"user": user, "kw": kw})
        if "The question paper (" in user:
            return {"content": self.locate_reply, "usage": {"prompt_tokens": 10, "completion_tokens": 5}}
        reply = self.grade_replies.pop(0)
        return {"content": reply, "usage": {"prompt_tokens": len(user) // 4, "completion_tokens": 50}}


def test_locate_answers_end_to_end() -> None:
    print("\nlocate_answers — small copy skipped, bad reply → {}, thin placement → {}")
    qs = _questions(4)
    llm = _FakeLLM('{"locations": {"1": ["p2"], "2": ["p3"], "3": ["p4"], "4": []}}', [])
    got = asyncio.run(locate.locate_answers(llm, qs, _layout(2), "m"))
    check("2-page copy: no call, {}", got == {} and llm.calls == [])
    got = asyncio.run(locate.locate_answers(llm, qs, _layout(6), "m"))
    check("6-page copy: one call, placements returned", got.get("q1") == ["p2"] and got.get("q4") == [] and len(llm.calls) == 1, str(got))
    check("locate prompt carries page prose and question list", "---- p6 ----" in llm.calls[0]["user"] and "#4  [Q4]" in llm.calls[0]["user"])
    check("locate runs cold", llm.calls[0]["kw"].get("temperature") == 0.0)

    llm = _FakeLLM("not json", [])
    check("garbage reply → {} (full transcript)", asyncio.run(locate.locate_answers(llm, qs, _layout(6), "m")) == {})
    llm = _FakeLLM('{"locations": {"1": [], "2": [], "3": [], "4": []}}', [])
    check("locator placed nothing → {} (do not trust it)", asyncio.run(locate.locate_answers(llm, qs, _layout(6), "m")) == {})

    class _Boom:
        async def chat_completion(self, *a, **k):
            raise RuntimeError("provider down")
    check("call failure → {}", asyncio.run(locate.locate_answers(_Boom(), qs, _layout(6), "m")) == {})


def test_grader_narrowed_call_and_token_drop() -> None:
    print("\nCopyCheckGrader.grade_question — page_ids reach the prompt; tokens drop")
    lm = _layout(40)
    q = _questions(1)[0]
    rubric = {"max_marks": 5, "rubric": [{"criteria_name": "c", "max_marks": 5}]}
    verdict = '{"marks_awarded": 4, "verdict": "partial", "extracted_answer": "x", "confidence": 0.9, "criteria_breakdown": [{"criteria_name": "c", "marks": 4, "reason": "ok"}], "annotations": []}'
    llm = _FakeLLM("", [verdict, verdict])
    g = CopyCheckGrader(llm)
    asyncio.run(g.grade_question(q, rubric, lm, None))
    full_len = len(llm.calls[-1]["user"])
    asyncio.run(g.grade_question(q, rubric, lm, None, ["p3", "p4"]))
    narrow_len = len(llm.calls[-1]["user"])
    check("narrowed grading prompt is far smaller", narrow_len * 5 < full_len, f"{narrow_len} vs {full_len}")
    check("narrowed prompt shows only p3/p4", llm.calls[-1]["user"].count("---- Page ") == 2)


def test_orchestrator_regrades_full_when_narrowed_finds_nothing() -> None:
    print("\n_looks_unattempted — what triggers the full-copy re-grade")
    from ai_service.app.services.copy_check.orchestrator import _looks_unattempted
    check("explicit verdict", _looks_unattempted({"verdict": "unattempted", "marks_awarded": 0}))
    check("shape of an unattempted answer", _looks_unattempted({"marks_awarded": 0, "extracted_answer": "", "annotations": []}))
    check("wrong answer is not unattempted", not _looks_unattempted({"marks_awarded": 0, "extracted_answer": "(b)", "annotations": [{"style": "cross"}]}))
    check("marks awarded is not unattempted", not _looks_unattempted({"marks_awarded": 2, "extracted_answer": ""}))
    check("bad marks value is not unattempted", not _looks_unattempted({"marks_awarded": "low", "extracted_answer": ""}))
    check("non-dict verdict is left to the validator", not _looks_unattempted(["not", "a", "dict"]))


def test_prompt_build_is_robust() -> None:
    print("\nbuild_locate_prompt — odd inputs never raise")
    lm = _layout(5)
    qs = [
        {"question_id": "q1", "question_text": None, "options": ["plain string", {"text": "dict"}, 7]},
        {"question_id": "q2", "question_text": "x" * 500, "question_type": None, "options": None},
    ]
    p = locate.build_locate_prompt(qs, lm)
    check("string/dict/int options all rendered", "(a) plain string; (b) dict; (c) 7" in p, p[-400:])
    check("long question text truncated", "x" * 161 not in p and "..." in p)
    lm["pages"][0]["vision_text"] = "y" * 5000
    prose = locate._page_prose(lm["pages"][0])
    check("page prose capped", len(prose) < 2500 and prose.endswith(" ..."), str(len(prose)))

    class _Boom:
        async def chat_completion(self, *a, **k):
            raise AssertionError("must not be called")
    check("prompt build failure → {} (no call)", asyncio.run(locate.locate_answers(_Boom(), [{"no_question_id": 1}], _layout(6), "m")) == {})


if __name__ == "__main__":
    test_parse_tolerates_sloppy_output()
    test_parse_bare_map_and_garbage()
    test_pages_for_question_window()
    test_paper_order()
    test_transcript_is_narrowed()
    test_locate_answers_end_to_end()
    test_grader_narrowed_call_and_token_drop()
    test_orchestrator_regrades_full_when_narrowed_finds_nothing()
    test_prompt_build_is_robust()
    print()
    if failures:
        print(f"{len(failures)} FAILED")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("all passed")
