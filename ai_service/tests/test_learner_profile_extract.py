"""Learner-profile extraction keeps only evidence-backed, non-sensitive signals."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.learner_profile import extract  # noqa: E402
from app.services.learner_profile.extract import Message  # noqa: E402

NEW = [
    Message(10, "user", "I'm preparing for NEET 2027. Is the derivative of x^2 equal to x?"),
    Message(11, "assistant", "Not quite: d/dx x^2 = 2x."),
    Message(12, "user", "Oh. Then for x^3 it is 3x^2"),
]


def _raw(*signals):
    return json.dumps({"signals": list(signals)})


def test_keeps_cited_signals_and_copies_the_quote_from_the_message():
    out = extract.parse_signals(_raw(
        {"kind": "misconception", "topic": "Derivatives", "detail": "Thought d/dx x^2 is x.",
         "confidence": 0.8, "message_ids": ["m10", 11], "evidence_quote": "made up"},
        {"kind": "GOAL", "topic": "NEET", "detail": "Preparing for NEET 2027.", "confidence": 0.9,
         "stated": True, "message_ids": [10]},
    ), NEW)
    assert [s.kind for s in out] == ["MISCONCEPTION", "GOAL"]
    assert out[0].message_ids == [10, 11]
    assert out[0].evidence_quote == NEW[0].content
    assert out[1].stated is True


def test_drops_uncited_low_confidence_unknown_and_sensitive_signals():
    out = extract.parse_signals(_raw(
        {"kind": "WEAKNESS", "topic": "Calculus", "detail": "Struggles with calculus.", "message_ids": [99]},
        {"kind": "STRENGTH", "topic": "Calculus", "detail": "Applies the power rule.", "confidence": 0.2,
         "message_ids": [12]},
        {"kind": "MOOD", "topic": "x", "detail": "Seems tired today.", "message_ids": [12]},
        {"kind": "WEAKNESS", "topic": "Study", "detail": "Studies poorly due to anxiety at home.",
         "confidence": 0.9, "message_ids": [12]},
        {"kind": "GOAL", "topic": "NEET", "detail": "Wants coaching, call 9876543210.", "confidence": 0.9,
         "message_ids": [10]},
    ), NEW)
    assert out == []


def test_a_strength_is_never_stated_and_the_list_is_capped():
    items = [{"kind": "STRENGTH", "topic": f"T{i}", "detail": "Applied the power rule to x^3.",
              "confidence": 0.7, "stated": True, "message_ids": [12]} for i in range(9)]
    out = extract.parse_signals(_raw(*items), NEW)
    assert len(out) == extract.MAX_SIGNALS
    assert not any(s.stated for s in out)


def test_bad_json_is_empty():
    assert extract.parse_signals("not json", NEW) == []
    assert extract.parse_signals(json.dumps({"signals": "x"}), NEW) == []


def test_prompt_lists_new_and_earlier_messages_and_known_signals():
    prompt = extract.build_prompt(NEW, [Message(5, "assistant", "Hi! What shall we study?")],
                                  [{"kind": "WEAKNESS", "topic": "Algebra", "detail": "Mixes up signs."}])
    assert "[m10] student: I'm preparing for NEET 2027." in prompt
    assert "EARLIER (context only):\n[m5] assistant: Hi!" in prompt
    assert "- WEAKNESS: Algebra — Mixes up signs." in prompt


def test_learner_chars_counts_only_learner_text():
    assert extract.learner_chars([Message(1, "assistant", "x" * 100), Message(2, "user", " hi ")]) == 2
