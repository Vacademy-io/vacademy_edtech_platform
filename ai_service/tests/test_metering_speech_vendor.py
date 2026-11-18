"""Speech rows name their vendor: Sarvam TTS/STT used to land with no provider, so the
platform portal filed their cost under "vendor not tracked"."""
import pytest

from app.services.metering.service import speech_vendor


@pytest.mark.parametrize("model_id, tts_provider, expected", [
    ("sarvam:bulbul-v3", None, "sarvam"),     # tutor, chatbot voice
    ("sarvam-bulbul-v3", None, "sarvam"),     # video narration
    ("sarvam:saaras-v3", None, "sarvam"),     # STT
    ("sarvam:priya", None, "sarvam"),         # tutor warm-up
    ("sarvam", None, "sarvam"),               # KB read-aloud
    ("system", "sarvam", "sarvam"),           # metadata's tts_provider
    ("google:chirp3-hd", None, "google"),
    ("smallest:lightning-v3.1", None, "smallest"),
    ("google/gemini-2.5-flash", None, None),  # an LLM: left to the router
    ("gemini-2.5-pro", None, None),
    ("gpt-4o", None, None),
    (None, None, None),
])
def test_speech_vendor(model_id, tts_provider, expected):
    assert speech_vendor(model_id, tts_provider) == expected
