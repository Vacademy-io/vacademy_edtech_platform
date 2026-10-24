"""A video run uses the model the user picked - not whatever heads a catalogue list.

Observed 2026-10-01 on a super_ultra run whose user set
`model_overrides.default = z-ai/glm-5.3-flash` (also the registry's default for video):

    ⇢ x-ai/grok-4.6               via OpenRouter   two calls before the shot plan
    ⇢ anthropic/claude-opus-4-8   via OpenRouter   the edit choreographer
    ⚠️ Design identity skipped (unhashable type: 'slice') — default look

Grok heads the registry's *recommended* list, which the client consulted for any call
that named no model and ran outside a mapped stage - and nothing in the video pipeline
sets the stage for its main calls. Opus was the tier's hard-coded concept model, read
directly by the choreographer; hero-shot escalation already refused to override the
user ("escalate over neither"), the choreographer did not. The design-identity crash
was a dict brand brief sliced like a string, on every run with a brand kit.

Run:  cd ai_service && PYTHONPATH=.. python -m pytest tests/test_video_model_selection.py
"""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
PIPELINE_DIR = HERE.parent / "app" / "ai-video-gen-main"
PIPELINE = PIPELINE_DIR / "automation_pipeline.py"
sys.path.insert(0, str(PIPELINE_DIR))

GLM = "z-ai/glm-5.3-flash"
GROK = "x-ai/grok-4.6"
RECOMMENDED = [GROK, GLM, "google/gemini-3-flash-preview"]   # the live registry order
FALLBACK = ["minimax/minimax-m3", GLM, "google/gemini-3-flash-preview"]


class _Stage:
    def __init__(self, value="unknown"):
        self.value = value

    def get(self):
        return self.value


def _client(stage="unknown", stage_map=None, registry_default=GLM):
    """A client built from the real `_user_default_model` / `_select_models`
    methods and the real `_normalize_stage_to_taxonomy`, lifted out of the
    pipeline source (importing it pulls in the whole renderer)."""
    tree = ast.parse(PIPELINE.read_text())
    norm = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_normalize_stage_to_taxonomy")
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "OpenRouterClient")
    methods = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in ("_user_default_model", "_select_models")]
    shell = ast.ClassDef(name="C", bases=[], keywords=[], body=methods, decorator_list=[])
    ns: Dict[str, Any] = {"Optional": Optional, "List": List, "Tuple": Tuple, "Dict": Dict, "Any": Any,
                          "_llm_stage": _Stage(stage)}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[norm, shell], type_ignores=[])), str(PIPELINE), "exec"), ns)
    c = ns["C"]()
    c.stage_model_map = stage_map or {}
    c.model_chain = list(RECOMMENDED)
    c.default_model = "client/default"
    c.use_case_default_model = registry_default
    c.use_case_fallback_chain = list(FALLBACK)
    return c


USER_MAP = {"shot_planner": (GLM, "user_default"), "narration_writer": (GLM, "user_default"),
            "per_shot_html": (GLM, "user_default"), "vision_review": ("google/gemini-2.5-pro", "matrix"),
            "beat_planner": ("google/gemini-3.7-flash", "matrix")}


def test_an_unnamed_call_outside_any_stage_uses_the_users_model_not_grok():
    """The regression: this returned [grok-4.6, ...] before."""
    models, source = _client(stage_map=USER_MAP)._select_models(None)
    assert models[0] == GLM, models
    assert source == "user_default"
    assert GROK not in models, "Grok must not even be a fallback for an unnamed call"


def test_without_a_user_choice_the_registry_default_beats_the_catalogue_order():
    """The admin set video's default to GLM; the recommended list is a catalogue
    ordering and must not outrank it."""
    models, source = _client(stage_map={"vision_review": ("google/gemini-2.5-pro", "matrix")})._select_models(None)
    assert models[0] == GLM and source == "use_case_default"


def test_only_with_no_defaults_at_all_does_the_recommended_list_apply():
    """The legacy path is kept, but only as the last resort."""
    models, _ = _client(stage_map={}, registry_default=None)._select_models(None)
    assert models[:3] == RECOMMENDED


def test_an_explicit_model_always_wins():
    models, _ = _client(stage_map=USER_MAP)._select_models("anthropic/claude-sonnet-5")
    assert models[0] == "anthropic/claude-sonnet-5"


def test_a_mapped_stage_still_routes_to_its_own_model():
    """User default must not flatten pinned stages - vision review stays on its
    reviewer model so a cheap model cannot mask defects."""
    models, source = _client(stage="vision_review_regen_shot_3", stage_map=USER_MAP)._select_models(None)
    assert models[0] == "google/gemini-2.5-pro" and source == "matrix"


def test_the_fallback_chain_is_still_appended_once_each():
    models, _ = _client(stage_map=USER_MAP)._select_models(None)
    assert models == [GLM, "minimax/minimax-m3", "google/gemini-3-flash-preview"]


def test_the_users_model_is_read_from_the_stage_map():
    c = _client(stage_map=USER_MAP)
    assert c._user_default_model() == GLM
    assert _client(stage_map={"vision_review": ("google/gemini-2.5-pro", "matrix")})._user_default_model() is None


def test_chat_selects_through_the_one_method():
    src = PIPELINE.read_text()
    assert "models_to_try, _stage_routed_source = self._select_models(model)" in src
    chat = src[src.index("    def chat("):]
    chat = chat[:chat.index("\n    def ", 10)] if "\n    def " in chat[10:] else chat
    assert "elif self.model_chain:" not in chat, "selection logic must live in _select_models only"


# --------------------------------------------------------------------------
# The tier's frontier pick no longer overrides the user
# --------------------------------------------------------------------------

def test_the_edit_choreographer_and_design_identity_put_the_user_first():
    """User's pick, then the stage's own matrix row, else None (the registry's
    video default). The tier's hard-coded Opus `concept_model` is gone."""
    src = PIPELINE.read_text()
    ec = src[src.index("_ec_model = ("):][:400]
    assert ec.index("_user_default_model()") < ec.index('_resolve_stage_model("edit_choreographer")')
    di = src[src.index("_di_model = ("):][:400]
    assert di.index("_user_default_model()") < di.index('_resolve_stage_model("design_identity")')
    for block in (ec, di):
        body = block[:block.index("\n                )")]
        assert "concept_model" not in body and "shot_planner_model" not in body
        assert body.rstrip().endswith("or None")


def test_no_reader_of_the_old_tier_model_keys_is_left():
    """concept_model doubled as a feature flag; a missed reader would silently
    switch concept enforcement off on premium+."""
    import re
    src = PIPELINE.read_text()
    for key in ("concept_model", "hero_shot_model", "preferred_script_model", "preferred_shot_model"):
        assert not re.search(r"\.get\(\s*[\"']" + key, src), key
    assert 'enforce_concept=bool(tier_config.get("concept_enabled"))' in src
    assert 'self._tier_config.get("concept_enabled")' in src  # temperature modulation gate


def _hero():
    tree = ast.parse(PIPELINE.read_text())
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_hero_shot_settings")
    ns: Dict[str, Any] = {"Optional": Optional, "Tuple": Tuple, "Dict": Dict, "Any": Any}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), str(PIPELINE), "exec"), ns)
    return ns["_hero_shot_settings"]


ULTRA_HERO = {"hero_effort": "max", "hero_max_tokens": 24000}


def test_a_hero_shot_on_glm_stays_on_glm_and_thinks_at_max():
    """No 'hero_shot' row (or the same model): no vendor switch, effort max."""
    hero = _hero()
    for hero_model in (None, GLM):
        model, effort, mt = hero(GLM, hero_model, (GLM, "matrix"), ULTRA_HERO, True)
        assert (model, effort, mt) == (GLM, "max", 24000), hero_model


def test_a_hero_row_with_another_model_switches_the_model():
    model, effort, _ = _hero()(GLM, "google/gemini-2.5-pro", (GLM, "matrix"), ULTRA_HERO, True)
    assert model == "google/gemini-2.5-pro" and effort == "max"


def test_hero_shots_keep_refusing_to_escalate_over_the_user():
    """An explicit user pick (per-stage or the video-wide default) is never
    replaced by the hero model."""
    hero = _hero()
    for source in ("user_per_stage", "user_default"):
        model, _, _ = hero("x/user-pick", "google/gemini-2.5-pro", ("x/user-pick", source), ULTRA_HERO, True)
        assert model == "x/user-pick", source


def test_ordinary_shots_and_tiers_without_hero_effort_are_untouched():
    hero = _hero()
    assert hero(GLM, "google/gemini-2.5-pro", (GLM, "matrix"), ULTRA_HERO, False) == (GLM, None, None)
    assert hero(GLM, None, (GLM, "matrix"), {}, True) == (GLM, None, None)
    assert hero(None, None, None, {"hero_effort": "max"}, True) == (None, "max", None)


def test_the_hero_effort_wraps_only_the_calls_that_write_shot_html():
    """The judge, vision and regen calls must not inherit "max" (it switches
    off the small-call floor and blows their budgets)."""
    src = PIPELINE.read_text()
    assert src.count("with _video_effort(_hero_effort):") == 2
    bon = src[src.index("_bon_model = _shot_model"):]
    bon = bon[:bon.index("self._select_best_shot_candidate(")]
    assert "with _video_effort(_hero_effort):" in bon
    # the selection call itself sits outside any effort block
    sel = src[src.index("_winner, _judge_usage, _judge_meta = self._select_best_shot_candidate(") - 200:]
    assert "with _video_effort" not in sel[:200]


# --------------------------------------------------------------------------
# Design identity works for branded runs
# --------------------------------------------------------------------------

def test_design_identity_accepts_the_pipelines_dict_brand_brief():
    import design_identity as di

    calls = []

    def fake_chat(**kw):
        calls.append(kw)
        return ('{"palette_direction": "teal"}', {"prompt_tokens": 1, "completion_tokens": 1})

    brief = {"primary_color": "#007A74", "fonts": ["Inter", "Poppins"]}
    _ident, _usage = di.generate_design_identity(fake_chat, concept={"controlling_idea": "x"},
                                                 script_summary="s", mode="marketing",
                                                 brand_brief=brief, model=GLM)
    assert len(calls) == 1, "a branded run must reach the model, not crash before it"
    sent = json.loads(calls[0]["messages"][1]["content"])
    assert "#007A74" in sent["brand_brief"], "the brand cues must reach the prompt"
    assert calls[0]["model"] == GLM


def test_design_identity_still_takes_a_text_brief():
    import design_identity as di
    calls = []
    di.generate_design_identity(lambda **kw: (calls.append(kw) or ("{}", {})), concept=None,
                                script_summary="s", mode="marketing", brand_brief="plain brief")
    assert json.loads(calls[0]["messages"][1]["content"])["brand_brief"] == "plain brief"
