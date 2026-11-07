"""
Module entitlements (admin-core V567): which modules and features an institute's
plan includes. A read-only mirror of admin-core's ``CapabilityResolver`` so the
MCP server and the assistant can hide and refuse tools of modules an institute
does not have.

Rules (CapabilityResolver.java):

* ``institute_module_policy.mode`` other than ``MANAGED`` (or no row) is LEGACY:
  every key in the catalogue is on.
* MANAGED: a module is on when it is core, or its row in
  ``institute_module_entitlement`` is enabled and not expired. A feature is on
  when its module is on AND (its row is enabled and not expired, or — no row —
  the catalogue's ``default_on``).
* A key that is not in the catalogue is off, in either mode.

The catalogue itself is ``admin_core_service/.../capabilities/catalog.json``;
``CATALOG`` below is a copy of its module / core / default_on facts, kept in
step by tests/test_entitlements.py.

A failed read rolls the session back and answers LEGACY, the same as
admin-core with no policy row. Nothing is cached here: callers memoise one
``Entitlements`` per tool call.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Mapping, Optional, Tuple

from sqlalchemy import text

logger = logging.getLogger(__name__)

MODE_LEGACY = "LEGACY"
MODE_MANAGED = "MANAGED"

#: module key → (core, {feature key: default_on}) — mirror of capabilities/catalog.json.
CATALOG: Dict[str, Tuple[bool, Dict[str, bool]]] = {
    "core": (True, {"core.dashboard": True, "core.contacts": True, "core.teams": True, "core.settings": True,
                    "core.activity_logs": True}),
    "lms": (False, {"lms.courses": True, "lms.batches": True, "lms.course_planning": True, "lms.reports": True,
                    "lms.student_ai": True, "lms.doubts": True, "lms.engagement": True, "lms.mentorship": False}),
    "assessments": (False, {"assessments.tests": True, "assessments.question_banks": True,
                            "assessments.scanned_evaluation": True}),
    "live_classes": (False, {"live_classes.sessions": True, "live_classes.meetings": True}),
    "crm": (False, {"crm.leads": True, "crm.admissions": True, "crm.calling": True, "crm.ai_calling": True,
                    "crm.call_intelligence": True, "crm.live_activity": False}),
    "communications": (False, {"communications.announcements": True, "communications.email": True,
                               "communications.whatsapp": True, "communications.chat": True,
                               "communications.notification_hub": True}),
    "automation": (False, {"automation.workflows": True, "automation.chatbot_flows": True,
                           "automation.engagement_engines": True}),
    "website": (False, {"website.builder": True, "website.product_pages": True, "website.blog": True}),
    "finance": (False, {"finance.fees": True, "finance.memberships": True, "finance.packages": True}),
    "sub_orgs": (False, {"sub_orgs.partners": True}),
    "inventory": (False, {"inventory.items": True}),
    "erp": (False, {"erp.people": True, "erp.leave": True, "erp.attendance": True, "erp.payroll": True,
                    "erp.compliance": True, "erp.finance": True, "erp.my_hr": True}),
    "ai": (False, {"ai.tools": True, "ai.knowledge_base": True, "ai.instructor_copilot": True,
                   "ai.course_creator": True, "ai.content_studio": True, "ai.content_api": True}),
}

CORE_MODULES = frozenset(m for m, (core, _) in CATALOG.items() if core)
#: feature key → its module key
MODULE_OF: Dict[str, str] = {f: m for m, (_, feats) in CATALOG.items() for f in feats}
#: feature key → the catalogue's default_on
CATALOG_DEFAULT_ON: Dict[str, bool] = {f: on for _, (_, feats) in CATALOG.items() for f, on in feats.items()}
#: every key the catalogue knows: module keys and feature keys
CATALOG_KEYS = frozenset(CATALOG) | frozenset(MODULE_OF)

_POLICY_SQL = "SELECT mode FROM institute_module_policy WHERE institute_id = :inst"
_ROWS_SQL = "SELECT key, enabled, expires_at FROM institute_module_entitlement WHERE institute_id = :inst"


@dataclass(frozen=True)
class Entitlements:
    """One institute's entitlements. ``rows`` = key → active (enabled and not expired); MANAGED only."""
    mode: str = MODE_LEGACY
    rows: Mapping[str, bool] = field(default_factory=dict)

    @property
    def managed(self) -> bool:
        return self.mode == MODE_MANAGED

    def module_on(self, module: str) -> bool:
        if module not in CATALOG:
            return False
        if not self.managed:
            return True
        return module in CORE_MODULES or self.rows.get(module) is True

    def on(self, key: str) -> bool:
        """True when ``key`` (a module or feature key) is on for this institute; unknown keys are off."""
        key = str(key or "").strip()
        if key not in CATALOG_KEYS:
            return False
        if not self.managed:
            return True
        if key in CATALOG:
            return self.module_on(key)
        if not self.module_on(MODULE_OF[key]):
            return False
        return bool(self.rows[key]) if key in self.rows else CATALOG_DEFAULT_ON[key]

    def all_on(self, *keys: str) -> bool:
        return all(self.on(k) for k in keys)

    def any_on(self, *keys: str) -> bool:
        return any(self.on(k) for k in keys)


LEGACY = Entitlements()


def _active(enabled: Any, expires_at: Any, now: datetime) -> bool:
    if not enabled:
        return False
    if expires_at is None:
        return True
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
        except ValueError:
            return False
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return now < expires_at
    return False


def entitlements(db: Any, institute_id: Optional[str]) -> Entitlements:
    """The institute's entitlements. No session / no institute / a failed read → LEGACY (everything on)."""
    if db is None or not institute_id:
        return LEGACY
    try:
        row = db.execute(text(_POLICY_SQL), {"inst": institute_id}).first()
        mode = str(row[0]).strip().upper() if row and row[0] is not None else MODE_LEGACY
        if mode != MODE_MANAGED:
            return LEGACY
        now = datetime.now(timezone.utc)
        rows = {str(r[0]): _active(r[1], r[2], now)
                for r in db.execute(text(_ROWS_SQL), {"inst": institute_id}).fetchall()}
        return Entitlements(mode=MODE_MANAGED, rows=rows)
    except Exception as exc:  # noqa: BLE001
        logger.warning("entitlements read failed for %s, treating as LEGACY: %s", institute_id, exc)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return LEGACY


__all__ = [
    "MODE_LEGACY", "MODE_MANAGED", "CATALOG", "CORE_MODULES", "MODULE_OF", "CATALOG_DEFAULT_ON", "CATALOG_KEYS",
    "Entitlements", "LEGACY", "entitlements",
]
