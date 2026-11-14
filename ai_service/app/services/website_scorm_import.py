"""SCORM packages for website pages (website_edit action ``import_scorm``).

A page's ``scormViewer`` block plays a SCORM package the way a course's SCORM
slide does: through the player wrapper admin-core writes next to the unpacked
package (``POST /admin-core-service/scorm/v1/upload``, the same endpoint the
course editor uses). This module only checks that the bytes are a SCORM zip
before handing them over; admin-core unpacks, repairs and hosts it.
"""
from __future__ import annotations

import base64
import binascii
import io
import logging
import zipfile
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

#: Largest zip fetched from a URL / accepted as base64 (decoded).
MAX_SOURCE_BYTES = 150 * 1024 * 1024
MAX_BASE64_BYTES = 25 * 1024 * 1024
#: Zip-bomb guard before anything is uploaded.
MAX_UNPACKED_BYTES = 600 * 1024 * 1024
MAX_ENTRIES = 5000
UPLOAD_PATH = "/admin-core-service/scorm/v1/upload"
UPLOAD_TIMEOUT_S = 300.0


class ScormImportError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class CheckedPackage:
    data: bytes
    file_name: str
    manifest_at_root: bool
    entries: int
    unpacked_bytes: int


def decode_base64_zip(data: str) -> bytes:
    """A base64 string or data: URL → bytes, capped before decoding."""
    text = (data or "").strip()
    if text.startswith("data:"):
        text = text.split(",", 1)[-1]
    text = "".join(text.split())
    if len(text) * 3 // 4 > MAX_BASE64_BYTES:
        raise ScormImportError("too_large", f"A base64 package can be at most {MAX_BASE64_BYTES // (1024 * 1024)} MB; "
                                            "send a public https link (url) for a bigger zip.")
    try:
        return base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        raise ScormImportError("bad_request", "data_base64 is not valid base64.")


def check_scorm_zip(raw: bytes, file_name: Optional[str]) -> CheckedPackage:
    """Refuse anything that is not a SCORM zip admin-core can launch."""
    if not raw.startswith(b"PK\x03\x04"):
        raise ScormImportError("bad_request", "That file is not a zip. Send the SCORM package (.zip) itself.")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            infos = zf.infolist()
    except zipfile.BadZipFile:
        raise ScormImportError("bad_request", "The zip is damaged and cannot be opened.")
    if len(infos) > MAX_ENTRIES:
        raise ScormImportError("too_large", f"The package has more than {MAX_ENTRIES} files.")
    unpacked = sum(i.file_size for i in infos)
    if unpacked > MAX_UNPACKED_BYTES:
        raise ScormImportError("too_large", f"The package unpacks to more than {MAX_UNPACKED_BYTES // (1024 * 1024)} MB.")
    names = [i.filename for i in infos]
    manifests = [n for n in names if n.rsplit("/", 1)[-1].lower() == "imsmanifest.xml" and "__MACOSX" not in n]
    if not manifests:
        raise ScormImportError(
            "not_scorm",
            "No imsmanifest.xml in this zip, so it is not a SCORM package. If the client sent a zip that holds "
            "another zip (e.g. 'Section2-Preview.zip' inside a folder), import that inner SCORM zip.",
        )
    name = (file_name or "").strip()[:200] or "package.zip"
    if not name.lower().endswith(".zip"):
        name += ".zip"
    return CheckedPackage(raw, name, "imsmanifest.xml" in names, len(infos), unpacked)


async def upload_to_admin_core(package: CheckedPackage, base_url: str, headers: Dict[str, str]) -> Dict[str, Any]:
    """POST the zip to admin-core; returns its ScormSlideDTO (launch_url, scorm_version, …)."""
    try:
        async with httpx.AsyncClient(timeout=UPLOAD_TIMEOUT_S) as client:
            resp = await client.post(
                f"{base_url}{UPLOAD_PATH}",
                files={"file": (package.file_name, package.data, "application/zip")},
                headers=headers,
            )
    except httpx.HTTPError as exc:
        logger.warning("import_scorm: admin-core upload failed: %r", exc)
        raise ScormImportError("upload_failed", "The package could not be sent for unpacking. Try again.")
    if resp.status_code >= 400:
        logger.warning("import_scorm: admin-core returned %s: %s", resp.status_code, resp.text[:300])
        raise ScormImportError("upload_failed", "The package could not be unpacked (it may not be a valid SCORM package).")
    try:
        body = resp.json() or {}
    except ValueError:
        body = {}
    if not body.get("launch_url"):
        raise ScormImportError("upload_failed", "The package was unpacked but has no launch file.")
    return body
