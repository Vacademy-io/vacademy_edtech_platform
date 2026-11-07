"""Vacademy AI voice-bot service — FastAPI entrypoint.

Endpoints (mirrors the validated POC server.py, productionized):
  GET  /health            — liveness + computed wss URL
  GET/POST /answer        — Plivo answer XML: [<Record recordSession>] + <Stream>
                            to our /ws + <Redirect> to admin_core's /plivo/ai-next
                            (handoff <Dial> or hangup). Stateless: everything it
                            needs rides the query string, placed there by
                            VacademyAiOutboundCaller (or the IVR renderer).
  WS   /ws                — the Plivo <Stream> audio socket; runs the Pipecat
                            pipeline, then builds + posts the end-of-call report.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import hmac
import json
import logging
import os
import re
import time
from urllib.parse import urlencode
from xml.sax.saxutils import escape

import aiohttp
from fastapi import APIRouter, FastAPI, Query, Request, Response, WebSocket
from fastapi.responses import JSONResponse, PlainTextResponse

from . import admin_core
from .ambience import build_ambience_mixer
from .bot import CallOutcome, run_bot
from . import memory, ttscache, ttswarm
from .config import get_settings
from .providers import rumik_pace_description
from .report import build_and_post_report, report_spool_sweeper

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
from .sarvam_v4_voices import SARVAM_V4_MODEL  # noqa: E402

logger = logging.getLogger("voice_bot")

# Live-call admission control. The event loop is single-threaded, so a plain int
# read+increment with no intervening await is atomic — the /ws gate below relies
# on that. Tracks active /ws pipelines (the CPU-heavy resource), not /answer hits.
_active_calls = 0
# Sockets accepted but still in the telephony handshake (pre-pipeline). Counted
# SEPARATELY from _active_calls so a flood of stalled handshakes (an attacker who
# connects and never sends the Plivo start event) is bounded on its own and can't
# consume the running-call budget legit calls need (deep-review W3).
_inflight_handshakes = 0


def _capacity_left() -> bool:
    return _active_calls < get_settings().max_concurrent_calls


def _warm_llm() -> None:
    """Import + construct the LLM service once at startup, OFF the event loop.
    On Vertex the constructor performs a synchronous service-account OAuth
    (~1-2s of pure loop blocking when done per-call at answer time — audible as
    garble on concurrent calls). Runs in a thread so /health stays responsive
    while the heavy pipecat/google-auth imports load."""
    from .providers import build_llm
    build_llm()


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # One shared HTTP session for the process — SarvamTTSService requires an
    # aiohttp session (keyword-only, no default in the pinned pipecat).
    app.state.http_session = aiohttp.ClientSession()

    async def _warm():
        try:
            await asyncio.to_thread(_warm_llm)
            logger.info("lifespan: LLM provider pre-warmed")
        except Exception:
            logger.exception("lifespan: LLM pre-warm failed (non-fatal)")
        # The heavy imports are in: freeze them out of every future collection
        # (see app/memory.py) — but only while no call is live.
        if _active_calls == 0:
            try:
                memory.freeze_startup()
            except Exception:
                logger.exception("lifespan: gc freeze failed (non-fatal)")

    # Background on purpose: pre-warm and the spool sweeper must not delay
    # startup (the probe window) or block /answer for live traffic.
    app.state.warm_task = asyncio.create_task(_warm())
    app.state.spool_task = asyncio.create_task(report_spool_sweeper())

    async def _open_speech_cache():
        # Rebuilds the RAM index from ONE SQL query. Off the startup path on
        # purpose: a cold or corrupt cache must never delay the readiness probe,
        # and a cache that will not open is a cache that is off, not an outage.
        try:
            await asyncio.to_thread(ttscache.get_cache().open)
        except Exception:
            logger.exception("lifespan: speech cache open failed (non-fatal)")

    app.state.speech_cache_task = asyncio.create_task(_open_speech_cache())
    app.state.tts_sweeper_task = asyncio.create_task(ttswarm.sweeper())
    # Mirrors the ledger into Postgres so the analytics screens are plain SQL
    # rather than a live dependency on this box's disk, and picks up any flush
    # queued the other way. Both use the auth this process already has.
    app.state.tts_reporter_task = asyncio.create_task(ttswarm.reporter())
    try:
        yield
    finally:
        for t in (app.state.warm_task, app.state.spool_task,
                  app.state.speech_cache_task, app.state.tts_sweeper_task,
                  app.state.tts_reporter_task):
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        await app.state.http_session.close()


app = FastAPI(title="Vacademy AI Voice Bot", lifespan=lifespan)

# Served under the shared cluster host at /voice-bot-service (same pattern as
# /ai-service): the ingress forwards the FULL path, so every route carries the
# prefix. PUBLIC_BASE must include it too.
router = APIRouter(prefix="/voice-bot-service")


@router.get("/health")
async def health():
    s = get_settings()
    return {
        "status": "ok",
        "activeCalls": _active_calls,
        "maxConcurrentCalls": s.max_concurrent_calls,
        "ws": s.wss_url("corr=<corr>"),
    }


_SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"
_TTS_MEM: dict[str, bytes] = {}   # small hot cache in front of the disk cache
_TTS_MEM_MAX = 128


def _tts_chunks(text: str, limit: int = 450) -> list[str]:
    """Split on sentence boundaries so each Sarvam input stays within its limit."""
    parts = re.split(r"(?<=[.!?।])\s+", text.strip())
    out, cur = [], ""
    for p in parts:
        if cur and len(cur) + len(p) + 1 > limit:
            out.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        out.append(cur)
    return out or [text[:limit]]


async def _synth_chunk(session, chunk: str, speaker: str, model: str, lang: str, sample_rate: int):
    body = {
        "target_language_code": lang,
        "speaker": speaker,
        "model": model,
        "speech_sample_rate": sample_rate,
        # MP3, not WAV: FreeSWITCH (Plivo's media engine, UA mod_httapi) fetched our
        # valid 8 kHz WAV and still played SILENCE — its <Play> is picky about WAV
        # containers, but plays MP3 reliably. MP3 is also the telephony default.
        "output_audio_codec": "mp3",
    }
    # v4 takes the documented "text"; v2/v3 keep the "inputs" list they were built on.
    if str(model).startswith("bulbul:v4"):
        body["text"] = chunk
    else:
        body["inputs"] = [chunk]
    async with session.post(_SARVAM_TTS_URL, json=body,
                            headers={"api-subscription-key": get_settings().sarvam_api_key},
                            timeout=aiohttp.ClientTimeout(total=20)) as resp:
        if resp.status != 200:
            logger.warning("tts: sarvam %s for %r", resp.status, chunk[:40])
            return None
        data = await resp.json()
    return data.get("audios") or []


async def _synth_audio(text: str, speaker: str, model: str, lang: str) -> bytes | None:
    """Sarvam Bulbul REST → one MP3. Returns None on failure so the caller can fall
    back to Plivo's built-in TTS. Chunks synthesize CONCURRENTLY (cold latency is one
    Sarvam round-trip, not the sum); MP3 frames concatenate by raw byte join and play
    back-to-back, so no container surgery is needed."""
    s = get_settings()
    session: aiohttp.ClientSession = app.state.http_session
    chunks = _tts_chunks(text)
    try:
        # 44.1 kHz (not the 8 kHz call rate) → MPEG-1 MP3, the only profile Plivo plays.
        results = await asyncio.gather(
            *[_synth_chunk(session, c, speaker, model, lang, s.tts_prompt_sample_rate)
              for c in chunks])
    except Exception:
        logger.exception("tts: sarvam call failed")
        return None
    if any(r is None for r in results):
        return None
    out = b"".join(base64.b64decode(b64) for audios in results for b64 in audios)
    return out or None


def _prompt_key(text: str) -> str:
    """Stable id for a prompt's audio — the ADMIN-CORE renderer computes the identical
    SHA-1(text) to build the clean play URL, so both sides agree with no shared state.
    IVR uses one voice/rate, so the text alone is a sufficient key."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


async def _ensure_cached(text: str, voice: str, lang: str) -> str | None:
    """Ensure {cache}/{sha1(text)}.mp3 exists (44.1 kHz MPEG-1); return its path or None."""
    s = get_settings()
    speaker = (voice or s.sarvam_tts_voice).strip()
    path = os.path.join(s.tts_cache_dir, _prompt_key(text) + ".mp3")
    if os.path.exists(path):
        return path
    audio = await _synth_audio(text, speaker, s.sarvam_tts_model, lang)
    if not audio:
        return None
    try:
        os.makedirs(s.tts_cache_dir, exist_ok=True)
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "wb") as f:
            f.write(audio)
        os.replace(tmp, path)  # atomic: a concurrent reader never sees a partial file
    except Exception:
        logger.exception("tts: disk cache write failed")
        return None
    await _evict_tts_cache_async()
    return path


def _serve_audio(path: str, media_type: str, *, touch: bool = False) -> Response:
    """Same delivery contract as _serve_mp3 (full-body 200, LRU touch, 404 on an
    eviction race) for a non-mp3 container. Rumik previews are WAV because Rumik
    streams raw PCM and we carry no mp3 encoder."""
    return _serve_mp3(path, touch=touch, media_type=media_type)


def _serve_mp3(path: str, *, touch: bool = False, media_type: str = "audio/mpeg") -> Response:
    # Plain 200 with the FULL body (NOT FileResponse/206): FreeSWITCH's mod_httapi
    # fetches the whole file and plays SILENCE on a 206 partial response. Content is a
    # 44.1 kHz MPEG-1 MP3 (the only profile Plivo's decoder plays).
    # touch=True bumps mtime so the eviction sweep is a TRUE LRU: a prompt played
    # on live IVR calls stays "recent" and outlives write-once junk — without this
    # the oldest files ARE the warmed IVR prompts, which eviction would delete
    # first, 404-ing the play route with no re-synthesis path (deep-review W3).
    if touch:
        # Best-effort LRU bump — NEVER fail the serve on it: a readable file on a
        # read-only/ownership-degraded volume (EROFS/EPERM/EIO) must still play,
        # not 500 (that would reintroduce the outage the 404 guard below removes,
        # exactly in the disk-trouble conditions eviction exists for — round-2).
        with contextlib.suppress(OSError):
            os.utime(path, None)
    try:
        with open(path, "rb") as f:
            body = f.read()
    except FileNotFoundError:
        # Raced by the eviction thread between the caller's exists-check and here;
        # a 404 lets Plivo fall through to its <Speak> fallback rather than 500.
        return Response(status_code=404)
    return Response(content=body, media_type=media_type,
                    headers={"Cache-Control": "public, max-age=31536000",
                             "Content-Length": str(len(body))})


@router.get("/tts/{token}.mp3")
async def tts_by_token(request: Request, token: str):
    """The URL the renderer gives Plivo: a CLEAN .mp3 path with NO query string, so
    FreeSWITCH's extension-based format detection sees ".mp3". Serves the pre-warmed
    file; 404 if it was never synthesized (warm-on-save populates it)."""
    logger.info("tts play token=%s xff=%s ua=%r range=%s",
                token, request.headers.get("x-forwarded-for"),
                (request.headers.get("user-agent") or "")[:40], request.headers.get("range"))
    path = os.path.join(get_settings().tts_cache_dir, os.path.basename(token) + ".mp3")
    if not os.path.exists(path):
        return Response(status_code=404)
    # touch: this is the LIVE IVR play route — every serve marks the prompt recent.
    return _serve_mp3(path, touch=True)


# By-text route: used by warm-on-save (and on-demand). Caches under sha1(text) so the
# clean /tts/{token}.mp3 play route finds it.
@router.get("/tts")
@router.get("/tts.wav")
@router.get("/tts.mp3")
async def tts(
    request: Request,
    text: str = Query(..., max_length=4000),
    voice: str = Query(""),
    lang: str = Query("hi-IN"),
):
    """Natural-voice audio (44.1 kHz MPEG-1 MP3) for a prompt, in the SAME Sarvam voice
    as the AI agent. Synthesized ONCE per text and cached to disk (a Docker volume), so
    playback is free — IVR prompts are static, no recurring TTS cost."""
    logger.info("tts synth path=%s text=%r", request.url.path, text[:40])
    path = await _ensure_cached(text, voice, lang)
    if not path:
        return Response(status_code=502)
    return _serve_mp3(path)


def _internal_ok(request: Request) -> bool:
    """Shared-secret gate for the internal TTS-cache routes.

    Not public: these SPEND MONEY (each warm is a vendor synthesis), so an open
    endpoint is a way for a stranger to run up our Sarvam bill. Same secret the
    /ws token is minted from, which admin_core already holds.
    """
    secret = get_settings().internal_client_secret
    if not secret:
        return False
    got = request.headers.get("x-voice-bot-token") or ""
    return hmac.compare_digest(got, secret)


@router.post("/internal/tts-cache/warm")
async def tts_cache_warm(request: Request):
    """Pre-render an agent's fixed lines so they hit from call #1.

    Called fire-and-forget by admin_core when an AI agent is saved (see
    AiAgentSpeechWarmer). A failure here must never be visible to the admin who
    just pressed Save — the call simply pays the vendor as it does today.
    """
    if not _internal_ok(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "bad json"}, status_code=400)
    texts = [t for t in (body.get("texts") or []) if isinstance(t, str)][:64]
    if not texts:
        return {"warmed": 0, "skipped": 0, "failed": 0}
    try:
        result = await ttswarm.warm(
            engine=(body.get("engine") or "sarvam").strip().lower(),
            model=(body.get("model") or "").strip(),
            voice=(body.get("voice") or "").strip(),
            pace=body.get("pace"), temperature=body.get("temperature"),
            texts=texts, language=body.get("language"))
    except Exception:
        logger.exception("tts-cache warm failed")
        return JSONResponse({"error": "warm failed"}, status_code=502)
    return result


@router.get("/internal/tts-cache/stats")
async def tts_cache_stats(request: Request):
    """What actually repeats, and how big the store is.

    This is the readout that decides whether the LLM-sentence half of the cache
    earns its complexity: if `repeated` stays a small fraction of `distinct`,
    the lever is a more deterministic script, not more cache engineering.
    """
    if not _internal_ok(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    cache = ttscache.get_cache()
    rows = await asyncio.to_thread(cache.repeat_report, 40)
    head = rows[0] if rows else {}
    return {
        "ready": cache.ready,
        "blobs": cache.size,
        "distinctSentences": head.get("distinct"),
        "totalSightings": head.get("sightings"),
        "repeatedSentences": head.get("repeated"),
        "top": [{"engine": r["engine"], "voice": r["voice"], "count": r["count"],
                 "chars": r["chars"], "text": r["text"][:120]} for r in rows],
    }


@router.get("/internal/tts-cache/export")
async def tts_cache_export(request: Request):
    """The whole ledger, as JSON — the same payload the 120s reporter pushes.

    Exists because the ledger lives on ONE box's local disk, so until now the
    only way to read it was a shell on that box. That made an empty analytics
    table impossible to diagnose remotely: a reporter that never started and a
    ledger with nothing in it look identical from Postgres.

    `ready` is returned separately from the rows for the same reason. A cache
    still opening returns ready=false with zero entries, which is NOT the same
    answer as an open cache that genuinely holds nothing, and a caller that
    cannot tell those apart will "fix" the wrong thing.
    """
    if not _internal_ok(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    cache = ttscache.get_cache()
    try:
        limit = min(max(int(request.query_params.get("limit") or 2000), 1), 5000)
    except ValueError:
        return JSONResponse({"error": "limit must be an integer"}, status_code=400)
    agent_id = (request.query_params.get("agentId") or "").strip()
    try:
        entries = await asyncio.to_thread(cache.export_for_report, limit)
    except Exception:
        logger.exception("tts-cache: export route failed")
        return JSONResponse({"error": "export failed"}, status_code=502)
    if agent_id:
        entries = [e for e in entries if e.get("agentId") == agent_id]
    return {
        "ready": cache.ready,
        "blobs": cache.size,
        "count": len(entries),
        "truncated": len(entries) >= limit,
        "entries": entries,
    }


@router.post("/internal/tts-cache/report-now")
async def tts_cache_report_now(request: Request):
    """Push the ledger to admin-core immediately instead of waiting for the tick.

    The reporter already does this every 120s; this is the same call, on demand,
    for the case where the analytics table needs filling right now — a box that
    was redeployed late, or a first rollout where nobody wants to watch a clock.

    Safe to repeat: admin-core upserts on (cache_key, agent_id), so a second
    push updates the same rows rather than duplicating them.
    """
    if not _internal_ok(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    cache = ttscache.get_cache()
    try:
        entries = await asyncio.to_thread(cache.export_for_report)
    except Exception:
        logger.exception("tts-cache: report-now export failed")
        return JSONResponse({"error": "export failed"}, status_code=502)
    if not entries:
        # The reporter's own `if entries:` guard makes this case silent. Say it
        # out loud here, because "pushed nothing" and "pushed successfully" are
        # the same HTTP 200 otherwise.
        return {"ready": cache.ready, "pushed": 0, "ok": None,
                "note": "ledger is empty — nothing to push"}
    ok = await admin_core.post_tts_cache_report(entries)
    logger.info("tts-cache: report-now pushed %s entries ok=%s", len(entries), ok)
    return {"ready": cache.ready, "pushed": len(entries), "ok": ok}


@router.post("/internal/tts-cache/flush")
async def tts_cache_flush(request: Request):
    """Drop one cached sentence, or everything one agent contributed.

    dryRun defaults TRUE — it reports what WOULD go and deletes nothing. The
    destructive reading of an ambiguous request is the wrong one, and this route
    deletes audio we paid a vendor to render.

    Audio another agent still references is kept: the cache key is global, so
    agents on the same voice share one blob and flushing one must not take
    somebody else's. The returned note says how many were kept for that reason.
    """
    if not _internal_ok(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        body = {}
    agent_id = (body.get("agentId") or "").strip()
    cache_key = (body.get("cacheKey") or "").strip()
    if not agent_id and not cache_key:
        return JSONResponse(
            {"error": "pass agentId or cacheKey — refusing to flush everything"},
            status_code=400)
    dry_run = bool(body.get("dryRun", True))
    cache = ttscache.get_cache()
    try:
        entries, freed, note = await asyncio.to_thread(
            cache.forget, agent_id=agent_id, cache_key=cache_key, dry_run=dry_run)
    except Exception:
        logger.exception("tts-cache: flush route failed")
        return JSONResponse({"error": "flush failed"}, status_code=502)
    logger.info("tts-cache: flush agent=%s key=%s dryRun=%s -> %s",
                agent_id or "-", cache_key or "-", dry_run, note)
    return {"dryRun": dry_run, "entriesRemoved": entries,
            "bytesRemoved": freed, "result": note}


def _cache_write(path: str, data: bytes) -> bool:
    """Atomic cache write; False means "serve inline instead" (never 500)."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        return True
    except Exception:
        logger.exception("preview: cache write failed")
        return False


def _google_tts_mp3(text: str, voice: str, pace: float) -> bytes:
    """One-shot Google Cloud TTS -> MP3. Blocking client, so callers push it to a
    thread. Deliberately NOT reusing the pipecat service: that is a pipeline
    component whose lifecycle assumes a live call.

    44.1 kHz on purpose: Plivo only plays MPEG-1 layer III, and 8 kHz forces
    MPEG-2.5 which it renders as SILENCE (the same trap the IVR /tts route hit)."""
    s = get_settings()
    try:
        from google.cloud import texttospeech
        from google.oauth2 import service_account
        raw = s.vertex_credentials_json.strip()
        if raw:
            creds = service_account.Credentials.from_service_account_info(json.loads(raw))
        else:
            creds = service_account.Credentials.from_service_account_file(
                s.vertex_credentials_path.strip() or "/etc/vertex-sa.json")
        client = texttospeech.TextToSpeechClient(credentials=creds)
        name = (voice or s.google_tts_voice).strip() or s.google_tts_voice
        # "hi-IN-Chirp3-HD-Achird" -> language "hi-IN"
        lang_code = "-".join(name.split("-")[:2]) if name.count("-") >= 2 else s.google_tts_language
        resp = client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=text),
            voice=texttospeech.VoiceSelectionParams(language_code=lang_code, name=name),
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                sample_rate_hertz=44100,
                speaking_rate=max(0.25, min(4.0, pace)),
            ),
        )
        return resp.audio_content or b""
    except Exception:
        logger.exception("preview: google tts failed voice=%s", voice)
        return b""


async def _edge_tts_mp3(text: str, voice: str, pace: float) -> bytes:
    """Audition an Edge voice. Returns MP3 bytes — which is what Edge emits
    natively, so unlike Rumik/Smallest there is nothing to wrap or transcode:
    the browser plays it directly.

    A cross-vendor voice is rejected rather than substituted. An audition that
    plays a DIFFERENT voice than the one that will ship is worse than an
    audition that fails, and this exact confusion already cost a week.
    """
    v = (voice or "").strip()
    if not (v and "-" in v and v.lower().endswith("neural")):
        logger.warning("preview: %r is not an Edge voice", v[:40])
        return b""
    try:
        import edge_tts
    except Exception:
        logger.exception("preview: edge-tts not installed")
        return b""
    pct = int(round((max(0.5, min(2.0, pace)) - 1.0) * 100))
    out = b""
    try:
        async for chunk in edge_tts.Communicate(text, v, rate=f"{pct:+d}%").stream():
            if chunk.get("type") == "audio" and chunk.get("data"):
                out += chunk["data"]
    except Exception:
        logger.exception("preview: edge synthesis failed for voice %r", v[:40])
        return b""
    return out


async def _smallest_tts_wav(text: str, voice: str, model: str, pace: float,
                            language: str | None = None) -> bytes:
    """One-shot Smallest.ai Lightning synthesis over its websocket -> WAV bytes.

    Protocol probe-verified 2026-08-05: one JSON message with flush=True returns
    base64 PCM chunks in `data.audio`, terminated by status="complete"."""
    import base64
    import io
    import wave
    s = get_settings()
    try:
        import websockets
    except ImportError:
        logger.error("preview: websockets missing for smallest")
        return b""
    from .speech_language import smallest_language_code
    pcm = bytearray()
    try:
        async with websockets.connect(
                "wss://api.smallest.ai/waves/v1/tts/live",
                additional_headers={"Authorization": f"Bearer {s.smallest_api_key}"},
                open_timeout=15) as ws:
            await ws.send(json.dumps({
                "text": text, "voice_id": (voice or s.smallest_voice).strip(),
                "model": model, "language": smallest_language_code(language),
                "sample_rate": s.smallest_sample_rate, "output_format": "pcm",
                "speed": max(0.5, min(2.0, pace)), "continue": False, "flush": True,
            }))
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=20)
                if isinstance(msg, (bytes, bytearray)):
                    pcm += msg
                    continue
                ev = json.loads(msg)
                chunk = (ev.get("data") or {}).get("audio")
                if chunk:
                    pcm += base64.b64decode(chunk)
                status = ev.get("status")
                if status in ("complete", "error"):
                    if status == "error":
                        logger.warning("preview: smallest error %s", str(ev)[:200])
                    break
    except Exception:
        logger.exception("preview: smallest tts failed voice=%s model=%s", voice, model)
        return b""
    if not pcm:
        return b""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(s.smallest_sample_rate)
        w.writeframes(bytes(pcm))
    return buf.getvalue()


async def _navana_tts_wav(text: str, voice: str, lang: str, pace: float | None) -> bytes:
    """One-shot Navana synthesis (POST /tts/bytes) -> WAV bytes. The response is
    headerless PCM; X-Sample-Rate says its rate."""
    import io
    import wave
    s = get_settings()
    body = {"text": text, "lang": lang, "voice": (voice or s.navana_tts_voice).strip(),
            "output_format": "24000:pcm16"}
    if pace is not None:          # the audition's slider; the cache renders at the live default
        body["speed"] = max(0.5, min(2.0, pace))
    # One key per request from the same pool as the live sockets (a render
    # holds a Navana stream too); a capacity refusal moves on to the next key.
    from .providers import NAVANA_KEYS, _Lease
    lease, tried = _Lease(), set()
    while True:
        key = NAVANA_KEYS.acquire(lease, exclude=tried)
        if key is None:
            logger.warning("preview: navana — every key refused (%d tried)", len(tried))
            return b""
        try:
            async with app.state.http_session.post(
                    "https://tts.navana.ai/tts/bytes", json=body,
                    headers={"X-API-Key": key},
                    timeout=aiohttp.ClientTimeout(total=60)) as r:
                if r.status != 200:
                    detail = (await r.text())[:200]
                    if r.status == 429 or "concurrency" in detail.lower():
                        NAVANA_KEYS.refused(key)
                        tried.add(key)
                        continue
                    if r.status in (401, 402, 403):
                        # A bad / revoked / out-of-credit key: rest it as the live
                        # sockets do and try the next — at load 0 it would
                        # otherwise be picked first for every render.
                        logger.warning("preview: navana key #%d of %d refused %s — resting it "
                                       "%.0f s: %s", NAVANA_KEYS.index(key),
                                       len(NAVANA_KEYS.keys()), r.status,
                                       NAVANA_KEYS.BAD_KEY_SECS, detail)
                        NAVANA_KEYS.refused(key, NAVANA_KEYS.BAD_KEY_SECS)
                        tried.add(key)
                        continue
                    logger.warning("preview: navana %s %s (key #%d)", r.status, detail,
                                   NAVANA_KEYS.index(key))
                    return b""
                rate = int(r.headers.get("X-Sample-Rate") or 24000)
                pcm = await r.read()
        except Exception:
            logger.exception("preview: navana tts failed voice=%s (key #%d)", voice,
                             NAVANA_KEYS.index(key))
            return b""
        finally:
            NAVANA_KEYS.release(lease, key)
        break
    if not pcm:
        return b""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


@router.get("/preview.mp3")
async def preview(
    text: str = Query(..., max_length=300),
    voice: str = Query(..., max_length=48),
    lang: str = Query("hi-IN", max_length=8),
    pace: float = Query(1.0, ge=0.5, le=2.0),
    temperature: float | None = Query(None, ge=0.01, le=2.0),
    # 24 was too short for the one form that needs it: "smallest:lightning_v3.1_pro"
    # is 27 chars, so the documented per-model escape hatch 422'd before reaching
    # any vendor. Still capped - this is a public endpoint - just not below the
    # length of its own longest legitimate value.
    model: str = Query("sarvam", max_length=48),
):
    """Voice tester for the admin AI-Agents editor: speak a short sample text in any
    Bulbul speaker at a chosen pace/expressiveness, so admins can A/B voices before
    saving an agent. SEPARATE from /tts on purpose: the IVR cache there is keyed by
    sha1(text) ALONE (the admin-core play URL depends on that contract — see
    VacademyAiAnswerUrls.ttsUrl), so previewing the same text in two voices through
    /tts would collide and corrupt IVR playback. Preview caches under its own
    voice+pace-aware key. Text is capped hard: this is a public endpoint spending
    Sarvam credits — cache + cap bound the cost (same exposure class as /tts)."""
    s = get_settings()
    # Route to the SAME engine the agent will use on a call. Without this the admin
    # auditions a Sarvam voice and the caller hears Rumik (or, for a Rumik voice
    # name, Sarvam 400s and the tester just fails) — an audition that lies about
    # what ships is worse than no audition.
    engine = (model or "").strip().lower()

    if engine.startswith("google") or engine.startswith("chirp"):
        # Google Cloud TTS audition. Chirp3-HD is the founder's pick; the voice
        # name IS locale-prefixed (hi-IN-Chirp3-HD-Achird), so no language param
        # is needed and a wrong-vendor name fails loudly instead of substituting.
        key = hashlib.sha1(
            f"pv|google|{voice}|{pace}|{text}".encode("utf-8")).hexdigest()
        path = os.path.join(s.tts_cache_dir, f"pv-{key}.mp3")
        if not os.path.exists(path):
            audio = await asyncio.to_thread(_google_tts_mp3, text, voice, pace)
            if not audio:
                return Response(status_code=502)
            if not _cache_write(path, audio):
                return Response(content=audio, media_type="audio/mpeg")
            await _evict_tts_cache_async()
        return _serve_mp3(path)

    if engine.startswith("edge") or engine.startswith("microsoft"):
        # Edge emits MP3 natively — serve it straight through.
        key = hashlib.sha1(
            f"pv|edge|{voice}|{pace}|{text}".encode("utf-8")).hexdigest()
        path = os.path.join(s.tts_cache_dir, f"pv-{key}.mp3")
        if not os.path.exists(path):
            audio = await _edge_tts_mp3(text, voice, pace)
            if not audio:
                return Response(status_code=502)
            if not _cache_write(path, audio):
                return Response(content=audio, media_type="audio/mpeg")
            await _evict_tts_cache_async()
        return _serve_mp3(path)

    if engine.startswith("smallest") or engine.startswith("lightning"):
        # Smallest.ai Lightning audition. Its palettes are PER-MODEL and the API
        # hard-rejects a cross-model voice, so pass the model through: an admin
        # auditioning a _pro voice must hit _pro, or the preview lies.
        if not s.smallest_api_key:
            logger.warning("preview: smallest requested but SMALLEST_API_KEY unset")
            return Response(status_code=503)
        from .providers import smallest_model_for
        sm_model = smallest_model_for(engine)
        from .speech_language import smallest_language_code
        language = smallest_language_code(lang)
        key = hashlib.sha1(
            f"pv|{sm_model}|{voice}|{pace}|{language}|{text}".encode("utf-8")).hexdigest()
        # Lightning streams raw PCM over its websocket; wrap as WAV (same reason
        # as the Rumik path — no mp3 encoder in this image).
        path = os.path.join(s.tts_cache_dir, f"pv-{key}.wav")
        if not os.path.exists(path):
            raw = await _smallest_tts_wav(text, voice, sm_model, pace, language)
            if not raw:
                return Response(status_code=502)
            if not _cache_write(path, raw):
                return Response(content=raw, media_type="audio/wav")
            await _evict_tts_cache_async()
        return _serve_audio(path, "audio/wav")

    if engine.startswith("navana") or engine.startswith("bodhi"):
        # Navana audition through its non-streaming endpoint (the live call
        # streams; same voices, same language rule). Raw PCM → WAV, as Smallest.
        from .providers import navana_keys
        if not navana_keys(s.navana_api_key):
            logger.warning("preview: navana requested but NAVANA_API_KEY unset")
            return Response(status_code=503)
        from .providers import navana_language
        nv_lang = navana_language(lang)
        key = hashlib.sha1(f"pv|navana|{voice}|{pace}|{nv_lang}|{text}".encode("utf-8")).hexdigest()
        path = os.path.join(s.tts_cache_dir, f"pv-{key}.wav")
        if not os.path.exists(path):
            # No speed: the live call's stream cannot send one, so an audition
            # at another speed would lie about what ships.
            raw = await _navana_tts_wav(text, voice, nv_lang, None)
            if not raw:
                return Response(status_code=502)
            if not _cache_write(path, raw):
                return Response(content=raw, media_type="audio/wav")
            await _evict_tts_cache_async()
        return _serve_audio(path, "audio/wav")

    is_rumik = engine.startswith("rumik") or engine.startswith("silk") \
        or engine.startswith("mulberry")
    if is_rumik:
        if not s.rumik_api_key:
            logger.warning("preview: rumik requested but RUMIK_API_KEY unset")
            return Response(status_code=503)
        # pace MUST be in the cache key. Without it the first pace previewed for a
        # given voice+text is served forever, so moving the slider appears to do
        # nothing — which is indistinguishable from the steering being broken.
        pace_desc = rumik_pace_description(pace)
        key = hashlib.sha1(
            f"pv|rumik|{voice}|{pace_desc}|{text}".encode("utf-8")).hexdigest()
        # .wav, not .mp3: Rumik streams raw PCM and we do not carry an mp3 encoder.
        # The route name is historical; the Content-Type is what browsers obey.
        path = os.path.join(s.tts_cache_dir, f"pv-{key}.wav")
        if not os.path.exists(path):
            from .providers import rumik_synthesize_wav
            raw = await rumik_synthesize_wav(text, voice, s.rumik_api_key,
                                             session=app.state.http_session,
                                             description=pace_desc)
            if not raw:
                return Response(status_code=502)
            try:
                os.makedirs(s.tts_cache_dir, exist_ok=True)
                tmp = f"{path}.{os.getpid()}.tmp"
                with open(tmp, "wb") as f:
                    f.write(raw)
                os.replace(tmp, path)
            except Exception:
                logger.exception("preview: cache write failed")
                return Response(content=raw, media_type="audio/wav")
            await _evict_tts_cache_async()
        return _serve_audio(path, "audio/wav")
    is_v4 = engine.startswith(("sarvam_v4", "sarvam-v4", "bulbul:v4", "bulbul_v4", "bulbul-v4"))
    sarvam_model = SARVAM_V4_MODEL if is_v4 else s.sarvam_tts_model
    if is_v4 and temperature is not None:
        temperature = min(temperature, 1.0)  # v4's documented range is 0.01-1.0
    key = hashlib.sha1(
        f"pv|{sarvam_model}|{voice}|{lang}|{pace}|{temperature}|{text}".encode("utf-8")
    ).hexdigest()
    path = os.path.join(s.tts_cache_dir, f"pv-{key}.mp3")
    if not os.path.exists(path):
        session = app.state.http_session
        body = {
            "target_language_code": lang,
            "speaker": voice.strip().lower(),
            "model": sarvam_model,
            "speech_sample_rate": s.tts_prompt_sample_rate,
            "output_audio_codec": "mp3",
            "pace": pace,
        }
        if temperature is not None:
            body["temperature"] = temperature
        if is_v4:
            body["text"] = text
        else:
            body["inputs"] = [text]
        try:
            async with session.post(_SARVAM_TTS_URL, json=body,
                                    headers={"api-subscription-key": s.sarvam_api_key},
                                    timeout=aiohttp.ClientTimeout(total=20)) as resp:
                if resp.status != 200:
                    detail = (await resp.text())[:200]
                    logger.warning("preview: sarvam %s voice=%s: %s", resp.status, voice, detail)
                    return Response(status_code=502)
                data = await resp.json()
        except Exception:
            logger.exception("preview: sarvam call failed")
            return Response(status_code=502)
        audios = data.get("audios") or []
        raw = b"".join(base64.b64decode(b64) for b64 in audios)
        if not raw:
            return Response(status_code=502)
        try:
            os.makedirs(s.tts_cache_dir, exist_ok=True)
            tmp = f"{path}.{os.getpid()}.tmp"
            with open(tmp, "wb") as f:
                f.write(raw)
            os.replace(tmp, path)
        except Exception:
            logger.exception("preview: cache write failed")
            return Response(content=raw, media_type="audio/mpeg")
        await _evict_tts_cache_async()
    return _serve_mp3(path)


# ── /ws admission token ──────────────────────────────────────────────────────
# /answer authors the wss URL Plivo connects to, so /answer mints a short-lived
# HMAC token that /ws verifies. This RAISES the bar on the open-socket hole
# (anyone who knew the path could hold all MAX_CONCURRENT_CALLS slots and burn
# Sarvam/LLM spend) with no admin_core change (key = VOICE_BOT_CLIENT_SECRET,
# already provisioned). It is NOT a complete DoS shield: /answer is public
# (Plivo must reach it) so an attacker can still mint tokens. Two further guards
# in /ws bound the residual: tokens are SINGLE-USE (one token → one socket, no
# replay amplification), and the capacity slot is claimed only AFTER a
# successful telephony handshake, with stalled pre-handshake sockets bounded by
# a SEPARATE cap so they can't starve the running-call budget (deep-review W3).
# Edge rate-limiting (Cloudflare/nginx on /answer + /ws) remains the real fix
# for a determined flood and is tracked as a follow-up.
_WS_TOKEN_TTL_SECS = 900.0  # Plivo connects within seconds of fetching the XML
# Signatures already spent, so a captured token can't be replayed across many
# sockets. Single-process service (the _active_calls int is relied on as atomic),
# so an in-memory set is authoritative; it resets on deploy (fine — tokens are
# minted seconds before use). Pruned opportunistically so it can't grow unbounded.
_spent_ws_tokens: dict = {}


def _mint_ws_token(corr: str, now: float | None = None) -> str:
    secret = get_settings().internal_client_secret
    exp = int((now if now is not None else time.time()) + _WS_TOKEN_TTL_SECS)
    sig = hmac.new(secret.encode(), f"{corr}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"{exp}.{sig}"


def _verify_ws_token(corr: str, token: str, now: float | None = None) -> bool:
    secret = get_settings().internal_client_secret
    if not secret:
        # Unconfigured secret = the service can't fetch call context either, so
        # nothing real runs; don't brick dev setups, just log once per connect.
        logger.warning("ws-token: VOICE_BOT_CLIENT_SECRET unset — token check skipped")
        return True
    try:
        exp_s, sig = token.split(".", 1)
        exp = int(exp_s)
    except (ValueError, AttributeError):
        return False
    if (now if now is not None else time.time()) > exp:
        return False
    want = hmac.new(secret.encode(), f"{corr}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(want, sig)


def _consume_ws_token(corr: str, token: str, now: float | None = None) -> bool:
    """Verify the token AND spend it — a second /ws carrying the same token is
    rejected, so one /answer fetch admits exactly one socket. No-op single-use
    when the secret is unset (dev)."""
    now = now if now is not None else time.time()
    if not _verify_ws_token(corr, token, now):
        return False
    if not get_settings().internal_client_secret:
        return True  # dev: verify already logged + returned True; nothing to spend
    key = f"{corr}|{token}"
    if key in _spent_ws_tokens:
        logger.warning("ws-token: replay rejected corr=%s", corr)
        return False
    # Opportunistic prune of expired signatures (bounded memory).
    if len(_spent_ws_tokens) > 2048:
        for k, exp in list(_spent_ws_tokens.items()):
            if exp < now:
                _spent_ws_tokens.pop(k, None)
    _spent_ws_tokens[key] = now + _WS_TOKEN_TTL_SECS
    return True


def _evict_tts_cache(cache_dir: str, max_files: int, max_bytes: int) -> int:
    """Bound the public-endpoint disk cache. Eviction order: voice-preview files
    ("pv-*", freely re-synthesizable) first, then least-recently-SERVED within
    each class — the play route bumps mtime on every serve (_serve_mp3 touch=True)
    so a live IVR prompt outlives write-once junk. IVR prompts have no re-synth
    path (the /tts/{token}.mp3 URL 404s until an admin re-saves), so protecting
    the actively-served ones is essential. Runs in a thread. Returns count."""
    try:
        scan = list(os.scandir(cache_dir))
    except FileNotFoundError:
        return 0  # cache dir not created yet — nothing to evict
    entries = []
    for e in scan:
        try:
            if e.is_file() and e.name.endswith(".mp3"):
                st = e.stat()
                entries.append((not e.name.startswith("pv-"), st.st_mtime, st.st_size, e.path))
        except FileNotFoundError:
            # A concurrent eviction/write unlinked this entry between scandir and
            # stat — skip it, do NOT abort the whole pass (a blanket except around
            # the loop mistook this for a missing dir and skipped eviction under
            # exactly the write pressure it defends against — deep-review W3).
            continue
    total = sum(sz for _, _, sz, _ in entries)
    if len(entries) <= max_files and total <= max_bytes:
        return 0
    entries.sort()
    evicted = 0
    while entries and (len(entries) > max_files or total > max_bytes):
        _, _, sz, path = entries.pop(0)
        try:
            os.remove(path)
            total -= sz
            evicted += 1
        except OSError:
            pass
    if evicted:
        logger.warning("tts cache: evicted %d oldest files (cap %d files / %d bytes)",
                       evicted, max_files, max_bytes)
    return evicted


async def _evict_tts_cache_async() -> None:
    s = get_settings()
    try:
        await asyncio.to_thread(
            _evict_tts_cache, s.tts_cache_dir, s.tts_cache_max_files, s.tts_cache_max_bytes)
    except Exception:
        logger.exception("tts cache: eviction failed")


@router.api_route("/answer", methods=["GET", "POST"], response_class=PlainTextResponse)
async def answer(
    corr: str = Query(...),
    agent: str = Query("default"),
    inst: str = Query(""),
    nxt: str = Query(""),
    rcb: str = Query(""),
):
    """Plivo fetches this when the callee answers. XML order matters:
    <Record recordSession> starts background full-session recording, <Stream>
    runs the conversation, and when the stream closes Plivo falls through to
    <Redirect> (handoff/hangup continuation served by admin_core)."""
    s = get_settings()

    # Admission control: at capacity, don't open a <Stream> we'd immediately have
    # to drop (a garbled/half-connected bot is worse than a clean fallback). Serve
    # a short apology + the <Redirect> so Plivo falls through to admin_core's
    # /plivo/ai-next (human handoff or hangup) exactly as a finished call would.
    if not _capacity_left():
        logger.warning("answer: at capacity (%d/%d) — serving busy fallback corr=%s",
                       _active_calls, s.max_concurrent_calls, corr)
        busy_redirect = f'<Redirect method="POST">{escape(nxt)}</Redirect>' if nxt else "<Hangup/>"
        busy_xml = (
            '<?xml version="1.0" encoding="UTF-8"?><Response>'
            "<Speak>Sorry, all our lines are busy right now. Please try again shortly.</Speak>"
            f"{busy_redirect}</Response>"
        )
        return PlainTextResponse(busy_xml, media_type="application/xml")

    # urlencode: agent/inst are institute-typed free text — '&'/'=' must not
    # inject query params into the wss URL Plivo will connect to. `tok` gates
    # /ws: only a socket carrying a fresh /answer-minted HMAC may run a pipeline.
    ws_url = s.wss_url(urlencode(
        {"corr": corr, "agent": agent, "inst": inst, "tok": _mint_ws_token(corr)}))

    record_el = (
        f'<Record recordSession="true" redirect="false" maxLength="3600" '
        f'callbackUrl="{escape(rcb)}" callbackMethod="POST"/>'
        if rcb else ""
    )
    redirect_el = f'<Redirect method="POST">{escape(nxt)}</Redirect>' if nxt else ""

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f"{record_el}"
        f'<Stream bidirectional="true" keepCallAlive="true" '
        f'contentType="audio/x-mulaw;rate=8000">{escape(ws_url)}</Stream>'
        f"{redirect_el}"
        "</Response>"
    )
    logger.info("answer XML served corr=%s agent=%s record=%s", corr, agent, bool(rcb))
    return PlainTextResponse(xml, media_type="application/xml")


def _cap_audio_lead(output, max_lead: float) -> bool:
    """Stop pushing audio into Plivo faster than it can play it.

    pipecat's websocket output paces at TWICE real time (send_interval =
    chunk_duration / 2) to keep the far end's buffer full. For a browser that is
    fine. For a phone call it is the reason barge-in feels broken: Plivo ends up
    holding ~half the reply, and DuckGate can only withhold audio it has not sent
    yet — live call d6e82def logged "dropping 0 held frame(s)" on an interrupt
    because the entire reply was already inside Plivo, still playing.

    Replaces the pacing clock with: burst until `max_lead` seconds of cushion
    exist, then track real time. Falling behind (slow TTS, a busy loop) re-primes
    the cushion instead of accumulating debt, so this cannot cause a stall it
    would not otherwise have.

    Returns False if the transport internals differ from the pinned pipecat, in
    which case we leave the stock behaviour alone rather than break audio.
    """
    try:
        chunk_secs = output.audio_chunk_size / (output.sample_rate * 2)
    except Exception:
        logger.warning("audio pacing: cannot read chunk size — leaving pipecat default")
        return False
    if chunk_secs <= 0:
        return False
    state = {"t0": None, "sent": 0.0}

    async def _paced_sleep():
        now = time.monotonic()
        if state["t0"] is None:
            state["t0"] = now
        lead = state["sent"] - (now - state["t0"])
        if lead < 0:
            # Behind real time (TTS slower than playback, or the loop was busy):
            # re-anchor so the next chunks re-prime the cushion.
            state["t0"], state["sent"], lead = now, 0.0, 0.0
        elif lead > max_lead:
            await asyncio.sleep(lead - max_lead)
        state["sent"] += chunk_secs

    output._write_audio_sleep = _paced_sleep      # noqa: SLF001 - deliberate
    logger.info("audio pacing: lead capped at %.2fs (chunk %.0fms)",
                max_lead, chunk_secs * 1000)
    return True


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    """One live call. Plivo connects here per the <Stream> URL; we wire the
    socket into Pipecat and run the conversation."""
    # Imported here so /health and /answer work even while heavy audio deps load.
    # pipecat 1.4: transports.network is gone (→ transports.websocket.fastapi),
    # and the VAD moved off the transport onto the user aggregator (bot.py owns
    # it now, with the telephony min_volume tuning).
    from pipecat.runner.utils import parse_telephony_websocket
    from pipecat.serializers.plivo import PlivoFrameSerializer
    from pipecat.transports.websocket.fastapi import (
        FastAPIWebsocketParams,
        FastAPIWebsocketTransport,
    )

    global _active_calls, _inflight_handshakes
    await websocket.accept()

    corr = websocket.query_params.get("corr") or ""
    agent = websocket.query_params.get("agent") or "default"
    if not corr:
        logger.warning("ws: missing corr — closing")
        await websocket.close()
        return

    # Single-use admission token minted by /answer (see _mint_ws_token). A socket
    # without a fresh, unspent token never reaches the handshake, the context
    # fetch, or a capacity slot — and a captured token admits exactly one socket.
    if not _consume_ws_token(corr, websocket.query_params.get("tok") or ""):
        logger.warning("ws: bad/missing/replayed admission token corr=%s — closing", corr)
        await websocket.close()
        return

    s = get_settings()
    # Pre-handshake admission: bound stalled handshakes separately from running
    # calls. Check + increment are adjacent (no await between) → atomic on the
    # single-threaded loop. The cap is generous (3× the call cap) so bursts of
    # real calls are never turned away here; it exists to cap a stall flood.
    pending_cap = s.max_concurrent_calls * 3 + 5
    if _inflight_handshakes >= pending_cap:
        logger.warning("ws: too many pending handshakes (%d/%d) — closing corr=%s",
                       _inflight_handshakes, pending_cap, corr)
        await websocket.close()
        return
    _inflight_handshakes += 1

    call_uuid = None
    _inflight_held = True
    _active_slot = False
    try:
        # Provider handshake first (Plivo sends a start event with stream/call ids).
        # Bounded: a client that connects and never sends the start event is dropped
        # here without ever consuming a running-call slot.
        try:
            transport_type, call_data = await asyncio.wait_for(
                parse_telephony_websocket(websocket), timeout=10.0)
        except asyncio.TimeoutError:
            logger.warning("ws: telephony handshake timeout corr=%s — closing", corr)
            await websocket.close()
            return

        # Handshake done → hand off from the pending bucket to a real call slot.
        # Adjacent check + increment (no await) keeps the slot count exact.
        _inflight_handshakes -= 1
        _inflight_held = False
        if _active_calls >= s.max_concurrent_calls:
            logger.warning("ws: at capacity (%d/%d) — closing corr=%s",
                           _active_calls, s.max_concurrent_calls, corr)
            await websocket.close()
            return
        _active_calls += 1
        _active_slot = True

        stream_id = (call_data or {}).get("stream_id")
        call_uuid = (call_data or {}).get("call_id")
        logger.info("ws connected corr=%s transport=%s call=%s active=%d",
                    corr, transport_type, call_uuid, _active_calls)

        # Context BEFORE the pipeline — a call without persona/lead must not proceed.
        try:
            _t0 = __import__("time").time()
            context = await admin_core.get_call_context(corr, agent)
            logger.info("setup timing corr=%s ctx_fetch=%.2fs", corr, __import__("time").time() - _t0)
        except Exception:
            logger.exception("ws: context fetch failed corr=%s — closing", corr)
            await websocket.close()
            return

        serializer = PlivoFrameSerializer(
        stream_id=stream_id,
        call_id=call_uuid,
        # auto_hang_up MUST stay off: the call has to SURVIVE the stream's end so
        # Plivo falls through to <Redirect> → admin_core /plivo/ai-next, which
        # serves the human-handoff <Dial> (or <Hangup/>). The default (True)
        # would API-kill the call on EndFrame and no handoff could ever happen.
            params=PlivoFrameSerializer.InputParams(auto_hang_up=False),
        )
        transport = FastAPIWebsocketTransport(
            websocket=websocket,
            params=FastAPIWebsocketParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                add_wav_header=False,
                # Room tone under every call — started by the transport on its
                # StartFrame, i.e. before the greeting (app/ambience.py).
                audio_out_mixer=build_ambience_mixer(s),
                # pipecat 1.4: NO vad_analyzer here — the VAD (with the telephony
                # min_volume=0.35 tuning from live call 8e1e00ad) lives on the
                # user aggregator in bot.run_bot, alongside Smart Turn v3.
                serializer=serializer,
            ),
        )

        # Bound how much audio Plivo may hold ahead of playback — the barge-in
        # fix (see _cap_audio_lead). Applied after the transport exists but
        # before the pipeline runs, and re-applied on StartFrame because
        # pipecat's start() recomputes its own interval.
        if s.audio_max_lead_secs > 0:
            _out = transport.output()
            _orig_start = _out.start

            async def _start_then_cap(frame, _o=_out, _s=_orig_start):
                await _s(frame)
                _cap_audio_lead(_o, s.audio_max_lead_secs)

            _out.start = _start_then_cap

        # The outcome is owned HERE (not inside run_bot) so a mid-pipeline crash
        # still leaves a reportable object — a lost report strands the paused
        # workflow until its safety timeout.
        outcome = CallOutcome(corr=corr, context=context)
        try:
            await run_bot(transport, corr, context, outcome,
                          aiohttp_session=websocket.app.state.http_session)
        except Exception:
            # Marked on the outcome so the report is HONEST: a crash with no real
            # conversation must reach admin_core as "failed", not "no-answer" —
            # mapStatus stamps unknown/absent statuses COMPLETED on the call log
            # and the classifier would count a phantom connect (verified 2026-07-27).
            outcome.crashed = True
            logger.exception("ws: pipeline crashed corr=%s", corr)
        finally:
            if outcome.ended_at is None:  # crash before run_bot's own finally ran
                outcome.ended_at = time.time()
            try:
                # shield: if this WS coroutine is being cancelled (abrupt disconnect /
                # shutdown), the report task still runs to completion.
                await asyncio.shield(build_and_post_report(outcome, call_uuid))
            except Exception:
                logger.exception("ws: report failed corr=%s", corr)
    finally:
        # Release whichever bucket this socket still holds on EVERY exit
        # (handshake timeout, capacity reject, context-fetch return, crash, normal
        # end, cancellation) — a leak here would silently shrink capacity. Exactly
        # one of the two is held at any point after the pending increment.
        if _inflight_held:
            _inflight_handshakes -= 1
        if _active_slot:
            _active_calls -= 1
            # Free this call now rather than at the interpreter's next full
            # collection (app/memory.py). Scheduled, not inline: until this
            # handler returns, its own locals still reference the pipeline — and
            # pipecat's TurnTrackingObserver keeps a turn-end timer (2.5 s after
            # the bot's last audio) that holds it too. 3 s clears both.
            try:
                asyncio.get_running_loop().call_later(3.0, _reclaim_after_call, corr)
            except Exception:
                logger.exception("ws: could not schedule memory reclaim corr=%s", corr)


def _reclaim_after_call(corr: str) -> None:
    try:
        memory.reclaim(idle=_active_calls == 0 and _inflight_handshakes == 0, corr=corr or "")
    except Exception:
        logger.exception("memory: reclaim failed corr=%s", corr)


app.include_router(router)
