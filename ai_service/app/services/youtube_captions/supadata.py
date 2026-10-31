"""Secondary provider: Supadata's transcript API (httpx, async).

Only ``mode=native`` is ever sent: the other modes are paid AI transcription.
``make_client`` is the test seam (tests return an AsyncClient on an
httpx.MockTransport).

Responses (errors carry {"error": "<code>", "message", "details"}):
  200        content[]{text, offset ms, duration ms, lang} -> OK (kind unknown)
  202        {jobId}: poll /transcript/{jobId} every 3 s until the budget runs out -> TIMEOUT
  206        NO_CAPTIONS (trusted; Supadata's "transcript unavailable" status)
  404        by error code: transcript-unavailable -> NO_CAPTIONS, not-found -> UNAVAILABLE
             (both trusted); any other 404 (no / unknown code: a wrong or moved
             endpoint) -> NETWORK, never cached, ERROR logged naming the path,
             breaker open 1 h
  401/402/403 credentials / balance: breaker open 1 h, ERROR logged
  429        breaker open Retry-After (60 s when absent)
  5xx, other NETWORK

Every request's timeout is cut to the caller's deadline (time.monotonic).

The endpoint path is confirmed by the live probe (scripts/yt_captions_probe.py
--supadata-legacy tries the older /v1/youtube/transcript?videoId= path).
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from .types import CaptionSegment, Outcome, logger
from .youtube_lib import RouteAttempt

BASE_URL = "https://api.supadata.ai/v1"
TIMEOUT_S = 30.0
POLL_EVERY_S = 3.0
AUTH_COOLDOWN_S = 3600
UNKNOWN_404_COOLDOWN_S = 3600
RATE_LIMIT_DEFAULT_S = 60
MIN_REQUEST_TIMEOUT_S = 1.0

# Supadata error codes (body "error") that are answers about the video.
NO_TRANSCRIPT_CODES = frozenset({"transcript-unavailable", "no-transcript"})
NOT_FOUND_CODES = frozenset({"not-found", "video-not-found", "video-unavailable"})


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT_S)


def _credits(resp: httpx.Response) -> int:
    raw = resp.headers.get("x-billable-requests")
    try:
        return max(0, int(raw)) if raw is not None else 1
    except (TypeError, ValueError):
        return 1


def _segments(body: Dict[str, Any]) -> Tuple[Tuple[CaptionSegment, ...], Optional[str]]:
    out: List[CaptionSegment] = []
    lang = body.get("lang") if isinstance(body.get("lang"), str) else None
    content = body.get("content")
    if not isinstance(content, list):
        return (), lang
    for item in content:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        try:
            start = int(round(float(item.get("offset") or 0)))
            dur = int(round(float(item.get("duration") or 0)))
        except (TypeError, ValueError):
            start, dur = 0, 0
        out.append(CaptionSegment(start_ms=start, end_ms=max(start, start + dur), text=text))
        if not lang and isinstance(item.get("lang"), str):
            lang = item["lang"]
    return tuple(out), lang


def _retry_after(resp: httpx.Response) -> int:
    try:
        return max(1, int(float(resp.headers.get("retry-after") or RATE_LIMIT_DEFAULT_S)))
    except (TypeError, ValueError):
        return RATE_LIMIT_DEFAULT_S


def _json(resp: httpx.Response) -> Dict[str, Any]:
    try:
        body = resp.json()
        return body if isinstance(body, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _error_code(body: Dict[str, Any]) -> str:
    raw = body.get("error")
    if isinstance(raw, dict):
        raw = raw.get("code") or raw.get("error")
    return str(raw or "").strip().lower()


def _video_answer(code: str) -> Optional[Outcome]:
    """The definitive outcome a Supadata error code means, or None."""
    if code in NO_TRANSCRIPT_CODES:
        return Outcome.NO_CAPTIONS
    if code in NOT_FOUND_CODES:
        return Outcome.UNAVAILABLE
    return None


async def fetch(video_id: str, api_key: str, *, language: Optional[str] = None,
                poll_budget_s: float = 60.0, legacy: bool = False,
                deadline: Optional[float] = None) -> RouteAttempt:
    """One Supadata transcript request (plus job polling). Never raises for an
    HTTP outcome; the key is sent only as a header and never logged."""
    t0 = time.monotonic()
    credits = 0
    end = t0 + max(0.0, poll_budget_s)
    if deadline is not None:
        end = min(end, deadline)

    def req_timeout() -> Optional[float]:
        left = end - time.monotonic()
        return None if left < MIN_REQUEST_TIMEOUT_S else min(TIMEOUT_S, left)

    def done(outcome: Outcome, **kw: Any) -> RouteAttempt:
        return RouteAttempt(route="supadata", outcome=outcome, credits=credits,
                            ms=int((time.monotonic() - t0) * 1000), **kw)

    if legacy:
        url = f"{BASE_URL}/youtube/transcript"
        params: Dict[str, str] = {"videoId": video_id, "text": "false"}
    else:
        url = f"{BASE_URL}/transcript"
        params = {"url": f"https://youtu.be/{video_id}", "mode": "native", "text": "false"}
    if language:
        params["lang"] = language
    headers = {"x-api-key": api_key}

    async with make_client() as client:
        first_timeout = TIMEOUT_S if deadline is None else req_timeout()
        if first_timeout is None:
            return done(Outcome.TIMEOUT, detail="supadata: no time left")
        try:
            resp = await client.get(url, params=params, headers=headers, timeout=first_timeout)
        except httpx.TimeoutException:
            return done(Outcome.TIMEOUT, detail="supadata timeout")
        except httpx.HTTPError as exc:
            return done(Outcome.NETWORK, detail=f"supadata {type(exc).__name__}")
        credits += _credits(resp)
        status = resp.status_code

        if status == 202:
            job = _json(resp).get("jobId")
            if not job:
                return done(Outcome.NETWORK, detail="supadata 202 without jobId")
            while time.monotonic() + POLL_EVERY_S <= end:
                await asyncio.sleep(POLL_EVERY_S)
                left = req_timeout()
                if left is None:
                    break
                try:
                    resp = await client.get(f"{BASE_URL}/transcript/{job}", headers=headers, timeout=left)
                except httpx.HTTPError:
                    continue
                if resp.status_code != 200:
                    if resp.status_code in (401, 402, 403, 429) or resp.status_code >= 500:
                        status = resp.status_code
                        break
                    continue
                body = _json(resp)
                state = str(body.get("status") or "").lower()
                if state in ("failed", "error"):
                    code = _error_code(body)
                    answer = _video_answer(code)
                    if answer is not None:
                        return done(answer, detail=f"supadata job {state}: {code[:60]}")
                    return done(Outcome.NETWORK, detail=f"supadata job {state}: {code[:60]}")
                if "content" in body:
                    status = 200
                    break
            else:
                return done(Outcome.TIMEOUT, detail="supadata job still running")
            if status == 202:
                return done(Outcome.TIMEOUT, detail="supadata job still running")

        if status == 200:
            segs, lang = _segments(_json(resp))
            if not segs:
                return done(Outcome.EMPTY_BODY, detail="supadata 200 with no text")
            return done(Outcome.OK, segments=segs, language=lang, kind="unknown", snippets=len(segs))
        if status == 206:
            return done(Outcome.NO_CAPTIONS, detail="supadata 206")
        if status == 404:
            code = _error_code(_json(resp))
            answer = _video_answer(code)
            if answer is not None:
                return done(answer, detail=f"supadata 404 {code[:60]}")
            path = resp.request.url.path if resp.request is not None else url
            logger.error("yt_captions: Supadata answered 404 with no recognised error code (%r) for %s: the "
                         "endpoint is probably wrong or moved; Supadata paused for %d min", code[:60], path,
                         UNKNOWN_404_COOLDOWN_S // 60)
            return done(Outcome.NETWORK, detail=f"supadata 404 {code[:60] or 'no code'}",
                        open_breaker_s=UNKNOWN_404_COOLDOWN_S)
        if status in (401, 402, 403):
            logger.error("yt_captions: Supadata rejected the request (HTTP %s: key invalid or out of credits); "
                         "Supadata paused for %d min", status, AUTH_COOLDOWN_S // 60)
            return done(Outcome.NETWORK, detail=f"supadata {status}", open_breaker_s=AUTH_COOLDOWN_S)
        if status == 429:
            wait = _retry_after(resp)
            return done(Outcome.BUSY, detail="supadata 429", open_breaker_s=wait)
        return done(Outcome.NETWORK, detail=f"supadata {status}")


__all__ = ["fetch", "make_client", "BASE_URL"]
