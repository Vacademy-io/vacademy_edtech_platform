"""Off-call synthesis for the TTS speech cache: the ONLY path that writes audio.

Kept out of ttscache.py to break an import cycle — the per-engine one-shot synth
functions live in main.py, which imports bot.py, which imports ttscache.py.

WHY OFF-CALL AT ALL. Recording the live stream would be cheaper to build and is
the obvious design, and it is wrong. On sarvam/smallest/rumik pipecat delivers
audio out-of-band from run_tts with no per-sentence attribution, and a barge-in
truncates the stream mid-sentence — so a live capture on exactly the engines
worth caching would be a coin-flip between "the whole sentence" and "the first
40% of it". A truncated blob is not a bad call, it is a bad call repeated
forever. Rendering off-call makes that failure impossible by construction
instead of guarding against it.

The same functions the voice-preview endpoint uses are reused deliberately: a
cache entry that does not sound like the audition is the audition lying.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from loguru import logger

from .config import get_settings
from .ttscache import SAMPLE_RATE, Candidate, cache_key, get_cache, is_complete


def _to_pcm8k(data: bytes) -> Optional[bytes]:
    """Decode any container the engines emit (MP3/WAV) to the Plivo leg's own
    format: 8 kHz signed-16 mono. miniaudio decodes AND resamples in one call —
    the same library EdgeTTSService already uses for its streaming decode, so no
    new dependency and no second resampler to disagree with the first."""
    if not data:
        return None
    try:
        import miniaudio
        dec = miniaudio.decode(data, output_format=miniaudio.SampleFormat.SIGNED16,
                               nchannels=1, sample_rate=SAMPLE_RATE)
        return dec.samples.tobytes()
    except Exception:
        logger.exception("tts-warm: decode/resample failed")
        return None


async def synthesize(*, engine: str, model: str, voice: str, pace, temperature,
                     text: str, language: str | None = None) -> Optional[bytes]:
    """One complete render, as 8 kHz PCM. None on any failure.

    Returns a WHOLE buffer or nothing — there is no partial success here, which
    is the property the whole design rests on.
    """
    from . import main as _main               # late: main imports bot imports us
    from .providers import normalize_for_rumik, rumik_synthesize_wav

    s = get_settings()
    eng = (engine or "").strip().lower()
    p = float(pace) if pace is not None else s.tts_pace
    try:
        if eng == "google":
            raw = await asyncio.to_thread(_main._google_tts_mp3, text, voice, p)
        elif eng == "edge":
            raw = await _main._edge_tts_mp3(text, voice, p)
        elif eng == "smallest":
            raw = await _main._smallest_tts_wav(text, voice, model or s.smallest_model, p, language)
        elif eng == "rumik":
            # Normalise exactly as the live path does, or the cached audio would
            # not match the text we keyed it under.
            # description, not a numeric rate: Rumik only responds to prose pacing,
            # which is why rumik_pace_description exists. Same call the preview
            # endpoint makes, so the cached audio matches the audition.
            from .providers import rumik_pace_description
            raw = await rumik_synthesize_wav(
                normalize_for_rumik(text), voice or s.rumik_voice,
                s.rumik_api_key, model=model or "mulberry",
                description=rumik_pace_description(p))
        elif eng == "navana":
            # No speed: the live stream cannot send one (Navana's streaming hello
            # rejects it), so the render must not either or the cached audio
            # would not match what the live call speaks.
            from .providers import navana_language
            raw = await _main._navana_tts_wav(text, voice or s.navana_tts_voice,
                                              navana_language(language), None)
        elif eng == "sarvam":
            raw = await _main._synth_audio(text, voice or s.sarvam_tts_voice,
                                           model or s.sarvam_tts_model, "hi-IN")
        elif eng == "sarvam_v4":
            from .sarvam_v4_voices import SARVAM_V4_DEFAULT_VOICE, SARVAM_V4_MODEL
            raw = await _main._synth_audio(text, voice or SARVAM_V4_DEFAULT_VOICE,
                                           SARVAM_V4_MODEL, "hi-IN")
        else:
            logger.warning("tts-warm: no one-shot renderer for engine {!r}", eng)
            return None
    except Exception:
        logger.exception("tts-warm: {} synthesis failed for {!r}", eng, text[:40])
        return None
    if not raw:
        return None
    return await asyncio.to_thread(_to_pcm8k, raw)


_RENDER_TIMEOUT_SECS = 90.0


async def render_candidate(cache, cand: Candidate) -> bool:
    """Serialize background renders; a save and a sweep must not pay twice.

    This lock is never acquired by live playback. A stalled vendor also has a
    total deadline so it cannot hold the entire warm queue indefinitely.
    """
    async with cache._lock:
        if cache.lookup(cand.key, cand.text) is not None:
            return True
        if not await asyncio.to_thread(cache.can_render, cand.key):
            return False
        try:
            pcm = await asyncio.wait_for(
                synthesize(engine=cand.engine, model=cand.model, voice=cand.voice,
                           pace=cand.pace, temperature=cand.temperature,
                           text=cand.text, language=cand.language),
                timeout=_RENDER_TIMEOUT_SECS)
            if pcm and await asyncio.to_thread(cache.store, cand, pcm):
                return True
            error = "invalid audio" if pcm else "empty or failed synthesis"
        except Exception as exc:
            logger.exception("tts-warm: render failed for {}", cand.key[:12])
            error = type(exc).__name__
        await asyncio.to_thread(cache.render_failed, cand.key, error)
        return False


async def warm(*, engine: str, model: str, voice: str, pace, temperature,
               texts: list, language: str | None = None) -> dict:
    """Pre-render a set of known-good lines. Used by warm-on-save.

    These are ADMIN-AUTHORED strings, not sentences learned from a call, so they
    skip the "was it actually heard" gate — there is no call to have heard them
    on. They still face G1 (a fragment is refused) and G5 (a bad render is
    refused), because those are about the audio, not about provenance.
    """
    cache = get_cache()
    if not cache.ready:
        await asyncio.to_thread(cache.open)

    # Resolve the model the SAME way the live call will, or the key we file this
    # audio under is not the key the call looks it up by. admin_core sends the
    # engine and leaves the model to us precisely because only this process knows
    # what its env resolves to.
    from .providers import default_engine_model
    engine = (engine or "").strip().lower()
    if not (model or "").strip():
        model = default_engine_model(engine, voice)
    if engine.startswith("smallest") or engine.startswith("lightning"):
        engine = "smallest"

    from .speech_language import smallest_language_code
    if engine == "navana":
        from .providers import navana_language
        language = navana_language(language)
    else:
        language = smallest_language_code(language) if engine == "smallest" else ""
    done = skipped = failed = 0
    for text in texts:
        t = (text or "").strip()
        if not t or not is_complete(t):
            # A fixed line with no terminal punctuation is almost always an
            # authoring slip; refusing it keeps one rule for everything.
            skipped += 1
            continue
        try:
            from .providers import rumik_term_map_version
            key = cache_key(engine=engine, model=model, voice=voice, pace=pace,
                            temperature=temperature, sample_rate=SAMPLE_RATE,
                            term_map_version=(rumik_term_map_version()
                                              if engine == "rumik" else ""),
                            text=t, language=language)
            if cache.lookup(key, t) is not None:
                skipped += 1
                continue
            cand = Candidate(key=key, text=t, chars=len(t), engine=engine,
                             model=model or "", voice=voice or "", pace=pace,
                             temperature=temperature, fixed=True, language=language)
            if await render_candidate(cache, cand):
                done += 1
            else:
                failed += 1
        except Exception:
            logger.exception("tts-warm: failed on {!r}", t[:40])
            failed += 1
    logger.info("tts-warm: {}/{} warmed={} skipped={} failed={}",
                engine, voice, done, skipped, failed)
    return {"warmed": done, "skipped": skipped, "failed": failed}


# Set when a call has just laddered something, so a newly-due sentence is
# rendered within seconds instead of waiting out the periodic tick. The tick
# stays as a backstop for anything the kick missed (a crash between ladder and
# signal, or work deferred because the box was busy).
_SWEEP_NOW: Optional[asyncio.Event] = None
_TICK_SECS = 300.0
# How often the ledger is mirrored into Postgres. Analytics, not control: a
# minute of staleness on a dashboard costs nothing, and a tighter loop would put
# avoidable load on a box that is also carrying live calls.
_REPORT_EVERY_SECS = 120.0


def request_sweep() -> None:
    """Ask the sweeper to run now. Fire-and-forget and never raises: the periodic
    tick is the guarantee, this is only the shortcut."""
    try:
        if _SWEEP_NOW is not None:
            _SWEEP_NOW.set()
    except Exception:
        pass


def _box_is_busy() -> bool:
    """Is the box carrying enough live calls that a render could be heard?

    Synthesis is mostly network, but the decode/resample is real CPU on a 1 vCPU
    node, and every concurrent call is already running VAD plus a smart-turn
    model on that same core. Background work must never be the reason a live
    caller hears a glitch — so above half capacity we defer to the next tick,
    which a lull will provide.
    """
    try:
        from . import main as _main
        return _main._active_calls * 2 >= get_settings().max_concurrent_calls
    except Exception:
        return False


async def sweeper() -> None:
    """Render what the ledger says is worth rendering, then bound the namespace.

    Runs off every call path. A sentence becomes due only after
    TTS_CACHE_MIN_SEEN qualifying sightings — complete, uninterrupted, confirmed
    played, on a call with a healthy verdict — so this is the last step of a
    chain that already decided the audio is worth having.

    Woken by request_sweep() the moment a call ladders something, so the gap
    between "this sentence earned a place" and "the next call hears it from
    cache" is seconds rather than a tick. The tick remains the backstop.
    """
    global _SWEEP_NOW
    _SWEEP_NOW = asyncio.Event()
    cache = get_cache()
    while True:
        try:
            try:
                await asyncio.wait_for(_SWEEP_NOW.wait(), timeout=_TICK_SECS)
            except asyncio.TimeoutError:
                pass
            _SWEEP_NOW.clear()

            if not cache.ready:
                continue
            if _box_is_busy():
                logger.info("tts-warm: box busy — deferring render pass")
                continue
            due = await asyncio.to_thread(cache.due, 25)
            for cand in due:
                if _box_is_busy():
                    logger.info("tts-warm: box got busy — pausing render pass")
                    break
                await render_candidate(cache, cand)
                # Space the vendor calls out: this is background work competing
                # with live calls for the same box and the same rate limit.
                await asyncio.sleep(1.0)
            await asyncio.to_thread(cache.evict)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("tts-warm: sweeper pass failed")


async def reporter() -> None:
    """Push the ledger to admin-core, and run any flush it has queued for us.

    Both directions ride the clientName/Signature auth the bot ALREADY uses for
    call-context and reports. That is the reason this is a push rather than
    admin-core polling us: this direction is authenticated and working, the
    reverse one has no credential at all — which is why warm-on-save has never
    fired in production.

    Off every call path, and total: a failed report costs a stale analytics
    screen until the next cycle. Nothing on a call depends on it.
    """
    from . import admin_core
    cache = get_cache()
    while True:
        try:
            await asyncio.sleep(_REPORT_EVERY_SECS)
            if not cache.ready:
                continue

            # Commands first — a flush the operator queued should land before we
            # report state, or the screen shows rows we are about to delete.
            for cmd in await admin_core.fetch_tts_cache_commands():
                cid = cmd.get("id")
                if not cid:
                    continue
                entries, freed, note = await asyncio.to_thread(
                    cache.forget,
                    agent_id=cmd.get("agentId") or "",
                    cache_key=cmd.get("cacheKey") or "",
                    dry_run=bool(cmd.get("dryRun", True)))
                logger.info("tts-cache: command {} {} -> {}", cid, cmd.get("kind"), note)
                await admin_core.post_tts_cache_command_result(
                    cid, True, note, entries, freed)

            entries = await asyncio.to_thread(cache.export_for_report)
            if entries:
                ok = await admin_core.post_tts_cache_report(entries)
                logger.info("tts-cache: reported {} entr{} ok={}",
                            len(entries), "y" if len(entries) == 1 else "ies", ok)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("tts-cache: reporter pass failed")
