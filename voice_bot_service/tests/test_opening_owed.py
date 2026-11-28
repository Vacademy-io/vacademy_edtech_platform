"""An owed opening must never mute the call, and the person must always hear
who is calling (2026-10-14).

Live shapes, re-told with synthetic lines:
  * 4cb132a2 — both re-says spent, the third delivery cut; the caller's two
    "no"s were swallowed by RunGuard as "the opening is the reply" while
    nothing was going to say it. 3.5 s of silence, hang-up.
  * 5e979e3e / 662d1c80 — the re-said opening was killed 22 ms in; it stayed
    "owed" and every turn was swallowed (14.6 s of silence).
  * a11e6709 — a voicemail prompt cut the opening; four hellos met 18 s of
    silence, then a reply with no introduction.
  * 9fd6489d — the callee spoke first, the opening was skipped, the prompt
    still said "it has been said", and the pickup "Hello." was dropped as a
    machine-greeting scrap.
  * c3818b83 — the greet and a model run raced, both were dropped, and the
    context still held the opening as said.
"""
import asyncio
import time

import pytest

import app.bot as b
import app.diagnostics as dg
import app.callstate as cs
from app.callstate import CallState

D = b.FrameDirection.DOWNSTREAM

AGENT, INSTITUTE = "Asha", "Test Academy"
OPENING = ("नमस्ते जी, मैं Asha बोल रही हूँ Test Academy से। आपने अपने बच्चे के लिए classes "
           "की inquiry की थी, उसी के बारे में दो मिनट बात करनी थी। क्या मैं जान सकती हूँ "
           "कि मैं किससे बात कर रही हूँ?")


async def _noop_super(self, frame, direction):
    return None


class _Ctx:
    def __init__(self, messages):
        self.messages = list(messages)

    def get_messages(self):
        return self.messages

    def set_messages(self, messages):
        self.messages = list(messages)


def _guard(ctx, pending, coming, intro_cue=None, forming=None, voice=None, **kw):
    from pipecat.frames.frames import LLMContextFrame  # noqa: F401  (pipecat import side effects)
    d = dg.CallDiagnostics()
    seen = []

    async def _push(frame, direction=None):
        seen.append(type(frame).__name__)
    g = b.RunGuard(ctx, enabled=lambda: True, diag=d,
                   opening_pending=lambda: pending["v"],
                   opening_coming=lambda: coming["v"],
                   intro_cue=intro_cue,
                   caller_forming=(lambda: forming["v"]) if forming else None,
                   voice_live=(lambda: voice["v"]) if voice else None, **kw)
    g.push_frame = _push
    g.create_task = lambda coro: asyncio.get_event_loop().create_task(coro)
    b.FrameProcessor.process_frame = _noop_super
    return g, seen, d


def _opening_ctx(*caller):
    return _Ctx([{"role": "system", "content": "x"},
                 {"role": "assistant", "content": OPENING}]
                + [{"role": "user", "content": t} for t in caller])


# ── B2: RunGuard swallows only while the opening will actually play ─────────

@pytest.mark.asyncio
async def test_owed_opening_that_nothing_will_say_does_not_swallow_the_turn():
    """4cb132a2 / a11e6709: owed (cut before half played, inside the machine
    window) but not playing and not queued — the turn must reach the model."""
    from pipecat.frames.frames import LLMContextFrame
    ctx = _opening_ctx("नहीं।")
    g, seen, d = _guard(ctx, {"v": True}, {"v": False})
    await g.process_frame(LLMContextFrame(ctx), D)
    assert seen == ["LLMContextFrame"], "the caller's turn was swallowed for an opening nobody says"
    assert d.opening_unsaid_runs == 1
    assert d.turns_swallowed_for_opening == 0


@pytest.mark.asyncio
async def test_a_turn_held_for_the_opening_runs_once_the_opening_is_killed():
    """5e979e3e: the re-say was on its way when the turn arrived, then a stale
    timer killed it 22 ms in. The held turn must run, not vanish."""
    from pipecat.frames.frames import LLMContextFrame
    ctx = _opening_ctx("Hello.")
    pending, coming = {"v": True}, {"v": True}
    g, seen, d = _guard(ctx, pending, coming)
    await g.process_frame(LLMContextFrame(ctx), D)
    await asyncio.sleep(0.25)
    assert seen == [], "ran over an opening that is playing"
    assert d.runs_held_for_opening == 1
    coming["v"] = False                              # killed; still owed
    await asyncio.sleep(1.4)                         # 1.0 s of "not coming" + a poll
    assert seen == ["LLMContextFrame"], "the held turn never ran after the opening died"
    assert d.opening_unsaid_runs == 1 and d.turns_swallowed_for_opening == 0


@pytest.mark.asyncio
async def test_a_killed_opening_releases_the_held_turn_only_after_the_callers_next_piece():
    """Replay of 662d1c80: what killed the opening was the caller talking;
    released into their forming turn, it made two runs for one moment."""
    from pipecat.frames.frames import LLMContextFrame
    ctx = _opening_ctx("ठीक है जी।")
    pending, coming, forming = {"v": True}, {"v": True}, {"v": False}
    g, seen, d = _guard(ctx, pending, coming, forming=forming)
    await g.process_frame(LLMContextFrame(ctx), D)
    await asyncio.sleep(0.15)
    forming["v"] = True                              # their next piece is forming
    coming["v"] = False                              # …and it cut the opening
    await asyncio.sleep(0.8)
    assert seen == [], "ran beside the caller's forming turn"
    forming["v"] = False                             # it never arrived as a run
    await asyncio.sleep(1.4)
    assert seen == ["LLMContextFrame"], "the held turn was lost"


@pytest.mark.asyncio
async def test_a_turn_over_an_opening_that_then_plays_is_swallowed_and_counted():
    """The 4243a436 behaviour is kept where it is right: the opening played
    over the pickup "Hello." — it was the reply. Counted for the report."""
    from pipecat.frames.frames import LLMContextFrame
    ctx = _opening_ctx("Hello.")
    pending, coming = {"v": True}, {"v": True}
    g, seen, d = _guard(ctx, pending, coming)
    await g.process_frame(LLMContextFrame(ctx), D)
    await asyncio.sleep(0.25)
    pending["v"] = False                             # half of it has played
    await asyncio.sleep(0.3)
    assert seen == []
    assert d.turns_swallowed_for_opening == 1


def test_swallowed_turns_reach_the_health_payload():
    """Before 2026-10-14 the swallow lock scored GREEN (4cb132a2, 5e979e3e):
    the counts must at least be visible to the report."""
    d = dg.CallDiagnostics()
    d.bump("turns_swallowed_for_opening")
    d.bump("opening_unsaid_runs", 2)
    d.bump("intro_cues")
    tt = dg.to_payload(d)["turnTaking"]
    assert tt["turnsSwallowedForOpening"] == 1
    assert tt["openingUnsaidRuns"] == 2
    assert tt["introCues"] == 1


@pytest.mark.asyncio
async def test_a_re_say_queued_right_after_the_cut_keeps_the_turn_waiting():
    """The cut that stops a delivery queues its re-say a moment later: one
    poll of "not coming" must not release the turn over the re-said opening."""
    from pipecat.frames.frames import LLMContextFrame
    ctx = _opening_ctx("Hello.")
    pending, coming = {"v": True}, {"v": True}
    g, seen, d = _guard(ctx, pending, coming)
    await g.process_frame(LLMContextFrame(ctx), D)
    await asyncio.sleep(0.15)
    coming["v"] = False
    await asyncio.sleep(0.12)
    coming["v"] = True                               # the re-say is queued
    await asyncio.sleep(0.5)
    assert seen == [], "released over the re-said opening"
    g._drop_held("test over")


# ── B3: the introduction follows what the person HEARD ──────────────────────

@pytest.mark.asyncio
async def test_intro_note_goes_before_the_callers_words_and_keeps_retriggers_blocked():
    from pipecat.frames.frames import LLMContextFrame
    cue = b.intro_cue_text(AGENT, INSTITUTE)
    ctx = _opening_ctx("अभी थोड़ा काम में हूँ।", "Hello.")
    g, seen, d = _guard(ctx, {"v": False}, {"v": False}, intro_cue=lambda: cue)
    await g.process_frame(LLMContextFrame(ctx), D)
    assert seen == ["LLMContextFrame"]
    msgs = ctx.messages
    assert msgs[-1]["content"] == "Hello.", "the run's last user message must stay the caller's"
    assert msgs[2]["content"] == cue, [m["content"][:20] for m in msgs]
    assert d.intro_cues == 1
    await g.process_frame(LLMContextFrame(ctx), D)   # the same context again
    assert seen == ["LLMContextFrame"], "a stale retrigger ran once the note was added"


@pytest.mark.asyncio
async def test_a_second_note_replaces_the_first_instead_of_stacking():
    from pipecat.frames.frames import LLMContextFrame
    cue = b.intro_cue_text(AGENT, INSTITUTE)
    ctx = _opening_ctx("Hello.")
    g, seen, _ = _guard(ctx, {"v": False}, {"v": False}, intro_cue=lambda: cue)
    await g.process_frame(LLMContextFrame(ctx), D)
    ctx.messages.append({"role": "user", "content": "हाँ बोलिए।"})   # superseding piece
    await g.process_frame(LLMContextFrame(ctx), D)
    assert [m["content"] for m in ctx.messages].count(cue) == 1


def test_intro_note_names_the_agent_from_context_never_a_fixed_institute():
    t = b.intro_cue_text(AGENT, INSTITUTE)
    assert AGENT in t and INSTITUTE in t and "Shiksha" not in t
    assert t.startswith("[") and t.endswith("]")
    assert "Shiksha" not in b.intro_cue_text("Ravi", "")
    assert "calling from Other School" in b.intro_cue_text("", "Other School")


def test_intro_secs_is_where_the_name_ends_not_the_whole_opening():
    from app.turntake import opening_expected_secs
    secs = b.opening_intro_secs(OPENING, [AGENT, INSTITUTE])
    assert 2.0 < secs < 4.5, secs
    assert secs < opening_expected_secs(OPENING) / 2
    assert b.opening_intro_secs("Hello!", [AGENT, INSTITUTE]) == 0.0
    assert b.opening_intro_secs(OPENING, ["", ""]) == 0.0


def test_intro_heard_by_audio_of_any_delivery_or_by_what_played():
    s = CallState()
    intro = b.opening_intro_secs(OPENING, [AGENT, INSTITUTE])
    names = [AGENT, INSTITUTE]
    assert not cs.intro_heard(s, 0.0, intro, [], names)                 # skipped / raced
    assert not cs.intro_heard(s, intro - 0.5, intro, [], names)         # cut before the name
    assert cs.intro_heard(s, intro + 0.1, intro, [], names)
    s.opening_heard_secs = 6.1                                       # an earlier delivery
    assert cs.intro_heard(s, 0.2, intro, [], names), "a re-say must not un-hear the name"
    s.opening_heard_secs = 0.0
    played = [{"role": "assistant", "text": "जी, मैं Asha, Test Academy से बोल रही हूँ।"}]
    assert cs.intro_heard(s, 0.0, intro, played, names)
    assert not cs.intro_heard(s, 0.0, intro, [{"role": "user", "text": "Asha"}], names)


def test_opening_coming_only_while_playing_uncut_or_freshly_queued():
    now = 1000.0
    s = CallState()
    s.opening_delivery_t = now - 0.3                                 # queued, silent, uncut
    assert cs.opening_coming(s, now - 5.0, now, 1.5)
    assert not cs.opening_coming(s, now - 5.0, now + 1.4 + 0.3, 1.5), "never started"
    s.last_cut_t = now - 0.1                                         # killed before it played
    assert not cs.opening_coming(s, now - 5.0, now, 1.5)
    # playing, then the stale voice-cut timer kills it 22 ms in (5e979e3e)
    s = CallState(bot_speaking=True, opening_seg_t=now - 0.05, bot_started_t=now - 0.05,
                  opening_delivery_t=now - 0.1, opening_queued_t=now + 0.4)
    assert cs.opening_coming(s, now - 5.0, now, 1.5)
    s.last_cut_t = now - 0.03
    assert not cs.opening_coming(s, now - 5.0, now, 1.5)
    s.bot_speaking, s.opening_seg_t = False, 0.0                     # the transport stopped
    assert not cs.opening_coming(s, now - 5.0, now, 1.5)


def test_resay_keeps_what_was_heard_and_stamps_the_new_delivery():
    import inspect
    src = inspect.getsource(b.run_bot)
    resay = src[src.index("_opening_resays += 1"):src.index("await task.queue_frames([TTSSpeakFrame(_opening_for_cache")]
    assert resay.index('flags["opening_heard_secs"] = max(') < resay.index('flags["opening_play_secs"] = 0.0')
    assert 'flags["opening_delivery_t"] = time.time()' in resay
    greet = src[src.index('flags["greet_queued_t"] = _greet_queued_t'):][:200]
    assert 'flags["opening_delivery_t"] = _greet_queued_t' in greet
    assert "opening_coming=_opening_coming" in src and "intro_cue=_intro_cue" in src


def test_already_spoken_rule_yields_to_the_not_heard_note():
    p = b.build_system_prompt({"instituteName": INSTITUTE, "agent": {
        "name": AGENT, "systemPrompt": "Bot: hi. " * 80, "direction": "OUTBOUND",
        "openingLine": OPENING}})
    assert "ALREADY SPOKEN — do not repeat" in p
    assert "has NOT heard who you are" in p


# ── B3: a pickup "Hello." after the greet skipped the opening is the person ──

def _pre_speech(rec, greet_skipped):
    d = dg.CallDiagnostics()
    tc = b.TranscriptCollector(
        _Outcome(), lambda user=True: None,
        is_bot_speaking=lambda: False, fillers_armed=lambda: False,
        bot_stopped_t=lambda: 0.0, gate_enabled=lambda: True,
        interrupt_on_vad=lambda: True, filler_phrases=[],
        in_machine_window=lambda: True, reply_in_flight=lambda: False,
        bot_spoke_once=lambda: False, diag=d, greet_skipped=lambda: greet_skipped)

    async def _push(frame, direction=None):
        rec.append(frame)

    async def _broadcast():
        return None
    tc.push_frame = _push
    tc.broadcast_interruption = _broadcast
    return tc, d


class _Outcome:
    def __init__(self):
        self.corr = "test"
        self.transcript = []
        self.transfer_requested = False
        self.end_requested = False
        self.transfer_registered = False
        self.context = {}


async def _feed(tc, text):
    from pipecat.frames.frames import TranscriptionFrame
    b.FrameProcessor.process_frame = _noop_super
    await tc.process_frame(TranscriptionFrame(text=text, user_id="u", timestamp="t"), D)


@pytest.mark.asyncio
async def test_pickup_hello_after_a_skipped_opening_is_not_a_machine_scrap():
    from pipecat.frames.frames import TranscriptionFrame
    rec = []
    tc, d = _pre_speech(rec, greet_skipped=True)
    await _feed(tc, "Hello.")
    assert d.carrier_announcements == 0, "the person's hello was dropped as a recording scrap"
    assert any(isinstance(f, TranscriptionFrame) for f in rec), rec


@pytest.mark.asyncio
async def test_scraps_before_we_spoke_are_still_dropped_otherwise():
    rec = []
    tc, d = _pre_speech(rec, greet_skipped=False)
    await _feed(tc, "Hello.")
    assert d.carrier_announcements == 1
    rec2 = []
    tc2, d2 = _pre_speech(rec2, greet_skipped=True)
    await _feed(tc2, "Your call.")                   # not a line-check: still a scrap
    assert d2.carrier_announcements == 1


# ── review 2026-10-14: the pieces together ─────────────────────────────────

@pytest.mark.asyncio
async def test_a_turn_let_go_after_the_opening_waits_for_the_callers_voice():
    """The opening stopped unheard because the caller is talking, and their
    words are not in the aggregator yet (the STT final lags the voice). A run
    sent then is cut by their own final: 3-4 runs for one moment and "जी सर।"
    cut twice in the twice-over-the-opening probe. Wait for the voice."""
    from pipecat.frames.frames import LLMContextFrame
    ctx = _opening_ctx("जी।")
    pending, coming, voice = {"v": True}, {"v": True}, {"v": False}
    g, seen, d = _guard(ctx, pending, coming, voice=voice)
    await g.process_frame(LLMContextFrame(ctx), D)
    await asyncio.sleep(0.15)
    voice["v"] = True                                # they talk over it…
    coming["v"] = False                              # …and that cut it
    await asyncio.sleep(1.8)
    assert seen == [], "ran while the caller was still talking"
    voice["v"] = False
    await asyncio.sleep(1.3)
    assert seen == ["LLMContextFrame"], "the turn was lost once they stopped"


@pytest.mark.asyncio
async def test_a_newer_turn_over_the_re_said_opening_cancels_the_run_let_go_before_it():
    """Probe of the opening fix (review 2026-10-14): T1 was let go when the
    opening stopped unheard and waited for the caller's voice; the opening was
    then re-said and the caller's next turn arrived over it. T1 must not run
    the model over the re-said opening, and T2 must be the one waiting on it."""
    from pipecat.frames.frames import LLMContextFrame
    ctx = _opening_ctx("जी।")
    pending, coming, voice = {"v": True}, {"v": True}, {"v": False}
    g, seen, d = _guard(ctx, pending, coming, voice=voice)
    await g.process_frame(LLMContextFrame(ctx), D)
    await asyncio.sleep(0.15)
    voice["v"], coming["v"] = True, False            # cut by their voice
    await asyncio.sleep(0.6)                         # T1 let go, waiting on the voice
    coming["v"] = True                               # the opening is re-said
    ctx.messages.append({"role": "user", "content": "हाँ जी।"})
    await g.process_frame(LLMContextFrame(ctx), D)   # T2 over the re-said opening
    voice["v"] = False
    await asyncio.sleep(1.5)
    assert seen == [], "a run went to the model over the re-said opening"
    pending["v"] = False                             # the opening played
    await asyncio.sleep(0.3)
    assert seen == [] and d.turns_swallowed_for_opening == 1


@pytest.mark.asyncio
async def test_a_turn_let_go_returns_to_waiting_when_the_opening_is_re_said():
    """Same moment without a newer turn: the re-say lands while T1 waits for
    the caller's voice. At release the opening is on its way again — it is
    the reply, not a model run over it."""
    from pipecat.frames.frames import LLMContextFrame
    ctx = _opening_ctx("जी।")
    pending, coming, voice = {"v": True}, {"v": True}, {"v": False}
    g, seen, d = _guard(ctx, pending, coming, voice=voice)
    await g.process_frame(LLMContextFrame(ctx), D)
    await asyncio.sleep(0.15)
    voice["v"], coming["v"] = True, False
    await asyncio.sleep(0.6)
    coming["v"] = True                               # re-said while it waited
    voice["v"] = False
    await asyncio.sleep(1.5)
    assert seen == [], "ran the model over the re-said opening"
    pending["v"] = False
    await asyncio.sleep(0.3)
    assert d.turns_swallowed_for_opening == 1


@pytest.mark.asyncio
async def test_a_turn_left_to_an_opening_that_never_played_is_caller_ignored():
    """CALLER_IGNORED is fed by what PLAYED: a turn left to the opening with no
    bot audio after it is the caller talking into silence (the 2026-10-14
    lock that scored GREEN). The fault's counter is swallowed_turns."""
    from pipecat.frames.frames import LLMContextFrame
    ctx = _opening_ctx("Hello.")
    pending, coming = {"v": True}, {"v": True}
    g, seen, d = _guard(ctx, pending, coming, audible_since=lambda t: False)
    g._SWALLOW_AUDIT_SECS = 0.6
    await g.process_frame(LLMContextFrame(ctx), D)
    await asyncio.sleep(0.25)
    pending["v"] = False
    await asyncio.sleep(1.0)
    assert d.turns_swallowed_for_opening == 1
    assert d.swallowed_turns == 1
    assert dg.verdict(d)["faults"].get(dg.CALLER_IGNORED) == dg.AMBER


@pytest.mark.asyncio
async def test_a_turn_the_opening_played_over_is_not_caller_ignored():
    """Control: the ordinary pickup "Hello." the opening answers never counts."""
    from pipecat.frames.frames import LLMContextFrame
    ctx = _opening_ctx("Hello.")
    pending, coming = {"v": True}, {"v": True}
    g, seen, d = _guard(ctx, pending, coming, audible_since=lambda t: True)
    g._SWALLOW_AUDIT_SECS = 0.6
    await g.process_frame(LLMContextFrame(ctx), D)
    await asyncio.sleep(0.25)
    pending["v"] = False
    await asyncio.sleep(1.0)
    assert d.turns_swallowed_for_opening == 1 and d.swallowed_turns == 0


def test_run_bot_wires_played_audio_and_the_early_skip_into_the_intro_note():
    """run_bot gives RunGuard the played-audio check, and _intro_cue covers a
    callee who spoke first before the greet's 0.1 s poll saw it (review
    2026-10-14: that first run went out with no introduction)."""
    import inspect
    src = inspect.getsource(b.run_bot)
    rg = src[src.index("run_guard = RunGuard("):]
    rg = rg[:rg.index("run_guard._one_door")]
    assert "audible_since=" in rg
    cue = src[src.index("def _intro_cue()"):src.index("async def _resay_opening(")]
    assert '_greet_connect_t' in cue and 'flags["substantive_t"] > _greet_connect_t + 0.05' in cue


@pytest.mark.asyncio
async def test_a_turn_let_go_never_answers_a_voicemail_recording():
    """36ac8abe replayed (review 2026-10-14): a recording piece ("Available.")
    cut the opening, its run was let go and waited for the "caller's" voice —
    the recorder's — and by then the call was known to be a voicemail. The
    16 s reply went into the recorder. No run once the line is a voicemail."""
    from pipecat.frames.frames import LLMContextFrame
    ctx = _opening_ctx("Available.")
    pending, coming, voice, vm = {"v": True}, {"v": True}, {"v": False}, {"v": False}
    g, seen, d = _guard(ctx, pending, coming, voice=voice, is_voicemail=lambda: vm["v"])
    await g.process_frame(LLMContextFrame(ctx), D)
    await asyncio.sleep(0.15)
    voice["v"], coming["v"] = True, False            # the recording talks on
    await asyncio.sleep(0.6)
    vm["v"] = True                                   # "…record your message."
    voice["v"] = False
    await asyncio.sleep(1.3)
    assert seen == [], "answered the voicemail recording"


@pytest.mark.asyncio
@pytest.mark.parametrize("gap", [0.15, 0.35, 0.5])
async def test_a_short_gap_inside_a_playing_opening_keeps_the_pickup_held(gap):
    """Final review 2026-10-14: a sentence-boundary gap of 0.25 s+ inside an
    opening that is still playing (nothing cut it) released a held pickup ack to
    the model, whose reply then talked past the opening's own question."""
    from pipecat.frames.frames import LLMContextFrame
    s = CallState()
    now = time.time()
    s.opening_delivery_t = now - 2.0
    s.opening_seg_t = now - 1.9
    s.bot_started_t = now - 1.9
    s.bot_speaking = True
    coming = lambda: cs.opening_coming(s, now - 2.0, time.time(), 1.5)
    pending = {"v": True}
    ctx = _opening_ctx("हाँ जी।")
    g, seen, _d = _guard(ctx, pending, {"v": True})
    g._opening_coming = coming
    await g.process_frame(LLMContextFrame(ctx), D)
    await asyncio.sleep(0.2)
    s.bot_speaking = False
    s.opening_seg_t = 0.0            # sentence boundary, nothing cut
    await asyncio.sleep(gap)
    s.bot_speaking = True
    s.opening_seg_t = time.time()
    s.bot_started_t = time.time()
    await asyncio.sleep(0.5)
    pending["v"] = False             # the opening reached half: heard
    await asyncio.sleep(0.3)
    assert seen == [], f"pickup ack sent to the model during a {gap}s gap in a playing opening"
