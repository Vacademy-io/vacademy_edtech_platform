"""Regenerating ONE engagement task keeps its type, and a wrong result is never billed.

Before this, single-item mode enabled the requested type AND then appended every
type in the plan's mix, so "regenerate this visual note" could come back as a
question — and the router billed it and the wizard swapped it in. These tests pin
the prompt (one enabled type), the router's refusal (422 before billing when the
result is empty or of another kind), the brief's date validation (422 before the
paid call), the plan-title precedence, and the reasoning-effort knob.

The model call is always stubbed; nothing here touches the network or a database.
"""
from __future__ import annotations

import json
from datetime import date
from types import SimpleNamespace
from typing import Any, Dict, List

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.db import db_dependency
from app.routers import engagement_plan as router_module
from app.services import engagement_plan_service as svc

UNUSABLE = "The AI didn't return a usable task. Try again; you weren't charged."

READING_TEXT = (
    "Photosynthesis is how green plants turn light, water and carbon dioxide into sugar "
    "and oxygen. It happens in the chloroplasts of leaf cells."
)


# ── model replies ────────────────────────────────────────────────────────────

def _mcq(title: str = "Which gas do plants release?") -> Dict[str, Any]:
    return {
        "type": "QUESTION_OF_DAY",
        "format": "MCQ",
        "title": title,
        "prompt": "<p>Which gas do plants release?</p>",
        "options": [{"id": "a", "text": "Oxygen"}, {"id": "b", "text": "Nitrogen"}],
        "correctOptionId": "a",
        "explanation": "<p>Oxygen is released.</p>",
    }


def _text_question() -> Dict[str, Any]:
    return {
        "type": "QUESTION_OF_DAY",
        "format": "TEXT",
        "title": "Explain photosynthesis",
        "prompt": "<p>In your own words, explain photosynthesis.</p>",
        "explanation": "<p>Light, water, CO2, sugar.</p>",
    }


def _reading(with_picture: bool) -> Dict[str, Any]:
    img = '<img data-img-prompt="a leaf cross-section" alt="leaf">' if with_picture else ""
    return {
        "type": "READING_HTML",
        "title": "How leaves make food",
        "contentHtml": f"<h2>Leaves</h2><p>{READING_TEXT}</p>{img}",
    }


def _reply(*items: Dict[str, Any], title: str = "Model title") -> str:
    return json.dumps({"title": title, "days": [{"day": 1, "theme": "Plants", "items": list(items)}]})


# ── harness ──────────────────────────────────────────────────────────────────

class Harness:
    def __init__(self, monkeypatch: pytest.MonkeyPatch, reply: str):
        self.reply = reply
        self.prompts: List[str] = []
        self.billed: List[Dict[str, Any]] = []

        async def fake_call_model(prompt, api_key, base_url, model):
            self.prompts.append(prompt)
            return self.reply, {"prompt_tokens": 100, "completion_tokens": 50}

        def fake_billing(**kwargs):
            self.billed.append(kwargs)

        monkeypatch.setattr(router_module, "call_model", fake_call_model)
        monkeypatch.setattr(router_module, "record_tool_billing", fake_billing)
        monkeypatch.setattr(
            router_module,
            "preflight_tool_credits",
            lambda db, **kw: {"sufficient": True, "estimated_credits": 2, "current_balance": 100},
        )
        monkeypatch.setattr(
            router_module,
            "get_settings",
            lambda: SimpleNamespace(openrouter_api_key="test-key", llm_base_url="http://model.invalid"),
        )

        app = FastAPI()
        app.include_router(router_module.router)
        app.dependency_overrides[get_current_user] = lambda: {
            "user_id": "u1",
            "institute_id": "inst-1",
            "roles": ["ADMIN"],
        }
        app.dependency_overrides[db_dependency] = lambda: object()
        self.client = TestClient(app)

    def draft(self, **overrides: Any):
        body: Dict[str, Any] = {
            "topic": "Photosynthesis",
            "start_date": "2026-10-01",
            "days": 1,
            "per_day_items": 1,
            # The wizard sends the plan's whole mix on a regenerate too.
            "mix": {"question_of_day": True, "text_question": True, "poll": True, "reading": True, "game": True},
            "idempotency_key": "engagement-item-0-0-test",
        }
        body.update(overrides)
        return self.client.post(router_module.router.prefix + "/draft", json=body)


# ── prompt ───────────────────────────────────────────────────────────────────

def _enabled_line(prompt: str) -> str:
    return next(line for line in prompt.splitlines() if line.startswith("Enabled task types:"))


FULL_MIX = {"question_of_day": True, "text_question": True, "poll": True, "reading": True, "game": True}


@pytest.mark.parametrize(
    "single, label",
    [
        ("VISUAL_NOTE", "READING_HTML"),
        ("READING_HTML", "READING_HTML"),
        ("QUESTION_OF_DAY", "QUESTION_OF_DAY (format MCQ)"),
        ("TEXT_QUESTION", "QUESTION_OF_DAY (format TEXT)"),
        ("POLL", "POLL"),
        ("FLASHCARDS", "FLASHCARDS"),
        # The pre-flashcards wizard regenerates a deck as GAME; it is a native deck now.
        ("GAME", "FLASHCARDS"),
    ],
)
def test_single_item_prompt_enables_only_the_requested_type(single, label):
    prompt = svc.build_prompt({"days": 1, "single_item_type": single, "mix": FULL_MIX}, "")
    assert _enabled_line(prompt) == f"Enabled task types: {label}"


def test_visual_note_prompt_asks_for_picture_placeholders():
    prompt = svc.build_prompt({"days": 1, "single_item_type": "VISUAL_NOTE", "mix": FULL_MIX}, "")
    assert "data-img-prompt" in prompt.split("Return ONLY a JSON object")[0]


def test_plan_prompt_still_follows_the_mix():
    prompt = svc.build_prompt(
        {"days": 3, "mix": {"question_of_day": False, "poll": True, "reading": True}}, ""
    )
    assert _enabled_line(prompt) == "Enabled task types: POLL, READING_HTML"


# ── normalisation ────────────────────────────────────────────────────────────

def test_teacher_title_wins_over_the_model_title():
    raw = json.loads(_reply(_mcq(), title="Model title"))
    brief = {"start_date": date(2026, 10, 1), "days": 1, "title": "My Plan"}
    assert svc.normalise_draft(raw, brief)["title"] == "My Plan"


def test_model_title_is_the_fallback_for_a_blank_teacher_title():
    raw = json.loads(_reply(_mcq(), title="Model title"))
    brief = {"start_date": "2026-10-01", "days": 1, "title": "   "}
    assert svc.normalise_draft(raw, brief)["title"] == "Model title"


def test_junk_points_fall_back_to_the_brief_defaults():
    item = dict(_mcq(), completionPoints="ten", correctPoints=None)
    raw = {"days": [{"items": [item]}]}
    draft = svc.normalise_draft(raw, {"start_date": date(2026, 10, 1), "days": 1, "completion_points": 7})
    out = draft["slots"][0]["items"][0]
    assert out["completionPoints"] == 7
    assert out["correctPoints"] == 20
    assert draft["slots"][0]["startDate"] == "2026-10-01"


def test_single_item_scans_past_a_wrong_first_item():
    raw = json.loads(_reply(_mcq(), _text_question()))
    brief = {"start_date": date(2026, 10, 1), "days": 1, "single_item_type": "TEXT_QUESTION"}
    draft = svc.normalise_single_item(raw, brief)
    assert draft is not None
    [slot] = draft["slots"]
    [item] = slot["items"]
    assert item["itemType"] == "QUESTION_OF_DAY"
    assert json.loads(item["payloadJson"])["format"] == "TEXT"


# ── router: type lock + no billing on a wrong result ────────────────────────

def test_visual_note_regenerate_comes_back_as_a_visual_note_and_is_billed_once(monkeypatch):
    h = Harness(monkeypatch, _reply(_reading(with_picture=True)))
    resp = h.draft(single_item_type="VISUAL_NOTE", avoid_title="Old reading")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["items_planned"] == 1
    item = body["slots"][0]["items"][0]
    assert item["itemType"] == "VISUAL_NOTE"
    assert "data-img-prompt" in item["contentHtml"]
    assert len(h.billed) == 1
    assert h.billed[0]["tool_key"] == "engagement_item"
    # The prompt the model saw enabled nothing but a reading.
    assert _enabled_line(h.prompts[0]) == "Enabled task types: READING_HTML"


def test_visual_note_regenerate_that_returns_a_question_is_refused_and_not_billed(monkeypatch):
    h = Harness(monkeypatch, _reply(_mcq()))
    resp = h.draft(single_item_type="VISUAL_NOTE")

    assert resp.status_code == 422
    assert resp.json()["detail"] == UNUSABLE
    assert h.billed == []


def test_visual_note_regenerate_without_any_picture_placeholder_is_refused(monkeypatch):
    h = Harness(monkeypatch, _reply(_reading(with_picture=False)))
    resp = h.draft(single_item_type="VISUAL_NOTE")

    assert resp.status_code == 422
    assert resp.json()["detail"] == UNUSABLE
    assert h.billed == []


def test_text_question_regenerate_that_returns_an_mcq_is_refused(monkeypatch):
    h = Harness(monkeypatch, _reply(_mcq()))
    resp = h.draft(single_item_type="TEXT_QUESTION")

    assert resp.status_code == 422
    assert h.billed == []


def test_empty_regenerate_is_refused_and_not_billed(monkeypatch):
    h = Harness(monkeypatch, json.dumps({"title": "x", "days": [{"day": 1, "items": []}]}))
    resp = h.draft(single_item_type="POLL")

    assert resp.status_code == 422
    assert resp.json()["detail"] == UNUSABLE
    assert h.billed == []


def test_unreadable_regenerate_reply_is_refused_and_not_billed(monkeypatch):
    h = Harness(monkeypatch, "sorry, I cannot help with that")
    resp = h.draft(single_item_type="QUESTION_OF_DAY")

    assert resp.status_code == 422
    assert resp.json()["detail"] == UNUSABLE
    assert h.billed == []


def test_mcq_regenerate_returns_exactly_one_mcq(monkeypatch):
    h = Harness(monkeypatch, _reply(_mcq("First"), _mcq("Second")))
    resp = h.draft(single_item_type="QUESTION_OF_DAY", start_date="2026-10-05")

    assert resp.status_code == 200, resp.text
    slots = resp.json()["slots"]
    assert len(slots) == 1 and len(slots[0]["items"]) == 1
    assert slots[0]["startDate"] == "2026-10-05"
    assert json.loads(slots[0]["items"][0]["payloadJson"])["format"] == "MCQ"
    assert len(h.billed) == 1


def test_unknown_single_type_is_rejected_before_the_model_call(monkeypatch):
    h = Harness(monkeypatch, _reply(_mcq()))
    resp = h.draft(single_item_type="HOMEWORK")

    assert resp.status_code == 400
    assert h.prompts == []
    assert h.billed == []


def test_regenerate_keeps_the_replaced_tasks_points(monkeypatch):
    # The model suggests its own points; a regenerate swaps content, not reward.
    h = Harness(monkeypatch, _reply(dict(_mcq(), completionPoints=50, correctPoints=90)))
    resp = h.draft(single_item_type="QUESTION_OF_DAY", completion_points=4, correct_points=0)

    assert resp.status_code == 200, resp.text
    item = resp.json()["slots"][0]["items"][0]
    assert item["completionPoints"] == 4
    assert item["correctPoints"] == 0


def test_visual_note_regenerate_adopts_an_invented_image_url(monkeypatch):
    # Models sometimes guess a URL instead of writing the placeholder; the alt is
    # a usable drawing prompt, so it becomes a placeholder rather than a 422.
    reading = dict(
        _reading(with_picture=False),
        contentHtml=f'<h2>Leaves</h2><p>{READING_TEXT}</p>'
        '<img src="https://example.com/leaf.png" alt="a labelled cross-section of a leaf">',
    )
    h = Harness(monkeypatch, _reply(reading))
    resp = h.draft(single_item_type="VISUAL_NOTE")

    assert resp.status_code == 200, resp.text
    html = resp.json()["slots"][0]["items"][0]["contentHtml"]
    assert "data-img-prompt" in html and "example.com" not in html
    assert len(h.billed) == 1


def test_unknown_single_type_detail_is_bounded(monkeypatch):
    h = Harness(monkeypatch, _reply(_mcq()))
    resp = h.draft(single_item_type="X" * 500)

    assert resp.status_code == 400
    assert len(resp.json()["detail"]) < 100


# ── router: brief validation before the paid call ────────────────────────────

@pytest.mark.parametrize("bad", ["", "not-a-date", "2026-13-40"])
def test_bad_start_date_is_a_422_with_a_readable_detail_before_the_model_call(monkeypatch, bad):
    h = Harness(monkeypatch, _reply(_mcq()))
    resp = h.draft(start_date=bad)

    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, str) and "start date" in detail
    assert h.prompts == []
    assert h.billed == []


def test_malformed_json_body_is_a_422_with_a_string_detail(monkeypatch):
    h = Harness(monkeypatch, _reply(_mcq()))
    resp = h.client.post(
        router_module.router.prefix + "/draft",
        content=b'{"topic": "x", "start_date": ',
        headers={"Content-Type": "application/json"},
    )

    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, str) and not any(ch.isdigit() for ch in detail)
    assert h.prompts == []


def test_nested_field_error_names_the_field(monkeypatch):
    h = Harness(monkeypatch, _reply(_mcq()))
    resp = h.draft(mix={"poll": "maybe"})

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Check the brief: poll is not valid."


def test_out_of_range_model_points_fall_back_to_the_defaults():
    item = dict(_mcq(), completionPoints=-5, correctPoints=5000)
    draft = svc.normalise_draft({"days": [{"items": [item]}]}, {"start_date": date(2026, 10, 1), "days": 1})
    out = draft["slots"][0]["items"][0]
    assert out["completionPoints"] == 10
    assert out["correctPoints"] == 20


def test_repeated_option_ids_are_made_unique():
    item = dict(
        _mcq(),
        options=[{"id": "a", "text": "Oxygen"}, {"id": "a", "text": "Nitrogen"}, {"id": "b", "text": "Argon"}],
    )
    draft = svc.normalise_draft({"days": [{"items": [item]}]}, {"start_date": date(2026, 10, 1), "days": 1})
    payload = json.loads(draft["slots"][0]["items"][0]["payloadJson"])
    ids = [o["id"] for o in payload["options"]]
    assert len(ids) == len(set(ids)) == 3
    assert payload["correctOptionId"] == "a"


def test_plan_draft_keeps_its_shape_and_the_teacher_title(monkeypatch):
    reply = json.dumps(
        {
            "title": "Model title",
            "days": [
                {"day": 1, "theme": "Leaves", "items": [_mcq(), _reading(with_picture=False)]},
                {"day": 2, "theme": "Roots", "items": [_text_question()]},
            ],
        }
    )
    h = Harness(monkeypatch, reply)
    resp = h.draft(title="Plants week", days=2, per_day_items=2)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    # The old wizard's fields are all still there; the requested-vs-delivered
    # report is additive.
    assert {"title", "slots", "model", "days_planned", "items_planned", "grounded"} <= set(body)
    assert body["title"] == "Plants week"
    assert body["days_planned"] == 2 and body["items_planned"] == 3
    assert body["days_requested"] == 2 and body["items_requested"] == 4
    assert body["short_dates"] == ["2026-10-02"] and body["missing_dates"] == []
    assert [s["startDate"] for s in body["slots"]] == ["2026-10-01", "2026-10-02"]
    assert len(h.billed) == 1 and h.billed[0]["tool_key"] == "engagement_plan"


def test_unreadable_plan_reply_is_a_502_and_not_billed(monkeypatch):
    h = Harness(monkeypatch, "not json at all")
    resp = h.draft(days=3)

    assert resp.status_code == 502
    assert h.billed == []


# ── reasoning effort ────────────────────────────────────────────────────────

class _FakeResponse:
    status_code = 200
    text = ""
    request = None

    def json(self):
        return {"choices": [{"message": {"content": "{}"}}], "usage": {}}


def _capture_payload(monkeypatch) -> List[Dict[str, Any]]:
    sent: List[Dict[str, Any]] = []

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, headers=None, json=None):
            sent.append(json)
            return _FakeResponse()

    monkeypatch.setattr(svc.httpx, "AsyncClient", FakeClient)
    return sent


@pytest.mark.parametrize(
    "env, expected",
    [(None, {"effort": "low"}), ("HIGH", {"effort": "high"}), ("", None), ("hihg", {"effort": "low"})],
)
def test_reasoning_effort_is_env_configurable(monkeypatch, env, expected):
    import asyncio

    if env is None:
        monkeypatch.delenv("ENGAGEMENT_PLAN_REASONING_EFFORT", raising=False)
    else:
        monkeypatch.setenv("ENGAGEMENT_PLAN_REASONING_EFFORT", env)
    sent = _capture_payload(monkeypatch)

    asyncio.run(svc.call_model("p", "k", "http://model.invalid", "m"))

    assert sent[0].get("reasoning") == expected
    assert sent[0]["response_format"] == {"type": "json_object"}


# ── legacy wizard compatibility ──────────────────────────────────────────────

def test_legacy_game_toggle_still_enables_flashcards():
    prompt = svc.build_prompt({"days": 1, "mix": {"question_of_day": False, "game": True}}, "")
    assert _enabled_line(prompt) == "Enabled task types: FLASHCARDS"


def test_prompt_asks_for_exactly_the_requested_number_of_tasks():
    prompt = svc.build_prompt({"days": 2, "per_day_items": 3, "mix": {}}, "")
    assert "Tasks per day: exactly 3" in prompt


def test_timeout_is_a_502_that_says_the_ai_was_slow(monkeypatch):
    import httpx

    h = Harness(monkeypatch, _reply(_mcq()))

    async def slow(prompt, api_key, base_url, model):
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(router_module, "call_model", slow)
    resp = h.draft(days=3)

    assert resp.status_code == 502
    assert "took too long" in resp.json()["detail"]
    assert h.billed == []


def test_plan_charge_is_sized_by_the_delivered_tasks(monkeypatch):
    h = Harness(monkeypatch, _reply(_mcq(), _text_question()))
    resp = h.draft(days=1, per_day_items=2)

    assert resp.status_code == 200, resp.text
    [bill] = h.billed
    assert bill["tool_key"] == "engagement_plan"
    assert bill["tool_params"] == {"days": 1, "num_questions": 2}
    assert bill["idempotency_key"] == "engagement-item-0-0-test"
