"""STT / LLM / TTS provider factory — the ONLY module that knows vendor SDKs.

Mirrors the validated POC's ``services.py`` (github.com/shreyash-jain/sales-poc-ai):
Sarvam end-to-end (Saaras STT, Sarvam-M via the OpenAI-compatible endpoint, Bulbul
TTS) with an OpenRouter LLM fallback. Swapping a vendor = editing this file only;
bot.py and the transports never change.
"""
from __future__ import annotations

from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.sarvam.tts import SarvamTTSService

from .sarvam_v4_voices import SARVAM_V4_DEFAULT_VOICE, SARVAM_V4_MODEL, SARVAM_V4_VOICES
from pipecat.services.tts_service import InterruptibleTTSService, TTSService


from .config import get_settings

import asyncio
import json
import logging
import re
import time
from typing import Optional

logger = logging.getLogger("voice_bot")

# A chunk with no word character is not speech. Sarvam REJECTS such input with
# "Text must contain at least one character from the allowed languages" — and
# pipecat 0.0.95 only logs that error and pushes an ErrorFrame: it never closes
# the socket, so `run_tts`'s `state is State.CLOSED` guard never fires and every
# LATER reply is sent into a dead-but-open socket, producing ZERO audio until our
# stall watchdog notices ~3.5s later. That is the 8-10.4s dead air the founder
# heard on 2026-07-29 (13 stalls / 7 of 220 calls). \w minus '_' , Unicode-aware
# so Devanagari counts as a word character.
_WORD_CHAR_RE = re.compile(r"[^\W_]", re.UNICODE)


def has_word_char(text: str | None) -> bool:
    """True if `text` contains at least one letter/digit in ANY script."""
    return bool(text) and _WORD_CHAR_RE.search(text) is not None


def _register_saaras_v4() -> bool:
    """Teach pipecat 1.4 about saaras:v4 (our production STT model).

    1.4's MODEL_CONFIGS table stops at saaras:v3 and REJECTS anything else with
    ValueError("Unsupported model") — which would crash build_stt on every call.
    Caught by the migration dry-run, never by a test.

    This is a DATA entry, not a behaviour patch: v4 is v3's capability shape
    (language pin + mode + server VAD params on the transcribe endpoint), which
    is exactly what we proved in production for a month via the 0.0.95 socket
    shim. Downgrading instead is worse: saaras:v3 garbled code-switched Hinglish
    ("Myapolicil tme we face") and saarika:v2.5 transliterated English callers
    into Devanagari and went deaf on a live call.

    Returns True when v4 is registered/known; False means we must fall back.
    """
    try:
        from pipecat.services.sarvam import stt as _sarvam_stt
        configs = _sarvam_stt.MODEL_CONFIGS
        if "saaras:v4" in configs:
            return True
        base = configs.get("saaras:v3")
        if base is None:
            return False
        import dataclasses
        configs["saaras:v4"] = dataclasses.replace(base)
        logger.info("stt: registered saaras:v4 with pipecat (v3 capability shape)")
        return True
    except Exception:
        logger.exception("stt: could not register saaras:v4 — falling back to v3")
        return False


def _smallest_with_finalize_retry(base, retry_secs: float, retries: int,
                                  hold_below: float = 0.0, hold_secs: float = 0.0):
    """Subclass that asks Pulse AGAIN when a caller turn produced no transcript.

    pipecat sends `{"type":"finalize"}` the moment our VAD says the caller
    stopped. Pulse decodes whatever it has; on a one-word answer that is ~0.3 s
    of audio and it answers ~2.5 s late, or silently drops the utterance (see
    Settings.smallest_finalize_retry_secs for the measurements and the two
    alternatives). Re-sending finalize costs nothing on a healthy turn — the
    flag is already set by then and no message goes out — and recovers the
    stuck one in ~0.8 s.

    A new VAD onset cancels anything pending: that turn will send its own.
    """
    if retry_secs <= 0 or retries <= 0:
        return base                       # kill switch: plain pipecat
    import asyncio as _asyncio
    import json as _json
    import time as _time
    from pipecat.frames.frames import (VADUserStartedSpeakingFrame,
                                       VADUserStoppedSpeakingFrame)
    from pipecat.services.stt_service import WebsocketSTTService

    class _FinalizeRetrySTT(base):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self._got_final = True
            self._retry_task = None
            self._hold_task = None
            self._speaking_since = 0.0

        async def _process_response(self, data):
            # ONLY a real final counts as "it answered". Keepalives and empty
            # finals are exactly the case we are retrying for.
            try:
                if data.get("is_final") and (data.get("transcript") or "").strip():
                    self._got_final = True
            except Exception:
                pass
            return await super()._process_response(data)

        def _cancel_retry(self):
            t, self._retry_task = self._retry_task, None
            if t is not None and not t.done():
                t.cancel()

        async def _retry_finalize(self):
            try:
                for n in range(retries):
                    await _asyncio.sleep(retry_secs)
                    if self._got_final:
                        return
                    ws = getattr(self, "_websocket", None)
                    state = getattr(ws, "state", None)
                    if ws is None or state is None or state.name != "OPEN":
                        return
                    await ws.send(_json.dumps({"type": "finalize"}))
                    logger.info("stt: no transcript %.1fs after the turn closed — "
                                "asking Pulse again (%d/%d)",
                                retry_secs * (n + 1), n + 1, retries)
            except _asyncio.CancelledError:
                pass
            except Exception:
                logger.warning("stt: finalize retry failed", exc_info=True)

        async def _hold_then_finalize(self, wait: float):
            """A VAD stop inside the first `hold_below` seconds of a turn is
            usually a breath ("Uh," … "I think mix"), not the end. Sending
            finalize there made Pulse return an empty final for the prefix and
            DROP the rest of the sentence (calls 82c1f95a x2, 91d1541e, 15aadcdb:
            5-6 s utterances with no transcript at all). Hold it; a new VAD
            onset inside the hold cancels it and the real stop sends its own."""
            try:
                await _asyncio.sleep(wait)
                ws = getattr(self, "_websocket", None)
                state = getattr(ws, "state", None)
                if ws is not None and state is not None and state.name == "OPEN":
                    await ws.send(_json.dumps({"type": "finalize"}))
                self._got_final = False
                self._cancel_retry()
                self._retry_task = self.create_task(self._retry_finalize())
            except _asyncio.CancelledError:
                pass

        async def process_frame(self, frame, direction):
            if isinstance(frame, VADUserStartedSpeakingFrame):
                self._cancel_retry()
                self._cancel_hold()
                if not self._speaking_since:
                    self._speaking_since = _time.time()
            if isinstance(frame, VADUserStoppedSpeakingFrame) and hold_below > 0:
                spoken = _time.time() - (self._speaking_since or _time.time())
                if 0 <= spoken < hold_below:
                    # Everything the base class does EXCEPT the finalize.
                    await WebsocketSTTService.process_frame(self, frame, direction)
                    self._cancel_hold()
                    self._hold_task = self.create_task(self._hold_then_finalize(hold_secs))
                    return
            await super().process_frame(frame, direction)
            if isinstance(frame, VADUserStoppedSpeakingFrame):
                # super() has just sent the first finalize.
                self._speaking_since = 0.0
                self._got_final = False
                self._cancel_retry()
                self._retry_task = self.create_task(self._retry_finalize())

        def _cancel_hold(self):
            t, self._hold_task = getattr(self, "_hold_task", None), None
            if t is not None and not t.done():
                t.cancel()

    _FinalizeRetrySTT.__name__ = base.__name__
    return _FinalizeRetrySTT


def build_stt(sample_rate: int, language: str | None = None, bias: str | None = None,
              mode: str | None = None, provider: str | None = None):
    """STT factory with a provider switch (STT_PROVIDER=sarvam|google|smallest).

    Why the switch exists: across the founder's four 2026-08-05 test calls the
    chronic offender was Saaras — interjections the VAD heard but STT never
    transcribed (the "gap"), 3.8-4.4s finals, mid-phrase fragment splits, and
    garbage like "जी, चॉपी अच्छा". Google STT (same GCP project as the Vertex
    LLM, streaming v2 with INTERIM results — which Sarvam never sends) is the
    comparison arm. Flip per call via the env; nothing else changes.

    pipecat 1.4 note: Sarvam mode/language/prompt/high-vad are NATIVE now
    (settings=), so the 0.0.95 socket-proxy shim era is over. ttfs_p99_latency
    matters: the Smart Turn stop strategy HOLDS the user turn for
    max(0, ttfs_p99 - vad_stop) waiting for a final (Sarvam never flags
    finalized=True). The pipecat default 1.17 adds ~1s of dead air per turn —
    the POC ships 0.5.
    """
    s = get_settings()
    provider = (provider or s.stt_provider or "sarvam").strip().lower()
    if provider == "google":
        from pipecat.services.google.stt import GoogleSTTService
        langs = []
        for t in ((language or s.google_stt_language) or "hi-IN").split(","):
            t = t.strip()
            if not t:
                continue
            try:
                from pipecat.transcriptions.language import Language
                langs.append(Language(t))
            except Exception:
                logger.warning("build_stt: unknown google language tag %r", t)
        creds = s.vertex_credentials_json.strip() or None
        return GoogleSTTService(
            credentials=creds,
            credentials_path=(s.vertex_credentials_path.strip() or None) if not creds else None,
            location=s.google_stt_location,
            sample_rate=sample_rate,
            params=GoogleSTTService.InputParams(
                languages=langs or None,
                model=s.google_stt_model,
                enable_automatic_punctuation=True,
                # Interims give the turn-stop strategy real-time evidence and let
                # the turn-gate see words sooner than Sarvam ever could.
                enable_interim_results=True,
            ),
        )
    if provider == "smallest":
        from pipecat.services.smallest.stt import SmallestSTTService
        stt_cls = _smallest_with_finalize_retry(
            SmallestSTTService, s.smallest_finalize_retry_secs,
            s.smallest_finalize_retries,
            hold_below=s.smallest_hold_below_secs, hold_secs=s.smallest_hold_secs)
        stt_cls = decoupled_stt_io(stt_cls, s.stt_stall_secs)
        # Per-agent pins arrive as BCP-47 ("hi-IN"); Pulse wants bare codes and
        # has no Hinglish code, "hi" IS the code-switching mode. Unknown → default.
        tag = (language or "").strip().lower()
        lang = {"hi-in": "hi", "hi": "hi", "hinglish": "hi", "en-in": "en", "en": "en",
                "en-us": "en", "mr-in": "mr", "gu-in": "gu", "bn-in": "bn", "ta-in": "ta",
                "te-in": "te", "kn-in": "kn", "ml-in": "ml", "or-in": "or",
                "multi": "multi"}.get(tag) or s.smallest_stt_language
        if not s.smallest_api_key:
            raise RuntimeError("STT_PROVIDER=smallest but SMALLEST_API_KEY is empty")
        return stt_cls(
            api_key=s.smallest_api_key,
            sample_rate=sample_rate,
            settings=SmallestSTTService.Settings(language=lang),
            ttfs_p99_latency=s.smallest_ttfs_p99,
        )
    # ── Sarvam (default) ──
    mode = (mode or s.sarvam_stt_mode or "transcribe").strip()
    stt_model = (s.sarvam_stt_model or "").strip()
    # saaras:v4 is not in pipecat 1.4's model table; register it (v3's capability
    # shape) or fall back to v3 rather than raising on every call.
    if "v4" in stt_model and not _register_saaras_v4():
        logger.warning("stt: saaras:v4 unavailable on this pipecat — using saaras:v3")
        stt_model = "saaras:v3"
    tag = language or s.sarvam_stt_language
    # ASK pipecat what this model accepts instead of guessing. 1.4 raises on any
    # unsupported field ("does not support prompt parameter"), and the families
    # differ in BOTH directions: saaras:v2.5 takes a prompt but no language;
    # saaras:v3/v4 take language + mode + server VAD params but NO prompt;
    # saarika takes language only. Guessing here cost a whole dry-run cycle.
    caps = None
    try:
        from pipecat.services.sarvam import stt as _sarvam_stt
        caps = _sarvam_stt.MODEL_CONFIGS.get(stt_model)
    except Exception:
        pass

    def _supports(field: str, default: bool) -> bool:
        return bool(getattr(caps, f"supports_{field}", default)) if caps else default

    settings_kwargs = {"model": stt_model}
    if tag and _supports("language", True):
        # An unknown tag must not take high_vad down with it (deep-review B2),
        # hence the per-field guard.
        try:
            from pipecat.transcriptions.language import Language
            settings_kwargs["language"] = Language(tag)
        except Exception:
            logger.warning("build_stt: unknown language tag %r — auto-detect", tag)
    if bias and _supports("prompt", False):
        settings_kwargs["prompt"] = bias[:200]
    if s.sarvam_stt_high_vad and _supports("vad_params", False):
        settings_kwargs["high_vad_sensitivity"] = True
    try:
        stt_settings = SarvamSTTService.Settings(**settings_kwargs)
    except Exception:
        logger.warning("build_stt: Settings rejected %r — model only", settings_kwargs)
        stt_settings = SarvamSTTService.Settings(model=stt_model)
    _cls = final_after_flush(SarvamSTTService) if s.sarvam_final_on_flush else SarvamSTTService
    _cls = decoupled_stt_io(_cls, s.stt_stall_secs)
    return _cls(
        api_key=s.sarvam_api_key,
        # Capability-gated, same reason as the settings above: saaras:v2.5 (a
        # documented SARVAM_STT_MODEL rollback target) has supports_mode=False
        # and 1.4 raises "does not support mode parameter" — that would have
        # crashed every call the moment anyone used the rollback.
        mode=mode if _supports("mode", False) else None,
        sample_rate=sample_rate,
        settings=stt_settings,
        ttfs_p99_latency=s.sarvam_ttfs_p99,
    )


def final_after_flush(cls):
    """Subclass a Sarvam STT so the transcript it sends in answer to our flush
    is flagged finalized=True.

    pipecat's Sarvam service flushes on every VAD stop (flush_signal) and
    Sarvam answers with the utterance's final ~0.08 s later — but never flags
    it, so TurnAnalyzerUserTurnStopStrategy treats it as provisional and waits
    out its STT safety timeout before closing the turn: 0.30 s of dead air on
    every turn of the 22 Sep batch. Only finals between a VAD stop and the next
    VAD start are flagged; one Sarvam emits mid-utterance (on its own
    segmentation) stays unflagged, so the turn cannot close on half a
    sentence. Not applied when Sarvam's own VAD drives it (vad_signals): then
    no flush is sent."""
    from pipecat.frames.frames import (InterimTranscriptionFrame, TranscriptionFrame,
                                       VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame)
    from pipecat.processors.frame_processor import FrameDirection as _Dir

    class _FinalOnFlush(cls):
        _after_flush = False

        async def process_frame(self, frame, direction):
            if isinstance(frame, VADUserStartedSpeakingFrame):
                self._after_flush = False
            elif isinstance(frame, VADUserStoppedSpeakingFrame):
                settings = getattr(self, "_settings", None)
                self._after_flush = not bool(getattr(settings, "vad_signals", False) is True)
            await super().process_frame(frame, direction)

        async def push_frame(self, frame, direction=_Dir.DOWNSTREAM):
            if (self._after_flush and isinstance(frame, TranscriptionFrame)
                    and not isinstance(frame, InterimTranscriptionFrame)
                    and (frame.text or "").strip()):
                frame.finalized = True
            await super().push_frame(frame, direction)

    _FinalOnFlush.__name__ = cls.__name__
    _FinalOnFlush.__qualname__ = cls.__qualname__
    return _FinalOnFlush


def decoupled_stt_io(cls, stall_secs: float, backlog_secs: float = 10.0):
    """Subclass a websocket STT service so the vendor's socket can never hold
    up the pipeline, and a stuck socket fails over in `stall_secs`.

    WHY. pipecat processes an InputAudioRawFrame — a SystemFrame — INLINE in
    the STT service's input task, and that task is the only thing that moves
    any frame through the service: STTService.process_audio_frame awaits
    run_stt, and Sarvam's run_stt awaits the socket's send. Call 3e327e8a
    (2026-10-02): Sarvam's account ran out of credit, its server sent a close
    frame (1003 "Credits exhausted") and kept the TCP open, and the sarvamai
    SDK's websockets legacy client made every send wait in ensure_open() for the
    closing handshake — close_timeout, 10 s (connected 07:10:25.823, error
    07:10:35.838). Behind that one send: the caller's audio (the VAD downstream
    heard nothing, then 10 s of it in one burst), the scripted opening queued at
    +1.24 s (played at +13.76 s), and every nudge, cue and switch frame queued
    from the pipeline source. 11 of 43 answered calls that morning waited > 5 s
    for the opening; parents hung up.

    WHAT. The vendor-facing work runs in this service's own I/O task, in
    arrival order: each audio chunk's send (the vendor's own run_stt) and the
    VAD frames whose handling sends a flush/finalize. The pipeline side only
    queues them, so audio passes downstream and every other frame flows on
    whatever the socket does. On a healthy socket a send completes in
    microseconds, so the queue is empty and the vendor sees exactly what it saw
    before, at the same moments.

    STUCK = a send (or flush) still not finished after `stall_secs`. That is
    the socket's own signal, not the caller's: audio — silence included — goes
    out 50 times a second, so a quiet caller never stalls a healthy socket. A
    stuck primary hands its queue (the caller's words since it stuck) to the
    fallback set by set_stall_handoff, ahead of the live audio, then pushes a
    non-fatal ErrorFrame so the waterfall switches now rather than at the
    vendor's eventual error. With no fallback it logs, counts, and keeps the
    newest `backlog_secs` queued until the socket recovers or errors.

    stall_secs <= 0: the class unchanged (kill switch, STT_STALL_SECS=0)."""
    if stall_secs <= 0:
        return cls
    import collections
    from pipecat.frames.frames import VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame

    class _DecoupledIO(cls):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self._io_jobs = collections.deque()
            self._io_bytes = 0                 # queued audio, for the backlog cap
            self._io_wake: Optional[asyncio.Event] = None
            self._io_task = None
            self._io_watch_task = None
            self._io_busy_since = 0.0          # monotonic start of the job in flight
            self._io_stalled = False
            self._io_handoff = None            # the fallback STT (build_stt_waterfall)
            self._io_redirect = None           # after a stall: where our jobs go
            self._io_diag = None
            self._io_dropped = 0

        def set_stall_handoff(self, fallback) -> None:
            self._io_handoff = fallback

        def set_diagnostics(self, diag) -> None:
            self._io_diag = diag
            parent = getattr(super(), "set_diagnostics", None)
            if parent is not None:
                parent(diag)

        # -- lifecycle -------------------------------------------------------
        async def start(self, frame):
            await super().start(frame)
            if self._io_task is None:
                self._io_wake = asyncio.Event()
                self._io_task = self.create_task(self._io_loop(), name="stt_io")
                self._io_watch_task = self.create_task(self._io_watch(), name="stt_io_watch")

        async def _io_stop(self):
            for name in ("_io_watch_task", "_io_task"):
                t = getattr(self, name)
                setattr(self, name, None)
                if t is not None:
                    await self.cancel_task(t)

        async def stop(self, frame):
            await self._io_stop()
            await super().stop(frame)

        async def cancel(self, frame):
            await self._io_stop()
            await super().cancel(frame)

        # -- the pipeline side: queue, never wait on the socket ---------------
        async def run_stt(self, audio: bytes):
            if self._io_task is None:          # not started (or stopping): as before
                async for f in super().run_stt(audio):
                    yield f
                return
            self._io_put(("audio", audio))
            yield None

        async def process_frame(self, frame, direction):
            if (self._io_task is not None
                    and isinstance(frame, (VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame))):
                # Sarvam flushes and Smallest finalizes on the VAD stop: a send.
                # Behind the audio that came before it, like the vendor expects.
                self._io_put(("frame", frame, direction))
                return
            await super().process_frame(frame, direction)

        def _io_put(self, job) -> None:
            if self._io_redirect is not None:
                self._io_redirect._io_put(job)
                return
            self._io_jobs.append(job)
            if job[0] == "audio":
                self._io_bytes += len(job[1])
                cap = int(backlog_secs * (self.sample_rate or 8000) * 2)
                while self._io_bytes > cap:
                    old = next((j for j in self._io_jobs if j[0] == "audio"), None)
                    if old is None:
                        break
                    self._io_jobs.remove(old)
                    self._io_bytes -= len(old[1])
                    self._io_dropped += 1
            if self._io_wake is not None:
                self._io_wake.set()

        # -- the vendor side ---------------------------------------------------
        async def _io_loop(self):
            while True:
                if not self._io_jobs:
                    self._io_wake.clear()
                    await self._io_wake.wait()
                    continue
                job = self._io_jobs.popleft()
                if job[0] == "audio":
                    self._io_bytes -= len(job[1])
                self._io_busy_since = time.monotonic()
                try:
                    if job[0] == "audio":
                        await self.process_generator(super().run_stt(job[1]))
                    else:
                        await super().process_frame(job[1], job[2])
                except asyncio.CancelledError:
                    raise
                except Exception as e:         # what pipecat's frame task does with it
                    await self.push_error(error_msg=f"Error processing frame: {e}", exception=e)
                finally:
                    self._io_busy_since = 0.0
                    if self._io_stalled and self._io_redirect is None:
                        self._io_stalled = False   # it recovered: watch again

        async def _io_watch(self):
            tick = min(0.25, stall_secs / 4)
            while True:
                await asyncio.sleep(tick)
                t0 = self._io_busy_since
                if t0 and not self._io_stalled and time.monotonic() - t0 >= stall_secs:
                    self._io_stalled = True
                    try:
                        await self._io_on_stall(time.monotonic() - t0)
                    except Exception:
                        logger.exception("stt: stall handling failed")

        async def _io_on_stall(self, stuck: float):
            queued = sum(len(j[1]) for j in self._io_jobs if j[0] == "audio")
            queued_secs = queued / 2.0 / float(self.sample_rate or 8000)
            if self._io_diag is not None:
                self._io_diag.bump("stt_stalls")
            fb = self._io_handoff
            if fb is None or getattr(fb, "_io_task", None) is None:
                logger.warning("stt: %s has not finished a send in %.1fs — the vendor socket is "
                               "stuck and there is no fallback (%.1fs of caller audio queued, "
                               "the newest %.0fs kept)", type(self).__name__, stuck, queued_secs,
                               backlog_secs)
                return
            # The caller's words since the socket stuck go to the fallback FIRST,
            # in order — before the switch, so before any live audio reaches it.
            jobs = list(self._io_jobs)
            self._io_jobs.clear()
            self._io_bytes = 0
            self._io_redirect = fb
            for j in jobs:
                fb._io_put(j)
            logger.warning("stt: %s has not finished a send in %.1fs — the vendor socket is "
                           "stuck; failing over to %s with %.1fs of the caller's audio",
                           type(self).__name__, stuck, type(fb).__name__, queued_secs)
            await self.push_error(
                error_msg=f"STT vendor socket stuck: a send has not completed in {stuck:.1f}s",
                fatal=False)

    _DecoupledIO.__name__ = cls.__name__
    _DecoupledIO.__qualname__ = cls.__qualname__
    return _DecoupledIO


class _PersistentClientSession:
    """Wraps an aiobotocore session so `create_client(...)` hands back ONE
    long-lived client instead of building a new one per request.

    pipecat 1.4's AWSBedrockLLMService opens `async with
    session.create_client(...)` inside every generation. Measured from the
    Mumbai box (2026-09-10): that costs 2.0-2.2s PER TURN before the request
    even leaves — with a reused client the same call answers in 0.2-0.4s. For
    a voice agent that difference is the whole product, so the client is
    created once and closed when the service stops."""

    def __init__(self, session):
        self._session = session
        self._client = None
        self._cm = None
        self._lock = asyncio.Lock()

    def create_client(self, service_name, **kwargs):
        outer = self

        class _Reuse:
            async def __aenter__(self_):
                async with outer._lock:
                    if outer._client is None:
                        outer._cm = outer._session.create_client(service_name, **kwargs)
                        outer._client = await outer._cm.__aenter__()
                return outer._client

            async def __aexit__(self_, *exc):
                return False          # keep it open; close() ends it

        return _Reuse()

    async def close(self):
        cm, self._cm, self._client = self._cm, None, None
        if cm is not None:
            try:
                await cm.__aexit__(None, None, None)
            except Exception:
                logger.debug("bedrock: client close failed", exc_info=True)


def _build_bedrock(s):
    from pipecat.services.aws.llm import AWSBedrockLLMService

    # Not on EC2. With a bearer token and no static keys, botocore's credential
    # chain probes the instance-metadata address and waits for it to time out:
    # measured 2.21s per service construction on the Mumbai box vs 0.02s with
    # the probe disabled (calls 09c5279a / f225f71e opened at +4.5-4.8s
    # instead of +1-2s). The token is read from AWS_BEARER_TOKEN_BEDROCK
    # regardless, so nothing is lost by skipping the probe.
    import os
    os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")

    try:
        extra = json.loads(s.bedrock_extra_json) if s.bedrock_extra_json.strip() else {}
        if not isinstance(extra, dict):
            raise ValueError("BEDROCK_EXTRA_JSON must be a JSON object")
    except Exception:
        logger.warning("bedrock: BEDROCK_EXTRA_JSON invalid — sending no extra fields")
        extra = {}

    class _BedrockLLM(AWSBedrockLLMService):
        def __init__(self, **kw):
            super().__init__(**kw)
            self._aws_session = _PersistentClientSession(self._aws_session)

        async def _warm(self):
            try:
                async with self._aws_session.create_client(
                        service_name="bedrock-runtime", **self._aws_params):
                    pass
            except Exception:
                logger.warning("bedrock: client warm-up failed — first turn will open it",
                               exc_info=True)

        async def start(self, frame):
            # Open the client at pipeline start, while the greeting is still
            # being spoken — otherwise the FIRST reply of every call pays the
            # ~2s client creation (measured 2.93s TTFT on turn 1 vs 0.56s after).
            # In the BACKGROUND: awaiting it here held the StartFrame, so the
            # whole pipeline (and the greeting audio) waited for it — call
            # 09c5279a was ready at +7.1s and the caller's hello sat unanswered.
            await super().start(frame)
            self._warm_task = asyncio.get_running_loop().create_task(self._warm())

        async def stop(self, frame):
            await super().stop(frame)
            await self._aws_session.close()

        async def cancel(self, frame):
            await super().cancel(frame)
            await self._aws_session.close()

    svc = _BedrockLLM(
        model=s.bedrock_model,
        aws_region=s.bedrock_region,
        params=AWSBedrockLLMService.InputParams(
            temperature=0.35, max_tokens=300,
            additional_model_request_fields=extra),
    )
    return _tag_engine(svc, "bedrock", s.bedrock_model)


class _FirstChunkGuard:
    """Wraps the vendor's chat stream so the FIRST chunk is bounded in time.
    `create()` returns once the headers arrive; a stalling model can hold the
    stream open with no token for as long as it likes (call f58ca825,
    2026-09-22: 34 s and 49 s to first token, then a 403). Everything after
    the first chunk passes straight through; attributes (close, response…)
    are delegated to the real stream."""

    def __init__(self, stream, secs: float):
        self._stream = stream
        self._secs = secs
        self._it = None
        self._first = True

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._it is None:
            self._it = self._stream.__aiter__()
        if self._first:
            self._first = False
            try:
                return await asyncio.wait_for(self._it.__anext__(), timeout=self._secs)
            except asyncio.TimeoutError as e:
                raise TimeoutError(f"LLM first token not received within {self._secs:.1f}s") from e
        return await self._it.__anext__()

    async def aclose(self):
        it = self._it if self._it is not None else self._stream
        if hasattr(it, "aclose"):
            await it.aclose()

    def __getattr__(self, name):
        return getattr(self._stream, name)


def with_first_token_timeout(cls, secs: float):
    """Subclass an OpenAI-compatible pipecat LLM service so a reply whose
    first token does not arrive within `secs` fails fast. The failure is an
    ordinary exception inside pipecat's LLMContextFrame handling, so it
    becomes a non-fatal ErrorFrame — which is exactly what ServiceSwitcher's
    failover strategy switches on. 0 or None = no timeout."""
    if not secs or secs <= 0:
        return cls

    class _Guarded(cls):
        first_token_timeout_secs = float(secs)

        async def get_chat_completions(self, context):
            t = self.first_token_timeout_secs
            try:
                stream = await asyncio.wait_for(super().get_chat_completions(context), timeout=t)
            except asyncio.TimeoutError as e:
                raise TimeoutError(f"LLM did not answer within {t:.1f}s (connect)") from e
            return _FirstChunkGuard(stream, t)
    _Guarded.__name__ = cls.__name__
    _Guarded.__qualname__ = cls.__qualname__
    return _Guarded


def with_stream_first_token_timeout(cls, secs: float):
    """The same guard for pipecat's Google (Gemini/Vertex) service, which
    streams through _stream_content instead of get_chat_completions. A 429 or
    a stall before the first chunk raises inside _process_context, which
    pipecat turns into a non-fatal ErrorFrame — the failover trigger."""
    if not secs or secs <= 0:
        return cls

    class _Guarded(cls):
        first_token_timeout_secs = float(secs)

        async def _stream_content(self, context):
            t = self.first_token_timeout_secs
            try:
                stream = await asyncio.wait_for(super()._stream_content(context), timeout=t)
            except asyncio.TimeoutError as e:
                raise TimeoutError(f"LLM did not answer within {t:.1f}s (connect)") from e
            return _FirstChunkGuard(stream, t)
    _Guarded.__name__ = cls.__name__
    _Guarded.__qualname__ = cls.__qualname__
    return _Guarded


def with_retire(cls):
    """The PRIMARY of an LLM waterfall retires the moment it fails a request.

    pipecat's failover strategy switches the ServiceSwitcher to the fallback
    when the primary's ErrorFrame passes it, and run_bot's on_pipeline_error
    re-runs the failed turn there. But a request already QUEUED in the primary
    (the caller's next words arrived while it stalled) is still processed by the
    primary after the error — a second generation beside the fallback's re-run.
    Retired synchronously in push_error_frame (before the error travels), such
    a request is dropped: its words are in the shared context, and the re-run
    answers them. `retire_on_error` is set per call by run_bot only when a
    fallback exists; a fatal error or one outside a request never retires."""
    from pipecat.frames.frames import LLMContextFrame, ServiceSwitcherRequestMetadataFrame

    class _Retiring(cls):
        retire_on_error = False
        retired = False
        errored_t = 0.0
        on_retired_drop = None
        _in_ctx = False

        async def process_frame(self, frame, direction):
            if (isinstance(frame, ServiceSwitcherRequestMetadataFrame)
                    and getattr(frame, "service", None) is self and self.retired):
                # The switcher made this service ACTIVE again (the fallback
                # failed too and failover went back round). The frame is queued
                # here in order, behind whatever was waiting at the failure —
                # those were dropped; what follows is new work (design review
                # 2026-10-01: never un-retired = a mute bot for the rest of the call).
                self.retired = False
                logger.info("llm: the switcher went back to the primary — it serves again")
            if isinstance(frame, LLMContextFrame):
                if self.retired:
                    logger.info("llm: the primary has retired — dropping a request queued "
                                "behind its failure (the fallback's re-run answers it)")
                    cb = self.on_retired_drop
                    if cb is not None:
                        try:
                            cb()
                        except Exception:
                            logger.exception("llm: retired-drop callback failed")
                    return
                self._in_ctx = True
                try:
                    await super().process_frame(frame, direction)
                finally:
                    self._in_ctx = False
                return
            await super().process_frame(frame, direction)

        async def push_error_frame(self, error):
            self.errored_t = time.time()
            if self.retire_on_error and self._in_ctx and not getattr(error, "fatal", False):
                self.retired = True
            await super().push_error_frame(error)
    _Retiring.__name__ = cls.__name__
    _Retiring.__qualname__ = cls.__qualname__
    return _Retiring


def build_llm_waterfall(provider: str | None = None):
    """(switcher_or_primary, primary, fallback). Like build_stt_waterfall: when
    LLM_FALLBACK_PROVIDER names a different provider that builds, the call
    runs pipecat's ServiceSwitcher with the failover strategy over the two,
    and a vendor error (a timeout, a 403, a 5xx) moves the rest of the call to
    the fallback. If the fallback cannot be built (no credentials on this box)
    the call runs on the primary alone, as before."""
    s = get_settings()
    prov = (provider or s.llm_provider or "").strip().lower()
    fb = (s.llm_fallback_provider or "").strip().lower()
    if not fb or fb == prov:
        primary = build_llm(provider)
        return primary, primary, None
    try:
        fallback = build_llm(fb)
    except Exception as e:
        logger.warning("llm: fallback provider %r could not be built (%s) — running on %s alone",
                       fb, e, prov)
        primary = build_llm(provider)
        return primary, primary, None
    # Only a primary that HAS somewhere to fail over to may give up early.
    primary = build_llm(provider, fail_fast=True)
    from pipecat.pipeline.service_switcher import (ServiceSwitcher,
                                                   ServiceSwitcherStrategyFailover)
    switcher = ServiceSwitcher([primary, fallback], strategy_type=ServiceSwitcherStrategyFailover)
    logger.info("llm: waterfall %s → %s", type(primary).__name__, type(fallback).__name__)
    return switcher, primary, fallback


def build_llm(provider: str | None = None, fail_fast: bool = False):
    """`provider` overrides LLM_PROVIDER for one call (per-agent POC routing —
    see Settings.sarvam_llm_agents). None = the configured default.
    fail_fast: this service is the primary of a waterfall, so a slow first
    token should hand the turn to the fallback sooner (Vertex only)."""
    s = get_settings()
    prov = (provider or s.llm_provider or "").strip().lower()
    _Timed = with_first_token_timeout(OpenAILLMService, s.llm_first_token_timeout_secs)
    if fail_fast:
        _Timed = with_retire(_Timed)
    if prov == "vertex":
        # Gemini on Vertex AI, served from vertex_location (asia-south1 = Mumbai):
        # in-country inference → low TTFT with no cross-ocean RTT. Auth = service
        # account JSON.
        #
        # THINKING MUST BE EXPLICITLY OFF. The comment that used to sit here said
        # "pipecat auto-disables Gemini thinking → the fast path". That was simply
        # untrue: InputParams.thinking defaults to None, pipecat sends no
        # thinkingConfig at all, and gemini-2.5-flash then applies its own DYNAMIC
        # thinking — it decides per request how long to reason before emitting a
        # first token.
        #
        # Which makes it a latency landmine, because it is a function of the
        # PROMPT. It cost 0.43s TTFB in the morning and 2.35s p50 / 5.76s p95 by
        # midday on 2026-08-06, with no LLM code change between — what changed was
        # that the system prompt grew richer (register rules, language rules, a
        # staged script with branching), so the model started thinking about it.
        #
        # Measured from the Mumbai box, same region, same model, idle host:
        #     thinking default : 2.16 / 2.43 / 2.55 s   (min/med/max of 3)
        #     thinking_budget=0: 0.37 / 0.51 / 0.91 s
        # 4.8x, for a scripted sales conversation that needs no reasoning at all.
        # Other regions were measured too and are all WORSE than Mumbai once
        # thinking is off (asia-southeast1 0.60, us-central1 0.62, global 0.82),
        # so the region was never the problem and does not change.
        from pipecat.services.google.llm import GoogleLLMService
        from pipecat.services.google.vertex.llm import GoogleVertexLLMService

        creds = s.vertex_credentials_json.strip() or None
        _Vertex = (with_retire(with_stream_first_token_timeout(GoogleVertexLLMService,
                                                               s.vertex_first_token_timeout_secs))
                   if fail_fast else GoogleVertexLLMService)
        return _Vertex(
            credentials=creds,
            credentials_path=(s.vertex_credentials_path.strip() or None) if not creds else None,
            project_id=s.vertex_project_id,
            location=s.vertex_location,
            model=s.vertex_model,
            params=GoogleLLMService.InputParams(
                temperature=0.35, max_tokens=300,
                thinking=GoogleLLMService.ThinkingConfig(
                    thinking_budget=s.vertex_thinking_budget)),
        )
    if prov == "google":
        # Gemini via its OpenAI-compat endpoint, hit directly (no proxy hop).
        # reasoning_effort 'none' via extra_body: 3.1 thinks by default.
        return _Timed(
            api_key=s.gemini_api_key,
            base_url=s.google_llm_base_url,
            model=s.google_llm_model,
            params=OpenAILLMService.InputParams(
                temperature=0.35, max_tokens=300,
                extra={"extra_body": {"reasoning_effort": "none"}},
            ),
        )
    if prov == "openrouter":
        from pipecat.services.openrouter.llm import OpenRouterLLMService

        return OpenRouterLLMService(
            api_key=s.openrouter_api_key,
            model=s.openrouter_model,
            params=OpenRouterLLMService.InputParams(temperature=0.35, max_tokens=300),
        )
    if prov == "bedrock":
        # Amazon Bedrock in Mumbai (see config.bedrock_model for the POC data).
        return _build_bedrock(s)
    # Sarvam's OpenAI-compatible chat API. reasoning_effort MUST be the literal
    # JSON null (Python None inside extra_body — the SDK drops None kwargs but
    # keeps them in extra_body): the ONLY value that disables hybrid thinking.
    # 0.14s median TTFT from Mumbai with null; 6-14s (or content=None) without.
    return _Timed(
        api_key=s.sarvam_llm_api_key,
        base_url=s.sarvam_llm_base_url,
        model=s.sarvam_llm_model,
        params=OpenAILLMService.InputParams(
            temperature=0.35, max_tokens=300,
            extra={"extra_body": {"reasoning_effort": None}},
        ),
    )


def build_stt_waterfall(sample_rate: int, language: str | None = None, bias: str | None = None,
                        mode: str | None = None):
    """(processor, primary, fallback): the STT to put in the pipeline. With
    STT_FALLBACK_PROVIDER set this is pipecat's ServiceSwitcher over the two
    vendors — only the active one receives audio (one vendor's cost at a
    time), a non-fatal ErrorFrame from the active one fails over on its own,
    and run_bot switches manually when the caller was audibly heard and no
    transcript came (the orphan re-ask). One way per call: nothing switches
    back. Without a fallback: the plain service, as before."""
    s = get_settings()
    primary = build_stt(sample_rate, language=language, bias=bias, mode=mode)
    fb = (s.stt_fallback_provider or "").strip().lower()
    if not fb or fb == (s.stt_provider or "sarvam").strip().lower():
        return primary, primary, None
    try:
        fallback = build_stt(sample_rate, language=language, bias=bias, mode=mode, provider=fb)
    except Exception:
        logger.exception("stt: fallback provider %r unavailable — no waterfall this call", fb)
        return primary, primary, None
    from pipecat.pipeline.service_switcher import (ServiceSwitcher,
                                                   ServiceSwitcherStrategyFailover)
    switcher = ServiceSwitcher([primary, fallback], strategy_type=ServiceSwitcherStrategyFailover)
    if hasattr(primary, "set_stall_handoff"):
        # A stuck primary socket hands the caller audio it could not send to
        # the fallback before the switch (decoupled_stt_io; call 3e327e8a).
        primary.set_stall_handoff(fallback)
    logger.info("stt: waterfall %s → %s", type(primary).__name__, type(fallback).__name__)
    return switcher, primary, fallback


def navana_keys(raw: Optional[str] = None) -> list:
    """NAVANA_API_KEY may hold several keys, comma-separated ("k1,k2,k3") —
    each Navana account allows only 2 concurrent streams, so capacity grows 2 per
    key. Whitespace and duplicates are ignored; order is kept."""
    if raw is None:
        raw = get_settings().navana_api_key
    out = []
    for k in (raw or "").split(","):
        k = k.strip().strip("\"'").strip()       # a secret pasted with quotes
        if k and k not in out:
            out.append(k)
    return out


class NavanaKeyPool:
    """Which Navana key a new connection should use. Single event loop, so no
    locks. A key's load is the number of LIVE holders (connected TTS sockets and
    in-flight one-shot renders) — tracked in a WeakSet, so a call that vanishes
    without closing cleanly cannot leave a key looking busy forever. Least-loaded
    wins; ties rotate (round-robin). A key that refused a handshake with
    concurrency_limit cools off for a few seconds and is tried last."""

    COOL_SECS = 5.0
    BAD_KEY_SECS = 60.0

    def __init__(self):
        import weakref
        self._weakref = weakref
        self._holders: dict = {}      # key -> WeakSet of holders
        self._cool: dict = {}         # key -> monotonic time the cool-off ends
        self._rr = 0

    def keys(self) -> list:
        return navana_keys()

    def load(self, key: str) -> int:
        hs = self._holders.get(key)
        return len(hs) if hs is not None else 0

    def index(self, key: Optional[str]) -> int:
        try:
            return self.keys().index(key)
        except ValueError:
            return -1

    def acquire(self, holder, exclude=()) -> Optional[str]:
        keys = self.keys()
        cands = [k for k in keys if k not in exclude]
        if not cands:
            return None
        now = time.monotonic()
        n = len(keys)
        rr = self._rr % n
        best = min(cands, key=lambda k: (self._cool.get(k, 0.0) > now,        # cooled keys last
                                         self.load(k),                        # least loaded
                                         (keys.index(k) - rr) % n))           # then round-robin
        self._rr = (keys.index(best) + 1) % n
        self._holders.setdefault(best, self._weakref.WeakSet()).add(holder)
        return best

    def release(self, holder, key: Optional[str]) -> None:
        hs = self._holders.get(key) if key else None
        if hs is not None:
            hs.discard(holder)

    def refused(self, key: Optional[str], secs: Optional[float] = None) -> None:
        """Rest a key: COOL_SECS after a capacity refusal; longer (BAD_KEY_SECS)
        after any other failure — a typo'd, revoked or out-of-credit key would
        otherwise look idle (load 0) and be picked FIRST for every call."""
        if key:
            self._cool[key] = time.monotonic() + (self.COOL_SECS if secs is None else secs)

    def loads(self) -> list:
        return [self.load(k) for k in self.keys()]


NAVANA_KEYS = NavanaKeyPool()


class _Lease:
    """A holder object for one-shot (REST) renders: weakref-able, per request."""


def _navana_seq_routing(cls):
    """Subclass Navana's BodhiTTSService so that, with ONE AUDIO CONTEXT PER
    SENTENCE (what the speech cache switches on), every chunk lands in the
    context of the sentence that asked for it.

    The SDK appends each chunk to get_active_audio_context_id() — the context
    PLAYING — which is right with one context per turn and wrong with one per
    sentence: the next sentence's audio would be filed under the previous one
    and a cached sentence queued behind it would stall until pipecat's idle
    timeout (the exact Smallest failure, call 5aa10e10). Navana makes the fix
    exact rather than inferred: every binary chunk is preceded by an `audio`
    header carrying the `seq` of the text frame it answers, and `is_last_chunk`
    marks that sentence's end. So seq -> context is recorded when run_tts sends,
    and the sentence's context is closed at its last chunk.

    SAID MUST MEAN HEARD (calls 18b63b17 / 45749163, 2026-09-30). pipecat
    appends a push_text_frames service's TTSTextFrame the moment run_tts
    returns — and Navana's run_tts only SENDS the text; the audio comes later on
    the receive loop. So each sentence's text went down the pipeline BEFORE its
    audio, past FloorGate (which starts holding at the first audio frame) and
    into the played transcript and the LLM context. A reply held because the
    parent was still talking, then dropped, still counted as said: the fees
    answer was refused as "already said" twice (the parent asked three times),
    the marks question never played and the line went quiet for 8.7 s. Every
    sentence's text is now held and released once 60 % of its own audio is out
    (NoRepeatGate's "mostly heard is heard" threshold): by `chunk_index`/
    `chunk_total` for a multi-chunk sentence, and by SPLITTING the audio frame at
    60 % when the text is still held at the sentence's last chunk — real Navana
    sends a sentence as ONE chunk (chunk_total 1). The output transport writes
    frames in order, so the text reaches the played transcript only once the
    parent has heard 60 % of the sentence. A reply
    FloorGate holds (from its first audio frame) keeps its text held with it and
    drops it with it; a sentence cut in its first half is re-sayable; one heard
    60-99 % is not repeated in full (an all-or-nothing "after the last chunk"
    rule re-asked a question the parent answered over its tail, and re-said a
    nearly finished opening). This applies with the cache off too (one context
    per turn).

    NO RECONNECT ON AN INTERRUPTION; RETRY A REFUSED HANDSHAKE. The account
    allows 2 concurrent streams. pipecat's InterruptibleTTSService closes and
    reopens the socket on every interruption while the bot is speaking, and
    Navana frees a closed socket's slot a moment late — so the fresh handshake
    was refused ("concurrency_limit") and that sentence was simply lost: 328
    refusals on 2026-09-30, in 8 of the 13 real conversations after 10:54 (6-48
    per call; calls cycled sockets several times a second). The reconnect is not
    needed for correctness: an interrupted reply's in-flight seqs are marked dead
    and whatever Navana still streams for them is dropped (it generates ~20x real
    time, so the next reply waits a few hundred ms at most). And a refused
    handshake is retried (0.25 / 0.5 / 1 s) instead of failing the sentence.
    """
    import asyncio as _asyncio
    from pipecat.services.tts_service import WebsocketTTSService as _WsTTS
    from pipecat.frames.frames import TTSTextFrame as _Text

    class _Routed(cls):
        def _nv_routing_on(self) -> bool:
            return not getattr(self, "_reuse_context_id_within_turn", True)

        def _nv_reset(self):
            self._nv_ctx = {}          # seq -> context_id, while its audio is still to come
            self._nv_cur_seq = None    # seq of the chunk header just received
            self._nv_cur_last = False
            self._nv_text = {}         # seq -> [TTSTextFrame] held until its last chunk
            self._nv_ctx_seq = {}      # context_id -> latest seq sent for it
            self._nv_dead = set()      # seqs of interrupted sentences: drop what still streams
            self._nv_cur_idx = None    # chunk_index / chunk_total of the header just received
            self._nv_cur_total = None

        async def append_to_audio_context(self, context_id, frame):
            if isinstance(frame, _Text) and not getattr(frame, "_nv_released", False):
                if not hasattr(self, "_nv_ctx"):
                    self._nv_reset()
                seq = self._nv_ctx_seq.get(context_id)
                if seq is not None and seq in self._nv_ctx:
                    self._nv_text.setdefault(seq, []).append(frame)
                    return
            await super().append_to_audio_context(context_id, frame)

        async def _nv_release_text(self, seq, ctx):
            for tf in self._nv_text.pop(seq, []):
                tf._nv_released = True
                await self.append_to_audio_context(ctx, tf)

        async def _nv_finish(self, seq, ctx):
            """The sentence's audio is complete: its text (if half-way did not
            already release it), then its stop."""
            self._nv_ctx.pop(seq, None)
            if self._nv_ctx_seq.get(ctx) == seq:
                self._nv_ctx_seq.pop(ctx, None)
            await self._nv_release_text(seq, ctx)
            from pipecat.frames.frames import TTSStoppedFrame as _Stopped
            await self.append_to_audio_context(ctx, _Stopped(context_id=ctx))
            # One context per sentence: close it so the next plays at once
            # (closing ends the queue, not the playout).
            if self._nv_routing_on() and self.audio_context_available(ctx):
                await self.remove_audio_context(ctx)

        async def push_error(self, *args, **kwargs):
            if getattr(self, "_nv_quiet", False):
                # A handshake attempt we are about to retry: not an error yet.
                self._nv_last_error = str(kwargs.get("error_msg") or (args[0] if args else ""))
                return
            await super().push_error(*args, **kwargs)

        async def _connect_websocket(self):
            from websockets.protocol import State as _State
            if self._websocket is not None and getattr(self._websocket, "state", None) is _State.OPEN:
                return                                  # already connected: keep the seq state
            # A fresh socket restarts seq at 1 (the SDK resets it on ready).
            self._nv_reset()
            # A lazy reconnect over a closed socket (the SDK's run_tts) may come
            # here still holding the old key: give it back first.
            NAVANA_KEYS.release(self, getattr(self, "_nv_key", None))
            self._nv_key = None
            # KEYS: the least-loaded of NAVANA_API_KEY's comma-separated keys. A
            # key that fails the handshake is rested (5 s for concurrency_limit,
            # 60 s for anything else — bad/revoked key, no credit) and the NEXT
            # key is tried at once; only when every key failed, back off and go
            # round again (0.25 / 0.5 / 1 s), then report.
            delays = (0.25, 0.5, 1.0)
            refusals, tried, rounds = 0, set(), 0
            while True:
                key = NAVANA_KEYS.acquire(self, exclude=tried)
                if key is None:                         # every key refused this round
                    if rounds >= len(delays):
                        await super().push_error(error_msg=self._nv_last_error or
                                                 f"{self} navana: every key refused")
                        return
                    await _asyncio.sleep(delays[rounds])
                    rounds += 1
                    tried = set()
                    continue
                self._nv_key, self._api_key = key, key
                self._nv_quiet, self._nv_last_error = True, ""
                try:
                    await super()._connect_websocket()
                finally:
                    self._nv_quiet = False
                if self._websocket is not None:
                    logger.info("navana: connected on key #%d of %d (load %s)%s",
                                NAVANA_KEYS.index(key), len(NAVANA_KEYS.keys()),
                                NAVANA_KEYS.loads(),
                                f" after {refusals} refusal(s)" if refusals else "")
                    return
                NAVANA_KEYS.release(self, key)
                self._nv_key = None
                refusals += 1
                tried.add(key)
                if "concurrency_limit" in self._nv_last_error:
                    NAVANA_KEYS.refused(key)
                else:
                    NAVANA_KEYS.refused(key, NAVANA_KEYS.BAD_KEY_SECS)
                    logger.warning("navana: key #%d of %d failed (not capacity) — resting it "
                                   "%.0f s, trying the next key: %s", NAVANA_KEYS.index(key),
                                   len(NAVANA_KEYS.keys()), NAVANA_KEYS.BAD_KEY_SECS,
                                   (self._nv_last_error or "")[-160:])

        async def _disconnect_websocket(self):
            try:
                await super()._disconnect_websocket()
            finally:
                NAVANA_KEYS.release(self, getattr(self, "_nv_key", None))
                self._nv_key = None

        async def on_audio_context_interrupted(self, context_id: str):
            # pipecat reconnects the socket on an interruption only while the bot
            # is audibly speaking — NOT for a reply FloorGate was still holding.
            # Navana then keeps streaming the dropped sentences, and forgetting
            # their seqs sent those chunks to whichever context played next. So
            # every sentence in flight is marked dead: its audio and its text
            # are discarded as they arrive (it was never heard).
            if not hasattr(self, "_nv_ctx"):
                self._nv_reset()
            self._nv_dead.update(self._nv_ctx.keys())
            self._nv_ctx.clear()
            self._nv_text.clear()
            self._nv_ctx_seq.clear()
            await super().on_audio_context_interrupted(context_id)

        async def _handle_interruption(self, frame, direction):
            # Skip InterruptibleTTSService's close-and-reopen (see above): the
            # dead-seq bookkeeping already discards the interrupted reply.
            await _WsTTS._handle_interruption(self, frame, direction)

        async def run_tts(self, text, context_id, *args, **kwargs):
            recorded = False
            async for frame in super().run_tts(text, context_id, *args, **kwargs):
                # The SDK increments _seq and sends BEFORE its first yield, so the
                # seq is known here — long before its first chunk (hundreds of ms).
                if not recorded:
                    if not hasattr(self, "_nv_ctx"):
                        self._nv_reset()
                    self._nv_ctx[self._seq] = context_id
                    self._nv_ctx_seq[context_id] = self._seq
                    recorded = True
                yield frame

        async def _receive_messages(self):
            import json as _json
            from pipecat.frames.frames import TTSAudioRawFrame as _Audio
            if not hasattr(self, "_nv_ctx"):
                self._nv_reset()
            async for message in self._get_websocket():
                if isinstance(message, (bytes, bytearray)):
                    await self.stop_ttfb_metrics()
                    seq = self._nv_cur_seq
                    last, self._nv_cur_last = self._nv_cur_last, False
                    if seq in self._nv_dead:
                        if last:
                            self._nv_dead.discard(seq)
                        continue
                    ctx = self._nv_ctx.get(seq)
                    if ctx is None or not self.audio_context_available(ctx):
                        if seq in self._nv_ctx:
                            # Cache off: the turn's context idled out while this
                            # sentence was still being generated — pipecat
                            # recreates the turn context on append (the SDK loop
                            # played it late). Any other closed context: drop.
                            ctx = ctx if ctx == getattr(self, "_turn_context_id", None) else None
                        else:
                            ctx = self.get_active_audio_context_id()
                    if ctx is None:
                        if last:
                            # Never played, so never heard: its text goes too.
                            self._nv_ctx.pop(seq, None)
                            self._nv_text.pop(seq, None)
                        continue
                    pcm = bytes(message)
                    if last and seq in self._nv_text and len(pcm) >= 8:
                        # Still held at the sentence's last chunk — always, for
                        # Navana's one-chunk sentences: the text goes 60 % into it.
                        cut = (int(len(pcm) * 0.6) // 2) * 2          # 16-bit aligned
                        await self.append_to_audio_context(ctx, _Audio(
                            audio=pcm[:cut], sample_rate=self._output_sample_rate,
                            num_channels=1, context_id=ctx))
                        await self._nv_release_text(seq, ctx)
                        pcm = pcm[cut:]
                    await self.append_to_audio_context(ctx, _Audio(
                        audio=pcm, sample_rate=self._output_sample_rate,
                        num_channels=1, context_id=ctx))
                    if last:
                        await self._nv_finish(seq, ctx)
                    elif seq in self._nv_text:
                        idx, total = self._nv_cur_idx, self._nv_cur_total
                        if isinstance(idx, int) and isinstance(total, int) and total > 0 \
                                and (idx + 1) * 5 >= total * 3:
                            await self._nv_release_text(seq, ctx)    # 60 % of it is out
                    continue
                try:
                    content = _json.loads(message)
                except Exception:
                    continue
                kind = content.get("type")
                if kind == "audio":
                    self._nv_cur_seq = content.get("seq")
                    self._nv_cur_last = bool(content.get("is_last_chunk"))
                    self._nv_cur_idx = content.get("chunk_index")
                    self._nv_cur_total = content.get("chunk_total")
                elif kind == "error":
                    await self.push_error(
                        error_msg=f"{self} Bodhi TTS error {content.get('code')}: {content.get('message')}")
    _Routed.__name__ = cls.__name__
    _Routed.__qualname__ = cls.__qualname__
    return _Routed


_NAVANA_LANGS = {
    "hinglish": "hi", "hindi": "hi", "hi": "hi", "english": "en", "en": "en",
    "marathi": "mr", "mr": "mr", "bengali": "bn", "bn": "bn", "gujarati": "gu", "gu": "gu",
    "tamil": "ta", "ta": "ta", "telugu": "te", "te": "te", "kannada": "kn", "kn": "kn",
    "malayalam": "ml", "ml": "ml", "odia": "or", "oriya": "or", "or": "or", "od": "or",
}


def navana_language(language: str | None) -> str:
    """Agent language ("hinglish", "marathi", "hi-IN", "od-IN"…) → Navana's bare
    code. Navana serves ten languages; anything else speaks Hindi, the same
    fallback every other engine here uses."""
    l = (language or "").strip().lower()
    return _NAVANA_LANGS.get(l) or _NAVANA_LANGS.get(l.split("-")[0]) or "hi"


def _tag_engine(svc, slug: str, model: str):
    """Stamp the engine ACTUALLY constructed onto the service.

    build_tts falls through to Sarvam on any construction failure (missing key,
    signature drift), so ai_agent.tts_model is NOT a reliable statement of what
    will speak. The TTS cache keys on this stamp: filing Sarvam audio under a
    google key would serve the wrong voice to every future call that matched it.
    Also what diagnostics should report as the vendor.
    """
    try:
        svc._vacademy_engine = (slug, model or "")
    except Exception:
        pass
    return _apply_speech_term_map(svc)


def normalize_for_speech(text: str, term_map=None) -> str:
    """Deterministic pronunciation fixes for ANY engine. PURE.

    Sibling of normalize_for_rumik, and for the same reason — a prompt rule cannot
    stop the model writing a word the way it wants to — but not tied to one vendor.
    Applied to the text sent for synthesis only; transcripts and LLM context keep
    the written form, so the report still shows what the model actually composed.
    """
    if not text:
        return text
    mapping = term_map if term_map is not None else get_settings().speech_term_map
    for src, dst in mapping:
        if src and src in text:
            text = text.replace(src, dst)
    return text


def _apply_speech_term_map(svc):
    """Wrap run_tts so the map applies however the engine synthesises.

    At the ONE point every engine passes through, rather than per vendor: five
    services with five different internals, and a sixth added later would silently
    miss out. run_tts receives whole SENTENCES (pipecat aggregates before calling
    it), so a multi-word key still matches — which it would not if this hooked the
    token stream further upstream.

    Inert when the map is empty, which is the default, so no existing agent is
    touched. Never raises: a wrapper failure must not cost the call its voice.
    """
    try:
        if not get_settings().speech_term_map:
            return svc
        original = svc.run_tts

        async def run_tts(text, *args, **kwargs):
            async for frame in original(normalize_for_speech(text), *args, **kwargs):
                yield frame

        svc.run_tts = run_tts
    except Exception:
        pass
    return svc


def smallest_model_for(engine: str) -> str:
    """Resolve the agent's Smallest selection identically on every synthesis path."""
    selected = (engine or "").strip().lower()
    model = "lightning_v3.1_pro" if "pro" in selected else get_settings().smallest_model
    if ":" in selected:
        explicit = selected.split(":", 1)[1].strip()
        if explicit:
            model = explicit if explicit.startswith("lightning") else f"lightning_{explicit}"
    return model


def default_engine_model(engine: str, voice: str = "") -> str:
    """The model string _tag_engine stamps for an engine, resolved from settings.

    ONE definition, because the cache key contains the model and two paths derive
    it: the live call takes it from engine_of(tts), and warm-on-save has only the
    engine name. They were allowed to disagree once — admin_core sent model="" and
    the warm key came out as (…, "", …) while the live key was (…, "bulbul:v3", …),
    so every pre-warmed blob was filed under a key no call could ever produce. The
    warm path looked like it worked and the cache simply never hit.
    """
    s = get_settings()
    e = (engine or "").strip().lower()
    if e == "sarvam_v4":
        return SARVAM_V4_MODEL
    if e == "sarvam":
        return s.sarvam_tts_model
    if e.startswith("smallest") or e.startswith("lightning"):
        return smallest_model_for(e)
    if e == "google":
        return "chirp3-hd"
    if e == "edge":
        return "read-aloud"
    if e == "rumik":
        return "mulberry"
    if e == "deepgram":
        return voice or s.deepgram_tts_voice
    return ""


def engine_of(svc) -> tuple:
    """(slug, model) for a service built by build_tts. ("sarvam", "") if unstamped —
    matching build_tts's own terminal fallback, and CallBillingService's."""
    got = getattr(svc, "_vacademy_engine", None)
    if isinstance(got, tuple) and len(got) == 2:
        return got
    return ("sarvam", "")


def rumik_term_map_version() -> str:
    """Short digest of RUMIK_TERM_MAP. It rewrites text at the synthesis
    boundary, so changing it changes the audio for an unchanged sentence — it
    has to be part of the cache key or a re-tuned map would serve stale audio."""
    import hashlib
    # It is a tuple of (from, to) pairs, not a string — repr is stable because
    # config sorts it at load.
    tm = get_settings().rumik_term_map
    if not tm:
        return ""
    return hashlib.sha1(repr(tm).encode("utf-8")).hexdigest()[:8]



def _register_sarvam_v4() -> None:
    """pipecat 1.4 knows bulbul v2/v3 only and REJECTS any other model at construction
    ("Unsupported model 'bulbul:v4-flash'"). v4 takes the v3 parameter set (no
    pitch/loudness, temperature 0.01-1.0, pace 0.5-2.0), so register it alongside."""
    from pipecat.services.sarvam import tts as _sarvam_tts
    if SARVAM_V4_MODEL in _sarvam_tts.TTS_MODEL_CONFIGS:
        return
    _sarvam_tts.TTS_MODEL_CONFIGS[SARVAM_V4_MODEL] = _sarvam_tts.TTSModelConfig(
        supports_pitch=False, supports_loudness=False, supports_temperature=True,
        default_sample_rate=24000, default_speaker=SARVAM_V4_DEFAULT_VOICE,
        pace_range=(0.5, 2.0), preprocessing_always_enabled=True,
        speakers=tuple(sorted(SARVAM_V4_VOICES)))


def _sarvam_tts_class():
    """SarvamTTSService as every call builds it (v3 and v4): each sentence
    flushed and routed to its own context when the speech cache splits a turn
    per sentence, and a silent line never holds the reply behind it — both from
    call c6847f91 (2026-10-14)."""
    return _silent_context_resume(_sarvam_sentence_routing(SarvamTTSService))


def build_tts(sample_rate: int, voice: str | None = None, *, aiohttp_session=None,
              tts_model: str | None = None,
              pace: float | None = None, temperature: float | None = None,
              language: str | None = None):
    """TTS factory. `aiohttp_session` is accepted for call-site compatibility but
    unused on 1.4 (Sarvam's service owns its own websocket).

    pipecat 1.4 upgrades absorbed here: SarvamTTSService now has native
    reconnect/keepalive (the Resilient wrapper is gone), and InputParams carries
    pace/temperature/enable_preprocessing natively (the pace_override config
    injection is dead). Rumik stays a custom service — UNVERIFIED on 1.4 beyond
    construction; Sarvam is the production engine (founder decision 2026-08-05
    after Mulberry garbled phone-leg Hindi: प्रतिशत → "प्रतिलत")."""
    s = get_settings()
    model = (tts_model or s.tts_model or "").strip().lower()
    eff_pace = _clamp(pace if pace is not None else s.tts_pace, 0.5, 2.0)

    if model.startswith("google") or model.startswith("chirp"):
        # Google Cloud TTS — founder's pick by ear (Chirp3-HD), and measured
        # CHEAPER per call-minute than Sarvam (Rs 2.06 vs 2.34) with 1M
        # chars/month free. Auth reuses the Vertex service account: no new
        # vendor, no new secret, no new failure mode to learn.
        #
        # FALL THROUGH to Sarvam on ANY construction failure (missing creds is
        # the likely one — VERTEX_CREDENTIALS_* is per-deployment). A misconfig
        # must degrade to a working call in a different voice, never to the mute
        # call that the 1.4 signature drift already cost us once.
        try:
            from pipecat.services.google.tts import GoogleTTSService
            creds = s.vertex_credentials_json.strip() or None
            voice_id = (voice or s.google_tts_voice).strip() or s.google_tts_voice
            # Chirp3-HD ignores speaking_rate on some tiers but never errors on
            # it; Neural2/WaveNet honour it. Pass it either way (probe-verified).
            return _tag_engine(GoogleTTSService(
                credentials=creds,
                credentials_path=(s.vertex_credentials_path.strip() or None) if not creds else None,
                voice_id=voice_id,
                sample_rate=s.google_tts_sample_rate,
                params=GoogleTTSService.InputParams(
                    language=_google_language(s.google_tts_language),
                    speaking_rate=_clamp(
                        eff_pace if pace is not None else s.google_tts_speaking_rate,
                        0.25, 4.0),
                ),
            ), "google", "chirp3-hd")
        except Exception:
            logger.exception("tts: google TTS unavailable (creds?) — "
                             "falling back to Sarvam bulbul")

    if model.startswith("edge"):
        # FREE: no key, no per-character charge. Falls through to Sarvam on any
        # construction failure, like every other optional engine here — a
        # misconfigured vendor must degrade to a working call in a different
        # voice, never to the mute call the 1.4 signature drift already cost us.
        try:
            return _tag_engine(EdgeTTSService(
                voice_id=(voice or s.edge_tts_voice).strip() or s.edge_tts_voice,
                sample_rate=24000,
                pace=eff_pace,
            ), "edge", "read-aloud")
        except Exception:
            logger.exception("tts: edge unavailable — falling back to Sarvam bulbul")

    if model.startswith("smallest") or model.startswith("lightning"):
        # Smallest.ai Lightning — Indian-language specialist, native pipecat
        # websocket service (so barge-in cancel comes for free).
        from pipecat.services.smallest.tts import SmallestTTSService
        if not s.smallest_api_key:
            logger.error("tts: SMALLEST_API_KEY unset — falling back to Sarvam bulbul")
        else:
            sm_model = smallest_model_for(model)
            sm_voice = (voice or s.smallest_voice).strip() or s.smallest_voice
            try:
                return _tag_engine(
                    _build_smallest(SmallestTTSService, s, sm_model, sm_voice,
                                    _clamp(eff_pace, 0.5, 2.0), language),
                    "smallest", sm_model)
            except Exception:
                logger.exception("tts: smallest unavailable — falling back to Sarvam")
    if model.startswith("deepgram") or model.startswith("aura"):
        # Deepgram Aura-2 — ENGLISH ONLY (see config.deepgram_api_key). Native
        # pipecat websocket service, so interruption cancel is handled upstream.
        #
        # No pace knob: Aura-2 exposes neither speaking_rate nor SSML, so
        # eff_pace is deliberately ignored here rather than silently pretended
        # at. An agent that needs pace control belongs on google or sarvam.
        from pipecat.services.deepgram.tts import DeepgramTTSService
        if not s.deepgram_api_key:
            logger.error("tts: DEEPGRAM_API_KEY unset — falling back to Sarvam bulbul")
        else:
            dg_voice = (voice or s.deepgram_tts_voice).strip() or s.deepgram_tts_voice
            try:
                return _tag_engine(_silent_context_resume(DeepgramTTSService)(
                    api_key=s.deepgram_api_key,
                    sample_rate=s.deepgram_tts_sample_rate,
                    encoding="linear16",
                    settings=DeepgramTTSService.Settings(voice=dg_voice, model=dg_voice),
                ), "deepgram", dg_voice)
            except Exception:
                logger.exception("tts: deepgram unavailable — falling back to Sarvam")
    if model.startswith("navana") or model.startswith("bodhi"):
        # Navana (Bodhi). Their SDK's service: InterruptibleTTSService, one
        # websocket per session, cancels mid-utterance on barge-in. Wrapped in the
        # letterless guard so vendor characters are METERED (diagnostics.tts.chars)
        # — the call card then prices the real count, as it does for Smallest.
        # No pace knob: the streaming hello rejects `speed` (Navana docs).
        if not navana_keys(s.navana_api_key):
            logger.error("tts: NAVANA_API_KEY unset — falling back to Sarvam bulbul")
        else:
            try:
                from bodhi.integrations.pipecat_tts import BodhiTTSService
                nv_voice = (voice or s.navana_tts_voice).strip() or s.navana_tts_voice
                cls = _letterless_guard(_navana_seq_routing(BodhiTTSService))
                # The key here is a placeholder: each connection picks the
                # least-loaded key from NAVANA_KEYS (comma-separated env).
                return _tag_engine(cls(api_key=navana_keys(s.navana_api_key)[0], voice=nv_voice,
                                       language=navana_language(language)),
                                   "navana", nv_voice)
            except Exception:
                logger.exception("tts: navana unavailable — falling back to Sarvam")
    if model.startswith("rumik") or model.startswith("silk"):
        if not s.rumik_api_key:
            logger.error("tts: RUMIK_API_KEY unset — falling back to Sarvam bulbul")
        else:
            return _tag_engine(RumikTTSService(
                api_key=s.rumik_api_key,
                # Rumik emits 24 kHz ONLY; the output transport resamples to the
                # 8 kHz Plivo leg.
                sample_rate=24000,
                voice=(voice or s.rumik_voice).strip() or "ira",
                model="mulberry",
                description=rumik_pace_description(eff_pace),
            ), "rumik", "mulberry")
    if model.startswith(("sarvam_v4", "sarvam-v4", "bulbul:v4", "bulbul_v4", "bulbul-v4")):
        # Sarvam Bulbul v4 Flash: the same websocket contract as v3 (probed live
        # 2026-10-14 with this exact config at 8 kHz: hi / enhi / en voices, first
        # audio 0.36 s vs v3's 0.39 s), but its OWN voice ids. A v3 name here is a
        # 400 and a silent call, so anything outside the v4 palette gets the default.
        _register_sarvam_v4()
        v4_voice = (voice or "").strip().lower()
        if v4_voice not in SARVAM_V4_VOICES:
            if v4_voice:
                logger.warning("tts: %r is not a Bulbul v4 voice — using %s", v4_voice,
                               SARVAM_V4_DEFAULT_VOICE)
            v4_voice = SARVAM_V4_DEFAULT_VOICE
        v4_kwargs = {"pace": eff_pace, "enable_preprocessing": True}
        if temperature is not None:
            v4_kwargs["temperature"] = _clamp(temperature, 0.01, 1.0)
        if s.sarvam_tts_min_buffer > 0:
            v4_kwargs["min_buffer_size"] = max(30, s.sarvam_tts_min_buffer)
        return _tag_engine(_sarvam_tts_class()(
            api_key=s.sarvam_api_key,
            model=SARVAM_V4_MODEL,
            voice_id=v4_voice,
            sample_rate=sample_rate,
            params=SarvamTTSService.InputParams(**v4_kwargs),
        ), "sarvam_v4", SARVAM_V4_MODEL)
    kwargs = {"pace": eff_pace, "enable_preprocessing": True}
    if temperature is not None:
        kwargs["temperature"] = _clamp(temperature, 0.01, 2.0)
    if s.sarvam_tts_min_buffer > 0:
        # Sarvam's WS validation floor is 30 (20 = rejected config = silent call,
        # 2026-07-20 outage).
        kwargs["min_buffer_size"] = max(30, s.sarvam_tts_min_buffer)
    return _tag_engine(_sarvam_tts_class()(
        api_key=s.sarvam_api_key,
        model=s.sarvam_tts_model,
        voice_id=voice or s.sarvam_tts_voice,
        sample_rate=sample_rate,
        params=SarvamTTSService.InputParams(**kwargs),
    ), "sarvam", s.sarvam_tts_model)


def _sarvam_sentence_routing(cls):
    """Subclass pipecat's SarvamTTSService so that, with ONE AUDIO CONTEXT PER
    SENTENCE (what the speech cache switches on), every sentence is FLUSHED and
    its audio lands in its own context.

    THE FLUSH (call c6847f91, 2026-10-14, bulbul:v4-flash, cache on). Sarvam
    holds text until min_buffer_size characters (50) unless it gets a
    {"type": "flush"}. pipecat sends that flush once, at the end of a turn or a
    TTSSpeakFrame, for `_turn_context_id` — and only if that id has an audio
    context. With reuse off no sentence uses that id (create_context_id() hands
    every sentence a fresh one), so the flush NEVER went out. The 9-character
    bridge "एक सेकंड।" got no audio; the service had paused itself behind it
    (pause_frame_processing) and the reply waited ~16 s, until the caller spoke.
    So here every sentence is flushed the moment its text is sent, and
    pipecat's own end-of-turn flush is dropped (every sentence is already
    flushed; a second, empty flush could earn a 'final' that closes the wrong
    sentence).

    THE ROUTING. The stock receive loop files each audio message under
    get_active_audio_context_id() — the context PLAYING — and lets a 'final'
    close the playing context. Right with one context per turn; wrong with one
    per sentence, where sentence 2's audio arrives while sentence 1 still plays:
    it was filed under sentence 1, sentence 2's own context sat empty until
    pipecat's 3 s idle timeout, and a 'final' processed just ahead of the next
    sentence's first chunk put that chunk BEHIND the closed context's end marker,
    where it is never played. Sarvam answers one socket strictly in order and
    sends one 'final' per flush (send_completion_event=true), so the Nth flushed
    sentence owns the audio until the Nth 'final': it gets its audio, its stop
    and its close. A context pipecat already closed (idle timeout) cannot take
    audio, so that audio goes to the next flushed sentence still open — late,
    but in order.

    With one context per turn (cache off) the stock path runs untouched,
    including pipecat's own flush.
    """
    import base64 as _b64
    import collections

    from websockets.protocol import State as _State

    class _Routed(cls):
        def _sv_routing_on(self) -> bool:
            return not getattr(self, "_reuse_context_id_within_turn", True)

        def _sv_state(self):
            if not hasattr(self, "_sv_pending"):
                self._sv_pending = collections.deque()   # flushed contexts owed a 'final', in send order
                self._sv_sent = False                    # did the last _send_text reach an open socket?
            return self

        def _sv_reset(self):
            self._sv_state()._sv_pending.clear()

        def _sv_target(self):
            """The earliest flushed sentence whose context is still open."""
            for ctx in self._sv_state()._sv_pending:
                if self.audio_context_available(ctx):
                    return ctx
            return self.get_active_audio_context_id()

        async def _connect_websocket(self):
            # A fresh socket owes us nothing: the old socket's 'final's died with it.
            self._sv_reset()
            await super()._connect_websocket()

        async def on_audio_context_interrupted(self, context_id: str):
            self._sv_reset()
            await super().on_audio_context_interrupted(context_id)

        async def _handle_interruption(self, frame, direction):
            # InterruptibleTTSService reopens the socket only while the bot is
            # audibly speaking. A reply interrupted before its first audio (still
            # being synthesised) leaves Sarvam owing audio and 'final's that would
            # be filed under the NEXT reply's sentences — and each stale 'final'
            # would close one of them early. Reopen the socket in that case too.
            owed = self._sv_routing_on() and bool(self._sv_state()._sv_pending)
            speaking = getattr(self, "_bot_speaking", False)
            await super()._handle_interruption(frame, direction)
            if owed and not speaking:
                await self._disconnect()
                await self._connect()

        async def _send_text(self, text: str):
            ws = self._websocket
            self._sv_state()._sv_sent = bool(ws is not None and ws.state == _State.OPEN)
            await super()._send_text(text)

        async def flush_audio(self, context_id: str | None = None):
            if self._sv_routing_on():
                return              # every sentence was flushed as it was sent (run_tts)
            await super().flush_audio(context_id)

        async def run_tts(self, text, context_id, *args, **kwargs):
            routed = self._sv_routing_on()
            self._sv_state()._sv_sent = False
            async for frame in super().run_tts(text, context_id, *args, **kwargs):
                # The stock run_tts yields None once the text is on the socket (and
                # yields an ErrorFrame instead when the send failed).
                if frame is None and routed and self._sv_sent:
                    self._sv_pending.append(context_id)
                    await super().flush_audio(context_id)
                yield frame

        async def _receive_messages(self):
            if not self._sv_routing_on():
                await super()._receive_messages()
                return
            from pipecat.frames.frames import (ErrorFrame as _Error, TTSAudioRawFrame as _Audio,
                                               TTSStoppedFrame as _Stopped)
            async for message in self._get_websocket():
                if not isinstance(message, str):
                    continue
                msg = json.loads(message)
                kind = msg.get("type")
                if kind == "audio":
                    await self.stop_ttfb_metrics()
                    ctx = self._sv_target()
                    await self.append_to_audio_context(ctx, _Audio(
                        _b64.b64decode(msg["data"]["audio"]), self.sample_rate, 1,
                        context_id=ctx))
                elif kind == "event" and msg.get("data", {}).get("event_type") == "final":
                    st = self._sv_state()
                    ctx = st._sv_pending.popleft() if st._sv_pending else None
                    if ctx and self.audio_context_available(ctx):
                        await self.append_to_audio_context(ctx, _Stopped(context_id=ctx))
                        await self.remove_audio_context(ctx)
                elif kind == "error":
                    error_msg = msg.get("data", {}).get("message", "")
                    await self.push_error(error_msg=f"TTS Error: {error_msg}")
                    ctx = self._sv_target()
                    await self.append_to_audio_context(ctx, _Error(error=f"TTS Error: {error_msg}"))

    _Routed.__name__ = cls.__name__
    _Routed.__qualname__ = cls.__qualname__
    return _Routed


def _smallest_request_routing(cls):
    """Subclass pipecat's SmallestTTSService so that, with ONE AUDIO CONTEXT PER
    SENTENCE (what the speech cache switches on), every chunk and word lands in
    the context of the request that asked for it, and each context closes as
    soon as its request is done.

    Stock behaviour assumes one context per turn: a chunk is appended to
    get_active_audio_context_id() — the context PLAYING — and nothing closes a
    finished request's context, because Smallest sends no per-request
    `complete` (recorded 2026-09-25: one `complete` ~4 s after the last audio
    of a whole batch). With per-sentence contexts that meant the next
    sentence's audio was filed under the previous one, its own context sat
    empty, and pipecat's 3 s idle timeout closed it — a cached sentence queued
    behind waited 2.2 s (call 5aa10e10; timing sim smallest_live_then_cached:
    a 2.56 s hole).

    Smallest serves requests on a socket strictly in order, each tagged with a
    request_id, so the Nth new request_id belongs to the Nth run_tts. A
    request is done when the next one starts streaming, or after
    _REQUEST_IDLE_SECS with nothing for it (chunks arrive ~40 ms apart at ~4x
    real time; closing a context ends its queue, not its playout).

    With one context per turn (cache off) the stock path runs untouched.
    """
    import collections

    class _Routed(cls):
        _REQUEST_IDLE_SECS = 0.5

        def _routing_on(self) -> bool:
            return not getattr(self, "_reuse_context_id_within_turn", True)

        def _routing_state(self):
            if not hasattr(self, "_rq_pending"):
                self._rq_pending = collections.deque()   # contexts awaiting a request_id
                self._rq_ctx = {}                        # request_id -> context_id
                self._rq_current = None                  # request_id streaming now
                self._rq_idle_task = None
            return self

        def _routing_reset(self):
            self._routing_state()
            self._rq_pending.clear()
            self._rq_ctx.clear()
            self._rq_current = None
            t, self._rq_idle_task = self._rq_idle_task, None
            if t is not None and not t.done():
                t.cancel()

        async def _connect_websocket(self):
            # A fresh socket starts a fresh request sequence (pipecat reconnects
            # on every interruption).
            self._routing_reset()
            await super()._connect_websocket()

        async def on_audio_context_interrupted(self, context_id: str):
            self._routing_reset()
            await super().on_audio_context_interrupted(context_id)

        async def run_tts(self, text, context_id, *args, **kwargs):
            if self._routing_on() and text and text.strip():
                self._routing_state()._rq_pending.append(context_id)
            async for frame in super().run_tts(text, context_id, *args, **kwargs):
                yield frame

        async def _close_request(self, rid):
            ctx = self._rq_ctx.pop(rid, None)
            if ctx and self.audio_context_available(ctx):
                await self.remove_audio_context(ctx)

        async def _close_after_idle(self, rid):
            try:
                await asyncio.sleep(self._REQUEST_IDLE_SECS)
                if self._rq_current == rid:
                    self._rq_current = None
                await self._close_request(rid)
            except asyncio.CancelledError:
                pass

        async def _route(self, rid):
            """Context for this request_id; closes the previous request's."""
            st = self._routing_state()
            if rid not in st._rq_ctx:
                if st._rq_current is not None and st._rq_current != rid:
                    await self._close_request(st._rq_current)
                st._rq_ctx[rid] = st._rq_pending.popleft() if st._rq_pending else None
                st._rq_current = rid
            t, st._rq_idle_task = st._rq_idle_task, None
            if t is not None and not t.done():
                t.cancel()
            st._rq_idle_task = asyncio.get_running_loop().create_task(self._close_after_idle(rid))
            ctx = st._rq_ctx.get(rid)
            if ctx and self.audio_context_available(ctx):
                return ctx
            return self.get_active_audio_context_id()

        async def _receive_messages(self):
            if not self._routing_on():
                await super()._receive_messages()
                return
            import base64 as _b64
            import json as _json
            from pipecat.frames.frames import TTSAudioRawFrame as _Audio, TTSStoppedFrame as _Stopped
            async for message in self._get_websocket():
                msg = _json.loads(message)
                status = msg.get("status")
                rid = msg.get("request_id")
                if status == "complete":
                    await self.stop_all_metrics()
                    st = self._routing_state()
                    for r in list(st._rq_ctx):
                        await self._close_request(r)
                    st._rq_current = None
                elif status == "chunk":
                    await self.stop_ttfb_metrics()
                    ctx = await self._route(rid)
                    await self.append_to_audio_context(ctx, _Audio(
                        audio=_b64.b64decode(msg["data"]["audio"]),
                        sample_rate=self.sample_rate, num_channels=1, context_id=ctx))
                elif status == "word_timestamp":
                    data = msg.get("data", {})
                    word, start = data.get("word"), data.get("start")
                    if word is not None and start is not None:
                        ctx = await self._route(rid)
                        # Each request has its own context and its own baseline:
                        # its word times are already relative to its own audio.
                        await self.add_word_timestamps([(word, start)], ctx)
                elif status == "error":
                    ctx = self.get_active_audio_context_id()
                    await self.push_frame(_Stopped(context_id=ctx))
                    await self.stop_all_metrics()
                    await self.push_error(error_msg=f"Smallest TTS error: {msg.get('error', msg)}")
                else:
                    logger.warning(f"{self} unknown message status: {msg}")

    _Routed.__name__ = cls.__name__
    _Routed.__qualname__ = cls.__qualname__
    return _Routed


def _letterless_guard(cls):
    """Subclass `cls` so a sentence with no letter or digit never reaches the
    vendor. Smallest renders a bare "." as 9 s of hum (measured 2026-09-15:
    '.' → 9.13 s of audio, no words; call af7e93bd — "नब्बे तीन परसेंट..."
    became "…परसेंट.." + "." inside pipecat's own text aggregator, downstream
    of every gate of ours). The skip happens before a context is created, so
    the sequencer sees nothing to wait for.

    Also the last gate before synthesis for text the CALL decides is stale by
    the time it gets here: `skip_text_if(text) -> reason | None`, set by
    run_bot (a bridge line queued behind a long reply, call 28570ec0)."""
    class _NoLetterless(cls):
        skip_text_if = None
        _vendor_diag = None

        def set_diagnostics(self, diag):
            # Meter what the VENDOR bills: characters that reach run_tts. The
            # speech cache wraps the instance's run_tts and calls this class
            # method only on a miss, so cache hits are not counted. Feeds
            # diagnostics.tts.chars — the per-call TTS cost on the call card
            # (it was null for Smallest, so the card fell back to duration).
            self._vendor_diag = diag
            sup = getattr(super(), "set_diagnostics", None)
            if sup is not None:
                sup(diag)

        async def run_tts(self, text, *args, **kwargs):
            d = self._vendor_diag
            if d is not None and text:
                d.bump("tts_chars", len(text.strip()))
            async for frame in super().run_tts(text, *args, **kwargs):
                yield frame

        async def _push_tts_frames(self, src_frame, *args, **kwargs):
            text = getattr(src_frame, "text", "") or ""
            if not any(ch.isalnum() for ch in text):
                logger.info("tts: letterless sentence %r skipped — the vendor hums on it",
                            text.strip()[:12])
                return None
            why = self.skip_text_if(text) if self.skip_text_if is not None else None
            logger.info("tts: to vendor %r%s", text.strip()[:40], f" — SKIPPED: {why}" if why else "")
            if why:
                logger.info("tts: %r skipped at synthesis — %s", text.strip()[:24], why)
                return None
            return await super()._push_tts_frames(src_frame, *args, **kwargs)
    _NoLetterless.__name__ = cls.__name__
    _NoLetterless.__qualname__ = cls.__qualname__
    return _NoLetterless


def _silent_context_resume(cls):
    """Subclass a TTS built with pause_frame_processing so an utterance that
    ends with NO audio cannot hold the reply behind it.

    pipecat pauses such a service once a TTSSpeakFrame or an LLM reply has been
    sent, and resumes it only on BotStoppedSpeakingFrame or an interruption. The
    output transport turns a TTSStoppedFrame into BotStoppedSpeaking only if
    audio was received — so a line the vendor never voiced kept the service
    paused, and everything queued behind it, the reply included, waited for the
    caller to speak. Call c6847f91 (2026-10-14, Sarvam bulbul:v4-flash): the
    bridge "एक सेकंड।" got no audio, the fallback model's reply sat behind it and
    the caller heard ~16 s of nothing until they talked over it.

    So when an audio context ends (on its own stop, or on pipecat's
    stop_frame_timeout_s idle timeout, 3 s) having played ZERO audio frames,
    while frame processing is paused and no other context is queued behind it,
    resume. Engine-agnostic: whatever made the line silent (no flush, a dropped
    send, a vendor that answered nothing), the silence is bounded by that
    timeout instead of by the caller. Resuming cannot reorder audio — later
    contexts still drain in creation order — it is the shape google, which never
    pauses, has always had.
    """
    from pipecat.frames.frames import TTSAudioRawFrame as _Audio
    from pipecat.processors.frame_processor import FrameDirection as _Dir

    class _Resume(cls):
        _silent_diag = None
        _audio_pushed = 0

        def set_diagnostics(self, diag):
            self._silent_diag = diag
            sup = getattr(super(), "set_diagnostics", None)
            if sup is not None:
                sup(diag)

        async def push_frame(self, frame, direction=_Dir.DOWNSTREAM):
            if isinstance(frame, _Audio):
                self._audio_pushed += 1
            await super().push_frame(frame, direction)

        async def _handle_audio_context(self, context_id: str):
            before = self._audio_pushed
            await super()._handle_audio_context(context_id)
            if self._audio_pushed != before or not getattr(self, "_pause_frame_processing", False):
                return
            # pipecat's own flag; if a release renames it, resuming an unpaused
            # processor is a no-op, so err on the side of resuming.
            if not getattr(self, "_FrameProcessor__should_block_frames", True):
                return
            if any(c != context_id for c in getattr(self, "_audio_contexts", {}) or {}):
                return              # more is queued: its own audio ends the pause as usual
            logger.warning("tts: audio context %s ended with no audio while paused — resuming "
                           "so the next reply is not held behind it", (context_id or "")[:8])
            d = self._silent_diag
            if d is not None:
                d.bump("tts_silent_resumes")
            await self.resume_processing_frames()

    _Resume.__name__ = cls.__name__
    _Resume.__qualname__ = cls.__qualname__
    return _Resume


def _build_smallest(cls, s, model: str, voice: str, speed: float,
                    language: str | None = None):
    """Construct Smallest.ai Lightning. Split out so build_tts can wrap it in one
    try/except: Lightning takes a REAL numeric speed multiplier (unlike Rumik,
    which only responds to prose), and its voice palettes are per-model — the API
    hard-rejects a cross-model voice, which is a mute call."""
    cls = _silent_context_resume(_letterless_guard(_smallest_request_routing(cls)))
    return cls(
        api_key=s.smallest_api_key,
        sample_rate=s.smallest_sample_rate,
        settings=cls.Settings(model=model, voice=voice,
                              language=_smallest_language(language), speed=speed),
    )


def _google_language(tag: str):
    """BCP-47 tag → pipecat Language for Google TTS; None = let Google infer from
    the voice name (every hi-IN voice is locale-prefixed, so that is safe)."""
    try:
        from pipecat.transcriptions.language import Language
        return Language(tag)
    except Exception:
        logger.warning("tts: unknown google language tag %r — inferring from voice", tag)
        return None


def _smallest_language(agent_language: str | None = None):
    """Lightning takes a language tag, and it must be the AGENT's, not a constant.

    This used to return HI for every agent. Calls c9aa4062 / e73a839b / 0e26a0c9
    (2026-09-09, an ENGLISH agent on lightning_v3.1_pro/mrunal): English text
    tagged `hi` makes the vendor return a ~200 Hz DRONE instead of speech for
    short interjection openers — measured by replaying the calls' own sentences
    against the API from the box: "Ah, okay, so you've got some automation in
    place." came back as 72.5 s of tone, "Perfect." 45.8 s, "Got it." 2.4 s (4 of
    101 sentences); tagged `en`, 0 of 101. The transport dutifully played the
    drone (the caller heard a hum), the real sentences queued behind it, and
    Call Health reported a 15-19 s "agent's audio wasn't ready" stall.

    Hindi/Hinglish agents keep `hi`: those voices code-switch into English
    natively, so `hi` is right for mixed text."""
    try:
        from pipecat.transcriptions.language import Language
        from .speech_language import smallest_language_code
        return Language.EN if smallest_language_code(agent_language) == "en" else Language.HI
    except Exception:
        return None


def _clamp(v: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return lo

_RUMIK_PACE_STYLES = (
    (1.15, "speaks extremely fast, rushed and hurried, clipped delivery, no pauses at all"),
    (1.05, "speaks rapidly with urgency, fast and energetic, no pauses"),
    (0.95, "speaks quickly and briskly, energetic and upbeat"),
    (0.85, "speaks at a brisk, upbeat conversational pace"),
    (0.75, None),   # Rumik's natural rate
)
_RUMIK_SLOW_STYLE = "speaks slowly and calmly, unhurried, with deliberate pauses"


def normalize_for_rumik(text: str, term_map=None) -> str:
    """Deterministic Devanagari→Latin replacement for terms Rumik mispronounces.

    The LLM transliterates English product terms into Devanagari when composing
    Hindi ("Live Classes" in the prompt → "लाइव क्लासेस" in the reply) and Rumik
    then speaks gibberish ("लव असेस" — heard on both founder test calls). Prompt
    rules failed to stop the transliteration twice, so this runs where it cannot
    be ignored: on the text actually sent for synthesis. Applied ONLY on the
    Rumik paths — transcripts, context, and Sarvam agents keep the written form.
    Map is longest-key-first (config guarantees the sort) so 'लाइव क्लासेस' wins
    over the bare 'क्लासेस'.
    """
    if not text:
        return text
    mapping = term_map if term_map is not None else get_settings().rumik_term_map
    for dev, latin in mapping:
        if dev in text:
            text = text.replace(dev, latin)
    return text


def rumik_pace_description(pace):
    """Prose that makes Rumik speak at the rate `pace` means on Sarvam."""
    if pace is None:
        return None
    for threshold, phrase in _RUMIK_PACE_STYLES:
        if pace >= threshold:
            return phrase
    return _RUMIK_SLOW_STYLE


async def rumik_synthesize_wav(text: str, voice: str, api_key: str,
                               session=None, model: str = "mulberry",
                               description: str | None = None) -> bytes:
    """One-shot Rumik synthesis -> WAV bytes. For the admin voice tester.

    Deliberately NOT reusing RumikTTSService: that is a pipecat pipeline component
    whose output goes to frames and whose lifecycle assumes a running call. A
    preview needs bytes, and giving it its own short path keeps a preview bug from
    ever touching live-call code.

    Returns b"" on any failure — the caller decides the HTTP status. Never raises,
    because a public preview endpoint must not 500 on a vendor hiccup.
    """
    import aiohttp
    import io
    import json as _json
    import wave
    # Same term normalization as the live call, so the admin's audition never
    # sounds better than what the caller will hear.
    text = normalize_for_rumik(text)
    own = session is None
    if own:
        session = aiohttp.ClientSession()
    try:
        async with session.post(
                RumikTTSService.MINT_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "text": text},
                timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                logger.warning("rumik preview: mint %s: %s", resp.status,
                               (await resp.text())[:200])
                return b""
            mint = await resp.json()
        pcm = bytearray()
        async with session.ws_connect(f'{mint["ws_url"]}?token={mint["token"]}',
                                      timeout=aiohttp.ClientTimeout(total=20)) as ws:
            payload = {"text": text, "speaker": (voice or "ira").strip().lower()}
            # The preview MUST carry the same pace steering a call would, or the
            # admin auditions a delivery the caller never hears.
            if description:
                payload["description"] = description
            await ws.send_json(payload)
            while True:
                msg = await asyncio.wait_for(ws.receive(), timeout=25)
                if msg.type == aiohttp.WSMsgType.BINARY:
                    pcm += msg.data
                elif msg.type == aiohttp.WSMsgType.TEXT:
                    j = _json.loads(msg.data)
                    if j.get("type") in ("done", "cancelled"):
                        break
                    if j.get("type") == "error":
                        logger.warning("rumik preview: %s", str(j)[:200])
                        return b""
                else:
                    break
        if not pcm:
            return b""
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            # 24 kHz is Rumik's only output rate; the WAV header must say so or the
            # browser plays it at the wrong speed.
            w.setframerate(24000)
            w.writeframes(bytes(pcm))
        return buf.getvalue()
    except Exception:
        logger.exception("rumik preview failed")
        return b""
    finally:
        if own:
            await session.close()


class EdgeTTSService(TTSService):
    """Microsoft Edge read-aloud TTS — free, no API key, decent hi-IN voices.

    WHY IT IS HAND-WRITTEN. pipecat ships no Edge service, and edge_tts speaks a
    bespoke websocket protocol behind a tiny client. The client is fine; what it
    will not do is give us PCM — the audio format is HARDCODED to
    audio-24khz-48kbitrate-mono-mp3 in edge_tts 7.2.8, with no parameter to
    change it. So we decode.

    STREAMING DECODE, AND WHY IT MATTERS. Buffering the whole utterance and
    decoding once is four lines and costs 1.04s before the caller hears
    anything, against Google Chirp3-HD's 0.18s — unacceptable on a line where a
    day was spent cutting latency. Instead we re-decode the ACCUMULATED buffer
    on every chunk and emit only the samples we have not emitted yet. That
    sounds wasteful and is not: miniaudio decodes 47 kB in ~4 ms, and MP3 frames
    are self-contained so a truncated tail simply yields fewer samples.
    Measured: first audio at 0.67s instead of 1.04s, with ZERO partial-decode
    failures across the run.

    Re-decoding from the start also sidesteps the whole class of frame-boundary
    bugs an incremental decoder would invite, which on a phone call would
    surface as clicks rather than as an exception.

    Emits 24 kHz mono, exactly like Rumik; the output transport resamples onto
    the 8 kHz Plivo leg.
    """

    #: Edge emits 24 kHz mono and nothing else. Decode at ITS rate — asking
    #: miniaudio for another resamples once here and again in the transport, and
    #: self.sample_rate is not even populated until the pipeline sends StartFrame,
    #: so using it made every decode raise and get swallowed: a silent service.
    NATIVE_HZ = 24000

    def __init__(self, *, voice_id: str = "hi-IN-SwaraNeural",
                 sample_rate: int = 24000, pace: float = 1.0, **kwargs):
        super().__init__(sample_rate=sample_rate, **kwargs)
        self._voice_id = self._safe_voice(voice_id)
        # edge_tts wants a signed percentage string, not a multiplier.
        pct = int(round((_clamp(pace, 0.5, 2.0) - 1.0) * 100))
        self._rate = f"{pct:+d}%"

    @staticmethod
    def _safe_voice(voice: str | None) -> str:
        """Drop a voice that belongs to another vendor.

        Edge names are locale-prefixed and end in Neural ("hi-IN-SwaraNeural").
        Sarvam's are bare words ("priya"), Rumik's too ("ira"). Handing Edge a
        Sarvam name yields either an error or, worse, somebody else's persona —
        and a wrong-gender voice already cost a week once, so this fails to the
        DEFAULT rather than to whatever was passed.
        """
        v = (voice or "").strip()
        if v and "-" in v and v.lower().endswith("neural"):
            return v
        if v:
            logger.warning("tts: %r is not an Edge voice — using the default", v[:32])
        return "hi-IN-SwaraNeural"

    def can_generate_metrics(self) -> bool:
        return True

    async def set_voice(self, voice: str):
        if voice:
            self._voice_id = self._safe_voice(voice)

    async def run_tts(self, text: str, context_id: str | None = None):
        """1.4 calls run_tts(text, context_id). context_id is accepted and unused
        — see RumikTTSService for the mute-bot incident that made this signature
        non-negotiable."""
        from pipecat.frames.frames import (ErrorFrame, TTSAudioRawFrame,
                                           TTSStartedFrame, TTSStoppedFrame)
        if not (text or "").strip():
            return
        try:
            import edge_tts
            import miniaudio
        except Exception:
            logger.exception("tts: edge-tts/miniaudio missing — cannot synthesise")
            yield ErrorFrame("edge tts unavailable")
            return

        await self.start_ttfb_metrics()
        yield TTSStartedFrame()
        buf = b""
        emitted = 0                     # samples already sent downstream
        try:
            comm = edge_tts.Communicate(text, self._voice_id, rate=self._rate)
            async for chunk in comm.stream():
                if chunk.get("type") != "audio" or not chunk.get("data"):
                    continue
                buf += chunk["data"]
                try:
                    dec = miniaudio.decode(
                        buf, output_format=miniaudio.SampleFormat.SIGNED16,
                        nchannels=1, sample_rate=self.NATIVE_HZ)
                except Exception:
                    continue            # not yet a decodable frame — keep buffering
                total = len(dec.samples)
                if total <= emitted:
                    continue
                fresh = dec.samples[emitted:total]
                emitted = total
                if emitted == len(fresh):
                    await self.stop_ttfb_metrics()
                yield TTSAudioRawFrame(fresh.tobytes(), self.NATIVE_HZ, 1)
        except Exception:
            logger.exception("tts: edge synthesis failed for %r", text[:40])
            yield ErrorFrame("edge tts failed")
        finally:
            await self.stop_ttfb_metrics()
            yield TTSStoppedFrame()


class RumikTTSService(InterruptibleTTSService):
    """Rumik Silk (mulberry 1.5) streaming TTS.

    pipecat 0.0.95 has no Rumik service, so this is hand-written to the
    WebsocketService contract: implement _connect_websocket /
    _disconnect_websocket / _receive_messages and the base gives us connection
    verification (ping) and reconnection-with-backoff for free. It therefore uses
    the `websockets` library, NOT aiohttp — the base calls .ping() and inspects
    .state, which only the former exposes.

    THE PROTOCOL MISMATCH THIS CLASS EXISTS TO BRIDGE. Sarvam's socket is a
    streaming-TEXT protocol: you may push clause after clause and the server
    buffers and flushes one continuous stream. Rumik's is REQUEST/RESPONSE and
    strictly one at a time — a second {"text":...} on the same socket CANCELS the
    first, which the server reports as {"type":"cancelled","reason":"interrupt"}.
    pipecat sends one socket message per aggregated sentence as the LLM streams
    and does not wait for completion, so the naive port truncated every
    multi-sentence reply to its LAST sentence (probed live: 85 ms of sentence 1,
    then only sentence 2 spoken). Hence the sender loop below: sends are
    serialised per socket, in a BACKGROUND task rather than inline in run_tts,
    because blocking run_tts would hold the pipeline task and delay the very
    InterruptionFrame that barge-in depends on.

    Why Rumik — measured against the live API from the box, not claimed:
      * Rs 0.50 / 1k characters vs Sarvam bulbul:v3's Rs 3.00. TTS is 65% of our
        per-call cost, so this is a 6x cut on the dominant line.
      * TTFB 0.295s end to end (server reported ttfa_ms 112.5), against Sarvam's
        0.20s median but 4.5s p95. Measured rtf 0.325 — generation runs ~3x ahead
        of playout, which is why serialising sends costs no audible latency.
      * A real cancel that PRESERVES the socket, so barge-in needs no reconnect.
        Sarvam has no cancel at all, which is why barge-in there means closing the
        socket — the root of 13 stalls across 220 calls.

    Protocol, verified live:
      mint  POST https://silk-api.rumik.ai/v1/tts/ws-connect  (Bearer key,
            body {"model":"mulberry","text":...}) -> {ws_url, token, expires_in}
      conn  wss://silk-api.rumik.ai/ws/tts?token=<token>
      send  {"text":..., "speaker":"ira"}          ONE AT A TIME
      recv  binary PCM int16 LE @ 24 kHz mono, then
            {"type":"done", credits_used, duration_s, ttfa_ms, ...}
      stop  {"type":"cancel"} -> {"type":"cancelled","reason":"cancel"}
      idle  {"type":"timeout","message":"Connection idle for 1 minute"} then a
            CLEAN (code 1000) close. Client pings do NOT refresh the vendor timer.

    24 kHz is the ONLY output format (no 8 kHz, no mu-law), so we declare 24 kHz
    and let pipecat's output transport resample onto the 8 kHz Plivo leg.
    """

    MINT_URL = "https://silk-api.rumik.ai/v1/tts/ws-connect"

    def __init__(self, *, api_key: str, voice: str = "ira",
                 model: str = "mulberry", sample_rate: int = 24000,
                 description: str | None = None,
                 turn_wait_secs: float = 20.0, **kwargs):
        super().__init__(sample_rate=sample_rate, **kwargs)
        # 1.4 validates that every settings field is initialized (None = "this
        # service does not support it"); leaving them NOT_GIVEN logs an ERROR on
        # every call and leaves the metrics model name blank.
        try:
            self._settings.voice = voice
            self._settings.language = None
        except Exception:
            pass
        self._api_key = api_key
        self._voice = voice
        self._model = model
        self._description = description
        self._receive_task = None
        self._sender_task = None
        self._request_active = False
        # Initialised HERE, not left to TTSService.start(): run_tts reads it, and
        # if the attribute is missing the FIRST utterance of every call dies with
        # AttributeError (caught by the e2e; a connect-only probe cannot see it).
        self._started = False
        # Rumik's own meter, echoed on the terminal frame — bot.py records it so
        # the health panel can report ACTUAL vendor spend per call instead of
        # inferring it from character counts.
        self._on_credits = None
        self._pending_chars = 0
        self._diag = None
        self._on_generate = None
        # Serialisation state. _turn_done starts SET: the first send must not wait.
        self._send_queue = asyncio.Queue()
        self._turn_done = asyncio.Event()
        self._turn_done.set()
        self._turn_wait_secs = turn_wait_secs
        # Intentional teardown. Without this, closing the socket at end of call
        # looks identical to the vendor's idle-close and would trigger a pointless
        # reconnect during shutdown.
        self._closing = False
        # Cancels actually put on the wire vs interruptions seen. Recorded because
        # "the cancel never fires" is invisible otherwise — it is precisely how the
        # first version of this class shipped broken.
        self._cancels_sent = 0
        self._dropped_audio_bytes = 0
        # Sentences enqueued but not yet terminated by the vendor. NOT the queue's
        # length: the sender pops an item BEFORE sending it, so an empty queue means
        # "nothing waiting", not "nothing outstanding". Gating the end of the bot's
        # turn on queue emptiness ended the turn while the LAST sentence was still
        # unsent, and its audio then arrived after TTSStoppedFrame — 71% of a
        # three-sentence reply reached the caller. Only a runtime trace showed it.
        self._pending_sends = 0
        self._interruptions_seen = 0
        # 1.4: set_model_name is gone — the model lives in self._settings.model
        # (synced to metrics); keep a plain model_name attr for our diagnostics.
        try:
            self._settings.model = f"silk-{model}"
            self._sync_model_name_to_metrics()
        except Exception:
            pass
        self.model_name = f"silk-{model}"
        self.set_voice(voice)

    def set_credits_callback(self, cb):
        self._on_credits = cb

    # ── diagnostics hooks (SAME duck-typed contract bot.py uses for Sarvam) ──
    # These are not optional extras. bot.py wires stall detection through
    # `hasattr(tts, "set_generate_callback")` and `hasattr(_svc,
    # "set_diagnostics")`; without them both guards skip SILENTLY, tts_gen_t is
    # never stamped, watchdog_decide can never return STALL_RECOVER, and the
    # reconnect-and-say-it-again recovery is dead code — on the provider whose
    # whole justification was fixing stalls.
    def set_diagnostics(self, diag):
        self._diag = diag

    def set_generate_callback(self, cb):
        self._on_generate = cb

    def _diag_bump(self, name: str, by: int = 1):
        try:
            if self._diag is not None:
                self._diag.bump(name, by)
        except Exception:
            pass

    def can_generate_metrics(self) -> bool:
        return True

    # ── lifecycle ──
    async def start(self, frame):
        await super().start(frame)
        await self._connect()

    async def stop(self, frame):
        await super().stop(frame)
        await self._disconnect()

    async def cancel(self, frame):
        await super().cancel(frame)
        await self._disconnect()

    async def _connect(self):
        await self._connect_websocket()
        # `not self._receive_task` alone is WRONG: a task that has finished is
        # done-but-not-None, so a fresh socket would come up with no reader and the
        # call would be silent forever. Same trap already fixed for Sarvam.
        if self._websocket and (self._receive_task is None or self._receive_task.done()):
            self._receive_task = self.create_task(
                self._receive_task_handler(self._report_error))
        if self._sender_task is None or self._sender_task.done():
            self._sender_task = self.create_task(self._sender_loop())

    async def _disconnect(self):
        self._closing = True
        for attr in ("_receive_task", "_sender_task"):
            task = getattr(self, attr, None)
            if task:
                await self.cancel_task(task, timeout=2.0)
                setattr(self, attr, None)
        await self._disconnect_websocket()

    # ── WebsocketService contract ──
    async def _connect_websocket(self):
        from websockets.asyncio.client import connect as websocket_connect
        from websockets.protocol import State
        try:
            if self._websocket and self._websocket.state is State.OPEN:
                return
            mint = await self._mint()
            self._websocket = await websocket_connect(
                f"{mint['ws_url']}?token={mint['token']}")
            self._closing = False
            # A reconnect must not inherit the old turn's block, or the first send
            # on the new socket waits out the full timeout for a `done` that can
            # never arrive.
            self._turn_done.set()
            logger.info("rumik: connected (%s voice=%s)", self.model_name, self._voice)
        except Exception as e:
            logger.error("rumik: connect failed: %s", e)
            self._websocket = None

    async def _disconnect_websocket(self):
        try:
            await self.stop_all_metrics()
            if self._websocket:
                await self._websocket.close()
        except Exception as e:
            logger.warning("rumik: close failed: %s", e)
        finally:
            self._started = False
            self._request_active = False
            self._websocket = None
            self._pending_sends = 0
            # Release anything waiting on a `done` that will never come.
            self._turn_done.set()

    async def _receive_messages(self):
        """Binary -> audio frames; the terminal frame ends one request.

        MUST RAISE when the socket closes. `websockets.__aiter__` swallows
        ConnectionClosedOK and returns normally, and pipecat's
        _receive_task_handler is `while True: await self._receive_messages()` with
        nothing in the loop that yields — so returning quietly spins the event loop
        at 100% and starves EVERY concurrent call on the box, the Plivo sockets and
        the health endpoint (proven: a 0.05s ticker recorded 0 ticks). Raising
        routes into the base's _try_reconnect, which re-mints with backoff and
        keeps the reader alive.
        """
        import json as _json
        from pipecat.frames.frames import TTSAudioRawFrame, TTSStoppedFrame
        async for message in self._websocket:
            if isinstance(message, (bytes, bytearray)):
                # Drop audio arriving for a request we cancelled: otherwise the
                # tail of a barged-in reply leaks into the next turn. Counted,
                # because "audio we threw away" is the difference between a reply
                # the caller heard and one they did not.
                if not self._request_active:
                    self._dropped_audio_bytes += len(message)
                    continue
                await self.stop_ttfb_metrics()
                await self.push_frame(TTSAudioRawFrame(bytes(message), self.sample_rate, 1))
                continue
            try:
                j = _json.loads(message)
            except Exception:
                continue
            kind = j.get("type")
            if kind in ("done", "cancelled"):
                self._request_active = False
                self._turn_done.set()
                if kind == "done":
                    try:
                        if self._on_credits is not None:
                            self._on_credits(float(j.get("credits_used") or 0.0),
                                             float(j.get("duration_s") or 0.0),
                                             self._pending_chars)
                    except Exception:
                        pass
                # End the bot's TURN only when no sentence of this reply is still
                # outstanding — one Started/Stopped pair per REPLY, not per
                # sentence, or the caller-silence measurements that hang off
                # BotStoppedSpeaking fire in the middle of a reply.
                await self._complete_one_request()
            elif kind == "timeout":
                # The vendor's idle notice, immediately followed by a clean close.
                logger.info("rumik: vendor idle timeout — will reconnect on demand")
            elif kind == "error":
                logger.error("rumik: %s", str(j)[:200])
                self._request_active = False
                self._turn_done.set()
                self._diag_bump("tts_wedges")
                await self._complete_one_request()
        # Loop exited => socket closed. See the docstring: never return quietly.
        if not self._closing:
            raise ConnectionError("rumik: websocket closed by peer")

    async def _complete_one_request(self, *, push_stopped: bool = True):
        """One request finished (or was abandoned). Close the turn if it was the last.

        The counter must never leak: a stuck positive value means TTSStoppedFrame is
        never pushed and the pipeline believes the bot is still speaking for the rest
        of the call, so every path that removes work calls this exactly once.
        """
        from pipecat.frames.frames import TTSStoppedFrame
        self._pending_sends = max(0, self._pending_sends - 1)
        if self._pending_sends == 0 and self._started and push_stopped:
            self._started = False
            await self.push_frame(TTSStoppedFrame())

    async def _sender_loop(self):
        """Serialise sends: one outstanding Rumik request per socket, ever."""
        import json as _json
        from websockets.protocol import State
        while True:
            text = await self._send_queue.get()
            try:
                if not self._turn_done.is_set():
                    try:
                        await asyncio.wait_for(self._turn_done.wait(),
                                               timeout=self._turn_wait_secs)
                    except asyncio.TimeoutError:
                        # Push through rather than wedge. A missing `done` must
                        # degrade to "this sentence cancelled the last one", never
                        # to "the call is silent from here with no signal".
                        self._diag_bump("tts_silent_generations")
                        logger.warning("rumik: no terminal frame in %.1fs — sending anyway",
                                       self._turn_wait_secs)
                if not self._websocket or self._websocket.state is not State.OPEN:
                    logger.warning("rumik: dropping queued sentence, socket down")
                    self._diag_bump("tts_silent_generations")
                    await self._complete_one_request()
                    continue
                self._turn_done.clear()
                self._request_active = True
                # Chars are OUR side of the cost equation (Rs 0.50/1k), recorded
                # per request so the panel can cross-check the vendor's meter
                # against what we actually sent instead of trusting either alone.
                self._pending_chars = len(text)
                payload = {"text": text, "speaker": self._voice}
                if self._description:
                    payload["description"] = self._description
                await self._websocket.send(_json.dumps(payload))
                await self.start_tts_usage_metrics(text)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error("rumik: send failed: %s", e)
                self._request_active = False
                self._turn_done.set()
                self._diag_bump("tts_wedges")
                await self._complete_one_request()
            finally:
                self._send_queue.task_done()

    async def _mint(self):
        """One-shot session token. Separate HTTP call, so it is the one place a
        network hiccup can delay first audio — kept tight at 10s."""
        import aiohttp
        async with aiohttp.ClientSession() as sess:
            async with sess.post(
                    self.MINT_URL,
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json={"model": self._model, "text": "warmup"},
                    timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status != 200:
                    raise RuntimeError(f"rumik mint {r.status}: {(await r.text())[:200]}")
                return await r.json()

    # ── barge-in ──
    async def _handle_interruption(self, frame, direction):
        """Cancel the in-flight request; NEVER tear the socket down.

        Deliberately does NOT call super(): InterruptibleTTSService's version is
        `if self._bot_speaking: await self._disconnect(); await self._connect()`,
        which closes the socket and re-mints — the exact close-and-reconnect path
        this vendor was chosen to avoid, and it runs BEFORE any cancel we send, so
        the cancel became dead code. Traced: bot_speaking=True gave
        [DISCONNECT, MINT+CONNECT] and cancel_sent=False. So we call TTSService's
        version directly (aggregator/filter reset only) and handle the socket here.

        The quiet-bot case is left ALONE on purpose. pipecat pushes an
        InterruptionFrame on every VAD onset while the bot is silent, and our own
        measurement says 60 of 63 such pre-playout kills went on to play anyway.
        Cancelling there would turn a cough or a "hmm" into a lost answer the LLM
        believes it delivered.
        """
        from websockets.protocol import State
        await TTSService._handle_interruption(self, frame, direction)
        self._interruptions_seen += 1
        if not self._bot_speaking:
            return
        # Drop anything still queued for the abandoned reply, and zero the
        # outstanding count in one step — the whole reply is gone, so the
        # per-request decrements will never arrive.
        while not self._send_queue.empty():
            try:
                self._send_queue.get_nowait()
                self._send_queue.task_done()
            except asyncio.QueueEmpty:
                break
        self._pending_sends = 0
        if (self._request_active and self._websocket
                and self._websocket.state is State.OPEN):
            try:
                import json as _json
                await self._websocket.send(_json.dumps({"type": "cancel"}))
                self._cancels_sent += 1
                self._diag_bump("barge_in_cancels")
            except Exception as e:
                logger.warning("rumik: cancel failed: %s", e)
        # AFTER the cancel branch, not before: the receive loop drops binary while
        # this is False, and clearing it earlier would discard the audio of a reply
        # the quiet-window early-return above means to preserve.
        self._request_active = False
        self._started = False
        self._turn_done.set()

    # ── synthesis ──
    async def run_tts(self, text: str, context_id: str | None = None):
        """1.4 calls ``run_tts(prepared_text, context_id)``; 0.0.95 passed text
        only. The mismatch made EVERY reply raise "takes 2 positional arguments
        but 3 were given" — a MUTE bot on the founder's first 1.4 call, with the
        error swallowed into an ErrorFrame the diagnostics never surfaced.
        context_id is accepted and unused: our sender loop is per-socket, and
        pipecat correlates frames itself via the id it passed in."""
        """Enqueue one sentence. Returns immediately — the sender loop serialises.

        Nothing here may block: pipecat calls this from the pipeline task, and
        awaiting a previous request's completion inline would delay the
        InterruptionFrame that stops the bot talking over the caller.
        """
        from pipecat.frames.frames import ErrorFrame, TTSStartedFrame
        from websockets.protocol import State
        # Devanagari-transliterated English terms → Latin BEFORE synthesis (the
        # 'लाइव क्लासेस' → 'लव असेस' class; see normalize_for_rumik).
        text = normalize_for_rumik(text)
        # Letterless input is not speech; same guard as Sarvam (has_word_char).
        if not has_word_char(text):
            logger.info("rumik: skipping letterless chunk %r", (text or "")[:40])
            self._diag_bump("tts_letterless_skipped")
            return
        try:
            if not self._websocket or self._websocket.state is not State.OPEN:
                await self._connect()
            if not self._websocket:
                yield ErrorFrame(error="rumik: no connection")
                return
            if not self._started:
                await self.start_ttfb_metrics()
                yield TTSStartedFrame()
                self._started = True
                # Stamp on SEND, never on `done`. A stamp that lands after the
                # audio makes the stall condition unreachable by construction.
                if self._on_generate is not None:
                    try:
                        self._on_generate()
                    except Exception:
                        pass
                self._diag_bump("replies_generated")
            self._pending_sends += 1
            await self._send_queue.put(text)
        except Exception as e:
            logger.error("rumik run_tts failed: %s", e)
            self._diag_bump("tts_wedges")
            yield ErrorFrame(error=f"rumik error: {e}")
            await self._disconnect()
