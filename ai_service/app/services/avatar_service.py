"""
Provider-agnostic avatar video generation service.

Calls a serverless inference endpoint (RunPod, fal.ai, etc.) to run
EchoMimic and produce a talking-head video from a still image + audio.
"""
from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from typing import Any, Dict

import requests

try:
    from .vendor_call_log import record_vendor_failure
except Exception:  # noqa: BLE001
    def record_vendor_failure(*args, **kwargs):  # type: ignore[misc]
        return None

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Abstract provider
# ---------------------------------------------------------------------------

class AvatarProvider(ABC):
    """Base class for avatar-video providers."""

    @abstractmethod
    def generate(self, image_url: str, audio_url: str) -> str:
        """Generate a talking-head video and return its URL.

        Args:
            image_url: Public URL of the source face image.
            audio_url: Public URL of the driving audio clip.

        Returns:
            Public URL of the generated video.
        """


# ---------------------------------------------------------------------------
# RunPod Serverless implementation
# ---------------------------------------------------------------------------

class RunPodAvatarProvider(AvatarProvider):
    """Generate avatar videos via RunPod Serverless (EchoMimic)."""

    TIMEOUT_SECONDS = 900   # 15 min: model init is one-time; warm inference ~5-8 min + buffer
    POLL_INTERVAL_SECONDS = 10

    def __init__(self, api_key: str, endpoint_id: str):
        self.api_key = api_key
        self.endpoint_id = endpoint_id

    def submit(self, image_url: str, audio_url: str) -> str:
        """Submit a RunPod job and return the job ID immediately (non-blocking)."""
        headers = {"Authorization": f"Bearer {self.api_key}"}
        run_url = f"https://api.runpod.ai/v2/{self.endpoint_id}/run"
        payload = {"input": {"image_url": image_url, "audio_url": audio_url}}
        logger.info("Submitting RunPod job to %s", run_url)
        try:
            resp = requests.post(run_url, headers=headers, json=payload, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as exc:
            record_vendor_failure(run_url, "submit avatar job", request=payload,
                                  response=getattr(exc.response, "text", None), error=exc)
            raise
        job_id = resp.json()["id"]
        logger.info("RunPod job submitted: %s", job_id)
        return job_id

    def check_status(self, job_id: str) -> Dict[str, Any]:
        """Poll one RunPod job status check. Returns dict with 'status', 'progress',
        'stage', and 'video_url' (only when COMPLETED) or 'error' (only when FAILED)."""
        headers = {"Authorization": f"Bearer {self.api_key}"}
        status_url = f"https://api.runpod.ai/v2/{self.endpoint_id}/status/{job_id}"
        try:
            resp = requests.get(status_url, headers=headers, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as exc:
            record_vendor_failure(status_url, "check avatar job status",
                                  response=getattr(exc.response, "text", None), error=exc)
            raise
        data = resp.json()
        status = data.get("status", "UNKNOWN")

        stream = data.get("stream") or []
        progress, stage = 0, ""
        if stream:
            latest = stream[-1].get("output", {})
            progress = latest.get("progress", 0)
            stage = latest.get("stage", "")

        logger.info("RunPod job %s: status=%s progress=%s%% stage=%s", job_id, status, progress, stage)
        result: Dict[str, Any] = {"status": status, "progress": progress, "stage": stage}
        if status == "COMPLETED":
            result["video_url"] = data.get("output", {}).get("video_url", "")
        elif status == "FAILED":
            result["error"] = data.get("error", "unknown error")
        return result

    def generate(self, image_url: str, audio_url: str) -> str:
        """Synchronous convenience wrapper: submit then poll until completion.
        Prefer submit() + check_status() from async contexts to avoid blocking threads."""
        job_id = self.submit(image_url, audio_url)
        deadline = time.time() + self.TIMEOUT_SECONDS

        while time.time() < deadline:
            time.sleep(self.POLL_INTERVAL_SECONDS)
            result = self.check_status(job_id)
            status = result["status"]

            if status == "COMPLETED":
                logger.info("RunPod job %s completed: %s", job_id, result["video_url"])
                return result["video_url"]
            if status == "FAILED":
                raise RuntimeError(f"RunPod job {job_id} failed: {result.get('error', 'unknown')}")

        raise TimeoutError(
            f"RunPod job {job_id} did not complete within {self.TIMEOUT_SECONDS}s"
        )


# ---------------------------------------------------------------------------
# fal.ai stub (for future use)
# ---------------------------------------------------------------------------

class FalAvatarProvider(AvatarProvider):
    """Generate avatar videos via fal.ai EchoMimic v3 (stub)."""

    TIMEOUT_SECONDS = 600
    POLL_INTERVAL_SECONDS = 5

    def __init__(self, api_key: str):
        self.api_key = api_key

    def generate(self, image_url: str, audio_url: str) -> str:
        headers = {
            "Authorization": f"Key {self.api_key}",
            "Content-Type": "application/json",
        }
        submit_url = "https://queue.fal.run/fal-ai/echomimic-v3"

        payload = {
            "image_url": image_url,
            "audio_url": audio_url,
            "prompt": "A person speaking naturally with subtle head movements",
        }
        logger.info("Submitting fal.ai job to %s", submit_url)
        try:
            resp = requests.post(submit_url, headers=headers, json=payload, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as exc:
            record_vendor_failure(submit_url, "submit avatar job", request=payload,
                                  response=getattr(exc.response, "text", None), error=exc)
            raise
        data = resp.json()

        # fal.ai queue returns a request_id + status_url
        status_url = data.get("status_url")
        if not status_url:
            # Synchronous result
            return data["output"]["video"]["url"]

        deadline = time.time() + self.TIMEOUT_SECONDS
        while time.time() < deadline:
            time.sleep(self.POLL_INTERVAL_SECONDS)
            try:
                poll = requests.get(status_url, headers=headers, timeout=30)
                poll.raise_for_status()
            except requests.RequestException as exc:
                record_vendor_failure(status_url, "check avatar job status",
                                      response=getattr(exc.response, "text", None), error=exc)
                raise
            result = poll.json()
            status = result.get("status")
            logger.info("fal.ai job status: %s", status)

            if status == "COMPLETED":
                return result["output"]["video"]["url"]
            if status in ("FAILED", "ERROR"):
                error = result.get("error", "unknown error")
                raise RuntimeError(f"fal.ai job failed: {error}")

        raise TimeoutError(
            f"fal.ai job did not complete within {self.TIMEOUT_SECONDS}s"
        )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

_PROVIDERS: Dict[str, type] = {
    "runpod": RunPodAvatarProvider,
    "fal": FalAvatarProvider,
}


def get_avatar_provider(provider: str = "runpod", **kwargs: Any) -> AvatarProvider:
    """Instantiate an avatar provider by name.

    Args:
        provider: Provider key (``"runpod"`` or ``"fal"``).
        **kwargs: Passed directly to the provider constructor
                  (e.g. ``api_key``, ``endpoint_id``).

    Returns:
        An ``AvatarProvider`` instance ready to call ``.generate()``.

    Raises:
        ValueError: If the provider name is unknown.
    """
    cls = _PROVIDERS.get(provider)
    if cls is None:
        raise ValueError(
            f"Unknown avatar provider '{provider}'. "
            f"Available: {', '.join(_PROVIDERS)}"
        )
    return cls(**kwargs)
