"""
HTTP client for the video indexing endpoint on the render worker server.

Mirrors the pattern from render_service.py — submits index jobs and polls status.
Reuses the same RENDER_SERVER_URL and RENDER_KEY since the indexer runs on the
same server as the renderer.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)


class IndexCapacityError(RuntimeError):
    """The render worker has no free slot right now. Retry, do not give up."""


class IndexService:
    """Client for the /index-jobs endpoints on the render worker."""

    def __init__(self, render_server_url: str, render_key: str = ""):
        self.base_url = render_server_url.rstrip("/")
        self.render_key = render_key
        self._timeout = 30

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url)

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.render_key:
            h["X-Render-Key"] = self.render_key
        return h

    def submit(
        self,
        input_video_id: str,
        source_url: str,
        mode: str,
        kind: str = "video",
        callback_url: Optional[str] = None,
    ) -> str:
        """Submit an index job to the render worker. Returns job_id.

        `kind` selects the pipeline branch on the worker:
          video → transcript/visuals (modes: 'podcast', 'demo')
          image → caption/ocr/face/colors (modes: 'photo', 'screenshot', 'diagram')

        Raises:
            RuntimeError: if submission fails or server is at capacity.
        """
        payload = {
            "input_video_id": input_video_id,
            "source_url": source_url,
            "mode": mode,
            "kind": kind,
        }
        if callback_url:
            payload["callback_url"] = callback_url

        try:
            with httpx.Client(timeout=self._timeout) as client:
                resp = client.post(
                    f"{self.base_url}/index-jobs",
                    json=payload,
                    headers=self._headers(),
                )
                if resp.status_code == 429:
                    # Transient: the worker is saturated, not the asset's fault.
                    # Callers must be able to tell this apart from a permanent
                    # failure so a batch upload retries instead of writing off
                    # every asset that arrived while the queue was full.
                    raise IndexCapacityError("Index server at capacity (429)")
                resp.raise_for_status()
                data = resp.json()
                job_id = data.get("job_id")
                if not job_id:
                    raise RuntimeError(f"No job_id in response: {data}")
                logger.info(f"Index job submitted: {job_id} for input_video {input_video_id}")
                return job_id
        except httpx.HTTPError as e:
            raise RuntimeError(f"Index job submission failed: {e}") from e

    def check_status(self, job_id: str) -> Dict[str, Any]:
        """Poll the status of an index job. Returns the full status dict.

        Returns a dict with at least: status, progress, output_urls, error.
        On HTTP failure returns a synthetic 'unknown' status.
        """
        try:
            with httpx.Client(timeout=self._timeout) as client:
                resp = client.get(
                    f"{self.base_url}/index-jobs/{job_id}",
                    headers=self._headers(),
                )
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.warning(f"Index status check failed for {job_id}: {e}")
            return {"status": "unknown", "error": str(e)}
