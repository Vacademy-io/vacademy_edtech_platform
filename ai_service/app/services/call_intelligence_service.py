"""CRM Call Intelligence pipeline (ai_service side).

A PENDING row in `call_intelligence` (enqueued by admin_core the moment a call
recording lands in our storage) is processed here:

    claim → transcribe (render worker, Hindi+English) → fetch transcript text
          → credit check → LLM structured analysis → deduct credits + write results

ai_service shares admin_core's DB, so we read/write `call_intelligence` and read
`telephony_call_log` / `institutes` directly (same pattern as chat_sessions and
the credit tables). No HTTP callback into admin_core is needed.

Credit policy: a PER-MINUTE charge on the recording length
(request_type='call_intelligence'; rate = credit_pricing.token_rate credits per
minute, DB-configurable; per-institute per-minute override via the setting).
Charged only on successful completion, idempotent on call_log_id so a retry never
double-charges. Insufficient balance → SKIPPED/INSUFFICIENT_CREDITS, no transcribe.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import text

from ..config import get_settings
from ..db import db_session
from ..schemas.credits import CreditCheckRequest, CreditDeductRequest
from . import llm_json
from .call_intelligence_prompt import PROMPT_VERSION, SCHEMA_VERSION, build_prompt
from .credit_service import CreditService
from .media_file_client import get_file_url, get_public_file_url
from .transcription_service import TranscriptionService

logger = logging.getLogger(__name__)

REQUEST_TYPE = "call_intelligence"
MODEL_ATTR = "system"  # credit attribution for the (non-LLM) transcription leg
TRANSCRIBE_MODEL_SIZE = "small"  # best for Hindi-English code-switching
TRANSCRIBE_POLL_INTERVAL_S = 10
TRANSCRIBE_MAX_WAIT_S = 25 * 60  # cap one transcription so a stuck job can't pin a worker
# Calls made BY an AI agent: analysed at no extra charge (founder decision
# 2026-09-11 — "fold it in"; the call itself is already billed per minute).
# Human/telephony calls keep the per-minute charge in credit_pricing.
AI_PROVIDER_TYPES = frozenset({"VACADEMY_AI", "AAVTAAR", "MOCK"})
# Recordings are short; keep the whole transcript with the analysis so the
# transcript viewer works without a text artifact in S3 (OpenRouter STT returns
# text, not files).
TRANSCRIPT_KEEP_CHARS = 40_000
SHORT_UPDATE_MAX_CHARS = 200


# ---------------------------------------------------------------------------
# Settings (read the institute's CRM_INTELLIGENCE_SETTING from institutes.setting_json)
# ---------------------------------------------------------------------------

def _read_call_settings(institute_id: str) -> Dict[str, Any]:
    """Return {rating_scale, objective_hint, qualities, weights}.

    Eligibility (enabled/source/min-duration) was already enforced by admin_core at
    enqueue time; here we only need the rubric. Credit pricing is NOT read here —
    it lives entirely in the credit_pricing DB row (per-minute), with no
    per-institute settings override. Any parse problem falls back to sane defaults
    so a row is never stuck on config.
    """
    out: Dict[str, Any] = {
        "rating_scale": 10,
        "objective_hint": None,
        "qualities": None,
        "weights": None,
    }
    try:
        with db_session() as db:
            row = db.execute(
                text("SELECT setting_json FROM institutes WHERE id = :id"),
                {"id": institute_id},
            ).first()
        if not row or not row[0]:
            return out
        root = json.loads(row[0])
        # Envelope: { "setting": { "CRM_INTELLIGENCE_SETTING": { "data": {...} } } }
        data = (((root or {}).get("setting") or {}).get("CRM_INTELLIGENCE_SETTING") or {}).get("data") or {}
        calls = data.get("calls") or {}
        if isinstance(calls.get("ratingScale"), (int, float)) and calls["ratingScale"] > 0:
            out["rating_scale"] = int(calls["ratingScale"])
        rubric = calls.get("rubric") or {}
        if rubric.get("objectiveHint"):
            out["objective_hint"] = str(rubric["objectiveHint"])
        if isinstance(rubric.get("qualities"), list) and rubric["qualities"]:
            # Each metric may be a bare string (legacy) or {"key","description"}
            # (current — an institute-authored definition of a custom metric).
            # Normalize to {key, description} and pass through to the prompt so the
            # AI grades custom metrics exactly as defined.
            parsed = []
            for q in rubric["qualities"]:
                if isinstance(q, dict):
                    key = str(q.get("key") or q.get("term") or "").strip()
                    desc = str(q.get("description") or "").strip()
                    if key:
                        parsed.append({"key": key, "description": desc})
                elif str(q).strip():
                    parsed.append({"key": str(q).strip(), "description": ""})
            if parsed:
                out["qualities"] = parsed
        if isinstance(rubric.get("weights"), dict):
            out["weights"] = {str(k): float(v) for k, v in rubric["weights"].items()}
    except Exception:
        logger.warning("call-intel: could not read CRM_INTELLIGENCE_SETTING for institute %s — using defaults",
                       institute_id, exc_info=True)
    return out


# ---------------------------------------------------------------------------
# Credit helpers (sync — run via asyncio.to_thread)
# ---------------------------------------------------------------------------

def _billable_minutes(duration_seconds: Optional[int]) -> int:
    """Whole minutes to bill, rounded up (min 1). Unknown/zero duration bills 1."""
    try:
        sec = int(duration_seconds or 0)
    except (TypeError, ValueError):
        sec = 0
    if sec <= 0:
        return 1
    return math.ceil(sec / 60)


def _compute_cost(pricing: Dict[str, Any], duration_seconds: Optional[int]) -> Decimal:
    """Per-minute charge: base + ceil(minutes) * rate, floored at minimum_charge.

    `token_rate` in the credit_pricing row is the credits-per-minute rate — the
    single source of truth (DB-only, no per-institute settings override).
    """
    per_min = Decimal(str(pricing["token_rate"]))
    base = Decimal(str(pricing["base_cost"]))
    min_charge = Decimal(str(pricing["min_charge"]))
    minutes = _billable_minutes(duration_seconds)
    cost = base + Decimal(minutes) * per_min
    return max(min_charge, cost).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _check_credits(institute_id: str, duration_seconds: Optional[int]) -> Dict[str, Any]:
    """Return {sufficient, cost, balance}. cost is per-minute of the recording."""
    with db_session() as db:
        svc = CreditService(db)
        resp = svc.check_credits(CreditCheckRequest(
            institute_id=institute_id, request_type=REQUEST_TYPE, model=MODEL_ATTR,
        ))
        pricing = svc.get_pricing(REQUEST_TYPE)
    cost = _compute_cost(pricing, duration_seconds)
    balance = resp.current_balance
    sufficient = balance >= cost
    return {"sufficient": sufficient, "cost": cost, "balance": balance}


def _deduct_and_write(row_id: str, call_log_id: str, institute_id: str,
                      counsellor_user_id: Optional[str], cost: Decimal,
                      columns: Dict[str, Any], analysis_json: Dict[str, Any],
                      *, llm_usage: Optional[Dict[str, Any]] = None,
                      stt_usage: Optional[Dict[str, Any]] = None) -> None:
    """Record vendor usage, deduct the charge (if any) and write the COMPLETED
    row in ONE transaction.

    Two ai_token_usage rows per call — the LLM leg (tokens) and the STT leg
    (seconds) — each carrying what the vendor charged us in total_price, so the
    AI Usage page shows this feature's real margin (it wrote nothing there
    before 2026-09-11). The credit charge, when `cost` > 0, rides the LLM row.
    Idempotent on call_log_id: a retry after a partial failure re-uses the same
    idempotency_key, so the deduction is a no-op the second time.
    """
    from ..models.ai_token_usage import ApiProvider, RequestType
    from .token_usage_service import TokenUsageService

    llm_usage = llm_usage or {}
    stt_usage = stt_usage or {}
    with db_session() as db:
        tus = TokenUsageService(db)
        usage_log_id = None
        credits_charged = Decimal("0")
        common = dict(request_type=RequestType.CALL_INTELLIGENCE, institute_id=institute_id,
                      user_id=counsellor_user_id, request_id=call_log_id)
        # Usage-event attribution only (a background job; the counsellor stays
        # the ledger user as before).
        from .ai_billing import UC, metering_kwargs, metering_system, supported_kwargs
        meter = metering_kwargs(UC.CALL_INTELLIGENCE, metering_system(surface="INTERNAL"),
                                {"call_log_id": call_log_id, "counsellor_user_id": counsellor_user_id})
        # Record-only legs: the STT leg's cost rides the LLM charge; a zero-cost
        # run is free by policy (AI calls).
        meter_free = {**meter, "free_reason": "BUNDLED"}
        if stt_usage.get("model"):
            try:
                tus.record_usage(
                    api_provider=ApiProvider.OPENAI, prompt_tokens=0, completion_tokens=0,
                    total_tokens=0, model=stt_usage["model"],
                    total_price=stt_usage.get("cost_usd"),
                    metadata={"leg": "stt", "call_log_id": call_log_id,
                              "seconds": stt_usage.get("seconds")}, **common,
                    **supported_kwargs(tus.record_usage, meter_free))
            except Exception:
                logger.warning("call-intel: could not record STT usage for %s", call_log_id, exc_info=True)
        llm_kwargs = dict(
            api_provider=ApiProvider.OPENAI,
            prompt_tokens=int(llm_usage.get("prompt_tokens") or 0),
            completion_tokens=int(llm_usage.get("completion_tokens") or 0),
            total_tokens=int(llm_usage.get("total_tokens") or 0),
            model=columns.get("model") or MODEL_ATTR,
            total_price=llm_usage.get("cost_usd"),
            metadata={"leg": "llm", "call_log_id": call_log_id}, **common)
        try:
            if cost > 0:
                rec = tus.record_usage_and_deduct_credits(
                    precomputed_credits=cost,
                    idempotency_key=f"{REQUEST_TYPE}:{call_log_id}",
                    user_role="SYSTEM",
                    allow_negative=True,  # work already delivered; pre-flight gated affordability
                    **llm_kwargs, **supported_kwargs(tus.record_usage_and_deduct_credits, meter))
                credits_charged = cost
            else:
                rec = tus.record_usage(**llm_kwargs, **supported_kwargs(
                    tus.record_usage, {**meter, "free_reason": "POLICY_FREE"}))
            usage_log_id = str(rec.id) if rec is not None and getattr(rec, "id", None) else None
        except Exception:
            logger.warning("call-intel: could not record LLM usage for %s", call_log_id, exc_info=True)
        params = dict(columns)
        params.update({
            "id": row_id,
            "credits_charged": credits_charged,
            "usage_log_id": usage_log_id,
            "analysis_json": json.dumps(analysis_json, ensure_ascii=False),
        })
        db.execute(text("""
            UPDATE call_intelligence SET
                status = 'COMPLETED',
                short_update = :short_update,
                source_text_key = :source_text_key,
                english_text_key = :english_text_key,
                detected_language = :detected_language,
                language_probability = :language_probability,
                inferred_goal = :inferred_goal,
                call_type = :call_type,
                general_summary = :general_summary,
                generic_status = :generic_status,
                caller_self_goal_rating = :caller_self_goal_rating,
                call_output_rating = :call_output_rating,
                conversion_likelihood = :conversion_likelihood,
                lead_sentiment = :lead_sentiment,
                analysis_json = CAST(:analysis_json AS jsonb),
                schema_version = :schema_version,
                credits_charged = :credits_charged,
                usage_log_id = :usage_log_id,
                model = :model,
                prompt_version = :prompt_version,
                completed_at = now(),
                updated_at = now()
            WHERE id = :id
        """), params)


def _mark(row_id: str, status: str, *, skip_reason: Optional[str] = None,
          error: Optional[str] = None) -> None:
    with db_session() as db:
        db.execute(text("""
            UPDATE call_intelligence
            SET status = :status, skip_reason = :skip_reason, error = :error, updated_at = now()
            WHERE id = :id
        """), {"id": row_id, "status": status, "skip_reason": skip_reason,
               "error": (error[:4000] if error else None)})


# ---------------------------------------------------------------------------
# Transcription + transcript fetch
# ---------------------------------------------------------------------------

def _transcription_service() -> TranscriptionService:
    s = get_settings()
    return TranscriptionService(render_server_url=s.render_server_url, render_key=s.render_server_key)


async def _transcribe(source_url: str, row_id: str) -> Dict[str, Any]:
    """Submit a 'both' (source + English) transcription and poll to completion.

    Returns {source_txt_url, english_txt_url, detected_language, language_probability}.
    Raises RuntimeError on failure / timeout.
    """
    svc = _transcription_service()
    if not svc.is_configured:
        raise RuntimeError("render server not configured (RENDER_SERVER_URL)")

    job_id = await asyncio.to_thread(
        svc.submit, source_url, None, TRANSCRIBE_MODEL_SIZE, False, ["txt", "json"], None, "both",
    )
    # Record the job id for traceability while we poll.
    with db_session() as db:
        db.execute(text("UPDATE call_intelligence SET job_id = :j, updated_at = now() WHERE id = :id"),
                   {"j": job_id, "id": row_id})

    loop = asyncio.get_event_loop()
    deadline = loop.time() + TRANSCRIBE_MAX_WAIT_S
    while True:
        status = await asyncio.to_thread(svc.check_status, job_id)
        st = (status.get("status") or "").lower()
        if st == "completed":
            src = status.get("output_urls_source") or status.get("output_urls") or {}
            eng = status.get("output_urls_english") or {}
            return {
                "source_txt_url": src.get("txt_url") or src.get("txt"),
                "english_txt_url": eng.get("txt_url") or eng.get("txt"),
                "detected_language": status.get("detected_language"),
                "language_probability": status.get("language_probability"),
            }
        if st in ("failed", "error"):
            raise RuntimeError(f"transcription failed: {status.get('error')}")
        if loop.time() > deadline:
            raise RuntimeError(f"transcription timed out after {TRANSCRIBE_MAX_WAIT_S}s (job {job_id})")
        await asyncio.sleep(TRANSCRIBE_POLL_INTERVAL_S)


def _openrouter_audio_url() -> str:
    """The transcription endpoint next to the chat endpoint we already use."""
    base = (get_settings().llm_base_url or "https://openrouter.ai/api/v1/chat/completions")
    base = base.split("/chat/completions")[0].rstrip("/")
    return f"{base}/audio/transcriptions"


_AUDIO_TYPES = {
    "mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg", "m4a": "audio/mp4",
    "mp4": "audio/mp4", "webm": "audio/webm", "flac": "audio/flac",
}


def _audio_name(audio: bytes, content_type: Optional[str], source_url: str) -> tuple:
    """(filename, mime) for the multipart upload — the provider validates the
    extension against the bytes, so a wrong guess is a 400.

    First deploy (2026-09-11) named a file .mp3 only on an ID3 tag or an
    FF FB sync; our Plivo recordings are bare MPEG-2.5 frames (FF E3), got
    called .wav and every one was rejected. Order: the storage's content-type,
    then the URL's extension, then the magic bytes, defaulting to mp3.
    """
    ct = (content_type or "").split(";")[0].strip().lower()
    for ext, mime in _AUDIO_TYPES.items():
        if ct == mime or (ct == "audio/mp3" and ext == "mp3") or (ct == "audio/x-wav" and ext == "wav"):
            return f"recording.{ext}", mime
    path = source_url.split("?")[0].lower()
    for ext, mime in _AUDIO_TYPES.items():
        if path.endswith("." + ext):
            return f"recording.{ext}", mime
    if audio[:4] == b"RIFF":
        return "recording.wav", "audio/wav"
    if audio[:4] == b"OggS":
        return "recording.ogg", "audio/ogg"
    if audio[4:8] == b"ftyp":
        return "recording.m4a", "audio/mp4"
    # ID3 tag, or an MPEG frame sync (FF Ex / FF Fx) — covers MPEG-1/2/2.5.
    return "recording.mp3", "audio/mpeg"


async def _transcribe_openrouter(source_url: str, stt_model: str) -> Dict[str, Any]:
    """Transcribe one recording through OpenRouter's audio endpoint.

    Returns {text, seconds, cost_usd, model}. Verified 2026-09-11 with
    openai/whisper-large-v3-turbo on Hindi phone audio: 10.5 s cost $0.000035
    (≈ $0.0002/min); the response carries `usage.seconds` and `usage.cost`.
    Raises RuntimeError on any failure so the caller can fall back.
    """
    api_key = get_settings().openrouter_api_key
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as client:
        dl = await client.get(source_url, follow_redirects=True)
        dl.raise_for_status()
        audio = dl.content
        if not audio:
            raise RuntimeError("empty recording download")
        name, mime = _audio_name(audio, dl.headers.get("content-type"), source_url)
        resp = await client.post(
            _openrouter_audio_url(),
            headers={"Authorization": f"Bearer {api_key}"},
            data={"model": stt_model},
            files={"file": (name, audio, mime)},
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"openrouter transcription HTTP {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
    usage = data.get("usage") or {}
    return {
        "text": data.get("text") or "",
        "seconds": usage.get("seconds"),
        "cost_usd": usage.get("cost"),
        "model": stt_model,
    }


async def _fetch_text(url: Optional[str]) -> str:
    if not url:
        return ""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.text or ""


# ---------------------------------------------------------------------------
# LLM analysis + mapping
# ---------------------------------------------------------------------------

USE_CASE = "call_intelligence"


def _llm_price_per_m(model: str) -> Optional[tuple]:
    """(input, output) USD per million tokens from the ai_models registry —
    the one price source (the super-admin portal edits it). The old hard-coded
    table priced GLM at 0.15/0.50 against the registry's real rate."""
    if not model:
        return None
    try:
        with db_session() as db:
            row = db.execute(
                text("SELECT input_price_per_1m, output_price_per_1m FROM ai_models WHERE model_id = :m"),
                {"m": model},
            ).fetchone()
    except Exception as exc:  # noqa: BLE001
        logger.warning("call-intel: price lookup for %s failed (%s); leaving unpriced", model, exc)
        return None
    if not row or row[0] is None or row[1] is None:
        return None
    try:
        return float(row[0]), float(row[1])
    except (TypeError, ValueError):
        return None


def _llm_cost_usd(model: str, usage: Dict[str, Any]) -> Optional[float]:
    """OpenRouter's chat response does not return cost unless asked, so the
    margin number is derived from the registry price. Unknown model → None
    (unpriced), never a guess."""
    price = _llm_price_per_m(model)
    if not price:
        return None
    try:
        return round((float(usage.get("prompt_tokens") or 0) * price[0]
                      + float(usage.get("completion_tokens") or 0) * price[1]) / 1e6, 6)
    except (TypeError, ValueError):
        return None


def _analysis_models() -> List[str]:
    """Model chain for the analysis: CALL_INTEL_LLM_MODEL (env, emergency
    override only) > the 'call_intelligence' use case (super-admin portal; GLM
    by default) and its fallback, then LLM_FALLBACK_MODEL — never
    LLM_DEFAULT_MODEL, which is GLM too and would de-duplicate to no fallback."""
    import os

    from .model_selection import resolve_model_sync

    settings = get_settings()
    models: List[str] = []
    env_override = (os.getenv("CALL_INTEL_LLM_MODEL") or "").strip()
    if env_override:
        models.append(env_override)
    try:
        primary, fallbacks = resolve_model_sync(USE_CASE, hard_fallback=settings.call_intel_llm_model)
        candidates = [primary, *fallbacks]
    except Exception as exc:  # noqa: BLE001
        logger.warning("call-intel: model lookup failed (%s); using %s", exc, settings.call_intel_llm_model)
        candidates = [settings.call_intel_llm_model]
    candidates.append(getattr(settings, "llm_fallback_model", None))
    for candidate in candidates:
        if candidate and candidate not in models:
            models.append(candidate)
    return models


def _num(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _columns_from_analysis(data: Dict[str, Any], model_used: str,
                           detected_language: Optional[str], language_probability: Optional[float],
                           source_txt_url: Optional[str], english_txt_url: Optional[str]) -> Dict[str, Any]:
    goal = data.get("inferred_goal") or {}
    csg = data.get("caller_self_goal_rating") or {}
    out_r = data.get("call_output_rating") or {}
    sentiment = data.get("sentiment") or {}
    update = " ".join(str(data.get("update") or "").split())[:SHORT_UPDATE_MAX_CHARS] or None
    return {
        "source_text_key": source_txt_url,
        "english_text_key": english_txt_url,
        "detected_language": detected_language,
        "language_probability": language_probability,
        "inferred_goal": goal.get("objective"),
        "call_type": goal.get("call_type"),
        "general_summary": data.get("general_summary"),
        "short_update": update,
        "generic_status": data.get("generic_status"),
        "caller_self_goal_rating": _num(csg.get("score")),
        "call_output_rating": _num(out_r.get("score")),
        "conversion_likelihood": out_r.get("conversion_likelihood"),
        "lead_sentiment": sentiment.get("lead"),
        "schema_version": data.get("schema_version") or SCHEMA_VERSION,
        "model": model_used,
        "prompt_version": PROMPT_VERSION,
    }


# ---------------------------------------------------------------------------
# Orchestration: process a single claimed row end-to-end (never raises)
# ---------------------------------------------------------------------------

async def process_one(claimed: Dict[str, Any]) -> None:
    row_id = claimed["id"]
    call_log_id = claimed["call_log_id"]
    institute_id = claimed["institute_id"]
    try:
        # 1. Resolve the recording in our storage.
        storage_key = claimed.get("recording_storage_key")
        if not storage_key:
            _mark(row_id, "SKIPPED", skip_reason="NO_RECORDING")
            return
        # Recordings live in EITHER bucket and each has its own resolver route, so the
        # bucket has to drive the choice (telephony_call_log.recording_private):
        #   • public  (most telephony recordings, same as lead-profile playback)
        #   • private (e.g. VACADEMY_AI / Plivo AI-call recordings)
        # Hardcoding either one 404s for the other half and fails the transcription job
        # with "transcription failed: HTTP Error 404: Not Found".
        if claimed.get("recording_private"):
            source_url = await get_file_url(storage_key)
        else:
            source_url = await get_public_file_url(storage_key)

        # 2. Settings (rubric + credit override).
        cfg = await asyncio.to_thread(_read_call_settings, institute_id)

        # 3. Credit pre-flight (don't transcribe what we can't bill). Priced per
        #    minute of the recording, so the duration drives the cost. AI-agent
        #    calls are free: the call itself is already billed per minute.
        free = (claimed.get("provider_type") or "").upper() in AI_PROVIDER_TYPES
        if free:
            credit = {"cost": Decimal("0")}
        else:
            credit = await asyncio.to_thread(
                _check_credits, institute_id, claimed.get("duration_seconds"),
            )
            if not credit["sufficient"]:
                _mark(row_id, "SKIPPED", skip_reason="INSUFFICIENT_CREDITS")
                logger.info("call-intel: SKIPPED %s — insufficient credits (need %s, have %s)",
                            call_log_id, credit["cost"], credit["balance"])
                return

        # 4. Transcribe. OpenRouter (Whisper turbo, seconds-priced) first; the
        #    render worker only as a fallback — it is a single CPU box that
        #    answered "at capacity" on 45% of runs in the 60 days to 2026-09-11.
        settings = get_settings()
        tx: Dict[str, Any] = {}
        stt_usage: Dict[str, Any] = {}
        transcript = ""
        if settings.call_intel_stt_backend == "openrouter":
            try:
                orx = await _transcribe_openrouter(source_url, settings.call_intel_stt_model)
                transcript = orx["text"]
                stt_usage = {k: orx.get(k) for k in ("model", "seconds", "cost_usd")}
            except Exception as exc:  # noqa: BLE001
                if not _transcription_service().is_configured:
                    raise
                logger.warning("call-intel: openrouter transcription failed for %s (%s) — "
                               "falling back to render worker", call_log_id, exc)
        if not transcript.strip() and not stt_usage:
            tx = await _transcribe(source_url, row_id)
            transcript = await _fetch_text(tx["source_txt_url"]) or await _fetch_text(tx["english_txt_url"])
            stt_usage = {"model": f"render/whisper-{TRANSCRIBE_MODEL_SIZE}", "seconds": claimed.get("duration_seconds"),
                         "cost_usd": None}
        if not transcript.strip():
            _mark(row_id, "SKIPPED", skip_reason="EMPTY_TRANSCRIPT")
            return

        # 5. Analyze.
        with db_session() as db:
            db.execute(text("UPDATE call_intelligence SET status='ANALYZING', updated_at=now() WHERE id=:id"),
                       {"id": row_id})
        prompt = build_prompt(
            transcript,
            rating_scale=cfg["rating_scale"],
            objective_hint=cfg["objective_hint"],
            qualities=cfg["qualities"],
            weights=cfg["weights"],
            direction=claimed.get("direction"),
            source=claimed.get("source"),
            duration_seconds=claimed.get("duration_seconds"),
        )
        models = await asyncio.to_thread(_analysis_models)
        sanitized, model_used, llm_usage = await llm_json.generate_json(
            prompt, models, label="call_intelligence",
        )
        data = json.loads(sanitized)
        llm_usage = dict(llm_usage or {})
        llm_usage["cost_usd"] = await asyncio.to_thread(_llm_cost_usd, model_used, llm_usage)

        # 6. Deduct + persist (one transaction, idempotent). The transcript and
        #    both legs' usage travel in analysis_json: the transcript viewer
        #    reads it when there is no S3 text artifact, and the cost fields
        #    make a per-call margin readable without joining ai_token_usage.
        data["transcript"] = transcript[:TRANSCRIPT_KEEP_CHARS]
        data["stt"] = stt_usage
        data["llm"] = {"model": model_used, **{k: llm_usage.get(k) for k in
                                               ("prompt_tokens", "completion_tokens", "cost_usd")}}
        data["billing"] = {"free": free, "credits": str(credit["cost"])}
        columns = _columns_from_analysis(
            data, model_used, tx.get("detected_language"), tx.get("language_probability"),
            tx.get("source_txt_url"), tx.get("english_txt_url"),
        )
        await asyncio.to_thread(
            _deduct_and_write, row_id, call_log_id, institute_id,
            claimed.get("counsellor_user_id"), credit["cost"], columns, data,
            llm_usage=llm_usage, stt_usage=stt_usage,
        )
        logger.info("call-intel: COMPLETED %s (institute %s, model %s, stt %s, free=%s)",
                    call_log_id, institute_id, model_used, stt_usage.get("model"), free)

    except Exception as exc:  # noqa: BLE001
        logger.warning("call-intel: FAILED %s: %s", call_log_id, exc, exc_info=True)
        try:
            _mark(row_id, "FAILED", error=str(exc))
        except Exception:
            logger.error("call-intel: could not mark %s FAILED", call_log_id, exc_info=True)
