"""Recovering a shot plan from a model that answers in prose.

Gemini Flash periodically ignores `response_format={"type":"json_object"}` and
opens with analysis instead — "Let me carefully analyze this request." A real
run hit this on BOTH the first call and the instruction-based corrective turn
("The user wants a valid JSON response. Let me carefully construct...") and
produced nothing parseable, dropping the whole run.

Asking again in words does not work on a model already committed to reasoning.
A trailing assistant turn containing "{" does: it leaves the model mid-object
with no grammatical way back into prose.
"""

import json
import os
import sys

import pytest

_HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(_HERE, "..", "app", "ai-video-gen-main"))

import shot_planner as sp  # noqa: E402


PROSE = "Let me carefully analyze this request.\n\nThe user wants a 300-second explainer."

_PLAN_BODY = {
    "shots": [
        {
            "shot_index": 0,
            "shot_type": "KINETIC_TITLE",
            "narration_brief": "open",
            "duration_estimate_s": 6,
        },
        {
            "shot_index": 1,
            "shot_type": "IMAGE_CLIP",
            "image_index": 3,
            "narration_brief": "the form",
            "duration_estimate_s": 6,
        },
    ]
}


def _plan_json():
    return json.dumps(_PLAN_BODY)


def _run(second_response):
    """Drive plan_shots with a scripted LLM. Returns (result, calls).

    Call 1 answers in prose. Call 2 is the corrective turn and gets the
    caller's response. Any later call (the creative-concept enforcement pass)
    is answered with a valid plan so it cannot disturb what is under test.
    """
    calls = []

    def llm_chat(messages, **kw):
        calls.append({"messages": messages, "kw": kw})
        if len(calls) == 1:
            return PROSE, {"prompt_tokens": 10, "completion_tokens": 5}
        if len(calls) == 2:
            return second_response, {"prompt_tokens": 10, "completion_tokens": 5}
        return _plan_json(), {"prompt_tokens": 10, "completion_tokens": 5}

    result = sp.plan_shots(
        prompt="explain the flow",
        target_duration_s=300.0,
        llm_chat=llm_chat,
        model="google/gemini-3-flash-preview",
        tier="super_ultra",
    )
    return result, calls


def test_the_corrective_turn_prefills_an_open_brace():
    """The mechanism: the retry must END on an assistant turn of '{'."""
    _, calls = _run(_plan_json()[1:])  # continuation, brace already consumed
    # Call 1 is the prose answer, call 2 the corrective turn. A third call may
    # follow (the creative-concept enforcement pass) — not part of recovery.
    assert len(calls) >= 2, "expected a corrective turn"
    last = calls[1]["messages"][-1]
    assert last["role"] == "assistant"
    assert last["content"].strip() == "{"


def test_a_prose_first_answer_still_yields_a_plan():
    result, _ = _run(_plan_json()[1:])
    assert len(result["shots"]) == 2
    assert result["shots"][1]["image_index"] == 3


def test_a_provider_that_echoes_the_prefill_also_parses():
    """Some providers continue from the prefill, others repeat it. Both must
    work, or the fix trades one parse failure for another."""
    result, _ = _run(_plan_json())  # full object, leading '{' included
    assert len(result["shots"]) == 2
    assert result["shots"][1]["image_index"] == 3


def test_prose_on_both_turns_still_raises():
    """Recovery must not paper over a genuinely unusable response."""
    with pytest.raises(sp.ShotPlanError):
        _run("Still thinking about it, no JSON here.")


def test_the_corrective_turn_is_cooled_and_keeps_json_mode():
    _, calls = _run(_plan_json()[1:])
    kw = calls[1]["kw"]
    assert kw.get("response_format") == {"type": "json_object"}
    assert kw.get("temperature", 1.0) <= 0.2, "retry should not be as hot as the first call"


def test_the_llm_timeout_scales_with_the_token_budget():
    """A flat 180s was sized for a fast non-reasoning model.

    A thinking model planning a 20-shot video spends minutes in its reasoning
    channel before the first content token. At 180s the call was cut off and
    failed over to the next model in the chain — so the model the user picked
    was never the one that answered, and silently, because a fallback is not
    an error.
    """
    import os
    path = os.path.join(
        os.path.dirname(__file__), "..", "app", "ai-video-gen-main", "automation_pipeline.py"
    )
    src = open(path).read()
    assert "urlopen(request, timeout=180)" not in src, "flat timeout is back"
    assert "_req_timeout = max(180, min(900, 120 + int(_effective_max_tokens * 0.05)))" in src
    # The scaled timeout must reach the network call. The request now opens
    # through _open_chat (gateway failover), so follow it there: both the
    # routed attempt and the OpenRouter retry must use it, not a constant.
    assert "model_to_use, _req_timeout) as response:" in src
    open_chat = src[src.index("    def _open_chat("):src.index("    def chat(")]
    assert open_chat.count("timeout=timeout") == 2, "both attempts must use the scaled timeout"

    budget = lambda mt: max(180, min(900, 120 + int(mt * 0.05)))
    assert budget(500) == 180        # small utility prompt keeps a tight timeout
    assert budget(16000) == 900      # a full shot plan gets room to finish
    assert budget(64000) == 900      # and it is bounded, not unlimited
    assert budget(2000) < budget(8000)


def test_the_requested_model_is_recorded_on_the_run():
    """Neither `model` nor `model_overrides` was persisted, so a finished run
    carried no trace of the choice — and reading the absent key returned None,
    which reads exactly like "no override was set"."""
    import os
    path = os.path.join(
        os.path.dirname(__file__), "..", "app", "services", "video_generation_service.py"
    )
    src = open(path).read()
    assert 'gen_metadata["model"] = model' in src
    assert 'gen_metadata["model_overrides"]' in src


def test_a_reasoning_model_gets_two_budget_bumps():
    """Measured on qwen3.8-max planning a 20-shot video from 19 screenshots:
    reasoning_tokens 16000 of a 16000 completion budget, finish_reason
    "length", content_len 0. It never reached the JSON.

    One doubling to 32k is not obviously enough for that, so the client allows
    two — 16k, 32k, 64k. `reasoning: {exclude: true}` is NOT an alternative:
    measured, it still burned all 16000 reasoning tokens and returned empty. It
    hides reasoning from the response; it does not stop the model doing it.
    """
    import os
    path = os.path.join(
        os.path.dirname(__file__), "..", "app", "ai-video-gen-main", "automation_pipeline.py"
    )
    src = open(path).read()
    assert "for _length_bump in range(3):" in src
    assert 'if _finish == "length" and _length_bump < 2:' in src
    assert "min(_effective_max_tokens * 2, 64000)" in src

    budget, seen = 16000, []
    for _ in range(3):
        seen.append(budget)
        budget = min(budget * 2, 64000)
    assert seen == [16000, 32000, 64000]


def test_truncated_output_also_triggers_a_budget_bump():
    """finish_reason "length" means the answer was CUT OFF — whether or not any
    content came back.

    The bump used to live inside the empty-content branch, so a partial answer
    was handed straight to the parser. Measured on gpt-5.6-luna at reasoning
    effort "high": well-formed JSON that simply stopped at char 40,689, which
    the shot-plan parser can only report as garbage ("Expecting value: line
    1247 column 17"). The model was not confused; it ran out of room.
    """
    import os
    path = os.path.join(
        os.path.dirname(__file__), "..", "app", "ai-video-gen-main", "automation_pipeline.py"
    )
    src = open(path).read()
    bump = src.index('if _finish == "length" and _length_bump < 2:')
    empty = src.index("if not content or not content.strip():\n                            _hint")
    assert bump < empty, "the length check must precede (and be independent of) the empty check"

    # The bump must not be nested under an emptiness condition any more.
    between = src[bump - 400:bump]
    assert "if not content" not in between.split("# finish_reason")[-1]
