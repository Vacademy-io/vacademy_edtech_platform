"""Caller gender, shadow mode (app/caller_gender.py, 2026-10-01)."""
import numpy as np
import pytest

from app.caller_gender import (PitchTracker, gender_from_transcript, gender_from_words, summarize,
                               yin_f0)

SR = 8000


def _voice(f0: float, secs: float = 2.5, sr: int = SR, jitter: float = 0.02) -> np.ndarray:
    """A voiced-speech-like signal: harmonics of a slowly wandering F0 with a
    falling spectrum, then the telephone band (no energy below 300 Hz — the
    fundamental itself is gone, as on a real phone line)."""
    t = np.arange(int(secs * sr)) / sr
    f = f0 * (1 + jitter * np.sin(2 * np.pi * 0.7 * t))
    phase = 2 * np.pi * np.cumsum(f) / sr
    x = sum((1.0 / k) * np.sin(k * phase) for k in range(1, 20))
    X = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / sr)
    X[(freqs < 300) | (freqs > 3400)] = 0
    y = np.fft.irfft(X, n=len(x))
    return (y / np.max(np.abs(y)) * 12000).astype(np.int16)


def _track(pcm: np.ndarray) -> dict:
    t = PitchTracker()
    for i in range(0, len(pcm), 160):                 # 20 ms chunks, like the transport
        t.add(pcm[i:i + 160].tobytes(), SR)
    return t.estimate()


@pytest.mark.parametrize("f0,want", [(105, "m"), (125, "m"), (210, "f"), (235, "f")])
def test_pitch_separates_typical_male_and_female_voices_through_the_phone_band(f0, want):
    e = _track(_voice(f0))
    assert e["gender"] == want, e
    assert e["confidence"] >= 0.6, e
    assert abs(e["medianHz"] - f0) < 0.08 * f0, e


def test_a_voice_in_the_overlap_band_is_unsure_not_guessed():
    e = _track(_voice(165))
    assert e["gender"] == "unsure" and e["confidence"] == 0.0, e


def test_silence_and_noise_give_no_decision():
    assert _track(np.zeros(SR * 3, dtype=np.int16))["gender"] is None
    rng = np.random.default_rng(0)
    noise = (rng.standard_normal(SR * 3) * 2000).astype(np.int16)
    e = _track(noise)
    assert e["gender"] in (None, "unsure") or e["confidence"] < 0.6, e


def test_too_little_speech_gives_no_decision():
    assert _track(_voice(120, secs=0.6))["gender"] is None


def test_yin_on_one_window():
    w = _voice(200, secs=0.04).astype(np.float32)
    f0 = yin_f0(w - w.mean(), SR)
    assert f0 is not None and abs(f0 - 200) < 12


def test_words_mark_the_speakers_gender():
    assert gender_from_words(["मैं बच्चे का पिता बोल रहा हूँ बोलिए।"])[0] == "m"
    assert gender_from_words(["मैं उसकी बुआ जी बोल रही हूँ।"])[0] == "f"
    assert gender_from_words(["मैं उसकी मम्मी हूँ"])[0] == "f"
    assert gender_from_words(["I am his father."])[0] == "m"
    for t in ("हाँ जी बताइए।", "वो पढ़ रहा था", "उसके पापा बाहर गए हैं", "आप क्या बोल रहे हो"):
        assert gender_from_words([t])[0] is None, t
    # Cues both ways (two people on the line / an STT slip): no verdict.
    assert gender_from_words(["मैं उसका पिता बोल रहा हूँ", "मैं बता रही हूँ"])[0] is None


def test_latin_role_words_count_in_a_self_reference():
    assert gender_from_words(["मैं उसका father हूँ"])[0] == "m"
    assert gender_from_words(["मैं उसकी mummy बोल रही हूँ"])[0] == "f"
    assert gender_from_words(["हाँ मैं papa ji"])[0] == "m"


_ASK = "नमस्ते, मैं शिक्षा नेशन से श्रेया बोल रही हूँ। आरव के माता-पिता में से किससे बात कर रही हूँ?"


def _call(*turns):
    return [{"role": r, "text": t} for r, t in turns]


@pytest.mark.parametrize("answer,want", [
    ("पापा।", "m"), ("पापा जी", "m"), ("हाँ जी, पापा बोल रहा हूँ।", "m"), ("Father.", "m"),
    ("मैं उसका पिता हूँ", "m"), ("papa", "m"),
    ("मम्मी।", "f"), ("मम्मी जी।", "f"), ("मैं मम्मी बोल रही हूँ", "f"), ("Mother", "f"),
    ("जी माँ हूँ", "f"),
    # "<role> से" — the answer in the question's own shape (किससे = with whom).
    ("माता से।", "f"), ("माता जी से", "f"), ("जी मम्मी से", "f"), ("Mother से।", "f"),
    ("पापा से।", "m"), ("जी पापा से", "m"), ("पापा जी से", "m"),
])
def test_a_bare_role_answer_to_the_role_question_labels_the_caller(answer, want):
    g, ev = gender_from_transcript(_call(("assistant", _ASK), ("user", answer)))
    assert g == want and ev, (answer, g, ev)


@pytest.mark.parametrize("answer", [
    "पापा अभी घर पर नहीं हैं",          # someone ELSE
    "मम्मी से बात करो",
    "हाँ जी बोलिए",
    "आप कौन बोल रहे हो?",
    "पापा मम्मी दोनों",
    # से + a verb asks for someone ELSE — the caller is not that role.
    "पापा से बात करो",
    "मम्मी से बात कर लीजिए",
    "Father से बात कर।",
    "पापा से बोल",
    "पापा मम्मी से",
])
def test_a_role_word_that_is_not_an_answer_about_the_caller_does_not_label(answer):
    assert gender_from_transcript(_call(("assistant", _ASK), ("user", answer)))[0] is None, answer


def test_the_mother_answering_mata_se_is_labelled_female_live_34452119():
    # Live call 34452119: _role_answer returned None for "माता से।" because से
    # was not a filler, so a clear role answer left the words column empty.
    t = _call(("assistant", "जी, क्या मैं जान सकती हूँ कि मैं बच्चे के माता-पिता में से किससे बात "
                            "कर रही हूँ?"),
              ("user", "माता से।"),
              ("assistant", "जी मैम, बच्चा किस class में है?"),
              ("user", "हाँ बच्चा"))
    g, ev = gender_from_transcript(t)
    assert g == "f" and ev == "माता से।", (g, ev)
    s = summarize({"gender": "f", "confidence": 0.9}, t)
    assert s["words"] == "f" and s["agree"] is True


def test_a_role_word_only_counts_right_after_the_role_question():
    t = _call(("assistant", _ASK), ("user", "हाँ जी"),
              ("assistant", "आरव के मार्क्स कम आए हैं।"), ("user", "पापा।"))
    assert gender_from_transcript(t)[0] is None
    t = _call(("assistant", "क्या आप बच्चे के बारे में बात कर सकते हैं?"), ("user", "पापा"))
    assert gender_from_transcript(t)[0] is None


def test_the_role_can_come_as_a_second_final_before_the_agent_speaks_again():
    t = _call(("assistant", _ASK), ("user", "हाँ जी।"), ("user", "पापा बोल रहा हूँ।"))
    assert gender_from_transcript(t)[0] == "m"
    t = _call(("assistant", "मी मुलाच्या आई-वडिलांपैकी कोणाशी बोलतेय, हे कळू शकेल का?"),
              ("user", "मी आई बोलतेय"))
    assert gender_from_transcript(t)[0] == "f"


def test_role_answer_and_self_reference_that_disagree_give_no_verdict():
    t = _call(("assistant", _ASK), ("user", "मम्मी"), ("assistant", "जी बताइए"),
              ("user", "मैं बोल रहा हूँ"))
    assert gender_from_transcript(t)[0] is None


def test_summary_marks_agreement():
    mom = _call(("assistant", _ASK), ("user", "मैं उसकी मम्मी हूँ"))
    s = summarize({"gender": "f", "confidence": 0.9, "medianHz": 214.0, "voicedSecs": 3.0}, mom)
    assert s["words"] == "f" and s["agree"] is True
    s = summarize({"gender": "m", "confidence": 0.9}, mom)
    assert s["agree"] is False
    s = summarize({"gender": "unsure", "confidence": 0.0}, mom)
    assert s["agree"] is None
    s = summarize({"gender": "m", "confidence": 0.8},
                  _call(("assistant", _ASK), ("user", "पापा।")))
    assert s["words"] == "m" and s["agree"] is True


@pytest.mark.asyncio
async def test_the_probe_passes_audio_through_and_ignores_it_while_the_bot_talks():
    from pipecat.frames.frames import InputAudioRawFrame
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
    from app.caller_gender import make_probe

    async def _noop(self, frame, direction):
        return None
    talking = {"v": True}
    probe = make_probe(lambda: talking["v"], echo_tail_secs=0.0)
    pushed = []

    async def push(frame, direction=FrameDirection.DOWNSTREAM):
        pushed.append(frame)
    probe.push_frame = push
    orig = FrameProcessor.process_frame
    FrameProcessor.process_frame = _noop
    try:
        pcm = _voice(120)
        for i in range(0, len(pcm), 160):
            await probe.process_frame(InputAudioRawFrame(audio=pcm[i:i + 160].tobytes(),
                                                         sample_rate=SR, num_channels=1),
                                      FrameDirection.DOWNSTREAM)
        assert len(pushed) == len(range(0, len(pcm), 160)), "a frame was not passed through"
        assert probe.tracker.voiced_secs == 0, "it listened while the bot was talking"
        talking["v"] = False
        for i in range(0, len(pcm), 160):
            await probe.process_frame(InputAudioRawFrame(audio=pcm[i:i + 160].tobytes(),
                                                         sample_rate=SR, num_channels=1),
                                      FrameDirection.DOWNSTREAM)
        assert probe.tracker.estimate()["gender"] == "m"
    finally:
        FrameProcessor.process_frame = orig
