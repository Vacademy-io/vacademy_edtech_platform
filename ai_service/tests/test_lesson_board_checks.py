"""Lesson board checks added after the first production corner-layout lesson:

- 60 s: "9 + 16 = 25" ran into the teacher's head — the shot ignored the
  "keep the corner clear" prompt and nothing measured it;
- 80 s: "c₂ = a₂ + b₂" (subscripts) while the teacher said "c squared";
- 5 s: board text sat under the burned-in captions.

The bbox lint now takes keep-out zones (teacher corner / caption strip) and
lessons run a notation lint + a model fact-check before the vision review.
The keep-out test drives the real render-worker walker in Chromium.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app" / "ai-video-gen-main"))
sys.path.insert(0, str(HERE.parent / "render_worker"))

import lesson_mode as lm  # noqa: E402

PLAN = lm.normalize_lesson_plan({"teacher": {"avatar_id": "37b77e8a-c2bd-413d-818f-810a59fcc14c"}, "layout": "corner"})


def test_corner_lessons_keep_the_teacher_clear_and_captions_get_their_own_band():
    area = lm.board_area("corner", 1920, 1080)
    z = lm.keep_out_zones(PLAN, "corner", 1920, 1080, canvas_w=area["w"], canvas_h=area["h"])
    box = lm.teacher_box("corner", 1920, 1080)
    assert z == [{"l": box["x"] - 16, "t": box["y"] - 16, "r": area["w"], "b": area["h"], "name": "teacher"}]
    # captions never need a zone: the shot canvas ends above the caption band
    assert area["h"] == lm.caption_band("corner", 1920, 1080)["y"]
    assert lm.keep_out_zones(PLAN, "side", 1920, 1080, canvas_w=1440, canvas_h=area["h"]) == []
    assert lm.keep_out_zones(None, "corner", 1920, 1080, canvas_w=1920, canvas_h=1080) == []
    block = lm.shot_prompt_block(PLAN, "corner", 1920, 1080)
    assert "SUPERSCRIPTS" in block and f"canvas is 1920×{area['h']}px" in block


def test_subscript_powers_are_flagged_only_when_the_teacher_says_squared():
    bad = "<div><span>c₂ = a₂ + b₂</span></div>"
    assert lm.notation_issues(bad, "c squared equals a squared plus b squared")
    assert not lm.notation_issues(bad, "water is H two O")              # chemistry subscripts are fine
    assert not lm.notation_issues("<div>c² = a² + b²</div>", "c squared equals a squared plus b squared")


def test_board_text_includes_katex_sources_and_drops_scripts():
    html = ("<style>.x{color:red}</style><h1>Solve for c</h1>"
            "<script>gsap.to('#a',{x:1}); katex.render(\"c^2 = 6^2 + 8^2\", el);</script>")
    t = lm.board_text(html)
    assert "Solve for c" in t and "c^2 = 6^2 + 8^2" in t and "gsap" not in t and "color:red" not in t


def test_fact_check_reply_becomes_a_concrete_correction():
    issues = lm.parse_fact_check({"errors": [{"board": "6² + 8² = 110", "problem": "36 + 64 is 100",
                                              "fix": "6² + 8² = 100"}, "junk"]})
    assert issues == ['"6² + 8² = 110" — 36 + 64 is 100 → write: "6² + 8² = 100"']
    assert lm.parse_fact_check({"errors": []}) == [] and lm.parse_fact_check(None) == []
    assert "6² + 8² = 100" in lm.correction_prompt(issues)


def _run(coro_fn):
    try:
        import playwright  # noqa: F401
        from screenshot_worker import ScreenshotWorker
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"playwright / worker not importable here: {exc}")

    async def go():
        w = ScreenshotWorker()
        try:
            return await coro_fn(w)
        except Exception as exc:  # pragma: no cover
            if "Executable doesn't exist" in str(exc) or "browserType.launch" in str(exc):
                pytest.skip(f"chromium not available: {exc}")
            raise
        finally:
            try:
                await w.close()
            except Exception:
                pass
    return asyncio.run(go())


SHOT = (
    '<div id="shot-root" style="position:absolute;inset:0;width:100%;height:100%;background:#1F3B2D">'
    '<div style="position:absolute;left:5%;top:5%;color:#fff;font:700 60px sans-serif">Area of squares</div>'
    '<div id="eq" style="position:absolute;left:1500px;top:640px;color:#fff;font:700 56px sans-serif">9 + 16 = 25</div>'
    "</div>"
)


def test_the_walker_reports_content_inside_the_teacher_corner():
    zones = lm.keep_out_zones(PLAN, "corner", 1920, 1080, canvas_w=1920, canvas_h=842)
    rows = _run(lambda w: w.bbox_check_shot(html=SHOT, width=1920, height=842, timestamps=[0.5],
                                            background="#1F3B2D", keep_out=zones))
    hits = [r for r in rows if r.get("zone") == "teacher"]
    assert hits and "9 + 16 = 25" in hits[0]["text"]
    assert not [r for r in rows if "Area of squares" in r.get("text", "")]
    # without zones the same shot is clean (it does not overflow the canvas)
    assert _run(lambda w: w.bbox_check_shot(html=SHOT, width=1920, height=842, timestamps=[0.5],
                                            background="#1F3B2D")) == []


SQUEEZED = (
    '<div id="shot-root" style="position:absolute;inset:0;width:100%;height:100%;background:#1F3B2D">'
    '<div style="position:absolute;left:100px;top:100px;width:420px;display:flex;gap:16px;color:#fff;font:600 30px sans-serif">'
    '<div style="flex:0 0 360px;height:80px;background:#333"></div>'
    '<div id="txt" style="min-width:0">Verify the 90° Right Angle</div></div>'
    '<div style="position:absolute;left:100px;top:600px;color:#fff;font:600 30px sans-serif">A normal sentence</div>'
    "</div>"
)


def test_the_walker_reports_text_squeezed_into_a_sliver():
    """The 2026-10-12 recap: a flex row left the text column ~40 px wide and
    "Verify the 90° Right Angle" rendered one syllable per line."""
    rows = _run(lambda w: w.bbox_check_shot(html=SQUEEZED, width=1920, height=842, timestamps=[0.5],
                                            background="#1F3B2D", check_squeeze=True))
    hits = [r for r in rows if r.get("zone") == "squeezed"]
    assert hits and "Verify" in hits[0]["text"]
    assert not [r for r in rows if "normal sentence" in r.get("text", "")]
    # off by default (non-lesson runs are unchanged)
    assert _run(lambda w: w.bbox_check_shot(html=SQUEEZED, width=1920, height=842, timestamps=[0.5],
                                            background="#1F3B2D")) == []


# ── proper nouns are never "errors" (prod: "ITRC" flagged as a garbled CHAPTER) ──

ITRC_BRANDING = {
    "intro": {"enabled": False, "html": "<h1>Vacademy</h1>"},          # disabled: not this run's brand
    "watermark": {"enabled": True, "html": "<div style='x'>ITRC Academy</div>"},
    "outro": {"enabled": True, "html": "<p>Thank you for watching, see you in the next class</p>"},
}


def test_known_proper_nouns_come_from_branding_teacher_and_the_prompts_caps():
    nouns = lm.known_proper_nouns(
        prompt="Make a lesson for ITRC students on Newton's laws for JEE. IMPORTANT: keep it short. I want AI-free maths.",
        branding=ITRC_BRANDING,
        teacher={"name": "Riya Sharma"},
    )
    assert "ITRC Academy" in nouns and "Riya Sharma" in nouns
    assert "ITRC" in nouns and "JEE" in nouns
    assert "IMPORTANT" not in nouns and "I" not in nouns
    assert "Vacademy" not in nouns                                     # disabled section ignored
    assert not [n for n in nouns if "Thank you" in n]                  # sentences are not names
    assert lm.known_proper_nouns() == []


def test_fact_check_prompt_lists_the_proper_nouns_as_correct():
    assert "KNOWN PROPER NOUNS" in lm.FACT_CHECK_SYSTEM
    p = lm.fact_check_user_prompt(narration="Welcome to ITRC.", board="ITRC — Chapter 3",
                                  subject="Physics", proper_nouns=["ITRC", "Riya Sharma"])
    assert "KNOWN PROPER NOUNS (correct as written — never report or change them): ITRC, Riya Sharma" in p
    assert p.index("KNOWN PROPER NOUNS") < p.index("NARRATION:")
    # no list → prompt unchanged from before
    assert "KNOWN PROPER NOUNS" not in lm.fact_check_user_prompt(narration="n", board="b", subject=None)


def test_a_checker_error_that_rewrites_a_proper_noun_is_dropped():
    reply = {"errors": [
        {"board": "ITRC", "problem": "garbled heading, should be CHAPTER", "fix": "CHAPTER"},
        {"board": "ITRC: Chapter 3", "problem": "garbled", "fix": "Chapter 3"},
        {"board": "6² + 8² = 110", "problem": "36 + 64 is 100", "fix": "6² + 8² = 100"},
        {"board": "ITRC: 2 + 2 = 5", "problem": "2 + 2 is 4", "fix": "ITRC: 2 + 2 = 4"},
    ]}
    issues = lm.parse_fact_check(reply, proper_nouns=["ITRC"])
    assert issues == ['"6² + 8² = 110" — 36 + 64 is 100 → write: "6² + 8² = 100"',
                      '"ITRC: 2 + 2 = 5" — 2 + 2 is 4 → write: "ITRC: 2 + 2 = 4"']
    # without the list the old behaviour is unchanged
    assert len(lm.parse_fact_check(reply)) == 4
    assert "Keep these proper nouns exactly as written: ITRC." in lm.correction_prompt(issues, ["ITRC"])


def test_proper_nouns_never_shield_formulas_shouted_words_or_real_errors():
    # formulas are notation the checker must still fix; a prompt in capitals
    # is shouting, not a list of names
    assert lm.known_proper_nouns(prompt="Explain H2SO4 and CO2 for ITRC") == ["ITRC"]
    assert lm.known_proper_nouns(prompt="MAKE A VIDEO ON PHOTOSYNTHESIS FOR CLASS 10 STUDENTS") == []
    reply = {"errors": [
        {"board": "H2SO4", "problem": "subscripts missing", "fix": "H₂SO₄"},
        # a real error on a line that mentions the name, fix drops the name
        {"board": "ITRC: 2 + 2 = 5", "problem": "2 + 2 is 4", "fix": "2 + 2 = 4"},
        # the name itself called misspelt → dropped
        {"board": "ITRC Chapter 3", "problem": "heading misspelt", "fix": "Chapter 3"},
    ]}
    nouns = lm.known_proper_nouns(prompt="Explain H2SO4 for ITRC students")
    assert lm.parse_fact_check(reply, proper_nouns=nouns) == [
        '"H2SO4" — subscripts missing → write: "H₂SO₄"',
        '"ITRC: 2 + 2 = 5" — 2 + 2 is 4 → write: "2 + 2 = 4"',
    ]
