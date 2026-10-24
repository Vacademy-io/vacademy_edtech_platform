"""
Platform-level AI runtime settings.

Which model serves the learner chatbot, which engine voices the voice call,
whether the voice socket demands a token — these used to be deployment
constants. They now live in `ai_platform_settings` (V493) and are edited from
the super-admin portal, so an operator can switch them without a rollout.

Design:
  * The set of valid keys, their types and defaults is declared HERE in
    SETTING_SPECS. The table only stores overrides; an absent row means "use the
    environment default", and resetting a setting deletes its row.
  * Reads go through a process-wide cache with a short TTL. Every request path
    that consults a setting calls `get_platform_setting`, which costs a dict
    lookup between refreshes and one small SELECT per TTL per replica.
  * The table may not exist yet on a replica that deploys ahead of the
    admin_core migration. That must never take the chatbot down, so a failed
    load falls back to defaults and is retried after the TTL.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import db_session

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 30.0


@dataclass(frozen=True)
class SettingSpec:
    key: str
    group: str
    label: str
    description: str
    # "model" (validated against ai_models), "enum" (validated against options),
    # "bool", "string", "number" (bounded by min_value / max_value).
    type: str
    default: Callable[[], Any]
    options: tuple = ()
    # A "model" setting may be blank, meaning "same as the text chatbot".
    nullable: bool = False
    # For "model" settings: which slice of ai_models the portal offers and the
    # server accepts — "llm" (chat-capable) or "image" (category = image).
    catalog: str = "llm"
    # What a blank value means, shown by the portal for nullable settings.
    blank_label: str = "Same as chatbot model"
    # Bounds for "number" settings.
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    # Longest accepted "string" value (JSON-valued settings need more room).
    max_length: int = 200


def _env_bool(name: str, fallback: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return fallback
    return raw.strip().lower() in ("1", "true", "yes", "on")


SETTING_SPECS: Dict[str, SettingSpec] = {
    s.key: s
    for s in (
        SettingSpec(
            key="chatbot.text.model",
            group="chatbot",
            label="Chatbot model",
            description=(
                "OpenRouter model that answers the learner text chatbot (and the voice call "
                "unless overridden below). Institutes that bring their own API key with a "
                "default model still win over this."
            ),
            type="model",
            default=lambda: get_settings().llm_default_model,
        ),
        SettingSpec(
            key="chatbot.llm.disable_reasoning",
            group="chatbot",
            label="Suppress reasoning tokens",
            description=(
                "Ask the provider not to spend hidden reasoning tokens on chatbot turns. "
                "Measured 4x faster and 7x cheaper on qwen3.7-flash with no answer-quality "
                "loss for typical 23-character learner messages."
            ),
            type="bool",
            default=lambda: get_settings().llm_disable_reasoning,
        ),
        SettingSpec(
            key="chatbot.voice.model",
            group="voice",
            label="Voice call model",
            description="Model for spoken turns. Leave blank to use the chatbot model.",
            type="model",
            default=lambda: None,
            nullable=True,
        ),
        SettingSpec(
            key="chatbot.voice.tts_provider",
            group="voice",
            label="Text-to-speech engine",
            description=(
                "Which engine speaks the agent's replies on the learner voice call. "
                "A failing engine falls back to Sarvam for that line rather than going silent."
            ),
            type="enum",
            default=lambda: "sarvam",
            options=("sarvam", "google", "edge"),
        ),
        SettingSpec(
            key="chatbot.voice.tts_voice",
            group="voice",
            label="Voice",
            description=(
                "Voice id for the selected engine (e.g. hi-IN-Chirp3-HD-Achird for Google, "
                "hi-IN-SwaraNeural for Edge). Blank picks a sensible default for the call's "
                "language. For Sarvam the institute's own voice setting is used instead."
            ),
            type="string",
            default=lambda: "",
        ),
        SettingSpec(
            key="chatbot.voice.stt_provider",
            group="voice",
            label="Speech-to-text engine",
            description="Engine that transcribes the student. Sarvam Saaras is the only one wired today.",
            type="enum",
            default=lambda: "sarvam",
            options=("sarvam",),
        ),
        SettingSpec(
            key="chatbot.voice.opening_turn",
            group="voice",
            label="Agent speaks first",
            description="Greet the student the moment the call connects, instead of waiting for them.",
            type="bool",
            default=lambda: True,
        ),
        SettingSpec(
            key="chatbot.voice.require_auth",
            group="rollout",
            label="Require a login token on the voice socket",
            description=(
                "Refuse voice sockets that don't present an access token. Turn on once every "
                "client is confirmed to send one — until then a token is verified when present "
                "but not demanded. Also settable via VOICE_REQUIRE_AUTH."
            ),
            type="bool",
            default=lambda: get_settings().voice_require_auth,
        ),
        SettingSpec(
            key="chatbot.text.require_auth",
            group="rollout",
            label="Require a login token on the text chatbot",
            description=(
                "Refuse /chat-agent requests that don't present a learner access token. Until it "
                "is on, a token is verified when present (and must belong to the session's "
                "learner) but not demanded, so older app builds keep working. Turn on once the "
                "'chat-agent request without a token' log line goes quiet. Also settable via "
                "CHAT_REQUIRE_AUTH."
            ),
            type="bool",
            default=lambda: get_settings().chat_require_auth,
        ),
        SettingSpec(
            key="chatbot.text.llm_greeting",
            group="chatbot",
            label="AI-written greeting",
            description=(
                "Write each chat's opening greeting with the model. Off = a templated greeting "
                "with the learner's name and current lesson, at no cost: 61% of chats (Sep-Oct "
                "2026) never got a question, so the AI greeting was mostly paid for nothing."
            ),
            type="bool",
            default=lambda: False,
        ),
        SettingSpec(
            key="tutor.compile.model",
            group="tutor",
            label="Tutor compile model",
            description=(
                "OpenRouter model that compiles a slide into a Live AI Tutor teaching plan "
                "(topics, concepts, board, checks). Flash by default: under this platform's "
                "token pricing a single failed Pro compile cost 35 credits (2026-09-03). Raise "
                "it here when the economics allow; the compiler falls back to the institute "
                "default if the chosen model is rejected by the provider."
            ),
            type="model",
            default=lambda: os.environ.get("TUTOR_COMPILE_MODEL") or "z-ai/glm-5.3-flash",
        ),
        SettingSpec(
            key="tutor.live.model",
            group="tutor",
            label="Tutor live model",
            description=(
                "Model for the live teaching turns: grading the learner's answer, hints, doubts "
                "(~1.3k tokens per turn). Blank = the chatbot model. A course or institute "
                "'Live model' setting still wins over this."
            ),
            type="model",
            default=lambda: os.environ.get("TUTOR_LIVE_MODEL") or None,
            nullable=True,
        ),
        SettingSpec(
            key="tutor.image.model",
            group="tutor",
            label="Tutor board image model",
            description=(
                "Image model for AI pictures on whiteboards (up to 4 per slide, billed per image). "
                "Blank = the platform image model below. Dedicated image models (Qwen, Seedream, "
                "FLUX) take 30-70 s per image; Gemini image models a few seconds."
            ),
            type="model",
            default=lambda: os.environ.get("TUTOR_IMAGE_MODEL") or None,
            nullable=True,
            catalog="image",
            blank_label="Platform image model",
        ),
        SettingSpec(
            key="tutor.voice.provider",
            group="tutor",
            label="Tutor voice provider",
            description="TTS engine for the Live AI Tutor's browser sessions. Smallest.ai when its key is present, else Sarvam. Institutes and courses can override; a failing engine falls back to Sarvam per line.",
            type="enum",
            default=lambda: os.environ.get("TUTOR_TTS_PROVIDER") or ("smallest" if os.environ.get("SMALLEST_API_KEY") else "sarvam"),
            options=("smallest", "sarvam", "google", "edge"),
        ),
        SettingSpec(
            key="tutor.transcription.provider",
            group="tutor",
            label="Tutor transcription provider",
            description="Speech-to-text for uploaded lecture videos in Tutor Mode. openrouter = Whisper large-v3-turbo via OpenRouter (an 82-minute lecture in a few minutes; the render worker is the fallback). render = Whisper small on the render worker's CPU (hours for a lecture).",
            type="enum",
            default=lambda: "openrouter",
            options=("openrouter", "render"),
        ),
        SettingSpec(
            key="tutor.transcription.model",
            group="tutor",
            label="Tutor transcription model",
            description="OpenRouter transcription model id used when the provider is openrouter.",
            type="string",
            default=lambda: "openai/whisper-large-v3-turbo",
        ),
        SettingSpec(
            key="tutor.voice.voice",
            group="tutor",
            label="Tutor voice",
            description="Default (female) voice id for the tutor's provider. Blank = provider default. Hindi verb gender follows the voice.",
            type="string",
            default=lambda: os.environ.get("TUTOR_TTS_VOICE") or "",
            nullable=True,
        ),
        SettingSpec(
            key="tutor.live.preflight_minutes",
            group="tutor",
            label="Voice lesson: minutes of credit required to start",
            description=(
                "A voice lesson starts only if the institute can afford this many minutes at the "
                "tutor_live_minute rate (see Credits & pricing below). 0 disables the check."
            ),
            type="number",
            default=lambda: 5,
            min_value=0, max_value=60,
        ),
        SettingSpec(
            key="tutor.demo.enabled",
            group="tutor",
            label="Public 3-minute demo lesson (tutezy.ai)",
            description="Lets unauthenticated visitors take one short lesson on the demo batch, unbilled. Needs the institute, batch and topics below.",
            type="bool",
            default=lambda: False,
        ),
        SettingSpec(
            key="tutor.demo.institute_id",
            group="tutor",
            label="Demo lesson: institute id",
            description="The institute whose settings (teacher name, voice, avatar) the public demo teaches with.",
            type="string",
            default=lambda: "",
        ),
        SettingSpec(
            key="tutor.demo.package_session_id",
            group="tutor",
            label="Demo lesson: batch (package session) id",
            description="The batch that holds the demo slides. Every topic's slide must belong to it.",
            type="string",
            default=lambda: "",
        ),
        SettingSpec(
            key="tutor.demo.topics",
            group="tutor",
            label="Demo lesson: topics (JSON)",
            description='A list like [{"key":"force","title":"What is a force?","emoji":"🚀","slide_id":"…","language":"en"}]. Slides must be compiled.',
            type="string",
            default=lambda: "[]",
            max_length=6000,
        ),
        SettingSpec(
            key="tutor.demo.teacher_name",
            group="tutor",
            label="Demo lesson: teacher name shown to visitors",
            description="Blank = the demo institute's own teacher name.",
            type="string",
            default=lambda: "",
        ),
        SettingSpec(
            key="tutor.demo.minutes",
            group="tutor",
            label="Demo lesson: length (minutes)",
            description="The public lesson ends politely at this length.",
            type="number",
            default=lambda: 3,
            min_value=1, max_value=10,
        ),
        SettingSpec(
            key="tutor.demo.per_ip_per_day",
            group="tutor",
            label="Demo lesson: sessions per visitor (IP) per day",
            description="0 disables the per-visitor limit (not recommended).",
            type="number",
            default=lambda: 1,
            min_value=0, max_value=20,
        ),
        SettingSpec(
            key="tutor.demo.daily_cap",
            group="tutor",
            label="Demo lesson: total sessions per day",
            description="A global ceiling on free lessons across all visitors; 0 = no cap.",
            type="number",
            default=lambda: 200,
            min_value=0, max_value=10000,
        ),
        SettingSpec(
            key="tutor.live.max_minutes",
            group="tutor",
            label="Voice/text lesson: maximum length (minutes)",
            description="A lesson is closed politely when it reaches this wall-clock length; the learner's place is saved.",
            type="number",
            default=lambda: 90,
            min_value=10, max_value=240,
        ),
        SettingSpec(
            key="image.model",
            group="images",
            label="Image generation model",
            description=(
                "Model behind every generated picture: course banners and previews, copilot slide "
                "images, question figures, tutor boards (unless overridden above). Dedicated image "
                "models (qwen/qwen-image-3, Seedream, FLUX) go through OpenRouter's images API; "
                "Gemini/GPT image models through chat completions — routing is automatic."
            ),
            type="model",
            default=lambda: os.environ.get("IMAGE_MODEL") or "qwen/qwen-image-3",
            catalog="image",
        ),
    )
}


SETTING_SPECS["llm.model_routes"] = SettingSpec(
    key="llm.model_routes",
    group="routing",
    label="Model routing (JSON)",
    description=(
        'Models served by a gateway other than OpenRouter, e.g. {"z-ai/glm-5.3-flash": "isoquant"} '
        'or {"z-ai/glm-5.3-flash": {"router": "isoquant", "model": "glm-5.3-flash", "reasoning_effort": "low"}}. '
        "Unlisted models stay on OpenRouter. Institutes using their own OpenRouter key always stay "
        "on OpenRouter, and a failing gateway falls back to OpenRouter for 2 minutes. "
        '"anthropic" sends a Claude model straight to Anthropic with the keys under LLM keys, e.g. '
        '{"anthropic/claude-sonnet-4.5": "anthropic"}; with no active key it stays on OpenRouter.'
    ),
    type="string",
    default=lambda: os.getenv("LLM_MODEL_ROUTES", "") or "{}",
    max_length=6000,
)

SETTING_SPECS["security.credit_history_scope"] = SettingSpec(
    key="security.credit_history_scope",
    group="rollout",
    label="Credit history: who sees which rows",
    description=(
        "Who can read an institute's credit transaction history and AI usage. 'institute' "
        "(default) = any member sees every row. 'own_unless_admin' = institute admins and "
        "platform staff see every row; other members see only the credit rows they caused and "
        "cannot open the institute-wide AI usage views (they keep their own usage)."
    ),
    type="enum",
    default=lambda: "institute",
    options=("institute", "own_unless_admin"),
)

SETTING_SPECS["billing.image_registry_pricing"] = SettingSpec(
    key="billing.image_registry_pricing",
    group="images",
    label="Image billing: registry pricing",
    description=(
        "How page-builder, course-assist, course-slide and course-banner images are charged. "
        "'off' (default) = as before (flat image rate; course assist 5 credits). 'shadow' = charge "
        "as before and log/record would_be_credits at the registry price. 'on' = charge "
        "ai_models.image_price_per_unit of the model that ran x the credit ratio. "
        "AI video billing is not affected by this switch."
    ),
    type="enum",
    default=lambda: "off",
    options=("off", "shadow", "on"),
)

# Read by admin_core directly from ai_platform_settings (60 s cache), not by ai_service.
SETTING_SPECS["billing.java_agent_charge"] = SettingSpec(
    key="billing.java_agent_charge",
    group="rollout",
    label="Charge admin_core AI calls (admin agent, workflow drafter)",
    description=(
        "'false' (default) = as before: these calls are logged in AI usage but not charged. "
        "'true' = each call is priced from ai_models and charged at the normal token rate "
        "(post-paid, once per usage row), whichever gateway served it. A charge the "
        "institute's balance cannot cover is dropped (logged), never taken below zero. Calls "
        "that already carry their own fee or are free by product decision (chatbot turns, the "
        "voice-agent prompt assistant, the WhatsApp engagement brain) are never charged. "
        "Takes up to a minute to apply."
    ),
    type="enum",
    default=lambda: "false",
    options=("false", "true"),
)

SETTING_SPECS["billing.record_unbilled_usage"] = SettingSpec(
    key="billing.record_unbilled_usage",
    group="rollout",
    label="Log unbilled AI usage (embeddings, web search)",
    description=(
        "Off (default) = as before: OpenRouter embedding calls (knowledge-base indexing and "
        "search) and the video pipeline's web searches are not logged. On = each call writes "
        "an AI usage row with its tokens and registry price but charges no credits. Those rows "
        "appear in the institute's AI Settings activity log and its cost total."
    ),
    type="bool",
    default=lambda: False,
)

# Usage metering (services/metering): write-only ai_usage_event rows.
SETTING_SPECS["metering.events.enabled"] = SettingSpec(
    key="metering.events.enabled",
    group="rollout",
    label="Record AI usage events (who used which AI feature)",
    description=(
        "On (default) = every AI charge, and every recorded-but-free AI call, also writes one "
        "ai_usage_event row (feature, user, role, surface, model, credits). Charges, balances and "
        "the credit ledger are exactly the same either way. Off = no usage events are written "
        "(the kill switch; the new usage history then stops growing). Takes up to 30 s to apply."
    ),
    type="bool",
    default=lambda: True,
)

SETTING_SPECS["metering.admin_hosts"] = SettingSpec(
    key="metering.admin_hosts",
    group="rollout",
    label="Usage events: admin dashboard hosts (JSON)",
    description=(
        'JSON array of browser hosts that count as the admin dashboard when a usage event records '
        'where a request came from (its Origin/Referer), e.g. ["dash.vacademy.io"]. Labels only; '
        "nothing is charged or blocked differently."
    ),
    type="string",
    default=lambda: '["dash.vacademy.io"]',
    max_length=2000,
)

SETTING_SPECS["metering.history_v2_institutes"] = SettingSpec(
    key="metering.history_v2_institutes",
    group="rollout",
    label="New AI usage history: institutes (JSON)",
    description=(
        'JSON array of institute ids that see the new AI credits History/Analytics (per user, per '
        'feature), or ["*"] for every institute. Empty (default) = everyone keeps the current view. '
        "Only the screen changes; the data is recorded for every institute either way."
    ),
    type="string",
    default=lambda: "[]",
    max_length=6000,
)

# Read by admin_core's nightly AiUsageRoleBackfillJob directly from ai_platform_settings.
if "metering.role_backfill.enabled" not in SETTING_SPECS:
    SETTING_SPECS["metering.role_backfill.enabled"] = SettingSpec(
        key="metering.role_backfill.enabled",
        group="rollout",
        label="Usage events: fill in roles and names nightly",
        description=(
            "On (default) = a nightly admin_core job looks up the role and name of the users on the "
            "last 7 days of usage events whose role was not known when they were written. It only "
            "updates the usage-event table. Off = the job does nothing."
        ),
        type="bool",
        default=lambda: True,
    )

# Usage limits (services/metering/limits.py): the global kill switch for blocking.
if "metering.limits.enforce" not in SETTING_SPECS:
    SETTING_SPECS["metering.limits.enforce"] = SettingSpec(
        key="metering.limits.enforce",
        group="rollout",
        label="AI usage limits: allow blocking",
        description=(
            "On (default) = institutes whose limits policy is set to Enforce get HTTP 429 when a hard "
            "limit is reached. Off = every Enforce policy behaves like Preview (Shadow): limits are "
            "still counted and would-block decisions are recorded, but no AI request is refused. "
            "Institutes without a limits policy are never affected either way. Takes up to 30 s to apply."
        ),
        type="bool",
        default=lambda: True,
    )

# Read by admin_core's nightly AiUsageCounterRebuildJob directly from ai_platform_settings.
if "metering.limits.rebuild.enabled" not in SETTING_SPECS:
    SETTING_SPECS["metering.limits.rebuild.enabled"] = SettingSpec(
        key="metering.limits.rebuild.enabled",
        group="rollout",
        label="AI usage limits: rebuild counters nightly",
        description=(
            "On (default) = a nightly admin_core job recomputes the current usage-limit counters from "
            "the usage events and repairs any drift. It does nothing while no institute has a limits "
            "policy. Off = the job does nothing (counters are still kept live by every charge)."
        ),
        type="bool",
        default=lambda: True,
    )

# AI subscription plans (services/metering/plans.py). Off = every charge exactly as before.
if "billing.plans.enabled" not in SETTING_SPECS:
    SETTING_SPECS["billing.plans.enabled"] = SettingSpec(
        key="billing.plans.enabled",
        group="rollout",
        label="AI subscription plans: apply plans to charges",
        description=(
            "Off (default) = as before: every AI charge comes from the institute's credit balance, "
            "whatever subscription it has. On = institutes with a live AI subscription follow it: a "
            "subscription set to Shadow still pays exactly as before and only records what the plan "
            "would have done; one set to Live has included features (within fair use) and plan "
            "allowance taken off the plan instead of the balance. AI calling and telephony are always "
            "charged. Institutes without a subscription are never affected. Takes up to 30 s to apply."
        ),
        type="bool",
        default=lambda: False,
    )

if "billing.inr_per_usd" not in SETTING_SPECS:
    SETTING_SPECS["billing.inr_per_usd"] = SettingSpec(
        key="billing.inr_per_usd",
        group="rollout",
        label="AI plans: rupees per US dollar (P&L)",
        description=(
            "The exchange rate the AI plan P&L and simulator use to turn real vendor cost in US "
            "dollars into rupees (default 86). Reports only; no charge depends on it."
        ),
        type="number",
        default=lambda: 86,
        min_value=1,
        max_value=1000,
    )

# Read by admin_core's hourly AI plan renewal job directly from ai_platform_settings.
if "billing.plans.roll.enabled" not in SETTING_SPECS:
    SETTING_SPECS["billing.plans.roll.enabled"] = SettingSpec(
        key="billing.plans.roll.enabled",
        group="rollout",
        label="AI plans: renew and expire subscriptions hourly",
        description=(
            "On (default) = an hourly admin_core job starts the next period of subscriptions that "
            "auto-renew, applies scheduled plan changes and cancellations at the period end, and "
            "expires subscriptions past their end date. It does nothing while no institute has a "
            "subscription. Off = the job does nothing (periods are still opened when a charge needs one)."
        ),
        type="bool",
        default=lambda: True,
    )

# Paid AI plans (payments design 2026-10-16). Every one defaults to OFF / dark;
# admin_core reads these directly from ai_platform_settings too.
if "billing.subscriptions.payments.enabled" not in SETTING_SPECS:
    SETTING_SPECS["billing.subscriptions.payments.enabled"] = SettingSpec(
        key="billing.subscriptions.payments.enabled",
        group="rollout",
        label="AI plans: take payments for subscriptions",
        description=(
            "Off (default) = AI plans are assigned by the platform team only (manual or complimentary), "
            "as before. On = plans can be sold: a paid checkout or a paid assignment creates a "
            "subscription that starts when its first payment is received, renews only when paid, and "
            "pauses its benefits (AI use charged from credits) while a renewal is unpaid. Institutes "
            "already paying keep their plan benefits even if the plans switch is turned off."
        ),
        type="bool",
        default=lambda: False,
    )

if "billing.autopay.enabled" not in SETTING_SPECS:
    SETTING_SPECS["billing.autopay.enabled"] = SettingSpec(
        key="billing.autopay.enabled",
        group="rollout",
        label="AI plans: autopay (UPI Autopay / card mandate)",
        description=(
            "Off (default) = every renewal is paid with a payment link. On = checkout offers to set up "
            "autopay (on by default where the payment method supports it) and renewals up to Rs 15,000 "
            "are debited automatically after a 24-hour notice; a failed debit falls back to a payment link."
        ),
        type="bool",
        default=lambda: False,
    )

if "billing.storefront.mode" not in SETTING_SPECS:
    SETTING_SPECS["billing.storefront.mode"] = SettingSpec(
        key="billing.storefront.mode",
        group="rollout",
        label="AI plans: who sees the plans page",
        description=(
            "OFF (default) = no institute sees the AI plans page. ALLOWLIST = only institutes the platform "
            "team allowed one by one. SEGMENTS = those plus institutes in an allowed segment. ALL = every "
            "institute admin (an institute switched off one by one never sees it)."
        ),
        type="enum",
        options=("OFF", "ALLOWLIST", "SEGMENTS", "ALL"),
        default=lambda: "OFF",
    )

if "billing.invoice.series_v2.enabled" not in SETTING_SPECS:
    SETTING_SPECS["billing.invoice.series_v2.enabled"] = SettingSpec(
        key="billing.invoice.series_v2.enabled",
        group="rollout",
        label="Billing: new invoice numbers (VT/FY/I#####)",
        description=(
            "Off (default) = credit-pack invoices keep today's numbers. On = new invoices are numbered "
            "VT/{financial year}/I##### and credit notes VT/{financial year}/C##### (financial year in "
            "India time). Subscription invoices always use the new series."
        ),
        type="bool",
        default=lambda: False,
    )

if "billing.buyer_state.required" not in SETTING_SPECS:
    SETTING_SPECS["billing.buyer_state.required"] = SettingSpec(
        key="billing.buyer_state.required",
        group="rollout",
        label="Billing: buyer state required for credit packs",
        description=(
            "Off (default) = buying credits works as before. On = the buyer's state must be given before "
            "buying credits (place of supply for GST). Subscriptions always need it."
        ),
        type="bool",
        default=lambda: False,
    )

if "billing.packs.reconcile.enabled" not in SETTING_SPECS:
    SETTING_SPECS["billing.packs.reconcile.enabled"] = SettingSpec(
        key="billing.packs.reconcile.enabled",
        group="rollout",
        label="Billing: hourly check of unpaid credit-pack links",
        description=(
            "Off (default) = unpaid credit-pack payments are only settled by the Razorpay webhook, as before. "
            "On = once an hour, unpaid credit-pack payment links older than 30 minutes are checked with "
            "Razorpay: a paid link gets its credits (a lost webhook), an expired one is closed."
        ),
        type="bool",
        default=lambda: False,
    )

# Site Assistant (public website chatbot, app/site_assistant): the platform
# kill switch and the per-visitor / per-network daily caps. Per-site settings
# (on/off, daily answers per site) live in each site's catalogue JSON.
SETTING_SPECS["site_assistant.enabled"] = SettingSpec(
    key="site_assistant.enabled",
    group="site_assistant",
    label="Site Assistant: on (platform kill switch)",
    description=(
        "On (default) = the website assistant answers on every site that has it turned on. Off = every site's "
        "assistant refuses new chats and messages (admin preview too), without any model call. Takes up to 30 s."
    ),
    type="bool",
    default=lambda: True,
)
SETTING_SPECS["site_assistant.visitor_daily_answers"] = SettingSpec(
    key="site_assistant.visitor_daily_answers",
    group="site_assistant",
    label="Site Assistant: answers per visitor per day",
    description="A visitor (browser) gets at most this many model answers a day; then the contact card is shown.",
    type="number",
    default=lambda: 40,
    min_value=0, max_value=1000,
)
SETTING_SPECS["site_assistant.ip_daily_answers"] = SettingSpec(
    key="site_assistant.ip_daily_answers",
    group="site_assistant",
    label="Site Assistant: answers per network (IP) per day",
    description="All visitors behind one IP address (IPv6: one /64) share this daily ceiling.",
    type="number",
    default=lambda: 80,
    min_value=0, max_value=10000,
)
SETTING_SPECS["site_assistant.llm.prefer_non_reasoning"] = SettingSpec(
    key="site_assistant.llm.prefer_non_reasoning",
    group="site_assistant",
    label="Site Assistant: answer with a non-reasoning model first",
    description=(
        "Off (default) = the chain runs exactly as set under Model defaults (site_assistant), so the portal shows "
        "what answers. On = when that chain starts with a model that cannot turn reasoning off (GLM), the first "
        "model of the chain that can answers instead and GLM becomes the fallback. Emergency lever only."
    ),
    type="bool",
    default=lambda: False,
)
SETTING_SPECS["site_assistant.llm.disable_reasoning"] = SettingSpec(
    key="site_assistant.llm.disable_reasoning",
    group="site_assistant",
    label="Site Assistant: suppress reasoning tokens",
    description=(
        "Ask the provider not to spend hidden reasoning tokens on website-assistant answers (latency: first token "
        "should arrive in under 2 s). Models that cannot turn reasoning off still run at low effort."
    ),
    type="bool",
    default=lambda: True,
)

# Learner profile (app/services/learner_profile): after a Student AI chat goes idle,
# a cheap model notes what it showed about the learner (admin_core V608). Phase 1
# only writes; admins read it on the learner's Reports tab. Off by default.
SETTING_SPECS["learner_profile.enabled"] = SettingSpec(
    key="learner_profile.enabled",
    group="learner_profile",
    label="Learner profile: on (platform kill switch)",
    description=(
        "Off (default) = idle Student AI chats are not read. On = chats of the institutes listed below are "
        "read once they go idle and what they show about the learner is saved for admins. Free to institutes."
    ),
    type="bool",
    default=lambda: False,
)
SETTING_SPECS["learner_profile.institutes"] = SettingSpec(
    key="learner_profile.institutes",
    group="learner_profile",
    label="Learner profile: institutes (JSON)",
    description='JSON array of institute ids, or ["*"] for every institute. Empty (default) = none.',
    type="string",
    default=lambda: "[]",
    max_length=6000,
)

# Course knowledge (app/services/course_knowledge): lessons indexed per institute
# into a hidden course_content knowledge base. Every switch is off by default;
# each institute also turns the feature on itself (course_knowledge_setting).
SETTING_SPECS["course_knowledge.enabled"] = SettingSpec(
    key="course_knowledge.enabled",
    group="course_knowledge",
    label="Course knowledge: on (platform kill switch)",
    description=(
        "Off (default) = no lesson is indexed, every course-knowledge screen reports 'not available' and "
        "learner answers never use course text. On = institutes listed below may turn the feature on. "
        "Takes up to 30 s."
    ),
    type="bool",
    default=lambda: _env_bool("COURSE_KNOWLEDGE_ENABLED", False),
)
SETTING_SPECS["course_knowledge.institutes"] = SettingSpec(
    key="course_knowledge.institutes",
    group="course_knowledge",
    label="Course knowledge: institutes (JSON)",
    description=(
        'JSON array of institute ids that may turn course knowledge on, or ["*"] for every institute. '
        "Empty (default) = none."
    ),
    type="string",
    default=lambda: "[]",
    max_length=6000,
)
SETTING_SPECS["course_knowledge.retrieval_mode"] = SettingSpec(
    key="course_knowledge.retrieval_mode",
    group="course_knowledge",
    label="Course knowledge: learner answers",
    description=(
        "'off' (default) = learner chat and voice never read course text. 'shadow' = the search runs and is "
        "logged, but nothing reaches the answer. 'on' = lessons the learner can open ground the answer."
    ),
    type="enum",
    default=lambda: "off",
    options=("off", "shadow", "on"),
)
SETTING_SPECS["course_knowledge.paid_enabled"] = SettingSpec(
    key="course_knowledge.paid_enabled",
    group="course_knowledge",
    label="Course knowledge: paid processing (scans, videos)",
    description=(
        "Off (default) = only free text is indexed; scanned pages and uploaded videos wait as 'needs "
        "processing' and no provider is called. On = institutes may pay credits to read them."
    ),
    type="bool",
    default=lambda: False,
)
SETTING_SPECS["course_knowledge.links_enabled"] = SettingSpec(
    key="course_knowledge.links_enabled",
    group="course_knowledge",
    label="Course knowledge: course to knowledge-base links",
    description=(
        "Off (default) = the link screens and APIs are closed and the AI tutor keeps its current grounding. "
        "On = courses can be linked to knowledge bases. Turn on 'Stable topic ids' first."
    ),
    type="bool",
    default=lambda: False,
)
SETTING_SPECS["course_knowledge.drip_mode"] = SettingSpec(
    key="course_knowledge.drip_mode",
    group="course_knowledge",
    label="Course knowledge: drip rules",
    description=(
        "'time_exact' (default) = date-based drip is applied exactly and progress-based rules count as not met "
        "(the lesson stays out of answers). 'mirror' = progress rules are evaluated like the learner app."
    ),
    type="enum",
    default=lambda: "time_exact",
    options=("time_exact", "mirror"),
)
SETTING_SPECS["course_knowledge.max_monthly_auto_cap"] = SettingSpec(
    key="course_knowledge.max_monthly_auto_cap",
    group="course_knowledge",
    label="Course knowledge: highest monthly auto-processing cap (credits)",
    description="An institute's own monthly cap for automatic paid processing is clamped to this.",
    type="number",
    default=lambda: 5000,
    min_value=0, max_value=1000000,
)
SETTING_SPECS["course_knowledge.max_chunks_per_institute"] = SettingSpec(
    key="course_knowledge.max_chunks_per_institute",
    group="course_knowledge",
    label="Course knowledge: most indexed passages per institute",
    description="Storage guard on the shared database: indexing stops for an institute at this many passages.",
    type="number",
    default=lambda: 200000,
    min_value=1000, max_value=5000000,
)
SETTING_SPECS["course_knowledge.scorm_ocr_engine"] = SettingSpec(
    key="course_knowledge.scorm_ocr_engine",
    group="course_knowledge",
    label="Course knowledge: reader for SCORM slides drawn as images",
    description=(
        "'mathpix' (default) = MathPix OCR reads each slide image. 'vision' = a vision model (GLM flash) "
        "transcribes it. Same price to the institute (per slide); used by course knowledge and Tutor Mode."
    ),
    type="enum",
    default=lambda: "mathpix",
    options=("mathpix", "vision"),
)
SETTING_SPECS["course_knowledge.worker_batch"] = SettingSpec(
    key="course_knowledge.worker_batch",
    group="course_knowledge",
    label="Course knowledge: lessons claimed per worker tick",
    description="How many queued lessons each ai_service pod picks up per tick.",
    type="number",
    default=lambda: 4,
    min_value=1, max_value=16,
)
SETTING_SPECS["kb.stable_topic_ids"] = SettingSpec(
    key="kb.stable_topic_ids",
    group="kb",
    label="Knowledge base: stable topic ids",
    description=(
        "Off (default) = rebuilding a knowledge base's topic tree gives every topic a new id, as before. "
        "On = unchanged topics keep their ids, so course links to topics survive a rebuild."
    ),
    type="bool",
    default=lambda: False,
)

# YouTube captions (app/services/youtube_captions): the shared caption service
# behind KB ingest, the AI tutor and course knowledge. No secrets here: proxy
# credentials and the Supadata key are env / k8s secret only.
_YTC_PER_POD = " Per pod: multiply by the ai_service replica count (2 today) for the platform total."
SETTING_SPECS["youtube_captions.enabled"] = SettingSpec(
    key="youtube_captions.enabled", group="youtube_captions",
    label="YouTube captions: fetch from YouTube",
    description="On (default) = captions are fetched through the fallback chain. Off = cache only: a video "
                "not cached yet reports 'try again later' and nothing calls YouTube, the proxy or Supadata.",
    type="bool", default=lambda: True,
)
SETTING_SPECS["youtube_captions.direct_enabled"] = SettingSpec(
    key="youtube_captions.direct_enabled", group="youtube_captions",
    label="YouTube captions: try direct (no proxy) first",
    description="On (default) = one free direct request first, behind a breaker that pauses direct for 6 h "
                "after 2 blocks in 10 min (so a blocked server IP costs one request per 6 h). With no proxy "
                "and no Supadata configured the breaker is not used: every request tries direct.",
    type="bool", default=lambda: True,
)
SETTING_SPECS["youtube_captions.proxy_enabled"] = SettingSpec(
    key="youtube_captions.proxy_enabled", group="youtube_captions",
    label="YouTube captions: use the proxy",
    description="On (default) = use the rotating residential proxy. Takes effect only when the proxy "
                "credentials are set in the server environment (YT_CAPTIONS_PROXY + WEBSHARE_PROXY_*).",
    type="bool", default=lambda: True,
)
SETTING_SPECS["youtube_captions.proxy_countries"] = SettingSpec(
    key="youtube_captions.proxy_countries", group="youtube_captions",
    label="YouTube captions: proxy countries",
    description="Comma list of country codes the proxy IPs come from (Webshare location filter). Blank = any.",
    type="string", default=lambda: "in,us", max_length=100,
)
SETTING_SPECS["youtube_captions.proxy_retries_when_blocked"] = SettingSpec(
    key="youtube_captions.proxy_retries_when_blocked", group="youtube_captions",
    label="YouTube captions: proxy retries when blocked",
    description="How many times the library re-lists a blocked video on a new proxy IP.",
    type="number", default=lambda: 4, min_value=0, max_value=10,
)
SETTING_SPECS["youtube_captions.outer_retries"] = SettingSpec(
    key="youtube_captions.outer_retries", group="youtube_captions",
    label="YouTube captions: extra proxy attempts",
    description="Extra attempts with a fresh proxy client after a blocked / timed-out / empty fetch "
                "(the library never retries the caption download itself). Backoff 1 s then 3 s.",
    type="number", default=lambda: 2, min_value=0, max_value=3,
)
SETTING_SPECS["youtube_captions.proxy_daily_mb"] = SettingSpec(
    key="youtube_captions.proxy_daily_mb", group="youtube_captions",
    label="YouTube captions: proxy MB per day (platform)",
    description="Platform-wide daily budget of proxy traffic in MB (UTC day, counted in the database across "
                "replicas; each pod re-reads the total every minute). About 0.5 MB per video. At the budget the "
                "proxy is skipped until tomorrow (Supadata may still run). 0 = no proxy traffic.",
    type="number", default=lambda: 1024, min_value=0, max_value=1000000,
)
SETTING_SPECS["youtube_captions.supadata_enabled"] = SettingSpec(
    key="youtube_captions.supadata_enabled", group="youtube_captions",
    label="YouTube captions: use Supadata as a fallback",
    description="Off (default). Turn on after SUPADATA_API_KEY is set and the live probe passes. Supadata is "
                "called only when the proxy is blocked / unusable or the track needs a token, never for a "
                "video YouTube says has no captions, and only in native-caption mode (no paid AI transcription).",
    type="bool", default=lambda: False,
)
SETTING_SPECS["youtube_captions.supadata_daily_cap"] = SettingSpec(
    key="youtube_captions.supadata_daily_cap", group="youtube_captions",
    label="YouTube captions: Supadata credits per day (platform)",
    description="Platform-wide daily cap on Supadata credits (UTC day, counted in the database, so it holds "
                "across replicas). At the cap Supadata is skipped until tomorrow.",
    type="number", default=lambda: 300, min_value=0, max_value=1000000,
)
SETTING_SPECS["youtube_captions.max_concurrent_batch"] = SettingSpec(
    key="youtube_captions.max_concurrent_batch", group="youtube_captions",
    label="YouTube captions: concurrent course scans",
    description="Caption fetches at once for course knowledge (batch)." + _YTC_PER_POD,
    type="number", default=lambda: 3, min_value=1, max_value=8,
)
SETTING_SPECS["youtube_captions.max_concurrent_interactive"] = SettingSpec(
    key="youtube_captions.max_concurrent_interactive", group="youtube_captions",
    label="YouTube captions: concurrent interactive fetches",
    description="Caption fetches at once for the AI tutor, KB ingest and probes; a separate pool from course "
                "scans so a re-scan never starves the tutor." + _YTC_PER_POD,
    type="number", default=lambda: 2, min_value=1, max_value=4,
)
SETTING_SPECS["youtube_captions.max_per_minute"] = SettingSpec(
    key="youtube_captions.max_per_minute", group="youtube_captions",
    label="YouTube captions: network attempts per minute",
    description="Token bucket on network attempts (cache hits are free)." + _YTC_PER_POD,
    type="number", default=lambda: 30, min_value=1, max_value=600,
)
SETTING_SPECS["youtube_captions.canary_video_ids"] = SettingSpec(
    key="youtube_captions.canary_video_ids", group="youtube_captions",
    label="YouTube captions: canary video ids",
    description="Comma list of 3-5 public video ids the live probe verified (an English manual-caption video, "
                "a Hindi auto-caption-only video, a long lecture). Each requeue sweep first checks that at least "
                "half of them come back OK through the proxy / Supadata. Blank (default) = the requeue never runs.",
    type="string", default=lambda: "", max_length=200,
)
SETTING_SPECS["youtube_captions.requeue_enabled"] = SettingSpec(
    key="youtube_captions.requeue_enabled", group="youtube_captions",
    label="YouTube captions: re-try lessons that had no captions",
    description="On (default) = the course-knowledge sweep re-queues YouTube lessons marked 'no captions' "
                "before this service existed (or blocked since) when the canary passes: at most 6 times per "
                "lesson, 1, 2, 4, 8 and 16 days apart.",
    type="bool", default=lambda: True,
)
SETTING_SPECS["youtube_captions.requeue_per_sweep"] = SettingSpec(
    key="youtube_captions.requeue_per_sweep", group="youtube_captions",
    label="YouTube captions: lessons re-queued per sweep",
    description="At most this many lessons per 30-minute sweep (platform-wide).",
    type="number", default=lambda: 300, min_value=0, max_value=2000,
)

GROUP_LABELS = {
    "chatbot": "Student chatbot",
    "site_assistant": "Website assistant",
    "course_knowledge": "Course knowledge",
    "learner_profile": "Learner profile",
    "kb": "Knowledge base",
    "youtube_captions": "YouTube captions",
    "voice": "Voice call",
    "tutor": "Live AI Tutor",
    "images": "Image generation",
    "rollout": "Rollout & safety",
    "routing": "Model routing",
}


# --------------------------------------------------------------------------
# Cache
# --------------------------------------------------------------------------

@dataclass
class _Cache:
    values: Dict[str, Any] = field(default_factory=dict)
    # None = never loaded. (A 0.0 sentinel compared against time.monotonic()
    # reads as "loaded just now" wherever the monotonic clock starts near zero.)
    loaded_at: Optional[float] = None
    loaded_wall: Optional[datetime] = None
    load_failed: bool = False
    last_error: Optional[str] = None
    lock: threading.Lock = field(default_factory=threading.Lock)


_cache = _Cache()


def _load_overrides(db: Session) -> Dict[str, Any]:
    rows = db.execute(text("SELECT setting_key, setting_value FROM ai_platform_settings")).fetchall()
    out: Dict[str, Any] = {}
    for key, value in rows:
        if key in SETTING_SPECS:
            out[key] = value
    return out


def _is_fresh(now: float) -> bool:
    return _cache.loaded_at is not None and (now - _cache.loaded_at) < CACHE_TTL_SECONDS


def _refresh_if_stale(db: Optional[Session] = None) -> None:
    """
    Reload the overrides once per TTL.

    Prefer the caller's session: the chatbot and the voice socket call this
    while already holding a pooled connection, and opening a second one from
    inside that request is how a busy pool turns a saved setting into a silent
    env default. Only fall back to a fresh session when no caller session exists.
    """
    now = time.monotonic()
    if _is_fresh(now):
        return
    with _cache.lock:
        if _is_fresh(now):
            return
        try:
            if db is not None:
                values = _load_overrides(db)
            else:
                with db_session() as fresh:
                    values = _load_overrides(fresh)
            _cache.values = values
            if _cache.load_failed:
                logger.info("ai_platform_settings loaded; overrides active again")
            _cache.load_failed = False
            _cache.last_error = None
            _cache.loaded_wall = datetime.utcnow()
        except Exception as exc:
            # Table not migrated yet, pool busy, DB blip: serve defaults, retry
            # after the TTL, and say so EVERY time — a one-off warning at pod
            # start is not enough to notice a setting that never takes effect.
            _cache.values = {}
            _cache.load_failed = True
            _cache.last_error = f"{type(exc).__name__}: {str(exc)[:200]}"
            logger.warning(
                "ai_platform_settings unavailable; using environment defaults (%s)",
                _cache.last_error,
            )
        _cache.loaded_at = time.monotonic()


def invalidate_platform_settings_cache() -> None:
    _cache.loaded_at = None


def get_platform_setting(key: str, default: Any = None, db: Optional[Session] = None) -> Any:
    """
    Current effective value: the portal override if set, else the spec default,
    else `default`. Pass the request's `db` session when you have one.
    """
    spec = SETTING_SPECS.get(key)
    if spec is None:
        raise KeyError(f"Unknown platform setting: {key}")
    _refresh_if_stale(db)
    if key in _cache.values:
        return _cache.values[key]
    try:
        value = spec.default()
    except Exception:
        value = None
    return default if value is None else value


# --------------------------------------------------------------------------
# Model health — why the configured model failed, and what answered instead
# --------------------------------------------------------------------------

_model_health: Dict[str, Dict[str, Any]] = {}
_MODEL_HEALTH_MAX = 8


def record_model_failure(model: str, reason: str, fallback_model: Optional[str] = None) -> None:
    """Remember the last failure for `model` so the portal can show it."""
    entry = _model_health.setdefault(model, {"failures": 0})
    entry["failures"] = int(entry.get("failures", 0)) + 1
    entry["last_error"] = (reason or "")[:300]
    entry["last_failed_at"] = datetime.utcnow().isoformat() + "Z"
    if fallback_model:
        entry["fallback_model"] = fallback_model
    while len(_model_health) > _MODEL_HEALTH_MAX:
        oldest = min(_model_health, key=lambda k: _model_health[k].get("last_failed_at", ""))
        _model_health.pop(oldest, None)


def record_model_success(model: str) -> None:
    """A successful call clears a model's failure record."""
    _model_health.pop(model, None)


_model_notes: Dict[str, str] = {}


def record_model_note(model: str, note: str) -> None:
    """Informational, not a failure: e.g. 'runs with reasoning on'."""
    _model_notes[model] = (note or "")[:200]


def get_model_notes() -> Dict[str, str]:
    return dict(_model_notes)


def get_model_health() -> Dict[str, Dict[str, Any]]:
    return {k: dict(v) for k, v in _model_health.items()}


def get_cache_status() -> Dict[str, Any]:
    """What this process is serving from — for the portal's 'effective' view."""
    age = None if _cache.loaded_at is None else round(time.monotonic() - _cache.loaded_at, 1)
    return {
        "model_health": get_model_health(),
        "model_notes": get_model_notes(),
        "loaded": _cache.loaded_at is not None and not _cache.load_failed,
        "load_failed": _cache.load_failed,
        "last_error": _cache.last_error,
        "age_seconds": age,
        "loaded_at": _cache.loaded_wall.isoformat() + "Z" if _cache.loaded_wall else None,
        "ttl_seconds": CACHE_TTL_SECONDS,
        "override_keys": sorted(_cache.values.keys()),
    }


# --------------------------------------------------------------------------
# Admin API support
# --------------------------------------------------------------------------

def _coerce(spec: SettingSpec, value: Any) -> Any:
    """Validate and normalise an incoming value for `spec`, or raise ValueError."""
    if value is None or (isinstance(value, str) and value.strip() == ""):
        if spec.nullable or spec.type == "string":
            return "" if spec.type == "string" else None
        raise ValueError(f"{spec.key} cannot be empty")

    if spec.type == "bool":
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.strip().lower() in ("true", "false"):
            return value.strip().lower() == "true"
        raise ValueError(f"{spec.key} must be true or false")

    if spec.type == "enum":
        v = str(value).strip().lower()
        if v not in spec.options:
            raise ValueError(f"{spec.key} must be one of {', '.join(spec.options)}")
        return v

    if spec.type in ("model", "string"):
        v = str(value).strip()
        if len(v) > spec.max_length:
            raise ValueError(f"{spec.key} is too long (max {spec.max_length} characters)")
        return v

    if spec.type == "number":
        try:
            n = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{spec.key} must be a number")
        if spec.min_value is not None and n < spec.min_value:
            raise ValueError(f"{spec.key} must be at least {spec.min_value:g}")
        if spec.max_value is not None and n > spec.max_value:
            raise ValueError(f"{spec.key} must be at most {spec.max_value:g}")
        return int(n) if n.is_integer() else n

    raise ValueError(f"Unsupported setting type {spec.type}")


def _model_exists(db: Session, model_id: str, catalog: str = "llm") -> bool:
    if catalog == "image":
        sql = "SELECT 1 FROM ai_models WHERE model_id = :m AND is_active = TRUE AND category = 'image' LIMIT 1"
    else:
        sql = ("SELECT 1 FROM ai_models WHERE model_id = :m AND is_active = TRUE "
               "AND category NOT IN ('embedding', 'image', 'tts', 'video') LIMIT 1")
    row = db.execute(text(sql), {"m": model_id}).fetchone()
    return row is not None


def list_platform_settings(db: Session) -> List[Dict[str, Any]]:
    """Every declared setting with its effective value and where it came from."""
    rows = db.execute(
        text("SELECT setting_key, setting_value, updated_by, updated_at FROM ai_platform_settings")
    ).fetchall()
    overrides = {r[0]: (r[1], r[2], r[3]) for r in rows}

    out: List[Dict[str, Any]] = []
    for spec in SETTING_SPECS.values():
        try:
            default = spec.default()
        except Exception:
            default = None
        if spec.key in overrides:
            value, updated_by, updated_at = overrides[spec.key]
            source = "portal"
        else:
            value, updated_by, updated_at = default, None, None
            source = "default"
        # What THIS process resolves right now (via its cache) — differs from
        # `value` when the cache could not load or is still within its TTL.
        try:
            effective = get_platform_setting(spec.key, db=db)
        except Exception:
            effective = None
        out.append(
            {
                "key": spec.key,
                "effective": effective,
                "group": spec.group,
                "group_label": GROUP_LABELS.get(spec.group, spec.group),
                "label": spec.label,
                "description": spec.description,
                "type": spec.type,
                "nullable": spec.nullable,
                "catalog": spec.catalog,
                "blank_label": spec.blank_label,
                "min_value": spec.min_value,
                "max_value": spec.max_value,
                "options": list(spec.options),
                "value": value,
                "default": default,
                "source": source,
                "updated_by": updated_by,
                "updated_at": updated_at.isoformat() if isinstance(updated_at, datetime) else updated_at,
            }
        )
    return out


def _check_model_routes(raw: Any) -> Optional[str]:
    """None if the map parses and every routed model answers one token through
    its gateway with the platform key; else why not. A route whose gateway key
    is missing would silently stay on OpenRouter, so that is refused too.
    An "anthropic" entry is probed through the key pool (no OpenRouter
    failover), so a map is refused while no Anthropic key is active."""
    from .llm_router import ROUTERS, parse_routes, probe_anthropic_route

    try:
        routes = parse_routes(raw)
    except Exception as exc:  # noqa: BLE001
        return str(exc)
    for model_id, entry in routes.items():
        spec = ROUTERS[entry["router"]]
        if entry["router"] == "openrouter":
            continue
        if spec.transport == "anthropic":
            err = probe_anthropic_route(model_id, routes)
            if err:
                return f"{model_id} failed through {spec.label}: {err}"
            continue
        if not spec.api_key():
            return f"{spec.label} API key is not configured on ai-service (needed for {model_id})"
        err = _openrouter_one_token(model_id, "on-low", get_settings().openrouter_api_key or "", 25.0, routes)
        if err:
            return f"{model_id} failed through {spec.label}: {err}"
    return None


def _openrouter_one_token(
    model_id: str, mode: str, api_key: str, timeout_seconds: float, routes: Optional[Dict[str, Any]] = None
) -> Optional[str]:
    """
    One-token completion in the chatbot's request shape; None if it worked,
    else the provider's error (with OpenRouter's upstream text unwrapped).
    mode: "disabled" (reasoning off), "on-low" (on at low effort), "on"
    (explicitly on, as the owner's working curl), "on-no-temp" (on, and no
    temperature parameter) — the same ladder the runtime client walks.
    """
    import httpx
    from .chat_llm_client import openrouter_error_text

    payload: Dict[str, Any] = {
        "model": model_id,
        "messages": [{"role": "user", "content": "Reply with the single word: ok"}],
        "max_tokens": 5,
        "temperature": 0,
    }
    if mode == "disabled":
        payload["reasoning"] = {"enabled": False}
    else:
        payload["reasoning"] = {"enabled": True, "effort": "low"} if mode == "on-low" else {"enabled": True}
        payload["max_tokens"] = 256  # room for thinking before the one visible token
        if mode == "on-no-temp":
            payload.pop("temperature", None)
    from .llm_router import route_chat

    # Probe the gateway that will actually serve the model (llm_router).
    url, headers, wire, route = route_chat(payload, api_key, routes)
    gw = route.label
    try:
        resp = httpx.post(url, json=wire, headers=headers, timeout=timeout_seconds)
    except Exception as exc:
        return f"could not reach {gw}: {exc}"
    if resp.status_code >= 400:
        return f"{gw} {resp.status_code}: {openrouter_error_text(resp.text)}"
    try:
        data = resp.json()
        if data.get("error"):
            return f"{gw} error: {openrouter_error_text(resp.text)}"
        if not (data.get("choices") or []):
            return f"{gw} returned no choices"
    except Exception as exc:
        return f"unreadable {gw} response: {exc}"
    return None


def probe_model_live(model_id: str, timeout_seconds: float = 25.0) -> Optional[str]:
    """
    Ask OpenRouter for one token from `model_id` in the chatbot's request shape.
    Returns None when some shape works, else the provider's error text.

    Saving a model the account cannot actually call took the chatbot down for
    every institute (2026-09-04, z-ai/glm-5.3-flash). The registry knows the id
    exists; only a real call knows whether OUR key may use it, in OUR shape.

    Shapes are tried in the order the runtime client uses them: as configured
    (reasoning off when suppression is on), then reasoning explicitly on, then
    on without a temperature parameter. A model that only works with reasoning
    on is saved, the client is told which shape to use, and the portal shows
    the note.
    """
    from .chat_llm_client import mark_reasoning_required, _mode_note

    settings = get_settings()
    api_key = getattr(settings, "openrouter_api_key", None)
    if not api_key:
        return None  # nothing to test against; don't block the save
    disable = bool(get_platform_setting("chatbot.llm.disable_reasoning", default=settings.llm_disable_reasoning))
    modes = (["disabled"] if disable else []) + ["on-low", "on", "on-no-temp"]
    last_error: Optional[str] = None
    for mode in modes:
        err = _openrouter_one_token(model_id, mode, api_key, timeout_seconds)
        if err is None:
            if mode != "disabled" and disable:
                mark_reasoning_required(model_id, mode)
                record_model_success(model_id)
                record_model_note(model_id, f"{_mode_note(mode)}. Provider said: {(last_error or '')[:120]}")
            return None
        last_error = err
        if mode == "disabled" and "reasoning" not in err.lower():
            # Not a reasoning complaint: a different shape won't help.
            return err
    return last_error


def set_platform_setting(db: Session, key: str, value: Any, updated_by: Optional[str]) -> None:
    """Validate and upsert one setting, then drop the cache so it applies at once."""
    spec = SETTING_SPECS.get(key)
    if spec is None:
        raise KeyError(f"Unknown platform setting: {key}")
    coerced = _coerce(spec, value)
    if key == "llm.model_routes":
        problem = _check_model_routes(coerced)
        if problem:
            raise ValueError(f"llm.model_routes not saved — {problem}")
    if spec.type == "model" and coerced and not _model_exists(db, coerced, spec.catalog):
        what = "an active image model" if spec.catalog == "image" else "an active chat model"
        raise ValueError(f"{coerced} is not {what} in the ai_models registry")
    # Only chat models are exercised live: image models don't take a chat
    # completion, and the runtime fallback is for the chatbot path.
    if spec.type == "model" and coerced and getattr(spec, "catalog", "chat") != "image":
        problem = probe_model_live(coerced)
        if problem:
            raise ValueError(
                f"{coerced} cannot be used with the platform's OpenRouter account — not saved. {problem}"
            )
        record_model_success(coerced)

    db.execute(
        text(
            """
            INSERT INTO ai_platform_settings (setting_key, setting_value, updated_by, updated_at)
            VALUES (:k, CAST(:v AS JSONB), :u, now())
            ON CONFLICT (setting_key)
            DO UPDATE SET setting_value = EXCLUDED.setting_value,
                          updated_by = EXCLUDED.updated_by,
                          updated_at = now()
            """
        ),
        {"k": key, "v": json.dumps(coerced), "u": updated_by},
    )
    db.commit()
    invalidate_platform_settings_cache()


def reset_platform_setting(db: Session, key: str) -> None:
    """Remove the override so the environment default applies again."""
    if key not in SETTING_SPECS:
        raise KeyError(f"Unknown platform setting: {key}")
    db.execute(text("DELETE FROM ai_platform_settings WHERE setting_key = :k"), {"k": key})
    db.commit()
    invalidate_platform_settings_cache()


__all__ = [
    "SETTING_SPECS",
    "GROUP_LABELS",
    "get_platform_setting",
    "get_cache_status",
    "record_model_failure",
    "record_model_success",
    "record_model_note",
    "get_model_notes",
    "get_model_health",
    "probe_model_live",
    "invalidate_platform_settings_cache",
    "list_platform_settings",
    "set_platform_setting",
    "reset_platform_setting",
]
