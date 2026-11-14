"""Lesson board in the institute's colours (2026-10-27): ITRC's blue lesson
came out on the template's green chalkboard, the brand only in accents."""
from __future__ import annotations

import __future__
import ast
import colorsys
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
PIPELINE_DIR = HERE.parent / "app" / "ai-video-gen-main"
PIPELINE = PIPELINE_DIR / "automation_pipeline.py"
sys.path.insert(0, str(PIPELINE_DIR))

from prompts import BACKGROUND_PRESETS  # noqa: E402
from video_templates import get_template_by_id  # noqa: E402

_FUTURE = __future__.annotations.compiler_flag


def _ns() -> Dict[str, Any]:
    tree = ast.parse(PIPELINE.read_text())
    want = {"_hex_rgb", "_brand_board_shade", "_brand_tint_light", "_reads_on_dark_board"}
    body = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in want]
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "VideoGenerationPipeline")
    body.append(ast.ClassDef(name="VideoGenerationPipeline", bases=[], keywords=[], decorator_list=[],
                             body=[n for n in cls.body if isinstance(n, ast.FunctionDef)
                                   and n.name in ("_generate_style_guide", "_ensure_fonts")]))
    ns: Dict[str, Any] = {"re": re, "json": json, "Any": Any, "Dict": Dict, "List": List, "Optional": Optional,
                          "Tuple": Tuple, "Path": Path, "BACKGROUND_PRESETS": BACKGROUND_PRESETS,
                          "_get_template_by_id": get_template_by_id}
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), str(PIPELINE), "exec",
                 flags=_FUTURE, dont_inherit=True), ns)
    return ns


NS = _ns()
ITRC = {"layout_theme": "chalkboard", "primary_color": "#005090", "accent_color": "#c99540"}


def _contrast(a: str, b: str) -> float:
    def lum(h):
        r, g, b_ = NS["_hex_rgb"](h)
        lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, b_)]
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def _guide(tmp_path, *, lesson: bool, style=ITRC):
    pipe = object.__new__(NS["VideoGenerationPipeline"])
    pipe._lesson_plan = {"subject": "x"} if lesson else None
    return pipe, pipe._generate_style_guide("script", tmp_path, background_type="black", style_config=dict(style))


def test_the_board_is_a_deep_shade_of_the_brand_colour():
    board = NS["_brand_board_shade"]("#005090")
    h, l, s = colorsys.rgb_to_hls(*NS["_hex_rgb"](board))
    h0, _, _ = colorsys.rgb_to_hls(*NS["_hex_rgb"]("#005090"))
    assert abs(h - h0) < 0.02 and abs(l - 0.13) < 0.01      # same hue, deep
    assert _contrast(board, "#f0ece0") > 10                    # chalk text stays readable
    assert NS["_brand_board_shade"]("not a colour") is None


def test_highlights_must_read_on_a_dark_board():
    assert NS["_reads_on_dark_board"]("#c99540")      # ITRC gold
    assert not NS["_reads_on_dark_board"]("#003a6b")  # ITRC navy
    assert not NS["_reads_on_dark_board"](None)


def test_a_lesson_run_gets_the_brand_board_and_highlight(tmp_path):
    pipe, sg = _guide(tmp_path, lesson=True)
    pal = sg["palette"]
    assert pal["background"] == NS["_brand_board_shade"]("#005090")
    assert pal["annotation_color"] == "#c99540"
    assert pal["text"] == "#f0ece0"
    # ITRC blue is too dark to draw with on its own navy board: same hue, light
    assert pal["primary"] == pal["svg_stroke"] == NS["_brand_tint_light"]("#005090")
    assert _contrast(pal["svg_stroke"], pal["background"]) > 4.5
    assert _contrast(pal["annotation_color"], pal["background"]) > 4.5
    assert pipe._board_color_swap == ("#1a3a2a", pal["background"])


def test_a_light_brand_colour_is_used_as_is(tmp_path):
    _, sg = _guide(tmp_path, lesson=True, style={"layout_theme": "chalkboard", "primary_color": "#ffb703"})
    assert sg["palette"]["primary"] == "#ffb703" == sg["palette"]["annotation_color"]


def test_other_videos_keep_the_template_board(tmp_path):
    pipe, sg = _guide(tmp_path, lesson=False)
    assert sg["palette"]["background"] == "#1a3a2a"
    assert getattr(pipe, "_board_color_swap", None) is None


def test_no_brand_colour_keeps_the_template_board(tmp_path):
    _, sg = _guide(tmp_path, lesson=True, style={"layout_theme": "chalkboard"})
    assert sg["palette"]["background"] == "#1a3a2a"


def test_a_dark_accent_does_not_become_the_highlight(tmp_path):
    _, sg = _guide(tmp_path, lesson=True, style={**ITRC, "accent_color": "#003a6b"})
    assert sg["palette"]["annotation_color"] == "#ffcc44"   # template chalk yellow kept


def test_hard_coded_template_green_in_a_shot_follows_the_brand_board():
    pipe = object.__new__(NS["VideoGenerationPipeline"])
    pipe._board_color_swap = ("#1a3a2a", "#0f2433")
    html = "<!--vx-preamble--><div style='background:#1A3A2A'>x</div><i style='color:#1a3a2a'></i>"
    out = pipe._ensure_fonts(html)
    assert "1a3a2a" not in out.lower() and out.count("#0f2433") == 2
