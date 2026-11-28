"""
Router for AI Input Asset indexing — videos and images.

Generalizes the original input-video router to a polymorphic asset surface.
Asset kind is fixed at creation:
  kind='video', mode ∈ {podcast, demo}
  kind='image', mode ∈ {photo, screenshot, diagram}

The router is mounted twice in app_factory.py:
  /input-asset/*   — primary path (use this)
  /input-video/*   — legacy alias for older clients; hidden from OpenAPI

POST /create accepts kind (default 'video' for legacy compatibility). All
other endpoints are kind-agnostic; pass ?kind= on /list to filter.
"""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..dependencies import get_institute_from_api_key
from ..config import get_settings
from ..repositories.ai_input_asset_repository import AiInputAssetRepository
from ..services.index_service import IndexService, IndexCapacityError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["input-asset"])


# Mode constraints per kind. Mirrors the CHECK constraint on ai_input_assets
# and the dispatch table in extractor/image_pipeline.py.
VALID_MODES_BY_KIND = {
    "video": ("podcast", "demo"),
    "image": ("photo", "screenshot", "diagram"),
}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateInputAssetRequest(BaseModel):
    name: str = Field(..., description="User-given name for this asset")
    mode: str = Field(..., description="Video: 'podcast'|'demo'. Image: 'photo'|'screenshot'|'diagram'")
    source_url: str = Field(..., description="S3 URL of the uploaded asset")
    kind: str = Field(default="video", description="'video' or 'image'")


class InputAssetResponse(BaseModel):
    id: str
    institute_id: str
    name: str
    kind: str = "video"
    mode: str
    status: str
    source_url: str
    # Video-only spatial fields.
    duration_seconds: Optional[float] = None
    resolution: Optional[str] = None
    # Image-only spatial fields.
    width: Optional[int] = None
    height: Optional[int] = None
    # Output artifact URLs (one or the other based on kind).
    context_json_url: Optional[str] = None       # video
    spatial_db_url: Optional[str] = None         # video
    image_metadata_url: Optional[str] = None     # image
    assets_urls: Optional[dict] = None
    render_job_id: Optional[str] = None
    progress: int = 0
    error_message: Optional[str] = None
    metadata: Optional[dict] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class InputAssetStatusResponse(BaseModel):
    id: str
    status: str
    progress: int = 0
    error_message: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_index_service() -> IndexService:
    settings = get_settings()
    return IndexService(
        render_server_url=settings.render_server_url,
        render_key=settings.render_server_key,
    )


async def _poll_index_status(
    input_asset_id: str,
    job_id: str,
    index_service: IndexService,
) -> None:
    """Background task: poll render worker for job status, update DB.

    Runs for up to 1 hour. On completion or failure, writes final state to DB.
    Maps the worker's output_urls dict (kind-discriminated keys) onto the
    appropriate ai_input_assets columns:
      video: context_json_url, spatial_db_url, duration_seconds, resolution
      image: image_metadata_url, width, height
    """
    deadline_s = 3600
    interval_s = 10
    elapsed = 0

    while elapsed < deadline_s:
        await asyncio.sleep(interval_s)
        elapsed += interval_s

        try:
            resp = index_service.check_status(job_id)
        except Exception as e:
            logger.warning(f"Poll error for {input_asset_id}: {e}")
            continue

        rs = resp.get("status", "")
        repo = AiInputAssetRepository()  # fresh session per poll

        if rs == "completed":
            output_urls = resp.get("output_urls") or {}
            # The worker should never report "completed" without producing the
            # kind-appropriate metadata artifact, but if it does, treat the job
            # as failed instead of leaving an asset card with no preview/data.
            has_video_artifact = bool(output_urls.get("context_json"))
            has_image_artifact = bool(output_urls.get("image_metadata"))
            if not (has_video_artifact or has_image_artifact):
                repo.update_status(
                    input_asset_id, "FAILED",
                    error_message="Worker reported completed but produced no metadata artifact",
                )
                logger.error(
                    f"Input asset {input_asset_id} completed with empty output_urls: {output_urls}"
                )
                return
            repo.update_on_completion(
                input_asset_id,
                context_json_url=output_urls.get("context_json"),
                spatial_db_url=output_urls.get("spatial_db"),
                image_metadata_url=output_urls.get("image_metadata"),
                assets_urls=output_urls.get("assets"),
                duration_seconds=resp.get("duration_seconds"),
                resolution=resp.get("resolution"),
                width=resp.get("width"),
                height=resp.get("height"),
            )
            logger.info(f"Input asset {input_asset_id} indexing completed")
            return

        if rs == "failed":
            repo.update_status(
                input_asset_id, "FAILED",
                error_message=resp.get("error", "Unknown error"),
            )
            logger.error(f"Input asset {input_asset_id} indexing failed: {resp.get('error')}")
            return

        # Only flip to PROCESSING on a real worker-side running state.
        # Worker reports "unknown" on any HTTP error from check_status — a
        # transient blip would otherwise overwrite real progress with 0 and
        # confuse the FE polling.
        if rs in ("running", "queued"):
            progress = int(resp.get("progress", 0) or 0)
            repo.update_status(input_asset_id, "PROCESSING", progress=progress)

    repo = AiInputAssetRepository()
    repo.update_status(input_asset_id, "FAILED", error_message="Indexing timed out (1h)")
    logger.error(f"Input asset {input_asset_id} indexing timed out")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

async def _submit_with_retry(
    input_asset_id: str,
    source_url: str,
    mode: str,
    kind: str,
    index_service: IndexService,
) -> None:
    """Keep asking the worker for a slot, backing off between attempts.

    Only capacity refusals come here. Anything else is a real failure and is
    recorded as one. The schedule spans ~15 minutes, which comfortably covers
    a queue drained by other jobs; past that the asset is marked FAILED and the
    user can retry it explicitly.
    """
    backoff_s = [15, 30, 60, 60, 120, 120, 180, 300]
    for delay in backoff_s:
        await asyncio.sleep(delay)
        try:
            job_id = index_service.submit(
                input_video_id=input_asset_id,
                source_url=source_url,
                mode=mode,
                kind=kind,
            )
        except IndexCapacityError:
            continue
        except Exception as e:
            AiInputAssetRepository().update_status(
                input_asset_id, "FAILED", error_message=str(e)
            )
            logger.error(f"Index retry for {input_asset_id} failed: {e}")
            return
        AiInputAssetRepository().update_status(
            input_asset_id, "QUEUED", render_job_id=job_id
        )
        await _poll_index_status(input_asset_id, job_id, index_service)
        return

    AiInputAssetRepository().update_status(
        input_asset_id,
        "FAILED",
        error_message="Index server stayed at capacity — retry this asset",
    )


@router.post("/create", response_model=InputAssetResponse)
async def create_input_asset(
    request: CreateInputAssetRequest,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Upload metadata and start indexing an asset (video or image)."""
    if request.kind not in VALID_MODES_BY_KIND:
        raise HTTPException(status_code=400, detail="kind must be 'video' or 'image'")
    valid_modes = VALID_MODES_BY_KIND[request.kind]
    if request.mode not in valid_modes:
        raise HTTPException(
            status_code=400,
            detail=f"For kind='{request.kind}', mode must be one of {valid_modes}",
        )

    repo = AiInputAssetRepository(session=db)
    record = repo.create(
        institute_id=institute_id,
        name=request.name,
        mode=request.mode,
        source_url=request.source_url,
        kind=request.kind,
    )

    index_svc = _get_index_service()
    try:
        job_id = index_svc.submit(
            input_video_id=str(record.id),  # legacy field name on the worker
            source_url=request.source_url,
            mode=request.mode,
            kind=request.kind,
        )
        repo.update_status(str(record.id), "QUEUED", render_job_id=job_id)
    except IndexCapacityError:
        # The worker is full, which says nothing about this asset. Uploading a
        # batch fills the queue in seconds, and marking the overflow FAILED
        # made a 20-image upload look like 14 broken files. Hold the asset
        # PENDING and keep trying in the background.
        logger.info(
            f"Index server at capacity for {record.id}; queued for background retry"
        )
        asyncio.create_task(
            _submit_with_retry(
                str(record.id), request.source_url, request.mode, request.kind, index_svc
            )
        )
        db.refresh(record)
        return InputAssetResponse(**record.to_dict())
    except RuntimeError as e:
        repo.update_status(str(record.id), "FAILED", error_message=str(e))
        logger.error(f"Failed to submit index job: {e}")
        db.refresh(record)
        return InputAssetResponse(**record.to_dict())

    asyncio.create_task(_poll_index_status(str(record.id), job_id, index_svc))

    db.refresh(record)
    return InputAssetResponse(**record.to_dict())


@router.post("/{record_id}/retry", response_model=InputAssetResponse)
async def retry_input_asset(
    record_id: str,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Re-submit a FAILED asset for indexing, reusing the existing upload.

    Indexing can fail for reasons that have nothing to do with the file — a
    saturated worker being the common one. Without this the only way back was
    to upload the same image again, which orphans the first row and pays for
    the storage twice.
    """
    repo = AiInputAssetRepository(session=db)
    record = repo.get_by_id(record_id)
    if not record or str(record.institute_id) != str(institute_id):
        raise HTTPException(status_code=404, detail="Asset not found")
    if record.status in ("QUEUED", "PROCESSING"):
        raise HTTPException(status_code=409, detail=f"Already {record.status.lower()}")
    if record.status == "COMPLETED":
        raise HTTPException(status_code=409, detail="Already indexed")

    repo.update_status(record_id, "PENDING", error_message="")
    index_svc = _get_index_service()
    try:
        job_id = index_svc.submit(
            input_video_id=record_id,
            source_url=record.source_url,
            mode=record.mode,
            kind=getattr(record, "kind", "video") or "video",
        )
        repo.update_status(record_id, "QUEUED", render_job_id=job_id)
        asyncio.create_task(_poll_index_status(record_id, job_id, index_svc))
    except IndexCapacityError:
        asyncio.create_task(
            _submit_with_retry(
                record_id,
                record.source_url,
                record.mode,
                getattr(record, "kind", "video") or "video",
                index_svc,
            )
        )
    except RuntimeError as e:
        repo.update_status(record_id, "FAILED", error_message=str(e))
        raise HTTPException(status_code=502, detail=str(e))

    db.refresh(record)
    return InputAssetResponse(**record.to_dict())


@router.get("/list", response_model=List[InputAssetResponse])
async def list_input_assets(
    kind: Optional[str] = Query(None, description="Filter by 'video' or 'image'"),
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """List all input assets for an institute, newest first."""
    if kind is not None and kind not in VALID_MODES_BY_KIND:
        raise HTTPException(status_code=400, detail="kind must be 'video' or 'image'")
    repo = AiInputAssetRepository(session=db)
    records = repo.list_by_institute(institute_id, kind=kind)
    return [InputAssetResponse(**r.to_dict()) for r in records]


@router.get("/{record_id}", response_model=InputAssetResponse)
async def get_input_asset(
    record_id: str,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Get full details for a single input asset."""
    repo = AiInputAssetRepository(session=db)
    record = repo.get_by_id(record_id)
    if not record or record.institute_id != institute_id:
        raise HTTPException(status_code=404, detail="Input asset not found")
    return InputAssetResponse(**record.to_dict())


@router.get("/{record_id}/status", response_model=InputAssetStatusResponse)
async def get_input_asset_status(
    record_id: str,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Lightweight status check for FE polling."""
    repo = AiInputAssetRepository(session=db)
    record = repo.get_by_id(record_id)
    if not record or record.institute_id != institute_id:
        raise HTTPException(status_code=404, detail="Input asset not found")
    return InputAssetStatusResponse(
        id=str(record.id),
        status=record.status,
        progress=record.progress or 0,
        error_message=record.error_message,
    )


@router.delete("/{record_id}")
async def delete_input_asset(
    record_id: str,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Delete an input asset record."""
    repo = AiInputAssetRepository(session=db)
    record = repo.get_by_id(record_id)
    if not record or record.institute_id != institute_id:
        raise HTTPException(status_code=404, detail="Input asset not found")
    repo.delete_by_id(record_id)
    return {"deleted": True}
