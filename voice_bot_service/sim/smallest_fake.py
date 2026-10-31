"""A Smallest.ai live-TTS websocket that speaks the REAL protocol, for the sims.

WHY. The timing sim's own SimTTS yields its audio synchronously from run_tts —
which is how a speech-cache HIT delivers audio, not how Smallest does. Smallest
streams audio back over the socket, pipecat's SmallestTTSService appends each
chunk to get_active_audio_context_id() (the context that is PLAYING), and an
audio context only closes on pipecat's 3 s idle timeout. Neither path ever ran
in the sim, so the two FULL-cache bugs of 2026-09-25 (calls d9aed777 and
5aa10e10: a 2.2 s stall before a cached sentence queued behind live ones, and
live words stamped inside a cached sentence) could not be reproduced there.

THE PROTOCOL, recorded against the live API on 2026-09-25 (voice mrunal,
lightning_v3.1_pro, hi, 24 kHz pcm, word_timestamps on; two requests sent 50 ms
apart on one socket, a third 6 s later):

  * requests on one socket are served strictly IN ORDER, each tagged with its
    own ``request_id``; the second starts streaming as soon as the first is done;
  * first audio ~0.21 s after the send; audio streams at ~3.5-4x real time in
    ~0.15 s chunks (7 KB of 24 kHz s16) roughly 40 ms apart;
  * ``word_timestamp`` messages carry ``word``, ``start``, ``end`` relative to
    THAT request's audio, interleaved with the chunks;
  * there is NO per-request ``complete``: one ``complete`` arrived 4 s after the
    last audio of the whole batch, and none within 4 s of the third request.

Everything else — context routing, the idle timeout, word stamping, the cache
wrapper — is pipecat's and our production code, running unmodified on top.
"""
from __future__ import annotations

import asyncio
import base64
import json
import math
import uuid
from typing import Any, Dict, List, Optional

import numpy as np

try:
    from websockets.protocol import State
except Exception:  # pragma: no cover - websockets always ships with pipecat
    class State:  # type: ignore
        OPEN, CLOSED = 1, 3


class FakeSmallestSocket:
    def __init__(self, *, sample_rate: int = 24000, ttfb: float = 0.21,
                 chunk_secs: float = 0.15, chunk_gap: float = 0.04,
                 secs_per_word: float = 0.33, complete_after: float = 4.0):
        self.state = State.OPEN
        self.sample_rate = sample_rate
        self.ttfb = ttfb
        self.chunk_secs = chunk_secs
        self.chunk_gap = chunk_gap
        self.secs_per_word = secs_per_word
        self.complete_after = complete_after
        self.requests: List[Dict[str, Any]] = []      # what was sent, for the checks
        self._reqs: asyncio.Queue = asyncio.Queue()
        self._out: asyncio.Queue = asyncio.Queue()
        self._worker = asyncio.get_running_loop().create_task(self._serve())

    # -- the websocket surface pipecat uses --------------------------------
    async def send(self, raw: str) -> None:
        m = json.loads(raw)
        text = (m.get("text") or "")
        if not text.strip():
            return                                   # keepalive
        rid = str(uuid.uuid4())
        self.requests.append({"request_id": rid, "text": text})
        await self._reqs.put((rid, text))

    def __aiter__(self):
        return self

    async def __anext__(self) -> str:
        item = await self._out.get()
        if item is None:
            raise StopAsyncIteration
        return json.dumps(item)

    async def recv(self) -> str:
        return await self.__anext__()

    async def close(self) -> None:
        if self.state == State.CLOSED:
            return
        self.state = State.CLOSED
        self._worker.cancel()
        await self._out.put(None)

    # -- the server ---------------------------------------------------------
    def _pcm(self, secs: float) -> bytes:
        n = int(self.sample_rate * secs)
        t = np.arange(n) / self.sample_rate
        f0 = 200 + 30 * np.sin(2 * np.pi * 1.3 * t)
        sig = np.sin(2 * np.pi * np.cumsum(f0) / self.sample_rate) * 8000
        return sig.astype(np.int16).tobytes()

    async def _serve(self) -> None:
        owe_complete = False
        while True:
            try:
                rid, text = await asyncio.wait_for(self._reqs.get(), timeout=self.complete_after)
            except asyncio.TimeoutError:
                if owe_complete:
                    await self._out.put({"status": "complete", "request_id": None})
                    owe_complete = False
                continue
            await asyncio.sleep(self.ttfb)
            words = text.split()
            dur = max(0.5, self.secs_per_word * len(words))
            per = dur / max(1, len(words))
            stamps = [(w, round(i * per + 0.04, 3), round((i + 1) * per - 0.02, 3))
                      for i, w in enumerate(words)]
            nchunks = max(1, math.ceil(dur / self.chunk_secs))
            wi = 0
            for k in range(nchunks):
                secs = min(self.chunk_secs, dur - k * self.chunk_secs)
                # Word events run slightly AHEAD of the audio, as recorded.
                while wi < len(stamps) and stamps[wi][1] < (k + 1.5) * self.chunk_secs:
                    w, st, en = stamps[wi]
                    await self._out.put({"status": "word_timestamp", "request_id": rid,
                                         "data": {"word": w, "start": st, "end": en}})
                    wi += 1
                await self._out.put({"status": "chunk", "request_id": rid,
                                     "data": {"audio": base64.b64encode(self._pcm(secs)).decode()}})
                await asyncio.sleep(self.chunk_gap)
            for w, st, en in stamps[wi:]:
                await self._out.put({"status": "word_timestamp", "request_id": rid,
                                     "data": {"word": w, "start": st, "end": en}})
            owe_complete = True


def patch_smallest_service(sockets: Optional[list] = None) -> None:
    """Make pipecat's REAL SmallestTTSService connect to FakeSmallestSocket.

    Only the socket is replaced: build_tts, _build_smallest, the letterless
    guard, the engine tag, the speech-cache wrapper and all of pipecat's
    context handling run exactly as in production."""
    from pipecat.services.smallest import tts as smallest_mod

    base = smallest_mod.SmallestTTSService
    if getattr(base, "_sim_fake_socket", False):
        return

    class SimSmallestTTSService(base):
        _sim_fake_socket = True

        async def _connect_websocket(self):
            if self._websocket and self._websocket.state is State.OPEN:
                return
            self._websocket = FakeSmallestSocket(sample_rate=self.sample_rate or 24000)
            if sockets is not None:
                sockets.append(self._websocket)
            await self._call_event_handler("on_connected")

    SimSmallestTTSService.__name__ = base.__name__
    SimSmallestTTSService.__qualname__ = base.__qualname__
    smallest_mod.SmallestTTSService = SimSmallestTTSService
