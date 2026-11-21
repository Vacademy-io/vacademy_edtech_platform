"""Voice modulation for the bot's OWN voice — vendor-agnostic.

Clients, 2026-09-11: "the tone is very simple and linear — bot like". Our TTS
(Smallest lightning_v3.1_pro) exposes no prosody control beyond speed, the
founder rejected the one Smallest voice with a wider pitch range, and the ask
was for something that does not depend on the engine at all. So this works on
the AUDIO: track the pitch of each block, and scale every excursion above and
below the voice's own median by ``expand`` (in the log/semitone domain, so the
voice keeps its identity — it just moves more). Resynthesis is Praat's PSOLA
(praat-parselmouth), the standard phonetics tool for exactly this edit.

Measured on real Smallest/mrunal output (pitch spread = sd of F0 in semitones
around the median; conversational human speech sits around 4–5 st):

    expand      1.0     1.3     1.6     2.0
    English     2.9     3.6     3.9     4.3
    Hindi       3.4     4.1     4.7     5.7

Every variant transcribed word-for-word through Sarvam STT, and the whole thing
runs at ~0.04x realtime on the 1-vCPU Mumbai box.

STREAMING. TTS audio arrives in small frames and must not wait for a sentence.
Blocks of ``block_ms`` are shaped with ``context_ms`` of real audio on each
side (pitch tracking needs ~3 periods of context; PSOLA needs it not to start
at a cut), and consecutive blocks are cross-faded over ``xfade_ms`` so the seam
never clicks. First audio is therefore delayed by block + context (~260 ms).
A sentence's tail is flushed on TTSStoppedFrame, and — because that frame is
a vendor promise, not a guarantee — also when no audio has arrived for
``idle_flush_secs``; an interruption drops whatever is pending.

The median is a RUNNING estimate over the whole call (not per block): a block's
own median is part of the movement we want to expand, and centring on it would
flatten the slow declination a sentence naturally has. Until enough pitch has
been seen the block's own median is used.

The DSP (ProsodyShaper) is free of pipecat so it can be tested on synthetic
signals; make_prosody_processor is the thin frame glue, mirroring voice_eq.
"""
from __future__ import annotations

import logging
import math
from typing import Optional

logger = logging.getLogger("voice_bot")

PITCH_FLOOR_HZ = 75.0
PITCH_CEILING_HZ = 400.0
# Fewer points than this and the running median is not yet trustworthy; the
# block centres on itself instead. ~30 points = 0.3 s of voiced speech.
MIN_MEDIAN_POINTS = 30
MAX_MEDIAN_POINTS = 4000
# A flush shorter than this (in ms) is passed through unshaped: too short for a
# pitch track, and inaudible either way.
MIN_SHAPE_MS = 60


def clamp_expand(value, lo: float = 1.0, hi: float = 2.5) -> float:
    """A safe expansion factor from a raw config/agent value; 1.0 = off."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 1.0
    if math.isnan(f):
        return 1.0
    return max(lo, min(hi, f))


class ProsodyShaper:
    """Pitch-range expansion on streamed 16-bit mono PCM, any sample rate."""

    def __init__(self, expand: float = 1.6, *, block_ms: int = 200,
                 context_ms: int = 60, xfade_ms: int = 20):
        self.expand = clamp_expand(expand)
        self.block_ms = block_ms
        self.context_ms = context_ms
        self.xfade_ms = xfade_ms
        self._f0_points: list[float] = []
        self._states: dict[int, dict] = {}
        # Set by process(): audio of a DIFFERENT rate that had to be released
        # before this chunk to keep playout order. The frame glue emits it first.
        self.pending_other_rate: bytes = b""
        self.last_flushed_rate: Optional[int] = None
        self.blocks_shaped = 0
        self.blocks_passed = 0
        self.cpu_secs = 0.0

    # ── state per sample rate (live TTS is 24 kHz, cache hits 8 kHz) ─────────
    def _st(self, sr: int) -> dict:
        st = self._states.get(sr)
        if st is None:
            import numpy as np
            st = {"buf": np.zeros(0), "hist": np.zeros(0), "tail": None}
            self._states[sr] = st
        return st

    def _n(self, ms: int, sr: int) -> int:
        return max(1, int(sr * ms / 1000))

    # ── the edit itself ──────────────────────────────────────────────────────
    def _median(self, block_values) -> float:
        import numpy as np
        if len(self._f0_points) >= MIN_MEDIAN_POINTS:
            return float(np.median(self._f0_points))
        return float(np.median(block_values))

    def _shape(self, x, sr: int):
        """Return x with its pitch excursions scaled; same length as x.
        Raises on any Praat failure — the caller passes audio through."""
        import time
        import numpy as np
        import parselmouth
        from parselmouth.praat import call

        t0 = time.perf_counter()
        snd = parselmouth.Sound(x / 32768.0, sampling_frequency=sr)
        manip = call(snd, "To Manipulation", 0.01, PITCH_FLOOR_HZ, PITCH_CEILING_HZ)
        pt = call(manip, "Extract pitch tier")
        n = int(call(pt, "Get number of points"))
        if n < 3:
            self.cpu_secs += time.perf_counter() - t0
            return None                       # unvoiced/silent block: nothing to shape
        ts = np.array([call(pt, "Get time from index", i + 1) for i in range(n)])
        fs = np.array([call(pt, "Get value at index", i + 1) for i in range(n)])
        med = self._median(fs)
        self._f0_points.extend(fs.tolist())
        if len(self._f0_points) > MAX_MEDIAN_POINTS:
            del self._f0_points[: len(self._f0_points) - MAX_MEDIAN_POINTS]
        st = 12.0 * np.log2(fs / med) * self.expand
        new = np.clip(med * 2.0 ** (st / 12.0), PITCH_FLOOR_HZ, PITCH_CEILING_HZ)
        call(pt, "Remove points between", 0, snd.duration)
        for t, f in zip(ts, new):
            call(pt, "Add point", float(t), float(f))
        call([pt, manip], "Replace pitch tier")
        y = call(manip, "Get resynthesis (overlap-add)").values[0] * 32768.0
        self.cpu_secs += time.perf_counter() - t0
        # PSOLA keeps duration; trim/pad the odd sample so lengths line up exactly.
        if len(y) >= len(x):
            return y[: len(x)]
        return np.concatenate([y, np.zeros(len(x) - len(y))])

    def _emit_block(self, st: dict, sr: int, seg, hist_len: int, take: int, final: bool):
        """Shape `seg` (hist + block [+ right context]); return the output samples
        for the `take` samples after the history, cross-faded with the previous
        block's held tail. When `final`, the held tail is released too."""
        import numpy as np
        y = None
        if len(seg) >= self._n(MIN_SHAPE_MS, sr):
            try:
                y = self._shape(seg, sr)
            except Exception:
                logger.exception("prosody: shaping failed — passing block through")
        if y is None:
            y = seg
            self.blocks_passed += 1
        else:
            self.blocks_shaped += 1
        # The held tail covers the `len(tail)` samples just before this block;
        # re-render that span from the new segment and cross-fade into it.
        tail = st["tail"]
        xf_in = len(tail) if tail is not None and len(tail) <= hist_len else 0
        produced = np.array(y[hist_len - xf_in: hist_len + take])
        if xf_in:
            w = np.linspace(0.0, 1.0, xf_in, endpoint=False)
            produced[:xf_in] = tail * (1 - w) + produced[:xf_in] * w
        elif tail is not None:
            produced = np.concatenate([tail, produced])   # no context to overlap: butt-join
        if final:
            st["tail"] = None
            return produced
        xf_hold = min(self._n(self.xfade_ms, sr), take)
        st["tail"] = produced[-xf_hold:]
        return produced[:-xf_hold]

    @staticmethod
    def _to_bytes(y) -> bytes:
        import numpy as np
        return np.clip(y, -32768, 32767).astype(np.int16).tobytes()

    # ── public API ───────────────────────────────────────────────────────────
    def process(self, pcm: bytes, sample_rate: int) -> bytes:
        """Feed one chunk; returns whatever output is ready (possibly b"").

        ORDER IS PRESERVED ACROSS SAMPLE RATES. Live TTS arrives at 24 kHz and
        speech-cache hits at 8 kHz in the same call, sometimes sentence by
        sentence. The first version kept one buffer per rate and released each
        on its own schedule, so a cached "Got it." left its tail in the 8 kHz
        buffer while the live 24 kHz sentence streamed past — and the tail came
        out mid-sentence ("Since you're Got it. So you have…", call 5a9fe35a,
        2026-09-11). A rate change now flushes the other rate first; the
        returned bytes are then at the incoming frame's rate only because the
        flushed tail is handed back separately via `pending_other_rate`.
        """
        if not pcm or sample_rate <= 0 or self.expand <= 1.0:
            return pcm
        import numpy as np
        self.pending_other_rate = b""
        for other in list(self._states):
            if other != sample_rate:
                self.pending_other_rate += self.flush(other)
                del self._states[other]
        st = self._st(sample_rate)
        x = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)
        st["buf"] = np.concatenate([st["buf"], x])
        block, ctx = self._n(self.block_ms, sample_rate), self._n(self.context_ms, sample_rate)
        out = []
        while len(st["buf"]) >= block + ctx:
            hist = st["hist"]
            seg = np.concatenate([hist, st["buf"][: block + ctx]])
            out.append(self._emit_block(st, sample_rate, seg, len(hist), block, final=False))
            consumed = np.concatenate([hist, st["buf"][:block]])
            st["hist"] = consumed[-ctx:]
            st["buf"] = st["buf"][block:]
        return self._to_bytes(np.concatenate(out)) if out else b""

    def flush(self, sample_rate: int | None = None) -> bytes:
        """Release everything pending (end of a sentence). Returns the tail."""
        import numpy as np
        rates = [sample_rate] if sample_rate else list(self._states)
        out = []
        for sr in rates:
            st = self._states.get(sr)
            if st is None:
                continue
            if len(st["buf"]) or st["tail"] is not None:
                self.last_flushed_rate = sr
            if len(st["buf"]):
                hist = st["hist"]
                seg = np.concatenate([hist, st["buf"]])
                out.append(self._emit_block(st, sr, seg, len(hist), len(st["buf"]), final=True))
            elif st["tail"] is not None:
                out.append(st["tail"])
            st["buf"], st["hist"], st["tail"] = np.zeros(0), np.zeros(0), None
        return self._to_bytes(np.concatenate(out)) if out else b""

    def reset(self) -> None:
        """Drop pending audio (interruption) — the caller does not want it."""
        self._states.clear()


def build_prosody_shaper(expand) -> ProsodyShaper | None:
    """A per-call shaper, or None when off (factor <= 1) or unavailable."""
    f = clamp_expand(expand)
    if f <= 1.0:
        return None
    try:
        import numpy  # noqa: F401
        import parselmouth  # noqa: F401
    except Exception as e:
        logger.warning("prosody: parselmouth/numpy unavailable (%s) — voice left as is", e)
        return None
    return ProsodyShaper(f)


def make_prosody_processor(shaper: ProsodyShaper, *, idle_flush_secs: float = 0.08):
    """Wrap a shaper in a FrameProcessor. Imported lazily so this module stays
    testable (and importable) without pipecat."""
    import asyncio
    import dataclasses

    from pipecat.frames.frames import (
        CancelFrame,
        EndFrame,
        Frame,
        InterruptionFrame,
        OutputAudioRawFrame,
        TTSStoppedFrame,
    )
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

    class ProsodyProcessor(FrameProcessor):
        """Shapes every bot-bound audio frame; passes everything else through.

        Sits AFTER DuckGate (held-then-dropped audio is never shaped for
        nothing) and BEFORE VoiceEQProcessor (shape the full-band voice, then
        band-limit it) — so it catches cache hits and scripted lines as well as
        live TTS, but never the ambience, which is mixed inside the transport.
        """

        def __init__(self, shaper: ProsodyShaper):
            super().__init__()
            self._shaper = shaper
            # A template frame PER SAMPLE RATE: a flushed 8 kHz cache tail must
            # never be wrapped in the 24 kHz live frame that happened to come
            # last, or it plays three times too fast.
            self._last_by_rate: dict[int, OutputAudioRawFrame] = {}
            self._idle_task = None

        def _cancel_idle(self):
            if self._idle_task is not None:
                self._idle_task.cancel()
                self._idle_task = None

        async def _idle_flush(self):
            try:
                await asyncio.sleep(idle_flush_secs)
            except asyncio.CancelledError:
                return
            self._idle_task = None
            await self._release(FrameDirection.DOWNSTREAM)

        async def _emit(self, rate: int, audio: bytes, direction):
            base = self._last_by_rate.get(rate)
            if audio and base is not None:
                await self.push_frame(dataclasses.replace(base, audio=audio), direction)

        async def _release(self, direction):
            # One flush per rate, each in its own correctly-rated frame.
            for rate in list(self._shaper._states):
                await self._emit(rate, self._shaper.flush(rate), direction)

        async def process_frame(self, frame: Frame, direction: FrameDirection):
            await super().process_frame(frame, direction)
            if (direction == FrameDirection.DOWNSTREAM
                    and isinstance(frame, OutputAudioRawFrame) and frame.audio):
                self._cancel_idle()
                self._last_by_rate[frame.sample_rate] = frame
                try:
                    out = self._shaper.process(frame.audio, frame.sample_rate)
                except Exception:
                    logger.exception("prosody: process failed — passing audio through")
                    self._shaper.reset()
                    out = frame.audio
                # Anything of another rate that had to go out first (order!).
                if self._shaper.pending_other_rate and self._shaper.last_flushed_rate:
                    await self._emit(self._shaper.last_flushed_rate,
                                     self._shaper.pending_other_rate, direction)
                    self._shaper.pending_other_rate = b""
                self._idle_task = self.create_task(self._idle_flush())
                if not out:
                    return                        # buffered; nothing ready yet
                frame.audio = out
                await self.push_frame(frame, direction)
                return
            if isinstance(frame, TTSStoppedFrame) and direction == FrameDirection.DOWNSTREAM:
                self._cancel_idle()
                await self._release(direction)
            elif isinstance(frame, (InterruptionFrame, CancelFrame, EndFrame)):
                self._cancel_idle()
                self._shaper.reset()
            await self.push_frame(frame, direction)

    return ProsodyProcessor(shaper)
