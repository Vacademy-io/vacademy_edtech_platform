"""
Serper API client for Google Image / Video / Web search.

Used by the video pipeline to find real photos and B-roll of named entities
(people, places, events, products) — the kind of subjects where stock libraries
(Pexels/Pixabay) come up empty because the entity is too specific. Examples:

    "Donald Trump 2026 oval office"     → real news photo
    "Strait of Hormuz aerial naval"     → Google image of the actual location
    "Iran flag map"                     → wire-service news image

Synchronous client (pipeline uses ThreadPoolExecutor, not async).
Supports round-robin API key rotation for rate limit management.
Per-run-dir disk cache keeps re-renders free.

Video search filters out platforms whose embeds the renderer can't frame-seek
(YouTube, Vimeo, TikTok, Instagram, Facebook). Only direct-CDN mp4s pass
through. In practice this means Serper Videos is rarely useful for B-roll —
Pexels/Pixabay remain the primary video providers — and its main value is
image search.

Usage:
    svc = SerperService("key1,key2,key3")
    img = svc.search_images("Donald Trump 2026 oval office", orientation="landscape")
    vid = svc.search_videos("Strait of Hormuz tanker")
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


# Hosts whose video URLs are NOT directly playable in the headless renderer.
# The renderer at generate_video.py paused-seeks each <video> element by
# setting currentTime + waiting for "seeked"; iframe-embedded players
# (YouTube IFrame Player, Vimeo Player, TikTok / Instagram / Facebook
# embeds) don't expose that API and frame-seek snaps to keyframes (~1-2s
# granularity), producing stuttering output. Filter them out at fetch time.
_VIDEO_BLOCKLIST_HOSTS = (
    "youtube.com",
    "youtu.be",
    "m.youtube.com",
    "vimeo.com",
    "player.vimeo.com",
    "tiktok.com",
    "vm.tiktok.com",
    "instagram.com",
    "www.instagram.com",
    "facebook.com",
    "www.facebook.com",
    "fb.watch",
)

# Direct CDN mp4 extensions — accept these even if host is unfamiliar.
_VIDEO_DIRECT_EXTS = (".mp4", ".mov", ".webm", ".m4v")


class SerperService:
    """Synchronous Serper API client with round-robin key rotation + disk cache."""

    IMAGES_URL = "https://google.serper.dev/images"
    VIDEOS_URL = "https://google.serper.dev/videos"
    SEARCH_URL = "https://google.serper.dev/search"

    _TIMEOUT = 15

    def __init__(self, api_keys_csv: str, cache_root: Optional[Path] = None) -> None:
        self._keys: List[str] = [k.strip() for k in api_keys_csv.split(",") if k.strip()]
        self._key_index: int = 0
        self._lock = threading.Lock()
        # In-memory LRU-ish cache (just a dict, capped) for the current process.
        self._mem_cache: Dict[str, Dict[str, Any]] = {}
        self._mem_cache_max = 256
        # Optional per-run disk cache. Set via set_run_dir() so re-renders of
        # the same video don't re-bill Serper queries.
        self._cache_dir: Optional[Path] = None
        if cache_root is not None:
            self.set_run_dir(cache_root)
        # Per-render usage counters. Reset by reset_usage() at render start.
        self._image_query_count = 0
        self._video_query_count = 0
        self._web_query_count = 0
        self._cache_hit_count = 0
        # Labels on external_api_call_log rows. Set by set_run_dir / set_run_context.
        self._run_id: Optional[str] = None
        self._institute_id: Optional[str] = None

    @property
    def is_available(self) -> bool:
        """True if at least one API key is configured."""
        return len(self._keys) > 0

    def set_run_dir(self, run_dir: Path) -> None:
        """Configure per-run disk cache directory. Safe to call repeatedly."""
        self._run_id = Path(run_dir).name
        try:
            self._cache_dir = Path(run_dir) / "_serper_cache"
            self._cache_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.warning(f"[Serper] Failed to set cache dir: {e}")
            self._cache_dir = None

    def set_run_context(self, institute_id: Optional[str]) -> None:
        """Institute that later queries are logged against."""
        self._institute_id = institute_id

    def reset_usage(self) -> None:
        """Reset per-render usage counters."""
        self._image_query_count = 0
        self._video_query_count = 0
        self._web_query_count = 0
        self._cache_hit_count = 0

    def get_usage(self) -> Dict[str, int]:
        """Return current per-render usage counters."""
        return {
            "image_queries": self._image_query_count,
            "video_queries": self._video_query_count,
            "web_queries": self._web_query_count,
            "cache_hits": self._cache_hit_count,
        }

    # ── Key Rotation ────────────────────────────────────────────────────

    def _get_key(self) -> str:
        with self._lock:
            if not self._keys:
                raise RuntimeError("No Serper API keys configured")
            return self._keys[self._key_index]

    def _rotate_key(self) -> None:
        with self._lock:
            if len(self._keys) > 1:
                old = self._key_index
                self._key_index = (self._key_index + 1) % len(self._keys)
                logger.info(f"[Serper] Force-rotated key {old} → {self._key_index}")

    # ── Cache ───────────────────────────────────────────────────────────

    def _cache_key(self, endpoint: str, payload: Dict[str, Any]) -> str:
        # Stable JSON serialization for the cache key
        canon = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        h = hashlib.sha256(f"{endpoint}|{canon}".encode("utf-8")).hexdigest()
        return h

    def _cache_get(self, key: str) -> Optional[Dict[str, Any]]:
        # Memory first
        hit = self._mem_cache.get(key)
        if hit is not None:
            self._cache_hit_count += 1
            return hit
        # Disk
        if self._cache_dir is not None:
            path = self._cache_dir / f"{key}.json"
            if path.exists():
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    self._mem_cache[key] = data
                    self._cache_hit_count += 1
                    return data
                except Exception as e:
                    logger.warning(f"[Serper] Cache read failed for {key}: {e}")
        return None

    def _cache_put(self, key: str, data: Dict[str, Any]) -> None:
        # Cap the in-memory cache crudely
        if len(self._mem_cache) >= self._mem_cache_max:
            # drop one arbitrary entry
            try:
                self._mem_cache.pop(next(iter(self._mem_cache)))
            except StopIteration:
                pass
        self._mem_cache[key] = data
        if self._cache_dir is not None:
            try:
                (self._cache_dir / f"{key}.json").write_text(
                    json.dumps(data, ensure_ascii=False), encoding="utf-8"
                )
            except Exception as e:
                logger.warning(f"[Serper] Cache write failed for {key}: {e}")

    # ── Call log ────────────────────────────────────────────────────────

    def _log_call(
        self,
        url: str,
        payload: Dict[str, Any],
        api_key: str,
        started: float,
        http_status: Optional[int] = None,
        data: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
    ) -> None:
        """One external_api_call_log row per real request (cache hits never reach here).
        Never raises: logging must not cost a video its stock images."""
        try:
            # This file is loaded flat via sys.path, like automation_pipeline.py.
            try:
                from app.services.external_api_log import record_external_call
            except ModuleNotFoundError:
                from ai_service.app.services.external_api_log import record_external_call

            summary = None
            credits = 1
            if data is not None:
                summary = {
                    k: len(v) for k, v in data.items() if k in ("images", "videos", "organic") and isinstance(v, list)
                }
                if isinstance(data.get("credits"), (int, float)):
                    credits = data["credits"]
                    summary["credits"] = credits
            record_external_call(
                vendor="serper",
                operation=url.rsplit("/", 1)[-1],
                status="FAILED" if error else "SUCCESS",
                http_status=http_status,
                duration_ms=int((time.monotonic() - started) * 1000),
                api_key=api_key,
                institute_id=self._institute_id,
                run_id=self._run_id,
                request_summary=payload,
                response_summary=summary,
                error_message=error,
                credential="SERPER_API_KEYS",
                credits=credits,
            )
        except Exception as e:
            logger.debug(f"[Serper] Call log skipped: {e}")

    # ── HTTP ────────────────────────────────────────────────────────────

    def _request(self, url: str, payload: Dict[str, Any], max_retries: int = 2) -> Optional[Dict[str, Any]]:
        cache_key = self._cache_key(url, payload)
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        body = json.dumps(payload).encode("utf-8")

        last_error: Optional[str] = None
        for attempt in range(max_retries):
            api_key = self._get_key()
            req = urllib.request.Request(url, data=body, method="POST")
            req.add_header("X-API-KEY", api_key)
            req.add_header("Content-Type", "application/json")
            req.add_header("User-Agent", "Vacademy-AI-Video/1.0")

            started = time.monotonic()
            try:
                with urllib.request.urlopen(req, timeout=self._TIMEOUT) as response:
                    data = json.loads(response.read().decode("utf-8"))
                    self._log_call(url, payload, api_key, started, http_status=response.status, data=data)
                    self._cache_put(cache_key, data)
                    return data
            except urllib.error.HTTPError as e:
                self._log_call(url, payload, api_key, started, http_status=e.code, error=f"HTTP {e.code}: {e.reason}")
                if e.code in (429, 401, 403) and attempt < max_retries - 1:
                    logger.warning(f"[Serper] HTTP {e.code} on key {self._key_index}, rotating...")
                    self._rotate_key()
                    time.sleep(0.4)
                    continue
                last_error = f"HTTP {e.code}: {e.reason}"
                logger.error(f"[Serper] {last_error}")
                return None
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                last_error = f"network: {e}"
                self._log_call(url, payload, api_key, started, error=last_error)
                logger.error(f"[Serper] Network error: {e}")
                if attempt < max_retries - 1:
                    time.sleep(0.4)
                    continue
                return None
            except Exception as e:
                logger.error(f"[Serper] Unexpected error: {e}")
                return None

        logger.error(f"[Serper] All retries exhausted: {last_error}")
        return None

    # ── Image Search ────────────────────────────────────────────────────

    def search_images(
        self,
        query: str,
        gl: str = "us",
        hl: str = "en",
        num: int = 10,
        orientation: Optional[str] = None,
        tbs: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Search Google Images via Serper. Returns up to `num` normalized results.

        Args:
            query: search terms (e.g., "Donald Trump 2026 oval office")
            gl: country code (e.g. "us", "in")
            hl: language code (e.g. "en", "hi")
            num: number of results (1–100)
            orientation: "landscape" | "portrait" | "square" — translated to
                Google's `tbs=ic:specific,isz:m,iar:w` style filter; may not
                always be honored. Pass None to skip.
            tbs: extra Google search filter string (e.g. "qdr:m" for past month).

        Returns: list of {url, source, title, link, position, width, height,
                          thumbnail_url, host}. Empty list on error / no results.
        """
        if not self.is_available:
            return []

        payload: Dict[str, Any] = {"q": query, "gl": gl, "hl": hl, "num": min(max(num, 1), 100)}

        # Translate orientation to Google's `iar` (image aspect ratio) filter.
        # Combined with any caller-supplied tbs.
        iar_map = {"landscape": "w", "portrait": "t", "square": "s"}
        iar = iar_map.get((orientation or "").lower())
        tbs_parts = []
        if iar:
            tbs_parts.append(f"iar:{iar}")
        if tbs:
            tbs_parts.append(tbs)
        if tbs_parts:
            payload["tbs"] = ",".join(tbs_parts)

        self._image_query_count += 1
        data = self._request(self.IMAGES_URL, payload)
        if not data:
            return []

        items = data.get("images") or []
        results: List[Dict[str, Any]] = []
        for it in items:
            url = it.get("imageUrl") or ""
            if not url:
                continue
            link = it.get("link") or ""
            host = ""
            try:
                host = urlparse(link).netloc.lower()
            except Exception:
                pass
            results.append({
                "url": url,
                "source": it.get("source") or "",
                "title": it.get("title") or "",
                "link": link,
                "position": it.get("position"),
                "width": it.get("imageWidth"),
                "height": it.get("imageHeight"),
                "thumbnail_url": it.get("thumbnailUrl") or "",
                "host": host,
            })
        return results

    def best_image(
        self,
        query: str,
        gl: str = "us",
        hl: str = "en",
        orientation: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Convenience: return just the top image result, or None.

        Note: this is the OLD selector — no quality filtering. New call sites
        should prefer `best_quality_image()` below which enforces minimum
        dimensions, aspect-ratio fit, and host-reputation re-ranking. This
        method is kept for the pre-fetch path (named-entity prefetcher) where
        we want speed over quality enforcement.
        """
        results = self.search_images(query, gl=gl, hl=hl, num=10, orientation=orientation)
        return results[0] if results else None

    # ── Quality-filtered image search ───────────────────────────────────

    # Editorial / encyclopedic hosts — strong boost. These are sources where
    # the top result for a named-entity query is usually a clean editorial
    # photograph, not a low-res repost.
    _HOST_TIER1_GLOBAL = (
        "reuters.com", "ap.org", "apnews.com", "bbc.com", "bbc.co.uk",
        "npr.org", "nytimes.com", "theguardian.com", "washingtonpost.com",
        "bloomberg.com", "ft.com", "wsj.com", "time.com", "economist.com",
        "wikipedia.org", "wikimedia.org", "commons.wikimedia.org",
        "nationalgeographic.com", "smithsonianmag.com",
    )
    # Per-region tier-1 hosts. The `gl=` value (ISO alpha-2) is the key.
    _HOST_TIER1_REGIONAL: Dict[str, tuple] = {
        "in": (
            "thehindu.com", "indianexpress.com", "hindustantimes.com",
            "ndtv.com", "livemint.com", "timesofindia.indiatimes.com",
            "pib.gov.in", "mygov.in", "india.gov.in",
        ),
        "us": ("politico.com", "axios.com", "cnbc.com"),
        "gb": ("thetimes.co.uk", "telegraph.co.uk", "independent.co.uk"),
        "jp": ("japantimes.co.jp", "asahi.com", "nhk.or.jp"),
        "ca": ("cbc.ca", "theglobeandmail.com"),
        "au": ("abc.net.au", "smh.com.au"),
    }
    # Tier-2 — decent but not top-tier. Modest boost.
    _HOST_TIER2 = (
        "forbes.com", "businessinsider.com", "theatlantic.com",
        "newyorker.com", "vox.com", "wired.com",
    )
    # Stock-photo domains: Serper often surfaces watermarked thumbnails from
    # these. They're not directly usable for the video frame.
    _HOST_STOCK_DOMAINS = (
        "shutterstock.com", "gettyimages.com", "istockphoto.com",
        "dreamstime.com", "alamy.com", "depositphotos.com", "123rf.com",
        "adobe.com", "stock.adobe.com",
    )
    # Low-quality reposts / unverifiable provenance.
    _HOST_LOW_QUALITY = (
        "pinterest.com", "pinimg.com", "reddit.com", "redd.it", "redditmedia.com",
        "tumblr.com", "imgur.com",
    )
    # Marketplace listings — almost always product-shot icons, not editorial.
    # When a "wooden wall of achievers" query hits an Indian art-products site
    # (exoticindia.com et al.) it ranks #1 by Serper relevance because the site
    # is heavily SEO'd for "indian + <any visual noun>" queries. The image is
    # Indian + portrait + high-res so every hard filter passes — but the
    # subject is a sculpture, not a wall of portraits. Penalty 0.30 plus the
    # subject-relevance multiplier (added below) is what kills these.
    _HOST_MARKETPLACE = (
        # Global generic marketplaces.
        "alibaba.com", "aliexpress.com", "amazon.com", "amazon.in",
        "etsy.com", "ebay.com", "flipkart.com",
        "walmart.com", "target.com", "bestbuy.com", "homedepot.com",
        "wayfair.com", "overstock.com",
        # Indian craft / art / general e-commerce.
        "exoticindia.com", "craftsvilla.com", "jaypore.com", "okhai.org",
        "indiamart.com", "meesho.com", "nykaa.com", "myntra.com",
        # E-commerce platform domains — catches Shopify-style storefronts
        # served on `<store>.myshopify.com` and the platforms' own marketing
        # subdomains.
        "shopify.com", "myshopify.com", "bigcommerce.com", "squarespace.com",
    )

    # Title/URL noise patterns — strong indicators the result is not a usable
    # editorial photograph.
    _TITLE_REJECT_PATTERNS = (
        "icon", "clipart", "vector", "transparent png", "template",
        "logo png", "free download", "stencil",
    )
    _URL_REJECT_PATTERNS = (
        "/thumb_", "/thumbs/", "/thumbnail/", "_thumb.", "_thumb_",
        "/150x", "/100x", "/icon/", "/icons/", "favicon",
    )
    _BAD_EXTENSIONS = (".gif", ".ico")  # .svg handled separately (wiki flags OK)

    # ── Product-listing heuristics (Layer 1b/1c) ─────────────────────────
    # Catches e-commerce hits whose host isn't yet in _HOST_MARKETPLACE.
    # URL path matches the product-detail-page shape that storefronts use.
    # Deliberately did NOT include `/p/` — Medium/Blogger blog posts use
    # it for routing (`/blog/p/article-slug`), and a false positive there
    # demotes editorial content. The remaining patterns are unambiguous
    # storefront paths.
    _URL_PRODUCT_PATTERNS = (
        r"/products?/", r"/dp/", r"/items?/", r"/sku/",
        r"/shop/", r"/store/", r"/catalog/", r"/listing/", r"/buy/",
        r"/pdp/", r"/productimages?/", r"/_pdp_", r"/_main_",
    )
    # SKU-shaped final segments — alpha prefix + digit body + extension. Used
    # by exoticindia (`dds257.webp`), craftsvilla (`prod-12345.jpg`), etc.
    _URL_SKU_RE = re.compile(
        r"/[a-z]{2,5}[-_]?\d{3,8}\.(?:jpg|jpeg|png|webp)(?:$|\?)",
        re.IGNORECASE,
    )
    _URL_PRODUCT_RE = re.compile("|".join(_URL_PRODUCT_PATTERNS), re.IGNORECASE)

    # Title shape — commerce vocabulary. One match is enough.
    _PRODUCT_TITLE_RE = re.compile(
        r"(?:"
        r"[₹$€£¥]"
        r"|\bRs\.?\s*\d"
        r"|\bINR\s*\d"
        r"|\bUSD\s*\d"
        r"|\bprice\b"
        r"|\bbuy\s+(?:now|online|at)\b"
        r"|\bshop\s+(?:now|online)\b"
        r"|\border\s+(?:now|online)\b"
        r"|\badd\s+to\s+(?:cart|bag)\b"
        r"|\bon\s+sale\b"
        r"|\bdiscount\b"
        r"|\bclearance\b"
        r"|\bfree\s+shipping\b"
        r"|\b(?:in|out\s+of)\s+stock\b"
        r"|\bbest\s+price\b"
        r"|\blowest\s+price\b"
        r"|\bwholesale\b"
        r"|\bbulk\s+price\b"
        r"|\bflat\s+\d{1,2}\s*%?\s*off\b"
        r"|\b\d{1,2}\s*%\s*off\b"
        r")",
        re.IGNORECASE,
    )

    # Layer 3 — minimum acceptable score before returning a Serper hit. Below
    # this threshold the caller cascades to AI generation rather than ship a
    # best-of-bad-results image. Tune in one place.
    _MIN_QUALITY_SCORE = 0.55

    # Crawler / proxy / SEO-preview hosts that 403 or return junk for
    # programmatic fetches. Serper Images sometimes ranks these high because
    # the social platform aggressively SEO-publishes them, but the URL only
    # serves a real image to a logged-in browser session matching the
    # original UA + referer. Headless Playwright (and any HEAD probe) gets
    # a 403 or a blank/expired response. Result: silent broken-image icon.
    # Reject at fetch time so they never make it to the candidate list.
    _IMG_BLOCKLIST_HOSTS = (
        "lookaside.instagram.com",
        "lookaside.fbsbx.com",
        "lookaside.facebook.com",
        "external.fbsbx.com",
        "external-iad3-1.xx.fbcdn.net",
        "scontent.cdninstagram.com",
        "scontent.xx.fbcdn.net",
        "scontent.fbsbx.com",
        "graph.facebook.com",
        "fbcdn.net",
        "cdninstagram.com",
    )
    # URL substrings that signal a crawler/proxy/cache URL even when the
    # host isn't fully blocklisted. Matches the `/seo/google_widget/crawler/`
    # endpoints Meta serves, plus the generic `/lookaside/crawler/` path.
    _IMG_BLOCKLIST_URL_PATTERNS = (
        "/seo/google_widget/crawler",
        "/lookaside/crawler",
        "/crawler/media",
        "facebook.com/login",
        "instagram.com/accounts/login",
    )

    @staticmethod
    def _is_govt_or_edu_host(host: str) -> bool:
        """True for `.gov.*` / `.ac.*` / `.edu` ccTLD-style hosts. Quality boost."""
        return (
            host.endswith(".gov") or ".gov." in host
            or host.endswith(".edu") or ".edu." in host
            or ".ac." in host or host.endswith(".ac.in") or host.endswith(".ac.uk")
        )

    def _host_score_multiplier(self, host: str, region_gl: str) -> float:
        """Reputation multiplier for ranking. 1.0 = neutral."""
        if not host:
            return 0.85  # missing host metadata is suspicious
        # Strip leading "www." for matching.
        host_match = host[4:] if host.startswith("www.") else host
        # Exact-match against tier-1 global.
        if any(host_match == h or host_match.endswith("." + h) for h in self._HOST_TIER1_GLOBAL):
            return 1.30
        # Regional tier-1 when geo matches.
        for region_hosts in (self._HOST_TIER1_REGIONAL.get(region_gl) or ()):
            if host_match == region_hosts or host_match.endswith("." + region_hosts):
                return 1.25
        # Government / education TLDs always boost.
        if self._is_govt_or_edu_host(host_match):
            return 1.20
        if any(host_match == h or host_match.endswith("." + h) for h in self._HOST_TIER2):
            return 1.10
        if any(host_match == h or host_match.endswith("." + h) for h in self._HOST_STOCK_DOMAINS):
            return 0.85
        if any(host_match == h or host_match.endswith("." + h) for h in self._HOST_LOW_QUALITY):
            return 0.50
        if any(host_match == h or host_match.endswith("." + h) for h in self._HOST_MARKETPLACE):
            return 0.30
        return 1.0

    @staticmethod
    def _passes_hard_filter(
        result: Dict[str, Any],
        canvas_w: int,
        canvas_h: int,
    ) -> tuple:
        """Return (passes, reason_if_not). Pure function — no I/O.

        Hard rejects on dimensions, aspect ratio, format, and title/URL noise.
        Results that pass are then re-ranked by `_host_score_multiplier`.
        """
        url = (result.get("url") or "").strip()
        if not url:
            return (False, "empty url")
        url_lower = url.lower().split("?")[0]
        # Host blocklist — crawler / SEO-preview / proxy hosts that serve
        # broken or auth-required content to non-browser clients. Shot-8/9
        # whiteouts in the Chanakya run were `lookaside.instagram.com` and
        # `lookaside.fbsbx.com` URLs that 403 in Playwright.
        host = (result.get("host") or "").lower()
        host_match = host[4:] if host.startswith("www.") else host
        for blocked in SerperService._IMG_BLOCKLIST_HOSTS:
            if host_match == blocked or host_match.endswith("." + blocked):
                return (False, f"blocklisted host: {host_match}")
        # URL substring blocklist — same rationale, catches the crawler
        # endpoint even when the host isn't fully blocked.
        url_full_lower = url.lower()
        for pat in SerperService._IMG_BLOCKLIST_URL_PATTERNS:
            if pat in url_full_lower:
                return (False, f"blocklisted url pattern: {pat}")
        # Format / extension.
        if any(url_lower.endswith(ext) for ext in SerperService._BAD_EXTENSIONS):
            return (False, "bad extension")
        # URL noise patterns.
        for pat in SerperService._URL_REJECT_PATTERNS:
            if pat in url_lower:
                return (False, f"url pattern: {pat}")
        # Title noise patterns.
        title_lower = (result.get("title") or "").lower()
        for pat in SerperService._TITLE_REJECT_PATTERNS:
            if pat in title_lower:
                return (False, f"title pattern: {pat}")
        # Dimension cutoffs.
        w = result.get("width") or 0
        h = result.get("height") or 0
        try:
            w = int(w); h = int(h)
        except (TypeError, ValueError):
            w = h = 0
        if w == 0 or h == 0:
            # No dimensions reported. Don't hard-reject — Serper sometimes omits
            # these for legitimate sources. The position-based scoring still
            # ranks them, just without the dimension boost.
            return (True, None)
        canvas_long = max(canvas_w, canvas_h)
        canvas_short = min(canvas_w, canvas_h)
        img_long = max(w, h)
        img_short = min(w, h)
        if img_long < canvas_long:
            return (False, f"long-side {img_long}px < canvas long {canvas_long}px")
        if img_short < int(canvas_short * 0.6):
            return (False, f"short-side {img_short}px < 0.6× canvas short")
        # Aspect ratio fit.
        canvas_is_portrait = canvas_h > canvas_w
        img_is_portrait = h > w
        if canvas_is_portrait != img_is_portrait:
            return (False, "orientation mismatch")
        img_ar = w / h if h else 1.0
        if canvas_is_portrait:
            # Portrait canvas — accept narrow-ish images.
            if not (0.42 <= img_ar <= 0.85):
                return (False, f"portrait AR {img_ar:.2f} outside [0.42, 0.85]")
        else:
            # Landscape canvas — accept wide-ish images.
            if not (1.2 <= img_ar <= 2.4):
                return (False, f"landscape AR {img_ar:.2f} outside [1.2, 2.4]")
        return (True, None)

    @staticmethod
    def _ar_fit_score(canvas_w: int, canvas_h: int, w: int, h: int) -> float:
        """Score 1.0 = perfect AR match, taper toward 0.5 as the image deviates."""
        if not (w and h and canvas_w and canvas_h):
            return 0.85
        target = canvas_w / canvas_h
        actual = w / h
        # Use the ratio of the smaller/larger so we get a value in (0, 1].
        ratio = min(target, actual) / max(target, actual)
        # ratio=1.0 → score 1.0; ratio=0.6 → score ~0.7.
        return 0.5 + 0.5 * ratio

    # ── Layer 1: product-listing detection ─────────────────────────────────
    @classmethod
    def _url_looks_like_product(cls, url: str) -> bool:
        """URL-path heuristic for e-commerce product pages.

        Returns True when the path contains common storefront segments
        (`/products/`, `/p/`, `/dp/`, etc.) OR a SKU-shaped final segment
        like `dds257.webp`. Catches new offenders without manual curation.
        """
        if not url or not isinstance(url, str):
            return False
        url_path = url.split("?", 1)[0]
        if cls._URL_PRODUCT_RE.search(url_path):
            return True
        if cls._URL_SKU_RE.search(url_path):
            return True
        return False

    @classmethod
    def _title_looks_like_product(cls, title: str) -> bool:
        """Title heuristic for product listings — currency / commerce verbs.

        Returns True when the title carries shopping-page vocabulary. False
        for editorial titles like "Indian Parliament Building New Delhi"
        which contain no commerce markers.
        """
        if not title:
            return False
        return cls._PRODUCT_TITLE_RE.search(title) is not None

    @classmethod
    def _product_listing_penalty(
        cls,
        host: str,
        url: str,
        title: str,
    ) -> Tuple[float, str]:
        """Combine curated + URL + title signals into a single multiplier.

        Returns (multiplier, reason). Multiplier:
          0.30  — host in curated _HOST_MARKETPLACE (handled upstream by
                  _host_score_multiplier; we return 1.0 here so we don't
                  double-penalize curated hosts).
          0.20  — both URL and title heuristics fire (very confident).
          0.50  — only one signal (could be false positive).
          1.00  — neither (no penalty).
        """
        host_match = host[4:] if host.startswith("www.") else host
        # Curated hits: already penalized by _host_score_multiplier. Return
        # 1.0 here so the score isn't multiplied twice.
        for h in cls._HOST_MARKETPLACE:
            if host_match == h or host_match.endswith("." + h):
                return (1.0, "curated-host")
        url_match = cls._url_looks_like_product(url)
        title_match = cls._title_looks_like_product(title)
        if url_match and title_match:
            return (0.20, "url+title heuristic")
        if url_match:
            return (0.50, "url heuristic")
        if title_match:
            return (0.50, "title heuristic")
        return (1.0, "")

    # ── Layer 2: subject-relevance scoring ─────────────────────────────────
    @staticmethod
    def _subject_relevance_multiplier(
        title: str,
        source: str,
        subject_keywords: Optional[List[str]],
    ) -> Tuple[float, int]:
        """Score result subject vs the query's content words.

        Returns (multiplier, match_count).

        Scoring uses COVERAGE FRACTION (matches/total) rather than a raw
        match count so the same logic works for a 5-keyword shot task AND
        a 1-keyword prefetched-entity reference:
          - coverage == 0         → 0.35  (likely off-subject — kills score)
          - 0 < coverage < 0.4    → 0.65  (one weak signal)
          - coverage >= 0.4       → 1.00  (subject-on)

        Why the 0.4 step: a typical shot task derives 4-6 subject keywords
        (e.g. "wooden wall framed portraits achievers"). The editorial
        target title often only echoes 2-3 of those (titles are concise).
        2/5 ≈ 0.4 → must count as "on-subject" or we'd cascade good
        editorial hits to AI gen. Single-keyword cases (prefetcher) jump
        to 1.0 at 1/1.

        Subject keywords come from the caller (derived from the LLM's
        `img_query`/`img_prompt` minus stopwords + region words; or from
        the entity name for prefetched references). The host `source`
        field is included alongside title because Serper sometimes leaves
        the title empty but populates `source` with the page title.

        Returns 1.0 with match_count=-1 when subject_keywords is empty or
        None (no relevance check requested — back-compat).
        """
        if not subject_keywords:
            return (1.0, -1)
        haystack = ((title or "") + " " + (source or "")).lower()
        matches = 0
        total = 0
        for kw in subject_keywords:
            if not kw:
                continue
            total += 1
            # Word-boundary match. Substring would over-match — "art" inside
            # "particular" is not a real hit.
            if re.search(r"\b" + re.escape(kw.lower()) + r"\b", haystack):
                matches += 1
        if total == 0:
            return (1.0, -1)
        coverage = matches / total
        if coverage == 0:
            return (0.35, 0)
        if coverage >= 0.4:
            return (1.00, matches)
        return (0.65, matches)

    def best_quality_image(
        self,
        query: str,
        canvas_w: int,
        canvas_h: int,
        *,
        gl: str = "us",
        hl: str = "en",
        num: int = 15,
        subject_keywords: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Run Serper image search + apply quality filter + re-rank.

        Args:
            query: search terms.
            canvas_w, canvas_h: target output dimensions. Hard-reject any
                result whose long-side is smaller than the canvas long-side
                or whose orientation / aspect ratio doesn't match.
            gl, hl: Google geo / language bias. Pass `gl=` from the run's
                `CulturalContext.gl` for region-appropriate indexing.
            num: how many Serper results to fetch before filtering. 15 is a
                good default — gives the filter room to reject 10+ low-quality
                hits and still return one.
            subject_keywords: optional content words from the LLM's prompt
                (region words pre-stripped). When supplied, results whose
                title/source don't mention at least 2 of these get a 0.35
                multiplier — catches SEO-trap hits where the image is
                culturally on-target but subject-off-target (e.g. an
                exoticindia.com sculpture ranking #1 for "wooden wall of
                achievers framed portraits" because the host SEO-ranks for
                "indian + anything"). None / empty = no subject check
                (back-compat).

        Returns:
            A single result dict (same shape as `best_image`) annotated with
            a `_quality_score` field, or None if every candidate was rejected
            OR if the best score falls below `_MIN_QUALITY_SCORE`. Caller
            treats None as "fall through to AI generation".
        """
        if not self.is_available:
            return None

        canvas_is_portrait = canvas_h > canvas_w
        orientation = "portrait" if canvas_is_portrait else "landscape"

        results = self.search_images(query, gl=gl, hl=hl, num=num, orientation=orientation)
        if not results:
            return None

        # Pass 1 — hard filter. Track rejection reasons for diagnostics.
        survivors: List[Dict[str, Any]] = []
        rejects = 0
        first_reason = ""
        for r in results:
            passes, reason = self._passes_hard_filter(r, canvas_w, canvas_h)
            if passes:
                survivors.append(r)
            else:
                rejects += 1
                if not first_reason and reason:
                    first_reason = reason

        if not survivors:
            logger.info(
                f"[Serper] best_quality_image: all {rejects} results rejected for '{query[:60]}' "
                f"(first reason: {first_reason})"
            )
            return None

        # Pass 2 — score + pick the highest.
        best_score = -1.0
        best: Optional[Dict[str, Any]] = None
        best_breakdown: Dict[str, Any] = {}
        for idx, r in enumerate(survivors):
            host = r.get("host") or ""
            url = r.get("url") or ""
            title = r.get("title") or ""
            source = r.get("source") or ""
            host_mul = self._host_score_multiplier(host, gl)
            # Position score — earlier results in the survivor list get a
            # small boost (they were also earlier in the raw Serper results).
            pos_score = max(0.4, 1.0 - 0.05 * idx)
            w = int(r.get("width") or 0)
            h = int(r.get("height") or 0)
            dim_score = 1.0
            if w and h:
                canvas_long = max(canvas_w, canvas_h)
                img_long = max(w, h)
                # >= canvas target → 1.0; smaller → linearly less (but already
                # hard-filtered to be at least canvas-long anyway).
                dim_score = min(1.0, img_long / canvas_long)
            ar_score = self._ar_fit_score(canvas_w, canvas_h, w, h)
            # Layer 1 — product-listing heuristic (URL/title shape).
            product_mul, product_reason = self._product_listing_penalty(host, url, title)
            # Layer 2 — subject relevance vs caller-supplied keywords.
            subj_mul, subj_matches = self._subject_relevance_multiplier(
                title, source, subject_keywords
            )
            score = pos_score * host_mul * dim_score * ar_score * product_mul * subj_mul
            # Telemetry — log every penalized hit so we can grow the curated
            # marketplace list from real traffic. Only logs when one of the
            # new multipliers actually penalized (else noise).
            if product_mul < 1.0 or subj_mul < 1.0:
                print(
                    f"   [serper-penalty] host={host} score={round(score,3)} "
                    f"product={product_mul}({product_reason}) "
                    f"subject={subj_mul}(matches={subj_matches}) "
                    f"title='{title[:60]}' url={url[:80]}"
                )
            if score > best_score:
                best_score = score
                best = r
                best_breakdown = {
                    "pos": round(pos_score, 3),
                    "host": round(host_mul, 3),
                    "dim": round(dim_score, 3),
                    "ar":  round(ar_score, 3),
                    "product": round(product_mul, 3),
                    "subject": round(subj_mul, 3),
                    "subject_matches": subj_matches,
                }

        if best is None:
            return None

        # Layer 3 — minimum quality threshold. Below this we cascade to AI
        # gen rather than ship a best-of-bad-results image.
        if best_score < self._MIN_QUALITY_SCORE:
            print(
                f"   [serper-low-quality] best_score={round(best_score,3)} "
                f"< threshold={self._MIN_QUALITY_SCORE} for "
                f"'{query[:60]}' → cascading to AI gen "
                f"(breakdown={best_breakdown})"
            )
            return None

        # Annotate the chosen result with diagnostics so callers can log it.
        out = dict(best)
        out["_quality_score"] = round(best_score, 4)
        out["_filter_rejects"] = rejects
        out["_score_breakdown"] = best_breakdown
        return out

    # ── Video Search ────────────────────────────────────────────────────

    def search_videos(
        self,
        query: str,
        gl: str = "us",
        hl: str = "en",
        num: int = 10,
        tbs: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Search Google Videos via Serper. Filters out non-frame-seekable platforms.

        See _VIDEO_BLOCKLIST_HOSTS — YouTube, Vimeo, TikTok, Instagram,
        Facebook results are dropped because the renderer's paused-seek path
        can't drive their iframe players. Only results with a direct CDN mp4
        URL (mp4/mov/webm/m4v extension on `videoUrl`) survive.

        Returns: list of {url, source, title, link, duration, position,
                          thumbnail_url, host, channel}. Empty list on error.
        """
        if not self.is_available:
            return []

        payload: Dict[str, Any] = {"q": query, "gl": gl, "hl": hl, "num": min(max(num, 1), 100)}
        if tbs:
            payload["tbs"] = tbs

        self._video_query_count += 1
        data = self._request(self.VIDEOS_URL, payload)
        if not data:
            return []

        items = data.get("videos") or []
        results: List[Dict[str, Any]] = []
        for it in items:
            link = it.get("link") or ""
            host = ""
            try:
                host = urlparse(link).netloc.lower()
            except Exception:
                pass
            # Strip the embedding-blocked hosts.
            if any(host == b or host.endswith("." + b) for b in _VIDEO_BLOCKLIST_HOSTS):
                continue
            # Prefer a direct mp4 url if Serper returns one, else fall through
            # to `link` and let the caller decide. We accept only direct CDN
            # extensions on the playable URL.
            video_url = it.get("videoUrl") or it.get("link") or ""
            if not video_url:
                continue
            url_lower = video_url.lower().split("?")[0]
            if not url_lower.endswith(_VIDEO_DIRECT_EXTS):
                # Non-direct (most Google Videos results are page links to
                # publisher sites, not raw mp4s). Skip — caller falls back to
                # Pexels/Pixabay.
                continue
            results.append({
                "url": video_url,
                "source": it.get("source") or "",
                "title": it.get("title") or "",
                "link": link,
                "duration": it.get("duration") or "",
                "position": it.get("position"),
                "thumbnail_url": it.get("imageUrl") or "",
                "host": host,
                "channel": it.get("channel") or "",
            })
        return results

    def best_video(
        self,
        query: str,
        gl: str = "us",
        hl: str = "en",
    ) -> Optional[Dict[str, Any]]:
        """Convenience: return just the top playable video result, or None."""
        results = self.search_videos(query, gl=gl, hl=hl, num=10)
        return results[0] if results else None

    # ── Web Search ──────────────────────────────────────────────────────

    def search_web(self, query: str, gl: str = "us", hl: str = "en", num: int = 10) -> Dict[str, Any]:
        """Plain Google Web search. Returns {organic, knowledge_graph, ...}.

        Lower-priority than the Perplexity-backed web_search_service.py for
        synthesis; useful when the pipeline wants raw URLs/titles rather than
        a synthesized answer.
        """
        if not self.is_available:
            return {}
        payload = {"q": query, "gl": gl, "hl": hl, "num": min(max(num, 1), 100)}
        self._web_query_count += 1
        data = self._request(self.SEARCH_URL, payload)
        return data or {}


__all__ = ["SerperService"]
