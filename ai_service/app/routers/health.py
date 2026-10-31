from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
import time
import os
from datetime import datetime

from ..config import get_settings
from ..db import db_dependency

router = APIRouter(
    prefix="/health",
    tags=["Health"]
)


@router.get("/ping")
def ping() -> dict:
    """
    Ultra-lightweight ping endpoint for client-side latency measurement
    """
    return {
        "status": "OK",
        "service": "ai-service",
        "timestamp": int(time.time() * 1000)
    }


@router.get("/db")
def get_database_latency(db: Session = Depends(db_dependency)) -> dict:
    """
    Database latency measurement
    """
    response = {
        "service": "ai-service",
        "timestamp": datetime.utcnow().isoformat()
    }
    
    start_time = time.time()
    try:
        # Simple query to test connection
        db.execute(text("SELECT 1"))
        latency_ms = (time.time() - start_time) * 1000
        
        response.update({
            "status": "UP",
            "connected": True,
            "connection_time_ms": latency_ms,
            "total_latency_ms": latency_ms
        })
    except Exception as e:
        latency_ms = (time.time() - start_time) * 1000
        response.update({
            "status": "DOWN",
            "connected": False,
            "connection_time_ms": latency_ms,
            "error": str(e)
        })
        
    return response


@router.get("/complete")
def get_complete_health(db: Session = Depends(db_dependency)) -> dict:
    """
    Complete health summary
    """
    # Database health
    db_response = get_database_latency(db)
    
    overall_status = "HEALTHY" if db_response["status"] == "UP" else "UNHEALTHY"
    
    settings = get_settings()

    return {
        "service": "ai-service",
        "timestamp": datetime.utcnow().isoformat(),
        "database": db_response,
        # Reports the global switch only. Whether any given institute can use the
        # MCP server is a per-institute setting, not a service health property.
        "mcp": {
            "enabled": bool(settings.mcp_server_enabled),
            "endpoint": f"{settings.api_base_path}/mcp" if settings.mcp_server_enabled else None,
        },
        "overall_status": overall_status
    }

# Keep original endpoints for backward compatibility if needed by K8s probes
@router.get("", include_in_schema=False)
@router.get("/", include_in_schema=False)
def health_root() -> dict:
    return {"status": "ok"}

# Keep original endpoints for backward compatibility if needed by K8s probes
@router.get("/health", include_in_schema=False)
def health_legacy() -> dict:
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────────────────────
# Diagnostics — pipeline-config readout
#
# Per-pod state probe so operators can verify (bypassing the LB) that every
# replica is running the same code version and resolves v3 unconditionally.
# Returns: pipeline_version (always "v3"), whether the automation_pipeline
# module imports successfully, list of tier configs present, the module's
# resolved file path, and the git commit if exposed via env.
# No authentication — the response leaks no secrets and the endpoint is
# read-only.
# ─────────────────────────────────────────────────────────────────────────

@router.get("/diagnostics/pipeline-config")
def diagnostics_pipeline_config() -> dict:
    """Per-pod readout of the AI video pipeline boot state.

    Hit this against each replica (bypassing the LB) when an audit panel
    or runtime log shows a v2/v3 mismatch — the response narrows it down
    to "module didn't import" vs "older deployed commit" in one call.
    """
    import sys as _sys_d
    from pathlib import Path as _Path_d
    out: dict = {
        "pipeline_version": "v3",
        "v2_supported": False,
        "v2_note": (
            "v2 BeatPlanner→Director chain remains as an internal exception-handler "
            "fallback inside _run_v3_shot_planning, but is no longer user-selectable."
        ),
        "tier_configs_present": [],
        "automation_pipeline_module_path": None,
        "automation_pipeline_import_ok": False,
        "automation_pipeline_import_error": None,
        "git_commit": os.environ.get("GIT_COMMIT") or os.environ.get("VERCEL_GIT_COMMIT_SHA") or None,
        "pipeline_version_env_var": os.environ.get("PIPELINE_VERSION") or None,
        "pipeline_version_env_var_note": (
            "PIPELINE_VERSION env var is no longer consulted. Listed here for "
            "operational visibility only — set or unset, behavior is identical."
        ),
    }
    try:
        _aigen = str(_Path_d(__file__).resolve().parent.parent / "ai-video-gen-main")
        if _aigen not in _sys_d.path:
            _sys_d.path.insert(0, _aigen)
        from automation_pipeline import QUALITY_TIERS as _qt_d  # type: ignore
        import automation_pipeline as _ap_module  # type: ignore
        out["tier_configs_present"] = sorted(_qt_d.keys())
        out["automation_pipeline_module_path"] = getattr(_ap_module, "__file__", None)
        out["automation_pipeline_import_ok"] = True
        # Method-presence sanity check — `_pipeline_v3_enabled` is the
        # in-pipeline gate. A code-deletion or refactor that loses this
        # method would silently send every run down the v2 fallback. Probe
        # both presence + return value here so the diagnostic catches it.
        try:
            from automation_pipeline import VideoGenerationPipeline as _Pipe  # type: ignore
            _method = getattr(_Pipe, "_pipeline_v3_enabled", None)
            out["pipeline_v3_method_present"] = callable(_method)
            # Calling the method needs `self._tier_config` but the new body
            # is a constant `return True` and doesn't touch self. Probe by
            # calling it bound to a minimal stub.
            class _Stub:
                _tier_config = {}
            out["pipeline_v3_method_returns_true"] = bool(_method(_Stub()))  # type: ignore[arg-type]
        except Exception as _mp_err:
            out["pipeline_v3_method_present"] = False
            out["pipeline_v3_method_error"] = f"{type(_mp_err).__name__}: {_mp_err}"
    except Exception as exc:
        out["automation_pipeline_import_error"] = f"{type(exc).__name__}: {exc}"
    return out
