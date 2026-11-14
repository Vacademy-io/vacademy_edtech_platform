"""Navana's English and Hindi models render the same voice ~18 dB apart (call
3beed75a, 2026-10-26: "English low, Hindi high"); every sentence is brought to
one level before it plays (voice_eq.match_speech_level)."""
import math

import numpy as np

from app.voice_eq import match_speech_level

SR = 24000


def _speech(level_db: float, secs: float = 2.0, sr: int = SR) -> bytes:
    """A voiced 230 Hz carrier in syllable-sized bursts with pauses, at roughly
    `level_db` dBFS during the bursts."""
    t = np.arange(int(sr * secs)) / sr
    env = (np.sin(2 * np.pi * 3.0 * t) > 0).astype(float)          # ~170 ms on/off
    x = np.sin(2 * np.pi * 230 * t) + 0.3 * np.sin(2 * np.pi * 690 * t)
    x = x / np.sqrt((x ** 2).mean()) * env
    return (x * 32768 * 10 ** (level_db / 20)).clip(-32768, 32767).astype(np.int16).tobytes()


def _active_db(pcm: bytes, sr: int = SR) -> float:
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)
    n = int(sr * 0.02)
    r = np.sqrt((x[:x.size // n * n].reshape(-1, n) ** 2).mean(1))
    loud = r[r > r.max() * 0.1]
    return 20 * math.log10(np.sqrt((loud ** 2).mean()) / 32768)


def _peak_db(pcm: bytes) -> float:
    return 20 * math.log10(np.abs(np.frombuffer(pcm, dtype=np.int16)).max() / 32768)


def test_quiet_english_and_loud_hindi_land_on_one_level():
    english, hindi = _speech(-35.6), _speech(-16.9)
    a, b = match_speech_level(english, SR), match_speech_level(hindi, SR)
    assert abs(_active_db(a) - _active_db(b)) < 1.0
    assert abs(_active_db(a) + 19.0) < 1.0


def test_it_never_clips():
    out = match_speech_level(_speech(-40.0), SR, target_db=-3.0)
    assert _peak_db(out) <= -0.9


def test_a_sentence_at_the_target_is_left_alone():
    """Idempotent: cached audio that was matched before it was stored comes back
    unchanged."""
    once = match_speech_level(_speech(-30.0), SR)
    assert match_speech_level(once, SR) == once


def test_the_gain_is_bounded():
    out = match_speech_level(_speech(-60.0), SR)
    assert _active_db(out) < -39.0                 # +20 dB at most, not +41


def test_silence_and_slivers_pass_through():
    silence = bytes(SR * 2)
    assert match_speech_level(silence, SR) == silence
    sliver = _speech(-35.0, secs=0.05)
    assert match_speech_level(sliver, SR) == sliver
    assert match_speech_level(b"", SR) == b""


def test_cache_rate_audio_works_too():
    out = match_speech_level(_speech(-35.0, sr=8000), 8000)
    assert abs(_active_db(out, 8000) + 19.0) < 1.0
