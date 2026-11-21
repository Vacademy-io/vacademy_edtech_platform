"""Scan Station: analyse one load of a two-pass scan (contract C1).

  - POST /copy-check/scan/analyse-load

Called only by assessment_service's ScanStationRunner, synchronously (its
timeout is 300 s; this call keeps an internal 240 s budget). Stateless: the
response is the whole record and assessment_service stores it.

  404  while env COPY_CHECK_SCAN_STATION is not '1'/'true' (the default)
  401  bad X-Internal-Service-Token
  422  bad body
  429  Retry-After: 10 when this pod's analyse slots are taken
  503  {"retryable": true} on a model outage or when the 240 s budget runs out

The database session is used only to read the model config and the
institute's keys, and is closed before the analysis starts (_model_config).

A call that runs out of budget answers at once, but keeps its slot until the
pool jobs it started have ended (analyse.release_slot), so the retry is told
429 rather than queuing behind them.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..dependencies import require_internal_service_token
from ..schemas.copy_check_scan import AnalyseLoadRequest, AnalyseLoadResponse
from ..services.copy_check.scan import analyse as scan_analyse
from ..services.copy_check.scan import config as scan_config
from ..services.copy_check.scan import header_read

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/copy-check/scan", tags=["copy-check-scan"])


def require_scan_station_enabled() -> None:
    if not scan_config.enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _retryable(detail: str) -> JSONResponse:
    return JSONResponse(status_code=503, content={"retryable": True, "detail": detail})


def _model_config(db: Session, req: AnalyseLoadRequest):
    """Read everything this call needs from the database (header model, the
    institute's API keys), then close the session: its pooled connection goes
    back now, not after the up-to-240 s analysis (the copy_check orchestrator
    closes its session before the model calls the same way)."""
    try:
        model = header_read.header_model(db, req.preferred_model)
        llm = header_read.make_llm(db, institute_id=req.institute_id)
        return llm, model
    finally:
        db.close()


@router.post(
    "/analyse-load",
    response_model=AnalyseLoadResponse,
    dependencies=[Depends(require_scan_station_enabled), Depends(require_internal_service_token)],
)
async def analyse_load(req: AnalyseLoadRequest, db: Session = Depends(db_dependency)):
    try:
        await scan_analyse.slots.acquire()
    except scan_analyse.ScanBusy:
        raise HTTPException(status_code=429, detail="scan analysis is busy on this pod; retry later",
                            headers={"Retry-After": "10"})
    jobs = scan_analyse.Jobs()
    try:
        llm, model = await asyncio.to_thread(_model_config, db, req)
        return await asyncio.wait_for(
            scan_analyse.analyse_load(req.model_dump(), llm=llm, model=model, jobs=jobs),
            timeout=scan_config.CALL_BUDGET_SECONDS,
        )
    except header_read.ScanRetryable as e:
        logger.warning("scan analyse: load %s retryable: %s", req.load_no, e)
        return _retryable(str(e))
    except asyncio.TimeoutError:
        logger.warning("scan analyse: load %s over the %.0f s budget", req.load_no, scan_config.CALL_BUDGET_SECONDS)
        return _retryable("the analysis ran over its time budget")
    finally:
        scan_analyse.release_slot(jobs)
