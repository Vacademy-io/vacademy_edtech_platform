"""The video pipeline must import ai_service modules by their production name.

Production runs `uvicorn ai_service.main:app` from /app, so the package is
`ai_service.app`; a bare `from app.… import` raises ImportError there. Sites
that tried only `app.` and swallowed the error fell back silently — from
2026-10-23 to 10-27 every video used Recraft + Seedream whatever the admin
portal's video_image / video_support_visual rows said. Locally `app` IS
importable, so ordinary tests could not see it; these check the code instead.
"""
from __future__ import annotations

import ast
import importlib
import types
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parent.parent / "app" / "ai-video-gen-main" / "automation_pipeline.py"

# Bare `app.` imports left as they are: each tries `ai_service.app.` first,
# loads the file directly on failure, or puts /app/ai_service on sys.path
# just before importing (which makes `app` resolvable). Do not add to this
# list — new code uses _platform_module.
_BARE_APP_IMPORTS_WITH_FALLBACK = {
    "app.config",
    "app.constants.model_defaults",
    "app.db",
    "app.repositories.vision_review_repository",
    "app.services.ai_models_service",
    "app.services.ai_video_ledger",
    "app.services.avatar_service",
    "app.services.fal_avatar_client",
    "app.services.fal_omni_client",
    "app.services.fal_seedance_client",
    "app.services.fal_veo_client",
    "app.services.s3_service",
}


def _tree() -> ast.Module:
    return ast.parse(PIPELINE.read_text(encoding="utf-8"))


def _platform_module_fn():
    """`_platform_module` compiled on its own (the pipeline itself is too heavy to import)."""
    node = next(n for n in _tree().body if isinstance(n, ast.FunctionDef) and n.name == "_platform_module")
    ns: dict = {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(PIPELINE), "exec"), ns)
    return ns["_platform_module"]


def test_no_new_bare_app_imports():
    bare = {
        n.module for n in ast.walk(_tree())
        if isinstance(n, ast.ImportFrom) and n.module and (n.module == "app" or n.module.startswith("app."))
    }
    unexpected = bare - _BARE_APP_IMPORTS_WITH_FALLBACK
    assert not unexpected, (
        f"bare `from app.…` imports fail in production ({sorted(unexpected)}); "
        "use _platform_module('services.…') instead")


def test_image_resolver_goes_through_platform_module():
    src = PIPELINE.read_text(encoding="utf-8")
    assert '_IMAGE_RESOLVER_MODULE = _platform_module("services.image_model_resolver")' in src


def test_smallest_and_navana_narration_go_through_platform_module():
    # A bare `from app.services import rest_tts` here sent every Smallest /
    # Navana video in production to the Edge fallback.
    src = PIPELINE.read_text(encoding="utf-8")
    assert 'rest_tts = _platform_module("services.rest_tts")' in src


def test_production_name_is_tried_first(monkeypatch):
    fn = _platform_module_fn()
    tried = []
    sentinel = types.ModuleType("ai_service.app.services.x")

    def fake(name):
        tried.append(name)
        if name.startswith("ai_service.app."):
            return sentinel
        raise AssertionError("app. must not be tried when the production name resolves")

    monkeypatch.setattr(importlib, "import_module", fake)
    assert fn("services.x") is sentinel
    assert tried == ["ai_service.app.services.x"]


def test_falls_back_to_app_then_none(monkeypatch):
    fn = _platform_module_fn()
    local = types.ModuleType("app.services.x")

    def only_app(name):
        if name == "app.services.x":
            return local
        raise ModuleNotFoundError(name)

    monkeypatch.setattr(importlib, "import_module", only_app)
    assert fn("services.x") is local

    def nothing(name):
        raise ModuleNotFoundError(name)

    monkeypatch.setattr(importlib, "import_module", nothing)
    assert fn("services.x") is None


@pytest.mark.parametrize("dotted", [
    "services.image_model_resolver", "services.music_library", "services.usage_record_only",
    "services.ai_video_constants", "services.credit_rate_service", "db", "services.rest_tts",
])
def test_targets_exist(dotted):
    path = PIPELINE.parent.parent / (dotted.replace(".", "/") + ".py")
    assert path.exists(), path
