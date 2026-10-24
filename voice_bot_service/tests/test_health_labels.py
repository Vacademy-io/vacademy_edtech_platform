"""Health labels that misled on the 2026-10-14 sweep, and the voicemail hang-up.

Every line below is SYNTHETIC: it reproduces the timing and shape of the live
calls (22f80a85, d8146538, 68bdcbcf: the hold recording counted as a deleted
answer; 4a594125: a stutter counted as deleted and two internal next-step
requests headlined as a handback loop; afa21bf4: idle waits counted as RED
dead air; 5e979e3e / 662d1c80 / 4cb132a2 / a11e6709: swallowed turns scored
GREEN; a5e314ee, 1c138e52, 36ac8abe, 2ba1ff7a, 5a180c97, 960251f2: voicemails
that ran 42-57 s; e208c6e8: the unpaid-number operator message), never their
words.
"""
import ast
import logging
import time as _time
from pathlib import Path
from types import SimpleNamespace

import pytest

import app.bot as b
import app.diagnostics as dg
from app.callstate import CallState
from app.turntake import is_carrier_announcement


# ── ANSWER_DELETED ─────────────────────────────────────────────────────────

def test_a_stutter_whose_halves_reached_the_model_separately_is_not_lost():
    """4a594125: the tail went in as a fragment continuation, the head later with
    the rest of the turn; the transcript glued the two into one line."""
    heard = ["मेरा बेटा बेटा अभी।", "मेरा बेटा नौवीं में पढ़ता है।", "मैं अभी बाहर हूँ।"]
    delivered = ["बेटा अभी।",
                 "मेरा बेटा मेरा बेटा नौवीं में पढ़ता है। मैं अभी बाहर हूँ।"]
    lost = dg.split_lost(heard, delivered)
    assert lost.answers == 0, lost


def test_a_genuinely_lost_short_answer_is_still_lost():
    """The split must never explain a real loss away with stray words: each half
    needs a whole-word run of at least four characters."""
    assert dg.split_lost(["हाँ जी", "दसवीं में है"], ["दसवीं में है", "जी हाँ ठीक"]).answers == 1
    assert dg.split_lost(["पचास हज़ार तक"], ["पचास हज़ार"]).answers == 1
    assert dg.split_lost(["Symbiosis Pune"], ["We will call Pune later"]).answers == 1


def test_a_half_is_consumed_once():
    """Two lost copies of the same stutter need two delivered copies."""
    heard = ["मेरा बेटा बेटा अभी।", "मेरा बेटा बेटा अभी।"]
    delivered = ["बेटा अभी।", "मेरा बेटा कुछ और।"]
    assert dg.split_lost(heard, delivered).answers == 1


# ── the live gate, as test_hold.py drives it ───────────────────────────────

class _Outcome:
    def __init__(self):
        self.corr = "test"
        self.transcript = []
        self.transfer_requested = False
        self.end_requested = False
        self.transfer_registered = False
        self.context = {}


class _Clock:
    def __init__(self, t):
        self.t = t

    def time(self):
        return self.t

    def __getattr__(self, name):
        return getattr(_time, name)


class _Rec:
    def __init__(self):
        self.frames = []
        self.interruptions = 0

    def forwarded(self):
        from pipecat.frames.frames import TranscriptionFrame
        return [f.text for f in self.frames if isinstance(f, TranscriptionFrame)]


async def _noop_super(self, frame, direction):
    return None


@pytest.fixture
def clock(monkeypatch):
    c = _Clock(10_000.0)
    monkeypatch.setattr(b, "time", c)
    monkeypatch.setattr(b.FrameProcessor, "process_frame", _noop_super)
    return c


def _collector(rec, *, machine=False, speaking=False):
    tc = b.TranscriptCollector(
        _Outcome(), lambda user=True: None,
        is_bot_speaking=lambda: speaking, fillers_armed=lambda: False,
        bot_stopped_t=lambda: 0.0, gate_enabled=lambda: True,
        interrupt_on_vad=lambda: True, filler_phrases=[],
        in_machine_window=lambda: machine, reply_in_flight=lambda: False,
        bot_spoke_once=lambda: True, opening_owed=lambda: False)

    async def _push(frame, direction=None):
        rec.frames.append(frame)

    async def _broadcast():
        rec.interruptions += 1
    tc.push_frame = _push
    tc.broadcast_interruption = _broadcast
    return tc


async def _say(tc, clock, at, text):
    from pipecat.frames.frames import TranscriptionFrame
    clock.t = 10_000.0 + at
    await tc.process_frame(TranscriptionFrame(text=text, user_id="u", timestamp="t"),
                           b.FrameDirection.DOWNSTREAM)


@pytest.mark.asyncio
async def test_the_hold_recording_is_not_a_deleted_answer(clock):
    """22f80a85 / d8146538 / 68bdcbcf: "Please stay on the line." was absorbed on
    purpose and then reported as a caller answer the model never saw."""
    rec = _Rec()
    tc = _collector(rec)
    tc._outcome.transcript.append({"role": "assistant", "text": "बच्चा किस class में है?"})
    await _say(tc, clock, 20.0, "सातवीं में है")
    await _say(tc, clock, 30.0, "Please stay on the line.")
    assert tc._hold_since == clock.t, "entered the hold"
    await _say(tc, clock, 31.0, "Stay on the line.")
    await _say(tc, clock, 50.0, "Sorry, आप fees के बारे में बता रही थीं")
    heard = tc.answers_heard()
    assert "Please stay on the line." not in heard and "Stay on the line." not in heard, heard
    assert heard == ["सातवीं में है", "Sorry, आप fees के बारे में बता रही थीं"], heard


@pytest.mark.asyncio
async def test_the_screeners_hold_line_is_not_a_deleted_answer(clock):
    rec = _Rec()
    tc = _collector(rec, machine=True)
    tc._outcome.transcript.append({"role": "assistant", "text": "नमस्ते जी, मैं बोल रही हूँ।"})
    await _say(tc, clock, 4.0, "Record your name and reason for calling.")
    assert tc.screener_seen
    await _say(tc, clock, 12.0, "Please stay on the line.")
    assert tc.answers_heard() == [], tc.answers_heard()


# ── HANDBACK_LOOP ──────────────────────────────────────────────────────────

class _NRRec:
    def __init__(self):
        self.text = []

    async def push(self, frame, direction=None):
        t = getattr(frame, "text", None)
        if t:
            self.text.append(t)


async def _reply(gate, *sentences):
    from pipecat.frames.frames import (LLMFullResponseStartFrame,
                                       LLMFullResponseEndFrame, LLMTextFrame)
    d = b.FrameDirection.DOWNSTREAM
    await gate.process_frame(LLMFullResponseStartFrame(), d)
    for s in sentences:
        await gate.process_frame(LLMTextFrame(s), d)
    await gate.process_frame(LLMFullResponseEndFrame(), d)


@pytest.mark.asyncio
async def test_an_internal_next_step_request_is_not_a_handback(monkeypatch):
    """4a594125: two all-repeat replies each asked the model for a fresh line —
    nothing reached the caller — and the panel headlined "kept asking the
    caller to talk"."""
    monkeypatch.setattr(b.FrameProcessor, "process_frame", _noop_super)
    rec, asked, d = _NRRec(), [], dg.CallDiagnostics(user_turns=6, bot_turns=6)

    async def _next_step(held, kind="", attempt=0):
        asked.append(kind)
    caller = {"t": "जी, सही है।"}
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: caller["t"],
                       request_next_step=_next_step, diag=d)
    g.push_frame = rec.push
    line = "तो मैं आपको हमारे counsellor का number भेज देती हूँ। क्या आप कल शाम बात कर पाएंगे?"
    await _reply(g, line)
    rec.text.clear()
    await _reply(g, line)                      # the whole reply again
    assert asked == ["all-repeat"], asked
    assert not any(t in b.NoRepeatGate._HANDBACK for t in rec.text), rec.text
    assert d.handbacks == 0 and d.next_step_requests == 1, (d.handbacks, d.next_step_requests)
    caller["t"] = "ठीक है जी।"
    rec.text.clear()
    await _reply(g, line)
    assert d.handbacks == 0, "a second request is still not a handback"
    assert dg.HANDBACK_LOOP not in dg.verdict(d)["faults"]


@pytest.mark.asyncio
async def test_a_spoken_handback_still_counts(monkeypatch):
    monkeypatch.setattr(b.FrameProcessor, "process_frame", _noop_super)
    rec, d = _NRRec(), dg.CallDiagnostics()
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "बताइए।", diag=d)
    g.push_frame = rec.push
    await _reply(g, "आपने अपने बेटे के लिए एक query डाली थी। ")
    rec.text.clear()
    await _reply(g, "आपने अपने बेटे के लिए एक query डाली थी। ")
    assert " ".join(rec.text) in b.NoRepeatGate._HANDBACK, rec.text
    assert d.handbacks == 1


@pytest.mark.asyncio
async def test_a_failed_request_that_falls_back_to_a_handback_counts(monkeypatch):
    monkeypatch.setattr(b.FrameProcessor, "process_frame", _noop_super)
    rec, d = _NRRec(), dg.CallDiagnostics()

    async def _broken(held, kind="", attempt=0):
        raise RuntimeError("queue closed")
    g = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: "हाँ जी।",
                       request_next_step=_broken, diag=d)
    g.push_frame = rec.push
    line = "क्या मैं जान सकती हूँ कि बच्चे के पिछले साल कितने marks आए थे?"
    await _reply(g, line)
    rec.text.clear()
    await _reply(g, line)
    assert " ".join(rec.text) in b.NoRepeatGate._HANDBACK, rec.text
    assert d.handbacks == 1 and d.next_step_requests == 1


# ── DEAD_AIR ───────────────────────────────────────────────────────────────

def _speech_callbacks(flags, diag, now):
    """run_bot's own speaking callbacks, lifted out as test_speech_quality does."""
    tree = ast.parse(Path(b.__file__).read_text())
    run = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "run_bot")
    mod = ast.Module(body=[n for n in run.body if isinstance(n, ast.FunctionDef)
                           and n.name in {"_silence_cause", "set_user_speaking", "set_bot_speaking"}],
                     type_ignores=[])
    scope = dict(flags=flags, diag=diag, time=SimpleNamespace(time=lambda: now),
                 logger=logging.getLogger(__name__), corr="test",
                 outcome=SimpleNamespace(replay={"bot": []}, connected_at=100))
    exec(compile(mod, b.__file__, "exec"), scope)
    return scope


def test_the_idle_nudge_after_an_unanswered_question_is_not_dead_air():
    """afa21bf4: the bot asked, the caller said nothing for 8 s, the idle timer
    nudged — and the nudge's first frame logged "dead air 8.0s — both_quiet",
    four times, RED. set_user_speaking already calls that span the caller's."""
    flags = CallState(bot_stopped_t=100, user_stopped_t=95, idle_nudge_t=108)
    diag = dg.CallDiagnostics(user_turns=3, bot_turns=3, tts_chars=100)
    _speech_callbacks(flags, diag, 108.04)["set_bot_speaking"](True)
    assert diag.dead_air == [], diag.dead_air
    assert diag.silences == [{"secs": 8.0, "cause": "caller_silent"}], diag.silences
    assert dg.DEAD_AIR not in dg.verdict(diag)["faults"]


def test_a_quiet_hole_between_two_bot_lines_is_still_dead_air():
    """No idle nudge: the hole is ours (a TTS stall mid-reply, the owed line
    after a bare "जी सर।")."""
    flags = CallState(bot_stopped_t=100, user_stopped_t=95)
    diag = dg.CallDiagnostics(user_turns=3, bot_turns=3, tts_chars=100)
    _speech_callbacks(flags, diag, 108)["set_bot_speaking"](True)
    assert diag.dead_air == [8]
    assert dg.verdict(diag)["faults"][dg.DEAD_AIR] == dg.RED


def test_a_reply_stuck_in_flight_is_still_dead_air_even_after_a_nudge_decision():
    flags = CallState(bot_stopped_t=100, user_stopped_t=95, reply_started_t=101,
                      idle_nudge_t=108)
    diag = dg.CallDiagnostics(user_turns=3, bot_turns=3, tts_chars=100)
    _speech_callbacks(flags, diag, 108)["set_bot_speaking"](True)
    assert diag.dead_air == [8]
    assert diag.silences[0]["cause"].startswith("awaiting_playout")


def test_a_nudge_from_an_earlier_silence_does_not_excuse_a_later_one():
    flags = CallState(bot_stopped_t=120, user_stopped_t=95, idle_nudge_t=108)
    diag = dg.CallDiagnostics(user_turns=3, bot_turns=3, tts_chars=100)
    _speech_callbacks(flags, diag, 128)["set_bot_speaking"](True)
    assert diag.dead_air == [8]


def test_the_hold_itself_is_not_dead_air():
    """68bdcbcf replayed with the hold gate (2026-10-14): nothing leaked into
    the 23 s hold any more, and the quiet read "dead air 22.8s —
    after_caller_turn", RED. Only what followed the person's return is ours."""
    flags = CallState(bot_stopped_t=100, user_stopped_t=101)
    diag = dg.CallDiagnostics(user_turns=3, bot_turns=3, tts_chars=100)
    cb = _speech_callbacks(flags, diag, 124.9)
    cb["transcript"] = SimpleNamespace(hold_ended_t=124.0)     # back at 124.0
    cb["set_bot_speaking"](True)
    assert [round(x, 1) for x in diag.dead_air] == [0.9], diag.dead_air
    assert dg.DEAD_AIR not in dg.verdict(diag)["faults"]
    # Control: the same gap with no hold in it is still ours.
    flags = CallState(bot_stopped_t=100, user_stopped_t=101)
    diag = dg.CallDiagnostics(user_turns=3, bot_turns=3, tts_chars=100)
    cb = _speech_callbacks(flags, diag, 124.9)
    cb["transcript"] = SimpleNamespace(hold_ended_t=0.0)
    cb["set_bot_speaking"](True)
    assert [round(x, 1) for x in diag.dead_air] == [23.9]


def test_the_person_back_from_a_hold_does_not_end_dead_air():
    """68bdcbcf replayed: the person's "Hello." after the 23 s hold started at
    an onset that measured back to the screen's last line — "dead air 22.8s —
    after_caller_turn", RED."""
    flags = CallState(bot_stopped_t=100, user_stopped_t=102)
    diag = dg.CallDiagnostics(user_turns=3, bot_turns=3, tts_chars=100)
    cb = _speech_callbacks(flags, diag, 125)
    cb["transcript"] = SimpleNamespace(on_hold=lambda: True, hold_ended_t=0.0)
    cb["set_user_speaking"](True)
    assert diag.dead_air == [], diag.dead_air
    assert diag.silences == [{"secs": 23.0, "cause": "on_hold"}], diag.silences
    # …and when their final already ended the hold before the (late) onset.
    flags = CallState(bot_stopped_t=100, user_stopped_t=102)
    diag = dg.CallDiagnostics(user_turns=3, bot_turns=3, tts_chars=100)
    cb = _speech_callbacks(flags, diag, 125)
    cb["transcript"] = SimpleNamespace(on_hold=lambda: False, hold_ended_t=124.7)
    cb["set_user_speaking"](True)
    assert diag.dead_air == [], diag.dead_air
    # Control: not on hold, the same span is still counted.
    flags = CallState(bot_stopped_t=100, user_stopped_t=102)
    diag = dg.CallDiagnostics(user_turns=3, bot_turns=3, tts_chars=100)
    cb = _speech_callbacks(flags, diag, 125)
    cb["transcript"] = SimpleNamespace(on_hold=lambda: False, hold_ended_t=0.0)
    cb["set_user_speaking"](True)
    assert [round(x, 1) for x in diag.dead_air] == [23.0]


def test_a_deliberate_re_say_of_the_opening_is_not_a_replay():
    """The opening cut at pickup and re-said on purpose (opening_resaid), with
    no acknowledgement splitting the re-delivery in the played transcript:
    662d1c80 / aa5e2e5f replayed RED "said its opening again mid-call" on
    the same audio that was GREEN before 2026-10-14. A model re-introducing
    itself later is still a replay."""
    import app.report as rp
    op = ("नमस्ते जी, मैं Asha बोल रही हूँ Test Academy से। आपने inquiry की थी, "
          "उसी के बारे में बात करनी थी।")
    o = b.CallOutcome(corr="resay-t", context={})
    o.transcript = [{"role": "assistant", "text": "नमस्ते जी, मैं Asha बोल"},
                    {"role": "user", "text": "बोलिए।"},
                    {"role": "assistant", "text": op}]
    o.diagnostics = dg.CallDiagnostics(user_turns=1, bot_turns=2, tts_chars=100,
                                       opening_resaid=1)
    blob = rp._diagnostics_blob(o)
    assert dg.OPENING_REPLAYED not in (blob.get("faultLevels") or {}), blob.get("faultLevels")
    o.transcript += [{"role": "user", "text": "कौन बोल रहा है?"},
                     {"role": "assistant", "text": op}]     # the model said it again
    o.diagnostics = dg.CallDiagnostics(user_turns=2, bot_turns=3, tts_chars=100,
                                       opening_resaid=1)
    blob = rp._diagnostics_blob(o)
    assert (blob.get("faultLevels") or {}).get(dg.OPENING_REPLAYED) == dg.RED


def test_the_idle_handler_marks_only_the_callers_silence():
    """The stamp sits on the plain nudge and on the farewell after a question —
    never on the owed-line path, where the silence is the bot's."""
    src = Path(b.__file__).read_text()
    idle = src[src.index("async def _on_idle("):src.index("async def _greet_when_ready(")]
    owed = idle[idle.index("no_repeat.owes_line():"):idle.index("elif flags[\"nudge_count\"]")]
    assert "idle_nudge_t" not in owed
    nudge = idle[idle.index("elif flags[\"nudge_count\"]"):]
    assert nudge.count("flags[\"idle_nudge_t\"] = time.time()") == 2


# ── CALLER_IGNORED ─────────────────────────────────────────────────────────

def test_swallowed_turns_are_a_fault_not_green():
    """5e979e3e / 662d1c80 / 4cb132a2 / a11e6709 scored GREEN (or AMBER on
    something else) while the person talked into 14-18 s of silence."""
    d = dg.CallDiagnostics(user_turns=4, bot_turns=1, tts_chars=200, swallowed_turns=1)
    v = dg.verdict(d)
    assert v["faults"][dg.CALLER_IGNORED] == dg.AMBER
    d.swallowed_turns = 2
    v = dg.verdict(d)
    assert v["health"] == dg.RED and v["headline"] == dg.CALLER_IGNORED
    p = dg.to_payload(d)
    assert p["turnTaking"]["swallowedTurns"] == 2
    assert p["headlineText"] == "The caller spoke and the agent stayed silent"
    assert dg.CallDiagnostics().swallowed_turns == 0
    assert dg.verdict(dg.CallDiagnostics(user_turns=4, bot_turns=4, tts_chars=200))["health"] == dg.GREEN


def test_next_step_requests_are_reported_and_fire_nothing():
    d = dg.CallDiagnostics(user_turns=6, bot_turns=6, tts_chars=200, next_step_requests=4)
    assert dg.verdict(d)["health"] == dg.GREEN
    assert dg.to_payload(d)["turnTaking"]["nextStepRequests"] == 4


# ── voicemail ──────────────────────────────────────────────────────────────

# The operator's voicemail recording, as the STT splits it, with the pieces it
# mishears in between (synthetic scraps of the 2026-10-14 shapes).
_VOICEMAIL = (
    (2.4, "Your call has been forwarded to voicemail."),
    (3.8, "The person you're trying to"),
    (4.1, "71."),                       # a mis-heard piece, capitalised / digits
    (5.0, "Bee is not available."),
    (5.1, "लेबो।"),                      # a Devanagari piece (islower() is False)
    (6.0, "At the tone."),
    (7.7, "Please record your message."),
    (8.6, "When you are done."),        # four capitalised words
    (10.0, "When you have finished recording you may hang up."),
)


@pytest.mark.asyncio
async def test_pieces_of_a_voicemail_recording_do_not_disarm_the_hang_up(clock):
    rec = _Rec()
    tc = _collector(rec, machine=True)
    for at, line in _VOICEMAIL:
        await _say(tc, clock, at, line)
    assert tc._human_turns == 3, "the pieces still went through as turns"
    assert tc.looks_like_voicemail(), "voicemail not recognised: nudges and a farewell into the recorder"


@pytest.mark.asyncio
async def test_a_hello_between_the_recordings_lines_is_the_recording(clock):
    """1c138e52: "Hello." between "…is not available." and "Please record…"."""
    rec = _Rec()
    tc = _collector(rec, machine=True)
    for at, line in ((2.2, "Your call has been forwarded to voicemail."),
                     (4.8, "The person you're trying to reach is not available."),
                     (5.7, "Hello."),
                     (7.4, "Please record your message."),
                     (9.7, "When you have finished recording you may hang up.")):
        await _say(tc, clock, at, line)
    assert tc.looks_like_voicemail()


@pytest.mark.asyncio
@pytest.mark.parametrize("after", ["Hello.", "हेलो।", "हाँ।", "हाँ जी बोलिए"])
async def test_a_person_after_the_recording_is_never_taken_for_it(clock, after):
    """a11e6709: the voicemail prompt played to its end, then someone said hello."""
    rec = _Rec()
    tc = _collector(rec, machine=True)
    for at, line in _VOICEMAIL:
        await _say(tc, clock, at, line)
    await _say(tc, clock, 13.0, after)
    assert not tc.looks_like_voicemail(), after


@pytest.mark.asyncio
async def test_a_hello_long_before_the_next_line_is_a_person(clock):
    rec = _Rec()
    tc = _collector(rec, machine=True)
    await _say(tc, clock, 2.0, "Your call has been forwarded to voicemail.")
    await _say(tc, clock, 4.0, "Hello.")
    await _say(tc, clock, 9.0, "Please record your message.")
    assert not tc.looks_like_voicemail()


@pytest.mark.asyncio
async def test_a_sentence_before_a_carrier_line_is_a_person(clock):
    rec = _Rec()
    tc = _collector(rec, machine=True)
    await _say(tc, clock, 2.0, "The person you are trying to reach is not available.")
    await _say(tc, clock, 3.0, "हाँ जी मैं बोल रहा हूँ आप कौन")
    await _say(tc, clock, 4.0, "Please try again later.")
    assert not tc.looks_like_voicemail()


@pytest.mark.asyncio
async def test_a_hello_over_a_call_connect_bridge_is_a_person(clock):
    """A connect bridge plays while the person may be picking up."""
    rec = _Rec()
    tc = _collector(rec, machine=True)
    await _say(tc, clock, 0.5, "Connecting your call.")
    await _say(tc, clock, 1.5, "Hello.")
    await _say(tc, clock, 2.5, "You are getting connected by Just Dial.")
    assert not tc.looks_like_voicemail()


@pytest.mark.asyncio
async def test_the_carrier_adjacent_guard_measures_from_the_previous_final(clock):
    """The guard's "< 1 s since the last final" was always true: _prev_final_t
    already held THIS final's time. A piece 0.3 s after a carrier line keeps the
    opening playing; a two-word line 2.5 s later is a person and cuts it."""
    rec = _Rec()
    tc = _collector(rec, machine=True, speaking=True)
    await _say(tc, clock, 2.0, "The person you're trying to reach.")
    await _say(tc, clock, 2.3, "Not.")
    assert rec.interruptions == 0, "a piece right after the carrier line cut the opening"
    rec2 = _Rec()
    tc2 = _collector(rec2, machine=True, speaking=True)
    await _say(tc2, clock, 2.0, "The person you're trying to reach.")
    await _say(tc2, clock, 4.5, "Not.")
    assert rec2.interruptions == 1, "a line 2.5 s after the recording is the person"


def test_the_unpaid_number_message_is_the_operator():
    """e208c6e8: two pieces of it matched nothing and each cut the opening."""
    for line in ("The number you are trying to call",
                 "is unable to take calls due to pending recharge",
                 "due to pending recharge.",
                 "डायल किए जा रहे नंबर पर अभी",
                 "कॉल प्राप्त करने में असमर्थ",
                 "recharge बाकी होने के कारण"):
        assert is_carrier_announcement(line), line
    for person in ("हाँ जी बोलिए", "recharge करवाना है क्या?", "The number is correct.",
                   "मैं अभी call receive नहीं कर पाऊँगा",
                   # Everyday Indian English — a carrier match drops it from the
                   # model's context (review 2026-10-14).
                   "Sorry, I am not able to receive call right now, I am driving.",
                   "I was unable to receive call yesterday.",
                   "I could not receive call due to meeting"):
        assert not is_carrier_announcement(person), person


@pytest.mark.asyncio
async def test_a_short_reply_between_generic_operator_lines_is_a_person(clock):
    """Pieces count as the recording only on a call whose recorder played its
    own prompt (voicemail / record your message / the tone). Between two
    generic lines a person's "हाँ।" is a person: hanging up on them in
    silence at the first idle tick is the wrong trade."""
    rec = _Rec()
    tc = _collector(rec, machine=True)
    for at, line in ((2.0, "The person you are trying to reach is not available."),
                     (3.0, "हाँ।"),
                     (4.0, "कृपया बाद में प्रयास करें।")):
        await _say(tc, clock, at, line)
    assert not tc.looks_like_voicemail()


# ── a looping phone menu ─────────────────────────────────────────────────────

# Call 5856b13f (2026-10-24), as the STT split it: an admissions IVR replaying
# every ~21 s for eight minutes while the bot answered it 34 times.
_IVR_LOOP = (
    "You have entered an invalid option.",
    "Thank you for calling.",
    "Nitya Admission Team.",
    "Press 1 for the programs offered at.",
    "Mangaluru campus.",
    "Programs offered at Bengaluru campus.",
)


@pytest.mark.asyncio
async def test_a_phone_menu_that_replays_itself_is_hung_up_on(clock):
    rec = _Rec()
    tc = _collector(rec)
    at = 2.0
    for loop in range(3):
        assert not tc.looks_like_ivr_loop(), f"hung up after {loop} play(s) of the menu"
        for line in _IVR_LOOP:
            await _say(tc, clock, at, line)
            at += 3.0
    assert tc.looks_like_ivr_loop()


@pytest.mark.asyncio
async def test_a_person_mentioning_a_menu_is_not_an_ivr_loop(clock):
    rec = _Rec()
    tc = _collector(rec)
    for at, line in ((2.0, "Hello?"),
                     (5.0, "You have to press 1 on our IVR to reach admissions."),
                     (9.0, "Yes, press 1."),
                     (13.0, "Press 2 is for the hostel."),
                     (17.0, "Sorry, which option did you want?")):
        await _say(tc, clock, at, line)
    assert not tc.looks_like_ivr_loop()


@pytest.mark.parametrize("line,menu", [
    ("You have entered an invalid option.", True),
    ("Press 1 for admissions.", True),
    ("Please dial 9 for the operator.", True),
    ("That is not a valid selection.", True),
    ("एडमिशन के लिए 1 दबाएं।", True),
    ("Hindi ke liye 4 dabayein.", True),
    ("Aap dabaiye mat.", False),
    ("Press.", False),
    ("I am under a lot of pressure.", False),
    ("Hello, who is this?", False),
])
def test_ivr_menu_key(line, menu):
    from app.turntake import ivr_menu_key
    assert bool(ivr_menu_key(line)) is menu


# ── a caller we can hear but not understand ──────────────────────────────────

@pytest.mark.asyncio
async def test_wordless_sounds_are_counted_until_a_word_arrives(clock):
    """ddcba11f (2026-10-24): five 0.2 s sounds, no words, 16 s of silence."""
    from pipecat.frames.frames import VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame
    rec = _Rec()
    tc = _collector(rec)
    bot_stopped = 10_000.0 + 6.7
    for at in (9.0, 11.9, 15.6):
        clock.t = 10_000.0 + at
        await tc.process_frame(VADUserStartedSpeakingFrame(), b.FrameDirection.DOWNSTREAM)
        clock.t += 0.2
        await tc.process_frame(VADUserStoppedSpeakingFrame(), b.FrameDirection.DOWNSTREAM)
    assert tc.wordless_onsets_since(bot_stopped) == 3
    assert tc.wordless_onsets_since(10_000.0 + 12.0) == 1
    await _say(tc, clock, 21.3, "Hello.")
    assert tc.wordless_onsets_since(bot_stopped) == 0, "a word arrived: they are heard"
