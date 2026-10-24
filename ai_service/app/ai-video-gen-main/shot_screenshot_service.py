"""HTTP client for the render worker's POST /screenshot endpoint.

Used from the per-shot vision-review path in automation_pipeline._shot_task.
Synchronous (httpx.Client) because _shot_task itself is sync — the pipeline
runs N shots in parallel via a thread pool, and an async client would force
a layer of asyncio-bridging on every call.
"""
from __future__ import annotations

import base64
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScreenshotFrame:
    t: float
    image_bytes: bytes  # decoded PNG bytes — direct input to a multimodal LLM


@dataclass(frozen=True)
class BboxViolation:
    """One offending element from the deterministic post-render bbox lint.

    Reported by render_worker `POST /bbox-check` when a text or media element's
    bounding box crosses the canvas edge at any sampled timestamp. The pipeline
    consumes the list to drive a single corrective regen ("demote one font tier")
    before shipping the shot.
    """
    t: float           # shot-relative second at which the violation was observed
    selector: str      # CSS path approximation (e.g. "#title", "div.headline")
    rect: dict         # {"l": float, "t": float, "r": float, "b": float}
    text: str          # first 80 chars of element textContent (empty for media)
    is_media: bool     # True for IMG/SVG/CANVAS/VIDEO
    zone: str = ""     # keep-out zone hit (lesson teacher / caption strip); "" = canvas overflow


class ScreenshotClientError(RuntimeError):
    """Raised on any failure to obtain screenshots — caller should treat as
    a soft failure and skip vision review for that shot (ship the original)."""


class ShotScreenshotClient:
    """Single-shot screenshot client against the render worker's /screenshot.

    Construction reads RENDER_SERVER_URL / RENDER_SERVER_KEY from env to match
    the existing render_service.RenderService configuration surface. If the URL
    is unset, `is_configured` is False and the vision-review path will skip
    cleanly.
    """

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        render_key: Optional[str] = None,
        timeout_s: Optional[float] = None,
    ):
        self.base_url = (base_url or os.getenv("RENDER_SERVER_URL", "")).rstrip("/")
        self.render_key = render_key if render_key is not None else os.getenv("RENDER_SERVER_KEY", "")
        # The render worker is a single process that also serves the heavy MP4
        # render + rembg init; under the pipeline's 8-way shot fan-out a
        # /screenshot or /bbox-check can queue well past 30s and time out, which
        # silently disables ALL post-render visual QA (bbox-lint + vision
        # review). Default to 120s (env-tunable) instead of a flat 30s.
        if timeout_s is None:
            try:
                timeout_s = float(os.getenv("RENDER_SCREENSHOT_TIMEOUT_S", "120"))
            except ValueError:
                timeout_s = 120.0
        self._timeout = timeout_s
        try:
            self._max_retries = int(os.getenv("RENDER_SCREENSHOT_RETRIES", "2"))
        except ValueError:
            self._max_retries = 2
        self._retry_backoff_s = 1.5

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url)

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.render_key:
            h["X-Render-Key"] = self.render_key
        return h

    def _post_json(self, path: str, payload: dict) -> dict:
        """POST to the render worker with a bounded retry on transport/timeout
        errors. A 4xx/5xx is a definitive server response and is NOT retried —
        only transient transport failures (timeouts under burst load) are, since
        those recover once the single-process worker drains its queue. Raises
        the underlying httpx error; callers wrap it into ScreenshotClientError."""
        last_exc: Optional[Exception] = None
        for attempt in range(self._max_retries + 1):
            try:
                with httpx.Client(timeout=self._timeout) as client:
                    resp = client.post(
                        f"{self.base_url}{path}",
                        json=payload,
                        headers=self._headers(),
                    )
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError:
                raise  # definitive 4xx/5xx — don't retry
            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt < self._max_retries:
                    time.sleep(self._retry_backoff_s * (attempt + 1))
                    continue
                raise
        if last_exc:
            raise last_exc
        raise ScreenshotClientError("render worker request failed with no response")

    def take_shot_screenshots(
        self,
        *,
        html: str,
        width: int,
        height: int,
        timestamps: List[float],
        background: str = "#0a0e27",
    ) -> List[ScreenshotFrame]:
        """Call /screenshot on the render worker and return decoded PNGs.

        Returns frames in the order requested. Raises ScreenshotClientError on
        any transport / 4xx / 5xx / decode failure — the caller is expected
        to log + ship the shot without vision review on error.
        """
        if not self.is_configured:
            raise ScreenshotClientError("RENDER_SERVER_URL not configured")
        if not html or not html.strip():
            raise ScreenshotClientError("html is required")
        if not timestamps:
            raise ScreenshotClientError("at least one timestamp required")

        payload = {
            "html": html,
            "width": int(width),
            "height": int(height),
            "timestamps": [float(t) for t in timestamps],
            "background": background,
        }

        try:
            data = self._post_json("/screenshot", payload)
        except httpx.HTTPStatusError as exc:
            raise ScreenshotClientError(
                f"render worker /screenshot returned {exc.response.status_code}: "
                f"{exc.response.text[:300]}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ScreenshotClientError(f"render worker /screenshot transport error: {exc}") from exc
        except ScreenshotClientError:
            raise
        except Exception as exc:
            raise ScreenshotClientError(f"render worker /screenshot unexpected error: {exc}") from exc

        screenshots = data.get("screenshots") or []
        if not screenshots:
            raise ScreenshotClientError("render worker returned empty screenshots[]")

        frames: List[ScreenshotFrame] = []
        for entry in screenshots:
            try:
                t = float(entry["t"])
                img = base64.b64decode(entry["image_b64"])
            except (KeyError, ValueError, TypeError) as exc:
                raise ScreenshotClientError(f"malformed screenshot entry: {exc}") from exc
            # Sanity-check the PNG header so we fail fast on garbled responses
            # rather than wasting a vision-LLM call on undecodable bytes.
            if not img.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ScreenshotClientError("response did not contain valid PNG bytes")
            frames.append(ScreenshotFrame(t=t, image_bytes=img))

        return frames

    def check_shot_bbox(
        self,
        *,
        html: str,
        width: int,
        height: int,
        timestamps: List[float],
        background: str = "#0a0e27",
        keep_out: Optional[List[Dict[str, Any]]] = None,
        check_squeeze: bool = False,
    ) -> List[BboxViolation]:
        """Call /bbox-check on the render worker and return overflow violations.

        Returns an empty list when every visible text/media element fits inside
        the canvas at every sampled timestamp. Raises ScreenshotClientError on
        transport / 4xx / 5xx failure — the caller is expected to log + ship
        the shot without bbox lint on error (best-effort path, mirroring how
        screenshot failures degrade the vision-review path).
        """
        if not self.is_configured:
            raise ScreenshotClientError("RENDER_SERVER_URL not configured")
        if not html or not html.strip():
            raise ScreenshotClientError("html is required")
        if not timestamps:
            raise ScreenshotClientError("at least one timestamp required")

        payload = {
            "html": html,
            "width": int(width),
            "height": int(height),
            "timestamps": [float(t) for t in timestamps],
            "background": background,
        }
        if keep_out:
            payload["keep_out"] = list(keep_out)
        if check_squeeze:
            payload["check_squeeze"] = True

        try:
            data = self._post_json("/bbox-check", payload)
        except httpx.HTTPStatusError as exc:
            raise ScreenshotClientError(
                f"render worker /bbox-check returned {exc.response.status_code}: "
                f"{exc.response.text[:300]}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ScreenshotClientError(f"render worker /bbox-check transport error: {exc}") from exc
        except ScreenshotClientError:
            raise
        except Exception as exc:
            raise ScreenshotClientError(f"render worker /bbox-check unexpected error: {exc}") from exc

        violations_raw = data.get("violations") or []
        violations: List[BboxViolation] = []
        for entry in violations_raw:
            try:
                violations.append(BboxViolation(
                    t=float(entry["t"]),
                    selector=str(entry.get("selector", "?")),
                    rect=dict(entry.get("rect") or {}),
                    text=str(entry.get("text", "")),
                    is_media=bool(entry.get("is_media", False)),
                    zone=str(entry.get("zone", "") or ""),
                ))
            except (KeyError, ValueError, TypeError) as exc:
                raise ScreenshotClientError(f"malformed bbox violation entry: {exc}") from exc

        return violations
