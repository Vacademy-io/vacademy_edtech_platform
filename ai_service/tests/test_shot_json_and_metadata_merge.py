"""Two ways a finished shot or a run's metadata got thrown away (2026-10-12,
first production lesson run "Shipped 11 of 13 shots").

1. Models write multi-line <script> / comment blocks with RAW newlines inside
   the JSON "html" string. Strict json.loads rejects that, so a complete shot
   failed 3 attempts and shipped as a fallback card.
2. The coverage gate wrote update_metadata(video_id, {"shot_coverage": ...});
   update_metadata replaces the whole column, so every run that tripped the
   gate lost user_selections, host outputs, the lesson plan and billing.
"""

import ast
import json
import os
import re

_HERE = os.path.dirname(__file__)
_PIPELINE = os.path.join(_HERE, "..", "app", "ai-video-gen-main", "automation_pipeline.py")
_SERVICE = os.path.join(_HERE, "..", "app", "services", "video_generation_service.py")


def _load_extract():
    src = open(_PIPELINE, encoding="utf-8").read()
    tree = ast.parse(src)
    keep = {"_extract_json_blob", "_repair_trailing_html_field", "_JSON_ESCAPE", "_JSON_ESCAPE_MAP"}
    nodes = [
        n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in keep)
        or (isinstance(n, ast.Assign) and any(getattr(t, "id", "") in keep for t in n.targets))
    ]
    import typing
    ns = {"json": json, "re": re, "Any": typing.Any, "Optional": typing.Optional, "Dict": typing.Dict}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), _PIPELINE, "exec"), ns)
    return ns["_extract_json_blob"]


def test_raw_newlines_inside_the_html_string_parse():
    extract = _load_extract()
    raw = '{"offsetSeconds":0,"html":"<style>a{}</style><script>\n/* plan\n   0.10s title\n*/\ngsap.to(\'#a\',{opacity:1});\n</script>"}'
    with __import__("pytest").raises(json.JSONDecodeError):
        json.loads(raw)
    data = extract(raw)
    assert data["html"].startswith("<style>") and "\n/* plan" in data["html"]


def test_raw_newlines_also_parse_when_prose_surrounds_the_object():
    extract = _load_extract()
    raw = 'Here you go:\n{"html":"<div>\n\tx</div>","z":10}\nDone.'
    assert extract(raw) == {"html": "<div>\n\tx</div>", "z": 10}


def test_coverage_gate_merges_instead_of_replacing_metadata():
    src = open(_SERVICE, encoding="utf-8").read()
    assert 'update_metadata(\n                                    video_id, {"shot_coverage": _cov}' not in src
    assert '_emeta_cov["shot_coverage"] = _cov' in src


def test_raw_double_quotes_inside_the_trailing_html_are_repaired():
    """2026-10-12 lesson: a /* timeline */ comment quoted the narration with raw
    double quotes — invalid JSON even with strict=False — and the shot failed
    3 attempts and shipped a fallback card."""
    extract = _load_extract()
    raw = ('{\n  "offsetSeconds": 0,\n  "durationSeconds": 11.7,\n  "z": 10,\n  "html": '
           '"<div id=\\"shot-root\\">Rule</div><script>/* TIMELINE\n   0.10s Title ("Another key rule...")\n*/\n'
           'gsap.to(\'#t\',{opacity:1});</script>"}')
    data = extract(raw)
    assert data["durationSeconds"] == 11.7 and data["z"] == 10
    assert data["html"].startswith('<div id="shot-root">') and '("Another key rule...")' in data["html"]
