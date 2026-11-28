"""Plivo text-to-speech (model koyal-v1).

Docs: https://www.plivo.com/docs/models/text-to-speech/overview (read 2026-11-27).

Two ways in, both authenticated with the Plivo account's Auth ID / Auth Token
(HTTP Basic):

* Realtime WebSocket ``wss://api.plivo.com/v1/Account/{auth_id}/TTS/Realtime/``
  for live calls (PlivoTTSService below).
* Batch ``POST https://api.plivo.com/v1/Account/{auth_id}/TTS/`` for the voice
  audition and the off-call speech-cache renderer (plivo_tts_bytes).

Every Plivo voice speaks ONE language (Meera: Hindi only). The voice's own
language is sent with every request, so a voice is never asked for a language
it does not have (400 language_not_supported).

Realtime protocol, as documented:
  client → {"type": "text", "context_id", "text", "finish", voice_id + options on
            the context's first message}, {"type": "flush"}, {"type": "cancel"}
  server → binary frames ``[u16 LE len][context_id][audio]`` and JSON events
            ``done`` / ``warning`` / ``error`` / ``flush_done`` / ``timestamps``.
Each open reply counts against the account's concurrency (50 per organisation)
until it ends, and an unfinished reply is held open for 60 s. So every sentence
pipecat hands us goes out as its OWN Plivo reply with ``finish: true``: it ends
the moment its audio is out, and nothing is left open between sentences.
"""

from __future__ import annotations

import asyncio
import base64
import io
import itertools
import json
import struct
import wave
from typing import AsyncGenerator, Dict, Optional, Tuple

import logging

from .config import get_settings

logger = logging.getLogger("voice_bot")

PLIVO_TTS_MODEL = "koyal-v1"
PLIVO_TTS_DEFAULT_VOICE = "meera"

# name → (voice_id, gender, language). From GET /TTS/Voices/ as published in the
# docs (2026-11-27). The bot and admin_core store the NAME; only this table knows
# the vendor id. TtsVoiceCatalog.java (PLIVO_VOICES) and the dashboard's
# tts-catalog.ts MUST list the same names and genders: the gender decides the
# agent's Hindi verb endings.
PLIVO_VOICES: Dict[str, Tuple[str, str, str]] = {
    # Hindi
    "meera": ("6uWzc4xFj31t4jNJUaED", "female", "hi"),
    "ritika": ("Hiqcy02wuf8a4sCMcdNO", "female", "hi"),
    "aman": ("OmziUEKO4d83QuGMo3bP", "male", "hi"),
    "ishaan": ("nzWUWk5ShuIYGSosxESk", "male", "hi"),
    # Indian English
    "nisha": ("H25SvwivznBqsIx1R7hX", "female", "en-IN"),
    "prerna": ("3gVUACYdS3ibtu8qPruB", "female", "en-IN"),
    "aarav": ("vGOW5Fzss7kzS9IxCObo", "male", "en-IN"),
    "karan": ("34AUgJTl9p1TLO99Mc7E", "male", "en-IN"),
    # American English
    "allison": ("GhXTeeZNT1zacg9RUbXa", "female", "en-US"),
    "hailey": ("lC7qzMoRE7SSjaNCVeff", "female", "en-US"),
    "garrett": ("P2WNP5RVUP1t6dK9PY52", "male", "en-US"),
    "terrell": ("ieA6hQ563LgXTiOgy6kz", "male", "en-US"),
    "travis": ("Ak70ycoSdDYbeq5sAXsc", "male", "en-US"),
    # British English
    "eleanor": ("Ic0DJ4TLN1ELIYmzwi6H", "female", "en-GB"),
    "poppy": ("0isEP1KMeZPsGSP5qj2A", "female", "en-GB"),
    "archie": ("zYmyWxqLSdlQ0MA4AQEV", "male", "en-GB"),
    # Australian English
    "tahlia": ("S4OkXYkfzKK9f6wzmQ0X", "female", "en-AU"),
    # Bengali
    "debasmita": ("cZncSKHriH32h4IKwAF1", "female", "bn"),
    "ishani": ("GKrPm1RIxbJRv4yYqAxX", "female", "bn"),
    "subhankar": ("vxMrWeHTjRflUziEla6E", "male", "bn"),
    # Tamil
    "nandhini": ("wDPugzmr5HSlFv9MaXk0", "female", "ta"),
    "kathir": ("4YwYWODqig98puWmLYRz", "male", "ta"),
    # Telugu
    "abhiram": ("v2jq1LG20JPbAVrlTWmZ", "male", "te"),
    "pavan": ("cXEjlQTYG6DCOlWVjGe9", "male", "te"),
    # Marathi
    "sanika": ("KCWPtNGDMOQ5bI9SiaIm", "female", "mr"),
    "shravani": ("WqKlYdzJonf6PWElzV6a", "female", "mr"),
    "akshay": ("KYAauPOeeH6Xkcy9YBA7", "male", "mr"),
    "mandar": ("nBMKcKglpeBGawQWLrOa", "male", "mr"),
    # Gujarati
    "hiren": ("xHCIssLpg7mFHuxJAl5D", "male", "gu"),
    "nirav": ("9ZCJ1Lca7nXQprCrubMG", "male", "gu"),
    # Kannada
    "bhavana": ("iNhbJlZPe4LFctxRtJPD", "female", "kn"),
    "spoorthi": ("Ba1rbMwhlf3aXyxKB99Q", "female", "kn"),
    "pradeep": ("JlZpUKXSnAs3C1qmfJR8", "male", "kn"),
}
PLIVO_MALE = frozenset(n for n, (_, g, _l) in PLIVO_VOICES.items() if g == "male")
PLIVO_FEMALE = frozenset(n for n, (_, g, _l) in PLIVO_VOICES.items() if g == "female")
PLIVO_VOICE_NAMES = frozenset(PLIVO_VOICES)

# pace is the only speed control; the API refuses anything outside it.
_PACE_RANGE = (0.7, 1.2)


def plivo_voice(name: Optional[str]) -> Tuple[str, str, str]:
    """(name, voice_id, language) for a stored voice name; the default for an
    unknown or empty one — a name Plivo does not know is a 404 and a mute call."""
    key = (name or "").strip().lower()
    if key not in PLIVO_VOICES:
        if key:
            logger.warning("tts: %r is not a Plivo voice — using %s", key, PLIVO_TTS_DEFAULT_VOICE)
        key = PLIVO_TTS_DEFAULT_VOICE
    vid, _g, lang = PLIVO_VOICES[key]
    return key, vid, lang


def plivo_pace(pace: Optional[float]) -> Optional[float]:
    """The agent's pace clamped to what Plivo accepts; None leaves Plivo's 1.0."""
    if pace is None:
        return None
    lo, hi = _PACE_RANGE
    return round(min(max(float(pace), lo), hi), 3)


def plivo_credentials() -> Tuple[str, str]:
    s = get_settings()
    return (s.plivo_tts_auth_id or "").strip(), (s.plivo_tts_auth_token or "").strip()


def _basic(auth_id: str, auth_token: str) -> str:
    return "Basic " + base64.b64encode(f"{auth_id}:{auth_token}".encode()).decode()


def split_audio_frame(data: bytes) -> Tuple[str, bytes]:
    """A realtime binary frame → (context_id, audio). PURE.
    Layout: 2-byte little-endian context_id length, the context_id, the audio."""
    if len(data) < 2:
        return "", b""
    (n,) = struct.unpack_from("<H", data, 0)
    return data[2:2 + n].decode("utf-8", "replace"), data[2 + n:]


def batch_body(text: str, voice: Optional[str], pace: Optional[float],
               sample_rate: int = 8000) -> dict:
    """The POST /TTS/ body for a WAV of `text`. PURE. Fields are LEFT OUT rather
    than sent as null: Plivo answers a null with 400 invalid_request."""
    _name, vid, lang = plivo_voice(voice)
    body = {
        "voice_id": vid,
        "text": text,
        "model_id": PLIVO_TTS_MODEL,
        "language": lang,
        "output_format": {"container": "wav", "encoding": "pcm_s16le",
                          "sample_rate": int(sample_rate)},
    }
    p = plivo_pace(pace)
    if p is not None:
        body["pace"] = p
    return body


def _fix_streamed_wav(raw: bytes) -> bytes:
    """Plivo streams WAV with its size fields set to 0xFFFFFFFF. Rewrite the
    header from the bytes actually received so every decoder accepts it."""
    try:
        if raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
            return raw
        pos = 12
        fmt = None
        while pos + 8 <= len(raw):
            cid, size = raw[pos:pos + 4], struct.unpack_from("<I", raw, pos + 4)[0]
            if cid == b"fmt ":
                fmt = raw[pos + 8:pos + 8 + 16]
            if cid == b"data":
                pcm = raw[pos + 8:]
                if fmt is None:
                    return raw
                ch, rate = struct.unpack_from("<HI", fmt, 2)
                bits = struct.unpack_from("<H", fmt, 14)[0]
                out = io.BytesIO()
                with wave.open(out, "wb") as w:
                    w.setnchannels(ch)
                    w.setsampwidth(bits // 8)
                    w.setframerate(rate)
                    w.writeframes(pcm[:len(pcm) - len(pcm) % (ch * bits // 8)])
                return out.getvalue()
            if size == 0xFFFFFFFF:
                return raw
            pos += 8 + size + (size & 1)
    except Exception:
        logger.exception("plivo: could not rewrite the streamed WAV header")
    return raw


async def plivo_tts_bytes(text: str, voice: Optional[str], pace: Optional[float] = None,
                          *, session=None, sample_rate: int = 8000,
                          timeout_secs: float = 30.0) -> Optional[bytes]:
    """One complete WAV (pcm_s16le, mono) from the batch endpoint; None on failure."""
    import aiohttp

    auth_id, auth_token = plivo_credentials()
    if not auth_id or not auth_token:
        logger.warning("plivo: PLIVO_TTS_AUTH_ID / PLIVO_TTS_AUTH_TOKEN unset")
        return None
    url = f"{get_settings().plivo_tts_http_url.rstrip('/')}/v1/Account/{auth_id}/TTS/"
    own = session is None
    sess = session or aiohttp.ClientSession()
    try:
        async with sess.post(url, json=batch_body(text, voice, pace, sample_rate),
                             headers={"Authorization": _basic(auth_id, auth_token)},
                             timeout=aiohttp.ClientTimeout(total=timeout_secs)) as r:
            if r.status != 200:
                detail = (await r.text())[:300]
                logger.warning("plivo: TTS %s %s", r.status, detail)
                from . import vendor_failures
                vendor_failures.record("api.plivo.com", "TTS",
                                       reason=vendor_failures.clean_reason(f"HTTP {r.status}: {detail}"))
                return None
            raw = await r.read()
    except Exception as exc:
        logger.exception("plivo: TTS request failed voice=%s", voice)
        from . import vendor_failures
        vendor_failures.record("api.plivo.com", "TTS",
                               reason=vendor_failures.clean_reason(f"{type(exc).__name__}: {exc}"))
        return None
    finally:
        if own:
            await sess.close()
    return _fix_streamed_wav(raw) if raw else None


def _service_class():
    """Built lazily so this module (and its voice table) imports without pipecat."""
    from pipecat.frames.frames import (CancelFrame, EndFrame, ErrorFrame, Frame,
                                       StartFrame, TTSAudioRawFrame, TTSStoppedFrame)
    from pipecat.services.settings import TTSSettings
    from pipecat.services.tts_service import WebsocketTTSService
    from websockets.asyncio.client import connect as websocket_connect
    from websockets.protocol import State

    class PlivoTTSService(WebsocketTTSService):
        """Plivo realtime TTS for a live call.

        One pipecat audio context per turn (pipecat's default), and one Plivo
        reply per SENTENCE inside it, each sent with ``finish: true``. The turn's
        audio context is closed once pipecat has flushed the turn AND every one
        of its sentences has reported ``done``.
        """

        def __init__(self, *, auth_id: str, auth_token: str, voice: str,
                     sample_rate: int = 8000, pace: Optional[float] = None,
                     url: str = "wss://api.plivo.com", **kwargs):
            name, vid, lang = plivo_voice(voice)
            super().__init__(
                push_text_frames=True,
                push_stop_frames=True,
                push_start_frame=True,
                pause_frame_processing=False,
                sample_rate=sample_rate,
                settings=TTSSettings(model=PLIVO_TTS_MODEL, voice=name, language=lang),
                **kwargs,
            )
            self._auth_id = auth_id
            # pipecat sets self.sample_rate only at start(); until then it is 0,
            # and a reply asking Plivo for 0 Hz is refused (unsupported_format).
            self._init_sample_rate = int(sample_rate or 8000)
            self._auth_token = auth_token
            self._voice_id = vid
            self._voice_language = lang
            self._pace = plivo_pace(pace)
            self._url = f"{url.rstrip('/')}/v1/Account/{auth_id}/TTS/Realtime/"
            self._receive_task = None
            self._seq = itertools.count(1)
            # Plivo reply id → the pipecat turn context its audio belongs to.
            self._reply_ctx: Dict[str, str] = {}
            # pipecat turn context → its replies still producing audio.
            self._open: Dict[str, set] = {}
            # pipecat turn contexts flushed (the turn's text is all sent).
            self._flushed: set = set()
            self._credits_cb = None

        def can_generate_metrics(self) -> bool:
            return True

        def set_credits_callback(self, cb):
            """diag.note_tts_spend(credits, secs, chars): Plivo bills characters,
            reported per reply in its ``done`` event."""
            self._credits_cb = cb

        @property
        def model_name(self) -> str:
            return f"plivo/{PLIVO_TTS_MODEL}"

        def _reply_message(self, reply_id: str, text: str) -> dict:
            msg = {
                "type": "text",
                "context_id": reply_id,
                "text": text,
                "finish": True,
                "voice_id": self._voice_id,
                "model_id": PLIVO_TTS_MODEL,
                "language": self._voice_language,
                "output_format": {"container": "raw", "encoding": "pcm_s16le",
                                  "sample_rate": int(self.sample_rate or self._init_sample_rate)},
            }
            if self._pace is not None:
                msg["pace"] = self._pace
            return msg

        # ── connection ────────────────────────────────────────────────────
        async def start(self, frame: StartFrame):
            await super().start(frame)
            await self._connect()

        async def stop(self, frame: EndFrame):
            await super().stop(frame)
            await self._disconnect()

        async def cancel(self, frame: CancelFrame):
            await super().cancel(frame)
            await self._disconnect()

        async def _connect(self):
            await super()._connect()
            await self._connect_websocket()
            if self._websocket and not self._receive_task:
                self._receive_task = self.create_task(self._receive_task_handler(self._report_error))

        async def _disconnect(self):
            await super()._disconnect()
            if self._receive_task:
                await self.cancel_task(self._receive_task)
                self._receive_task = None
            await self._disconnect_websocket()

        async def _connect_websocket(self):
            try:
                if self._websocket and self._websocket.state is State.OPEN:
                    return
                self._websocket = await websocket_connect(
                    self._url,
                    additional_headers={"Authorization": _basic(self._auth_id, self._auth_token)},
                    max_size=None,
                )
                await self._call_event_handler("on_connected")
            except Exception as e:
                await self.push_error(error_msg=f"Plivo TTS connection error: {e}", exception=e)
                self._websocket = None
                await self._call_event_handler("on_connection_error", f"{e}")

        async def _disconnect_websocket(self):
            try:
                await self.stop_all_metrics()
                if self._websocket:
                    await self._websocket.close()
            except Exception as e:
                logger.debug("plivo: close failed: %s", e)
            finally:
                self._websocket = None
                self._reply_ctx.clear()
                self._open.clear()
                self._flushed.clear()
                await self._call_event_handler("on_disconnected")

        def _get_websocket(self):
            if self._websocket:
                return self._websocket
            raise Exception("Websocket not connected")

        # ── turn lifecycle ────────────────────────────────────────────────
        async def _maybe_close_turn(self, ctx: str):
            if ctx in self._flushed and not self._open.get(ctx):
                self._flushed.discard(ctx)
                self._open.pop(ctx, None)
                if self.audio_context_available(ctx):
                    await self.append_to_audio_context(ctx, TTSStoppedFrame(context_id=ctx))
                    await self.remove_audio_context(ctx)

        async def flush_audio(self, context_id: Optional[str] = None):
            """pipecat has sent the turn's last sentence. Every sentence was sent
            with finish already, so there is nothing to tell Plivo: close the
            turn once its replies are done."""
            ctx = context_id or self.get_active_audio_context_id()
            if not ctx:
                return
            self._flushed.add(ctx)
            await self._maybe_close_turn(ctx)

        async def on_audio_context_interrupted(self, context_id: str):
            """Barge-in: stop every reply of this turn at Plivo, so no more audio
            for it is generated (or billed)."""
            await self.stop_all_metrics()
            replies = [r for r, c in self._reply_ctx.items() if c == context_id]
            for reply_id in replies:
                self._reply_ctx.pop(reply_id, None)
                if self._websocket and self._websocket.state is State.OPEN:
                    try:
                        await self._websocket.send(json.dumps({"type": "cancel", "context_id": reply_id}))
                    except Exception as e:
                        logger.debug("plivo: cancel failed: %s", e)
            self._open.pop(context_id, None)
            self._flushed.discard(context_id)
            await super().on_audio_context_interrupted(context_id)

        # ── receiving ─────────────────────────────────────────────────────
        async def _handle_event(self, msg: dict):
            kind = msg.get("type")
            reply_id = msg.get("context_id") or ""
            ctx = self._reply_ctx.get(reply_id)
            if kind == "done":
                self._reply_ctx.pop(reply_id, None)
                if self._credits_cb is not None and msg.get("reason") != "cancelled":
                    try:
                        self._credits_cb(0.0, float(msg.get("audio_seconds") or 0.0),
                                         int(msg.get("characters") or 0))
                    except Exception:
                        logger.exception("plivo: spend callback failed")
                if ctx is not None:
                    self._open.get(ctx, set()).discard(reply_id)
                    await self._maybe_close_turn(ctx)
            elif kind == "error":
                # Ends this reply only; the socket stays open.
                logger.warning("plivo: TTS error %s %s — %s", msg.get("code"),
                               msg.get("status_code"), msg.get("message"))
                self._reply_ctx.pop(reply_id, None)
                await self.push_error(error_msg=f"Plivo TTS error: {msg.get('code')}: "
                                                f"{msg.get('message')}")
                if ctx is not None:
                    self._open.get(ctx, set()).discard(reply_id)
                    await self._maybe_close_turn(ctx)
            elif kind == "warning":
                logger.warning("plivo: TTS warning %s — %s", msg.get("code"), msg.get("message"))

        async def _receive_messages(self):
            async for message in self._get_websocket():
                if isinstance(message, (bytes, bytearray)):
                    reply_id, audio = split_audio_frame(bytes(message))
                    ctx = self._reply_ctx.get(reply_id)
                    if not audio or ctx is None or not self.audio_context_available(ctx):
                        continue
                    await self.stop_ttfb_metrics()
                    await self.append_to_audio_context(ctx, TTSAudioRawFrame(
                        audio=audio, sample_rate=self.sample_rate or self._init_sample_rate,
                        num_channels=1,
                        context_id=ctx))
                    continue
                try:
                    msg = json.loads(message)
                except Exception:
                    continue
                await self._handle_event(msg)

        # ── sending ───────────────────────────────────────────────────────
        async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
            logger.debug("%s: Generating TTS [%s]", self, text)
            reply_id = f"{context_id}-{next(self._seq)}"
            try:
                if not self._websocket or self._websocket.state is State.CLOSED:
                    await self._connect()
                self._reply_ctx[reply_id] = context_id
                self._open.setdefault(context_id, set()).add(reply_id)
                try:
                    await self._get_websocket().send(json.dumps(self._reply_message(reply_id, text)))
                    await self.start_tts_usage_metrics(text)
                except Exception as e:
                    self._reply_ctx.pop(reply_id, None)
                    self._open.get(context_id, set()).discard(reply_id)
                    yield ErrorFrame(error=f"Plivo TTS send error: {e}")
                    yield TTSStoppedFrame(context_id=context_id)
                    await self._disconnect()
                    await self._connect()
                    return
                yield None
            except Exception as e:
                yield ErrorFrame(error=f"Plivo TTS error: {e}")

    return PlivoTTSService


_CLASS = None


def plivo_tts_service_class():
    global _CLASS
    if _CLASS is None:
        _CLASS = _service_class()
    return _CLASS
