"""Render speed, lesson count-ups, JSON-checked fix-up regens and an honest
cost report (2026-10-27, from the ITRC lesson's run data)."""
from __future__ import annotations

import __future__
import ast
import contextvars
import json
import re
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

HERE = Path(__file__).resolve().parent
PIPELINE_DIR = HERE.parent / "app" / "ai-video-gen-main"
PIPELINE = PIPELINE_DIR / "automation_pipeline.py"
RENDERER = PIPELINE_DIR / "generate_video.py"
sys.path.insert(0, str(PIPELINE_DIR))

import cost_event_tracker as cet  # noqa: E402
import lesson_mode as lm  # noqa: E402

_FUTURE = __future__.annotations.compiler_flag


def _lift(path: Path, names: Sequence[str], ns: Dict[str, Any], cls_methods=None) -> Dict[str, Any]:
    tree = ast.parse(path.read_text())
    body: List[ast.stmt] = []
    for name in names:
        for n in tree.body:
            if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name == name:
                body.append(n)
            elif isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in n.targets):
                body.append(n)
    for cls_name, methods in (cls_methods or {}).items():
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == cls_name)
        fns = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in methods]
        body.append(ast.ClassDef(name=cls_name, bases=[], keywords=[], body=fns, decorator_list=[]))
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), str(path), "exec",
                 flags=_FUTURE, dont_inherit=True), ns)
    return ns


def _ns() -> Dict[str, Any]:
    return {"json": json, "re": re, "sys": sys, "Any": Any, "Dict": Dict, "List": List, "Optional": Optional,
            "Sequence": Sequence, "Tuple": Tuple, "Callable": Callable, "Path": Path,
            "_llm_stage": contextvars.ContextVar("_llm_stage", default="unknown"),
            "_llm_phase": contextvars.ContextVar("_llm_phase", default="base")}


# --------------------------------------------------------------------------
# 1. Render speed
# --------------------------------------------------------------------------

def test_shot_html_is_sent_only_when_the_page_has_not_mounted_it():
    """The dispatcher reads html only on mount; re-sending ~50 KB per active
    shot every frame was most of the per-frame cost."""
    src = RENDERER.read_text()
    loop = src[src.index("for frame_index in range(_render_start, _render_end):"):][:3000]
    assert 'e.get("id") not in _mounted_ids else {k: v for k, v in e.items() if k != "html"}' in loop
    assert "window.__updateSnippets(entries)" in loop and "_send," in loop
    # what counts as mounted comes from the page, not from what we sent
    assert "Array.from((window.__activeSnippets || new Map()).keys())" in loop


def test_images_stay_file_urls_instead_of_data_uris(tmp_path):
    png = tmp_path / "a.png"
    png.write_bytes(b"\x89PNG fake")
    other = tmp_path / "doc.bin"
    other.write_bytes(b"x")
    ns = _lift(RENDERER, ["_MEDIA_KEEP_AS_FILE_URL", "_path_to_data_uri", "_convert_file_urls_to_data_uris"],
               {**_ns(), "base64": __import__("base64")})
    html = f'<img src="file://{png}"><video src="file://{tmp_path}/t.webm"></video><x src="file://{other}">'
    out = ns["_convert_file_urls_to_data_uris"](html)
    assert f'src="file://{png}"' in out and "data:image" not in out
    assert f'src="file://{tmp_path}/t.webm"' in out
    assert "data:" in out  # unknown types are still inlined as before


# --------------------------------------------------------------------------
# 2. Lesson fact-check reads count-ups at their final value
# --------------------------------------------------------------------------

ITRC_SHOT_24 = (
    "<div>Territory revenue up <span id='s23_n1p' style='font-weight:700'>0</span>% in year one</div>"
    "<div>Led a team of 6 · <span id='s23_n2p'>0</span>% of target</div><script>"
    "const s23c1={v:0};const s23c2={v:0};"
    "gsap.to(s23c1,{v:40,duration:1.0,delay:8.6,ease:'power2.out',onUpdate:function(){"
    "document.getElementById('s23_n1p').textContent=Math.round(s23c1.v)}});"
    "gsap.to(s23c2,{v:120,duration:1.0,delay:9.2,ease:'power2.out',onUpdate:function(){"
    "document.getElementById('s23_n2p').textContent=Math.round(s23c2.v)}});</script>"
)


def test_the_itrc_counters_read_at_their_final_value():
    text = lm.board_text(ITRC_SHOT_24)
    assert "Territory revenue up 40 % in year one" in text
    assert "120 % of target" in text
    assert " 0 %" not in text


def test_other_counter_idioms():
    cases = [
        ("<span id='a'>0</span><script>gsap.to('#a',{innerText:97,snap:{innerText:1}})</script>", "97"),
        ("<b id=\"r\">0.0</b><script>const o={x:0};gsap.to(o,{x:4.7,onUpdate:()=>{"
         "document.getElementById('r').textContent=o.x.toFixed(1)}})</script>", "4.7"),
        ("<i id='z'>0</i><script>gsap.fromTo(c,{n:0},{n:1200,onUpdate(){"
         "document.querySelector('#z').innerText=Math.round(c.n)}})</script>", "1200"),
    ]
    for html, want in cases:
        assert lm.board_text(html) == want, html


def test_static_numbers_are_untouched():
    assert lm.board_text("<p>Revenue up <b>12</b>% — <span id='n'>3</span> rooms</p>") == "Revenue up 12 % — 3 rooms"


# --------------------------------------------------------------------------
# 3. Fix-up regens: JSON-checked reply, one retry, failures recorded
# --------------------------------------------------------------------------

def _client(replies: List[str]):
    ns = _lift(PIPELINE, ["_JSON_RETRY_NUDGE", "_json_failure_hint", "_extract_json_blob",
                          "_repair_trailing_html_field", "_JSON_ESCAPE", "_JSON_ESCAPE_MAP",
                          "_llm_stage_label"], _ns(),
               {"OpenRouterClient": ["_ensure_json_reply", "_record_outcome"]})
    calls: List[List[Dict[str, str]]] = []
    client = object.__new__(ns["OpenRouterClient"])
    client.cost_events = cet.CostEventTracker()

    def chat(messages, model=None, temperature=0.6, max_tokens=2000, response_format=None):
        calls.append(list(messages))
        return replies[len(calls) - 1], {"prompt_tokens": 10, "completion_tokens": 5}

    client.chat = chat
    return client, calls, ns


def test_a_valid_reply_is_returned_untouched():
    client, calls, _ = _client([])
    out, usage = client._ensure_json_reply('{"html": "<div></div>"}', {"completion_tokens": 3},
                                           [{"role": "user", "content": "fix"}], "m", 0.4, 100, None)
    assert out == '{"html": "<div></div>"}' and calls == []


def test_a_cut_off_reply_is_retried_once_and_the_failure_booked(capsys):
    client, calls, _ = _client(['{"html": "<div>fixed</div>"}'])
    out, usage = client._ensure_json_reply('{"html": "<div>cut', {"completion_tokens": 100},
                                           [{"role": "user", "content": "fix"}], "z-ai/glm-5.3-flash", 0.4, 100, None)
    assert json.loads(out)["html"] == "<div>fixed</div>"
    assert calls[0][-1]["role"] == "user" and "could not be parsed as JSON" in calls[0][-1]["content"]
    assert usage["completion_tokens"] == 105, "both calls' tokens are counted"
    log = capsys.readouterr().out
    assert "cut off; 18 chars, 100/100 completion tokens" in log
    report = client.cost_events.build_report(video_id="v", tier="t", pipeline_version="v3")
    assert report["summary"]["outcomes"] == {"parse_failed": 1}


def test_a_second_bad_reply_is_returned_for_the_caller_to_handle(capsys):
    client, calls, _ = _client(["still {not json"])
    out, _ = client._ensure_json_reply("nope", {}, [{"role": "user", "content": "fix"}], "m", 0.4, 50, None)
    assert out == "still {not json" and len(calls) == 1
    assert "retry was not valid JSON either" in capsys.readouterr().out
    assert client.cost_events.build_report(video_id="v", tier="t", pipeline_version="v3")["summary"]["outcomes"] == {
        "parse_failed": 2}


def test_every_fix_up_regen_asks_for_a_json_checked_reply():
    src = PIPELINE.read_text()
    assert src.count("expect_json=True,") >= 6
    for stage in ("brand_asset_regen_shot_", "lesson_fact_regen_shot_", "bbox_lint_regen_shot_",
                  "creativity_critic_regen_shot_", "anim_validator_regen_shot_"):
        i = src.index(f"_llm_stage.set(f\"{stage}")
        assert "expect_json=True," in src[i:i + 2500], stage


# --------------------------------------------------------------------------
# 4. Cost report: priced LLM events, real stage names
# --------------------------------------------------------------------------

def test_llm_events_are_priced_from_the_registry_when_the_vendor_reports_none():
    t = cet.CostEventTracker()
    t.record_llm(stage="shot_html", model="z-ai/glm-5.3-flash",
                 usage={"prompt_tokens": 1_000_000, "completion_tokens": 1_000_000})
    t.record_llm(stage="judge", model="google/gemini-2.5-flash",
                 usage={"prompt_tokens": 10, "completion_tokens": 10}, cost_usd=0.002)
    t.record_image(stage="image_support_visual", model="qwen/qwen-image-2.1-turbo", cost_usd=0.0184,
                   purpose="support_visual")
    prices = {"z-ai/glm-5.3-flash": (0.027 / 1e6, 0.49 / 1e6)}
    r = t.build_report(video_id="v", tier="t", pipeline_version="v3", price_lookup=prices.get)
    glm, gem, img = r["stages"]
    assert glm["cost_usd"] == 0.517 and glm["cost_source"] == "registry"
    assert gem["cost_usd"] == 0.002 and gem["cost_source"] == "vendor"
    assert "cost_source" not in img
    assert r["summary"]["llm_usd"] == 0.519
    assert r["summary"]["total_usd"] == round(0.517 + 0.002 + 0.0184, 4)


def test_without_a_lookup_unpriced_llm_events_are_counted_not_hidden():
    t = cet.CostEventTracker()
    t.record_llm(stage="s", model="unknown/model", usage={"prompt_tokens": 5, "completion_tokens": 5})
    r = t.build_report(video_id="v", tier="t", pipeline_version="v3", price_lookup=lambda m: None)
    assert r["summary"]["llm_unpriced_events"] == 1 and "cost_usd" not in r["stages"][0]


def test_a_broken_price_lookup_never_fails_the_report():
    t = cet.CostEventTracker()
    t.record_llm(stage="s", model="m", usage={"prompt_tokens": 5, "completion_tokens": 5})

    def boom(_m):
        raise RuntimeError("db down")

    assert t.build_report(video_id="v", tier="t", pipeline_version="v3", price_lookup=boom)["summary"]["llm_usd"] == 0


def test_an_unlabelled_call_is_booked_under_its_caller():
    ns = _lift(PIPELINE, ["_llm_stage_label"], _ns())
    label = ns["_llm_stage_label"]

    def chat():  # stands in for OpenRouterClient.chat
        return label()

    def _generate_shot_html():
        return chat()

    assert _generate_shot_html() == "fn:_generate_shot_html"
    ns["_llm_stage"].set("vision_review_shot_3")
    assert _generate_shot_html() == "vision_review_shot_3"


def test_the_report_is_built_with_the_registry_lookup():
    src = PIPELINE.read_text()
    i = src.index("cost_breakdown = self._cost_events.build_report(")
    assert "price_lookup=_registry_llm_price" in src[i:i + 200]
    assert "cost_usd=_image_cost_usd(usage) or 0.0" in src
