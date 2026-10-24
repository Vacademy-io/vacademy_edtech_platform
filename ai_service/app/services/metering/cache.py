"""Process-wide caches for the metering lookups, plus the on/off switches.

* Catalog, role map and model aliases are read together, at most once per
  CACHE_TTL_SECONDS, inside their own SAVEPOINT on the caller's session (a
  failed read cannot poison the caller's transaction).
* A failed read keeps the last good snapshot. With no good snapshot (the V586
  tables are not there yet, or the database said no) metering is OFF and NO
  further query is made until ABSENT_RETRY_SECONDS have passed; the failure is
  logged once per retry window.
* Settings are read without ever touching the caller's session. The write
  path (events_enabled, admin_hosts) only peeks the in-process cache, never
  doing I/O; setting_value (refresh on the settings service's own session when
  stale) is for the read endpoints only.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .constants import DEFAULT_ROLE_MAP, normalize_role_name

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 300.0
ABSENT_RETRY_SECONDS = 300.0

EVENTS_ENABLED_SETTING = "metering.events.enabled"
ADMIN_HOSTS_SETTING = "metering.admin_hosts"
HISTORY_V2_SETTING = "metering.history_v2_institutes"
DEFAULT_ADMIN_HOSTS = ("dash.vacademy.io",)


@dataclass
class Snapshot:
    catalog: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    #: tool_key -> use_case (active rows, lowest display_order first)
    by_tool: Dict[str, str] = field(default_factory=dict)
    #: request_type -> use_case (active rows, lowest display_order first)
    by_request_type: Dict[str, str] = field(default_factory=dict)
    #: role_name -> (role_class, precedence); DEFAULT_ROLE_MAP overlaid by DB rows
    roles: Dict[str, Tuple[str, int]] = field(default_factory=lambda: dict(DEFAULT_ROLE_MAP))
    #: alias -> canonical model id
    aliases: Dict[str, str] = field(default_factory=dict)


class _State:
    def __init__(self) -> None:
        self.snapshot: Optional[Snapshot] = None
        self.loaded_at: Optional[float] = None
        self.retry_after: Optional[float] = None
        self.lock = threading.Lock()


_state = _State()


def as_list(value: Any) -> List[str]:
    """TEXT[] as returned by psycopg (list), by the SQLite JSON variant, or as a
    Postgres array literal string."""
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(v) for v in value if v is not None and str(v) != ""]
    s = str(value).strip()
    if not s:
        return []
    if s.startswith("["):
        try:
            return [str(v) for v in json.loads(s) if v is not None]
        except Exception:  # noqa: BLE001
            return []
    if s.startswith("{") and s.endswith("}"):
        inner = s[1:-1]
        return [p.strip().strip('"') for p in inner.split(",") if p.strip()]
    return [s]


def _load(db) -> Snapshot:
    from sqlalchemy import select

    from .models import ALIAS_TABLE, CATALOG_TABLE, ROLE_MAP_TABLE

    snap = Snapshot()
    c = CATALOG_TABLE.c
    rows = db.execute(select(
        c.use_case, c.feature_group, c.label, c.label_template, c.count_unit_label, c.model_use_case,
        c.legacy_request_types, c.tool_keys, c.capability_key, c.default_surface, c.actor_kind, c.unit_kind,
        c.billing_policy, c.is_active, c.display_order,
    )).mappings().all()
    ordered = sorted(rows, key=lambda r: (r.get("display_order") if r.get("display_order") is not None else 100,
                                          str(r.get("use_case"))))
    for r in ordered:
        row = dict(r)
        row["legacy_request_types"] = as_list(row.get("legacy_request_types"))
        row["tool_keys"] = as_list(row.get("tool_keys"))
        key = str(row.get("use_case") or "").strip()
        if not key:
            continue
        snap.catalog[key] = row
        if row.get("is_active") is False:
            continue
        for tk in row["tool_keys"]:
            snap.by_tool.setdefault(tk.strip().lower(), key)
        for rt in row["legacy_request_types"]:
            snap.by_request_type.setdefault(rt.strip().lower(), key)
    rm = ROLE_MAP_TABLE.c
    for r in db.execute(select(rm.role_name, rm.role_class, rm.precedence)).mappings().all():
        name = normalize_role_name(r.get("role_name"))
        if name and r.get("role_class"):
            try:
                prec = int(r.get("precedence"))
            except (TypeError, ValueError):
                prec = 35
            snap.roles[name] = (str(r.get("role_class")).strip().upper(), prec)
    for r in db.execute(select(ALIAS_TABLE.c.alias, ALIAS_TABLE.c.model_id)).mappings().all():
        a, m = r.get("alias"), r.get("model_id")
        if a and m:
            snap.aliases[str(a)] = str(m)
    return snap


def get_snapshot(db) -> Optional[Snapshot]:
    """The current lookups, or None when metering cannot run (tables absent or
    unreadable and no earlier good read). Never raises; at most one read per TTL."""
    now = time.monotonic()
    st = _state
    if st.snapshot is not None and st.loaded_at is not None and now - st.loaded_at < CACHE_TTL_SECONDS:
        return st.snapshot
    if st.retry_after is not None and now < st.retry_after:
        return st.snapshot
    if db is None:
        return st.snapshot
    # Never wait: another thread already refreshing means this caller uses the
    # copy it has (or skips its event before the first load).
    if not st.lock.acquire(blocking=False):
        return st.snapshot
    try:
        now = time.monotonic()
        if st.snapshot is not None and st.loaded_at is not None and now - st.loaded_at < CACHE_TTL_SECONDS:
            return st.snapshot
        if st.retry_after is not None and now < st.retry_after:
            return st.snapshot
        try:
            with db.begin_nested():
                snap = _load(db)
            if st.snapshot is None:
                logger.info("metering: lookups loaded (%d use cases, %d roles, %d aliases)",
                            len(snap.catalog), len(snap.roles), len(snap.aliases))
            st.snapshot = snap
            st.loaded_at = time.monotonic()
            st.retry_after = None
        except Exception as exc:  # noqa: BLE001
            st.retry_after = time.monotonic() + ABSENT_RETRY_SECONDS
            if st.snapshot is None:
                logger.warning(
                    "metering: usage-event tables unavailable (apply admin_core Flyway V586 "
                    "ai_usage_metering); usage events are OFF, next check in %ds: %s",
                    int(ABSENT_RETRY_SECONDS), str(exc).splitlines()[0][:300] if str(exc) else type(exc).__name__)
            else:
                logger.warning("metering: lookup refresh failed, keeping the last good copy: %s",
                               str(exc).splitlines()[0][:300] if str(exc) else type(exc).__name__)
        return st.snapshot
    finally:
        st.lock.release()


def peek_snapshot() -> Optional[Snapshot]:
    """The cached lookups without any I/O (None before the first good read)."""
    return _state.snapshot


def reset_cache() -> None:
    """Tests and the super-admin catalog/role-map writers: forget everything."""
    with _state.lock:
        _state.snapshot = None
        _state.loaded_at = None
        _state.retry_after = None


def invalidate() -> None:
    """Re-read on next use, keeping the last good copy meanwhile."""
    _state.loaded_at = None
    _state.retry_after = None


# --------------------------------------------------------------------------
# Settings (never on the caller's session)
# --------------------------------------------------------------------------

def setting_value(key: str, default: Any) -> Any:
    """Effective platform setting. While the settings cache is fresh this is a
    dict lookup; when stale it refreshes on the settings service's own session.
    Any problem -> `default`."""
    try:
        from .. import platform_settings_service as pss

        if key not in pss.SETTING_SPECS:
            return default
        if pss._is_fresh(time.monotonic()):  # noqa: SLF001 - read-only peek, no I/O
            if key in pss._cache.values:  # noqa: SLF001
                return pss._cache.values[key]  # noqa: SLF001
            value = pss.SETTING_SPECS[key].default()
            return default if value is None else value
        return pss.get_platform_setting(key, default=default)
    except Exception:  # noqa: BLE001
        return default


def peek_setting(key: str, default: Any) -> Any:
    """Effective platform setting from the in-process cache only (no I/O ever):
    for code on an event-loop thread. Before the first load: the spec default."""
    try:
        from .. import platform_settings_service as pss

        spec = pss.SETTING_SPECS.get(key)
        if spec is None:
            return default
        vals = pss._cache.values  # noqa: SLF001
        if key in vals:
            return vals[key]
        value = spec.default()
        return default if value is None else value
    except Exception:  # noqa: BLE001
        return default


def as_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    s = str(value).strip().lower()
    if s in ("true", "1", "yes", "on"):
        return True
    if s in ("false", "0", "no", "off"):
        return False
    return default


def as_json_list(value: Any, default: Tuple[str, ...] = ()) -> List[str]:
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    if value is None:
        return list(default)
    s = str(value).strip()
    if not s:
        return list(default)
    try:
        parsed = json.loads(s)
    except Exception:  # noqa: BLE001
        return [p.strip() for p in s.split(",") if p.strip()]
    if isinstance(parsed, list):
        return [str(v).strip() for v in parsed if str(v).strip()]
    if isinstance(parsed, str) and parsed.strip():
        return [parsed.strip()]
    return list(default)


def events_enabled() -> bool:
    """The kill switch, from the in-process settings cache only (no I/O ever).
    The write gate runs inside deduct_credits' open transaction (holding the
    institute balance row lock) and on event-loop threads: it must never check
    out a second pooled connection or refresh the settings cache. The cache is
    kept fresh by every other settings reader in the process; before its first
    load this is the spec default (true)."""
    return as_bool(peek_setting(EVENTS_ENABLED_SETTING, True), True)


def admin_hosts() -> List[str]:
    hosts = as_json_list(peek_setting(ADMIN_HOSTS_SETTING, None), DEFAULT_ADMIN_HOSTS)
    return [h.lower() for h in hosts]


def history_v2_enabled(institute_id: Optional[str]) -> bool:
    ids = as_json_list(setting_value(HISTORY_V2_SETTING, "[]"))
    return "*" in ids or (bool(institute_id) and str(institute_id) in ids)


__all__ = [
    "Snapshot", "get_snapshot", "peek_snapshot", "reset_cache", "invalidate", "setting_value", "peek_setting",
    "events_enabled", "admin_hosts", "history_v2_enabled", "as_list", "as_bool", "as_json_list",
    "EVENTS_ENABLED_SETTING", "ADMIN_HOSTS_SETTING", "HISTORY_V2_SETTING",
]
