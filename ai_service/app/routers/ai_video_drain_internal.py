"""Graceful drain of this pod's AI-video legs, for the Kubernetes preStop hook.

    POST /ai-service/internal/ai-video/v1/drain?wait_s=20
    X-Internal-Service-Token: <INTERNAL_SERVICE_TOKEN>

Stops every leased generation leg on THIS process and hands it back as
``interrupted`` (reason drain) so a pod that boots after it resumes the run
from its checkpoints right away — see ai_video_run_lease.drain. The hook
calls it on 127.0.0.1 from inside the pod. Like every ai-service /internal
route it is guarded by the shared internal token only (the public-edge block,
vacademy_devops/internal-paths-block.yaml, is still a draft). A drained pod
stops resuming other pods' runs until it restarts — it is about to.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict

from fastapi import APIRouter, Depends, Query

from ..dependencies import require_internal_service_token
from ..services import ai_video_run_lease as run_lease

router = APIRouter(
    prefix="/internal/ai-video/v1",
    tags=["Internal AI video"],
    dependencies=[Depends(require_internal_service_token)],
)

MAX_WAIT_S = 90.0


@router.post("/drain")
async def drain_ai_video_legs(
    wait_s: float = Query(run_lease.DRAIN_WAIT_S, ge=0, le=MAX_WAIT_S,
                          description="How long running legs may unwind before they are marked for them"),
) -> Dict[str, Any]:
    legs = await asyncio.to_thread(run_lease.drain, wait_s)
    return {"draining": True, "legs": legs}
