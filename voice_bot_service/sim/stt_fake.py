"""Sarvam and Smallest streaming-STT endpoints on a local socket, for the timing sim.

WHY. The sim's SimSTT is a pass-through that emits scripted finals: no vendor
socket, so nothing the vendor's socket does can reach the pipeline. Call
3e327e8a (2026-10-02) was exactly that: Sarvam's account ran out of credit, the
server answered the stream with a close frame (1003 "Credits exhausted") and
kept the TCP connection open; every send() then waited ~10 s, and the opening
waited behind them (first audio at +13.76 s, 11 of 43 answered calls that
morning waited > 5 s).

So the vendors' REAL clients run here — pipecat's SarvamSTTService over the
sarvamai SDK (websockets' legacy client) and SmallestSTTService (websockets'
asyncio client), built by production's build_stt_waterfall with every wrapper
— against a server that speaks just enough RFC 6455 for them (handshake,
masked client frames, text/binary/close/ping), on a raw asyncio TCP socket so
that it can do what a real server did and a well-behaved library will not:
send a close frame and then hold the TCP connection open.

TRANSCRIPTION is honest about what arrived: the feeder registers every voiced
20 ms chunk of a caller utterance (Line.chunk_owner), the server looks up the
PCM it actually received, and emits that utterance's final only once >= 60 %
of its voiced chunks reached THIS vendor — on the client's flush/finalize, or
on its own endpointing after 1 s without new voice. Audio lost in a stuck
pipeline is never transcribed.

PLAN, per vendor ("sarvam" / "smallest"), from Scenario.stt_fake:
  hang_on_audio=n   close 1003 + hold TCP when the n-th audio message arrives
  hang_on_say=k     ... when the first voiced chunk of caller utterance k arrives
  latency=secs      final after the flush/finalize (Sarvam 0.15 s, Smallest 0.4 s)
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import struct
import time
from typing import Any, Dict, List, Optional

_GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
CREDITS_EXHAUSTED = "Credits exhausted. Add credits in the API Dashboard."


class FakeSTTServer:
    def __init__(self, line, plan: Optional[Dict[str, Dict[str, Any]]] = None, log=None):
        self.line = line
        self.plan = plan or {}
        self.log = log or (lambda *a: None)
        self.port = 0
        self.conns: List[Dict[str, Any]] = []
        self._server = None
        self._tasks: List[asyncio.Task] = []

    async def start(self) -> int:
        self._server = await asyncio.start_server(self._serve, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]
        return self.port

    async def close(self):
        if self._server is not None:
            self._server.close()
        for t in list(self._tasks):
            t.cancel()
        for c in self.conns:
            try:
                c["writer"].close()
            except Exception:
                pass

    # -- per connection -----------------------------------------------------
    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self._tasks.append(asyncio.current_task())
        try:
            head = await reader.readuntil(b"\r\n\r\n")
        except Exception:
            writer.close()
            return
        lines = head.decode("latin-1").split("\r\n")
        path = lines[0].split(" ")[1] if " " in lines[0] else ""
        hdr = {k.strip().lower(): v.strip() for k, _, v in
               (ln.partition(":") for ln in lines[1:] if ":" in ln)}
        vendor = "sarvam" if "speech-to-text" in path else "smallest"
        accept = base64.b64encode(hashlib.sha1(hdr.get("sec-websocket-key", "").encode()
                                               + _GUID).digest()).decode()
        writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                      "Connection: Upgrade\r\nSec-WebSocket-Accept: " + accept
                      + "\r\n\r\n").encode())
        await writer.drain()
        plan = dict(self.plan.get(vendor) or {})
        c = {"vendor": vendor, "writer": writer, "plan": plan, "audio_msgs": 0,
             "heard": {}, "emitted": set(), "last_voice_t": 0.0, "hung_at": None,
             "flushes": 0, "audio_secs": 0.0, "closed": False}
        self.conns.append(c)
        self.log(f"STT-FAKE {vendor}: connected")
        endpoint = asyncio.get_running_loop().create_task(self._endpointing(c))
        self._tasks.append(endpoint)
        try:
            while True:
                op, payload = await self._read_frame(reader)
                if op is None:
                    break
                if c["hung_at"] is not None:
                    continue                    # read and discard: never close the TCP
                if op == 0x8:                   # client close: echo it, then close
                    await self._send(c, 0x8, payload[:2])
                    break
                if op == 0x9:
                    await self._send(c, 0xA, payload)
                    continue
                if op == 0x2:
                    await self._audio(c, payload)
                elif op == 0x1:
                    await self._text(c, payload)
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            endpoint.cancel()
            c["closed"] = True
            try:
                writer.close()
            except Exception:
                pass
            self.log(f"STT-FAKE {vendor}: TCP closed by the client"
                     + (f" ({self.line.now() - c['hung_at']:.1f}s after the close frame)"
                        if c["hung_at"] is not None else ""))

    async def _read_frame(self, reader):
        try:
            b1, b2 = await reader.readexactly(2)
        except asyncio.IncompleteReadError:
            return None, b""
        op = b1 & 0x0F
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack("!H", await reader.readexactly(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", await reader.readexactly(8))[0]
        mask = await reader.readexactly(4) if b2 & 0x80 else b""
        data = await reader.readexactly(n)
        if mask:
            data = bytes(x ^ mask[i % 4] for i, x in enumerate(data))
        return op, data

    async def _send(self, c, op: int, payload: bytes):
        n = len(payload)
        if n < 126:
            head = bytes([0x80 | op, n])
        elif n < 65536:
            head = bytes([0x80 | op, 126]) + struct.pack("!H", n)
        else:
            head = bytes([0x80 | op, 127]) + struct.pack("!Q", n)
        try:
            c["writer"].write(head + payload)
            await c["writer"].drain()
        except Exception:
            pass

    async def _hang(self, c, why: str):
        """What Sarvam did on 3e327e8a: a close frame, then nothing — the TCP
        connection stays open until the CLIENT gives up on it."""
        c["hung_at"] = self.line.now()
        self.log(f"STT-FAKE {c['vendor']}: {why} — close 1003 and holding the TCP open")
        reason = CREDITS_EXHAUSTED.encode()
        await self._send(c, 0x8, struct.pack("!H", 1003) + reason)

    # -- protocol -----------------------------------------------------------
    async def _audio(self, c, pcm: bytes):
        c["audio_msgs"] += 1
        c["audio_secs"] += len(pcm) / 2 / 8000
        plan = c["plan"]
        owner = self.line.chunk_owner.get(pcm) if hasattr(self.line, "chunk_owner") else None
        if plan.get("hang_on_audio") and c["audio_msgs"] >= plan["hang_on_audio"]:
            await self._hang(c, f"audio message {c['audio_msgs']}")
            return
        if owner is not None and plan.get("hang_on_say") == owner:
            await self._hang(c, f"caller utterance {owner} started")
            return
        if owner is not None:
            c["heard"][owner] = c["heard"].get(owner, 0) + 1
            c["last_voice_t"] = time.monotonic()

    async def _text(self, c, payload: bytes):
        try:
            m = json.loads(payload.decode("utf-8"))
        except Exception:
            return
        if c["vendor"] == "sarvam":
            if m.get("type") == "flush":
                c["flushes"] += 1
                await self._finalize(c)
                return
            audio = (m.get("audio") or {}).get("data")
            if audio:
                await self._audio(c, base64.b64decode(audio))
        elif m.get("type") == "finalize":
            c["flushes"] += 1
            await self._finalize(c)

    async def _finalize(self, c):
        lat = float(c["plan"].get("latency", 0.15 if c["vendor"] == "sarvam" else 0.4))
        ready = [k for k, n in c["heard"].items()
                 if k not in c["emitted"] and n >= 0.6 * self.line.say_chunks.get(k, 1)]
        for k in sorted(ready):
            c["emitted"].add(k)
            loop = asyncio.get_running_loop()
            self._tasks.append(loop.create_task(self._emit_later(c, k, lat)))

    async def _emit_later(self, c, k: int, lat: float):
        await asyncio.sleep(lat)
        for text in self.line.say_finals.get(k) or []:
            if not text:
                continue
            if c["vendor"] == "sarvam":
                msg = {"type": "data", "data": {
                    "request_id": f"sim-{k}", "transcript": text, "language_code": "hi-IN",
                    "metrics": {"audio_duration": 1.0, "processing_latency": lat}}}
            else:
                msg = {"is_final": True, "transcript": text, "language": "hi"}
            self.log(f"STT-FAKE {c['vendor']}: final for utterance {k}: {text!r}")
            await self._send(c, 0x1, json.dumps(msg, ensure_ascii=False).encode("utf-8"))

    async def _endpointing(self, c):
        """The vendor's own endpointing: an utterance it has heard enough of
        and no new voice for 1 s gets its final even without a flush."""
        while True:
            await asyncio.sleep(0.25)
            if (c["hung_at"] is None and c["last_voice_t"]
                    and time.monotonic() - c["last_voice_t"] > 1.0):
                await self._finalize(c)


def point_at(server: FakeSTTServer, primary, fallback) -> None:
    """Aim the REAL vendor services build_stt_waterfall built at the fake."""
    for svc in (primary, fallback):
        if svc is None:
            continue
        if hasattr(svc, "_sarvam_client"):
            from sarvamai import AsyncSarvamAI
            from sarvamai.environment import SarvamAIEnvironment
            svc._sarvam_client = AsyncSarvamAI(
                api_subscription_key="sim-not-a-key",
                environment=SarvamAIEnvironment(base=f"http://127.0.0.1:{server.port}",
                                                production=f"ws://127.0.0.1:{server.port}"),
                headers=getattr(svc, "_sdk_headers", None) or {})
        elif hasattr(svc, "_base_url"):
            svc._base_url = f"ws://127.0.0.1:{server.port}"
