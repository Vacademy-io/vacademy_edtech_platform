"""Explicit call state + PURE watchdog decision logic.

Extracted from run_bot's closure-flags (deep-review Wave 2): every production
regression this month was a state-transition bug hiding inside async callbacks,
untestable before a live call. This module makes the state machine a value and
the watchdog a pure function — the timeline test harness drives both with
scripted event sequences and asserts the exact action stream.

Design:
- ``CallState`` is dict-compatible (``state["bot_speaking"]``) so the existing
  frame-processor callbacks keep working unchanged.
- ``watchdog_decide(state, now, cfg)`` is SIDE-EFFECT-FREE and returns a
  ``Decision``; ``apply_decision(state, decision, now)`` performs the state
  bookkeeping; run_bot's watchdog loop performs the I/O per decision kind.
  Branch ORDER mirrors the original loop exactly — order is behavior.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CallState:
    """All per-call watchdog/turn state. Field comments = transition contract."""

    # Idle clock: any activity (user VAD, bot audio, transcripts) refreshes it.
    t: float = 0.0
    # Idle-nudge bookkeeping: `nudged` re-armed ONLY by real transcripts
    # (VAD blips re-arming it made the hangup escalation unreachable — A10).
    nudged: bool = False
    nudge_count: int = 0
    # When the idle timer last decided the CALLER owed the turn (a nudge, or the
    # idle farewell, after a question the bot asked). The silence that line ends
    # is theirs, not dead air (call afa21bf4, 2026-10-14).
    idle_nudge_t: float = 0.0
    # Idle fired while a reply was on its way: times it looked again (≤3).
    idle_rechecks: int = 0
    # True while bot audio is playing / caller is audibly speaking (VAD).
    bot_speaking: bool = False
    user_speaking: bool = False
    # Graceful-stop: set once by _begin_stop; watchdog enforces the deadline and
    # re-issues the (barge-in drainable) EndFrame every ~3s (A7).
    stopping_since: Optional[float] = None
    last_stop_reissue: float = 0.0
    # Last REAL transcribed words (greet gating + orphan discriminator).
    transcript_t: float = 0.0
    # Caller VAD utterance boundaries (orphan discriminator). NOTE: on pipecat
    # 1.4 these are stamped from the aggregator's TURN lifecycle, which can lag
    # the caller's actual voice by SECONDS (a turn closes on strategy fallback,
    # not on VAD stop). Anything that needs acoustic truth uses voice_tick_t.
    user_started_t: float = 0.0
    user_stopped_t: float = 0.0
    # Last time the transport's VAD said voice is live RIGHT NOW (it pushes
    # UserSpeakingFrame every 0.2s while speech is detected). Call 17be14f2:
    # a "हेलो" whose turn stayed open 4.6s pinned the greet gate to its 2.5s
    # ceiling — the acoustic ticks had stopped 4s earlier.
    voice_tick_t: float = 0.0
    # When bot audio last STOPPED (dedupe scope + orphan turn-stealing guard).
    bot_stopped_t: float = 0.0
    bot_started_t: float = 0.0        # when bot audio last STARTED (stale-bridge drop)
    # When the LLM began composing the CURRENT reply. A reply is "in flight"
    # from here until its audio stops, and there is a ~0.5-1.0s window inside
    # that where the bot is not yet audible — call bc84958c fell into exactly
    # that window and delivered its whole pitch twice. 0 = no reply pending.
    reply_started_t: float = 0.0
    # Last SUBSTANTIVE caller utterance (see turntake.suppresses_opening).
    # Distinct from transcript_t, which any word stamps — including the
    # operator's voicemail recording arriving in fragments.
    substantive_t: float = 0.0
    # One-shot guards.
    orphan_used: bool = False
    orphan_asks: int = 0
    # A caller turn the aggregator closed on its 5 s timeout with NO transcript
    # (call b2f6330a: 18 s of the caller talking to a stalled STT, VAD bursts
    # too short for orphan_min_utterance). Stamped at the close; a real
    # transcript supersedes it.
    unheard_turn_t: float = 0.0
    # Consecutive caller utterances that produced NO transcript. Reset by any real
    # transcript. This is the "we cannot hear them" signal — see HEARING_FAILED.
    deaf_streak: int = 0
    bot_spoke_once: bool = False
    # Audio-stall watchdog: stamped when a TTS generation begins while the bot
    # is QUIET; cleared on ANY bot-speaking transition (B1 corrected semantics).
    tts_gen_t: float = 0.0
    stall_recoveries: int = 0
    # A reply was interrupted before base_output announced it. That is NOT yet
    # evidence the caller heard nothing — see unplayed_confirmed().
    unplayed_pending_t: float = 0.0
    # The bot has said its goodbye but the line is NOT yet closing. Held open for
    # end_grace_secs so a caller who re-engages ("Yes, I can") is not hung up on.
    end_pending_since: float = 0.0
    # When a composed reply was cancelled before it played (barge-in). A silence
    # after that is the caller's, not "awaiting playout" of a dead reply.
    reply_cancelled_t: float = 0.0
    # The same, for every cancel EXCEPT RunGuard's supersede: "was the reply to
    # the run let through at t cut since?" (reply_unheard). The supersede's own
    # stamp lands after the newer run has gone through, so read from
    # reply_cancelled_t it made that newer run look cut, and a third piece
    # could not supersede the second (review 2026-10-08: two replies again).
    reply_cut_t: float = 0.0
    # Bot audio is DUCKED (held in DuckGate) because the caller started speaking
    # over a reply. Set at VAD onset; cleared by TurnGate absorb/interrupt or by
    # the watchdog's DUCK_RESUME when the voiced sound produced no words at all.
    # While ducked the idle machinery is paused — the silence is deliberate.
    ducked_since: float = 0.0
    # When a reply was last cancelled. A backchannel arriving within
    # backchannel_carry_secs of this can still be answered with "carry on"
    # rather than the model replying to a bare "haan" from a standing start.
    last_cut_t: float = 0.0
    # The scripted opening's AUDIO, as the caller heard it: when the greet was
    # queued, when its current stretch of bot audio started (0 = not playing)
    # and the seconds played so far in this delivery (reset by a re-say). Its
    # TEXT is no measure: a cached opening is one blob whose text reaches the
    # played transcript only when the blob ENDS (call 1f2b97ab, 2026-10-01).
    greet_queued_t: float = 0.0
    # When the CURRENT delivery of the opening was queued (the greet, then each
    # re-say). A re-say needs a cut AFTER this — not after the first greet.
    opening_queued_t: float = 0.0
    opening_seg_t: float = 0.0
    opening_play_secs: float = 0.0
    # When the current delivery was really queued (opening_queued_t carries a
    # +0.5 s grace for the cut that caused it), and the most of the opening any
    # delivery played — a re-say resets opening_play_secs, but what the person
    # already HEARD stays heard (call 4cb132a2, 2026-10-14).
    opening_delivery_t: float = 0.0
    opening_heard_secs: float = 0.0
    # When RunGuard last told the model the person has not heard who is
    # calling (0 = never). Cleared in effect once a reply after it plays.
    intro_cue_t: float = 0.0
    # reply_started_t of the reply we already covered with a latency bridge
    # ("Just a second.") — one bridge per reply, never a loop of them.
    bridged_reply_t: float = 0.0
    # The person has put the call on hold (TranscriptCollector.on_hold_for, copied
    # in by run_bot's watchdog every tick). Nobody is listening for "please say
    # that again" or "एक सेकंड।" (the replay of 6d81124d said "एक सेकंड।" into the
    # hold), and hold music must not spend the call's two orphan re-asks — so
    # those decisions are never MADE on hold, instead of being made, booked by
    # apply_decision and then skipped (review of 53b6e16b04, 2026-10-14).
    on_hold: bool = False
    # When run_bot last escalated a hold past HOLD_MAX_SECS (nudge / hang-up).
    hold_nudge_t: float = 0.0

    # ── dict-compat so existing callbacks keep working ──
    def __getitem__(self, key: str):
        return getattr(self, key)

    def __setitem__(self, key: str, value) -> None:
        setattr(self, key, value)


@dataclass(frozen=True)
class WatchdogConfig:
    connected_at: float
    cap_secs: float
    idle_timeout_secs: float
    stall_recovery_enabled: bool
    graceful_stop_deadline_secs: float
    stall_after_secs: float = 3.5
    stall_max_recoveries: int = 3
    stop_reissue_every_secs: float = 3.0
    orphan_min_utterance_secs: float = 0.4
    orphan_window_secs: tuple = (2.5, 10.0)
    orphan_bot_quiet_secs: float = 2.0
    orphan_connect_grace_secs: float = 6.0
    max_orphan_asks: int = 2
    # Clock-skew guard for the orphan discriminator. transcript_t is stamped from
    # SARVAM's server-side final; user_started_t from pipecat's LOCAL Silero VAD.
    # For short answers the final routinely lands BEFORE Silero even reports the
    # onset (measured lead up to 1.2s, on 35.2% of utterances), so a strict
    # `user_started_t > transcript_t` reads "heard perfectly" as "swallowed":
    # 23 of 32 live re-asks (72%) apologised for answers we had already received.
    # Only treat a transcript as belonging to an EARLIER utterance if it predates
    # the onset by more than this margin.
    orphan_transcript_lookback_secs: float = 1.5
    max_nudges: int = 2
    # Dead-air escalation: VAD blips (breathing/hold-music) refresh the idle
    # clock, so a noisy dead line never reached the nudge and ran to the
    # duration cap (harness caught this). Independent clock: no REAL words and
    # no bot audio for this long → escalate regardless of VAD activity.
    no_words_timeout_secs: float = 30.0
    # After this many consecutive unheard utterances, stop apologising and close
    # out honestly. 2 = the caller has already repeated themselves twice.
    max_deaf_streak: int = 2
    # How long to wait before believing an interrupted reply truly never played.
    unplayed_confirm_secs: float = 3.0
    # Grace between the farewell finishing and actually closing the line.
    end_grace_secs: float = 2.0
    # Duck (held bot audio) resume rules. no_words: the caller made a sound the
    # VAD heard but STT produced nothing (cough, horn) — resume this long after
    # their sound ended. max_hold: absolute ceiling on a single hold, so a
    # missing transcript can never mute the bot indefinitely.
    duck_no_words_resume_secs: float = 2.0
    duck_max_hold_secs: float = 12.0
    # A reply has been composing this long with no audio → say a short bridge
    # line once. OFF by default (1e9) so the timeline harness is unchanged;
    # run_bot passes the configured value. Call c130e39f (2026-09-09): Vertex
    # took 5.4s to the first token, then streamed a 3-sentence reply over ~8s
    # — 16s of silence, and the caller said "Hello?" three times into it.
    llm_bridge_after_secs: float = 1e9


# Decision kinds — one per watchdog side-effect branch.
NONE = "none"
CANCEL_STARVED = "cancel_starved"
REISSUE_STOP = "reissue_stop"
CAP_FAREWELL = "cap_farewell"
STALL_RECOVER = "stall_recover"
ORPHAN_ASK = "orphan_ask"
NUDGE = "nudge"
IDLE_HANGUP = "idle_hangup"
ARM_STOP = "arm_stop"
HEARING_FAILED = "hearing_failed"
DUCK_RESUME = "duck_resume"
LLM_BRIDGE = "llm_bridge"


@dataclass(frozen=True)
class Decision:
    kind: str
    # Diagnostic payload (logged by the caller).
    detail: float = 0.0


def watchdog_decide(s: CallState, now: float, cfg: WatchdogConfig) -> Decision:
    """Pure decision — mirrors the original watchdog branch order EXACTLY."""
    # 1) Graceful-stop enforcement.
    if s.stopping_since is not None:
        if now - s.stopping_since > cfg.graceful_stop_deadline_secs:
            return Decision(CANCEL_STARVED, now - s.stopping_since)
        if now - s.last_stop_reissue > cfg.stop_reissue_every_secs:
            return Decision(REISSUE_STOP)
        return Decision(NONE)

    # 2) Ducked: the bot's reply is deliberately held while the caller speaks
    #    over it. Pause ALL idle machinery (the silence is ours, not theirs) —
    #    except the duration cap, which is a spend bound and still binds. Resume
    #    when their sound produced no words (TurnGate handles the with-words
    #    paths event-driven), or unconditionally at the hold ceiling.
    if s.ducked_since > 0:
        if now - cfg.connected_at >= cfg.cap_secs:
            return Decision(CAP_FAREWELL, now - cfg.connected_at)
        held = now - s.ducked_since
        if held >= cfg.duck_max_hold_secs:
            return Decision(DUCK_RESUME, held)
        if (not s.user_speaking
                and now - max(s.user_stopped_t, s.ducked_since)
                >= cfg.duck_no_words_resume_secs):
            return Decision(DUCK_RESUME, held)
        return Decision(NONE)

    # 2) Close the line — but only after a grace in which the caller could
    #    re-engage. Live call ee8e2168: the bot said its goodbye, the caller then
    #    said "Yes, I can", the bot asked "May I know a convenient date and time?"
    #    — and the line dropped before they could answer, losing the booking. The
    #    end intent must be REVOCABLE until the line actually closes; on_transcript
    #    clears end_pending_since, so any real word from the caller cancels it.
    if (s.end_pending_since > 0
            and now - s.end_pending_since >= cfg.end_grace_secs
            and not s.bot_speaking and not s.user_speaking):
        return Decision(ARM_STOP, now - s.end_pending_since)

    # 2c) VAD-orphan: caller audibly spoke, no transcript since the utterance
    #    BEGAN (finals land mid-speech, so comparing against utterance START is
    #    the only correct discriminator — the stopped_t variant steamrolled).
    lo, hi = cfg.orphan_window_secs
    # ACOUSTIC stop, not the aggregator's: with no transcript the turn stays
    # open ~5 s (Smart Turn waiting), user_stopped_t is the PREVIOUS turn's,
    # and the ask came 9.4 s after the caller went quiet (timing sim,
    # 2026-09-15). voice_tick_t is when the caller's voice was last live.
    acoustic_stop = (s.voice_tick_t if s.voice_tick_t > s.user_started_t
                     else s.user_stopped_t)
    # BEFORE the speaking gate below: with no transcript the aggregator keeps
    # the turn open (user_speaking) for its 5 s speech timeout, and the ask
    # would wait for that instead of the caller's actual silence. The window's
    # low edge (lo) is measured from the acoustic stop, so a caller who is
    # still talking (fresh voice ticks) can never be talked over.
    if (not s.bot_speaking and not s.on_hold and s.deaf_streak < cfg.max_deaf_streak
            and s.user_started_t > 0 and acoustic_stop > s.user_started_t
            and not s.orphan_used and s.orphan_asks < cfg.max_orphan_asks
            and s.transcript_t < s.user_started_t - cfg.orphan_transcript_lookback_secs
            and (acoustic_stop - s.user_started_t >= cfg.orphan_min_utterance_secs
                 or s.unheard_turn_t > s.transcript_t)
            and lo <= now - acoustic_stop <= hi
            and now - s.bot_stopped_t >= cfg.orphan_bot_quiet_secs
            and now - cfg.connected_at > cfg.orphan_connect_grace_secs):
        return Decision(ORPHAN_ASK, now - acoustic_stop)

    # 3) Hard call-duration cap. (Deliberately BEFORE the speaking check — the
    #    cap is a spend bound and must fire even mid-conversation.)
    if now - cfg.connected_at >= cfg.cap_secs:
        return Decision(CAP_FAREWELL, now - cfg.connected_at)

    # 3) Idle machinery pauses while either side is audibly speaking.
    if s.bot_speaking or s.user_speaking:
        return Decision(NONE)

    # 3b) LLM latency bridge: the reply exists (LLMFullResponseStart stamped
    #     reply_started_t) but nothing has reached the line since. Both sides
    #     are quiet (checked above) and nothing is ducked (returned above).
    #     Once per reply — bridged_reply_t remembers which one.
    st = s.reply_started_t
    if (st > 0 and not s.on_hold and s.bot_stopped_t < st and s.bridged_reply_t != st
            and now - st >= cfg.llm_bridge_after_secs):
        return Decision(LLM_BRIDGE, now - st)

    # 4) Audio-stall recovery (flag-gated; corrected stamp semantics assumed).
    if (cfg.stall_recovery_enabled and s.tts_gen_t > 0
            and now - s.tts_gen_t > cfg.stall_after_secs
            and s.stall_recoveries < cfg.stall_max_recoveries):
        return Decision(STALL_RECOVER, now - s.tts_gen_t)

    # 5) HEARING FAILED. We have already asked them to repeat max_deaf_streak
    #    times and STILL received no words. Live call 393859bc: Sarvam STT went
    #    deaf (4 socket reconnects, one final with 6.08s processing latency) and
    #    NEVER transcribed "hybrid model" — which the caller said FOUR times. The
    #    bot apologised four times, re-asked the same question three times and
    #    restarted its opening three times, because from the model's side the
    #    caller had said nothing at all. Repeating "sorry, I missed that" at
    #    someone who is answering clearly is worse than admitting the problem.
    if s.deaf_streak >= cfg.max_deaf_streak:
        return Decision(HEARING_FAILED, float(s.deaf_streak))

    # 6) Idle nudge → capped escalation to hangup. Two clocks:
    #    - `t` (any activity — pauses while either side audibly speaks);
    #    - dead-air (real words / bot audio only — VAD blips can't refresh it,
    #      or a noisy dead line idles forever; harness: noisy_line test).
    idle_reached = now - s.t >= cfg.idle_timeout_secs
    last_signal = max(s.transcript_t, s.bot_stopped_t, cfg.connected_at)
    dead_air_reached = now - last_signal >= cfg.no_words_timeout_secs
    if not idle_reached and not dead_air_reached:
        return Decision(NONE)
    if not s.nudged and s.nudge_count < cfg.max_nudges:
        return Decision(NUDGE)
    return Decision(IDLE_HANGUP)


def note_reply_cancelled(s: CallState, now: float, superseded: bool = False) -> None:
    """An interruption reached the sentinel: whatever reply was composing is
    gone. A supersede is a cancel too, but not a cut of the run that replaces
    it (see reply_cut_t)."""
    s.reply_cancelled_t = now
    if not superseded:
        s.reply_cut_t = now


def reply_unheard(s: CallState, since: float, in_flight) -> bool:
    """Has the reply to the run let through at `since` made no sound, and is it
    still on its way? RunGuard supersedes only such a reply. Any bot audio
    since `since` (that reply's, a filler's) or audio playing now: the caller
    is hearing us — a barge-in, not a supersede. A reply cut since then needs
    nothing. `in_flight`: a reply is composing, rendering or held (callable or
    bool; read last)."""
    if s.bot_speaking or s.bot_started_t >= since:
        return False
    if s.reply_cut_t >= since:
        return False
    return bool(in_flight() if callable(in_flight) else in_flight)


def opening_coming(s: CallState, greet_queued_t: float, now: float,
                   start_grace_secs: float) -> bool:
    """Will the owed opening actually reach the caller's ears? Its current
    delivery is playing and nothing has cut it, or it was queued less than
    `start_grace_secs` ago, has made no sound yet and nothing has cut it since
    (the same "killed after it was queued" test as run_bot._resay_opening).
    Not "the opening is owed" — call 5e979e3e (2026-10-14): the re-said
    opening was killed 22 ms in, stayed owed for 14.6 s, and RunGuard
    swallowed every turn waiting for it."""
    seg = s.opening_seg_t
    if s.bot_speaking and seg and not s.last_cut_t > seg:
        return True
    queued = s.opening_delivery_t
    return bool(queued
                and s.bot_started_t < queued
                and not s.last_cut_t > max(greet_queued_t, s.opening_queued_t)
                and now - queued < start_grace_secs)


def intro_heard(s: CallState, played_secs: float, intro_secs: float,
                transcript, names) -> bool:
    """Has the person HEARD who is calling? By the opening's audio — the most
    any delivery played (`played_secs` is the current one) reaching
    `intro_secs` — or the agent's name / institute in what played. Never by
    what the context says was queued (calls 9fd6489d, c3818b83, 2026-10-14)."""
    if max(s.opening_heard_secs, played_secs) >= intro_secs:
        return True
    keys = [n.casefold() for n in names or () if len(n or "") >= 3]
    return any(e.get("role") == "assistant"
               and any(k in (e.get("text") or "").casefold() for k in keys)
               for e in transcript or [])


def unplayed_confirmed(s: CallState, now: float, cfg: WatchdogConfig) -> bool:
    """Did an interrupted reply REALLY never reach the caller?

    Do not shortcut this to "an interruption arrived while the bot was quiet".
    That is only "base_output had not yet emitted BotStartedSpeaking for this
    clause", which is a very different claim. pipecat's
    InterruptibleTTSService._handle_interruption tears the TTS socket down only
    `if self._bot_speaking` — false in exactly this window — so Sarvam keeps
    streaming audio it had already synthesised and it PLAYS.

    Measured on 220 live calls: of 63 such "kills", 60 (95%) began playing within
    a median of 0.17s and ran ~1.8s. Counting them as lost made REPLY_UNPLAYED a
    ~95% false positive and turned two of the founder's own calls RED for a
    non-problem. Only silence that OUTLASTS this window is real evidence.
    """
    return (s.unplayed_pending_t > 0
            and not s.bot_speaking
            and now - s.unplayed_pending_t >= cfg.unplayed_confirm_secs)


def stall_recovery_still_needed(s: CallState, now: float,
                                grace_secs: float = 0.5) -> bool:
    """Re-check between the watchdog's DECISION and its (awaited) I/O.

    The decision is computed from a snapshot; tearing down the TTS socket is
    awaited I/O, and on a live call (corr=230e95af) Sarvam's first byte landed
    ~2ms AFTER the decision — the reconnect then destroyed audio that had just
    arrived. So re-check immediately before acting.

    NOTE the trap: ``apply_decision`` has ALREADY zeroed ``tts_gen_t`` for this
    decision, so the stamp is useless as the signal here — testing it would
    abort every recovery and silently disable the feature. Audio that arrived in
    the meantime instead shows up as the bot SPEAKING, or — if it played and
    finished within the tick — as a very recent ``bot_stopped_t``.
    """
    if s.bot_speaking:
        return False
    if s.bot_stopped_t and now - s.bot_stopped_t <= grace_secs:
        return False
    return True


def hold_escalation_due(s: CallState, now: float, held: float, hold_max_secs: float,
                        idle_secs: float) -> bool:
    """On hold past the limit: is the next step of the usual idle escalation due
    (nudge, nudge, goodbye — run_bot's _on_idle owns which)? One step per idle
    period: the bot's own nudge moves bot_stopped_t, the step itself stamps
    hold_nudge_t, so a step can never fire twice for one silence.

    Measured from neither transcript_t nor the caller's VAD on purpose: every
    piece of a looping hold recording stamps both, and that is what kept the
    old idle-based limit from ever firing (review of 53b6e16b04, 2026-10-14)."""
    return (held >= hold_max_secs and not s.bot_speaking and s.stopping_since is None
            and now - max(s.hold_nudge_t, s.bot_stopped_t) >= idle_secs)


def apply_decision(s: CallState, d: Decision, now: float) -> None:
    """State bookkeeping for a decision (I/O stays with the caller)."""
    if d.kind == REISSUE_STOP:
        s.last_stop_reissue = now
    elif d.kind == DUCK_RESUME:
        s.ducked_since = 0.0
        s.t = now
    elif d.kind == ARM_STOP:
        s.end_pending_since = 0.0
    elif d.kind == STALL_RECOVER:
        s.tts_gen_t = 0.0
        s.stall_recoveries += 1
    elif d.kind == LLM_BRIDGE:
        s.bridged_reply_t = s.reply_started_t
    elif d.kind == ORPHAN_ASK:
        s.orphan_asks += 1
        # Twice per call at most; orphan_used stays the hard stop.
        s.orphan_used = s.orphan_asks >= 2
        # The apology is a bot turn: the next tick must not re-fire on the same
        # silence; the window re-arms only after the caller speaks again.
        s.user_stopped_t = 0.0
        s.user_started_t = 0.0
        # Each unheard utterance compounds; a real transcript clears it.
        s.deaf_streak += 1
        s.t = now
    elif d.kind == HEARING_FAILED:
        s.deaf_streak = 0
        s.t = now
    elif d.kind == NUDGE:
        s.nudged = True
        s.nudge_count += 1
        s.t = now
