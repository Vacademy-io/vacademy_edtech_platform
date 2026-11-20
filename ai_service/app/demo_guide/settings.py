"""Demo guide settings: platform settings (super-admin portal, 30 s cache) and constants.

Products live in the platform setting ``demo_guide.products`` (a JSON string):

    {"vacademy": {"catalog_url": "https://demo.vacademy.io/tours/vacademy.json",
                  "knowledge_url": "https://demo.vacademy.io/knowledge/vacademy.md",
                  "audience_id": "<lead list id>", "lead_institute_id": "<institute>",
                  "app_institute_id": "<demo institute>",
                  "stage_origins": ["https://demo.vacademy.io"]}}

Secrets are environment variables only (DEMO_GUIDE_APP_USER,
DEMO_GUIDE_APP_PASSWORD, DEMO_GUIDE_TOKEN_SECRET), never settings.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

USE_CASE = "demo_guide"
TOOL_KEY = "demo_guide_turn"
# Hard fallback when ai_model_defaults has no row: the registry's non-GLM model
# (the same default Site Assistant uses), never a literal here.

LANGS: Tuple[str, ...] = ("en", "hi", "kn", "fr")
LANG_NAMES = {"en": "English", "hi": "Hindi", "kn": "Kannada", "fr": "French"}
LISTEN_LANGS: Tuple[str, ...] = ("en", "hi", "kn")       # French has speech out, no microphone at launch

TEMPERATURE = 0.4
MAX_ANSWER_TOKENS = 320
MAX_TOOL_ROUNDS = 3
MAX_TEXT_CHARS = 1000
MAX_REPLY_WORDS = 90            # hard stop; the prompt asks for 45
HISTORY_MESSAGES = 14
SESSION_TTL_SECONDS = 12 * 3600
TURN_DEADLINE_SECONDS = 60.0
PING_SECONDS = 15.0
MAX_CHOICES = 5
MAX_FORMS_PER_SESSION = 2
CONTACTS_PER_IP_PER_DAY = 3
NARRATIONS_PER_IP_PER_DAY = 600
LISTEN_MAX_SECONDS = 60.0
LISTEN_MAX_BYTES = 3 * 1024 * 1024
FETCH_TTL_SECONDS = 300.0
SPEECH_CACHE_SECONDS = 600.0
APP_SIGN_IN_TTL_SECONDS = 6 * 3600

DEFAULT_CAPS = {
    "sessions_per_ip_per_day": 30,
    "turns_per_session": 60,
    "turns_per_ip_per_day": 200,
    "daily_turns": 3000,
    "speech_chars_per_session": 12000,
    "listen_seconds_per_session": 600,
}

_PRODUCT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
_LOCAL_HOSTS = ("localhost", "127.0.0.1")


def is_production() -> bool:
    """ENVIRONMENT=production. An UNSET variable counts as production, so a
    deployment that forgot to set it never accepts localhost origins."""
    return (os.getenv("ENVIRONMENT") or "production").strip().lower() in ("production", "prod")


def _platform(key: str, default: Any, db=None) -> Any:
    try:
        from ..services.platform_settings_service import get_platform_setting
        value = get_platform_setting(key, default=default, db=db)
        return default if value in (None, "") else value
    except Exception:  # noqa: BLE001 - a settings outage reads as the default (the switch default is OFF)
        return default


def enabled(db=None) -> bool:
    """The kill switch: off by default."""
    v = _platform("demo_guide.enabled", False, db)
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    return bool(v)


def cap(name: str, db=None) -> int:
    default = DEFAULT_CAPS[name]
    try:
        return max(0, int(float(_platform(f"demo_guide.{name}", default, db))))
    except (TypeError, ValueError):
        return default


# ── products ──────────────────────────────────────────────────────────────

def normalize_origin(raw: Any) -> Optional[str]:
    """scheme://host[:port], lower-case, or None. Only http(s) origins."""
    if not isinstance(raw, str) or not raw.strip() or raw.strip() == "null":
        return None
    try:
        parts = urlsplit(raw.strip())
        host, port = parts.hostname, parts.port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not host:
        return None
    default_port = 443 if parts.scheme == "https" else 80
    return f"{parts.scheme}://{host.lower().rstrip('.')}" + (f":{port}" if port and port != default_port else "")


def is_local_origin(origin: Optional[str]) -> bool:
    if not origin:
        return False
    try:
        return urlsplit(origin).hostname in _LOCAL_HOSTS
    except ValueError:
        return False


def _fetch_url(raw: Any) -> Optional[str]:
    """A URL ai_service may fetch: https, or http://localhost outside production."""
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 1000:
        return None
    url = raw.strip()
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme == "https" and parts.hostname:
        return url
    if parts.scheme == "http" and parts.hostname in _LOCAL_HOSTS and not is_production():
        return url
    return None


@dataclass(frozen=True)
class Product:
    key: str
    catalog_url: str
    knowledge_url: Optional[str]
    audience_id: Optional[str]
    lead_institute_id: str
    app_institute_id: Optional[str]
    stage_origins: Tuple[str, ...]

    def origin_allowed(self, origin: Optional[str]) -> bool:
        o = normalize_origin(origin)
        if not o:
            return False
        if o in self.stage_origins:
            return True
        return is_local_origin(o) and not is_production()


def _id(raw: Any) -> Optional[str]:
    return raw.strip() if isinstance(raw, str) and _ID_RE.match(raw.strip()) else None


def parse_products(raw: Any) -> Dict[str, Product]:
    """The ``demo_guide.products`` value → products. A product missing its
    catalogue URL or lead institute is dropped (logged), never half-read."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except ValueError:
            logger.error("demo-guide: demo_guide.products is not valid JSON")
            return {}
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Product] = {}
    for key, cfg in raw.items():
        if not isinstance(key, str) or not _PRODUCT_RE.match(key) or not isinstance(cfg, dict):
            continue
        catalog_url = _fetch_url(cfg.get("catalog_url"))
        lead_institute = _id(cfg.get("lead_institute_id"))
        if not catalog_url or not lead_institute:
            logger.error("demo-guide: product %s needs an https catalog_url and a lead_institute_id", key)
            continue
        origins = tuple(dict.fromkeys(o for o in (normalize_origin(x) for x in (cfg.get("stage_origins") or [])
                                                  if isinstance(cfg.get("stage_origins"), list)) if o))
        out[key] = Product(key=key, catalog_url=catalog_url, knowledge_url=_fetch_url(cfg.get("knowledge_url")),
                           audience_id=_id(cfg.get("audience_id")), lead_institute_id=lead_institute,
                           app_institute_id=_id(cfg.get("app_institute_id")), stage_origins=origins)
    return out


def products(db=None) -> Dict[str, Product]:
    return parse_products(_platform("demo_guide.products", "{}", db))


def product(key: Any, db=None) -> Optional[Product]:
    if not isinstance(key, str):
        return None
    return products(db).get(key.strip().lower())


def clean_lang(raw: Any, default: str = "en") -> str:
    v = str(raw or "").strip().lower().split("-")[0]
    return v if v in LANGS else default
