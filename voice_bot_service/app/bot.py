"""The Pipecat call pipeline — productionization of the validated POC bot.py
(github.com/shreyash-jain/sales-poc-ai).

Pipeline (same order as the POC):
    transport.input() → STT → transcript(user) → user_agg → LLM
        → SentinelGate → TTS → transport.output() → assistant_agg

Two hidden markers steer the call (sentinel pattern proven in the POC — no
dependency on provider tool-calling):
    <<END_CALL>>  — the LLM decided the conversation is over; say the farewell,
                    then stop the task (Plivo falls through to <Redirect> which
                    hangs up via /plivo/ai-next).
    <<TRANSFER>>  — the caller wants a human; register the handoff with
                    admin_core, speak the bridge line, then stop the task
                    (Plivo's <Redirect> then <Dial>s the registered target).

NOTE ON PIPECAT IMPORTS: this file targets pipecat-ai 0.0.95 (pinned in
requirements.txt; every module path below verified against that wheel). If you
bump pipecat, re-verify each import — paths have moved between minor versions.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from collections import deque
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from pipecat.frames.frames import (VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame, 
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EndFrame,
    Frame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMMessagesAppendFrame,
    ManuallySwitchServiceFrame,
    LLMRunFrame,
    LLMTextFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSSpeakFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    TTSTextFrame,
    UserSpeakingFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.audio.turn.smart_turn.base_smart_turn import SmartTurnParams
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.turns.user_stop.turn_analyzer_user_turn_stop_strategy import (
    TurnAnalyzerUserTurnStopStrategy,
)
from pipecat.turns.user_turn_strategies import (
    TranscriptionUserTurnStartStrategy,
    UserTurnStrategies,
    VADUserTurnStartStrategy,
)

from . import admin_core
from .callstate import (CallState, WatchdogConfig, Decision, watchdog_decide,
                        apply_decision, stall_recovery_still_needed, unplayed_confirmed,
                        note_reply_cancelled, reply_unheard, hold_escalation_due,
                        opening_coming, intro_heard,
                        NONE, CANCEL_STARVED, REISSUE_STOP,
                        CAP_FAREWELL, STALL_RECOVER, ORPHAN_ASK, NUDGE, IDLE_HANGUP,
                        LLM_BRIDGE,
                        HEARING_FAILED, ARM_STOP, DUCK_RESUME)
from .config import get_settings
from .agent_domain import is_general_agent
from .ambience import AmbienceDucker
from .voice_eq import build_voice_eq, make_voice_eq_processor
from .prosody import build_prosody_shaper, make_prosody_processor
from . import diagnostics as diag_mod
from .providers import (build_stt_waterfall, build_llm, build_llm_waterfall, build_stt, build_tts, engine_of,
                        normalize_for_rumik, rumik_term_map_version)
from . import ttscache
from .turntake import (mid_reply_action, is_carrier_announcement,
                       is_audio_check, suppresses_opening, is_repeat,
                       caller_asked_to_repeat, caller_wants_to_end, is_farewell, normalize_spoken,
                       question_topic, strip_echo_opener, ABSORB, caller_checking_presence,
                       presence_cue, last_question_in, is_fragment_continuation,
                       is_echo_of_answer, is_call_screener, is_call_connect, is_voicemail_prompt,
                       caller_asks_who,
                       caller_says_goodbye,
                       is_screener_hold, spoken_key, takes_over_opening, is_question,
                       is_hold_announcement, hold_absorbs, caller_is_busy,
                       opening_expected_secs, ends_on_question, ivr_menu_key,
                       IVR_LOOP_REPEATS)

from .sarvam_v4_voices import (SARVAM_V4_DEFAULT_VOICE, SARVAM_V4_MALE,  # noqa: E402
                               SARVAM_V4_VOICES)

logger = logging.getLogger(__name__)

# How long the bot waits on hold before the usual idle nudges/hang-up apply again.
HOLD_MAX_SECS = 300.0
# Said to the model when the person comes back from putting the call on hold.
HOLD_RESUME_CUE = ("[They had put the call on hold and are back now. Do NOT introduce yourself "
                   "again and do not restart your pitch. Answer what they say next first. If "
                   "they only greeted you or checked the line, say in a few words that you are "
                   "still here (e.g. 'जी, मैं यहीं हूँ।' / 'Yes, I'm still here.') and, if you "
                   "had asked a question, ask it again briefly.]")

# …when the hold began before the bot had spoken: an IVR answered the call
# ("Welcome to New Light Institute. Stay on the line…", call 9519f8c6,
# 2026-10-14), and the person now on the line has heard nothing from us.
HOLD_FIRST_CUE = ("[A person has just come on the line after a recorded hold/queue message. "
                  "They have NOT heard anything you said before. Answer what they say first, "
                  "then introduce yourself briefly — your name, your institute and why you "
                  "are calling.]")
# The same cue for a non-education agent (app/agent_domain). "your institute"
# tells a model with a thin script that it calls for a school or a coaching
# centre, and "why you are calling" with no reason in the script is the gap the
# AAIBUZZ/IRPL calls c43e9ce7, e6cb5f47 (2026-10-16) filled with an invented
# edtech product. Education agents keep HOLD_FIRST_CUE, byte for byte.
HOLD_FIRST_CUE_GENERAL = ("[A person has just come on the line after a recorded hold/queue "
                          "message. They have NOT heard anything you said before. Answer what "
                          "they say first, then introduce yourself briefly — your name, your "
                          "company as your instructions name it, and why you are calling, "
                          "only as your instructions or their enquiry give it; if neither "
                          "gives a reason, do not make one up — ask if it is a good time to "
                          "talk.]")

# Said to the model when the caller asks who is calling ("aap kaun bol rahi
# ho?"), so the answer comes first (TranscriptCollector).
WHO_CUE = ("[They asked who is calling. FIRST sentence: your name and "
           "your institute. SECOND: one short line on why you called. "
           "Nothing before that — no filler, no question.]")
# Non-education agents: "your company", and the reason only from the script or
# their enquiry — "who is calling?" is the moment the AAIBUZZ/IRPL bot (calls
# c43e9ce7, e6cb5f47, 2026-10-16) has to say who it is and why, with a script
# that says neither. Education agents keep WHO_CUE, byte for byte.
WHO_CUE_GENERAL = ("[They asked who is calling. FIRST sentence: your name and your "
                   "company, as your instructions name it. SECOND: one short line on why "
                   "you called — only the reason your instructions or their enquiry give; "
                   "if neither gives one, do not make one up, just ask if this is a good "
                   "time to talk. Nothing before your name — no filler, no question.]")

END_MARKER = "<<END_CALL>>"
TRANSFER_MARKER = "<<TRANSFER>>"

# Mid-call sends. UNLIKE the two above, this marker carries a PAYLOAD, so both places
# that know about markers need the variable-length form: the strip in SentinelGate and
# the hold-back in _split_safe. Miss either and the caller HEARS it — that is not
# hypothetical, it is what happened with [STOP] on 2026-08-18, when parents heard the
# word "stop" read out mid-sentence.
SEND_MARKER_OPEN = "<<SEND:"
SEND_MARKER_CLOSE = ">>"
# Artefact keys are authored in the agent UI, so validate rather than trust: anything
# outside this set is a mis-generation and must never reach admin_core.
_SEND_KEY_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")


def _valid_send_key(key: str) -> bool:
    return bool(key) and len(key) <= 64 and all(c in _SEND_KEY_CHARS for c in key)


# sarvam-105b writes the markers with SINGLE angle brackets about a fifth of the
# time (2026-09-10, first day as the default LLM: 14x "<<SEND:…>>", 4x
# "<SEND:…>"; Gemini never did). Call 4565478b: "<SEND:scholarship_quiz>" was
# not recognised, the link was never sent, and the TTS READ THE MARKER ALOUD —
# the caller said "हैं?". Normalise the loose form to the canonical one before
# any marker scan. Complete tokens only: a half-streamed "<SEND:schol" is held
# back by _split_safe until its closing bracket arrives.
# A template slot copied out of the prompt's example lines: "क्या <name> के
# साथ भी ऐसा है सर" (call e32df5c0, 2026-09-23) — the parent never gave the
# child's name and the model spoke the script line verbatim; the TTS read
# "name" aloud. Gemini did it 11 times in its first day, gemma4 once. Our
# markers are UPPERCASE (<<SEND:…>>, <<END_CALL>>) and never match.
_TEMPLATE_SLOT_RE = re.compile(r"<\s*([a-z][a-z _'-]{0,24})\s*>")


# "The child" in the reply's own language, for a name slot the model copied.
# Script first (each has its own Unicode block), then Marathi vs Hindi inside
# Devanagari. Call 7f86df90 (2026-09-25, Shreya-marathi demo): the Hindi-only
# filler put "बच्चे" into Marathi — "बच्चे च्या बाबतीतही असं आहे का मॅडम".
_CHILD_BY_SCRIPT = (
    ("[\u0A80-\u0AFF]", "બાળક"),       # Gujarati
    ("[\u0980-\u09FF]", "শিশু"),        # Bengali / Assamese
    ("[\u0A00-\u0A7F]", "ਬੱਚਾ"),        # Gurmukhi (Punjabi)
    ("[\u0B80-\u0BFF]", "குழந்தை"),     # Tamil
    ("[\u0C00-\u0C7F]", "పిల్లవాడు"),   # Telugu
    ("[\u0C80-\u0CFF]", "ಮಗು"),         # Kannada
    ("[\u0D00-\u0D7F]", "കുട്ടി"),      # Malayalam
    ("[\u0B00-\u0B7F]", "ପିଲା"),        # Odia
)
# Words that occur in Marathi and not in Hindi.
_MARATHI_MARKERS = frozenset(
    "आहे आहेत आहात आहोत मध्ये आम्ही तुमच्या तुमचं तुमची तुमचा आणि होतं होती "
    "करतो करते करतात बद्दल मधून पूर्ण असं काय नाव सध्या".split())
_MARATHI_POSTPOSITIONS = ("च्या", "चा", "ची", "चे", "ला", "ने", "साठी", "कडे", "कडून", "बद्दल")
_CHILD_SLOT = "\x00CHILD\x00"


def _is_marathi(text: str) -> bool:
    words = {w.strip("।.,!?;:\"'()") for w in text.split()}
    return bool(words & _MARATHI_MARKERS) or any(w.endswith("च्या") for w in words)


def _child_word(text: str) -> str:
    for block, word in _CHILD_BY_SCRIPT:
        if re.search(block, text):
            return word
    if re.search("[\u0900-\u097F]", text):
        return _CHILD_SLOT if _is_marathi(text) else "बच्चे"
    return "your child"


def fill_template_slots(text: str, child_slots: bool = True):
    """(text, n): name-like slots become "the child" in the reply's language
    (Marathi takes the oblique मुला- before a postposition: "मुलाच्या"), any
    other slot is dropped — anything but reading the bracket aloud.

    child_slots=False (a non-education agent, app/agent_domain): every slot is
    dropped. "<name>" there is the person on the line or a customer, and "your
    child" would put a child into a call about something else entirely — the
    AAIBUZZ/IRPL failure (calls c43e9ce7, e6cb5f47, 2026-10-16) said aloud."""
    n = 0

    def _rep(m):
        nonlocal n
        n += 1
        slot = m.group(1).strip()
        if child_slots and ("name" in slot or slot in ("child", "student", "beta", "bachcha")):
            return _child_word(text)
        return ""
    out = _TEMPLATE_SLOT_RE.sub(_rep, text)
    if _CHILD_SLOT in out:
        out = re.sub(re.escape(_CHILD_SLOT) + r"\s*(" + "|".join(_MARATHI_POSTPOSITIONS) + r")",
                     lambda m: "मुला" + m.group(1), out)
        out = out.replace(_CHILD_SLOT, "मूल")
    if n:
        out = re.sub(r"[ \t]{2,}", " ", out)
    return out, n


def mostly_played(sentence: str, played_key: str, share: float = 0.6) -> bool:
    """Did at least `share` of this sentence (from its start) reach the caller?
    played_key is spoken_key() of the played transcript. Short sentences need
    all of it — a cut two words in is not "heard"."""
    k = spoken_key(sentence)
    if not k or k in played_key:
        return bool(k)
    if len(k) < 24:
        return False
    return k[:int(len(k) * share)] in played_key


def cut_still_current(cut_t: float, bot_speaking: bool, bot_started_t: float) -> bool:
    """Does a cut at cut_t still describe what is on the line now? A cut
    belongs to the reply it stopped: once NEWER audio is playing, that is a
    different reply and it was not cut. Call edbbe7b3 (2026-10-14): a "हम्म"
    2.6 s after a barge-in counted as cutting the percent question then
    playing, and a carry-on cue sent a second reply straight after the
    question (bot audio continuous for 14.6 s) — the father never answered."""
    return not (bot_speaking and bot_started_t > cut_t)


# "करतो/करते", "सर/मॅडम", "शिकतो/शिकते": a prompt's either-or written as a
# slash pair, copied into a reply — the voice reads the slash or both words
# (call 7f86df90, 2026-09-25: "…खूप छान करतो/करते पण…"). Keep ONE: the address
# the call already uses (sir or madam), otherwise the first form. A token with
# a digit ("24/7") or a URL is left alone.
_ALT_RE = re.compile(r"(?<![^\s\"'“‘(])([^\s/\"'“”‘’()]+)/([^\s/\"'“”‘’()]+)")
_FEMALE_ADDRESS = frozenset({"मॅडम", "मैम", "मैडम", "मेम", "madam", "ma'am", "maam", "mam"})
_MALE_ADDRESS = frozenset({"सर", "sir"})


def collapse_alternatives(text: str, address: str = ""):
    """(text, n). address: "f" or "m" — how the caller has been addressed."""
    n = 0

    def _rep(m):
        nonlocal n
        a, b = m.group(1), m.group(2)
        if any(ch.isdigit() for ch in a + b) or ":" in a:
            return m.group(0)
        if not (any(ch.isalpha() for ch in a) and any(ch.isalpha() for ch in b)):
            return m.group(0)
        tail = re.search(r"[।.,!?;:…]*$", b).group(0)
        b_core = b[:len(b) - len(tail)] if tail else b
        pick = a
        if address == "f" and b_core.casefold() in _FEMALE_ADDRESS:
            pick = b_core
        elif address == "m" and b_core.casefold() in _MALE_ADDRESS:
            pick = b_core
        n += 1
        return pick + tail
    return _ALT_RE.sub(_rep, text), n


_LOOSE_MARKER_RE = re.compile(r"(?<!<)<\s*(SEND:[^<>]+|END_CALL|TRANSFER)\s*>(?!>)")
_LOOSE_MARKER_PREFIXES = ("<SEND:", "<END_CALL>", "<TRANSFER>", "<tool_call>", "<arg_key>",
                          "<arg_value>", "</tool_call>")
# Call 5a9fe35a (2026-09-11): sarvam-105b wrote a GLM-style tool call —
# "<tool_call>send_whatsapp_message <arg_key>phone_number</arg_key>
# <arg_value>9…" — instead of <<SEND:key>>, nothing here knew the shape, and the
# TTS read it to the caller, phone number included. Any such block (or its
# unterminated start, to the end of the buffer) is cut out of speech; the send
# itself still happens post-call from the transcript's promise. The trailing
# alternative also catches the bare "<tool_call>" a model may write.
_TOOL_CALL_RE = re.compile(r"<tool_call>.*?(?:</tool_call>|$)|</?arg_(?:key|value)>", re.S)


def _canonical_markers(text: str) -> str:
    return _LOOSE_MARKER_RE.sub(lambda m: f"<<{m.group(1).strip()}>>", text)

# If a graceful stop (stop_when_done) hasn't ended the runner within this many
# seconds, hard-cancel — a chatty caller can otherwise starve the drain forever.
_GRACEFUL_STOP_DEADLINE_SECS = 25.0
# A short "turn" followed this soon by another carrier line was a piece of that
# recording (TranscriptCollector.looks_like_voicemail). The six voicemails of
# 2026-10-14 put 0.9-2.5 s between a piece and the next carrier line; a person
# who came on after the recording (a11e6709) spoke 3.6 s after its LAST line,
# with no carrier line following.
RECORDING_PIECE_SECS = 4.0


@dataclass
class CallOutcome:
    """Everything report.py needs after the call ends. Owned by the CALLER of
    run_bot (main.py) so a mid-pipeline crash still leaves a reportable object —
    a lost report strands the paused workflow until its safety timeout."""

    corr: str
    context: Dict[str, Any]
    connected_at: float = field(default_factory=time.time)
    ended_at: Optional[float] = None
    transcript: List[Dict[str, str]] = field(default_factory=list)  # {role, text}
    # Everything sim.replay needs to re-run this call through the real
    # pipeline as a timing-sim scenario: STT finals, VAD on/off, bot audio
    # on/off (seconds since connect) and the raw LLM replies in order. Logged
    # as ONE json line ("replay corr=…") at the end of the call.
    replay: Dict[str, list] = field(default_factory=lambda: {
        "finals": [], "vad": [], "bot": [], "runs": [], "replies": []})
    transfer_requested: bool = False
    transfer_registered: bool = False
    end_requested: bool = False
    # The CALLER asked to stop (turntake.caller_wants_to_end): the next reply
    # ends the call whether or not the model appends the marker.
    end_forced: bool = False
    # Set by main.py when run_bot raises: the report must say "failed", not
    # "no-answer" — a crash is our fault and must never read as the lead's.
    crashed: bool = False
    crash_detail: Optional[str] = None
    # Per-call technical diagnostics (app/diagnostics.CallDiagnostics). Owned by
    # run_bot; None when the pipeline died before setup.
    diagnostics: Any = None
    # TTS speech-cache candidates this call proposed (ttscache.CallCandidates).
    # Declared rather than attached ad hoc so report.py can find it, and so the
    # end-of-call admission (was it heard, was the call healthy) has one owner.
    tts_candidates: Any = None

    def duration_seconds(self) -> int:
        end = self.ended_at or time.time()
        return max(0, int(end - self.connected_at))


class TranscriptCollector(FrameProcessor):
    """Records the caller's words (final transcriptions), refreshes the idle clock,
    and speaks an instant filler acknowledgment ("Hmm…") while the LLM composes —
    the reply's hard floor is ~1.5s of silence otherwise (VAD window + STT final +
    LLM TTFT), and a human-style acknowledgment makes it read as attentiveness."""

    def __init__(self, outcome: CallOutcome, on_activity, is_bot_speaking,
                 set_user_speaking=None, filler_phrases=None, on_transcript=None,
                 fillers_armed=None, bot_stopped_t=None, duck=None,
                 on_absorb=None, backchannel_extra=frozenset(),
                 gate_enabled=None, interrupt_on_vad=None, recently_cut=None,
                 end_pending=None,
                 diag=None, in_machine_window=None, reply_in_flight=None, reply_pending=None,
                 caller_forming=None, register_cue=None, opening_owed=None,
                 bot_spoke_once=None, on_voice_tick=None, on_continuation=None,
                 resume_unplayed=None, resume_on_stop_secs: float = 0.0,
                 resume_max_chars: int = 600, resume_settle_secs: float = 0.6,
                 forget_resume=None, release_turn=None, noise_reask_wait_secs: float = 1.0,
                 voice_live=None, resay_opening=None, cut_after_voice_secs: float = 0.0,
                 ack_answer_window_secs: float = 3.0, bot_started_t=None,
                 greet_skipped=None, general_agent: bool = False):
        super().__init__()
        self._outcome = outcome
        # A non-education agent (app/agent_domain): the who-is-calling and
        # back-from-hold cues say "your company" and never ask for a reason the
        # script does not give (WHO_CUE_GENERAL, HOLD_FIRST_CUE_GENERAL).
        self._general_agent = general_agent
        # "voice" barge-in mode (config.barge_in_mode): 0 = off (onset mode).
        self._cut_after = cut_after_voice_secs
        self._ack_answer_window = ack_answer_window_secs
        self._voice_on = False
        self._voice_cut_task = None
        # When THIS gate last stopped the reply. The pipeline's own "was cut"
        # (recently_cut) is stamped when the InterruptionFrame reaches DuckGate,
        # ~0.1 s later — and the caller's words arrive inside that gap.
        self._self_cut_t = 0.0
        self._question_cue_t = 0.0
        # (text, voice onset) of an acknowledgement heard while the bot kept
        # talking — answered when the reply ends, if it ended on a question.
        self._acked_mid_reply = None
        self._diag = diag
        # async (text) -> bool. Injected by run_bot: when the reply the caller's
        # acknowledgment cut was the scripted OPENING and they heard almost none
        # of it, re-speak the opening instead of asking the model to "carry on".
        self._resay_opening = resay_opening
        # Acoustic truth: the transport's VAD pushes UserSpeakingFrame every
        # 0.2s while voice is live. The turn-level Started/Stopped frames can
        # lag this by seconds (see CallState.voice_tick_t).
        self._on_voice_tick = on_voice_tick or (lambda: None)
        # Is the caller audibly speaking RIGHT NOW? Read from the same VAD ticks,
        # not from the turn-level frames, which lag by seconds (CallState.voice_tick_t).
        self._voice_live = voice_live or (lambda: False)
        # When we last played a filler. Compared against bot_stopped_t so at most one
        # filler covers any one gap between the bot's turns.
        self._last_filler_t = 0.0
        # Tells NoRepeatGate the NEXT response is a continuation of a cut reply
        # — the one place a paraphrased restatement is never legitimate.
        self._on_continuation = on_continuation or (lambda: None)
        # Resuming after a backchannel: the words the caller never heard
        # (NoRepeatGate.take_unplayed_tail), said again by the TTS with no model
        # in the loop — see config.backchannel_resume_verbatim.
        self._resume_unplayed = resume_unplayed
        self._resume_on_stop_secs = resume_on_stop_secs
        self._resume_max_chars = resume_max_chars
        # pipecat clears the TTS queue and reconnects the vendor socket while it
        # handles an interruption; a frame pushed into that window is dropped
        # silently. Wait it out before speaking the cut words.
        self._resume_settle_secs = resume_settle_secs
        self._forget_resume = forget_resume
        self._release_turn = release_turn or (lambda: True)
        self._noise_reask_wait_secs = noise_reask_wait_secs
        # The aggregator's view of the caller's turn (UserStarted/StoppedSpeaking);
        # _release_user_turn closes it when we swallow the final it is waiting for.
        self._user_turn_open = False
        self._vad_started_t = 0.0
        # The VAD onset whose words already went to the model as a real
        # barge-in. That burst's turn is taken: its VAD stop must not ALSO
        # resume the cut words, and its voice-cut timer must not fire on what
        # plays next. Call afa21bf4 (2026-10-14): "तो।" landed 95 ms before its
        # own VAD stop, the model answered it AND the stop resumed the cut
        # marks question — the caller heard that question twice back to back.
        self._barged_onset = 0.0
        self._resumed_t = 0.0
        self._reran_for = ""
        self._resume_check = None
        self._resume_stale = False
        self._rerun_for_resume = ""
        # True only while an operator/voicemail recording is still plausible.
        # This was a LATCH ("have we heard a real caller yet?") and the latch is
        # what broke on call 14029bd6: Sarvam rendered "…after the tone" as the
        # complete final "Add the tone.", that one miss flipped the latch, and
        # the two unmistakable announcements that followed ("Please record your
        # message.", "When you have finished recording you may hang up.") were
        # then treated as the caller and cut our opening three times. A clock
        # cannot be flipped by a single bad transcript.
        self._in_machine_window = in_machine_window or (lambda: False)
        self._reply_in_flight = reply_in_flight or (lambda: False)
        # In flight OR a held caller turn — for the bot's OWN runs (cues,
        # re-asks, resumes); see run_bot._reply_pending.
        self._reply_pending_fn = reply_pending
        self._caller_forming = caller_forming or (lambda: False)
        # The bot's own runs announce their cue to RunGuard (single-flight step 5).
        self._register_cue = register_cue or (lambda text: None)
        # The scripted opening is still owed (see run_bot._opening_pending).
        self._opening_owed = opening_owed or (lambda: False)
        # The callee spoke first and the greet skipped our opening: nothing of
        # ours is queued to answer a pickup "Hello." (call 9fd6489d, 2026-10-14).
        self._greet_skipped = greet_skipped or (lambda: False)
        self._bot_spoke_once = bot_spoke_once or (lambda: True)
        # Have we already identified this line as a machine greeting? Kept for the
        # log/diagnostic trail only — the scrap filter below deliberately no
        # longer waits for it, because the fragment that does the damage is the
        # FIRST one and it is never the recognisable one.
        self._carrier_seen = False
        self._human_turns = 0          # finals that reached the model as the callee's
        # …of which turned out to be the operator's recording: a short turn that
        # another carrier line followed within RECORDING_PIECE_SECS (a number, a
        # Devanagari syllable or four capitalised words the STT made of the
        # voicemail between its sentences, 2026-10-14). Only looks_like_voicemail
        # and the carrier-adjacent guard read it; everything else keeps counting
        # _human_turns as before.
        self._recording_turns = 0
        # The recorder's own prompt played ("…forwarded to voicemail.", "Please
        # record your message.") — see turntake.is_voicemail_prompt.
        self._voicemail_seen = False
        self._turns_after_carrier = []  # times of short turns since the last carrier line
        self._prev_final = ""          # every final, carrier or not (split-phrase matching)
        self._prev_final_t = 0.0
        # Phone-menu lines heard, by ivr_menu_key → times (looks_like_ivr_loop).
        self._ivr_lines: Dict[str, int] = {}
        # Caller VAD onsets (wordless_onsets_since).
        self._vad_onsets: List[float] = []
        # When the person put us on hold (0 = not on hold); see the hold branch in
        # process_frame and turntake.is_hold_announcement.
        self._hold_since = 0.0
        self._hold_line_t = 0.0
        # When the person last came back from a hold (0 = never): the silence
        # before it was the hold's, not dead air (run_bot.set_bot_speaking).
        self.hold_ended_t = 0.0
        self._hold_unheard = False     # the hold began before anyone heard the bot
        # Transcript entries that are the hold recording, absorbed on purpose: on
        # the record, never meant for the model, so not a "deleted answer" either
        # (ANSWER_DELETED quoted "Please stay on the line." on 22f80a85, d8146538
        # and 68bdcbcf, 2026-10-14). The entry dicts themselves, matched by
        # identity: an equal-text line the person says later is still theirs.
        self._absorbed = []
        # A call-screening prompt was heard: the opening went to a recorder,
        # and the human's first hello must get it again (consumed by the resay).
        self.screener_seen = False
        # STICKY: the line was screened at some point. screener_seen is cleared
        # by the first "human" turn, and the screen's own "Thanks." is one —
        # call 68bdcbcf (2026-10-14): "Thanks." cleared it, the screen's "Please
        # stay on the line." then started an ordinary hold, and the person who
        # came back was told "do NOT introduce yourself" having heard nothing.
        # _heard_since_screen: someone has demonstrably heard us since (the
        # opening re-said to their pickup, or a real 3+ word answer).
        self._screened = False
        self._heard_since_screen = False
        self._on_activity = on_activity
        self._is_bot_speaking = is_bot_speaking
        self._set_user_speaking = set_user_speaking or (lambda speaking: None)
        self._on_transcript = on_transcript or (
            lambda backchannel=False, substantive=False: None)
        # Turn-gate (see DuckGate): for ANY final that lands mid-reply, THIS
        # processor is the decision point — it sits before aggregators.user(),
        # so an absorbed backchannel never reaches the aggregator that would
        # delete it or run the LLM on it. Deliberately NOT gated on a duck
        # having happened: on live call 8e1e00ad Silero's volume gate missed the
        # caller entirely (no VAD onset → no duck), STT still transcribed them,
        # and pipecat's emulated path deleted the words while the bot talked on.
        # The words themselves are the trigger of last resort.
        self._duck = duck
        self._gate_enabled = gate_enabled or (lambda: duck is not None)
        self._interrupt_on_vad = interrupt_on_vad or (lambda: False)
        # True while a reply cancelled moments ago could still be picked up.
        self._recently_cut = recently_cut or (lambda: False)
        self._end_pending = end_pending or (lambda: False)

        async def _noop_absorb(text):
            return None

        self._on_absorb = on_absorb or _noop_absorb
        self._backchannel_extra = frozenset(backchannel_extra)
        # Fillers only AFTER the bot has completed its first real utterance: during
        # the setup dead-air callers say "hello? hello?" and a filler was the FIRST
        # thing they ever heard ("starts with Hmm" — live complaint).
        self._fillers_armed = fillers_armed or (lambda: True)
        # When the bot last FINISHED speaking — a repeat is only greeting-spam if
        # the bot has said nothing since the first copy; if it asked a NEW question
        # in between, an identical short answer ("haan") is a REAL answer.
        self._bot_stopped_t = bot_stopped_t or (lambda: 0.0)
        # When the bot's audio last STARTED (see _was_cut: a cut belongs to the
        # reply it stopped, not to newer audio playing after it).
        self._bot_started_t = bot_started_t or (lambda: 0.0)
        # Dedupe window for identical consecutive transcripts ("Hello" x3 while the
        # pipeline warms up): each repeat triggered its own LLM run → the intro was
        # spoken twice back-to-back on a live call.
        self._last_text = ""
        self._last_text_t = 0.0
        # Consecutive bare "hello?"s from the caller (reset by anything else).
        self._audio_checks = 0
        s = get_settings()
        self._filler_phrases = list(filler_phrases if filler_phrases is not None
                                    else s.filler_phrases)
        self._filler_probability = max(0.0, min(1.0, s.filler_probability))


    def _reply_pending(self) -> bool:
        f = self._reply_pending_fn
        return f() if f is not None else self._reply_in_flight()
    def _played_tail_is_question(self) -> bool:
        """Did the LAST thing the caller actually heard end in a question?
        Unlike _played_ended_with_question this does not need their final to
        have landed yet — it is asked at the VAD stop, before any transcript.
        A question mark that PLAYED means they could be answering; a reply cut
        before it means they cannot be. Same test as the other two paths
        (turntake.ends_on_question): with a strict "ends with ?" here, a cut
        inside the short sentence after the question resumed that sentence, and
        the "हाँ" that arrived next was dropped as "already resuming"."""
        for entry in reversed(self._outcome.transcript):
            if entry.get("role") == "assistant" and (entry.get("text") or "").strip():
                return ends_on_question(entry["text"] or "")
        return False

    def _played_ended_with_question(self) -> bool:
        """Did the bot's most recent PLAYED speech — since the caller last spoke —
        end in a question? The caller's own final has just been appended, so the
        entry before it must be assistant text (a user entry there means the cut
        reply never reached the line) ending with '?'."""
        t = self._outcome.transcript
        if len(t) < 2 or t[-1].get("role") != "user":
            return False
        prev = t[-2]
        if prev.get("role") != "assistant":
            return False
        # Text reaches the played transcript per WORD (Smallest word timings),
        # and the STT final lands 0.4-0.8 s after the caller starts — by then a
        # few words of the next sentence have played: "…right now? Is that".
        # The caller is answering the question; the fragment is the interrupted
        # continuation. Timing simulator yes_over_tail, 2026-09-12.
        return ends_on_question(prev.get("text") or "")

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        forwarded = False      # set once a final has already gone downstream
        # VAD user-speech frames re-arm the idle clock. Sarvam STT emits FINAL
        # transcripts only (no interims), so without this the clock goes stale during
        # a LONG caller utterance and the watchdog spoke "kya aap sun paa rahe hain?"
        # WHILE THE CALLER WAS TALKING (observed 13x in 48h of live calls).
        if isinstance(frame, UserSpeakingFrame):
            self._on_voice_tick()         # voice is live RIGHT NOW (acoustics)
        if isinstance(frame, UserStartedSpeakingFrame):
            self._on_voice_tick()
            self._user_turn_open = True
        if isinstance(frame, BotStoppedSpeakingFrame) and self._acked_mid_reply is not None:
            try:
                self.create_task(self._answer_ack_after_reply(*self._acked_mid_reply, time.time()))
            except Exception:
                logger.debug("turn-gate: no task manager for the deferred answer")
        if isinstance(frame, (VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame)):
            # The VAD's own onset/stop: the acoustic truth the orphan re-ask
            # keys on. The aggregator's UserStopped comes ~5 s late when no
            # transcript arrives (it is still waiting for one). Only the ONSET
            # opens the caller's turn — treating the stop as "speaking" too
            # re-stamped user_started_t at the acoustic stop, so the re-ask
            # measured from the aggregator's late stop after all (timing sim
            # unheard_turn, 2026-09-15: asked 9.4 s late).
            self._on_voice_tick()
            self._on_activity(user=True)
            _rp = getattr(self._outcome, "replay", None)
            if _rp is not None:
                _rp["vad"].append([round(time.time() - self._outcome.connected_at, 2),
                                   int(isinstance(frame, VADUserStartedSpeakingFrame))])
            if isinstance(frame, VADUserStartedSpeakingFrame):
                self._vad_started_t = time.time()
                self._vad_onsets.append(self._vad_started_t)
                self._voice_on = True
                self._arm_voice_cut()
                self._set_user_speaking(True)
            elif self._voice_stopped() and not self._was_cut():
                # Voice mode and nothing was cut: the reply is still playing
                # (or composing). There is nothing to resume or re-ask.
                pass
            elif self._vad_started_t and self._barged_onset == self._vad_started_t:
                # This burst's final arrived FIRST and already went to the
                # model as a real barge-in — the "cut" is that barge-in's own.
                # One burst, one response: the model's. Resuming as well put
                # two producers on the line for one "तो।" (call afa21bf4) and
                # one "हं?" (call 4a594125, both 2026-10-14).
                logger.info("turn-gate: this burst's words are already the model's turn "
                            "— not resuming the cut words as well")
                if (time.time() - self._vad_started_t <= self._resume_on_stop_secs
                        and not self._is_bot_speaking()):
                    # The safety net stays: if that turn's run never makes a
                    # sound (swallowed, or cut before a word played), the
                    # answer is asked for once. It stands down whenever the
                    # model's reply is pending or playing.
                    await self._answer_check_after_stt(
                        FrameDirection.DOWNSTREAM, time.time() - self._vad_started_t)
            elif self._resume_on_stop_secs > 0 and self._vad_started_t:  # noqa: SIM102
                # Their voice has stopped and it was SHORT, and we were cut
                # before finishing a question — so they cannot have been
                # answering one. Resume now instead of waiting out the STT
                # final (0.25-4.07 s on Sarvam, call 1e374b99). If the words
                # turn out to be a real turn, its final interrupts us exactly
                # as any barge-in does.
                _voice = time.time() - self._vad_started_t
                # VAD frames are BROADCAST by the aggregator, so this one
                # arrived travelling UPSTREAM — and every frame we originate
                # here used to inherit that direction. The resume went up the
                # pipeline into the STT and vanished, silently: calls
                # b41b481f, 0c42d3a6, 9050a3e1, 42106148 — every lost resume
                # and every "hello" left unanswered came through this branch.
                # (Traced hop by hop in the timing sim, 2026-09-21: pushed by
                # the turn-gate, never seen by RunGuard.)
                _down = FrameDirection.DOWNSTREAM
                if _voice <= self._resume_on_stop_secs and not self._is_bot_speaking():
                    if (not self._played_tail_is_question()
                            and await self._resume_cut_words(
                                _down, "%.1fs of voice over our reply" % _voice)):
                        pass
                    else:
                        # Nothing played yet to resume: the noise cancelled the
                        # reply while the model was still writing it, so their
                        # turn has no answer at all. Call 3b5fb592: a 0.02 s
                        # blip killed the answer to "मैं बच्चे का पिता बोल रहा हूँ"
                        # and the caller waited 6 s for an apology instead.
                        await self._answer_check_after_stt(_down, _voice)
        elif isinstance(frame, UserStoppedSpeakingFrame):
            self._user_turn_open = False
            self._set_user_speaking(False)
            self._on_activity(user=True)  # give them thinking time from speech END
        # FINAL transcriptions only. pipecat 1.4's Google STT emits
        # InterimTranscriptionFrame (a TranscriptionFrame subclass) continuously —
        # treating interims as turns would spam the transcript, the dedupe window
        # and the turn-gate. Interims exist for the turn-stop strategy, not us.
        if (isinstance(frame, TranscriptionFrame)
                and not isinstance(frame, InterimTranscriptionFrame)
                and frame.text and frame.text.strip()):
            text = frame.text.strip()
            now = time.time()
            # A newer final supersedes an acknowledgement waiting for the reply
            # to end (the absorb branch sets it again if this one is one too).
            self._acked_mid_reply = None
            _rp = getattr(self._outcome, "replay", None)
            if _rp is not None:
                _rp["finals"].append([round(now - self._outcome.connected_at, 2), text])
            # The previous final, carrier or not: the operator's sentence lands
            # in pieces ("The person you are calling is not" + "available.",
            # "at the t" + "one, please record…" — 2026-09-15) and a piece may
            # match only when joined to the one before it.
            prev_final, self._prev_final = self._prev_final, text
            # When the PREVIOUS final landed — read below by the carrier-adjacent
            # guard, after self._prev_final_t has become this final's own time
            # (that guard's "< 1.0 s" was always true; 2026-10-14 review).
            prev_final_t = self._prev_final_t
            # Only a phrase that SPANS the boundary counts: a previous final that
            # matched on its own would otherwise make everything after it a
            # carrier line ("…forwarded to voicemail." + "haan ji bol raha hoon").
            joined_carrier = (bool(prev_final) and now - self._prev_final_t < 4.0
                              and not is_carrier_announcement(prev_final)
                              and is_carrier_announcement(prev_final + " " + text))
            # Same for the hold recording ("The person you are" + "speaking with.").
            joined_hold = (bool(prev_final) and now - self._prev_final_t < 4.0
                           and not is_hold_announcement(prev_final)
                           and is_hold_announcement(prev_final + " " + text))
            self._prev_final_t = now
            _ivr = ivr_menu_key(text)
            if _ivr:
                self._ivr_lines[_ivr] = self._ivr_lines.get(_ivr, 0) + 1
            # The OPERATOR's recorded message is not the callee. Record it (the
            # answering-machine detector reads these markers) then stop: it must
            # not stamp transcript_t (which would make _greet_when_ready skip our
            # opening), must not interrupt, and above all must not reach the LLM.
            # On call 77cb4b47 it did all three — "Your call has been forwarded to
            # voicemail." became the first user message and conditioned EVERY
            # generation for the next 2.5 minutes.
            #
            # Only before the callee has actually said something: after that, a
            # match is far more likely to be the caller quoting us than the network.
            if self.screener_seen and self._human_turns == 0 and is_screener_hold(text):
                # The screen is still talking ("Please stay on the line") —
                # not the person. Keep waiting for their "Hello".
                self._record_absorbed(text)
                logger.info("turn-gate: screener hold line %r — waiting for the person", text[:40])
                self._on_activity(user=True)
                self._on_transcript(backchannel=True)
                await self._release_user_turn(frame, direction)
                return
            if self._in_machine_window() and (is_carrier_announcement(text) or joined_carrier):
                self._outcome.transcript.append({"role": "user", "text": text})
                if self._diag is not None:
                    self._diag.bump("carrier_announcements")
                logger.info("turn-gate: carrier announcement %r — not the callee, "
                            "dropping from context", text[:48])
                # The recording is still talking, so the short "turns" just
                # before this line were pieces of it, not a person: six
                # voicemails on 2026-10-14 (a5e314ee, 1c138e52, 36ac8abe,
                # 2ba1ff7a, 5a180c97, 960251f2 — even a "Hello." between two
                # of its sentences) disarmed the voicemail hang-up this way and
                # ran 42-57 s of nudges and a farewell into the recorder. Only
                # turns BEFORE a carrier line:
                # whoever speaks after the recording's last line is a person.
                # Not a screener or a call-connect bridge: those play while a
                # person may be picking up, and their "Hello." is the person.
                # (looks_like_voicemail only counts these pieces once the
                # recorder's own prompt has played — _voicemail_seen.)
                _pieces = ([] if is_call_screener(text) or is_call_connect(text) else
                           [t for t in self._turns_after_carrier
                            if now - t <= RECORDING_PIECE_SECS])
                if is_voicemail_prompt(text) or (
                        joined_carrier and is_voicemail_prompt(prev_final + " " + text)):
                    self._voicemail_seen = True
                if _pieces:
                    self._recording_turns += len(_pieces)
                    logger.info("turn-gate: %d short turn(s) just before this carrier line "
                                "were the recording, not the callee", len(_pieces))
                self._turns_after_carrier = []
                self._carrier_seen = True
                if is_call_screener(text):
                    self.screener_seen = True
                    self._screened = True
                    self._heard_since_screen = False
                if self._hold_since:
                    # "…has put your call on hold." is a carrier phrase too; it is
                    # still a piece of the hold recording for the scrap timing.
                    self._hold_line_t = now
                # Heard, just not the callee: stamp it, or the silence after a
                # recording reads as a swallowed utterance and the orphan
                # re-ask apologises to a voicemail (timing sim, 2026-09-15).
                self._on_transcript(backchannel=True)
                if self._duck is not None and self._duck.is_ducked():
                    await self._on_absorb(None)
                await self._release_user_turn(frame, direction)
                return
            # ── on hold ──────────────────────────────────────────────────────
            # The person put the call on hold and the network plays its looping
            # announcement (call 6d81124d, 2026-10-14: the bot answered the
            # recording a dozen times, logged a reply loop, then introduced itself
            # again when the father came back). While on hold the recording is
            # neither an answer nor a barge-in: keep quiet until something that is
            # not the recording arrives — that is the person — then carry on from
            # where the conversation was. Only after the call has started, so the
            # machine window's own screener/carrier handling above keeps the start.
            # BEFORE the machine-window scrap rules below: an IVR that answers the
            # call ("Welcome to New Light Institute. Stay on the line…", call
            # 9519f8c6, 2026-10-14) puts us on hold inside that window, where a
            # 1-2 word "See shortly." or the representative's "Hello." would
            # otherwise be dropped as a machine-greeting scrap.
            back_from_hold = False
            if self._hold_since:
                if hold_absorbs(text, now - self._hold_line_t):
                    await self._absorb_hold_line(frame, direction, text)
                    return
                held = now - self._hold_since
                self._hold_since = 0.0
                self.hold_ended_t = now
                back_from_hold = True
                logger.info("turn-gate: back from hold after %.0fs — %r", held, text[:30])
                if self._diag is not None:
                    self._diag.bump("hold_returns")
                if (self._hold_unheard and self._resay_opening is not None
                        and not takes_over_opening(text)
                        and await self._resay_opening(text, force=True)):
                    # The IVR took our opening, as a call screener does: the
                    # person's "Hello." gets it again from the top (the screener
                    # pickup below, calls 612f5e37 / 91d1541e). Without this the
                    # run-guard held their hello for an opening nobody was going
                    # to say (replay of 9519f8c6: 2.7 s of silence, then the model
                    # answered the SECOND hello with no introduction at all). A
                    # question, a refusal or busy takes over, as it does over the
                    # opening itself: the model answers it (HOLD_FIRST_CUE below).
                    self._last_text = text.casefold()
                    self._last_text_t = now
                    self._outcome.transcript.append({"role": "user", "text": text})
                    self._human_turns += 1
                    self._heard_since_screen = True
                    self._on_activity(user=True)
                    self._on_transcript(backchannel=True)
                    if self._duck is not None and self._duck.is_ducked():
                        await self._on_absorb(None)
                    await self._release_user_turn(frame, direction)
                    return
                # Their line is a NORMAL turn from here on: the gate below forwards
                # it to the aggregator, which runs the model on their words, and
                # "नहीं चाहिए, फ़ोन रखिए" still gets the forced goodbye. The first
                # cut sent it straight to the model with "carry on… ask it again"
                # and returned, so a refusal after a hold got the question again
                # (review of 53b6e16b04, 2026-10-14). The cue goes in first, so it
                # reads as context for the words that follow, not instead of them.
                if not (caller_wants_to_end(text) or caller_is_busy(text)):
                    # A hold that began before the bot had spoken (the IVR case):
                    # whatever we said went to the recording, so this person has
                    # heard nothing — "do not introduce yourself" would be wrong.
                    cue = ((HOLD_FIRST_CUE_GENERAL if self._general_agent else HOLD_FIRST_CUE)
                           if self._hold_unheard else HOLD_RESUME_CUE)
                    if self._hold_unheard:
                        self._heard_since_screen = True     # the model introduces us now
                    await self.push_frame(LLMMessagesAppendFrame(
                        messages=[{"role": "user", "content": cue}]),
                        FrameDirection.DOWNSTREAM)
            # Once we KNOW the line is playing a recording, the scraps between
            # its recognisable sentences are that same recording. Call 38536b71
            # died on a single one: 'तो।' — one word, no phrase match, so it
            # counted as the callee and _greet_when_ready skipped our opening
            # again (greetPath "callee_spoke_first"), even though the four real
            # announcements around it were all filtered correctly.
            #
            # Deliberately narrow: only BEFORE we have spoken (after that the
            # caller is answering us and every word matters) and only 1-2 word
            # scraps.
            #
            # NO LONGER requires _carrier_seen, and no longer spares audio-checks
            # — call 2fc70065 (2026-08-13) proved both conditions were the hole.
            # The operator announcement arrives in FRAGMENTS and its first one was
            # bare "Hi.", which matches no carrier phrase, so it counted as the
            # callee and drove a full LLM reply; the recognisable fragment ("If you
            # record your") landed 0.6s LATER and armed the latch after the damage.
            # The caller's own "Hello." then absorbed into a second generation, and
            # the caller heard Shreya introduce herself TWICE in four seconds
            # ("अच्छा अभी तो आपने बताया, दो बार क्यों बता…" — they said so on the line).
            #
            # The asymmetry is what makes swallowing these safe: before we have
            # spoken, OUR OPENING is the right answer to any greeting, and it is
            # already queued (suppresses_opening ignores 1-2 word scraps, so the
            # greet still fires). If it was the operator we have dodged a
            # duplicate introduction; if it was the callee they get greeted
            # properly a moment later. Neither branch needs a generation.
            # Once the line has identified itself as a recording, a short
            # unmatched piece inside the machine window is that recording, not
            # a person: "at the t" (call 0938aaa0, 2026-09-15) counted as a
            # human turn, disarmed the voicemail hang-up, and the bot nudged a
            # voicemail twice more — 46 s of telephony.
            _toks = text.split()
            if (self._in_machine_window() and self._carrier_seen and len(_toks) <= 4
                    and not back_from_hold
                    and (len(_toks[-1].strip(".,?!")) == 1        # cut mid-word: "at the t"
                         or text[0].islower())):                  # a tail: "is available."
                # NOT a capitalised word on its own — "Raman", "No.", "Yeah." after
                # a voicemail fragment are the human (call ab194522).
                self._outcome.transcript.append({"role": "user", "text": text})
                if self._diag is not None:
                    self._diag.bump("carrier_announcements")
                logger.info("turn-gate: recording scrap %r after a carrier phrase — dropping",
                            text[:32])
                self._on_transcript(backchannel=True)
                if self._duck is not None and self._duck.is_ducked():
                    await self._on_absorb(None)
                await self._release_user_turn(frame, direction)
                return
            # …and the premise is false outright once the greet has SKIPPED
            # the opening because the callee spoke first: call 9fd6489d
            # (2026-10-14) dropped the person's "Hello." twice here, the first
            # reply was held off the line, and they heard nothing for 15 s.
            # A line-check from them is the person, not a recording.
            if (self._in_machine_window()
                    and not self._bot_spoke_once()
                    and not back_from_hold
                    and len(text.split()) <= 2
                    and not (self._greet_skipped()
                             and (is_audio_check(text) or caller_checking_presence(text)))):
                self._outcome.transcript.append({"role": "user", "text": text})
                # The premise above — "our opening is already queued and will
                # answer this" — is false when the VAD killed the opening before
                # ONE frame of audio played. Call ab194522 (2026-09-10): the
                # caller's "hello" landed 23ms after the greet was queued, the
                # opening never started, bot_spoke_once stayed False for the
                # whole machine window, and "No." then "Yeah." — real answers —
                # were dropped here. 5.8s of silence, "hello hello hello", hang
                # up. resay_opening only acts once the scripted greet was queued
                # and nothing of it reached the line, so an operator fragment
                # BEFORE the greet still takes the drop below.
                if (self._resay_opening is not None
                        and await self._resay_opening(text)):
                    return
                if self._diag is not None:
                    self._diag.bump("carrier_announcements")
                logger.info("turn-gate: machine-greeting scrap %r — dropping", text[:32])
                self._on_transcript(backchannel=True)
                if self._duck is not None and self._duck.is_ducked():
                    await self._on_absorb(None)
                await self._release_user_turn(frame, direction)
                return
            # Not on the person's own return line: joined to the recording's last
            # piece ("The person you are" + "speaking with, नाम ऋषभ है") it can
            # spell a hold phrase that neither half is.
            if ((self._human_turns > 0 or self._bot_spoke_once()) and not back_from_hold
                    and (is_hold_announcement(text) or joined_hold)):
                self._hold_since = now
                # Nobody has heard us yet: the bot has not spoken, the opening
                # is still owed (it played into the IVR, cut before half of it),
                # or it played in full to a call screener and nobody has heard
                # us since (call 68bdcbcf, 2026-10-14: "Thanks." / "Please stay
                # on the line." from the screen — the person's "Hello." then got
                # "do NOT introduce yourself" and hung up without a name).
                self._hold_unheard = (not self._bot_spoke_once() or self._opening_owed()
                                      or (self._screened and not self._heard_since_screen))
                if self._diag is not None:
                    self._diag.bump("holds")
                logger.info("turn-gate: the call is on hold (%r) — quiet until the person "
                            "is back%s", text[:40],
                            " (they have not heard us)" if self._hold_unheard else "")
                if self._is_bot_speaking() or self._reply_in_flight():
                    # Nobody is listening to the rest of it.
                    await self.broadcast_interruption()
                # A verbatim resume waiting out its settle would play into the
                # hold; the words are un-recorded so the model may say them when
                # the person is back. Runs (replies, cues, re-asks) are dropped
                # at RunGuard's door while on hold (calls 22f80a85, d8146538,
                # 68bdcbcf, 2026-10-14).
                self._cancel_resume_check(stale=True)
                await self._absorb_hold_line(frame, direction, text)
                return
            ducked = self._duck is not None and self._duck.is_ducked()
            # A final with no letter or digit ("।", "?") is punctuation the engine
            # attached to nothing. Call 31763255 (2026-09-12): a bare "।" was a
            # "real barge-in" that killed a two-sentence reply.
            if not any(ch.isalnum() for ch in text):
                logger.info("turn-gate: letterless final %r — ignoring", text[:8])
                self._on_activity(user=True)
                if ducked:
                    await self._on_absorb(None)
                return
            # The tail of the previous final (see turntake.is_fragment_continuation)
            # while a reply is playing or in flight: same utterance, so the reply
            # keeps going and the words still reach the context. Before this,
            # every such tail was a barge-in: reply killed, regenerated, and then
            # suppressed as a repeat — the "long gaps" and "repeating" of 31763255.
            if (self._last_text and is_fragment_continuation(
                    self._last_text, text, now - self._last_text_t)
                    and self._gate_enabled()
                    and (self._is_bot_speaking() or self._reply_in_flight()
                         or self._recently_cut()
                         or (self._duck is not None and self._duck.has_pending_audio()))):
                logger.info("turn-gate: fragment continuation %r of %r — absorbing, "
                            "not interrupting", text[:24], self._last_text[-24:])
                # "Hell" + "o" over our opening (call f28888b2): the pieces
                # never read as a hello, the LLM answered "Hell o" with the
                # pitch, and the caller heard a call that "started from the
                # middle". Joined, it is the hello — say the opening again.
                joined = "".join((self._last_text + text).split())
                if (self._resay_opening is not None
                        and (caller_checking_presence(joined) or is_audio_check(joined))
                        and await self._resay_opening(joined)):
                    self._last_text = (self._last_text + " " + text.casefold()).strip()
                    self._last_text_t = now
                    return
                t = self._outcome.transcript
                if t and t[-1].get("role") == "user":
                    t[-1]["text"] = (t[-1]["text"] + " " + text).strip()
                else:
                    t.append({"role": "user", "text": text})
                self._last_text = (self._last_text + " " + text.casefold()).strip()
                self._last_text_t = now
                self._on_activity(user=True)
                self._on_transcript(backchannel=True)
                await self.push_frame(LLMMessagesAppendFrame(
                    messages=[{"role": "user", "content": text}]), direction)
                await self._on_absorb(text)
                return
            # Drop an identical repeat within 4s (greeting spam: "Hello" x3 while the
            # bot warms up/opens). Recorded once; repeats never reach the LLM, so the
            # model can't answer the same hello twice.
            if (text.casefold() == self._last_text and now - self._last_text_t < 4.0
                    and self._bot_stopped_t() < self._last_text_t
                    # …but only while something of ours is on its way. Into our
                    # SILENCE a second "Hello?" is the caller telling us they
                    # hear nothing — call 9050a3e1: it was dropped here and the
                    # third one, 7 s later, got the reply.
                    and (self._is_bot_speaking() or self._reply_in_flight()
                         or self._resume_pending() or not self._bot_spoke_once())):
                logger.info("transcript dedupe: dropping repeat %r", text[:30])
                self._on_activity(user=True)
                # The words WERE heard — stamp transcript time so the VAD-orphan
                # can't treat a heard-and-dropped repeat as a swallowed utterance
                # and apologise "I couldn't hear you" (deep-review A1).
                self._on_transcript()
                if ducked:
                    # A dropped repeat must still release the held reply, or the
                    # duck sits until the watchdog timeout for no reason.
                    await self._on_absorb(None)
                await self._release_user_turn(frame, direction)
                return
            self._last_text = text.casefold()
            self._last_text_t = now
            self._outcome.transcript.append({"role": "user", "text": text})
            self._human_turns += 1
            if (self._carrier_seen and self._in_machine_window()
                    and len(text.split()) <= 4):
                # Possibly a piece of the recording: decided by the next carrier
                # line, if one follows (see the carrier branch above).
                self._turns_after_carrier.append(now)
            # The person is on the line and talking to us: the screener is
            # history. Left armed, a mid-conversation "Hello?" replayed the whole
            # opening 2 min 20 s into call 196838de and the caller hung up. A
            # hello itself is the pickup the resay below is for — not this.
            if not (is_audio_check(text) or caller_checking_presence(text)):
                self.screener_seen = False
            # A real answer means a person is on the line hearing us. The
            # screen's own relays are one or two words ("Available.", "Thanks.",
            # calls d8146538 / 68bdcbcf) and must not count.
            if (self._screened and len(text.split()) >= 3
                    and not (is_call_screener(text) or is_screener_hold(text))):
                self._heard_since_screen = True
            self._on_activity(user=True)
            # We said goodbye and they said "Thank you." / "Okay, bye." That is
            # their goodbye, not re-engagement. Call 82c1f95a (2026-09-15): it
            # re-opened the call, the model had nothing left, and the last thing
            # the caller heard was "Yes, go ahead."
            if self._end_pending() and caller_says_goodbye(text):
                logger.info("turn-gate: caller's goodbye after ours (%r) — closing", text[:24])
                self._on_transcript(backchannel=True)
                if self._duck is not None and self._duck.is_ducked():
                    await self._on_absorb(None)
                await self._release_user_turn(frame, direction)
                return
            # The phone screened us: our opening played to a recorder, and this
            # is the person finally picking up. Whatever the played transcript
            # says, THEY have heard none of it — say the opening again and let
            # it be the answer to their hello (calls 612f5e37, 91d1541e).
            if (self.screener_seen and self._resay_opening is not None
                    and (is_audio_check(text) or caller_checking_presence(text))):
                self.screener_seen = False
                if self._is_bot_speaking():
                    # The opening is still playing into what was the screener;
                    # the person picked up in the middle of it. Cut it, then
                    # start it again from the top (call 28570ec0: 12 s of the
                    # tail, then the whole thing again).
                    logger.info("turn-gate: person picked up mid-opening — cutting it to restart")
                    await self.broadcast_interruption()
                if await self._resay_opening(text, force=True):
                    self._heard_since_screen = True
                    self._on_transcript(backchannel=True)
                    if self._duck is not None and self._duck.is_ducked():
                        await self._on_absorb(None)
                    return
            # Mid-reply = a reply is audibly playing, OR held by a duck. NOT
            # "ducked" by itself: ducked with nothing held and the bot quiet
            # means the reply ENDED during the hold — a backchannel then is an
            # answer to its closing question, not an interruption. When the VAD
            # missed the onset (no duck — the 8e1e00ad failure mode) the bot is
            # still speaking, so is_bot_speaking() carries the trigger.
            # "Mid-reply" now includes JUST-CUT, because interrupting at VAD
            # onset means the bot is already silent by the time the words arrive
            # (~1.5s later, STT). Without this the absorb path could never fire
            # and every "haan" ended the bot's turn — measured on the probe: the
            # model answered the acknowledgment from a standing start instead of
            # finishing its sentence.
            mid_reply = self._gate_enabled() and (
                self._is_bot_speaking()
                or (self._duck is not None and self._duck.has_pending_audio())
                or self._recently_cut()
                # ...or the reply exists but has not reached the line yet.
                or self._reply_in_flight())
            if mid_reply:
                if text.startswith("["):
                    # Synthetic noise cue mid-reply: nothing to answer, nothing
                    # worth interrupting — release any hold and move on.
                    self._on_transcript(backchannel=True)
                    await self._release_user_turn(frame, direction)
                    await self._on_absorb(None)
                    return
                if mid_reply_action(
                        text, extra_backchannels=self._backchannel_extra) == ABSORB:
                    if self._caller_forming():
                        # Their turn is still FORMING (words in the aggregator,
                        # not yet a run): this "हाँ" is part of it, not a
                        # backchannel to our reply. Forward it as an ordinary
                        # final — no cue run of its own; the turn's run answers
                        # all of it (call c05f6c83: a cue at 30.88 s and their
                        # turn at 31.36 s, two replies).
                        logger.info("turn-gate: %r while their turn is forming — "
                                    "part of it, not a backchannel", text[:24])
                        self._on_transcript()
                        await self.push_frame(frame, direction)
                        return
                    # "Absorb but never lose" (founder decision 2026-08-05): the
                    # reply continues (resumes if held) AND the ack still reaches
                    # the LLM context — run_llm omitted, so no generation. The
                    # aggregator never sees this turn, so pipecat's min-words and
                    # emulated-VAD paths cannot delete it (ANSWER_DELETED).
                    self._on_transcript(backchannel=True)
                    await self._release_user_turn(frame, direction)
                    # Call 34f258c2 (2026-09-11): "…fees ka follow-up? Is that you?"
                    # → caller "Yes." → the HELD tail "Or does someone help?" resumed
                    # after the answer, twice in one call. A short reply to a question
                    # that has already been asked is its answer, not a backchannel:
                    # drop the held tail and let the model respond to the answer.
                    # NOT gated on duck.has_pending_audio(): TTS delivers a reply
                    # faster than real time, so by the time the caller answers, the
                    # tail sits in the TRANSPORT's queue, not in DuckGate (timing
                    # sim yes_over_tail; production "dropping 0 held frame(s)").
                    # broadcast_interruption() is what clears that queue.
                    if ducked and self._played_ended_with_question():
                        logger.info("turn-gate: %r answers the question already asked — "
                                    "dropping the held tail, not resuming it", text[:20])
                        await self.broadcast_interruption()
                        await self.push_frame(LLMMessagesAppendFrame(
                            messages=[{"role": "user", "content": text}]), direction)
                        await self.push_frame(LLMMessagesAppendFrame(
                            messages=[{"role": "user", "content":
                                       "[That was their ANSWER to the question you had "
                                       "just asked — respond to that answer only. Do not "
                                       "finish, repeat or rephrase the question, and do "
                                       "not say their answer back to them.]"}],
                            run_llm=True), direction)
                        return
                    logger.info("turn-gate: absorbed backchannel %r "
                                "(ducked=%s, cut=%s)", text[:30], ducked,
                                self._interrupt_on_vad())
                    if (self._cut_after > 0 and not self._was_cut()
                            and self._is_bot_speaking()):
                        # Voice mode: the reply never stopped. If it ends on a
                        # question and this came near its end, it is the answer
                        # (handled when the reply finishes); otherwise it was
                        # just "I'm listening" and needs nothing at all.
                        #
                        # It is an ASIDE, not a turn: kept out of the call
                        # transcript and the model's context. Recorded in the
                        # middle of the reply it split the bot's own sentence in
                        # two ("…Aarushi" + "from Vacademy"), and everything that
                        # reads what the caller just heard — the opening check,
                        # the last question, the report — saw a fragment.
                        self._unrecord_aside(text)
                        self._acked_mid_reply = (text, self._vad_started_t or time.time())
                        logger.info("turn-gate: %r over the reply — kept talking", text[:20])
                        if self._diag is not None:
                            self._diag.bump("acks_talked_through")
                        return
                    await self.push_frame(LLMMessagesAppendFrame(
                        messages=[{"role": "user", "content": text}]), direction)
                    await self._on_absorb(text)
                    if (self._resumed_t and time.time() - self._resumed_t < 8.0
                            and (self._is_bot_speaking() or self._resume_pending())):
                        # The words they missed are already playing — or are
                        # about to, once the TTS teardown settles. Their "हम्म"
                        # is in the context; there is nothing to generate, and
                        # generating anyway is how two voices ended up on the
                        # line. If that resume was cut or abandoned, the task is
                        # done and the bot is quiet, so we fall through.
                        logger.info("turn-gate: already resuming the cut words — "
                                    "no cue for %r", text[:20])
                        self._resumed_t = 0.0
                        return
                    if self._reply_pending():
                        # The answer to this turn is already being composed and
                        # nothing of it has played. Call 8e2041c8 (2026-09-22):
                        # "मैं बच्चे का पिता बोल रहा हूँ" started run #1; "बोलिए"
                        # 90 ms later was read as the ANSWER to the question the
                        # bot had last played, started run #2, which repeated
                        # run #1's question, was dropped as already-said, asked
                        # for a next step (run #3), and the father heard "जी सर।
                        # जी सर। जी, बोलिए।" for 11 s. It is in the context; the
                        # reply on its way is the reply.
                        logger.info("turn-gate: %r while the answer is already on its way "
                                    "— nothing to generate", text[:20])
                        return
                    if self._was_cut():
                        # The callee's pickup "Hello" lands INSIDE our opening:
                        # call 9e566e32 (2026-09-09) said "Hello" 250ms into
                        # "Hi, is this Shreyash?…", the VAD cut the opening after
                        # "Hi,", and the cue below — "carry on… do not re-greet"
                        # — sent the model straight to "Thanks. So the reason I
                        # called…". The caller never learned who was calling and
                        # hung up at 11s. Two people who say hello at once do
                        # not "carry on"; the caller repeats the greeting.
                        if (self._resay_opening is not None
                                and await self._resay_opening(text)):
                            return
                        if self._opening_owed() and self._is_bot_speaking():
                            # The (re-said) opening is still playing and still
                            # owed: an ack over it needs no reply of its own —
                            # the opening IS the reply. The cue below put the
                            # model's answer right after the opening's own
                            # question, so the caller heard two questions back
                            # to back (call 8208166f replayed, 2026-10-01).
                            logger.info("turn-gate: %r over the opening still playing "
                                        "— no cue", text[:20])
                            return
                        # Call 7003c36a (2026-09-09): "Actually I am busy for
                        # classes" -> "No problem. When would be a better time
                        # for me to call you back today?" -> caller: "Yeah." —
                        # spoken over the last word of the question, so it
                        # landed here as a backchannel and the carry-on cue
                        # below marched the model into the pitch. A "yes" right
                        # after a question the caller HEARD is the answer to it.
                        if self._played_ended_with_question():
                            if caller_checking_presence(text) and self._last_played_question():
                                # "Hello?" after our question is not its answer:
                                # they lost the line. Call b2f6330a: the ANSWER
                                # cue sent the model into the pitch.
                                q = self._last_played_question()
                                logger.info("turn-gate: %r is a line check, not an answer "
                                            "— re-asking %r", text[:16], q[:40])
                                await self.push_frame(LLMMessagesAppendFrame(
                                    messages=[{"role": "user", "content": presence_cue(q)}],
                                    run_llm=True), direction)
                                return
                            logger.info("turn-gate: %r answers the question just "
                                        "asked — not a carry-on", text[:20])
                            await self.push_frame(LLMMessagesAppendFrame(
                                messages=[{"role": "user", "content":
                                           "[That was their ANSWER to the question you "
                                           "had just finished asking — respond to that "
                                           "answer only. Do NOT ask that question again, "
                                           "do not rephrase it as a check, and do not say "
                                           "their answer back to them: go straight to your "
                                           "next line. Do not carry on with your "
                                           "script. If they agreed to a callback or "
                                           "asked to end, close politely.]"}],
                                run_llm=True), direction)
                            return
                        # The VAD onset already cancelled the reply, and a
                        # cancelled reply cannot be un-cancelled. Duck-only
                        # (holding the audio instead of cancelling) is NOT
                        # available: measured on the deployed image 2026-08-06,
                        # INTERRUPT_ON_VAD=false gives 1.92s of talk-over
                        # against 0.52s with it on. So: cancel fast, then say
                        # the cut words AGAIN ourselves (the branch below) —
                        # and only ask the model for a line when there is
                        # nothing left to resume.
                        if is_audio_check(text):
                            self._audio_checks += 1
                        else:
                            self._audio_checks = 0
                        if (self._audio_checks < 2
                                and await self._resume_cut_words(
                                    direction, "backchannel %r" % text[:16])):
                            # Words we emitted and they never heard: the reply
                            # did NOT finish, whatever bot_speaking says now
                            # (the VAD onset cancelled it). Say them — no cue,
                            # no generation, nothing for the model to shorten.
                            self._resumed_t = 0.0
                            return
                        if self._audio_checks >= 2:
                            # Twice in a row means the line is genuinely bad.
                            # Re-delivering the sentence a third time is what
                            # made call 77cb4b47 unlistenable: cut -> "hello?"
                            # -> cut -> "hello?", four times in eleven seconds.
                            # Say one short thing and then STOP talking.
                            cue = ("[They have said hello twice now — they are "
                                   "not hearing you properly. Say ONE short "
                                   "sentence asking whether they can hear you, "
                                   "then stop. Do NOT repeat your question, do "
                                   "NOT restart your pitch, do NOT re-greet.]")
                        elif (not self._is_bot_speaking()
                              and not (self._duck is not None
                                       and self._duck.has_pending_audio())
                              and not self._last_reply_had_question()):
                            # The reply had FINISHED (nothing playing, nothing
                            # held) — a "yes" over a statement still in
                            # progress carries on as before.
                            # Call 15aadcdb (2026-09-13): "It is offline." →
                            # "It's all offline right now." (an echo, no
                            # question) → "yes" → carry-on cue → another echo,
                            # four rounds. A reply that asked nothing has
                            # nothing to carry on from: demand the next step.
                            cue = ("[They acknowledged. Your last line only "
                                   "restated what they told you and asked "
                                   "nothing. Now take the NEXT step in one "
                                   "sentence: ask your next question, or if "
                                   "what they said means this is not for "
                                   "them, close politely. Do not restate "
                                   "their answer again.]")
                        else:
                            # With the words they actually heard: without them
                            # the model restarted the cut sentence from its
                            # first word and the caller heard ten seconds
                            # again (call 196838de, 2026-09-15).
                            heard = self._heard_tail()
                            cue = (("[They just acknowledged you. They heard you up "
                                    "to: \"" + heard + "\". Now carry on from right "
                                    "after those words, in one short sentence — do not "
                                    "repeat what they heard, do not restart the "
                                    "sentence, do not re-greet.]") if heard else
                                   ("[They just acknowledged you — carry on "
                                    "from where you were interrupted, in one "
                                    "short sentence. Do not restart or "
                                    "re-greet.]"))
                        # A continuation must ADD, never restate: arm the strict
                        # no-repeat bar for the reply this cue generates. Call
                        # 17be14f2's audible repetition was this exact reply
                        # paraphrasing the intro past the normal 0.80 bar.
                        self._on_continuation()
                        await self.push_frame(LLMMessagesAppendFrame(
                            messages=[{"role": "user", "content": cue}],
                            run_llm=True), direction)
                    return
                self._on_transcript(substantive=suppresses_opening(text))
                # Real barge-in. If ducked, the line is already silent and this
                # makes it formal; if the VAD missed the onset the bot is STILL
                # TALKING and this is what finally stops it — late beats never.
                # broadcast_interruption (the 1.4 API) pushes InterruptionFrame
                # both directions from HERE: downstream it cancels the in-flight
                # generation, drops any held tail in DuckGate and clears Plivo's
                # buffer; the aggregator closes the assistant turn as interrupted
                # so its played text is committed (prevents the verbatim
                # re-opening seen on 8e1e00ad). The transcript is then forwarded
                # below as a fresh, normal turn.
                if (self._in_machine_window() and self._carrier_seen
                        and prev_final_t and now - prev_final_t < 1.0
                        and len(text.split()) <= 2
                        and self._human_turns - self._recording_turns <= 1):
                    # Call 9050a3e1 (2026-09-21): the operator's "…is not
                    # available" landed as "The person you're trying to reach."
                    # / "Not." / "Not available." — the middle piece is
                    # capitalised, so the scrap rule rightly spares it as a
                    # possible human "No.", but letting it CUT the opening
                    # 1.1 s in is a different matter. Keep it in the context
                    # (a real "No." still gets answered after the opening) and
                    # let the opening play. Whoever it was hears a complete
                    # sentence either way.
                    logger.info("turn-gate: %r right after a carrier line while the opening "
                                "plays — keeping it, not cutting the opening", text[:20])
                    self._on_transcript(backchannel=True)
                    await self.push_frame(LLMMessagesAppendFrame(
                        messages=[{"role": "user", "content": text}]), direction)
                    await self._release_user_turn(frame, direction)
                    return
                self._audio_checks = 0
                logger.info("turn-gate: real barge-in %r — interrupting reply "
                            "(ducked=%s)", text[:40], ducked)
                # They took the turn: the words we were resuming are stale.
                self._cancel_resume_check(stale=True)
                # …and this voice onset is spent. Its VAD stop must not resume
                # the cut words too, and the voice-cut timer armed for it must
                # not fire later: on calls 5e979e3e and 662d1c80 (2026-10-14)
                # it fired 22-500 ms into the opening this barge-in re-said,
                # cut it, and the caller got 14 s of silence.
                if self._vad_started_t:
                    self._barged_onset = self._vad_started_t
                t, self._voice_cut_task = self._voice_cut_task, None
                if t is not None and not t.done():
                    t.cancel()
                # Their words go downstream BEFORE the cut. The interruption's
                # job is the bot's audio, which does not care about order; the
                # transcript, pushed 30 ms after our own interruption, has been
                # arriving at the aggregator during its interruption handling
                # and going missing — 19 of 133 calls in 48 h logged "caller
                # answer never reached the model"; call 59888de8 lost "नहीं
                # यही सब" this way and she hung up 27 s later.
                await self.push_frame(frame, direction)
                forwarded = True
                # They cut in with a QUESTION: the model must answer it, not go
                # back to the sentence it lost. Call 2983bf1f (2026-09-24): "तो
                # Ma'am कैसे क्या होगा… मेरा बच्चा mobile… पढ़ाई हो सकती?" reached
                # the model whole, and it replied "जी मैम। आपको एक online
                # dashboard मिलता है…" — the cut sentence, re-delivered. Pushed
                # BEFORE the interruption, like the words themselves, so it
                # cannot go missing in the aggregator's interruption handling.
                # Once per burst of pieces; never while the opening is owed.
                if (is_question(text) and self._bot_spoke_once()
                        and not caller_asked_to_repeat(text)
                        and time.time() - self._question_cue_t > 4.0):
                    self._question_cue_t = time.time()
                    logger.info("turn-gate: %r cut in with a question — steering the "
                                "model to answer it first", text[:32])
                    await self.push_frame(LLMMessagesAppendFrame(messages=[{
                        "role": "user", "content":
                        "[They cut you off with a QUESTION. Answer that question "
                        "first, directly, in one or two sentences. Do not go back "
                        "to what you were saying and do not re-say the sentence "
                        "they interrupted.]"}]), direction)
                self._self_cut_t = time.time()
                await self.broadcast_interruption()
                # If that cut our opening before it was heard and what they
                # said is not a question or a refusal, the opening is still
                # owed (call 4243a436: room chatter cut it at 3 of 221 chars).
                if self._resay_opening is not None and not takes_over_opening(text):
                    try:
                        await self._resay_opening(text, cut_now=True)
                    except TypeError:
                        await self._resay_opening(text)
            elif ducked:
                # The reply finished while we were ducked (nothing held, bot
                # quiet): this is just a normal turn — release the duck flag
                # and let the aggregator answer it.
                self._on_transcript()
                await self._on_absorb(None)
            else:
                self._on_transcript(substantive=suppresses_opening(text))
            # Filler only when the bot is quiet AND has spoken once already — a
            # barge-in has audio to cancel, and a filler before the opening meant
            # the first thing the caller ever heard was "Hmm…".
            #
            # Every guard above is about the BOT's state; none asked whether the CALLER
            # had finished. Two things then went wrong together, and the client heard
            # both as "too much hmm-ing":
            #
            #   * saaras splits one halting utterance into fragment finals (see
            #     diagnostics.reconcile_answers — "नहीं जान।" + "सकते हैं आप।"), and EVERY
            #     fragment was its own roll. A sentence that split five ways had a ~41%
            #     chance of a filler at p=0.10, spoken INTO the caller's own speech.
            #   * nothing stopped a second filler covering the same silence.
            #
            # So: never while the VAD says voice is live (acoustic truth, not the
            # turn frames, which lag by seconds), and at most one per gap between the
            # bot's turns. A filler after the caller genuinely stops is unaffected —
            # by then the final trails the last voice tick by ~0.65s, well past the
            # window — which is the latency mask this exists for.
            # Strictly positive: at call start both stamps are 0.0, and '0 >= 0' would
            # latch the very first filler off before any gap had been filled.
            already_filled = (self._last_filler_t > 0.0
                              and self._last_filler_t >= self._bot_stopped_t())
            if (self._filler_phrases and not self._is_bot_speaking()
                    and not (self._duck is not None and self._duck.is_ducked())
                    and self._fillers_armed()
                    and not text.startswith("[")     # synthetic cue, not real speech
                    and not self._voice_live()
                    and not already_filled
                    and random.random() < self._filler_probability):
                self._last_filler_t = time.time()
                await self.push_frame(
                    TTSSpeakFrame(random.choice(self._filler_phrases)), direction)
            # "Cut the call" / "not interested" / "wrong number" / "bye": the
            # model gets ONE line, and the sentinel ends the call after it no
            # matter what it wrote (call ada2e60c: "Just to clarify…" instead).
            if caller_wants_to_end(text) and self._bot_spoke_once():
                self._outcome.end_forced = True
                logger.info("turn-gate: caller asked to end (%r) — forcing the close", text[:40])
                await self.push_frame(LLMMessagesAppendFrame(
                    messages=[{"role": "user", "content":
                               "[The caller just asked to end this call. Reply with ONE short, "
                               "polite goodbye line — no question, no offer, no clarification, "
                               "no pitch — and append " + END_MARKER + ".]"}]), direction)
            # "Hello? Hello?" after the bot's question is a line check, not an
            # answer. Call f08f5712 (2026-09-12): the model replied "Yes, I'm
            # here." and stopped; the caller, still without the question, said
            # hello four more times and hung up. Confirm AND put the question
            # back on the line.
            elif (caller_checking_presence(text) and self._bot_spoke_once()
                  and not text.startswith("[")):
                q = self._last_played_question()
                if q:
                    logger.info("turn-gate: caller is checking the line (%r) — re-asking %r",
                                text[:24], q[:48])
                    await self.push_frame(LLMMessagesAppendFrame(
                        messages=[{"role": "user", "content": presence_cue(q)}]), direction)
            # "Aap kaun bol rahi ho?" — the answer must come FIRST. Call 91d1541e
            # (2026-09-15): the model re-asked the child's name (dropped as a
            # repeat), then gave its name as the third sentence: 4 s of waiting.
            elif (caller_asks_who(text) and self._bot_spoke_once()
                  and not text.startswith("[")):
                logger.info("turn-gate: caller asked who is calling — answer first")
                await self.push_frame(LLMMessagesAppendFrame(
                    messages=[{"role": "user", "content":
                               WHO_CUE_GENERAL if self._general_agent else WHO_CUE}]),
                    direction)
        if not forwarded:
            await self.push_frame(frame, direction)

    def on_hold_for(self) -> float:
        """Seconds the person has had us on hold (0 when not on hold)."""
        return time.time() - self._hold_since if self._hold_since else 0.0

    def on_hold(self) -> bool:
        """The person has us on hold right now. Not on_hold_for() > 0: on a
        coarse clock a run checked in the same tick as the hold began read 0."""
        return self._hold_since > 0

    async def _absorb_hold_line(self, frame, direction, text: str) -> None:
        """A piece of the hold recording: on the record, out of the model's context,
        and not a barge-in. Stamped as heard, so the silence around it is not taken
        for a swallowed utterance (the VAD-orphan re-ask)."""
        self._record_absorbed(text)
        self._hold_line_t = time.time()
        if self._diag is not None:
            self._diag.bump("hold_lines")
        self._on_activity(user=True)
        self._on_transcript(backchannel=True)
        if self._duck is not None and self._duck.is_ducked():
            await self._on_absorb(None)
        await self._release_user_turn(frame, direction)

    def answers_heard(self) -> List[str]:
        """The caller lines the model was meant to receive — ANSWER_DELETED's
        `heard` side (diagnostics.split_lost), read once at the end of the call."""
        tr = self._outcome.transcript
        # Carrier recordings are kept in the transcript (LIKELY_MACHINE reads
        # those markers) but are deliberately NOT in the context — so they
        # are not "answers the model never saw". Without this exclusion the
        # fix that filters them MANUFACTURES an ANSWER_DELETED fault: call
        # 14029bd6's panel read "2 caller answers were discarded", quoting
        # the voicemail system back at us.
        # Pickup noises said before the bot's first word are dropped ON
        # PURPOSE — the opening is their answer (machine-greeting scrap) —
        # so they are not answers the model missed either. Counting them
        # put "हम दस।" and "कोन दीदी?" on the 23 Sep panel as lost answers.
        first_bot = next((i for i, t in enumerate(tr)
                          if t.get("role") == "assistant"), len(tr))
        return [t.get("text") or "" for i, t in enumerate(tr)
                if i > first_bot
                and t.get("role") == "user"
                and not (t.get("text") or "").lstrip().startswith("[")
                and not is_carrier_announcement(t.get("text") or "")
                # The hold recording, absorbed on purpose (_absorbed).
                and not self.is_absorbed(t)
                # An acknowledgement ("ठीक।", "Okay जी") is talked
                # through in voice mode and kept OUT of the model's
                # context on purpose — not a lost answer. 8 of the 11
                # ANSWER_DELETED samples on 24 Sep were exactly these.
                and mid_reply_action(t.get("text") or "") != ABSORB]

    def _record_absorbed(self, text: str) -> None:
        entry = {"role": "user", "text": text}
        self._outcome.transcript.append(entry)
        self._absorbed.append(entry)

    def is_absorbed(self, entry) -> bool:
        """A transcript entry the gate kept from the model on purpose (the hold
        recording): not a caller answer the model lost."""
        return any(entry is e for e in self._absorbed)

    def looks_like_voicemail(self) -> bool:
        """The carrier's recording is the only thing that has spoken. Call
        24089872 (2026-09-12): "forwarded to voicemail… at the tone" was the
        whole caller side, and the bot still nudged twice and left a
        "lost you" farewell — 40 s of telephony and three TTS lines to a
        machine. Only carrier PHRASES arm this (is_carrier_announcement), never
        a scrap or silence, so a quiet human is not mistaken for a recording.

        Turns the recording itself produced (a piece that another carrier line
        followed — see RECORDING_PIECE_SECS) do not count as the callee: a5e314ee,
        1c138e52, 36ac8abe, 2ba1ff7a, 5a180c97 and 960251f2 (2026-10-14) each had
        one or two and ran 42-57 s. Anything said after the recording's last
        line still does, so a person who says "Hello" then is never hung up on."""
        if not self._voicemail_seen:
            # Only a recorder's own prompt makes the pieces the recording: a
            # person's "हाँ" between two generic lines ("not available", "कृपया
            # बाद में") must not be hung up on in silence (review 2026-10-14).
            return self._carrier_seen and self._human_turns == 0
        return self._carrier_seen and self._human_turns <= self._recording_turns

    def looks_like_ivr_loop(self) -> bool:
        """A phone menu is replaying itself: one menu line has played
        IVR_LOOP_REPEATS times. The bot cannot press a key, so nobody will ever
        pick up behind it (call 5856b13f: 8 minutes, 34 replies to the menu)."""
        return any(n >= IVR_LOOP_REPEATS for n in self._ivr_lines.values())

    def wordless_onsets_since(self, since: float) -> int:
        """How many times the caller's voice started after `since` without one
        word reaching us since then — 0 once any final has arrived."""
        if self._prev_final_t > since:
            return 0
        return sum(1 for t in self._vad_onsets if t > since)

    def _last_reply_had_question(self) -> bool:
        """Did the bot's most recent played reply ask anything?"""
        t = self._outcome.transcript
        for entry in reversed(t[:-1] if t and t[-1].get("role") == "user" else t):
            if entry.get("role") == "assistant":
                return "?" in (entry.get("text") or "") or "？" in (entry.get("text") or "")
        return True

    def _unrecord_aside(self, text: str):
        """Take a talked-through acknowledgement back out of the call
        transcript, re-joining the bot's sentence it had split."""
        t = self._outcome.transcript
        for i in range(len(t) - 1, max(-1, len(t) - 5), -1):
            if t[i].get("role") == "user" and t[i].get("text") == text:
                del t[i]
                if (0 < i < len(t) and t[i - 1].get("role") == "assistant"
                        and t[i].get("role") == "assistant"):
                    t[i - 1]["text"] = (t[i - 1]["text"] + " " + t[i]["text"]).strip()
                    del t[i]
                return

    def _was_cut(self) -> bool:
        """Was the reply stopped? The pipeline's own answer, or ours — the gate
        knows the instant it cuts, the pipeline ~0.1 s later. Call 0808862f
        (2026-09-23): the gate stopped the reply after 0.7 s of voice; "हाँ जी
        बिल्कुल" landed 0.1 s later, read as an aside over a still-playing reply,
        and nothing resumed — 8 s of silence, then "Hello?" re-asked the marks
        question the caller had already answered, because the closing question
        he had never heard was not the last one PLAYED.

        Only a cut of what is on the line NOW (cut_still_current, call
        edbbe7b3)."""
        if self._interrupt_on_vad():
            return True
        if self._self_cut_t <= 0 or time.time() - self._self_cut_t >= 3.0:
            return False
        return cut_still_current(self._self_cut_t, self._is_bot_speaking(),
                                 self._bot_started_t())

    def _voice_stopped(self) -> bool:
        """Bookkeeping for a VAD stop; always True so it can sit in an elif."""
        self._voice_on = False
        t, self._voice_cut_task = self._voice_cut_task, None
        if t is not None and not t.done():
            t.cancel()
        return True

    def _arm_voice_cut(self):
        """Voice mode: the bot keeps talking through the caller's sound, and
        stops only if the sound turns into talk — barge_in_voice_secs of it —
        or its words turn out to be a real interruption (the transcript path)."""
        t, self._voice_cut_task = self._voice_cut_task, None
        if t is not None and not t.done():
            t.cancel()
        if self._cut_after <= 0 or not self._gate_enabled():
            return
        if not (self._is_bot_speaking() or self._reply_in_flight()):
            return
        try:
            self._voice_cut_task = self.create_task(self._cut_if_still_talking(self._vad_started_t))
        except Exception:
            logger.debug("turn-gate: no task manager for the voice cut")

    async def _cut_if_still_talking(self, onset_t: float):
        try:
            await asyncio.sleep(self._cut_after)
            if not self._voice_on or self._vad_started_t != onset_t:
                return
            if self._barged_onset == onset_t:
                return                  # this onset already cut the reply (a real barge-in)
            if not (self._is_bot_speaking() or self._reply_in_flight()):
                return
            logger.info("turn-gate: caller has talked %.1fs over the reply — stopping it",
                        self._cut_after)
            if self._diag is not None:
                self._diag.bump("voice_cuts")
            self._acked_mid_reply = None
            self._self_cut_t = time.time()
            await self.broadcast_interruption()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("turn-gate: voice cut failed")

    async def _answer_ack_after_reply(self, text: str, ack_t: float, stop_t: float):
        """The reply ended after the caller said "हाँ"/"जी" over it without it
        stopping. If the reply ended on a question and the acknowledgement came
        near its end, that WAS their answer — respond to it now, instead of
        both sides waiting. An earlier one was just "I'm listening"."""
        try:
            await asyncio.sleep(0.4)
            if self._acked_mid_reply is None or self._acked_mid_reply[0] != text:
                return                          # a newer final took over
            if (self._is_bot_speaking() or self._reply_pending() or self._voice_live()
                    or self._recently_cut() or self._end_pending()):
                return                          # more of the reply, or they are talking
            self._acked_mid_reply = None
            if is_audio_check(text) or caller_checking_presence(text):
                return                          # "Hello" at pickup — they will answer
            if stop_t - ack_t > self._ack_answer_window:
                return                          # it acknowledged earlier content
            last = ""
            for entry in reversed(self._outcome.transcript):
                if entry.get("role") == "assistant":
                    last = (entry.get("text") or "").strip()
                    break
            # NOT "ends with ?": the scripted close puts a short sentence after
            # the question. Call 71d0d5bd (2026-10-02): "…WhatsApp कर दूँ?
            # पंद्रह questions हैं, सिर्फ पंद्रह मिनट लगते हैं।" — the mother's
            # "हाँ" over that last sentence was dropped here as "just
            # listening"; 15 s of silence, two nudges, the question again, 29 s
            # to the next line. The same tolerance the ducked and cut paths use.
            if not ends_on_question(last):
                return
            q = last_question_in(last) or last[-120:]
            logger.info("turn-gate: %r came over the end of %r — answering it", text[:20], q[:40])
            self._outcome.transcript.append({"role": "user", "text": text})
            self._last_text_t = time.time()
            await self.push_frame(LLMMessagesAppendFrame(
                messages=[{"role": "user", "content": text}]), FrameDirection.DOWNSTREAM)
            await self.push_frame(LLMMessagesAppendFrame(
                messages=[{"role": "user", "content":
                           "[While you were asking \"" + q + "\" they said \"" + text + "\" — "
                           "that is their ANSWER to it. Respond to that answer only: do not "
                           "ask the question again, do not rephrase it as a check, do not say "
                           "their answer back to them. Go straight to your next line.]"}],
                run_llm=True), FrameDirection.DOWNSTREAM)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("turn-gate: deferred answer failed")

    async def _release_user_turn(self, frame, direction):
        """Close the caller's turn in the aggregator after we swallow a final.

        pipecat's TurnAnalyzerUserTurnStopStrategy holds the turn open after
        Smart Turn says COMPLETE until it has seen a TranscriptionFrame for it;
        a final we absorb (a backchannel, a carrier line, a scrap, a repeat)
        never reaches it, so the turn stays open for the whole 5 s
        user_turn_stop_timeout. Inside that window nothing we push is heard —
        every lost resume in calls 9050a3e1 and 42106148 was sent there — and
        the aggregator will not run the model either. A whitespace-only final
        satisfies the strategy (it only checks that text arrived) while the
        aggregator ignores it (no content, nothing aggregated, no run), and the
        strategy resets on every stop, so nothing leaks into the next turn."""
        if not self._user_turn_open or not self._release_turn():
            return
        direction = FrameDirection.DOWNSTREAM
        try:
            await self.push_frame(TranscriptionFrame(
                " ", getattr(frame, "user_id", "") or "", getattr(frame, "timestamp", "") or "",
                language=getattr(frame, "language", None)), direction)
        except Exception:
            logger.exception("turn-gate: could not release the caller's turn")

    async def _answer_check_after_stt(self, direction, voice: float):
        """A short burst with no transcript YET is not noise until the STT has
        had its window. Call bd9e6a0d (2026-09-21): "हाँ Ma'am" was declared
        noise at its VAD stop, 65 ms before its own final arrived; the cue and
        the answer both ran the model and the parent heard the same question
        twice — twice in that call. Decide after noise_reask_wait_secs, and
        only if nothing was transcribed since the stop."""
        stop_t = time.time()

        async def _later():
            try:
                await asyncio.sleep(self._noise_reask_wait_secs)
                if self._last_text_t > stop_t or self._hold_line_t > stop_t:
                    return                      # it was words, and they were handled
                if self._is_bot_speaking() or self._reply_pending():
                    return
                await self._answer_never_arrived(direction, voice)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("turn-gate: noise re-ask check failed")
        try:
            self.create_task(_later())
        except Exception:
            await self._answer_never_arrived(direction, voice)

    async def _answer_never_arrived(self, direction, voice: float) -> bool:
        """Their turn was answered by a generation that a noise cancelled before
        one word of it played. Ask for that answer again — not for them to
        repeat themselves, which is what the orphan re-ask used to do."""
        if self._hold_since:
            # Nobody is there to hear it. Call 22f80a85 (2026-10-14): the
            # screen's "Please stay on the line." landed after the VAD stop, was
            # absorbed as the hold, and 1 s later this re-asked into the hold —
            # with the hold line itself as "their turn".
            return False
        t = self._outcome.transcript
        if not t or t[-1].get("role") != "user":
            return False                       # the last thing heard was ours
        said = (t[-1].get("text") or "").strip()
        if len(said.split()) < 2 or said.startswith("["):
            return False                       # a scrap, not a turn owed an answer
        if self._reran_for == said:
            return False                       # once per turn
        self._reran_for = said
        direction = FrameDirection.DOWNSTREAM
        logger.info("turn-gate: %.2fs of noise killed the reply before they heard any of it "
                    "— asking for it again (their turn: %r)", voice, said[:40])
        cue = ("[A noise on the line cut your reply off before they heard a single "
               "word of it. Say that reply now, in one or two short sentences. Do "
               "not apologise, and do not ask them to repeat anything.]")
        self._register_cue(cue)
        await self.push_frame(LLMMessagesAppendFrame(
            messages=[{"role": "user", "content": cue}], run_llm=True), direction)
        return True

    async def _resume_cut_words(self, direction, why: str) -> bool:
        """Say the exact words the caller did not hear, with no model in the
        loop. Call 1e374b99 (2026-09-17): a "हम्म" over a reply cost a full LLM
        round trip (1.7-5.9 s of silence, fifteen times) and the re-generated
        sentence lost its opening clause to the no-echo trimmer, so the parent
        heard "नाम क्या है…" and had to ask "किसका नाम?"."""
        if self._resume_unplayed is None or self._hold_since:
            return False                       # on hold: nobody is there to hear it
        if self._reply_pending():
            # The model is already answering this moment (a real barge-in's
            # turn, held or composing): the cut words are its to say or drop.
            # A second short burst while it composed resumed them on top of it
            # — two voices for one moment (afa21bf4 replayed, review
            # 2026-10-14). The caller's reply is on its way; nothing to add.
            logger.info("turn-gate: %s — a reply is already on its way, not resuming", why)
            return False
        try:
            tail = self._resume_unplayed(self._resume_max_chars)
        except Exception:
            logger.exception("turn-gate: could not read the unplayed tail")
            return False
        if not tail:
            return False
        self._resumed_t = time.time()
        self._resume_stale = False
        logger.info("turn-gate: %s — resuming the %d unheard words verbatim: %r",
                    why, len(tail.split()), tail[:60])
        self._cancel_resume_check()
        try:
            self._resume_check = self.create_task(self._deliver_resume(tail, direction))
        except Exception:
            # No task manager (a bare unit harness, or teardown): say it now and
            # skip the settle and the did-it-play check.
            logger.debug("turn-gate: no task manager — sending the resume unchecked")
            await self.push_frame(TTSSpeakFrame(tail, append_to_context=True), direction)
        return True

    async def _deliver_resume(self, text: str, direction):
        direction = FrameDirection.DOWNSTREAM   # never inherit a broadcast's direction
        """Get the cut words to the caller, or give them back to the model.

        pipecat's InterruptibleTTSService handles an interruption by clearing
        its serialisation queue and its frame sequencer and then reconnecting
        the vendor socket. Anything pushed into that window is discarded with
        no error: the resume was lost that way on 3 of its first 4 production
        attempts (calls 0c42d3a6, b41b481f), and on b41b481f it cost the parent
        a 66-word explanation — he answered "sorry एक बार समझा नहीं… मेरे को बस
        ये समझ आया कि नाम". So wait the teardown out, then judge by what
        actually PLAYED, and if the words never arrived give them back to the
        model instead of leaving them marked as said."""
        try:
            await asyncio.sleep(self._resume_settle_secs)
            if self._resume_stale or self._hold_since:
                return
            logger.info("turn-gate: resume → pushing %d words", len(text.split()))
            await self.push_frame(TTSSpeakFrame(text, append_to_context=True), direction)
            for attempt in (1, 2):
                await asyncio.sleep(1.2)
                if self._resume_stale or self._heard_in_played(text):
                    return
                if self._is_bot_speaking():
                    return                      # it is on the line right now
                if self._reply_pending():
                    break                       # the model is writing; never two voices
                if attempt == 1:
                    logger.warning("turn-gate: the resumed words never reached the line "
                                   "(the vendor socket was reconnecting) — saying them again")
                    if self._diag is not None:
                        self._diag.bump("resume_respoken")
                    self._resumed_t = time.time()
                    await self.push_frame(TTSSpeakFrame(text, append_to_context=True), direction)
            if not self._heard_in_played(text):
                # Never heard: they must stop counting as "already said", or the
                # model's own copy is suppressed and the words leave the call
                # altogether (call b41b481f).
                self._forget_resumed()
                # Handing the words back is inert unless the model is actually
                # asked to speak — call 42106148: un-recorded at 13.1 s, then
                # 12 s of nothing until the caller asked "are you using AI?".
                if (not self._reply_pending() and not self._is_bot_speaking()
                        and self._rerun_for_resume != text):
                    self._rerun_for_resume = text
                    heard = self._heard_tail()
                    logger.warning("turn-gate: the resumed words were lost twice — asking "
                                   "the model to finish the thought")
                    cue = (("[The line dropped the end of your last reply; they "
                            "heard nothing after: \"" + heard + "\". Say the rest "
                            "now, in one or two short sentences. Do not restart, "
                            "re-greet or apologise.]") if heard else
                           "[The line dropped the end of your last reply. Say the "
                           "rest now, in one or two short sentences. Do not "
                           "restart, re-greet or apologise.]")
                    self._register_cue(cue)
                    await self.push_frame(LLMMessagesAppendFrame(
                        messages=[{"role": "user", "content": cue}], run_llm=True), direction)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("turn-gate: resume delivery failed")

    def _resume_pending(self) -> bool:
        """A resume is scheduled but not audible yet (the settle window)."""
        t = self._resume_check
        return t is not None and not t.done() and not self._resume_stale

    def _heard_in_played(self, text: str) -> bool:
        key = spoken_key(text)[:60]
        played = spoken_key(" ".join(e.get("text") or "" for e in self._outcome.transcript[-4:]
                                     if e.get("role") == "assistant"))
        return bool(key) and key in played

    def _forget_resumed(self):
        if self._forget_resume is None:
            return
        try:
            if self._forget_resume():
                logger.warning("turn-gate: the resumed words never played — un-recording them "
                               "so the model may say them")
                if self._diag is not None:
                    self._diag.bump("resume_lost")
        except Exception:
            logger.exception("turn-gate: could not un-record the lost resume")

    def _cancel_resume_check(self, stale: bool = False):
        """The caller has taken the turn (or a newer resume replaced this one):
        whatever was cut is stale, and re-sending it would fight the reply the
        model is already writing. `stale` also un-records the words — the
        caller is never going to hear them now."""
        t, self._resume_check = self._resume_check, None
        if t is not None and not t.done():
            if stale:
                self._resume_stale = True
                self._forget_resumed()
            t.cancel()

    def _heard_tail(self, words: int = 12) -> str:
        """The last words of what the caller actually heard (played transcript)."""
        for entry in reversed(self._outcome.transcript):
            if entry.get("role") == "assistant" and (entry.get("text") or "").strip():
                return " ".join((entry["text"] or "").split()[-words:])
        return ""

    def _last_played_question(self) -> str:
        """The last question the caller HEARD (played transcript), or ''."""
        t = self._outcome.transcript
        for entry in reversed(t[:-1] if t and t[-1].get("role") == "user" else t):
            if entry.get("role") != "assistant":
                continue
            q = last_question_in(entry.get("text") or "")
            if q:
                return q
        return ""


class PlayedTranscriptRecorder(FrameProcessor):
    """Sits AFTER transport.output(): records assistant speech from TTSTextFrames,
    which the transport releases at PLAYOUT position — i.e. text the caller
    actually HEARD. Replaces generation-time commits (deep-review A3): stalled or
    interrupted replies used to enter the transcript in full, so the disposition
    analyzer judged conversations that never happened (live 'Wrong_Number' on a
    caller who heard nothing) — while nudges/farewells/fillers the caller DID
    hear were never recorded (they ride TTSSpeakFrame, which also emits
    TTSTextFrames, so this captures them too). Consecutive assistant clauses
    merge into one transcript entry until a caller turn intervenes."""

    def __init__(self, outcome: CallOutcome):
        super().__init__()
        self._outcome = outcome
        self._last_chunk = ""
        self._entry_chunks: set = set()

    # Since the speech cache put each sentence in its own audio context
    # (2026-08-25), pipecat's sequencer force-completes a slot at the end of
    # that context and re-emits its "remaining" text — so a sentence lands here
    # twice ("Great, thanks. Great, thanks.", "Just a second. Just a second.";
    # 6 duplicates on call 34f258c2, 2026-09-11) although the RECORDING plays it
    # once. Left in, the duplicate reaches the health rules (REPLY_LOOP) and the
    # assistant aggregator — the model then sees itself repeating and imitates.
    @staticmethod
    def _same(a: str, b: str) -> bool:
        na = " ".join(a.split()).casefold()
        nb = " ".join(b.split()).casefold()
        return bool(na) and na == nb

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TTSTextFrame) and frame.text and frame.text.strip():
            t = self._outcome.transcript
            chunk = frame.text.strip()
            norm = " ".join(chunk.split()).casefold()
            if t and t[-1]["role"] == "assistant":
                # Not only the previous chunk: the sequencer re-emits a whole
                # GROUP ("Okay, I understand. Thank you for your time, namaste."
                # twice on call ada2e60c). Within one assistant entry — no caller
                # turn between — a repeated sentence of three or more words is
                # that artefact, never speech.
                if (self._same(chunk, self._last_chunk) or self._same(t[-1]["text"], chunk)
                        or (len(chunk.split()) >= 3 and norm in self._entry_chunks)):
                    logger.info("played: dropping duplicate text frame %r", chunk[:48])
                    await self.push_frame(frame, direction)
                    return
                t[-1]["text"] = (t[-1]["text"] + " " + chunk).strip()
                self._entry_chunks.add(norm)
            else:
                t.append({"role": "assistant", "text": chunk})
                self._entry_chunks = {norm}
            self._last_chunk = chunk
        await self.push_frame(frame, direction)


class DuckGate(FrameProcessor):
    """Between TTS and transport.output(): instant-stop barge-in ("ducking").

    THE PROBLEM (founder, 2026-08-05: "when the human talks the bot takes ages
    to stop"): with interruption_strategies set, pipecat 0.0.95 defers ALL
    interruption handling to the user aggregator, which only decides after the
    caller's turn fully ENDS — utterance + VAD stop + STT final + aggregation
    wait ≈ 2.5-4s of the bot talking over the caller. And a turn under the word
    minimum is silently discarded (ANSWER_DELETED on 67% of calls).

    THE FIX: the moment the caller audibly starts speaking over a reply
    (UserStartedSpeakingFrame is a SystemFrame — it jumps every queue), this
    gate HOLDS the reply's frames instead of forwarding them to the transport.
    The transport paces audio in real time (write_audio_frame emulates an audio
    device), so holding here silences the line within one Plivo jitter buffer
    (~200-300ms). Then TranscriptCollector decides on the caller's words:
    backchannel → resume() (the reply continues mid-sentence, nothing lost);
    real speech → a formal InterruptionFrame arrives here and drops the held
    tail (the caller already heard silence, not talk-over). A voiced sound with
    no words at all (cough) is resumed by the watchdog's DUCK_RESUME.

    Holds LLMFullResponseStart/End and TTSStarted/Stopped ALONGSIDE audio and
    text deliberately: the assistant aggregator downstream brackets its context
    commit on those frames, and letting an End overtake its held text would
    commit an empty assistant turn (the A2 repeat class all over again).
    """

    _HOLDABLE = (TTSAudioRawFrame, TTSTextFrame, TTSStartedFrame, TTSStoppedFrame,
                 LLMFullResponseStartFrame, LLMFullResponseEndFrame)

    def __init__(self, enabled, is_bot_speaking, on_duck, on_unduck, diag,
                 on_interrupt=None):
        super().__init__()
        self._enabled = enabled
        self._is_bot_speaking = is_bot_speaking
        self._on_duck = on_duck
        self._on_unduck = on_unduck
        self._on_interrupt = on_interrupt or (lambda: None)
        self._diag = diag
        self._held: deque = deque()
        self._ducked = False
        # Bumped on every duck/interrupt so a resume() that lost the race to a
        # NEW duck (system frames run out-of-band) stops flushing and stays held.
        self._gen = 0

    def is_ducked(self) -> bool:
        return self._ducked

    def has_pending_audio(self) -> bool:
        return bool(self._held)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InterruptionFrame):
            # Stamp WHEN the reply died, so a backchannel whose words land after
            # the cut can still be answered with "carry on" instead of the model
            # replying to a bare "haan" from a standing start. Not for a
            # superseded reply: it never made a sound, there is nothing to
            # carry on from, and the newer reply is already on its way.
            if not isinstance(frame, SupersedeInterruptionFrame):
                self._on_interrupt()
            # The reply is formally dead — the held tail must never play.
            if self._held or self._ducked:
                logger.info("duck: interruption — dropping %d held frame(s)",
                            len(self._held))
            self._held.clear()
            self._gen += 1
            if self._ducked:
                self._ducked = False
                self._on_unduck()
            await self.push_frame(frame, direction)
            return
        if isinstance(frame, UserStartedSpeakingFrame):
            if (self._enabled() and not self._ducked
                    and (self._is_bot_speaking() or self._held)):
                self._ducked = True
                self._gen += 1
                self._diag.bump("ducks")
                self._on_duck()
                logger.info("duck: caller speaking over reply — holding bot audio")
            await self.push_frame(frame, direction)
            return
        if isinstance(frame, EndFrame) and (self._ducked or self._held):
            # A graceful stop is draining the pipeline; a held farewell must
            # play BEFORE the line closes, not be leapfrogged by the EndFrame.
            await self.resume("end_frame")
            await self.push_frame(frame, direction)
            return
        if (self._ducked and direction == FrameDirection.DOWNSTREAM
                and isinstance(frame, self._HOLDABLE)):
            self._held.append(frame)
            return
        await self.push_frame(frame, direction)

    async def resume(self, reason: str = ""):
        """Release the held reply, in order. Safe to call when not ducked."""
        if not self._ducked and not self._held:
            return
        gen = self._gen
        n = 0
        while self._held and self._gen == gen:
            await self.push_frame(self._held.popleft(), FrameDirection.DOWNSTREAM)
            n += 1
        if self._gen == gen and self._ducked:
            self._ducked = False
            self._on_unduck()
        logger.info("duck: resumed (%s) — released %d held frame(s)", reason, n)


class FloorGate(FrameProcessor):
    """Between TTS and transport.output(): never START a reply over a caller
    who is talking.

    THE BUG (call 358e5026, 2026-09-23, and 0.34-0.38 "stub cascades" per
    call on both the gemma4 and the Gemini day): a parent who speaks in
    pieces — "बच।" … "बच्चों के class ये हैं।" … "Sir बच्चों के class ये
    हैं।" — gets a reply to every piece. The reply is composed in ~0.3 s, and
    by the time its audio reaches the line the parent has already begun the
    next piece (voice onset 47.39, bot audio 47.68). 0.7 s later the voice
    cut stops it and the line hears a stub: "आप मुझे एक समय बता" / "मैं समझ"
    / "मैं समझ गई" / "मैं आपसे पूछ रही थी" / "कि". 12 cuts, 21 abandoned
    replies in that one call.

    THE RULE: when a reply's FIRST audio is ready and the caller's voice is
    live, hold the reply instead of starting it. Nothing has been played, so
    holding is free — the caller hears no talk-over, and callers who pause
    normally never meet the gate. Then the turn-gate decides, exactly as it
    does for any reply in flight (is_holding() keeps it in flight):
      real words or 0.7 s of voice → an InterruptionFrame drops the held reply,
        and the next run answers everything they said, once;
      an acknowledgement ("हाँ", "जी") → absorbed; the voice stops and the
        held reply plays;
      a line whose "voice" never stops → played after cap_secs anyway.
    Mid-reply sound is not this gate's business (voice mode talks through it):
    only a reply STARTING on a quiet line with a talking caller is held.
    """

    _HOLDABLE = DuckGate._HOLDABLE

    def __init__(self, enabled, caller_talking, is_bot_speaking, diag=None,
                 cap_secs: float = 3.0, poll_secs: float = 0.05):
        super().__init__()
        self._enabled = enabled
        self._caller_talking = caller_talking
        self._is_bot_speaking = is_bot_speaking
        self._diag = diag
        self._cap = cap_secs
        self._poll = poll_secs
        self._held: deque = deque()
        self._holding = False
        self._hold_t = 0.0
        self._task: Optional[asyncio.Task] = None
        # Last time audio went through: a reply's later sentences arrive while
        # its first is still playing and must never be mistaken for a start.
        self._last_audio_t = 0.0

    def is_holding(self) -> bool:
        return self._holding

    def _bump(self, name: str):
        if self._diag is not None:
            self._diag.bump(name)

    def _drop(self):
        t, self._task = self._task, None
        if t is not None and not t.done():
            t.cancel()
        self._held.clear()
        self._holding = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InterruptionFrame):
            if self._holding:
                logger.info("floor: the caller took the turn — dropping the held reply "
                            "(%d frame(s), held %.2fs)", len(self._held),
                            time.time() - self._hold_t)
                self._bump("floor_holds_dropped")
            self._drop()
            await self.push_frame(frame, direction)
            return
        if direction != FrameDirection.DOWNSTREAM or not isinstance(frame, self._HOLDABLE):
            await self.push_frame(frame, direction)
            return
        if self._holding:
            self._held.append((frame, direction))
            return
        if isinstance(frame, TTSAudioRawFrame):
            now = time.time()
            starting = (not self._is_bot_speaking()
                        and now - self._last_audio_t > 0.5)
            if starting and self._enabled() and self._caller_talking():
                self._holding = True
                self._hold_t = now
                self._held.append((frame, direction))
                self._bump("floor_holds")
                logger.info("floor: the caller is talking — holding the reply until they stop")
                self._task = self.create_task(self._wait_for_floor())
                return
            self._last_audio_t = now
        await self.push_frame(frame, direction)

    async def _wait_for_floor(self):
        try:
            while self._caller_talking() and time.time() - self._hold_t < self._cap:
                await asyncio.sleep(self._poll)
            waited = time.time() - self._hold_t
            capped = waited >= self._cap
            logger.info("floor: %s — playing the held reply after %.2fs",
                        "the line never went quiet" if capped else "the caller stopped", waited)
            self._bump("floor_holds_capped" if capped else "floor_holds_released")
            # Drain with the gate still shut, so frames that arrive meanwhile
            # queue behind the held ones instead of overtaking them.
            while self._held:
                f, d = self._held.popleft()
                await self.push_frame(f, d)
                if isinstance(f, TTSAudioRawFrame):
                    self._last_audio_t = time.time()
            self._holding = False
        except asyncio.CancelledError:
            pass


class LateReplyCommitter(FrameProcessor):
    """Right before aggregators.assistant(): make sure EVERY sentence the caller
    heard is written to the model's history before they can answer it.

    pipecat's assistant aggregator commits its buffer on LLMFullResponseEndFrame.
    With one audio context per sentence (what the speech cache switches on) the
    TTS service releases that End as soon as the FIRST sentence's context ends,
    so the later sentences' words reach the buffer after the commit and sit
    there, unwritten, until some later End. Timing sim
    smallest_history_holds_last_reply_cache_on: the parent heard "Rajeev is in
    class seven right now. What marks did he get in his previous class?" and the
    history held only the first sentence — the model never knew it had asked,
    and re-asked (every founder test call, 2026-09-26; ~20-25 repeats per 100
    replies since the FIXED tier went on).

    Words that arrive with no open LLM response are committed as soon as the bot
    stops speaking — before the caller's answer. An interruption already makes
    the aggregator commit what played, so a cut sentence is covered too.
    """

    def __init__(self, diag=None):
        super().__init__()
        self._open = False
        self._late = False
        self._diag = diag

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, LLMFullResponseStartFrame):
                self._open = True
            elif isinstance(frame, LLMFullResponseEndFrame):
                self._open = False
            elif isinstance(frame, InterruptionFrame):
                self._late = False
            elif (isinstance(frame, TTSTextFrame) and not self._open
                  and getattr(frame, "append_to_context", True) and (frame.text or "").strip()):
                self._late = True
        await self.push_frame(frame, direction)
        if isinstance(frame, BotStoppedSpeakingFrame) and self._late:
            self._late = False
            from pipecat.frames.frames import LLMAssistantPushAggregationFrame
            if self._diag is not None:
                self._diag.bump("late_reply_commits")
            logger.info("history: committing reply text that arrived after its response ended")
            await self.push_frame(LLMAssistantPushAggregationFrame(), FrameDirection.DOWNSTREAM)


class TtfbObserver:
    """Corr-tagged per-turn latency telemetry. pipecat already computes per-service
    TTFB (enable_metrics=True) but only logs it uncorrelated at DEBUG inside the
    metrics module — useless for 'which call was slow'. This observer logs one INFO
    line per service per turn tagged with the call corr, so 'replies were slow on
    that call' is answerable from docker logs:  grep 'ttfb corr=<id>'."""

    def __init__(self, corr: str, diag=None):
        from pipecat.observers.base_observer import BaseObserver

        outer = self

        class _Obs(BaseObserver):
            async def on_push_frame(self, data):
                try:
                    from pipecat.frames.frames import MetricsFrame
                    from pipecat.metrics.metrics import LLMUsageMetricsData, TTFBMetricsData
                    if isinstance(data.frame, MetricsFrame):
                        # The SAME frame object is observed once per pipeline hop
                        # (~9x) — dedupe by object id or we log 9 duplicate lines
                        # per metric (measured 3.3k lines/day; real CPU on 1 vCPU).
                        fid = id(data.frame)
                        if fid in outer._seen:
                            return
                        outer._seen.append(fid)
                        if len(outer._seen) > 64:
                            outer._seen.pop(0)
                        for d in data.frame.data:
                            if isinstance(d, LLMUsageMetricsData) and d.value:
                                outer._note_llm_usage(d.processor, d.value)
                                continue
                            if isinstance(d, TTFBMetricsData) and d.value:
                                logger.info("ttfb corr=%s service=%s value=%.3f",
                                            outer._corr, d.processor, d.value)
                                # Same numbers, now CARRIED (not just logged) so
                                # "replies were slow on that call" is answerable
                                # from the UI instead of docker logs.
                                proc = (d.processor or "").lower()
                                if outer._diag is not None:
                                    # Match the service suffix, not overlapping substrings:
                                    # SmallestTTSService contains "stt", while
                                    # SarvamSTTService contains "tts".
                                    service = proc.split("#", 1)[0]
                                    if service.endswith("sttservice"):
                                        outer._diag.sample("stt_ttfb", d.value)
                                    elif service.endswith("ttsservice"):
                                        outer._diag.sample("tts_ttfb", d.value)
                                    elif "llm" in proc or "vertex" in proc or "google" in proc:
                                        outer._diag.sample("llm_ttfb", d.value)
                except Exception:
                    pass

        self._corr = corr
        self._seen: list = []
        self._diag = diag
        self.observer = _Obs()

    def _note_llm_usage(self, processor, u):
        """One line per LLM run: how much of the prompt the vendor served
        from its cache. grep 'llm usage corr=<id>'."""
        prompt = int(getattr(u, "prompt_tokens", 0) or 0)
        cached = int(getattr(u, "cache_read_input_tokens", 0) or 0)
        out = int(getattr(u, "completion_tokens", 0) or 0)
        if not (prompt or out):
            return                 # a cancelled run reports zeros — not a run
        logger.info("llm usage corr=%s service=%s prompt=%d cached=%d out=%d",
                    self._corr, processor, prompt, cached, out)
        if self._diag is not None:
            self._diag.bump("llm_runs")
            self._diag.bump("llm_prompt_tokens", prompt)
            self._diag.bump("llm_cached_tokens", cached)
            self._diag.bump("llm_completion_tokens", out)


class NoRepeatGate(FrameProcessor):
    """Between the LLM and the TTS: never say the same sentence twice in a call.

    THE PROBLEM the founder kept hearing: the bot re-asks its own closing
    questions — "kya aap fees ke baare mein jaanna chahenge?", "kya main is
    WhatsApp number par link bhej doon?" — several turns after it already asked
    them, because nothing tracks which questions have been put to the caller.

    WHY IN CODE. Four prompt-level attempts failed, each measured over 3+ live
    conversations against the real model: style rules in the system prompt
    (1.7 -> 1.7 repeats, and they broke script and gender), no-echo rules with
    worked examples in the script (3.0 -> 3.0 echoes), deleting the scripted
    acknowledgement lines the model was parroting (2.7 -> 2.7), and changing
    model (1.0 -> 0.3, real but reverted for latency). Remembering what you
    already said is state, and a 16k-character prompt is not where state lives.

    NO LATENCY COST. pipecat's TTS already buffers to a sentence boundary before
    synthesising (hence "Generating TTS [whole sentence]" in the logs), so
    holding a sentence here to look at it costs nothing that was not already
    being spent.

    NEVER SILENT. If every sentence of a reply is a repeat, the LAST one is let
    through anyway: one repeated question is bad, a reply that vanishes and
    leaves the caller in silence is worse.
    """

    _SENT_END = re.compile(r"[.!?।]+[\s\"'\)\]]*")

    def __init__(self, enabled=None, last_caller_text=None, diag=None,
                 no_echo=None, handbacks=None, played_text=None, end_forced=None,
                 request_next_step=None, drop_stale_bridge=None, max_sentences=None,
                 max_chars=None, ending=None, primary_errored_since=None,
                 caller_turn_pending=None, child_slots=True):
        super().__init__()
        self._enabled = enabled or (lambda: True)
        # False for a non-education agent: a copied "<name>" slot is dropped,
        # never spoken as "your child" (fill_template_slots).
        self._child_slots = child_slots
        # (t) -> did the waterfall's primary LLM error at or after t, with a
        # fallback to take the turn? Then an empty reply is the failure, not the
        # model saying nothing — the fallback's re-run answers it.
        self._primary_errored_since = primary_errored_since or (lambda t: False)
        self._caller_turn_pending = caller_turn_pending or (lambda: False)
        # The most body sentences one reply may put on the line (0 = no cap).
        # Call bd9e6a0d: a five-sentence pitch became a 30 s monologue
        # (quiz → programme → fees → "identify हों…"), and the parent came back
        # with "क्या बोला Ma'am, समझा नहीं". Sentences past the cap are held;
        # if the reply ENDS on a question, that question is still asked, so the
        # turn is handed over cleanly. The context only ever holds what was
        # played, so the model picks up the rest itself next turn.
        self._max_sentences = max_sentences or (lambda: 0)
        self._max_chars = max_chars or (lambda: 0)
        self._capped: list = []
        self._last_caller_text = last_caller_text or (lambda: "")
        self._diag = diag
        self._no_echo = no_echo or (lambda: True)
        self._handbacks = tuple(handbacks) if handbacks else self._HANDBACK
        # What the caller ACTUALLY heard (recent assistant entries of the played
        # transcript). None = unknown, and the interruption branch then keeps
        # everything, i.e. the old behaviour.
        self._played_text = played_text
        self._spoken: list = []
        self._greeted = False              # one greeting per call (see _GREETING_RE)
        # The caller asked to end (outcome.end_forced): the model gets one
        # goodbye line, and a question in it is never spoken — timing sim
        # cut_the_call_forced_close: "Just to clarify…?" still played before
        # the forced close.
        self._end_forced = end_forced or (lambda: False)
        # topic -> the normalized QUESTION we actually asked about it. A dict,
        # not a set: topic membership alone is not evidence of a re-ask — see
        # _TOPIC_REASK_THRESHOLD for the call that proved it.
        self._asked: dict = {}
        # Armed by the absorb path: the NEXT response continues a cut reply, so
        # a moderate paraphrase of anything already said is a restart, not new
        # content. Call 17be14f2: the continuation re-said the intro line as
        # "वेबसाइट … पढ़ाई … enquiry डाली थी" (0.7 vs the 0.80 bar) and the
        # caller heard the introduction twice. Strictness is scoped to that one
        # response; normal replies keep the 0.80 bar and its false-positive
        # safety margin.
        self._continuation_next = False
        self._strict_this_response = False
        self._suppressions: dict = {}  # key -> drops since we last let it through
        # Sentences emitted since the last response START — i.e. the ones whose
        # audio may not have reached the caller yet. On an interruption, any of
        # these that never PLAYED are un-recorded, because "already said" must
        # mean "already heard". See the InterruptionFrame branch.
        self._pending: list = []
        # Set on an interruption: what was emitted to the TTS and never heard,
        # plus the (norm, topic) of each so they go back into _spoken when the
        # turn-gate actually resumes them.
        self._unplayed_tail: str = ""
        self._unplayed_entries: list = []
        # What take_unplayed_tail last handed to the turn-gate, so it can be
        # given back if the caller never actually heard it.
        self._resumed_entries: list = []
        self._resumed_at = 0.0
        self._buf = ""
        # How the bot addresses the caller so far ("f" madam / "m" sir): picks
        # the side of a "सर/मॅडम" pair the model copies from its prompt.
        self._address = ""
        # Set when THIS reply's end-of-reply handling asked for a fresh line, so
        # its own held restatement is not spoken on top of it (call 30cfc538).
        self._next_step_this_reply = False
        self._emitted = 0
        # Characters spoken this reply — the length budget (max_reply_chars).
        self._body_chars = 0
        self._held_tail = ""
        self._handback = 0
        # Content-free turns since the last reply that actually said something.
        # >0 means the caller's last turn was answered with "you talk" and
        # nothing else — whether that came from us or from the model.
        self._consecutive_handbacks = 0
        self._said_real = False
        self._cf_this_reply: set = set()   # fillers said in THIS reply (keys)
        self._real_this_reply = False       # anything non-filler said in THIS reply
        self._norms_this_reply: set = set() # normalised sentences said in THIS reply
        # A content-free opener we are holding rather than speaking, and the last
        # sentence the gate dropped (kept ACROSS turns, unlike _held_tail).
        self._cf_held = ""
        self._echo_held = ""           # an opening restatement, held until we know if more follows
        # Ask the model for its NEXT step when a whole reply was a repeat of
        # something the caller has just answered (see the End branch). Capped
        # per call: a second one would be a regeneration loop.
        self._request_next_step = request_next_step
        self._next_steps = 0
        # Which caller turn the last next-step request was for. Call b41b481f
        # (2026-09-19): three generations in 1.6 s, each producing the same
        # sentence, because every one of them tripped the restatement rule and
        # asked for a "next step" again. The budget is per CALL; this is per
        # TURN — the caller has to have said something new to earn another.
        self._next_step_for = None
        # Run ledger (call 22062aac, 2026-09-29). Every LLM run the RunGuard
        # lets through is counted here (note_run) and every response START is
        # counted against it, so at a reply's END we know whether a NEWER run
        # is already queued behind it. That reply has been superseded: asking
        # for a "next step" on top of it put two LLM replies on the line back
        # to back — "…कितने marks आए थे? जी सर, 9th क्लास। और बच्चे का नाम
        # क्या है सर?" (the name asked right after it was used).
        self._runs_passed = 0
        self._responses_started = 0
        self._responses_ended = 0
        self._last_run_t = 0.0
        self._last_start_t = 0.0
        # The last QUESTION the gate dropped as already-said in this reply —
        # the line a recovery should be about. _held_tail is the last dropped
        # sentence of any kind; on 22062aac that was the explanation after the
        # question ("So that मुझे उसकी performance…").
        self._held_question = ""
        # (topic, response index, normalised line): a question the model may ask again once, in
        # the next reply or two — set when a next-step cue told it "if they have
        # not answered it, ask it once more".
        self._reask_ok_topic = None
        # Replies in a row that were nothing but an acknowledgment. "जी सर।" is a
        # filler, not a handback, so _consecutive_handbacks never saw three of
        # them in a row on 22062aac — and nothing escalated.
        self._filler_streak = 0
        self._escalated_for = None
        self._killed = False           # an interruption ended the current response
        self._text_seen = True         # any text in the current response (False = an empty reply)
        self._last_reply_statement = False  # last reply said something but asked nothing
        self._ending = ending or (lambda: False)
        self._asked_this_reply = False    # a question reached the caller in THIS reply
        # "Just a second." queued while the model composed, arriving at the TTS
        # AFTER the reply's audio began (the LLM processor holds frames during a
        # generation): call dd5eb5cc heard the question, then "Just a second."
        self._drop_stale_bridge = drop_stale_bridge
        self._last_suppressed = ""

    def _trim_echo(self, sentence: str) -> str:
        """Strip a reply's opening clause when it only parrots the caller's answer.

        Applied to the FIRST sentence of a reply only: that is where the
        restatement lands ("ओके, सुबोध अभी आठवीं क्लास में है, तो …"), and a
        mid-reply clause that happens to reuse the caller's words is usually the
        bot building on them, not confirming them. See
        turntake.strip_echo_opener for what it refuses to touch.
        """
        if not self._no_echo():
            return sentence
        try:
            # The bot's own last QUESTION is half the reference set: the caller's
            # answer is short ("तिरानवे प्रतिशत") and the parroting reuses the
            # question's nouns too ("मार्क्स", "क्लास"), which the caller never said.
            bot_question = next((s for s in reversed(self._spoken) if "?" in s), "")
            out = strip_echo_opener(sentence, self._last_caller_text(), bot_question)
        except Exception:
            logger.exception("no-echo: trim failed — speaking the reply as written")
            return sentence
        if out != sentence:
            if self._diag is not None:
                self._diag.bump("echoes_trimmed")
            logger.info("no-echo: dropped parroted opener %r -> %r",
                        sentence.strip()[:56], out.strip()[:56])
        return out

    # How many times one sentence (or one question topic) may be silently
    # dropped before we let it through anyway.
    #
    # The ban used to be PERMANENT, and that is what killed call 3148ccd4. The
    # bot asked "Raman abhi kaun si class mein hai?" once, the caller — still
    # working out who was calling — never answered it, and the gate then blocked
    # all six attempts to ask again. It was not a handback problem: even on the
    # turns where some other sentence survived, the ONE question that could have
    # moved the call forward was gagged, so there was no path out.
    #
    # The model holds the whole conversation in its context. If it asks the same
    # thing a THIRD time across three separate turns, it is not being sloppy —
    # it is telling us the answer never arrived (which ANSWER_DELETED confirmed
    # on that very call). Believe it. Being wrong costs the caller one repeated
    # question; being right saves the call. The counter resets when we let one
    # through, so a model stuck in a loop still only gets one in three.
    _MAX_SUPPRESSIONS = 2

    # A topic match NARROWS the candidates; similarity must CONFIRM the re-ask.
    #
    # Topic membership alone banned a question on its FIRST delivery — twice, on
    # calls 4b1a44b9 and 761decff (2026-08-13). The script's step-4 question
    # ("कितने मार्क्स आए थे?") and its step-5 DIAGNOSTIC ("कुछ chapters में अच्छा
    # करता है और कुछ topics में marks खो देता है?") both contain the keyword
    # "marks", so question_topic files both under the same topic — but they are
    # DIFFERENT questions (similarity 0.35). The instant the bot asked for the
    # marks, the diagnostic was pre-banned: the caller answered "83%", heard
    # praise and NO question, prompted "हम्म", got a handback, and a second voice
    # on the line had to say "आप बोलिए ना, आपने phone किया है" before the
    # suppression cap released it.
    #
    # So a same-topic sentence is a re-ask only if it also RESEMBLES the question
    # we actually asked about that topic. The paraphrase this tier exists for
    # (597aeb3f: "Aur wo abhi kis class mein hai?" -> "Raman abhi kis class mein
    # padh raha hai?") scores 0.73; the false positive scores 0.35. 0.5 splits
    # them with margin on both sides.
    _TOPIC_REASK_THRESHOLD = 0.5
    # The bar for a CONTINUATION response (absorb path). 0.6 catches the
    # observed paraphrase (~0.7) with margin while leaving genuinely new
    # content (which shares little text with what played) untouched.
    _CONTINUATION_THRESHOLD = 0.6

    def mark_continuation(self) -> None:
        """The next response continues a cut reply — hold it to the strict bar."""
        self._continuation_next = True

    # A sentence that is ONLY a greeting. Under is_repeat's 22-char floor by
    # design (acks recur legitimately) — but a greeting does not: call
    # 862aa6a0 (2026-09-12) said "Good morning!" FIVE times in 30 s, once per
    # barge-in regeneration, because the caller kept answering with "Good
    # morning" and every regenerated reply re-greeted. One per call, then gone.
    _GREETING_RE = re.compile(
        r"^\W*(good\s+(morning|afternoon|evening)|hello|hi|hey|namaste|namaskar|"
        r"नमस्ते|नमस्कार|हेलो|हैलो)(\s+(ji|जी|sir|ma'?am|madam))?\W*$", re.I)

    def note_run(self) -> None:
        """RunGuard let an LLM run through (see the run ledger in __init__)."""
        self._runs_passed += 1
        self._last_run_t = time.time()

    def runs_noted(self) -> int:
        """Runs counted so far — RunGuard stamps it on a SupersedeInterruptionFrame
        so the ledger flushes exactly the superseded runs, not the newer one."""
        return self._runs_passed

    def _newer_run_queued(self) -> bool:
        """A run passed that has not started its response yet — this reply is
        about to be followed by the answer to something newer. Bounded in time:
        a run that died without a response must not disable recovery for good."""
        return (self._runs_passed > self._responses_started
                and time.time() - self._last_run_t < 4.0)

    def refund_next_step(self) -> None:
        """A next-step cue's run was dropped at the door (a reply was already on
        its way): it never ran, so it does not count against the per-call budget,
        and the same caller turn may ask again later."""
        self._next_steps = max(0, self._next_steps - 1)
        self._next_step_for = None

    def note_dropped_run(self) -> None:
        """A run RunGuard passed was dropped by a retired LLM primary: it will
        never start or end — balance the ledger so it is not "on its way"."""
        self._responses_started = min(self._responses_started + 1, self._runs_passed)
        self._responses_ended = min(self._responses_ended + 1, self._responses_started)

    def generating(self) -> bool:
        """A run passed and its reply has not finished composing (no End yet).
        Capped at 8 s so a run that died without a response cannot hold the
        call in "a reply is on its way" for good."""
        return (self._runs_passed > self._responses_ended
                and time.time() - max(self._last_run_t, self._last_start_t) < 8.0)

    def owed_line_requested(self) -> None:
        """The idle handler asked for the owed line; the next idle, if the model
        still says nothing, is an ordinary presence check."""
        self._filler_streak = 0
        self._last_reply_statement = False

    def owed_after_filler(self) -> bool:
        return self._filler_streak > 0

    def owes_line(self) -> bool:
        """The silence that follows is the BOT's, not the caller's: its last reply
        was only an acknowledgment, or a statement with no question in it (call
        963347ab: "पहली, faculty अच्छे हों…" then 8.2 s and "are you there?")."""
        return ((self._filler_streak > 0 or self._last_reply_statement)
                and not self._end_forced() and not self._ending())

    def _may_ask_next_step(self) -> bool:
        """At most five per call AND at most one per caller turn. Two ran out
        by the middle of a scripted call (97c06634): every repeat after that
        went straight to a bare handback."""
        if self._next_steps >= 5:
            return False
        turn = normalize_spoken(self._last_caller_text() or "")
        if turn and turn == self._next_step_for:
            logger.info("no-repeat: already asked for a next step on this turn — not again")
            return False
        return True

    def take_unplayed_tail(self, max_chars: int = 600) -> str:
        """The exact sentences cut off by the last interruption, once. Empty
        when the reply had finished, when everything was heard, or when it is
        too long to be a natural resumption."""
        tail, self._unplayed_tail = self._unplayed_tail, ""
        entries, self._unplayed_entries = self._unplayed_entries, []
        if not tail or len(tail) > max_chars:
            if tail:
                logger.info("no-repeat: unplayed tail too long to resume verbatim (%d chars)",
                            len(tail))
            return ""
        # They are about to be SAID, so they are "already said" again — the
        # un-record above had removed them on the assumption they were lost.
        # They also go back into _pending, so if THIS resume is cut before it
        # plays the next interruption un-records them exactly as it would any
        # other emitted sentence. Without that, a resume killed by a barge-in
        # left the words marked "said" forever and the model's own reply was
        # then suppressed as a repeat — call 0c42d3a6 (2026-09-18) ended on
        # "हाँ जी?" and a hang-up because of it.
        for norm, topic, prev_exemplar, said in entries:
            self._spoken.append(norm)
            if topic:
                self._asked[topic] = norm
            self._pending.append((norm, topic, prev_exemplar, said))
        self._resumed_entries = entries
        self._resumed_at = time.time()
        return tail

    # How long after a hand-over its words can still be on their way to the
    # caller: the settle, a re-send, and a long sentence playing out.
    _RESUME_LIVE_SECS = 12.0

    def _being_resumed(self, sentence: str) -> bool:
        """Is this one of the cut words the turn-gate is saying again right
        now — handed over moments ago and not yet fully heard? Then a model
        reply that repeats it is not "the caller already answered it": they
        have not even heard it yet, and the resume will say it. Call afa21bf4
        (2026-10-14): the model's copy of the resumed marks question was
        dropped, the gate decided the caller had "already answered" and asked
        for a next step, and the caller heard the question twice."""
        if (not self._resumed_entries or self._played_text is None
                or time.time() - self._resumed_at > self._RESUME_LIVE_SECS):
            return False
        try:
            played = spoken_key(self._played_text() or "")
        except Exception:
            return False
        for norm, _topic, _prev, _said in self._resumed_entries:
            if (norm and is_repeat(sentence, [norm], threshold=0.80)
                    and spoken_key(norm) not in played):
                return True
        return False

    def forget_resumed(self) -> bool:
        """Undo the last hand-over: the caller never heard those words, so they
        are not "already said" and the model must be free to say them itself.
        Without this a resume lost to the vendor socket deleted its sentences
        from the call — the model's copy was suppressed as a repeat and the
        parent was left with a bare question (call b41b481f, 2026-09-19)."""
        entries, self._resumed_entries = self._resumed_entries, []
        if not entries:
            return False
        for norm, topic, prev_exemplar, _said in entries:
            for i in range(len(self._spoken) - 1, -1, -1):
                if self._spoken[i] == norm:
                    del self._spoken[i]
                    break
            if topic and self._asked.get(topic) == norm:
                if prev_exemplar is None:
                    self._asked.pop(topic, None)
                else:
                    self._asked[topic] = prev_exemplar
            for i in range(len(self._pending) - 1, -1, -1):
                if self._pending[i][0] == norm:
                    del self._pending[i]
                    break
        if self._diag is not None:
            self._diag.bump("unsaid_reverted", len(entries))
        return True

    def _keep(self, sentence: str) -> bool:
        if not self._enabled():
            return True
        if self._end_forced() and (sentence or "").rstrip().endswith(("?", "？")):
            logger.info("no-repeat: caller asked to end — dropping question %r", sentence.strip()[:48])
            return False
        if self._GREETING_RE.match(sentence or ""):
            if self._greeted:
                logger.info("no-repeat: dropping second greeting %r", sentence.strip()[:24])
                return False
            self._greeted = True
            return True
        if caller_asked_to_repeat(self._last_caller_text()):
            return True            # they ASKED us to say it again
        if caller_checking_presence(self._last_caller_text()):
            return True            # "Hello?" — they LOST it; the re-ask is the reply
        # Same QUESTION, different words. Sentence similarity at 0.80 cannot see
        # this (597aeb3f's pair scores ~0.7), so the topic supplies the candidate
        # and a looser similarity bar confirms it.
        topic = question_topic(sentence)
        ok = self._reask_ok_topic
        if (ok and self._responses_started <= ok[1] + 2
                and ((topic and topic == ok[0])
                     or (not ok[0] and is_repeat(sentence, [ok[2]], threshold=0.6)))):
            # We told the model "if they have not answered it, ask it once
            # more" and it did: it read the caller's words, we cannot.
            self._reask_ok_topic = None
            logger.info("no-repeat: re-asking %r — the model judged it unanswered",
                        sentence.strip()[:48])
            return True
        prev_ask = self._asked.get(topic) if topic else None
        same_topic_reask = prev_ask is not None and is_repeat(
            sentence, [prev_ask], threshold=self._TOPIC_REASK_THRESHOLD)
        bar = (self._CONTINUATION_THRESHOLD if self._strict_this_response
               else 0.80)
        if not (is_repeat(sentence, self._spoken, threshold=bar)
                or same_topic_reask):
            return True
        if self._being_resumed(sentence):
            # Dropped, but not counted against its budget: the caller has not
            # had the chance to "move on" from words still playing. Call
            # 4a594125 (2026-10-14): two drops during the resume of the
            # WhatsApp line used the budget up, and the third copy was spoken
            # right after the resume finished.
            logger.info("no-repeat: %r is being resumed right now — dropping the "
                        "model's copy", sentence.strip()[:56])
            return False
        # ONE budget per topic, not one per mechanism. Keying the two branches
        # separately let a re-asked question burn 2 drops as a near-identical
        # sentence and 2 more as an already-asked topic — four silent drops for
        # something the caller was waiting on.
        key = topic or normalize_spoken(sentence)[:48]
        n = self._suppressions.get(key, 0) + 1
        if n > self._MAX_SUPPRESSIONS:
            self._suppressions[key] = 0
            logger.info("no-repeat: %r suppressed %d times and the caller still "
                        "has not moved on — saying it", sentence.strip()[:56],
                        self._MAX_SUPPRESSIONS)
            if self._diag is not None:
                self._diag.bump("repeat_escalations")
            return True
        self._suppressions[key] = n
        return False

    # Said INSTEAD of a reply that turned out to be entirely a repeat. The first
    # version of this guard re-emitted the duplicate rather than go silent, and
    # it fired seven times in one afternoon — so the guard against dead air was
    # itself producing the repetition the founder was hearing. Hand the turn
    # back instead, and never with the same words twice running.
    #
    # ONE handback, then ESCALATE — call 3148ccd4 (2026-08-13), the worst call
    # we have logs for. Every one of these lines means "you talk", and the bot is
    # the party that placed the call. On that call the gate suppressed 20
    # sentences, handed back SEVEN times, and the caller answered each one:
    # "आप कुछ बोल क्यों नहीं रही हैं?" -> "मैं क्या बताऊँ?" -> "मैं क्या बताऊँ?" ->
    # "क्या बोलूं?" -> "मुझे समझ नहीं आ रहा आप क्यों phone कर रहे हैं" — forty-five
    # seconds of two parties telling each other to go first, then the callee hung
    # up. The trigger was ordinary: "Raman abhi kaun si class mein hai?" was asked
    # ONCE, never answered, and the gate then blocked all SIX attempts to ask it
    # again, which is the one thing a human counsellor would obviously do.
    #
    # So the rule the original comment was reaching for is not "never repeat", it
    # is "never leave the caller with nothing". A repeated question is a small
    # cost; a bot that can only say "you talk" cannot be answered at all, and the
    # conversation has no way back. After one handback the held sentence goes out.
    # DEVANAGARI, not romanized. These go straight to a hi-IN voice without ever
    # passing the prompt's SCRIPT rule, and Google TTS reads Latin-spelt Hindi
    # letter-by-letter — the founder heard "aa jaayega" come out as "A A जाएगा"
    # on call f9deaf6c. Sarvam bulbul handles either script, Google does not.
    _HANDBACK = ("जी, बोलिए।", "हाँ जी?", "आप बताइए।", "जी?")
    _HANDBACK_EN = ("Yes, go ahead.", "Sorry, you were saying?", "Please go on.", "Yes?")

    # A reply that says nothing. The gate's own handbacks land in the model's
    # context (aggregators.assistant() is downstream of this processor), so the
    # model LEARNS them and starts producing them itself — on call f9deaf6c it
    # answered a caller "Hello." with its own "Ji, boliye." and no suppression had
    # even fired. To the caller that is identical to a handback, so it counts as
    # one: two content-free turns in a row and we force real content out.
    _CONTENT_FREE = frozenset({
        "जी", "जी बोलिए", "हाँ जी", "हां जी", "आप बताइए", "बोलिए", "बताइए", "हाँ",
        "ji", "ji boliye", "haan ji", "aap batayiye", "aap bataiye", "boliye",
        "bataiye", "haan", "yes", "yes go ahead", "please go on",
        "sorry you were saying",
    })
    # Acknowledgment noises. NOT folded into _CONTENT_FREE: that set also drives
    # the hand-back escalation and the content-free-turn counter, and widening
    # it made "Theek hai. Achha." hold its own opener. Call 08df7128
    # (2026-09-12): "Right." "Right." was the whole audible reply twice over —
    # each a separate cached TTS context, each 3 s of phantom speaking — and
    # when only a filler survives the already-said drops the caller has nothing
    # to answer. Farewells and thanks are NOT here on purpose.
    _FILLER = frozenset({
        "right", "okay", "ok", "okay okay", "hmm", "hmm hmm", "achha", "acha",
        "theek hai", "thik hai", "theek", "sure", "alright", "i see", "got it",
        "understood", "great", "okay great", "ok great", "fair enough", "correct",
        # Hindi/Hinglish acknowledgments. Call 612f5e37 (2026-09-13): the caller
        # said "haan, bol sakte hain sir" and the model's WHOLE reply was
        # "जी सर।" — counted as real content, so nothing recovered and the caller
        # waited 6 s and said "Hello". The same words with a title are still
        # nothing.
        "जी", "जी सर", "जी मैम", "जी मैडम", "जी हाँ", "जी हां", "हाँ जी", "हां जी",
        "अच्छा जी", "ठीक है जी", "ठीक है सर", "अच्छा सर", "हाँ सर", "हां सर",
        "ji", "ji sir", "ji maam", "ji ma'am", "ji madam", "ji haan", "haan ji",
        "achha ji", "theek hai ji", "theek hai sir", "achha sir", "haan sir",
        "ok sir", "okay sir", "yes sir", "sure sir", "alright sir", "right sir",
        "ok ma'am", "okay ma'am", "yes ma'am", "ok maam", "okay maam", "yes maam",
        "okay madam", "yes madam", "great sir", "got it sir",
    })

    # Strip punctuation only. NOT isalnum() — Devanagari vowel signs are not
    # alphanumeric, so an isalnum filter turns "जी, बोलिए।" into "ज बलए" and the
    # match silently never fires. Same trap as diagnostics._norm_answer.
    _CF_STRIP = "।॥.,!?…\"'`~()[]{}:;-–—"

    @classmethod
    def _cf_key(cls, text: str) -> str:
        words = [w.strip(cls._CF_STRIP)
                 for w in (text or "").casefold().replace("।", " ").split()]
        return " ".join(w for w in words if w)

    @classmethod
    def _is_content_free(cls, text: str) -> bool:
        """Would the caller get NOTHING out of this reply? ("जी, बोलिए।")"""
        return cls._cf_key(text) in cls._CONTENT_FREE

    # Words that make an "ack + word" line mean something (a thanks, a no).
    _ACK_PLUS_MEANINGFUL = frozenset({
        "धन्यवाद", "शुक्रिया", "thanks", "thank", "bye", "नमस्ते", "sorry", "माफ़",
        "माफ", "नहीं", "no", "not", "please",
    })

    @classmethod
    def _is_filler(cls, text: str) -> bool:
        """A sentence that carries nothing answerable: a hand-back OR an
        acknowledgment noise — including an acknowledgment that only echoes a
        word or two back. Call 22062aac (2026-09-29): "जी सर, Pragyan." was the
        whole reply once the marks question behind it was dropped as a repeat,
        and because the name made it "real content" nothing recovered — 8 s of
        silence, then "Hello? are you there?"."""
        k = cls._cf_key(text)
        if k in cls._CONTENT_FREE or k in cls._FILLER:
            return True
        if "?" in (text or "") or "？" in (text or ""):
            return False
        words = k.split()
        if not 2 <= len(words) <= 4:
            return False
        for i in range(1, len(words)):
            rest = words[i:]
            if (" ".join(words[:i]) in cls._FILLER and len(rest) <= 2
                    and not any(w in cls._ACK_PLUS_MEANINGFUL for w in rest)):
                return True
        return False

    async def _emit(self, text: str, direction, past_cap: bool = False):
        cap = self._max_sentences()
        if cap and not past_cap and self._emitted >= cap:
            self._capped.append(text)
            return
        # Length budget: the first sentence always plays; after it, stop once
        # the reply would run past max_reply_chars (the closing question is
        # still asked, as for the sentence cap). Call 3c2f5b82 (2026-09-24):
        # a 210-char pitch sentence, then the faculty line, then the dashboard
        # and PTM — "समझ में नहीं आया", and the parent hung up. Shreya's replies:
        # p95 228 chars, so this trims only the stacked monologues.
        # Only once the reply has said something substantial: call 5aa10e10
        # (2026-09-25) held a 220-char sentence behind a 35-char one, the reply
        # was "that's actually a good performance।" and nothing else, and the
        # parent waited 7 s — "आप बार-बार शांत क्यों जा रही हैं?".
        budget = self._max_chars()
        if (budget and not past_cap and self._body_chars >= 120
                and self._body_chars + len(text.strip()) > budget):
            self._capped.append(text)
            return
        if self._echo_held and text is not self._echo_held:
            logger.info("no-echo: dropping restated answer %r — real content followed",
                        self._echo_held.strip()[:48])
            if self._diag is not None:
                self._diag.bump("echoes_trimmed")
            self._echo_held = ""
        # The End-branch strips its tail, so without this the assistant
        # aggregator glues sentences into "…for you.How does that sound?" in
        # the model's own context — and the model then IMITATES the glued
        # style in later replies (call c9aa4062, 2026-09-09).
        if self._emitted and text and not text[0].isspace():
            text = " " + text
        # An ellipsis is not a sentence. The gate's splitter keeps "..." on the
        # sentence, but pipecat's TTS text aggregator splits it again into
        # "…परसेंट.." and a bare "." — and Smallest renders a lone "." as a
        # multi-second hum (call af7e93bd, 2026-09-15: "नब्बे तीन परसेंट..."
        # → 10 s of drone). A pause mid-sentence becomes a comma; at the end,
        # one full stop.
        text = re.sub(r"\.{2,}(\s*$)", r".\1", text)
        text = re.sub(r"\s*\.{2,}\s*", ", ", text)
        # A 10-digit run is a phone number, and a TTS reads "9425677707" as a
        # nine-billion numeral (call 4565478b, 2026-09-10: "क्या मैं ये link आपके
        # WhatsApp number 9425677707 पर भेज दूँ?"). Space the digits so it is
        # read out one by one, which is also how the prompt asks for numbers.
        text = re.sub(r"(?<!\d)(\d{10})(?!\d)", lambda m: " ".join(m.group(1)), text)
        if "/" in text:
            text, alts = collapse_alternatives(text, self._address)
            if alts:
                logger.info("no-repeat: kept one form of %d either-or pair(s) -> %r",
                            alts, text.strip()[:60])
                if self._diag is not None:
                    self._diag.bump("alternatives_collapsed", alts)
        if "<" in text:
            text, slots = fill_template_slots(text, self._child_slots)
            if slots:
                logger.info("no-repeat: filled %d template slot(s) the model copied from "
                            "the prompt -> %r", slots, text.strip()[:60])
                if self._diag is not None:
                    self._diag.bump("placeholders_filled", slots)
        _words = {w.strip("।.,!?;:\"'()").casefold() for w in text.split()}
        if _words & _FEMALE_ADDRESS:
            self._address = "f"
        elif _words & _MALE_ADDRESS:
            self._address = "m"
        norm = normalize_spoken(text)
        self._spoken.append(norm)
        self._norms_this_reply.add(norm)
        topic = question_topic(text)
        # Remember the PREVIOUS exemplar so an un-poison can restore it exactly.
        prev_exemplar = self._asked.get(topic) if topic else None
        if topic:
            self._asked[topic] = norm
        self._pending.append((norm, topic, prev_exemplar, text.strip()))
        self._emitted += 1
        self._body_chars += len(text.strip())
        if "?" in text or "？" in text:
            self._asked_this_reply = True
        if not self._is_content_free(text):
            self._said_real = True          # the bot said something answerable
        if self._is_filler(text):
            self._cf_this_reply.add(self._cf_key(text))
        else:
            self._real_this_reply = True
        await self.push_frame(LLMTextFrame(text), direction)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMFullResponseEndFrame):
            # FIRST, before any branch returns: every reply that ends counts.
            self._responses_ended = min(self._responses_ended + 1, self._responses_started)

        if isinstance(frame, LLMFullResponseStartFrame):
            self._killed = False
            self._text_seen = False
            self._responses_started += 1
            self._last_start_t = time.time()
            if self._responses_started > self._runs_passed:
                self._runs_passed = self._responses_started    # a run we did not see
            self._held_question = ""
            self._asked_this_reply = False
            self._buf, self._emitted, self._held_tail = "", 0, ""
            self._body_chars = 0
            self._next_step_this_reply = False
            self._capped = []
            self._said_real = False
            self._cf_held = ""
            self._cf_this_reply = set()
            self._real_this_reply = False
            self._norms_this_reply = set()
            self._strict_this_response = self._continuation_next
            self._continuation_next = False
            # The previous response ran to a natural start-of-next — its
            # sentences played (or are playing out normally) and stay recorded.
            self._pending = []
            self._unplayed_tail = ""
            self._unplayed_entries = []
            await self.push_frame(frame, direction)
            return

        if isinstance(frame, InterruptionFrame):
            supersede_cut = isinstance(frame, SupersedeInterruptionFrame)
            flushed = getattr(frame, "runs_flushed", None) if supersede_cut else None
            if flushed is not None:
                # RunGuard's supersede: it flushes the runs counted when it was
                # sent. The newer run it was sent for was counted right after
                # (note_run is synchronous, this frame is not) and is still
                # on its way — counting it as flushed read "nothing pending"
                # for the newer run's whole time-to-first-token.
                self._responses_started = max(self._responses_started, flushed)
                self._responses_ended = max(self._responses_ended, flushed)
            else:
                # An interruption flushes the LLM's queued runs: nothing is queued now.
                self._responses_started = max(self._responses_started, self._runs_passed)
                self._responses_ended = self._responses_started
            # Whatever the previous interruption left unsaid is history: only
            # THIS cut's words may be resumed (else a stale tail could surface
            # minutes later, mid-topic).
            self._unplayed_tail = ""
            self._unplayed_entries = []
            # A resume still on its way is cut like any reply. Its words went
            # into _pending when handed over, but a model response starting
            # since then emptied _pending — and the cut resume stayed "said"
            # though never heard (afa21bf4 replayed, 2026-10-14: the barge-in
            # cut the resumed marks question, and the model's own copy of it
            # was then dropped as a repeat). Judge them here with the rest.
            if (self._resumed_entries
                    and time.time() - self._resumed_at <= self._RESUME_LIVE_SECS):
                for e in self._resumed_entries:
                    if e not in self._pending:
                        self._pending.append(e)
            self._resumed_entries = []
            # A cancelled reply's unsaid tail was never heard, so it is not
            # "already said" — but what DID play is still in _spoken.
            #
            # And that must include sentences that were EMITTED but never PLAYED.
            # Call 4b1a44b9 (2026-08-13): Smart Turn fired on the fragment
            # "Raman के", the generation it triggered streamed the diagnostic
            # question into _spoken, and the caller's continuing speech cancelled
            # it before one word of audio played. The REAL reply's same question
            # was then dropped as "already-said", the caller got "बहुत अच्छे!"
            # and 6.6s of silence, prompted with "हम्म", got a handback, and had
            # to complain before the suppression cap finally released the
            # question. "Already said" has to mean "already HEARD" — so anything
            # pending that is absent from the played transcript is un-recorded.
            if self._pending and self._played_text is not None:
                try:
                    played_raw = self._played_text() or ""
                    played = spoken_key(played_raw)
                    unplayed = []
                    for norm, topic, prev_exemplar, said in self._pending:
                        # MOSTLY heard is heard. Call 83735c51 (2026-09-26): a
                        # cut near the END of "लेकिन इस level पर हमारा focus …"
                        # un-recorded the whole sentence; the model said it
                        # again out of context 45 s later, then kept repeating
                        # it, and the repeat filter's fallback became a
                        # "जी, बोलिए।" / "हाँ जी?" handback loop.
                        if norm and mostly_played(norm, played):
                            logger.info("no-repeat: %r was mostly heard before the cut — "
                                        "keeping it as said", norm[:40])
                            continue
                        if norm and spoken_key(norm) not in played:
                            # Only REAL words are worth resuming: a hand-back
                            # ("जी, बोलिए।") or an acknowledgement carries
                            # nothing, and saying it again after a backchannel
                            # is the content-free turn we fight everywhere else.
                            if said and not self._is_content_free(said) and not self._is_filler(said):
                                unplayed.append(said)
                                self._unplayed_entries.append((norm, topic, prev_exemplar, said))
                            logger.info("no-repeat: not in the played text (tail %r)",
                                        played_raw[-100:])
                            for i in range(len(self._spoken) - 1, -1, -1):
                                if self._spoken[i] == norm:
                                    del self._spoken[i]
                                    break
                            # Restore the exemplar the never-played ask displaced
                            # (None = the topic had not been asked before).
                            if topic and self._asked.get(topic) == norm:
                                if prev_exemplar is None:
                                    self._asked.pop(topic, None)
                                else:
                                    self._asked[topic] = prev_exemplar
                            if self._diag is not None:
                                self._diag.bump("unsaid_reverted")
                            logger.info("no-repeat: un-recording never-played %r",
                                        norm[:56])
                    # The exact words the caller did NOT hear, in order: the
                    # turn-gate speaks them verbatim when the thing that cut us
                    # off was only a backchannel.
                    self._unplayed_tail = " ".join(unplayed).strip()
                except Exception:
                    logger.exception("no-repeat: unplayed-revert failed — keeping all")
            if supersede_cut:
                # Superseded, not cut: the newer run answers the whole turn, so
                # these words are never to be resumed on their own (a "हाँ"
                # inside its time-to-first-token would have spoken a stale
                # answer verbatim).
                self._unplayed_tail = ""
                self._unplayed_entries = []
            self._pending = []
            self._buf, self._held_tail, self._cf_held = "", "", ""
            self._echo_held = ""
            # Text of the response this interruption killed can still arrive
            # (the LLM streams until its cancel lands, then ends). Without this
            # it was flushed as a tail — "जी मैम, Shik" reached the caller after
            # she cut in, and the filler recovery then asked for a fresh line on
            # a reply she never heard (call 3ad7f590, 2026-09-30).
            self._killed = True
            self._cf_this_reply = set()
            self._real_this_reply = False
            self._norms_this_reply = set()
            await self.push_frame(frame, direction)
            return

        if (isinstance(frame, TTSSpeakFrame) and self._drop_stale_bridge is not None
                and self._drop_stale_bridge(frame.text or "")):
            logger.info("no-repeat: dropping stale bridge line — the reply is already playing")
            return
        if (isinstance(frame, LLMTextFrame) and direction == FrameDirection.DOWNSTREAM
                and not isinstance(frame, TTSTextFrame)):
            if self._killed:
                return                  # the interrupted response's late tokens
            if (frame.text or "").strip():
                self._text_seen = True
            self._buf += frame.text or ""
            while True:
                m = self._SENT_END.search(self._buf)
                if not m:
                    break
                sentence, self._buf = self._buf[:m.end()], self._buf[m.end():]
                if not sentence.strip():
                    continue
                # A chunk with no letters or digits ("." from a stray leading
                # period) is not speech — Smallest TTS reads it as the WORD
                # "dot". Call c9aa4062: the caller heard "September 10th dot
                # WHAT time works best" three times and asked "what is dot
                # H four W?". Never let letterless text reach the TTS.
                if not any(ch.isalnum() for ch in sentence):
                    logger.info("no-repeat: dropping letterless chunk %r",
                                sentence.strip()[:16])
                    continue
                if self._emitted == 0:
                    sentence = self._trim_echo(sentence)
                # We already gave the caller one "you talk" turn and the model is
                # opening with another. Hold it: if real content follows it was
                # only a filler and is better dropped anyway (fast_open_rule); if
                # nothing follows, the End branch says something real instead.
                # Only while _consecutive_handbacks is up, so the normal path and
                # its latency are untouched — and these sentences are three words,
                # so holding one costs nothing measurable.
                if (self._emitted == 0 and not self._cf_held
                        and self._consecutive_handbacks >= 1
                        and self._is_content_free(sentence)):
                    self._cf_held = sentence
                    logger.info("no-repeat: holding a second content-free opener %r",
                                sentence.strip()[:32])
                    continue
                # An opening sentence that only says the caller's answer back
                # ("Okay, so it's all offline right now.") is held: if anything
                # real follows, it is dropped; if it is the whole reply, it is
                # spoken rather than leaving silence. Founder, 2026-09-13:
                # "whatever is being answered the bot is again reconfirming
                # every time, that's not normal." The prompt forbids it and the
                # model does it anyway (4/4 sim runs), so the gate enforces it.
                if (self._emitted == 0 and not self._echo_held and self._no_echo()
                        and is_echo_of_answer(
                            sentence, self._last_caller_text(),
                            next((x for x in reversed(self._spoken) if "?" in x), ""))):
                    self._echo_held = sentence
                    logger.info("no-echo: holding restated answer %r", sentence.strip()[:48])
                    continue
                # The SAME content-free sentence twice in ONE reply says nothing
                # twice. Call 08df7128: "Right." … "Right." was all that survived
                # the already-said drops. Different acknowledgments in one reply
                # ("Theek hai. Achha.") stay — that is how people talk.
                if (self._is_filler(sentence)
                        and self._cf_key(sentence) in self._cf_this_reply):
                    logger.info("no-repeat: dropping repeated filler %r",
                                sentence.strip()[:24])
                    continue
                # The SAME sentence twice in one reply, any length. is_repeat
                # exempts short sentences (acknowledgments recur across turns),
                # which let "Yes, I'm here. Yes, I'm here." through (call
                # f08f5712). Within a single reply an exact repeat is never right.
                if normalize_spoken(sentence) in self._norms_this_reply:
                    logger.info("no-repeat: dropping exact repeat within the reply %r",
                                sentence.strip()[:32])
                    continue
                if self._keep(sentence):
                    await self._emit(sentence, direction)
                else:
                    self._held_tail = self._last_suppressed = sentence
                    if "?" in sentence or "？" in sentence:
                        self._held_question = sentence
                    if self._diag is not None:
                        self._diag.bump("repeats_suppressed")
                    logger.info("no-repeat: dropping already-said %r", sentence.strip()[:56])
            return

        if isinstance(frame, LLMFullResponseEndFrame) and self._killed:
            # The end of the response an interruption killed: nothing of it is
            # spoken and nothing is recovered — the caller's new turn drives.
            if self._buf.strip():
                logger.info("no-repeat: dropping %r — its response was interrupted",
                            self._buf.strip()[:40])
            self._buf = ""
            await self.push_frame(frame, direction)
            return

        if isinstance(frame, LLMFullResponseEndFrame):
            tail = self._buf.strip()
            self._buf = ""
            if tail and not any(ch.isalnum() for ch in tail):
                logger.info("no-repeat: dropping letterless tail %r", tail[:16])
                tail = ""
            if (tail and self._is_filler(tail)
                    and self._cf_key(tail) in self._cf_this_reply):
                logger.info("no-repeat: dropping repeated filler tail %r", tail[:24])
                tail = ""
            if tail and normalize_spoken(tail) in self._norms_this_reply:
                logger.info("no-repeat: dropping exact repeat tail %r", tail[:32])
                tail = ""
            if tail:
                if self._emitted == 0:
                    tail = self._trim_echo(tail)
                if self._keep(tail):
                    await self._emit(tail, direction)
                else:
                    self._held_tail = self._last_suppressed = tail
                    if "?" in tail or "？" in tail:
                        self._held_question = tail
                    if self._diag is not None:
                        self._diag.bump("repeats_suppressed")
                    logger.info("no-repeat: dropping already-said %r", tail[:56])
            if self._capped:
                # The reply's LAST QUESTION among the held sentences, wherever it
                # sits. Only checking the final held sentence dropped the question
                # whenever the model put anything after it — call 963347ab
                # (2026-09-30): pitch + name/class question + one more line, the
                # question was held, the parent never knew it was her turn, 8.2 s
                # of silence, then "are you there?".
                last = next((x for x in reversed(self._capped) if "?" in x or "？" in x),
                            self._capped[-1])
                asks = "?" in last or "？" in last
                logger.info("no-repeat: reply capped at %d sentence(s) / %d chars — %d held%s",
                            self._emitted, self._body_chars, len(self._capped),
                            ", asking its closing question" if asks else "")
                if self._diag is not None:
                    self._diag.bump("sentences_capped", len(self._capped))
                held, self._capped = self._capped, []
                if asks and self._keep(last):
                    await self._emit(last, direction, past_cap=True)
            # Superseded: a newer caller run is already queued, and its reply
            # will answer everything this one failed to. Any recovery here
            # (a next-step request, a handback, speaking a held line) would be
            # a SECOND reply to the same moment — call 22062aac (2026-09-29).
            # A held caller turn or one still forming is a newer run too: it
            # will answer everything (single-flight step 5).
            superseded = ((self._newer_run_queued() or self._caller_turn_pending())
                          and not self._end_forced())
            # AN EMPTY REPLY. Gemini sometimes answers with zero tokens (call
            # 963347ab: out=0 after the parent's "ये apply."), and nothing at all
            # followed — the bridge line, then 8.2 s, then "are you there?". Ask
            # for the next line at once, as for a bare acknowledgment.
            # Not for a response the parent's barge-in killed (its End carries no
            # text either). After a put-off (call 899c6888) the cue itself says
            # to offer a call back or close, rather than push on or go silent.
            _caller_now = (self._last_caller_text() or "").strip()
            if (not getattr(self, "_text_seen", True) and not self._buf.strip()
                    and not self._killed
                    and not superseded and not self._end_forced() and not self._ending()
                    # A FAILED primary request ends with no text too. The failover
                    # re-runs the turn on the fallback; a "continue" cue here
                    # answered it under the wrong steering, used a next-step slot
                    # and could add a second reply (timing sim
                    # vertex_stall_failover_slow_tts, 2026-10-01).
                    and not self._primary_errored_since(self._last_start_t)
                    and self._request_next_step is not None and self._may_ask_next_step()
                    and _caller_now and not _caller_now.startswith("[")):
                self._next_steps += 1
                self._next_step_for = normalize_spoken(_caller_now)
                logger.info("no-repeat: the model's reply was EMPTY — asking for the next line")
                if self._diag is not None:
                    # Its own counter: an internal re-ask is not a handback the
                    # parent heard (HANDBACK_LOOP counted it as one).
                    self._diag.bump("empty_replies")
                try:
                    await self._request_next_step("", kind="continue")
                except Exception:
                    logger.exception("no-repeat: next-step request failed")
            # A short line with no question is all that survived the
            # already-said drops: nothing new reached the caller. Call f6764346
            # (2026-09-30): "समझ सकती हूँ सर। + the Shiksha Nation line (already
            # said)" left "समझ सकती हूँ सर।", 8.2 s of silence and "are you
            # there?". No word list can name every acknowledgment; the shape can.
            if (self._real_this_reply and (self._held_tail or self._held_question)
                    and not self._asked_this_reply and self._body_chars <= 40):
                logger.info("no-repeat: only a short line survived the already-said drops "
                            "— treating the reply as saying nothing new")
                self._real_this_reply = False
            if superseded and (not self._real_this_reply or self._echo_held or self._cf_held):
                logger.info("no-repeat: a newer caller turn is already queued — "
                            "no recovery for this reply")
                self._held_tail = self._held_question = ""
                self._echo_held = self._cf_held = ""
            # "Nothing answerable was said" — not "nothing was said". Call
            # 08df7128: "Right." survived, the three real sentences behind it were
            # already-said drops, and the caller got "Right." then 12 s of
            # nothing. Never on a forced close: a goodbye must stay a goodbye.
            # A reply that was ONLY a filler ("जी सर।") with nothing held: the
            # model acknowledged and stopped. Same remedy as the all-repeat
            # case — ask for the next line — but only when the caller actually
            # said something to move on from (call 612f5e37, 2026-09-13).
            # The soft next-step cue came back as another bare acknowledgment:
            # one FIRM request for the same caller turn, outside the per-turn
            # limit — otherwise the firm cue waits for the idle timer (8 s).
            # Keyed on the turn the soft request was FOR: by now the context's
            # last entry is our own "जी सर।", so last_caller_text() is empty.
            escalate_now = (self._filler_streak >= 1 and self._next_steps < 5
                            and self._next_step_for is not None
                            and self._escalated_for != self._next_step_for)
            _caller = (self._last_caller_text() or "").strip()
            if (not self._real_this_reply and self._emitted and not self._held_tail
                    and not self._held_question
                    and not self._end_forced() and not superseded
                    and self._request_next_step is not None
                    and (escalate_now or (self._may_ask_next_step()
                                          and _caller and not _caller.startswith("[")))):
                if escalate_now:
                    self._escalated_for = self._next_step_for
                self._next_steps += 1
                if not escalate_now:
                    self._next_step_for = normalize_spoken(self._last_caller_text() or "")
                # The second acknowledgment-only reply in a row gets the firm
                # cue (ask ONE new question, or close) — the soft one had just
                # been ignored. Call 22062aac: "जी।" "जी सर।" "जी सर।" "जी सर।"
                # to a parent explaining his son, each on attempt 0.
                attempt = 2 if self._filler_streak >= 1 else 0
                logger.info("no-repeat: reply was only a filler after the caller spoke "
                            "— asking for the next step (streak %d)", self._filler_streak + 1)
                if self._diag is not None:
                    self._diag.bump("handbacks")
                try:
                    await self._request_next_step("", attempt=attempt)
                except Exception:
                    logger.exception("no-repeat: next-step request failed")
            if self._held_question:
                # Recover about the QUESTION that was dropped, not whatever
                # sentence happened to be dropped last.
                self._held_tail = self._held_question
            if (not self._real_this_reply and self._held_tail
                    and not self._end_forced() and not superseded):
                if self._being_resumed(self._held_tail):
                    # The whole reply repeated the cut words the turn-gate is
                    # saying again right now. The caller has not answered them
                    # — they have not heard them yet — so there is no next
                    # step to ask for and nothing to hand back: the resume IS
                    # the reply (call afa21bf4, 2026-10-14). Nothing held may
                    # be spoken on top of it either.
                    logger.info("no-repeat: whole reply repeats the words being resumed "
                                "right now — adding nothing, they are about to hear them")
                    self._echo_held = self._cf_held = ""
                elif self._consecutive_handbacks >= 1:
                    # ESCALATE (call 3148ccd4). We already handed the turn back
                    # once and the caller still has nothing to answer. Saying
                    # "you talk" a second time is how a call becomes unrecoverable
                    # — so say the held sentence, repeat and all. It is almost
                    # always the question the caller never answered, which is
                    # exactly what a human would ask again.
                    logger.warning("no-repeat: second all-repeat reply in a row — "
                                   "speaking it rather than handing back again %r",
                                   self._held_tail.strip()[:56])
                    if self._diag is not None:
                        self._diag.bump("repeat_escalations")
                    await self._emit(self._held_tail, direction)
                elif (self._request_next_step is not None
                      and is_question(self._last_caller_text() or "")
                      and self._next_step_for != normalize_spoken(self._last_caller_text() or "")):
                    # They asked something and the model answered with its
                    # script line again. Call 59888de8: "हाँ anything else?" and
                    # "नहीं, आप कुछ और पूछना चाह रही थी?" got "जी?" and "जी,
                    # बोलिए". A question is never handed back; it is answered.
                    # Once per turn, outside the per-call next-step budget.
                    self._next_step_for = normalize_spoken(self._last_caller_text() or "")
                    # A request, not a handback: nothing was said to the caller
                    # (call 4a594125, 2026-10-14 — see next_step_requests).
                    if self._diag is not None:
                        self._diag.bump("next_step_requests")
                    logger.info("no-repeat: whole reply was a repeat but the caller asked a "
                                "question — asking the model to answer it")
                    try:
                        self._next_step_this_reply = True
                        await self._request_next_step(self._last_caller_text() or "",
                                                      kind="answer-question",
                                                      attempt=self._next_steps)
                    except Exception:
                        logger.exception("no-repeat: answer-question request failed — handing back")
                        line = self._handbacks[self._handback % len(self._handbacks)]
                        self._handback += 1
                        if self._diag is not None:
                            self._diag.bump("handbacks")
                        await self._emit(line, direction)
                elif (self._request_next_step is not None and self._may_ask_next_step()
                      and (self._last_caller_text() or "").strip()
                      and not (self._last_caller_text() or "").startswith("[")):
                    # The caller ANSWERED and the model's whole reply was that
                    # question again. Call a59696ed (2026-09-13): "Yes" →
                    # "Okay." + the same WhatsApp question → dropped → the bot
                    # said "Okay. Yes, go ahead." and the caller hung up.
                    # Handing the turn back to someone who has just answered is
                    # nonsense; ask the model for its NEXT step instead. Capped
                    # at two per call, and the escalation above takes over once
                    # a content-free turn has been counted, so it cannot loop.
                    self._next_steps += 1
                    self._next_step_for = normalize_spoken(self._last_caller_text() or "")
                    logger.info("no-repeat: whole reply repeated what they just answered "
                                "— asking for the next step instead of handing back")
                    # Not a handback: no line reached the caller. Call 4a594125
                    # (2026-10-14) headlined HANDBACK_LOOP over two of these.
                    if self._diag is not None:
                        self._diag.bump("next_step_requests")
                    self._next_step_this_reply = True
                    if "?" in self._held_tail or "？" in self._held_tail:
                        self._reask_ok_topic = (question_topic(self._held_tail),
                                                self._responses_started,
                                                normalize_spoken(self._held_tail))
                    try:
                        await self._request_next_step(self._held_tail, kind="all-repeat",
                                                      attempt=self._next_steps)
                    except Exception:
                        logger.exception("no-repeat: next-step request failed — handing back")
                        line = self._handbacks[self._handback % len(self._handbacks)]
                        self._handback += 1
                        if self._diag is not None:
                            self._diag.bump("handbacks")
                        await self._emit(line, direction)
                else:
                    # Everything was a repeat. Do NOT say it again — hand the turn
                    # back in a few words so the line is not dead either.
                    line = self._handbacks[self._handback % len(self._handbacks)]
                    self._handback += 1
                    # NOT counted here — the content-free check below owns the
                    # counter, so a handback and a model-written "Ji, boliye."
                    # increment it exactly once each.
                    if self._diag is not None:
                        self._diag.bump("handbacks")
                    logger.info("no-repeat: whole reply was a repeat — handing back with %r", line)
                    # THROUGH _emit, not a raw push: _emit is what puts a space
                    # between sentences. Without it the caller heard
                    # "Okay.Yes, go ahead." as one glued word (call a59696ed).
                    await self._emit(line, direction)
            if self._emitted == 0 and self._echo_held:
                held, self._echo_held = self._echo_held, ""
                if (self._request_next_step is not None and self._may_ask_next_step()
                        and not self._end_forced()):
                    # Speaking it is how call 71e8f39b looped: "You are taking
                    # offline classes." / "You are not taking any online classes
                    # right now." / "You only take offline classes." — five
                    # restatements in a row to a caller saying yes/no/hello. Ask
                    # for the next line instead; the second request offers a
                    # polite goodbye as the way out.
                    self._next_steps += 1
                    self._next_step_for = normalize_spoken(self._last_caller_text() or "")
                    logger.info("no-echo: restatement was the whole reply — asking for "
                                "the next step (%d/2)", self._next_steps)
                    if self._diag is not None:
                        self._diag.bump("next_step_requests")
                    try:
                        await self._request_next_step(held, kind="restatement",
                                                      attempt=self._next_steps)
                    except Exception:
                        logger.exception("no-echo: next-step request failed — speaking the restatement")
                        await self._emit(held, direction)
                elif self._next_step_this_reply:
                    # A fresh line was requested while handling THIS reply (the
                    # repeat branch above): it is on its way, and speaking the
                    # held line too glued an already-answered question onto it —
                    # call 30cfc538 (2026-09-26): "क्या परमजीत के साथ भी ऐसा ही
                    # है सर? जी सर, समझ सकती हूँ।".
                    logger.info("no-echo: a fresh line is already requested for this turn — "
                                "dropping the restatement %r", held.strip()[:40])
                else:
                    # Nothing but the restatement came and the budget is spent:
                    # better a weak line than silence.
                    logger.info("no-echo: restatement was the whole reply — speaking it")
                    await self._emit(held, direction)
            self._echo_held = ""
            if self._emitted == 0 and self._cf_held:
                # The model answered "you talk" for the second turn running. Say
                # the thing it has been unable to get out instead; only if there
                # is nothing at all do we let the filler through, because a silent
                # turn is worse than a weak one.
                real = self._last_suppressed or ""
                if real:
                    logger.warning("no-repeat: model repeated a content-free reply — "
                                   "speaking held content instead %r", real.strip()[:56])
                    if self._diag is not None:
                        self._diag.bump("repeat_escalations")
                    await self._emit(real, direction)
                else:
                    self._emitted += 1
                    await self.push_frame(LLMTextFrame(self._cf_held), direction)
            # Did this turn give the caller anything to answer? A reply the MODEL
            # wrote that is only "Ji, boliye." counts the same as our own handback
            # — see _CONTENT_FREE. Two in a row and the next one is forced out.
            if self._real_this_reply:
                self._filler_streak = 0
            elif self._emitted:
                self._filler_streak += 1
            if self._emitted:
                self._last_reply_statement = self._real_this_reply and not self._asked_this_reply
            if self._said_real:
                self._consecutive_handbacks = 0
            elif self._emitted:
                self._consecutive_handbacks += 1
                if self._diag is not None:
                    self._diag.bump("content_free_turns")
                logger.info("no-repeat: content-free turn (%d in a row)",
                            self._consecutive_handbacks)
            await self.push_frame(frame, direction)
            return

        await self.push_frame(frame, direction)


@dataclass
class SupersedeInterruptionFrame(InterruptionFrame):
    """RunGuard's own interruption, pushed DOWNSTREAM only, right before a newer
    caller run: the earlier run's reply has not made a sound yet, so it is
    cancelled — in the LLM and in its queue — instead of being played ahead of
    the answer to the whole turn (config.run_supersede).

    An InterruptionFrame to pipecat (the LLM, the TTS, the transport drop what
    they hold), but nothing the CALLER heard was cut: DuckGate does not stamp a
    cut (no "carry on" reading of their next "हाँ"), NoRepeatGate keeps no
    unplayed tail to resume (the newer reply replaces it), and the sentinel does
    not suspect a lost reply. `runs_flushed` is the run ledger's count when the
    earlier run was superseded — every run up to it is gone, a newer one is not."""
    runs_flushed: Optional[int] = None


class RunGuard(FrameProcessor):
    """Between aggregators.user() and the LLM: a generation must ANSWER something.

    THE CLASS OF BUG THIS KILLS (call 17be14f2, 2026-08-13, and its cousins on
    4b1a44b9/761decff): the caller's pre-greet "हेलो" opened a user TURN whose
    transcript was then dropped (machine-scrap filter) — but the turn itself
    stayed open, and when it finally closed 4.6s later on a silence fallback,
    the aggregator triggered an LLM inference WITH NO NEW USER CONTENT. The
    model, asked to reply to nothing, re-delivered whatever its context says is
    pending — the introduction — and the no-repeat gate was left to fight a
    paraphrasing model with a similarity threshold. Every repetition incident
    this month funnels through a generation that had nothing new to answer.

    The rule is the definition of a conversation turn: run the LLM only when the
    context's last message is a USER message we have not already answered.
    Everything that legitimately generates satisfies it — the greet cue, the
    absorb "carry on" cue, real caller turns — because they all APPEND before
    they run. The empty-turn inference appends nothing, so its trigger arrives
    with the context unchanged since the previous run, and is swallowed.
    """

    def __init__(self, context, enabled=None, diag=None,
                 short_answer_grace_secs: float = 0.0, short_answer_max_words: int = 3,
                 quiet_for=None, on_run=None, opening_pending=None,
                 noise_cap_secs: float = 3.0, caller_forming=None,
                 forming_cap_secs: float = 5.5, bot_run_drop_reason=None, voice_live=None,
                 supersede=None, reply_unheard=None, runs_noted=None, before_run=None,
                 on_hold=None, opening_coming=None, intro_cue=None, audible_since=None,
                 is_voicemail=None):
        super().__init__()
        # The person has put us on hold (TranscriptCollector.on_hold_for): no run
        # goes to the LLM, whoever started it — see _let_through.
        self._on_hold = on_hold or (lambda: False)
        # A frame to push ahead of a run that goes through (the LLM switch back
        # to the primary after a failover) — None for nothing.
        self._before_run = before_run or (lambda: None)
        # ONE REPLY PER CALLER TURN (config.run_supersede). A parent who speaks
        # in pieces — "आप।" / "आप teachers से कहें मुझसे भी direct बात करें।" /
        # "बात करें।", finals 0.3-1 s apart — reaches us as several runs. A run
        # that has gone through is in the LLM, and pipecat's LLM services
        # QUEUE a second context behind the first rather than replace it: on
        # call 84e52d17 run 1 (10 caller words) and run 2 (12) went through
        # 0.55 s apart, nothing interrupted either, and both replies played
        # back to back. So a caller run that arrives while the reply to the
        # previous run has not made a sound (`reply_unheard(pushed_t)`) cancels
        # that run first — the newer context holds all of its words too.
        # Once the earlier reply is audible this does nothing: the turn-gate's
        # barge-in owns that case, as before.
        self._supersede = supersede or (lambda: False)
        self._reply_unheard = reply_unheard or (lambda since: False)
        self._runs_noted = runs_noted or (lambda: None)
        self._pushed_t = 0.0           # when the last run went to the LLM (0 = none, or flushed)
        # Caller words in the whole context when that run went: a newer run
        # supersedes it only if the caller has said something since.
        self._pushed_words = 0
        # The bot's OWN runs (single-flight step 5): cue text → on_drop. A run
        # whose last user message is a registered cue is the bot's; any caller
        # words after the cue make it the caller's turn instead.
        self._cues: Dict[str, Any] = {}
        self._held_cue = None
        self._bot_run_drop_reason = bot_run_drop_reason or (lambda for_reply=0.0: None)
        self._voice_live = voice_live or (lambda: False)
        # The caller's words are still in the user aggregator: a run now would
        # answer half a turn and the turn's own run would follow it.
        self._caller_forming = caller_forming or (lambda: False)
        self._forming_cap = forming_cap_secs
        self._context = context
        self._noise_cap = noise_cap_secs
        # While the scripted opening has not been heard, the opening is the
        # reply — a run only goes through if the caller genuinely took over
        # (a question to us, a refusal, or our own cue). Call 4243a436.
        self._opening_pending = opening_pending or (lambda: False)
        # …but only while something will actually SAY it: this delivery is
        # playing, or was queued a moment ago and nothing has cut it since.
        # Otherwise nothing ever spoke: call 4cb132a2 (2026-10-14) had spent
        # its two re-says and swallowed "no" twice, a11e6709's opening was cut
        # by a voicemail prompt and four hellos met 18 s of silence, and
        # 5e979e3e's re-say was killed 22 ms in — 14.6 s, no run at all.
        self._opening_coming = opening_coming or (lambda: True)
        self._opening_wait: Optional[asyncio.Task] = None
        # Has bot audio played at any moment since t (playing now, or started /
        # stopped after t)? How a turn left to the opening is checked against
        # what the caller actually HEARD (CALLER_IGNORED, _check_swallowed).
        self._audible_since = audible_since or (lambda t: True)
        # The only thing that has spoken is the voicemail recorder
        # (TranscriptCollector.looks_like_voicemail): its "turns" were pieces
        # of the recording, and the idle tick hangs up.
        self._is_voicemail = is_voicemail or (lambda: False)
        # The note a run carries while the person has not HEARD who is calling
        # ("" = none) — added at the one exit every run takes (_let_through).
        self._intro_cue = intro_cue or (lambda: "")
        self._enabled = enabled or (lambda: True)
        self._diag = diag
        self._last_allowed_fp = None
        # SHORT-ANSWER GRACE. "Yes." — a breath — "I take classes in the evening,
        # mostly at the studio…": the VAD stops inside the breath, Smart Turn
        # calls "Yes." complete, the STT finalizes it, and the run fires ~20 ms
        # later. The model answers a bare yes, its audio starts, the caller's
        # continuation barges it down, and the real answer then gets a SECOND
        # reply — the "talks over me / re-asks what I just said" of the founder's
        # 2026-09-15 calls, reproduced with the real STT in sim.timing
        # breath_then_long_answer_*. A run whose new caller words are this short
        # is held for the grace; if their voice resumes inside it, the run is
        # dropped and the next turn answers the whole thing. Longer answers are
        # never held — the cost is paid only where the breath is likely.
        self._grace = short_answer_grace_secs
        self._max_words = short_answer_max_words
        # Seconds since the caller's voice was last live — ACOUSTIC (VAD ticks),
        # never the aggregator's turn flag, which stays up for seconds after the
        # words (first real-STT run: a 6 s hold on "Yes, go ahead").
        self._quiet_for = quiet_for or (lambda: float("inf"))
        self._held: Optional[asyncio.Task] = None
        # Replay record: the last user text of every run that goes through.
        self._on_run = on_run or (lambda text: None)

    def allow_rerun(self):
        """The last run FAILED at the vendor (call f58ca825): the same context
        must be allowed to run again on the fallback, which the unchanged-
        context block would otherwise refuse. The failed run is gone, so its
        re-run supersedes nothing: read as "a newer run over an unheard reply"
        it pushed a supersede that cancelled nothing in the LLM but flushed the
        "Just a second." bridge queued for the stall (review 2026-10-08,
        timing sim vertex_stall_failover_slow_tts: 4.55 s → 6.2 s of silence)."""
        self._last_allowed_fp = None
        self._pushed_t = 0.0

    @staticmethod
    def _all_caller_words(msgs) -> int:
        """Caller words in every user message of the context, steering cues
        excluded — grows only when the caller says something."""
        n = 0
        for msg in msgs or []:
            role = msg.get("role") if isinstance(msg, dict) else getattr(msg, "role", None)
            if role != "user":
                continue
            content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", "")
            if isinstance(content, list):
                content = " ".join(str(part.get("text", "")) if isinstance(part, dict) else str(part)
                                   for part in content)
            text = re.sub(r"\[[^\]]*\]", " ", str(content or ""))
            n += len([w for w in re.split(r"[\s,.!?।]+", text) if w])
        return n

    @staticmethod
    def _last_user_text(msgs) -> str:
        for msg in reversed(msgs):
            if isinstance(msg, dict) and msg.get("role") == "user":
                c = msg.get("content")
                return c if isinstance(c, str) else ""
        return ""

    @staticmethod
    def _caller_words(msgs) -> int:
        """Words the caller said in the unanswered user messages at the end of
        the context, steering cues excluded. The turn-gate appends its cue as a
        user message of its own AFTER the words ("Yes" then "[That was their
        ANSWER…]"), so a single-message count would read the cue and see 0."""
        n = 0
        for msg in reversed(msgs):
            role = msg.get("role") if isinstance(msg, dict) else getattr(msg, "role", None)
            if role != "user":
                break
            content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", "")
            if isinstance(content, list):          # multimodal parts
                content = " ".join(str(part.get("text", "")) if isinstance(part, dict) else str(part)
                                   for part in content)
            text = re.sub(r"\[[^\]]*\]", " ", str(content or ""))
            n += len([w for w in re.split(r"[\s,.!?।]+", text) if w])
        return n

    def register_cue(self, text: str, on_drop=None, for_reply: float = 0.0) -> None:
        """The bot is about to start a run of its own with this cue. `for_reply`:
        the reply_started_t of the reply this cue RECOVERS (a next-step after an
        empty / filler / all-repeat reply) — that reply must not count as "a
        reply on its way" against its own recovery (design review 2026-10-01)."""
        self._cues[text] = (on_drop, for_reply)

    def _bot_cue(self, msgs):
        """(text, on_drop, for_reply) when the run's last user message is a
        registered cue."""
        last = self._last_user_text(msgs)
        if last in self._cues:
            on_drop, for_reply = self._cues[last]
            return (last, on_drop, for_reply)
        return None

    def _cue_drop_reason(self, cue):
        """Why the bot's own run must not go now (None = it may). On hold first,
        at the door AND when a parked cue is released: call d8146538
        (2026-10-14) parked a next-step cue 0.25 s before the hold began and
        released it 1 s into it — 11.6 s of re-introduction to a call screener.
        Dropped here, the cue is refunded (on_drop)."""
        if self._on_hold():
            return "the call is on hold"
        return self._bot_run_drop_reason(cue[2])

    def _drop_cue(self, cue, why: str) -> None:
        """Take the cue out of the context (it never ran — the model must not
        see a stale instruction ahead of the caller's next words) and refund it."""
        text, on_drop = cue[0], cue[1]
        self._cues.pop(text, None)
        try:
            msgs = list(self._context.get_messages())
            for i in range(len(msgs) - 1, -1, -1):
                m = msgs[i]
                if (isinstance(m, dict) and m.get("role") == "user"
                        and m.get("content") == text):
                    self._context.set_messages(msgs[:i] + msgs[i + 1:])
                    break
        except Exception:
            logger.exception("run-guard: could not remove a dropped cue")
        if on_drop is not None:
            try:
                on_drop()
            except Exception:
                logger.exception("run-guard: cue on_drop failed")
        if self._diag is not None:
            self._diag.bump("cue_runs_dropped")
        logger.info("run-guard: dropping the bot's own run (%s) — %s", text[:40], why)

    def held(self) -> bool:
        """A caller turn is held for its short-answer grace (it will run)."""
        return self._held is not None and not self._held.done()

    def _drop_held(self, why: str):
        self._drop_opening_wait(why)
        if self._held is not None and not self._held.done():
            self._held.cancel()
            logger.info("run-guard: held short-answer run superseded — %s", why)
            if self._held_cue is not None:
                self._drop_cue(self._held_cue, "superseded by the caller's turn")
        self._held = None
        self._held_cue = None

    def _drop_opening_wait(self, why: str):
        if self._opening_wait is not None and not self._opening_wait.done():
            self._opening_wait.cancel()
            logger.info("run-guard: run waiting on the opening superseded — %s", why)
        self._opening_wait = None

    # How long after a turn left to the opening the caller must hear SOMETHING
    # of ours for "the opening was the reply" to be true.
    _SWALLOW_AUDIT_SECS = 5.0

    def _check_swallowed(self, turn_t: float, last: str) -> None:
        """A caller turn was left to the opening. Check it against what PLAYED:
        no bot audio from the turn until _SWALLOW_AUDIT_SECS later (and not on
        hold) means the caller talked into silence — CALLER_IGNORED
        (swallowed_turns). Before 2026-10-14 every such swallow scored GREEN:
        5e979e3e, 662d1c80, 4cb132a2, a11e6709 (3.5-18 s of silence)."""
        async def _audit():
            try:
                while time.time() - turn_t < self._SWALLOW_AUDIT_SECS:
                    if self._audible_since(turn_t) or self._on_hold():
                        return
                    await asyncio.sleep(0.25)
                if self._audible_since(turn_t) or self._on_hold():
                    return
                if self._diag is not None:
                    self._diag.bump("swallowed_turns")
                logger.warning("run-guard: %r was left to the opening and nothing has "
                               "played since — the caller was ignored", last[:32])
            except asyncio.CancelledError:
                pass
        if self._audible_since(turn_t):
            return
        try:
            self.create_task(_audit())
        except Exception:
            logger.debug("run-guard: no task manager for the swallow audit")

    async def _await_opening(self, frame: Frame, direction: FrameDirection, last: str):
        """A caller run that arrived while the opening was on its way. Not
        held() on purpose: a held turn is "a reply on its way" to the turn-gate
        and the bot's own runs, and the opening is not a model reply. Dropped
        once the opening has been heard — it was the reply; let through if it
        stops being on its way first (cut, killed before it started), because
        then nothing would answer them. Not on the first poll that reads "not
        coming": the cut that stops a delivery queues its re-say a moment
        later, and the newer turn's own run supersedes this one anyway."""
        t0 = time.time()
        idle = 0.0
        while self._opening_pending():
            idle = 0.0 if self._opening_coming() else idle + 0.1
            # A full second, not 0.3 s: a sentence-boundary gap of 0.25 s+ in
            # an opening synthesised sentence by sentence (or an event-loop
            # stall on the 1-vCPU box) read as "not coming" and released a held
            # pickup "हाँ जी" — its reply then talked past the opening's own
            # question (final review 2026-10-14, probe; the B5 shape).
            if idle >= 1.0:
                break
            await asyncio.sleep(0.1)
        self._opening_wait = None
        if not self._opening_pending():
            if self._diag is not None:
                self._diag.bump("turns_swallowed_for_opening")
            logger.info("run-guard: the opening played over %r (%.1fs) — it was the reply",
                        last[:32], time.time() - t0)
            self._check_swallowed(t0, last)
            return
        try:
            msgs = self._context.get_messages()
        except Exception:
            msgs = []
        if not msgs or self._fingerprint(msgs)[0] != "user":
            return
        if self._diag is not None:
            self._diag.bump("opening_unsaid_runs")
        logger.info("run-guard: the opening stopped unheard after %.1fs and nothing is "
                    "saying it — %r runs", time.time() - t0, last[:32])
        if self._caller_forming() or self._voice_live():
            # What stopped it is usually the caller talking: their turn's own
            # run takes these words too (replay of 662d1c80: released into the
            # caller's next piece, two runs, the second dropped as a repeat).
            # Wait for their VOICE as well, not only for words in the
            # aggregator: the STT final lags the voice, and a run sent while
            # they still talk is cut by their own final (review 2026-10-14:
            # 3-4 runs where one would do, "जी सर।" cut twice).
            self._held = self.create_task(self._release_when_formed(
                frame, direction, wait_voice=True, after_opening=last))
            return
        await self._let_through(frame, direction)

    def _add_intro_cue(self, cue: str):
        """Put the note just BEFORE the caller's unanswered words, so the run's
        last user message stays theirs (replay records, the stub LLM and the
        turn-gate all read it); an earlier copy that never got a reply heard
        is taken out first."""
        try:
            msgs = [m for m in self._context.get_messages()
                    if not (isinstance(m, dict) and m.get("content") == cue)]
            i = len(msgs)
            while i > 0 and isinstance(msgs[i - 1], dict) and msgs[i - 1].get("role") == "user":
                i -= 1
            self._context.set_messages(msgs[:i] + [{"role": "user", "content": cue}] + msgs[i:])
            if self._diag is not None:
                self._diag.bump("intro_cues")
            logger.info("run-guard: the person has not heard who is calling — the reply "
                        "introduces")
        except Exception:
            logger.exception("run-guard: could not add the introduction note")

    def _one_door(self) -> bool:
        return True

    async def _release_when_formed(self, frame: Frame, direction: FrameDirection, cue=None,
                                   wait_voice: bool = False, after_opening: Optional[str] = None):
        """Held because the caller's turn was forming. Normally their turn's own
        run supersedes this (process_frame → _drop_held). If it never comes — the
        words were taken some other way — run once nothing is forming and the
        context has been still for 0.3 s; never later than the cap.
        `after_opening`: the run was let go by _await_opening because the
        opening stopped unheard (the caller's words, for the log)."""
        t0 = time.time()
        while ((self._caller_forming() or ((cue is not None or wait_voice) and self._voice_live()))
               and time.time() - t0 < self._forming_cap):
            await asyncio.sleep(0.1)
        capped = self._caller_forming()
        stable, waited, n = 0.0, 0.0, self._context_len()
        while stable < 0.3 and waited < 1.0 and not capped:
            await asyncio.sleep(0.1)
            waited += 0.1
            m = self._context_len()
            if m != n:
                n, stable = m, 0.0
            else:
                stable += 0.1
        self._held = None
        self._held_cue = None
        if cue is not None:
            why = self._cue_drop_reason(cue)
            if why:
                self._drop_cue(cue, why + " (at release)")
                return
            self._cues.pop(cue[0], None)
        if (after_opening is not None and self._opening_pending()
                and self._opening_coming()):
            # The opening was re-said while this waited (the cut that stopped
            # it queues the re-say a moment later): it is the reply again, so
            # wait on it as process_frame would, instead of running the model
            # over it (review 2026-10-14).
            logger.info("run-guard: the opening is on its way again — %r waits for it",
                        after_opening[:32])
            self._opening_wait = self.create_task(
                self._await_opening(frame, direction, after_opening))
            return
        if capped and self._diag is not None:
            self._diag.bump("forming_hold_cap_releases")
        logger.info("run-guard: run held for a forming turn released after %.2fs%s",
                    time.time() - t0, " (cap)" if capped else "")
        await self._let_through(frame, direction)

    async def _let_through(self, frame: Frame, direction: FrameDirection):
        """Every run that reaches the LLM goes through here (pass or release).

        What goes is the context as it stands NOW (the LLM reads the shared
        context, not the one the run arrived with): a held short answer
        released the instant the aggregator appended the rest of the turn —
        before RunGuard has handled the rest's own run — answers the rest too.
        So the fingerprint and the caller-word count are taken from it here:
        that newer run then reads "context unchanged" and is blocked, instead
        of being let through as a second run over the same context with
        nothing to supersede (review 2026-10-08, finding 5)."""
        if self._on_hold():
            # ONE door for the hold too: every run reaches the LLM through here,
            # so nothing generated plays into a hold. Calls 2026-10-14: a caller
            # turn still forming when the hold began ran on release and played
            # 6 s into it (68bdcbcf); a parked next-step cue was released into
            # it — 11.6 s of re-introduction to a call screener (d8146538).
            self._drop_on_hold()
            return
        if self._is_voicemail():
            # A run let go while the recording was still playing (it waited
            # for the "caller's" voice — the recorder's) would answer pieces
            # of a voicemail into the recorder. 36ac8abe replayed (2026-10-14):
            # 16 s of reply after "When you have finished recording…".
            self._last_allowed_fp = None
            logger.info("run-guard: the line is a voicemail recording — no reply to it")
            return
        # Before the fingerprint, so a stale retrigger of this same context
        # still reads "unchanged" and is blocked.
        cue = self._intro_cue()
        if cue:
            self._add_intro_cue(cue)
        self._pushed_t = time.time()
        msgs = None
        try:
            msgs = self._context.get_messages()
            self._pushed_words = self._all_caller_words(msgs)
            if msgs:
                self._last_allowed_fp = self._fingerprint(msgs)[1]
        except Exception:
            self._pushed_words = 0
        self._note_run()
        try:
            # Only a run that answers the caller: the bot's own nudges and cues
            # (no caller words since the last reply) never move the model.
            pre = self._before_run() if self._caller_words(msgs or []) > 0 else None
        except Exception:
            logger.exception("run-guard: before_run failed")
            pre = None
        if pre is not None:
            await self.push_frame(pre, direction)
        await self.push_frame(frame, direction)

    def _drop_on_hold(self) -> None:
        """Drop a run while the call is on hold. The caller's words stay in the
        context — the person's return line runs on top of them — but a steering
        cue goes: the model must not read a stale instruction later."""
        try:
            last = self._last_user_text(self._context.get_messages())
        except Exception:
            last = ""
        if self._diag is not None:
            self._diag.bump("runs_dropped_on_hold")
        # process_frame marked this context "allowed" before the run reached the
        # door; it never ran, so the same context must be able to run later.
        self._last_allowed_fp = None
        if last.startswith("[") and last.endswith("]"):
            on_drop = self._cues.get(last, (None, 0.0))[0]
            self._drop_cue((last, on_drop), "the call is on hold")
            return
        logger.info("run-guard: the call is on hold — not answering %r now; it stays in "
                    "the context for when the person is back", last[:32])

    async def _supersede_unheard(self, msgs=None) -> bool:
        """A newer caller run has arrived. If the run before it went to the LLM
        and its reply has not made a sound yet, cancel it: the newer context
        holds every word it answered, plus the rest. Pushed DOWNSTREAM only —
        upstream, the user aggregator would drop the caller's queued finals.
        Only for a run that carries caller words the earlier one did not — a
        re-run of the same context (failover) or a cue on top of it is not the
        caller going on."""
        since = self._pushed_t
        if not since or not self._supersede():
            return False
        if msgs is not None and self._all_caller_words(msgs) <= self._pushed_words:
            return False
        try:
            unheard = self._reply_unheard(since)
        except Exception:
            logger.exception("run-guard: reply_unheard check failed — not superseding")
            return False
        if not unheard:
            return False
        try:
            flushed = self._runs_noted()
        except Exception:
            flushed = None
        self._pushed_t = 0.0
        if self._diag is not None:
            self._diag.bump("runs_superseded")
        logger.info("run-guard: the caller went on before the reply to their last piece "
                    "made a sound (%.2fs ago) — cancelling it; this run answers the whole "
                    "turn", time.time() - since)
        await self.push_frame(SupersedeInterruptionFrame(runs_flushed=flushed),
                              FrameDirection.DOWNSTREAM)
        return True

    async def _wait_out_forming(self) -> None:
        """Before a held short answer runs: if the caller's next words are
        already in the user aggregator, the turn is not over. Their own run
        arrives when the turn closes and supersedes this one (_drop_held); the
        cap only matters if it never does. Calls 84e52d17, b51093dc, 0ae77e88,
        e11cc15b replayed: the hold released on a context that had been still
        for 0.5 s while the rest of the turn sat in the aggregator (Smart Turn
        INCOMPLETE keeps it up to 1.5 s), and the turn's own run followed
        ~0.55 s later — two replies, the first to a stale half."""
        if not self._supersede() or not self._caller_forming():
            return
        if self._diag is not None:
            self._diag.bump("short_answer_forming_waits")
        logger.info("run-guard: the rest of their turn is still forming — the short "
                    "answer waits for it")
        t0 = time.time()
        while self._caller_forming() and time.time() - t0 < self._forming_cap:
            await asyncio.sleep(0.1)

    async def _release(self, frame: Frame, direction: FrameDirection):
        # Silence already elapsed counts: a final that landed 0.4 s after the
        # voice stopped waits 0.2 s, not 0.6.
        t0 = time.time()
        q0 = self._quiet_for()
        noisy = False
        await asyncio.sleep(max(0.0, self._grace - q0))
        if self._quiet_for() < 0.4:
            # They went on. Wait for the rest, then run ONCE on everything the
            # context holds by then. The run is not simply dropped: when the
            # rest arrives as fragment continuations, the turn-gate appends them
            # WITHOUT a run (a reply was in flight, as far as it knows), and a
            # dropped run would leave the caller in silence (real-STT sim,
            # 2026-09-15: "Yes" / "go ahe" / "ad." → no reply until the nudge).
            # A newer run from the aggregator supersedes this one (see
            # process_frame), so a continuation that IS a new turn costs nothing.
            if self._diag is not None:
                self._diag.bump("short_answer_holds")
            logger.info("run-guard: caller's voice resumed within %.1fs of a short "
                        "answer — waiting for the rest", self._grace)
            waited = 0.0
            while self._quiet_for() < 0.4 and waited < self._noise_cap:
                await asyncio.sleep(0.1)
                waited += 0.1
            if waited >= self._noise_cap:
                # Their "voice" never stopped: a noisy line, not a sentence.
                # Call 59888de8: "नहीं यही सब" waited for a quiet that never
                # came, and she hung up 27 s later.
                noisy = True
                logger.info("run-guard: voice never went quiet in %.1fs after a short answer "
                            "— treating it as line noise and running", self._noise_cap)
                if self._diag is not None:
                    self._diag.bump("short_answer_noise_releases")
            # Time for the tail's final to land and be appended (Smallest
            # finalizes 0.1-0.8 s after the stop): run once the context has
            # been still for 0.5 s, 1.5 s at most.
            stable = 0.0
            waited = 0.0
            n = self._context_len()
            while stable < 0.5 and waited < 1.5:
                await asyncio.sleep(0.1)
                waited += 0.1
                m = self._context_len()
                if m != n:
                    n, stable = m, 0.0
                else:
                    stable += 0.1
        # The context is still, but the rest of the turn may be in the user
        # aggregator, which the context cannot show. Not on a noisy line: a
        # turn whose voice never stops does not close either.
        if not noisy:
            await self._wait_out_forming()
        self._held = None
        logger.info("run-guard: short answer's run released after %.2fs (quiet %.2fs at hold)",
                    time.time() - t0, q0 if q0 != float("inf") else -1.0)
        await self._let_through(frame, direction)

    # A turn Smart Turn closed in the middle of a clause: no sentence-final
    # mark and the last word is one that never ends a sentence ("अ, Rishika के
    # previous class में" — call 28570ec0, 2026-09-15: the run answered the
    # half-sentence by re-asking the question, the caller's "eighty three
    # percent" came 2 s later). Smallest punctuates finished sentences.
    _CLAUSE_TAILS = frozenset({
        "में", "के", "की", "का", "को", "से", "पर", "और", "या", "कि", "तो", "ने", "भी", "ही",
        "mein", "ke", "ki", "ka", "ko", "se", "par", "aur", "ya", "ki", "toh", "bhi",
        "and", "or", "but", "the", "a", "an", "to", "of", "in", "on", "at", "for", "with",
        "is", "are", "was", "my", "his", "her", "our", "their", "so", "because", "that",
    })

    def _ends_mid_clause(self, msgs) -> bool:
        for msg in reversed(msgs):
            role = msg.get("role") if isinstance(msg, dict) else getattr(msg, "role", None)
            if role != "user":
                return False
            content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", "")
            text = str(content or "").strip()
            if text.startswith("[") and text.endswith("]"):
                continue                              # a steering cue, look behind it
            if not text:
                return False
            if text[-1] in "?？":
                return False
            # Sarvam ends EVERY final with a danda or full stop, so a punctuation
            # test made this dead for Hindi callers: "अब पढ़ने में तो।" (call
            # 22062aac, 2026-09-29) went to the model mid-sentence, got "जी।",
            # and started a four-acknowledgment chain. The last WORD decides.
            text = text.rstrip(".!।॥… \t")
            if not text:
                return False
            last = re.split(r"[\s,]+", text.casefold())[-1]
            return last in self._CLAUSE_TAILS
        return False

    def _note_run(self):
        try:
            msgs = self._context.get_messages()
            last = next((m for m in reversed(msgs)
                         if (m.get("role") if isinstance(m, dict) else getattr(m, "role", None)) == "user"), None)
            content = (last.get("content") if isinstance(last, dict) else getattr(last, "content", "")) if last else ""
            if isinstance(content, list):
                content = " ".join(str(p.get("text", "")) if isinstance(p, dict) else str(p) for p in content)
            self._on_run(str(content or "")[:240])
        except Exception:
            pass

    def _context_len(self) -> int:
        try:
            return len(self._context.get_messages())
        except Exception:
            return -1

    def _fingerprint(self, msgs):
        last = msgs[-1]
        role = last.get("role") if isinstance(last, dict) else getattr(last, "role", None)
        return role, (len(msgs), repr(last)[-300:])

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if (isinstance(frame, (LLMContextFrame, LLMRunFrame))
                and direction == FrameDirection.DOWNSTREAM and self._enabled()):
            try:
                ctx = getattr(frame, "context", None) or self._context
                msgs = ctx.get_messages() if ctx is not None else []
            except Exception:
                msgs = []
            if msgs:
                role, fp = self._fingerprint(msgs)
                if role == "user" and self._opening_pending():
                    last = self._last_user_text(msgs)
                    if not takes_over_opening(last):
                        if self._opening_coming():
                            if self._diag is not None:
                                self._diag.bump("runs_held_for_opening")
                            logger.info("run-guard: the opening has not played yet and %r does "
                                        "not take over — the opening is the reply", last[:32])
                            # Every earlier run of this moment too — one let go
                            # by _await_opening and waiting for the caller's
                            # voice included: else it ran the model over the
                            # re-said opening (review 2026-10-14).
                            self._drop_held("a newer turn arrived")
                            self._opening_wait = self.create_task(
                                self._await_opening(frame, direction, last))
                            return
                        # Owed, but nothing will say it: answer them, and the
                        # reply introduces (_intro_cue). Calls 4cb132a2, a11e6709,
                        # 5e979e3e, 662d1c80 (2026-10-14).
                        if self._diag is not None:
                            self._diag.bump("opening_unsaid_runs")
                        logger.info("run-guard: the opening is owed but nothing is saying "
                                    "it — %r runs", last[:32])
                if role != "user":
                    # Nothing new to answer — the last word was OURS.
                    if self._diag is not None:
                        self._diag.bump("empty_runs_blocked")
                    logger.info("run-guard: blocking generation — last context "
                                "message is %r, nothing new to answer", role)
                    return
                if fp == self._last_allowed_fp:
                    # Identical input to the run we already did — the stale-turn
                    # retrigger. Answering it again is how intros double.
                    if self._diag is not None:
                        self._diag.bump("empty_runs_blocked")
                    logger.info("run-guard: blocking generation — context unchanged "
                                "since the previous run")
                    return
                own_cue = self._bot_cue(msgs)
                cue = own_cue if self._one_door() else None
                if cue is not None:
                    # The BOT's own run. One door: never beside a reply that is
                    # already on its way, never once the call is ending, and
                    # never over a caller whose turn is still forming (calls
                    # c05f6c83, 1d28af3a: a cue and the caller's turn each ran
                    # the model for the same moment).
                    why = self._cue_drop_reason(cue)
                    if why:
                        self._drop_cue(cue, why)
                        return
                    if self._caller_forming() or self._voice_live():
                        if self._held is not None and not self._held.done():
                            self._drop_cue(cue, "a caller turn is already held")
                            return
                        logger.info("run-guard: the bot's own run waits — the caller is "
                                    "talking or their turn is forming")
                        self._held_cue = cue
                        self._held = self.create_task(
                            self._release_when_formed(frame, direction, cue=cue))
                        return
                    self._cues.pop(cue[0], None)
                # A newer run supersedes a held one (its context contains the
                # held words too) — but only a run that is itself let through.
                # Dropped ABOVE the two blocks, a stale retrigger or a run with
                # nothing new cancelled the caller's held short answer and was
                # then blocked itself: the answer was never run (design review
                # 2026-10-01, the single-flight map).
                self._drop_held("a newer turn arrived")
                self._last_allowed_fp = fp
                words = self._caller_words(msgs)
                if own_cue is None and words > 0:
                    # …and a run that already went to the LLM, if its reply
                    # has not made a sound: the caller's next piece arrived
                    # first (call 84e52d17: runs of 10 and 12 caller words
                    # 0.55 s apart, both replies played). Before this run is
                    # held or passed, so the cancel lands first.
                    await self._supersede_unheard(msgs)
                if self._caller_forming():
                    # Their turn is still forming. Its own run arrives when it
                    # closes and supersedes this one (the _drop_held above), so
                    # ONE run answers everything — calls c05f6c83 (a cue at
                    # 30.88 s, their turn at 31.36 s) and 20d1c619 ("हाँ।" and
                    # "से अभी।" as two runs 0.56 s apart).
                    if self._diag is not None:
                        self._diag.bump("forming_holds")
                    logger.info("run-guard: the caller's turn is still forming — "
                                "holding this run for it")
                    self._held = self.create_task(self._release_when_formed(frame, direction))
                    return
                unfinished = self._grace > 0 and len(msgs) > 2 and self._ends_mid_clause(msgs)
                if self._grace > 0 and len(msgs) > 2 and (0 < words <= self._max_words or unfinished):
                    logger.info("run-guard: holding the run for a %d-word %s (quiet %.2fs)",
                                words, "unfinished clause" if unfinished and words > self._max_words
                                else "answer", min(self._quiet_for(), 99.0))
                    self._held = self.create_task(self._release(frame, direction))
                    return
                logger.info("run-guard: run passed (%d caller words)", words)
                await self._let_through(frame, direction)
                return
        await self.push_frame(frame, direction)


def next_step_cue(held: str, kind: str = "", attempt: int = 0):
    """The steering cue for a reply that said nothing new: (what, cue text).
    Module-level so the text simulator (sim/run.py) sends the SAME words."""
    if kind == "answer-question":
        q = (held or "").strip().replace("]", "")[:120]
        return "answer-question", (
            "[They just asked you: \"" + q + "\". Your last reply ignored it and repeated "
            "your script line. Answer their question directly, in one or two short "
            "sentences, then stop. Do not repeat the expectations line.]")
    if kind == "continue":
        # The bot's own turn went nowhere: an EMPTY reply from the model, or a
        # statement the caller has had nothing to answer (call 963347ab).
        return "continue", (
            "[You have not moved the call forward yet and the caller is waiting. "
            "Say your NEXT line now — the next point or the next question in your "
            "script, in one or two short sentences. Do not acknowledge or apologise. "
            "If the caller has just said they are busy, not interested or want a "
            "call later, do not push on: offer to call back at a time that suits "
            "them, or close politely.]")
    if kind == "restatement":
        why = ("[Your last reply only said their answer back to them and asked "
               "nothing. Do not restate it again. ")
        what = "restatement"
    elif held and ("?" in held or "？" in held):
        # A dropped QUESTION. The gate cannot tell whether the caller's words
        # answered it; the model can. Call 22062aac (2026-09-29): two replies
        # played back to back, the father answered the SECOND question (the
        # name), and the marks question was then blocked as "already said" on
        # every attempt — 8 s of silence. The gate lets exactly one re-ask of
        # this topic through (_reask_ok_topic).
        line = " ".join((held or "").split()).replace("]", "").replace('"', "'")[:160]
        why = ("[You just asked: \"" + line + "\". If their reply answered it, do not "
               "ask it again, not even reworded — continue with what comes AFTER it in "
               "your script. If they said something else and it is still unanswered, "
               "ask it once more in fewer words. ")
        what = "all-repeat"
    elif held:
        # Name the line. A generic "you repeated yourself" left Gemini to guess
        # what it had repeated, and it said the same line again — then the
        # fallback was a bare "जी, बोलिए।" / "हाँ जी?" (calls 83735c51,
        # 97c06634, 2026-09-26: the expectations lines, which are statements,
        # re-said after the parent's "ठीक है").
        line = " ".join((held or "").split()).replace("]", "").replace('"', "'")[:160]
        why = ("[You just said: \"" + line + "\" — the caller HEARD it and has replied. "
               "Do not say it again, not even reworded, and do not restate their answer. "
               "Continue with what comes AFTER it in your script. ")
        what = "all-repeat"
    else:
        why = ("[Your last reply was only an acknowledgment and the caller is "
               "waiting. Do not acknowledge again. ")
        what = "filler-only"
    if attempt >= 2:
        # Second time round: a concrete way out, or the model loops.
        tail = ("Either ask ONE new question that moves the call forward, or — if "
                "what they said means this is not for them — say a one-line polite "
                "goodbye and append " + END_MARKER + ".]")
    else:
        tail = ("Say your NEXT line now — the next question or the next useful "
                "fact, in one or two short sentences — or close politely if what "
                "they said means this is not for them.]")
    return what, why + tail


# Spoken when a requested human transfer could not be registered. A module
# constant rather than an inline default so the TTS cache can pre-warm it: it is
# a fixed, bot-authored line like the farewells and the handbacks.
TRANSFER_FAIL_CLOSING = ("Mujhe abhi connect karne mein dikkat aa rahi hai — hamare "
                         "counsellor aapko jald call karenge. Dhanyavaad!")
# The same line for a non-education agent (app/agent_domain): "counsellor" is
# an education word, and promising one is what an edtech caller would say.
TRANSFER_FAIL_CLOSING_GENERAL = ("Mujhe abhi connect karne mein dikkat aa rahi hai — "
                                 "hamari team aapko jald call karegi. Dhanyavaad!")


class SentinelGate(FrameProcessor):
    """Between LLM and TTS: strips the steering markers from the token stream so
    they are never spoken, accumulates the assistant transcript one utterance at
    a time, tracks bot-speaking state for the idle watchdog, and stops the
    pipeline after the final utterance finished playing."""

    def __init__(self, outcome: CallOutcome, on_activity, set_bot_speaking,
                 on_reply_start=None, on_send=None,
                 transfer_closing: str = "Ek moment, main aapko connect kar rahi hoon.",
                 end_closing: str = "Theek hai, dhanyavaad. Aapka din shubh ho!",
                 transfer_fail_closing: str = TRANSFER_FAIL_CLOSING, diag=None):
        super().__init__()
        self._diag = diag
        # SUPERSEDED REPLIES (RunGuard, config.run_supersede). Their markers
        # follow the caller's own agreement or request, so a <<SEND:…>> still
        # fires at token time and a <<TRANSFER>> stands — the newer reply plays
        # and the handoff follows (decision 2026-10-08; the sends are counted).
        # END is different: the superseded reply's goodbye never played, and
        # its orphan End reaches us BEFORE the supersede, so the latch below
        # has already promoted it — taken back at the supersede, or a "ठीक है"
        # in the newer reply's time-to-first-token is swallowed as the
        # goodbye and the line starts closing (review 2026-10-08, finding 6).
        self._audio_since_start = False   # bot audio started since this reply began
        self._end_unheard = False         # END promoted by a reply nothing of which played
        self._sends_this_response = 0
        self._outcome = outcome
        self._on_activity = on_activity
        self._set_bot_speaking = set_bot_speaking
        self._on_reply_start = on_reply_start or (lambda: None)
        # Mid-call send hook. Default no-op so every existing construction site and
        # every test keeps working untouched.
        self._on_send = on_send or (lambda _key: None)
        # One send per artefact per call. The model re-states its offer when the caller
        # says 'haan' twice, and the caller must not get the brochure twice for it.
        self._sends_fired: set = set()
        self._transfer_closing = transfer_closing
        self._end_closing = end_closing
        self._transfer_fail_closing = transfer_fail_closing
        self._transfer_fallback_done = False
        self._task: Optional[PipelineTask] = None
        # run_bot injects _begin_stop so sentinel-initiated stops arm the SAME
        # graceful-stop deadline as watchdog stops (deep-review A6/F2: raw
        # stop_when_done left the drain starvable forever).
        self._arm_stop = None
        self._buffer = ""          # marker hold-back across token chunks
        self._utterance = ""       # current assistant utterance (one transcript entry)
        self._raw_reply = ""       # the model's text for this response, unfiltered (replay)
        self._spoke_this_response = False
        self._response_active = False  # LLM tokens still streaming for this response
        # A2 shield: a barge-in DURING streaming cancels the LLM task, but its
        # finally-block still emits an orphan LLMFullResponseEndFrame. Downstream,
        # pipecat 0.0.95's assistant aggregator decrements its _started counter
        # for EVERY End it sees — the interruption already reset it to 0, so the
        # orphan End underflows it to -1 and ALL later assistant text is silently
        # dropped from the model's context (verbatim repeats / re-asking, deep-
        # review A2, verified against the wheel). Swallow exactly that one End.
        self._swallow_next_end = False
        # Injected by run_bot: disarms the audio-stall stamp when a reply dies
        # before playout (see the InterruptionFrame branch).
        self._on_interrupted_cb = None
        # Per-response end latch; promoted to outcome.end_requested only when the
        # response ENDS, so a marker seen mid-stream cannot make a later,
        # unrelated response close the call.
        self._end_this_response = False
        # True once the line is genuinely closing. After this an end intent can no
        # longer be revoked.
        self._stop_armed = False
        self._defer_stop_cb = None
        self._clear_end_pending_cb = None

    def set_task(self, task: PipelineTask):
        self._task = task

    def set_arm_stop(self, arm_stop):
        self._arm_stop = arm_stop

    def set_on_interrupted(self, cb):
        self._on_interrupted_cb = cb

    def set_end_hooks(self, defer_stop, clear_end_pending):
        """Wire the revocable close: defer_stop starts the grace, and
        clear_end_pending cancels it when the caller re-engages."""
        self._defer_stop_cb = defer_stop
        self._clear_end_pending_cb = clear_end_pending

    def _defer_stop(self) -> None:
        if self._defer_stop_cb is not None:
            try:
                self._defer_stop_cb()
            except Exception:
                logger.exception("sentinel: defer-stop hook failed")
        elif self._task is not None:
            # No hook wired (older caller): fall back to the old immediate close
            # rather than never closing at all.
            self._stop_armed = True

    def _clear_end_pending(self) -> None:
        if self._clear_end_pending_cb is not None:
            try:
                self._clear_end_pending_cb()
            except Exception:
                pass

    def _on_interrupted(self, superseded: bool = False) -> None:
        if self._on_interrupted_cb is not None:
            try:
                if superseded:
                    self._on_interrupted_cb(superseded=True)
                else:
                    self._on_interrupted_cb()
            except Exception:
                logger.exception("sentinel: on_interrupted callback failed")

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, InterruptionFrame):
            # pipecat 1.4: the assistant aggregator closes the turn itself on
            # interruption (interrupted=True) — the 0.0.95 `_started` underflow
            # this swallow shielded (deep-review A2) does not exist here, and
            # eating a legitimate End would now corrupt turn accounting. The
            # flag machinery stays for the response-local bookkeeping below.
            # Stale hold-back/utterance from the aborted response must not bleed
            # into the next one (deep-review B6).
            self._buffer = ""
            self._response_active = False
            # Disarm the audio-stall stamp. It is otherwise cleared ONLY on a
            # bot-speaking transition (set_bot_speaking), so a reply killed
            # BEFORE playout — no BotStarted, no BotStopped — leaves it armed and
            # the watchdog "recovers" by re-speaking a reply the caller
            # deliberately interrupted. 6-13% of generations die pre-playout.
            if isinstance(frame, SupersedeInterruptionFrame):
                self._on_interrupted(superseded=True)   # replaced on purpose, not lost
                self._superseded()
            else:
                self._on_interrupted()
            await self.push_frame(frame, direction)
            return

        if isinstance(frame, LLMFullResponseStartFrame):
            self._on_reply_start()
            self._raw_reply = ""
            # A bot generating a fresh reply is NOT closing. Live call ee8e2168:
            # the bot said goodbye, the caller re-engaged with "Yes, I can", the
            # bot asked "May I know a convenient date and time?" — and the stale
            # call-scoped end latch dropped the line before they could answer,
            # losing the booking. Revoke while the line is still open.
            if self._outcome.end_requested and not self._stop_armed:
                self._outcome.end_requested = False
                self._clear_end_pending()
                logger.info("sentinel: end intent superseded by a new response corr=%s",
                            self._outcome.corr)
            # A NEW response begins — any expected orphan End never arrived (or
            # was consumed upstream); swallowing this response's End instead
            # would corrupt the aggregator bracket the OTHER way.
            self._swallow_next_end = False
            self._audio_since_start = False
            self._end_unheard = False
            self._sends_this_response = 0
            await self.push_frame(frame, direction)
            return

        if isinstance(frame, LLMTextFrame):
            self._on_activity(user=False)
            self._response_active = True
            self._buffer += frame.text or ""
            self._raw_reply += frame.text or ""
            if "<" in self._buffer:
                self._buffer = _canonical_markers(self._buffer)
                if "<tool_call>" in self._buffer and "</tool_call>" in self._buffer:
                    logger.warning("sentinel: model wrote a tool-call block — removed from speech "
                                   "corr=%s %r", self._outcome.corr, self._buffer[:80])
                    self._buffer = _TOOL_CALL_RE.sub("", self._buffer)
            if TRANSFER_MARKER in self._buffer:
                self._outcome.transfer_requested = True
                self._buffer = self._buffer.replace(TRANSFER_MARKER, "")
            if END_MARKER in self._buffer:
                # PER-RESPONSE latch. Promoted to outcome.end_requested only when
                # this response ENDS — a marker seen mid-stream must not make a
                # later, unrelated response close the call.
                self._end_this_response = True
                self._buffer = self._buffer.replace(END_MARKER, "")
            if SEND_MARKER_OPEN in self._buffer:
                self._buffer = self._extract_sends(self._buffer)
            emit, self._buffer = self._split_safe(self._buffer)
            if emit:
                self._utterance += emit
                self._spoke_this_response = True
                await self.push_frame(LLMTextFrame(emit), direction)
            return

        if isinstance(frame, LLMFullResponseEndFrame):
            _rp = getattr(self._outcome, "replay", None)
            if _rp is not None and self._raw_reply.strip():
                _rp["replies"].append([round(time.time() - self._outcome.connected_at, 2),
                                       self._raw_reply.strip()[:600]])
            # A leftover hold-back can only be a partial marker prefix (e.g. a
            # max_tokens cutoff mid-"<<END_CA") — never speak it; treat a partial
            # END prefix as intent to end so the call can't stall.
            if self._buffer:
                logger.info("sentinel: dropping partial marker tail %r corr=%s",
                            self._buffer, self._outcome.corr)
                if self._buffer.startswith("<<T"):
                    # A max_tokens cut mid-"<<TRANSFER>>" is a request for a HUMAN —
                    # ending instead hung up on exactly the callers who asked for one.
                    self._outcome.transfer_requested = True
                elif self._buffer.startswith("<<"):
                    self._end_this_response = True
                self._buffer = ""
            # The model said goodbye but forgot the marker (recordings 4acc56a6,
            # 6fa15c09: "…धन्यवाद, नमस्ते", then 8-11 s of silence, then a nudge).
            # Not in the opening seconds: "Namaste Aditi ji, I'm Aarushi…" is a greeting.
            if (not self._end_this_response and self._spoke_this_response
                    and any(t.get("role") == "user" for t in self._outcome.transcript)
                    and is_farewell(self._utterance)):
                logger.info("sentinel: farewell without marker %r — ending corr=%s",
                            self._utterance[-60:], self._outcome.corr)
                self._end_this_response = True
            if self._end_this_response or getattr(self._outcome, "end_forced", False):
                if not self._end_this_response:
                    logger.info("sentinel: caller asked to end and the model did not append "
                                "the marker — ending anyway corr=%s", self._outcome.corr)
                self._outcome.end_requested = True
                self._end_this_response = False
                self._end_unheard = not self._audio_since_start
            self._response_active = False
            self._flush_utterance()
            if self._swallow_next_end:
                # The orphan End of an interrupted stream — local bookkeeping done
                # above; do NOT push it downstream (A2 underflow shield). An
                # interrupted response must also never drive the marker-only
                # close, and its spoke-flag must not leak into the next response.
                self._swallow_next_end = False
                self._spoke_this_response = False
                logger.info("sentinel: swallowed orphan response-End after interruption corr=%s",
                            self._outcome.corr)
                return
            await self.push_frame(frame, direction)
            # Marker-only response (nothing spoken): no BotStoppedSpeakingFrame
            # will ever arrive, so speak a short close to drive the stop path.
            if ((self._outcome.end_requested or self._outcome.transfer_requested)
                    and not self._spoke_this_response):
                closing = (self._transfer_closing if self._outcome.transfer_requested
                           else self._end_closing)
                self._utterance = closing
                self._spoke_this_response = True
                self._flush_utterance()
                await self.push_frame(TTSSpeakFrame(closing), direction)
            self._spoke_this_response = False
            return

        if isinstance(frame, BotStartedSpeakingFrame):
            self._set_bot_speaking(True)
            self._on_activity(user=False)
            self._audio_since_start = True
            self._end_unheard = False
            self._sends_this_response = 0     # counted only while nothing has played
            await self.push_frame(frame, direction)
            return

        if isinstance(frame, BotStoppedSpeakingFrame):
            self._set_bot_speaking(False)
            self._on_activity(user=False)
            # Don't flush while LLM tokens are still streaming: a filler's playout
            # ending mid-response used to split ONE sentence across two transcript
            # entries ('...क्या' / 'यह दो मिनट...') — audio was continuous, only the
            # saved transcript fractured. Flush happens at LLMFullResponseEndFrame.
            if not self._response_active:
                self._flush_utterance()
            await self.push_frame(frame, direction)
            if self._outcome.transfer_requested and not self._outcome.transfer_registered:
                await self._register_handoff()
                if (not self._outcome.transfer_registered
                        and not self._transfer_fallback_done):
                    # Handoff registration failed (admin_core down / no target):
                    # do NOT end on an unfulfilled "connecting you now" — promise a
                    # callback instead, then close on that farewell's BotStopped.
                    self._transfer_fallback_done = True
                    self._outcome.transfer_requested = False
                    self._outcome.end_requested = True
                    logger.warning("sentinel: handoff failed — speaking callback fallback corr=%s",
                                   self._outcome.corr)
                    self._utterance = self._transfer_fail_closing
                    self._spoke_this_response = True
                    self._flush_utterance()
                    await self.push_frame(TTSSpeakFrame(self._transfer_fail_closing), direction)
                    return
            if self._outcome.transfer_requested and self._task:
                # Transfer closes immediately — the caller is waiting to be put
                # through, and a grace period here is dead air.
                logger.info("sentinel: stopping call corr=%s (transfer=True)",
                            self._outcome.corr)
                self._stop_armed = True
                if self._arm_stop is not None:
                    await self._arm_stop()
                else:
                    await self._task.stop_when_done()
            elif self._outcome.end_requested and self._task and not self._stop_armed:
                # The farewell has finished playing. Hold the line open briefly:
                # the watchdog closes it after end_grace_secs, and ANY real word
                # from the caller cancels the close instead (on_transcript).
                logger.info("sentinel: farewell played — closing after grace corr=%s",
                            self._outcome.corr)
                self._defer_stop()
            return

        await self.push_frame(frame, direction)

    def _superseded(self) -> None:
        """RunGuard cancelled the reply in progress before a sound of it played
        (see __init__, SUPERSEDED REPLIES)."""
        self._end_this_response = False
        if self._end_unheard and self._outcome.end_requested and not self._stop_armed:
            self._outcome.end_requested = False
            self._clear_end_pending()
            logger.info("sentinel: the goodbye of a superseded reply never played — the "
                        "call is not ending corr=%s", self._outcome.corr)
        self._end_unheard = False
        if self._sends_this_response and self._diag is not None:
            self._diag.bump("sends_from_superseded_reply", self._sends_this_response)
        self._sends_this_response = 0

    def _flush_utterance(self):
        # Transcript commits moved to PlayedTranscriptRecorder (playout-ordered,
        # played-text-only — deep-review A3). The utterance accumulator remains
        # only as marker bookkeeping; clear it each response.
        self._utterance = ""

    async def _register_handoff(self):
        numbers = (self._outcome.context.get("handoff") or {}).get("numbers") or []
        if not numbers:
            logger.warning("transfer requested but no handoff target corr=%s", self._outcome.corr)
            return
        try:
            registered = await asyncio.wait_for(
                admin_core.post_handoff(self._outcome.corr, numbers[0]), timeout=4.0)
        except asyncio.TimeoutError:
            logger.warning("handoff registration timed out corr=%s", self._outcome.corr)
            registered = None
        self._outcome.transfer_registered = registered is not None

    def _extract_sends(self, buffer: str) -> str:
        """Strip every COMPLETE send marker and fire it; leave a partial one in place.

        A partial marker stays in the buffer and _split_safe holds it back from the TTS,
        so a marker split across two token chunks is never spoken and never lost.
        """
        out = []
        pos = 0
        while True:
            start = buffer.find(SEND_MARKER_OPEN, pos)
            if start == -1:
                out.append(buffer[pos:])
                break
            end = buffer.find(SEND_MARKER_CLOSE, start + len(SEND_MARKER_OPEN))
            if end == -1:
                out.append(buffer[pos:])      # incomplete — wait for the next chunk
                break
            key = buffer[start + len(SEND_MARKER_OPEN):end].strip()
            out.append(buffer[pos:start])
            pos = end + len(SEND_MARKER_CLOSE)
            if not _valid_send_key(key):
                logger.info("sentinel: ignoring malformed send marker %r corr=%s",
                            key, self._outcome.corr)
            elif key in self._sends_fired:
                logger.info("sentinel: send %s already fired this call corr=%s",
                            key, self._outcome.corr)
            else:
                self._sends_fired.add(key)
                self._sends_this_response += 1
                logger.info("sentinel: mid-call send %s corr=%s", key, self._outcome.corr)
                try:
                    self._on_send(key)
                except Exception:
                    # The voice path outranks the send, always.
                    logger.exception("sentinel: send hook failed for %s corr=%s",
                                     key, self._outcome.corr)
        return "".join(out)

    @staticmethod
    def _split_safe(buffer: str) -> tuple[str, str]:
        """Emit everything except a trailing prefix that might grow into a marker."""
        # A send marker has a VARIABLE payload, so the fixed-prefix scan below cannot
        # see a half-written one. Hold back from an unterminated open marker to the end.
        idx = buffer.rfind(SEND_MARKER_OPEN)
        if idx != -1 and SEND_MARKER_CLOSE not in buffer[idx:]:
            return buffer[:idx], buffer[idx:]
        # An open tool-call block: hold everything from it until it closes (the
        # LLMTextFrame branch strips the completed block; the End branch drops a
        # never-closed one). Nothing after "<tool_call>" is ever speech.
        idx = buffer.find("<tool_call>")
        if idx != -1:
            return buffer[:idx], buffer[idx:]
        # The single-bracket form sarvam-105b sometimes writes: hold back an
        # unterminated "<SEND:…" too, or its first half is spoken.
        m = re.search(r"(?<!<)<SEND:[^<>]*$", buffer)
        if m:
            return buffer[:m.start()], buffer[m.start():]
        for marker in (END_MARKER, TRANSFER_MARKER, SEND_MARKER_OPEN,
                       *_LOOSE_MARKER_PREFIXES):
            for i in range(min(len(marker) - 1, len(buffer)), 0, -1):
                if buffer.endswith(marker[:i]):
                    return buffer[:-i], buffer[-i:]
        return buffer, ""


# Sarvam Bulbul voices → grammatical gender. Hindi/Hinglish first-person verbs are
# gendered, so a female voice saying masculine "kar raha hoon" is the #1 immersion
# breaker on Indian calls. We know the voice, so we pin the grammar to match it.
# Union across Bulbul versions (a name's gender doesn't change between versions, and
# there's no male/female name collision), so a voice picked from ANY version's palette
# is classified right. bulbul:v3 male speakers must be here or a v3 male voice would
# be spoken with FEMALE grammar (the bug this set exists to prevent).
_MALE_VOICES = {
    # bulbul:v3 male
    "shubh", "aditya", "rahul", "rohan", "amit", "dev", "ratan", "varun", "manan",
    "sumit", "kabir", "aayan", "ashutosh", "advait", "anand", "tarun", "sunny", "mani",
    "gokul", "vijay", "mohit", "rehan", "soham",
    # bulbul:v2 male
    "abhilash", "karun", "hitesh",
    # bulbul:v1 male (legacy)
    "amol", "amartya", "arvind", "neel", "vian",
    # Rumik Silk Mulberry 1.5 male presets. These MUST be here: this set is the
    # only thing that makes the LLM write masculine Hindi verb endings, and a
    # Rumik agent on "adam" would otherwise say "kar rahi hoon" in a male voice.
    "lucas", "noah", "theo", "adam",
}
# Google + Smallest male voices are UNIONED into this set right after their
# palettes are defined below — same reason as the Rumik note above: this set is
# the ONLY thing that makes the LLM write masculine Hindi verb endings.

# Rumik Mulberry 1.5 female presets, kept explicit rather than inferred from the
# male set's complement — _voice_gender defaults unknown names to female, so an
# unlisted female voice is harmless, but naming them documents the real palette
# for the picker and catches a typo'd voice at review time.
_RUMIK_FEMALE_VOICES = {
    "emma", "mia", "sophia", "ava", "ira", "siya", "aisha", "zoya",
}
_RUMIK_MALE_VOICES = {"lucas", "noah", "theo", "adam"}
RUMIK_VOICES = _RUMIK_FEMALE_VOICES | _RUMIK_MALE_VOICES

# ── Google Cloud TTS (hi-IN) ────────────────────────────────────────────────
# Curated from the live list_voices API (46 hi-IN voices; 30 Chirp3-HD). Kept to
# a shortlist so the Python palette and Java TtsVoiceCatalog can stay in
# agreement — a mismatch there is what silently substitutes a caller's voice.
# Gender comes from Google's own ssml_gender, NOT from the name: "Achird" and
# "Achernar" are male and female respectively and nothing in the string says so.
_GOOGLE_MALE_VOICES = {
    "hi-in-chirp3-hd-achird", "hi-in-chirp3-hd-charon", "hi-in-chirp3-hd-fenrir",
    "hi-in-chirp3-hd-orus", "hi-in-chirp3-hd-puck", "hi-in-chirp3-hd-schedar",
    "hi-in-neural2-b", "hi-in-neural2-c", "hi-in-wavenet-b", "hi-in-wavenet-c",
}
_GOOGLE_FEMALE_VOICES = {
    "hi-in-chirp3-hd-achernar", "hi-in-chirp3-hd-aoede", "hi-in-chirp3-hd-kore",
    "hi-in-chirp3-hd-leda", "hi-in-chirp3-hd-zephyr", "hi-in-chirp3-hd-sulafat",
    "hi-in-neural2-a", "hi-in-neural2-d", "hi-in-wavenet-a", "hi-in-wavenet-d",
}
GOOGLE_VOICES = _GOOGLE_MALE_VOICES | _GOOGLE_FEMALE_VOICES

# ── Smallest.ai Lightning ───────────────────────────────────────────────────
# From the live get_voices catalog, Hindi-tagged Indian-accent voices only.
# ⚠️ The palettes are PER-MODEL and do not overlap: the API hard-rejects a
# cross-model voice ("Voice 'devansh' is not available on the
# lightning_v3.1_pro model") — i.e. a mute call. lightning_v3.1 is our default,
# so its names lead; the _pro names are listed separately for the picker.
_SMALLEST_V31_MALE = {"devansh", "kaustubh", "virat", "karan", "yash", "debashis"}
_SMALLEST_V31_FEMALE = {"imogen", "nirupma", "niharika"}
_SMALLEST_PRO_MALE = {"mandar", "mathan", "barath"}
_SMALLEST_PRO_FEMALE = {"manasi", "mrunal", "ketaki", "meher"}
SMALLEST_VOICES = _SMALLEST_V31_MALE | _SMALLEST_V31_FEMALE
SMALLEST_PRO_VOICES = _SMALLEST_PRO_MALE | _SMALLEST_PRO_FEMALE
# Kept for any caller that wants "is this a Smallest name at all" regardless of model.
SMALLEST_ANY_VOICES = SMALLEST_VOICES | SMALLEST_PRO_VOICES

# ── Deepgram Aura-2 ─────────────────────────────────────────────────────────
# ENGLISH ONLY — the live /v1/models catalog has no Hindi voice at any tier, so
# these are for English-speaking agents. Genders are Deepgram's own metadata
# tags (feminine/masculine), NOT guessed from the mythological names: Janus and
# Juno are both FEMALE here, which no reading of the names would tell you.
# American accent only; Deepgram has no en-IN.
_DEEPGRAM_MALE_VOICES = {
    "aura-2-apollo-en", "aura-2-arcas-en", "aura-2-atlas-en",
    "aura-2-hermes-en", "aura-2-mars-en", "aura-2-odysseus-en",
}
_DEEPGRAM_FEMALE_VOICES = {
    "aura-2-asteria-en", "aura-2-athena-en", "aura-2-helena-en",
    "aura-2-hera-en", "aura-2-luna-en", "aura-2-cordelia-en",
    "aura-2-harmonia-en", "aura-2-electra-en",
}
DEEPGRAM_VOICES = _DEEPGRAM_MALE_VOICES | _DEEPGRAM_FEMALE_VOICES

# Navana (Bodhi): 55 voice ids, each speaking all ten languages. Navana publishes
# no genders; these are read from the names (achu, temjen, vetri are the least
# certain — audition before relying on the verb gender they imply).
_NAVANA_MALE = {"achu", "anirban", "basava", "basheer", "bijay", "chhotu", "elango", "faizal", "gurdeep", "imran", "kannan", "kishan", "murugan", "savio", "shivanna", "srinu", "sulaiman", "tanaji", "temjen", "vetri", "xavier"}
_NAVANA_FEMALE = {"ammu", "ann", "arasi", "ayesha", "bhavana", "bimla", "champa", "falguni", "flavia", "harleen", "ipsita", "jayita", "jessy", "kayal", "mahadevi", "malar", "maria", "merin", "mukta", "nasrin", "nayeema", "netra", "nila", "ponni", "porkavi", "rukhiya", "rukhsana", "selvi", "shabnam", "sharon", "shikha", "vanaja", "yasmin", "zoya"}
NAVANA_VOICES = _NAVANA_MALE | _NAVANA_FEMALE

# One place where every engine's male voices land, so _voice_gender works for
# all four. Missing a name here means a male voice speaking feminine Hindi —
# the #1 immersion complaint from live calls.
_MALE_VOICES |= (_GOOGLE_MALE_VOICES | _SMALLEST_V31_MALE | _SMALLEST_PRO_MALE
                 | _DEEPGRAM_MALE_VOICES | _NAVANA_MALE | SARVAM_V4_MALE)


def _engine_of(model: str) -> str:
    """Normalize a stored tts_model into one of our four engine ids."""
    m = (model or "").strip().lower()
    if m.startswith(("rumik", "silk")):
        return "rumik"
    if m.startswith(("google", "chirp")):
        return "google"
    if m.startswith(("smallest", "lightning")) and "pro" in m:
        return "smallest_pro"
    if m.startswith(("smallest", "lightning")):
        return "smallest"
    if m.startswith(("deepgram", "aura")):
        return "deepgram"
    if m.startswith(("navana", "bodhi")):
        return "navana"
    # Before the Sarvam fallback: v4 is its own engine (disjoint voices, see
    # app/sarvam_v4_voices.py) and must never be read as v3.
    if m.startswith(("sarvam_v4", "sarvam-v4", "bulbul:v4", "bulbul_v4", "bulbul-v4")):
        return "sarvam_v4"
    return "sarvam"


# Per-engine defaults + palettes, so adding a 5th engine is one table row rather
# than a new branch in three functions.
_ENGINE_DEFAULT_VOICE = {
    "sarvam": "priya",
    "rumik": "ira",
    # Founder chose Chirp3-HD by ear; Achird is its male voice (agent Ameet).
    "google": "hi-IN-Chirp3-HD-Achird",
    "smallest": "devansh",
    "smallest_pro": "mandar",
    # English-only engine; Asteria is its clear/confident female voice.
    "deepgram": "aura-2-asteria-en",
    "navana": "bhavana",
    "sarvam_v4": SARVAM_V4_DEFAULT_VOICE,
}


def _engine_palette(engine: str):
    return {"rumik": RUMIK_VOICES, "google": GOOGLE_VOICES,
            "smallest": SMALLEST_VOICES,
            "smallest_pro": SMALLEST_PRO_VOICES,
            "deepgram": DEEPGRAM_VOICES,
            "navana": NAVANA_VOICES,
            "sarvam_v4": SARVAM_V4_VOICES}.get(engine)


def _default_voice_for(agent) -> str:
    """Provider default voice. Grammar follows it via _voice_gender, so the
    default and the prompt's verb endings can never disagree."""
    return _ENGINE_DEFAULT_VOICE.get(_engine_of(_agent_tts_model(agent)), "priya")


def _voice_gender(voice) -> str:
    return "male" if (voice or "priya").strip().lower() in _MALE_VOICES else "female"


def _agent_tts_model(agent) -> str:
    """Which TTS vendor this agent speaks through.

    Explicit agent config wins; otherwise the env default. Institutes created
    before the picker existed have no tts_model, and they are billed at the
    Sarvam rate, so they must KEEP Sarvam — silently moving a paying institute
    to a different-sounding voice is not a config change, it is a product change.
    """
    m = (agent.get("tts_model") or "").strip().lower()
    return m or get_settings().tts_model


def _agent_voice(agent):
    """The configured voice, dropped if it belongs to the other vendor's palette.

    Voice names do not cross vendors, and the two engines fail DIFFERENTLY when you
    send the wrong one (both probed against the live APIs):

      * Sarvam REJECTS an unknown speaker outright ("Speaker 'x' is not compatible
        with model bulbul:v3", HTTP 400) — so a Rumik name on a Sarvam agent means
        no audio at all.
      * Rumik SILENTLY SUBSTITUTES its default voice. It returned 184 KB of clean
        audio for "priya". So the call is not mute — it is worse in a quieter way:
        the caller hears a voice nobody chose, and because the LLM's Hindi verb
        gender was conjugated for the CONFIGURED voice, a male-configured agent can
        end up speaking masculine Hindi in a female voice.

    Either way the stored name is not usable, so fall back to the provider default,
    which at least keeps voice and grammar consistent with each other.
    """
    voice = (agent.get("voice") or "").strip()
    if not voice:
        return None
    engine = _engine_of(_agent_tts_model(agent))
    palette = _engine_palette(engine)
    low = voice.lower()
    if palette is not None:
        # Engine with a known palette: the voice MUST be in it.
        return voice if low in palette else None
    # Sarvam has no enumerated palette here (dozens of speakers across bulbul
    # versions), so instead reject anything that clearly belongs elsewhere.
    for other in (RUMIK_VOICES, GOOGLE_VOICES, SMALLEST_ANY_VOICES, DEEPGRAM_VOICES, SARVAM_V4_VOICES):
        if low in other:
            return None
    return voice


def _as_float(v) -> float | None:
    """Tolerant numeric read for call-context JSON (numbers arrive as int/float/str)."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# The agent's configured "language" (a UI value like "hinglish") → a Sarvam STT
# BCP-47 tag to PIN transcription, plus a human label for the prompt. Pinning matters:
# auto-detect drifts a Hindi/Hinglish caller into a neighbouring Indic language
# (Punjabi/Marathi), and once a turn is transcribed as that, the LLM replies and the
# TTS speaks it for the rest of the call. Hinglish pins to hi-IN — saarika still
# transcribes the English words in a Hinglish sentence, it just never leaves Hindi.
_STT_LANGS = {
    "hinglish": ("hi-IN", "Hindi or Hinglish"),
    "hindi": ("hi-IN", "Hindi"),
    "english": ("en-IN", "English"),
    "punjabi": ("pa-IN", "Punjabi"),
    "marathi": ("mr-IN", "Marathi"),
    "gujarati": ("gu-IN", "Gujarati"),
    "bengali": ("bn-IN", "Bengali"),
    "tamil": ("ta-IN", "Tamil"),
    "telugu": ("te-IN", "Telugu"),
    "kannada": ("kn-IN", "Kannada"),
    "malayalam": ("ml-IN", "Malayalam"),
    # Sarvam spells Odia "od-IN", NOT the ISO "or-IN" — verified against the
    # SDK's own Literal. The ISO form is rejected, so Odia agents failed.
    "odia": ("od-IN", "Odia"),
    "oriya": ("od-IN", "Odia"),
}


# Calls 3bc5f884/f8d8478b/be51d77f/5b88b55c (2026-10-22, Arushi CRM): the agent's script
# pairs every line with a Hinglish version in Latin letters and says "mirror English or
# Hinglish". With callers who had only said "Yes", the model opened in that Hinglish or
# ended an English pitch with its Hinglish question, and the English voice read it in an
# English accent. The language is decided by the caller, never by the script.
_ENGLISH_CALL_LANGUAGE_LOCK = (
    "\n- LANGUAGE: This is an English call. Every sentence you say is in English until the "
    "caller asks you to speak Hindi or speaks it to you in full sentences (see LANGUAGE "
    "STABILITY). Your instructions may also give Hindi or Hinglish "
    "versions of lines — those are only for after such a switch: before it, never say "
    "them, never open in Hindi, and never end an English reply with a Hindi sentence. One "
    "reply is one language."
)


def _agent_stt_mode(agent) -> str:
    """Sarvam saaras `mode` for this agent.

    codemix keeps a Hinglish caller's code-switched words as they were spoken.
    The alternatives both lose information: transcribe with a hi-IN pin turned
    ENGLISH callers into Devanagari ("इफ यू रिकॉर्ड योर नेम"), and translate
    forces everyone into English so the model can no longer tell what language
    the caller actually used.
    """
    raw = (agent.get("language") or "").strip().lower()
    return "codemix" if raw in ("hinglish", "hindi-english", "hi-en") else "transcribe"


def _agent_language(agent) -> tuple[str | None, str]:
    """(BCP-47 STT tag or None, human label). None ⇒ let build_stt use its env default."""
    raw = (agent.get("language") or "").strip().lower()
    if not raw:
        return None, "Hindi or Hinglish"
    if raw in _STT_LANGS:
        return _STT_LANGS[raw]
    if "-" in raw and len(raw) <= 6:  # already a tag like "hi-in"
        parts = raw.split("-")
        return f"{parts[0]}-{parts[1].upper()}", agent.get("language")
    return None, agent.get("language")


def _lead_fields_line(context: Dict[str, Any]) -> str:
    """One prompt line listing the lead's captured form/custom fields, so the agent uses
    what it already knows (company, role, …) instead of re-asking. Capped so a lead with
    many fields can't blow up the prompt. Empty for unknown callers."""
    fields = context.get("leadFields") or {}
    if not isinstance(fields, dict) or not fields:
        return ""
    pairs = [f"{k}: {v}" for k, v in fields.items() if v and str(v).strip()][:15]
    if not pairs:
        return ""
    return ("What you ALREADY KNOW about this person (from the form they filled — use it to "
            "personalise, and do NOT ask again for anything already listed here): "
            + "; ".join(pairs) + ".")


# Parent-facing words for where a lead came from (audience_response.source_type).
# An unknown type falls back to a plain "enquiry form": a wrong channel is worse
# than a vague one.
_ENQUIRY_SOURCES = {
    "META_LEAD_ADS": "the form on one of {inst}'s ads on Facebook or Instagram (which of the two is not on record, so always name both: 'Facebook या Instagram')",
    "FACEBOOK_ADS": "the form on one of {inst}'s ads on Facebook or Instagram (which of the two is not on record, so always name both: 'Facebook या Instagram')",
    "INSTAGRAM_ADS": "the form on one of {inst}'s ads on Facebook or Instagram (which of the two is not on record, so always name both: 'Facebook या Instagram')",
    "GOOGLE_ADS": "the form on one of {inst}'s ads on Google",
    "LINKEDIN_ADS": "the form on one of {inst}'s ads on LinkedIn",
    "WEBSITE": "the enquiry form on {inst}'s website",
    "COURSE_CATALOGUE": "a course page on {inst}'s website",
    "SELF_SIGNUP": "signing up on {inst}'s website",
    "WALK_IN": "visiting {inst} in person",
    "INBOUND_CALL": "calling {inst}",
}


def _ago(days: int) -> str:
    if days <= 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 14:
        return f"{days} days ago"
    if days < 60:
        return f"about {round(days / 7)} weeks ago"
    return f"about {round(days / 30)} months ago"


def _lead_enquiry_line(context: Dict[str, Any], general: bool = False) -> str:
    """When and where the lead enquired, from admin_core's leadEnquiry block. Parents
    ask "मैंने कब form भरा?" / "कहाँ से number मिला?"; without this the model could only
    repeat a stock line (call 6313b454: three times, then "Not interested"). A date is
    given ONLY when admin_core marked it genuine (dateKnown): a bulk-imported lead's
    stamp is the import day, and stating it would be a false date. Empty when there is
    no block.

    general=True (a non-education agent, app/agent_domain): a blank institute
    name reads "the company", not "the institute" — that word alone tells a
    thin-script model it calls for a school (AAIBUZZ/IRPL calls c43e9ce7,
    e6cb5f47, 2026-10-16)."""
    enq = context.get("leadEnquiry")
    if not isinstance(enq, dict) or not enq:
        return ""
    inst = (str(context.get("instituteName") or "").strip()
            or ("the company" if general else "the institute"))
    source = _ENQUIRY_SOURCES.get(str(enq.get("sourceType") or "").strip().upper(),
                                  "an enquiry form for {inst}").format(inst=inst)
    agent = context.get("agent") or {}
    tzname = (agent.get("timezone") or context.get("timezone") or "Asia/Kolkata").strip()
    try:
        tz = ZoneInfo(tzname)
    except Exception:
        tz = ZoneInfo("Asia/Kolkata")
    today = datetime.now(tz).date()

    def _day(key: str):
        raw = str(enq.get(key) or "").strip()
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(tz).date()
        except ValueError:
            return None

    head = ("WHEN AND WHERE THEY ENQUIRED — use this ONLY if they ask when, where or how "
            "they enquired, or how you got their number. ")
    tail = (" Say it once, simply, in the language of the call, then carry on with the "
            "conversation; if they ask again, do not repeat it word for word. Never add "
            "details that are not here: no ad name, no page, no time of day.")
    day = _day("submittedAt") if enq.get("dateKnown") is True else None
    if day is not None:
        return (head + f"They enquired through {source} on {day.strftime('%A %-d %B %Y')} "
                f"({_ago((today - day).days)}). Name that date when you answer." + tail)
    recorded = _day("recordedAt")
    months = (today - recorded).days // 30 if recorded is not None else 0
    when = ("some months ago" if months >= 2 else "some time ago")
    return (head + f"They enquired through {source} {when}. The exact date is NOT on record: "
            f"never name a date, a month or a number of days or weeks, only say it was {when}."
            + tail)


_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_ ]+?)\s*\}\}")

# Author-written placeholder names -> the lead-field names they should resolve
# against. EXACT alias match only (never fuzzy): a wrong name in a sentence is
# worse than a neutral one. Key = the field names to look up, value = the
# {{placeholders}} that mean it.
_PLACEHOLDER_SYNONYMS: Dict[tuple, set] = {
    ("child name", "children name", "student name", "kid name", "child"): {
        "child_name", "children_name", "student_name", "kid_name", "child",
        "childs_name", "child name", "student name",
    },
    ("parent name", "guardian name", "father name", "mother name"): {
        "parent_name", "guardian_name", "father_name", "mother_name",
        "parent name", "guardian name",
    },
}

# The lead IS the parent on these campaigns, so these may fall back to leadName.
# Deliberately NOT every *_name key — see _fill_placeholders step 3.
_PARENT_ALIASES = {
    "parent_name", "guardian_name", "parent name", "guardian name", "contact_name",
}


def _lead_field(context: Dict[str, Any], *names: str) -> str | None:
    """First non-blank lead custom field matching any of `names` (case-insensitive)."""
    fields = context.get("leadFields") or {}
    wanted = {n.strip().lower() for n in names}
    for k, v in fields.items():
        if str(k).strip().lower() in wanted and v is not None and str(v).strip():
            return str(v).strip()
    return None


def _fill_placeholders(text: str, context: Dict[str, Any], sink=None, *, full_name: bool = False) -> str:
    """Substitute the author's {{placeholders}} with real call values BEFORE the model
    sees the prompt. Left literal, `{{institute_name}}` etc. reach the model, which then
    improvises or fills them wrong (observed: {{institute_name}} became our account's
    legal name, not the brand). Unknown/empty → a graceful neutral, never a literal
    '{{...}}'. NOTE: {{institute_name}} is the PROSPECT's institute — deliberately NOT
    our instituteName (that mash-up is what produced the wrong-company opening)."""
    if not text or "{{" not in text:
        return text
    lead_name = context.get("leadName")
    # Simulator run 2026-09-12: 12/12 callers were addressed by their FULL name
    # mid-call ("Namaste Sunita Devi ji") because the authored prompt says
    # "{{name}} ji" and {{name}} was the list's full name. A person is addressed
    # by first name; the full name belongs only in the identity check of the
    # opening line ("Hi, is this Vijay Madhekar?") — full_name=True there.
    if lead_name and not full_name:
        lead_name = str(lead_name).split()[0]
    agent_cfg = context.get("agent") or {}
    # "aap" in an ENGLISH opening ("Hello, am I speaking with aap?") is as broken
    # as a blank — for English agents an unknown name renders as nothing and the
    # whitespace cleanup below closes the hole ("Is this ?" -> "Is this?").
    _is_en = str(agent_cfg.get("language") or "").strip().lower().startswith("en")
    _name_fallback = "" if _is_en else "aap"
    if not lead_name and _is_en:
        # No name on the lead (campaign rows with a blank "Who", 2026-09-15):
        # "Hi, is this {{name}}? Aarushi from Vacademy" rendered as
        # "Hi, is this? Aarushi from Vacademy" on every call. Drop the
        # identity-check clause rather than ask it of nobody.
        text = re.sub(r"\b(?:is this|is that|is it|am i (?:speaking|talking) (?:with|to))\s*"
                      r"\{\{\s*(?:name|lead_name)\s*\}\}\s*[?？]?\s*",
                      "", text, flags=re.I)
        text = re.sub(r",\s*,", ",", text)
        text = re.sub(r"(^|[.!?]\s*)\s*,\s*", r"\1", text)
        text = re.sub(r"\s{2,}", " ", text).strip()
        # The clause was the whole line ("Hello, am I speaking with {{name}}?"):
        # close the greeting instead of leaving "Hello,".
        text = re.sub(r"[,\s]+$", ".", text) if text and text[-1] in ", " else text
    values = {
        "lead_name": lead_name or _name_fallback,
        "name": lead_name or _name_fallback,
        "institute_name": _lead_field(context, "institute", "institute name", "company",
                                      "organisation", "organization") or "aapke institute",
        "lead_source": _lead_field(context, "source", "lead source", "lead_source",
                                   "enquiry source") or "apni enquiry",
        "lead_source_line": "",
        "booked_slot": _lead_field(context, "slot", "booked slot", "demo slot") or "",
    }
    # Date/time placeholders. A live agent's prompt used {{day}}, {{date}} and
    # {{time}} and every one rendered EMPTY (seen in a real call's diagnostics:
    # promptUnfilled ["day","date","time"]) — so the model was handed blanks
    # exactly where it needed to know "now", which is what the booking flow
    # depends on to resolve "tomorrow". Same tz rule as _now_line: the agent's
    # configured timezone, else Asia/Kolkata.
    _tz = (agent_cfg.get("timezone") or context.get("timezone") or "Asia/Kolkata").strip()
    try:
        _now = datetime.now(ZoneInfo(_tz))
    except Exception:
        _now = datetime.now(ZoneInfo("Asia/Kolkata"))
    values.update({
        "day": _now.strftime("%A"),
        "today": _now.strftime("%A, %-d %B %Y"),
        "date": _now.strftime("%-d %B %Y"),
        "time": _now.strftime("%-I:%M %p"),
        "datetime": _now.strftime("%A, %-d %B %Y, %-I:%M %p"),
        "now": _now.strftime("%A, %-d %B %Y, %-I:%M %p"),
        "tomorrow": (_now + timedelta(days=1)).strftime("%A, %-d %B %Y"),
        "year": _now.strftime("%Y"),
        "month": _now.strftime("%B"),
    })

    def repl(m: "re.Match[str]") -> str:
        key = m.group(1).strip().lower()
        # 1) A known key.
        if key in values:
            return values[key]
        # 2) The author's own field name, matched against the lead's captured
        #    fields (casefold + '_'<->' '), plus the common name synonyms. This is
        #    the fix for a 100% silent failure: the whitelist previously returned
        #    "" for ANY unknown key, so a prompt written with {{child_name}} /
        #    {{parent_name}} rendered as "with , whose child  studies" on all
        #    141/141 calls of that agent (2026-07-29 forensics).
        direct = _lead_field(context, key, key.replace("_", " "))
        if direct:
            return direct
        for canon, aliases in _PLACEHOLDER_SYNONYMS.items():
            if key in aliases:
                hit = _lead_field(context, *canon)
                if hit:
                    return hit
                break
        # 3) The person we are CALLING is the parent/guardian, so an unresolved
        #    {{parent_name}} is the lead themselves. Scoped to this alias set on
        #    purpose — a blanket "*name -> lead_name" would also fire for
        #    {{school_name}} / {{child_name}} and speak the wrong person's name.
        if key in _PARENT_ALIASES and lead_name:
            return lead_name
        # 4) Give up — but LOUDLY, so this can never be silent again.
        #    NO generic "*name -> lead_name" fallback: `endswith("name")` also
        #    matches {{school_name}}, {{agent_name}}, {{child_name}}, so an
        #    unresolved key would make the bot call the SCHOOL (or the child) by
        #    the parent's name. A hole in the sentence is bad; confidently
        #    speaking the wrong person's name is worse.
        logger.warning("prompt placeholder %r unresolved — rendering empty", key)
        # `sink` is passed per-call (never a module global): up to 10 calls run
        # concurrently in one process and a shared buffer would cross-contaminate.
        if sink is not None:
            try:
                sink(key)
            except Exception:
                pass
        return ""

    filled = _PLACEHOLDER_RE.sub(repl, text)
    # An empty substitution leaves grammar debris in SPOKEN text ("Is this ?").
    # Collapse runs of spaces and pull punctuation back onto the previous word.
    filled = re.sub(r"[ \t]{2,}", " ", filled)
    filled = re.sub(r" +([?!,.।;:])", r"\1", filled)
    return filled


def _opening_barely_heard(opening: str, transcript, reply_started_t: float,
                          heard_ratio: float = 0.5, played_secs: float = 0.0) -> bool:
    """Was the scripted opening cut before the caller could have taken it in?

    True only while the call is still AT the opening: no LLM reply has started
    (reply_started_t == 0) and the played transcript holds less than
    `heard_ratio` of the opening text. A later cut — the caller heard most of
    it, or a reply has since run — is the ordinary continuation case.
    Call 9e566e32 (2026-09-09): played "Hi," of a 109-char opening."""
    if not opening or reply_started_t:
        return False
    # AUDIO first. A cached opening is ONE blob, and its text reaches the played
    # transcript only when the blob ends — so a cut at 10.4 s of 12.4 s left no
    # opening text at all, read as "barely heard", and the caller who had just
    # said "अभी time नहीं है madam" heard "नमस्ते जी, मैं श्रेया…" from the top,
    # twice, then hung up (call 1f2b97ab, 2026-10-01; 13 of 58 re-says in
    # 28 Sep-1 Oct came after more than half of the opening had played).
    if played_secs >= heard_ratio * opening_expected_secs(opening):
        return False
    # How much of THE OPENING played — not whatever the bot said last. A
    # "Hmm…" filler after a fully-played opening made the last entry 4 chars,
    # the opening read as unheard, and RunGuard swallowed every reply as "the
    # opening is the reply": the caller heard "Hmm…", then only nudges (timing
    # sim smallest_filler_then_live_and_cached, 7 of 8 runs; 36 held runs in
    # production logs 22-25 Sep).
    ok = spoken_key(opening)
    best = 0
    for entry in transcript or []:
        if entry.get("role") != "assistant":
            continue
        k = spoken_key(entry.get("text") or "")
        if k and ok.startswith(k[:min(len(k), 12)]):
            best = max(best, len(k))
    return best < len(ok) * heard_ratio


def opening_intro_secs(opening: str, names) -> float:
    """Seconds of the opening that must PLAY before the person has heard who
    is calling: up to the end of the last of `names` (the agent's name, the
    institute) found in it, at opening_expected_secs' rate. 0.0 when it names
    neither — a bare greeting, and the prompt already has the first reply
    introduce. Shreya's "…मैं श्रेया बोल रही हूँ Shiksha Nation से" ends at
    ~3.3 s of 14 (2.9 s of the real 12.4 s audio)."""
    low = (opening or "").casefold()
    end = 0
    for n in names or ():
        n = (n or "").strip().casefold()
        i = low.find(n) if n else -1
        if i >= 0:
            end = max(end, i + len(n))
    return opening_expected_secs(opening[:end]) if end else 0.0


def intro_cue_text(name: str, institute: str) -> str:
    """The note a run carries while the person has not heard who is calling
    (calls 9fd6489d, a11e6709, c3818b83, 2026-10-14): the context still holds
    the opening and the prompt says it "has been said", so without it the
    model never introduces. Names come from the agent context, never fixed."""
    name, institute = (name or "").strip(), (institute or "").strip()
    who = (f"you are {name}, calling from {institute}" if name and institute
           else f"you are {name}" if name else f"you are calling from {institute}")
    return ("[The person has NOT heard who you are — your opening never reached them, "
            "whatever your history shows. Begin with ONE short sentence saying "
            f"{who}, in the language of the call, then reply to what they said.]")


_NAME_NOISE_RE = re.compile(r"\([^)]*\)|\[[^\]]*\]|\{[^}]*\}")
_ORG_NAME_WORDS = frozenset({
    "studio", "academy", "yoga", "classes", "class", "institute", "school", "college",
    "program", "programs", "programme", "centre", "center", "pvt", "ltd", "llp", "gym",
    "fitness", "coaching", "tuition", "tutorials", "solutions", "services", "group",
    "team", "wellness", "foundation", "trust", "clinic", "hospital", "enterprises",
})


def _clean_lead_name(name) -> Optional[str]:
    """The person's name as it should be SPOKEN, or None when the list gave us
    something that is not a person.

    Call 5a9fe35a (2026-09-11): the audience list held "Bhawana Jain (founder)"
    and the bot said "Hi, is this Bhawana Jain founder?"; the same batch carried
    "Beena Bhati / Pooja" and "I Am Yoga Studio". Parentheticals and everything
    after a separator are list annotations, not names; a name made of business
    words is an organisation, and name_sanity_rule already knows to ask
    "May I know who I'm speaking with?" when the name is absent."""
    s = str(name or "")
    s = _NAME_NOISE_RE.sub(" ", s)
    s = re.split(r"\s*[/|,;]\s*", s, maxsplit=1)[0]
    s = " ".join(s.split()).strip(" -–—.:")
    if not s or _lead_name_is_phone(s):
        return None
    words = [w.strip(".,").casefold() for w in s.split()]
    if any(w in _ORG_NAME_WORDS for w in words):
        return None
    return s


def _lead_name_is_phone(name) -> bool:
    """Is this "name" actually a phone number? ("919425677707", "+91 94256 77707")
    Mostly digits and at least seven of them — a real name never is, and digit-
    heavy junk ("Lead #4521-A") deserves the same treatment as a bare number."""
    s = str(name or "")
    digits = sum(ch.isdigit() for ch in s)
    visible = sum(not ch.isspace() for ch in s)
    return digits >= 7 and digits >= 0.7 * visible


def _opening_is_substantive(opening: str, min_words: int = 4) -> bool:
    """Does the scripted opening actually CARRY the call, or is it just a greeting?

    "Hello" / "नमस्ते" answers nothing and asks nothing: the caller hears it and
    waits, and so do we. Call 5d81ace1 sat silent for 2.1s after saying "Hello"
    and only moved when the caller spoke a SECOND time — 5.9s to the first real
    sentence. A full opening ("Hello, main Shreya baat kar rahi hoon Shiksha
    Nation se…") needs no such help.

    Same 4-word threshold as turntake.suppresses_opening, and for the same
    reason: below it, a line is a greeting rather than a turn.
    """
    return len((opening or "").split()) >= min_words


def _clean_opening(text: str) -> str:
    """Sanitize an authored openingLine for SPEECH. Admins paste whole script blocks
    into the field (observed live: '# VACADEMY AI – INTRODUCTION SPEECH', blank lines,
    '(Wait for confirmation)') and TTSSpeakFrame reads every character aloud. Keep only
    speakable words: drop markdown headings, stage directions (lines fully wrapped in
    brackets), and markdown emphasis; collapse whitespace."""
    if not text:
        return ""
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if (line.startswith("(") and line.endswith(")")) or            (line.startswith("[") and line.endswith("]")):
            continue  # stage direction, not speech
        lines.append(line)
    out = " ".join(lines)
    out = out.replace("**", "").replace("*", "").replace("`", "")
    out = re.sub(r"\s+", " ", out).strip()
    # Authors wrap the line in quotes ('"Hi, this is Avni…"'). Spoken, a stray
    # quote is at best silent; worse, a clause that ends up holding ONLY the
    # closing quote is rejected by Sarvam and wedges the TTS socket open-but-dead
    # (see providers.has_word_char). Strip a matched wrapping pair, then any
    # leftover edge quotes.
    if len(out) >= 2 and out[0] in '"“”‘’\'' and out[-1] in '"“”‘’\'':
        out = out[1:-1].strip()
    out = out.strip('"“”‘’\'').strip()
    return out[:600]


def _now_line(context: Dict[str, Any]) -> str:
    """A prominent 'right now it is ...' line so the model can resolve relative dates
    ('tomorrow', 'day after', 'next Monday') the caller mentions. Without it the LLM
    has NO idea what today is and mis-schedules. Timezone: the agent's configured
    tz if set, else Asia/Kolkata (all current calls are India). Computed fresh per
    call so it never goes stale."""
    agent = context.get("agent") or {}
    tzname = (agent.get("timezone") or context.get("timezone") or "Asia/Kolkata").strip()
    try:
        now = datetime.now(ZoneInfo(tzname))
    except Exception:
        tzname = "Asia/Kolkata"
        now = datetime.now(ZoneInfo(tzname))
    # e.g. "Wednesday, 22 July 2026, 3:45 PM"
    stamp = now.strftime("%A, %-d %B %Y, %-I:%M %p")
    # The week as a LOOKUP, not an arithmetic exercise. Sarvam LLM POC eval
    # (2026-09-10, today = Thursday 10 Sept): asked for "day after", sarvam-105b
    # confirmed "Friday the 12th" (the 12th was a Saturday) — the prompt only
    # named today and tomorrow, so it had to count. It also invented "six PM"
    # for a caller who only said "evening", 2 runs of 3. Gemini got the
    # weekday right 3/3 but that was the model doing arithmetic we can do here.
    labels = ("today", "tomorrow", "day after tomorrow")
    week = []
    for i in range(7):
        d = now + timedelta(days=i)
        tag = f" ({labels[i]})" if i < len(labels) else ""
        week.append(d.strftime("%A %-d %B") + tag)
    return (
        f"RIGHT NOW it is {stamp} ({tzname}). Use this as the current date and time. "
        "The next seven days are: " + "; ".join(week) + ". "
        "When the caller mentions a relative day — 'today', 'tomorrow', 'day after tomorrow', "
        "'this weekend', 'next Monday' — READ the day and date from that list; never count "
        "it out yourself. When you confirm, say the concrete day and date ('Saturday the 12th'). "
        "Never state a clock time the caller did not say: 'evening' or 'morning' is not a "
        "time — ask what time suits them."
    )


def build_system_prompt(context: Dict[str, Any], sink=None) -> str:
    agent = context.get("agent") or {}
    lead_name = context.get("leadName")
    extraction = agent.get("extractionQuestions") or []
    dispositions = agent.get("dispositions") or []
    name = agent.get("name") or "the assistant"
    stt_tag, lang_label = _agent_language(agent)
    is_english = stt_tag == "en-IN"
    # _agent_voice, not agent["voice"]: if the name was dropped as belonging to
    # the other vendor we speak with the provider default, so the grammar has to
    # match THAT voice, not the discarded config.
    gender = _voice_gender(_agent_voice(agent) or _default_voice_for(agent))
    direction = str(context.get("direction") or agent.get("direction") or "OUTBOUND").upper()
    now_line = _now_line(context)
    # A non-education agent gets the same rules with industry-neutral examples
    # plus grounding_rule; an education (or blank) agent's prompt stays byte-
    # identical. AAIBUZZ/IRPL calls c43e9ce7, e6cb5f47 (2026-10-16): a thin
    # generic script, and the bot sold "learning programs for children" and
    # booked a demo, both taken from the examples below. See app/agent_domain.
    general = is_general_agent(agent)

    if gender == "female":
        gender_line = (
            "You are a woman. When you speak Hindi or Hinglish, ALWAYS use FEMININE "
            "first-person verb forms for yourself — 'main kar rahi hoon', 'kar sakti hoon', "
            "'karungi', 'deti hoon', 'bataungi', 'samajh gayi' — and NEVER the masculine "
            "forms ('raha', 'sakta', 'karunga', 'deta', 'gaya'). Keep this consistent the whole call."
        )
    else:
        gender_line = (
            "You are a man. When you speak Hindi or Hinglish, ALWAYS use MASCULINE "
            "first-person verb forms for yourself — 'main kar raha hoon', 'kar sakta hoon', "
            "'karunga', 'deta hoon', 'samajh gaya' — and NEVER the feminine forms. "
            "Keep this consistent the whole call."
        )

    # SECOND-person agreement + HONORIFIC. Hindi addresses the LISTENER with gendered
    # forms ('aap kaisi hain' to a woman vs 'aap kaise hain' to a man), and the model's
    # reflex English honorific is 'sir' — wrong for a woman, the #1 gender complaint.
    # An explicit leadGender (resolved server-side from the user record, else the name)
    # wins; when it's UNKNOWN, forbid guessing a gendered honorific — use the name + 'ji'.
    lead_gender = str(context.get("leadGender") or "").strip().lower()
    if is_english:
        # English agents: the Hindi second-person grammar rules below would be an
        # unconditional instruction to speak Hindi ('aap kaise hain', name + 'ji') —
        # one of the two confirmed pushes that flipped English calls into Hindi.
        if lead_gender in ("female", "f", "woman"):
            addressee_line = ((f"{lead_name} is a woman" if lead_name else
                              "The person on the line is a woman")
                             + " — if you use an honorific, say 'ma'am', never 'sir'.")
        elif lead_gender in ("male", "m", "man"):
            addressee_line = ((f"{lead_name} is a man" if lead_name else
                              "The person on the line is a man")
                             + " — if you use an honorific, say 'sir', never 'ma'am'.")
        else:
            addressee_line = ("You do NOT know whether this person is a man or a woman "
                              "— never guess 'sir' or 'ma'am'; address them by "
                              + (f"name ({lead_name})" if lead_name else "name") + ".")
    elif lead_gender in ("female", "f", "woman"):
        who = f"{lead_name} is a WOMAN" if lead_name else "The person on the line is a WOMAN"
        addressee_line = (
            f"{who}. Use FEMININE second-person Hindi — 'aap kaisi hain', 'aap kya chahti hain', "
            "'aap bata sakti hain' — and, if you use an honorific, say 'ma'am' or "
            + (f"'{lead_name} ji'" if lead_name else "her name with 'ji'")
            + ". NEVER call her 'sir' and never use masculine forms for her."
        )
    elif lead_gender in ("male", "m", "man"):
        who = f"{lead_name} is a MAN" if lead_name else "The person on the line is a MAN"
        addressee_line = (
            f"{who}. Use MASCULINE second-person Hindi — 'aap kaise hain', 'aap kya chahte hain', "
            "'aap bata sakte hain' — and, if you use an honorific, say 'sir' or "
            + (f"'{lead_name} ji'" if lead_name else "his name with 'ji'")
            + ". Never use feminine forms for him."
        )
    else:
        addressee_line = (
            "You do NOT know whether this person is a man or a woman, so you MUST NOT guess a "
            "gendered honorific — NEVER say 'sir' or 'ma'am'. Address them by their name with 'ji' ("
            + (f"'{lead_name} ji'" if lead_name else "their name + ' ji'")
            + ") and use gender-neutral 'aap' forms ('aap kaise hain'). Only if they clearly reveal "
            "their gender by how they speak of themselves ('main aayi'/'karungi' = a woman, 'main "
            "aaya'/'karunga' = a man) may you switch to the matching feminine/masculine forms."
        )

    # Company identity comes from the AGENT'S OWN prompt (which names the brand it should
    # say, e.g. "Vacademy"). Do NOT also inject the institute's legal display name here — a
    # second, different company name ("Vidyayatan Technologies") makes the model mash the two
    # ("Vacancy"). Refer to it generically and let the prompt be the single source of the name.
    if direction == "INBOUND":
        intent_line = (
            "This person has CALLED your organisation. You are answering their call — greet them "
            "warmly, quickly find out why they called, and help them. Name your company EXACTLY as "
            "your instructions specify."
        )
    else:
        intent_line = (
            "You are PROACTIVELY CALLING this person — YOU placed this call, they did not call you. "
            "Never sound like you are answering their call. If they speak first (a 'hello'), your "
            "FIRST reply is your full opening — never a bare greeting word back. Open with "
            # GENERAL: "a clear reason" with no reason in the script is the gap
            # AAIBUZZ/IRPL calls c43e9ce7, e6cb5f47 (2026-10-16) filled with an
            # invented product; the reason comes from GROUNDING's sources only.
            + ("the reason for calling that your instructions give (see GROUNDING — never "
               "make one up), " if general else "a clear reason for calling, ")
            + "introduce yourself and your company EXACTLY as your instructions specify (never invent "
            "or alter the company name), lead the conversation confidently, and keep a warm, "
            "positive, forward-moving tone that gives them a reason to engage right now."
        )

    # Placed near the TOP (primacy matters under live-call latency) and applied to every
    # agent — the failure modes seen on real calls (verbatim loops, deflecting instead of
    # answering, ignoring rising frustration, ploughing on through mis-hears, switching
    # language unprompted) are conversation-level and no per-agent prompt reliably prevents
    # them. These are hard rules, phrased as mechanisms not vibes.
    non_negotiable = (
        "NON-NEGOTIABLE RULES — these override everything else:\n"
        "1) NEVER repeat a sentence you have already said. If the caller asks the same thing "
        "again, your previous answer FAILED — do NOT say it again. Acknowledge briefly ('Sorry, "
        "main clearly bata deti hoon —') and answer the LITERAL question they asked, even if it is "
        "outside your script"
        # GENERAL: "outside your script" must not read as leave to answer
        # "what does your company do?" from general knowledge (AAIBUZZ/IRPL
        # calls c43e9ce7, e6cb5f47, 2026-10-16).
        + (" — but a fact about your business still comes only from GROUNDING below: if "
           "your instructions do not give it, say a colleague will share it" if general else "")
        + ". You may steer toward "
        + ("your next step" if general else "your goal (demo/next step)")
        + " at most ONCE per "
        "topic; if they push again, ANSWER the question instead of steering.\n"
        "2) ANSWER direct questions directly FIRST, then invite the next step. Never stonewall or "
        "dodge (never say things like 'their strategy is different' to avoid answering). If you "
        "genuinely don't have a specific fact, say so honestly and offer to share it another way — "
        "do not invent, do not evade.\n"
        "3) FRUSTRATION = STOP. If the caller repeats a question, says 'main ye nahi pooch raha', or "
        "sounds annoyed: drop the script immediately, apologise briefly, and answer their exact "
        "question. If you cannot resolve it in one turn, offer a human callback rather than continuing.\n"
        "4) If the conversation stops making sense, or they seem to answer a different question than "
        "you asked, assume you MIS-HEARD: say 'Sorry, aapki awaaz thodi clear nahi aayi, ek baar phir "
        "boliye?' — do NOT plough ahead with your script.\n"
        f"5) Speak {lang_label} and STAY in it for the whole call. Every reply must be in the "
        f"same language and script as YOUR OWN previous turns — mirror yourself, not the "
        f"transcript. A single word from the caller in any other language ('yes', 'achha', "
        f"'haan') is NEVER a cue to switch; if a transcript looks like another language, treat "
        f"it as a mis-heard {lang_label} line. Switch only if the caller explicitly asks, or "
        f"speaks 3+ consecutive full sentences in the other language.\n"
        "6) End every turn with a question, a quick check-in ('right?') or a clear closing — "
        "then STOP COMPLETELY and wait for the caller's answer. NEVER answer your own question, "
        "NEVER say 'thank you' or continue as if they replied when they haven't. The caller's "
        "silence is NOT consent — wait for them.\n"
        "7) A neutral SPOKEN acknowledgment to your yes/no question ('okay', 'cool', 'hmm', "
        "'go ahead', 'haan', 'achha') means YES — move forward. Never re-ask a question you "
        "already asked, and never repeat any sentence verbatim; if you must clarify, rephrase "
        "it in under 8 words."
    )
    # GENERAL agents only (empty for education agents). AAIBUZZ/IRPL calls
    # c43e9ce7, e6cb5f47 (2026-10-16): the script said "briefly explain why you
    # are calling" and never said why, or what AAIBUZZ sells; the model made up
    # an edtech company and booked a 5 PM demo. Its own "never invent prices,
    # dates or facts" line did not stop it: a whole product is not a "fact" to
    # a model. So this names exactly what may not be made up, and where it may
    # come from. Unconditional for GENERAL agents in BOTH prompt shapes (an
    # authored prompt does not get non_negotiable — see below). A booking page
    # (agent.bookingEnabled, sent by admin_core) is the platform offering a
    # meeting, so it lifts the meeting ban.
    grounding_rule = ""
    # The LAST line of a GENERAL prompt. In the middle of ~19k characters the
    # grounding rule did not hold against a point-blank "आप exactly क्या offer
    # करते हो?": the live probe (2026-10-16) still got "digital marketing
    # services", "an AI customer-engagement platform" in most runs. The end of
    # the prompt is what the model weighs most. Empty for education agents.
    closing_grounding = ""
    if general:
        closing_grounding = (
            "LAST AND MOST IMPORTANT: you know ONLY what your instructions at the top say "
            "about your company. If they do not say what it sells or does, you do NOT know "
            "it — when asked, say 'Iski poori jaankari hamari team aapko degi' (or the same "
            "in the caller's language) and ask if a team member may contact them. Never "
            "describe a product, service, platform or solution that your instructions do "
            "not name, not even in general words, and never promise anything your "
            "instructions do not offer."
        )
        _offers_meeting = bool(agent.get("bookingEnabled"))
        # The enquiry may be the stated reason only when it is a real one: a
        # known source (_ENQUIRY_SOURCES) or a genuine date. A bulk-imported
        # lead's block falls back to "an enquiry form for <inst>", which may
        # not be true, so it stays "use this ONLY if they ask" (_lead_enquiry_line).
        _enq = context.get("leadEnquiry")
        _enquiry_is_reason = isinstance(_enq, dict) and bool(_enq) and (
            _enq.get("dateKnown") is True
            or str(_enq.get("sourceType") or "").strip().upper() in _ENQUIRY_SOURCES)
        grounding_rule = (
            "GROUNDING — NEVER INVENT YOUR BUSINESS (this overrides every other rule and every "
            "example in these rules, the NON-NEGOTIABLE rules included): who your company is, "
            "what it sells or does, any product, service, offer, price, fee, discount, date, "
            "timing, schedule or place, and the reason for this call may come ONLY from your "
            "instructions above, from THINGS YOU CAN SEND (if these rules list any), and from "
            "the details about this person given in these rules (what they filled in, when and "
            "where they enquired). Today's date and time, as these rules give them, are real: "
            "use them to settle a day. Never guess what industry your company is in, and never "
            "make up a product, a programme, a feature, a benefit or a customer story: if your "
            "instructions do not say it, you do not know it. If the caller asks something your "
            "instructions do not cover, say honestly, in the caller's language, that a "
            "colleague will share those details with them — never fill the gap with a guess.\n"
            # Live probe of the AAIBUZZ setup (2026-10-16): with the education examples
            # gone, "आप exactly क्या offer करते हो?" still got "AI-powered marketing /
            # business-intelligence solutions" in 5 of 6 runs — read off "AAIBUZZ AI
            # Agent". A name is not a product description, and the honest answer has
            # to be spelled out or the model reaches for a plausible one.
            "YOUR NAMES ARE NOT A DESCRIPTION: the company's name and your own agent name "
            "(even when they contain words like AI, Tech, Digital, Solutions, Labs) tell you "
            "NOTHING about what the company sells — never work a product out of a name. When "
            "the caller asks what your company does or offers and your instructions above do "
            "not describe it, answer exactly that, honestly and briefly — e.g. 'Iski poori "
            "jaankari hamari team aapko degi.' / 'Our team will share the full details with "
            "you.' — and ask whether a team member may contact them. Do not describe any "
            "product, service, feature or benefit in that case, not even in general words.\n"
            "THE REASON FOR THIS CALL: give only the reason your instructions give"
            + (", or, if they give none, that this person enquired, exactly as the enquiry "
               "details in these rules say (you may say that without being asked)."
               if _enquiry_is_reason else
               ", and never claim this person enquired, filled a form or visited unless your "
               "instructions say so.")
            + " If there is no reason to give, do not make one up: say your name and the "
            "company your instructions name, and ask whether it is a good time to talk.\n"
            "NEVER OFFER WHAT YOUR INSTRUCTIONS DO NOT OFFER: "
            + ("you may offer to book a meeting with the team at a time the caller chooses; "
               "never offer or book a demo, trial or visit unless your instructions above or "
               "THINGS YOU CAN SEND offer one."
               if _offers_meeting else
               "never offer, propose or book a demo, meeting, appointment, visit, trial or a "
               "time slot for a call back unless your instructions above or THINGS YOU CAN "
               "SEND offer one.")
            + " If the caller asks you to call them back later, you may note the time they "
            "give, as your instructions allow."
        )

    prompt = _fill_placeholders(agent.get("systemPrompt") or "", context, sink=sink)

    # Pieces the bot knows that NO agent prompt can — kept in BOTH paths:
    # the configured voice's grammatical gender, the TTS script rule (romanized Hindi
    # synthesizes worse than Devanagari — Sarvam docs), the live lead facts, and the
    # machine end/transfer MARKERS (the agent prompt has no idea these tokens exist).
    if is_english and _agent_tts_model(agent) == "navana":
        # Call a4ce0279 (2026-10-13, Riya): the caller asked for Hindi, the script
        # said "switch", and this rule said "never Devanagari" — so the model wrote
        # "main ab Hindi mein baat karungi" in Latin letters and the English voice
        # read it as gibberish ("I don't understand you"). Navana reads Devanagari
        # in Hindi on its own (lang_corrected, verified on her earlier calls), so
        # Hindi the caller ASKED for goes out in Devanagari.
        script_rule = (
            "- SCRIPT: Write your replies in English (Latin letters). If you must echo an "
            "Indian-language word the caller used, keep it romanized. ONE exception: if the "
            "caller has asked you to speak Hindi and your instructions let you switch, write "
            "every Hindi sentence in DEVANAGARI (हिंदी लिपि), keeping English business words in "
            "English letters ("
            + ("link, WhatsApp, plan" if general else "demo, link, WhatsApp")
            + ") — NEVER write Hindi in Latin letters like "
            "'main aapko batati hoon'; the voice cannot pronounce romanized Hindi."
        )
    elif is_english:
        script_rule = (
            "- SCRIPT: Write every reply in English (Latin letters) only. If you must echo an "
            "Indian-language word the caller used, keep it romanized in Latin letters — never "
            "switch to Devanagari or any Indic script."
        )
    elif general:
        # Same rule, without the demo booking as the worked example.
        script_rule = (
            "- SCRIPT: Write Hindi words in DEVANAGARI (हिंदी लिपि), and keep common English business "
            "words in English letters (call, details, service, WhatsApp, offer, plan, confirm, link). "
            "So write 'क्या अभी दो minute बात करना convenient रहेगा?' — NOT romanized 'kya abhi do "
            "minute baat karna convenient rahega?'. NEVER write Hindi words in Latin letters."
        )
    else:
        script_rule = (
            "- SCRIPT: Write Hindi words in DEVANAGARI (हिंदी लिपि), and keep common English business "
            "words in English letters (demo, course, book, WhatsApp, offer, plan, confirm, link). "
            "So write 'मैं आपको एक demo book कर देती हूँ' — NOT romanized 'main aapko ek demo book kar "
            "deti hoon'. NEVER write Hindi words in Latin letters."
        )
    # The LAST line of every English agent's prompt (see _ENGLISH_CALL_LANGUAGE_LOCK).
    # Placement is the fix: inside the rules block the model still copied the script's
    # Hinglish question 8/8 times (probe 2026-10-22); as the final line, 0/12.
    language_lock = ""
    if is_english:
        language_lock = _ENGLISH_CALL_LANGUAGE_LOCK.lstrip("\n")
        if _agent_tts_model(agent) == "navana":
            language_lock += (" If you do switch, any Hindi/Hinglish line from your "
                              "instructions is rewritten in Devanagari before you say it.")
    if not is_english:
        # Rumik reads Devanagari-transliterated English as gibberish — live call
        # 8e1e00ad: the model wrote 'लाइव क्लासेस' and the caller heard 'लव असेस'
        # (founder: "it pronounced many words poorly"). Sarvam bulbul handles
        # either script, so this stays Rumik-only to leave legacy agents alone.
        if _agent_tts_model(agent) == "rumik":
            script_rule += (
                "\n- EVERY English-origin word — product and "
                + ("plan" if general else "class")
                + " names included — must be in "
                "English letters, never Devanagari transliteration: write "
                + ("'Premium Plan', 'Service', 'Support Team' — NEVER 'प्रीमियम प्लान', 'सर्विस'."
                   if general else
                   "'Live Classes', 'Assessment', 'Foundation Batch' — NEVER 'लाइव क्लासेस', "
                   "'असेसमेंट'.")
                + " Devanagari is "
                "for Hindi words ONLY; if a word is English, spell it in English."
            )

        # WORDING CONSISTENCY — only for agents whose speech cache is ON.
        #
        # The cache keys on the exact sentence, so one line said two ways is two
        # renders and neither is ever reused. Measured on live agent shreya-v3:
        # SEVEN of its most-spoken sentences were near-duplicate PAIRS, each half
        # sitting at count 1 instead of one entry at count 2 — so the longest,
        # most-repeated lines in the call (86-172 chars) never cached at all.
        # Every pair was one of three drifts: रमन/Raman, class/क्लास, and an
        # optional leading "सर,".
        #
        # GATED, because it tightens delivery for a reason that only exists when
        # the cache is on. An agent not using the cache keeps today's freedom —
        # this feature has no business changing how 26 other agents speak.
        if str(agent.get("speech_cache_mode") or "OFF").strip().upper() != "OFF":
            script_rule += (
                "\n- SAY A RECURRING LINE THE SAME WAY EVERY TIME — same words, same "
                "order, same spelling. Three things drift and must not:"
                "\n  * the "
                + ("person's" if general else "student's")
                + " NAME is always in DEVANAGARI — रमन, never Raman; "
                "आर्यन, never Aryan. In this conversation the name is a Hindi word, not an "
                "English one."
                "\n  * an English word is never in Devanagari — write "
                + ("'plan', never 'प्लान'." if general else "'class', never 'क्लास'.")
                + "\n  * सर/मैम goes exactly where the script puts it and nowhere else. "
                "Never add one to a line that does not already open with it."
            )

    # REGISTER. Founder, after hearing live calls: "everything is highly formal
    # Hindi... words that in general are not used". Measured across two days of
    # calls: 198 uses of literary vocabulary — प्रदर्शन 37x, पूछताछ 28x, अकादमिक
    # 14x, अवधारणा 12x. It is translationese: the authored script is English and
    # the model renders it into textbook Hindi, which no counsellor speaks and
    # which the TTS also stumbles over. The pairs below are the actual offenders
    # from those transcripts, not invented examples — concrete swaps steer a
    # model far better than "be conversational".
    plain_hindi_rule = "" if is_english else (
        "SPEAK PHONE HINDI, NOT TEXTBOOK HINDI. Use the words a real counsellor "
        "says out loud. Where the everyday word IS English, use the English word — "
        "that is how people actually speak; it is not a mistake. Say: performance "
        "(never प्रदर्शन), enquiry (never पूछताछ), academic (never अकादमिक/शैक्षणिक), "
        "concepts (never अवधारणाएँ), annual exam (never वार्षिक परीक्षा), tracking "
        "(never निगरानी), counsellor (never सलाहकार), problem/difficulty (never "
        "कठिनाई), structured (never संरचित), suitable / सही रहेगा (never उपयुक्त), "
        "guidance (never मार्गदर्शन), tests (never परीक्षण), doubts (never संदेह), "
        "fees (never शुल्क), scholarship (never छात्रवृत्ति), lectures (never "
        "व्याख्यान), parents / माता-पिता (never अभिभावक), option (never विकल्प), "
        "score किया (never अंक प्राप्त किए). If a word would sound odd from a "
        "shopkeeper or a parent on a phone call, do not use it."
    )
    if general and not is_english:
        # The same lesson in a non-education agent's words: the list above is a
        # counsellor's vocabulary (marks, fees, scholarship, parents) and it
        # handed AAIBUZZ an education product to talk about (calls c43e9ce7,
        # e6cb5f47, 2026-10-16). Everyday business words, same textbook traps.
        plain_hindi_rule = (
            "SPEAK PHONE HINDI, NOT TEXTBOOK HINDI. Use the words a real person says out "
            "loud on a phone call. Where the everyday word IS English, use the English "
            "word — that is how people actually speak; it is not a mistake. Say: details "
            "(never विवरण), enquiry (never पूछताछ), process (never प्रक्रिया), tracking "
            "(never निगरानी), problem/difficulty (never कठिनाई), structured (never "
            "संरचित), suitable / सही रहेगा (never उपयुक्त), guidance (never मार्गदर्शन), "
            "available (never उपलब्ध), payment (never भुगतान), charges (never शुल्क), "
            "option (never विकल्प). If a word would sound odd from a shopkeeper or a "
            "customer on a phone call, do not use it."
        )
    # The caller HEARS every character — markdown becomes spoken garbage (a live call
    # read out its own bullet list). And a short first clause reaches the ear sooner
    # (TTS synthesizes the first chunk while the rest streams).
    plain_speech_rule = (
        "- Speak plain text only: NEVER output markdown — no *, #, bullets, numbered lists or "
        "headings. No stage directions or parentheticals. Only words meant to be heard.\n"
        "- Write NUMBERS AS WORDS so they are spoken correctly: say 'a ten-minute "
        + ("call" if general else "demo")
        + "' (not "
        "'10-minute'), 'two minutes', 'nine thirty', 'twenty five'. Digits like '10' get read "
        "out as 'one zero'. The ONLY exception is a phone number, which you read digit by digit."
    )
    # The audio path starts TTS the moment the first sentence is complete
    # (NoRepeatGate splits on sentence ends), so the first sentence's length IS the
    # caller's wait. FAST_OPENER_ENABLED (default on) makes that sentence a complete
    # four-word-or-shorter sentence carrying the answer itself; off restores the
    # older, softer wording verbatim. Both prompt branches use this one variable.
    # Measured 2026-09-12 (sim, 24 runs each): this wording took the first sentence
    # from p50 5 / p90 11 words to p50 5 / p90 9, judge 6.4 -> 6.8, fillers flat. A
    # sharper "shape: <4 words>. <rest>" version at the TOP of the rules got p50 3
    # but the model met it with FILLER ("Right.", "Great, thanks.") — judge 6.0,
    # fillers up — the very robotic-Hmm pattern the founder flagged. Keep this one.
    fast_open_rule = (
        "- FIRST SENTENCE RULE: begin every reply with a COMPLETE sentence of at most "
        "FOUR words, ended with a full stop, then continue. It must carry SUBSTANCE — the "
        "direct answer, the key fact, or a real reaction — never a filler noise, a "
        "greeting, or a restatement of what the caller said. Good: "
        # GENERAL: the education examples are FACTS (where, which day, the
        # price) a model with a thin script copies as its own — "No charge at
        # all." is a price claim GROUNDING forbids. AAIBUZZ/IRPL calls c43e9ce7,
        # e6cb5f47 (2026-10-16). Same shape, no facts.
        + ("\u2018Haan, bilkul.\u2019 / \u2018Good question.\u2019 / \u2018Bilkul possible hai.\u2019 / "
           "\u2018Fair point.\u2019 / \u2018Sahi baat hai.\u2019 " if general else
           "\u2018Haan, shivir mein "
           "hi hai.\u2019 / \u2018Sunday ko hai.\u2019 / \u2018Bilkul possible hai.\u2019 / \u2018Fair point.\u2019 / "
           "\u2018No charge at all.\u2019 ")
        + "Bad: \u2018Hmm.\u2019 / \u2018Achha.\u2019 / \u2018Okay.\u2019 / \u2018Theek hai.\u2019 / "
        "\u2018Right.\u2019 — callers heard constant Hmm-ing as robotic, so such noises are "
        "allowed at most one reply in five. The detail, and the one question if any, "
        "come in the sentences after it. When the caller has just ANSWERED you, that "
        "first sentence is your NEXT step — never their answer in other words "
        + ("(\u2018It\u2019s all manual right now.\u2019, \u2018So you\u2019re only doing it by hand.\u2019 "
           if general else
           "(\u2018It\u2019s all offline right now.\u2019, \u2018So you\u2019re only doing offline classes.\u2019 ")
        + "are both wrong) and never a yes/no check of it."
        if get_settings().fast_opener_enabled else
        "- Keep the FIRST sentence of every reply short (a few words) so it reaches the "
        "caller fast — but make it SUBSTANCE, not a filler sound. Do NOT open replies with "
        "\u2018Hmm\u2019, \u2018Achha\u2019, \u2018Theek hai\u2019, \u2018Okay\u2019, \u2018Right\u2019 or similar acknowledgment noises "
        "more than about one reply in five — callers heard constant Hmm-ing as robotic. "
        + ("Usually answer directly: \u2018Haan, ye bilkul ho sakta hai\u2019 beats \u2018Achha. "
           "Toh ye\u2026\u2019." if general else
           "Usually answer directly: \u2018Haan, accommodation shivir mein hi hai\u2019 beats \u2018Achha. "
           "Toh accommodation\u2026\u2019.")
    )
    # Founder, 2026-08-12, on a live Shiksha Nation call: "every time the person
    # answers, the AI again says okay. It asked how many marks, the person said
    # ninety-four, and it comes back 'okay, you got ninety-four'. There is no need
    # to reconfirm every time — it looks like an AI." Three turns in a row opened
    # with the restatement.
    #
    # SECOND line of defence only. NoRepeatGate's docstring records four measured
    # prompt-only attempts at this exact class of repetition, one of them "no-echo
    # rules with GALAT/SAHI examples in the script" (3.0 -> 3.0 echoes) — the
    # 16k-character prompt is saturated. turntake.strip_echo_opener does the
    # load-bearing work; this just lowers how often it has to fire.
    no_echo_rule = (
        "- NEVER CONFIRM AN ANSWER BACK. When the caller ANSWERS your question, do not "
        "repeat it, restate it, or open with ‘okay, so <their answer>…’. They know "
        "what they just said; repeating it wastes their time and sounds like a machine "
        "reading a form. Simply USE the answer in your next line."
        + ("" if is_english else
           " GALAT: ‘ओके, आप अभी Pune में हैं, तो आपको ये कब तक "
           "चाहिए?’ SAHI: ‘आपको ये कब तक चाहिए?’" if general else
           " GALAT: ‘ओके, सुबोध अभी "
           "आठवीं क्लास में "
           "है, तो लास्ट exam में "
           "कितने marks आए थे?’ SAHI: "
           "‘लास्ट exam में कितने "
           "marks आए थे?’")
        + " TWO EXCEPTIONS, and only these: read a phone number back once digit by digit, "
        "and read a booked day and time back once. Everything else, never. Do not turn "
        "their answer into a confirmation question either "
        + ("(\u2018Nothing online at all then?\u2019 after they said it is all offline)"
           if general else
           "(\u2018No online classes at all "
           "then?\u2019 after they said it is offline)")
        + ": one answer, one acknowledgment at most, "
        "then move on — if the answer means this is not for them, say so and close."
    )
    # Founder, 2026-09-08, after live-testing the yoga agent: "it's asking questions
    # as if she is my mother. 'Hey, do you take live classes?' is not the right way —
    # first tell about yourself, soften it, THEN ask." A bare question with no
    # context reads as an interrogation; the same question cushioned by one clause
    # of assumption or reason reads as conversation. One clause only — cushions are
    # exactly the place models balloon a turn.
    warm_question_rule = (
        # Same three cushions with no industry in them: the live-classes and
        # members examples read as "this is an education/fitness business" to an
        # agent whose script never says what it is (AAIBUZZ, 2026-10-16).
        "- ASK LIKE A PERSON, NOT A FORM. Never fire a bare survey question at the caller "
        "('How many people work with you?'). Cushion it with ONE short clause first, in one of "
        "three ways, then ask: a soft everyday assumption ('You'd be handling most of this "
        "yourself these days, I suppose — is that right?'); the reason you're asking ('Just so "
        "I only tell you what's relevant — what matters most to you here?'); or their own last "
        "answer ('Since you said timing is the main concern — what would suit you better?'). "
        "ONE clause of cushion, ONE question, then stop. Direct is still fine for tiny "
        "follow-ups ('And on weekends?')."
        if general and get_settings().warm_questions_enabled else
        "- ASK LIKE A PERSON, NOT A FORM. Never fire a bare survey question at the caller "
        "('Do you take live classes?'). Cushion it with ONE short clause first, in one of "
        "three ways, then ask: a soft everyday assumption ('You'd be running your sessions "
        "online these days, I suppose — are those live, or recorded?'); the reason you're "
        "asking ('Just so I only tell you what's relevant — roughly how many members do you "
        "have?'); or their own last answer ('Since you're sending the link out yourself every "
        "morning — what happens for someone who joins late?'). ONE clause of cushion, ONE "
        "question, then stop. Direct is still fine for tiny follow-ups ('And on weekends?')."
        if get_settings().warm_questions_enabled else ""
    )
    # Live call went out in the evening but opened 'Good morning' — the authored script
    # hard-codes a greeting and nothing tied it to the clock. The RIGHT-NOW line above
    # gives the time; this makes the model USE it for the greeting, overriding a fixed one.
    greeting_rule = (
        "- GREET ONCE, at the very start, and never again — if the caller says hello or "
        "good morning later, do not greet back; just continue. "
        "GREET FOR THE CURRENT TIME shown above: say 'good morning' before 12 noon, "
        "'good afternoon' from 12 noon to 5 PM, and 'good evening' after 5 PM. If your "
        "scripted opening contains a fixed greeting, ADAPT it to the current time — never "
        "say 'good morning' in the afternoon or evening."
    )
    # Live call: the lead's real name was missing, so the model addressed the caller by the
    # AUDIENCE-LIST name ('Am I speaking with Mr. or Ms. Robotics STEM Programs for Schools?').
    name_sanity_rule = (
        "- NEVER say 'Mr.' or 'Ms.' with nothing (or a non-name) after it, and never invent a "
        "surname. If you do NOT have the person's real name — it is blank, a placeholder, the "
        "word 'hello', or looks like a company/program/list ("
        + ("'Mumbai Leads March', 'Website Enquiries List'" if general else
           "'Robotics Programs for Schools', "
           "'AI and Machine Learning'")
        + ") — do NOT attempt 'Am I speaking with Mr./Ms. ___'. That "
        "produces a broken 'Mr. Hello' or a dangling 'Mr.'. Instead ask warmly 'May I know who "
        "I'm speaking with?' or confirm the organisation ('Am I speaking with someone from "
        "<org>?'). Only use 'Mr./Ms. <surname>' when you actually have a real surname."
    )
    # Live calls: the caller asked 'who are you?' / said 'we already spoke' and the agent
    # ignored it and ploughed the next scripted line. This forces a response FIRST.
    listen_rule = (
        "- LISTEN AND RESPOND to what the caller just said BEFORE moving to your next scripted "
        "line. If they ask 'who are you?', 'which company?', 'why are you calling?', 'where are "
        "you calling from?' — answer it plainly and immediately (your name, your company, one "
        "short reason), THEN continue. If they say you have ALREADY SPOKEN, 'we discussed this', "
        "or 'I explained already' — acknowledge it and do NOT repeat your introduction or pitch; "
        "pick up from there and ask what they'd like to do next. NEVER deliver the next script "
        "line as if the caller said nothing when they have just spoken."
    )
    # Live calls showed the model compressing several script steps into one turn
    # ("How are you? That's wonderful to hear." — answering its OWN question), and
    # closing on a vague "okay, thanks" with no day, no time, no contact captured.
    one_step_rule = (
        "- ONE STEP AT A TIME: if your instructions contain questions or steps, deliver "
        "exactly ONE question and then STOP — never answer your own question, never "
        "continue past a question mark in the same turn, never act out both sides. "
        "Break any long scripted passage into short turns (2-3 sentences), pausing for "
        "the caller between them."
    )
    # GENERAL agents: the same drive, aimed at the next step the SCRIPT offers.
    # The education version names a demo three times and gives a booking line
    # to copy; AAIBUZZ, whose script offers no demo, proposed one five times and
    # booked it (call e6cb5f47, 2026-10-16).
    goal_drive_rule = (
        "- SELL WITH INTENT — you are a sharp, warm caller working toward the goal your "
        "instructions set, NOT a passive form-filler. Tie what you say to something the caller "
        "actually said (a need, what they use today, their size) and lead with ONE crisp benefit "
        "your instructions give you, never a feature list.\n"
        "- DON'T ACCEPT THE FIRST BRUSH-OFF. Common deflections — 'just email me' / 'send a "
        "proposal' / 'we handle it ourselves' / 'we work directly' / 'not right now' / 'we're "
        "busy' — are not a no; they're a reflex. Acknowledge briefly, then redirect ONCE to "
        "value + the next step your instructions offer. Example — if they say 'email me the "
        "details', reply: 'Happy to — may I ask one quick thing first, so what reaches you "
        "actually fits?' Make ONE genuine, specific attempt like this. Only if they still "
        "decline do you take the email or a callback time gracefully and thank them.\n"
        "- CLOSE CONCRETELY: a vague acknowledgment ('okay', 'thanks', 'theek hai') is NOT a "
        "confirmation — when your instructions have you book a time, propose two specific "
        "slots, get ONE explicitly confirmed (exact day + time), and confirm the contact channel "
        "(read a number back digit by digit). Never announce a meeting or a call as scheduled "
        "unless the caller named or accepted a specific day and time."
    ) if general else (
        "- SELL WITH INTENT — you are a sharp, warm salesperson working toward a goal "
        "(usually a short demo or meeting), NOT a passive form-filler. Tie your pitch to "
        "something the caller actually said (a pain, a tool they already use, their size) "
        "and lead with ONE crisp benefit, never a feature list.\n"
        "- DON'T ACCEPT THE FIRST BRUSH-OFF. Common deflections — 'just email me' / 'send a "
        "proposal' / 'we handle it ourselves' / 'we work directly' / 'not right now' / 'we're "
        "busy' — are not a no; they're a reflex. Acknowledge briefly, then redirect ONCE to "
        "value + a concrete small next step: a ten-minute demo at a specific time. Example — if "
        "they say 'email me the details', reply: 'Happy to — honestly it lands better as a "
        "quick 10-minute look so I show only what fits you. Would tomorrow evening or Thursday "
        "morning work?' Make ONE genuine, specific attempt like this. Only if they still "
        "decline do you take the email or a callback time gracefully and thank them.\n"
        "- CLOSE CONCRETELY: a vague acknowledgment ('okay', 'thanks', 'theek hai') is NOT a "
        "confirmation — when booking, propose two specific slots, get ONE explicitly confirmed "
        "(exact day + time), and confirm the contact channel (read a number back digit by "
        "digit). Never announce a meeting/demo as scheduled unless the caller named or accepted "
        "a specific day and time."
    )
    language_stability_rule = (
        "LANGUAGE STABILITY: every reply must be in the SAME language and script as YOUR OWN "
        "previous turns. One word from the caller in another language ('yes', 'achha', 'haan'), "
        "or one odd/garbled transcript line, is NEVER a cue to switch — treat it as a mis-hear. "
        "Switch languages only if the caller explicitly asks, or speaks 3+ consecutive full "
        "sentences in the other language. If your instructions define their own language "
        "rules, those take precedence.\n"
        "ON REQUEST, THE SWITCH IS PERMANENT: if the caller asks for a language at any point "
        "(\u2018English mein baat karo\u2019, \u2018can you speak in English\u2019, "
        "\u2018Hindi mein boliye\u2019), switch on your VERY NEXT sentence and stay there for "
        "the WHOLE rest of the call. Never drift back \u2014 not for one line, not because they "
        "later use a word of the other language, not after an interruption. If they ask for "
        "English, speak plain English only: no Hindi words, no Devanagari."
    )
    # "Vijay Madhekar ji" (call ada2e60c, 2026-09-12): a full name plus honorific is
    # how a form reads, not how a person is addressed. First name only.
    lead_name_line = (f"The caller's name is {lead_name}. Address them by their FIRST name "
                      f"only ('{str(lead_name).split()[0]}' / '{str(lead_name).split()[0]} ji'), "
                      f"never the full name." if lead_name else "")
    # Call c9aa4062: the close asked "which number should I send the invite to?",
    # the caller said "the same number we're talking on", and the agent then made
    # her DICTATE it digit by digit — a number we dialled ourselves. Give the
    # model the number so "this same number" is an answer it can act on.
    _lead_phone = str(context.get("leadPhone") or "").strip()
    dialled_number_line = (
        f"- You dialled this call to {_lead_phone}. If they want something sent to "
        f"'this number' / 'the same number', USE it: confirm it back yourself once, "
        f"digit by digit without the country code — NEVER ask the caller to dictate "
        f"a number you already have." if _lead_phone else "")
    # Same call: the agent ended six turns in ~3 minutes with "Does that make
    # sense?" / "How does that sound?" — a tic the check-in rule itself invited.
    check_in_rule = (
        "- VARY your check-ins: never end two replies in the same call with the same "
        "check-in phrase ('does that make sense?', 'how does that sound?'). Usually the "
        "next REAL question is the better turn-ender; with a brisk caller, drop "
        "check-ins entirely.")
    # Clients, 2026-09-11: "the tone is very simple and linear — bot like". Our TTS
    # has no prosody knobs (speed only), so the text carries the delivery. Verified
    # on the production engine before shipping: '...', '!' and ',' change the
    # pitch contour and are NEVER read aloud (Sarvam STT of the output: no "dot",
    # no "exclamation", English and Hindi); pipecat and NoRepeatGate both cut a
    # sentence at '...', but the fragment that makes is under 22 chars, which
    # is_repeat ignores by design. '?' is deliberately kept for the ONE real
    # question: question_topic() and _played_ended_with_question() key on it.
    delivery_rule = (
        "- SPEAK, DON'T READ. Even, flat sentences sound like a machine reading a "
        "script. Give each reply ONE moment of emphasis: put '...' just before the "
        "phrase that matters most ("
        + ("'The main thing... it is entirely your choice'" if general else
           "'You set your timings once... and every morning the "
           "sessions just appear'")
        + "), and when there is genuine warmth or good news, let ONE "
        "sentence end with '!' — never more than one, never on a question. Vary the "
        "rhythm: a short sentence next to a longer one, not two of the same length. "
        "These marks are for your voice only: never end a reply with '...', never write "
        "dashes, and use '?' only for the one real question you are asking. Your "
        "scripted opening stays exactly as written."
        if get_settings().prosody_hints_enabled else ""
    )
    # Placed among the LAST rules on purpose (recency wins in a long prompt) and
    # written with the exact lines callers heard, because the generic version
    # above did not hold: after every answer the model opened by saying the
    # answer back, four rounds in call 15aadcdb. The gate now drops such an
    # opener when more follows (NoRepeatGate._echo_held); this is the first line
    # of defence.
    reply_shape_rule = (
        "- AFTER THE CALLER ANSWERS, YOUR FIRST SENTENCE IS NEVER THEIR ANSWER IN OTHER "
        "WORDS. This overrides any example in the script above. "
        + ("Wrong, the shape heard on real calls: \u2018Okay, so it\u2019s all offline right "
           "now.\u2019 / \u2018So you\u2019re not doing any of it online.\u2019 / \u2018You\u2019re "
           "maintaining an Excel sheet.\u2019 / \u2018Okay, so they do UPI.\u2019 / \u2018Nothing "
           "online at all then?\u2019"
           if general else
           "Wrong, all heard on real "
           "calls: \u2018Okay, so it\u2019s all offline right now.\u2019 / \u2018So you\u2019re not running any "
           "online classes.\u2019 / \u2018You\u2019re maintaining an Excel sheet.\u2019 / \u2018Okay, so they do "
           "UPI.\u2019 / \u2018No online classes at all then?\u2019")
        + " Right: go straight to the next "
        "question or the next useful fact, or close if their answer means this is not for "
        "them. If you need a beat, one word at most (\u2018Great.\u2019), never their words."
    )
    fields_line = _lead_fields_line(context)
    enquiry_line = _lead_enquiry_line(context, general=general)
    end_line = (f"- When the conversation has reached a natural end, say a short goodbye and "
                f"append {END_MARKER}. If the caller asks you to end the call, says they are "
                f"not interested, or says they do not need this: ONE short polite line and "
                f"{END_MARKER} immediately — never a clarifying question, never one more pitch. "
                f"The same when they say goodbye, 'I'll think about it', or that they have to go: "
                f"thank them in one line and {END_MARKER} — do not offer "
                + ("a meeting" if general else "a demo")
                + ", a WhatsApp "
                f"overview or another call at that point.")
    human_line = (
        f"- If the caller asks for a human, is upset, or you cannot help, say you are connecting "
        f"them and append {TRANSFER_MARKER}."
        if (context.get("handoff") or {}).get("enabled")
        else f"- If the caller asks for a human, say "
             + ("a colleague from the team will call them back" if general else
                "a counsellor will call them right back")
             + f", then append {END_MARKER}."
    )
    # Offers the admin attached to this agent's send rules. Built here so a rule is
    # self-contained: the admin writes the question once, on the rule, and never has to
    # keep a duplicate copy of it inside the system prompt.
    #
    # MID_CALL offers carry the marker instruction; POST_CALL ones do NOT, because the
    # post-call analyser reads the acceptance straight from the transcript. Telling the
    # model to emit a marker for those would fire a send twice.
    #
    # Empty for every agent without rules, so this adds nothing to their prompt.
    _offers = [o for o in (agent.get("sendOffers") or [])
               if isinstance(o, dict) and o.get("ask") and o.get("key")]
    sends_line = ""
    if _offers:
        _mid = [o for o in _offers if str(o.get("timing", "")).upper() == "MID_CALL"]
        _post = [o for o in _offers if o not in _mid]
        _parts = [
            "THINGS YOU CAN SEND. You may offer these, in your own words, at the moment "
            "they naturally fit — never all at once, and never one the caller already "
            "declined. Offer at most one per turn. You have NO tools and NO functions: "
            "the ONLY way to send is the exact token shown below, written as plain text at "
            "the end of your reply. Never write XML, <tool_call>, <arg_key>, JSON or a "
            "function call — anything like that would be read aloud to the caller."
        ]
        for o in _post:
            _parts.append(f"- Offer: {o['ask']}")
        for o in _mid:
            _parts.append(
                f"- Offer: {o['ask']} If the caller AGREES, finish that reply with the "
                f"exact token {SEND_MARKER_OPEN}{o['key']}{SEND_MARKER_CLOSE}")
        if _mid:
            _parts.append(
                "The tokens are silent instructions to our system. NEVER say a token out "
                "loud, never spell it, never mention that you are sending a code, and "
                "never write one unless the caller clearly agreed in that very turn.")
        sends_line = chr(10).join(_parts)

    disposition_line = (("At the end you must be able to judge the caller's interest as one of: "
                         + ", ".join(dispositions)) if dispositions else "")

    # When a scripted opening is configured we SPEAK IT VERBATIM before the model
    # ever runs. Authored prompts are usually a call SCRIPT whose first block is
    # that very introduction (Shiksha Nation's is written as "Bot: Hi! I'm Ameet
    # calling from…"), so without this the model reads the script from the top and
    # delivers the introduction a second time — which is exactly what callers heard.
    # Naming the opening verbatim also gives LANGUAGE STABILITY something to anchor
    # to on the first turn, when the model has no previous turns of its own.
    opening_line = _clean_opening(_fill_placeholders(
        (agent.get("openingLine") or "").strip(), context, full_name=True))
    # Does the opening actually INTRODUCE anyone, or is it just a greeting? This
    # decides the difference between two opposite instructions, and getting it
    # wrong is what call 2fc70065 sounded like. The opening line had been changed
    # to bare "Hello", so the rule below told the model it had already named
    # itself and its company and must "NEVER introduce yourself again" — when the
    # caller had heard nothing but "Hello". The model introduced itself anyway
    # (correctly), but with no stable notion of the introduction being DONE it did
    # so on every generation, and quoting a one-word opening back at it verbatim
    # invited it to replay "Hello" too. The caller heard the whole introduction
    # twice and said so: "अभी तो आपने बताया, दो बार क्यों बता…".
    _intro_words = [w for w in (name, context.get("instituteName") or "") if w]
    opening_introduces = any(w.casefold() in opening_line.casefold() for w in _intro_words)
    already_said_rule = ""
    if opening_line and opening_introduces:
        already_said_rule = (
            "ALREADY SPOKEN — do not repeat: this call has ALREADY opened with exactly "
            f"\"{opening_line}\" It has been said. NEVER introduce yourself, your name or "
            "your company again, and never restart your script from the top, no matter what "
            "the caller says (including a bare 'hello' mid-call — that means they are "
            "checking the line is alive, so simply continue). Resume from the point in your "
            "instructions that comes AFTER the introduction. Keep speaking the SAME LANGUAGE "
            "as that opening unless the caller clearly asks for another one. ONE exception: "
            "if a bracketed note says the person has NOT heard who you are (the opening "
            "never reached them), follow that note and introduce yourself once, briefly."
        )
        # The rule above is written before the call, about audio that may never
        # play: the callee spoke first and the opening was skipped (9fd6489d),
        # or it raced a run and both were dropped (c3818b83, 2026-10-14). What
        # the person actually heard decides — run_bot._intro_cue sends the note.
    elif opening_line:
        already_said_rule = (
            f"ALREADY SPOKEN: this call has opened with \"{opening_line}\" — a GREETING ONLY. "
            "The caller does NOT yet know who you are. So introduce yourself and your company "
            "EXACTLY ONCE, in your very first reply, and then NEVER again: after that first "
            "reply, treat the introduction as finished for the whole call. Do not greet a "
            "second time, do not say your name or your company a second time, and never "
            "repeat that opening word back. A bare 'hello' from the caller mid-call means "
            "they are checking the line is alive — carry on from where you were, do not "
            "re-introduce. Keep speaking the SAME LANGUAGE as that opening unless the caller "
            "clearly asks for another one."
        )

    # An agent whose author wrote a real prompt (opening choreography, identity rules,
    # language + conversation rules) is AUTHORITATIVE. Piling the generic scaffolding on
    # top DUPLICATES it and — via intent_line's "introduce yourself" vs a "confirm
    # identity first" prompt — CONTRADICTS it, which is what produced the double/triple
    # greeting on live calls. So defer: add ONLY the bot-only knowledge above, plus one
    # line telling the model its own instructions own the opening.
    if len(prompt.strip()) >= 600:
        # THE 600-CHARACTER CUT-OFF DECIDES WHO GETS THE SAFETY RULES, AND IT IS
        # THE WRONG SIDE OF THE LINE. 600 characters is roughly four sentences, so
        # every authored agent lands here and receives NONE of `non_negotiable` —
        # production prompts measured 2026-08-14 were 2956, 3359, 3489, 5152 and
        # 10078 characters. The rules reach only the built-in placeholder persona,
        # never an agent taking real calls, although each was added after a
        # specific live failure: a repeated question means your answer FAILED;
        # answer direct questions first and never dodge; frustration means drop
        # the script; if the conversation stops making sense assume you MIS-HEARD.
        #
        # Those four are RECOVERY rules — what to do when a call goes wrong — so
        # they cannot contradict a script that only describes the happy path,
        # which is what the deferral below was written to protect against.
        #
        # Gated OFF by default: this ships as a no-op and every existing prompt is
        # byte-identical until SAFETY_RULES_FOR_AUTHORED=true. Placed AFTER the
        # authoritative line so the author's script still leads and the rules read
        # as the override they announce themselves to be.
        #
        # NOTE this does not resolve the already_said_rule / listen_rule conflict
        # (never name your company again vs. name it when asked) — that needs its
        # own carve-out, and prod call 775ac5ac is the evidence.
        lines = [
            prompt,
            "Your instructions above are AUTHORITATIVE for the opening, identity, language, "
            "pacing and conversation rules — follow them exactly. Greet and introduce yourself "
            "ONCE as they specify; never add a second greeting or re-introduce yourself. If the "
            "caller speaks first at the very START of the call, your FIRST reply IS your "
            "scripted opening — but ONLY at the start; mid-call that rule does not apply.",
            non_negotiable if get_settings().safety_rules_for_authored else "",
            grounding_rule,
            already_said_rule,
            now_line,
            greeting_rule,
            name_sanity_rule,
            listen_rule,
            "End every turn with a question, a quick check-in (\u2018right?\u2019) or a clear closing — "
            "then STOP and wait for the caller\u2019s answer. Never answer your own question or "
            "continue as if they replied when they haven\u2019t; their silence is NOT consent.",
            "A neutral SPOKEN acknowledgment to your yes/no question (\u2018okay\u2019, \u2018cool\u2019, \u2018hmm\u2019, "
            "\u2018go ahead\u2019) means YES — move forward. Never re-ask a question you already asked, "
            "and never repeat any sentence verbatim; to clarify, rephrase in under 8 words.",
            language_stability_rule,
            f"{gender_line} {addressee_line}",
            script_rule,
            plain_hindi_rule,
            plain_speech_rule,
            fast_open_rule,
            no_echo_rule,
            reply_shape_rule,
            warm_question_rule,
            check_in_rule,
            delivery_rule,
            one_step_rule,
            goal_drive_rule,
            lead_name_line,
            dialled_number_line,
            fields_line,
            enquiry_line,
            end_line,
            human_line,
            sends_line,
            disposition_line,
            closing_grounding,
            language_lock,
        ]
        return "\n".join(l for l in lines if l)

    # Thin / blank prompt → the full scaffolding it needs to behave at all.
    lines = [
        prompt or "You are a friendly, concise phone assistant.",
        non_negotiable,
        grounding_rule,
        already_said_rule,
        now_line,
        greeting_rule,
        name_sanity_rule,
        listen_rule,
        f"You are {name}. {gender_line}",
        addressee_line,
        intent_line,
        lead_name_line,
        fields_line,
        enquiry_line,
        ("During the conversation, naturally find out: " + "; ".join(extraction))
        if extraction else "",
        "Rules:",
        "- 1-2 short sentences per reply. ONE question per turn. Never monologue.",
        script_rule,
        plain_hindi_rule,
        plain_speech_rule,
        fast_open_rule,
        no_echo_rule,
        warm_question_rule,
        check_in_rule,
        delivery_rule,
        one_step_rule,
        goal_drive_rule,
        dialled_number_line,
        ("- Mostly SKIP acknowledgment openers entirely and answer directly; when you do "
         "acknowledge, never use the same word twice in a row."),
        reply_shape_rule,
        # Scoped to a QUESTION or a CONCERN on purpose. Reflecting one back shows you
        # listened; reflecting an ANSWER back is the parroting no_echo_rule forbids,
        # and the unscoped version of this line was licence for exactly that.
        ("- When the caller asks a QUESTION or raises a CONCERN, briefly reflect that point "
         "back before you answer so they feel heard — not a generic 'I understand'. Never do "
         "this with an ANSWER they gave you."
         if is_english else
         "- When the caller asks a QUESTION or raises a CONCERN, briefly reflect that point "
         "back before you answer (e.g. 'अच्छा, आप timing को लेकर puchh rahe hain —') so they "
         "feel heard. Not a generic 'मैं समझती हूँ'. NEVER do this with an ANSWER they gave you."),
        "- Match the caller's energy: a brief, businesslike caller gets crisp efficiency; a "
        "chatty, warm caller gets a little more warmth. Don't be relentlessly peppy.",
        ("- Say clock times naturally in the 12-hour format — 'five PM', 'ten thirty AM'."
         if is_english else
         "- Clock times: ALWAYS the English 12-hour format — 'five PM', 'ten thirty AM', 'twelve "
         "noon', 'quarter past six'. NEVER the Hindi 'baje' form and NEVER a mix — 'five baje' and "
         "'paanch baje' are both WRONG; say 'five PM'."),
        "- Other numbers and money: whole spoken words in the sentence's one language, never spelled "
        "out digit-by-digit — 'do sau rupaye' / 'two hundred rupees' (NEVER 'two zero zero' or 'do "
        "zero zero'), 'pandrah tarikh'. Exception: a 10-digit phone number is read digit by digit.",
        end_line,
        human_line,
        sends_line,
        disposition_line,
        f"IDENTITY LOCK (most important): your name is EXACTLY \"{name}\" — say it identically "
        f"every single time, and NEVER introduce yourself with any other name, spelling or "
        f"variation. Use the SAME company name you introduce yourself with for the whole call; "
        f"never change, translate or invent a different company name.",
        closing_grounding,
        language_lock,
    ]
    return "\n".join(l for l in lines if l)


async def run_bot(transport, corr: str, context: Dict[str, Any],
                  outcome: CallOutcome, *, aiohttp_session,
                  providers: Optional[Dict[str, Any]] = None) -> CallOutcome:
    """Run one call end-to-end on an already-connected Plivo <Stream> transport.
    Mutates the caller-owned CallOutcome in place (crash-safe reporting).

    pipecat 1.4 architecture (migration 2026-08-05): the USER AGGREGATOR owns the
    VAD, the turn strategies (Smart Turn v3 semantic end-of-turn) and the idle
    clock. Interruptions are OURS to drive: turn-start strategies are constructed
    with enable_interruptions=False so a VAD onset never hard-cancels a reply —
    DuckGate holds the audio instantly and the turn-gate then absorbs a
    backchannel or commits a real interruption (founder decision: "absorb but
    never lose"). The 0.0.95 watchdog shrinks to spend/stop/duck enforcement;
    nudges and idle-hangup ride the aggregator's on_user_turn_idle event."""
    _run_bot_t0 = time.time()
    settings = get_settings()
    agent = context.get("agent") or {}

    # Live call c9aa4062 (2026-09-09): the audience list's "name" column held the
    # PHONE NUMBER, so the scripted opening read twelve digits aloud — "Hello, is
    # this nine one nine four two five…?". A number is never a person's name:
    # blank it here, once, so {{name}} falls back, name_sanity_rule applies, and
    # the report doesn't carry a phone number as customerName either.
    if _lead_name_is_phone(context.get("leadName")):
        logger.warning("lead name %r is a phone number — treating as no name corr=%s",
                       str(context.get("leadName"))[:24], corr)
        context["leadName"] = None
    _cleaned = _clean_lead_name(context.get("leadName"))
    if _cleaned != context.get("leadName"):
        logger.info("lead name %r spoken as %r corr=%s",
                    str(context.get("leadName"))[:40], _cleaned, corr)
        context["leadName"] = _cleaned

    flags = CallState(t=time.time())
    diag = diag_mod.CallDiagnostics()
    outcome.diagnostics = diag

    def on_activity(user: bool = True):
        flags["t"] = time.time()

    # WHAT was the bot doing while the line was silent? Call 597aeb3f showed
    # 8.2s of dead air and the container restart that shipped the next build
    # destroyed the logs before it could be diagnosed — so the answer has to
    # travel with the REPORT, which survives restarts, not the log.
    def _silence_cause(gap: float) -> str:
        if gap < 2.5:
            return ""
        if flags["bot_speaking"]:
            # The caller broke in while we were still talking: whatever the
            # last stop stamp says, the line was not silent (call f28888b2:
            # 18.8 s of a pitch counted as "awaiting_playout").
            return ""
        now = time.time()
        if flags["ducked_since"] > 0:
            return "ducked_%.1fs" % (now - flags["ducked_since"])
        st = flags["reply_started_t"]
        if st and flags["bot_stopped_t"] < st and flags["reply_cancelled_t"] < st:
            return "awaiting_playout_%.1fs" % (now - st)   # LLM/TTS composed, no audio
        if flags["user_speaking"]:
            return "caller_speaking"
        if flags["user_stopped_t"] > flags["bot_stopped_t"]:
            return "after_caller_turn"      # we owed them a reply and did not start one
        return "both_quiet"

    def set_bot_speaking(speaking: bool):
        if speaking:
            flags["unplayed_pending_t"] = 0.0
        if speaking and not flags["bot_speaking"]:
            _last = max(flags["bot_stopped_t"], flags["user_stopped_t"])
            try:
                # Quiet on hold is the point of the hold, not dead air: only
                # what followed the person's return is ours (call 68bdcbcf,
                # 2026-10-14; set_user_speaking skips the hold the same way).
                _last = max(_last, transcript.hold_ended_t)
            except NameError:
                pass
            if _last and not flags["user_speaking"]:
                _gap = max(0.0, time.time() - _last)
                _why = _silence_cause(_gap)
                # The same rule as set_user_speaking's "caller_thinking": a
                # silence after OUR question that the caller let run until the
                # idle nudge is the caller's, not ours. Call afa21bf4
                # (2026-10-14) went RED on four "dead air 8.0s — both_quiet",
                # each the 8 s idle wait ended by "हेलो? क्या आप मुझे सुन पा
                # रहे हैं?". Only when the idle timer said so (idle_nudge_t):
                # a hole between two bot lines with nothing in flight — a TTS
                # stall mid-reply, the owed next line after "जी सर।" — is
                # still ours and still counted.
                if _why == "both_quiet" and flags["idle_nudge_t"] >= _last:
                    _why = "caller_silent"
                if _why != "caller_silent":
                    diag.sample("dead_air", _gap)
                if _why:
                    diag.note_silence(round(_gap, 1), _why)
                    logger.info("dead air %.1fs — bot was %s corr=%s", _gap, _why, corr)
            diag.bump("bot_turns")
        flags["bot_speaking"] = speaking
        flags["tts_gen_t"] = 0.0
        outcome.replay["bot"].append([round(time.time() - outcome.connected_at, 2), int(speaking)])
        # The opening's audio, stretch by stretch (CallState.opening_play_secs).
        if flags["greet_queued_t"] and not flags["reply_started_t"]:
            if speaking:
                flags["opening_seg_t"] = flags["opening_seg_t"] or time.time()
            elif flags["opening_seg_t"]:
                flags["opening_play_secs"] += time.time() - flags["opening_seg_t"]
                flags["opening_seg_t"] = 0.0
        if speaking:
            flags["bot_started_t"] = time.time()
        # Set when the FIRST frame reaches the line, not when the opening ends:
        # call 31763255 (2026-09-12) — "yes." to "Hi, is this Shreyash?" landed
        # 3.4 s into the opening and was dropped as a machine-greeting scrap
        # because "we had not spoken yet".
        flags["bot_spoke_once"] = True
        if not speaking:
            flags["bot_stopped_t"] = time.time()

    def set_user_speaking(speaking: bool):
        if speaking and not flags["user_speaking"]:
            _last = max(flags["bot_stopped_t"], flags["user_stopped_t"])
            if _last and not flags["bot_speaking"]:
                _gap = max(0.0, time.time() - _last)
                _why = _silence_cause(_gap)
                # THE CALLER'S OWN RESPONSE TIME IS NOT OUR DEAD AIR.
                #
                # This branch runs when the caller STARTS speaking, and measures
                # backwards to whoever last stopped. When the BOT spoke last,
                # that span is the caller thinking before they answer — a normal
                # part of a phone conversation, not a defect.
                #
                # _silence_cause tags that span "both_quiet" (not ducked, no reply
                # in flight, and bot_stopped_t >= user_stopped_t). Measured over
                # 365 dead-air events in the 7 days to 2026-08-14, "both_quiet" at
                # a user onset was 169 of them (46.3%) with a MEDIAN of 3.9s — i.e.
                # squarely over the 3.5s AMBER bar — and produced 45 of the gaps
                # past the 6s RED bar. DEAD_AIR was firing on 41% of calls, roughly
                # half of it for callers simply taking a moment to reply.
                #
                # Renamed rather than dropped: the span is still recorded in
                # `silences` (it is genuine, useful signal about how long callers
                # take to answer this agent), it just no longer feeds the
                # dead_air reservoir that verdict() scores.
                #
                # SCOPED TO THIS CALLBACK ON PURPOSE. set_bot_speaking computes the
                # mirror gap — "the caller stopped, how long until WE spoke" — and
                # "both_quiet" there means two bot utterances with a hole between
                # them, which IS ours. That path is deliberately untouched.
                if _why == "both_quiet":
                    _why = "caller_thinking"
                try:
                    # The person coming back from a hold ("Hello.") ends a
                    # silence that was the hold's: the point of it, not ours
                    # (68bdcbcf replayed, 2026-10-14: "dead air 22.8s —
                    # after_caller_turn" once nothing leaked into the hold).
                    # Their onset can reach here after their final has
                    # already ended the hold (the aggregator's late start).
                    if _why and (transcript.on_hold() or transcript.hold_ended_t >= _last):
                        _why = "on_hold"
                except NameError:
                    pass
                if _why not in ("caller_thinking", "on_hold"):
                    diag.sample("dead_air", _gap)
                if _why:
                    diag.note_silence(round(_gap, 1), _why)
                    logger.info("dead air %.1fs — bot was %s corr=%s", _gap, _why, corr)
            if flags["bot_speaking"]:
                diag.bump("barge_ins")
        elif not speaking and flags["user_speaking"]:
            _dur = time.time() - (flags["user_started_t"] or time.time())
            if _dur > diag.longest_user_secs:
                diag.longest_user_secs = _dur
            # ACOUSTIC length, not `_dur`: when no transcript arrives the
            # aggregator always closes the turn on its 5 s stop-timeout, so
            # `_dur >= 4.0` was true for EVERY transcript-less turn — including
            # a 0.02 s blip. Call 3b5fb592 (2026-09-18): two blips (0.02 s and
            # 0.22 s) each armed this, so the bot twice told a caller who had
            # said nothing "माफ़ कीजिए, आवाज़ कट गई — क्या आप दोबारा बोल सकते हैं?",
            # and the second one also demoted Sarvam to the fallback STT. The
            # VAD ticks say how long they REALLY spoke.
            _voice = flags["voice_tick_t"] - flags["user_started_t"]
            if (_dur >= 4.0 and _voice >= settings.orphan_min_utterance_secs
                    and flags["transcript_t"] < flags["user_started_t"]
                    # Hold music is not an unheard caller.
                    and not transcript.on_hold_for()):
                # They spoke for a real span, the aggregator gave up on the turn
                # and no words ever came: we did not hear them.
                flags["unheard_turn_t"] = time.time()
                logger.info("turn closed after %.1fs with no transcript (%.1fs of voice) — "
                            "orphan re-ask armed corr=%s", _dur, _voice, corr)
            elif _dur >= 4.0 and flags["transcript_t"] < flags["user_started_t"]:
                logger.info("turn closed with no transcript after only %.2fs of voice — "
                            "a blip, not an unheard turn corr=%s", max(_voice, 0.0), corr)
        flags["user_speaking"] = speaking
        if speaking:
            flags["user_started_t"] = time.time()
        else:
            flags["user_stopped_t"] = time.time()

    stt_lang, _ = _agent_language(agent)
    eng = stt_lang == "en-IN"
    orphan_text = ("Sorry, I didn't catch that — could you say it again?" if eng
                   else "माफ़ कीजिए, आवाज़ कट गई — क्या आप दोबारा बोल सकते हैं?")
    # Devanagari for a Hindi agent: the romanised line reached the caller on
    # 22062aac in the middle of an all-Devanagari call.
    nudge_text = ("Hello? Are you still there?" if eng
                  else "हेलो? क्या आप मुझे सुन पा रहे हैं?")
    cap_farewell = ("I have to end the call now — our team will reach out to you shortly. "
                    "Thank you!" if eng else
                    "Mujhe ab call samaapt karni hogi. Hamari team aapse jald sampark karegi. "
                    "Dhanyavaad!")
    transfer_closing = ("One moment, connecting you now." if eng
                        else "Ek moment, main aapko connect kar rahi hoon.")
    idle_farewell = ("It seems I've lost you — I'll follow up shortly. Thank you, and have a "
                     "great day!" if eng else
                     "Lagta hai aapki awaaz nahi aa rahi — main baad mein sampark karti hoon. "
                     "Dhanyavaad, aapka din shubh ho!")
    end_closing = ("Alright, thank you. Have a great day!" if eng
                   else "Theek hai, dhanyavaad. Aapka din shubh ho!")
    eng_fillers = ("Hmm…",)
    # Spoken by the watchdog when a reply has been composing with no audio for
    # LLM_BRIDGE_AFTER_SECS. Not "Hmm" (founder: "too much Hmm-ing") — a plain
    # human "hang on" that a slow model earns, never a thinking sound.
    bridge_line = "Just a second." if eng else "एक सेकंड।"
    general_agent = is_general_agent(agent)
    transfer_fail_closing = (TRANSFER_FAIL_CLOSING_GENERAL if general_agent
                             else TRANSFER_FAIL_CLOSING)

    stt_bias = (agent.get("name") or "").strip() or None
    # `providers` (sim/timing.py): the timing simulator runs THIS pipeline —
    # every gate, the aggregator, VAD, Smart Turn, the watchdog — with stub
    # STT/LLM/TTS services instead of vendors, so turn-taking bugs reproduce
    # offline. Production never passes it.
    providers = providers or {}
    stt_primary = stt_fallback = None
    if providers.get("stt") is not None:
        stt = providers["stt"]
        stt_primary = providers.get("stt_primary") or stt
        stt_fallback = providers.get("stt_fallback")       # the real-STT sim's waterfall
    else:
        stt, stt_primary, stt_fallback = build_stt_waterfall(
            settings.sample_rate, language=stt_lang, bias=stt_bias, mode=_agent_stt_mode(agent))
    flags["stt_failed_over"] = False

    async def _stt_failover(why: str) -> bool:
        """Hand the rest of the call to the fallback STT. Once per call."""
        if stt_fallback is None or flags["stt_failed_over"]:
            return False
        flags["stt_failed_over"] = True
        diag.bump("stt_failovers")
        diag.stt_vendor_final = type(stt_fallback).__name__
        logger.warning("stt failover: %s — switching %s → %s for the rest of the call corr=%s",
                       why, type(stt_primary).__name__, type(stt_fallback).__name__, corr)
        await task.queue_frames([ManuallySwitchServiceFrame(service=stt_fallback)])
        return True

    def _note_vendor_failover():
        """pipecat's own failover (a non-fatal ErrorFrame from the active
        vendor) switches without telling us — the strategy's
        on_service_switched event did not fire in the real-STT sim — so the
        watchdog polls the active service once a second and counts it."""
        if (stt_fallback is not None and not flags["stt_failed_over"]
                and getattr(getattr(stt, "strategy", None), "active_service", None) is stt_fallback):
            flags["stt_failed_over"] = True
            diag.bump("stt_failovers")
            diag.stt_vendor_final = type(stt_fallback).__name__
            logger.warning("stt failover: vendor error — pipecat switched %s → %s corr=%s",
                           type(stt_primary).__name__, type(stt_fallback).__name__, corr)
    # to_thread: Vertex constructors do a SYNCHRONOUS service-account OAuth
    # round-trip; keep it off the loop so concurrent calls' audio never glitches.
    # Per-agent LLM routing for the Sarvam POC (config.sarvam_llm_agents): only
    # the listed agents leave the configured provider, so a test never moves
    # every institute's calls at once. Recorded on the report as llm.vendor.
    _agent_id = str(agent.get("id") or "")
    _inst_id = str(context.get("instituteId") or "")
    _llm_provider = None
    if ((_agent_id and _agent_id in settings.bedrock_llm_agents)
            or (_inst_id and _inst_id in settings.bedrock_llm_institutes)):
        _llm_provider = "bedrock"
    elif ((_agent_id and _agent_id in settings.sarvam_llm_agents)
            or (_inst_id and _inst_id in settings.sarvam_llm_institutes)):
        _llm_provider = "sarvam"
    if providers.get("llm") is not None:
        llm = llm_primary = providers["llm"]
        llm_fallback = providers.get("llm_fallback")     # the timing sim's LLM waterfall
        if llm_fallback is not None:                     # built as build_llm_waterfall builds it
            from pipecat.pipeline.service_switcher import (ServiceSwitcher,
                                                           ServiceSwitcherStrategyFailover)
            llm = ServiceSwitcher([llm_primary, llm_fallback],
                                  strategy_type=ServiceSwitcherStrategyFailover)
    else:
        llm, llm_primary, llm_fallback = await asyncio.to_thread(build_llm_waterfall, _llm_provider)
    flags["llm_failed_over"] = False
    flags["llm_failed_over_t"] = 0.0
    flags["llm_failovers_n"] = 0
    if (llm_fallback is not None and settings.llm_retire_primary
            and hasattr(llm_primary, "retire_on_error")):
        llm_primary.retire_on_error = True
        llm_primary.on_retired_drop = lambda: (no_repeat.note_dropped_run(),
                                               diag.bump("retired_runs_dropped"))
    _eff_provider = _llm_provider or settings.llm_provider
    diag.llm_vendor = "%s/%s" % (
        _eff_provider,
        {"sarvam": settings.sarvam_llm_model, "vertex": settings.vertex_model,
         "bedrock": settings.bedrock_model}.get(
            _eff_provider, getattr(llm_primary, "model_name", "") or ""))
    logger.info("llm: %s corr=%s%s", diag.llm_vendor, corr,
                " (per-agent POC override)" if _llm_provider else "")
    tts = providers.get("tts") or build_tts(settings.sample_rate, voice=_agent_voice(agent),
                                            aiohttp_session=aiohttp_session,
                                            pace=_as_float(agent.get("pace")),
                                            temperature=_as_float(agent.get("temperature")),
                                            tts_model=_agent_tts_model(agent),
                                            language=agent.get("language"))
    # No bridge line on Sarvam: pipecat builds SarvamTTSService with
    # pause_frame_processing, so a line spoken while the model is still composing
    # holds the TTS until that line's audio has played. Call c6847f91 (2026-10-14,
    # bulbul:v4-flash): the bridge's audio never came, the fallback model's reply sat
    # behind it from 06:07:57 and the caller heard 16 s of nothing until they spoke.
    # Smallest pauses the same way but has not failed like this; the stamp (not
    # engine_of's unstamped default) keeps the timing sim's stub TTS bridging.
    bridge_freezes_tts = (getattr(tts, "_vacademy_engine", ("", ""))[0]
                          in ("sarvam", "sarvam_v4")
                          and bool(getattr(tts, "_pause_frame_processing", False)))
    # The STT waterfall's own services too (stalls are counted on them — the
    # switcher has no set_diagnostics); `stt` IS the primary without a fallback.
    _diag_set = set()
    for _svc in (stt, stt_primary, stt_fallback, tts):
        if _svc is None or id(_svc) in _diag_set:
            continue
        _diag_set.add(id(_svc))
        if hasattr(_svc, "set_diagnostics"):
            _svc.set_diagnostics(diag)
    diag.tts_vendor = (getattr(tts, "model_name", "")
                       or str(getattr(getattr(tts, "_settings", None), "model", "") or "")
                       or type(tts).__name__)
    if hasattr(tts, "set_credits_callback"):
        tts.set_credits_callback(
            lambda credits, secs, chars=0: diag.note_tts_spend(credits, secs, chars))
    if hasattr(tts, "set_generate_callback"):
        def _stamp_generate():
            if flags["tts_gen_t"] == 0.0 and not flags["bot_speaking"]:
                flags["tts_gen_t"] = time.time()
        tts.set_generate_callback(_stamp_generate)

    # ── TTS speech cache ────────────────────────────────────────────────────
    # Replay audio we already paid to synthesize, on an EXACT sha256 match of
    # (engine, model, voice, pace, temperature, rate, term-map, sentence,
    # and Smallest language). One
    # differing character is a miss and goes to the vendor.
    #
    # engine_of(tts), not _agent_tts_model(agent): build_tts silently falls back
    # to Sarvam on a missing key, and filing that audio under the configured
    # engine's key would serve the wrong voice to every future match.
    _cache_engine, _cache_model = engine_of(tts)
    # The bot's OWN lines. They never pass through the LLM, an admin authored
    # them, and each arrives as a standalone TTSSpeakFrame — so they are the one
    # class that can be pre-warmed and is exempt from the "was it heard" gate.
    # Resolved exactly as _greet_when_ready will resolve it, so the key matches
    # what actually gets spoken. Deterministic: same agent + same context in,
    # same string out.
    # Guarded: _greet_when_ready calls this same pair inside a background task,
    # where a raise costs the opening line. Here it would be on the call setup
    # path, where a raise costs the whole call — and _fill_placeholders reaches
    # strftime with glibc-only directives. A warm target is not worth that.
    try:
        _opening_for_cache = _clean_opening(_fill_placeholders(
            (agent.get("openingLine") or "").strip(), context, full_name=True))
    except Exception:
        logger.exception("tts-cache: could not resolve the opening line for warming")
        _opening_for_cache = ""
    _fixed_lines = {
        _opening_for_cache, nudge_text, cap_farewell, transfer_closing,
        idle_farewell, end_closing, transfer_fail_closing, bridge_line,
    }
    _fixed_lines.update(eng_fillers if eng else settings.filler_phrases)
    _fixed_lines.update(NoRepeatGate._HANDBACK_EN if eng else NoRepeatGate._HANDBACK)
    _fixed_lines.add(orphan_text)
    _fixed_lines.discard("")
    tts_candidates = ttscache.CallCandidates(ttscache.get_cache())
    tts_watcher = ttscache.install_tts_cache(
        tts,
        engine=_cache_engine, model=_cache_model,
        voice=_agent_voice(agent) or "",
        pace=_as_float(agent.get("pace")),
        temperature=_as_float(agent.get("temperature")),
        language=agent.get("language"),
        term_map_version=(rumik_term_map_version() if _cache_engine == "rumik" else ""),
        fixed_lines=_fixed_lines,
        # Per-agent rollout gate — one agent first, then widen (TTS_CACHE_AGENTS).
        agent_id=str(agent.get("id") or ""), agent_name=str(agent.get("name") or ""),
        institute_id=str(context.get("instituteId") or ""),
        # snake_case, like tts_model: admin_core emits it that way ON PURPOSE and
        # always emits it, because the safe default for a MISSING key is OFF.
        cache_mode=str(agent.get("speech_cache_mode") or ttscache.MODE_OFF),
        # Rumik rewrites Devanagari-spelt English terms at the synthesis
        # boundary, so the cache must key on the text the VENDOR sees.
        normalize=(normalize_for_rumik if _cache_engine == "rumik" else None),
        diag=diag, candidates=tts_candidates)
    # Only hand the candidate list to the report when the cache is actually
    # installed. Left attached for an OFF agent it would be empty forever, and
    # report.py would still spawn a thread per call to flush nothing.
    outcome.tts_candidates = tts_candidates if tts_watcher is not None else None

    llm_context = LLMContext(
        messages=[{"role": "system", "content": build_system_prompt(context, sink=diag.note_unfilled)}]
    )

    # ── 1.4 turn machinery: VAD + Smart Turn v3 + idle, all on the aggregator ──
    # Telephony VAD tuning carries over from the 0.0.95 fixes: min_volume 0.35
    # (pipecat's 0.6 default made the VAD stone-deaf to phone-leg callers on live
    # call 8e1e00ad — the single worst finding of the migration's test calls).
    vad = SileroVADAnalyzer(params=VADParams(
        stop_secs=settings.vad_stop_secs,
        start_secs=settings.vad_start_secs,
        confidence=settings.vad_confidence,
        min_volume=settings.vad_min_volume,
    ))
    turn_strategies = UserTurnStrategies(
        # enable_interruptions=False on BOTH start strategies: a bare VAD onset
        # (cough, backchannel) must never hard-cancel a reply. DuckGate silences
        # the line instantly; the turn-gate decides on the words.
        start=[
            # enable_interruptions=True — MEASURED DECISION, reversed from the
            # duck-only design. Holding audio in DuckGate cannot stop the bot
            # quickly, because by the time the caller speaks the reply has
            # already flowed PAST the duck into pipecat's output queue and
            # Plivo's buffer; live call d6e82def logged "dropping 0 held
            # frame(s)" on an interrupt for exactly this reason. Only a flush
            # empties those, and the duck could only flush after the STT final
            # arrived — 0.8-1.6s later. Probed talk-over was 1.96s.
            # A native interruption at VAD onset flushes both immediately.
            # Backchannels are still not lost: the turn-gate appends them to the
            # context, and _resume_after_backchannel below has the bot pick up
            # its sentence, because a cancelled reply cannot be un-cancelled.
            # Voice mode (BARGE_IN_MODE, 2026-09-23): the onset never cuts —
            # the turn-gate stops the bot on meaning or on sustained voice.
            VADUserTurnStartStrategy(enable_interruptions=(settings.interrupt_on_vad
                                                           and settings.barge_in_mode != "voice"),
                                     enable_user_speaking_frames=True),
            # Interims must NOT interrupt on their own: Google STT streams them
            # continuously, and the VAD onset above already covers the stop.
            TranscriptionUserTurnStartStrategy(use_interim=True,
                                               enable_interruptions=False),
        ],
        stop=[
            TurnAnalyzerUserTurnStopStrategy(
                turn_analyzer=(smart_turn := LocalSmartTurnAnalyzerV3(
                    params=SmartTurnParams(stop_secs=settings.smart_turn_stop_secs)))),
        ],
    )
    aggregators = LLMContextAggregatorPair(
        llm_context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=vad,
            user_turn_strategies=turn_strategies,
            user_idle_timeout=settings.idle_timeout_secs,
        ),
    )

    def on_transcript(backchannel: bool = False, substantive: bool = False):
        flags["transcript_t"] = time.time()
        if substantive:
            flags["substantive_t"] = flags["transcript_t"]
        if not backchannel and flags["end_pending_since"] != 0.0:
            flags["end_pending_since"] = 0.0
            outcome.end_requested = False
            logger.info("sentinel: caller re-engaged after farewell — call continues corr=%s", corr)
        flags["deaf_streak"] = 0
        flags["orphan_used"] = False
        if not backchannel:
            flags["nudged"] = False
            flags["nudge_count"] = 0
            flags["idle_rechecks"] = 0

    def _on_duck():
        flags["ducked_since"] = time.time()

    def _on_unduck():
        flags["ducked_since"] = 0.0

    def _on_interrupt():
        flags["last_cut_t"] = time.time()

    def _recently_cut() -> bool:
        # Only a cut of what is on the line NOW (call edbbe7b3, 2026-10-14).
        if not cut_still_current(flags["last_cut_t"], flags["bot_speaking"],
                                 flags["bot_started_t"]):
            return False
        return (flags["last_cut_t"] > 0
                and time.time() - flags["last_cut_t"] <= settings.backchannel_carry_secs)

    # Holding audio is a stop too — in voice mode the reply keeps playing.
    duck = DuckGate(enabled=lambda: settings.duck_enabled and settings.barge_in_mode != "voice",
                    is_bot_speaking=lambda: flags["bot_speaking"],
                    on_duck=_on_duck, on_unduck=_on_unduck, diag=diag,
                    on_interrupt=_on_interrupt)

    floor = FloorGate(
        enabled=lambda: settings.floor_hold_enabled and not _opening_pending(),
        caller_talking=lambda: (flags["voice_tick_t"] > 0 and
                                time.time() - flags["voice_tick_t"] < settings.filler_voice_live_secs),
        is_bot_speaking=lambda: flags["bot_speaking"],
        diag=diag, cap_secs=settings.floor_hold_cap_secs)

    async def _absorb(text):
        if text is not None:
            diag.bump("duck_absorbs")
        await duck.resume("backchannel" if text is not None else "no_content")

    # ONE re-say per call. If the caller talks over the re-delivered opening
    # too, the normal continuation path takes it from there — never a loop.
    _opening_resays = 0        # at most two: a noisy pickup can cut it twice
    _greet_queued_t = 0.0      # stamped by _greet_when_ready when it queues the opening
    _greet_skipped = False     # the callee spoke first: no scripted opening will play
    _greet_connect_t = 0.0     # when _greet_when_ready began watching for the callee
    # Who is calling, as the opening says it, and how much of it must PLAY for
    # the person to have heard that (opening_intro_secs; 0 = it does not say).
    _intro_names = [str(agent.get("name") or "").strip(),
                    str(context.get("instituteName") or "").strip()]
    _intro_secs = opening_intro_secs(_opening_for_cache, _intro_names)
    _intro_cue_text = intro_cue_text(*_intro_names)

    def _opening_played_secs() -> float:
        """Seconds of the opening's audio played in its current delivery —
        frozen at the cut, so RunGuard ("the opening is the reply", it swallows
        the run) and _resay_opening (it re-says) read the SAME number in the
        few hundred ms before the transport reports the bot stopped. Were they
        to straddle the half-way mark, the run would be swallowed and nothing
        said."""
        seg = flags["opening_seg_t"]
        if not seg:
            return flags["opening_play_secs"]
        end = flags["last_cut_t"] if flags["last_cut_t"] > seg else time.time()
        return flags["opening_play_secs"] + max(0.0, end - seg)

    def _opening_pending() -> bool:
        """The scripted opening is still owed to the caller: it was never
        played, or was cut before half of it played, no reply has run, and
        we are still inside the pickup window (so this can never mute a call)."""
        try:
            return (diag.greet_path == "scripted" and _in_machine_window()
                    and _opening_barely_heard(_opening_for_cache, outcome.transcript,
                                              flags["reply_started_t"],
                                              played_secs=_opening_played_secs()))
        except NameError:
            return False

    # A queued delivery that has not made a sound yet is still on its way for
    # this long (a cached opening starts in ~0.1 s, a synthesized one in under
    # a second); past it, it is not coming and RunGuard stops waiting for it.
    _OPENING_START_GRACE_SECS = 1.5

    def _opening_coming() -> bool:
        """See callstate.opening_coming — only a scripted greet has one."""
        return (diag.greet_path == "scripted"
                and opening_coming(flags, _greet_queued_t, time.time(),
                                   _OPENING_START_GRACE_SECS))

    def _intro_heard() -> bool:
        return intro_heard(flags, _opening_played_secs(), _intro_secs,
                           outcome.transcript, _intro_names)

    _intro_cue_chars = 0       # played assistant text when the note was last added

    def _played_chars() -> int:
        return sum(len(spoken_key(e.get("text") or "")) for e in outcome.transcript
                   if e.get("role") == "assistant")

    def _intro_cue() -> str:
        """The note for a run going to the model while the opening that
        introduces us was never heard ("" = none): the callee spoke first and
        the opening was skipped (9fd6489d), it raced a run and both were
        dropped (c3818b83), or it was cut before the name (a11e6709). Once
        speech after the note has PLAYED, it is not added again — measured on
        the played transcript, not "audio started after a reply started": in
        the replay of c3818b83 the noted reply never played, a resumed
        fragment did, and the next reply went out with no note."""
        nonlocal _intro_cue_chars
        # The callee spoke first and the greet has not polled yet (it does
        # every 0.1 s): its own skip test already holds, so it WILL skip — a
        # run closing in that gap went out with no note (review 2026-10-14).
        _skipping = (_greet_connect_t and not _greet_queued_t
                     and flags["substantive_t"] > _greet_connect_t + 0.05)
        if not _intro_secs or not (_greet_skipped or _skipping
                                   or diag.greet_path == "scripted"):
            return ""
        if _intro_heard() or _opening_coming():
            return ""
        if flags["intro_cue_t"] and _played_chars() - _intro_cue_chars >= 20:
            return ""                   # more than a bridge line has played since
        flags["intro_cue_t"] = time.time()
        _intro_cue_chars = _played_chars()
        return _intro_cue_text

    async def _resay_opening(text, force: bool = False, cut_now: bool = False) -> bool:
        nonlocal _opening_resays
        if _opening_resays >= 2 or diag.greet_path != "scripted" or not _greet_queued_t:
            return False
        if not force:
            # Only when something actually KILLED the queued opening: an
            # interruption after it was queued. Call 09c5279a (2026-09-10): the
            # caller's "Hello" arrived 0.85s after the greet was queued but before
            # the pipeline had even started playing it; nothing had cancelled it,
            # the re-say queued a second copy, and the caller heard the whole
            # introduction twice back to back.
            # …and a cut of THIS delivery. Measured against the first greet, the
            # one cut that caused a re-say also justified the next: an absorbed
            # "हाँ।" during the re-said opening queued another copy, and the
            # father's "fifth class…" waited 26 s behind two more openings
            # (call 8208166f replayed on the live build, 2026-10-01).
            if not cut_now and not (flags["last_cut_t"]
                                    > max(_greet_queued_t, flags["opening_queued_t"])):
                return False
            played = _opening_played_secs()
            if not _opening_barely_heard(_opening_for_cache, outcome.transcript,
                                         flags["reply_started_t"], played_secs=played):
                if played > 0:
                    logger.info("greet: %r after %.1fs of the opening — heard; the model "
                                "answers it corr=%s", (text or "")[:20], played, corr)
                return False
            # Some of it played and what they said is a real answer — busy, a
            # refusal, a question: the model answers THAT (it has the opening in
            # its context). The top of the opening again ignores them — call
            # 1f2b97ab: "अभी time नहीं है" -> "नमस्ते जी, मैं श्रेया…". Before ANY
            # audio played (call ab194522) the opening is still owed, whatever
            # they said.
            if played > 0 and takes_over_opening(text or ""):
                logger.info("greet: %r over the opening is an answer, not a pickup "
                            "— the model takes it corr=%s", (text or "")[:20], corr)
                return False
        # force=True: a call screener took the opening and the human has just
        # picked up — the "was it cut / barely heard" tests are about THEIR
        # ears, and none of it reached them (calls 612f5e37, 91d1541e).
        _opening_resays += 1
        diag.bump("opening_resaid")
        flags["opening_heard_secs"] = max(flags["opening_heard_secs"], _opening_played_secs())
        flags["opening_delivery_t"] = time.time()
        flags["opening_play_secs"] = 0.0         # a new delivery; heard is measured afresh
        flags["opening_seg_t"] = time.time() if flags["bot_speaking"] else 0.0
        # The interruption of the cut that caused THIS re-say can be stamped a
        # few ms after it is queued (DuckGate sees the frame later): it must
        # not count as a cut of the new delivery, which has not played yet.
        flags["opening_queued_t"] = time.time() + 0.5
        logger.info("greet: %s — saying the opening again corr=%s",
                    "the line was screening; the person just picked up" if force
                    else "caller's %r cut the opening at its start" % (text or "")[:20], corr)
        await task.queue_frames([TTSSpeakFrame(_opening_for_cache,
                                               append_to_context=False)])
        return True
        # Only when something actually KILLED the queued opening: an
        # interruption after it was queued. Call 09c5279a (2026-09-10): the
        # caller's "Hello" arrived 0.85s after the greet was queued but before
        # the pipeline had even started playing it; nothing had cancelled it,
        # the re-say queued a second copy, and the caller heard the whole
        # introduction twice back to back.
        if not (_greet_queued_t and flags["last_cut_t"] > _greet_queued_t):
            return False
        if not _opening_barely_heard(_opening_for_cache, outcome.transcript,
                                     flags["reply_started_t"]):
            return False
        _opening_resays += 1
        diag.bump("opening_resaid")
        logger.info("greet: caller's %r cut the opening at its start — saying the "
                    "opening again corr=%s", (text or "")[:20], corr)
        # append_to_context=False: the context already holds the opening once
        # (the greet path pre-appends it); this is the AUDIO the caller missed.
        await task.queue_frames([TTSSpeakFrame(_opening_for_cache,
                                               append_to_context=False)])
        return True

    def _on_reply_start():
        flags["reply_started_t"] = time.time()

    def _reply_in_flight() -> bool:
        """True from the LLM starting a reply until that reply is off the line.

        Exists for the ~0.5-1.0s hole between "the LLM began composing" and
        "the bot is audible". Call bc84958c: Sarvam split one answer into two
        finals 0.85s apart, the second landed in that hole, the turn-gate saw a
        quiet bot and let it through as a brand-new turn, and the bot delivered
        its ENTIRE Marks Improvement pitch TWICE — about 40 seconds of it. The
        caller asked, on the line, "फिर से repeat क्यों कर रहे हैं आप".

        The second final was not a barge-in either: it arrived through
        TranscriptionUserTurnStartStrategy, which has interruptions disabled, so
        nothing cancelled the first reply.

        Time-capped so a generation that dies without ever reaching playout
        cannot mute the caller's turns for the rest of the call.
        """
        if floor.is_holding():
            return True         # composed, held off the line while the caller talks
        if settings.reply_ledger and no_repeat.generating():
            return True         # a run passed and its reply is still composing
        st = flags["reply_started_t"]
        if not st or flags["bot_speaking"]:
            return False        # is_bot_speaking() already covers the audible case
        if settings.reply_ledger:
            # From the reply's own audio START, not the last stop: a run that
            # began while the previous reply was still playing stays in flight
            # until ITS audio starts — the previous reply's stop (or the bridge
            # line's) no longer reads as "nothing on its way" (single-flight
            # design 2026-10-01: calls c05f6c83, 1d28af3a).
            return (flags["bot_started_t"] < st and flags["reply_cancelled_t"] < st
                    and (time.time() - st) < settings.reply_inflight_grace_secs)
        return (flags["bot_stopped_t"] < st
                and (time.time() - st) < settings.reply_inflight_grace_secs)

    def _reply_unheard(since: float) -> bool:
        """The reply to the run RunGuard let through at `since` has not made a
        sound and is still on its way (composing, rendering, or held off the
        line by the floor) — RunGuard may supersede it with the caller's next
        piece. Any bot audio since `since` (that reply's, a filler's) or audio
        playing now means the caller is hearing us: that is a barge-in, the
        turn-gate's business, as before. A reply already cut needs nothing —
        but a supersede is not a cut of the run that replaced it, or a third
        piece could not supersede the second (callstate.reply_unheard)."""
        return reply_unheard(flags, since, _reply_in_flight)

    def _caller_forming() -> bool:
        """The caller's words are in the user aggregator, not yet pushed as a
        turn (pipecat clears _aggregation BEFORE it pushes, so this is exact)."""
        try:
            return bool(aggregators.user()._aggregation)
        except AttributeError:
            return False

    def _bot_run_drop_reason(for_reply: float = 0.0):
        """Why a run the BOT started must not run now (None = it may).
        Only a line that is actually CLOSING drops it: a goodbye or transfer
        line a noise killed before it played still needs the re-ask (design
        review 2026-10-01), and NoRepeatGate guards its own cues after a
        goodbye. A recovery cue does not count the very reply it recovers —
        an empty or fully-dropped reply still sits in the reply_started_t
        window, and dropping its recovery left ~8 s of silence."""
        if flags["stopping_since"] is not None:
            return "the line is closing"
        if for_reply and flags["reply_started_t"] == for_reply:
            # Not floor.is_holding(): the floor may be holding THIS reply's own
            # first audio while the caller breathes — the voice-live hold at the
            # door takes the cue instead and re-checks once they stop
            # (re-review 2026-10-01: an empty/filler reply's recovery dropped).
            pending = (settings.reply_ledger
                       and (no_repeat.generating() or run_guard.held()))
        else:
            pending = _reply_pending()
        if pending:
            return "a reply is already on its way"
        return None

    def _reply_pending() -> bool:
        """A reply is on its way: in flight, or a caller turn RunGuard is holding
        for its short-answer grace. Every place the bot would start a run of its
        own (a cue, a re-ask, a resume, the idle fallback) asks THIS — a held
        caller turn is a reply on its way too."""
        return _reply_in_flight() or (settings.reply_ledger and run_guard.held())

    def _in_machine_window() -> bool:
        return (time.time() - _run_bot_t0) < settings.machine_greeting_window_secs

    transcript = TranscriptCollector(outcome, on_activity,
                                     is_bot_speaking=lambda: flags["bot_speaking"],
                                     set_user_speaking=set_user_speaking,
                                     filler_phrases=eng_fillers if eng else None,
                                     on_transcript=on_transcript,
                                     fillers_armed=lambda: flags["bot_spoke_once"],
                                     bot_stopped_t=lambda: flags["bot_stopped_t"],
                                     bot_started_t=lambda: flags["bot_started_t"],
                                     duck=duck, on_absorb=_absorb,
                                     backchannel_extra=settings.backchannel_extra,
                                     gate_enabled=lambda: settings.duck_enabled,
                                     # "Was the reply cut?" — in voice mode only a
                                     # real stop (transcript or sustained voice) is.
                                     interrupt_on_vad=((lambda: _recently_cut())
                                                       if settings.barge_in_mode == "voice"
                                                       else (lambda: settings.interrupt_on_vad)),
                                     cut_after_voice_secs=(settings.barge_in_voice_secs
                                                           if settings.barge_in_mode == "voice"
                                                           else 0.0),
                                     ack_answer_window_secs=settings.ack_answer_window_secs,
                                     recently_cut=_recently_cut, diag=diag,
                                     end_pending=lambda: (flags["end_pending_since"] != 0.0
                                                          or outcome.end_requested),
                                     in_machine_window=_in_machine_window,
                                     reply_in_flight=_reply_in_flight,
                                     reply_pending=lambda: _reply_pending(),
                                     caller_forming=lambda: (settings.run_forming_hold
                                                             and _caller_forming()),
                                     register_cue=lambda text: run_guard.register_cue(text),
                                     opening_owed=lambda: _opening_pending(),
                                     bot_spoke_once=lambda: flags["bot_spoke_once"],
                                     on_voice_tick=lambda: flags.__setitem__(
                                         "voice_tick_t", time.time()),
                                     # Two missed VAD ticks (they arrive every 0.2s
                                     # while voice is live). Long enough to ride out a
                                     # breath mid-sentence, short enough that a real
                                     # end-of-turn still gets its filler.
                                     voice_live=lambda: (
                                         time.time() - flags["voice_tick_t"]
                                         < settings.filler_voice_live_secs),
                                     # late-bound: no_repeat is created below
                                     on_continuation=lambda: no_repeat.mark_continuation(),
                                     resume_unplayed=(
                                         (lambda n: no_repeat.take_unplayed_tail(n))
                                         if settings.backchannel_resume_verbatim else None),
                                     resume_on_stop_secs=settings.backchannel_resume_on_stop_secs,
                                     resume_max_chars=settings.backchannel_resume_max_chars,
                                     resume_settle_secs=settings.backchannel_resume_settle_secs,
                                     forget_resume=lambda: no_repeat.forget_resumed(),
                                     release_turn=lambda: settings.turn_release_on_absorb,
                                     noise_reask_wait_secs=settings.noise_reask_wait_secs,
                                     resay_opening=_resay_opening,
                                     greet_skipped=lambda: _greet_skipped,
                                     general_agent=general_agent)
    played_transcript = PlayedTranscriptRecorder(outcome)

    async def _ask_for_next_step(held: str, kind: str = "", attempt: int = 0):
        """NoRepeatGate found that the whole reply repeated a question the caller
        had just answered (or only restated their answer). Rather than hand the
        turn back to someone who has just spoken, ask the model for its next
        line. `task` is bound later in this function — the closure resolves it
        at call time, like on_continuation."""
        what, cue = next_step_cue(held, kind, attempt)
        logger.info("next-step: requesting a fresh line (%s, attempt %d) corr=%s",
                    what, attempt, corr)
        run_guard.register_cue(cue, on_drop=no_repeat.refund_next_step,
                               for_reply=flags["reply_started_t"])
        await task.queue_frames([LLMMessagesAppendFrame(
            messages=[{"role": "user", "content": cue}], run_llm=True)])

    def _bridge_is_stale(text: str) -> bool:
        return (text == bridge_line and flags["bridged_reply_t"] > 0
                and flags["bot_started_t"] > flags["bridged_reply_t"])

    # Same test at SYNTHESIS time: with per-sentence contexts the TTS pauses
    # frame processing while a context plays, so a line that was fresh when
    # it passed the gate can be minutes stale when the vendor gets to it.
    if hasattr(tts, "skip_text_if"):
        tts.skip_text_if = lambda text: ("the reply it covered for is already playing"
                                         if _bridge_is_stale(text) else None)

    no_repeat = NoRepeatGate(
        # Only when THIS error's failover re-run is coming: the failover
        # handler re-runs once per call (a later primary error, after the
        # switcher went back to it, is answered by the ordinary recovery).
        primary_errored_since=lambda t: (settings.llm_retire_primary and llm_fallback is not None
                                         and t > 0
                                         and getattr(llm_primary, "errored_t", 0.0) >= t
                                         and (not flags["llm_failed_over"]
                                              or flags["llm_failed_over_t"] >= t)),
        caller_turn_pending=lambda: (settings.cue_one_door
                                     and (run_guard.held() or _caller_forming())),
        enabled=lambda: settings.no_repeat_enabled,
        end_forced=lambda: outcome.end_forced,
        last_caller_text=lambda: (outcome.transcript[-1].get("text", "")
                                  if outcome.transcript
                                  and outcome.transcript[-1].get("role") == "user" else ""),
        no_echo=lambda: settings.no_echo_enabled,
        # An English agent handing back in romanized Hindi ("Ji, boliye.") is a
        # language break the caller hears immediately — and these lines bypass
        # the prompt's SCRIPT rule entirely because they never touch the LLM.
        request_next_step=_ask_for_next_step,
        drop_stale_bridge=_bridge_is_stale,
        max_sentences=lambda: settings.max_sentences_per_reply,
        max_chars=lambda: settings.max_reply_chars,
        # A goodbye with the end marker is a reply with no question: never
        # "continue" after it, and never treat its empty text as a failed reply.
        ending=lambda: bool(outcome.end_requested or flags["end_pending_since"] > 0),
        handbacks=(NoRepeatGate._HANDBACK_EN
                   if _agent_language(agent)[0] == "en-IN" else None),
        # PlayedTranscriptRecorder's record of what the caller actually heard —
        # the interruption branch uses it to un-record never-played sentences.
        played_text=lambda: " ".join(
            t.get("text") or "" for t in outcome.transcript[-6:]
            if t.get("role") == "assistant"),
        child_slots=not general_agent,
        diag=diag)

    def _fire_mid_call_send(key: str) -> None:
        """Hand a mid-call send to admin_core WITHOUT blocking the voice path.

        create_task, never await: this is a cross-ocean HTTP call (bot in Mumbai,
        admin_core in Singapore) and the agent is mid-sentence. A lost fire is
        recoverable — the post-call rules see the same acceptance in promisedSends.
        """
        try:
            asyncio.create_task(
                admin_core.post_action(corr, key, agent.get("id")))
        except Exception:
            logger.exception("sentinel: could not schedule send %s corr=%s", key, corr)

    sentinel = SentinelGate(outcome, on_activity, set_bot_speaking,
                            on_reply_start=_on_reply_start,
                            transfer_closing=transfer_closing, end_closing=end_closing,
                            transfer_fail_closing=transfer_fail_closing,
                            on_send=_fire_mid_call_send, diag=diag)

    run_guard = RunGuard(llm_context,
                         enabled=lambda: settings.run_guard_enabled,
                         diag=diag,
                         short_answer_grace_secs=settings.short_answer_grace_secs,
                         short_answer_max_words=settings.short_answer_max_words,
                         quiet_for=lambda: (time.time() - flags["voice_tick_t"]
                                            if flags["voice_tick_t"] else float("inf")),
                         on_run=lambda text: (
                             no_repeat.note_run(),
                             outcome.replay["runs"].append(
                                 [round(time.time() - outcome.connected_at, 2), text])),
                         opening_pending=lambda: _opening_pending(),
                         noise_cap_secs=settings.short_answer_noise_cap_secs,
                         caller_forming=lambda: (settings.run_forming_hold and _caller_forming()),
                         forming_cap_secs=settings.forming_hold_cap_secs,
                         bot_run_drop_reason=lambda for_reply=0.0: _bot_run_drop_reason(for_reply),
                         voice_live=lambda: (flags["voice_tick_t"] > 0
                                             and time.time() - flags["voice_tick_t"] < 0.4),
                         supersede=lambda: settings.run_supersede,
                         reply_unheard=_reply_unheard,
                         runs_noted=lambda: no_repeat.runs_noted(),
                         before_run=lambda: _llm_return_frame(),
                         on_hold=lambda: transcript.on_hold(),
                         opening_coming=_opening_coming,
                         intro_cue=_intro_cue,
                         audible_since=lambda t: (flags["bot_speaking"]
                                                  or flags["bot_started_t"] > t
                                                  or flags["bot_stopped_t"] > t),
                         is_voicemail=lambda: transcript.looks_like_voicemail())
    run_guard._one_door = lambda: settings.cue_one_door

    # One EQ per call: it carries IIR state across frames, so it must not be
    # shared between concurrent calls. None when disabled or scipy is missing,
    # and then no processor is added at all.
    # Voice modulation (app/prosody.py): per-agent factor from the dashboard
    # (agent.voiceModulation, V504), else the box default — off unless set.
    # Per call for the same reason as the EQ: it carries audio state.
    _prosody = build_prosody_shaper(
        agent.get("voiceModulation") if agent.get("voiceModulation") is not None
        else settings.prosody_expand)
    if _prosody is not None:
        logger.info("prosody: pitch-range expansion x%.2f corr=%s", _prosody.expand, corr)
    _voice_eq = build_voice_eq(settings)
    if _voice_eq is not None:
        logger.info("voice-eq: HP%.0fHz + LP%.0fHz + %+.1fdB@%.0fHz, makeup %+.1fdB corr=%s",
                    _voice_eq.highpass_hz, _voice_eq.lowpass_hz, _voice_eq.presence_db,
                    _voice_eq.presence_hz, settings.voice_eq_makeup_db, corr)

    # Shadow mode: the caller's gender from their voice — measured and reported,
    # never used yet (app/caller_gender.py). Pass-through; skips while the bot talks.
    from .caller_gender import make_probe as _make_gender_probe
    gender_probe = _make_gender_probe(lambda: flags["bot_speaking"])

    pipeline = Pipeline([
        transport.input(),
        gender_probe,
        stt,
        transcript,
        aggregators.user(),
        run_guard,
        llm,
        sentinel,
        no_repeat,
        tts,
        # Feeds the cache's ordering guard: on an engine whose audio arrives
        # out-of-band, a cached utterance may only be served when the vendor
        # owes us nothing, or it would be heard BEFORE audio requested earlier.
        #
        # ABSENT ENTIRELY when the cache is not installed for this agent — which
        # is every agent until one is switched on. A pass-through processor is
        # cheap but it is not free, and "the chain is byte-identical to today"
        # is a much stronger thing to be able to say than "the extra link does
        # nothing".
        *([ttscache.make_turn_watcher_processor(tts_watcher)]
          if tts_watcher is not None else []),
        floor,          # never START a reply over a talking caller
        duck,
        # Put the bot's voice in the caller's band (app/voice_eq.py). AFTER the
        # duck so audio that is held and then dropped is never filtered for
        # nothing; BEFORE transport.output() so it catches cache hits and
        # scripted lines too — and cannot touch the ambience, which the
        # transport mixes in afterwards.
        # Shape the full-band voice first, then band-limit it.
        *([make_prosody_processor(_prosody)] if _prosody is not None else []),
        *([make_voice_eq_processor(_voice_eq)] if _voice_eq is not None else []),
        # Room-tone level: ducked under speech, drifting slowly while idle.
        # Control frames only; remove this one line to run it flat.
        *([AmbienceDucker(settings.ambience_volume,
                          drift_db=settings.ambience_drift_db,
                          drift_period_secs=settings.ambience_drift_period_secs)]
          if settings.ambience_enabled else []),
        transport.output(),
        played_transcript,
        LateReplyCommitter(diag),   # every heard sentence reaches the history
        aggregators.assistant(),
    ])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=settings.sample_rate,
            audio_out_sample_rate=settings.sample_rate,
            enable_metrics=True,
            # Token usage per LLM run (TtfbObserver sums it into diagnostics).
            enable_usage_metrics=True,
        ),
        observers=[TtfbObserver(corr, diag).observer],
    )

    def _llm_return_frame():
        """After a failover, hand the caller's next turn back to the primary.

        Call a4ce0279 (2026-10-13): Vertex missed its 3 s first-token deadline
        once, at 0:21, and the rest of the call ran on the fallback, which
        repeated a pitch line verbatim. The stall is per request — Vertex
        answers in ~0.6 s again a moment later — so it is the next turn's
        model too. Not inside LLM_RETURN_AFTER_SECS of the failover (its own
        re-run must stay on the fallback), and never after LLM_MAX_FAILOVERS
        stalls: a primary that keeps stalling is left. The switch frame goes
        AHEAD of the run (RunGuard pushes it first); the switcher then hands
        the primary its metadata frame, which also un-retires it
        (providers.with_retire)."""
        if not (settings.llm_return_to_primary and llm_fallback is not None
                and flags["llm_failed_over"]):
            return None
        if flags["llm_failovers_n"] >= settings.llm_max_failovers:
            return None
        if time.time() - flags["llm_failed_over_t"] < settings.llm_return_after_secs:
            return None
        flags["llm_failed_over"] = False
        if hasattr(llm_primary, "retired"):
            llm_primary.retired = False
        diag.bump("llm_returns")
        diag.llm_vendor_final = ""
        logger.info("llm: back on %s for this turn (failover %.0f s ago) corr=%s",
                    type(llm_primary).__name__, time.time() - flags["llm_failed_over_t"], corr)
        return ManuallySwitchServiceFrame(service=llm_primary)

    @task.event_handler("on_pipeline_error")
    async def _on_pipeline_error(_task, frame):
        """The primary LLM failed (a timeout, a 403, a 5xx). pipecat's failover
        strategy has already moved the switcher to the fallback; what it does
        not do is answer the turn that failed — call f58ca825 (2026-09-22): the
        caller waited through 34 s, 49 s and a 403 with only bridges and
        nudges. Re-run that context on the fallback, once."""
        try:
            if llm_fallback is None or flags["llm_failed_over"]:
                return
            proc = getattr(frame, "processor", None)
            if proc is not llm_primary:
                return
            flags["llm_failed_over"] = True
            flags["llm_failed_over_t"] = time.time()
            flags["llm_failovers_n"] += 1
            diag.bump("llm_failovers")
            diag.llm_vendor_final = type(llm_fallback).__name__
            back = (settings.llm_return_to_primary
                    and flags["llm_failovers_n"] < settings.llm_max_failovers)
            logger.warning("llm failover: %s — switching %s → %s %s corr=%s",
                           str(getattr(frame, "error", ""))[:90], type(llm_primary).__name__,
                           type(llm_fallback).__name__,
                           "until the caller's next turn" if back else "for the rest of the call",
                           corr)
            run_guard.allow_rerun()
            await task.queue_frames([ManuallySwitchServiceFrame(service=llm_fallback), LLMRunFrame()])
        except Exception:
            logger.exception("llm failover: handler failed corr=%s", corr)
    sentinel.set_task(task)

    cap_minutes = float(agent.get("maxCallMinutes") or 0) or settings.max_call_minutes_default
    cap_secs = cap_minutes * 60.0

    async def _begin_stop():
        if flags["stopping_since"] is None:
            flags["stopping_since"] = time.time()
            await task.stop_when_done()

    sentinel.set_arm_stop(_begin_stop)

    def _note_killed_before_playout(superseded: bool = False):
        # Suspicion only — unplayed_confirmed() turns it into a fact if silence
        # outlasts the confirm window (95% of these replies play anyway). A
        # SUPERSEDED reply is not lost: it was replaced, on purpose.
        if flags["tts_gen_t"] != 0.0 and not flags["bot_speaking"] and not superseded:
            if flags["unplayed_pending_t"] == 0.0:
                flags["unplayed_pending_t"] = time.time()
        # A cancelled reply is no longer "awaiting playout": without this every
        # later silence was tagged awaiting_playout_<stale seconds> — 401 of
        # 549 s of "dead air" across the 8 worst calls of 2026-09-09..12, while
        # the recordings held no such gaps.
        note_reply_cancelled(flags, time.time(), superseded=superseded)
    sentinel.set_on_interrupted(_note_killed_before_playout)

    def _defer_stop():
        if flags["end_pending_since"] == 0.0:
            flags["end_pending_since"] = time.time()

    def _clear_end_pending():
        flags["end_pending_since"] = 0.0

    sentinel.set_end_hooks(_defer_stop, _clear_end_pending)

    # ── idle: the aggregator's clock replaces the 0.0.95 watchdog nudges ──
    # NOTE for 1.4: TTSSpeakFrame text IS captured into the assistant context by
    # the aggregator (verified in the POC — manual context appends double-add).
    @aggregators.user().event_handler("on_user_turn_idle")
    async def _on_idle(_agg, *_args):
        if flags["stopping_since"] is not None or flags["ducked_since"] > 0:
            return
        if flags["end_pending_since"] > 0 or outcome.end_requested:
            # The goodbye has been said; a "Hello? Are you still there?" after
            # it is the worst possible last impression. Close now.
            logger.info("idle: after farewell — closing, not nudging corr=%s", corr)
            await _begin_stop()
            return
        if (settings.cue_one_door and (_reply_pending() or _caller_forming())
                and flags["idle_rechecks"] < 3):
            # A reply is on its way (composing, held for a short answer, or the
            # caller's turn is still forming): "Hello? Are you there?" or a
            # next-step request now would be a second voice. Look again soon.
            flags["idle_rechecks"] += 1
            logger.info("idle: a reply is already on its way — not nudging; checking "
                        "again in 3 s corr=%s", corr)

            async def _recheck():
                await asyncio.sleep(3.0)
                if not flags["bot_speaking"] and not flags["user_speaking"]:
                    await _on_idle(None)
            asyncio.get_running_loop().create_task(_recheck())
            return
        flags["idle_rechecks"] = 0
        _held = transcript.on_hold_for()
        if 0 < _held < HOLD_MAX_SECS:
            # The person put the call on hold: "Hello? Are you there?" into the
            # hold music is wrong, and hanging up on someone who asked us to wait
            # is worse. No recheck task here: the watchdog loop owns the hold
            # limit (pipecat's idle timer never re-arms on hold — the bot never
            # speaks — and the old self-renewing rechecks stacked up, one per
            # firing, and fired in a burst at 300 s).
            logger.info("idle: on hold for %.0fs — waiting, not nudging corr=%s", _held, corr)
            return
        if transcript.looks_like_voicemail():
            # Nothing to nudge and nobody to say goodbye to (call 24089872).
            diag.idle_hangup = True
            logger.info("idle: voicemail and no human turn — hanging up corr=%s", corr)
            outcome.end_requested = True
            await _begin_stop()
            return
        if flags["nudge_count"] < settings.max_nudges and no_repeat.owes_line():
            # The bot's last reply was only "जी सर।" after the caller spoke: the
            # silence is OURS. "Are you there?" to someone waiting for us is
            # wrong twice over (call 22062aac: 8 s, then the presence check,
            # twice). Ask the model for the next line with the firm cue.
            flags["nudge_count"] += 1
            diag.bump("nudges")
            logger.info("idle: the bot owes the next line — asking for it, not "
                        "'are you there?' corr=%s", corr)
            kind = "" if no_repeat.owed_after_filler() else "continue"
            no_repeat.owed_line_requested()
            await _ask_for_next_step("", kind=kind, attempt=2)
        elif flags["nudge_count"] < settings.max_nudges:
            flags["nudge_count"] += 1
            diag.bump("nudges")
            logger.info("idle: nudge %d corr=%s", flags["nudge_count"], corr)
            # The caller owed this turn (no_repeat.owes_line() was False): the
            # silence the nudge ends is theirs — see set_bot_speaking.
            flags["idle_nudge_t"] = time.time()
            await task.queue_frames([TTSSpeakFrame(nudge_text)])
        else:
            diag.idle_hangup = True
            logger.info("idle: hangup corr=%s", corr)
            if not no_repeat.owes_line():
                flags["idle_nudge_t"] = time.time()
            outcome.end_requested = True
            await task.queue_frames([TTSSpeakFrame(idle_farewell)])
            await _begin_stop()

    async def _greet_when_ready():
        """Open like a person: on OUTBOUND speak first after a short beat unless
        the callee already said something substantive (their turn then drives the
        LLM). Scripted openings are spoken directly — NO manual context append on
        1.4, the assistant aggregator captures spoken text itself."""
        nonlocal _greet_skipped, _greet_connect_t
        opening = _clean_opening(_fill_placeholders(
            (agent.get("openingLine") or "").strip(), context, full_name=True))
        connect_t = time.time()
        _greet_connect_t = connect_t
        # SUBSTANTIVE speech only. This used to test transcript_t, i.e. ANY
        # transcript, so one stray word decided whether we opened at all — and
        # on a voicemail the stray words are the operator's own recording
        # arriving in fragments. Calls 0d61b32a ('Your call.') and 9668da21
        # ('Hi.' / 'If you record your') both lost their opening to a fragment
        # on 2026-08-06, and the model improvised a replacement, which is how
        # one of them delivered its introduction twice.
        while time.time() - connect_t < settings.greet_delay_secs:
            if flags["substantive_t"] > connect_t + 0.05:
                logger.info("greet: callee spoke first — LLM replies, skipping our open (corr=%s)", corr)
                _greet_skipped = True
                return
            await asyncio.sleep(0.1)
        # Hold while the caller is AUDIBLY mid-utterance, then a short settle,
        # capped at 2.5s. Two generations of this loop got the "is the caller
        # speaking" signal wrong:
        #   * v1 held on `user_started_t > connect_t` — true forever after one
        #     sound, so it always burned the whole ceiling (call 5d81ace1).
        #   * v2 keyed on user_speaking/user_stopped_t — but on pipecat 1.4
        #     those are the aggregator's TURN lifecycle, and a turn can outlive
        #     the voice by seconds (call 17be14f2: a "हेलो" turn closed on a
        #     1500ms-silence fallback 4.6s later, so v2 ALSO burned the ceiling).
        # The truth is acoustic: the transport's VAD pushes UserSpeakingFrame
        # every 0.2s while voice is live, stamped into voice_tick_t. Quiet =
        # no tick for 0.6s (3 missed ticks). The turn flag is consulted ONLY
        # when no tick has ever arrived (a transport that doesn't emit them),
        # and even then for at most 1.2s — so a stale-open turn can never pin
        # the greet, while a caller who is genuinely talking holds it with
        # fresh ticks for as long as they speak.
        _tick_settle = 0.6
        while time.time() - connect_t < 2.5:
            if flags["substantive_t"] > connect_t + 0.05:
                diag.greet_path = "callee_spoke_first"
                logger.info("greet: callee spoke first (extended wait) — skipping our open (corr=%s)", corr)
                _greet_skipped = True
                return
            now = time.time()
            voiced = flags["voice_tick_t"]
            acoustically_quiet = voiced == 0.0 or now - voiced >= _tick_settle
            turn_holds = (voiced == 0.0 and flags["user_speaking"]
                          and now - flags["user_started_t"] < 1.2)
            if acoustically_quiet and not turn_holds:
                break
            await asyncio.sleep(0.1)
        if opening:
            diag.greet_path = "scripted"
            diag.greet_delay_secs = round(time.time() - _run_bot_t0, 2)
            logger.info("greet: openingLine spoken (corr=%s) at +%.2fs", corr, time.time() - _run_bot_t0)
            # Record the opening in the LLM context OURSELVES, and tell pipecat
            # not to (append_to_context=False) so there is exactly one copy.
            #
            # pipecat 1.4 does commit TTSSpeakFrame utterances — but only when
            # the utterance COMPLETES: the turn opens on TTSStartedFrame and is
            # committed at the end. A caller who speaks over the opening cancels
            # that commit, and the model is then left with NO record that it
            # ever introduced itself. Measured on the live pipeline: uninterrupted
            # the context held the opening; interrupted at +4s it held only
            # (system, user, assistant-reply) and the reply re-introduced the
            # agent from scratch. That is both of the founder's complaints in one
            # mechanism — the re-delivered intro, AND the language flip, because
            # LANGUAGE STABILITY anchors on "your own previous turns" and there
            # were none.
            #
            # Trade-off, deliberate: if the caller cuts the opening short, the
            # context claims slightly more than the caller heard. Believing it
            # said a bit too much is far cheaper than re-delivering the whole
            # introduction, and the played transcript (PlayedTranscriptRecorder)
            # still records the truth for the report.
            _frames = [
                LLMMessagesAppendFrame(messages=[{"role": "assistant", "content": opening}]),
                TTSSpeakFrame(opening, append_to_context=False)]
            # A BARE-GREETING opening leads straight into the real one. Otherwise
            # the call stalls: on 5d81ace1 the bot said "Hello" at +2.9s, stopped
            # 0.3s later, and then said nothing for 2.1s because it was waiting
            # for a caller turn while the caller waited for it — first real
            # sentence at +5.9s. Depending on the caller to restart the
            # conversation is not a plan; a one-word greeting is not an opening.
            if not _opening_is_substantive(opening):
                diag.greet_path = "scripted+intro"
                logger.info("greet: opening %r is a bare greeting — following it "
                            "straight into the introduction corr=%s", opening[:24], corr)
                _frames.append(LLMMessagesAppendFrame(
                    messages=[{"role": "user", "content":
                               "[You have just said that one-word greeting and the person is "
                               "on the line. NOW deliver your opening — who you are, your "
                               "company, and why you are calling — exactly as your "
                               "instructions specify, then ask your first question. Do NOT "
                               "greet again and do not repeat that word.]"}],
                    run_llm=True))
            nonlocal _greet_queued_t
            _greet_queued_t = time.time()
            flags["greet_queued_t"] = _greet_queued_t
            flags["opening_delivery_t"] = _greet_queued_t
            await task.queue_frames(_frames)

            # THE PRE-APPEND ABOVE CLAIMS THE WHOLE OPENING REACHED THE CALLER.
            # It often does not: the caller talks over the first second, the
            # utterance is cancelled, and the model still reads its own context as
            # "I delivered the full introduction". already_said_rule then tells it
            # "It has been said... Resume from the point AFTER the introduction",
            # so it skips ahead to the next scripted step and the caller — who
            # heard a fragment — has no idea what is being asked. That is the
            # HANDBACK_LOOP shape: on call 3148ccd4 the caller spent the last
            # forty-five seconds asking "मैं क्या बताऊँ?" and hung up.
            #
            # NoRepeatGate got this exact fix on 2026-08-13 (it holds sentences
            # pending and rolls back the ones that never played). The opening
            # bypasses NoRepeatGate entirely — it is injected straight into the
            # context here — so it never received it. This is that fix, for the
            # one utterance most likely to be interrupted.
            #
            # PURELY ADDITIVE, DELIBERATELY. The full opening STAYS in context: it
            # is what stops the "no record at all" failure that cost us both a
            # re-delivered intro and a language flip (see the note above). We only
            # ADD a correction telling the model what the caller actually heard.
            # Every failure mode therefore degrades to today's behaviour:
            #   correction races the caller's turn -> model has the full opening
            #   opening completed                  -> nothing added
            #   nothing reached the caller         -> nothing added
            #   watch loop times out               -> nothing added
            # It can do nothing; it cannot do harm.
            #
            # Substantive openings only. The bare-greeting path above hands
            # straight to the LLM with run_llm=True, so its played text is the
            # greeting PLUS the model's own introduction — not the opening alone,
            # and the length test would be meaningless.
            if _opening_is_substantive(opening):
                _t0 = time.time()
                while time.time() - _t0 < 12.0:
                    # bot_spoke_once flips in set_bot_speaking(False), so this is
                    # exactly "the opening started and has now stopped" — whether
                    # it finished or was cut off.
                    if flags["bot_spoke_once"] and not flags["bot_speaking"]:
                        break
                    await asyncio.sleep(0.05)
                _played = ""
                for _e in reversed(outcome.transcript):
                    if _e.get("role") == "assistant":
                        _played = _e.get("text") or ""
                        break
                # 0.8: TTS re-chunks and normalises, so played text never matches
                # the source exactly. Only correct on a REAL shortfall.
                if _played and len(_played) < len(opening) * 0.8:
                    diag.bump("opening_truncated")
                    # A caller who TALKED OVER the opening is a barge-in, not a
                    # playback failure: they are already speaking and the normal
                    # turn will answer them. Correcting here made the model
                    # re-say the clause it was cut inside — call ddc67ffc opened
                    # "मैं श्रेया बात कर रही हूँ शिक्षा नेशन" twice, which the
                    # caller hears as a repeated introduction. "Finish the point
                    # you were making" cannot be delivered mid-sentence, so the
                    # model restarts the sentence to finish it.
                    #
                    # Only correct when the caller was SILENT — i.e. the audio
                    # genuinely never reached them (network, TTS, carrier cut),
                    # which is the case this was written for. Strictly narrower
                    # than before: every path that fired previously either still
                    # fires or reverts to pre-fix behaviour. It cannot do more.
                    _caller_spoke = any(_e.get("role") == "user"
                                        for _e in outcome.transcript)
                    logger.info("greet: opening cut short — caller heard %d of %d chars "
                                "caller_spoke=%s corr=%s",
                                len(_played), len(opening), _caller_spoke, corr)
                    # Not when the cut came before who is calling: "do not
                    # re-introduce yourself" would then contradict _intro_cue,
                    # which has the next reply introduce (call a11e6709,
                    # 2026-10-14).
                    if not _caller_spoke and _intro_heard():
                        # No run_llm: the caller is mid-sentence. Forcing a generation
                        # here would talk straight over them.
                        await task.queue_frames([LLMMessagesAppendFrame(messages=[{
                            "role": "user", "content":
                            f"[You were cut off after saying only: \"{_played}\" — the caller "
                            "did NOT hear the rest of your opening. Do not start over and do "
                            "not re-introduce yourself, but do finish the point you were "
                            "making before you move on.]"}])])
        else:
            diag.greet_path = "llm"
            logger.info("greet: LLM-generated opening (corr=%s)", corr)
            await task.queue_frames([LLMMessagesAppendFrame(
                messages=[{"role": "user", "content":
                           "[The call has just connected and the person is on the line. "
                           "Deliver your opening now, exactly as your instructions "
                           "specify — do not just say 'hello'.]"}],
                run_llm=True)])

    _bg_tasks: list = []

    @transport.event_handler("on_client_connected")
    async def _on_connected(_transport, _client):
        _bg_tasks.append(asyncio.create_task(_greet_when_ready()))

    @transport.event_handler("on_client_disconnected")
    async def _on_disconnected(_transport, _client):
        await task.cancel()

    async def watchdog():
        """1-second tick, SLIMMED for 1.4: spend cap, graceful-stop enforcement,
        end-grace, duck resume and unplayed confirmation. Idle/nudge/orphan/deaf
        machinery moved to the aggregator's turn events — their branches are
        disabled via the sentinel values below (the pure decision fn and its
        timeline harness stay authoritative for what remains)."""
        _OFF = 1e9
        cfg = WatchdogConfig(
            connected_at=outcome.connected_at,
            cap_secs=cap_secs,
            idle_timeout_secs=_OFF,                       # aggregator owns idle
            stall_recovery_enabled=False,                 # native TTS reconnect in 1.4
            graceful_stop_deadline_secs=_GRACEFUL_STOP_DEADLINE_SECS,
            stall_after_secs=settings.stall_after_secs,
            stall_max_recoveries=settings.stall_max_recoveries,
            stop_reissue_every_secs=settings.stop_reissue_every_secs,
            orphan_min_utterance_secs=settings.orphan_min_utterance_secs,
            orphan_window_secs=(settings.orphan_window_lo_secs,
                                settings.orphan_window_hi_secs),
            orphan_bot_quiet_secs=settings.orphan_bot_quiet_secs,
            # Re-enabled 2026-09-15 with the STT finalize retry in place: three
            # of 81 caller turns that day got no transcript at all, and in every
            # one the caller said "Hello?" 4-14 s later into silence. The window
            # opens at 3.5 s, past the retried final's p90 (2.26 s).
            orphan_connect_grace_secs=settings.orphan_connect_grace_secs,
            max_orphan_asks=2,
            orphan_transcript_lookback_secs=settings.orphan_transcript_lookback_secs,
            max_nudges=settings.max_nudges,
            no_words_timeout_secs=_OFF,                   # dead-air clock retired
            unplayed_confirm_secs=settings.unplayed_confirm_secs,
            end_grace_secs=settings.end_grace_secs,
            max_deaf_streak=settings.max_deaf_streak,
            duck_no_words_resume_secs=settings.duck_no_words_resume_secs,
            duck_max_hold_secs=settings.duck_max_hold_secs,
            llm_bridge_after_secs=(settings.llm_bridge_after_secs
                                   if settings.llm_bridge_after_secs > 0 and not bridge_freezes_tts
                                   else _OFF),
        )
        while True:
            await asyncio.sleep(1.0)
            now = time.time()
            if unplayed_confirmed(flags, now, cfg):
                flags["unplayed_pending_t"] = 0.0
                diag.bump("replies_never_played")
                logger.warning("reply never reached the caller corr=%s "
                               "(no audio %.1fs after it was cut)",
                               corr, cfg.unplayed_confirm_secs)
            _note_vendor_failover()
            _held = transcript.on_hold_for()
            # Before deciding: on hold, ORPHAN_ASK / LLM_BRIDGE are never decided,
            # so apply_decision cannot book them against the call's budget.
            flags["on_hold"] = _held > 0
            if not outcome.end_requested and transcript.looks_like_ivr_loop():
                # Nothing to say to a menu, and nobody to say goodbye to — the
                # voicemail hang-up, for a phone menu that keeps replaying.
                diag.idle_hangup = True
                logger.info("ivr: the phone menu is looping — hanging up corr=%s", corr)
                outcome.end_requested = True
                await _begin_stop()
                continue
            d = watchdog_decide(flags, now, cfg)
            apply_decision(flags, d, now)

            if (flags["user_started_t"] > flags["transcript_t"]
                    and 2.0 < now - flags["user_started_t"] < 3.05):
                # Orphan diagnostics, once per unheard turn (at ~2-3 s).
                logger.info("watchdog: no transcript %.1fs after onset — kind %s since stop %.1f "
                            "since voice %.1f since bot_stop %.1f asks %d",
                            now - flags["user_started_t"], d.kind,
                            now - flags["user_stopped_t"] if flags["user_stopped_t"] else -1.0,
                            now - flags["voice_tick_t"] if flags["voice_tick_t"] else -1.0,
                            now - flags["bot_stopped_t"], flags["orphan_asks"])
            if d.kind == NONE and _held:
                # HOLD_MAX_SECS is enforced HERE. pipecat's idle timer starts only
                # on BotStoppedSpeaking, which a silent bot never sends, and every
                # absorbed piece of a looping recording stamps transcript_t, so the
                # idle fallback below never fires either: a forgotten hold ran to
                # the duration cap (review of 53b6e16b04, 2026-10-14). Past the
                # limit, the usual escalation, paced one idle period apart:
                # _on_idle nudges max_nudges times, then says goodbye and stops.
                if hold_escalation_due(flags, now, _held, HOLD_MAX_SECS,
                                       settings.idle_timeout_secs):
                    logger.info("idle: on hold for %.0fs — past the %.0fs limit, escalating "
                                "corr=%s", _held, HOLD_MAX_SECS, corr)
                    flags["hold_nudge_t"] = now
                    await _on_idle(None)
                continue
            if d.kind == NONE:
                # Idle fallback for the turn pipecat's idle controller cannot see:
                # its timer starts on BotStoppedSpeaking while the caller is quiet,
                # so when the CALLER stopped last and got no reply — a pickup
                # "Hello" dropped as a machine-greeting scrap, a dedupe, a carrier
                # line — nothing ever arms it and the line sits silent for the rest
                # of the call (timing sim hello_then_silence, 2026-09-12; the
                # "Hello? … Hello?" callers in real transcripts). Same handler,
                # same budget; self-limiting because the nudge itself moves
                # bot_stopped_t past user_stopped_t.
                _last = max(flags["bot_stopped_t"], flags["user_stopped_t"], flags["transcript_t"])
                if (flags["user_stopped_t"] > flags["bot_stopped_t"] > 0
                        and not flags["bot_speaking"] and not flags["user_speaking"]
                        and flags["stopping_since"] is None and flags["ducked_since"] == 0
                        and not _reply_pending()
                        and now - _last >= settings.idle_timeout_secs):
                    logger.info("idle: caller spoke last and got no reply for %.1fs — "
                                "nudging from the watchdog corr=%s", now - _last, corr)
                    flags["bot_stopped_t"] = now        # one shot per silence, not one per tick
                    await _on_idle(None)
                    continue
                # The caller keeps making a sound but no word ever comes: a faint
                # "Hello?" every few seconds. Each one re-arms pipecat's idle
                # timer and is too short for the orphan re-ask (0.4 s — blips
                # must not trigger "say that again", call 3b5fb592), so the
                # line sat silent (call ddcba11f, 2026-10-24: five sounds of
                # 0.2 s over 16 s, then "Hello."). After the usual idle span,
                # two such sounds earn the presence check.
                _since = flags["bot_stopped_t"]
                if (_since > 0 and flags["transcript_t"] < _since
                        and not flags["bot_speaking"]
                        and flags["stopping_since"] is None and flags["ducked_since"] == 0
                        and not _reply_pending()
                        and transcript.wordless_onsets_since(_since) >= 2
                        and now - flags["voice_tick_t"] >= 1.5
                        and now - _since >= settings.idle_timeout_secs):
                    logger.info("idle: %d sounds and no words for %.1fs since the bot spoke — "
                                "nudging corr=%s", transcript.wordless_onsets_since(_since),
                                now - _since, corr)
                    flags["bot_stopped_t"] = now        # one shot per silence, not one per tick
                    await _on_idle(None)
                continue
            if d.kind == ARM_STOP:
                logger.info("sentinel: grace elapsed (%.1fs) — closing the line corr=%s",
                            d.detail, corr)
                sentinel._stop_armed = True
                await _begin_stop()
                continue
            if d.kind == CANCEL_STARVED:
                logger.warning("graceful stop starved — cancelling corr=%s", corr)
                await task.cancel()
                return
            if d.kind == REISSUE_STOP:
                await task.stop_when_done()
                continue
            if d.kind == DUCK_RESUME:
                diag.bump("duck_timeout_resumes")
                logger.info("duck: voiced but wordless for %.1fs — resuming reply corr=%s",
                            d.detail, corr)
                await duck.resume("watchdog_timeout")
                continue
            if d.kind == CAP_FAREWELL:
                diag.cap_farewell = True
                logger.info("max call duration reached corr=%s (%.0fs)", corr, cap_secs)
                outcome.end_requested = True
                await duck.resume("cap_farewell")
                await task.queue_frames([TTSSpeakFrame(cap_farewell)])
                await _begin_stop()
                continue
            if d.kind == LLM_BRIDGE:
                # Call c130e39f: 16s of silence while Vertex took 5.4s to the
                # first token and ~8s more to finish the reply. The caller said
                # "Hello?" three times into it. append_to_context=False: this is
                # cover for the line, not part of the conversation.
                diag.bump("llm_bridges")
                logger.info("llm bridge: reply composing %.1fs with no audio — saying %r "
                            "corr=%s", d.detail, bridge_line, corr)
                # From the sentinel, NOT task.queue_frames: a frame queued at
                # the source waits behind the LLM service, whose process_frame
                # is blocked for the whole generation — so the bridge could
                # only ever play AFTER the reply it was covering for (call
                # 28570ec0, 2026-09-15: "एक सेकंड।" 25 s late, after a 4-sentence
                # answer). Pushed here it reaches the TTS while the model is
                # still thinking, which is the only time it is worth saying.
                await sentinel.push_frame(TTSSpeakFrame(bridge_line, append_to_context=False))
                continue
            if d.kind == ORPHAN_ASK:
                # The caller audibly spoke (VAD), the STT returned nothing even
                # after the finalize retries, and the bot has been quiet since.
                # Admit it rather than sit in silence until they say "Hello?".
                # And if there is a second vendor, their repeat goes to it —
                # a vendor that returned nothing for an audible utterance has
                # failed this call (28570ec0: deaf for its last 70 s).
                await _stt_failover("no transcript for an audible utterance")
                diag.bump("orphan_reasks")
                logger.info("orphan: %.1fs since the caller stopped and no transcript — "
                            "asking them to say it again corr=%s", d.detail, corr)
                await task.queue_frames([TTSSpeakFrame(orphan_text, append_to_context=True)])
                continue
            # Retired branches (idle/stall/deaf) are disabled by config;
            # reaching one means the sentinel values above were changed — say so.
            logger.warning("watchdog: unexpected decision %s corr=%s", d.kind, corr)

    watchdog_task = asyncio.create_task(watchdog())
    try:
        runner = PipelineRunner(handle_sigint=False)
        logger.info("setup timing corr=%s pipeline_built=%.2fs (since run_bot entry)",
                    corr, time.time() - _run_bot_t0)
        await runner.run(task)
    finally:
        outcome.ended_at = time.time()
        # RECONCILE: which caller answers never reached the model? (Ground truth
        # for ANSWER_DELETED; join-aware — see diagnostics.reconcile_answers.)
        try:
            _delivered = [m.get("content") or "" for m in llm_context.get_messages()
                          if isinstance(m, dict) and m.get("role") == "user"]
            _lost = diag_mod.split_lost(transcript.answers_heard(), _delivered)
            diag.answers_deleted = _lost.answers
            diag.answers_deleted_samples = _lost.answer_samples
            # Sub-floor scraps are a measured loss but not a lost ANSWER, and
            # reporting them as one sent the founder hunting for an answer that
            # was never spoken (call c7bf5ff5, verbatim "वो।"). Carried, logged
            # at INFO, no fault — see diagnostics._lost_carries_meaning.
            diag.fragments_lost = _lost.fragments
            diag.fragments_lost_samples = _lost.fragment_samples
            if _lost.answers:
                logger.warning("diagnostics: %d caller answer(s) never reached the model "
                               "corr=%s %s", _lost.answers, corr,
                               _lost.answer_samples[:5])
            if _lost.fragments:
                logger.info("diagnostics: %d sub-word caller scrap(s) lost (no answer in "
                            "them, no fault) corr=%s %s", _lost.fragments, corr,
                            _lost.fragment_samples)
            try:
                # One line per call for sim.replay. journald cuts a line at
                # 48 KB — Devanagari is 3 bytes a character, so shrink the
                # replies until the JSON fits rather than ship a broken tail.
                _rec = dict(outcome.replay, agent=str(agent.get("id") or ""),
                            ended=round(time.time() - outcome.connected_at, 2))
                # 14 KB, not 40: docker's journald driver splits a log line at
                # 16 KB and the remainder never arrives, so call 1e374b99's
                # record came back as invalid JSON cut mid-character.
                _cap = 600
                while True:
                    _rec["replies"] = [[t, x[:_cap]] for t, x in _rec["replies"]]
                    _rec["runs"] = [[t, x[:max(60, _cap // 3)]] for t, x in _rec["runs"]]
                    _js = json.dumps(_rec, ensure_ascii=False, separators=(",", ":"))
                    if len(_js.encode("utf-8")) <= 14000 or _cap <= 40:
                        break
                    _cap //= 2
                if len(_js.encode("utf-8")) > 14000:
                    # Still too big (a very long call): drop the oldest turns
                    # rather than ship a truncated line.
                    while len(_js.encode("utf-8")) > 14000 and len(_rec["finals"]) > 4:
                        for k in ("finals", "vad", "bot", "runs", "replies"):
                            _rec[k] = _rec[k][len(_rec[k]) // 4:]
                        _rec["truncated"] = True
                        _js = json.dumps(_rec, ensure_ascii=False, separators=(",", ":"))
                logger.info("replay corr=%s %s", corr, _js)
            except Exception:
                logger.exception("replay record failed corr=%s", corr)
            # Did the caller hear the same sentence over and over? (REPLY_LOOP)
            diag.max_reply_restarts = diag_mod.max_reply_restarts(
                outcome.transcript, skip_like=_opening_for_cache)
            if diag.max_reply_restarts >= 2:
                logger.warning("diagnostics: bot restarted the same reply %dx in a row "
                               "corr=%s", diag.max_reply_restarts, corr)
        except Exception:
            logger.exception("diagnostics: answer reconciliation failed corr=%s", corr)
        for _t in [watchdog_task, *_bg_tasks]:
            _t.cancel()
            try:
                await _t
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("teardown: background task died corr=%s", corr)
        try:
            from .caller_gender import summarize as _gender_summary
            diag.caller_gender = _gender_summary(gender_probe.tracker.estimate(),
                                                 outcome.transcript)
            _g = diag.caller_gender
            logger.info("caller-gender corr=%s pitch=%s conf=%.2f median=%sHz voiced=%.1fs "
                        "words=%s (%s) agree=%s", corr, _g.get("gender"), _g.get("confidence") or 0,
                        _g.get("medianHz"), _g.get("voicedSecs") or 0, _g.get("words"),
                        _g.get("wordsEvidence"), _g.get("agree"))
        except Exception:
            logger.exception("caller-gender: summary failed corr=%s", corr)
        # Release this call's two ONNX models and their executor threads NOW,
        # by reference count. The pipeline itself is cyclic garbage that only a
        # full collection frees (app/memory.py does that ~3 s later); if any
        # transient holder still pins it then, these ~35 MB and 2 threads must
        # not ride along (pipecat never shuts these executors down).
        for _an, _attr in ((vad, "_model"), (smart_turn, "_session")):
            try:
                _ex = getattr(_an, "_executor", None)
                if _ex is not None:
                    _ex.shutdown(wait=False, cancel_futures=True)
                setattr(_an, _attr, None)
            except Exception:
                logger.exception("teardown: releasing %s failed corr=%s", type(_an).__name__, corr)
        # Best-effort SDK teardown (defensive getattr chain — harmless if the
        # 1.4 services shape differs; they own their sockets natively now).
        for _svc in (stt, tts):
            _sdk = getattr(_svc, "_sarvam_client", None) or getattr(_svc, "_client", None)
            _httpx = getattr(getattr(_sdk, "_client_wrapper", None), "httpx_client", None)
            _inner = getattr(_httpx, "httpx_client", _httpx)
            _close = getattr(_inner, "aclose", None)
            if _close is not None:
                try:
                    _res = _close()
                    if asyncio.iscoroutine(_res):
                        await _res
                except Exception:
                    pass

    return outcome
