"""Speech-to-text through OpenRouter's audio transcription endpoint
(openai/whisper-large-v3-turbo by default; owner decision 2026-09-05).

Verified on prod: POST /api/v1/audio/transcriptions (OpenAI-style multipart)
returns {"text", "usage": {"seconds", "cost"}, "duration", "language"} in a
few seconds per file; the chat/completions endpoint rejects the model.

A lecture is a big video: the media is downloaded once, ffmpeg (present in
the ai_service image) extracts mono 16 kHz audio in ~10-minute mp3 chunks
(~3.5 MB each), the chunks are transcribed a few at a time and the texts
are joined in order. An 82-minute lecture is back in a few minutes instead
of two hours on the render worker's CPU.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

OPENROUTER_TRANSCRIBE_URL = "https://openrouter.ai/api/v1/audio/transcriptions"
DEFAULT_MODEL = "openai/whisper-large-v3-turbo"
CHUNK_SECONDS = 600
CHUNK_CONCURRENCY = 4
MAX_MEDIA_BYTES = 3 * 1024 * 1024 * 1024
AUDIO_BITRATE = "48k"
PER_CHUNK_TIMEOUT = 300.0


@dataclass
class OpenRouterTranscript:
    text: str
    duration_seconds: float
    cost_usd: float
    language: Optional[str] = None
    chunks: int = 0
    model: str = DEFAULT_MODEL
    generation_ids: List[str] = field(default_factory=list)
    # Timed pieces of the transcript, [{"start": s, "end": s, "text": str}] in
    # seconds from the start of the recording (each chunk's verbose_json
    # segments shifted by its offset). Empty when the provider sent none.
    segments: List[Dict[str, Any]] = field(default_factory=list)


class DurationExceeded(RuntimeError):
    """The recording is longer than the caller allowed (max_seconds). Raised
    after probing, before any paid chunk call, so nothing has been spent."""

    def __init__(self, duration: float) -> None:
        self.duration = float(duration or 0.0)
        super().__init__(f"The recording is {self.duration:.0f} s long, over the allowed length")


def chunk_plan(duration_seconds: float, chunk_seconds: int = CHUNK_SECONDS) -> int:
    """How many chunks a recording splits into (at least one)."""
    if duration_seconds <= 0:
        return 1
    return int((duration_seconds + chunk_seconds - 1) // chunk_seconds)


def join_chunk_texts(texts: List[str]) -> str:
    return " ".join(t.strip() for t in texts if t and t.strip()).strip()


def offset_segments(results: List[Optional[dict]], chunk_seconds: int = CHUNK_SECONDS) -> List[Dict[str, Any]]:
    """Every chunk's verbose_json segments on one timeline: chunk i starts at
    i × chunk_seconds (ffmpeg cuts the audio at exactly those points)."""
    out: List[Dict[str, Any]] = []
    for i, body in enumerate(results):
        offset = float(i * chunk_seconds)
        for seg in ((body or {}).get("segments") or []):
            if not isinstance(seg, dict):
                continue
            text = str(seg.get("text") or "").strip()
            if not text:
                continue
            try:
                start = float(seg.get("start") or 0.0)
                end = float(seg.get("end") or start)
            except (TypeError, ValueError):
                continue
            out.append({"start": round(offset + start, 3), "end": round(offset + max(start, end), 3), "text": text})
    return out


async def _download(url: str, dest: Path) -> int:
    size = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0), follow_redirects=True) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            with dest.open("wb") as fh:
                async for part in resp.aiter_bytes(1024 * 1024):
                    size += len(part)
                    if size > MAX_MEDIA_BYTES:
                        raise RuntimeError("The recording is larger than 3 GB")
                    fh.write(part)
    return size


def _probe_duration(path: Path) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=120,
        )
        return float((out.stdout or "0").strip() or 0.0)
    except Exception:  # noqa: BLE001
        return 0.0


def _extract_chunks(src: Path, out_dir: Path, chunk_seconds: int = CHUNK_SECONDS) -> List[Path]:
    """Mono 16 kHz mp3 in chunk_seconds pieces; ffmpeg does demux + resample + split in one pass."""
    pattern = out_dir / "chunk_%03d.mp3"
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000",
           "-b:a", AUDIO_BITRATE, "-f", "segment", "-segment_time", str(chunk_seconds), "-reset_timestamps", "1", str(pattern)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg could not read the recording: {(proc.stderr or '')[-300:]}")
    chunks = sorted(out_dir.glob("chunk_*.mp3"))
    if not chunks:
        raise RuntimeError("The recording has no audio track")
    return chunks


async def _transcribe_chunk(client: httpx.AsyncClient, path: Path, *, key: str, model: str, language: Optional[str]) -> dict:
    data = {"model": model, "response_format": "verbose_json"}
    if language:
        data["language"] = language
    with path.open("rb") as fh:
        resp = await client.post(OPENROUTER_TRANSCRIBE_URL, headers={"Authorization": f"Bearer {key}"},
                                 files={"file": (path.name, fh, "audio/mpeg")}, data=data)
    if resp.status_code != 200:
        raise RuntimeError(f"OpenRouter transcription HTTP {resp.status_code}: {resp.text[:200]}")
    body = resp.json()
    body["_generation_id"] = resp.headers.get("x-generation-id")
    return body


async def transcribe_media(
    source_url: str, *, api_key: str, model: str = DEFAULT_MODEL, language: Optional[str] = None,
    chunk_seconds: int = CHUNK_SECONDS, concurrency: int = CHUNK_CONCURRENCY,
    max_seconds: Optional[float] = None,
) -> OpenRouterTranscript:
    """Download → ffmpeg chunks → parallel transcription → joined text.

    max_seconds (optional): refuse a longer recording with DurationExceeded
    right after probing, before any paid chunk call. When ffprobe cannot read
    the length, the chunk count is the check instead (still before any call)."""
    if not api_key:
        raise RuntimeError("No OpenRouter key for transcription")
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is not available for audio extraction")
    workdir = Path(tempfile.mkdtemp(prefix="tutor-stt-"))
    try:
        media = workdir / "media.bin"
        await _download(source_url, media)
        duration = await asyncio.to_thread(_probe_duration, media)
        if max_seconds is not None and duration and duration > max_seconds:
            raise DurationExceeded(duration)
        chunks = await asyncio.to_thread(_extract_chunks, media, workdir, chunk_seconds)
        if max_seconds is not None and not duration and (len(chunks) - 1) * chunk_seconds > max_seconds:
            # No probed length: every chunk but the last is a full chunk_seconds.
            raise DurationExceeded(float((len(chunks) - 1) * chunk_seconds))
        try:
            media.unlink()
        except OSError:
            pass
        sem = asyncio.Semaphore(max(1, concurrency))
        results: List[Optional[dict]] = [None] * len(chunks)
        async with httpx.AsyncClient(timeout=httpx.Timeout(PER_CHUNK_TIMEOUT, connect=30.0)) as client:
            async def one(i: int, p: Path) -> None:
                async with sem:
                    last: Optional[Exception] = None
                    for attempt in range(3):
                        try:
                            results[i] = await _transcribe_chunk(client, p, key=api_key, model=model, language=language)
                            return
                        except Exception as exc:  # noqa: BLE001
                            last = exc
                            await asyncio.sleep(2 * (attempt + 1))
                    raise RuntimeError(f"chunk {i + 1}/{len(chunks)} failed: {last}")
            await asyncio.gather(*(one(i, p) for i, p in enumerate(chunks)))
        texts = [str((r or {}).get("text") or "") for r in results]
        seconds = sum(float(((r or {}).get("usage") or {}).get("seconds") or (r or {}).get("duration") or 0) for r in results)
        cost = sum(float(((r or {}).get("usage") or {}).get("cost") or 0) for r in results)
        langs = [str((r or {}).get("language") or "") for r in results if (r or {}).get("language")]
        return OpenRouterTranscript(
            text=join_chunk_texts(texts), duration_seconds=float(duration or seconds), cost_usd=cost,
            language=(max(set(langs), key=langs.count) if langs else None), chunks=len(chunks), model=model,
            generation_ids=[str((r or {}).get("_generation_id") or "") for r in results],
            segments=offset_segments(results, chunk_seconds),
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
