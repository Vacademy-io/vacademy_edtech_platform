"""Scan Station build step for assessment_service (contract C2).

  - POST /copy-check/scan/build   one PDF per planned copy (at most 10 copies and
                                  300 pages per call), uploaded to media-service
                                  as a file the institute owns

Answers 404 unless env COPY_CHECK_SCAN_STATION is on (checked before the token,
so the route does not exist while the feature is off), 401 without the internal
service token, 422 for a bad body or too many copies/pages, 429 with
Retry-After: 10 when this pod's build slot is taken. A copy that fails carries
its own `error`; the call still answers 200.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException

from ..dependencies import require_internal_service_token
from ..schemas.copy_check_scan_build import ScanBuildRequest, ScanBuildResponse
from ..services.copy_check.scan_build import service as scan_build

router = APIRouter(prefix="/copy-check/scan", tags=["copy-check-scan"])


def _scan_station_on() -> bool:
    return os.getenv("COPY_CHECK_SCAN_STATION", "").strip().lower() in ("1", "true")


def require_scan_station() -> None:
    if not _scan_station_on():
        raise HTTPException(status_code=404, detail="Not Found")


@router.post(
    "/build",
    response_model=ScanBuildResponse,
    dependencies=[Depends(require_scan_station), Depends(require_internal_service_token)],
)
async def build_copies(req: ScanBuildRequest) -> ScanBuildResponse:
    try:
        copies = await scan_build.build_copies(
            [c.model_dump() for c in req.copies],
            institute_id=req.institute_id,
            source_id=req.source_id,
            session_id=req.session_id,
        )
    except scan_build.ScanBuildBusy:
        raise HTTPException(
            status_code=429,
            detail="scan build is busy on this pod; retry later",
            headers={"Retry-After": "10"},
        )
    return ScanBuildResponse(copies=copies)
