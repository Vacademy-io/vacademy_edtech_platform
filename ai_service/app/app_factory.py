from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import sys

from .config import get_settings
from .core.server_timing import ServerTimingMiddleware
from .routers.health import router as health_router
from .routers.course_outline import router as course_outline_router
from .routers.content_generation import router as content_generation_router
from .routers.video_generation import router as video_generation_router
from .routers.models import router as models_router
from .routers.api_keys import router as api_keys_router
from .routers.token_usage import router as token_usage_router
from .routers.chat_bot import router as chat_bot_router
from .routers.tts import router as tts_router
from .routers.chat_agent import router as chat_agent_router
from .routers.assistant import router as assistant_router
from .routers.validation import router as validation_router
from .routers.institute_settings import router as institute_settings_router
from .routers.utils import router as utils_router
from .routers.institute_api_keys import router as institute_api_keys_router
from .routers.external_video_generation import router as external_video_generation_router
from .routers.lms_video import router as lms_video_router
from .routers.auth_test import router as auth_test_router
from .routers.credits import router as credits_router
from .routers.ai_models import router as ai_models_router
from .routers.super_admin import router as super_admin_router
from .routers.super_admin_models import router as super_admin_models_router
from .routers.super_admin_ai_video_policy import router as super_admin_ai_video_policy_router
from .routers.youtube_captions_admin import router as youtube_captions_admin_router
from .routers.internal_llm import router as internal_llm_router
from .routers.llm_keys_admin import router as llm_keys_admin_router
from .routers.credits_v2 import router as credits_v2_router
from .routers.metering_admin import router as metering_admin_router
from .routers.credits_limits import router as credits_limits_router
from .routers.metering_limits_admin import router as metering_limits_admin_router
from .routers.metering_internal import router as metering_internal_router
from .routers.plans_admin import router as plans_admin_router
from .routers.plans_internal import router as plans_internal_router
from .routers.plans_billing_internal import router as plans_billing_internal_router
from .routers.credits_plan import router as credits_plan_router
from .routers.content_ingestion import router as content_ingestion_router
from .routers.learning_analytics import router as learning_analytics_router
from .routers.mathpix import router as mathpix_router
from .routers.knowledge_base import router as knowledge_base_router
from .routers.course_knowledge import router as course_knowledge_router
from .routers.course_knowledge_links import router as course_knowledge_links_router
from .routers.kb_paper import router as kb_paper_router
from .routers.kb_companion import router as kb_companion_router
from .site_assistant.router import router as site_assistant_router
from .routers.paper_digitise import router as paper_digitise_router
from .routers.kb_library import router as kb_library_router
from .routers.voice_agent import router as voice_agent_router
from .routers.tutor import router as tutor_router
from .routers.tutor_ws import router as tutor_ws_router
from .routers.input_asset import router as input_asset_router
from .routers.reels import router as reels_router
from .routers.studio_projects import router as studio_router
from .routers.transcription import router as transcription_router
from .routers.assessment_generation import router as assessment_generation_router
from .routers.coding_question_gen import router as coding_question_gen_router
from .routers.brand_kit_scrape import router as brand_kit_scrape_router
from .routers.transcript_notes import router as transcript_notes_router
from .routers.html_document import router as html_document_router
from .routers.engagement_plan import router as engagement_plan_router
from .routers.page_builder import router as page_builder_router
from .routers.course_assist import router as course_assist_router
from .routers.copy_check import router as copy_check_router
from .routers.omr import router as omr_router
from .routers.lecture import router as lecture_router
from .routers.ai_task_status import router as ai_task_status_router
from .routers.presentation import router as presentation_router
from .routers.incident import router as incident_router
from .routers.question_metadata import router as question_metadata_router
from .routers.question_gen import router as question_gen_router
from .routers.pdf_questions import router as pdf_questions_router
from .routers.audio_questions import router as audio_questions_router
from .routers.chat_with_pdf import router as chat_with_pdf_router
from .routers.retry import router as retry_router
from .routers.translation import router as translation_router

from .db import db_session
from .repositories.ai_task_repository import ensure_ai_task_schema
from .models.file_conversion import ensure_file_conversion_schema
from .models.chat_quiz_state import ensure_chat_quiz_state_schema
from .services.ai_task_service import sweep_stale_tasks



# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)


@asynccontextmanager
def _warm_billing_indexes(logger: logging.Logger) -> None:
    """Load the AI-plan subscription index and the usage-limits policy index once,
    before the pod serves traffic. Both are otherwise loaded lazily in the
    background, so a fresh pod's first requests saw empty sets: a plan-covered use
    was charged to the wallet (the engine's fail-safe) until the first refresh
    landed. A failure here only logs; the lazy refresh still runs as before."""
    try:
        from .services.metering import plans as _plans
        if not _plans.refresh_index():
            logger.warning("ai plans index warm-up did not load; lazy refresh will retry")
    except Exception as exc:  # noqa: BLE001
        logger.warning("ai plans index warm-up skipped: %s", exc)
    try:
        from .services.metering import limits as _limits
        _limits.refresh_policy_index()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ai limits index warm-up skipped: %s", exc)


async def _lifespan(app: FastAPI):
    """Startup: ensure the ai_task schema exists (idempotent) and sweep any
    PROGRESS rows orphaned by a prior restart to FAILED."""
    _logger = logging.getLogger(__name__)
    try:
        with db_session() as db:
            ensure_ai_task_schema(db)
            ensure_file_conversion_schema(db)
            ensure_chat_quiz_state_schema(db)
            from .repositories.ai_video_cast_repository import ensure_ai_video_cast_schema
            ensure_ai_video_cast_schema(db)
            from .models.tutor_tts_cache import ensure_tutor_tts_cache_schema
            ensure_tutor_tts_cache_schema(db)
            from .models.tutor_asset_registry import ensure_tutor_asset_registry_schema
            ensure_tutor_asset_registry_schema(db)
            from .services.tutor.demo import ensure_tutor_demo_schema
            ensure_tutor_demo_schema(db)
        sweep_stale_tasks()
    except Exception as exc:  # noqa: BLE001
        _logger.warning("ai_task startup init skipped: %s", exc)
    _warm_billing_indexes(_logger)
    # Orphaned AI-video runs (deploy/crash killed the in-process pipeline
    # task): refund + mark FAILED so slides stop spinning forever. Sweeps at
    # startup and every 30 min (a crash's own orphans are younger than the TTL
    # at boot). Lazy import so a module issue can't block app boot.
    try:
        from .services.ai_video_sweeper import start_ai_video_sweeper
        start_ai_video_sweeper()
    except Exception as exc:  # noqa: BLE001
        _logger.warning("ai_gen_video sweeper skipped: %s", exc)
    # AI-video auto-resume: runs whose leg died (deploy / OOM / node loss) are
    # claimed (lease compare-and-set — one pod wins) and resumed from their
    # checkpoints. First scan 30 s after boot, then every 90 s ± 20 s.
    try:
        from .services.ai_video_resumer import start_ai_video_resumer
        start_ai_video_resumer()
    except Exception as exc:  # noqa: BLE001
        _logger.warning("ai_gen_video resumer skipped: %s", exc)
    # Reels stuck-render reaper: sweeps PENDING/IN_PROGRESS rows orphaned by
    # a deploy/crash (in-process asyncio renders die with the process) every
    # 5 min. Lazy import so a reels-module issue can't block app boot.
    try:
        from .services.reels_render_orchestrator import start_reels_reaper
        start_reels_reaper()
    except Exception as exc:  # noqa: BLE001
        _logger.warning("reels reaper startup skipped: %s", exc)
    # CRM Call Intelligence: drains the call_intelligence work queue (transcribe +
    # LLM analysis of call recordings) every tick. FOR UPDATE SKIP LOCKED makes it
    # safe across replicas. Lazy import so a module issue can't block app boot.
    try:
        from .services.call_intelligence_poller import start_call_intelligence_poller
        start_call_intelligence_poller()
    except Exception as exc:  # noqa: BLE001
        _logger.warning("call-intelligence poller startup skipped: %s", exc)
    # Learner profile (admin_core V608): reads idle Student AI chats of allowlisted
    # institutes into evidence rows. Idles while learner_profile.enabled is off.
    try:
        from .services.learner_profile.poller import start_learner_profile_poller
        start_learner_profile_poller()
    except Exception as exc:  # noqa: BLE001
        _logger.warning("learner-profile poller startup skipped: %s", exc)
    # Copy-check billing reconciliation (spec 10.5): nightly, flags graded copies
    # of the last 48 h that have no credit transaction. One replica runs it
    # (advisory lock). Lazy import so a module issue can't block app boot.
    try:
        from .services.copy_check.billing_reconciliation import start_billing_reconciliation
        start_billing_reconciliation()
    except Exception as exc:  # noqa: BLE001
        _logger.warning("copy-check billing reconciliation startup skipped: %s", exc)
    # Vacademy Assistant help corpus: keep the deployed pgvector corpus in sync
    # with app/data/help_knowledge.jsonl. Change-detected, so an unchanged corpus
    # is a no-op. Lazy import + background task so it can't block app boot.
    try:
        from .services.help_corpus_sync import start_help_corpus_sync
        start_help_corpus_sync()
    except Exception as exc:  # noqa: BLE001
        _logger.warning("help corpus sync startup skipped: %s", exc)
    # Course knowledge (admin_core V600): tables only admin_core Flyway creates, so
    # no DDL here, only a check that logs an error naming the migration when one is
    # missing. Before the MCP early return below so it runs whether or not MCP is on.
    try:
        with db_session() as db:
            from .services.course_knowledge.schema_check import check_course_knowledge_schema
            check_course_knowledge_schema(db)
    except Exception as exc:  # noqa: BLE001
        _logger.error("course knowledge schema check skipped: %s", exc)
    # Course knowledge indexing worker: drains content_index_queue. It idles while
    # course_knowledge.enabled is off. Lazy import so a module issue can't block app boot.
    try:
        from .services.course_knowledge.worker import start_course_knowledge_worker
        start_course_knowledge_worker()
    except Exception as exc:  # noqa: BLE001
        _logger.warning("course knowledge worker startup skipped: %s", exc)

    # MCP: the Streamable HTTP session manager needs a task group alive for the
    # whole app lifetime. Mounting the SDK's ASGI app bypasses its own lifespan,
    # so the host app has to run it or every MCP request fails.
    mcp_server = getattr(app.state, "mcp_server", None)
    if mcp_server is None:
        try:
            yield
        finally:
            await _stop_course_knowledge_worker(_logger)
        return

    try:
        with db_session() as db:
            from .mcp.schema import ensure_mcp_schema
            ensure_mcp_schema(db)
    except Exception as exc:  # noqa: BLE001
        _logger.warning("mcp schema init skipped: %s", exc)
    # Tables only admin_core Flyway creates (V561, V562, V565, V583): no DDL here, only a check
    # that logs an error naming the migration when one is missing. Never raises.
    try:
        with db_session() as db:
            from .models.catalog_data_edit import check_catalog_data_schema
            from .models.crm_confirm import check_crm_confirm_schema
            from .models.design_import import check_design_import_schema
            from .models.file_export import check_file_export_schema
            from .models.publish_confirm import check_publish_confirm_schema
            check_design_import_schema(db)
            check_catalog_data_schema(db)
            check_publish_confirm_schema(db)
            check_crm_confirm_schema(db)
            check_file_export_schema(db)
    except Exception as exc:  # noqa: BLE001
        _logger.error("mcp table check skipped: %s", exc)
    # design_import keeps uploads 24 h: drop expired ones hourly, uploads or not.
    try:
        from .services.assistant_tools_design_import import start_design_import_purger
        start_design_import_purger()
    except Exception as exc:  # noqa: BLE001
        _logger.warning("design_import purger startup skipped: %s", exc)

    try:
        async with mcp_server.session_manager.run():
            yield
    finally:
        await _stop_course_knowledge_worker(_logger)


async def _stop_course_knowledge_worker(logger: logging.Logger) -> None:
    """Shutdown: cancel the indexing worker so a stopping pod (or a test app) leaves no
    task claiming queue rows. A crash here must not block shutdown."""
    try:
        from .services.course_knowledge.worker import stop_course_knowledge_worker
        await stop_course_knowledge_worker()
    except Exception as exc:  # noqa: BLE001
        logger.warning("course knowledge worker shutdown skipped: %s", exc)


def create_app() -> FastAPI:
    settings = get_settings()
    logger = logging.getLogger(__name__)
    logger.info("="*80)
    logger.info("Starting AI Service Application")
    logger.info(f"Environment: {settings.app_env}")
    # API keys loaded from environment (not logging to avoid exposing key status)
    logger.info("="*80)

    # ── Pipeline-version banner ─────────────────────────────────────────
    # v3 is the only supported pipeline. The v2 BeatPlanner→Director chain
    # remains as an internal exception-handler fallback inside
    # `_run_v3_shot_planning`, but is no longer user-selectable. Print the
    # banner + verify `automation_pipeline.QUALITY_TIERS` is importable so
    # any cold-start import failure surfaces immediately in logs (rather
    # than silently downgrading to v2 like the pre-V200 resolution did).
    try:
        import sys as _sys_pv
        from pathlib import Path as _Path_pv
        _aigen_pv = str(_Path_pv(__file__).resolve().parent / "ai-video-gen-main")
        if _aigen_pv not in _sys_pv.path:
            _sys_pv.path.insert(0, _aigen_pv)
        from automation_pipeline import QUALITY_TIERS as _qt_pv  # type: ignore
        _tier_names = sorted(_qt_pv.keys())
        logger.info("🚦 AI video pipeline: v3 (only supported version; v2 deprecated)")
        logger.info(f"   Resolved tier configs: {', '.join(_tier_names)}")
        # Probe v3-only modules explicitly. A partial deploy that left
        # `automation_pipeline.py` in place but lost `shot_planner.py` or
        # `narration_writer.py` would pass the QUALITY_TIERS probe above
        # but crash on every gen request. Surface here instead.
        try:
            from shot_planner import plan_shots  # type: ignore  # noqa: F401
            from narration_writer import write_narration  # type: ignore  # noqa: F401
            logger.info("   ShotPlanner + NarrationWriter modules: OK")
        except Exception as _v3_mod_err:
            logger.error(
                "🚨 v3 critical module probe FAILED (%s) — the pipeline will "
                "always fall back to the v2 safety net on every run. Verify "
                "shot_planner.py + narration_writer.py are present in "
                "ai-video-gen-main/.",
                _v3_mod_err,
            )
    except Exception as _pv_err:
        logger.error(
            "🚦 AI video pipeline boot probe FAILED to import "
            "automation_pipeline.QUALITY_TIERS (%s). Pipeline will still run "
            "v3 unconditionally, but this hints at a deploy/path problem.",
            _pv_err,
        )
    
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url=f"{settings.api_base_path}/docs",
        redoc_url=None,
        openapi_url=f"{settings.api_base_path}/openapi.json",
        lifespan=_lifespan,
    )

    # CORS
    allow_origins = [o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()]
    allow_methods = [m.strip() for m in settings.cors_allow_methods.split(",") if m.strip()]
    allow_headers = [h.strip() for h in settings.cors_allow_headers.split(",") if h.strip()]

    # NOTE: `allow_origins=["*"]` with `allow_credentials=True` is an INVALID CORS
    # combination — browsers reject `Access-Control-Allow-Origin: *` for any
    # credentialed request. Use a regex that ECHOES the request origin (valid
    # with credentials), so it's correct regardless of whether a caller sends
    # credentials, while still effectively allowing all origins.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        # RESPONSE headers the browser is allowed to reveal to JS. Note that
        # allow_headers above is about REQUEST headers and does not cover this, and
        # with allow_credentials=True a wildcard here would be invalid — so
        # Server-Timing has to be listed explicitly or the client reads nothing,
        # silently and with no error.
        # Mcp-* are read by browser-based MCP clients (e.g. the Inspector);
        # without them the session id is invisible to JS and the client cannot
        # continue a stream.
        expose_headers=["Server-Timing", "Mcp-Session-Id", "Mcp-Protocol-Version"],
    )

    # AI usage limits (services/metering/limit_gate.py): LimitExceeded -> HTTP 429
    # {"error": "AI_USAGE_LIMIT", ...} + Retry-After, and the soft-limit header
    # X-AI-Usage-Warning. The middleware sits OUTSIDE CORS so it can expose its
    # headers; it passes every response through untouched unless a limits gate
    # of that request produced a warning or a 429 (only institutes with a limits
    # policy ever do), and installs nothing at all while no institute has one.
    from .services.metering import limit_gate as _limit_gate
    for _exc_type in _limit_gate.limit_exceeded_types():
        app.add_exception_handler(_exc_type, _limit_gate.limit_exceeded_handler)
    app.add_middleware(_limit_gate.LimitHeadersMiddleware)

    # Outermost middleware: stamps how long we took, so the browser can subtract it
    # and attribute the rest of the round trip to the network.
    app.add_middleware(ServerTimingMiddleware)

    # Routers
    app.include_router(health_router, prefix=settings.api_base_path, tags=["health"])
    app.include_router(course_outline_router, prefix=settings.api_base_path)
    app.include_router(content_generation_router, prefix=settings.api_base_path)
    app.include_router(video_generation_router, prefix=settings.api_base_path)
    app.include_router(models_router, prefix=settings.api_base_path)
    app.include_router(api_keys_router, prefix=settings.api_base_path)
    app.include_router(token_usage_router, prefix=settings.api_base_path)
    app.include_router(chat_bot_router, prefix=settings.api_base_path)
    app.include_router(tts_router, prefix=settings.api_base_path)
    app.include_router(chat_agent_router, prefix=settings.api_base_path)
    app.include_router(assistant_router, prefix=settings.api_base_path)
    app.include_router(validation_router, prefix=settings.api_base_path)
    app.include_router(institute_settings_router, prefix=settings.api_base_path)
    app.include_router(utils_router, prefix=settings.api_base_path)
    app.include_router(institute_api_keys_router, prefix=settings.api_base_path)
    app.include_router(external_video_generation_router, prefix=settings.api_base_path)
    # LMS AI Video: chapter-slide videos for staff (JWT + clientId, staff roles).
    app.include_router(lms_video_router, prefix=settings.api_base_path)
    app.include_router(auth_test_router, prefix=settings.api_base_path)
    app.include_router(credits_router, prefix=settings.api_base_path)
    app.include_router(ai_models_router, prefix=settings.api_base_path)
    app.include_router(super_admin_router, prefix=settings.api_base_path)
    # Model defaults per AI feature (/super-admin/v1/models/*), platform staff only.
    app.include_router(super_admin_models_router, prefix=settings.api_base_path)
    # Per-institute AI video policy (/super-admin/v1/institutes/{id}/ai-video-policy), platform staff only.
    app.include_router(super_admin_ai_video_policy_router, prefix=settings.api_base_path)
    # Shared YouTube caption service: health / probe / requeue (/super-admin/v1/youtube-captions/*), platform staff only.
    app.include_router(youtube_captions_admin_router, prefix=settings.api_base_path)
    # Service-to-service chat completion by use case (assessment / community services).
    app.include_router(internal_llm_router, prefix=settings.api_base_path)
    # Vendor API keys for direct LLM gateways (/super-admin/v1/llm/keys), platform staff only.
    app.include_router(llm_keys_admin_router, prefix=settings.api_base_path)
    # AI usage metering: tenant History/Analytics v2 reads + super-admin catalog/role map/parity
    app.include_router(credits_v2_router, prefix=settings.api_base_path)
    app.include_router(metering_admin_router, prefix=settings.api_base_path)
    # AI usage limits: tenant admin (/credits/v2/institutes/{id}/limits) + super admin (/super-admin/v1/metering/limits)
    app.include_router(credits_limits_router, prefix=settings.api_base_path)
    app.include_router(metering_limits_admin_router, prefix=settings.api_base_path)
    # AI usage limits, service-to-service: /internal/metering/v1/authorize + counters/rebuild
    app.include_router(metering_internal_router, prefix=settings.api_base_path)
    # AI subscription plans: super admin (/super-admin/v1/plans), tenant view
    # (/credits/v2/institutes/{id}/plan) and the renewal job (/internal/plans/v1/roll)
    app.include_router(plans_admin_router, prefix=settings.api_base_path)
    app.include_router(credits_plan_router, prefix=settings.api_base_path)
    app.include_router(plans_internal_router, prefix=settings.api_base_path)
    app.include_router(plans_billing_internal_router, prefix=settings.api_base_path)
    app.include_router(content_ingestion_router, prefix=settings.api_base_path)
    app.include_router(learning_analytics_router, prefix=settings.api_base_path)
    app.include_router(mathpix_router, prefix=settings.api_base_path)
    app.include_router(knowledge_base_router, prefix=settings.api_base_path)
    # Course knowledge: Make course AI-ready (admin) and course-to-KB links (V600).
    # Both routers declare /course-knowledge/v1; every route checks its own flag.
    app.include_router(course_knowledge_router, prefix=settings.api_base_path)
    app.include_router(course_knowledge_links_router, prefix=settings.api_base_path)
    # Question papers generated from a knowledge base (V436). Shares the
    # /knowledge-base/v1 prefix and the same Caller auth dependency.
    app.include_router(kb_paper_router, prefix=settings.api_base_path)
    # Student study companions built on a knowledge base (V535).
    app.include_router(kb_companion_router, prefix=settings.api_base_path)
    # Public website assistant for institute sites (hosted + embed), docs/site-assistant.
    app.include_router(site_assistant_router, prefix=settings.api_base_path)
    # A question-paper PDF read into gradable questions for offline tests.
    app.include_router(paper_digitise_router, prefix=settings.api_base_path)
    app.include_router(kb_library_router, prefix=settings.api_base_path)
    app.include_router(voice_agent_router, prefix=settings.api_base_path)
    app.include_router(tutor_router, prefix=settings.api_base_path)
    app.include_router(tutor_ws_router, prefix=settings.api_base_path)
    # Primary path: /input-asset/* — handles both video and image kinds.
    app.include_router(
        input_asset_router,
        prefix=f"{settings.api_base_path}/input-asset",
    )
    # Legacy alias: /input-video/* — kept so existing FE clients keep working
    # until they migrate. Hidden from OpenAPI to avoid duplicate routes in
    # Swagger. The same handlers serve both paths; image rows surface in
    # /input-video/list responses, but pre-migration UIs simply render them
    # as unrecognized cards.
    app.include_router(
        input_asset_router,
        prefix=f"{settings.api_base_path}/input-video",
        include_in_schema=False,
    )
    app.include_router(transcription_router, prefix=settings.api_base_path)
    app.include_router(assessment_generation_router, prefix=settings.api_base_path)
    app.include_router(coding_question_gen_router, prefix=settings.api_base_path)
    app.include_router(brand_kit_scrape_router, prefix=settings.api_base_path)
    app.include_router(transcript_notes_router, prefix=settings.api_base_path)
    app.include_router(html_document_router, prefix=settings.api_base_path)
    app.include_router(engagement_plan_router, prefix=settings.api_base_path)
    app.include_router(page_builder_router, prefix=settings.api_base_path)
    # Inline "generate with AI" for the manual Add Course form fields:
    #   {api_base_path}/course/assist/v1/text  |  /v1/image
    app.include_router(course_assist_router, prefix=settings.api_base_path)
    app.include_router(copy_check_router, prefix=settings.api_base_path)
    # OMR sheet reading (vendored OMRChecker) for assessment_service:
    #   {api_base_path}/omr/v1/read
    app.include_router(omr_router, prefix=settings.api_base_path)
    # Migrated from media_service: AI lecture planner (kick-off) + the
    # task-status polling mirror. Final paths:
    #   {api_base_path}/ai/lecture/generate-plan
    #   {api_base_path}/task-status/{get-status,get-raw-result,get/lecture-plan}
    app.include_router(lecture_router, prefix=settings.api_base_path)
    app.include_router(ai_task_status_router, prefix=settings.api_base_path)
    app.include_router(presentation_router, prefix=settings.api_base_path)
    app.include_router(incident_router, prefix=settings.api_base_path)
    app.include_router(question_metadata_router, prefix=settings.api_base_path)
    app.include_router(question_gen_router, prefix=settings.api_base_path)
    app.include_router(pdf_questions_router, prefix=settings.api_base_path)
    app.include_router(audio_questions_router, prefix=settings.api_base_path)
    app.include_router(chat_with_pdf_router, prefix=settings.api_base_path)
    # /ai/evaluation-tool/* (the logged-out /evaluator-ai free tool) is retired:
    # it ran anonymous AI evaluation against any assessment id. Not mounted.
    app.include_router(retry_router, prefix=settings.api_base_path)
    # i18n Phase 1 — content translation pipeline (estimate / course job /
    # strings / review-approve / job status). Router declares its own
    # /translation/v1 prefix. Final paths: {api_base_path}/translation/v1/*.
    app.include_router(translation_router, prefix=settings.api_base_path)
    # Reels-from-long-video — three-gate funnel (scan/preview/render) +
    # /frame/{add,update,delete} for the editor's `kind=reel` save loop.
    # The router declares its own `/external/reels/v1` prefix; we only add
    # the service-wide `/ai-service` base here. Final paths:
    #   {api_base_path}/external/reels/v1/{scan,preview,render,list,...}
    app.include_router(reels_router, prefix=settings.api_base_path)
    # Vimotion Studio — multi-asset video editing pipeline. P0 contract
    # surface: all endpoints return 501 until P1+ wires the service modules.
    # Router declares its own `/external/studio/v1` prefix. Final paths:
    #   {api_base_path}/external/studio/v1/{projects,builds,...}
    # See docs/ai_content/AI_VIDEO_STUDIO.md for phase status.
    app.include_router(studio_router, prefix=settings.api_base_path)

    # MCP server (Model Context Protocol) — off unless MCP_SERVER_ENABLED.
    # Link-only downloads (e.g. an enrolment's credentials CSV). Outside /ai-service/mcp
    # (the mount below owns that subtree) and mounted whether or not MCP is on: the
    # in-product Assistant runs the same learner tools.
    from .services.file_exports import router as file_exports_router
    app.include_router(file_exports_router)

    # The consent/settings router declares its own absolute /ai-service/mcp/oauth
    # prefix, so it must be registered BEFORE the mount below: Starlette matches
    # routes in order and the mount owns everything under /ai-service/mcp.
    _mount_mcp(app, settings)

    return app


def _mount_mcp(app: FastAPI, settings) -> None:
    """
    Attach the MCP endpoint, its OAuth routes, and the OAuth discovery documents.

    Refuses to mount (rather than degrading) when the encryption key is missing:
    every grant persists the approving user's platform tokens, and storing those
    unencrypted is not an acceptable fallback.
    """
    logger = logging.getLogger(__name__)
    if not settings.mcp_server_enabled:
        logger.info("MCP server disabled (MCP_SERVER_ENABLED is not true).")
        return

    try:
        from starlette.routing import Route

        from .mcp.consent import router as mcp_consent_router
        from .mcp.institute_scope import McpInstitutePathAdapter
        from .mcp.server import McpExactPathAdapter, build_mcp_asgi_app, build_mcp_server
        from .mcp.well_known import build_discovery_routes
    except Exception as exc:  # noqa: BLE001
        logger.error("MCP server could not be imported; not mounting: %s", exc)
        return

    if not settings.mcp_token_encryption_key:
        logger.warning(
            "MCP_TOKEN_ENCRYPTION_KEY is not set; falling back to another server-side "
            "secret to encrypt stored platform tokens. Set a dedicated key in production."
        )

    try:
        mcp_server = build_mcp_server()
        mcp_app = build_mcp_asgi_app(settings, mcp_server)
    except Exception as exc:  # noqa: BLE001
        logger.error("MCP server failed to build; not mounting: %s", exc)
        return

    app.include_router(mcp_consent_router)
    # The exact path first, then the subtree. A Mount alone would answer the
    # bare /ai-service/mcp — the URL users paste into their AI client — with a
    # 307 to the trailing-slash form; see McpExactPathAdapter.
    app.router.routes.append(
        Route(
            f"{settings.api_base_path}/mcp",
            endpoint=McpExactPathAdapter(mcp_app),
            methods=["GET", "POST", "DELETE", "OPTIONS"],
        )
    )
    # Institute-scoped endpoint for white-label institutes (see institute_scope):
    # the same app, with the institute pinned by the path.
    scoped = McpInstitutePathAdapter(mcp_app, settings.mcp_issuer_url)
    for path in (f"{settings.api_base_path}/mcp/i/{{institute_id}}",
                 f"{settings.api_base_path}/mcp/i/{{institute_id}}/"):
        app.router.routes.append(Route(path, endpoint=scoped, methods=["GET", "POST", "DELETE", "OPTIONS"]))
    app.mount(f"{settings.api_base_path}/mcp", mcp_app)

    # RFC 9728 / RFC 8414 discovery lives at the ROOT, not under /ai-service, so
    # the ingress needs a /.well-known route to this service (see the chart).
    for route in build_discovery_routes(settings):
        app.router.routes.append(route)

    # The MCP session manager needs a running task group for the life of the app.
    # The SDK's own lifespan is bypassed when its app is mounted, so the host app
    # owns it — see _lifespan, which reads this back off app.state.
    app.state.mcp_server = mcp_server
    logger.info("MCP server mounted at %s/mcp (issuer %s)", settings.api_base_path, settings.mcp_issuer_url)


