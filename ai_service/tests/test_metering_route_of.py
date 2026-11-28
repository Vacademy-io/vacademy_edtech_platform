"""Every usage event says which gateway served it, so cost can be traced to a vendor.

Offline: the live route map is a stub.

Run from the repo root:
    <venv>/bin/python -m pytest ai_service/tests/test_metering_route_of.py -q
"""
from __future__ import annotations

import os
import sys
import types

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.metering.service import EventInput, _route_of  # noqa: E402

MODEL = "anthropic/claude-sonnet-4.5"


@pytest.fixture()
def route_map(monkeypatch):
    stub = types.ModuleType("app.services.llm_router")
    stub.DEFAULT_ROUTER = "openrouter"
    stub.model_routes = lambda: {MODEL: {"router": "anthropic"}}
    monkeypatch.setitem(sys.modules, "app.services.llm_router", stub)
    return stub


def _llm(**kwargs):
    return EventInput(prompt_tokens=10, completion_tokens=5, **kwargs)


def test_what_the_caller_said_wins(route_map):
    assert _route_of(_llm(router="isoquant"), {"router": "x"}, MODEL) == "isoquant"
    assert _route_of(_llm(), {"router": "isoquant"}, MODEL) == "isoquant"


def test_llm_call_uses_the_route_map(route_map):
    assert _route_of(_llm(), {}, MODEL) == "anthropic"


def test_wire_model_is_tried_too(route_map):
    assert _route_of(_llm(), {}, "canonical/id", MODEL) == "anthropic"


def test_unlisted_model_stays_on_openrouter(route_map):
    assert _route_of(_llm(), {}, "z-ai/glm-5") == "openrouter"


def test_institutes_own_key_stays_on_openrouter(route_map):
    assert _route_of(_llm(byo_key=True), {}, MODEL) == "openrouter"


def test_non_llm_call_is_not_guessed(route_map):
    assert _route_of(EventInput(seconds=60), {}, MODEL) is None


def test_llm_call_without_a_model_is_not_guessed(route_map):
    assert _route_of(_llm(), {}, None, None) is None


def test_a_broken_route_map_never_breaks_metering(route_map):
    def boom():
        raise RuntimeError("no settings")

    route_map.model_routes = boom
    assert _route_of(_llm(), {}, MODEL) is None
