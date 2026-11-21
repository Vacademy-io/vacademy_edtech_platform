"""Per-site Site Assistant settings and the platform-wide switches.

Per site: ``globalSettings.siteAssistant`` in the PUBLISHED catalogue JSON
(SPEC §1). Everything there is public by nature (the site serves it), so no
secret ever lives in it. Missing keys take the defaults below.

Platform: the kill switch and per-visitor / per-IP caps are platform settings
(super-admin portal, ``site_assistant.*``), read through
platform_settings_service like every other switch.
"""
from __future__ import annotations

import copy
import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

USE_CASE = "site_assistant"
TOOL_KEY = "site_assistant_answer"
# Fast, non-reasoning default when ai_model_defaults has no row for the use case:
# the registry's one non-GLM model (constants.model_defaults), never a literal here.
from ..constants.model_defaults import NON_GLM_FALLBACK as DEFAULT_MODEL  # noqa: E402
TEMPERATURE = 0.3
MAX_ANSWER_TOKENS = 450
MAX_TOOL_ROUNDS = 4
MAX_TEXT_CHARS = 1000
HISTORY_MESSAGES = 8
SESSION_TTL_SECONDS = 12 * 3600
VISITOR_DAILY_ANSWERS = 40
IP_DAILY_ANSWERS = 80
IP_DAILY_SESSIONS = 300          # new chats (POST /sessions) per visitor network per day
SITE_DAILY_ANSWERS = 300
MESSAGES_PER_MINUTE = 6
MAX_CARDS_PER_ANSWER = 3

PERSONAS = ("warm", "formal", "friendly", "concise")
PLACEMENT_MODES = ("all", "catalogue_and_courses", "routes")
POSITIONS = ("bottom-right", "bottom-left")

DEFAULTS: Dict[str, Any] = {
    "enabled": False,
    "name": None,
    "avatarUrl": None,
    "greeting": "Hi! I can help you find a course, check prices or join a live class.",
    "persona": "warm",
    "suggestions": [],
    "placement": {"mode": "all", "routes": []},
    "position": "bottom-right",
    "accentColor": None,
    "knowledge": {"pages": True, "courses": True, "faqs": True, "notices": True,
                  "liveClasses": True, "linkedKbIds": []},
    "leads": {"campaignId": None, "streamCampaigns": {}, "consentText": None},
    "support": {"email": None, "phone": None, "whatsapp": None, "loginUrl": None},
    "limits": {"dailyAnswers": SITE_DAILY_ANSWERS},
    "embed": {"enabled": False},
}

_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{3,8}$")


def _merge(base: Dict[str, Any], over: Any) -> Dict[str, Any]:
    out = copy.deepcopy(base)
    if not isinstance(over, dict):
        return out
    for k, v in over.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _merge(out[k], v)
        elif v is not None or k not in out:
            out[k] = v
    return out


def _str(v: Any, cap: int) -> Optional[str]:
    if not isinstance(v, str):
        return None
    s = " ".join(v.split())
    return s[:cap] if s else None


def _bool(v: Any, default: bool) -> bool:
    return v if isinstance(v, bool) else default


def normalize(raw: Any) -> Dict[str, Any]:
    """``globalSettings.siteAssistant`` with defaults filled and types forced."""
    s = _merge(DEFAULTS, raw)
    s["enabled"] = _bool(s.get("enabled"), False)
    s["name"] = _str(s.get("name"), 80)
    s["avatarUrl"] = s["avatarUrl"] if isinstance(s.get("avatarUrl"), str) and s["avatarUrl"].startswith("https://") else None
    s["greeting"] = _str(s.get("greeting"), 300) or DEFAULTS["greeting"]
    s["persona"] = s.get("persona") if s.get("persona") in PERSONAS else "warm"
    s["suggestions"] = [x for x in (_str(v, 80) for v in (s.get("suggestions") or [])
                                    if isinstance(s.get("suggestions"), list)) if x][:6]
    placement = s.get("placement") if isinstance(s.get("placement"), dict) else {}
    s["placement"] = {
        "mode": placement.get("mode") if placement.get("mode") in PLACEMENT_MODES else "all",
        "routes": [r for r in (placement.get("routes") or []) if isinstance(r, str)][:50]
        if isinstance(placement.get("routes"), list) else [],
    }
    s["position"] = s.get("position") if s.get("position") in POSITIONS else "bottom-right"
    color = s.get("accentColor")
    s["accentColor"] = color if isinstance(color, str) and _HEX_COLOR.match(color) else None
    k = s.get("knowledge") if isinstance(s.get("knowledge"), dict) else {}
    s["knowledge"] = {
        "pages": _bool(k.get("pages"), True),
        "courses": _bool(k.get("courses"), True),
        "faqs": _bool(k.get("faqs"), True),
        "notices": _bool(k.get("notices"), True),
        "liveClasses": _bool(k.get("liveClasses"), True),
        "linkedKbIds": [str(x) for x in (k.get("linkedKbIds") or []) if isinstance(x, (str, int))][:10]
        if isinstance(k.get("linkedKbIds"), list) else [],
    }
    leads = s.get("leads") if isinstance(s.get("leads"), dict) else {}
    stream_campaigns = leads.get("streamCampaigns") if isinstance(leads.get("streamCampaigns"), dict) else {}
    s["leads"] = {
        "campaignId": _str(leads.get("campaignId"), 64),
        "streamCampaigns": {str(a)[:120]: str(b)[:64] for a, b in stream_campaigns.items() if isinstance(b, str) and b},
        "consentText": _str(leads.get("consentText"), 500),
    }
    sup = s.get("support") if isinstance(s.get("support"), dict) else {}
    login = _str(sup.get("loginUrl"), 500)
    if login and not (login.startswith("https://") or (login.startswith("/") and not login.startswith("//"))):
        login = None
    s["support"] = {"email": _str(sup.get("email"), 200), "phone": _str(sup.get("phone"), 40),
                    "whatsapp": _str(sup.get("whatsapp"), 40), "loginUrl": login}
    limits = s.get("limits") if isinstance(s.get("limits"), dict) else {}
    try:
        daily = int(limits.get("dailyAnswers"))
    except (TypeError, ValueError):
        daily = SITE_DAILY_ANSWERS
    s["limits"] = {"dailyAnswers": max(0, min(daily, 100_000))}
    embed = s.get("embed") if isinstance(s.get("embed"), dict) else {}
    s["embed"] = {"enabled": _bool(embed.get("enabled"), False)}
    return s


def from_catalogue(catalogue: Any) -> Dict[str, Any]:
    gs = (catalogue or {}).get("globalSettings") if isinstance(catalogue, dict) else None
    raw = gs.get("siteAssistant") if isinstance(gs, dict) else None
    return normalize(raw)


def public_view(s: Dict[str, Any], *, site_name: Optional[str], logo_url: Optional[str],
                popular: Optional[List[str]] = None) -> Dict[str, Any]:
    """The `assistant` object a session hands the widget."""
    suggestions = list(s.get("suggestions") or []) or [p for p in (popular or []) if p][:4]
    return {
        "name": s.get("name") or (f"Ask {site_name}" if site_name else "Ask us"),
        "avatar_url": s.get("avatarUrl") or (logo_url if isinstance(logo_url, str) and logo_url.startswith("https://") else None),
        "greeting": s.get("greeting"),
        "suggestions": suggestions[:6],
        "accent_color": s.get("accentColor"),
        "position": s.get("position"),
        "persona": s.get("persona"),
    }


# ── platform switches ─────────────────────────────────────────────────────

def _platform(key: str, default: Any, db=None) -> Any:
    try:
        from ..services.platform_settings_service import get_platform_setting
        value = get_platform_setting(key, default=default, db=db)
        return default if value in (None, "") else value
    except Exception:  # noqa: BLE001 - a settings outage must not take the bot down
        return default


def kill_switch_on(db=None) -> bool:
    """True when the platform switch has turned the Site Assistant OFF."""
    v = _platform("site_assistant.enabled", True, db)
    if isinstance(v, str):
        v = v.strip().lower() in ("1", "true", "yes", "on")
    return not bool(v)


def visitor_daily_cap(db=None) -> int:
    try:
        return max(0, int(float(_platform("site_assistant.visitor_daily_answers", VISITOR_DAILY_ANSWERS, db))))
    except (TypeError, ValueError):
        return VISITOR_DAILY_ANSWERS


def ip_daily_cap(db=None) -> int:
    try:
        return max(0, int(float(_platform("site_assistant.ip_daily_answers", IP_DAILY_ANSWERS, db))))
    except (TypeError, ValueError):
        return IP_DAILY_ANSWERS


def ip_daily_sessions(db=None) -> int:
    try:
        return max(0, int(float(_platform("site_assistant.ip_daily_sessions", IP_DAILY_SESSIONS, db))))
    except (TypeError, ValueError):
        return IP_DAILY_SESSIONS


def disable_reasoning(db=None) -> bool:
    v = _platform("site_assistant.llm.disable_reasoning", True, db)
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    return bool(v)


def prefer_non_reasoning(db=None) -> bool:
    # Off by default: Model defaults (site_assistant) is the source of truth for what answers.
    v = _platform("site_assistant.llm.prefer_non_reasoning", False, db)
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    return bool(v)
