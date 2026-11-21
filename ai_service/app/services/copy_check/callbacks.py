"""Webhook callbacks back to Java assessment_service.

Java exposes /copy-check/callback/{progress,question,complete,failed} guarded
by X-Internal-Service-Token. Each call is fire-and-forget with one retry on
network errors; persistent failures are logged but never block the pipeline
(Java's progress watchdog will reconcile via its own polling fallback).
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)


def _token() -> str:
    return os.getenv("INTERNAL_SERVICE_TOKEN", "")


def _headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    tok = _token()
    if tok:
        h["X-Internal-Service-Token"] = tok
    return h


async def _post(url: str, payload: dict[str, Any]) -> None:
    async def attempt() -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=payload, headers=_headers())
                resp.raise_for_status()
                return True
        except Exception as e:
            logger.warning(f"copy-check callback {url} failed: {e}")
            return False

    if await attempt():
        return
    await asyncio.sleep(1.0)
    await attempt()


async def progress(
    base_url: str,
    process_id: str,
    job_id: str,
    step: str,
    progress_pct: Optional[float] = None,
    layout_map: Optional[dict[str, Any]] = None,
) -> None:
    await _post(f"{base_url.rstrip('/')}/copy-check/callback/progress", {
        "process_id": process_id,
        "job_id": job_id,
        "step": step,
        "progress": progress_pct,
        "layout_map": layout_map,
    })


async def question_done(
    base_url: str,
    process_id: str,
    job_id: str,
    verdict: dict[str, Any],
    rubric_version: Optional[int] = None,
) -> None:
    payload = {
        "process_id": process_id,
        "job_id": job_id,
        "question_id": verdict["question_id"],
        "marks_awarded": verdict["marks_awarded"],
        "max_marks": verdict["max_marks"],
        "feedback": verdict["feedback"],
        "extracted_answer": verdict["extracted_answer"],
        "criteria_breakdown": verdict.get("criteria_breakdown", []),
        "annotations": verdict.get("annotations", []),
        "confidence": verdict.get("confidence", 0),
        "rubric_version": rubric_version,
        # COMPLETED (graded) or FAILED (grading failed after retry). Java uses
        # this to keep failed questions out of the released total and flag them
        # for teacher review instead of silently recording a 0.
        "status": verdict.get("status", "COMPLETED"),
        # Why grading failed (exception class + message, no trace) — admin-side
        # diagnosis rides to ai_question_evaluation.evaluation_result_json.
        # This payload is an explicit field list, so forgetting a key here means
        # the field silently never reaches Java.
        "error_detail": verdict.get("error_detail"),
        # False = internal choice: graded, but outside the `attempt` of its
        # choice group, so not part of the total (T1.36). Older Java builds
        # ignore the key and count every question, as before.
        "counted": bool(verdict.get("counted", True)),
    }
    await _post(f"{base_url.rstrip('/')}/copy-check/callback/question", payload)


async def complete(
    base_url: str,
    process_id: str,
    job_id: str,
    total_marks_awarded: float,
    total_max_marks: float,
    questions_evaluated: int,
    evaluated_file_id: Optional[str] = None,
) -> None:
    # evaluated_file_id is the annotated copy (see annotator.py). Omitted when
    # rendering or upload failed — Java leaves the existing value alone rather
    # than clearing it, so a failed render never destroys a copy someone
    # uploaded by hand.
    await _post(f"{base_url.rstrip('/')}/copy-check/callback/complete", {
        "process_id": process_id,
        "job_id": job_id,
        "total_marks_awarded": total_marks_awarded,
        "total_max_marks": total_max_marks,
        "questions_evaluated": questions_evaluated,
        "evaluated_file_id": evaluated_file_id,
    })


async def failed(
    base_url: str,
    process_id: str,
    job_id: str,
    error_message: str,
    error_code: Optional[str] = None,
) -> None:
    # error_code: spec 8.3 machine code (failure.py); error_message stays the
    # human text. Java builds without the field ignore it.
    await _post(f"{base_url.rstrip('/')}/copy-check/callback/failed", {
        "process_id": process_id,
        "job_id": job_id,
        "error_message": error_message,
        "error_code": error_code,
    })
