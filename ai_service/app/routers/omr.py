"""OMR sheet reading for assessment_service.

  - POST /omr/v1/read   count a file's pages, or read the given pages of it

Gated by X-Internal-Service-Token (assessment_service is the only caller). The
request carries the OMRChecker template assessment_service generated for the
sheet, so this endpoint knows nothing about assessments. 429 with Retry-After
when every OMR slot on this pod is taken.
"""
from __future__ import annotations

import logging
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..dependencies import require_internal_service_token
from ..services.omr import service as omr_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/omr/v1", tags=["omr"])


class OmrMarker(BaseModel):
    outer_mm: float
    inner_mm: float
    core_mm: float
    pad_mm: float


class OmrLayout(BaseModel):
    processing_width: int
    processing_height: int
    render_dpi: int = 200
    # A field is flagged when a bubble is within low_margin of the threshold, or
    # an "empty" bubble is faint_delta darker than the other empty ones of its row.
    low_margin: float = 20
    faint_delta: float = 15
    # [x, y, w, h] in template pixels
    name_box: Optional[list[float]] = None
    orientation_box: Optional[list[float]] = None


class OmrReadRequest(BaseModel):
    file_url: str
    file_kind: Literal["pdf", "image"] = "pdf"
    # 1-based pages to read; empty = only count the pages.
    pages: list[int] = Field(default_factory=list)
    template: dict[str, Any] = Field(default_factory=dict)
    marker: Optional[OmrMarker] = None
    layout: Optional[OmrLayout] = None
    file_name_prefix: Optional[str] = None


@router.post("/read", dependencies=[Depends(require_internal_service_token)])
async def read(req: OmrReadRequest) -> dict[str, Any]:
    if req.pages and (req.marker is None or req.layout is None or not req.template):
        raise HTTPException(status_code=400, detail="template, marker and layout are required to read pages")
    try:
        return await omr_service.read({
            "file_url": req.file_url,
            "file_kind": req.file_kind,
            "pages": req.pages,
            "template": req.template,
            "marker": req.marker.model_dump() if req.marker else None,
            "layout": req.layout.model_dump() if req.layout else None,
            "file_name_prefix": req.file_name_prefix,
        })
    except omr_service.OmrBusy:
        raise HTTPException(status_code=429, detail="OMR reading is busy on this pod; retry later",
                            headers={"Retry-After": "5"})
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=422, detail=f"the file could not be downloaded: {type(e).__name__}")
