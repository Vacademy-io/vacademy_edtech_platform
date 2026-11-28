"""Live-lesson cost fixes (cost review 2026-11-10).

A. A voice saved without its engine plays on the engine it belongs to.
B. The Sarvam fallback keeps a Sarvam voice (else the caller's female teacher).
C. A narration with the learner's name: only the name sentence is voiced per
   learner; every other segment is the prepared, shared audio.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from app.services import voice_tts
from app.services.tutor import voice_cache
from app.services.tutor.runtime import settings as settings_mod
from app.services.tutor.runtime.speech import NAME_TOKEN, tutor_segments


# ── A. engine of a saved voice ───────────────────────────────────────────────

def _envelope(data):
    return json.dumps({"setting": {"TUTOR_MODE_SETTING": {"data": data}}})


class _Row:
    def __init__(self, v):
        self.v = v

    def first(self):
        return (self.v,) if self.v is not None else None


class _DB:
    def __init__(self, institute=None, package=None):
        self.institute, self.package = institute, package

    def execute(self, stmt, params):
        sql = str(stmt)
        return _Row(self.institute if "institutes" in sql else self.package)


@pytest.fixture
def platform(monkeypatch):
    values = {"tutor.voice.provider": "smallest", "tutor.voice.voice": None}
    monkeypatch.setattr(settings_mod, "get_platform_setting", lambda key, default=None, db=None: values.get(key, default))
    monkeypatch.setattr(settings_mod, "_enforce_registry", lambda db, s, i: None)
    monkeypatch.setitem(voice_tts._smallest_voice_cache, "voices", [])
    return values


def _resolve(db):
    return settings_mod.resolve_settings(db, package_id="p", institute_id="i")


def test_course_voice_without_engine_uses_the_voice_engine(platform):
    # Shiksha Nation's Gravitation: ttsVoice "dev", engine inherited (Smallest).
    s = _resolve(_DB(package=_envelope({"enabled": True, "ttsVoice": "dev"})))
    assert (s.tts_provider, s.tts_voice) == ("sarvam", "dev")


def test_engine_and_voice_chosen_together_are_trusted(platform):
    s = _resolve(_DB(package=_envelope({"ttsProvider": "smallest", "ttsVoice": "dev"})))
    assert s.tts_provider == "smallest"


def test_engine_chosen_after_the_voice_wins(platform):
    # Institute picked the voice, the course then picked an engine: the course's choice stands.
    s = _resolve(_DB(institute=_envelope({"ttsVoice": "dev"}), package=_envelope({"ttsProvider": "smallest"})))
    assert s.tts_provider == "smallest"


def test_unknown_voice_keeps_the_inherited_engine(platform):
    s = _resolve(_DB(package=_envelope({"ttsVoice": "advika"})))
    assert (s.tts_provider, s.tts_voice) == ("smallest", "advika")


def test_a_voice_in_the_smallest_catalogue_is_not_moved(platform, monkeypatch):
    monkeypatch.setitem(voice_tts._smallest_voice_cache, "voices", [{"id": "dev"}])
    s = _resolve(_DB(package=_envelope({"ttsVoice": "dev"})))
    assert s.tts_provider == "smallest"


@pytest.mark.parametrize("voice,engine", [
    ("dev", "sarvam"), ("Priya", "sarvam"), ("hi-IN-SwaraNeural", "edge"), ("hi-IN-Chirp3-HD-Achird", "google"),
    ("advika", None), ("voice_9o0RsvQUsC", None), ("", None), (None, None),
])
def test_engine_for_voice(voice, engine):
    assert voice_tts.engine_for_voice(voice) == engine


# ── B. the fallback keeps a fitting voice ────────────────────────────────────

def _spoken_by(monkeypatch, voice, fallback_voice=None):
    async def boom(*a, **k):
        raise RuntimeError("Smallest TTS 400: unknown voice")
    heard = {}

    async def sarvam(text, language, voice_, pace=None):
        heard["voice"] = voice_
        return b"wav", "audio/wav"
    monkeypatch.setitem(voice_tts._ENGINES, "smallest", boom)
    monkeypatch.setattr(voice_tts, "_sarvam", sarvam)
    _audio, _mime, used = asyncio.run(voice_tts.synthesize_speech(
        text="A force is a push.", language="en-IN", voice=voice, provider="smallest", fallback_voice=fallback_voice))
    return used, heard["voice"]


def test_fallback_keeps_a_sarvam_voice(monkeypatch):
    assert _spoken_by(monkeypatch, "dev", fallback_voice="priya") == ("sarvam", "dev")


def test_fallback_uses_the_callers_teacher_voice(monkeypatch):
    assert _spoken_by(monkeypatch, "advika", fallback_voice="priya") == ("sarvam", "priya")


def test_fallback_default_is_unchanged_for_other_callers(monkeypatch):
    assert _spoken_by(monkeypatch, "advika") == ("sarvam", "shubh")


# ── C. only the name sentence is personal ────────────────────────────────────

LINE = ("Today, {student_name}, we're diving into gravitation. Every mass pulls every other mass. "
        "The pull grows with the masses. Look at the arrow, {student_name}. It points to the centre.")


def test_name_sentences_are_their_own_segments():
    segs = tutor_segments(LINE, isolate=NAME_TOKEN)
    texts = [s for s, _i, _n in segs]
    assert texts == ["Today, {student_name}, we're diving into gravitation.",
                     "Every mass pulls every other mass. The pull grows with the masses.",
                     "Look at the arrow, {student_name}.", "It points to the centre."]
    # Sentence indices are unchanged, so the board still follows the words.
    assert [(i, n) for _s, i, n in segs] == [(0, 1), (1, 2), (3, 1), (4, 1)]


def test_without_a_name_segmentation_is_unchanged():
    plain = "Every mass pulls every other mass. The pull grows with the masses."
    assert tutor_segments(plain, isolate=NAME_TOKEN) == tutor_segments(plain)


def _view(say):
    return {"topics": [{"title": "Gravitation", "concepts": [{"say": say, "check": {"type": "none"}}],
                        "summary_say": "Mass attracts mass."}]}


def test_warm_up_prepares_what_the_lesson_reuses():
    lines = voice_cache.spoken_lines(_view(LINE), "en", "en", keep_names=True)
    prepared = {seg for ln in lines for seg, _i, _n in tutor_segments(ln, isolate=NAME_TOKEN) if NAME_TOKEN not in seg}
    live_shared = {seg for seg, _i, _n in tutor_segments(LINE, isolate=NAME_TOKEN) if NAME_TOKEN not in seg}
    assert live_shared <= prepared
    # The name-free rewrite of the whole line (never spoken by a lesson) is not prepared.
    assert not any("diving into gravitation. Every mass" in p for p in prepared)


def test_spoken_lines_default_is_unchanged():
    lines = voice_cache.spoken_lines(_view(LINE), "en", "en")
    assert not any(NAME_TOKEN in ln for ln in lines)
