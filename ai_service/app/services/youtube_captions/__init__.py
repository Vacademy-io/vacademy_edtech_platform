"""Shared YouTube caption service (KB ingest, the AI tutor, course knowledge).

One fallback chain (cache -> direct -> rotating residential proxy -> Supadata)
with a shared cache in course_extract_cache, per-pod capacity limits, circuit
breakers and a staff health / probe API (routers/youtube_captions_admin.py).
Secrets come only from env / the k8s secret: YT_CAPTIONS_PROXY,
WEBSHARE_PROXY_USERNAME, WEBSHARE_PROXY_PASSWORD, YT_CAPTIONS_PROXY_HTTP_URL,
YT_CAPTIONS_PROXY_HTTPS_URL, SUPADATA_API_KEY. Tuning lives in platform
settings (group youtube_captions).

Callers that tests fake should call through the module
(``from ..youtube_captions import service as yt_service``), not these names.
"""
from .service import canary_ok, get_captions, health_snapshot, load_config, probe, require_captions
from .types import (
    CaptionResult, CaptionSegment, CaptionsError, DEFINITIVE, NOTES, Outcome, TRANSIENT, note_for,
)

__all__ = [
    "get_captions", "require_captions", "probe", "canary_ok", "health_snapshot", "load_config",
    "CaptionResult", "CaptionSegment", "CaptionsError", "Outcome", "NOTES", "DEFINITIVE", "TRANSIENT", "note_for",
]
