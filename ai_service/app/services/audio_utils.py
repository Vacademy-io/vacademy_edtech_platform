"""
Audio normalisation shared by every speech-to-text entry point (the voice
call's WebSocket turns and the text chat's voice notes).

Two jobs:
  * `transcode_to_wav` — browser audio (webm/opus, ogg, mp4) to 16 kHz mono
    PCM WAV via ffmpeg, which ships in this image for the video pipeline.
    Input AND output go through temp files: MP4-family input cannot be demuxed
    from a pipe, and a WAV streamed to stdout carries placeholder RIFF sizes
    that Sarvam rejects with HTTP 400 (both seen in production).
  * `split_wav` — Sarvam's REST STT refuses clips over 30 s ("use the batch
    API"). Long recordings are cut on frame boundaries into ≤29 s WAVs that are
    transcribed one after another.
"""
from __future__ import annotations

import asyncio
import logging
import os
import struct
import tempfile
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# Sarvam's documented per-request ceiling is 30 s; stay under it.
STT_CHUNK_SECONDS = 29.0

_WAV_MIMES = ("audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave")
_SUFFIX_BY_MIME = {
    "audio/webm": ".webm", "video/webm": ".webm", "audio/ogg": ".ogg",
    "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/aac": ".aac",
    "audio/mpeg": ".mp3", "audio/flac": ".flac", "audio/x-caf": ".caf",
}


def base_mime(mime: Optional[str]) -> str:
    return (mime or "").split(";")[0].strip().lower()


def is_wav(mime: Optional[str]) -> bool:
    return base_mime(mime) in _WAV_MIMES


def repair_wav_header(wav: bytes) -> bytes:
    """Make the RIFF and data chunk sizes match the payload (pipe-written WAVs don't)."""
    if len(wav) < 44 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        return wav
    buf = bytearray(wav)
    total = len(buf)
    buf[4:8] = (total - 8).to_bytes(4, "little")
    pos = 12
    while pos + 8 <= total:
        cid = bytes(buf[pos:pos + 4])
        size = int.from_bytes(buf[pos + 4:pos + 8], "little")
        if cid == b"data":
            buf[pos + 4:pos + 8] = (total - pos - 8).to_bytes(4, "little")
            break
        if size in (0, 0xFFFFFFFF) or pos + 8 + size > total:
            break
        pos += 8 + size + (size & 1)
    return bytes(buf)


def parse_wav(wav: bytes) -> Optional[Tuple[int, int, int, int, int]]:
    """
    (channels, sample_rate, bits_per_sample, data_offset, data_length) for a
    PCM WAV, or None if it isn't one we can slice.
    """
    if len(wav) < 44 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        return None
    pos = 12
    fmt = None
    while pos + 8 <= len(wav):
        cid = wav[pos:pos + 4]
        size = int.from_bytes(wav[pos + 4:pos + 8], "little")
        body = pos + 8
        if cid == b"fmt " and size >= 16:
            audio_format, channels, sample_rate, _byte_rate, _block_align, bits = struct.unpack(
                "<HHIIHH", wav[body:body + 16]
            )
            if audio_format != 1:  # PCM only
                return None
            fmt = (channels, sample_rate, bits)
        elif cid == b"data":
            if not fmt:
                return None
            length = min(size, len(wav) - body) if size not in (0, 0xFFFFFFFF) else len(wav) - body
            return (fmt[0], fmt[1], fmt[2], body, length)
        if size in (0, 0xFFFFFFFF):
            return None
        pos = body + size + (size & 1)
    return None


def wav_duration_seconds(wav: bytes) -> Optional[float]:
    parsed = parse_wav(wav)
    if not parsed:
        return None
    channels, rate, bits, _off, length = parsed
    bytes_per_second = channels * rate * (bits // 8)
    return length / bytes_per_second if bytes_per_second else None


def _wav_header(channels: int, rate: int, bits: int, data_len: int) -> bytes:
    block_align = channels * (bits // 8)
    return (
        b"RIFF" + (36 + data_len).to_bytes(4, "little") + b"WAVE"
        + b"fmt " + (16).to_bytes(4, "little")
        + struct.pack("<HHIIHH", 1, channels, rate, rate * block_align, block_align, bits)
        + b"data" + data_len.to_bytes(4, "little")
    )


def split_wav(wav: bytes, max_seconds: float = STT_CHUNK_SECONDS) -> List[bytes]:
    """Cut a PCM WAV into ≤max_seconds standalone WAVs on frame boundaries."""
    parsed = parse_wav(wav)
    if not parsed:
        return [wav]
    channels, rate, bits, off, length = parsed
    frame = channels * (bits // 8)
    chunk_bytes = int(max_seconds * rate) * frame
    if chunk_bytes <= 0 or length <= chunk_bytes:
        return [wav]
    data = wav[off:off + length]
    out: List[bytes] = []
    for start in range(0, len(data), chunk_bytes):
        piece = data[start:start + chunk_bytes]
        piece = piece[: len(piece) - (len(piece) % frame)]
        if piece:
            out.append(_wav_header(channels, rate, bits, len(piece)) + piece)
    return out or [wav]


_WEBM_MAGIC = b"\x1aE\xdf\xa3"  # EBML header
_OGG_MAGIC = b"OggS"


def trim_to_container_start(audio: bytes, mime: Optional[str]) -> Tuple[bytes, int]:
    """
    Drop bytes in front of the container header. Returns (audio, bytes_dropped).

    The voice call streams MediaRecorder chunks and then says "audio_end". The
    recorder's LAST chunk is emitted asynchronously after stop(), so older app
    builds sent it after audio_end — the server then prefixed it to the NEXT
    turn, whose clip no longer started with a header: "EBML header parsing
    failed" in ffmpeg and a 400 from Sarvam on every second turn (prod,
    2026-10-20). Cutting to the real header recovers that turn.
    """
    base = base_mime(mime)
    if len(audio) < 8:
        return audio, 0
    if base in ("audio/webm", "video/webm"):
        magic, back = _WEBM_MAGIC, 0
    elif base == "audio/ogg":
        magic, back = _OGG_MAGIC, 0
    elif base in ("audio/mp4", "audio/x-m4a", "video/mp4"):
        magic, back = b"ftyp", 4  # the box size sits 4 bytes before its type
    else:
        return audio, 0
    if audio[back:back + len(magic)] == magic:
        return audio, 0
    idx = audio.find(magic, back)
    if idx < back:
        return audio, 0
    start = idx - back
    return audio[start:], start


async def transcode_to_wav(audio: bytes, mime: Optional[str]) -> Tuple[bytes, str, str]:
    """
    Normalise to 16 kHz mono 16-bit WAV. Returns (bytes, mime, note) where
    `note` records what happened (wav_passthrough, transcoded_file:<mime>,
    transcode_failed:<why>). On failure the original bytes go through unchanged
    so the caller can still try — and report — rather than drop the audio.
    """
    base = base_mime(mime)
    if not audio:
        return audio, mime or "", "empty"
    if base in _WAV_MIMES:
        return repair_wav_header(audio), "audio/wav", "wav_passthrough"

    src_path = None
    out_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix="stt_in_", suffix=_SUFFIX_BY_MIME.get(base, ".bin"), delete=False) as f:
            f.write(audio)
            src_path = f.name
        out_path = src_path + ".wav"
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-i", src_path, "-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", "-f", "wav", out_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await asyncio.wait_for(proc.communicate(), timeout=30)
        out = b""
        if proc.returncode == 0 and os.path.exists(out_path):
            with open(out_path, "rb") as f:
                out = f.read()
        if proc.returncode == 0 and len(out) > 44:
            return repair_wav_header(out), "audio/wav", f"transcoded_file:{base}"
        detail = (err or b"")[:300].decode("utf-8", "ignore").strip()
        logger.warning("ffmpeg transcode failed (rc=%s, in=%s %dB): %s", proc.returncode, base, len(audio), detail)
        return audio, mime or "", f"transcode_failed:rc{proc.returncode}"
    except FileNotFoundError:
        logger.error("ffmpeg binary not found; sending original audio to STT")
        return audio, mime or "", "transcode_failed:no_ffmpeg"
    except Exception as exc:
        logger.exception("ffmpeg transcode error; sending original audio to STT")
        return audio, mime or "", f"transcode_failed:{type(exc).__name__}"
    finally:
        for path in (src_path, out_path):
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass


__all__ = [
    "STT_CHUNK_SECONDS",
    "base_mime",
    "is_wav",
    "repair_wav_header",
    "parse_wav",
    "wav_duration_seconds",
    "split_wav",
    "transcode_to_wav",
    "trim_to_container_start",
]
