"""A Navana (Bodhi) streaming-TTS websocket that speaks the REAL protocol, for the sims.

WHY. Same reason as sim/smallest_fake.py: the timing sim's SimTTS yields audio
synchronously, which is how a speech-cache HIT delivers audio, not how Navana
does. Navana's own Pipecat service (bodhi-api-sdk) streams audio back on a
receive loop and — stock — appends it to the context that is PLAYING. With the
speech cache on (one context per sentence) that is the Smallest misrouting of
2026-09-25, so the cache scenarios must run against the real service.

THE PROTOCOL (docs.navana.ai/text-to-speech/streaming, 2026-09-30):
  * one socket; client sends {"type":"text","seq":n,"target_text":...}; seq is
    per-connection and starts at 1;
  * the server answers each text frame IN ORDER: per chunk, a JSON header
    {"type":"audio","seq":n,"chunk_index":i,"chunk_total":N,"is_last_chunk":b,...}
    followed by a BINARY frame of raw pcm16 at the negotiated rate;
  * {"type":"end"} -> {"type":"done"} and the socket closes.
The handshake (hello/ready) is skipped: the sim patches _connect_websocket,
exactly as smallest_fake does, and sets the state the SDK sets on ready.
"""
from __future__ import annotations

import asyncio
import json
import math
from typing import Any, Dict, List, Optional

import numpy as np

try:
    from websockets.protocol import State
except Exception:  # pragma: no cover
    class State:  # type: ignore
        OPEN, CLOSED = 1, 3


class FakeNavanaSocket:
    def __init__(self, *, sample_rate: int = 24000, ttfb: float = 0.30,
                 chunk_secs: float = 60.0, chunk_gap: float = 0.05,
                 secs_per_word: float = 0.33):
        self.state = State.OPEN
        self.sample_rate = sample_rate
        self.ttfb = ttfb
        # ONE chunk per sentence by default: production Navana sends each
        # sentence as a single chunk (chunk_total 1; the service logs
        # user_requests 7 -> internal_chunks 7). The old 0.25 s chunks hid that
        # "release the text after 60 % of the chunks" meant "after all of it" in
        # production. NV_FAKE_CHUNK_SECS=0.25 runs the multi-chunk shape.
        import os as _os
        self.chunk_secs = float(_os.environ.get("NV_FAKE_CHUNK_SECS", chunk_secs))
        self.chunk_gap = chunk_gap
        self.secs_per_word = secs_per_word
        self.requests: List[Dict[str, Any]] = []
        self._reqs: asyncio.Queue = asyncio.Queue()
        self._out: asyncio.Queue = asyncio.Queue()
        self._worker = asyncio.get_running_loop().create_task(self._serve())

    async def send(self, raw: str) -> None:
        m = json.loads(raw)
        if m.get("type") == "end":
            await self._reqs.put(None)
            return
        if m.get("type") != "text":
            return
        self.requests.append({"seq": m.get("seq"), "text": m.get("target_text", "")})
        await self._reqs.put((m.get("seq"), m.get("target_text", "")))

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self._out.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def recv(self):
        return await self.__anext__()

    async def close(self) -> None:
        if self.state == State.CLOSED:
            return
        self.state = State.CLOSED
        self._worker.cancel()
        await self._out.put(None)

    def _pcm(self, secs: float) -> bytes:
        n = int(self.sample_rate * secs)
        t = np.arange(n) / self.sample_rate
        f0 = 190 + 25 * np.sin(2 * np.pi * 1.1 * t)
        sig = np.sin(2 * np.pi * np.cumsum(f0) / self.sample_rate) * 8000
        return sig.astype(np.int16).tobytes()

    async def _serve(self) -> None:
        while True:
            req = await self._reqs.get()
            if req is None:
                await self._out.put(json.dumps({"type": "done"}))
                continue
            seq, text = req
            await asyncio.sleep(self.ttfb)
            dur = max(0.5, self.secs_per_word * len(text.split()))
            n = max(1, math.ceil(dur / self.chunk_secs))
            for k in range(n):
                secs = min(self.chunk_secs, dur - k * self.chunk_secs)
                pcm = self._pcm(secs)
                await self._out.put(json.dumps({
                    "type": "audio", "seq": seq, "chunk_index": k, "chunk_total": n,
                    "is_last_chunk": k == n - 1, "bytes": len(pcm),
                    "duration_ms": int(secs * 1000), "inference_ms": 40}))
                await self._out.put(pcm)
                await asyncio.sleep(self.chunk_gap)


def patch_navana_service(sockets: Optional[list] = None) -> None:
    """Make the REAL BodhiTTSService connect to FakeNavanaSocket. Only the socket
    is replaced; build_tts, the seq routing, the letterless guard, the cache
    wrapper and pipecat's context handling run exactly as in production."""
    from bodhi.integrations import pipecat_tts as bodhi_mod

    base = bodhi_mod.BodhiTTSService
    if getattr(base, "_sim_fake_socket", False):
        return

    class SimBodhiTTSService(base):
        _sim_fake_socket = True

        async def _connect_websocket(self):
            if self._websocket and self._websocket.state is State.OPEN:
                return
            self._websocket = FakeNavanaSocket(sample_rate=self._output_sample_rate or 24000)
            self._seq = 0
            self._chunk_is_last = False
            if sockets is not None:
                sockets.append(self._websocket)
            await self._call_event_handler("on_connected")

    SimBodhiTTSService.__name__ = base.__name__
    SimBodhiTTSService.__qualname__ = base.__qualname__
    bodhi_mod.BodhiTTSService = SimBodhiTTSService
