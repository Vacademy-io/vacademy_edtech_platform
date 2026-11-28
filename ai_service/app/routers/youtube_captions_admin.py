"""Super admin: the shared YouTube caption service (services/youtube_captions).

GET  /super-admin/v1/youtube-captions/health
     This pod's view: proxy mode and countries, whether the proxy credentials
     and the Supadata key are present (booleans only, never the values),
     breaker states, the last hour's counters and p95, today's Supadata
     credits and proxy MB (from the DB; youtube_captions.proxy_daily_mb is the
     proxy budget) and the library version. Breakers and counters are
     per pod; call it a few times to see both replicas (``pod`` says which).
POST /super-admin/v1/youtube-captions/probe
     {video_ids?: <=10 (default: the canary ids), language?, routes?: [direct, proxy, supadata]}
     Each route on its own per video, bypassing the cache and the breakers.
     Writes the cache only on OK.
POST /super-admin/v1/youtube-captions/requeue
     {institute_id?, dry_run: true, limit <= 2000}: the caption requeue
     (course_knowledge/caption_requeue.py) on demand; returns the counts.

Same platform-staff gate as routers/super_admin.py (SUPER_ADMIN_USER_IDS):
is_root_user and institute ADMIN roles are not staff.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..core.security import get_current_user
from ..schemas.auth import CustomUserDetails
from ..services.youtube_captions import service as yt_service
from .super_admin import _require_super_admin

router = APIRouter(prefix="/super-admin/v1/youtube-captions", tags=["Super Admin"])


class ProbeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    video_ids: Optional[List[str]] = Field(default=None, max_length=yt_service.MAX_PROBE_IDS)
    language: Optional[str] = Field(default=None, max_length=16)
    routes: Optional[List[Literal["direct", "proxy", "supadata"]]] = None


class RequeueRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    institute_id: Optional[str] = Field(default=None, max_length=255)
    dry_run: bool = True
    limit: int = Field(default=300, ge=1, le=2000)


@router.get("/health")
async def captions_health(current_user: CustomUserDetails = Depends(get_current_user)) -> Dict[str, Any]:
    _require_super_admin(current_user)
    return await asyncio.to_thread(yt_service.health_snapshot, True)


@router.post("/probe")
async def captions_probe(body: ProbeRequest,
                         current_user: CustomUserDetails = Depends(get_current_user)) -> Dict[str, Any]:
    _require_super_admin(current_user)
    ids = [v.strip() for v in (body.video_ids or []) if v and v.strip()]
    if not ids:
        cfg = await asyncio.to_thread(yt_service.load_config)
        ids = list(cfg.canary_video_ids)
    if not ids:
        raise HTTPException(status_code=400, detail="Give video_ids, or set youtube_captions.canary_video_ids")
    if len(ids) > yt_service.MAX_PROBE_IDS:
        raise HTTPException(status_code=422, detail=f"At most {yt_service.MAX_PROBE_IDS} video ids")
    rows = await yt_service.probe(ids, body.routes or list(yt_service.PROBE_ROUTES), body.language)
    return {"results": rows}


@router.post("/requeue")
async def captions_requeue(body: RequeueRequest,
                           current_user: CustomUserDetails = Depends(get_current_user)) -> Dict[str, Any]:
    _require_super_admin(current_user)
    from ..services.course_knowledge import caption_requeue
    return await asyncio.to_thread(caption_requeue.run_on_demand, institute_id=body.institute_id,
                                   dry_run=body.dry_run, limit=body.limit)
