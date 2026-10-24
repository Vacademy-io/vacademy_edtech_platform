"""Per-call technical diagnostics — collection, and a PURE health verdict.

Why this exists: diagnosing three founder-flagged calls in 2026-07 took a
forensic sweep of ~140k log lines across 220 calls on the box. Every signal that
investigation needed was already known to this process at call time; it was just
never carried anywhere. This module carries it, so the next "the agent took ages
and I had to repeat myself" is a hover in the admin UI, not an SSH session.

Design mirrors app/callstate.py deliberately:
  * a plain dataclass of counters (no pipecat imports, no I/O),
  * PURE functions (``verdict``) the scripted harness can drive,
  * a TOTAL ``to_payload()`` that can never raise into the report path.

Cost discipline: this runs on a 1-vCPU box carrying live calls. Everything here
is per-TURN or per-EVENT — never per audio frame — and every reservoir is
bounded, so a 10-minute call cannot produce megabytes.

Honesty discipline: a signal we could not measure is ``None``, NEVER 0. Reading
"0 answers deleted" when we actually went blind is how a fleet chart says "fixed"
about something that isn't; that mistake is exactly what this module exists to
prevent. ``src`` marks whether a fault is MEASURED or INFERRED.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import difflib
from typing import Any, Dict, List, NamedTuple, Optional

# Bump when a threshold or a fault definition changes. Stored with every call so
# health can be re-derived across history without re-collecting anything.
# v3 (2026-08-12): a lost sub-floor scrap ("वो।") is no longer an ANSWER_DELETED
# — see _lost_carries_meaning.
# v4 (2026-08-14): the caller's own response time no longer counts as DEAD_AIR.
# A gap measured when the CALLER starts speaking, with the bot having spoken last
# ("both_quiet"), is the caller thinking — it is now tagged "caller_thinking" in
# `silences` and kept out of the dead_air reservoir. It was 46.3% of dead-air
# events and 45 of the RED-bar gaps over the 7 days to 2026-08-14. See
# bot.set_user_speaking. Compare DEAD_AIR rates across the v3/v4 boundary with care.
# v5 (2026-08-14): greetings/address terms and bare function words are no longer
# ANSWER_DELETED. "Hello." x15 and "Hi." x10 were 23% of all reported losses over
# the 7 days to 2026-08-14, and the fault fired on 60% of current-build calls while
# ~76% of its payload was social tokens or abandoned fragments. Consent and refusal
# are explicitly still counted — see _lost_carries_meaning. Compare ANSWER_DELETED
# rates across the v4/v5 boundary with care.
# v6 (2026-10-02): LIKELY_MACHINE no longer fires on a machine marker that a
# person then answered past (person_turns, see machine_score) — a call screener
# followed by a real conversation (calls b5b43ae1, 34452119). Compare
# LIKELY_MACHINE rates across the v5/v6 boundary with care.
# v7 (2026-10-14): four labels that misled on the 2026-10-14 sweep. ANSWER_DELETED
# no longer counts the hold recording the gate absorbed on purpose (22f80a85,
# d8146538, 68bdcbcf) nor a stutter whose two halves reached the model in
# separate messages (4a594125); HANDBACK_LOOP counts only handback lines the
# caller heard, not internal next-step requests (4a594125); DEAD_AIR no longer
# charges the bot for the idle wait on a caller who did not answer its question
# (afa21bf4, d8146538: "dead air 8.0s" at every nudge) nor for the quiet of a
# hold (68bdcbcf); OPENING_REPLAYED no longer counts the bot's own deliberate
# re-says (opening_resaid: cut at pickup, or re-said to the person a screener
# handed over). New fault CALLER_IGNORED. Compare all five across the v6/v7
# boundary with care.
RULES_VERSION = 7

# ── fault codes: CLOSED, APPEND-ONLY ─────────────────────────────────────────
# Renaming one silently breaks every row already stored. test_diagnostics.py
# pins this set; adding is fine, renaming/removing fails CI.
CRASH = "CRASH"
TTS_WEDGE = "TTS_WEDGE"
REPLY_UNPLAYED = "REPLY_UNPLAYED"
ANSWER_DELETED = "ANSWER_DELETED"
DEAD_AIR = "DEAD_AIR"
FALSE_REASK = "FALSE_REASK"
LIKELY_MACHINE = "LIKELY_MACHINE"
STT_DEAF = "STT_DEAF"
SLOW_TTS = "SLOW_TTS"
SLOW_LLM = "SLOW_LLM"
TRANSFER_FAILED = "TRANSFER_FAILED"
PROMPT_UNFILLED = "PROMPT_UNFILLED"
# The caller spoke but the bot produced NO audio at all. Added 2026-08-05 after
# the pipecat 1.4 migration shipped a mute bot: RumikTTSService.run_tts kept the
# 0.0.95 signature, 1.4 called it with (text, context_id), and every reply died
# as an ErrorFrame pipecat only logged. The call was scored RED for
# LIKELY_MACHINE while the REAL story — "we never said a word" — appeared
# nowhere in the panel. A whole class of outage was invisible; now it is not.
BOT_SILENT = "BOT_SILENT"
# The bot kept re-delivering a reply it had just been cut off on. Added
# 2026-08-06 from call 77cb4b47, where the founder heard the first second of the
# SAME question four times in eleven seconds and told the bot so on the line
# ("आपकी आवाज़ कट हो रही है बार-बार"). Every existing panel read fine: TTS TTFB
# 0.18s, LLM 0.46s, no stalls, "every caller answer reached the agent". The one
# thing that was actually broken — that the caller heard the same sentence over
# and over and never heard the end of it — had no counter at all.
REPLY_LOOP = "REPLY_LOOP"
# The bot answered the caller with a content-free "you talk" line because the
# no-repeat gate had suppressed its whole reply. Added 2026-08-13 from call
# 3148ccd4: 20 sentences suppressed, 7 handbacks, and the ONE question the caller
# never answered ("Raman abhi kaun si class mein hai?") blocked on all six
# attempts to ask it again. The caller spent the last forty-five seconds asking
# "मैं क्या बताऊँ?" — what am I supposed to tell you — and hung up. Every existing
# panel signal was about something else: ANSWER_DELETED named a one-word
# fragment, DEAD_AIR named the symptom, LIKELY_MACHINE was simply wrong. The
# thing that actually broke the call had no counter at all.
HANDBACK_LOOP = "HANDBACK_LOOP"
# 2026-09-15, six founder-found defects in one day that the counters above did
# not name. Both computed from the PLAYED transcript at report time — what the
# caller actually heard, the same invariants sim.replay checks offline.
# The opening was said again after the person had already spoken (call
# 196838de: a screener flag left armed; the father's "Hello?" 2 min in
# replayed the whole opening and he hung up).
OPENING_REPLAYED = "OPENING_REPLAYED"
# A sentence of five or more words was played twice and the caller had not
# asked for it (calls f28888b2, af7e93bd: heard lines un-recorded and said
# again; 71e8f39b: the same restatement five times).
REPEATED_LINE = "REPEATED_LINE"
# The caller spoke and the bot swallowed their turn, waiting for an opening that
# nothing was going to say (2026-10-14: 5e979e3e, 662d1c80, 4cb132a2, a11e6709 —
# 14-18 s of silence while the person kept saying hello, and three of the four
# scored GREEN because no counter here saw it).
CALLER_IGNORED = "CALLER_IGNORED"

ALL_FAULTS = (
    CRASH, TTS_WEDGE, REPLY_UNPLAYED, ANSWER_DELETED, DEAD_AIR, FALSE_REASK,
    LIKELY_MACHINE, STT_DEAF, SLOW_TTS, SLOW_LLM, TRANSFER_FAILED, PROMPT_UNFILLED,
    BOT_SILENT, REPLY_LOOP, HANDBACK_LOOP, OPENING_REPLAYED, REPEATED_LINE,
    CALLER_IGNORED,
)

# Headline = the first FIRED fault in this order, so UI copy is deterministic.
# Ordered by what the CALLER experienced, not by internal severity. Being unable
# to hear them outranks a TTS stall: on live call 393859bc the headline read
# "Voice synthesis stalled" while the actual story was that the caller repeated
# "hybrid model" four times and we never once transcribed it.
# HANDBACK_LOOP outranks ANSWER_DELETED and DEAD_AIR deliberately: on call
# 3148ccd4 all three fired, and the other two describe consequences of it.
# CALLER_IGNORED sits with BOT_SILENT and STT_DEAF: the caller talked and got
# nothing back, which is the whole story of those calls.
HEADLINE_PRIORITY = (
    CRASH, BOT_SILENT, STT_DEAF, CALLER_IGNORED, REPLY_LOOP, OPENING_REPLAYED, HANDBACK_LOOP,
    REPEATED_LINE,
    TTS_WEDGE, REPLY_UNPLAYED, ANSWER_DELETED, DEAD_AIR, FALSE_REASK, LIKELY_MACHINE,
    SLOW_TTS, SLOW_LLM, TRANSFER_FAILED, PROMPT_UNFILLED,
)

GREEN, AMBER, RED = "GREEN", "AMBER", "RED"
_RANK = {GREEN: 0, AMBER: 1, RED: 2}

_MAX_SAMPLES = 200          # bounded reservoirs
_MAX_UNFILLED_KEYS = 12
_MAX_DELETED_ANSWERS = 20
# Scraps are evidence, not the story — a handful is enough to recognise the shape
# ("all one-syllable") and the blob has a 4 KB budget to keep.
_MAX_LOST_FRAGMENTS = 5


def _hit_rate(hits, misses):
    """Fraction of sentences served from cache. None when not measured, and None
    (not 0.0) when nothing was attempted — a rate over zero attempts is not a
    zero rate, it is no reading at all."""
    if hits is None or misses is None:
        return None
    total = hits + misses
    if total <= 0:
        return None
    return round(hits / total, 4)


def _p(values: List[float], pct: float) -> Optional[float]:
    """Nearest-rank percentile; None for an empty sample."""
    if not values:
        return None
    xs = sorted(values)
    k = max(0, min(len(xs) - 1, int(round((pct / 100.0) * len(xs) + 0.5)) - 1))
    return round(xs[k], 3)


@dataclass
class CallDiagnostics:
    """Per-call counters. Mutated by cheap hooks; never read by call logic."""

    # ── TTS health (the founder's 8-10.4s dead-air root cause) ──
    tts_letterless_skipped: int = 0     # our fix firing = the wedge TRIGGER blocked
    tts_wedges: int = 0                 # Sarvam rejected input; socket open-but-dead
    tts_wedge_reconnects: int = 0       # forced rebuilds of a wedged socket
    tts_stalls: int = 0                 # STALL_RECOVER decisions
    tts_stall_cap_hit: bool = False     # gave up: permanently silent from here
    tts_silent_generations: int = 0     # generated, no audio ever followed
    # A paused TTS ended an utterance with zero audio and was resumed so the
    # reply behind it could play (providers._silent_context_resume; call
    # c6847f91, 2026-10-14: a silent bridge line held the reply ~16 s).
    tts_silent_resumes: int = 0

    # ── playout truth ──
    replies_generated: int = 0
    replies_never_played: int = 0

    # ── turn-taking ──
    orphan_reasks: int = 0
    orphan_false_reasks: int = 0        # a real final landed right after: we heard it
    nudges: int = 0
    idle_hangup: bool = False
    cap_farewell: bool = False
    barge_ins: int = 0
    # Cancels actually put on the wire, against barge-ins seen. The first Rumik
    # implementation never sent one (the base class tore the socket down first) and
    # nothing revealed it — so the count is the signal that the primary reason for
    # choosing this vendor is really happening.
    barge_in_cancels: int = 0
    # None = NOT MEASURED (never 0-by-default — see module docstring).
    answers_deleted: Optional[int] = None
    answers_deleted_samples: List[str] = field(default_factory=list)
    # Caller finals lost the same way but too small to have carried an answer
    # ("वो।" — see _lost_carries_meaning). Reported, because they ARE a measured
    # loss, but deliberately NOT a fault: evidence-only, like LIKELY_MACHINE.
    # There is no measured count at which these mean something, and inventing a
    # threshold would just replace one false fault with another.
    fragments_lost: Optional[int] = None
    fragments_lost_samples: List[str] = field(default_factory=list)
    # Ducking (instant barge-in hold). ducks = holds begun; absorbs = holds that
    # turned out to be backchannels and resumed mid-sentence; timeout_resumes =
    # voiced-but-wordless holds the watchdog released.
    ducks: int = 0
    duck_absorbs: int = 0
    duck_timeout_resumes: int = 0
    # Operator recordings ("forwarded to voicemail") filtered out of the LLM
    # context. NOTE the name must match bump()'s argument EXACTLY — bump() is
    # getattr/setattr with a bare except, so a typo silently counts nothing.
    carrier_announcements: int = 0
    # The person put the call on hold: holds entered, pieces of the network's hold
    # recording kept out of the model, and returns from hold (call 6d81124d).
    holds: int = 0
    hold_lines: int = 0
    hold_returns: int = 0
    # Runs (replies, cues, re-asks) dropped at RunGuard's door while on hold —
    # each one would have played into the hold (calls 68bdcbcf, d8146538).
    runs_dropped_on_hold: int = 0
    # Sentences dropped because the bot had already said them this call.
    repeats_suppressed: int = 0
    # Replies that were ENTIRELY suppressed, so the caller got "Ji, boliye." —
    # "you talk" — instead of an answer. Untracked until call 3148ccd4, where
    # seven of these in ninety seconds made the call unrecoverable while the
    # panel reported ANSWER_DELETED and DEAD_AIR. The suppression counter above
    # could not tell that story: it counts sentences, and what matters is TURNS
    # the caller could not answer.
    handbacks: int = 0
    empty_replies: int = 0        # genuinely empty model answers re-asked for the next line
    # The gate suppressed the whole reply and asked the model for a fresh line
    # (all-repeat / answer-question / restatement). Nothing was said to the
    # caller, so not a handback — HANDBACK_LOOP counted these until call
    # 4a594125 (2026-10-14) headlined "kept asking the caller to talk" over two
    # of them with no handback line ever spoken.
    next_step_requests: int = 0
    forming_holds: int = 0        # runs held because the caller's turn was still forming
    forming_hold_cap_releases: int = 0   # …released by the cap, not by the turn (expect ~0)
    retired_runs_dropped: int = 0  # requests a failed LLM primary dropped (the fallback answered)
    cue_runs_dropped: int = 0      # the bot's own runs dropped at the door (a reply was on its way)
    # A caller's next piece arrived before the earlier run's reply made a sound:
    # that run was cancelled and the newer one answers the whole turn, once.
    runs_superseded: int = 0
    short_answer_forming_waits: int = 0  # a held short answer waited for the rest of the turn
    # <<SEND:…>>s fired by a reply that was then superseded (they still go —
    # the marker follows the caller's agreement; counted to watch the rate).
    sends_from_superseded_reply: int = 0
    # Times we said a repeat anyway rather than hand back twice running. Healthy
    # in ones; a run of them means the model is stuck on a line it cannot get past.
    repeat_escalations: int = 0
    # Turns where the caller got nothing answerable — including replies the MODEL
    # wrote itself ("जी, बोलिए।"). It learns those from our own handbacks, which
    # land in its context because aggregators.assistant() sits downstream of the
    # gate that emits them.
    content_free_turns: int = 0
    # Sentences un-recorded from the no-repeat memory because they were emitted
    # but never PLAYED before an interruption (call 4b1a44b9: a cancelled
    # never-heard question was then blocked as "already-said" on its real
    # delivery). A few per call is the fix working; not a fault.
    unsaid_reverted: int = 0
    # LLM generations blocked because nothing new had been said (a stale turn
    # closing on a silence fallback re-triggered inference with the context
    # unchanged — call 17be14f2). Each one is a reply-to-nothing that used to
    # re-deliver the intro. Evidence, not a fault.
    empty_runs_blocked: int = 0
    # Runs held because the scripted opening had not been heard yet and the
    # caller's words did not take over (room chatter at pickup, call 4243a436).
    runs_held_for_opening: int = 0
    # Of those, caller turns that got NO model reply because the opening played
    # over them (it was the reply). Before 2026-10-14 every held run ended this
    # way even when nothing ever said the opening — calls 4cb132a2, a11e6709,
    # 5e979e3e: 3.5-18 s of silence on calls that scored GREEN.
    turns_swallowed_for_opening: int = 0
    # Caller runs let through although the opening was still owed, because
    # nothing was going to say it (spent re-says, a killed re-say, a voicemail
    # prompt over it) — each was a silent swallow before 2026-10-14.
    opening_unsaid_runs: int = 0
    # Runs that carried "the person has not heard who you are" to the model.
    intro_cues: int = 0
    # Caller turns left to the opening (turns_swallowed_for_opening) after which
    # NOTHING of ours played for 5 s — the caller talked into silence. Checked
    # against played audio by RunGuard._check_swallowed, so the ordinary
    # pickup "हाँ जी" the opening answers never counts. Drives CALLER_IGNORED.
    swallowed_turns: int = 0
    # Short-answer holds released because the line never went quiet (noise).
    short_answer_noise_releases: int = 0
    # Voice-mode barge-in: acknowledgements the bot talked straight through, and
    # stops made because the caller kept talking past barge_in_voice_secs.
    acks_talked_through: int = 0
    # FloorGate: replies held because the caller was talking when they were
    # ready; then dropped (caller took the turn), released (caller stopped) or
    # capped (the line never went quiet).
    # "<name>" copied from the prompt's script lines, replaced before the TTS.
    placeholders_filled: int = 0
    # "करतो/करते"-style either-or pairs reduced to one form before the TTS.
    alternatives_collapsed: int = 0
    # Replies whose later sentences had to be committed to the model's history
    # after their response ended (per-sentence TTS contexts).
    late_reply_commits: int = 0
    floor_holds: int = 0
    floor_holds_dropped: int = 0
    # Shadow mode (2026-10-01): the caller's gender from voice pitch and from
    # their own words — measured and reported, not yet used. app/caller_gender.py
    caller_gender: dict = field(default_factory=dict)
    floor_holds_released: int = 0
    floor_holds_capped: int = 0
    voice_cuts: int = 0
    # Short-answer runs ("Yes." + a breath) dropped because the caller's voice
    # resumed inside the grace — the whole turn was answered once instead
    # (bot.RunGuard, 2026-09-15). The fix working, not a fault.
    short_answer_holds: int = 0
    # Resumed words that had to be sent to the TTS twice because the first
    # frame was swallowed by the vendor socket reconnecting after the
    # interruption (call 3b5fb592). Evidence, not a fault.
    resume_respoken: int = 0
    # Resumed words that never reached the line at all and were handed back to
    # the model (call b41b481f). A fault symptom, not a fault by itself.
    resume_lost: int = 0
    sentences_capped: int = 0
    # From the PLAYED transcript at report time (report._played_invariants):
    # the opening said again after a substantive caller turn; 5+-word
    # sentences played twice without a caller "hello?"/"say again" between.
    opening_replays: int = 0
    repeated_lines: int = 0
    repeated_line_samples: List[str] = field(default_factory=list)
    # Opening clauses dropped because they only parroted the caller's own answer
    # back at them ("ओके, सुबोध अभी आठवीं क्लास में है, तो …"). A high count is the
    # model reaching for the restatement on every turn despite the prompt rule —
    # which is the whole reason the trim lives in code.
    echoes_trimmed: int = 0
    # (seconds, what the bot was doing) for every silence over 2.5s. Travels with
    # the REPORT, which survives the container restarts that keep destroying the
    # logs before a dead-air call can be diagnosed.
    silences: List[Any] = field(default_factory=list)
    # Consecutive times the bot re-delivered a reply it had just been cut off
    # on. 1-2 is normal recovery; a run of them is the restart loop that made
    # call 77cb4b47 unlistenable.
    reply_restarts: int = 0
    max_reply_restarts: int = 0

    # ── caller/agent shape (feeds the machine heuristic) ──
    user_turns: int = 0
    bot_turns: int = 0
    first_user_secs: Optional[float] = None
    longest_user_secs: float = 0.0
    machine_markers: List[str] = field(default_factory=list)
    # Times a person answered the bot after the machine greeting (report.
    # _person_turns). None = not measured, and then the markers count as before.
    person_turns: Optional[int] = None

    # ── latency reservoirs ──
    llm_ttfb: List[float] = field(default_factory=list)
    tts_ttfb: List[float] = field(default_factory=list)
    stt_ttfb: List[float] = field(default_factory=list)
    dead_air: List[float] = field(default_factory=list)

    # ── vendor spend: the vendor's OWN meter, not our arithmetic ──
    # tts_vendor_credits stays None unless a terminal frame actually carried a
    # figure. Rumik currently reports credits_used: 0 on our key, and 0 is
    # indistinguishable from unmetered — so we count the metered requests
    # separately. "12 requests metered, 0 credits" reads as a broken meter;
    # a bare 0 would read as a free call, which is a lie we would then bill on.
    tts_vendor: str = ""
    tts_vendor_credits: Optional[float] = None
    # "provider/model" the call's replies came from (bot.run_bot). Exists so a
    # per-agent LLM POC (config.sarvam_llm_agents) is visible in the report and
    # a latency comparison can be made per vendor instead of by memory.
    llm_vendor: str = ""
    tts_meter_frames: int = 0
    tts_audio_secs: float = 0.0
    tts_chars: int = 0

    # ── speech cache ──
    # None = the cache was OFF or unreadable, i.e. NOT MEASURED. It must never
    # render as 0: "0 hits" is a claim that we looked and found nothing, and a
    # fleet chart that cannot tell those apart will report a broken cache as a
    # working one with nothing to serve. Both counters arm together on the first
    # observation, so "hits 0, misses 12" is a real, honest reading.
    tts_cache_hits: Optional[int] = None
    tts_cache_misses: Optional[int] = None
    tts_cache_chars_saved: int = 0
    tts_cache_secs_saved: float = 0.0

    # ── infrastructure ──
    stt_reconnects: int = 0
    # The STT waterfall took over mid-call (STT_FALLBACK_PROVIDER): primary
    # failed audibly (no transcript for a heard utterance) or on its socket.
    stt_failovers: int = 0
    # The STT vendor's socket stopped finishing sends (providers.decoupled_stt_io)
    # — call 3e327e8a's "Credits exhausted" close that held the TCP open.
    stt_stalls: int = 0
    stt_vendor_final: str = ""
    llm_failovers: int = 0
    llm_returns: int = 0          # turns handed back to the primary after a failover
    llm_vendor_final: str = ""
    # Token usage summed over the call's LLM runs, from pipecat's usage
    # metrics. cached = prompt tokens the vendor served from its prompt cache
    # (Gemini implicit caching bills them at ~10%; Sarvam reports none) — the
    # only per-call answer to "is caching lowering the LLM bill?".
    llm_runs: int = 0
    llm_prompt_tokens: int = 0
    llm_cached_tokens: int = 0
    llm_completion_tokens: int = 0
    hearing_failures: int = 0     # times we gave up and closed out honestly
    # Caller utterances DETECTED by VAD that produced no transcript at all. This
    # is the only signal that separates "nobody answered" from "we went deaf".
    unheard_utterances: int = 0
    greet_path: str = ""                # "scripted" | "callee_spoke_first" | "llm"
    greet_delay_secs: Optional[float] = None
    setup_secs: Optional[float] = None
    # The caller talked over the scripted opening and heard only part of it. The
    # full opening is pre-appended to the model's context before it is spoken, so
    # without a correction the model believes it delivered the whole introduction
    # and skips ahead — see bot._greet_when_ready. Counted, not scored: it is a
    # normal thing for a caller to do, and the correction handles it.
    opening_truncated: int = 0
    # The caller's pickup "hello" cut the opening at its start and the opening
    # was spoken again (call 9e566e32, 2026-09-09). At most 1 per call.
    opening_resaid: int = 0
    # "Just a second." spoken because a reply was composing with no audio for
    # LLM_BRIDGE_AFTER_SECS (call c130e39f, 2026-09-09). One per slow reply.
    llm_bridges: int = 0
    prompt_unfilled: List[str] = field(default_factory=list)
    crash: Optional[str] = None
    transfer_requested: bool = False
    transfer_registered: bool = False

    # ── cheap, total hooks (never raise into call logic) ──
    def bump(self, name: str, by: int = 1) -> None:
        try:
            setattr(self, name, getattr(self, name) + by)
        except Exception:
            pass

    def note_silence(self, secs: float, cause: str) -> None:
        if len(self.silences) < 20:
            self.silences.append({"secs": secs, "cause": cause})

    def sample(self, name: str, value: float) -> None:
        try:
            buf: List[float] = getattr(self, name)
            if len(buf) < _MAX_SAMPLES:
                buf.append(float(value))
        except Exception:
            pass

    def note_tts_spend(self, credits, audio_secs, chars=0) -> None:
        """Terminal-frame hook. TOTAL: a metering bug must not touch the call."""
        try:
            self.tts_meter_frames += 1
            if credits:
                self.tts_vendor_credits = (self.tts_vendor_credits or 0.0) + float(credits)
            self.tts_audio_secs += float(audio_secs or 0.0)
            self.tts_chars += int(chars or 0)
        except Exception:
            pass

    def _arm_cache_counters(self) -> None:
        if self.tts_cache_hits is None:
            self.tts_cache_hits = 0
            self.tts_cache_misses = 0

    def note_tts_cache_hit(self, duration_ms: int, chars: int) -> None:
        """A sentence served from cache: the vendor was never called."""
        try:
            self._arm_cache_counters()
            self.tts_cache_hits += 1
            self.tts_cache_chars_saved += int(chars or 0)
            self.tts_cache_secs_saved += float(duration_ms or 0) / 1000.0
        except Exception:
            pass

    def note_tts_cache_miss(self, chars: int) -> None:
        try:
            self._arm_cache_counters()
            self.tts_cache_misses += 1
        except Exception:
            pass

    def note_unfilled(self, key: str) -> None:
        try:
            if key not in self.prompt_unfilled and len(self.prompt_unfilled) < _MAX_UNFILLED_KEYS:
                self.prompt_unfilled.append(str(key)[:40])
        except Exception:
            pass

    def note_deleted_answer(self, text: str) -> None:
        try:
            if self.answers_deleted is None:
                self.answers_deleted = 0
            self.answers_deleted += 1
            if len(self.answers_deleted_samples) < _MAX_DELETED_ANSWERS:
                self.answers_deleted_samples.append(str(text)[:60])
        except Exception:
            pass


def _norm_answer(text: str) -> str:
    """Loose key for matching a caller final against what the model received.
    Case/punctuation/whitespace-insensitive so 'SSC.' == 'ssc'."""
    return "".join(ch for ch in (text or "").casefold() if ch.isalnum())


# Containment matching below this many normalized chars is off: a tiny key like
# "हा" ("हाँ।" after stripping marks) is a substring of half the transcript and
# would mark genuinely-deleted acks as delivered. 4, not 5: normalization drops
# Devanagari combining vowels, so a real two-word fragment like "नहीं जान।"
# shrinks to just 4 consonant chars ("नहजन").
_CONTAIN_MIN_CHARS = 4

# ── what a LOST final actually cost the call ─────────────────────────────────
# Every unmatched final used to be reported as a "discarded caller answer". That
# over-claims at the short end, and the founder caught it on a live call
# (2026-08-12): the panel went AMBER on ONE lost final whose verbatim text was
# "वो।" — one syllable, no answer in it, dropped when the reply it landed on top
# of was cancelled. Reported to a human as "1 answer never reached the agent",
# which sent them looking for a lost answer that was never spoken.
#
# It is STRUCTURAL, not bad luck. _norm_answer keeps only alphanumerics and
# Devanagari combining vowels are not alphanumeric, so "वो।" normalizes to the
# single char "व" — below _CONTAIN_MIN_CHARS, which turns pass 2 off. Below that
# floor a final can never be matched, so the guard that exists to prevent a false
# MATCH had become a guaranteed false FAULT: any sub-floor scrap the aggregator
# dropped was certain to be counted as a deleted answer.
#
# What must still count, and does: a lost "हाँ" or "नहीं" is consent or refusal
# and changes the call — "absorb but never lose" exists for exactly that — and so
# does anything with a digit in it ("94"). So the carve-out is the narrowest
# thing that fixes the observed case: a SINGLE word, no digit, not consent, not
# refusal, and under the containment floor.
_CONSENT_OR_REFUSAL = frozenset({
    # affirmation
    "हाँ", "हां", "हा", "जी", "हाँजी", "हांजी", "सही", "बिल्कुल", "बिलकुल", "ओके",
    "haan", "haa", "han", "ha", "hn", "ji", "jee", "jii", "sahi", "bilkul",
    "ok", "okay", "okey", "kk", "yes", "yeah", "yah", "ya", "yup", "yep",
    "right", "correct", "sure",
    # refusal — an objection lost mid-pitch is the expensive one
    "नहीं", "नही", "ना", "मत", "नो", "nahi", "nahin", "nhi", "na", "no", "not",
    "mat", "stop", "never",
})
_FRAG_STRIP = "।॥.,!…\"'`~()[]{}:;-–—"

# ONE alphanumeric char after normalization — a single syllable, nothing more.
#
# _CONTAIN_MIN_CHARS (4) is emphatically NOT the number to reuse here, and the
# existing multiset test caught it: "SSC." normalizes to 3 and is a real answer.
# So do "DPS" (3), "आठवीं" (3 — Devanagari vowel signs are dropped) and "पाँच"
# (2). Everything genuine clears 2; the scraps that made this fault lie do not
# ("वो" 1, "तो" 1, "ब" 1). The floor is set at the observed case and no wider.
_SCRAP_MAX_CHARS = 1

# Greetings, address terms and bare discourse fillers. Losing one of these costs
# NOTHING: the model is not waiting on "Hello." and no decision turns on "Sir."
#
# Measured over the 109 utterances ANSWER_DELETED flagged in the 7 days to
# 2026-08-14: 'Hello.' x15 and 'Hi.' x10 alone were 23% of every reported loss,
# and the fault was firing on 60% of calls on the current build while ~76% of
# what it reported was this plus abandoned fragments (below). The panel headline
# reads "Caller answers were discarded before the agent saw them" — for a caller
# who said hello twice.
#
# DELIBERATELY NOT HERE: consent and refusal. "haan"/"yes"/"nahi"/"no" live in
# _CONSENT_OR_REFUSAL and stay meaningful, because a lost yes or a lost no is the
# expensive case — the bot keeps pitching at someone who already declined. That
# check runs BEFORE this one.
_SOCIAL_TOKENS = frozenset({
    "hello", "helo", "hallo", "hlo", "hi", "hey", "namaste", "namaskar",
    "sir", "madam", "mam", "maam", "bhaiya", "bhai", "ji",
    "welcome", "thanks", "thank", "thankyou", "sorry", "bye", "goodbye",
    "hmm", "hm", "mm", "mhm", "uh", "um", "ah", "oh", "aah", "ohh",
    "हेलो", "हैलो", "हलो", "नमस्ते", "नमस्कार", "सर", "मैम", "मैडम", "भैया",
    "धन्यवाद", "शुक्रिया", "माफ", "हम्म", "हम", "अरे", "ओह", "आँ",
})

# Function words and sentence-openers. On their own these are the START of an
# utterance the caller abandoned, not an answer — the STT emitted a final because
# the caller paused, and there is nothing in it to act on. From the same corpus:
# 'So.' x4, 'And.' x2, 'I.' x2, plus 'But.', 'Is.', 'To.', 'Our.', "That's.",
# 'वो।', 'और।', 'क्योंकि।', 'आप।' x3.
#
# Kept to closed-class words ONLY. Nothing here can be an answer to a question a
# counselling call asks — unlike 'Six.', 'BSL.' or 'विवेक।', which are single
# words that ARE answers and must keep firing the fault.
_FUNCTION_WORDS = frozenset({
    "so", "and", "but", "or", "if", "is", "am", "are", "was", "were", "be",
    "to", "of", "in", "on", "at", "for", "the", "a", "an", "that", "thats",
    "this", "it", "its", "i", "we", "you", "he", "she", "they", "my", "our",
    "actually", "because", "then", "also", "just", "like",
    # _FRAG_STRIP only strips from the ENDS, so an internal apostrophe survives:
    # "That's." normalizes to "that's", not "thats". Both spellings listed.
    "that's", "it's", "we're", "you're", "i'm",
    "और", "या", "पर", "लेकिन", "क्योंकि", "तो", "वो", "ये", "यह", "मैं", "हम",
    "आप", "आपने", "उसको", "इसको", "का", "की", "के", "है", "हैं", "भी", "थोड़ा", "बस",
})


def _is_throwaway(words) -> bool:
    """True when every word is a greeting/address term or a function word.

    Multi-word is included so 'हाँ जी।' style pairs do not slip through as
    "a phrase, therefore meaningful" — but any single content word in the
    utterance makes the whole thing meaningful again.
    """
    return bool(words) and all(w in _SOCIAL_TOKENS or w in _FUNCTION_WORDS
                               for w in words)


def _lost_carries_meaning(text: str) -> bool:
    """PURE. Was this unmatched caller final worth calling a DISCARDED ANSWER?

    True for anything that could have changed the call: a phrase, a digit,
    consent, a refusal, a question, or a single word of more than one syllable.
    False for a one-character scrap, and (v5) for greetings/address terms and
    bare function words — see _SOCIAL_TOKENS / _FUNCTION_WORDS.

    ORDER IS LOAD-BEARING. Question, digit and consent/refusal are all tested
    BEFORE the throwaway check, so "haan", "yes", "nahi", "no", "5" and "kitni?"
    can never be filtered as noise. A lost refusal is the expensive case and
    stays a reported loss.
    """
    raw = (text or "").strip()
    if "?" in raw or "？" in raw:
        return True
    words = [w for w in (s.strip(_FRAG_STRIP).casefold() for s in raw.split()) if w]
    if not words:
        return False
    if any(any(ch.isdigit() for ch in w) for w in words):
        return True
    if any(w in _CONSENT_OR_REFUSAL for w in words):
        return True
    # Nothing here could have changed the call: "Hello.", "Sir.", "So.", "और।".
    # Checked for one word AND for phrases, because the old "two words is a
    # phrase, not a scrap" shortcut let "हाँ जी।" and "That's." through as
    # meaningful losses.
    if _is_throwaway(words):
        return False
    if len(words) > 1:
        return True                          # a real phrase
    return len(_norm_answer(words[0])) > _SCRAP_MAX_CHARS


def _consume_words(words: List[List[Optional[str]]], seq: List[str]) -> bool:
    """Find `seq` as a contiguous run of still-unconsumed words in one of the
    delivered messages; blank those words (None) and return True. Whole words
    only — "हाँ" never matches inside "हाय", which is what the substring pass
    could not promise for short keys."""
    n = len(seq)
    for ws in words:
        for i in range(len(ws) - n + 1):
            if ws[i:i + n] == seq:
                ws[i:i + n] = [None] * n
                return True
    return False


def _delivered_in_two_pieces(words: List[List[Optional[str]]], hw: List[str]) -> bool:
    """Split `hw` once so each half is a whole-word run of the unconsumed
    messages (any order, any message); consume both and return True. All or
    nothing: a half that does not fit leaves `words` untouched."""
    for i in range(1, len(hw)):
        head, tail = hw[:i], hw[i:]
        if min(len("".join(head)), len("".join(tail))) < _CONTAIN_MIN_CHARS:
            continue
        trial = [list(ws) for ws in words]
        if _consume_words(trial, head) and _consume_words(trial, tail):
            words[:] = trial
            return True
    return False


class Lost(NamedTuple):
    """What the reconciliation found, split by whether losing it cost anything."""
    answers: int
    answer_samples: List[str]
    fragments: int
    fragment_samples: List[str]


def max_reply_restarts(transcript: List[Dict[str, Any]], threshold: float = 0.82,
                       skip_like: str = "") -> int:
    """PURE. Longest run of consecutive bot turns that said the SAME thing.

    Post-hoc rather than frame-plumbed on purpose: the played transcript already
    records exactly what the CALLER heard, which is the thing that matters. If
    the bot starts "Shreyash ji, main pooch raha tha ki Raman ke last annual
    exam..." four times without ever reaching the end, the caller heard the same
    second of audio four times (call 77cb4b47).

    FUZZY, not exact-prefix. The first version of this compared a 24-character
    head and would have scored that very call as ZERO, because the model
    re-rendered one of the four as "main puch raha tha" instead of "main pooch
    raha tha" — a restart the caller cannot even hear the difference in. A
    detector that misses the case it was built for is worse than none, so
    similarity it is.

    Short bot turns (fillers, "Hmm…", one-word acks) are SKIPPED without
    breaking the run: they legitimately repeat, and on the live call a "Hmm…"
    landed in the middle of the loop. Skipping keeps the run intact; resetting
    on them hid it.

    ``skip_like`` (the opening) is skipped the same way: the bot's deliberate
    re-says of an opening cut at pickup sit next to each other in the played
    transcript once an acknowledgement over them stops splitting the entries
    (2026-10-14), and three deliveries of the opening read as a REPLY_LOOP —
    which marks the outcome untrustworthy and re-dials the lead (replay of
    7fb703a4: GREEN on the old build, RED on identical audio).
    """
    skip = " ".join((skip_like or "").split()).casefold()[:120]
    heads: List[str] = []
    for entry in transcript or []:
        if (entry or {}).get("role") != "assistant":
            continue
        text = " ".join(((entry or {}).get("text") or "").split()).casefold()
        if len(text) < 24:
            continue
        if skip and difflib.SequenceMatcher(None, skip, text[:120]).ratio() >= threshold:
            continue
        heads.append(text[:120])
    best = run = 0
    prev = None
    for head in heads:
        same = prev is not None and difflib.SequenceMatcher(
            None, prev, head).ratio() >= threshold
        run = run + 1 if same else 1
        prev = head
        best = max(best, run)
    return best


def split_lost(heard: List[str], delivered: List[str]) -> Lost:
    """PURE. Which caller finals never reached the model, and did it matter?

    ``heard``    = finals TranscriptCollector recorded (it sits BEFORE
                   aggregators.user() in the pipeline, so it sees words the
                   aggregator later deletes).
    ``delivered`` = user messages actually present in the LLM context.

    Returns a ``Lost``: the losses that carried something (ANSWER_DELETED's
    input) and the sub-floor scraps that did not (evidence only — see
    _lost_carries_meaning). This is the ground truth for the biggest finding
    of the 2026-07 forensics: pipecat's aggregator DELETES caller utterances
    (min_words + the emulated-VAD path) — 179 of them across 40% of calls,
    including the literal answers IGCSE, Symbiosis, Monday. They never reach the
    MODEL, so nothing can answer them and nothing re-asks for them. (They DO
    reach the transcript and the report: ``heard`` is derived from
    outcome.transcript, which report.py posts verbatim — so UI copy claiming
    otherwise is wrong.)

    Two passes:
    1. Multiset exact match, so a genuine repeat ("SSC." twice) is not miscounted.
    2. CONTAINMENT with consumption: Saaras splits one halting utterance into
       fragment finals ("नहीं जान।" + "सकते हैं आप।") which the aggregator JOINS
       into one context message — per-final exact matching then counted every
       fragment as deleted. Live call ae7d3069 reported 10 deletions on a
       conversation the model demonstrably followed (it answered each refusal).
       A fragment found inside a delivered message consumes that span, so a
       repeat still needs its own copy.
    """
    pool: Dict[str, int] = {}
    for m in delivered:
        k = _norm_answer(m)
        if k:
            pool[k] = pool.get(k, 0) + 1
    leftovers: List[tuple] = []
    for h in heard:
        k = _norm_answer(h)
        if not k:
            continue
        if pool.get(k, 0) > 0:
            pool[k] -= 1
        else:
            leftovers.append((h, k))
    # Pass 2 over what exact matching couldn't place. Consume matched spans from
    # a mutable copy of the delivered pool (exact-pass leftovers included — a
    # message that exact-matched is spoken for and must not also absorb fragments,
    # so only UNCONSUMED copies are searchable).
    spans: List[str] = []
    # Whole-word view of the same unconsumed messages, for the short tokens
    # the substring pass must not touch. Verified live (call ee6f561c,
    # 2026-09-11): saaras emitted "But." / "बच्चा भी।" / "ठीक।" / "fifth class
    # में पढ़ रहा है।" as four finals, the aggregator joined them into one
    # message and the model answered "fifth class" — yet "ठीक।" was reported
    # DELETED, because it normalizes to 2 chars and substring matching is
    # (rightly) off below 4. Over 7 days the top "deleted answers" were
    # "Yes." x8, "हाँ।" x3, "Yeah." x3 — every one a 3-char-or-shorter key that
    # this pass can now place as a whole word, so the fault reports real
    # losses only. A word is consumed once, so a repeated "yes" still needs
    # its own copy.
    words: List[List[Optional[str]]] = []
    for m in delivered:
        k = _norm_answer(m)
        if k and pool.get(k, 0) > 0:
            pool[k] -= 1
            spans.append(k)
            words.append([w for w in (_norm_answer(t) for t in m.split()) if w])
    missing: List[str] = []
    for h, k in leftovers:
        if len(k) >= _CONTAIN_MIN_CHARS:
            for i, span in enumerate(spans):
                j = span.find(k)
                if j >= 0:
                    spans[i] = span[:j] + span[j + len(k):]
                    break
            else:
                missing.append(h)
            continue
        hw = [w for w in (_norm_answer(t) for t in h.split()) if w]
        if hw and _consume_words(words, hw):
            continue
        missing.append(h)
    # Pass 3, the reverse split: the transcript JOINS a fragment continuation
    # onto its head ("मेरा बच्चा mobile" + "बाईस से।" -> one entry) while the
    # model received the pieces as separate messages. Call 2983bf1f
    # (2026-09-24) reported that line lost; the run that followed had all 17
    # of the caller's words. Search the unconsumed messages joined in order.
    if missing and spans:
        joined = "".join(spans)
        still: List[str] = []
        for h in missing:
            k = _norm_answer(h)
            j = joined.find(k) if len(k) >= _CONTAIN_MIN_CHARS else -1
            if j >= 0:
                joined = joined[:j] + joined[j + len(k):]
            else:
                still.append(h)
        missing = still
    # Pass 4, the same join out of order: a stutter's tail went to the model the
    # moment it landed (a fragment continuation), its head later with the rest of
    # the turn, while the transcript glued them into one line (two words + the
    # same two words again). Call 4a594125 (2026-10-14) reported that line lost;
    # the run that followed had every word and the reply answered it. Both
    # halves must be a whole-word run of some unconsumed message and at least
    # _CONTAIN_MIN_CHARS long, so a real lost "हाँ जी" is never explained away by
    # a stray "हाँ" and "जी" somewhere else.
    if missing and words:
        still = []
        for h in missing:
            hw = [w for w in (_norm_answer(t) for t in h.split()) if w]
            if not _delivered_in_two_pieces(words, hw):
                still.append(h)
        missing = still
    answers = [h for h in missing if _lost_carries_meaning(h)]
    scraps = [h for h in missing if not _lost_carries_meaning(h)]
    return Lost(len(answers), answers[:_MAX_DELETED_ANSWERS],
                len(scraps), scraps[:_MAX_LOST_FRAGMENTS])


def reconcile_answers(heard: List[str], delivered: List[str]) -> tuple:
    """PURE. (count, samples) of caller ANSWERS that never reached the model —
    i.e. ANSWER_DELETED's input. Thin view over split_lost for callers that do
    not care about the sub-floor scraps."""
    lost = split_lost(heard, delivered)
    return lost.answers, lost.answer_samples


# A machine greeting that a person then answered past this many times was a
# call screener (or a pickup after the operator's line), not an answering
# machine. Live calls b5b43ae1 and 34452119 (2026-10-02) were AMBER
# LIKELY_MACHINE on the screener's marker alone, through 18 and 15 caller
# turns of a real conversation. 3, not 1: a screen with nobody behind it
# still relays a line or two after our opening ("Thanks. Arushi.", "I'm
# sorry." — 787aa111 scored 2), and a person answers us far more than that.
_PERSON_TURNS_OVER_MACHINE = 3


def machine_score(d: CallDiagnostics) -> float:
    """Bounded 0..1 heuristic that a machine, not a person, answered. INFERRED —
    v1 is EVIDENCE ONLY and never changes status or disposition."""
    score = 0.0
    if d.machine_markers and (d.person_turns or 0) < _PERSON_TURNS_OVER_MACHINE:
        score += 0.5
    if d.user_turns <= 1 and d.bot_turns >= 2:
        score += 0.2
    if d.longest_user_secs >= 6.0:      # an uninterrupted recorded announcement
        score += 0.2
    if d.barge_ins == 0 and d.user_turns <= 2:
        score += 0.1
    return round(min(1.0, score), 2)


def verdict(d: CallDiagnostics) -> Dict[str, Any]:
    """PURE: counters -> (health, faults, headline). Thresholds live HERE only."""
    faults: Dict[str, str] = {}

    def fire(code: str, level: str) -> None:
        if _RANK[level] > _RANK.get(faults.get(code, GREEN), 0):
            faults[code] = level

    if d.crash:
        fire(CRASH, RED)

    # A conversation where the caller spoke and we never produced a single audio
    # frame is total failure, whatever else the counters say. Requires a caller
    # turn so an unanswered dial (nobody there, nothing to say) stays quiet.
    if d.user_turns >= 1 and d.bot_turns == 0 and d.tts_chars == 0:
        fire(BOT_SILENT, RED)

    # Re-delivering a cut-off reply once is normal recovery. Three in a row is
    # the loop: the caller is hearing the same opening words and never the end.
    if d.max_reply_restarts >= 3:
        fire(REPLY_LOOP, RED)
    elif d.max_reply_restarts == 2:
        fire(REPLY_LOOP, AMBER)

    if d.tts_stall_cap_hit or d.tts_stalls >= 2 or (d.tts_stalls >= 1 and d.tts_silent_generations >= 1):
        fire(TTS_WEDGE, RED)
    elif d.tts_stalls == 1 or d.tts_wedges >= 1 or d.tts_letterless_skipped >= 1:
        fire(TTS_WEDGE, AMBER)

    if d.opening_replays >= 1:
        fire(OPENING_REPLAYED, RED)
    if d.repeated_lines >= 2:
        fire(REPEATED_LINE, RED)
    elif d.repeated_lines == 1:
        fire(REPEATED_LINE, AMBER)

    if d.replies_never_played >= 2:
        fire(REPLY_UNPLAYED, RED)
    elif d.replies_never_played == 1:
        fire(REPLY_UNPLAYED, AMBER)

    # A handback is a TURN the caller could not answer. One is recovery; a run of
    # them is a conversation with no way forward. RED at 3 because that is where
    # 3148ccd4 became unrecoverable — the caller started asking what they were
    # even supposed to say.
    if d.handbacks >= 3:
        fire(HANDBACK_LOOP, RED)
    elif d.handbacks >= 2:
        fire(HANDBACK_LOOP, AMBER)

    # A swallowed turn is a person talking into silence (audio-checked, see
    # swallowed_turns); one is already a fault the caller felt, two is the
    # 14-18 s lock of 2026-10-14 (a11e6709: four hellos, two swallowed runs,
    # then a reply with no introduction).
    if d.swallowed_turns >= 2:
        fire(CALLER_IGNORED, RED)
    elif d.swallowed_turns >= 1:
        fire(CALLER_IGNORED, AMBER)

    if d.answers_deleted is not None:          # None = not measured: never fires
        if d.answers_deleted >= 3:
            fire(ANSWER_DELETED, RED)
        elif d.answers_deleted >= 1:
            fire(ANSWER_DELETED, AMBER)

    # DEAD_AIR only means something in a CONVERSATION. If the caller never took a
    # turn, the "silence" is simply nobody answering — the bot greeting a voicemail
    # or an empty line — and the call status already says no-answer. Marking that
    # "Broken" made an unanswered dial look like a system failure and would make
    # the fleet view mostly red for a non-problem (seen live: userTurns=0,
    # idleHangup, verdict RED "Long silence during the call").
    worst_gap = max(d.dead_air) if d.dead_air else 0.0
    if d.user_turns == 0:
        pass                                   # nobody to be silent AT
    elif worst_gap >= 6.0:
        fire(DEAD_AIR, RED)
    elif worst_gap >= 3.5:                     # below STALL_AFTER_SECS nothing was detectable
        fire(DEAD_AIR, AMBER)

    if d.orphan_false_reasks >= 3:
        fire(FALSE_REASK, RED)
    elif d.orphan_false_reasks >= 1:
        fire(FALSE_REASK, AMBER)

    ms = machine_score(d)
    if ms >= 0.7:
        fire(LIKELY_MACHINE, RED)
    elif ms >= 0.5:
        fire(LIKELY_MACHINE, AMBER)

    # "We could not hear the caller" is the most caller-visible failure there is —
    # they answer, we apologise, they answer again. Giving up and closing out is
    # always RED regardless of how the sockets behaved.
    # A call where the caller SPOKE but we transcribed nothing is the worst
    # outcome there is, and it used to score GREEN: user_turns==0 suppressed
    # DEAD_AIR (correct for an unanswered dial), and reconnects/hearing_failures
    # can both be 0 when the socket is healthy but silent. A live call rated
    # GREEN while the caller said "Hello" seven times into nothing.
    heard_nothing = d.unheard_utterances >= 1 and d.user_turns == 0
    if d.hearing_failures >= 1 or d.stt_reconnects >= 3 or heard_nothing:
        fire(STT_DEAF, RED)
    elif d.stt_reconnects >= 1 or d.unheard_utterances >= 1:
        fire(STT_DEAF, AMBER)

    for code, buf in ((SLOW_TTS, d.tts_ttfb), (SLOW_LLM, d.llm_ttfb)):
        if len(buf) >= 5:
            p95 = _p(buf, 95) or 0.0
            if p95 > 3.0:
                fire(code, RED)
            elif p95 > 1.5:
                fire(code, AMBER)

    if d.transfer_requested and not d.transfer_registered:
        fire(TRANSFER_FAILED, AMBER)

    if d.prompt_unfilled:
        fire(PROMPT_UNFILLED, AMBER)           # config bug, never call breakage

    health = GREEN
    for level in faults.values():
        if _RANK[level] > _RANK[health]:
            health = level
    # Severity FIRST, then caller-experience order within that severity. The
    # order alone used to decide it, so an AMBER could headline over a RED:
    # call 14029bd6 was banner-RED for LIKELY_MACHINE but read "The agent kept
    # restarting the same reply", an AMBER two-restart blip, because REPLY_LOOP
    # sits higher in the list. The banner and the sentence under it must agree.
    headline = next((c for c in HEADLINE_PRIORITY
                     if faults.get(c) == health), None)
    if headline is None:       # defensive: never lose the headline entirely
        headline = next((c for c in HEADLINE_PRIORITY if c in faults), None)
    return {"health": health, "faults": faults, "headline": headline}


_HEADLINE_TEXT = {
    CRASH: "Pipeline crashed mid-call",
    TTS_WEDGE: "Voice synthesis stalled — caller heard silence",
    REPLY_UNPLAYED: "A reply was never played to the caller",
    ANSWER_DELETED: "Caller answers were discarded before the agent saw them",
    DEAD_AIR: "Long silence during the call",
    FALSE_REASK: "Agent re-asked for answers it had already heard",
    LIKELY_MACHINE: "Probably an answering machine, not a person",
    STT_DEAF: "The agent could not hear the caller",
    SLOW_TTS: "Slow voice synthesis",
    SLOW_LLM: "Slow agent responses",
    TRANSFER_FAILED: "Human transfer was requested but failed",
    PROMPT_UNFILLED: "Agent prompt has unresolved placeholders",
    BOT_SILENT: "The agent never spoke — the caller heard nothing",
    REPLY_LOOP: "The agent kept restarting the same reply",
    OPENING_REPLAYED: "The agent said its opening again mid-call",
    REPEATED_LINE: "The agent said the same line twice",
    HANDBACK_LOOP: "The agent had nothing to say and kept asking the caller to talk",
    CALLER_IGNORED: "The caller spoke and the agent stayed silent",
}


def to_payload(d: CallDiagnostics) -> Dict[str, Any]:
    """TOTAL: builds the report blob. Must never raise — a diagnostics bug can
    never be allowed to cost us the report itself."""
    try:
        v = verdict(d)
        return {
            "rulesVersion": RULES_VERSION,
            "health": v["health"],
            "faults": sorted(v["faults"].keys()),
            "faultLevels": v["faults"],
            "headline": v["headline"],
            "headlineText": _HEADLINE_TEXT.get(v["headline"]) if v["headline"] else None,
            "llm": {"vendor": d.llm_vendor or None},
            "tts": {
                "letterlessSkipped": d.tts_letterless_skipped,
                "wedges": d.tts_wedges,
                "wedgeReconnects": d.tts_wedge_reconnects,
                "stalls": d.tts_stalls,
                "stallCapHit": d.tts_stall_cap_hit,
                "silentGenerations": d.tts_silent_generations,
                "silentResumes": d.tts_silent_resumes,
                "ttfbP50": _p(d.tts_ttfb, 50), "ttfbP95": _p(d.tts_ttfb, 95),
                "ttfbMax": round(max(d.tts_ttfb), 3) if d.tts_ttfb else None,
                "vendor": d.tts_vendor or None,
                # None = the vendor told us nothing. Never rendered as zero cost.
                "vendorCredits": (round(d.tts_vendor_credits, 4)
                                  if d.tts_vendor_credits is not None else None),
                "meteredRequests": d.tts_meter_frames or None,
                "audioSecs": round(d.tts_audio_secs, 2) if d.tts_audio_secs else None,
                "chars": d.tts_chars or None,
                # null (not 0) when the cache was off — see the field comments.
                "cacheHits": d.tts_cache_hits,
                "cacheMisses": d.tts_cache_misses,
                "cacheCharsSaved": (d.tts_cache_chars_saved
                                    if d.tts_cache_hits is not None else None),
                "cacheSecsSaved": (round(d.tts_cache_secs_saved, 2)
                                   if d.tts_cache_hits is not None else None),
                "cacheHitRate": _hit_rate(d.tts_cache_hits, d.tts_cache_misses),
            },
            "playout": {
                "repliesGenerated": d.replies_generated,
                "repliesNeverPlayed": d.replies_never_played,
            },
            "turnTaking": {
                "userTurns": d.user_turns, "botTurns": d.bot_turns,
                "bargeIns": d.barge_ins,
                "bargeInCancels": d.barge_in_cancels,
                "ducks": d.ducks,
                "duckAbsorbs": d.duck_absorbs,
                "duckTimeoutResumes": d.duck_timeout_resumes,
                "carrierAnnouncements": d.carrier_announcements,
                "holds": d.holds,
                "holdLines": d.hold_lines,
                "holdReturns": d.hold_returns,
                "runsDroppedOnHold": d.runs_dropped_on_hold,
                "repeatsSuppressed": d.repeats_suppressed,
                "echoesTrimmed": d.echoes_trimmed,
                "handbacks": d.handbacks,
                "nextStepRequests": d.next_step_requests,
                "repeatEscalations": d.repeat_escalations,
                "contentFreeTurns": d.content_free_turns,
                "unsaidReverted": d.unsaid_reverted,
                "emptyRunsBlocked": d.empty_runs_blocked,
                "runsHeldForOpening": d.runs_held_for_opening,
                "turnsSwallowedForOpening": d.turns_swallowed_for_opening,
                "openingUnsaidRuns": d.opening_unsaid_runs,
                "introCues": d.intro_cues,
                "swallowedTurns": d.swallowed_turns,
                "shortAnswerNoiseReleases": d.short_answer_noise_releases,
                "acksTalkedThrough": d.acks_talked_through,
                "placeholdersFilled": d.placeholders_filled,
                "alternativesCollapsed": d.alternatives_collapsed,
                "lateReplyCommits": d.late_reply_commits,
                "floorHolds": d.floor_holds,
                "floorHoldsDropped": d.floor_holds_dropped,
                "callerGender": d.caller_gender or None,
                "formingHolds": d.forming_holds,
                "formingHoldCapReleases": d.forming_hold_cap_releases,
                "retiredRunsDropped": d.retired_runs_dropped,
                "cueRunsDropped": d.cue_runs_dropped,
                "runsSuperseded": d.runs_superseded,
                "shortAnswerFormingWaits": d.short_answer_forming_waits,
                "sendsFromSupersededReply": d.sends_from_superseded_reply,
                "floorHoldsReleased": d.floor_holds_released,
                "floorHoldsCapped": d.floor_holds_capped,
                "voiceCuts": d.voice_cuts,
                "shortAnswerHolds": d.short_answer_holds,
                "resumeRespoken": d.resume_respoken,
                "resumeLost": d.resume_lost,
                "sentencesCapped": d.sentences_capped,
                "openingReplays": d.opening_replays,
                "repeatedLines": d.repeated_lines,
                "repeatedLineSamples": d.repeated_line_samples[:3],
                "maxReplyRestarts": d.max_reply_restarts,
                "orphanReasks": d.orphan_reasks,
                "orphanFalseReasks": d.orphan_false_reasks,
                "nudges": d.nudges,
                "idleHangup": d.idle_hangup, "capFarewell": d.cap_farewell,
                # None here means NOT MEASURED — the UI must not render it as 0.
                "answersDeleted": d.answers_deleted,
                "answersDeletedSamples": d.answers_deleted_samples or None,
                "answersDeletedSrc": "measured" if d.answers_deleted is not None else None,
                # Same measured loss, too small to have been an answer. Present so
                # the loss is never hidden, but it fires no fault (RULES_VERSION 3).
                "fragmentsLost": d.fragments_lost,
                "fragmentsLostSamples": d.fragments_lost_samples or None,
            },
            "silences": d.silences or None,
            "latency": {
                "llmTtfbP50": _p(d.llm_ttfb, 50), "llmTtfbP95": _p(d.llm_ttfb, 95),
                "sttTtfbP50": _p(d.stt_ttfb, 50), "sttTtfbP95": _p(d.stt_ttfb, 95),
                "deadAirP95": _p(d.dead_air, 95),
                "deadAirMax": round(max(d.dead_air), 3) if d.dead_air else None,
            },
            "setup": {
                "greetPath": d.greet_path or None,
                "greetDelaySecs": d.greet_delay_secs,
                "setupSecs": d.setup_secs,
                "openingTruncated": d.opening_truncated,
                "openingResaid": d.opening_resaid,
                "llmBridges": d.llm_bridges,
            },
            "machine": {
                "score": machine_score(d),
                "markers": d.machine_markers or None,
                "personTurns": d.person_turns,
                "firstUserSecs": d.first_user_secs,
                "longestUserSecs": round(d.longest_user_secs, 2) or None,
                "src": "inferred",
            },
            "infra": {
                "sttReconnects": d.stt_reconnects,
                "sttFailovers": d.stt_failovers,
                "sttStalls": d.stt_stalls,
                "sttVendorFinal": d.stt_vendor_final or None,
                "llmFailovers": d.llm_failovers,
                "llmReturns": d.llm_returns,
                "llmVendorFinal": d.llm_vendor_final or None,
                "llmUsage": {
                    "runs": d.llm_runs,
                    "promptTokens": d.llm_prompt_tokens,
                    "cachedTokens": d.llm_cached_tokens,
                    "completionTokens": d.llm_completion_tokens,
                    "cachedPct": (round(100.0 * d.llm_cached_tokens / d.llm_prompt_tokens, 1)
                                  if d.llm_prompt_tokens else None),
                } if d.llm_runs else None,
                "hearingFailures": d.hearing_failures,
                "unheardUtterances": d.unheard_utterances,
                "promptUnfilled": d.prompt_unfilled or None,
                "crash": d.crash,
                "transferRequested": d.transfer_requested,
                "transferRegistered": d.transfer_registered,
            },
        }
    except Exception:  # pragma: no cover - belt and braces
        return {"rulesVersion": RULES_VERSION, "health": None, "error": "diagnostics_failed"}
