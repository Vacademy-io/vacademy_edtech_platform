"""get_my_performance must surface the topic strengths/weaknesses the per-test AI
analysis stores ({topic: percent} maps or topic_analysis rows) and v2 progress
reports, and link the reports they come from."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import learner_tools as lt  # noqa: E402
from app.services.chat_cards import ToolOutput  # noqa: E402

ANALYSIS = {
    "strengths": {"Time, Speed & Distance": 83, "Computer Programming": 90},
    "weaknesses": {"Geometry": 40, "Mixtures & Allegation": 0},
    "areas_of_improvement": "- **Mixtures**: learn allegation.\n- **Geometry**: revise areas.",
    "misconception_analysis": [{"question_summary": "Dice", "misconception": "Opposite faces add to 7."}],
}
REPORT_V2 = {
    "meta": {"report_name": "October 2026 Progress Report"},
    "ai_insights": {"summary": "Steady effort, Maths needs work."},
    "strengths": [{"topic": "Physics", "confidence": 82}],
    "areas_to_improve": [{"topic": "Course Completion", "confidence": 0}],
}


def test_topic_split_reads_percent_maps():
    strong, weak = lt._topic_split(ANALYSIS)
    assert strong == ["Computer Programming (90%)", "Time, Speed & Distance (83%)"]
    assert weak == ["Mixtures & Allegation (0%)", "Geometry (40%)"]


def test_topic_split_prefers_topic_analysis():
    data = {**ANALYSIS, "topic_analysis": [
        {"topic": "Algebra", "questions_count": 10, "correct": 9, "accuracy": 90},
        {"topic": "Optics", "questions_count": 4, "correct": 1, "accuracy": 25},
    ]}
    assert lt._topic_split(data) == (["Algebra (9/10, 90%)"], ["Optics (1/4, 25%)"])


class _DB:
    def execute(self, stmt, params=None):
        sql = str(stmt)
        rows, first = [], None
        if "FROM activity_log" in sql and "llm_assessment" in sql:
            rows = [("a1", json.dumps(ANALYSIS), None)]
        elif "student_analysis_process" in sql:
            first = ("p1", json.dumps(REPORT_V2), None)
        return SimpleNamespace(all=lambda: rows, first=lambda: first,
                               mappings=lambda: SimpleNamespace(all=lambda: [], first=lambda: None))


def test_performance_links_the_reports(monkeypatch):
    async def fake_get(path, params):
        return {"results": [{"assessment_id": "a1", "attempt_id": "t1", "assessment_name": "Unit Test 1",
                             "marks": 40, "total_marks": 100}]}

    monkeypatch.setattr(lt, "_assessment_get", fake_get)
    out = asyncio.run(lt.get_my_performance(_DB(), "u1", "i1"))
    assert isinstance(out, ToolOutput)
    assert "strong topics: Computer Programming (90%)" in out.text
    assert "weak topics: Mixtures & Allegation (0%)" in out.text
    assert "misconceptions: Opposite faces add to 7." in out.text
    assert "Steady effort, Maths needs work." in out.text and "strengths: Physics" in out.text
    test, report = out.card["items"]
    assert test["href"].startswith("/assessment/reports/ai-report?assessmentId=a1")
    assert "attemptId=t1" in test["href"]
    assert test["subtitle"] == "Strong: Computer Programming, Time, Speed & Distance · Work on: Mixtures & Allegation, Geometry"
    assert report == {"title": "October 2026 Progress Report", "subtitle": "Progress report",
                      "href": "/my-reports/p1", "icon": "assessment"}
