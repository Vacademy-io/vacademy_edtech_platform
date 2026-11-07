"""The AI planner drafts native FLASHCARDS decks, runs as a background job, and
reports what it delivered against what was asked.

Pinned here:
  - `_norm_cards`: tags stripped, over-long / faceless cards dropped, repeated
    fronts dropped, at most 20, at least 3, fresh ids admin_core accepts;
  - the emitted item: itemType FLASHCARDS, the flashcards/v1 payload,
    correctPoints 0 — and no rendered HTML game (the renderer is gone);
  - the legacy `game` toggle and GAME regenerate still land as decks;
  - a regenerated deck that is too small is a 422 with no charge;
  - weekdays in the brief, requested vs delivered, localised fallback titles;
  - the job flow: start → poll ("day n of N") → result, billed exactly once;
    failed and cancelled jobs are never billed; a cancel aborts the model call;
    a job is private to the teacher who started it;
  - the streamed model call and the size-based engagement_plan price.

The model is always stubbed; nothing touches the network. Jobs run against a
throwaway SQLite database standing in for the ai_task table.
"""
from __future__ import annotations

import asyncio
import json
import re
import threading
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.security import get_current_user
from app.db import db_dependency
from app.models.ai_task import AiTask, AiTaskStatus
from app.routers import engagement_plan as router_module
from app.services import ai_task_service
from app.services import engagement_plan_service as svc
from app.services.tool_cost_estimator import ToolCostEstimator

ID_RE = re.compile(r"^[a-z0-9_-]{1,24}$")
DECK_422 = "The AI didn't return a usable card deck. Try again; you weren't charged."


# ── model replies ────────────────────────────────────────────────────────────

def _cards(n: int, prefix: str = "Term") -> List[Dict[str, Any]]:
    return [{"front": f"{prefix} {i}", "back": f"Meaning of {prefix.lower()} {i}"} for i in range(1, n + 1)]


def _deck(n: int = 8, *, type_: str = "FLASHCARDS", title: str = "Key terms", **extra) -> Dict[str, Any]:
    item = {"type": type_, "title": title, "cards": _cards(n), "completionPoints": 10, "correctPoints": 40}
    item.update(extra)
    return item


def _mcq(title: str = "Which gas do plants release?") -> Dict[str, Any]:
    return {
        "type": "QUESTION_OF_DAY",
        "format": "MCQ",
        "title": title,
        "prompt": "<p>Which gas do plants release?</p>",
        "options": [{"id": "a", "text": "Oxygen"}, {"id": "b", "text": "Nitrogen"}],
        "correctOptionId": "a",
    }


def _plan(*days_items: List[Dict[str, Any]], title: str = "Model title") -> str:
    return json.dumps(
        {
            "title": title,
            "days": [{"day": i + 1, "theme": f"Theme {i + 1}", "items": items} for i, items in enumerate(days_items)],
        }
    )


def _payload(item: Dict[str, Any]) -> Dict[str, Any]:
    return json.loads(item["payloadJson"])


BRIEF = {"start_date": date(2026, 10, 1), "days": 1, "per_day_items": 1}


# ── _norm_cards ──────────────────────────────────────────────────────────────

def test_cards_are_stripped_of_markup_and_trimmed():
    cards = svc._norm_cards(
        [
            {"front": "  <b>Photosynthesis</b> ", "back": "<p>Light → sugar</p><p>in leaves</p>"},
            {"front": "**Chlorophyll**", "back": "Green&nbsp;pigment"},
            {"front": "2 < x > 1", "back": "an inequality"},
        ]
    )
    assert [c["front"] for c in cards] == ["Photosynthesis", "Chlorophyll", "2 < x > 1"]
    assert cards[0]["back"] == "Light → sugar\nin leaves"
    assert cards[1]["back"] == "Green pigment"


def test_over_length_and_faceless_cards_are_dropped():
    raw = _cards(3) + [
        {"front": "x" * 201, "back": "too long a front"},
        {"front": "Long back", "back": "y" * 501},
        {"front": "Many lines", "back": "\n".join(["line"] * 13)},
        {"front": "No back"},
        {"back": "No front"},
        "not a card",
    ]
    cards = svc._norm_cards(raw)
    assert [c["front"] for c in cards] == ["Term 1", "Term 2", "Term 3"]


def test_an_over_long_hint_loses_only_the_hint():
    raw = _cards(3)
    raw[0]["hint"] = "h" * 151
    raw[1]["hint"] = "<i>starts with M</i>"
    cards = svc._norm_cards(raw)
    assert "hint" not in cards[0]
    assert cards[1]["hint"] == "starts with M"
    assert "hint" not in cards[2]


def test_repeated_fronts_are_dropped_case_insensitively():
    raw = _cards(3) + [{"front": "term  1", "back": "again"}, {"front": "TERM 2", "back": "again"}]
    cards = svc._norm_cards(raw)
    assert len(cards) == 3
    assert [c["back"] for c in cards] == ["Meaning of term 1", "Meaning of term 2", "Meaning of term 3"]


def test_deck_is_capped_at_20_and_needs_at_least_3():
    assert len(svc._norm_cards(_cards(35))) == svc.DECK_MAX_CARDS == 20
    assert svc._norm_cards(_cards(2)) is None
    assert svc._norm_cards(_cards(2) + [{"front": "Term 1", "back": "dup"}]) is None
    assert svc._norm_cards("not a list") is None


def test_ids_are_minted_fresh_unique_and_valid():
    raw = [dict(c, id="Model ID!") for c in _cards(12)]
    cards = svc._norm_cards(raw)
    ids = [c["id"] for c in cards]
    assert len(set(ids)) == 12
    assert all(ID_RE.match(i) and i.startswith("c_") and len(i) == 8 for i in ids)


def test_length_limits_count_utf16_units_like_the_server():
    # An emoji is 2 UTF-16 units: 100 of them is 200 units (fits), 101 is 202.
    ok = svc._norm_cards([{"front": "\U0001F600" * 100, "back": "b"}] + _cards(2))
    assert ok is not None and len(ok) == 3
    assert svc._norm_cards([{"front": "\U0001F600" * 101, "back": "b"}] + _cards(2)) is None


# ── the emitted item ─────────────────────────────────────────────────────────

def test_flashcards_item_is_a_native_deck():
    draft = svc.normalise_draft({"days": [{"items": [_deck(8)]}]}, BRIEF)
    [item] = draft["slots"][0]["items"]
    assert item["itemType"] == "FLASHCARDS"
    assert item["correctPoints"] == 0
    assert item["completionPoints"] == 10
    assert item["maxScore"] == 8
    assert item["isRequired"] is True
    assert item["hideResultUntilReveal"] is False
    assert "contentHtml" not in item
    payload = _payload(item)
    assert payload["schema"] == "flashcards/v1"
    assert payload["settings"] == {"shuffle": True}
    assert len(payload["cards"]) == 8
    assert set(payload["cards"][0]) == {"id", "front", "back"}


def test_a_legacy_game_deck_from_the_model_becomes_flashcards():
    item = _deck(6, type_="GAME", game="FLASHCARDS")
    draft = svc.normalise_draft({"days": [{"items": [item]}]}, BRIEF)
    out = draft["slots"][0]["items"][0]
    assert out["itemType"] == "FLASHCARDS"
    assert "contentHtml" not in out


def test_a_game_without_cards_or_a_tiny_deck_is_dropped_and_reported():
    raw = {"days": [{"items": [{"type": "GAME", "title": "html game"}, _deck(2), _mcq()]}]}
    draft = svc.normalise_draft(raw, dict(BRIEF, per_day_items=3))
    assert [i["itemType"] for i in draft["slots"][0]["items"]] == ["QUESTION_OF_DAY"]
    assert draft["dropped_items"] == 2
    assert draft["short_dates"] == ["2026-10-01"]


def test_the_html_flashcards_renderer_is_gone():
    assert not hasattr(svc, "render_flashcards_html")


def test_prompt_describes_native_flashcards_and_not_the_game():
    prompt = svc.build_prompt({"days": 1, "mix": {"question_of_day": False, "flashcards": True}}, "")
    schema = prompt.split("Return ONLY a JSON object")[1]
    assert '"type": "FLASHCARDS"' in schema
    assert '"type": "GAME"' not in schema
    assert "6 to 12 cards" in schema
    assert "Enabled task types: FLASHCARDS" in prompt


# ── weekdays, requested vs delivered, chrome ─────────────────────────────────

@pytest.mark.parametrize(
    "value, expected",
    [
        (None, None),
        ([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]),
        ([0, 6], [6, 7]),  # JS getDay(): 0 is Sunday
        (["Mon", "wednesday", "7"], [1, 3, 7]),
        ("mon,fri", [1, 5]),
        (31, [1, 2, 3, 4, 5]),  # dowMask Mon..Fri
        (64, [7]),
        ([], []),
    ],
)
def test_weekdays_accept_numbers_names_and_the_dow_mask(value, expected):
    assert svc.parse_weekdays(value) == expected


@pytest.mark.parametrize("bad", [[8], ["someday"], 0, 128, True, {"mon": 1}])
def test_bad_weekdays_raise(bad):
    with pytest.raises(ValueError):
        svc.parse_weekdays(bad)


def test_weekdays_skip_dates_and_days_map_onto_the_remaining_dates():
    # 2026-10-01 is a Thursday. Seven days Mon–Fri: Thu, Fri, Mon, Tue, Wed.
    brief = {"start_date": "2026-10-01", "days": 7, "weekdays": [1, 2, 3, 4, 5], "per_day_items": 1}
    assert [d.isoformat() for d in svc.plan_dates(brief)] == [
        "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07",
    ]
    prompt = svc.build_prompt(dict(brief, mix={}), "")
    assert "Number of days: 5" in prompt
    assert "Day 3 = Mon 5 Oct" in prompt

    raw = json.loads(_plan([_mcq()], [_mcq()], [_mcq()]))
    draft = svc.normalise_draft(raw, brief)
    assert [s["startDate"] for s in draft["slots"]] == ["2026-10-01", "2026-10-02", "2026-10-05"]
    assert draft["requested_days"] == 5 and draft["requested_items"] == 5
    assert draft["missing_dates"] == ["2026-10-06", "2026-10-07"]


def test_fallback_titles_follow_the_brief_language():
    item = dict(_deck(3), title="")
    raw = {"days": [{"items": [item]}]}
    draft = svc.normalise_draft(raw, dict(BRIEF, language="Hindi"))
    slot = draft["slots"][0]
    assert slot["title"] == "दिन 1"
    assert slot["items"][0]["title"] == "दिन 1 का कार्य"
    assert draft["title"] == "AI सहभागिता योजना"
    assert svc.normalise_draft(raw, dict(BRIEF, language="fr"))["slots"][0]["title"] == "Jour 1"
    assert svc.normalise_draft(raw, dict(BRIEF, language="Klingon"))["slots"][0]["title"] == "Day 1"


# ── synchronous router ───────────────────────────────────────────────────────

class Harness:
    def __init__(self, monkeypatch: pytest.MonkeyPatch, reply: str):
        self.reply = reply
        self.prompts: List[str] = []
        self.billed: List[Dict[str, Any]] = []
        self.preflights: List[Dict[str, Any]] = []

        async def fake_call_model(prompt, api_key, base_url, model):
            self.prompts.append(prompt)
            return self.reply, {"prompt_tokens": 100, "completion_tokens": 50}

        def fake_preflight(db, **kw):
            self.preflights.append(kw)
            return {"sufficient": True, "estimated_credits": 2, "current_balance": 100}

        monkeypatch.setattr(router_module, "call_model", fake_call_model)
        monkeypatch.setattr(router_module, "record_tool_billing", lambda **kw: self.billed.append(kw))
        monkeypatch.setattr(router_module, "preflight_tool_credits", fake_preflight)
        monkeypatch.setattr(
            router_module,
            "get_settings",
            lambda: SimpleNamespace(openrouter_api_key="test-key", llm_base_url="http://model.invalid"),
        )
        self.app = FastAPI()
        self.app.include_router(router_module.router)
        self.user = {"user_id": "u1", "institute_id": "inst-1", "roles": ["TEACHER"]}
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.app.dependency_overrides[db_dependency] = lambda: object()
        self.client = TestClient(self.app)

    def body(self, **overrides: Any) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "topic": "Photosynthesis",
            "start_date": "2026-10-01",
            "days": 1,
            "per_day_items": 1,
            "mix": {"question_of_day": False, "reading": False, "flashcards": True},
            "idempotency_key": "engagement-test-key",
        }
        body.update(overrides)
        return body

    def draft(self, **overrides: Any):
        return self.client.post(router_module.router.prefix + "/draft", json=self.body(**overrides))


def test_probe_a_one_day_flashcards_brief_drafts_a_native_deck(monkeypatch):
    h = Harness(monkeypatch, _plan([_deck(9)]))
    resp = h.draft()

    assert resp.status_code == 200, resp.text
    [item] = resp.json()["slots"][0]["items"]
    assert item["itemType"] == "FLASHCARDS"
    assert 6 <= len(_payload(item)["cards"]) <= 12
    assert item["correctPoints"] == 0
    assert _enabled_line(h.prompts[0]) == "Enabled task types: FLASHCARDS"
    assert len(h.billed) == 1


def test_the_old_wizards_game_toggle_still_drafts_decks(monkeypatch):
    h = Harness(monkeypatch, _plan([_deck(6)]))
    resp = h.draft(mix={"question_of_day": False, "reading": False, "game": True})

    assert resp.status_code == 200, resp.text
    assert resp.json()["slots"][0]["items"][0]["itemType"] == "FLASHCARDS"
    assert _enabled_line(h.prompts[0]) == "Enabled task types: FLASHCARDS"


def test_probe_regenerating_a_deck_of_fewer_than_3_cards_is_a_422_and_free(monkeypatch):
    h = Harness(monkeypatch, _plan([_deck(2)]))
    resp = h.draft(single_item_type="FLASHCARDS")

    assert resp.status_code == 422
    assert resp.json()["detail"] == DECK_422
    assert h.billed == []


def test_regenerating_a_deck_that_comes_back_as_a_question_is_refused(monkeypatch):
    h = Harness(monkeypatch, _plan([_mcq()]))
    resp = h.draft(single_item_type="FLASHCARDS")

    assert resp.status_code == 422
    assert resp.json()["detail"] == DECK_422
    assert h.billed == []


def test_a_legacy_game_regenerate_returns_a_deck_billed_as_one_item(monkeypatch):
    h = Harness(monkeypatch, _plan([_mcq(), _deck(7)]))
    resp = h.draft(single_item_type="GAME", completion_points=12)

    assert resp.status_code == 200, resp.text
    [item] = resp.json()["slots"][0]["items"]
    assert item["itemType"] == "FLASHCARDS"
    assert item["completionPoints"] == 12 and item["correctPoints"] == 0
    [bill] = h.billed
    assert bill["tool_key"] == "engagement_item"


def test_weekdays_reach_the_draft_and_the_report(monkeypatch):
    h = Harness(monkeypatch, _plan([_deck(6)], [_deck(6)], [_deck(6)]))
    resp = h.draft(days=7, weekdays=["mon", "tue", "wed", "thu", "fri"])

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [s["startDate"] for s in body["slots"]] == ["2026-10-01", "2026-10-02", "2026-10-05"]
    assert body["days_requested"] == 5 and body["days_planned"] == 3
    assert body["items_requested"] == 5 and body["items_planned"] == 3
    assert body["missing_dates"] == ["2026-10-06", "2026-10-07"]
    # The pre-flight quoted the requested size; the charge used the delivered size.
    assert h.preflights[0]["tool_params"] == {"days": 5, "num_questions": 5}
    assert h.billed[0]["tool_params"] == {"days": 3, "num_questions": 3}


def test_weekdays_that_miss_the_whole_span_are_refused_before_the_model_call(monkeypatch):
    h = Harness(monkeypatch, _plan([_deck(6)]))
    resp = h.draft(days=2, start_date="2026-10-03", weekdays=[1, 2, 3, 4, 5])  # Sat + Sun

    assert resp.status_code == 400
    assert "weekday" in resp.json()["detail"]
    assert h.prompts == [] and h.billed == []


def test_bad_weekdays_are_a_readable_422(monkeypatch):
    h = Harness(monkeypatch, _plan([_deck(6)]))
    resp = h.draft(weekdays=["someday"])

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Pick the weekdays the plan runs on (Mon to Sun)."
    assert h.prompts == []


def _enabled_line(prompt: str) -> str:
    return next(line for line in prompt.splitlines() if line.startswith("Enabled task types:"))


# ── jobs ─────────────────────────────────────────────────────────────────────

class JobHarness(Harness):
    """The router with a real (SQLite) ai_task table and the real background
    scheduler; only the model stream, billing and the credit check are stubbed."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, tmp_path, pieces: List[str]):
        super().__init__(monkeypatch, "".join(pieces))
        engine = create_engine(
            f"sqlite:///{tmp_path / 'jobs.db'}", connect_args={"check_same_thread": False}
        )
        AiTask.metadata.create_all(engine, tables=[AiTask.__table__])
        self.Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)

        @contextmanager
        def fake_db_session():
            s = self.Session()
            try:
                yield s
                s.commit()
            except Exception:
                s.rollback()
                raise
            finally:
                s.close()

        def fake_db_dependency():
            s = self.Session()
            try:
                yield s
            finally:
                s.close()

        monkeypatch.setattr(router_module, "db_session", fake_db_session)
        monkeypatch.setattr(ai_task_service, "db_session", fake_db_session)
        monkeypatch.setattr(router_module, "_JOB_FLUSH_SECONDS", 0.05)
        self.app.dependency_overrides[db_dependency] = fake_db_dependency

        self.pieces = pieces
        self.gate = threading.Event()  # set → the stub stream may finish
        self.gate_after = len(pieces)  # pieces sent before waiting on the gate
        self.gate.set()
        self.stream_calls = 0
        self.stream_cancelled = threading.Event()
        self.stream_error: Optional[BaseException] = None

        async def fake_stream(prompt, api_key, base_url, model, on_delta=None):
            self.stream_calls += 1
            self.prompts.append(prompt)
            try:
                if on_delta:
                    on_delta("reasoning", 500)
                for i, piece in enumerate(self.pieces):
                    if i == self.gate_after:
                        while not self.gate.is_set():
                            await asyncio.sleep(0.01)
                    if on_delta:
                        on_delta("content", piece)
                    await asyncio.sleep(0)
                while not self.gate.is_set():
                    await asyncio.sleep(0.01)
            except asyncio.CancelledError:
                self.stream_cancelled.set()
                raise
            if self.stream_error:
                raise self.stream_error
            return "".join(self.pieces), {"prompt_tokens": 1000, "completion_tokens": 400}

        monkeypatch.setattr(router_module, "stream_model", fake_stream)

    def start(self, **overrides: Any):
        return self.c.post(router_module.router.prefix + "/draft/jobs", json=self.body(**overrides))

    def get(self, task_id: str):
        return self.c.get(f"{router_module.router.prefix}/draft/jobs/{task_id}")

    def wait(self, task_id: str, until=lambda v: v["status"] != "PROGRESS", timeout: float = 5.0) -> Dict[str, Any]:
        end = time.monotonic() + timeout
        while True:
            view = self.get(task_id).json()
            if until(view) or time.monotonic() > end:
                return view
            time.sleep(0.02)


def _pieces_for_days(n_days: int) -> List[str]:
    """A plan reply cut at day boundaries, the way a stream arrives."""
    days = [{"day": i + 1, "theme": f"Theme {i + 1}", "items": [_deck(6)]} for i in range(n_days)]
    text = json.dumps({"title": "Model title", "days": days})
    cuts = [m.start() for m in re.finditer(r'\{"day": ', text)][1:]
    out, prev = [], 0
    for c in cuts:
        out.append(text[prev:c])
        prev = c
    out.append(text[prev:])
    return out


@pytest.fixture
def job_harness(monkeypatch, tmp_path):
    def make(pieces: List[str]) -> JobHarness:
        return JobHarness(monkeypatch, tmp_path, pieces)

    return make


def test_job_reports_day_progress_and_returns_the_draft_billed_once(job_harness):
    h = job_harness(_pieces_for_days(3))
    h.gate.clear()
    h.gate_after = 2  # day 1 and day 2 written, then the model "pauses"
    with TestClient(h.app) as c:
        h.c = c
        started = h.start(days=3, title="Plants week")
        assert started.status_code == 200, started.text
        job = started.json()
        assert job["status"] == "PROGRESS" and job["kind"] == "plan"
        assert job["progress"]["days_total"] == 3 and job["charged"] is False

        mid = h.wait(job["task_id"], until=lambda v: v["progress"].get("days_done") == 1)
        assert mid["status"] == "PROGRESS"
        assert mid["progress"]["phase"] == "writing"
        assert mid["progress"]["days_done"] == 1  # day 2 is still being written
        assert h.billed == []

        h.gate.set()
        done = h.wait(job["task_id"])
        assert done["status"] == "COMPLETED", done
        assert done["charged"] is True
        assert done["progress"] == {"phase": "done", "days_done": 3, "days_total": 3}
        result = done["result"]
        assert result["title"] == "Plants week"
        assert result["days_planned"] == 3 and result["days_requested"] == 3
        assert all(s["items"][0]["itemType"] == "FLASHCARDS" for s in result["slots"])

        # Polling again never bills again.
        for _ in range(3):
            assert h.get(job["task_id"]).json()["status"] == "COMPLETED"
    assert len(h.billed) == 1
    assert h.billed[0]["tool_key"] == "engagement_plan"
    assert h.billed[0]["idempotency_key"] == "engagement-test-key"
    assert h.billed[0]["prompt_tokens"] == 1000


def test_a_job_without_a_key_is_billed_under_its_own_id(job_harness):
    h = job_harness(_pieces_for_days(1))
    with TestClient(h.app) as c:
        h.c = c
        job = h.start(idempotency_key=None).json()
        assert h.wait(job["task_id"])["status"] == "COMPLETED"
    assert [b["idempotency_key"] for b in h.billed] == [f"engagement-plan-job:{job['task_id']}"]


def test_starting_twice_with_one_key_reattaches_instead_of_paying_twice(job_harness):
    h = job_harness(_pieces_for_days(1))
    h.gate.clear()
    with TestClient(h.app) as c:
        h.c = c
        first = h.start().json()
        second = h.start().json()
        assert second["task_id"] == first["task_id"]
        h.gate.set()
        assert h.wait(first["task_id"])["status"] == "COMPLETED"
        # Finished: the same key still returns the finished draft, not a new run.
        third = h.start().json()
        assert third["task_id"] == first["task_id"] and third["status"] == "COMPLETED"
    assert h.stream_calls == 1
    assert len(h.billed) == 1


def test_an_unusable_regenerate_job_fails_with_the_reason_and_is_not_billed(job_harness):
    h = job_harness([_plan([_deck(2)])])
    with TestClient(h.app) as c:
        h.c = c
        job = h.start(single_item_type="FLASHCARDS").json()
        assert job["kind"] == "item" and job["single_item_type"] == "FLASHCARDS"
        done = h.wait(job["task_id"])
    assert done["status"] == "FAILED"
    assert done["error"] == DECK_422 and done["error_code"] == 422
    assert done["charged"] is False and done["result"] is None
    assert h.billed == []


def test_a_provider_failure_fails_the_job_without_billing(job_harness):
    import httpx

    h = job_harness(_pieces_for_days(1))
    h.stream_error = httpx.ReadTimeout("slow")
    with TestClient(h.app) as c:
        h.c = c
        done = h.wait(h.start().json()["task_id"])
    assert done["status"] == "FAILED"
    assert "took too long" in done["error"] and done["error_code"] == 502
    assert h.billed == []


def test_cancel_stops_the_model_and_is_never_billed(job_harness):
    h = job_harness(_pieces_for_days(2))
    h.gate.clear()
    h.gate_after = 1
    with TestClient(h.app) as c:
        h.c = c
        job = h.start(days=2).json()
        h.wait(job["task_id"], until=lambda v: v["progress"].get("phase") == "writing")
        cancelled = c.post(f"{router_module.router.prefix}/draft/jobs/{job['task_id']}/cancel").json()
        assert cancelled["status"] == "CANCELLED" and cancelled["charged"] is False
        assert h.stream_cancelled.wait(3.0), "the model stream was not aborted"
        time.sleep(0.2)
        after = h.get(job["task_id"]).json()
        # Re-attach does not offer a cancelled draft.
        active = c.get(f"{router_module.router.prefix}/draft/jobs/active").json()
    assert after["status"] == "CANCELLED"
    assert active == {"job": None}
    assert h.billed == []


def test_active_reattaches_to_a_finished_draft_until_it_is_acknowledged(job_harness):
    h = job_harness(_pieces_for_days(1))
    with TestClient(h.app) as c:
        h.c = c
        job = h.start().json()
        h.wait(job["task_id"])
        active = c.get(f"{router_module.router.prefix}/draft/jobs/active").json()["job"]
        assert active["task_id"] == job["task_id"] and active["status"] == "COMPLETED"
        assert active["result"]["slots"]
        # A regenerate job is not what the plan wizard re-attaches to.
        assert c.get(f"{router_module.router.prefix}/draft/jobs/active?kind=item").json() == {"job": None}

        assert c.post(f"{router_module.router.prefix}/draft/jobs/{job['task_id']}/ack").json() == {"ok": True}
        assert c.get(f"{router_module.router.prefix}/draft/jobs/active").json() == {"job": None}


def test_a_job_is_private_to_the_teacher_who_started_it(job_harness):
    h = job_harness(_pieces_for_days(1))
    with TestClient(h.app) as c:
        h.c = c
        job = h.start().json()
        h.wait(job["task_id"])
        h.user = {"user_id": "u2", "institute_id": "inst-1", "roles": ["TEACHER"]}
        assert h.get(job["task_id"]).status_code == 404
        assert c.post(f"{router_module.router.prefix}/draft/jobs/{job['task_id']}/cancel").status_code == 404
        assert c.get(f"{router_module.router.prefix}/draft/jobs/active").json() == {"job": None}
        h.user = {"user_id": "u1", "institute_id": "inst-2", "roles": ["TEACHER"]}
        assert h.get(job["task_id"]).status_code == 404
        h.user = {"user_id": "u1", "institute_id": "inst-1", "roles": ["STUDENT"]}
        assert h.get(job["task_id"]).status_code == 403


def test_a_job_that_stopped_heartbeating_reads_as_interrupted(job_harness):
    h = job_harness(_pieces_for_days(1))
    old = datetime.now(timezone.utc) - timedelta(minutes=5)
    with h.Session() as s:
        s.add(
            AiTask(
                id="stale-1",
                task_type=router_module.JOB_TYPE,
                status=AiTaskStatus.PROGRESS.value,
                institute_id="inst-1",
                input_id="u1",
                status_message=json.dumps({"phase": "writing", "days_done": 2, "days_total": 7}),
                dynamic_values_map=json.dumps({"kind": "plan"}),
                created_at=old,
                updated_at=old,
            )
        )
        s.commit()
    with TestClient(h.app) as c:
        h.c = c
        view = h.get("stale-1").json()
    assert view["status"] == "INTERRUPTED"
    assert view["charged"] is False and "weren't charged" in view["error"]


def test_job_start_refuses_a_bad_brief_before_creating_anything(job_harness):
    h = job_harness(_pieces_for_days(1))
    with TestClient(h.app) as c:
        h.c = c
        assert h.start(topic="", grounding_texts=[]).status_code == 400
        assert h.start(single_item_type="HOMEWORK").status_code == 400
        assert h.start(start_date="nope").status_code == 422
    with h.Session() as s:
        assert s.query(AiTask).count() == 0
    assert h.stream_calls == 0


def test_the_sync_draft_endpoint_is_unchanged_next_to_the_jobs(job_harness):
    h = job_harness(_pieces_for_days(1))
    with TestClient(h.app) as c:
        h.c = c
        resp = c.post(router_module.router.prefix + "/draft", json=h.body())
    assert resp.status_code == 200
    assert resp.json()["slots"][0]["items"][0]["itemType"] == "FLASHCARDS"
    assert h.stream_calls == 0  # the sync path uses the plain call


# ── streamed model call ──────────────────────────────────────────────────────

class _FakeStreamResponse:
    def __init__(self, lines: List[str], status_code: int = 200):
        self.lines = lines
        self.status_code = status_code
        self.request = None

    async def aread(self) -> bytes:
        return b"provider says no"

    async def aiter_lines(self):
        for line in self.lines:
            yield line


def _fake_client(monkeypatch, lines: List[str], status_code: int = 200) -> List[Dict[str, Any]]:
    sent: List[Dict[str, Any]] = []

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def stream(self, method, url, headers=None, json=None):
            sent.append(json)
            resp = _FakeStreamResponse(lines, status_code)

            class _Ctx:
                async def __aenter__(self_inner):
                    return resp

                async def __aexit__(self_inner, *exc):
                    return False

            return _Ctx()

    monkeypatch.setattr(svc.httpx, "AsyncClient", FakeClient)
    return sent


def _sse(obj: Dict[str, Any]) -> str:
    return "data: " + json.dumps(obj)


def test_stream_model_collects_content_reasoning_and_usage(monkeypatch):
    sent = _fake_client(
        monkeypatch,
        [
            ": OPENROUTER PROCESSING",
            _sse({"choices": [{"delta": {"reasoning": "thinking..."}}]}),
            _sse({"choices": [{"delta": {"content": '{"days": ['}}]}),
            "",
            _sse({"choices": [{"delta": {"content": "]}"}}]}),
            _sse({"choices": [], "usage": {"prompt_tokens": 7, "completion_tokens": 3}}),
            "data: [DONE]",
        ],
    )
    events: List[Any] = []
    text, usage = asyncio.run(svc.stream_model("p", "k", "http://x", "m", lambda k, v: events.append((k, v))))
    assert text == '{"days": []}'
    assert usage == {"prompt_tokens": 7, "completion_tokens": 3}
    assert events[0] == ("reasoning", len("thinking..."))
    assert [v for k, v in events if k == "content"] == ['{"days": [', "]}"]
    assert sent[0]["stream"] is True and sent[0]["stream_options"] == {"include_usage": True}
    assert sent[0]["response_format"] == {"type": "json_object"}


def test_stream_model_raises_on_a_provider_error(monkeypatch):
    import httpx

    _fake_client(monkeypatch, [], status_code=429)
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(svc.stream_model("p", "k", "http://x", "m"))

    _fake_client(monkeypatch, [_sse({"error": {"message": "overloaded"}})])
    with pytest.raises(RuntimeError, match="overloaded"):
        asyncio.run(svc.stream_model("p", "k", "http://x", "m"))

    _fake_client(monkeypatch, ["data: [DONE]"])
    with pytest.raises(RuntimeError, match="empty"):
        asyncio.run(svc.stream_model("p", "k", "http://x", "m"))


def test_drafted_days_counts_finished_day_objects():
    pieces = _pieces_for_days(4)
    assert svc.drafted_days("", 4) == 0
    assert svc.drafted_days(pieces[0], 4) == 0
    assert svc.drafted_days("".join(pieces[:3]), 4) == 2
    assert svc.drafted_days("".join(pieces), 4) == 3  # the last day may still be open
    assert svc.drafted_days("".join(pieces) * 3, 4) == 4  # never beyond the total


# ── price ────────────────────────────────────────────────────────────────────

class _NoPricingTable:
    def execute(self, *a, **kw):
        raise RuntimeError("no ai_tool_pricing table")


@pytest.mark.parametrize("tasks, credits", [(14, 10), (3, 5), (93, 50), (1, 4)])
def test_engagement_plan_is_priced_by_the_number_of_tasks(tasks, credits):
    est = ToolCostEstimator(_NoPricingTable()).estimate("engagement_plan", {"num_questions": tasks})
    assert est["estimated_credits"] == credits


def test_engagement_item_stays_a_small_flat_charge():
    est = ToolCostEstimator(_NoPricingTable()).estimate("engagement_item", {})
    assert est["estimated_credits"] == 2


# ── review follow-ups: the wizard's contract, truncated replies, races ────────

def test_explicit_dates_win_over_days_and_weekdays():
    # The admin wizard sends `days` as the COUNT of its run dates plus the dates
    # themselves. Read as a span, days=5 from a Wednesday would lose Mon + Tue.
    brief = {
        "start_date": "2026-09-30",  # Wednesday
        "days": 5,
        "weekdays": [1, 2, 3, 4, 5],
        "dates": ["2026-10-06", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-02"],
    }
    assert [d.isoformat() for d in svc.plan_dates(brief)] == [
        "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06",
    ]
    # A regenerate is still exactly one date.
    assert svc.plan_dates(dict(brief, single_item_type="POLL")) == [date(2026, 9, 30)]


def test_the_wizards_brief_shape_drafts_every_run_date(monkeypatch):
    h = Harness(monkeypatch, _plan(*[[_deck(6)] for _ in range(5)]))
    dates = ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"]
    resp = h.draft(start_date=dates[0], days=5, weekdays=[1, 2, 3, 4, 5], dow_mask=31, dates=dates)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [s["startDate"] for s in body["slots"]] == dates
    assert body["days_requested"] == 5 and body["missing_dates"] == []
    assert "Day 4 = Mon 5 Oct" in h.prompts[0]
    assert h.preflights[0]["tool_params"] == {"days": 5, "num_questions": 5}


@pytest.mark.parametrize("dates", [["not-a-date"], [f"2026-10-{d:02d}" for d in range(1, 32)] + ["2026-11-01"]])
def test_bad_dates_are_a_readable_422(monkeypatch, dates):
    h = Harness(monkeypatch, _plan([_deck(6)]))
    resp = h.draft(dates=dates)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Pick between 1 and 31 valid run dates (yyyy-MM-dd)."
    assert h.prompts == []


def test_a_cut_off_reply_keeps_its_complete_days():
    full = _plan([_deck(6)], [_mcq()], [_deck(6)])
    cut = full[: full.index('"Theme 3"') + 20]  # day 3 is cut mid-object
    raw = svc.parse_draft_reply(cut)
    assert raw["title"] == "Model title"
    assert len(raw["days"]) == 2

    brief = {"start_date": "2026-10-01", "days": 3, "per_day_items": 1}
    draft = svc.normalise_draft(raw, brief)
    assert [s["startDate"] for s in draft["slots"]] == ["2026-10-01", "2026-10-02"]
    assert draft["missing_dates"] == ["2026-10-03"]


def test_a_reply_with_no_complete_day_still_fails():
    with pytest.raises(ValueError):
        svc.parse_draft_reply('{"title": "x", "days": [{"day": 1, "items": [')
    with pytest.raises(ValueError):
        svc.parse_draft_reply("the model said no")
    assert svc.salvage_partial_plan('{"days": []}') is None


def test_a_cut_off_plan_is_delivered_short_and_billed_for_what_came_back(monkeypatch):
    full = _plan([_deck(6)], [_deck(6)], [_deck(6)])
    h = Harness(monkeypatch, full[: full.index('"Theme 3"') + 20])
    resp = h.draft(days=3)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["days_planned"] == 2 and body["days_requested"] == 3
    assert body["missing_dates"] == ["2026-10-03"]
    assert h.billed[0]["tool_params"] == {"days": 2, "num_questions": 2}


def test_the_jobs_are_also_served_at_the_path_the_wizard_calls(job_harness):
    h = job_harness(_pieces_for_days(1))
    root = router_module.router.prefix
    with TestClient(h.app) as c:
        h.c = c
        started = c.post(f"{root}/jobs", json=h.body())
        assert started.status_code == 200, started.text
        task_id = started.json()["task_id"]
        done = h.wait(task_id)
        assert done["status"] == "COMPLETED"
        assert c.get(f"{root}/jobs/{task_id}").json()["status"] == "COMPLETED"
        assert c.get(f"{root}/jobs/active").json()["job"]["task_id"] == task_id
        assert c.post(f"{root}/jobs/{task_id}/ack").json() == {"ok": True}
        assert c.get(f"{root}/jobs/active").json() == {"job": None}
        assert c.post(f"{root}/jobs/{task_id}/cancel").json()["status"] == "COMPLETED"
    assert len(h.billed) == 1


@pytest.mark.parametrize("age_minutes, expected", [(3, "PROGRESS"), (11, "INTERRUPTED")])
def test_a_job_waiting_for_a_worker_slot_is_not_called_dead_too_early(job_harness, age_minutes, expected):
    h = job_harness(_pieces_for_days(1))
    old = datetime.now(timezone.utc) - timedelta(minutes=age_minutes)
    with h.Session() as s:
        s.add(
            AiTask(
                id="queued-1",
                task_type=router_module.JOB_TYPE,
                status=AiTaskStatus.PROGRESS.value,
                institute_id="inst-1",
                input_id="u1",
                status_message=json.dumps({"phase": "queued", "days_done": 0, "days_total": 7}),
                dynamic_values_map=json.dumps({"kind": "plan"}),
                created_at=old,
                updated_at=old,
            )
        )
        s.commit()
    with TestClient(h.app) as c:
        h.c = c
        assert h.get("queued-1").json()["status"] == expected


@pytest.mark.parametrize("reply", ["unusable", "usable"])
def test_a_cancel_the_heartbeat_has_not_seen_yet_is_still_honoured(job_harness, monkeypatch, reply):
    # The cancel lands between heartbeats and the model finishes right after:
    # an unusable reply must read CANCELLED (not a FAILED error), and a usable
    # one must not be billed.
    pieces = [_plan([_deck(2)])] if reply == "unusable" else _pieces_for_days(1)
    h = job_harness(pieces)
    monkeypatch.setattr(router_module, "_JOB_FLUSH_SECONDS", 30.0)
    h.gate.clear()
    with TestClient(h.app) as c:
        h.c = c
        job = h.start(single_item_type="FLASHCARDS" if reply == "unusable" else None).json()
        h.wait(job["task_id"], until=lambda v: v["progress"].get("phase") == "thinking")
        root = router_module.router.prefix
        assert c.post(f"{root}/draft/jobs/{job['task_id']}/cancel").json()["status"] == "CANCELLED"
        h.gate.set()
        time.sleep(0.8)
        after = h.get(job["task_id"]).json()
    assert after["status"] == "CANCELLED", after
    assert after["charged"] is False and after["error"] == ""
    assert h.billed == []
