"""Phase 2 of the simulator: TIMING. Runs the REAL pipeline — run_bot with its
gates, aggregator, VAD, Smart Turn, watchdog — on a simulated phone line, with
stub STT/LLM/TTS services that behave like vendors (latency, streaming) but cost
nothing. Real speech audio (sim/fixtures/caller_speech_8k.wav, one TTS render)
drives the VAD, so barge-in, ducking, held tails, resumes, nudges and closes all
happen the way they do on a call.

    docker compose exec voice-bot python -m sim.timing            # all scenarios
    python -m sim.timing --scenarios yes_over_tail,silent_caller --verbose

Each scenario scripts the caller (what, when — absolute or relative to the bot's
k-th utterance) and the model's replies, then asserts on what the LINE carried:
bot audio intervals, the played transcript, the diagnostics. Not covered:
STT accuracy (the stub transcribes perfectly), audio quality, vendor outages."""
from __future__ import annotations

import argparse
import logging
import asyncio
import json
import os
import sys
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import numpy as np

FIXTURE_DIR = Path(__file__).parent / "fixtures"
SR_LINE = 8000


# ── caller audio ────────────────────────────────────────────────────────────

def _load_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        assert w.getframerate() == SR_LINE and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


# Complete utterances (one TTS render each), so Smart Turn hears a natural
# ending: a clip cut mid-word made it hold EVERY caller turn open for the full
# 5 s stop-timeout. Picked by the Say text; anything else uses the long clip.
CLIPS = {k: _load_wav(FIXTURE_DIR / "caller" / f"caller_{k}_8k.wav")
         for k in ("yes_go_ahead", "yes", "hello", "haan", "cut_the_call", "good_morning", "long",
                   # A short answer, a 0.45 s breath, then a long sentence — the
                   # shape Smallest Pulse DROPPED on the founder's 2026-09-15 calls
                   # (VAD stop inside the breath → finalize → the rest never lands).
                   "pause_then_long", "haan_pause_long", "yga_pause_long")}
_CLIP_FOR = {"yes, go ahead.": "yes_go_ahead", "yes.": "yes", "hello.": "hello", "hello?": "hello",
             "haan.": "haan", "good morning.": "good_morning",
             "i don't need this. cut the call, thank you.": "cut_the_call"}


def clip_for(text: str, secs: float, clip: str | None = None) -> np.ndarray:
    key = clip or _CLIP_FOR.get(text.strip().lower())
    if key:
        return CLIPS[key]
    n = int(secs * SR_LINE)
    base = CLIPS["long"]
    if n > len(base):                       # a replayed 30 s answer: loop the voice
        base = np.tile(base, n // len(base) + 1)
    return base[:n]


@dataclass
class Say:
    """One caller utterance: text the stub STT will emit, how long the voice
    lasts on the line, and WHEN it starts."""
    text: str
    secs: float = 1.6                   # only for texts without a dedicated clip
    at: float | None = None            # absolute seconds from call start
    after_bot_start: int | None = None  # index (1-based) of bot utterance…
    after_bot_stop: int | None = None   # …and an offset from its start/stop
    offset: float = 0.0
    stt_latency: float = 0.55           # Sarvam final after the voice stops
    finals: List[str] | None = None     # split into several finals (fragments)
    clip: str | None = None             # CLIPS key, when the text has no clip of its own
    final_times: List[float] | None = None  # absolute seconds per final (replay); else after the voice
    # Seconds from this utterance's voice START per final — a final can land
    # mid-speech or after it, as Sarvam's do (live call 84e52d17: 'आप teachers
    # से कहें…' 1.5 s into the voice, 'बात करें।' 0.3 s later at its end).
    final_offsets: List[float] | None = None


@dataclass
class Scenario:
    key: str
    caller: List[Say]
    replies: List[str]                  # the model's replies, in order
    checks: Callable[[Dict[str, Any]], List[str]]
    max_secs: float = 60.0
    ttft: float = 0.45
    tts_ttfb: float = 0.35
    note: str = ""
    # Sentences pre-loaded into the speech cache under exactly the key run_bot's
    # install_tts_cache will look them up with, so the reply HITS the cache and
    # the cached-sentence path (own audio context, synchronous frames) runs for
    # real. Non-empty also keeps the agent's speech_cache_mode FULL.
    cache_warm: List[str] = field(default_factory=list)
    # "smallest": pipecat's REAL SmallestTTSService, built by production's
    # build_tts, talking to sim/smallest_fake.py's protocol-faithful socket
    # instead of SimTTS. The speech-cache scenarios need it — SimTTS yields its
    # audio synchronously, which is how a cache HIT works, not how Smallest does.
    engine: str = "sim"
    # Chance of a thinking filler ("Hmm…") on a turn. 0 by default so a gate
    # never flips a coin: production's 10% made a random scenario fail about
    # one deploy in several (a6252b5c57's gate: a filler before a reply read
    # as a hole inside it). Scenarios that exercise the filler set 1.0.
    # SIM_FILLER_PROBABILITY overrides every scenario, for a forced run.
    filler: float = 0.0
    # Needs the REAL STT (python -m sim.timing --real-stt): the check is about
    # what the vendor transcribes from the fixture audio, not the pipeline.
    # Skipped by "all" without the flag.
    real_stt: bool = False
    # Replay: pick the recorded reply for THIS run by its trigger text instead
    # of consuming replies in order (the fixed pipeline may run fewer times).
    reply_for: Callable[[str], str | None] | None = None
    # Agent context fixture (sim/fixtures/<name>); default = the English yoga agent.
    # Hindi-only behaviour (Devanagari fillers, "।"-terminated finals, the Hindi
    # presence check) never ran in the gate before 2026-09-29.
    context: str = ""
    # LLM WATERFALL, as production runs it (build_llm_waterfall: Vertex primary
    # + fallback in pipecat's ServiceSwitcher, failover strategy). llm_stalls[k]
    # is the PRIMARY's first-token delay on its k-th generation (None = ttft);
    # past the guard (vertex_first_token_timeout_secs, 3 s) it errors as the
    # guarded Vertex service does and the fallback answers in fallback_ttft.
    # Non-empty — or SIM_SLOW_PRIMARY_EVERY=N, for any scenario or replay —
    # builds the fallback. 13 failovers in 283 calls on 2026-10-01.
    llm_stalls: List[Optional[float]] = field(default_factory=list)
    fallback_ttft: float = 0.8
    # STT WATERFALL on vendor-faithful sockets (sim/stt_fake.py): production's
    # build_stt_waterfall — pipecat's real SarvamSTTService + SmallestSTTService
    # with our wrappers, in the ServiceSwitcher — talking to a local server that
    # transcribes only the caller audio it actually received. Non-empty = on;
    # the dict is the fault plan per vendor ({"sarvam": {"hang_on_audio": 1}}).
    # Call 3e327e8a (2026-10-02): a Sarvam socket that closed and hung.
    stt_fake: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    # Settings overridden for this scenario only (restored after it), e.g. a
    # kill switch: {"run_forming_hold": False}.
    settings: Dict[str, Any] = field(default_factory=dict)
    # Caller runs FORCED at fixed times — (absolute seconds, user text), each
    # pushed from the input transport as LLMMessagesAppendFrame(run_llm=True),
    # i.e. a caller turn reaching RunGuard exactly then. For races the audio
    # path stages only on some machines (review 2026-10-08: on the CI runner
    # Smart Turn never cut the first piece off, and the race did not happen).
    inject: List[Any] = field(default_factory=list)


# ── the simulated line ──────────────────────────────────────────────────────

class Line:
    """Shared clock + what the line carried. Bot audio intervals come from the
    output transport's paced writes; caller intervals from the feeder."""

    def __init__(self):
        self.t0 = time.perf_counter()
        self.bot: List[List[float]] = []       # [start, end] per utterance
        self.caller: List[List[float]] = []
        self.finals: List[tuple] = []          # (t, text)
        self.tts_texts: List[str] = []         # every sentence handed to the TTS
        self._last_bot_write = -10.0
        # sim/stt_fake.py: which caller utterance (1-based) each voiced 20 ms
        # chunk of line audio belongs to, how many there are, and its finals.
        self.chunk_owner: Dict[bytes, int] = {}
        self.say_chunks: Dict[int, int] = {}
        self.say_finals: Dict[int, List[str]] = {}
        self.stt_switches: List[tuple] = []    # (t, service) when the STT switcher moved
        self.injected: List[tuple] = []        # (t, text) of Scenario.inject runs

    def now(self) -> float:
        return time.perf_counter() - self.t0

    def bot_wrote(self, secs_of_audio: float):
        t = self.now()
        if t - self._last_bot_write > 0.35:
            self.bot.append([t, t + secs_of_audio])
        else:
            self.bot[-1][1] = max(self.bot[-1][1], t + secs_of_audio)
        self._last_bot_write = t

    def bot_cut(self):
        """An interruption reached the output: the queued audio is dropped, so
        the utterance ENDS here — and whatever plays next is a new one. Without
        this a cut and the line spoken right after it (a re-said opening, a
        resumed reply) merged into one stretch whose end even counted the
        dropped audio, and the replay invariants saw "no reply" to the turn
        that caused the cut (replay of 953d5366, 2026-10-01)."""
        t = self.now()
        if self.bot and self.bot[-1][1] > t:
            self.bot[-1][1] = max(self.bot[-1][0], t)
        self._last_bot_write = -10.0

    def bot_speaking(self) -> bool:
        return bool(self.bot) and self.now() < self.bot[-1][1]


def build(scenario: Scenario, line: Line, verbose: bool = False, real_stt: bool = False):
    from pipecat.frames.frames import (Frame, InputAudioRawFrame, InterruptionFrame, TTSSpeakFrame,
                                       LLMContextFrame, LLMFullResponseEndFrame,
                                       LLMFullResponseStartFrame, LLMTextFrame,
                                       OutputAudioRawFrame, StartFrame, TranscriptionFrame,
                                       TTSAudioRawFrame, TTSStartedFrame, TTSStoppedFrame)
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
    from pipecat.services.llm_service import LLMService
    from pipecat.services.tts_service import TTSService
    from pipecat.transports.base_input import BaseInputTransport
    from pipecat.transports.base_output import BaseOutputTransport
    from pipecat.transports.base_transport import BaseTransport, TransportParams

    log = (lambda *a: print(f"[{line.now():6.2f}s]", *a)) if verbose else (lambda *a: None)

    class SimSTT(FrameProcessor):
        """Passes everything through (the aggregator's VAD needs the audio) and
        emits scripted finals when the feeder tells it to."""
        async def process_frame(self, frame: Frame, direction: FrameDirection):
            await super().process_frame(frame, direction)
            await self.push_frame(frame, direction)

        async def emit(self, text: str):
            line.finals.append((line.now(), text))
            log("STT final:", repr(text))
            await self.push_frame(TranscriptionFrame(text=text, user_id="caller",
                                                     timestamp=str(time.time()), finalized=True),
                                  FrameDirection.DOWNSTREAM)

    class SimLLM(LLMService):
        def __init__(self, service: str = "primary", peer: "SimLLM | None" = None,
                     first_token: Callable[[int], float] | None = None, guard: float = 0.0):
            super().__init__()
            self.sim_service = service
            self._first_token = first_token or (lambda k: scenario.ttft)
            self._guard = guard               # the production first-token timeout; 0 = none
            self._n = 0                       # this service's generations so far
            self._gen = None
            # The two ends of a waterfall share ONE book: the scripted replies
            # are consumed in order whichever service answers, and the log
            # below holds every generation, tagged with the service that ran it.
            self._book = peer._book if peer is not None else {"i": 0, "runs": 0}
            # Last user message per run (cues included).
            self.prompts: List[str] = peer.prompts if peer is not None else []
            # The tail of the history each run SAW — (role, text) — so a check
            # can prove the model's own last reply is in it, whole and in order.
            self.contexts: List[list] = peer.contexts if peer is not None else []
            # One entry per generation: when it was REQUESTED (context frame),
            # STARTED, ENDED, whether an interruption killed it or the vendor
            # ERRORED, its service, trigger and reply. sim.replay's invariants
            # read it ("two replies for one moment", "the same reply twice",
            # cue storms).
            self.gens: List[Dict[str, Any]] = peer.gens if peer is not None else []

        # The production primary's retire (app/providers.py with_retire): run_bot
        # sets retire_on_error when a fallback exists. Retired synchronously when
        # the error is pushed; a request queued behind the failure is dropped
        # when it would start (pipecat would dequeue it then), never run.
        retire_on_error = False
        retired = False
        errored_t = 0.0
        on_retired_drop = None

        async def push_error_frame(self, error):
            self.errored_t = time.time()
            if self.retire_on_error and not getattr(error, "fatal", False):
                self.retired = True
            await super().push_error_frame(error)

        def _maybe_unretire(self, frame):
            from pipecat.frames.frames import ServiceSwitcherRequestMetadataFrame
            if (isinstance(frame, ServiceSwitcherRequestMetadataFrame)
                    and getattr(frame, "service", None) is self):
                self.retired = False

        @property
        def runs(self) -> int:
            return self._book["runs"]

        async def process_frame(self, frame: Frame, direction: FrameDirection):
            await super().process_frame(frame, direction)
            self._maybe_unretire(frame)
            if isinstance(frame, InterruptionFrame) and self._gen and not self._gen.done():
                # Like pipecat's own LLM services: an interruption kills the
                # running generation AND any request queued behind it.
                await self.cancel_task(self._gen)
                self._gen = None
            if isinstance(frame, LLMContextFrame):
                msgs = frame.context.get_messages()
                last_user = next((m.get("content") for m in reversed(msgs)
                                  if isinstance(m, dict) and m.get("role") == "user"), "")
                self.contexts.append([(m.get("role"), str(m.get("content") or ""))
                                      for m in msgs[-6:] if isinstance(m, dict)])
                # QUEUED, as in production: pipecat's OpenAI/Google services
                # await _process_context inline, so a second context waits for
                # the first reply to finish. Overlapping generations here
                # interleaved two replies' words — a failure production cannot
                # have, which hid the one it does (two replies back to back).
                entry = {"requested": round(line.now(), 2), "trigger": str(last_user)[:200],
                         "service": self.sim_service}
                self.gens.append(entry)
                prev = self._gen if (self._gen and not self._gen.done()) else None
                self._gen = self.create_task(self._queued(prev, str(last_user), entry))
                return
            await self.push_frame(frame, direction)

        async def _queued(self, prev, last_user: str, entry: Dict[str, Any]):
            try:
                if prev is not None:
                    try:
                        await prev
                    except asyncio.CancelledError:
                        pass
                if self.retired:
                    entry["dropped"] = round(line.now(), 2)
                    log(f"LLM ({self.sim_service}) retired — dropping {last_user[:40]!r}")
                    if self.on_retired_drop is not None:
                        self.on_retired_drop()
                    return
                entry["started"] = round(line.now(), 2)
                await self._generate(last_user, entry)
                entry["ended"] = round(line.now(), 2)
            except asyncio.CancelledError:
                entry["cancelled"] = round(line.now(), 2)
                if prev is not None and not prev.done():
                    prev.cancel()
                raise

        async def _generate(self, last_user: str, entry: Dict[str, Any] | None = None):
            self._book["runs"] += 1
            self.prompts.append(last_user)
            first_token = self._first_token(self._n)
            self._n += 1
            if self._guard and first_token > self._guard:
                await self._time_out(last_user, entry)
                return
            # A steering cue ("[…]") from the gates counts as a turn too: the
            # scripted replies are consumed in order, whatever prompted them.
            text = None
            if scenario.reply_for is not None:
                text = scenario.reply_for(last_user)
            if text is None:
                i = self._book["i"]
                text = scenario.replies[i] if i < len(scenario.replies) else "Okay."
                self._book["i"] = i + 1
            if entry is not None:
                entry["reply"] = text[:300]
            log(f"LLM run {self.runs} ({self.sim_service}) for {last_user[:40]!r} → {text[:60]!r}")
            await self.push_frame(LLMFullResponseStartFrame())
            await asyncio.sleep(first_token)
            for w in (text.split(" ") if text else []):     # "" = an EMPTY reply (Gemini out=0)
                await self.push_frame(LLMTextFrame(w + " "))
                await asyncio.sleep(0.025)
            await self.push_frame(LLMFullResponseEndFrame())

        async def _time_out(self, last_user: str, entry: Dict[str, Any] | None):
            """The guarded production service whose first token never comes:
            app/providers.py's _FirstChunkGuard raises TimeoutError inside
            pipecat's GoogleLLMService._process_context, which has already
            pushed Start; its `except Exception` turns that into push_error —
            a NON-fatal ErrorFrame upstream with processor=self, what the
            failover strategy and run_bot's on_pipeline_error key on — and its
            `finally` pushes End. No text, and no scripted reply consumed."""
            log(f"LLM run {self.runs} ({self.sim_service}) for {last_user[:40]!r} → "
                f"no first token within {self._guard:.1f}s")
            await self.push_frame(LLMFullResponseStartFrame())
            await asyncio.sleep(self._guard)
            try:
                raise TimeoutError(f"LLM first token not received within {self._guard:.1f}s")
            except TimeoutError as e:
                if entry is not None:
                    entry["errored"] = round(line.now(), 2)
                await self.push_error(error_msg=f"Unknown error occurred: {e}", exception=e)
            await self.push_frame(LLMFullResponseEndFrame())

    class SimTTS(TTSService):
        """Vendor-shaped: TTFB, then audio streamed faster than realtime. Voiced
        synthetic signal (not the caller clip) so an echo path can never
        confuse the two."""
        def __init__(self):
            # Turn-level audio context (pipecat default): this is what every
            # agent whose speech cache is OFF runs in production. With the cache
            # on (Aarushi 2, FULL) Smallest gets one context per sentence and text
            # reaches the played-transcript recorder per sentence instead —
            # a difference the "Yes over the question" scenario is sensitive to.
            # Same base flags as pipecat's SmallestTTSService: it pushes
            # TTSStarted/TTSStopped itself (the bot-speaking flag, the sentinel's
            # utterance bracket and the played-transcript recorder all key on
            # them) and pauses frame processing while a sentence renders. One
            # audio context per sentence as the speech cache configures it.
            # push_text_frames=False like Smallest (word_timestamps=True): the
            # TTSTextFrames come from word timings, not from the base class
            # after run_tts. The speech cache's hit path keys on this flag.
            super().__init__(sample_rate=24000, push_start_frame=True, push_stop_frames=True,
                             pause_frame_processing=True, reuse_context_id_within_turn=False,
                             push_text_frames=False)
            self.model_name = "sim-tts"

        async def run_tts(self, text: str, context_id: str):
            log(f"TTS run_tts {text[:40]!r}")
            line.tts_texts.append(text)
            words = max(1, len(text.split()))
            secs = max(0.5, words / 2.8)
            await asyncio.sleep(scenario.tts_ttfb)
            n = int(24000 * secs)
            t = np.arange(n) / 24000.0
            f0 = 190 + 25 * np.sin(2 * np.pi * 1.7 * t)
            sig = np.sin(2 * np.pi * np.cumsum(f0) / 24000.0) * 9000
            pcm = sig.astype(np.int16).tobytes()
            step = 24000 * 2 // 50                     # 20 ms
            yield TTSStartedFrame(context_id=context_id)
            for i in range(0, len(pcm), step):
                yield TTSAudioRawFrame(pcm[i:i + step], 24000, 1, context_id=context_id)
            # Word timings, as Smallest reports them: pipecat turns these into
            # the TTSTextFrames the played-transcript recorder keys on.
            per = secs / words
            await self.add_word_timestamps(
                [(w, i * per) for i, w in enumerate(text.split())], context_id)
            yield TTSStoppedFrame(context_id=context_id)

    class SimInput(BaseInputTransport):
        def __init__(self, params, feeder):
            super().__init__(params)
            self._feeder = feeder

        async def start(self, frame: StartFrame):
            await super().start(frame)
            await self.set_transport_ready(frame)
            self._feed_task = self.create_task(self._feeder(self))

        async def _end_feed(self):
            # The feeder outlived the call and pinned its whole pipeline, which
            # hid the production leak (an un-awaited cancel_task in ambience)
            # from the sim's own end-of-run leak check.
            task, self._feed_task = getattr(self, "_feed_task", None), None
            if task is not None:
                await self.cancel_task(task)

        async def stop(self, frame):
            await super().stop(frame)
            await self._end_feed()

        async def cancel(self, frame):
            await super().cancel(frame)
            await self._end_feed()

    class SimOutput(BaseOutputTransport):
        interruptions = 0
        interruption_times: List[float] = []

        async def process_frame(self, frame: Frame, direction: FrameDirection):
            if isinstance(frame, InterruptionFrame):
                self.interruptions += 1
                self.interruption_times = self.interruption_times + [round(line.now(), 2)]
                line.bot_cut()
                log("OUTPUT interruption → dropping queued bot audio")
            n = type(frame).__name__
            if n in ("TTSStartedFrame", "TTSStoppedFrame", "BotStartedSpeakingFrame",
                     "BotStoppedSpeakingFrame", "UserStartedSpeakingFrame", "UserStoppedSpeakingFrame"):
                log(f"OUTPUT sees {n} ({'down' if direction == FrameDirection.DOWNSTREAM else 'up'})")
            await super().process_frame(frame, direction)

        async def start(self, frame: StartFrame):
            await super().start(frame)
            await self.set_transport_ready(frame)

        _pace_t = 0.0

        async def write_audio_frame(self, frame: OutputAudioRawFrame) -> bool:
            # Plivo consumes audio in real time and the FastAPI transport paces
            # its writes to match; the base class does not. Without this the whole
            # reply "plays" in a few ms and every timing below is fiction.
            secs = len(frame.audio) / 2 / frame.sample_rate
            now = time.perf_counter()
            if self._pace_t < now - 0.5:
                self._pace_t = now
            await asyncio.sleep(max(0.0, self._pace_t - now))
            line.bot_wrote(secs)
            self._pace_t += secs
            return True

    class SimTransport(BaseTransport):
        def __init__(self, feeder):
            super().__init__()
            params = TransportParams(audio_in_enabled=True, audio_in_sample_rate=SR_LINE,
                                     audio_out_enabled=True, audio_out_sample_rate=SR_LINE,
                                     audio_in_stream_on_start=True)
            self._in = SimInput(params, feeder)
            self._out = SimOutput(params)
            self._register_event_handler("on_client_connected")
            self._register_event_handler("on_client_disconnected")

        def input(self):
            return self._in

        def output(self):
            return self._out

        async def connected(self):
            await self._call_event_handler("on_client_connected", None)

    if real_stt:
        # The production STT (STT_PROVIDER from the env), fed the fixture audio
        # at line rate. Its finals are tapped here so the report and the checks
        # see exactly what the pipeline saw.
        from pipecat.frames.frames import InterimTranscriptionFrame
        from app.providers import build_stt_waterfall
        stt, _stt_primary, _stt_fallback = build_stt_waterfall(SR_LINE)
        if os.environ.get("SIM_DEAF_PRIMARY") and _stt_fallback is not None:
            # A primary that hears nothing — the shape of Smallest's last 70 s
            # on call 28570ec0 — in front of the real fallback, so the orphan
            # re-ask → manual failover path runs for real.
            from pipecat.pipeline.service_switcher import (ServiceSwitcher,
                                                           ServiceSwitcherStrategyFailover)
            from pipecat.services.stt_service import STTService

            class DeafSTT(STTService):
                async def run_stt(self, audio: bytes):
                    if False:
                        yield None
            _stt_primary = DeafSTT(sample_rate=SR_LINE)
            stt = ServiceSwitcher([_stt_primary, _stt_fallback],
                                  strategy_type=ServiceSwitcherStrategyFailover)
        # Tap the finals where they leave the service(s), not the switcher
        # (a ParallelPipeline's push_frame is not the services' push_frame).
        _tap_targets = [t for t in (_stt_primary, _stt_fallback) if t is not None]
        _orig_push = None

        for _svc in _tap_targets:
            def _mk(svc):
                orig = svc.push_frame

                async def _tap(frame, direction=FrameDirection.DOWNSTREAM):
                    if (isinstance(frame, TranscriptionFrame)
                            and not isinstance(frame, InterimTranscriptionFrame) and frame.text.strip()):
                        line.finals.append((line.now(), frame.text.strip()))
                        log(f"STT final ({type(svc).__name__}):", repr(frame.text.strip()))
                    await orig(frame, direction)
                return _tap
            _svc.push_frame = _mk(_svc)
    elif scenario.stt_fake:
        # Production's own waterfall, pointed at sim/stt_fake.py's sockets.
        from pipecat.frames.frames import InterimTranscriptionFrame
        from app.config import get_settings as _gs
        from app.providers import build_stt_waterfall
        from sim.stt_fake import point_at
        _s = _gs()
        _saved = {k: getattr(_s, k) for k in ("stt_provider", "stt_fallback_provider",
                                               "sarvam_api_key", "smallest_api_key")}
        try:
            object.__setattr__(_s, "stt_provider", "sarvam")
            object.__setattr__(_s, "stt_fallback_provider", "smallest")
            for k in ("sarvam_api_key", "smallest_api_key"):
                if not getattr(_s, k):
                    object.__setattr__(_s, k, "sim-not-a-key")
            stt, _stt_primary, _stt_fallback = build_stt_waterfall(SR_LINE, language="hi-IN")
        finally:
            for k, v in _saved.items():
                object.__setattr__(_s, k, v)
        point_at(line.stt_server, _stt_primary, _stt_fallback)
        strategy = getattr(stt, "strategy", None)
        if strategy is not None:
            @strategy.event_handler("on_service_switched")
            async def _switched(_strategy, service):
                line.stt_switches.append((round(line.now(), 2), type(service).__name__))
                log(f"STT switched to {type(service).__name__}")
        for _svc in (_stt_primary, _stt_fallback):
            def _mk(svc):
                orig = svc.push_frame

                async def _tap(frame, direction=FrameDirection.DOWNSTREAM):
                    if (isinstance(frame, TranscriptionFrame)
                            and not isinstance(frame, InterimTranscriptionFrame) and frame.text.strip()):
                        line.finals.append((line.now(), frame.text.strip()))
                        line.vendor_finals.append((round(line.now(), 2), type(svc).__name__,
                                                   frame.text.strip()))
                        log(f"STT final ({type(svc).__name__}):", repr(frame.text.strip()))
                    await orig(frame, direction)
                return _tap
            _svc.push_frame = _mk(_svc)
    else:
        stt = SimSTT()
    # The LLM waterfall. SIM_SLOW_PRIMARY_EVERY=N stalls every N-th primary
    # generation SIM_SLOW_PRIMARY_SECS (4 s) — a variant any scenario, replay or
    # corpus run takes from the environment.
    slow_every = int(os.environ.get("SIM_SLOW_PRIMARY_EVERY") or 0)
    slow_secs = float(os.environ.get("SIM_SLOW_PRIMARY_SECS") or 4.0)

    def _primary_first_token(k: int) -> float:
        if slow_every > 0 and (k + 1) % slow_every == 0:
            return slow_secs
        stall = scenario.llm_stalls[k] if k < len(scenario.llm_stalls) else None
        return scenario.ttft if stall is None else stall
    if scenario.llm_stalls or slow_every > 0:
        from app.config import get_settings as _gs
        # The guards production puts on each end (app/providers.py build_llm):
        # Vertex with a fallback fails fast; the OpenAI-compatible fallback has
        # the general first-token timeout.
        llm = SimLLM("primary", first_token=_primary_first_token,
                     guard=_gs().vertex_first_token_timeout_secs)
        llm_fallback = SimLLM("fallback", peer=llm, first_token=lambda k: scenario.fallback_ttft,
                              guard=_gs().llm_first_token_timeout_secs)
    else:
        llm, llm_fallback = SimLLM(), None
    if scenario.engine == "smallest":
        from sim.smallest_fake import patch_smallest_service
        os.environ.setdefault("SMALLEST_API_KEY", "sim-not-a-key")
        from app.config import get_settings as _gs
        # Settings may already exist (an earlier scenario built it) and is
        # frozen — without a key build_tts silently falls back to Sarvam.
        if not _gs().smallest_api_key:
            object.__setattr__(_gs(), "smallest_api_key", "sim-not-a-key")
        line.smallest_sockets = []
        patch_smallest_service(line.smallest_sockets)
        from app.providers import build_tts
        tts = build_tts(24000, voice="mrunal", tts_model="smallest_pro", pace=1.05,
                        language="hi")
        _orig_run_tts = tts.run_tts

        async def _logged_run_tts(text, context_id=None, _o=_orig_run_tts):
            log(f"TTS run_tts {text[:40]!r}")
            line.tts_texts.append(text)
            async for f in _o(text, context_id):
                yield f
        tts.run_tts = _logged_run_tts
    elif scenario.engine == "navana":
        from sim.navana_fake import patch_navana_service
        from app.config import get_settings as _gs
        if not _gs().navana_api_key:
            object.__setattr__(_gs(), "navana_api_key", "sim-not-a-key")
        line.navana_sockets = []
        patch_navana_service(line.navana_sockets)
        from app.providers import build_tts
        tts = build_tts(24000, voice="ipsita", tts_model="navana", language="english")
        _orig_nv = tts.run_tts

        async def _logged_nv(text, context_id=None, _o=_orig_nv):
            log(f"TTS run_tts {text[:40]!r}")
            line.tts_texts.append(text)
            async for f in _o(text, context_id):
                yield f
        tts.run_tts = _logged_nv
    else:
        tts = SimTTS()
    pending: List[Say] = list(scenario.caller)

    async def feeder(inp: SimInput):
        """Streams the line in 20 ms frames of silence or fixture speech, in real
        time, and fires each Say when its trigger is met."""
        await transport.connected()
        if scenario.inject:
            from pipecat.frames.frames import LLMMessagesAppendFrame as _Append

            async def _injector():
                for at, text in scenario.inject:
                    await asyncio.sleep(max(0.0, at - line.now()))
                    line.injected.append((round(line.now(), 2), text))
                    log("INJECTED caller run:", repr(text))
                    await inp.push_frame(_Append(messages=[{"role": "user", "content": text}],
                                                 run_llm=True), FrameDirection.DOWNSTREAM)
            inp.create_task(_injector())
        frame_n = SR_LINE // 50
        silence = np.zeros(frame_n, dtype=np.int16).tobytes()
        speaking: Optional[Say] = None
        pos = 0; spoken_frames = 0; total_frames = 0
        next_t = time.perf_counter()
        while True:
            # trigger check
            if speaking is None:
                for s in list(pending):
                    due = False
                    if s.at is not None:
                        due = line.now() >= s.at
                    elif s.after_bot_start is not None and len(line.bot) >= s.after_bot_start:
                        due = line.now() >= line.bot[s.after_bot_start - 1][0] + s.offset
                    elif s.after_bot_stop is not None and len(line.bot) >= s.after_bot_stop:
                        iv = line.bot[s.after_bot_stop - 1]
                        due = (not (line.bot_speaking() and line.bot[-1] is iv)) and line.now() >= iv[1] + s.offset
                    if due:
                        pending.remove(s); speaking = s; pos = 0; spoken_frames = 0
                        clip = clip_for(s.text, s.secs, s.clip)
                        total_frames = len(clip) // frame_n
                        if scenario.stt_fake:
                            k = scenario.caller.index(s) + 1
                            # Clips without a fixture of their own are cuts of the SAME
                            # long recording: a k-LSB offset (inaudible, VAD-neutral)
                            # makes each utterance's chunks its own.
                            clip = np.clip(clip.astype(np.int32) + k, -32768, 32767).astype(np.int16)
                            line.say_finals[k] = list(s.finals or [s.text])
                            n = 0
                            for i in range(total_frames):
                                ch = clip[i * frame_n:(i + 1) * frame_n]
                                if len(ch) == frame_n and int(np.abs(ch).max()) > 600:
                                    line.chunk_owner.setdefault(ch.tobytes(), k)
                                    n += 1
                            line.say_chunks[k] = max(1, n)
                        line.caller.append([line.now(), line.now() + total_frames / 50])
                        log("CALLER starts:", repr(s.text), f"({total_frames / 50:.2f}s)")
                        break
            if speaking is not None:
                chunk = clip[pos:pos + frame_n]
                if len(chunk) < frame_n:
                    chunk = np.pad(chunk, (0, frame_n - len(chunk)))
                pos += frame_n; spoken_frames += 1
                await inp.push_audio_frame(InputAudioRawFrame(chunk.tobytes(), SR_LINE, 1))
                if (speaking is not None and spoken_frames == 1
                        and (speaking.final_times or speaking.final_offsets)
                        and not real_stt):
                    # Replay: finals land at their RECORDED times, mid-speech or
                    # after it, independent of the voice clip.
                    s = speaking
                    times = (s.final_times if s.final_times
                             else [line.now() + o for o in s.final_offsets])

                    async def _emit_at(s=s, times=times):
                        t_prev = line.now()
                        for k, f in enumerate(s.finals or []):
                            at = times[k] if k < len(times) else t_prev + 0.5
                            await asyncio.sleep(max(0.0, at - line.now()))
                            t_prev = line.now()
                            if f:
                                await stt.emit(f)
                    inp.create_task(_emit_at())
                if spoken_frames >= total_frames:
                    s = speaking; speaking = None
                    if real_stt or s.final_times or s.final_offsets or scenario.stt_fake:
                        continue                    # the vendor / the record decides what was said
                    finals = s.finals or [s.text]

                    async def _emit(finals=finals, lat=s.stt_latency):
                        await asyncio.sleep(lat)
                        for k, f in enumerate(finals):
                            if f:                       # "" = the STT returned nothing
                                await stt.emit(f)
                            if k + 1 < len(finals):
                                await asyncio.sleep(0.5)
                    inp.create_task(_emit())
            else:
                await inp.push_audio_frame(InputAudioRawFrame(silence, SR_LINE, 1))
            next_t += 0.02
            await asyncio.sleep(max(0.0, next_t - time.perf_counter()))

    transport = SimTransport(feeder)
    out = {"stt": stt, "llm": llm, "tts": tts}
    if llm_fallback is not None:
        out["llm_fallback"] = llm_fallback
    if real_stt or scenario.stt_fake:
        out["stt_primary"], out["stt_fallback"] = _stt_primary, _stt_fallback
    return transport, out


def _warm_cache(tts, agent: Dict[str, Any], lines: List[str]) -> None:
    """Store `lines` in the speech cache the way a previous call would have,
    keyed exactly as run_bot's install_tts_cache keys a lookup for this tts
    service and agent (engine_of, _agent_voice, pace, temperature)."""
    from app import ttscache
    from app.bot import _agent_voice, _as_float
    from app.providers import engine_of
    engine, model = engine_of(tts)
    from app.speech_language import smallest_language_code
    render_language = (smallest_language_code(agent.get("language"))
                       if engine.lower() == "smallest" else "")
    if engine.lower() == "navana":
        from app.providers import navana_language
        render_language = navana_language(agent.get("language"))
    cache = ttscache.get_cache()
    cache.open()
    for text in lines:
        norm = text.strip()
        key = ttscache.cache_key(engine=engine.lower(), model=model,
                                 voice=_agent_voice(agent) or "",
                                 pace=_as_float(agent.get("pace")),
                                 temperature=_as_float(agent.get("temperature")),
                                 sample_rate=ttscache.SAMPLE_RATE, term_map_version="",
                                 text=norm, language=render_language)
        cand = ttscache.Candidate(key=key, text=norm, chars=len(norm), engine=engine.lower(),
                                  model=model, voice=_agent_voice(agent) or "",
                                  pace=_as_float(agent.get("pace")),
                                  temperature=_as_float(agent.get("temperature")), fixed=True)
        cache.ladder([cand])
        # ~60 ms per character of voiced 8 kHz tone: inside plausible_duration.
        n = int(ttscache.SAMPLE_RATE * 0.06 * len(norm))
        t = np.arange(n) / ttscache.SAMPLE_RATE
        pcm = (np.sin(2 * np.pi * 210 * t) * 9000).astype(np.int16).tobytes()
        ok = cache.store(cand, pcm)
        if not ok:
            raise RuntimeError(f"cache warm refused {norm!r}")


async def run_scenario(scenario: Scenario, ctx: Dict[str, Any], verbose: bool = False,
                       real_stt: bool = False) -> Dict[str, Any]:
    from app import bot as b
    ctx = json.loads(json.dumps(ctx))
    ctx["agent"]["speech_cache_mode"] = "FULL" if scenario.cache_warm else "OFF"
    ctx["agent"]["voiceModulation"] = 1.0
    ctx["corr"] = f"sim-{scenario.key}"
    from app.config import get_settings as _gs
    # A fresh, empty speech cache per scenario. One shared cache let a
    # sentence rendered in an earlier scenario (the background sweeper warms
    # what it saw) change the timing of a later one: the filler scenario
    # passed alone and failed in the full run.
    import tempfile
    from app import ttscache as _tc
    _tc._CACHE = _tc.SpeechCache(root=tempfile.mkdtemp(prefix=f"sim-cache-{scenario.key}-"))
    _tc._CACHE.open()
    _p = os.environ.get("SIM_FILLER_PROBABILITY")
    object.__setattr__(_gs(), "filler_probability",
                       float(_p) if _p not in (None, "") else scenario.filler)
    _saved_settings = {k: getattr(_gs(), k) for k in scenario.settings}
    for k, v in scenario.settings.items():
        object.__setattr__(_gs(), k, v)
    try:
        return await _run_scenario(scenario, ctx, verbose, real_stt)
    finally:
        for k, v in _saved_settings.items():
            object.__setattr__(_gs(), k, v)


async def _run_scenario(scenario: Scenario, ctx: Dict[str, Any], verbose: bool,
                        real_stt: bool) -> Dict[str, Any]:
    from app import bot as b
    line = Line()
    line.vendor_finals = []
    line.stt_server = None
    if scenario.stt_fake:
        from sim.stt_fake import FakeSTTServer
        line.stt_server = FakeSTTServer(
            line, scenario.stt_fake,
            log=(lambda *a: print(f"[{line.now():6.2f}s]", *a)) if verbose else None)
        await line.stt_server.start()
    transport, providers = build(scenario, line, verbose, real_stt)
    if scenario.cache_warm:
        _warm_cache(providers["tts"], ctx["agent"], scenario.cache_warm)
    outcome = b.CallOutcome(corr=ctx["corr"], context=ctx)
    try:
        await asyncio.wait_for(b.run_bot(transport, ctx["corr"], ctx, outcome,
                                         aiohttp_session=None, providers=providers),
                               timeout=scenario.max_secs)
        ended_at = line.now()
    except asyncio.TimeoutError:
        ended_at = None
    finally:
        if line.stt_server is not None:
            await line.stt_server.close()
    d = outcome.diagnostics
    res = {
        "key": scenario.key,
        "bot": [[round(a, 2), round(b_, 2)] for a, b_ in line.bot],
        "caller": [[round(a, 2), round(b_, 2)] for a, b_ in line.caller],
        "finals": [(round(t, 2), x) for t, x in line.finals],
        "tts_texts": list(line.tts_texts),
        "transcript": outcome.transcript,
        "ended_at": None if ended_at is None else round(ended_at, 2),
        "interruptions_at_output": transport.output().interruptions,
        "interruption_times": list(getattr(transport.output(), "interruption_times", [])),
        "llm_runs": providers["llm"].runs,
        "llm_gens": list(getattr(providers["llm"], "gens", [])),
        "contexts": providers["llm"].contexts,
        "llm_prompts": providers["llm"].prompts,
        "nudges": getattr(d, "nudges", 0) or 0,
        "replies_scripted": list(scenario.replies),
        "stt_failovers": getattr(d, "stt_failovers", 0) or 0,
        "llm_failovers": getattr(d, "llm_failovers", 0) or 0,
        "llm_returns": getattr(d, "llm_returns", 0) or 0,
        "orphan_reasks": getattr(d, "orphan_reasks", 0) or 0,
        "opening_resaid": getattr(d, "opening_resaid", 0) or 0,
        "end_forced": getattr(outcome, "end_forced", False),
        "floor_holds": getattr(d, "floor_holds", 0) or 0,
        "floor_holds_dropped": getattr(d, "floor_holds_dropped", 0) or 0,
        "repeats_suppressed": getattr(d, "repeats_suppressed", 0) or 0,
        "unsaid_reverted": getattr(d, "unsaid_reverted", 0) or 0,
        "stt_stalls": getattr(d, "stt_stalls", 0) or 0,
        "runs_superseded": getattr(d, "runs_superseded", 0) or 0,
        "injected": list(line.injected),
        "short_answer_forming_waits": getattr(d, "short_answer_forming_waits", 0) or 0,
        "stt_switches": list(line.stt_switches),
        "stt_vendor_finals": list(line.vendor_finals),
        "stt_conns": [{"vendor": c["vendor"], "hung_at": c["hung_at"],
                       "audio_secs": round(c["audio_secs"], 2), "flushes": c["flushes"]}
                      for c in (line.stt_server.conns if line.stt_server is not None else [])],
    }
    # turn latency: caller stop → next bot audio start
    lat = []
    for _, cend in line.caller:
        nxt = [s for s, _ in line.bot if s >= cend]
        if nxt:
            lat.append(round(nxt[0] - cend, 2))
    res["turn_latency"] = lat
    res["fails"] = scenario.checks(res)
    return res


# ── scenarios ───────────────────────────────────────────────────────────────

OPEN_ANSWER = "Yes, go ahead."
PITCH_Q = ("So the reason I called — we work with yoga teachers on everything around their online "
           "classes. The daily link, the reminders, the fees. Who's doing the daily running around "
           "right now? Is that you, or does someone help?")


def _after_word(text: str, word: str, ttfb: float = 0.35) -> float:
    """Seconds after the bot utterance starts at which `word` has finished
    playing under SimTTS's pacing (words / 2.8 per second, first audio after
    ttfb)."""
    words = text.split()
    i = words.index(word)
    per = max(0.5, len(words) / 2.8) / len(words)
    return round(ttfb + (i + 1) * per + 0.15, 2)


def _assistant_texts(res):
    return [t["text"] for t in res["transcript"] if t["role"] == "assistant"]


# ── call 22062aac (2026-09-29): a Hindi father answering in pieces ──────────
HI_Q_CLASS = "जी सर। बच्चा अभी किस class में पढ़ रहा है?"
HI_Q_EFFORT = "यही वो साल है जब syllabus heavy लगने लगता है। क्या बच्चा पढ़ाई में मेहनत करता है?"
HI_EXPECT = "आमतौर पर parents की तीन-चार expectations होती हैं। पहली, faculty अच्छे हों और concepts clear करें।"


# ── call 1f2b97ab (2026-10-01): "अभी time नहीं है madam" over the CACHED opening ─
# The cached opening is one 13 s blob whose text reaches the played transcript
# only when it ends. Cut at 10 s, it read as "barely heard": the opening started
# again from "नमस्ते जी", twice, and the caller hung up at 15 s.
HI_OPENING = json.loads((FIXTURE_DIR / "hindi_parent_agent_context.json")
                        .read_text(encoding="utf-8"))["agent"]["openingLine"]
HI_BUSY = "अभी time नहीं है madam."
HI_BUSY_REPLY = "जी, कोई बात नहीं। मैं आपको किस समय call करूँ?"


def chk_busy_over_cached_opening(res):
    f = []
    if res["opening_resaid"]:
        f.append(f"the opening was said again ({res['opening_resaid']}x) over 'busy'")
    if not any("किस समय call" in t for t in _assistant_texts(res)):
        f.append("the busy caller never got an answer")
    cut = next((c for c in res["caller"]), None)
    if cut:
        again = [iv for iv in res["bot"] if iv[0] >= cut[1] and iv[1] - iv[0] > 7.0]
        if again:
            f.append(f"a {again[0][1] - again[0][0]:.1f}s utterance after 'busy' — the opening again")
    return f


# ── call 8208166f (2026-10-01, replayed on the live build): a real barge-in
#    cut the opening and it was re-said; then an ABSORBED "हाँ।" during the
#    re-said opening queued ANOTHER copy — the cut check compared against the
#    ORIGINAL greet time, so the first cut justified every later re-say. The
#    father's "fifth class…" waited 26 s behind two more openings. ──────────
HI_FATHER = "जी, मैं उसका पिता बोल रहा हूँ।"
HI_WHO = "जी, क्या मैं बच्चे के माता-पिता में से किसी से बात कर रही हूँ?"


def _resaid_opening_reply(last_user: str) -> str:
    """The father's answer gets the class question; the earlier swallowed
    "करतो करतो। हाँ।" turn (answered once the re-said opening is over) gets
    the who-am-I-speaking-to question; a cue gets a fresh line, never a stub
    "Okay." (a bare ack would start a next-step cascade of its own)."""
    u = last_user or ""
    if "पिता" in u:
        return HI_Q_CLASS
    if u.startswith("["):
        return "जी सर, बच्चे के बारे में थोड़ा बताइए — अभी किस class में है?"
    return HI_WHO


def chk_absorbed_ack_does_not_resay_again(res):
    f = []
    if res["opening_resaid"] != 1:
        f.append(f"opening re-said {res['opening_resaid']}x (expected once, for the real cut)")
    two_q = [t for t in _assistant_texts(res)
             if sum(1 for q in ("किससे बात कर रही", "किसी से बात कर रही", "किस class") if q in t) >= 2]
    if two_q:
        f.append(f"two questions back to back after the re-said opening: {two_q[0][-90:]!r}")
    said = " ".join(_assistant_texts(res))
    if said.count("श्रेया") > 1 and res["opening_resaid"] > 1:
        f.append("the caller heard the introduction more than twice")
    if "किस class" not in " ".join(_after_user(res, "पिता")):
        f.append("the father's answer never got the next question")
    gaps = [t for t, x in res["finals"] if "पिता" in x]
    if gaps:
        nxt = [bs for bs, _ in res["bot"] if bs > gaps[0]]
        if not nxt or nxt[0] - gaps[0] > 4.0:
            f.append(f"reply to the father came {round(nxt[0] - gaps[0], 1) if nxt else 'never'}s after his answer")
    return f


def chk_hello_over_cached_opening(res):
    """A pickup "Hello." over the cached opening is a backchannel in voice
    mode: the opening plays on to its end — heard ONCE, never restarted, and
    no model reply on top of it — and the caller's answer gets the next step."""
    f = []
    intros = sum(1 for t in _assistant_texts(res) if "श्रेया" in t)
    if intros != 1:
        f.append(f"the introduction was heard {intros}x (expected once)")
    if res["opening_resaid"]:
        f.append(f"the opening was said again ({res['opening_resaid']}x) over a pickup hello")
    if not any("किस class" in t for t in _after_user(res, "पिता")):
        f.append("the father's answer never got the next question")
    return f


# ── call 34452119 (2026-10-02, Shreya on Navana, speech cache FULL): a REPLY
#    sentence served from the cache as one 13.2 s clip; the mother cut in at
#    63 % of it. A cached clip's text reached the played transcript only when
#    the clip ENDED, so NoRepeatGate un-recorded the sentence as never played
#    and the model's next reply said all of it again. A LIVE Navana sentence
#    counts as heard once 60 % of its audio has played; a cached one must too. ─
# The sentence as the cache served it: NoRepeatGate's echo trim had already
# dropped the reply's "नमस्ते मैम," opener ("un-recording never-played
# 'shiksha nation में हमारा focus…'").
HI_FOCUS = ("Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है — हम हर "
            "बच्चे के concepts पूरी तरह clear करवाते हैं, हर हफ्ते उसका test लेते हैं और "
            "उसका progress आपके साथ WhatsApp पर share करते हैं।")
HI_MOTHER = "जी, मैं उसकी मम्मी बोल रही हूँ।"
HI_FEES_ASK = "अच्छा, पर इसकी fees कितनी है?"
HI_FEES_REPLY = "Fees के बारे में मैं अभी बताती हूँ — बच्चा अभी किस class में है?"
# _warm_cache renders 60 ms of audio per character.
HI_FOCUS_SECS = 0.06 * len(HI_FOCUS.strip())
_FOCUS_KEY = "Shiksha Nation में हमारा focus"


def _cut_cached_reply(key: str, share: float, heard: bool) -> "Scenario":
    # The caller's VOICE starts `share` of the way into the clip; the bot audio
    # stops ~1.0 s later (VAD onset ~0.3 s, then the turn-gate's 0.7 s of talk
    # over the reply): 0.55 stops it at ~63 % of the 12 s clip, as on the call;
    # 0.22 at ~30 %.
    return Scenario(
        key,
        caller=[Say(HI_MOTHER, 1.4, after_bot_stop=1, offset=0.6),
                Say(HI_FEES_ASK, 1.6, after_bot_start=2, offset=round(share * HI_FOCUS_SECS, 2),
                    stt_latency=0.5)],
        # The model's answer to the cut repeats the cut sentence first — what
        # 34452119's model did — then the fees answer.
        replies=[HI_FOCUS, HI_FOCUS + " " + HI_FEES_REPLY, "जी।"],
        context="hindi_parent_agent_context.json", engine="navana",
        cache_warm=[HI_FOCUS],
        checks=lambda r: chk_cut_cached_reply(r, heard=heard), max_secs=55,
        note=("call 34452119: cut at 63 % of a 13 s cached reply sentence; it was said again in full"
              if heard else "cut at 30 % of a cached reply sentence: not heard, so re-saying it is right"))


def chk_cut_cached_reply(res, heard: bool):
    f = []
    if len(res["caller"]) < 2:
        return ["caller turns missing"]
    cut_start = res["caller"][1][0]
    # The first delivery: the bot stretch the caller's voice started inside.
    first = next((iv for iv in res["bot"] if iv[0] <= cut_start <= iv[1] + 0.3), None)
    if first is None:
        return [f"the caller's cut at {cut_start:.2f}s fell outside any bot audio — scenario shape off"]
    played = (first[1] - first[0]) / HI_FOCUS_SECS
    print(f"NOTE {res['key']}: first delivery played {first[1] - first[0]:.2f}s of "
          f"{HI_FOCUS_SECS:.2f}s ({played:.0%}); repeats_suppressed={res['repeats_suppressed']} "
          f"unsaid_reverted={res['unsaid_reverted']}")
    if heard and not 0.6 <= played <= 0.8:
        f.append(f"scenario shape off: the first delivery played {played:.0%} (want 60-80 %)")
    if not heard and not 0.15 <= played <= 0.5:
        f.append(f"scenario shape off: the first delivery played {played:.0%} (want 15-50 %)")
    # The played transcript, split at the caller's cut-in turn.
    tr = res["transcript"]
    i_cut = next((i for i, t in enumerate(tr) if t["role"] == "user" and "fees" in t["text"]), None)
    if i_cut is None:
        return f + ["the caller's fees question never reached the transcript"]
    before = " ".join(t["text"] for t in tr[:i_cut] if t["role"] == "assistant")
    after = " ".join(t["text"] for t in tr[i_cut:] if t["role"] == "assistant")
    n = (before + " " + after).count(_FOCUS_KEY)
    # Said twice on the LINE: any bot stretch after the cut long enough to be
    # the clip again.
    again = [iv for iv in res["bot"] if iv[0] > first[1] and iv[1] - iv[0] > 0.7 * HI_FOCUS_SECS]
    if heard:
        if _FOCUS_KEY not in before:
            f.append("the sentence the caller heard 60 %+ of is not in the played transcript — "
                     "it counts as never said")
        if n != 1:
            f.append(f"the sentence is in the played transcript {n}x (want once)")
        if again:
            f.append(f"the sentence was said again after the cut: a {again[0][1] - again[0][0]:.1f}s "
                     f"stretch at {again[0][0]:.1f}s")
        if res["repeats_suppressed"] < 1:
            f.append("the model's repeat of the heard sentence was not dropped as already said")
        for ctx in res.get("contexts", [])[1:2]:
            if _FOCUS_KEY not in json.dumps(ctx, ensure_ascii=False):
                f.append("the heard sentence is missing from the model's context at the next run")
    else:
        if _FOCUS_KEY in before:
            f.append("a sentence cut at ~30 % counts as heard — it can never be said again")
        if _FOCUS_KEY not in after:
            f.append("the sentence the caller barely heard was not said again")
        if n != 1:
            f.append(f"the sentence is in the played transcript {n}x (want once, from the re-say)")
    if "किस class" not in after:
        f.append("the answer to the fees question never played")
    return f


def _hindi_pieces_reply(last_user: str) -> str:
    """Gemini's behaviour on the real call: a bare "जी।"/"जी सर।" to every piece
    and to the SOFT next-step cue; it moved on only when told firmly."""
    u = last_user or ""
    if u.startswith("["):
        return HI_EXPECT if "ONE new question" in u else "जी सर।"
    if "पिताजी" in u:
        return HI_Q_CLASS
    if "नौवीं" in u:
        return HI_Q_EFFORT
    if "कोशिश" in u:
        return "जी सर।"
    return "जी।"


def chk_hindi_pieces_bare_acks(res):
    f = []
    texts = _assistant_texts(res)
    joined = " ".join(texts)
    presence = [i for i, t in enumerate(texts) if "सुन पा रहे" in t or "sun paa" in t]
    moved_on = [i for i, t in enumerate(texts) if "expectations" in t]
    if not moved_on:
        f.append("the bot never moved on after the pieces — only acknowledgments")
    if presence and (not moved_on or presence[0] < moved_on[0]):
        f.append("asked 'are you there?' while the bot owed the next line")
    acks = 0
    for t in _after_user(res, "कोशिश"):
        if "expectations" in t:
            break
        acks += sum(1 for x in t.replace("।", "।\n").splitlines()
                    if x.strip() in ("जी।", "जी सर।"))
    if acks > 2:
        f.append(f"{acks} bare acknowledgments after the pieces")
    if "Kya aap" in joined:
        f.append("romanised presence check on a Hindi agent")
    return f


def _after_user(res, needle):
    seen = False; out = []
    for t in res["transcript"]:
        if t["role"] == "user" and needle.lower() in t["text"].lower():
            seen = True
        elif seen and t["role"] == "assistant":
            out.append(t["text"])
    return out


def chk_yes_over_tail(res):
    f = []
    # The caller's "Yes." is the second caller interval. Bot audio must stop
    # for it and must NOT resume the held tail: the next bot audio has to be
    # the new reply (STT final + LLM + TTS ≈ 1 s after the caller stops), not
    # a resume (<0.6 s).
    if len(res["caller"]) >= 2:
        yes_start, yes_end = res["caller"][1]
        nxt = [s for s, _ in res["bot"] if s > yes_start + 0.3]
        if nxt and nxt[0] - yes_end < 0.8:
            f.append(f"held question tail resumed {nxt[0] - yes_end:.2f}s after the caller's 'Yes.'")
    if not any("ANSWER" in p for p in res.get("llm_prompts", [])[1:]):
        f.append("'Yes.' after the question was not cued as its answer (got: %s)"
                 % [p[:40] for p in res.get("llm_prompts", [])[1:]])
    if not any("on you" in t for t in _after_user(res, "Yes.")):
        f.append("no answer-reply followed the caller's 'Yes.'")
    return f


def chk_farewell(res):
    f = []
    if res["ended_at"] is None:
        f.append("call did not end after the farewell")
    if res["nudges"]:
        f.append(f"nudged {res['nudges']}x after the farewell")
    if res["ended_at"] and res["bot"] and res["ended_at"] - res["bot"][-1][1] > 5.0:
        f.append(f"line stayed open {res['ended_at'] - res['bot'][-1][1]:.1f}s after the goodbye")
    return f


def chk_backchannel(res):
    """Founder 2026-09-17 (call 1e374b99): "हम्म" / "ठीक है" over a reply left a
    1.7-5.9 s hole, an acknowledgement, and a sentence missing its opening
    words. The reply must resume with the SAME words, fast, no generation."""
    f = []
    texts = " ".join(_assistant_texts(res))
    if "on its own" not in texts:
        f.append("reply did not complete after the backchannel")
    if res["llm_runs"] > 2:
        f.append(f"backchannel triggered a new LLM run (runs={res['llm_runs']})")
    # Every word of the interrupted reply reaches the caller.
    reply = (res.get("replies_scripted") or [""])[0]
    for phrase in ("daily running around", "goes out to everyone on WhatsApp",
                   "Are your classes online at the moment?"):
        if phrase and phrase not in texts:
            f.append(f"words lost across the backchannel: {phrase!r} never played")
    # NOTE: this simulator cannot cut the bot with a backchannel — its
    # aggregator keeps the first caller turn open, so a second short burst
    # never broadcasts an interruption. The cut-and-resume path (call
    # 1e374b99) is covered by the unit tests and by sim.replay's
    # "resumed after a backchannel" invariant, which runs on real calls.
    return f


# ── single-flight review (2026-10-01): an EMPTY model reply (Gemini out=0, call
#    963347ab) must get the next line at once — the one-door cue gate first
#    dropped that recovery as "a reply is already on its way" (the empty reply
#    itself) and the caller sat through ~8 s of silence and "are you there?" ──
def chk_empty_reply_gets_the_next_line(res):
    f = []
    if not res["caller"]:
        return ["caller turn missing"]
    cend = res["caller"][0][1]
    nxt = [bs for bs, _ in res["bot"] if bs > cend]
    if not nxt or nxt[0] - cend > 4.5:
        f.append(f"after an empty reply the next line came {round(nxt[0] - cend, 1) if nxt else 'never'}s "
                 "after the caller stopped (bar 4.5 s)")
    if not any(PITCH_Q[:30] in t for t in _assistant_texts(res)):
        f.append("the next line never played")
    if res["nudges"] and nxt and nxt[0] - cend > 4.5:
        f.append("the caller got 'are you there?' instead of the next line")
    return f


def chk_silent(res):
    f = []
    if res["nudges"] < 1:
        f.append("no nudge for a silent caller")
    if res["ended_at"] is None:
        f.append("silent call never ended")
    if res["bot"] and len(res["bot"]) >= 2 and res["bot"][1][0] - res["bot"][0][1] > 13:
        f.append(f"first nudge {res['bot'][1][0] - res['bot'][0][1]:.1f}s after the opening (expected ~8s)")
    return f


def chk_hello_cuts_opening(res):
    f = []
    intros = sum(1 for t in _assistant_texts(res) if "Aarushi from Vacademy" in t)
    if intros == 0:
        f.append("caller never heard the introduction")
    if intros > 2:
        f.append(f"introduction played {intros}x")
    return f


def chk_forced_close(res):
    f = []
    if not res["end_forced"]:
        f.append("'cut the call' did not force the close")
    if res["ended_at"] is None:
        f.append("call did not end after 'cut the call'")
    after = _after_user(res, "cut the call")
    if any("?" in t for t in after):
        f.append("bot asked a question after 'cut the call'")
    return f


def chk_turn_latency(res, bar: float = 2.5):
    slow = [x for x in res["turn_latency"] if x > bar]
    return [f"turn latency {slow} s (caller stop → bot audio, bar {bar})"] if slow else []


def chk_fragment_tail(res):
    """Call 31763255 (2026-09-12): Smallest split "…say somet" / "hing" and
    "? It makes" / "some". The second fragment must not kill the reply
    generated for the first: one LLM run, the reply plays in full, and no
    interruption reaches the output after the caller's turn."""
    f = []
    if len(res["caller"]) < 2:
        return ["caller turns missing"]
    cend = res["caller"][1][1]
    if res["llm_runs"] != 2:
        f.append(f"expected 2 LLM runs (opening answer + one reply), got {res['llm_runs']}")
    ivs = [iv for iv in res["bot"] if cend <= iv[0] < cend + 12.0]
    total = sum(b - a for a, b in ivs)
    if total < 4.0:
        f.append(f"reply audio only {total:.1f}s after the fragmented turn — it was cut")
    texts = " ".join(_assistant_texts(res))
    if "It makes sense" not in texts:
        f.append("the reply to the fragmented turn never played in full")
    if res["interruptions_at_output"] > 3:      # opening cut + VAD onset + first fragment formalised; the tail must add none
        f.append(f"{res['interruptions_at_output']} interruptions at the output — a fragment barged in")
    return f


def chk_pieces_with_gaps(res):
    """Call 358e5026 (2026-09-23): a parent speaking in pieces got a reply to
    every piece, each started while the NEXT piece was already under way and
    cut 0.7 s later — "आप मुझे एक समय बता" / "मैं समझ" / "मैं समझ गई". No
    reply may start while the caller is talking, no stub may reach the line,
    and the pieces still get one full answer."""
    f = []
    if len(res["caller"]) < 3:
        return ["caller turns missing"]
    p1 = res["caller"][1]
    p2 = res["caller"][2]
    for a, b_ in res["bot"]:
        if a < p1[0]:
            continue
        if any(ca + 0.05 < a < cb for ca, cb in res["caller"]):
            f.append(f"bot audio started at {a:.2f}s while the caller was talking")
        if b_ - a < 1.0 and a < p2[1] + 6.0:
            f.append(f"a {b_ - a:.2f}s stub of a reply reached the line at {a:.2f}s")
    # One answer to both pieces, played in full (its sentences are separate
    # intervals on the line).
    after = [iv for iv in res["bot"] if p2[1] <= iv[0] < p2[1] + 8.0]
    if not after:
        f.append("the pieces never got an answer")
    elif sum(b_ - a for a, b_ in after) < 3.0:
        f.append("the answer to the pieces was cut short")
    if "Three girls" not in " ".join(_assistant_texts(res)):
        f.append("the answer to both pieces never played")
    return f


# ONE reply for a turn spoken in pieces (live calls 84e52d17, b51093dc,
# 0ae77e88, e11cc15b, 2026-10-06..08). A short first piece ("Yes.", a complete
# utterance to Smart Turn) is held for its grace; the rest follows 0.35 s
# later, 1.8 s of voice whose finals land 1.5 s and 1.8 s in. Smart Turn calls
# the rest INCOMPLETE, so it sits in the user aggregator until its 1.5 s stop
# — while the held run, seeing a context that had been still for 0.5 s, went
# ahead on "Yes." alone. The turn's own run followed ~0.55 s later and the LLM
# queued it behind the first: the caller heard an answer to "Yes." and then
# the answer to the whole turn, back to back.
PIECES_HALF = "Great, so you handle it all yourself. How many classes do you take a week?"
PIECES_FULL = ("Got it — you, and your sister on the WhatsApp reminders. "
               "How many classes do you take a week?")
PIECES_CALLER = [
    Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
    Say("Yes.", after_bot_stop=2, offset=0.8, stt_latency=0.3),
    Say("and my sister sends the WhatsApp reminders.", 1.8, after_bot_stop=2, offset=1.56,
        finals=["and my sister sends the", "WhatsApp reminders."], final_offsets=[1.5, 1.8]),
]


def _pieces_reply(last_user: str) -> str:
    u = (last_user or "").casefold()
    if "go ahead" in u:
        return PITCH_Q
    if "sister" in u or "whatsapp" in u:
        return PIECES_FULL
    if u.strip(" .") == "yes":
        return PIECES_HALF
    return "Understood. And how many students join each class?"


def chk_pieces_one_reply(res):
    """The pieces get ONE reply, to all of them: the answer to the first piece
    alone never reaches the line, no two runs compose for one moment, and the
    answer to the whole turn plays without a pause longer than a normal turn."""
    f = []
    if len(res["caller"]) < 3:
        return ["caller turns missing"]
    p1, p2 = res["caller"][1], res["caller"][2]
    texts = " ".join(_assistant_texts(res)).casefold()
    if "all yourself" in texts:
        f.append("the answer to the first piece alone reached the line")
    if "your sister" not in texts:
        f.append("the answer to the whole turn never played")
    gens = [g for g in res.get("llm_gens") or [] if g["requested"] >= p1[0]
            and g.get("dropped") is None]
    live = [g for g in gens if g.get("cancelled") is None and g.get("errored") is None]
    if len(live) != 1:
        f.append(f"{len(live)} replies composed for the turn (want 1): "
                 + "; ".join(f"{g['requested']:.2f}s {g.get('trigger', '')[:24]!r}" for g in live))
    elif "sister" not in (live[0].get("trigger") or ""):
        f.append(f"the one reply answered {live[0].get('trigger', '')[:32]!r}, not the whole turn")
    after = [a for a, _ in res["bot"] if a >= p2[1] - 0.2]
    if not after:
        f.append("nothing played after the pieces")
    elif after[0] - p2[1] > 3.5:
        f.append(f"the reply started {after[0] - p2[1]:.2f}s after they stopped (bar 3.5 s)")
    return f


def chk_pieces_one_reply_superseded(res):
    """The same, with the forming test blind (RUN_FORMING_HOLD=0 — the shape
    of production's race, where the rest sat in the aggregator's queue where no
    check can see it): the stale run goes through, and the turn's own run must
    cancel it before a sound of it plays."""
    f = chk_pieces_one_reply(res)
    stale = [g for g in res.get("llm_gens") or []
             if (g.get("trigger") or "").strip(" .").casefold() == "yes"]
    if not stale:
        # The outcome is judged above; the race itself did not happen (the CI
        # runner, 2026-10-08: Smart Turn kept "Yes." in the turn, one run).
        f.append("SHAPE: no run went for the first piece alone — the race this scenario "
                 "stages did not happen here (pieces_supersede_forced forces it)")
    elif not res.get("runs_superseded"):
        f.append("a run for the first piece alone went and was not superseded")
    return f


# The same races FORCED: caller runs injected at RunGuard 0.3-0.4 s apart,
# while the previous run is still composing (first token 0.8 s) — the shape of
# live call 84e52d17 (runs of 10 and 12 caller words 0.55 s apart), on every
# machine. Each newer run must cancel the one before it; only the reply to
# all the pieces may reach the line.
FORCED_CALLER = [Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)]
# Distinct words of their own: a reply that echoed the caller's would lose its
# first sentence to the no-echo trimmer and hide from the check.
FORCED_ONE = "Marigold classes start at nine every morning. Anything else?"
FORCED_TWO = "Sunflower batches run on weekends at the studio. Could you tell me more?"
FORCED_ALL = "Lotus is our evening programme for working parents. What time suits you for a demo?"


def _forced_reply(last_user: str) -> str:
    u = (last_user or "").casefold()
    if "go ahead" in u:
        return PITCH_Q
    if "piece three" in u or "closes the whole turn" in u:
        return FORCED_ALL
    if "piece two" in u:
        return FORCED_TWO
    if "piece one" in u:
        return FORCED_ONE
    return "Understood. And how many students join each class?"


def chk_forced_supersede(pieces: int):
    def chk(res):
        f = []
        if len(res.get("injected") or []) != pieces:
            return [f"injected {len(res.get('injected') or [])} runs (want {pieces})"]
        t0 = res["injected"][0][0]
        texts = " ".join(_assistant_texts(res)).casefold()
        final = FORCED_ALL if pieces == 3 else FORCED_TWO
        for stale in ([FORCED_ONE, FORCED_TWO] if pieces == 3 else [FORCED_ONE]):
            if stale.split()[0].casefold() in texts:
                f.append(f"a superseded reply reached the line: {stale[:32]!r}")
        if final.split()[0].casefold() not in texts:
            f.append(f"the reply to all {pieces} pieces never played")
        gens = [g for g in res.get("llm_gens") or [] if g["requested"] >= t0 - 0.05]
        live = [g for g in gens if g.get("cancelled") is None and g.get("errored") is None]
        if len(live) != 1:
            f.append(f"{len(live)} replies composed for the pieces (want 1): "
                     + "; ".join(f"{g['requested']:.2f}s {g.get('trigger', '')[:28]!r}"
                                 for g in live))
        if res.get("runs_superseded") != pieces - 1:
            f.append(f"runs superseded: {res.get('runs_superseded')} (want {pieces - 1})")
        last = res["injected"][-1][0]
        after = [a for a, _ in res["bot"] if a >= last]
        if not after:
            f.append("nothing played after the last piece")
        elif after[0] - last > 2.5:
            f.append(f"the reply started {after[0] - last:.2f}s after the last piece (bar 2.5)")
        return f
    return chk


NV_HELD = "Got it, eighth class. And how were her marks last year?"


def chk_navana_held_reply_is_not_heard(res):
    """Calls 18b63b17 / 45749163 (2026-09-30), Navana: a reply that FloorGate
    held (the parent was still talking) and then dropped was already in the
    played transcript and the model's context — its text reached them before
    its audio. The bot then refused to say it again as "already said". Same
    shape as pieces_with_gaps, on Navana's real service with the cache on."""
    f = chk_pieces_with_gaps(res)
    if res.get("floor_holds_dropped", 0) < 1:
        # The runner's timing never produced the hold+drop this is about; the
        # unit tests in tests/test_navana.py cover the ordering deterministically.
        print(f"NOTE navana_held_reply_is_not_heard: no floor drop this run "
              f"(holds={res.get('floor_holds')}) — ordering covered by unit tests")
        return f
    said = " ".join(_assistant_texts(res))
    if "eighth class" in said:
        f.append("the dropped reply counts as said: " + said[:160])
    for ctx in res.get("contexts", [])[1:]:
        blob = json.dumps(ctx, ensure_ascii=False)
        if "Got it, eighth class" in blob:
            f.append("the dropped reply is in the model's context as said")
            break
    return f


NV_Q2 = "Got it, eighth class. And how were her marks last year?"
NV_Q2_Q = "And how were her marks last year?"


def chk_nv_answer_over_tail(res):
    """Review of 2cfb1cff29: the parent answers ("Ninety percent.") over the
    last part of a Navana question. Holding the text to the sentence's END made
    the question count as never heard: it was re-asked and left the model's
    context. Heard 60 %+ = said: sent to the TTS once, and in the next run's
    context as the bot's own line."""
    f = []
    asked = [t for t in res.get("tts_texts", []) if "marks last year" in t]
    if len(asked) > 1:
        f.append(f"the marks question was sent to the TTS {len(asked)}x: {asked}")
    ctxs = res.get("contexts", [])
    if len(ctxs) >= 2 and "marks last year" not in json.dumps(ctxs[1], ensure_ascii=False):
        f.append("the question the parent answered is missing from the model's context")
    return f


def _nv_tail_scenario(key: str, cache: bool) -> "Scenario":
    return Scenario(
        key,
        caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                Say("Ninety percent.", 0.9, after_bot_start=2,
                    # 2.4 s: the answer lands while the question is ~60-80 % played
                    # (calibrated: 2.2 and 2.6 fail on the last-chunk rule and pass
                    # on the 60 % split; at 1.6 the question is barely heard and
                    # re-asking it is right).
                    offset=float(os.environ.get("NV_TAIL_OFFSET", "2.4")), stt_latency=0.4)],
        replies=[NV_Q2, NV_Q2_Q, "Okay, ninety percent, that's good.", "Okay."],
        checks=chk_nv_answer_over_tail, max_secs=40,
        cache_warm=([S_CACHED_TAIL] if cache else []), engine="navana",
        context="navana_agent_context.json",
        note="review of 2cfb1cff29: the parent answers over the tail of a Navana question")


LONG_ANSWER = ("Yes, I take classes in the evening, mostly at the studio near my house, "
               "and a few students come to my home on weekends")
_LONG_KEYS = ("classes", "evening", "studio", "students", "weekends")


def chk_stt_waterfall(res):
    """Primary STT deaf, fallback real: the first turn produces nothing → one
    "say it again" → the STT fails over → the caller's next turn is heard by
    the fallback and answered. Founder 2026-09-15: "have waterfall if sarvam
    fails to smallest"."""
    f = []
    if res.get("stt_failovers", 0) != 1:
        f.append(f"stt_failovers = {res.get('stt_failovers')} (want 1)")
    if res.get("orphan_reasks", 0) < 1:
        f.append("never asked the caller to repeat the unheard turn")
    texts = " ".join(_assistant_texts(res)).lower()
    heard = " ".join(x for _, x in res.get("finals", [])).lower()
    if not any(k in heard for k in _LONG_KEYS):
        f.append(f"the fallback never transcribed the second turn: finals {res.get('finals')!r}")
    prompts = [p for p in res.get("llm_prompts", []) if any(k in p.lower() for k in _LONG_KEYS)]
    if not prompts:
        f.append("the model never received the answer heard by the fallback")
    return f


def chk_breath_then_long(res):
    """A short answer, a breath, then the real answer — all one caller turn.
    Founder's 2026-09-15 calls: the VAD stopped inside the breath, Smallest
    finalized on the short part and the long part NEVER arrived (5 sightings).
    The vendor must deliver the long part, promptly, and the bot must answer
    it — not the short part, and not with a "say it again"."""
    f = []
    if len(res["caller"]) < 2:
        return ["caller turns missing"]
    cstart, cend = res["caller"][1]
    finals = [(t, x) for t, x in res["finals"] if t >= cstart]
    heard = " ".join(x for _, x in finals).lower()
    got = [k for k in _LONG_KEYS if k in heard]
    if len(got) < 4:
        f.append(f"the long part was dropped: finals after the turn {finals!r}")
    else:
        t_long = next(t for t, x in finals if sum(k in x.lower() for k in _LONG_KEYS) >= 2)
        if t_long - cend > 1.5:
            f.append(f"long part transcribed {t_long - cend:.2f}s after the caller stopped")
    texts = " ".join(_assistant_texts(res)).lower()
    if "say it again" in texts or "didn't catch" in texts:
        f.append("asked the caller to repeat a turn that was audible and transcribable")
    prompts = [p for p in res.get("llm_prompts", []) if any(k in p.lower() for k in _LONG_KEYS)]
    if not prompts:
        f.append("the model never received the long answer")
    replies = [iv for iv in res["bot"] if iv[0] >= cend]
    if not replies:
        f.append("no bot audio after the caller's answer")
    elif replies[0][0] - cend > 3.0:
        f.append(f"reply started {replies[0][0] - cend:.2f}s after the caller stopped")
    # One generation for the whole turn. A run on the short part alone (or on a
    # mid-sentence fragment) is the bot answering before the caller finished.
    if res.get("llm_runs", 0) > 2:
        f.append(f"{res['llm_runs']} generations — answered a partial turn (short part or fragment) "
                 f"before the caller finished: {[p[:40] for p in res.get('llm_prompts', [])[1:]]}")
    if any(iv[0] < cend - 0.3 for iv in res["bot"] if iv[0] > cstart + 0.5):
        f.append("bot audio started while the caller was still talking")
    return f


def chk_unheard_turn(res):
    """The caller spoke, the STT returned nothing (3 of 81 turns on 2026-09-15).
    Within ~7 s the bot must ask them to say it again — not sit silent until
    the 8 s nudge or the caller's own "Hello?"."""
    f = []
    if len(res["caller"]) < 2:
        return ["caller turns missing"]
    cend = res["caller"][1][1]
    texts = " ".join(_assistant_texts(res)).lower()
    if "say it again" not in texts and "didn't catch" not in texts:
        f.append("never asked the caller to repeat an unheard turn")
    asks = [iv for iv in res["bot"] if cend + 3.0 <= iv[0] <= cend + 7.5]
    if not asks:
        f.append(f"no bot audio 3-7.5 s after the unheard turn (bot: {res['bot']})")
    return f


def chk_screener_then_person(res):
    """Call 196838de (2026-09-15): Google call screen answered, our opening
    played into its recorder, the father picked up with a substantive line —
    and 2 min later his "Hello?" replayed the whole opening. The opening is
    said exactly twice (screener, then the person), never again; a mid-call
    "Hello?" gets a short confirm + the question, within 3 s."""
    f = []
    texts = _assistant_texts(res)
    if not texts:
        return ["bot said nothing"]
    head = _key(" ".join(texts[0].split()[:4]))
    n = sum(1 for t in texts if head and head in _key(t))
    if n < 2:
        f.append(f"the person who picked up after the screener never heard the opening ({n} openings)")
    if n > 2:
        f.append(f"opening said {n}x — replayed after the person was already talking")
    if len(res["caller"]) < 4:
        return f + ["caller turns missing"]
    hello_end = res["caller"][3][1]
    nxt = [iv for iv in res["bot"] if hello_end - 0.5 <= iv[0] <= hello_end + 3.0]
    if not nxt:
        f.append(f"no reply within 3 s of the mid-call Hello? (bot: {res['bot'][-3:]})")
    return f


def _key(text: str) -> str:
    from app.turntake import spoken_key
    return spoken_key(text)


def chk_voicemail(res):
    """Call 24089872: the carrier's recording spoke, nobody else did. No nudge,
    no farewell — hang up as soon as the idle clock fires."""
    f = []
    if res["nudges"]:
        f.append(f"nudged {res['nudges']}x a voicemail")
    if res["ended_at"] is None or res["ended_at"] > 25.0:   # idle clock 8 s + end grace, after a ~6 s announcement
        f.append(f"call still open at {res['ended_at']}s — should hang up on the first idle tick")
    texts = " ".join(_assistant_texts(res))
    if "lost you" in texts or "still there" in texts:
        f.append("spoke a nudge/farewell to the machine")
    return f


def chk_cached_opener(res):
    """Call 994162b0 (2026-09-12): 'Thank you.' from the cache, then 3.6 s of
    nothing before the pitch. A cached sentence's own audio context only closed
    on pipecat's 3 s idle timeout, and the next sentence waited behind it."""
    f = []
    if not res["caller"]:
        return ["caller never spoke"]
    cend = res["caller"][0][1]
    # The reply only; the idle nudge ~8 s after it is a different scenario.
    ivs = [iv for iv in res["bot"] if cend <= iv[0] < cend + 12.0]
    if not ivs:
        return ["no bot audio after the caller's answer"]
    gaps = [round(b - a, 2) for (_, a), (b, _) in zip(ivs, ivs[1:])]
    if any(g > 1.0 for g in gaps):
        f.append(f"silence inside the reply: gaps {gaps} s between bot audio intervals")
    if ivs[0][0] - cend > 2.5:
        f.append(f"reply started {ivs[0][0] - cend:.2f}s after the caller stopped")
    total = sum(b - a for a, b in ivs)
    if total < 5.0:
        f.append(f"reply audio only {total:.1f}s — a sentence was lost")
    texts = " ".join(_assistant_texts(res))
    for s in ("Thank you", "daily link"):
        if s not in texts:
            f.append(f"{s!r} never reached the played transcript")
    # Order and single occurrence: call 859c20ee (2026-09-12) recorded the
    # sentence AFTER a cached one before it, and then again after it.
    if "Thank you" in texts and "So the reason" in texts and texts.index("So the reason") < texts.index("Thank you"):
        f.append("played transcript out of order: the vendor sentence precedes the cached opener")
    if texts.count("So the reason I called") > 1:
        f.append("a sentence was recorded twice in the played transcript")
    return f


LONG_CACHED = ("Generally when parents join a coaching class they have three or four basic "
               "expectations, first that the faculty is good and clears every concept properly.")
LIVE_AFTER_CACHED = "Would you agree with that?"


def chk_long_cached_then_live(res):
    """Call d9aed777 (2026-09-25, first FULL-cache call): a 10.9 s cached
    sentence, then a live question in the same reply. The audio played in
    order, but the played transcript — and so the model's own context — came
    out interleaved: "…पहली, faculty क्या आप इससे अच्छे सहमत हों हैं? और बच्चे
    के concepts…". The cached sentence must be recorded whole, then the live
    one, each once."""
    f = []
    if not res["caller"]:
        return ["caller never spoke"]
    texts = " ".join(" ".join(_assistant_texts(res)).split())
    cached = " ".join(LONG_CACHED.split())
    if cached not in texts:
        f.append("the cached sentence is not recorded whole — words from another "
                 "sentence landed inside it: " + texts[-260:])
    elif LIVE_AFTER_CACHED not in texts:
        f.append("the live sentence after the cached one never reached the played transcript")
    elif texts.index(LIVE_AFTER_CACHED) < texts.index(cached):
        f.append("played transcript out of order: the live sentence precedes the cached one")
    if texts.count("Would you agree") > 1:
        f.append("the live sentence was recorded twice")
    cend = res["caller"][0][1]
    ivs = [iv for iv in res["bot"] if cend <= iv[0] < cend + 20.0]
    if sum(b - a for a, b in ivs) < 9.0:
        f.append(f"reply audio only {sum(b - a for a, b in ivs):.1f}s — part of it was lost")
    return f


# ── speech cache on the REAL Smallest service (sim/smallest_fake.py) ──────
S_LIVE_1 = "Rajeev is in class seven right now."
S_LIVE_2 = "What marks did he get in his previous class?"
S_CACHED_TAIL = "So that I get some idea of his performance."
S_CACHED_HEAD = "Thank you."
S_LIVE_Q = "Would you agree with that?"


def chk_history_holds_last_reply(res):
    """The question the parent is answering must be in the model's history —
    whole, and BEFORE the answer. Gemini re-said its whole previous turn after
    the parent answered it in every founder test call on 2026-09-26; a model
    that does that has usually not seen its own last turn."""
    f = []
    ctxs = res.get("contexts") or []
    if len(ctxs) < 2:
        return [f"expected 2 LLM runs, saw {len(ctxs)}"]
    tail = ctxs[1]
    roles = [r for r, _ in tail]
    try:
        last_user = max(i for i, (r, t) in enumerate(tail) if r == "user" and not t.startswith("["))
    except ValueError:
        return ["run 2 saw no caller message"]
    before = [t for r, t in tail[:last_user] if r == "assistant"]
    if not before:
        f.append(f"run 2's history has no assistant reply before the answer: roles {roles}")
    elif "What marks did he get" not in " ".join(before):
        f.append("the question the parent answered is missing from the model's history — saw "
                 + repr(" | ".join(before)[-200:]))
    after = [t for r, t in tail[last_user + 1:] if r == "assistant"]
    if any("What marks" in t for t in after):
        f.append("the question sits AFTER the parent's answer in the history")
    return f


def _norm_ws(t: str) -> str:
    return " ".join(t.split())


def chk_reply_plays_whole(expected: List[str], max_gap: float = 0.8,
                          leading_filler: bool = False):
    """What the caller hears, for one multi-sentence reply: every sentence, in
    order, exactly once, recorded exactly as it played (no sentence's words
    inside another's), and no hole inside the reply longer than max_gap.
    Calls d9aed777 and 5aa10e10 (2026-09-25) failed all three ways."""
    def chk(res):
        f = []
        if not res["caller"]:
            return ["caller never spoke"]
        texts = _norm_ws(" ".join(_assistant_texts(res)))
        want = _norm_ws(" ".join(expected))
        if want not in texts:
            f.append("played transcript does not contain the reply whole and in order — "
                     f"got …{texts[-320:]!r}")
        for sent in expected:
            n = texts.count(_norm_ws(sent))
            if n != 1 and want in texts:
                f.append(f"{sent!r} recorded {n} times")
        cend = res["caller"][0][1]
        ivs = sorted(iv for iv in res["bot"] if iv[0] >= cend)
        reply = []
        for iv in ivs:                        # the reply = intervals until a >4 s pause (nudge)
            if reply and iv[0] - reply[-1][1] > 4.0:
                break
            reply.append(iv)
        if leading_filler and len(reply) > 1 and reply[0][1] - reply[0][0] <= 1.5:
            # "Hmm…" covers the model's thinking time; the pause between it and
            # the reply is the model, not a hole in the reply. The filler is
            # skipped by design while the caller's voice is still live, so its
            # absence is not a failure — the whole reply is what is checked.
            reply = reply[1:]
        gaps = [round(b[0] - a[1], 2) for a, b in zip(reply, reply[1:])]
        if any(g > max_gap for g in gaps):
            f.append(f"hole inside the reply: gaps {gaps} s (max {max_gap})")
        if not reply:
            f.append("the reply never played")
        return f
    return chk


def chk_vertex_stall_then_back(res):
    """Call a4ce0279 (2026-10-13): one Vertex stall put the rest of the call on
    the fallback. The failed turn is answered on the fallback (as before) and the
    caller's NEXT turn goes back to the primary — once, and not for the bot's
    own runs."""
    f = []
    gens = res.get("llm_gens") or []
    if res.get("llm_failovers") != 1:
        f.append(f"llm_failovers = {res.get('llm_failovers')} (want 1)")
    if res.get("llm_returns") != 1:
        f.append(f"llm_returns = {res.get('llm_returns')} (want 1)")
    errs = [g for g in gens if g.get("errored") is not None]
    if not errs:
        return f + ["the primary never errored — the scenario did not stall"]
    t_err = errs[0]["errored"]
    if len(res.get("caller") or []) < 2:
        return f + ["the caller's second turn never came"]
    second_end = res["caller"][1][1]
    after = [g for g in gens if g["requested"] >= second_end - 0.5]
    if not after:
        f.append("nothing answered the caller's second turn")
    elif after[0].get("service") != "primary":
        f.append(f"the second turn went to {after[0].get('service')} (want primary)")
    fb = [g for g in gens if g.get("service") == "fallback" and t_err <= g["requested"] < second_end]
    if len(fb) != 1:
        f.append(f"{len(fb)} fallback generations for the failed turn (want 1)")
    return f


def chk_vertex_stall_failover(res, bar: float = 7.0, bridge_bar: float = 5.0):
    """Call c05f6c83 and 12 more on 2026-10-01: no Vertex first token within
    3 s → a non-fatal ErrorFrame → the switcher moves to the fallback and
    run_bot re-runs the failed turn there. The turn gets ONE fallback reply,
    the primary is never asked again, the errored (text-less) reply is not
    taken for an EMPTY one that needs a "continue" cue, and the caller hears
    the answer within ~7 s of finishing (3 s of it the guard)."""
    from app.bot import next_step_cue
    f = []
    gens = res.get("llm_gens") or []
    if res.get("llm_failovers") != 1:
        f.append(f"llm_failovers = {res.get('llm_failovers')} (want 1)")
    errs = [g for g in gens if g.get("errored") is not None]
    if len(errs) != 1 or errs[0].get("service") != "primary":
        return f + [f"expected one errored primary generation, got "
                    f"{[(g.get('service'), g.get('errored')) for g in errs]}"]
    t_err = errs[0]["errored"]
    again = [g["requested"] for g in gens if g.get("service") == "primary" and g["requested"] >= t_err]
    if again:
        f.append(f"{len(again)} primary generation(s) requested after its error, at {again}")
    fb = [g for g in gens if g.get("service") == "fallback" and t_err <= g["requested"] <= t_err + 8.0]
    if len(fb) != 1:
        f.append(f"{len(fb)} fallback generations for the failed turn (want 1): "
                 f"{[(g['requested'], (g.get('trigger') or '')[:48]) for g in fb]}")
    cue = next_step_cue("", "continue")[1][:40]
    cued = [g["requested"] for g in gens if (g.get("trigger") or "").startswith(cue)]
    if cued:
        f.append(f"the errored reply read as EMPTY: a 'continue' next-step cue ran the model at {cued}")
    if not res["caller"]:
        return f + ["caller never spoke"]
    cend = res["caller"][0][1]
    # Said once (sent to the TTS once) and heard. Not a count in the played
    # transcript: pipecat's word-timestamp sequencer re-emits a multi-sentence
    # reply's later sentences there, failover or not (pieces_with_gaps too).
    said = sum(1 for t in res.get("tts_texts", []) if "So the reason I called" in t)
    if said != 1:
        f.append(f"the answer to the failed turn was sent to the TTS {said}x (want 1)")
    if "So the reason I called" not in " ".join(_assistant_texts(res)):
        f.append("the answer to the failed turn never reached the played transcript")
    # The reply, not the 1 s "Just a second." bridge the stall earns at 2 s.
    # 7 s: the sim's ~2.5 s turn + the 3 s guard + the fallback's 0.8 s — and
    # SimTTS keeps the bridge's audio context open for its 3 s idle timeout,
    # which the reply waits behind (5.7 s with the bridge off, 6.6 s with it).
    reply = [iv for iv in res["bot"] if iv[0] >= cend and iv[1] - iv[0] >= 2.0]
    if not reply:
        f.append("the failed turn was never answered on the line")
    elif reply[0][0] - cend > bar:
        f.append(f"reply started {reply[0][0] - cend:.2f}s after the caller stopped (bar {bar})")
    # The stall is covered: the bridge PLAYS, a few seconds after they stop.
    # c73f60c10d's supersede flushed it from the TTS when the fallback re-ran
    # the turn (slow TTS: 4.55 s → 6.2 s of silence, "dead air 5.7s"); the
    # loose reply bar above could not see it.
    if "Just a second" not in " ".join(_assistant_texts(res)):
        f.append("the 'Just a second.' bridge never reached the caller")
    first = [a for a, _ in res["bot"] if a >= cend]
    if first and first[0] - cend > bridge_bar:
        f.append(f"first sound {first[0] - cend:.2f}s after the caller stopped (bar {bridge_bar})")
    return f


# ── call 71d0d5bd (2026-10-02): "हाँ" over the statement AFTER the question ──
# The prompt's scripted close puts a sentence after the question. The mother's
# "हाँ।" landed over that sentence; the deferred answer check wanted the reply
# to END with "?", so it was dropped as "just listening". Both sides waited:
# two "हेलो? क्या आप मुझे सुन पा रहे हैं?" nudges, the question asked again,
# 29 s from her answer to the bot's next line.
HI_MOTHER = "जी, मैं उसकी मम्मी बोल रही हूँ।"
HI_QUIZ_Q = "क्या मैं Scholarship Quiz का link भी WhatsApp कर दूँ?"
HI_QUIZ_TAIL = "पंद्रह questions हैं, सिर्फ पंद्रह मिनट लगते हैं।"
HI_QUIZ = "ठीक है। " + HI_QUIZ_Q + " " + HI_QUIZ_TAIL
# 14 words after the "?": past the 8-word tolerance — a statement in its own right.
HI_QUIZ_LONG_TAIL = ("पंद्रह questions हैं, सिर्फ पंद्रह मिनट लगते हैं, और result उसी दिन "
                     "आपके WhatsApp पर आ जाता है।")
# A long statement FIRST, then the question and the short tail.
HI_QUIZ_LONG_HEAD = ("ठीक है, मैं आपको sample report, dashboard का video, course brochure और "
                     "कुछ demo videos अभी WhatsApp पर भेज दूँगी। " + HI_QUIZ_Q + " " + HI_QUIZ_TAIL)
HI_QUIZ_SENT = "जी, मैं link अभी भेज देती हूँ। परम से कहिएगा कि आज ही quiz attempt कर ले।"
HI_QUIZ_LATER = "जी, ठीक है। मैं link भेज देती हूँ।"


def _quiz_reply(reply: str):
    """The mother's answer to the opening gets `reply`; the ANSWER cue gets the
    next line; anything else (a nudge cue, her later words) a short line."""
    def pick(last_user: str) -> str:
        u = last_user or ""
        if "मम्मी" in u:
            return reply
        if "ANSWER" in u:
            return HI_QUIZ_SENT
        return HI_QUIZ_LATER
    return pick


def _ack_t(res, needle: str):
    """(start, end) of the caller's interval whose final contains `needle`."""
    t = next((t for t, x in res["finals"] if needle in x), None)
    if t is None:
        return None
    iv = [c for c in res["caller"] if c[0] <= t]
    return iv[-1] if iv else None


def _quiz_asked(res) -> int:
    """Replies that carried the quiz question. Counted on the generations, not
    tts_texts (a cache HIT never reaches run_tts) nor the played transcript
    (pipecat's word-timestamp sequencer re-emits later sentences there)."""
    return sum(1 for g in res.get("llm_gens") or [] if "Scholarship Quiz" in (g.get("reply") or ""))


def _answer_gens(res):
    return [g for g in res.get("llm_gens") or [] if "ANSWER" in (g.get("trigger") or "")]


def chk_ack_answers_question_before_statement(res):
    """The "हाँ" over "पंद्रह questions हैं…" answers "…कर दूँ?": the ANSWER
    path runs right after the reply ends — no 15 s of silence, no nudge, and
    the question is never asked again."""
    f = []
    ack = _ack_t(res, "हाँ")
    if ack is None:
        return ["the caller's 'हाँ।' was never transcribed"]
    ends = [b_ for a, b_ in res["bot"] if b_ > ack[0]]
    if not ends:
        return ["no bot audio around the ack"]
    reply_end = ends[0]
    if ack[0] > reply_end or ack[1] < reply_end - 3.0:
        f.append(f"scenario drift: the ack {ack} is not over the reply's last sentence "
                 f"(reply ends {reply_end})")
    gens = [g for g in _answer_gens(res) if g["requested"] >= ack[0]]
    if not gens:
        f.append("the 'हाँ' over the statement after the question never ran the ANSWER path "
                 f"(prompts after it: {[p[:40] for p in res.get('llm_prompts', [])[1:]]})")
    else:
        lag = round(gens[0]["requested"] - reply_end, 2)
        print(f"NOTE ack answer: ANSWER cue {lag}s after the reply ended")
        if lag > 1.0:
            f.append(f"the ANSWER path ran {lag}s after the reply ended (bar 1.0)")
    # The next thing on the line is the reply to her answer — not 15 s of
    # silence and "हेलो? क्या आप मुझे सुन पा रहे हैं?" (the idle clock is 8 s, so
    # a line inside 3.5 s cannot be a nudge). A later idle nudge, after that
    # reply asked nothing, is the next turn's business.
    nxt = [a for a, _ in res["bot"] if a > reply_end + 0.05]
    if not nxt or nxt[0] - reply_end > 3.5:
        f.append(f"next bot line {round(nxt[0] - reply_end, 1) if nxt else 'never'}s after the reply "
                 "ended (bar 3.5)")
    first = next((g for g in res.get("llm_gens") or [] if g["requested"] >= ack[0]), None)
    if first is not None and "ANSWER" not in (first.get("trigger") or ""):
        f.append(f"the first run after her 'हाँ' was not the answer: {(first.get('trigger') or '')[:60]!r}")
    if _quiz_asked(res) != 1:
        f.append(f"the model was asked for the quiz question {_quiz_asked(res)}x (want 1)")
    if not any("भेज देती" in t for t in _assistant_texts(res)):
        f.append("the reply to her answer never played")
    return f


def chk_ack_stays_backchannel(needle: str = "हाँ"):
    """An acknowledgement that is NOT an answer — over a long statement after
    the question, early in the reply, or a "Hello?" line check — must not be
    handed to the model as the answer to the question."""
    def chk(res):
        f = []
        ack = _ack_t(res, needle)
        if ack is None:
            return [f"the caller's {needle!r} was never transcribed"]
        ends = [b_ for a, b_ in res["bot"] if b_ > ack[0]]
        if not ends or ack[0] > ends[0]:
            f.append(f"scenario drift: {needle!r} at {ack} is not over the reply")
        bad = [g for g in _answer_gens(res) if g["requested"] >= ack[0]]
        if bad:
            f.append(f"{needle!r} was taken as the ANSWER at {bad[0]['requested']}: "
                     f"{(bad[0].get('trigger') or '')[:90]!r}")
        if _quiz_asked(res) != 1:
            f.append(f"the model was asked for the quiz question {_quiz_asked(res)}x (want 1)")
        return f
    return chk


def chk_hello_over_tail_is_not_an_answer(res):
    f = chk_ack_stays_backchannel("Hello")(res)
    if not any("भेज दीजिए" in p for p in res.get("llm_prompts", [])):
        f.append("her real answer after the line check never reached the model")
    return f


def _quiz_scenario(key: str, reply: str, say: "Say", checks, note: str, **kw) -> "Scenario":
    return Scenario(
        key,
        caller=[Say(HI_MOTHER, 1.4, after_bot_stop=1, offset=0.6, stt_latency=0.4), say,
                *kw.pop("more", [])],
        replies=[], reply_for=_quiz_reply(reply),
        context="hindi_parent_agent_context.json",
        checks=checks, max_secs=kw.pop("max_secs", 45), note=note, **kw)


# ── call 3e327e8a (2026-10-02): a hung STT socket held back the opening ────
# Sarvam's account ran out of credit. Its server answered the stream with a
# close frame (1003 "Credits exhausted") and kept the TCP connection open; the
# sarvamai SDK's websockets (legacy) client then made every send() wait for
# the closing handshake — close_timeout, 10 s (connected 07:10:25.823, error
# 07:10:35.838). The opening, queued at +1.24 s, played at +13.76 s.
HI_STT_REPLY_CLASS = "जी मैम। बच्चा अभी किस class में पढ़ रहा है?"
HI_STT_NINTH = "नौवीं में पढ़ रहा है।"


def _stt_reply(last_user: str) -> str:
    u = last_user or ""
    if "मम्मी" in u:
        return HI_STT_REPLY_CLASS
    if "नौवीं" in u:
        return HI_Q_EFFORT
    return "जी मैम।"


def _hang_t(res, vendor: str = "sarvam"):
    return next((c["hung_at"] for c in res.get("stt_conns") or []
                 if c["vendor"] == vendor and c["hung_at"] is not None), None)


def _switch_t(res):
    return next((t for t, svc in res.get("stt_switches") or [] if "Smallest" in svc), None)


def _heard_by(res, needle: str):
    return [v for t, v, x in res.get("stt_vendor_finals") or [] if needle in x]


def chk_stt_failover_target(res, bar: float = 2.5):
    """A stuck vendor socket fails over within `bar` s of the hang — never the
    10 s the closing handshake takes — and exactly once."""
    f = []
    hung, sw = _hang_t(res), _switch_t(res)
    if hung is None:
        return ["scenario drift: the Sarvam socket never hung"]
    if sw is None:
        f.append(f"no failover to Smallest after Sarvam hung at {hung}s")
    else:
        print(f"NOTE stt: Sarvam hung at {hung}s, switched to Smallest at {sw}s "
              f"(+{round(sw - hung, 2)}s)")
        if sw - hung > bar:
            f.append(f"failover {round(sw - hung, 2)}s after the socket hung (bar {bar})")
    if res.get("stt_failovers") != 1:
        f.append(f"stt_failovers = {res.get('stt_failovers')} (want 1)")
    return f


def chk_stt_hangs_at_pickup(res):
    f = chk_stt_failover_target(res)
    if not res["bot"]:
        return f + ["the opening never played"]
    first = res["bot"][0][0]
    print(f"NOTE stt: opening first audio at +{first}s")
    if first > 2.5:
        f.append(f"the opening started at +{first}s with the STT stuck (normal +1.2-2 s; "
                 "3e327e8a: +13.76 s)")
    # Their pickup "Hello" arrived DURING the hang: it must not be lost.
    if not _heard_by(res, "Hello"):
        f.append("the pickup 'Hello' spoken while the STT was stuck was never transcribed")
    elif "SmallestSTTService" not in _heard_by(res, "Hello"):
        f.append(f"'Hello' transcribed by {_heard_by(res, 'Hello')}, not the fallback")
    # Their first words after the failover reach the model and get a reply.
    if "SmallestSTTService" not in _heard_by(res, "मम्मी"):
        f.append(f"her answer after the failover was not transcribed by the fallback "
                 f"(finals {res.get('stt_vendor_finals')})")
    if not any("मम्मी" in p for p in res.get("llm_prompts", [])):
        f.append("her answer never reached the model")
    elif len(res["caller"]) >= 2:
        cend = res["caller"][1][1]
        nxt = [a for a, _ in res["bot"] if a > cend]
        if not nxt or nxt[0] - cend > 3.5:
            f.append(f"reply to her answer {round(nxt[0] - cend, 1) if nxt else 'never'}s "
                     "after she stopped (bar 3.5)")
    return f


def chk_stt_hangs_mid_call(res):
    f = chk_stt_failover_target(res)
    if "SarvamSTTService" not in _heard_by(res, "मम्मी"):
        f.append(f"before the hang Sarvam should have transcribed her first answer "
                 f"(finals {res.get('stt_vendor_finals')})")
    heard = _heard_by(res, "नौवीं")
    if "SmallestSTTService" not in heard:
        f.append(f"the answer she gave while Sarvam was stuck was lost (finals "
                 f"{res.get('stt_vendor_finals')})")
    if len(res["caller"]) >= 2:
        cend = res["caller"][1][1]
        nxt = [a for a, _ in res["bot"] if a > cend]
        lag = round(nxt[0] - cend, 2) if nxt else None
        print(f"NOTE stt: reply to the answer given during the hang {lag}s after she stopped")
        if lag is None or lag > 4.0:
            f.append(f"reply to the answer given during the hang came {lag}s after she "
                     "stopped (bar 4.0)")
    if "syllabus" not in " ".join(_assistant_texts(res)):
        f.append("the answer given during the hang never got its reply")
    return f


def chk_stt_healthy_quiet(res):
    """A healthy socket on a caller who says nothing for ~20 s: no stall, no
    failover — silence is not a stuck vendor — and Sarvam still transcribes."""
    f = []
    if res.get("stt_switches"):
        f.append(f"the STT switched on a healthy, quiet line: {res['stt_switches']}")
    if res.get("stt_failovers") or res.get("stt_stalls"):
        f.append(f"stt_failovers={res.get('stt_failovers')} stt_stalls={res.get('stt_stalls')} "
                 "on a healthy socket")
    if _hang_t(res) is not None:
        f.append("scenario drift: the Sarvam socket hung")
    if _heard_by(res, "मम्मी") != ["SarvamSTTService"]:
        f.append(f"Sarvam should have transcribed her answer once (finals "
                 f"{res.get('stt_vendor_finals')})")
    if not any("मम्मी" in p for p in res.get("llm_prompts", [])):
        f.append("her answer never reached the model")
    if res["bot"] and res["bot"][0][0] > 2.5:
        f.append(f"the opening started at +{res['bot'][0][0]}s")
    return f


_BREATH_REPLIES = [PITCH_Q, "Got it — evenings at the studio, weekends at home. Who sends the daily link right now?"]
_BREATH_NOTE = "2026-09-15: VAD stop inside a 0.45 s breath; Smallest finalized the short part, the rest was dropped"

SCENARIOS: List[Scenario] = [
    Scenario("stt_waterfall_after_deaf_primary",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("Yes. " + LONG_ANSWER, after_bot_stop=2, offset=0.8, clip="pause_then_long")],
             replies=[PITCH_Q, "Got it — evenings at the studio, weekends at home. Who sends the daily link right now?"],
             checks=chk_stt_waterfall, max_secs=50, real_stt=True,
             note="run with SIM_DEAF_PRIMARY=1 STT_FALLBACK_PROVIDER=<vendor>: orphan re-ask → failover"),
    Scenario("breath_then_long_answer_yes",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("Yes. " + LONG_ANSWER, after_bot_stop=2, offset=0.8, clip="pause_then_long")],
             replies=_BREATH_REPLIES, checks=chk_breath_then_long, max_secs=45,
             real_stt=True, note=_BREATH_NOTE),
    Scenario("breath_then_long_answer_haan",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("Haan. " + LONG_ANSWER, after_bot_stop=2, offset=0.8, clip="haan_pause_long")],
             replies=_BREATH_REPLIES, checks=chk_breath_then_long, max_secs=45,
             real_stt=True, note=_BREATH_NOTE),
    Scenario("breath_then_long_answer_yga",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("Yes, go ahead. " + LONG_ANSWER, after_bot_stop=2, offset=0.8, clip="yga_pause_long")],
             replies=_BREATH_REPLIES, checks=chk_breath_then_long, max_secs=45,
             real_stt=True, note=_BREATH_NOTE),
    Scenario("unheard_turn_gets_a_repeat_request",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("It's a mix of online and studio.", 1.6, after_bot_stop=2, offset=0.8,
                         finals=[""], stt_latency=0.4)],
             replies=[PITCH_Q, "Got it. Who sends the daily link right now?"],
             checks=chk_unheard_turn, max_secs=40,
             note="2026-09-15: 3 of 81 turns produced no transcript; callers said Hello? into silence"),
    Scenario("yes_after_nudge",
             # Call 92743351 (2026-09-15): silent caller, two nudges, "Yes" right
             # after "Hello? Are you there?" — the reply took 6.2 s.
             caller=[Say("Yes.", after_bot_stop=3, offset=0.4, stt_latency=0.6)],
             replies=["Great. So the reason I called — we work with yoga teachers on the daily link."],
             checks=chk_turn_latency, max_secs=40,
             note="yes after the second nudge must be answered like any yes"),
    Scenario("screener_then_person",
             caller=[Say("Hi. If you record your name and reason for calling, I'll see if this person is available",
                         3.0, at=0.4, stt_latency=0.3),
                     Say("Hello.", at=11.0, stt_latency=0.4),
                     Say("Yes, this is me. Go ahead.", 1.6, after_bot_stop=2, offset=0.8, stt_latency=0.5),
                     Say("Hello?", after_bot_stop=3, offset=5.0, stt_latency=0.4)],
             replies=[PITCH_Q, "Got it. Who sends the daily link right now?", "Yes, I'm here. Who sends the daily link right now?"],
             checks=chk_screener_then_person, max_secs=60,
             note="call 196838de: screener flag stayed armed; a later Hello? replayed the opening"),
    Scenario("voicemail_hangs_up",
             caller=[Say("Your call has been forwarded to voicemail.", 2.4, at=0.3, stt_latency=0.3),
                     Say("At the tone, please record your message.", 2.2, at=4.0, stt_latency=0.3)],
             replies=[], checks=chk_voicemail, max_secs=30,
             note="call 24089872: two nudges and a farewell spoken to an answering machine"),
    Scenario("fragment_tail_is_not_a_barge_in",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("It makes some sense", 1.6, after_bot_stop=2, offset=0.8,
                         finals=["? It makes", "some sense"], stt_latency=0.4)],
             replies=[PITCH_Q, "It makes sense, good. So who sends the daily link right now — you, or someone else?"],
             checks=chk_fragment_tail, max_secs=45,
             note="call 31763255: '? It makes' → reply → 'some' as a real barge-in killed it"),
    Scenario("pieces_with_gaps",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("My daughter is in the eighth class", 1.1, after_bot_stop=2,
                         offset=0.8, stt_latency=0.4),
                     # Starts 0.8 s after the first piece — on the CI runner's
                     # usual ~1.2 s reply latency the reply is ready mid-piece
                     # (gate off: a 0.28 s stub at 25.51 s). Closer, and the
                     # first reply never starts at all; on a fast runner it
                     # starts before this piece and the case does not arise.
                     Say("and there are three girls at home studying", 1.4, after_bot_stop=2,
                         offset=2.7, stt_latency=0.4)],
             replies=[PITCH_Q,
                      "Got it, eighth class. And how were her marks last year?",
                      "Three girls, that's lovely. And how were the eldest one's marks last year?",
                      "Okay."],
             checks=chk_pieces_with_gaps, max_secs=45,
             note="call 358e5026: a reply started over every next piece and was cut to a stub"),
    Scenario("pieces_one_reply",
             caller=PIECES_CALLER, replies=[], reply_for=_pieces_reply,
             checks=chk_pieces_one_reply, max_secs=40,
             note="calls 84e52d17/b51093dc: a held short piece released stale while the rest "
                  "formed — two replies back to back"),
    Scenario("pieces_one_reply_forming_unseen",
             caller=PIECES_CALLER, replies=[], reply_for=_pieces_reply,
             checks=chk_pieces_one_reply_superseded, max_secs=40,
             settings={"run_forming_hold": False},
             note="the same with the rest of the turn invisible to RunGuard (production's "
                  "race): the turn's run must supersede the stale one"),
    Scenario("pieces_supersede_forced",
             caller=FORCED_CALLER, replies=[], reply_for=_forced_reply, ttft=0.8,
             inject=[(24.0, "I have piece one of my answer here."),
                     (24.4, "And piece two follows now right away.")],
             checks=chk_forced_supersede(2), max_secs=34,
             note="84e52d17 forced: a second caller run 0.4 s after the first, which is "
                  "still composing — it must be cancelled, one reply"),
    Scenario("pieces_supersede_chain",
             caller=FORCED_CALLER, replies=[], reply_for=_forced_reply, ttft=0.8,
             inject=[(24.0, "I have piece one of my answer here."),
                     (24.3, "And piece two follows now right away."),
                     (24.6, "And then piece three closes the whole turn.")],
             checks=chk_forced_supersede(3), max_secs=34,
             note="review 2026-10-08: the supersede's own cancel stamp made the 2nd run look "
                  "cut, so the 3rd could not supersede it — two replies"),
    Scenario("navana_held_reply_is_not_heard",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("My daughter is in the eighth class", 1.1, after_bot_stop=2,
                         offset=0.8, stt_latency=0.4),
                     Say("and there are three girls at home studying", 1.4, after_bot_stop=2,
                         offset=2.7, stt_latency=0.4)],
             replies=[PITCH_Q, NV_HELD,
                      "Three girls, that's lovely. And how were the eldest one's marks last year?",
                      "Okay."],
             checks=chk_navana_held_reply_is_not_heard, max_secs=45,
             cache_warm=[S_CACHED_TAIL], engine="navana", context="navana_agent_context.json",
             note="calls 18b63b17/45749163: a held-then-dropped Navana reply counted as said"),
    _nv_tail_scenario("navana_answer_over_tail_cache_off", False),
    _nv_tail_scenario("navana_answer_over_tail_cache_on", True),
    Scenario("smallest_live_only",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=[" ".join([S_LIVE_1, S_LIVE_2])],
             checks=chk_reply_plays_whole([S_LIVE_1, S_LIVE_2]), max_secs=30, engine="smallest",
             note="baseline: the real Smallest service with no cache in the reply"),
    Scenario("smallest_live_then_cached",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=[" ".join([S_LIVE_1, S_LIVE_2, S_CACHED_TAIL])],
             checks=chk_reply_plays_whole([S_LIVE_1, S_LIVE_2, S_CACHED_TAIL]), max_secs=30,
             cache_warm=[S_CACHED_TAIL], engine="smallest",
             note="call 5aa10e10: a cached sentence behind two live ones waited 2.2 s"),
    Scenario("smallest_cached_then_live",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=[" ".join([LONG_CACHED, S_LIVE_Q])],
             checks=chk_reply_plays_whole([LONG_CACHED, S_LIVE_Q]), max_secs=35,
             cache_warm=[LONG_CACHED], engine="smallest",
             note="call d9aed777: live words stamped inside a long cached sentence"),
    Scenario("smallest_cached_live_cached",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=[" ".join([S_CACHED_HEAD, S_LIVE_1, S_CACHED_TAIL])],
             checks=chk_reply_plays_whole([S_CACHED_HEAD, S_LIVE_1, S_CACHED_TAIL]), max_secs=30,
             cache_warm=[S_CACHED_HEAD, S_CACHED_TAIL], engine="smallest",
             note="cached, live, cached in one reply"),
    Scenario("navana_live_then_cached",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=[" ".join([S_LIVE_1, S_LIVE_2, S_CACHED_TAIL])],
             checks=chk_reply_plays_whole([S_LIVE_1, S_LIVE_2, S_CACHED_TAIL]), max_secs=30,
             cache_warm=[S_CACHED_TAIL], engine="navana", context="navana_agent_context.json",
             note="Navana + FULL cache: the Smallest 5aa10e10 shape on Navana's own service"),
    Scenario("navana_cached_then_live",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=[" ".join([LONG_CACHED, S_LIVE_Q])],
             checks=chk_reply_plays_whole([LONG_CACHED, S_LIVE_Q]), max_secs=35,
             cache_warm=[LONG_CACHED], engine="navana", context="navana_agent_context.json",
             note="Navana + FULL cache: live words must not land inside a cached sentence"),
    Scenario("navana_cached_live_cached",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=[" ".join([S_CACHED_HEAD, S_LIVE_1, S_CACHED_TAIL])],
             checks=chk_reply_plays_whole([S_CACHED_HEAD, S_LIVE_1, S_CACHED_TAIL]), max_secs=30,
             cache_warm=[S_CACHED_HEAD, S_CACHED_TAIL], engine="navana", context="navana_agent_context.json",
             note="Navana + FULL cache: cached, live, cached in one reply"),
    Scenario("smallest_filler_then_live_and_cached",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=[" ".join([S_LIVE_1, S_LIVE_2, S_CACHED_TAIL])],
             checks=chk_reply_plays_whole([S_LIVE_1, S_LIVE_2, S_CACHED_TAIL],
                                          leading_filler=True),
             max_secs=30, cache_warm=[S_CACHED_TAIL], engine="smallest", filler=1.0,
             note="a6252b5c57's gate: a 'Hmm…' filler, then the reply must still come whole"),
    Scenario("smallest_history_holds_last_reply",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("He got eighty three percent last year", 1.6, after_bot_stop=2,
                         offset=0.8, stt_latency=0.4)],
             replies=[" ".join([S_LIVE_1, S_LIVE_2]), "Okay, eighty three is good."],
             checks=chk_history_holds_last_reply, max_secs=35, engine="smallest",
             note="2026-09-26: Gemini re-said its whole previous turn after the parent answered it"),
    Scenario("smallest_history_holds_last_reply_cache_on",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("He got eighty three percent last year", 1.6, after_bot_stop=2,
                         offset=0.8, stt_latency=0.4)],
             replies=[" ".join([S_LIVE_1, S_LIVE_2]), "Okay, eighty three is good."],
             checks=chk_history_holds_last_reply, max_secs=35, engine="smallest",
             cache_warm=["Thank you."],
             note="the same with the speech cache installed: per-sentence contexts, as Shreya runs"),
    Scenario("long_cached_then_live",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=[LONG_CACHED + " " + LIVE_AFTER_CACHED],
             checks=chk_long_cached_then_live, max_secs=35, cache_warm=[LONG_CACHED],
             note="call d9aed777: long cached sentence + live question — transcript interleaved"),
    Scenario("cached_opener_then_pitch",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=["Thank you. So the reason I called — we work with yoga teachers on everything "
                      "around their online classes. The daily link, the reminders, the fees."],
             checks=chk_cached_opener, max_secs=30, cache_warm=["Thank you."],
             note="call 994162b0: cached 'Thank you.' then 3.6 s of silence — the cached per-sentence "
                  "context only closed on pipecat's 3 s idle timeout"),
    Scenario("yes_over_tail",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     # Right after "right now?" has PLAYED (word timings reach the
                     # played transcript per word, as with Smallest), while the tail
                     # "Is that you, or does someone help?" is still queued — call
                     # 34f258c2's shape exactly.
                     Say("Yes.", after_bot_start=2, offset=_after_word(PITCH_Q, "now?"),
                         stt_latency=0.4)],
             replies=[PITCH_Q, "Great — so it's on you. Honestly, the fees part is what most teachers are fed up with."],
             # 3.0, not 2.5: a bare "Yes." pays the short-answer grace (0.8 s
             # minus the silence already elapsed) by design since 8de0c67de3 —
             # measured 2.44-2.57 s here, flapping on the old bar under any load.
             checks=lambda r: chk_yes_over_tail(r) + chk_turn_latency(r, 3.0), max_secs=40,
             note="call 34f258c2: '…Is that you?' → 'Yes.' → the held tail 'or does someone help?' resumed"),
    Scenario("farewell_without_marker",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=["No problem at all. Thank you for your time, namaste."],
             checks=chk_farewell, max_secs=40,
             note="recordings 4acc56a6/6fa15c09: goodbye without <<END_CALL>>, 8-11 s hole, then a nudge"),
    Scenario("backchannel_mid_reply",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("haan.", 0.45, after_bot_start=2, offset=2.0, stt_latency=0.4)],
             replies=["So the reason I called — we handle the daily running around of online yoga classes. "
                      "The link goes out to everyone on WhatsApp on its own. Are your classes online at the moment?"],
             checks=chk_backchannel, max_secs=40,
             note="founder rule 2026-08-05: absorb but never lose — a 'haan' mid-reply must not cut or restart it"),
    Scenario("silent_caller",
             caller=[],
             replies=[],
             checks=chk_silent, max_secs=45,
             note="nobody answers after the opening: one nudge at ~8 s, then the idle farewell and hang-up"),
    Scenario("hello_then_silence",
             caller=[Say("Hello.", at=0.5)],
             replies=[],
             checks=chk_silent, max_secs=45,
             note="the callee's pickup 'Hello' lands before the opening, then nothing: the nudge must still come"),
    Scenario("empty_reply_gets_the_next_line",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=["", PITCH_Q],
             checks=chk_empty_reply_gets_the_next_line, max_secs=30,
             note="call 963347ab: Gemini answered out=0; the next line must come at once"),
    Scenario("hello_cuts_opening",
             caller=[Say("Hello.", 0.6, after_bot_start=1, offset=0.8),
                     Say(OPEN_ANSWER, 1.2, after_bot_stop=2, offset=0.8)],
             replies=[PITCH_Q],
             checks=chk_hello_cuts_opening, max_secs=40,
             note="call 9e566e32: the callee's 'Hello' 0.8 s into the opening cut it; the caller must still hear who is calling"),
    Scenario("cut_the_call_forced_close",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("I don't need this. Cut the call, thank you.", 2.2, after_bot_stop=2, offset=0.5)],
             replies=[PITCH_Q, "Just to clarify, is it that you don't take online classes, or someone handles it?"],
             checks=chk_forced_close, max_secs=45,
             note="call ada2e60c: the model clarifies instead of ending; the gate must end the call anyway"),
    Scenario("vertex_stall_failover",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=[PITCH_Q],
             llm_stalls=[4.0], fallback_ttft=0.8,
             checks=chk_vertex_stall_failover, max_secs=30,
             note="c05f6c83 + 12 calls 2026-10-01: no Vertex first token in 3 s → the fallback answers the turn"),
    # FAILS on bae0308b34. The errored reply's End reaches NoRepeatGate before
    # the bridge is heard, so the caller's words are still the last transcript
    # entry: the EMPTY-reply recovery queues a "continue" cue, the cue's run
    # takes the fallback, and RunGuard then blocks on_pipeline_error's re-run
    # as "context unchanged" — the failed turn is answered under the cue. With
    # the bridge heard first (the scenario above) the same code passes.
    Scenario("vertex_stall_then_back",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6),
                     Say("Okay, and how much does it cost?", 1.6, after_bot_stop=3, offset=0.8)],
             replies=[PITCH_Q, "It depends on your batch size. Shall I send the details?"],
             llm_stalls=[4.0], fallback_ttft=0.8,
             checks=chk_vertex_stall_then_back, max_secs=40,
             note="a4ce0279: after one stall the caller's next turn goes back to the primary"),
    Scenario("vertex_stall_failover_slow_tts",
             caller=[Say(OPEN_ANSWER, 1.2, after_bot_stop=1, offset=0.6)],
             replies=[PITCH_Q],
             llm_stalls=[4.0], fallback_ttft=0.8, tts_ttfb=0.9,
             # +1 s: the bridge and the reply each pay the slower TTS.
             checks=lambda r: chk_vertex_stall_failover(r, bar=8.0, bridge_bar=6.0), max_secs=30,
             note="the same with a 0.9 s TTS: the 'Just a second.' bridge is not yet HEARD when the "
                  "errored reply ends"),
    Scenario("busy_over_cached_opening_late",
             caller=[Say(HI_BUSY, 1.0, after_bot_start=1, offset=10.0)],
             replies=[HI_BUSY_REPLY],
             context="hindi_parent_agent_context.json", engine="navana",
             cache_warm=[HI_OPENING],
             checks=chk_busy_over_cached_opening, max_secs=35,
             note="call 1f2b97ab: 'busy' at 10 s of a 13 s cached opening re-said it from the top"),
    Scenario("busy_over_cached_opening_early",
             caller=[Say(HI_BUSY, 1.0, after_bot_start=1, offset=2.0)],
             replies=[HI_BUSY_REPLY],
             context="hindi_parent_agent_context.json", engine="navana",
             cache_warm=[HI_OPENING],
             checks=chk_busy_over_cached_opening, max_secs=35,
             note="'busy' 2 s into the opening is an answer, not a pickup hello"),
    Scenario("absorbed_ack_during_resaid_opening",
             caller=[Say("करतो करतो।", 0.9, after_bot_start=1, offset=3.0),
                     Say("हाँ।", 0.4, after_bot_start=2, offset=1.5),
                     Say(HI_FATHER, 1.4, after_bot_stop=2, offset=0.6)],
             replies=[],
             reply_for=_resaid_opening_reply,
             context="hindi_parent_agent_context.json", engine="navana",
             cache_warm=[HI_OPENING],
             checks=chk_absorbed_ack_does_not_resay_again, max_secs=50,
             note="call 8208166f: an absorbed 'हाँ' during the re-said opening queued another copy"),
    Scenario("hello_over_cached_opening",
             caller=[Say("Hello.", 0.6, after_bot_start=1, offset=0.8),
                     Say("जी, मैं उसका पिता बोल रहा हूँ।", 1.4, after_bot_stop=1, offset=0.6)],
             replies=[HI_Q_CLASS],
             context="hindi_parent_agent_context.json", engine="navana",
             cache_warm=[HI_OPENING],
             checks=chk_hello_over_cached_opening, max_secs=40,
             note="the time-based 'heard' must not change a pickup Hello over a cached opening"),
    _cut_cached_reply("cut_cached_reply_late_is_heard", 0.55, heard=True),
    _cut_cached_reply("cut_cached_reply_early_is_not_heard", 0.22, heard=False),
    Scenario("hindi_pieces_bare_acks",
             caller=[Say("हाँ जी पिताजी हैं।", 1.2, after_bot_stop=1, offset=0.6),
                     Say("नौवीं में पढ़ रहा है।", 1.3, after_bot_stop=2, offset=0.6),
                     Say("अब पढ़ने में तो।", 1.0, after_bot_stop=3, offset=0.6),
                     Say("कोशिश करता है।", 1.1, after_bot_stop=3, offset=2.9)],
             replies=[],
             reply_for=_hindi_pieces_reply,
             context="hindi_parent_agent_context.json",
             checks=chk_hindi_pieces_bare_acks, max_secs=75,
             note="call 22062aac: 'अब पढ़ने में तो।' / 'कोशिश करता है।' got 'जी।' 'जी सर।' x3, "
                  "then 12 s of silence and 'are you there?'"),
    # Under SimTTS a short first sentence ("ठीक है।", 0.7 s) is its own
    # utterance on the line — its audio context closes on the 3 s idle timeout
    # before the next one plays — so the question + tail is bot utterance 3:
    # the question 3.6 s, then the tail 2.9 s. 4.6 s puts "हाँ" a second into
    # the tail, where the mother said hers (VAD 182.48 s, tail 181.52-183.83 s).
    _quiz_scenario("ack_over_statement_after_question",
                   HI_QUIZ, Say("हाँ।", 0.39, clip="haan", after_bot_start=3, offset=4.6,
                                stt_latency=0.2),
                   chk_ack_answers_question_before_statement,
                   "call 71d0d5bd: 'हाँ' over the sentence after the question was dropped; "
                   "29 s, two nudges and the question again before the next line"),
    # Cache HITs play back to back as ONE utterance (60 ms/char): the tail is
    # its last ~2.8 s; 5.6 s in is ~0.9 s before the end.
    _quiz_scenario("ack_over_statement_after_question_cached",
                   HI_QUIZ, Say("हाँ।", 0.39, clip="haan", after_bot_start=2, offset=5.6,
                                stt_latency=0.2),
                   chk_ack_answers_question_before_statement,
                   "the same on Navana with every sentence of the reply a cache HIT "
                   "(per-sentence audio contexts), as the live call ran",
                   engine="navana", cache_warm=["ठीक है।", HI_QUIZ_Q, HI_QUIZ_TAIL]),
    # Negatives. Past the tolerance the statement is a sentence in its own
    # right, and a "हाँ" over its end acknowledges IT: question 3.6 s + an
    # 18-word tail of 6.4 s; 8.5 s in is 1.5 s before the end, 4.9 s after "?".
    _quiz_scenario("ack_over_long_statement_stays_backchannel",
                   "ठीक है। " + HI_QUIZ_Q + " " + HI_QUIZ_LONG_TAIL,
                   Say("हाँ।", 0.39, clip="haan", after_bot_start=3, offset=8.5, stt_latency=0.2),
                   chk_ack_stays_backchannel(),
                   "negative for 71d0d5bd: an ack over a statement longer than the "
                   "8-word tolerance is not the answer to the question before it",
                   max_secs=35),
    # An ack 1.5 s into a 13 s reply whose question comes near its end: it
    # acknowledged the first sentence, ~11 s before the reply ends.
    _quiz_scenario("early_ack_in_question_reply_stays_backchannel",
                   HI_QUIZ_LONG_HEAD,
                   Say("हाँ।", 0.39, clip="haan", after_bot_start=2, offset=1.5, stt_latency=0.2),
                   chk_ack_stays_backchannel(),
                   "negative for 71d0d5bd: an ack early in a reply that ends on a "
                   "question (plus a short tail) is still just 'I'm listening'",
                   max_secs=40),
    # "Hello?" over the tail is a line check: never the answer. Her real
    # answer comes 1.2 s after the reply ends and is answered normally.
    _quiz_scenario("hello_over_statement_after_question_is_not_an_answer",
                   HI_QUIZ,
                   Say("Hello?", 0.53, after_bot_start=3, offset=4.6, stt_latency=0.2),
                   chk_hello_over_tail_is_not_an_answer,
                   "negative for 71d0d5bd: 'Hello?' over the tail is a line check, not an answer",
                   more=[Say("हाँ, भेज दीजिए।", 1.0, after_bot_stop=3, offset=1.2,
                             stt_latency=0.4)]),
    # Call 3e327e8a: the socket dies on the first audio; the parent's pickup
    # "Hello" (0.4 s) falls inside the hang, before any detector can fire.
    Scenario("stt_hangs_at_pickup",
             caller=[Say("Hello.", at=0.4, stt_latency=0.3),
                     Say(HI_MOTHER, 1.4, after_bot_stop=1, offset=0.6)],
             replies=[], reply_for=_stt_reply,
             stt_fake={"sarvam": {"hang_on_audio": 1}, "smallest": {}},
             context="hindi_parent_agent_context.json", engine="navana",
             cache_warm=[HI_OPENING],
             checks=chk_stt_hangs_at_pickup, max_secs=45,
             note="call 3e327e8a: Sarvam closed 1003 and held the TCP; the opening waited "
                  "~10 s behind the stuck sends (+13.76 s)"),
    # Mid-call: Sarvam dies the moment she starts her second answer, so ALL of
    # it is caller audio that arrived during the hang.
    Scenario("stt_hangs_mid_call",
             caller=[Say(HI_MOTHER, 1.4, after_bot_stop=1, offset=0.6),
                     Say(HI_STT_NINTH, 1.3, after_bot_stop=2, offset=0.6)],
             replies=[], reply_for=_stt_reply,
             stt_fake={"sarvam": {"hang_on_say": 2}, "smallest": {}},
             context="hindi_parent_agent_context.json", engine="navana",
             cache_warm=[HI_OPENING],
             checks=chk_stt_hangs_mid_call, max_secs=45,
             note="the 3e327e8a socket failure in the middle of a call, while she talks"),
    # Healthy and quiet: ~20 s with nothing to transcribe (the opening, a
    # nudge), then an answer — no stall, no failover, Sarvam hears it.
    Scenario("stt_healthy_quiet_caller_no_failover",
             caller=[Say(HI_MOTHER, 1.4, after_bot_stop=2, offset=1.0)],
             replies=[], reply_for=_stt_reply,
             stt_fake={"sarvam": {}, "smallest": {}},
             context="hindi_parent_agent_context.json", engine="navana",
             cache_warm=[HI_OPENING],
             checks=chk_stt_healthy_quiet, max_secs=45,
             note="the stall detector must not fire on a healthy socket that is merely quiet"),
]
BY_KEY = {s.key: s for s in SCENARIOS}


def _holders(target, depth: int = 8, limit: int = 12, ignore=()) -> List[str]:
    """Reference chains from `target` up to something that is not part of the
    call's own object web (a module, a timer, a function, a class, a closure
    cell held by one) — i.e. what keeps a finished call alive."""
    import gc
    import types
    def d(o):
        n = type(o).__name__
        if isinstance(o, dict):
            ks = [k for k in list(o.keys())[:5]]
            return f"dict{ks}"
        if isinstance(o, (list, tuple, set)):
            return f"{n}[{len(o)}]"
        if isinstance(o, (types.FunctionType, types.MethodType)):
            f = getattr(o, "__func__", o)
            return f"{n}:{f.__qualname__}"
        if isinstance(o, type):
            return f"class {o.__qualname__}"
        if n == "coroutine":
            st = "suspended" if getattr(o, "cr_frame", None) is not None else "finished"
            return f"coroutine {getattr(o, '__qualname__', '?')} ({st})"
        if n in ("Task", "Future"):
            return f"{n} {getattr(o, 'get_name', lambda: '')()} done={o.done()}"
        return n
    out, seen = [], {id(target), *ignore}
    frontier = [(target, [type(target).__name__])]
    for _ in range(depth):
        nxt = []
        for obj, path in frontier:
            for r in gc.get_referrers(obj):
                if id(r) in seen or isinstance(r, types.FrameType) or r is frontier or r is nxt:
                    continue
                seen.add(id(r))
                p = path + [d(r)]
                root = (isinstance(r, (types.ModuleType, type))
                        or type(r).__name__ in ("TimerHandle", "Handle")
                        or (isinstance(r, dict) and "__name__" in r and "__loader__" in r)
                        # a pending task is a root (the loop holds it)
                        or (type(r).__name__ == "Task" and not r.done()))
                if root:
                    out.append(" <- ".join(p))
                    if len(out) >= limit:
                        return out
                else:
                    nxt.append((r, p))
        frontier = nxt[:600]
    return out or ["(no module/timer/task root found within depth)"]


async def main():
    import os, tempfile
    # A private speech cache per run: warm lines must never land in the box's
    # real ledger, and CI has no writable /srv/data.
    os.environ["TTS_CACHE_DIR"] = tempfile.mkdtemp(prefix="sim-tts-cache-")
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="all")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--out", default="sim_timing.json")
    ap.add_argument("--ci", action="store_true")
    ap.add_argument("--real-stt", action="store_true",
                    help="use the production STT (STT_PROVIDER env) on the fixture audio; "
                         "'all' then includes the real_stt scenarios")
    ap.add_argument("--app-log", action="store_true",
                    help="show app.* INFO lines (watchdog/orphan diagnostics) alongside events")
    ap.add_argument("--slow-primary-every", type=int, default=0,
                    help="LLM waterfall variant: every N-th primary generation stalls past the "
                         "first-token guard (= SIM_SLOW_PRIMARY_EVERY, which sim.replay/corpus read)")
    args = ap.parse_args()
    if args.slow_primary_every:
        os.environ["SIM_SLOW_PRIMARY_EVERY"] = str(args.slow_primary_every)
    if args.app_log:
        # Only stdlib loggers under app.*; pipecat's loguru stays as-is.
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("        app: %(message)s"))
        logging.getLogger("app").addHandler(h)
        logging.getLogger("app").setLevel(
            logging.DEBUG if os.environ.get("SIM_APP_DEBUG") else logging.INFO)
    ctx = json.loads((FIXTURE_DIR / "yoga_agent_context.json").read_text(encoding="utf-8"))
    keys = ([s.key for s in SCENARIOS if args.real_stt or not s.real_stt]
            if args.scenarios == "all" else args.scenarios.split(","))
    results = []
    for k in keys:
        sc = BY_KEY[k]
        sc_ctx = (json.loads((FIXTURE_DIR / sc.context).read_text(encoding="utf-8"))
                  if sc.context else ctx)
        try:
            res = await run_scenario(sc, sc_ctx, args.verbose, args.real_stt)
        except Exception as e:  # noqa: BLE001
            res = {"key": k, "fails": [f"run error: {type(e).__name__}: {str(e)[:160]}"], "turn_latency": []}
        behaviour = [x for x in res["fails"] if not x.startswith("SHAPE:")]
        if behaviour and args.ci:
            # ONE immediate re-run of a failed scenario. hindi_pieces_bare_acks
            # (2026-09-29) passed 11/11 alone and 3/5 in full runs, failing only
            # with zero LLM runs — the CI runner's timing, not the pipeline
            # (the same rule never misfired on 263 live calls). A second failure
            # still blocks the deploy; a pass is reported as FLAKY, never hidden.
            first = res["fails"]
            try:
                res = await run_scenario(sc, sc_ctx, args.verbose, args.real_stt)
            except Exception as e:  # noqa: BLE001
                res = {"key": k, "fails": [f"run error: {type(e).__name__}: {str(e)[:160]}"],
                       "turn_latency": []}
            if not [x for x in res["fails"] if not x.startswith("SHAPE:")]:
                res["flaky_first_run"] = first
                print(f"FLAKY {k}: failed once, passed on re-run — first run: {first}")
                print(f"::warning title=Timing simulator flaky::{k} failed once and passed "
                      f"on re-run: {'; '.join(first)[:300]}")
        results.append(res)
        # SHAPE: the behaviour checks passed but the scenario did not stage the
        # case it exists for on this machine — reported, never a pass, never a
        # deploy blocker (its forced twin is).
        bad = [x for x in res["fails"] if not x.startswith("SHAPE:")]
        st = "FAIL" if bad else ("SHAPE" if res["fails"] else "ok  ")
        if st == "SHAPE" and args.ci:
            print(f"::warning title=Timing simulator scenario shape::{k}: "
                  f"{'; '.join(res['fails'])[:300]}")
        print(f"{st} {k:28s} latency {res.get('turn_latency')} ended {res.get('ended_at')} nudges {res.get('nudges', '?')} llm_runs {res.get('llm_runs', '?')}")
        for f in res["fails"]:
            print(f"       ✗ {f}")
    Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"report → {args.out}")
    # A finished call must leave nothing behind. From 2026-09-11 to 09-30 every
    # call's pipeline (VAD + Smart Turn ONNX sessions, ~35 MB) stayed alive via a
    # never-cancelled task, and the Mumbai box was OOM-killed 20 times.
    # Let cancelled tasks unwind — and pipecat's TurnTrackingObserver turn-end
    # timer fire: it holds a FramePushed (so the whole pipeline) for 2.5 s after
    # the bot's last audio. A call that ends right after the bot spoke is still
    # reachable until then; that is a delay, not a leak.
    await asyncio.sleep(3.0)
    import gc
    gc.collect()
    alive_objs = [o for o in gc.get_objects() if type(o).__name__ == "PipelineTask"]
    alive = len(alive_objs)
    leftover = sorted({t.get_name() for t in asyncio.all_tasks() if t is not asyncio.current_task()})
    print(f"{'FAIL' if alive else 'ok  '} no_pipeline_outlives_its_call   "
          f"pipelines alive {alive} of {len(results)} runs; tasks left {leftover[:6]}")
    if alive_objs:
        for line in _holders(alive_objs[0], ignore={id(alive_objs)}):
            print(f"       ✗ held by: {line}")
    if args.ci and (alive or any(x for r in results for x in r["fails"]
                                 if not x.startswith("SHAPE:"))):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
