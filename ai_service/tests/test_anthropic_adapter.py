"""Offline tests for the OpenAI <-> Anthropic Messages adapter
(services/llm_providers/anthropic_adapter.py). Pure functions, no network.

Run from the repo root:
    python -m pytest ai_service/tests/test_anthropic_adapter.py -q -p no:cacheprovider
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services.llm_providers import anthropic_adapter as A  # noqa: E402
from ai_service.app.services.llm_providers.anthropic_adapter import (  # noqa: E402
    ANTHROPIC_VERSION,
    StreamTranslator,
    error_to_openai,
    from_messages_response,
    to_messages_request,
    usage_to_openai,
)

REG = "anthropic/claude-sonnet-4.5"
OLD = "claude-sonnet-4-5"      # sampling: one of temperature/top_p; budget thinking; prefill ok
NEW = "claude-opus-5-5"        # no sampling, thinking can't be disabled, no forced tools, no prefill


def req(messages, model=OLD, **extra):
    return to_messages_request({"model": REG, "messages": messages, **extra}, model)


# ── constants / model table ─────────────────────────────────────────────────


def test_version_constant():
    assert ANTHROPIC_VERSION == "2023-06-01"


@pytest.mark.parametrize("registry,wire", [
    ("anthropic/claude-sonnet-4.5", "claude-sonnet-4-5"),
    ("anthropic/claude-haiku-4.5", "claude-haiku-4-5"),
    ("anthropic/claude-opus-5.5", "claude-opus-5-5"),
    ("anthropic/claude-opus-4", "claude-opus-4-0"),
    ("anthropic/claude-sonnet-4", "claude-sonnet-4-0"),
    ("anthropic/claude-sonnet-5", "claude-sonnet-5"),
    ("anthropic/claude-opus-4.1", "claude-opus-4-1"),
    ("anthropic/claude-sonnet-4.5:beta", "claude-sonnet-4-5"),
])
def test_derive_wire_model(registry, wire):
    assert A.derive_wire_model(registry) == wire


@pytest.mark.parametrize("model,sampling,thinking,default_on,off,forced,prefill,max_out", [
    ("claude-3-5-haiku-20241022", "both", "none", False, "disabled", True, True, 8192),
    ("claude-3-7-sonnet-latest", "both", "budget", False, "disabled", True, True, 64000),
    ("claude-opus-4-1-20250805", "one", "budget", False, "disabled", True, True, 32000),
    ("claude-sonnet-4-20250514", "one", "budget", False, "disabled", True, True, 64000),
    ("claude-haiku-4-5-20251001", "one", "budget", False, "disabled", True, True, 64000),
    ("anthropic/claude-sonnet-4.5", "one", "budget", False, "disabled", True, True, 64000),
    ("claude-opus-4-6", "one", "adaptive", False, "disabled", True, False, 128000),
    ("claude-opus-4-8", "none", "adaptive", False, "disabled", True, False, 128000),
    ("claude-opus-5", "none", "adaptive", True, "disabled", True, False, 128000),
    ("claude-sonnet-5", "none", "adaptive", True, "disabled", True, False, 128000),
    ("claude-haiku-5-5", "none", "adaptive", True, "disabled", True, False, 128000),
    ("claude-sonnet-5-5", "none", "adaptive", True, "between_tools", False, False, 128000),
    ("claude-opus-5-5", "none", "adaptive", True, "effort_low", False, False, 128000),
    ("claude-fable-5", "none", "adaptive", True, "effort_low", True, False, 128000),
    ("claude-fable-5-1", "none", "adaptive", True, "effort_low", False, False, 128000),
    ("claude-opus-6", "none", "adaptive", True, "effort_low", False, False, None),
    ("something-else", "none", "none", False, "disabled", False, False, None),
])
def test_caps_table(model, sampling, thinking, default_on, off, forced, prefill, max_out):
    c = A.caps_for(model)
    assert (c.sampling, c.thinking, c.thinking_default_on, c.thinking_off,
            c.forced_tool_choice, c.prefill, c.max_output) == \
        (sampling, thinking, default_on, off, forced, prefill, max_out)


# ── system / turns ──────────────────────────────────────────────────────────


def test_system_and_developer_go_top_level_as_string():
    body = req([
        {"role": "system", "content": "You are A."},
        {"role": "developer", "content": [{"type": "text", "text": "Be brief."}]},
        {"role": "user", "content": "hi"},
    ])
    assert body["system"] == "You are A.\n\nBe brief."
    assert body["messages"] == [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]
    assert body["model"] == OLD


def test_system_blocks_kept_when_cache_control_present():
    body = req([
        {"role": "system", "content": [
            {"type": "text", "text": "big stable prompt", "cache_control": {"type": "ephemeral"}}]},
        {"role": "system", "content": "volatile"},
        {"role": "user", "content": "q"},
    ])
    assert body["system"] == [
        {"type": "text", "text": "big stable prompt", "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": "volatile"},
    ]


def test_consecutive_same_role_merged_and_first_turn_user():
    body = req([
        {"role": "assistant", "content": "Hello, how can I help?"},
        {"role": "user", "content": "a"},
        {"role": "user", "content": "b"},
        {"role": "assistant", "content": "x"},
        {"role": "assistant", "content": "y"},
        {"role": "user", "content": "c"},
    ])
    roles = [m["role"] for m in body["messages"]]
    assert roles == ["user", "assistant", "user", "assistant", "user"]
    assert body["messages"][0]["content"] == [{"type": "text", "text": "Please proceed."}]
    assert [b["text"] for b in body["messages"][2]["content"]] == ["a", "b"]
    assert [b["text"] for b in body["messages"][3]["content"]] == ["x", "y"]


def test_system_only_payload_gets_a_user_turn():
    body = req([{"role": "system", "content": "Write a haiku."}])
    assert body["system"] == "Write a haiku."
    assert body["messages"][0]["role"] == "user"


def test_empty_and_whitespace_text_dropped():
    body = req([
        {"role": "user", "content": [{"type": "text", "text": "  "}, {"type": "text", "text": "real"}]},
        {"role": "assistant", "content": ""},
        {"role": "user", "content": "next"},
    ])
    # the blank assistant turn vanished, the two user turns merged
    assert body["messages"] == [{"role": "user", "content": [
        {"type": "text", "text": "real"}, {"type": "text", "text": "next"}]}]


def test_trailing_assistant_prefill_kept_on_old_models_and_rstripped():
    body = req([{"role": "user", "content": "q"}, {"role": "assistant", "content": "{ \n"}])
    assert body["messages"][-1] == {"role": "assistant", "content": [{"type": "text", "text": "{"}]}


def test_trailing_assistant_on_new_models_gets_continue_turn():
    body = req([{"role": "user", "content": "q"}, {"role": "assistant", "content": "partial"}], model=NEW)
    assert body["messages"][-1] == {"role": "user", "content": [{"type": "text", "text": "Continue."}]}


# ── content parts ───────────────────────────────────────────────────────────


def test_images_data_uri_and_url_and_cache_control():
    body = req([{"role": "user", "content": [
        {"type": "text", "text": "what is this?"},
        {"type": "image_url", "image_url": {"url": "data:image/jpg;base64,QUJD\nREVG"}},
        {"type": "image_url", "image_url": {"url": "https://x.test/a.png", "detail": "high"},
         "cache_control": {"type": "ephemeral"}},
        {"type": "image_url", "image_url": "data:image/svg+xml;base64,PHN2Zz4="},
    ]}])
    c = body["messages"][0]["content"]
    assert c[0] == {"type": "text", "text": "what is this?"}
    assert c[1] == {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "QUJDREVG"}}
    assert c[2] == {"type": "image", "source": {"type": "url", "url": "https://x.test/a.png"},
                    "cache_control": {"type": "ephemeral"}}
    assert c[3]["type"] == "text" and "unsupported type image/svg+xml" in c[3]["text"]


def test_pdf_file_part_becomes_document():
    body = req([{"role": "user", "content": [
        {"type": "file", "file": {"filename": "a.pdf", "file_data": "data:application/pdf;base64,JVBERi0="}},
        {"type": "text", "text": "summarise"},
    ]}])
    assert body["messages"][0]["content"][0] == {
        "type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": "JVBERi0="}}


def test_assistant_images_dropped():
    body = req([
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": [{"type": "text", "text": "a"},
                                          {"type": "image_url", "image_url": {"url": "https://x/y.png"}}]},
        {"role": "user", "content": "q2"},
    ])
    assert body["messages"][1]["content"] == [{"type": "text", "text": "a"}]


# ── tools ───────────────────────────────────────────────────────────────────

TOOLS = [
    {"type": "function", "function": {"name": "get_weather", "description": "Weather for a city",
                                      "parameters": {"type": "object", "properties": {"city": {"type": "string"}},
                                                     "required": ["city"]}}},
    {"type": "function", "function": {"name": "now"}},
]


def test_tools_translated():
    body = req([{"role": "user", "content": "q"}], tools=TOOLS)
    assert body["tools"] == [
        {"name": "get_weather", "description": "Weather for a city",
         "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}},
        {"name": "now", "input_schema": {"type": "object", "properties": {}}},
    ]
    assert "tool_choice" not in body


@pytest.mark.parametrize("choice,expected", [
    ("auto", {"type": "auto"}),
    ("none", {"type": "none"}),
    ("required", {"type": "any"}),
    ({"type": "function", "function": {"name": "now"}}, {"type": "tool", "name": "now"}),
])
def test_tool_choice_on_models_that_allow_forcing(choice, expected):
    body = req([{"role": "user", "content": "q"}], tools=TOOLS, tool_choice=choice)
    assert body["tool_choice"] == expected
    assert "system" not in body


@pytest.mark.parametrize("choice,instruction", [
    ("required", "You must call one of the provided tools in this reply."),
    ({"type": "function", "function": {"name": "now"}}, "You must call the `now` tool in this reply."),
])
def test_forced_tool_choice_becomes_auto_plus_instruction_where_refused(choice, instruction):
    for model in ("claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"):
        body = req([{"role": "system", "content": "S"}, {"role": "user", "content": "q"}],
                   model=model, tools=TOOLS, tool_choice=choice)
        assert body["tool_choice"] == {"type": "auto"}
        assert body["system"] == "S\n\n" + instruction


def test_parallel_tool_calls_false():
    body = req([{"role": "user", "content": "q"}], tools=TOOLS, parallel_tool_calls=False)
    assert body["tool_choice"] == {"type": "auto", "disable_parallel_tool_use": True}


def test_multi_tool_turn_round_trip():
    body = req([
        {"role": "user", "content": "weather in Pune and the time?"},
        {"role": "assistant", "content": "Checking.", "tool_calls": [
            {"id": "call_1", "type": "function", "function": {"name": "get_weather", "arguments": '{"city":"Pune"}'}},
            {"id": "call.2:x", "type": "function", "function": {"name": "now", "arguments": ""}},
        ]},
        {"role": "tool", "tool_call_id": "call.2:x", "content": "10:00"},
        {"role": "tool", "tool_call_id": "call_1", "content": [{"type": "text", "text": "31C"}]},
        {"role": "user", "content": "thanks"},
    ], tools=TOOLS)
    msgs = body["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert msgs[1]["content"] == [
        {"type": "text", "text": "Checking."},
        {"type": "tool_use", "id": "call_1", "name": "get_weather", "input": {"city": "Pune"}},
        {"type": "tool_use", "id": "call_2_x", "name": "now", "input": {}},
    ]
    # ONE user turn: both results first (in call order), then the user's text
    assert msgs[2]["content"] == [
        {"type": "tool_result", "tool_use_id": "call_1", "content": [{"type": "text", "text": "31C"}]},
        {"type": "tool_result", "tool_use_id": "call_2_x", "content": "10:00"},
        {"type": "text", "text": "thanks"},
    ]


def test_bad_tool_arguments_wrapped():
    body = req([
        {"role": "user", "content": "q"},
        {"role": "assistant", "tool_calls": [
            {"id": "c1", "type": "function", "function": {"name": "now", "arguments": "{not json"}},
            {"id": "c2", "type": "function", "function": {"name": "now", "arguments": "[1,2]"}},
            {"id": "c3", "type": "function", "function": {"name": "now", "arguments": {"a": 1}}},
        ]},
        {"role": "tool", "tool_call_id": "c1", "content": "x"},
        {"role": "tool", "tool_call_id": "c2", "content": "y"},
        {"role": "tool", "tool_call_id": "c3", "content": "z"},
    ], tools=TOOLS)
    inputs = [b["input"] for b in body["messages"][1]["content"]]
    assert inputs == [{"_raw": "{not json"}, {"_raw": "[1,2]"}, {"a": 1}]


def test_missing_tool_result_filled_and_orphan_result_becomes_text():
    body = req([
        {"role": "user", "content": "q"},
        {"role": "assistant", "tool_calls": [
            {"id": "a", "type": "function", "function": {"name": "now", "arguments": "{}"}},
            {"id": "b", "type": "function", "function": {"name": "now", "arguments": "{}"}},
        ]},
        {"role": "tool", "tool_call_id": "a", "content": "ok"},
        {"role": "tool", "tool_call_id": "zzz", "content": "stray"},
    ], tools=TOOLS)
    last = body["messages"][-1]["content"]
    assert last[0] == {"type": "tool_result", "tool_use_id": "a", "content": "ok"}
    assert last[1]["tool_use_id"] == "b" and last[1]["is_error"] is True
    assert last[2] == {"type": "text", "text": "[result of tool call zzz]: stray"}


def test_trailing_tool_use_gets_result_turn():
    body = req([
        {"role": "user", "content": "q"},
        {"role": "assistant", "tool_calls": [
            {"id": "a", "type": "function", "function": {"name": "now", "arguments": "{}"}}]},
    ], tools=TOOLS)
    assert body["messages"][-1]["role"] == "user"
    assert body["messages"][-1]["content"][0]["tool_use_id"] == "a"


def test_tool_history_without_tools_is_flattened_to_text():
    body = req([
        {"role": "user", "content": "q"},
        {"role": "assistant", "tool_calls": [
            {"id": "a", "type": "function", "function": {"name": "now", "arguments": '{"tz":"IST"}'}}]},
        {"role": "tool", "tool_call_id": "a", "content": "10:00"},
        {"role": "user", "content": "so?"},
    ])
    assert "tools" not in body
    flat = json.dumps(body["messages"])
    assert "tool_use" not in flat and "tool_result" not in flat
    assert body["messages"][1]["content"][0]["text"] == '[called tool now with {"tz": "IST"}]'
    assert body["messages"][2]["content"][0]["text"] == "[result of tool call a]: 10:00"


# ── parameters ──────────────────────────────────────────────────────────────


def test_max_tokens_default_and_clamp():
    # No max_tokens from the caller (several admin_core report callers): the model's
    # output cap up to 64K, never the old 4096 that cut long JSON reports short.
    assert req([{"role": "user", "content": "q"}])["max_tokens"] == 64000
    assert req([{"role": "user", "content": "q"}], model="claude-opus-4-1")["max_tokens"] == 32000
    assert req([{"role": "user", "content": "q"}], model="claude-opus-5-5")["max_tokens"] == 64000
    assert req([{"role": "user", "content": "q"}], model="claude-3-5-haiku")["max_tokens"] == 8192
    assert req([{"role": "user", "content": "q"}], model="claude-future-x")["max_tokens"] == 32000
    assert req([{"role": "user", "content": "q"}], max_tokens=200)["max_tokens"] == 200
    assert req([{"role": "user", "content": "q"}], max_completion_tokens=300)["max_tokens"] == 300
    assert req([{"role": "user", "content": "q"}], max_tokens=500_000)["max_tokens"] == 64000
    assert req([{"role": "user", "content": "q"}], model="claude-opus-4-1", max_tokens=50_000)["max_tokens"] == 32000


def test_stop_sequences_and_stream():
    body = req([{"role": "user", "content": "q"}], stop=["END", " ", ""], stream=True)
    assert body["stop_sequences"] == ["END"]
    assert body["stream"] is True
    assert req([{"role": "user", "content": "q"}], stop="###")["stop_sequences"] == ["###"]


def test_sampling_rules_per_model():
    msgs = [{"role": "user", "content": "q"}]
    # Claude 4.x: temperature OR top_p — temperature wins; clamped to [0, 1]
    b = req(msgs, temperature=1.4, top_p=0.9, top_k=40)
    assert b["temperature"] == 1.0 and "top_p" not in b and b["top_k"] == 40
    b = req(msgs, top_p=0.8)
    assert b["top_p"] == 0.8 and "temperature" not in b
    # 3.x: both
    b = req(msgs, model="claude-3-5-haiku-20241022", temperature=0.2, top_p=0.9)
    assert b["temperature"] == 0.2 and b["top_p"] == 0.9
    # newer models and unknown ids: never sent
    for model in ("claude-opus-4-8", "claude-sonnet-5-5", "claude-opus-5-5", "mystery-model"):
        b = req(msgs, model=model, temperature=0.2, top_p=0.9, top_k=5)
        assert not {"temperature", "top_p", "top_k"} & set(b), model


def test_openrouter_only_keys_dropped():
    body = req([{"role": "user", "content": "q"}], reasoning={"enabled": False}, provider={"order": ["x"]},
               transforms=["middle-out"], plugins=[{"id": "web"}], route="fallback", models=["a"],
               usage={"include": True}, stream_options={"include_usage": True}, seed=1,
               frequency_penalty=0.1, presence_penalty=0.1, logprobs=True, n=1, user="u1",
               metadata={"a": 1})
    assert set(body) == {"model", "max_tokens", "messages"}


# ── JSON mode ───────────────────────────────────────────────────────────────


def test_json_object_instruction():
    p = {"messages": [{"role": "system", "content": "S"}, {"role": "user", "content": "q"}],
         "response_format": {"type": "json_object"}}
    body = to_messages_request(p, OLD)
    assert A.wants_json(p) is True
    assert body["system"].startswith("S\n\nRespond with only a single valid JSON value.")
    assert "response_format" not in body


def test_json_schema_instruction_includes_schema():
    schema = {"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"]}
    body = req([{"role": "user", "content": "q"}],
               response_format={"type": "json_schema", "json_schema": {"name": "x", "schema": schema}})
    assert "conform to this JSON Schema" in body["system"]
    assert json.dumps(schema, sort_keys=True) in body["system"]


def test_json_instruction_appended_after_cached_system_block():
    body = req([{"role": "system", "content": [{"type": "text", "text": "S", "cache_control": {"type": "ephemeral"}}]},
                {"role": "user", "content": "q"}], response_format={"type": "json_object"})
    assert body["system"][0] == {"type": "text", "text": "S", "cache_control": {"type": "ephemeral"}}
    assert "JSON" in body["system"][1]["text"] and "cache_control" not in body["system"][1]


def test_text_response_format_is_not_json():
    assert A.wants_json({"response_format": {"type": "text"}}) is False
    assert "system" not in req([{"role": "user", "content": "q"}], response_format={"type": "text"})


@pytest.mark.parametrize("text,expected", [
    ('```json\n{"a": 1}\n```', '{"a": 1}'),
    ('  ```\n[1, 2]\n```  \n', "[1, 2]"),
    ('```JSON\r\n{"a": 1}\r\n```', '{"a": 1}'),
    ('{"a": 1}', '{"a": 1}'),
    ('Here you go: ```json\n{}\n```', 'Here you go: ```json\n{}\n```'),
])
def test_fence_stripping(text, expected):
    resp = {"id": "msg_1", "content": [{"type": "text", "text": text}], "stop_reason": "end_turn", "usage": {}}
    assert from_messages_response(resp, REG, json_mode=True)["choices"][0]["message"]["content"] == expected


def test_no_fence_stripping_without_json_mode():
    text = '```json\n{"a": 1}\n```'
    resp = {"id": "m", "content": [{"type": "text", "text": text}], "stop_reason": "end_turn"}
    assert from_messages_response(resp, REG)["choices"][0]["message"]["content"] == text


# ── reasoning / thinking ────────────────────────────────────────────────────


def test_no_thinking_by_default():
    for model in ("claude-sonnet-4-5", "claude-opus-4-8", "claude-opus-5-5", "claude-sonnet-5-5"):
        body = req([{"role": "user", "content": "q"}], model=model)
        assert "thinking" not in body and "output_config" not in body, model


@pytest.mark.parametrize("reasoning", [
    {"enabled": True}, {"enabled": True, "effort": "low"}, {"effort": "medium"},
    {"enabled": False, "effort": "high"},
])
def test_low_or_unset_effort_never_enables_thinking(reasoning):
    body = req([{"role": "user", "content": "q"}], model="claude-opus-4-8", reasoning=reasoning)
    assert "thinking" not in body


def test_high_effort_adaptive_models():
    body = req([{"role": "user", "content": "q"}], model="claude-opus-4-8",
               reasoning={"enabled": True, "effort": "xhigh"})
    assert body["thinking"] == {"type": "adaptive"} and body["output_config"] == {"effort": "xhigh"}
    # Opus 4.6 has no xhigh -> clamped to high; sampling dropped while thinking
    body = req([{"role": "user", "content": "q"}], model="claude-opus-4-6", temperature=0.3,
               reasoning={"enabled": True, "effort": "xhigh"})
    assert body["output_config"] == {"effort": "high"} and "temperature" not in body
    # top-level reasoning_effort works too
    body = req([{"role": "user", "content": "q"}], model="claude-sonnet-5", reasoning_effort="max")
    assert body["thinking"] == {"type": "adaptive"} and body["output_config"] == {"effort": "max"}


def test_high_effort_budget_models():
    body = req([{"role": "user", "content": "q"}], max_tokens=8000, temperature=0.5,
               reasoning={"enabled": True, "effort": "high"})
    assert body["thinking"] == {"type": "enabled", "budget_tokens": 4000}
    assert "temperature" not in body
    body = req([{"role": "user", "content": "q"}], max_tokens=8000,
               reasoning={"enabled": True, "effort": "max", "max_tokens": 3000})
    assert body["thinking"]["budget_tokens"] == 3000
    # too small a max_tokens for the 1024 minimum budget -> no thinking
    body = req([{"role": "user", "content": "q"}], max_tokens=1000, reasoning={"enabled": True, "effort": "high"})
    assert "thinking" not in body
    # a non-thinking model ignores it
    body = req([{"role": "user", "content": "q"}], model="claude-3-5-haiku-20241022",
               reasoning={"enabled": True, "effort": "high"})
    assert "thinking" not in body


def test_high_effort_skipped_with_forced_tool_choice():
    body = req([{"role": "user", "content": "q"}], tools=TOOLS, tool_choice="required",
               reasoning={"enabled": True, "effort": "high"}, max_tokens=8000)
    assert body["tool_choice"] == {"type": "any"} and "thinking" not in body


@pytest.mark.parametrize("model,expected", [
    ("claude-opus-5", {"thinking": {"type": "disabled"}}),
    ("claude-haiku-5-5", {"thinking": {"type": "disabled"}}),
    ("claude-sonnet-5-5", {"thinking": {"type": "between_tools"}}),
    ("claude-opus-5-5", {"output_config": {"effort": "low"}}),
    ("claude-fable-5-1", {"output_config": {"effort": "low"}}),
    ("claude-sonnet-4-5", {}),   # off by default: nothing to send
    ("claude-opus-4-8", {}),
])
def test_reasoning_disabled(model, expected):
    body = req([{"role": "user", "content": "q"}], model=model, reasoning={"enabled": False})
    got = {k: body[k] for k in ("thinking", "output_config") if k in body}
    assert got == expected


# ── cache breakpoints ───────────────────────────────────────────────────────


def test_cache_breakpoints_capped_at_four_dropping_earliest():
    cc = {"type": "ephemeral"}
    body = req([
        {"role": "system", "content": [{"type": "text", "text": "s1", "cache_control": cc},
                                       {"type": "text", "text": "s2", "cache_control": cc}]},
        {"role": "user", "content": [{"type": "text", "text": "u1", "cache_control": cc}]},
        {"role": "assistant", "content": [{"type": "text", "text": "a1", "cache_control": cc}]},
        {"role": "user", "content": [{"type": "text", "text": "u2", "cache_control": {"type": "ephemeral", "ttl": "1h"}}]},
    ])
    assert "cache_control" not in body["system"][0]
    assert body["system"][1]["cache_control"] == cc
    assert body["messages"][-1]["content"][0]["cache_control"] == {"type": "ephemeral", "ttl": "1h"}
    n = sum(1 for b in body["system"] if "cache_control" in b) + \
        sum(1 for m in body["messages"] for b in m["content"] if "cache_control" in b)
    assert n == 4


def test_input_payload_not_mutated():
    p = {"messages": [{"role": "system", "content": [{"type": "text", "text": "s", "cache_control": {"type": "ephemeral"}}]},
                      {"role": "user", "content": "q"}],
         "tools": TOOLS, "response_format": {"type": "json_object"}}
    before = json.dumps(p, sort_keys=True)
    to_messages_request(p, NEW)
    assert json.dumps(p, sort_keys=True) == before


# ── responses ───────────────────────────────────────────────────────────────


def test_usage_math_with_cache_tokens():
    u = usage_to_openai({"input_tokens": 100, "output_tokens": 50,
                         "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 200})
    assert u == {"prompt_tokens": 1300, "completion_tokens": 50, "total_tokens": 1350,
                 "prompt_tokens_details": {"cached_tokens": 1000},
                 "cache_creation_input_tokens": 200, "cache_read_input_tokens": 1000}
    assert usage_to_openai(None)["total_tokens"] == 0
    assert usage_to_openai({"input_tokens": 5, "cache_read_input_tokens": None})["prompt_tokens"] == 5


def test_text_response():
    resp = {"id": "msg_01", "type": "message", "role": "assistant", "model": "claude-sonnet-4-5-20250929",
            "content": [{"type": "thinking", "thinking": "", "signature": "x"},
                        {"type": "text", "text": "Hello "}, {"type": "text", "text": "world"}],
            "stop_reason": "end_turn", "usage": {"input_tokens": 10, "output_tokens": 3}}
    out = from_messages_response(resp, REG, created=123)
    assert out == {
        "id": "msg_01", "object": "chat.completion", "created": 123, "model": REG,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello world"},
                     "finish_reason": "stop"}],
        "usage": usage_to_openai({"input_tokens": 10, "output_tokens": 3}),
    }


def test_tool_use_response():
    resp = {"id": "msg_02", "content": [
        {"type": "tool_use", "id": "toolu_1", "name": "get_weather", "input": {"city": "Pune"}},
        {"type": "tool_use", "id": "toolu_2", "name": "now", "input": {}},
    ], "stop_reason": "tool_use", "usage": {}}
    msg = from_messages_response(resp, REG)["choices"][0]
    assert msg["finish_reason"] == "tool_calls"
    assert msg["message"]["content"] is None
    assert msg["message"]["tool_calls"] == [
        {"id": "toolu_1", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "Pune"}'}},
        {"id": "toolu_2", "type": "function", "function": {"name": "now", "arguments": "{}"}},
    ]


@pytest.mark.parametrize("stop,finish", [
    ("end_turn", "stop"), ("stop_sequence", "stop"), ("max_tokens", "length"),
    ("tool_use", "tool_calls"), ("refusal", "content_filter"),
    ("model_context_window_exceeded", "length"), ("pause_turn", "stop"), (None, "stop"),
])
def test_finish_reasons(stop, finish):
    resp = {"id": "m", "content": [{"type": "text", "text": "x"}], "stop_reason": stop}
    assert from_messages_response(resp, REG)["choices"][0]["finish_reason"] == finish


# ── errors ──────────────────────────────────────────────────────────────────


def test_error_mapping_json_body():
    body = json.dumps({"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"},
                       "request_id": "req_1"})
    assert error_to_openai(529, body) == {"error": {"message": "Overloaded", "type": "overloaded_error", "code": 529}}


def test_error_mapping_non_json_and_empty():
    assert error_to_openai(502, "<html>Bad gateway</html>") == \
        {"error": {"message": "<html>Bad gateway</html>", "type": "api_error", "code": 502}}
    assert error_to_openai(429, "") == \
        {"error": {"message": "Anthropic API error (HTTP 429)", "type": "rate_limit_error", "code": 429}}
    assert error_to_openai(401, '{"error": "bad key"}')["error"] == \
        {"message": "bad key", "type": "authentication_error", "code": 401}


# ── streaming ───────────────────────────────────────────────────────────────


def run_stream(events, **kw):
    t = StreamTranslator(REG, created=7, **kw)
    out = []
    for name, data in events:
        out.extend(t.feed(name, data))
    return t, out


TEXT_STREAM = [
    ("message_start", {"type": "message_start", "message": {
        "id": "msg_s1", "type": "message", "role": "assistant", "content": [], "model": "claude-sonnet-4-5",
        "stop_reason": None, "usage": {"input_tokens": 25, "output_tokens": 1,
                                       "cache_read_input_tokens": 100, "cache_creation_input_tokens": 0}}}),
    ("content_block_start", {"type": "content_block_start", "index": 0,
                             "content_block": {"type": "thinking", "thinking": ""}}),
    ("content_block_delta", {"type": "content_block_delta", "index": 0,
                             "delta": {"type": "thinking_delta", "thinking": "hmm"}}),
    ("content_block_stop", {"type": "content_block_stop", "index": 0}),
    ("content_block_start", {"type": "content_block_start", "index": 1,
                             "content_block": {"type": "text", "text": ""}}),
    ("ping", {"type": "ping"}),
    ("content_block_delta", {"type": "content_block_delta", "index": 1,
                             "delta": {"type": "text_delta", "text": "Hel"}}),
    ("content_block_delta", {"type": "content_block_delta", "index": 1,
                             "delta": {"type": "text_delta", "text": "lo"}}),
    ("content_block_stop", {"type": "content_block_stop", "index": 1}),
    ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                       "usage": {"output_tokens": 12}}),
    ("message_stop", {"type": "message_stop"}),
]


def test_stream_text():
    t, chunks = run_stream(TEXT_STREAM)
    assert all(c["object"] == "chat.completion.chunk" and c["model"] == REG and c["id"] == "msg_s1"
               and c["created"] == 7 for c in chunks)
    assert chunks[0]["choices"][0] == {"index": 0, "delta": {"role": "assistant", "content": ""},
                                       "finish_reason": None}
    assert [c["choices"][0]["delta"].get("content") for c in chunks[1:-1]] == ["Hel", "lo"]
    assert all(c["choices"][0]["finish_reason"] is None for c in chunks[:-1])
    final = chunks[-1]
    assert final["choices"][0] == {"index": 0, "delta": {}, "finish_reason": "stop"}
    assert final["usage"] == usage_to_openai({"input_tokens": 25, "output_tokens": 12,
                                              "cache_read_input_tokens": 100, "cache_creation_input_tokens": 0})
    assert t.finished and t.raw_usage["output_tokens"] == 12
    assert t.feed("content_block_delta", {"index": 1, "delta": {"type": "text_delta", "text": "late"}}) == []


def test_stream_tool_calls():
    events = [
        ("message_start", {"type": "message_start", "message": {"id": "msg_t", "usage": {"input_tokens": 9}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0,
                                 "content_block": {"type": "text", "text": "Let me check."}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("content_block_start", {"type": "content_block_start", "index": 1, "content_block": {
            "type": "tool_use", "id": "toolu_A", "name": "get_weather", "input": {}}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 1,
                                 "delta": {"type": "input_json_delta", "partial_json": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 1,
                                 "delta": {"type": "input_json_delta", "partial_json": '{"city": '}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 1,
                                 "delta": {"type": "input_json_delta", "partial_json": '"Pune"}'}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 1}),
        ("content_block_start", {"type": "content_block_start", "index": 2, "content_block": {
            "type": "tool_use", "id": "toolu_B", "name": "now", "input": {}}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 2,
                                 "delta": {"type": "input_json_delta", "partial_json": "{}"}}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "tool_use"},
                           "usage": {"output_tokens": 40}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    _, chunks = run_stream(events)
    deltas = [c["choices"][0]["delta"] for c in chunks]
    assert deltas[1] == {"content": "Let me check."}
    assert deltas[2] == {"tool_calls": [{"index": 0, "id": "toolu_A", "type": "function",
                                         "function": {"name": "get_weather", "arguments": ""}}]}
    assert deltas[3] == {"tool_calls": [{"index": 0, "function": {"arguments": '{"city": '}}]}
    assert deltas[4] == {"tool_calls": [{"index": 0, "function": {"arguments": '"Pune"}'}}]}
    assert deltas[5]["tool_calls"][0]["index"] == 1 and deltas[5]["tool_calls"][0]["id"] == "toolu_B"
    assert deltas[6] == {"tool_calls": [{"index": 1, "function": {"arguments": "{}"}}]}
    assert chunks[-1]["choices"][0]["finish_reason"] == "tool_calls"
    assert chunks[-1]["usage"]["prompt_tokens"] == 9 and chunks[-1]["usage"]["completion_tokens"] == 40
    # reassembled arguments parse
    args = "".join(d["tool_calls"][0]["function"]["arguments"] for d in deltas
                   if d.get("tool_calls") and d["tool_calls"][0]["index"] == 0)
    assert json.loads(args) == {"city": "Pune"}


def test_stream_max_tokens_finish_and_event_name_from_data():
    events = [
        ("", {"type": "message_start", "message": {"id": "m", "usage": {"input_tokens": 1}}}),
        ("", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "x"}}),
        ("", {"type": "message_delta", "delta": {"stop_reason": "max_tokens"}, "usage": {"output_tokens": 1}}),
        ("", {"type": "message_stop"}),
    ]
    _, chunks = run_stream(events)
    assert chunks[1]["choices"][0]["delta"] == {"content": "x"}
    assert chunks[-1]["choices"][0]["finish_reason"] == "length"


def test_stream_error_event():
    events = [
        ("message_start", {"type": "message_start", "message": {"id": "m", "usage": {}}}),
        ("error", {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}),
    ]
    t, chunks = run_stream(events)
    err = chunks[-1]
    assert err["object"] == "chat.completion.chunk"
    assert err["error"] == {"message": "Overloaded", "type": "overloaded_error", "code": 529}
    assert err["choices"][0]["finish_reason"] == "error"
    assert t.finished and t.error["code"] == 529


def test_stream_unknown_events_ignored():
    t = StreamTranslator(REG)
    assert t.feed("ping", {"type": "ping"}) == []
    assert t.feed("something_new", {"type": "something_new"}) == []
