"""Scripted call-timeline tests over the PURE watchdog (app/callstate.py).

Each test replays a REAL production incident as a timeline of state
transitions + 1s watchdog ticks and asserts the exact decision stream.
No pipecat needed — this is the harness that gates every Wave-2+ change.
"""
from app.callstate import (
    CallState, WatchdogConfig, watchdog_decide, apply_decision,
    stall_recovery_still_needed,
    NONE, CANCEL_STARVED, REISSUE_STOP, CAP_FAREWELL, STALL_RECOVER,
    ORPHAN_ASK, NUDGE, IDLE_HANGUP,
)

T0 = 1000.0


def cfg(**over):
    base = dict(connected_at=T0, cap_secs=600.0, idle_timeout_secs=8.0,
                stall_recovery_enabled=True, graceful_stop_deadline_secs=25.0)
    base.update(over)
    return WatchdogConfig(**base)


def run_ticks(state, c, start, end, step=1.0, events=None):
    """Tick the watchdog over [start,end); apply timed events; return decisions."""
    events = sorted(events or [], key=lambda e: e[0])
    out = []
    t = start
    ei = 0
    while t < end:
        while ei < len(events) and events[ei][0] <= t:
            events[ei][1](state)
            ei += 1
        d = watchdog_decide(state, t, c)
        apply_decision(state, d, t)
        out.append((t, d.kind))
        t += step
    return out


def kinds(decisions):
    return [k for _, k in decisions if k != NONE]


# ── INCIDENT: 2026-07-27 repeat-3x (stall false-fire after multi-clause reply) ─

def test_multi_clause_reply_never_false_stalls():
    """Corrected stamp semantics: clause-2 generation during playout must NOT
    stamp, and BotStopped clears any stamp — so a healthy long reply produces
    zero STALL_RECOVER decisions even with recovery ENABLED."""
    s = CallState(t=T0)
    c = cfg()

    def clause1_gen(st):   # bot quiet → stamps
        if not st.bot_speaking and st.tts_gen_t == 0.0:
            st.tts_gen_t = T0 + 1.0
    def audio_start(st):   # BotStarted → clears (both transitions clear now)
        st.bot_speaking = True
        st.tts_gen_t = 0.0
        st.t = T0 + 1.5
    def clause2_gen(st):   # generated DURING playout → corrected gate refuses
        if not st.bot_speaking and st.tts_gen_t == 0.0:
            st.tts_gen_t = T0 + 2.0
    def audio_stop(st):    # BotStopped → clears unconditionally
        st.bot_speaking = False
        st.tts_gen_t = 0.0
        st.bot_stopped_t = T0 + 8.0
        st.t = T0 + 8.0

    ds = run_ticks(s, c, T0 + 1.0, T0 + 16.0, events=[
        (T0 + 1.0, clause1_gen),
        (T0 + 1.5, audio_start),
        (T0 + 2.0, clause2_gen),
        (T0 + 8.0, audio_stop),
    ])
    assert STALL_RECOVER not in kinds(ds), kinds(ds)


def test_true_stall_recovers_once_then_caps():
    """Reply generated while quiet, audio NEVER starts → exactly one
    STALL_RECOVER >3.5s later per stamp; total capped at 3."""
    s = CallState(t=T0)
    c = cfg()
    s.tts_gen_t = T0 + 1.0          # generation, bot quiet
    ds = run_ticks(s, c, T0 + 2.0, T0 + 8.0)
    assert kinds(ds).count(STALL_RECOVER) == 1
    # stamp cleared by apply; re-stamp twice more → cap at 3 total
    for i in range(4):
        s.tts_gen_t = T0 + 10.0 + i * 10
        ds += run_ticks(s, c, T0 + 11.0 + i * 10, T0 + 19.0 + i * 10)
    assert kinds(ds).count(STALL_RECOVER) == 3   # cap enforced


# ── INCIDENT: "Yeah, I'm Shreyash" swallowed → orphan asks to repeat ─────────

def test_true_swallow_fires_orphan_once():
    s = CallState(t=T0)
    c = cfg()
    s.bot_stopped_t = T0 + 5.0
    # caller speaks 7.0→7.6s, NO transcript ever arrives
    s.user_started_t = T0 + 7.0
    s.user_stopped_t = T0 + 7.6
    ds = run_ticks(s, c, T0 + 8.0, T0 + 14.0)
    assert kinds(ds).count(ORPHAN_ASK) == 1


def test_normal_turn_never_orphans():
    """Regression #1 (steamroll): finals land WHILE the caller speaks; the
    started_t discriminator must yield NONE for every normal utterance."""
    s = CallState(t=T0)
    c = cfg()
    s.bot_stopped_t = T0 + 5.0
    s.user_started_t = T0 + 7.0
    s.transcript_t = T0 + 7.4      # final arrived mid-speech
    s.user_stopped_t = T0 + 7.6
    s.t = T0 + 7.6
    ds = run_ticks(s, c, T0 + 8.0, T0 + 14.0)
    assert ORPHAN_ASK not in kinds(ds)


def test_heard_and_deduped_repeat_never_orphans():
    """Wave-1 A1: a dropped duplicate still stamps transcript_t — the orphan
    must not apologise for words that were heard."""
    s = CallState(t=T0)
    c = cfg()
    s.bot_stopped_t = T0 + 5.0
    s.user_started_t = T0 + 7.0
    s.user_stopped_t = T0 + 7.6
    s.transcript_t = T0 + 7.8      # stamped by the dedupe drop path
    ds = run_ticks(s, c, T0 + 8.0, T0 + 14.0)
    assert ORPHAN_ASK not in kinds(ds)


def test_orphan_never_steals_turn_at_bot_stop():
    """Orphan requires the bot quiet ≥2s — it must not fire the instant the
    bot finishes its own question."""
    s = CallState(t=T0)
    c = cfg()
    s.user_started_t = T0 + 7.0
    s.user_stopped_t = T0 + 7.6
    s.bot_stopped_t = T0 + 9.5     # bot just stopped talking
    ds = run_ticks(s, c, T0 + 10.0, T0 + 11.0)
    assert ORPHAN_ASK not in kinds(ds)


# ── INCIDENT: noisy line nudged for 10 minutes (A10) ─────────────────────────

def test_noisy_line_nudges_capped_then_hangs_up():
    """VAD blips refresh the idle clock's *speaking* pause but no longer
    re-arm `nudged`; after 2 nudges the line hangs up."""
    s = CallState(t=T0)
    c = cfg()
    seen = []
    t = T0 + 1.0
    while t < T0 + 120.0:
        d = watchdog_decide(s, t, c)
        apply_decision(s, d, t)
        if d.kind != NONE:
            seen.append((t, d.kind))
        if d.kind == IDLE_HANGUP:
            break
        # noise blip every 3s: refreshes idle clock ONLY (on_activity), never
        # `nudged` (transcript-gated now)
        if int(t - T0) % 3 == 0:
            s.t = t
        t += 1.0
    ks = [k for _, k in seen]
    assert ks.count(NUDGE) <= 2
    assert ks[-1] == IDLE_HANGUP
    assert seen[-1][0] < T0 + 120.0   # exits long before the duration cap


# ── INCIDENT: barge-in eats the farewell's EndFrame (A7) ─────────────────────

def test_stopping_reissues_end_then_hard_cancels():
    s = CallState(t=T0)
    c = cfg()
    s.stopping_since = T0 + 10.0
    ds = run_ticks(s, c, T0 + 11.0, T0 + 40.0)
    ks = kinds(ds)
    assert REISSUE_STOP in ks                     # keeps replacing drained EndFrames
    assert ks[-1] == CANCEL_STARVED               # deadline still enforced
    # reissues are rate-limited (~3s cadence, not every tick)
    assert ks.count(REISSUE_STOP) <= 10


# ── Duration cap fires even mid-speech (spend bound) ─────────────────────────

def test_cap_fires_even_while_speaking():
    s = CallState(t=T0)
    c = cfg(cap_secs=30.0)
    s.bot_speaking = True
    ds = run_ticks(s, c, T0 + 29.0, T0 + 32.0)
    assert CAP_FAREWELL in kinds(ds)


# ── Stall recovery honours the kill switch ───────────────────────────────────

def test_stall_disabled_never_fires():
    s = CallState(t=T0)
    c = cfg(stall_recovery_enabled=False)
    s.tts_gen_t = T0 + 1.0
    ds = run_ticks(s, c, T0 + 2.0, T0 + 30.0)
    assert STALL_RECOVER not in kinds(ds)


# ═══ 2026-08-03 "Now" wave ════════════════════════════════════════════════════

# ── INCIDENT: 72% of "Sorry, I missed that" re-asks apologised for answers we
#    heard perfectly. transcript_t (Sarvam server final) routinely lands BEFORE
#    user_started_t (local Silero onset) for the SAME short utterance.

def test_transcript_arriving_before_silero_onset_never_reasks():
    """The Kyoto call: 'SSC.' transcribed at 08:17:06.822, Silero onset reported
    later. Strict `user_started_t > transcript_t` called that a swallowed turn."""
    c = cfg()
    s = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0 + 9.6,
                  user_started_t=T0 + 10.0,   # onset lands 0.4s AFTER the final
                  user_stopped_t=T0 + 10.5)
    out = kinds(run_ticks(s, c, T0 + 11.0, T0 + 18.0))
    assert ORPHAN_ASK not in out, f"apologised for an answer we heard: {out}"


def test_genuinely_swallowed_turn_still_reasks():
    """The guard must not blind us to a REAL drop: no transcript for this
    utterance at all (last one is far older than the lookback)."""
    c = cfg()
    s = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0 + 1.0,
                  user_started_t=T0 + 10.0, user_stopped_t=T0 + 10.6)
    out = kinds(run_ticks(s, c, T0 + 11.0, T0 + 18.0))
    assert out.count(ORPHAN_ASK) == 1, f"a real drop must be rescued once: {out}"


def test_lookback_boundary_is_exact():
    """transcript exactly at the lookback edge is treated as belonging to THIS
    utterance (no re-ask); clearly older still re-asks."""
    c = cfg(orphan_transcript_lookback_secs=1.5)
    inside = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0 + 10.0 - 1.4,
                       user_started_t=T0 + 10.0, user_stopped_t=T0 + 10.6)
    assert ORPHAN_ASK not in kinds(run_ticks(inside, c, T0 + 11.0, T0 + 16.0))
    outside = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0 + 10.0 - 1.6,
                        user_started_t=T0 + 10.0, user_stopped_t=T0 + 10.6)
    assert ORPHAN_ASK in kinds(run_ticks(outside, c, T0 + 11.0, T0 + 16.0))


def test_lookback_zero_restores_old_behaviour_killswitch():
    """ORPHAN_TRANSCRIPT_LOOKBACK_SECS=0 must reproduce the pre-fix comparison."""
    c = cfg(orphan_transcript_lookback_secs=0.0)
    s = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0 + 9.6,
                  user_started_t=T0 + 10.0, user_stopped_t=T0 + 10.5)
    assert ORPHAN_ASK in kinds(run_ticks(s, c, T0 + 11.0, T0 + 16.0))


# ── INCIDENT: a reply killed BEFORE playout left tts_gen_t armed, so the
#    watchdog "recovered" a reply the caller deliberately interrupted.

def test_stall_stamp_cleared_on_interrupt_yields_no_recovery():
    c = cfg()
    s = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0)
    s.tts_gen_t = T0 + 1.0          # generation began, bot still quiet
    # SentinelGate's interruption handler disarms the stamp (bot.py wiring).
    events = [(T0 + 2.0, lambda st: setattr(st, "tts_gen_t", 0.0))]
    out = kinds(run_ticks(s, c, T0 + 1.0, T0 + 10.0, events=events))
    assert STALL_RECOVER not in out, f"recovered an interrupted reply: {out}"


def test_stall_still_recovers_when_audio_never_arrives():
    """The Kyoto wedge: generated, never played, nothing interrupts it."""
    c = cfg()
    s = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0)
    s.tts_gen_t = T0 + 1.0
    out = kinds(run_ticks(s, c, T0 + 1.0, T0 + 12.0))
    assert out.count(STALL_RECOVER) >= 1


def test_all_watchdog_thresholds_are_configurable():
    """Item 2: every WatchdogConfig field must be settable (no field reachable
    only via its dataclass default)."""
    import dataclasses
    names = {f.name for f in dataclasses.fields(WatchdogConfig)}
    required = {"connected_at", "cap_secs", "idle_timeout_secs",
                "stall_recovery_enabled", "graceful_stop_deadline_secs"}
    over = {n: 1.0 for n in names - required}
    over["stall_recovery_enabled"] = True
    over["stall_max_recoveries"] = 2
    over["max_nudges"] = 2
    over["orphan_window_secs"] = (2.5, 10.0)
    c = cfg(**over)
    for n in names:
        assert hasattr(c, n)


# ── REGRESSION: the re-check guard must not disable the feature it guards ─────
# apply_decision() zeroes tts_gen_t for STALL_RECOVER, so a guard written as
# `tts_gen_t == 0.0` is ALWAYS true and would abort every recovery — silently
# removing the only cure for the founder's 8-10.4s dead air. Caught pre-ship.

def test_stall_recheck_still_true_after_apply_decision_zeroed_the_stamp():
    s = CallState(t=T0, bot_stopped_t=0.0)
    s.tts_gen_t = T0 + 1.0
    d = watchdog_decide(s, T0 + 5.0, cfg())
    assert d.kind == STALL_RECOVER
    apply_decision(s, d, T0 + 5.0)
    assert s.tts_gen_t == 0.0                      # the trap
    assert stall_recovery_still_needed(s, T0 + 5.0) is True, \
        "guard aborted a genuine stall — recovery would be dead in production"


def test_stall_recheck_aborts_when_audio_arrived():
    # Bot started speaking between decision and I/O.
    s = CallState(t=T0, bot_speaking=True)
    assert stall_recovery_still_needed(s, T0 + 5.0) is False
    # Or it played AND finished inside the tick.
    s2 = CallState(t=T0, bot_speaking=False, bot_stopped_t=T0 + 4.8)
    assert stall_recovery_still_needed(s2, T0 + 5.0) is False
    # An OLD bot_stopped_t must not suppress a real stall.
    s3 = CallState(t=T0, bot_speaking=False, bot_stopped_t=T0 + 1.0)
    assert stall_recovery_still_needed(s3, T0 + 5.0) is True


# ── REPLY_UNPLAYED was ~95% FALSE. This pins the corrected semantics ─────────
# An interruption while the bot is quiet only means base_output had not yet
# announced the clause. pipecat tears the TTS socket down only `if
# self._bot_speaking`, so in that window Sarvam keeps streaming and the audio
# PLAYS: 60 of 63 live "kills" began playing within a median 0.17s. Counting
# them as lost turned two of the founder's calls RED for a non-problem.

def test_interrupted_reply_that_then_plays_is_not_counted_as_lost():
    from app.callstate import unplayed_confirmed
    c = cfg()
    s = CallState(t=T0, unplayed_pending_t=T0)
    # Audio arrives 0.17s later (the measured median) -> suspicion cleared.
    s.unplayed_pending_t = 0.0
    s.bot_speaking = True
    assert unplayed_confirmed(s, T0 + 5.0, c) is False


def test_reply_that_never_plays_is_confirmed_lost():
    from app.callstate import unplayed_confirmed
    c = cfg(unplayed_confirm_secs=3.0)
    s = CallState(t=T0, unplayed_pending_t=T0)
    assert unplayed_confirmed(s, T0 + 2.9, c) is False, "too early to call it lost"
    assert unplayed_confirmed(s, T0 + 3.1, c) is True


def test_unplayed_never_confirmed_while_bot_is_speaking():
    from app.callstate import unplayed_confirmed
    s = CallState(t=T0, unplayed_pending_t=T0, bot_speaking=True)
    assert unplayed_confirmed(s, T0 + 10.0, cfg()) is False


def test_unplayed_never_confirmed_when_unarmed():
    from app.callstate import unplayed_confirmed
    assert unplayed_confirmed(CallState(t=T0), T0 + 10.0, cfg()) is False


# ── INCIDENT 2026-08-03 (call 393859bc): Sarvam STT went deaf ────────────────
# The caller said "hybrid model" FOUR times. Sarvam transcribed it ZERO times
# (one final in a 50s window; first final of the call had 6.08s latency; 4 socket
# reconnects). The bot apologised 4x, re-asked the same question 3x and restarted
# its opening 3x, because from the model's side the caller had said nothing.

def test_repeated_unheard_utterances_stop_the_apology_loop():
    from app.callstate import HEARING_FAILED
    c = cfg(max_deaf_streak=2, orphan_connect_grace_secs=0.0)
    s = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0)
    out = []
    t = T0 + 5.0
    for _ in range(4):                      # four unheard utterances in a row
        s.user_started_t = t
        s.user_stopped_t = t + 0.8
        s.orphan_used = False
        out += kinds(run_ticks(s, c, t + 3.5, t + 6.0))
        t += 8.0
    assert HEARING_FAILED in out, f"never gave up apologising: {out}"
    # …and it stops asking once it has: no orphan re-ask after the give-up.
    assert out.index(HEARING_FAILED) <= 2, f"apologised too many times first: {out}"


def test_a_heard_answer_resets_the_deaf_streak():
    """One good transcript proves the line works — the counter must not creep
    toward a false give-up across a long healthy call."""
    from app.callstate import HEARING_FAILED
    c = cfg(max_deaf_streak=2)
    s = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0)
    s.deaf_streak = 1
    s.deaf_streak = 0                        # on_transcript() does exactly this
    assert HEARING_FAILED not in kinds(run_ticks(s, c, T0, T0 + 10.0))


def test_hearing_failed_never_fires_on_a_healthy_call():
    from app.callstate import HEARING_FAILED
    s = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0)
    assert HEARING_FAILED not in kinds(run_ticks(s, cfg(), T0, T0 + 30.0))


# ── INCIDENT 2026-08-03 (call ee8e2168): we hung up on a booking ─────────────
# Caller said "No, not yet" -> bot began its goodbye -> caller RE-ENGAGED with
# "Yes, I can" -> bot asked "May I know a convenient date and time?" -> the line
# dropped before they could answer. The end intent was call-scoped, so every
# later BotStoppedSpeaking re-armed the stop (two "stopping call" log lines).

def test_farewell_closes_the_line_after_the_grace():
    from app.callstate import ARM_STOP
    c = cfg(end_grace_secs=2.0)
    s = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0)
    s.end_pending_since = T0
    early = kinds(run_ticks(s, c, T0, T0 + 1.9))
    assert ARM_STOP not in early, "closed before the caller had a chance to speak"
    out = kinds(run_ticks(s, c, T0, T0 + 6.0))
    assert out.count(ARM_STOP) == 1, f"must close exactly once: {out}"


def test_caller_re_engaging_after_the_farewell_cancels_the_close():
    """THE booking-losing case. on_transcript clears end_pending_since."""
    from app.callstate import ARM_STOP
    c = cfg(end_grace_secs=2.0)
    s = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0)
    s.end_pending_since = T0
    events = [(T0 + 1.0, lambda st: setattr(st, "end_pending_since", 0.0))]
    out = kinds(run_ticks(s, c, T0, T0 + 8.0, events=events))
    assert ARM_STOP not in out, f"hung up on a caller who re-engaged: {out}"


def test_close_waits_until_both_sides_are_quiet():
    from app.callstate import ARM_STOP
    c = cfg(end_grace_secs=2.0)
    speaking = CallState(t=T0, bot_speaking=True)
    speaking.end_pending_since = T0
    assert ARM_STOP not in kinds(run_ticks(speaking, c, T0, T0 + 6.0))
    listening = CallState(t=T0, user_speaking=True)
    listening.end_pending_since = T0
    assert ARM_STOP not in kinds(run_ticks(listening, c, T0, T0 + 6.0))


def test_no_close_when_no_farewell_happened():
    from app.callstate import ARM_STOP
    s = CallState(t=T0, bot_stopped_t=T0, transcript_t=T0)
    assert ARM_STOP not in kinds(run_ticks(s, cfg(), T0, T0 + 20.0))


# ── call c130e39f (2026-09-09): Vertex 5.4s to first token, then ~8s to finish a
#    3-sentence reply — 16s of dead air, "Hello?" x3 from the caller ─────────────
from app.callstate import LLM_BRIDGE


def test_llm_bridge_fires_once_per_slow_reply_and_only_when_late():
    s = CallState(t=T0)
    c = cfg(llm_bridge_after_secs=2.0)
    s.reply_started_t = T0 + 1.0            # LLMFullResponseStart, no audio yet
    out = run_ticks(s, c, T0 + 1.0, T0 + 8.0, step=0.5)
    fired = [t for t, k in out if k == LLM_BRIDGE]
    assert fired == [T0 + 3.0], fired       # exactly once, exactly at +2.0s
    # The next reply gets its own bridge.
    s.bot_stopped_t = T0 + 9.0
    s.reply_started_t = T0 + 10.0
    out = run_ticks(s, c, T0 + 10.0, T0 + 14.0, step=0.5)
    assert [t for t, k in out if k == LLM_BRIDGE] == [T0 + 12.0]


def test_llm_bridge_stays_quiet_when_audio_played_speaking_or_ducked():
    c = cfg(llm_bridge_after_secs=2.0)
    # Reply already reached the line: bot_stopped_t after reply_started_t.
    s = CallState(t=T0); s.reply_started_t = T0 + 1.0; s.bot_stopped_t = T0 + 2.0
    assert LLM_BRIDGE not in kinds(run_ticks(s, c, T0 + 1.0, T0 + 8.0))
    # Bot audibly speaking (the reply is playing).
    s = CallState(t=T0); s.reply_started_t = T0 + 1.0; s.bot_speaking = True
    assert LLM_BRIDGE not in kinds(run_ticks(s, c, T0 + 1.0, T0 + 8.0))
    # Caller speaking / ducked: the silence is theirs or deliberate.
    s = CallState(t=T0); s.reply_started_t = T0 + 1.0; s.user_speaking = True
    assert LLM_BRIDGE not in kinds(run_ticks(s, c, T0 + 1.0, T0 + 8.0))
    s = CallState(t=T0); s.reply_started_t = T0 + 1.0; s.ducked_since = T0 + 1.5
    assert LLM_BRIDGE not in kinds(run_ticks(s, c, T0 + 1.0, T0 + 3.4))


def test_llm_bridge_is_off_unless_configured():
    s = CallState(t=T0); s.reply_started_t = T0 + 1.0
    assert LLM_BRIDGE not in kinds(run_ticks(s, cfg(), T0 + 1.0, T0 + 8.0))
