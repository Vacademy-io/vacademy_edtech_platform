"""Vision review: a lesson gets a second corrective attempt.

With one attempt, a regen that was still severity 3 meant shipping the
ORIGINAL, which the reviewer had already called broken (video feadce4b,
2026-10-27: a list clipped at the right edge, a quote printed over the recap).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app" / "ai-video-gen-main"))

import automation_pipeline as ap  # noqa: E402
import shot_visual_reviewer as svr  # noqa: E402

BROKEN = {"severity_max": 3, "passes": False, "cost_usd": 0.0,
          "issues": [{"code": "TEXT_CLIPPED", "severity": 3, "description": "list runs off the right edge"}]}
FIXED = {"severity_max": 1, "passes": True, "cost_usd": 0.0, "issues": []}


class _Client:
    is_configured = True

    def take_shot_screenshots(self, **kw):
        return [SimpleNamespace(t=t, image_bytes=b"\x89PNG\r\n\x1a\nfake") for t in kw["timestamps"]]


class _LLM:
    def __init__(self):
        self.calls = []

    def chat(self, messages, **kw):
        self.calls.append(messages)
        return json.dumps({"html": f"<div id='shot-root'>attempt {len(self.calls)}</div>"}), {}


def _pipeline(monkeypatch, reviews, *, lesson: bool):
    p = object.__new__(ap.VideoGenerationPipeline)
    p._tier_config = {"shot_vision_review": True, "vision_review_regen_enabled": True,
                      "vision_review_run_cost_cap_usd": 10}
    p._lesson_plan = {"enabled": True, "layout": "board"} if lesson else None
    p._vision_review_skipped_count = 0
    p._vision_review_run_cost_usd = 0.0
    p._review_thumbnails = {}
    p._screenshot_client = _Client()
    p.html_client = _LLM()
    for name in ("_vision_review_emit_banner_once", "_emit_shot_substage", "_emit_shot_regen"):
        monkeypatch.setattr(p, name, lambda *a, **k: None, raising=False)
    monkeypatch.setattr(p, "_ensure_fonts", lambda h: h, raising=False)
    monkeypatch.setattr(p, "_lesson_canvas", lambda shot: (1920, 842), raising=False)
    monkeypatch.setattr(p, "_sanitize_html_content", lambda h: h, raising=False)
    monkeypatch.setattr(p, "_clamp_entry_animations", lambda h, d: h, raising=False)
    monkeypatch.setattr(p, "_resolve_vision_stage_model", lambda stage: "m", raising=False)
    monkeypatch.setattr(p, "_resolve_visual_style_mode", lambda: "educational", raising=False)
    seq = iter(reviews)
    monkeypatch.setattr(svr, "review_shot", lambda **kw: dict(next(seq)))
    return p


def _review(p):
    return p._review_shot_visually(
        html="<div id='shot-root'>original</div>", shot={"shot_type": "TEXT_DIAGRAM", "start_time": 0, "end_time": 10},
        shot_idx=8, start_time=0.0, end_time=10.0, system_prompt="sys", user_prompt="user",
        last_raw_response='{"html": "original"}', usage={},
    )


def test_a_lesson_shot_gets_a_second_attempt_that_builds_on_the_first(monkeypatch):
    p = _pipeline(monkeypatch, [BROKEN, BROKEN, FIXED], lesson=True)
    rec = _review(p)
    assert rec["shipped"] == "regen" and rec["regen_attempts"] == 2
    assert rec["regen_html"] == "<div id='shot-root'>attempt 2</div>"
    # attempt 2 corrects attempt 1's HTML, not the original's
    assert "attempt 1" in p.html_client.calls[1][2]["content"]


def test_two_failed_attempts_still_ship_the_original(monkeypatch):
    p = _pipeline(monkeypatch, [BROKEN, BROKEN, BROKEN], lesson=True)
    rec = _review(p)
    assert rec["shipped"] == "ship_original" and len(p.html_client.calls) == 2


@pytest.mark.parametrize("lesson", [False])
def test_other_videos_keep_one_attempt(monkeypatch, lesson):
    p = _pipeline(monkeypatch, [BROKEN, BROKEN, FIXED], lesson=lesson)
    rec = _review(p)
    assert rec["shipped"] == "ship_original" and len(p.html_client.calls) == 1
