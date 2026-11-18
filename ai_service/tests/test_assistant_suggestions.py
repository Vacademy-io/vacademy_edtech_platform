"""
Follow-up suggestions in the Vacademy Assistant.

Pinned here: the model's ```suggestions block is parsed and cut out of the
answer, also while tokens stream (however the text is split, no part of the
block reaches the user); malformed or missing blocks give no suggestions;
at most three short plain questions survive, never one naming a tool, a
link, an action that contacts people or an area the caller has no tool for;
refused, failed and card turns get none; the suggestions ride on the
message event and are stored with the message; and the prompt asks for them.
"""
from __future__ import annotations

import json
import random
import sys
import threading
from contextlib import nullcontext
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.services import assistant_tool_registry as reg  # noqa: E402  (load the registry first)
from app.services import assistant_service as asv  # noqa: E402
from app.services import assistant_suggestions as sg  # noqa: E402
from app.services.entitlements import LEGACY  # noqa: E402
from crm_fakes import principal  # noqa: E402

ANSWER = "Asha has **2** overdue instalments.\n\n| Due | Amount |\n|---|---|\n| 1 Nov | 5,000 |"
BLOCK = '```suggestions\n["Show her payment history", "Who else is overdue?"]\n```'
ALL_TOOLS = set(reg.ASSISTANT_TOOLS)
ADMIN_TOOLS = {"search_help_knowledge", "learners", "learner_report", "get_fee_dues", "get_payment_history",
               "find_assessment", "get_assessment_results", "get_class_schedule", "list_announcements"}


def stream_through(text: str, sizes) -> str:
    """What the user sees when ``text`` streams in chunks of the given sizes."""
    f = sg.SuggestionStreamFilter()
    shown, at = [], 0
    for size in sizes:
        shown.append(f.feed(text[at:at + size]))
        at += size
    shown.append(f.feed(text[at:]))
    tail, _ = f.finish()
    return "".join(shown) + tail


# ── parsing and stripping ────────────────────────────────────────────────

def test_the_block_is_parsed_and_cut_out():
    content, raw = sg.split_suggestions(f"{ANSWER}\n\n{BLOCK}\n")
    assert content == ANSWER
    assert raw == ["Show her payment history", "Who else is overdue?"]


def test_an_answer_without_a_block_is_unchanged_and_has_none():
    content, raw = sg.split_suggestions(ANSWER + "\n\n```python\nprint('code stays')\n```")
    assert content.startswith(ANSWER) and "print('code stays')" in content and raw is None


@pytest.mark.parametrize("block", [
    "```suggestions\nnot json at all\n```",
    "```suggestions\n{\"a\": 1}\n```",
    "```suggestions\n\"just a string\"\n```",
    "```suggestions\n[\"unterminated\", \n",
    "```Suggestions\n[\"half a list\"",
    "```suggestions",
])
def test_a_malformed_block_is_still_cut_out_and_gives_nothing_usable(block):
    content, raw = sg.split_suggestions(f"{ANSWER}\n\n{block}")
    assert content == ANSWER and raw is None
    assert sg.validate_suggestions(raw, ADMIN_TOOLS, all_tools=ALL_TOOLS) == []


def test_an_unterminated_block_at_the_end_still_counts():
    content, raw = sg.split_suggestions(ANSWER + '\n```suggestions\n["Who else is overdue?"]')
    assert content == ANSWER and raw == ["Who else is overdue?"]


def test_an_object_form_and_text_after_the_block_are_handled():
    content, raw = sg.split_suggestions(
        'Done.\n```suggestions\n{"suggestions": ["Any more?"]}\n```\nAnything else?')
    assert raw == ["Any more?"] and content == "Done.\n\nAnything else?"


# ── streaming ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(40))
def test_no_part_of_the_block_is_ever_shown_while_streaming(seed):
    rng = random.Random(seed)
    text = f"{ANSWER}\n\n{BLOCK}"
    sizes = [rng.randint(1, 7) for _ in range(len(text))]
    f = sg.SuggestionStreamFilter()
    shown, at = "", 0
    for size in sizes:
        if at >= len(text):
            break
        shown += f.feed(text[at:at + size])
        at += size
        # at no point does any piece of the fence or its content reach the user
        assert "```" not in shown and "suggest" not in shown.lower() and "payment history" not in shown
    tail, bodies = f.finish()
    assert (shown + tail).rstrip() == ANSWER
    assert sg.parse_block(bodies[-1]) == ["Show her payment history", "Who else is overdue?"]


def test_one_token_per_character_shows_the_answer_exactly():
    assert stream_through(f"{ANSWER}\n\n{BLOCK}", [1] * 400).rstrip() == ANSWER


def test_held_back_backticks_are_released_when_they_are_not_the_block():
    text = "Use the `Fees` tab, or run:\n```sql\nselect 1\n```\nThat is all."
    assert stream_through(text, [1] * len(text)) == text
    assert stream_through(text, [3, 5, 2, 9, 1, 30]) == text


def test_a_fence_split_across_chunks_is_caught():
    f = sg.SuggestionStreamFilter()
    assert f.feed("Answer.\n``") == "Answer.\n"
    assert f.feed("`sugg") == ""
    assert f.feed('estions\n["Next?"]\n``') == ""
    assert f.feed("`") == ""
    tail, bodies = f.finish()
    assert tail == "" and sg.parse_block(bodies[0]) == ["Next?"]


# ── validation ───────────────────────────────────────────────────────────

def test_at_most_three_short_distinct_plain_questions():
    raw = ["Who else is overdue?", "who else is overdue", "  1. Show her   payment history ", 42, None, "",
           "x" * 81, "Show her attendance this month", "What about her test scores?"]
    out = sg.validate_suggestions(raw, ADMIN_TOOLS, all_tools=ALL_TOOLS)
    assert out == ["Who else is overdue?", "Show her payment history", "Show her attendance this month"]
    assert all(len(s) <= sg.MAX_SUGGESTION_CHARS for s in out)


def test_the_question_just_asked_is_not_suggested_back():
    out = sg.validate_suggestions(["Who is overdue?", "Show payment history"], ADMIN_TOOLS, asked="who is overdue")
    assert out == ["Show payment history"]


@pytest.mark.parametrize("text", [
    "Run crm_leads for this week",            # a tool name
    "Use get_fee_dues on Asha",               # a tool name
    "Open [Fees](/fees)",                     # a link
    "See https://example.com",                # a url
    "Use `learners` to search",               # markup
    "Call Asha now",                          # contacts people
    "WhatsApp the overdue learners",
    "Send a reminder to everyone overdue",
    "Email the parents about fees",
])
def test_tool_names_links_and_contact_actions_are_dropped(text):
    assert sg.validate_suggestions([text], ADMIN_TOOLS | {"crm_leads"}, all_tools=ALL_TOOLS) == []


def test_areas_the_caller_has_no_tool_for_are_dropped():
    help_only = {"search_help_knowledge"}
    raw = ["Show this week's new leads", "Who owes fees this month?", "Top scorers in the last test",
           "How do I add a lead?", "What's on the class schedule today?"]
    assert sg.validate_suggestions(raw, help_only, all_tools=ALL_TOOLS) == ["How do I add a lead?"]
    crm = help_only | {"crm_reports", "crm_collections"}
    assert sg.validate_suggestions(raw, crm, all_tools=ALL_TOOLS) == [
        "Show this week's new leads", "Who owes fees this month?", "How do I add a lead?"]
    # without the help search, how-to questions are not offered either
    assert sg.validate_suggestions(["How do I add a lead?"], {"crm_leads"}) == []


def test_refusals_and_failures_are_recognised():
    assert sg.refused_or_failed(json.dumps({"error": "tool_not_permitted"}))
    assert sg.refused_or_failed(json.dumps({"error": "tool_failed", "tool": "x"}))
    assert sg.refused_or_failed({"error": "module_not_enabled"})
    assert not sg.refused_or_failed(json.dumps({"error": "missing_argument"}))
    assert not sg.refused_or_failed(json.dumps({"rows": []}))
    assert not sg.refused_or_failed("not json")
    assert sg.answer_points_to_settings("An admin can enable it in [AI access settings](/settings?selectedTab=aiAccess).")


# ── the assistant loop, end to end with a fake model ─────────────────────

class _Turn:
    """Patches everything around AssistantAgentService.stream; the fake model streams in small chunks."""

    def __init__(self, monkeypatch, script, roles=("ADMIN",), results=None, card=False, fail=False, setting=None):
        self.store, self.script, self.results = [], list(script), dict(results or {})
        self.principal = principal(user_id="u-1", roles=roles)
        self.prompts = []
        turn = self

        def add(session_id, message_type, content, metadata=None):
            msg = SimpleNamespace(id=len(turn.store) + 1, session_id=session_id, message_type=message_type,
                                  content=content, meta_data=metadata, created_at=datetime.now(timezone.utc))
            turn.store.append(msg)
            return msg

        self.add = add

        class SessionRepo:
            def __init__(self, db):
                pass

            def get_session_by_id(self, sid):
                return SimpleNamespace(id=sid, user_id="u-1", institute_id="inst-1",
                                       context_type=reg.ASSISTANT_CONTEXT_TYPE, status="ACTIVE")

            def update_last_active(self, sid):
                pass

        class MessageRepo:
            def __init__(self, db):
                pass

            def get_latest_message(self, sid):
                return turn.store[-1] if turn.store else None

            def get_conversation_history(self, sid, limit=10, message_types=None):
                types = message_types or ["user", "assistant"]
                return [m for m in turn.store if m.message_type in types][-limit:]

            def create_message(self, session_id, message_type, content, metadata=None):
                return add(session_id, message_type, content, metadata)

        class Llm:
            def __init__(self, resolver):
                pass

            async def chat_completion_stream(self, messages, tools=None, **kw):
                turn.prompts.append(messages[0]["content"])
                if fail:
                    yield {"type": "token", "content": "Partial "}
                    raise RuntimeError("model down")
                step = turn.script.pop(0) if turn.script else "Done."
                if isinstance(step, tuple):
                    name, args = step
                    yield {"type": "tool_calls", "tool_calls": [
                        {"id": f"call-{len(turn.prompts)}", "function": {"name": name, "arguments": json.dumps(args)}}]}
                    return
                for i in range(0, len(step), 3):
                    yield {"type": "token", "content": step[i:i + 3]}

        async def fake_execute(name, args, ctx, setting, *, in_product=False):
            if card:
                ctx.pending_action = {"action_id": "n-1", "tool": name, "summary": "Change it"}
            return turn.results.get(name, json.dumps({"ok": True}))

        monkeypatch.setattr(asv, "ChatSessionRepository", SessionRepo)
        monkeypatch.setattr(asv, "ChatMessageRepository", MessageRepo)
        monkeypatch.setattr(asv, "ApiKeyResolver", lambda db: SimpleNamespace(resolve_keys=lambda **kw: ("k",)))
        monkeypatch.setattr(asv, "_assistant_model_chain", lambda *a: (None, None))
        monkeypatch.setattr(asv, "load_assistant_tools_setting", lambda db, inst: setting)
        monkeypatch.setattr(asv, "load_entitlements", lambda db, inst: LEGACY)
        monkeypatch.setattr(asv, "CreditService", lambda db: SimpleNamespace(
            check_credits=lambda req: SimpleNamespace(has_sufficient_credits=True)))
        monkeypatch.setattr(asv, "ChatLLMClient", Llm)
        monkeypatch.setattr(asv, "execute_tool", fake_execute)
        self.service = asv.AssistantAgentService(lambda: nullcontext(object()))

    async def ask(self, text, route="/dashboard"):
        self.add("s-1", "user", text, {"page_context": {"route": route}})
        return [e async for e in self.service.stream("s-1", self.principal, bearer_token="jwt")]

    @staticmethod
    def shown(events):
        return "".join(e["data"]["content"] for e in events if e["event"] == "token")

    @staticmethod
    def final(events):
        return [e["data"] for e in events if e["event"] == "message" and e["data"]["type"] == "assistant"][-1]

    def saved(self):
        return [m for m in self.store if m.message_type == "assistant"][-1]


async def test_the_answer_streams_without_the_block_and_the_suggestions_ride_on_the_message(monkeypatch):
    turn = _Turn(monkeypatch, script=[("get_fee_dues", {"learner_id": "l-1"}), f"{ANSWER}\n\n{BLOCK}"])
    events = await turn.ask("Does Asha owe fees?")
    assert "```" not in _Turn.shown(events) and "suggest" not in _Turn.shown(events).lower()
    assert _Turn.shown(events).rstrip() == ANSWER
    final = _Turn.final(events)
    assert final["content"] == ANSWER
    assert final["suggestions"] == ["Show her payment history", "Who else is overdue?"]
    saved = turn.saved()
    assert saved.content == ANSWER and saved.meta_data == {"suggestions": final["suggestions"]}


async def test_no_block_means_no_suggestions(monkeypatch):
    turn = _Turn(monkeypatch, script=[ANSWER])
    final = _Turn.final(await turn.ask("Does Asha owe fees?"))
    assert final["content"] == ANSWER and "suggestions" not in final
    assert not turn.saved().meta_data


async def test_a_refused_tool_turn_gets_no_suggestions(monkeypatch):
    refused = json.dumps({"error": "tool_not_permitted", "tool": "get_fee_dues"})
    turn = _Turn(monkeypatch, script=[("get_fee_dues", {}), f"That isn't enabled for you.\n{BLOCK}"],
                 results={"get_fee_dues": refused})
    final = _Turn.final(await turn.ask("Does Asha owe fees?"))
    assert final["content"] == "That isn't enabled for you." and "suggestions" not in final


async def test_a_refused_load_tools_turn_gets_no_suggestions(monkeypatch):
    turn = _Turn(monkeypatch, roles=("TEACHER",), script=[("load_tools", {"topic": "crm"}), f"Not available.\n{BLOCK}"])
    final = _Turn.final(await turn.ask("Show my leads"))
    assert "suggestions" not in final


async def test_an_answer_pointing_to_the_access_settings_gets_no_suggestions(monkeypatch):
    turn = _Turn(monkeypatch, script=[
        f"An admin can turn it on in [AI access settings](/settings?selectedTab=aiAccess).\n{BLOCK}"])
    final = _Turn.final(await turn.ask("Send a fee reminder"))
    assert "suggestions" not in final and "```" not in final["content"]


async def test_a_card_turn_gets_no_suggestions(monkeypatch):
    turn = _Turn(monkeypatch, card=True, script=[("update_learner_profile", {}), f"Press Confirm on the card.\n{BLOCK}"])
    events = await turn.ask("Change Asha's phone")
    assert any(e["event"] == "action_request" for e in events)
    assert "suggestions" not in _Turn.final(events)


async def test_an_error_turn_gets_no_suggestions(monkeypatch):
    turn = _Turn(monkeypatch, script=[], fail=True)
    events = await turn.ask("Does Asha owe fees?")
    assert any(e["event"] == "error" for e in events)
    assert "suggestions" not in _Turn.final(events) and not turn.saved().meta_data


async def test_a_block_only_answer_saves_nothing(monkeypatch):
    turn = _Turn(monkeypatch, script=[BLOCK])
    events = await turn.ask("Hi")
    assert _Turn.shown(events) == "" and not [m for m in turn.store if m.message_type == "assistant"]


async def test_suggestions_for_tools_the_caller_lacks_are_dropped(monkeypatch):
    block = '```suggestions\n["Show this week\'s new leads", "How do I add a batch?"]\n```'
    turn = _Turn(monkeypatch, roles=("TEACHER",), script=[f"Here are the steps.\n{block}"])
    final = _Turn.final(await turn.ask("How do I add a course?"))
    assert final["suggestions"] == ["How do I add a batch?"]


async def test_the_prompt_asks_for_the_block_and_its_rules(monkeypatch):
    turn = _Turn(monkeypatch, script=["Hi."])
    await turn.ask("Hello")
    prompt = turn.prompts[0]
    assert "```suggestions" in prompt and "under 80 characters" in prompt
    assert "Leave the block out when you refuse" in prompt
    assert prompt.index("CAPABILITIES") < prompt.index("FOLLOW-UP SUGGESTIONS")


def test_the_history_view_and_stream_share_one_message_shape():
    msg = SimpleNamespace(id=7, message_type="assistant", content="Hi", meta_data={"suggestions": ["Next?"]},
                          created_at=datetime.now(timezone.utc))
    assert asv._msg_event(msg)["suggestions"] == ["Next?"]
    msg.message_type = "tool_result"
    assert "suggestions" not in asv._msg_event(msg)


async def test_learner_search_and_report_run_off_the_event_loop(monkeypatch):
    seen = []

    async def fake_execute(name, args, ctx, setting, *, in_product=False):
        seen.append((name, threading.get_ident(), ctx.db))
        return "{}"

    dbs = iter(["db-1", "db-2", "db-3"])
    monkeypatch.setattr(asv, "execute_tool", fake_execute)
    service = asv.AssistantAgentService(lambda: nullcontext(next(dbs)))
    p = principal()
    for name in ("learners", "learner_report", "search_help_knowledge"):
        await service._dispatch_tool(name, {"action": "find", "query": "Asha"}, p, (), "jwt", "s-1", None)
    main = threading.get_ident()
    assert seen[0][0] == "learners" and seen[0][1] != main
    assert seen[1][0] == "learner_report" and seen[1][1] != main
    assert seen[2][0] == "search_help_knowledge" and seen[2][1] == main
    assert [db for _n, _t, db in seen] == ["db-1", "db-2", "db-3"]       # each call has its own DB session
    # the MCP lane's own list is unchanged
    from app.mcp.constants import OFF_LOOP_TOOLS
    assert "learners" not in OFF_LOOP_TOOLS and "learner_report" not in OFF_LOOP_TOOLS


@pytest.mark.parametrize("opening", ["``` suggestions", "```\tsuggestions", "```  SUGGESTIONS"])
def test_a_spaced_opening_fence_is_also_cut_out(opening):
    text = f'Done.\n\n{opening}\n["Show overdue fees"]\n```'
    answer, raw = sg.split_suggestions(text)
    assert answer == "Done."
    assert raw == ["Show overdue fees"]


def test_a_spaced_opening_split_across_chunks_is_held_back():
    stream = sg.SuggestionStreamFilter()
    shown = stream.feed("Done.\n``` ") + stream.feed("sugg") + stream.feed('estions\n["A?"]\n```')
    tail, bodies = stream.finish()
    assert (shown + tail).strip() == "Done."
    assert bodies and "A?" in bodies[0]


def test_an_ordinary_code_fence_with_a_space_is_shown():
    text = "Run this:\n``` sql\nselect 1;\n```"
    answer, raw = sg.split_suggestions(text)
    assert answer == text
    assert raw is None
