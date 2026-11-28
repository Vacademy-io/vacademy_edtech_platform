"""Vocabularies for ai_usage_event (contract K1).

The migration has no CHECK constraints on these columns: values are validated
here, in code, and anything outside a set is stored as the set's fallback.
"""
from __future__ import annotations

from typing import Dict, Tuple

ACTOR_KINDS = frozenset({"USER", "SYSTEM", "API_KEY", "PUBLIC", "UNKNOWN"})
ROLE_CLASSES = frozenset({"ADMIN", "TEACHER", "STAFF", "PARENT", "LEARNER", "SYSTEM", "API_KEY", "PUBLIC", "UNKNOWN"})
ROLE_SOURCES = frozenset({"JWT", "CALLER", "AUTH_LOOKUP", "CATALOG_DEFAULT", "UNRESOLVED", "BACKFILL"})
SURFACES = frozenset({
    "ADMIN_APP", "LEARNER_APP", "PUBLIC", "PARTNER_API", "WHATSAPP", "PHONE", "SCHEDULED", "INTERNAL", "UNKNOWN",
})
BILLING_MODES = frozenset({"CHARGED", "INCLUDED", "ALLOWANCE", "SPLIT", "FREE", "BYO_KEY"})
CHARGE_STATUSES = frozenset({
    "POSTED", "DROPPED_INSUFFICIENT", "SKIPPED_NO_INSTITUTE", "NOT_APPLICABLE", "REFUNDED", "PARTIAL_REFUND",
})
FREE_REASONS = frozenset({"BUNDLED", "POLICY_FREE", "UNBILLED_GAP", "NO_INSTITUTE", "INTERNAL_TEST"})
USE_CASE_SOURCES = frozenset({"EXPLICIT", "TOOL_KEY", "REQUEST_TYPE", "BACKFILL", "UNKNOWN"})
COST_SOURCES = frozenset({"VENDOR_REPORTED", "REGISTRY", "RATE_CARD", "ESTIMATE", "UNKNOWN"})
LIMIT_DECISIONS = frozenset({"NONE", "OK", "WARN", "WOULD_BLOCK", "OVERRUN", "BLOCKED_SKIPPED"})

UNKNOWN_USE_CASE = "unknown"
UNKNOWN_FEATURE_GROUP = "platform"
DEFAULT_SOURCE_SERVICE = "ai_service"

#: Role class for a role name the map does not know (custom institute roles).
UNMAPPED_ROLE: Tuple[str, int] = ("STAFF", 35)

#: Built-in copy of the FULL V586 ai_role_class_map seed (kept identical by
#: tests/test_metering_core.py::test_default_role_map_matches_the_v583_seed).
#: Used until the table has been read once, and by MeteringContext.from_request,
#: which never touches the database. DB rows override these.
DEFAULT_ROLE_MAP: Dict[str, Tuple[str, int]] = {
    "ADMIN": ("ADMIN", 10),
    "OWNER": ("ADMIN", 10),
    "ROOT_ADMIN": ("ADMIN", 10),
    "SUPERADMIN": ("ADMIN", 10),
    "SUPER_ADMIN": ("ADMIN", 10),
    "CENTRE_ADMIN": ("ADMIN", 12),
    "LMS_ADMIN": ("ADMIN", 12),
    "SCHOOL_ADMIN": ("ADMIN", 12),
    "SCHOOL_PRINCIPAL": ("ADMIN", 12),
    "AIQUESTIONCREATOR": ("TEACHER", 20),
    "ASSESSMENT_CREATOR": ("TEACHER", 20),
    "CONTENT_CREATOR": ("TEACHER", 20),
    "COURSE_CREATOR": ("TEACHER", 20),
    "CUSTOM_CREATOR": ("TEACHER", 20),
    "EVALUATOR": ("TEACHER", 20),
    "MENTOR": ("TEACHER", 20),
    "TEACHER": ("TEACHER", 20),
    "ENGLISH_TEACHER": ("TEACHER", 22),
    "ENGLISH_TEACHER1": ("TEACHER", 22),
    "MATHS_TEACHER": ("TEACHER", 22),
    "PLAYGROUP_TEACHER": ("TEACHER", 22),
    "SCHOOL_ENGLISH_TEACHER": ("TEACHER", 22),
    "SCHOOL_MATH": ("TEACHER", 22),
    "SCIENCE_TEACHER": ("TEACHER", 22),
    "CONTENT_REVIEWER": ("TEACHER", 24),
    "AFFILIATE": ("STAFF", 30),
    "CHANNEL_PARTNER": ("STAFF", 30),
    "COORDINATOR": ("STAFF", 30),
    "COUNSELLOR": ("STAFF", 30),
    "CO_ORDINATOR": ("STAFF", 30),
    "CRM": ("STAFF", 30),
    "CRM_ACCESS": ("STAFF", 30),
    "FRONT_DESK_EMPLOYEE": ("STAFF", 30),
    "GUJARAT_SALES_TEAM": ("STAFF", 30),
    "HR_ADMIN": ("STAFF", 30),
    "HR_MANAGER": ("STAFF", 30),
    "MANAGE_LEAD": ("STAFF", 30),
    "MODERATOR": ("STAFF", 30),
    "OPERATIONS": ("STAFF", 30),
    "PARTNER_ADMIN": ("STAFF", 30),
    "SALES_HEAD": ("STAFF", 30),
    "SCHOOL_MANAGER": ("STAFF", 30),
    "TEAM_LEAD": ("STAFF", 30),
    "TEAM_PT": ("STAFF", 30),
    "TPO_COLLEGE": ("STAFF", 30),
    "UPSELLING": ("STAFF", 30),
    "VLE": ("STAFF", 30),
    "ASSISTANT": ("STAFF", 35),
    "CUSTOMROLECPO": ("STAFF", 35),
    "CUSTOM_DEV": ("STAFF", 35),
    "C_P": ("STAFF", 35),
    "DEV": ("STAFF", 35),
    "GUEST": ("STAFF", 35),
    "TEST_ROLE": ("STAFF", 35),
    "USER": ("STAFF", 35),
    "PARENT": ("PARENT", 40),
    "LEARNER": ("LEARNER", 50),
    "STUDENT": ("LEARNER", 50),
}

#: Legacy credit_transactions.user_role values that are not institute roles.
LEGACY_ROLE_CLASSES: Dict[str, str] = {
    "SYSTEM": "SYSTEM",
    "PLATFORM_BILLING": "SYSTEM",
    "API_KEY": "API_KEY",
    "PUBLIC": "PUBLIC",
}

# Column widths of ai_usage_event (values are clipped to fit, never rejected).
W_ACTOR_KIND = 16
W_ROLE_CLASS = 16
W_ROLE_SOURCE = 16
W_NAME = 255
W_USER_ID = 255
W_USE_CASE = 64
W_USE_CASE_SOURCE = 16
W_FEATURE_GROUP = 48
W_REQUEST_TYPE = 50
W_TOOL_KEY = 64
W_SURFACE = 24
W_SOURCE_SERVICE = 24
W_MODEL = 255
W_PROVIDER = 32
W_ROUTER = 32
W_GATEWAY_KEY = 64
W_BILLING_MODE = 20
W_CHARGE_STATUS = 24
W_FREE_REASON = 24
W_COST_SOURCE = 16
W_BATCH = 255
W_IDEM = 255
W_ROLE_NAME = 64


def normalize_role_name(raw) -> str:
    """Same rule as core/security.py jwt_institute_roles: UPPER, '-'/' ' -> '_'."""
    return str(raw or "").strip().upper().replace("-", "_").replace(" ", "_")
