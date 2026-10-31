"""Prepared teacher voice (cost review 2026-09-07).

Institutes pay happily once; a per-minute bill per learner is what hurts.
The teacher's compiled lines — narration, recaps, questions, hints, predict
questions, and the fixed lines the socket says around them — are the same
for every learner of a course, so they are synthesised ONCE, right after a
slide compiles, stored as mp3 in S3 and indexed in `tutor_tts_cache`. A live
lesson looks a segment up here before paying the voice vendor; only the
model-written lines of a conversation (verdicts, doubts, the greeting with
the learner's name) are synthesised live.

Quality is unchanged: the same engine, voice and pace produce the audio; it
is simply produced earlier and reused.
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx

from ...db import db_session
from ...models.ai_token_usage import RequestType
from ...models.tutor_tts_cache import TutorTtsCache
from ..ai_billing import UC, metering_user, record_tool_billing
from ..provider_rates import tts_cost_usd
from .runtime import prompts
from .runtime.speech import spoken_form, cache_key, effective_pace, tutor_segments

logger = logging.getLogger(__name__)

VOICE_PREPARE_TOOL = "tutor_voice_prepare"
WARM_CONCURRENCY = 3
S3_PREFIX = "tutor-voice"
# Lines with the learner's name are personal: synthesised live.
NAME_PLACEHOLDER = "{student_name}"


# ── S3 ───────────────────────────────────────────────────────────────────────

def _s3():
    from ...config import get_settings
    s = get_settings()
    if not (s.s3_aws_access_key and s.s3_aws_access_secret and s.s3_aws_region and s.aws_bucket_name):
        return None, None
    try:
        import boto3
        return boto3.client("s3", aws_access_key_id=s.s3_aws_access_key, aws_secret_access_key=s.s3_aws_access_secret,
                            region_name=s.s3_aws_region), s.aws_bucket_name
    except Exception:  # noqa: BLE001
        return None, None


def _to_mp3(audio: bytes, mime: str) -> Tuple[bytes, str]:
    """WAV from the engine → mono 48 kbps mp3 (8× smaller); anything else kept."""
    if not shutil.which("ffmpeg") or "wav" not in (mime or "").lower():
        return audio, mime or "audio/mpeg"
    work = Path(tempfile.mkdtemp(prefix="tutor-voice-"))
    try:
        src, dst = work / "in.wav", work / "out.mp3"
        src.write_bytes(audio)
        proc = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(src), "-ac", "1", "-b:a", "48k", str(dst)],
                              capture_output=True, timeout=120)
        if proc.returncode != 0 or not dst.exists():
            return audio, mime
        return dst.read_bytes(), "audio/mpeg"
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── cache ────────────────────────────────────────────────────────────────────

def lookup(key: str) -> Optional[TutorTtsCache]:
    try:
        with db_session() as db:
            row = db.get(TutorTtsCache, key)
            if row is None:
                return None
            row.hits = int(row.hits or 0) + 1
            row.last_used_at = datetime.utcnow()
            db.commit()
            db.expunge(row)
            return row
    except Exception:  # noqa: BLE001
        logger.debug("tts cache lookup failed", exc_info=True)
        return None


async def fetch(url: str) -> Optional[bytes]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.content
    except Exception:  # noqa: BLE001
        logger.debug("tts cache fetch failed: %s", url, exc_info=True)
        return None


async def store(key: str, *, provider: str, voice: str, lang: str, pace: str, text_: str, audio: bytes, mime: str) -> Optional[str]:
    """Upload a synthesised segment and index it; returns the url or None."""
    client, bucket = _s3()
    if client is None:
        return None
    data, out_mime = await asyncio.to_thread(_to_mp3, audio, mime)
    ext = "mp3" if out_mime == "audio/mpeg" else "wav"
    filename = f"{S3_PREFIX}/{provider}/{key[:2]}/{key}.{ext}"
    try:
        await asyncio.to_thread(client.put_object, Bucket=bucket, Key=filename, Body=data, ContentType=out_mime)
        url = f"https://{bucket}.s3.amazonaws.com/{filename}"
        with db_session() as db:
            if db.get(TutorTtsCache, key) is None:
                db.add(TutorTtsCache(cache_key=key, provider=provider, voice=voice[:120] if voice else None, language=lang,
                                     pace=pace, chars=len(text_), text_head=text_[:120], url=url, mime=out_mime, bytes=len(data)))
                db.commit()
        return url
    except Exception:  # noqa: BLE001
        logger.warning("tts cache store failed for %s", key[:12], exc_info=True)
        return None


# ── what a plan says ─────────────────────────────────────────────────────────

def spoken_lines(view: Dict[str, Any], lang: str, course_lang: str) -> List[str]:
    """Every line the teacher will say from a compiled plan in `lang`, plus
    the fixed lines the socket wraps them in. Lines that carry the learner's
    name are left to the live path."""
    lines: List[str] = []

    def alt(base: Optional[str], i18n: Optional[Dict[str, str]]) -> Optional[str]:
        if lang != course_lang:
            return ((i18n or {}).get(lang) or "").strip() or None
        return (base or "").strip() or None

    for t in view.get("topics") or []:
        for c in t.get("concepts") or []:
            say = alt(c.get("say"), c.get("say_i18n"))
            if say:
                # A line with the learner's name is personal (synthesised live);
                # its neutral form serves learners whose name is unknown.
                lines.append(prompts.neutralize_name(say) if NAME_PLACEHOLDER in say else say)
            chk = c.get("check") or {}
            if (chk.get("type") or "none") != "none":
                p = alt(chk.get("prompt"), chk.get("prompt_i18n"))
                if p:
                    lines.append(prompts.tpl("ask", lang, prompt=p))
                h = alt(chk.get("hint"), chk.get("hint_i18n"))
                if h:
                    lines.append(prompts.tpl("nudge_hint", lang, hint=h))
                exp = (chk.get("expected") or "").strip()
                if exp and lang == course_lang:
                    lines.append(prompts.tpl("fallback_move_on", lang, expected=exp[:160]))
            pr = alt(c.get("predict"), c.get("predict_i18n"))
            if pr:
                lines.append(prompts.tpl("predict_intro", lang, question=pr))
        recap = alt(t.get("summary_say"), t.get("summary_say_i18n"))
        lines.append(recap or prompts.tpl("topic_summary", lang, topic=t.get("title") or ""))
    # Fixed lines every lesson may say (no learner name in them).
    for key in ("revisit_done_topic", "revisit_done_slide", "revisit_skipped", "skipped", "pause", "slower", "faster",
                "fallback_correct", "predict_ack", "nudge_open", "idle_end", "credits_end", "media_task_video", "media_task_pdf"):
        lines.append(prompts.tpl(key, lang))
    for n in (1, 2, 3):
        lines.append(prompts.tpl("revisit_intro_topic", lang, n=n))
        lines.append(prompts.tpl("revisit_intro_slide", lang, n=n))
    # De-duplicate, drop personal lines and empties.
    seen, out = set(), []
    for ln in lines:
        ln = " ".join((ln or "").split())
        if not ln or NAME_PLACEHOLDER in ln or ln in seen:
            continue
        seen.add(ln)
        out.append(ln)
    return out


# ── warm-up ──────────────────────────────────────────────────────────────────

async def warm_plan(
    *, plan_id: str, slide_id: str, institute_id: str, user_id: Optional[str], provider: str, voice: str,
    base_pace: float, languages: Iterable[str], course_lang: str, request_id: Optional[str] = None,
    metering: Any = None,
) -> Dict[str, Any]:
    """Synthesise every line of a compiled plan for each language, once.
    Charges `tutor_voice_prepare` per slide per language only when at least
    one line was actually synthesised (a re-run of a warmed plan is free)."""
    from ..voice_tts import default_voice_for, sarvam_speaker, smallest_available, synthesize_speech, SARVAM_DEFAULT_FEMALE, SMALLEST_DEFAULT_VOICE
    from . import plan_store
    from ...models.teaching_plan import TeachingPlan
    if provider == "edge" or (provider == "smallest" and not smallest_available()):
        return {"skipped": "provider not prepared"}
    with db_session() as db:
        plan = db.get(TeachingPlan, plan_id)
        if plan is None:
            return {"skipped": "plan missing"}
        view = plan_store.plan_view(db, plan)
    out: Dict[str, Any] = {"languages": {}}
    stt_lang = {"en": "en-IN", "hi": "hi-IN"}
    for lang in [x for x in languages if x in ("en", "hi")]:
        if provider == "sarvam":
            v = sarvam_speaker(voice, SARVAM_DEFAULT_FEMALE)
        elif provider == "smallest":
            v = (voice or SMALLEST_DEFAULT_VOICE).strip()
        else:
            v = voice or default_voice_for(provider, stt_lang.get(lang, "en-IN"))
        segments: List[str] = []
        for line in spoken_lines(view, lang, course_lang):
            segments.extend(seg for seg, _i, _n in tutor_segments(line))
        todo: List[Tuple[str, str, str]] = []
        for seg in dict.fromkeys(segments):
            pace = str(effective_pace(base_pace, "normal", seg))
            spoken = spoken_form(seg, lang)
            key = cache_key(provider, v, stt_lang.get(lang, "en-IN"), pace, spoken)
            if lookup(key) is None:
                todo.append((key, spoken, pace))
        synthesized = 0
        chars = 0
        sem = asyncio.Semaphore(WARM_CONCURRENCY)

        async def one(key: str, seg: str, pace: str) -> None:
            nonlocal synthesized, chars
            async with sem:
                try:
                    audio, mime, used = await synthesize_speech(text=seg, language=stt_lang.get(lang, "en-IN"), voice=v,
                                                                provider=provider, pace=float(pace))
                    if audio and used == provider:
                        if await store(key, provider=provider, voice=v, lang=stt_lang.get(lang, "en-IN"), pace=pace,
                                       text_=seg, audio=audio, mime=mime):
                            synthesized += 1
                            chars += len(seg)
                except Exception:  # noqa: BLE001
                    logger.warning("voice warm-up: segment failed for plan %s", plan_id, exc_info=True)

        await asyncio.gather(*(one(k, s, p) for k, s, p in todo))
        out["languages"][lang] = {"segments": len(segments), "synthesized": synthesized, "chars": chars}
        if synthesized:
            record_tool_billing(
                tool_key=VOICE_PREPARE_TOOL, tool_params={}, request_type=RequestType.TTS_PREMIUM,
                model=f"{provider}:{v}", institute_id=institute_id, user_id=user_id, user_role="ADMIN",
                request_id=request_id, idempotency_key=f"tutor_voice:{plan_id}:{lang}:{provider}:{v}"[:255],
                provider_cost_usd=tts_cost_usd(provider, chars), character_count=chars,
                use_case=UC.TUTOR_SETUP,
                metering=metering if metering is not None else metering_user(user_id, surface="ADMIN_APP"),
                usage_context={"plan_id": plan_id, "slide_id": slide_id, "language": lang,
                               "feature": "tutor_voice_prepare"},
            )
    logger.info("Voice warm-up for slide %s: %s", slide_id, out)
    return out
