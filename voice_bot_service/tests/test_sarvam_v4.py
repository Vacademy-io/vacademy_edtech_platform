"""Sarvam Bulbul v4 Flash as its own engine (2026-10-14)."""
from app import bot, providers
from app.sarvam_v4_voices import (SARVAM_V4_DEFAULT_VOICE, SARVAM_V4_FEMALE, SARVAM_V4_MALE,
                                  SARVAM_V4_MODEL, SARVAM_V4_VOICES)


def test_palette_is_disjoint_from_v3_and_gendered():
    assert len(SARVAM_V4_VOICES) == 210
    assert not (SARVAM_V4_MALE & SARVAM_V4_FEMALE)
    assert "priya" not in SARVAM_V4_VOICES and "shubh" not in SARVAM_V4_VOICES
    assert SARVAM_V4_DEFAULT_VOICE in SARVAM_V4_MALE
    # Gender is per speaker across styles (ratan_hi_sports measured 235 Hz, still male).
    assert "ratan_hi_sports" in SARVAM_V4_MALE
    for unverified in ("dev_en_conversational", "rohan_en_recovery", "advait_hi_character"):
        assert unverified not in SARVAM_V4_VOICES


def test_engine_is_never_read_as_v3():
    for m in ("sarvam_v4", "bulbul:v4-flash", "SARVAM_V4"):
        assert bot._engine_of(m) == "sarvam_v4"
    assert bot._engine_of("sarvam") == "sarvam"
    assert providers.default_engine_model("sarvam_v4") == SARVAM_V4_MODEL


def test_cross_version_voices_are_dropped():
    assert bot._agent_voice({"tts_model": "sarvam_v4", "voice": "priya"}) is None
    assert bot._agent_voice({"tts_model": "sarvam", "voice": "ritu_hi_customer"}) is None
    assert bot._agent_voice({"tts_model": "sarvam_v4", "voice": "ritu_hi_customer"}) == "ritu_hi_customer"


def test_grammar_follows_the_measured_gender():
    assert bot._voice_gender("shubh_enhi_ads") == "male"
    assert bot._voice_gender("ritu_hi_customer") == "female"


def test_build_tts_speaks_v4_with_a_valid_voice():
    svc = providers.build_tts(8000, voice="simran_enhi_customer", tts_model="sarvam_v4", temperature=1.4)
    assert providers.engine_of(svc) == ("sarvam_v4", SARVAM_V4_MODEL)
    assert "model=bulbul:v4-flash" in svc._websocket_url
    assert svc._settings.temperature <= 1.0
    fallback = providers.build_tts(8000, voice="priya", tts_model="sarvam_v4")
    assert fallback._settings.voice == SARVAM_V4_DEFAULT_VOICE
