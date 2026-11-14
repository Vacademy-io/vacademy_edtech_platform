"""HTML body extraction + base64-image externalization.

Ports media_service HtmlParsingUtils.extractBody + HtmlImageConverter
.convertBase64ToUrls: pull the <body> inner HTML, and replace any inline
`data:image/...;base64,...` <img> sources with uploaded S3 URLs (so the HTML
stored/served carries URLs, not megabytes of base64). Uses BeautifulSoup
(already a dependency) + the shared S3Service.
"""
from __future__ import annotations

import base64
import logging
import re
from typing import Optional

from bs4 import BeautifulSoup

from ..services.s3_service import S3Service

logger = logging.getLogger(__name__)

_DATA_URI_RE = re.compile(r"^data:(image/[\w.+-]+);base64,(.*)$", re.DOTALL)
_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg"}


def extract_body(html: Optional[str]) -> str:
    """Return the inner HTML of <body>, or the input unchanged if no body."""
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    if soup.body is not None:
        return soup.body.decode_contents()
    return html


def convert_base64_to_urls(html: Optional[str]) -> str:
    """Replace inline base64 <img> sources with uploaded S3 URLs. Best-effort:
    an upload failure leaves that image inline."""
    if not html or "data:image" not in html:
        return html or ""
    soup = BeautifulSoup(html, "html.parser")
    s3: Optional[S3Service] = None
    for img in soup.find_all("img"):
        src = img.get("src", "")
        m = _DATA_URI_RE.match(src or "")
        if not m:
            continue
        mime, b64 = m.group(1), m.group(2)
        try:
            data = base64.b64decode(b64)
        except Exception:  # noqa: BLE001
            continue
        try:
            s3 = s3 or S3Service()
            ext = _EXT.get(mime.lower(), "png")
            url = s3.upload_file_content(data, f"ai-doc-image.{ext}", None, mime)
            if url:
                img["src"] = url
        except Exception as exc:  # noqa: BLE001
            logger.warning("base64→S3 upload failed: %s", exc)
    return soup.decode_contents() if soup.body is None else soup.body.decode_contents()


# Figures MathPix crops out of a page are served from its own CDN and purged
# after a while; a question that keeps the vendor URL loses its figure later.
_VENDOR_IMG_RE = re.compile(
    r"""(<img\b[^>]*?\bsrc\s*=\s*)(["'])(https?://cdn\.mathpix\.com/[^"']+)\2""", re.I
)
_MAX_REHOST = 200
_REHOST_BUDGET_SECONDS = 90


def _rehost_one(raw_url: str) -> Optional[str]:
    import httpx

    url = raw_url.replace("&amp;", "&")
    try:
        with httpx.Client(timeout=15.0, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
        mime = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        if not mime.startswith("image/") or not resp.content:
            return None
        ext = _EXT.get(mime, "jpg")
        return S3Service().upload_file_content(resp.content, f"ai-doc-image.{ext}", None, mime) or None
    except Exception as exc:  # noqa: BLE001
        logger.warning("vendor image re-host failed for %s: %s", url[:80], exc)
        return None


def rehost_vendor_images(html: Optional[str]) -> str:
    """Copy every MathPix-hosted <img> to our S3 and point the HTML at the
    copy. Best-effort: an image that fails keeps its original URL."""
    if not html or "cdn.mathpix.com" not in html:
        return html or ""
    urls = list(dict.fromkeys(m.group(3) for m in _VENDOR_IMG_RE.finditer(html)))[:_MAX_REHOST]
    if not urls:
        return html
    from concurrent.futures import ThreadPoolExecutor, wait

    # One overall budget: a slow or hung CDN must not hold the extraction up —
    # whatever is not copied in time keeps its URL.
    pool = ThreadPoolExecutor(max_workers=4)
    futures = {pool.submit(_rehost_one, raw): raw for raw in urls}
    done, _pending = wait(futures, timeout=_REHOST_BUDGET_SECONDS)
    pool.shutdown(wait=False, cancel_futures=True)
    mapping = {}
    for fut in done:
        try:
            new = fut.result()
        except Exception:  # noqa: BLE001
            new = None
        if new:
            mapping[futures[fut]] = new
    if not mapping:
        return html
    return _VENDOR_IMG_RE.sub(
        lambda m: m.group(1) + m.group(2) + mapping.get(m.group(3), m.group(3)) + m.group(2), html
    )
