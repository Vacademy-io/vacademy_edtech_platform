"""Platform switches for the Lead Agent (spec §6; ai_platform_settings, 30 s cache).

Thin readers over get_platform_setting that never raise: a settings outage reads
as the safe default (off / nobody / the declared default), so a DB blip can stop
the agent but never start it.

The setting specs are registered here (not in platform_settings_service.py) so the
whole feature lives in its own package; importing this module (the router and the
scheduler both do) makes them known to the super-admin settings page.

JSON settings are STRINGS: lead_agent.institutes must be written as
json.dumps(["<institute id>"]); a Python list would be str()-ed and parse as empty.
"""
from __future__ import annotations

import json
import logging
from typing import Any, FrozenSet, Union

logger = logging.getLogger(__name__)

ALL_INSTITUTES = "*"
DEFAULT_MODEL = "z-ai/glm-5.3-flash"
DEFAULT_MAX_CONCURRENCY = 3

ENABLED_KEY = "lead_agent.enabled"
INSTITUTES_KEY = "lead_agent.institutes"
MODEL_KEY = "lead_agent.model"
CONCURRENCY_KEY = "lead_agent.max_concurrency"


def _register_specs() -> None:
    try:
        from ..platform_settings_service import SETTING_SPECS, SettingSpec
    except Exception:  # noqa: BLE001 - settings module unavailable: readers fall back to defaults
        return
    specs = (
        SettingSpec(
            key=ENABLED_KEY, group="lead_agent", label="Lead Agent: on (platform kill switch)",
            description=("Off (default) = no agent searches, researches, delivers or charges, and the "
                         "extension is told to pause. On = agents of the institutes listed below run. "
                         "Takes up to 30 s."),
            type="bool", default=lambda: False,
        ),
        SettingSpec(
            key=INSTITUTES_KEY, group="lead_agent", label="Lead Agent: institutes (JSON)",
            description='JSON array of institute ids whose agents may run, or ["*"]. Empty (default) = none.',
            type="string", default=lambda: "[]", max_length=6000,
        ),
        SettingSpec(
            key=MODEL_KEY, group="lead_agent", label="Lead Agent: model",
            description=("Model for planning, discovery selection, extraction and the decision-maker "
                         "lookup. The 'lead_agent' use-case chain is the fallback."),
            type="string", default=lambda: DEFAULT_MODEL, max_length=120,
        ),
        SettingSpec(
            key=CONCURRENCY_KEY, group="lead_agent", label="Lead Agent: research workers per pod",
            description="Organisations researched at the same time on each ai_service pod.",
            type="number", default=lambda: DEFAULT_MAX_CONCURRENCY, min_value=1, max_value=10,
        ),
    )
    for spec in specs:
        SETTING_SPECS.setdefault(spec.key, spec)


_register_specs()


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


def parse_allowlist(raw: Any) -> Union[FrozenSet[str], str]:
    """ALL_INSTITUTES for ["*"], else a set of ids. Bad JSON, a non-list or blank
    entries are ignored (an empty set = nobody)."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else []
        except (ValueError, TypeError):
            logger.warning("%s is not valid JSON; treating it as empty", INSTITUTES_KEY)
            return frozenset()
    if not isinstance(raw, (list, tuple, set, frozenset)):
        return frozenset()
    ids = {str(x).strip() for x in raw if isinstance(x, (str, int)) and str(x).strip()}
    if ALL_INSTITUTES in ids:
        return ALL_INSTITUTES
    return frozenset(ids)


def platform_enabled() -> bool:
    return _bool(ENABLED_KEY)


def allowed_institutes() -> Union[FrozenSet[str], str]:
    return parse_allowlist(_platform(INSTITUTES_KEY, "[]"))


def institute_allowed(institute_id: str | None) -> bool:
    if not institute_id:
        return False
    allowed = allowed_institutes()
    return allowed == ALL_INSTITUTES or institute_id in allowed


def available(institute_id: str | None) -> bool:
    """The platform switch is on AND the institute is on the allowlist."""
    return platform_enabled() and institute_allowed(institute_id)


def model() -> str:
    value = str(_platform(MODEL_KEY, DEFAULT_MODEL) or "").strip()
    return value or DEFAULT_MODEL


def max_concurrency() -> int:
    return _int(CONCURRENCY_KEY, DEFAULT_MAX_CONCURRENCY, 1, 10)


__all__ = [
    "ALL_INSTITUTES", "DEFAULT_MODEL", "parse_allowlist", "platform_enabled", "allowed_institutes",
    "institute_allowed", "available", "model", "max_concurrency",
]
