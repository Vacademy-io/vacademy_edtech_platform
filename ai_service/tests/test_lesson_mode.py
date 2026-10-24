"""Lesson mode: an education video taught by a teacher at a board.

The reel planner capped body shots at 4 s and a video at 12 shots — at most
about a minute of content — so a "10-minute lesson" came back short or
crammed. Lesson mode swaps that rhythm for lesson pacing, writes the narration
as a teacher, keeps the teacher's part of the frame clear on every board shot,
and lays the Spatius teacher over the timeline in per-section layouts.
"""

import json
import os
import sys

_HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(_HERE, ".."))
sys.path.insert(0, os.path.join(_HERE, "..", "app", "ai-video-gen-main"))

import lesson_mode as lm  # noqa: E402
import narration_writer as nw  # noqa: E402
import shot_planner as sp  # noqa: E402
from app.services.timeline_coverage import _timeline_coverage  # noqa: E402

TEACHER = {"teacher": {"avatar_id": "37b77e8a-c2bd-413d-818f-810a59fcc14c", "name": "Riya Jain"}}


# ── config ───────────────────────────────────────────────────────────────────

def test_disabled_or_missing_lesson_is_off():
    assert lm.normalize_lesson_plan(None) is None
    assert lm.normalize_lesson_plan({"enabled": False, **TEACHER}) is None


def test_no_teacher_means_board_only():
    plan = lm.normalize_lesson_plan({"layout": "corner"})
    assert plan["teacher"] is None and plan["layout"] == "board"
    assert not lm.has_teacher(plan)


def test_unknown_layout_falls_back_to_auto():
    plan = lm.normalize_lesson_plan({**TEACHER, "layout": "sideways"})
    assert plan["layout"] == "auto" and lm.has_teacher(plan)


# ── planner ──────────────────────────────────────────────────────────────────

def test_lesson_pacing_replaces_the_reel_rhythm():
    out = lm.planner_system_prompt(sp.SHOT_PLANNER_SYSTEM_PROMPT)
    assert "Cap shot count at 12" in sp.SHOT_PLANNER_SYSTEM_PROMPT
    assert "Cap shot count at 12" not in out
    assert "min 2.5s, max 4.0s" not in out
    assert "LESSON PACING" in out
    # the rest of the contract is untouched
    assert "5. Total of all `duration_estimate_s`" in out


def test_lesson_override_is_appended_when_the_rule_moves():
    out = lm.planner_system_prompt("A prompt with no rhythm rule.")
    assert out.startswith("A prompt with no rhythm rule.")
    assert "LESSON MODE OVERRIDE" in out


def test_user_prompt_teaches_structure_and_layouts():
    plan = lm.normalize_lesson_plan({**TEACHER, "subject": "Mathematics"})
    up = sp.build_shot_planner_user_prompt(
        prompt="Explain the Pythagoras theorem", target_duration_s=600, target_audience="Class 8",
        language="English", content_type="VIDEO", tier="ultra", image_ratio="16:9", lesson=plan,
    )
    assert "LESSON MODE" in up and "about 55 teaching sections" in up
    assert "Worked example" in up and "Recap" in up
    assert "SUBJECT: Mathematics" in up
    for layout in ("presenter", "side", "corner", "board"):
        assert f'"{layout}"' in up


def _fake_chat(plan_body, seen):
    def chat(messages, **kw):
        seen.append(messages)
        return json.dumps(plan_body), {"total_tokens": 10}
    return chat


def _body(n, layouts=None):
    shots = []
    for i in range(n):
        s = {"shot_index": i, "shot_type": "EQUATION_BUILD" if i == 2 else "TEXT_DIAGRAM",
             "intent_role": "hook" if i == 0 else "explanation",
             "narration_brief": f"section {i}", "duration_estimate_s": 11}
        if layouts:
            s["teacher_layout"] = layouts[i]
        shots.append(s)
    return {"shots": shots, "continuity_notes": "", "recurring_motifs": []}


def test_plan_shots_uses_lesson_prompt_and_fills_missing_layouts():
    seen = []
    plan = lm.normalize_lesson_plan(TEACHER)
    out = sp.plan_shots(prompt="Pythagoras", target_duration_s=55, llm_chat=_fake_chat(_body(5), seen),
                        lesson=plan, enforce_concept=True)
    system = seen[0][0]["content"]
    assert "LESSON PACING" in system and "Cap shot count at 12" not in system
    layouts = [s["teacher_layout"] for s in out["shots"]]
    assert layouts[0] == "presenter"                                  # hook
    assert layouts[-1] == "side"                                      # recap needs the wider board
    assert layouts[2] == "corner"                                     # dense board
    assert layouts[1] == "side"
    assert len(seen) == 1   # no concept-conformance re-plan for lessons


def test_planner_layouts_are_kept_and_garbage_is_repaired():
    seen = []
    plan = lm.normalize_lesson_plan(TEACHER)
    out = sp.plan_shots(prompt="x", target_duration_s=33,
                        llm_chat=_fake_chat(_body(3, ["side", "teleport", "board"]), seen), lesson=plan)
    assert [s["teacher_layout"] for s in out["shots"]] == ["side", "side", "board"]


def test_user_fixed_layout_wins_over_the_planner():
    plan = lm.normalize_lesson_plan({**TEACHER, "layout": "corner"})
    out = sp.plan_shots(prompt="x", target_duration_s=33,
                        llm_chat=_fake_chat(_body(3, ["presenter", "side", "board"]), []), lesson=plan)
    assert {s["teacher_layout"] for s in out["shots"]} == {"corner"}


def test_non_lesson_runs_are_untouched():
    seen = []
    out = sp.plan_shots(prompt="x", target_duration_s=33, llm_chat=_fake_chat(_body(3), seen),
                        enforce_concept=False)
    assert "RHYTHM PROFILE" in seen[0][0]["content"]
    assert all("teacher_layout" not in s for s in out["shots"])


# ── narration ────────────────────────────────────────────────────────────────

def test_teaching_voice_reaches_the_narration_writer():
    seen = []

    def chat(messages, **kw):
        seen.append(messages)
        return json.dumps({"shots": [{"shot_index": 0, "narration_text": "Look at this right angle."}]}), {}

    shots = {"shots": [{"shot_index": 0, "shot_type": "TEXT_DIAGRAM", "narration_brief": "x",
                        "duration_estimate_s": 2, "audio_policy": "narration_only"}]}
    try:
        nw.write_narration(shot_plan=shots, llm_chat=chat, teaching_voice=True)
    except Exception:
        pass  # quality gates may complain about the toy plan; the prompt is what we check
    assert "YOU ARE THE TEACHER" in seen[0][0]["content"]

    seen.clear()
    try:
        nw.write_narration(shot_plan=shots, llm_chat=chat)
    except Exception:
        pass
    assert "YOU ARE THE TEACHER" not in seen[0][0]["content"]


# ── per-shot board block ─────────────────────────────────────────────────────

def test_shot_block_reserves_the_teacher_area():
    plan = lm.normalize_lesson_plan(TEACHER)
    side = lm.shot_prompt_block(plan, "side", 1920, 1080)
    assert "TEACHER SAFE AREA" in side and "x ≥ 1424px" in side and "x ∈ [0, 1440]px" in side
    corner = lm.shot_prompt_block(plan, "corner", 1920, 1080)
    assert "bottom-right corner" in corner
    board = lm.shot_prompt_block(plan, "board", 1920, 1080)
    assert "TEACHER SAFE AREA" not in board and "BUILD UP" in board


# ── geometry ─────────────────────────────────────────────────────────────────

def test_teacher_boxes_fit_the_frame_and_clips_are_even():
    for w, h in ((1920, 1080), (1080, 1920)):
        for layout in lm.TEACHER_LAYOUTS:
            b = lm.teacher_box(layout, w, h)
            assert b["x"] >= 0 and b["y"] >= 0 and b["x"] + b["w"] <= w and b["y"] + b["h"] <= h
            cw, ch = lm.clip_size(layout, w, h)
            assert cw % 2 == 0 and ch % 2 == 0 and cw <= b["w"] and ch <= b["h"]
    assert lm.teacher_box("board", 1920, 1080) is None
    assert lm.teacher_box("side", 1920, 1080) == {"x": 1440, "y": 0, "w": 480, "h": 1080}


# ── timeline ─────────────────────────────────────────────────────────────────

def _entry(i, t0, t1, sub=None):
    return {"id": f"shot-{i}" + (f"-sub{sub}" if sub is not None else ""), "inTime": t0, "exitTime": t1, "html": "<div/>"}


def test_runs_merge_same_layout_and_break_on_board():
    entries = [_entry(0, 3, 10), _entry(1, 10, 21), _entry(2, 21, 30), _entry(3, 30, 40), _entry(4, 40, 52),
               {"id": "branding-watermark", "inTime": 3, "exitTime": 52, "html": ""}]
    layouts = {0: "presenter", 1: "side", 2: "side", 3: "board", 4: "corner"}
    runs = lm.teacher_runs(entries, layouts)
    assert [(r["layout"], r["start"], r["end"]) for r in runs] == [
        ("presenter", 3, 10), ("side", 10, 30), ("corner", 40, 52)]


def test_sub_shots_belong_to_their_parent_section():
    entries = [_entry(0, 0, 5, sub=0), _entry(0, 5, 9, sub=1), _entry(1, 9, 20)]
    runs = lm.teacher_runs(entries, {0: "side", 1: "side"})
    assert [(r["start"], r["end"]) for r in runs] == [(0, 20)]


def test_teacher_entries_are_overlays_the_coverage_gate_ignores(tmp_path):
    runs = [{"layout": "presenter", "start": 0.0, "end": 9.0}, {"layout": "corner", "start": 9.0, "end": 20.0}]
    teacher = {"avatar_id": "a", "name": "Riya <b>Jain</b>", "title": "Maths"}
    entries = lm.build_teacher_entries(runs, ["https://x/t0.webm", None], width=1920, height=1080,
                                       teacher=teacher, palette={"background": "#FFFFFF", "text": "#111111"})
    assert len(entries) == 1   # a failed clip is skipped, not shipped empty
    e = entries[0]
    assert e["id"].startswith("snippet-teacher-")   # renderer seeks <video> in snippet-* hosts
    assert e["z"] > 10 and (e["htmlStartX"], e["htmlEndX"]) == (1920 - 690, 1920)
    assert 'src="https://x/t0.webm"' in e["html"] and "muted" in e["html"]
    assert "<b>" not in e["html"] and "Riya &lt;b&gt;Jain" in e["html"]

    shot_html = "<div id='shot-root'>" + ("<p>Pythagoras board content</p>" * 20) + "</div>"
    shots = [dict(_entry(0, 0, 9), html=shot_html), dict(_entry(1, 9, 20), html=shot_html)]
    tl = tmp_path / "timeline"
    tl.mkdir()
    (tl / "time_based_frame.json").write_text(json.dumps({
        "meta": {"shots": [{"shot_idx": 0}, {"shot_idx": 1}]},
        "entries": shots + entries,
    }))
    cov = _timeline_coverage(tmp_path)
    assert cov["missing"] == [] and cov["present"] == 2


def test_captions_sit_in_the_band_left_of_any_teacher():
    for layout in lm.TEACHER_LAYOUTS + ("board",):
        band = lm.caption_band(layout, 1920, 1080)
        cb = lm.caption_box(layout, 1920, 1080)
        assert band["y"] + band["h"] == 1080 and band["y"] < cb["cy"] < 1080
        box = lm.teacher_box(layout, 1920, 1080)
        if box:
            assert cb["x"] + cb["w"] <= box["x"]
    # portrait panel layouts: the band sits above the teacher band
    pb = lm.caption_band("side", 1080, 1920)
    assert pb["y"] + pb["h"] == lm.teacher_box("side", 1080, 1920)["y"]


def test_every_lesson_shot_gets_its_board_canvas_above_the_band():
    shots = [dict(_entry(i, t0, t1), htmlStartX=0, htmlStartY=0, htmlEndX=1920, htmlEndY=1080)
             for i, (t0, t1) in enumerate([(0, 9), (9, 20), (20, 31), (31, 40)])]
    runs = [{"layout": "presenter", "start": 0, "end": 9}, {"layout": "side", "start": 9, "end": 20},
            {"layout": "corner", "start": 20, "end": 31}, {"layout": "side", "start": 31, "end": 40}]
    eff = lm.effective_layouts({0: "presenter", 1: "side", 2: "corner", 3: "side"}, runs,
                               ["a", "b", "c", None], shots)
    assert eff == {0: "presenter", 1: "side", 2: "corner", 3: "board"}   # failed clip → board
    assert lm.fit_shots_to_board(shots, eff, width=1920, height=1080) == 4
    band_y = lm.caption_band("board", 1920, 1080)["y"]
    assert [(s["htmlEndX"], s["htmlEndY"]) for s in shots] == [
        (1230, band_y), (1440, band_y), (1920, band_y), (1920, band_y)]
    bands = lm.build_band_entries(shots, eff, width=1920, height=1080)
    # corner and board share the band's geometry but not the caption box
    # (corner captions stop short of the teacher), so they stay separate
    assert [b["htmlEndX"] for b in bands] == [1230, 1440, 1920, 1920]
    assert bands[2]["entry_meta"]["caption_box"]["w"] < bands[3]["entry_meta"]["caption_box"]["w"]
    assert all(b["entry_meta"]["kind"] == "lesson_band" and b["z"] < lm.TEACHER_Z for b in bands)
    plan = lm.normalize_lesson_plan(TEACHER)
    assert f"canvas is 1440×{band_y}px" in lm.shot_prompt_block(plan, "side", 1920, 1080)
    assert f"canvas is 1920×{band_y}px" in lm.shot_prompt_block(plan, "corner", 1920, 1080)


def test_corner_name_label_is_readable_on_dark_and_light_boards():
    # The label once used a white pill with the palette's text colour — on a
    # dark (chalkboard) palette that is light text on white: invisible.
    for pal in ({"background": "#1F3B2D", "text": "#F0ECE0"}, {"background": "#FBFAF6", "text": "#1F2A44"}):
        html = lm.teacher_entry_html(layout="corner", clip_url="u", width=1920, height=1080,
                                     teacher={"name": "Riya"}, palette=pal)
        colors = lm.panel_colors(pal)
        assert f"background:{colors['panel']}" in html and f"color:{colors['text']}" in html
        assert "rgba(255,255,255" not in html



def test_teacher_never_takes_more_than_about_a_third_of_the_frame():
    # Feedback on the first prod lesson: the teacher took too much space
    # (side was a third, presenter half the frame).
    for layout, max_frac in (("corner", 0.10), ("bubble", 0.04), ("side", 0.26), ("presenter", 0.37)):
        b = lm.teacher_box(layout, 1920, 1080)
        assert b["w"] * b["h"] / (1920 * 1080) <= max_frac, layout


def test_bubble_is_a_round_overlay_on_the_full_width_board():
    b = lm.teacher_box("bubble", 1920, 1080)
    assert b["w"] == b["h"] == 270 and b["x"] + b["w"] < 1920 and b["y"] + b["h"] < 1080
    html = lm.teacher_entry_html(layout="bubble", clip_url="u", width=1920, height=1080,
                                 teacher={"name": "Riya"}, palette=None)
    assert "border-radius:50%" in html and "object-fit:cover" in html and "Riya" in html
    assert lm.board_area("bubble", 1920, 1080)["w"] == 1920
    assert "bottom-right corner" in lm.shot_prompt_block(lm.normalize_lesson_plan(TEACHER), "bubble", 1920, 1080)
    assert lm.normalize_lesson_plan({**TEACHER, "layout": "bubble"})["layout"] == "bubble"


