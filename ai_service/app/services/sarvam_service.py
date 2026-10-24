"""
Sarvam AI integration service for Text-to-Speech and Speech-to-Text.

Wraps Sarvam's REST and WebSocket APIs for the voice agent feature.
Docs: https://docs.sarvam.ai/
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from typing import Optional

import httpx

try:
    import websockets
except ImportError:  # graceful fallback if websockets not installed yet
    websockets = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SARVAM_BASE_URL = "https://api.sarvam.ai"
TTS_ENDPOINT = f"{SARVAM_BASE_URL}/text-to-speech"
STT_ENDPOINT = f"{SARVAM_BASE_URL}/speech-to-text"

# WebSocket URLs — update these once Sarvam publishes stable streaming endpoints
STT_WS_URL = "wss://api.sarvam.ai/speech-to-text/streaming"  # placeholder
TTS_WS_URL = "wss://api.sarvam.ai/text-to-speech/streaming"  # placeholder

# Filename extension per upload content type — Sarvam keys off both the part's
# content type and its filename, so the two have to agree.
_AUDIO_EXTENSIONS = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/flac": "flac",
}

REST_TIMEOUT_SECONDS = 30
TTS_MAX_CHUNK_CHARS = 500
STT_MAX_AUDIO_SECONDS = 30


# ---------------------------------------------------------------------------
# WebSocket stream helpers
# ---------------------------------------------------------------------------

class SarvamSTTStream:
    """Manages a streaming Speech-to-Text WebSocket connection to Sarvam AI."""

    def __init__(self, ws_connection, language: str = "en-IN"):
        self._ws = ws_connection
        self._language = language

    async def send_audio_chunk(self, chunk_base64: str) -> None:
        """Send a base64-encoded audio chunk over the WebSocket."""
        try:
            payload = json.dumps({
                "audio": chunk_base64,
                "language_code": self._language,
            })
            await self._ws.send(payload)
        except Exception:
            logger.exception("Error sending audio chunk to Sarvam STT stream")

    async def receive_transcript(self) -> Optional[str]:
        """Receive a partial or final transcript from the WebSocket.

        Returns:
            Transcript string, or None if the connection is closed / errored.
        """
        try:
            message = await self._ws.recv()
            data = json.loads(message)
            return data.get("transcript")
        except (asyncio.CancelledError, GeneratorExit):
            raise
        except Exception:
            logger.exception("Error receiving transcript from Sarvam STT stream")
            return None

    async def close(self) -> None:
        """Gracefully close the WebSocket connection."""
        try:
            await self._ws.close()
        except Exception:
            logger.exception("Error closing Sarvam STT stream")


class SarvamTTSStream:
    """Manages a streaming Text-to-Speech WebSocket connection to Sarvam AI."""

    def __init__(self, ws_connection, language: str = "en-IN", voice: str = "shubh"):
        self._ws = ws_connection
        self._language = language
        self._voice = voice

    async def send_text(self, text: str) -> None:
        """Send text to be synthesized over the WebSocket."""
        try:
            payload = json.dumps({
                "text": text,
                "target_language_code": self._language,
                "speaker": self._voice,
            })
            await self._ws.send(payload)
        except Exception:
            logger.exception("Error sending text to Sarvam TTS stream")

    async def receive_audio_chunk(self) -> Optional[bytes]:
        """Receive synthesized audio bytes from the WebSocket.

        Returns:
            Raw audio bytes, or None if the connection is closed / errored.
        """
        try:
            message = await self._ws.recv()
            data = json.loads(message)
            audio_b64 = data.get("audio")
            if audio_b64:
                return base64.b64decode(audio_b64)
            return None
        except (asyncio.CancelledError, GeneratorExit):
            raise
        except Exception:
            logger.exception("Error receiving audio from Sarvam TTS stream")
            return None

    async def close(self) -> None:
        """Gracefully close the WebSocket connection."""
        try:
            await self._ws.close()
        except Exception:
            logger.exception("Error closing Sarvam TTS stream")


# ---------------------------------------------------------------------------
# Main service
# ---------------------------------------------------------------------------

class SarvamSTTError(RuntimeError):
    """Sarvam speech-to-text failed (HTTP error or transport). Carries the status
    so the caller can tell a rejected upload from genuinely empty speech."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class SarvamService:
    """Wraps Sarvam AI TTS and STT APIs (REST + WebSocket)."""

    def __init__(self):
        self.api_key: str = os.environ.get("SARVAM_API_KEY", "")
        self.base_url: str = SARVAM_BASE_URL

    def _headers(self) -> dict[str, str]:
        return {
            "api-subscription-key": self.api_key,
            "Content-Type": "application/json",
        }

    # ------------------------------------------------------------------
    # REST: Text-to-Speech
    # ------------------------------------------------------------------

    async def text_to_speech(
        self,
        text: str,
        language: str = "en-IN",
        voice: str = "shubh",
        pace: Optional[float] = None,
    ) -> bytes:
        """Convert text to speech audio bytes using Sarvam Bulbul v3.

        Handles texts longer than 2500 characters by splitting into chunks
        and concatenating the resulting audio.

        Args:
            text: The text to synthesize.
            language: BCP-47 language code (default ``en-IN``).
            voice: Speaker voice name (default ``shubh``).

        Returns:
            Raw audio bytes (WAV/PCM at 24 kHz), or empty bytes on failure.
        """
        if not text.strip():
            return b""

        chunks = self._split_text(text, TTS_MAX_CHUNK_CHARS)
        audio_parts: list[bytes] = []

        async with httpx.AsyncClient(timeout=REST_TIMEOUT_SECONDS) as client:
            for chunk in chunks:
                audio = await self._tts_single(client, chunk, language, voice, pace)
                if audio:
                    audio_parts.append(audio)

        return b"".join(audio_parts)

    async def _tts_single(
        self,
        client: httpx.AsyncClient,
        text: str,
        language: str,
        voice: str,
        pace: Optional[float] = None,
    ) -> bytes:
        """Synthesize a single text chunk (<=2500 chars)."""
        body = {
            "inputs": [text],
            "target_language_code": language,
            "speaker": voice,
            "model": "bulbul:v3",
            "speech_sample_rate": 24000,
            "enable_preprocessing": True,
        }
        if pace is not None and abs(float(pace) - 1.0) >= 0.05:
            body["pace"] = round(max(0.5, min(2.0, float(pace))), 2)
        try:
            response = await client.post(
                TTS_ENDPOINT,
                headers=self._headers(),
                json=body,
            )
            response.raise_for_status()
            data = response.json()
            audios = data.get("audios", [])
            if audios:
                return base64.b64decode(audios[0])
            logger.warning("Sarvam TTS returned empty audios array")
            return b""
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Sarvam TTS HTTP error %s: %s",
                exc.response.status_code,
                exc.response.text[:500],
            )
            return b""
        except Exception:
            logger.exception("Sarvam TTS request failed")
            return b""

    # ------------------------------------------------------------------
    # REST: Speech-to-Text
    # ------------------------------------------------------------------

    async def speech_to_text(
        self,
        audio_bytes: bytes,
        language: str = "auto",
        mime_type: str = "audio/wav",
    ) -> str:
        """Transcribe audio bytes to text using Sarvam Saaras v3.

        Note: Sarvam limits each request to ~30 seconds of audio. For
        longer audio, callers should split beforehand and concatenate.

        Args:
            audio_bytes: Raw audio data.
            language: BCP-47 language code, or ``"auto"`` for auto-detection.
            mime_type: Container/codec the bytes actually are. Browsers record
                webm/opus, not WAV — sending them under the wrong content type
                leaves transcription at the mercy of server-side sniffing.

        Returns:
            Transcript string, or empty string on failure.
        """
        if not audio_bytes:
            return ""

        upload_type = (mime_type or "audio/wav").split(";")[0].strip() or "audio/wav"

        # Sarvam rejects clips over 30 s with HTTP 400. A PCM WAV can be cut on
        # frame boundaries, so transcribe it in <=29 s pieces and join them.
        if upload_type in ("audio/wav", "audio/x-wav", "audio/wave"):
            from .audio_utils import STT_CHUNK_SECONDS, split_wav, wav_duration_seconds

            duration = wav_duration_seconds(audio_bytes)
            if duration and duration > STT_CHUNK_SECONDS:
                pieces = split_wav(audio_bytes, STT_CHUNK_SECONDS)
                logger.info("STT: %.1fs clip split into %d pieces", duration, len(pieces))
                texts = []
                for piece in pieces:
                    text = await self.speech_to_text(piece, language=language, mime_type="audio/wav")
                    if text.strip():
                        texts.append(text.strip())
                return " ".join(texts)

        headers = {
            "api-subscription-key": self.api_key,
        }

        upload_name = f"audio.{_AUDIO_EXTENSIONS.get(upload_type, 'wav')}"

        form_data: dict = {"model": "saaras:v3"}
        # Only send language_code if explicitly specified (not auto-detect)
        if language and language != "auto":
            form_data["language_code"] = language

        try:
            async with httpx.AsyncClient(timeout=REST_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    STT_ENDPOINT,
                    headers=headers,
                    files={"file": (upload_name, audio_bytes, upload_type)},
                    data=form_data,
                )
                response.raise_for_status()
                data = response.json()
                return data.get("transcript", "") or ""
        except httpx.HTTPStatusError as exc:
            body = exc.response.text[:500]
            logger.error(
                "Sarvam STT HTTP error %s (upload %s, %d bytes): %s",
                exc.response.status_code, upload_type, len(audio_bytes), body,
            )
            # Surfaced, not swallowed: an empty string here used to read as
            # "the student said nothing" and hid a broken upload for days.
            raise SarvamSTTError(f"Sarvam STT HTTP {exc.response.status_code}: {body[:120]}",
                                 status=exc.response.status_code) from exc
        except SarvamSTTError:
            raise
        except Exception as exc:
            logger.exception("Sarvam STT request failed")
            raise SarvamSTTError(f"Sarvam STT request failed: {exc}") from exc

    # ------------------------------------------------------------------
    # WebSocket: Streaming STT
    # ------------------------------------------------------------------

    async def stream_stt_connect(self, language: str = "en-IN") -> SarvamSTTStream:
        """Open a streaming STT WebSocket connection to Sarvam AI.

        Args:
            language: BCP-47 language code (default ``en-IN``).

        Returns:
            A ``SarvamSTTStream`` helper for sending audio and receiving
            transcripts.

        Raises:
            RuntimeError: If the ``websockets`` package is not installed.
            Exception: If the WebSocket connection fails.
        """
        if websockets is None:
            raise RuntimeError(
                "The 'websockets' package is required for streaming. "
                "Install it with: pip install websockets"
            )

        # NOTE: Update STT_WS_URL when Sarvam publishes the final streaming endpoint
        ws_url = f"{STT_WS_URL}?api-subscription-key={self.api_key}&language_code={language}"
        logger.info("Connecting to Sarvam STT streaming: %s", STT_WS_URL)

        ws = await websockets.connect(ws_url)
        return SarvamSTTStream(ws, language=language)

    # ------------------------------------------------------------------
    # WebSocket: Streaming TTS
    # ------------------------------------------------------------------

    async def stream_tts_connect(
        self,
        language: str = "en-IN",
        voice: str = "shubh",
    ) -> SarvamTTSStream:
        """Open a streaming TTS WebSocket connection to Sarvam AI.

        Args:
            language: BCP-47 language code (default ``en-IN``).
            voice: Speaker voice name (default ``shubh``).

        Returns:
            A ``SarvamTTSStream`` helper for sending text and receiving
            audio chunks.

        Raises:
            RuntimeError: If the ``websockets`` package is not installed.
            Exception: If the WebSocket connection fails.
        """
        if websockets is None:
            raise RuntimeError(
                "The 'websockets' package is required for streaming. "
                "Install it with: pip install websockets"
            )

        # NOTE: Update TTS_WS_URL when Sarvam publishes the final streaming endpoint
        ws_url = (
            f"{TTS_WS_URL}"
            f"?api-subscription-key={self.api_key}"
            f"&language_code={language}"
            f"&speaker={voice}"
        )
        logger.info("Connecting to Sarvam TTS streaming: %s", TTS_WS_URL)

        ws = await websockets.connect(ws_url)
        return SarvamTTSStream(ws, language=language, voice=voice)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _split_text(text: str, max_chars: int) -> list[str]:
        """Split text into chunks of at most *max_chars* characters.

        Tries to break at sentence boundaries (`. `, `? `, `! `) to
        produce more natural speech. Falls back to hard splits if a
        single sentence exceeds the limit.
        """
        if len(text) <= max_chars:
            return [text]

        chunks: list[str] = []
        remaining = text

        while remaining:
            if len(remaining) <= max_chars:
                chunks.append(remaining)
                break

            # Find the last sentence boundary within the limit
            split_pos = -1
            for sep in [". ", "? ", "! ", ".\n", "?\n", "!\n"]:
                pos = remaining.rfind(sep, 0, max_chars)
                if pos > split_pos:
                    split_pos = pos + len(sep)

            if split_pos <= 0:
                # No sentence boundary found — hard split at max_chars
                split_pos = max_chars

            chunks.append(remaining[:split_pos].strip())
            remaining = remaining[split_pos:].strip()

        return [c for c in chunks if c]
