"""The call on hold — entry, exit and the limits around it.

Review of 53b6e16b04 (2026-10-14), which taught the bot to stay silent through
the network's hold recording (call 6d81124d): the first cut also went silent on
REAL people. "पापा अभी दूसरी कॉल पर हैं, बाद में कीजिए" entered the hold and never
reached the model; while on hold, "हेलो, आप लाइन पर हैं?" or "Sorry for the hold,
haan boliye" read as more of the recording; a goodbye after a hold got the
question again; the 5-minute limit never fired; hold music spent the call's
orphan re-asks. Every sentence below is from that review (or its synthetic
twin); the IVR timeline is the shape of call 9519f8c6 (2026-10-14).
"""
import time as _time

import pytest

import app.bot as b
from app.callstate import (CallState, WatchdogConfig, watchdog_decide, apply_decision,
                           hold_escalation_due, NONE, ORPHAN_ASK, LLM_BRIDGE)
from app.turntake import (is_hold_announcement, hold_absorbs, is_hold_fragment,
                          caller_asks_who, caller_checking_presence)


# ── the rule, as pure functions ────────────────────────────────────────────

RECORDING_ENTERS = (
    "The person you are calling has put your call on hold",
    "please stay on the line",
    "कृपया लाइन पर बने रहें",
    "आप जिस व्यक्ति से बात कर रहे हैं वो अभी दूसरी कॉल पर हैं",
    "Welcome to New Light Institute. Stay on the line. One of our representatives "
    "will assist you shortly",
    "Stay on the line.",
    "The person you are speaking with has put your call on hold. Please stay on the line.",
    # Other operators' wording (review 2026-10-14).
    "आप जिस व्यक्ति से बात कर रहे हो, उन्होंने आपकी कॉल होल्ड पर रखी है",
    "कृपया लाइन पे बने रहिए",
    "The person you are talking to has put your call on hold.",
    "आप जिनसे बात कर रहे हैं उन्होंने आपके call को hold पर रखा है",
)

PERSON_NEVER_ENTERS = (
    "पापा अभी दूसरी कॉल पर हैं, बाद में कीजिए",
    "He is busy on another call, call later",
    "My father is on another call.",
    "Please hold, what is the fee?",
    "थोड़ा प्रतीक्षा करें",
    "stay on the line I will call my son",
    "don't disconnect, I will ask",
    "पापा दूसरी कॉल पर हैं।",
    "He is on another call",
    "Sorry, I had put your call on hold, what were you saying?",
    # A person explaining the hold — past tense, which the recordings never use.
    "हाँ जी, होल्ड पर रखा था",
    "होल्ड पर रखा था",
    "hold par rakha tha",
)

PERSON_BACK = (
    "हेलो, आप लाइन पर हैं?",
    "Hello, are you still on the line?",
    "हाँ जी, कौन बात कर रहे हैं?",
    "Who am I speaking with?",
    "Sorry for the hold, haan boliye",
    "Thanks for holding, yes tell me",
    "Sorry, I was on another call",
    "I thought the call got disconnected",
    "हाँ, ऑनलाइन क्लास के बारे में बताइए",
    "हाँ, लाइन पर हूँ, बोलिए।",
    "हाँ जी, आप कहाँ से बात कर रहे हैं?",
    "Yes, I am on the line.",
    "मैंने पूछा, उन्होंने बोला अभी नहीं चाहिए",
    "Hello.",
    "हाँ जी",
    "Thanks for holding.",
    "नहीं चाहिए, फ़ोन रखिए",
    # Every word is recording vocabulary, none only the recording says.
    "आप लाइन पर हैं",
    "You are on the line",
    "वो दूसरी कॉल पर हैं",
    "वो अभी बात कर रहे हैं",
    "होल्ड पर रखा था",
)

# Two-three words of recording vocabulary and nothing only the recording says:
# a scrap of it right after a piece, the person once the recording has paused.
PERSON_BACK_AFTER_A_PAUSE = ("We will see", "Please connect", "आपके call को")

RECORDING_PIECES = (
    "Stay on the line.", "One of our representatives will assist.", "See shortly.",
    "please stay on the line", "उन्होंने आपके।", "होल्ड।", "hold पर रखा है।",
    "कृपा।", "कृपया लाइन पर बने रहें।", "The person you are", "Speaking with.",
    "has put your call on hold.", "आप जिस व्यक्ति से बात कर रहे हैं।",
    "कृपया लाइन पे बने रहिए", "The subscriber you are calling", "आप जिस व्यक्ति से बात कर रहे हो",
)


@pytest.mark.parametrize("line", RECORDING_ENTERS)
def test_recording_phrasing_enters_the_hold(line):
    assert is_hold_announcement(line), line


@pytest.mark.parametrize("line", PERSON_NEVER_ENTERS)
def test_a_person_saying_wait_or_busy_is_a_normal_turn(line):
    """Their own words go to the model like any other answer (call-back, wait,
    a question) — silence is never the reply to a person."""
    assert not is_hold_announcement(line), line


@pytest.mark.parametrize("line", PERSON_BACK)
def test_a_person_back_from_hold_ends_it_even_right_after_a_piece(line):
    # 0.4 s after a piece of the recording: the tightest the live gate sees.
    assert not hold_absorbs(line, 0.4), line
    assert not hold_absorbs(line, 30.0), line


@pytest.mark.parametrize("piece", RECORDING_PIECES)
def test_pieces_of_the_recording_stay_absorbed(piece):
    assert hold_absorbs(piece, 30.0), piece


@pytest.mark.parametrize("line", PERSON_BACK_AFTER_A_PAUSE)
def test_generic_recording_words_are_a_scrap_only_right_after_a_piece(line):
    assert hold_absorbs(line, 0.4), line
    assert not hold_absorbs(line, 30.0), line


def test_fragments_are_whole_words_not_substrings():
    # "लाइन" inside "ऑनलाइन", "hold" inside "holding", "disconnect" inside
    # "disconnected": none of them is the recording.
    for line in ("ऑनलाइन", "holding", "disconnected", "the line is bad, बोलिए"):
        assert not is_hold_fragment(line), line


def test_scraps_right_after_a_piece_are_the_recording_but_not_later():
    # 6d81124d: "हाँ।" 0.4 s after "Speaking with."; 9519f8c6: "But losing art."
    # 2.3 s after "See shortly.".
    assert hold_absorbs("हाँ।", 0.43)
    assert hold_absorbs("But losing art.", 2.33)
    assert not hold_absorbs("But losing art.", 5.0)
    assert not hold_absorbs("हाँ जी", 0.5), "a person's two-word answer"
    assert not hold_absorbs("नाम अर्जुन है और वो seventh में", 0.5), "a real answer"
    assert hold_absorbs("।", 0.5), "punctuation alone is nobody"


def test_presence_and_who_cover_the_return_lines():
    assert caller_checking_presence("Hello, are you still on the line?")
    assert caller_asks_who("हाँ जी, कौन बात कर रहे हैं?")
    assert caller_asks_who("Who am I speaking with?")


def test_ivr_and_carrier_timelines_classify_as_on_the_live_calls():
    """sim.replay shares the rule: the hold windows of both live shapes."""
    from sim.replay import _hold_lines
    ivr = [(1.57, "Welcome to New Light Institute."), (3.65, "Stay on the line."),
           (5.84, "One of our representatives will assist."), (6.63, "See shortly."),
           (8.96, "But losing art."), (20.4, "Hello."), (23.12, "Hello."),
           (25.82, "Hello."), (29.46, "Yes.")]
    assert _hold_lines(ivr) == {3.65, 5.84, 6.63, 8.96}
    # Synthetic twin of 6d81124d's 44.8-61.2 s hold (Hindi + English loop).
    carrier = [(42.6, "मैं बात करता हूँ बाद में।"), (46.5, "आप जिस व्यक्ति से बात कर रहे हैं।"),
               (47.2, "उन्होंने आपके।"), (48.0, "आपके call को"), (48.6, "होल्ड।"),
               (49.4, "hold पर रखा है।"), (50.1, "कृपा।"), (51.6, "कृपया लाइन पर बने रहें।"),
               (53.0, "The person you are"), (53.7, "Speaking with."), (54.1, "हाँ।"),
               (55.6, "has put your call on hold."), (57.5, "Stay on the line."),
               (60.1, "आप जिस व्यक्ति से बात कर रहे हैं।"), (61.1, "Hello."),
               (65.7, "हां जी बताइए, आ गया।")]
    held = _hold_lines(carrier)
    assert min(held) == 46.5 and max(held) == 60.1 and 61.1 not in held
    assert len(held) == 13


# ── the live gate (TranscriptCollector) ────────────────────────────────────

class _Outcome:
    def __init__(self):
        self.corr = "test"
        self.transcript = []
        self.transfer_requested = False
        self.end_requested = False
        self.transfer_registered = False
        self.context = {}


class _Clock:
    """bot.time with a settable time(); everything else is the real module."""

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

    def cues(self):
        return [m.get("content") or "" for f in self.frames
                for m in (getattr(f, "messages", None) or [])]

    def forwarded(self):
        from pipecat.frames.frames import TranscriptionFrame
        return [f.text for f in self.frames if isinstance(f, TranscriptionFrame)]

    def clear(self):
        self.frames.clear()


async def _noop_super(self, frame, direction):
    return None


@pytest.fixture
def clock(monkeypatch):
    c = _Clock(10_000.0)
    monkeypatch.setattr(b, "time", c)
    monkeypatch.setattr(b.FrameProcessor, "process_frame", _noop_super)
    return c


def _collector(rec, *, bot_spoke_once=True, machine=False, resay=None, owed=False):
    tc = b.TranscriptCollector(
        _Outcome(), lambda user=True: None,
        is_bot_speaking=lambda: False, fillers_armed=lambda: False,
        bot_stopped_t=lambda: 0.0, gate_enabled=lambda: True,
        interrupt_on_vad=lambda: True, filler_phrases=[],
        in_machine_window=lambda: machine, reply_in_flight=lambda: False,
        bot_spoke_once=lambda: bot_spoke_once, opening_owed=lambda: owed,
        resay_opening=resay)

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


async def _on_hold(tc, clock, rec, at=40.0):
    await _say(tc, clock, at - 10.0, "नाम अर्जुन है और वो seventh में है")
    await _say(tc, clock, at, "आप जिस व्यक्ति से बात कर रहे हैं।")
    assert tc._hold_since == clock.t, "entered the hold"
    rec.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize("line", PERSON_NEVER_ENTERS)
async def test_person_lines_mid_call_reach_the_model(clock, line):
    rec = _Rec()
    tc = _collector(rec)
    await _say(tc, clock, 20.0, "हाँ जी बोलिए")
    await _say(tc, clock, 25.0, line)
    assert tc.on_hold_for() == 0, line
    assert line in rec.forwarded(), line


@pytest.mark.asyncio
async def test_the_carrier_loop_is_silent_and_hello_brings_the_person_back(clock):
    rec = _Rec()
    tc = _collector(rec)
    tc._outcome.transcript.append({"role": "assistant",
                                   "text": "अर्जुन के previous class में कितने marks आए थे?"})
    await _say(tc, clock, 28.0, "नाम अर्जुन है और वो seventh में है")
    rec.clear()
    for at, piece in ((46.5, "आप जिस व्यक्ति से बात कर रहे हैं।"), (47.2, "उन्होंने आपके।"),
                      (48.0, "आपके call को"), (48.6, "होल्ड।"), (49.4, "hold पर रखा है।"),
                      (50.1, "कृपा।"), (51.6, "कृपया लाइन पर बने रहें।"),
                      (53.0, "The person you are"), (53.7, "Speaking with."), (54.1, "हाँ।"),
                      (55.6, "has put your call on hold."), (57.5, "Stay on the line."),
                      (60.1, "आप जिस व्यक्ति से बात कर रहे हैं।")):
        await _say(tc, clock, at, piece)
    assert rec.frames == [], "the recording must not reach the model"
    assert tc.on_hold_for() == pytest.approx(60.1 - 46.5)
    await _say(tc, clock, 61.1, "Hello.")
    assert tc.on_hold_for() == 0
    assert rec.forwarded() == ["Hello."], "the person's words are the turn"
    cues = rec.cues()
    assert cues[0] == b.HOLD_RESUME_CUE, "the cue is context for their words, sent first"
    assert any("checking whether you are still on the line" in c for c in cues), cues


@pytest.mark.asyncio
@pytest.mark.parametrize("line", PERSON_BACK)
async def test_every_return_line_ends_the_hold_and_reaches_the_model(clock, line):
    rec = _Rec()
    tc = _collector(rec)
    await _on_hold(tc, clock, rec)
    await _say(tc, clock, 40.4, line)       # straight after the piece
    assert tc.on_hold_for() == 0, line
    assert line in rec.forwarded(), line


@pytest.mark.asyncio
@pytest.mark.parametrize("piece", RECORDING_PIECES)
async def test_more_of_the_recording_keeps_the_hold(clock, piece):
    rec = _Rec()
    tc = _collector(rec)
    await _on_hold(tc, clock, rec)
    await _say(tc, clock, 52.0, piece)
    assert tc.on_hold_for() > 0, piece
    assert rec.frames == [], piece


@pytest.mark.asyncio
async def test_a_goodbye_after_a_hold_gets_the_forced_close_not_the_question(clock):
    rec = _Rec()
    tc = _collector(rec)
    await _on_hold(tc, clock, rec)
    await _say(tc, clock, 70.0, "नहीं चाहिए, फ़ोन रखिए")
    cues = rec.cues()
    assert tc._outcome.end_forced is True
    assert any(b.END_MARKER in c for c in cues), cues
    assert b.HOLD_RESUME_CUE not in cues, "'carry on… ask it again' contradicts a goodbye"
    assert "नहीं चाहिए, फ़ोन रखिए" in rec.forwarded()


@pytest.mark.asyncio
async def test_busy_after_a_hold_gets_no_carry_on_cue(clock):
    rec = _Rec()
    tc = _collector(rec)
    await _on_hold(tc, clock, rec)
    await _say(tc, clock, 70.0, "Sorry, I am busy now, call me later")
    assert b.HOLD_RESUME_CUE not in rec.cues()
    assert "Sorry, I am busy now, call me later" in rec.forwarded()


@pytest.mark.asyncio
async def test_the_return_line_cannot_rejoin_the_recording_into_a_new_hold(clock):
    rec = _Rec()
    tc = _collector(rec)
    await _on_hold(tc, clock, rec)
    await _say(tc, clock, 41.0, "The person you are")
    await _say(tc, clock, 41.5, "speaking with, नाम अर्जुन है बोलिए")
    assert tc.on_hold_for() == 0
    assert "speaking with, नाम अर्जुन है बोलिए" in rec.forwarded()


@pytest.mark.asyncio
async def test_ivr_answering_the_call_is_silent_until_the_representative(clock):
    """Call 9519f8c6 (2026-10-14), its finals at their times: an IVR picked up
    before the bot had spoken. Silent from "Stay on the line." to "Hello.", and
    the person, who heard nothing from us, is told to get an introduction."""
    rec = _Rec()
    tc = _collector(rec, bot_spoke_once=False, machine=True)
    await _say(tc, clock, 1.57, "Welcome to New Light Institute.")
    rec.clear()
    for at, piece in ((3.65, "Stay on the line."),
                      (5.84, "One of our representatives will assist."),
                      (6.63, "See shortly."), (8.96, "But losing art.")):
        await _say(tc, clock, at, piece)
    assert rec.frames == [], rec.frames
    assert tc.on_hold_for() > 0
    await _say(tc, clock, 20.4, "Hello.")
    assert tc.on_hold_for() == 0
    assert rec.forwarded() == ["Hello."], "not dropped as a machine-greeting scrap"
    assert rec.cues()[0] == b.HOLD_FIRST_CUE
    rec.clear()
    await _say(tc, clock, 23.12, "Hello.")
    await _say(tc, clock, 25.82, "Hello.")
    await _say(tc, clock, 29.46, "Yes.")
    assert tc.on_hold_for() == 0, "the person's hellos never re-enter the hold"


@pytest.mark.asyncio
async def test_ivr_return_resays_an_opening_the_recording_took(clock):
    rec = _Rec()
    said = []

    async def resay(text, force=False, cut_now=False):
        said.append((text, force))
        return True
    tc = _collector(rec, bot_spoke_once=True, machine=True, resay=resay, owed=True)
    await _say(tc, clock, 1.57, "Welcome to New Light Institute.")
    await _say(tc, clock, 3.65, "Stay on the line.")
    rec.clear()
    await _say(tc, clock, 20.4, "Hello.")
    assert said == [("Hello.", True)], said
    assert tc.on_hold_for() == 0
    assert rec.forwarded() == [], "the opening IS the reply to their hello"
    assert not any("introduce yourself" in c or "on hold" in c for c in rec.cues())
    # A question takes over, as it does over the opening: the model answers it
    # and introduces itself (it was never heard).
    await _say(tc, clock, 30.0, "Stay on the line.")
    rec.clear()
    await _say(tc, clock, 45.0, "Yes, who is calling?")
    assert said == [("Hello.", True)], said
    assert rec.forwarded() == ["Yes, who is calling?"]
    assert rec.cues()[0] == b.HOLD_FIRST_CUE


@pytest.mark.asyncio
async def test_a_hold_after_the_bot_was_heard_says_do_not_reintroduce(clock):
    rec = _Rec()
    tc = _collector(rec, bot_spoke_once=True, machine=False, owed=False)
    await _on_hold(tc, clock, rec)
    await _say(tc, clock, 60.0, "हाँ जी बताइए")
    assert rec.cues()[0] == b.HOLD_RESUME_CUE
    assert "Answer what they say next first" in b.HOLD_RESUME_CUE


# ── HOLD_MAX_SECS and the orphan budget (pure watchdog) ─────────────────────

T0 = 1000.0


def _cfg(**over):
    base = dict(connected_at=T0, cap_secs=3600.0, idle_timeout_secs=1e9,
                stall_recovery_enabled=False, graceful_stop_deadline_secs=25.0,
                llm_bridge_after_secs=2.0)
    base.update(over)
    return WatchdogConfig(**base)


def test_hold_max_is_enforced_while_the_recording_loops():
    """A forgotten hold with the recording looping every 2 s: every piece stamps
    transcript_t and the caller's VAD, which kept the old idle-based limit from
    ever firing. The watchdog's check fires at 300 s and then once per idle
    period — nudge, nudge, goodbye — never in a burst."""
    s = CallState(t=T0)
    s.bot_stopped_t = T0 + 40.0
    hold_t, idle = T0 + 46.0, 8.0
    steps = []
    t = hold_t
    while t < hold_t + 340.0:
        k = int(t - hold_t)
        s.user_speaking = k % 2 == 0           # a piece of the recording …
        if s.user_speaking:
            s.user_started_t = t
            s.transcript_t = t                 # … absorbed, stamped as heard
        else:
            s.user_stopped_t = t
        s.on_hold = True
        d = watchdog_decide(s, t, _cfg())
        apply_decision(s, d, t)
        assert d.kind == NONE, d
        if hold_escalation_due(s, t, t - hold_t, b.HOLD_MAX_SECS, idle):
            s.hold_nudge_t = t
            steps.append(t - hold_t)
            s.bot_stopped_t = t + 2.0          # the nudge plays for 2 s
        t += 1.0
    assert steps and steps[0] == pytest.approx(b.HOLD_MAX_SECS)
    assert all(b2 - a >= idle for a, b2 in zip(steps, steps[1:])), steps
    assert len(steps) == 4                     # 300, 310, 320, 330 in 340 s


def test_hold_escalation_waits_for_the_bot_and_the_stop():
    s = CallState(t=T0)
    assert not hold_escalation_due(s, T0 + 400, 299.0, 300.0, 8.0)
    assert hold_escalation_due(s, T0 + 400, 300.0, 300.0, 8.0)
    s.bot_speaking = True
    assert not hold_escalation_due(s, T0 + 400, 300.0, 300.0, 8.0)
    s.bot_speaking = False
    s.stopping_since = T0 + 399
    assert not hold_escalation_due(s, T0 + 400, 300.0, 300.0, 8.0)


def _wordless_vad(s, at):
    """Hold music / a tone: 1 s of voice, no transcript."""
    s.user_started_t = at
    s.voice_tick_t = at + 1.0
    s.user_stopped_t = at + 1.0


def _ticks(s, c, start, end):
    out = []
    t = start
    while t < end:
        d = watchdog_decide(s, t, c)
        apply_decision(s, d, t)
        out.append(d.kind)
        t += 1.0
    return out


def test_hold_music_never_spends_the_orphan_budget():
    c = _cfg()
    s = CallState(t=T0)
    s.bot_stopped_t = T0 + 5.0
    s.on_hold = True
    for at in (T0 + 20.0, T0 + 40.0, T0 + 60.0):
        _wordless_vad(s, at)
        assert ORPHAN_ASK not in _ticks(s, c, at + 2.0, at + 14.0)
    assert s.orphan_asks == 0 and not s.orphan_used and s.deaf_streak == 0
    # The person is back; two genuinely lost utterances still get their re-ask.
    s.on_hold = False
    s.transcript_t = T0 + 80.0
    s.bot_stopped_t = T0 + 82.0
    _wordless_vad(s, T0 + 90.0)
    assert _ticks(s, c, T0 + 92.0, T0 + 104.0).count(ORPHAN_ASK) == 1
    s.bot_stopped_t = T0 + 106.0
    _wordless_vad(s, T0 + 110.0)
    assert _ticks(s, c, T0 + 112.0, T0 + 124.0).count(ORPHAN_ASK) == 1


def test_no_bridge_line_into_a_hold():
    c = _cfg()
    s = CallState(t=T0)
    s.reply_started_t = T0 + 1.0
    s.on_hold = True
    assert LLM_BRIDGE not in _ticks(s, c, T0 + 1.0, T0 + 8.0)
    assert s.bridged_reply_t == 0.0
    s.on_hold = False
    assert LLM_BRIDGE in _ticks(s, c, T0 + 8.0, T0 + 10.0)


def test_run_bot_wires_the_hold_limit_into_the_watchdog():
    """The I/O side: on_hold is set BEFORE the decision, the limit is checked in
    the 1 s loop, and _on_idle no longer spawns self-renewing recheck tasks."""
    import inspect
    src = inspect.getsource(b.run_bot)
    loop = src[src.index("_note_vendor_failover()\n            _held"):]
    assert loop.index('flags["on_hold"] = _held > 0') < loop.index("watchdog_decide(flags")
    assert "hold_escalation_due(flags, now, _held, HOLD_MAX_SECS" in loop
    idle = src[src.index("async def _on_idle"):src.index("async def _greet_when_ready")]
    hold = idle[idle.index("if 0 < _held < HOLD_MAX_SECS:"):]
    hold = hold[:hold.index("return")]
    assert "create_task" not in hold
    assert "_hold_recheck" not in src


# ── the hold is a hard gate; a screener hand-off re-introduces ─────────────
# Calls 22f80a85, d8146538, 68bdcbcf (2026-10-14): a phone call screener ("…record
# your name and reason for calling…", then "Thanks." / "Please stay on the
# line.") put the bot on hold, and something already queued or forming played
# into the hold every time — a noise re-ask, a parked next-step cue, the run on
# the screen's own "Thanks.". On 68bdcbcf the person then came back to "do NOT
# introduce yourself" and never heard who was calling. Synthetic lines, the
# calls' shapes and timings.

SCREEN_PROMPT = "If you record your name and reason for calling I'll see if."


def _screened_collector(rec, clock, resay):
    tc = _collector(rec, bot_spoke_once=True, resay=resay)
    machine = {"on": True}
    tc._in_machine_window = lambda: machine["on"]
    return tc, machine


async def _screen_then_hold(tc, clock, machine):
    """The screen's prompt, its relays and its hold line — the opening played
    in full into its recorder (bot_spoke_once, not owed)."""
    await _say(tc, clock, 3.9, SCREEN_PROMPT)
    assert tc.screener_seen
    await _say(tc, clock, 4.65, "Available.")     # d8146538: kept as a "human" turn
    await _say(tc, clock, 16.7, "Thanks.")        # 68bdcbcf: the screen's courtesy word
    assert not tc.screener_seen, "the precondition of the live failure"
    await _say(tc, clock, 18.3, "Please stay on the line.")
    assert tc._hold_since, "entered the hold"
    machine["on"] = False


@pytest.mark.asyncio
async def test_a_screener_hold_resays_the_opening_to_the_person(clock):
    """68bdcbcf: the person's "Hello." after the screen's hold gets the opening
    from the top — never HOLD_RESUME_CUE ("do NOT introduce yourself")."""
    rec = _Rec()
    said = []

    async def resay(text, force=False, cut_now=False):
        said.append((text, force))
        return True
    tc, machine = _screened_collector(rec, clock, resay)
    await _screen_then_hold(tc, clock, machine)
    rec.clear()
    await _say(tc, clock, 41.4, "Hello.")
    assert tc.on_hold_for() == 0
    assert said == [("Hello.", True)], said
    assert b.HOLD_RESUME_CUE not in rec.cues()
    assert rec.forwarded() == [], "the opening IS the reply to their hello"


@pytest.mark.asyncio
async def test_a_screener_hold_answered_with_a_question_gets_the_first_cue(clock):
    """Their question takes over the opening: the model answers it and
    introduces itself (HOLD_FIRST_CUE). Also the path when the re-say budget
    is spent."""
    rec = _Rec()
    said = []

    async def resay(text, force=False, cut_now=False):
        said.append((text, force))
        return False                               # budget spent / not scripted
    tc, machine = _screened_collector(rec, clock, resay)
    await _screen_then_hold(tc, clock, machine)
    rec.clear()
    await _say(tc, clock, 41.4, "Yes, who is calling?")
    assert rec.cues()[0] == b.HOLD_FIRST_CUE, rec.cues()
    assert b.HOLD_RESUME_CUE not in rec.cues()
    assert rec.forwarded() == ["Yes, who is calling?"]


@pytest.mark.asyncio
async def test_a_hold_after_the_person_answered_past_a_screen_does_not_reintroduce(clock):
    """The screen is history once the person has really answered us: a later
    hold is an ordinary one, and their return gets HOLD_RESUME_CUE — the
    opening replayed mid-call is what the 196838de fix exists to prevent."""
    rec = _Rec()
    said = []

    async def resay(text, force=False, cut_now=False):
        said.append((text, force))
        return True
    tc, machine = _screened_collector(rec, clock, resay)
    await _say(tc, clock, 3.9, SCREEN_PROMPT)
    machine["on"] = False
    await _say(tc, clock, 30.0, "हाँ जी, मैं उसकी मम्मी बोल रही हूँ")
    await _say(tc, clock, 45.0, "आप जिस व्यक्ति से बात कर रहे हैं।")
    assert tc._hold_since
    rec.clear()
    await _say(tc, clock, 70.0, "Hello.")
    assert said == []
    assert rec.cues()[0] == b.HOLD_RESUME_CUE


async def _vad(tc, clock, at, on):
    from pipecat.frames.frames import VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame
    clock.t = 10_000.0 + at
    await tc.process_frame(VADUserStartedSpeakingFrame() if on else VADUserStoppedSpeakingFrame(),
                           b.FrameDirection.UPSTREAM)


def _runs(rec):
    return [f for f in rec.frames if getattr(f, "run_llm", False)]


@pytest.mark.asyncio
async def test_no_noise_reask_into_a_hold_that_began_after_the_voice_stop(clock):
    """22f80a85: "Please stay on the line." stopped the voice (cut reply → the
    noise re-ask armed), its final arrived 50 ms later and started the hold,
    and 1 s on the re-ask ran the model into the hold with the hold line as
    "their turn"."""
    import asyncio
    rec = _Rec()
    tc = _collector(rec)
    tc._resume_on_stop_secs = 1.5
    tc._noise_reask_wait_secs = 0.05
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    tc._outcome.transcript.append({"role": "assistant", "text": "जी, धन्यवाद।"})
    await _say(tc, clock, 21.3, "Thanks.")
    rec.clear()
    await _vad(tc, clock, 22.2, True)
    await _vad(tc, clock, 23.2, False)
    await _say(tc, clock, 23.25, "Please stay on the line.")
    assert tc._hold_since
    await asyncio.sleep(0.2)
    assert _runs(rec) == [], rec.cues()
    assert await tc._answer_never_arrived(b.FrameDirection.DOWNSTREAM, 0.96) is False


@pytest.mark.asyncio
async def test_a_pending_resume_never_plays_into_the_hold(clock):
    """A verbatim resume waiting out its settle when the hold begins is
    cancelled, and none starts while on hold."""
    import asyncio
    rec = _Rec()
    tc = _collector(rec)
    tc._resume_unplayed = lambda n=600: "फीस हर महीने की है।"
    tc._resume_settle_secs = 0.05
    tc.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    assert await tc._resume_cut_words(b.FrameDirection.DOWNSTREAM, "test")
    await _say(tc, clock, 40.0, "आप जिस व्यक्ति से बात कर रहे हैं।")
    assert tc._hold_since
    await asyncio.sleep(0.2)
    try:
        assert not [f for f in rec.frames if isinstance(f, b.TTSSpeakFrame)], rec.frames
        assert await tc._resume_cut_words(b.FrameDirection.DOWNSTREAM, "test") is False
    finally:
        tc._cancel_resume_check()


# RunGuard: the one door every run goes through.

class _Ctx:
    def __init__(self, msgs):
        self.messages = list(msgs)

    def get_messages(self):
        return self.messages

    def set_messages(self, msgs):
        self.messages = list(msgs)


_CONVO = [{"role": "system", "content": "…"},
          {"role": "user", "content": "[NOW deliver your opening…]"},
          {"role": "assistant", "content": "नमस्ते जी, मैं श्रेया बोल रही हूँ।"}]


@pytest.fixture
def guard(monkeypatch):
    import asyncio
    import app.diagnostics as dg
    monkeypatch.setattr(b.FrameProcessor, "process_frame", _noop_super)
    state = {"hold": False}

    def make(**kw):
        d = dg.CallDiagnostics()
        ctx = _Ctx(_CONVO)
        passed = []
        g = b.RunGuard(ctx, enabled=lambda: True, diag=d,
                       on_hold=lambda: state["hold"], **kw)

        async def _push(frame, direction=None):
            passed.append(frame)
        g.push_frame = _push
        g.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
        return g, ctx, passed, d
    make.state = state
    return make


def _texts(ctx):
    return [m.get("content") for m in ctx.messages]


@pytest.mark.asyncio
async def test_run_guard_drops_a_caller_run_on_hold_and_keeps_its_words(guard):
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, passed, d = guard()
    D = b.FrameDirection.DOWNSTREAM
    guard.state["hold"] = True
    ctx.messages.append({"role": "user", "content": "Thanks."})
    await g.process_frame(LLMRunFrame(), D)
    assert passed == [], "a reply would play into the hold"
    assert d.runs_dropped_on_hold == 1
    assert "Thanks." in _texts(ctx), "the words must still be there when they are back"
    # Back: the return line runs on top of them.
    guard.state["hold"] = False
    ctx.messages += [{"role": "user", "content": b.HOLD_RESUME_CUE},
                     {"role": "user", "content": "हाँ जी बताइए"}]
    await g.process_frame(LLMRunFrame(), D)
    assert len(passed) == 1
    assert "Thanks." in _texts(ctx)


@pytest.mark.asyncio
async def test_a_run_dropped_on_hold_can_run_once_the_person_is_back(guard):
    """The context a hold drop left unanswered is not "already run": process_frame
    marked it allowed before the door dropped it, and the same context sent
    again after the hold read "context unchanged" and was blocked."""
    from pipecat.frames.frames import LLMRunFrame
    g, ctx, passed, d = guard()
    D = b.FrameDirection.DOWNSTREAM
    guard.state["hold"] = True
    ctx.messages.append({"role": "user", "content": "Okay."})
    await g.process_frame(LLMRunFrame(), D)
    assert passed == [] and d.runs_dropped_on_hold == 1
    guard.state["hold"] = False
    await g.process_frame(LLMRunFrame(), D)
    assert len(passed) == 1, "the words left from the hold were never answered"


@pytest.mark.asyncio
async def test_a_short_answer_held_across_the_hold_entry_is_dropped(guard):
    """68bdcbcf: the run on the screen's "Thanks." was held for its short-answer
    grace, the hold began inside it, and the release played 6 s into the hold."""
    import asyncio
    from pipecat.frames.frames import LLMRunFrame
    quiet = {"s": 0.0}
    g, ctx, passed, d = guard(short_answer_grace_secs=0.3, short_answer_max_words=3,
                              quiet_for=lambda: quiet["s"])
    ctx.messages.append({"role": "user", "content": "Thanks."})
    await g.process_frame(LLMRunFrame(), b.FrameDirection.DOWNSTREAM)
    assert passed == [] and g.held()
    guard.state["hold"] = True                     # "Please stay on the line."
    quiet["s"] = 5.0
    await asyncio.sleep(0.6)
    assert not g.held()
    assert passed == [], "released into the hold"
    assert d.runs_dropped_on_hold == 1


@pytest.mark.asyncio
async def test_a_parked_cue_released_into_the_hold_is_dropped_and_refunded(guard):
    """d8146538: a next-step cue parked behind the screen's voice 0.25 s before
    the hold began was released 1 s into it — 11.6 s of re-introduction."""
    import asyncio
    from pipecat.frames.frames import LLMRunFrame
    forming = {"on": True}
    refunds = []
    g, ctx, passed, d = guard(caller_forming=lambda: forming["on"])
    cue, = (b.next_step_cue("", "continue")[1],)
    g.register_cue(cue, on_drop=lambda: refunds.append(1))
    ctx.messages += [{"role": "user", "content": "Thanks."},
                     {"role": "user", "content": cue}]
    await g.process_frame(LLMRunFrame(), b.FrameDirection.DOWNSTREAM)
    assert passed == [] and g.held(), "parked behind the forming turn"
    guard.state["hold"] = True
    forming["on"] = False
    await asyncio.sleep(0.8)
    assert passed == [], "released into the hold"
    assert refunds == [1], "a dropped cue is refunded"
    assert cue not in _texts(ctx), "a stale instruction left for the model"
    assert "Thanks." in _texts(ctx)


@pytest.mark.asyncio
async def test_a_cue_arriving_on_hold_is_dropped_at_the_door(guard):
    from pipecat.frames.frames import LLMRunFrame
    refunds = []
    g, ctx, passed, d = guard()
    cue = "[A noise on the line cut your reply off before they heard a single word of it.]"
    g.register_cue(cue, on_drop=lambda: refunds.append(1))
    ctx.messages += [{"role": "user", "content": "Please stay on the line."},
                     {"role": "user", "content": cue}]
    guard.state["hold"] = True
    await g.process_frame(LLMRunFrame(), b.FrameDirection.DOWNSTREAM)
    assert passed == [] and refunds == [1]
    assert cue not in _texts(ctx)


def test_run_bot_wires_the_hold_into_the_run_guard():
    import inspect
    src = inspect.getsource(b.run_bot)
    rg = src[src.index("run_guard = RunGuard("):]
    rg = rg[:rg.index("run_guard._one_door")]
    assert "on_hold=lambda: transcript.on_hold()" in rg


def test_on_hold_is_true_in_the_same_tick_the_hold_began(monkeypatch):
    """on_hold_for() > 0 read False when a run was checked in the same clock
    tick as the hold line (a coarse clock): the run went into the hold."""
    tc = b.TranscriptCollector(_Outcome(), lambda user=True: None,
                               is_bot_speaking=lambda: False)
    monkeypatch.setattr(b.time, "time", lambda: 5000.0)
    tc._hold_since = 5000.0
    assert tc.on_hold()
    tc._hold_since = 0.0
    assert not tc.on_hold()
