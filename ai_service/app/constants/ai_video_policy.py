"""Platform defaults and bounds for the per-institute AI video policy (LMS AI Video).

The policy lives in ``institutes.setting_json`` under ``setting[AI_VIDEO_POLICY].data``
and is written only by the super-admin endpoints (admin_core's generic save-setting
refuses the key: InstituteSettingAccessGuard.SUPER_ADMIN_ONLY_KEYS). A missing key
means "platform defaults" below.
"""
from __future__ import annotations

from typing import Any, Dict, Tuple

AI_VIDEO_POLICY_KEY = "AI_VIDEO_POLICY"
AI_VIDEO_POLICY_NAME = "AI Video Policy"

# Qualities the LMS dialog offers (UI: Standard / Premium / Best). They map 1:1
# to VideoGenerationRequest.quality_tier.
AI_VIDEO_QUALITIES: Tuple[str, ...] = ("standard", "premium", "ultra")

DEFAULT_AI_VIDEO_POLICY: Dict[str, Any] = {
    "enabled": True,
    "allowed_qualities": list(AI_VIDEO_QUALITIES),
    "teacher_allowed": True,
    "max_minutes_per_video": 8,
    "monthly_credit_cap": None,   # None = no cap
    "max_concurrent": 3,
}

# The six policy fields, in display order. Audit fields (updated_by / updated_at /
# reason) are stored beside them in the same data blob.
POLICY_FIELDS: Tuple[str, ...] = tuple(DEFAULT_AI_VIDEO_POLICY)
POLICY_AUDIT_FIELDS: Tuple[str, ...] = ("updated_by", "updated_at", "reason")

# Super-admin validation ranges.
MAX_MINUTES_RANGE = (1, 30)
MAX_CONCURRENT_RANGE = (1, 20)

# Upper bound (minutes) of each duration band the LMS dialog offers; compared
# with max_minutes_per_video.
DURATION_MAX_MINUTES: Dict[str, int] = {
    "1-2 minutes": 2,
    "2-3 minutes": 3,
    "3-5 minutes": 5,
    "5-8 minutes": 8,
}

# credit_transactions.request_type values a video run charges under
# (services/video_generation_service.py: VIDEO, IMAGE, STOCK, TTS, TTS_PREMIUM,
# AVATAR_VIDEO incl. the lesson teacher; services/ai_video_ledger.py: ai_video).
VIDEO_REQUEST_TYPES: Tuple[str, ...] = (
    "video", "image", "tts", "tts_premium", "stock", "avatar_video", "ai_video",
)

# ai_gen_video statuses that mean "a run is working right now". COMPLETED /
# FAILED / CANCELLED are terminal; AWAITING_INPUT (assist mode) is parked on a
# human and consumes nothing.
RUNNING_STATUSES: Tuple[str, ...] = ("PENDING", "IN_PROGRESS")
# A run whose row has not moved for this long is dead (pod restart); it no
# longer counts against max_concurrent.
RUNNING_WINDOW_HOURS = 6
# Between stages the pipeline leaves a live run at status COMPLETED with an
# early current_stage (e.g. COMPLETED/WORDS for the whole HTML stage of a
# Standard video). Those rows count as running while they keep moving (the
# live snapshot is flushed every few seconds); one parked longer than this —
# a Studio script-review run waiting at COMPLETED/SCRIPT — does not.
BETWEEN_STAGES: Tuple[str, ...] = ("PENDING", "SCRIPT", "TTS", "WORDS")
BETWEEN_STAGES_WINDOW_MINUTES = 30

# Policy block codes (403 {detail, code}).
CODE_DISABLED = "AI_VIDEO_DISABLED"
CODE_TIER_NOT_ALLOWED = "TIER_NOT_ALLOWED"
CODE_TEACHER_NOT_ALLOWED = "TEACHER_NOT_ALLOWED"
CODE_TOO_LONG = "TOO_LONG"
CODE_MONTHLY_CAP = "MONTHLY_CAP"
CODE_TOO_MANY_RUNNING = "TOO_MANY_RUNNING"

__all__ = [
    "AI_VIDEO_POLICY_KEY", "AI_VIDEO_POLICY_NAME", "AI_VIDEO_QUALITIES", "DEFAULT_AI_VIDEO_POLICY",
    "POLICY_FIELDS", "POLICY_AUDIT_FIELDS", "MAX_MINUTES_RANGE", "MAX_CONCURRENT_RANGE",
    "DURATION_MAX_MINUTES", "VIDEO_REQUEST_TYPES", "RUNNING_STATUSES", "RUNNING_WINDOW_HOURS",
    "BETWEEN_STAGES", "BETWEEN_STAGES_WINDOW_MINUTES",
    "CODE_DISABLED", "CODE_TIER_NOT_ALLOWED", "CODE_TEACHER_NOT_ALLOWED", "CODE_TOO_LONG",
    "CODE_MONTHLY_CAP", "CODE_TOO_MANY_RUNNING",
]
