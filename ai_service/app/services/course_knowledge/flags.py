"""Platform switches for course knowledge (ai_platform_settings, 30 s cache).

Thin readers over get_platform_setting that never raise: a settings outage
reads as the safe default (off / empty / the declared default number), so a
DB blip can switch the feature off but never on.
"""
from __future__ import annotations

import json
import logging
from typing import Any, FrozenSet, Union

logger = logging.getLogger(__name__)

ALL_INSTITUTES = "*"

RETRIEVAL_MODES = ("off", "shadow", "on")
DRIP_MODES = ("time_exact", "mirror")
SCORM_OCR_ENGINES = ("mathpix", "vision")

DEFAULT_MAX_MONTHLY_AUTO_CAP = 5000
DEFAULT_MAX_CHUNKS_PER_INSTITUTE = 200000
DEFAULT_WORKER_BATCH = 4


def _platform(key: str, default: Any) -> Any:
    try:
        from ..platform_settings_service import get_platform_setting
        value = get_platform_setting(key, default=default)
        return default if value in (None, "") else value
    except Exception:  # noqa: BLE001 - a settings outage must read as "off"
        return default


def _bool(key: str) -> bool:
    v = _platform(key, False)
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    return bool(v)


def _int(key: str, default: int, lo: int, hi: int) -> int:
    try:
        n = int(float(_platform(key, default)))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _enum(key: str, options: tuple, default: str) -> str:
    v = str(_platform(key, default) or "").strip().lower()
    return v if v in options else default


def parse_allowlist(raw: Any) -> Union[FrozenSet[str], str]:
    """The institute allowlist: ALL_INSTITUTES for ``["*"]``, else a set of ids.
    Bad JSON, a non-list or blank entries are ignored (an empty set = nobody)."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else []
        except (ValueError, TypeError):
            logger.warning("course_knowledge.institutes is not valid JSON; treating it as empty")
            return frozenset()
    if not isinstance(raw, (list, tuple, set, frozenset)):
        return frozenset()
    ids = {str(x).strip() for x in raw if isinstance(x, (str, int)) and str(x).strip()}
    if ALL_INSTITUTES in ids:
        return ALL_INSTITUTES
    return frozenset(ids)


def platform_enabled() -> bool:
    return _bool("course_knowledge.enabled")


def allowed_institutes() -> Union[FrozenSet[str], str]:
    return parse_allowlist(_platform("course_knowledge.institutes", "[]"))


def institute_allowed(institute_id: str | None) -> bool:
    if not institute_id:
        return False
    allowed = allowed_institutes()
    return allowed == ALL_INSTITUTES or institute_id in allowed


def available(institute_id: str | None) -> bool:
    """The platform switch is on AND the institute is on the allowlist."""
    return platform_enabled() and institute_allowed(institute_id)


def retrieval_mode() -> str:
    return _enum("course_knowledge.retrieval_mode", RETRIEVAL_MODES, "off")


def paid_enabled() -> bool:
    return _bool("course_knowledge.paid_enabled")


def links_enabled() -> bool:
    return _bool("course_knowledge.links_enabled")


def drip_mode() -> str:
    return _enum("course_knowledge.drip_mode", DRIP_MODES, "time_exact")


def scorm_ocr_engine() -> str:
    """Who reads SCORM slides drawn as images: MathPix OCR or a vision model."""
    return _enum("course_knowledge.scorm_ocr_engine", SCORM_OCR_ENGINES, "mathpix")


def max_monthly_auto_cap() -> int:
    return _int("course_knowledge.max_monthly_auto_cap", DEFAULT_MAX_MONTHLY_AUTO_CAP, 0, 1000000)


def max_chunks_per_institute() -> int:
    return _int("course_knowledge.max_chunks_per_institute", DEFAULT_MAX_CHUNKS_PER_INSTITUTE, 1000, 5000000)


def worker_batch() -> int:
    return _int("course_knowledge.worker_batch", DEFAULT_WORKER_BATCH, 1, 16)


__all__ = [
    "ALL_INSTITUTES", "RETRIEVAL_MODES", "DRIP_MODES", "SCORM_OCR_ENGINES", "parse_allowlist",
    "platform_enabled", "allowed_institutes", "institute_allowed", "available",
    "retrieval_mode", "paid_enabled", "links_enabled", "drip_mode", "scorm_ocr_engine",
    "max_monthly_auto_cap", "max_chunks_per_institute", "worker_batch",
]
