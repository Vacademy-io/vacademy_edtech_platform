"""One voice burst, one response — and a cut belongs to the reply it stopped.

Review of the 2026-10-14 live calls (11:20-13:17 UTC):

* afa21bf4 / 4a594125: the caller's short final arrived 55-95 ms BEFORE the
  VAD stop of the same burst. The final went to the model as a real barge-in,
  and the VAD stop resumed the cut sentence verbatim as well — two producers
  for one moment. The model's copy was then dropped as already-said and the
  repeat gate decided the caller had "already answered" it, asked for a next
  step, and the question came back a second time.
* 5e979e3e / 662d1c80: the same barge-in never cancelled the 0.7 s voice-cut
  timer armed for its onset, which then cut the opening the barge-in had just
  re-said — 14 s of silence.
* edbbe7b3: a "हम्म" 2.6 s after a barge-in counted as cutting the NEW reply
  then playing, and a carry-on cue talked straight past its question.

Every line below is synthetic; only the timing and shape are the calls'.
"""
import asyncio
import time

import pytest
from pipecat.frames.frames import (InterruptionFrame, LLMFullResponseEndFrame,
                                   LLMFullResponseStartFrame, LLMTextFrame,
                                   TranscriptionFrame, VADUserStartedSpeakingFrame,
                                   VADUserStoppedSpeakingFrame)

import app.bot as b

D = b.FrameDirection.DOWNSTREAM
UP = b.FrameDirection.UPSTREAM

STATEMENT = "That is a really important year for her."
QUESTION = "And what marks did she get in her last exam?"
REASON = "So that I can understand where she stands right now."


class _Outcome:
    def __init__(self):
        self.corr = "test"
        self.transcript = []
        self.transfer_requested = False
        self.end_requested = False
        self.transfer_registered = False
        self.context = {}


async def _noop_super(self, frame, direction):
    return None


@pytest.fixture(autouse=True)
def _bare_processor(monkeypatch):
    # pipecat's base setup needs a running task manager; these tests are about
    # OUR gate logic, which lives entirely after the super() call.
    monkeypatch.setattr(b.FrameProcessor, "process_frame", _noop_super)


def _gate(state, cut_after=0.3, **kw):
    """The turn-gate in voice barge-in mode. `state` is the line: is the bot
    speaking, when did its audio last start, when was it last cut."""
    frames, dirs, cuts = [], [], []

    def recently_cut():
        # The same rule run_bot wires in (call edbbe7b3).
        return (state["cut_t"] > 0 and time.time() - state["cut_t"] <= 3.0
                and b.cut_still_current(state["cut_t"], state["speaking"], state["started_t"]))

    tc = b.TranscriptCollector(
        _Outcome(), lambda user=True: None,
        is_bot_speaking=lambda: state["speaking"],
        fillers_armed=lambda: False, bot_stopped_t=lambda: 0.0,
        bot_started_t=lambda: state["started_t"],
        gate_enabled=lambda: True,
        interrupt_on_vad=recently_cut, recently_cut=recently_cut,
        filler_phrases=[], in_machine_window=lambda: False,
        reply_in_flight=lambda: False, bot_spoke_once=lambda: True,
        cut_after_voice_secs=cut_after, ack_answer_window_secs=3.0, **kw)

    async def _push(frame, direction=None):
        frames.append(frame)
        dirs.append(direction)

    async def _broadcast():
        cuts.append(time.time())
        state["cut_t"] = time.time()
        state["speaking"] = False

    tc.push_frame = _push
    tc.broadcast_interruption = _broadcast
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    tc._outcome.transcript.append({"role": "assistant", "text": STATEMENT})
    return tc, frames, cuts


def _line(speaking=True):
    return {"speaking": speaking, "started_t": time.time() - 1.0, "cut_t": 0.0}


async def _final(tc, text):
    await tc.process_frame(TranscriptionFrame(text=text, user_id="u", timestamp="t"), D)


def _spoken(frames):
    return [f.text for f in frames if isinstance(f, b.TTSSpeakFrame)]


def _runs(frames):
    return [f for f in frames if getattr(f, "run_llm", False)]


# ── B1: the final lands before its own VAD stop ────────────────────────────

@pytest.mark.asyncio
async def test_a_final_before_its_own_vad_stop_gets_the_models_reply_only():
    """afa21bf4 shape: a 0.26 s burst over the reply; its one-word final is a
    real barge-in, and the VAD stop 95 ms later must NOT resume the cut words
    on top of the model's reply to it."""
    state = _line()
    tail = {"t": QUESTION + " " + REASON}
    tc, frames, cuts = _gate(state, resume_unplayed=lambda n=600: tail.pop("t", ""),
                             resume_on_stop_secs=1.0, resume_settle_secs=0.01)
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await asyncio.sleep(0.16)
    await _final(tc, "Wait.")                         # real barge-in: the model's turn
    assert len(cuts) == 1
    await asyncio.sleep(0.095)
    await tc.process_frame(VADUserStoppedSpeakingFrame(), UP)
    await asyncio.sleep(0.1)                          # past the resume's settle
    assert _spoken(frames) == [], f"resumed on top of the model's turn: {_spoken(frames)}"
    assert sum(isinstance(f, TranscriptionFrame) and f.text == "Wait." for f in frames) == 1
    assert "t" in tail, "the cut words were taken for a resume"


@pytest.mark.asyncio
async def test_a_vad_stop_before_the_final_still_resumes_the_cut_words():
    """The designed order is untouched: voice stops first, the short burst
    cannot have been an answer, the cut words come back verbatim."""
    state = _line(speaking=False)
    state["cut_t"] = time.time()                      # the onset cut the reply
    tc, frames, _ = _gate(state, resume_unplayed=lambda n=600: QUESTION,
                          resume_on_stop_secs=1.0, resume_settle_secs=0.01)
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await asyncio.sleep(0.05)
    await tc.process_frame(VADUserStoppedSpeakingFrame(), UP)
    await asyncio.sleep(0.1)
    assert _spoken(frames) == [QUESTION]
    tc._cancel_resume_check(stale=True)


# ── B2: the voice-cut timer of a spent onset ───────────────────────────────

@pytest.mark.asyncio
async def test_the_voice_cut_timer_of_a_spent_onset_never_cuts_what_plays_next():
    """5e979e3e shape: the barge-in re-said the opening; the 0.7 s timer armed
    for the SAME onset fired 22 ms into it and cut it."""
    state = _line()
    tc, _, cuts = _gate(state, cut_after=0.2)
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)    # timer armed
    await asyncio.sleep(0.05)
    await _final(tc, "Wait.")                                     # cut #1, the real one
    assert len(cuts) == 1
    state["speaking"] = True                                      # the re-said opening plays
    state["started_t"] = time.time()
    await asyncio.sleep(0.3)                                      # voice still on, timer due
    assert len(cuts) == 1, "the stale timer cut the next delivery"


@pytest.mark.asyncio
async def test_the_voice_cut_timer_still_stops_a_reply_the_caller_talks_over():
    state = _line()
    tc, _, cuts = _gate(state, cut_after=0.1)
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await asyncio.sleep(0.2)
    assert len(cuts) == 1, "sustained voice over the reply must still stop it"


# ── B5: a cut belongs to the reply it stopped ──────────────────────────────

def test_a_cut_is_current_only_until_newer_audio_plays():
    assert b.cut_still_current(10.0, False, 9.0)          # cut, bot quiet
    assert b.cut_still_current(10.0, True, 9.0)           # the cut reply's own audio (race)
    assert not b.cut_still_current(10.0, True, 10.5)      # a NEW reply is on the line
    assert b.cut_still_current(10.0, False, 10.5)         # …that has finished


@pytest.mark.asyncio
async def test_an_ack_over_a_reply_started_after_the_cut_is_not_a_cut_of_it():
    """edbbe7b3 shape: barge-in, the model's answer to it starts playing, a
    "हम्म" 2.6 s after the cut lands over it. Old code: "cut=True" and a
    carry-on cue — a second reply right after the question."""
    state = _line()
    tc, frames, cuts = _gate(state, cut_after=5.0)
    await _final(tc, "Wait.")
    assert len(cuts) == 1
    await asyncio.sleep(0.05)
    state["speaking"] = True                         # the reply to "Wait." plays
    state["started_t"] = time.time()
    frames.clear()
    await _final(tc, "Hmm.")
    assert _runs(frames) == [], [getattr(f, "messages", None) for f in _runs(frames)]
    assert tc._acked_mid_reply is not None, "an ack over a playing reply is kept for its end"


@pytest.mark.asyncio
async def test_an_ack_right_after_a_cut_with_nothing_playing_still_gets_a_line():
    state = _line()
    tc, frames, _ = _gate(state, cut_after=5.0)
    await _final(tc, "Wait.")
    await asyncio.sleep(0.05)                        # the bot is quiet: the cut is current
    frames.clear()
    await _final(tc, "Hmm.")
    assert _runs(frames), "a cut reply with nothing playing must still move on"


# ── NoRepeat: a repeat of the words being resumed ──────────────────────────

class _NR:
    def __init__(self, caller="Wait."):
        self.text, self.next_steps = [], []
        self.played = {"t": ""}
        self.caller = {"t": caller}

        async def nxt(held, kind="", attempt=0):
            self.next_steps.append(kind)

        self.g = b.NoRepeatGate(enabled=lambda: True,
                                last_caller_text=lambda: self.caller["t"],
                                played_text=lambda: self.played["t"],
                                request_next_step=nxt)

        async def push(frame, direction=None):
            t = getattr(frame, "text", None)
            if t:
                self.text.append(t)
        self.g.push_frame = push

    async def reply(self, *sentences):
        await self.g.process_frame(LLMFullResponseStartFrame(), D)
        for s in sentences:
            await self.g.process_frame(LLMTextFrame(s), D)
        await self.g.process_frame(LLMFullResponseEndFrame(), D)


@pytest.mark.asyncio
async def test_a_reply_repeating_the_words_being_resumed_is_not_an_answered_question():
    """afa21bf4: the model's reply to the barge-in was the resumed question.
    The gate said "whole reply repeated what they just answered" and asked for
    a next step — the question came back after the resume."""
    nr = _NR()
    await nr.reply(STATEMENT + " ", QUESTION + " ", REASON)
    nr.played["t"] = STATEMENT                     # cut right after the statement
    await nr.g.process_frame(InterruptionFrame(), D)
    assert nr.g.take_unplayed_tail().strip() == QUESTION + " " + REASON   # resume handed over
    nr.text.clear()
    for _ in range(3):                             # copies while the resume plays
        await nr.reply(QUESTION + " ", REASON)
    assert nr.next_steps == [], nr.next_steps
    assert nr.text == [], f"spoke on top of the resume: {nr.text}"


@pytest.mark.asyncio
async def test_once_the_resumed_words_were_heard_a_repeat_is_a_repeat_again():
    nr = _NR()
    await nr.reply(STATEMENT + " ", QUESTION + " ", REASON)
    nr.played["t"] = STATEMENT
    await nr.g.process_frame(InterruptionFrame(), D)
    nr.g.take_unplayed_tail()
    nr.played["t"] = " ".join((STATEMENT, QUESTION, REASON))   # the resume played
    nr.caller["t"] = "About seventy percent."                  # and they answered
    nr.text.clear()
    await nr.reply(QUESTION + " ", REASON)
    assert not any(QUESTION in t for t in nr.text), nr.text
    assert nr.next_steps == ["all-repeat"], nr.next_steps


@pytest.mark.asyncio
async def test_a_resume_cut_before_it_was_heard_is_not_already_said():
    """afa21bf4 replayed: the resume was handed over, the model's reply (all
    repeat) started and ended, then a barge-in cut the resume before its words
    played. They were never heard — the model's next copy must be spoken, not
    dropped as already-said (silence: 11.3 s)."""
    nr = _NR()
    await nr.reply(STATEMENT + " ", QUESTION + " ", REASON)
    nr.played["t"] = STATEMENT
    await nr.g.process_frame(InterruptionFrame(), D)
    nr.g.take_unplayed_tail()
    await nr.reply(QUESTION + " ", REASON)             # dropped: being resumed
    await nr.g.process_frame(InterruptionFrame(), D)   # the barge-in cuts the resume
    nr.caller["t"] = "Sorry, one moment."
    nr.text.clear()
    await nr.reply(QUESTION)
    assert nr.text == [QUESTION], nr.text
    assert nr.next_steps == [], nr.next_steps


@pytest.mark.asyncio
async def test_a_second_burst_while_the_models_turn_is_on_its_way_resumes_nothing():
    """afa21bf4 replayed (review 2026-10-14): the barge-in's final went to the
    model; while its reply was still held / composing, a second short burst
    (a breath, an "umm") stopped and resumed the cut words verbatim — the
    model's reply was then dropped as "being resumed". One moment, one
    producer: the reply already on its way."""
    state = _line()
    tail = {"t": QUESTION + " " + REASON}
    pending = {"v": False}
    tc, frames, cuts = _gate(state, resume_unplayed=lambda n=600: tail.pop("t", ""),
                             resume_on_stop_secs=1.0, resume_settle_secs=0.01,
                             reply_pending=lambda: pending["v"])
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await asyncio.sleep(0.16)
    await _final(tc, "Wait.")                      # a real barge-in: the model's turn
    pending["v"] = True                            # …held for its grace / composing
    await asyncio.sleep(0.095)
    await tc.process_frame(VADUserStoppedSpeakingFrame(), UP)
    await asyncio.sleep(0.6)
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await asyncio.sleep(0.3)
    await tc.process_frame(VADUserStoppedSpeakingFrame(), UP)
    await asyncio.sleep(0.1)
    assert _spoken(frames) == [], f"resumed on top of the model's turn: {_spoken(frames)}"
    assert "t" in tail, "the cut words were taken although nothing said them"


@pytest.mark.asyncio
async def test_a_short_burst_with_nothing_on_its_way_still_resumes():
    """Control: no reply pending — a noise burst over the reply still gets the
    cut words back verbatim."""
    state = _line()
    tail = {"t": QUESTION + " " + REASON}
    tc, frames, cuts = _gate(state, resume_unplayed=lambda n=600: tail.pop("t", ""),
                             resume_on_stop_secs=1.0, resume_settle_secs=0.01,
                             reply_pending=lambda: False)
    await tc.process_frame(VADUserStartedSpeakingFrame(), UP)
    await asyncio.sleep(0.4)                       # the voice-cut timer stops the reply
    await tc.process_frame(VADUserStoppedSpeakingFrame(), UP)
    await asyncio.sleep(0.1)
    assert _spoken(frames) == [QUESTION + " " + REASON]
