"""
Pixabay API client for stock photo and video search.

Mirrors the public surface of PexelsService so call sites in the video
generation pipeline can treat both providers interchangeably.

Usage:
    svc = PixabayService("key1,key2")
    photo = svc.search_photos("mitosis diagram", orientation="landscape")
    video = svc.search_videos("microscope close up", orientation="landscape")
"""

from __future__ import annotations

import json
import logging
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

try:
    try:
        from app.services.vendor_call_log import record_vendor_failure
    except ModuleNotFoundError:
        # Loaded flat via sys.path (hyphenated dir); in the container the package is ai_service.app.
        from ai_service.app.services.vendor_call_log import record_vendor_failure
except Exception:  # noqa: BLE001
    def record_vendor_failure(*args, **kwargs):  # type: ignore[misc]
        return None

logger = logging.getLogger(__name__)


class PixabayService:
    """Synchronous Pixabay API client with round-robin key rotation."""

    PHOTOS_URL = "https://pixabay.com/api/"
    VIDEOS_URL = "https://pixabay.com/api/videos/"

    _REMAINING_THRESHOLD = 10
    _TIMEOUT = 15

    # Pexels uses landscape/portrait/square; Pixabay uses horizontal/vertical/all.
    _ORIENTATION_MAP = {
        "landscape": "horizontal",
        "portrait": "vertical",
        "square": "all",
        "horizontal": "horizontal",
        "vertical": "vertical",
        "all": "all",
    }

    def __init__(self, api_keys_csv: str) -> None:
        self._keys: List[str] = [k.strip() for k in api_keys_csv.split(",") if k.strip()]
        self._key_index: int = 0
        self._lock = threading.Lock()
        self._key_remaining: Dict[int, int] = {}

    @property
    def is_available(self) -> bool:
        return len(self._keys) > 0

    # ── Key Rotation ────────────────────────────────────────────────────

    def _get_key(self) -> str:
        with self._lock:
            if not self._keys:
                raise RuntimeError("No Pixabay API keys configured")
            remaining = self._key_remaining.get(self._key_index)
            if remaining is not None and remaining < self._REMAINING_THRESHOLD and len(self._keys) > 1:
                self._key_index = (self._key_index + 1) % len(self._keys)
                logger.info(f"[Pixabay] Rotated to key index {self._key_index} (previous key low: {remaining} remaining)")
            return self._keys[self._key_index]

    def _rotate_key(self) -> None:
        with self._lock:
            if len(self._keys) > 1:
                old = self._key_index
                self._key_index = (self._key_index + 1) % len(self._keys)
                logger.info(f"[Pixabay] Force-rotated key {old} → {self._key_index}")

    def _update_remaining(self, key_index: int, response: Any) -> None:
        try:
            remaining_str = response.headers.get("X-RateLimit-Remaining", "")
            if remaining_str:
                self._key_remaining[key_index] = int(remaining_str)
        except (ValueError, AttributeError):
            pass

    # ── HTTP Helper ─────────────────────────────────────────────────────

    def _request(self, url: str, params: Dict[str, Any], max_retries: int = 2) -> Optional[Dict]:
        for attempt in range(max_retries):
            key_index = self._key_index
            api_key = self._get_key()

            full_params = {**params, "key": api_key}
            full_url = f"{url}?{urllib.parse.urlencode(full_params)}"

            req = urllib.request.Request(full_url)
            req.add_header("User-Agent", "Vacademy-AI-Video/1.0")

            try:
                with urllib.request.urlopen(req, timeout=self._TIMEOUT) as response:
                    self._update_remaining(key_index, response)
                    data = json.loads(response.read().decode("utf-8"))
                    return data
            except urllib.error.HTTPError as e:
                record_vendor_failure(url, "search media", error=e)
                if e.code == 429:
                    logger.warning(f"[Pixabay] Rate limited (429) on key {key_index}, rotating...")
                    self._rotate_key()
                    if attempt < max_retries - 1:
                        continue
                    logger.error("[Pixabay] All retries exhausted (429)")
                    return None
                logger.error(f"[Pixabay] HTTP {e.code}: {e.reason}")
                return None
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                record_vendor_failure(url, "search media", error=e)
                logger.error(f"[Pixabay] Network error: {e}")
                return None
            except Exception as e:
                logger.error(f"[Pixabay] Unexpected error: {e}")
                return None

        return None

    # ── Photo Search ────────────────────────────────────────────────────

    def search_photos(
        self,
        query: str,
        orientation: str = "landscape",
        per_page: int = 5,
        must_match_keywords: Optional[List[str]] = None,
    ) -> Optional[Dict[str, str]]:
        """Return a single best-match photo dict or None.

        Shape matches PexelsService.search_photos: {url, photographer,
        photographer_url, alt, pexels_url}. The `pexels_url` key holds the
        Pixabay page URL to keep call sites uniform.

        When `must_match_keywords` is set, only return a photo whose `tags`
        contain at least one keyword (case-insensitive). On no match we
        return None so the caller can cascade to AI gen rather than ship
        an off-context image.
        """
        if not self.is_available:
            return None

        effective_per_page = max(3, min(40 if must_match_keywords else per_page, 200))
        params = {
            "q": query,
            "image_type": "photo",
            "orientation": self._ORIENTATION_MAP.get(orientation, "all"),
            "per_page": effective_per_page,  # Pixabay requires per_page >= 3
            "safesearch": "true",
        }
        data = self._request(self.PHOTOS_URL, params)
        if not data:
            return None

        hits = data.get("hits", [])
        if not hits:
            logger.info(f"[Pixabay] No photo results for: {query[:50]}")
            return None

        if must_match_keywords:
            kws = [k.lower() for k in must_match_keywords if k]
            for h in hits:
                tags_lower = (h.get("tags") or "").lower()
                if any(kw in tags_lower for kw in kws):
                    photo = h
                    break
            else:
                logger.info(
                    f"[Pixabay] No photo matched cultural keywords {kws} "
                    f"in {len(hits)} candidates for: {query[:50]}"
                )
                return None
        else:
            photo = hits[0]
        # largeImageURL (1280w) is reliably available; fullHDURL/imageURL require
        # full API tier and may be absent for free keys.
        url = photo.get("fullHDURL") or photo.get("largeImageURL") or photo.get("webformatURL")
        if not url:
            return None

        return {
            "url": url,
            "photographer": photo.get("user", ""),
            "photographer_url": f"https://pixabay.com/users/{photo.get('user', '')}-{photo.get('user_id', '')}/",
            "alt": photo.get("tags", query),
            "pexels_url": photo.get("pageURL", ""),
        }

    def search_photos_many(
        self,
        query: str,
        orientation: str = "landscape",
        per_page: int = 24,
    ) -> List[Dict[str, Any]]:
        """Return up to `per_page` normalized photo results (editor media
        picker grid). Same item shape as PexelsService.search_photos_many."""
        if not self.is_available:
            return []
        params = {
            "q": query,
            "image_type": "photo",
            "orientation": self._ORIENTATION_MAP.get(orientation, "all"),
            "per_page": max(3, min(per_page, 200)),
            "safesearch": "true",
        }
        data = self._request(self.PHOTOS_URL, params)
        if not data:
            return []
        out: List[Dict[str, Any]] = []
        for h in data.get("hits", []):
            url = h.get("fullHDURL") or h.get("largeImageURL") or h.get("webformatURL")
            if not url:
                continue
            out.append({
                "url": url,
                "thumb": h.get("webformatURL") or h.get("previewURL") or url,
                "photographer": h.get("user", ""),
                "photographer_url": f"https://pixabay.com/users/{h.get('user', '')}-{h.get('user_id', '')}/",
                "alt": h.get("tags", query),
                "source_url": h.get("pageURL", ""),
                "width": h.get("imageWidth"),
                "height": h.get("imageHeight"),
            })
        return out

    # ── Video Search ────────────────────────────────────────────────────

    def search_videos(
        self,
        query: str,
        orientation: str = "landscape",
        per_page: int = 3,
        min_duration: int = 5,
        must_match_keywords: Optional[List[str]] = None,
    ) -> Optional[Dict[str, str]]:
        """When `must_match_keywords` is set, drop hits whose `tags` field
        (Pixabay's comma-separated keyword list, the most reliable signal)
        doesn't mention any keyword. Returns None on no match so the caller
        cascades to the next provider — same pattern as search_photos."""
        if not self.is_available:
            return None

        effective_per_page = max(3, min(40 if must_match_keywords else per_page, 200))
        params = {
            "q": query,
            "video_type": "film",
            "per_page": effective_per_page,
            "safesearch": "true",
        }
        data = self._request(self.VIDEOS_URL, params)
        if not data:
            return None

        hits = data.get("hits", [])
        if not hits:
            logger.info(f"[Pixabay] No video results for: {query[:50]}")
            return None

        target = self._ORIENTATION_MAP.get(orientation, "all")
        kws = [k.lower() for k in (must_match_keywords or []) if k]
        for video in hits:
            duration = video.get("duration", 0)
            if duration < min_duration:
                continue
            if target != "all" and not self._matches_orientation(video, target):
                continue
            if kws:
                # Pixabay's `tags` is a comma-separated keyword list — the
                # most reliable cultural signal. Fall back to pageURL slug
                # which usually encodes subject.
                hay = " ".join(filter(None, [
                    (video.get("tags") or ""),
                    (video.get("pageURL") or ""),
                ])).lower()
                if not any(kw in hay for kw in kws):
                    continue
            file_info = self._pick_video_file(video.get("videos", {}))
            if not file_info:
                continue
            return {
                "url": file_info["url"],
                "image": self._poster_url(video),
                "photographer": video.get("user", ""),
                "photographer_url": f"https://pixabay.com/users/{video.get('user', '')}-{video.get('user_id', '')}/",
                "duration": duration,
                "pexels_url": video.get("pageURL", ""),
            }

        reason = (
            f"no suitable video (min {min_duration}s)"
            if not kws else f"no video matched cultural keywords {kws}"
        )
        logger.info(f"[Pixabay] {reason} in {len(hits)} for: {query[:50]}")
        return None

    def search_video_candidates(
        self,
        query: str,
        orientation: str = "landscape",
        per_page: int = 6,
        min_duration: int = 5,
        must_match_keywords: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """See `search_videos` for `must_match_keywords` semantics."""
        if not self.is_available:
            return []

        effective_per_page = max(3, min(40 if must_match_keywords else per_page, 200))
        params = {
            "q": query,
            "video_type": "film",
            "per_page": effective_per_page,
            "safesearch": "true",
        }
        data = self._request(self.VIDEOS_URL, params)
        if not data:
            return []

        target = self._ORIENTATION_MAP.get(orientation, "all")
        kws = [k.lower() for k in (must_match_keywords or []) if k]
        candidates: List[Dict[str, Any]] = []
        for video in data.get("hits", []):
            duration = video.get("duration", 0)
            if duration < min_duration:
                continue
            if target != "all" and not self._matches_orientation(video, target):
                continue
            if kws:
                hay = " ".join(filter(None, [
                    (video.get("tags") or ""),
                    (video.get("pageURL") or ""),
                ])).lower()
                if not any(kw in hay for kw in kws):
                    continue
            file_info = self._pick_video_file(video.get("videos", {}))
            if not file_info:
                continue
            candidates.append({
                "id": video.get("id"),
                "url": file_info["url"],
                "image": self._poster_url(video),
                "duration": duration,
                "photographer": video.get("user", ""),
                "pexels_url": video.get("pageURL", ""),
                "alt": video.get("tags", "") or f"{file_info.get('width','?')}x{file_info.get('height','?')} clip",
            })
        return candidates

    @staticmethod
    def _pick_video_file(videos_obj: Dict[str, Dict]) -> Optional[Dict]:
        """Pick the best quality video URL. Priority: large > medium > small > tiny."""
        for size in ("large", "medium", "small", "tiny"):
            entry = videos_obj.get(size)
            if entry and entry.get("url"):
                return entry
        return None

    @staticmethod
    def _matches_orientation(video: Dict, target: str) -> bool:
        """Pixabay doesn't filter videos by orientation server-side; infer from dimensions."""
        videos_obj = video.get("videos", {})
        for size in ("large", "medium", "small", "tiny"):
            entry = videos_obj.get(size)
            if not entry:
                continue
            w, h = entry.get("width", 0), entry.get("height", 0)
            if not w or not h:
                continue
            if target == "horizontal":
                return w >= h
            if target == "vertical":
                return h > w
            return True
        return True  # fall through — accept if no dimensions available

    @staticmethod
    def _poster_url(video: Dict) -> str:
        """Pixabay exposes a per-size `thumbnail` field; pick the largest available.
        Returns "" if no thumbnail is present — the <video> tag handles that fine
        (first frame is shown while loading)."""
        videos_obj = video.get("videos", {}) or {}
        for size in ("large", "medium", "small", "tiny"):
            entry = videos_obj.get(size) or {}
            thumb = entry.get("thumbnail") or ""
            if thumb:
                return thumb
        return ""
