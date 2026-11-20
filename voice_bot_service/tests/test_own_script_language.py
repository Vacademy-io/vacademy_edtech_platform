"""Agents speaking a language with its own script (Tamil, Malayalam, Kannada...).

The non-English prompt path was written for Hindi: it told every non-English agent to
"write Hindi words in DEVANAGARI" and to "speak phone Hindi". A Tamil agent got Tamil
from rule 5 and Hindi from the script rule. Hindi, Hinglish, English and Marathi
agents must not change by one byte.

Every agent here is synthetic.
"""
import sys
from datetime import datetime as _dt

import pytest

import app.bot as b


@pytest.fixture(autouse=True)
def _glibc_strftime_on_windows(monkeypatch):
    # The bot formats dates with glibc's %-d, which Windows rejects. Production runs on
    # Linux; this only lets the file run on a Windows dev box.
    if sys.platform != "win32":
        return

    class _DT(_dt):
        def strftime(self, fmt):
            return super().strftime(fmt.replace("%-", "%#"))

        @classmethod
        def now(cls, tz=None):
            n = _dt.now(tz)
            return cls(n.year, n.month, n.day, n.hour, n.minute, n.second, n.microsecond, n.tzinfo)

    monkeypatch.setattr(b, "datetime", _DT)

_PROMPT = ("You are Vaani, the admission counsellor for {{institute_name}}. Greet the caller, "
           "find out which class or course they want, answer warmly and book a campus visit. "
           + "Keep every turn short. " * 40)


def _ctx(language, voice="ta-IN-PallaviNeural"):
    agent = {"name": "Vaani", "language": language, "voice": voice, "tts_model": "edge",
             "speech_cache_mode": "OFF", "openingLine": "Hello {{name}}",
             "systemPrompt": _PROMPT, "extractionQuestions": ["Which course?"],
             "dispositions": ["Interested", "Callback", "Not_Interested"]}
    return {"agent": agent, "instituteName": "CRM", "direction": "INBOUND",
            "leadName": "Anil Kumar", "leadPhone": "919800000000",
            "leadFields": {"institute name": "Sunrise Public School"},
            "handoff": {"enabled": False, "numbers": []}}


@pytest.mark.parametrize("language,label,script", [
    ("tamil", "Tamil", "Tamil"), ("malayalam", "Malayalam", "Malayalam"),
    ("kannada", "Kannada", "Kannada"), ("telugu", "Telugu", "Telugu"),
    ("bengali", "Bengali", "Bengali"), ("gujarati", "Gujarati", "Gujarati"),
])
def test_own_script_language_gets_its_own_script_rule(language, label, script):
    p = b.build_system_prompt(_ctx(language))
    assert f"Write every reply in {label}, in the {script} script" in p
    assert f"SPEAK EVERYDAY SPOKEN {label.upper()}" in p
    assert "Write Hindi words in DEVANAGARI" not in p
    assert "SPEAK PHONE HINDI" not in p
    # The org typed on the website fills the authored placeholder.
    assert "Sunrise Public School" in p


@pytest.mark.parametrize("language", ["hindi", "hinglish", "marathi", "english"])
def test_devanagari_and_english_agents_keep_their_rules(language):
    p = b.build_system_prompt(_ctx(language, voice="hi-IN-SwaraNeural"))
    assert "SCRIPT:" in p
    assert " script. Keep common English words" not in p
    if language != "english":
        assert "Write Hindi words in DEVANAGARI" in p
        assert "SPEAK PHONE HINDI" in p
