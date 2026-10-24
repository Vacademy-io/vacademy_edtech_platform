import logging
import os
from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv


def _load_env_file() -> None:
    """
    Load environment variables from a .env file based on APP_ENV.
    Default APP_ENV is 'stage'. Supports:
      - .env
      - .env.<APP_ENV> (e.g., .env.stage)
    Files later in the list override earlier ones.
    """
    app_env = os.getenv("APP_ENV", "stage")

    # Load base .env first, then env-specific to allow overrides
    base_env = os.path.join(os.getcwd(), ".env")
    load_dotenv(dotenv_path=base_env, override=False)

    env_specific = os.path.join(os.getcwd(), f".env.{app_env}")
    if os.path.exists(env_specific):
        load_dotenv(dotenv_path=env_specific, override=True)


_load_env_file()

# The platform JWT signing key that used to be hardcoded here (and in
# common_service JwtService). Kept ONLY as a fallback until JWT_SECRET_KEY is set
# everywhere; then it goes, and the key is rotated.
_LEGACY_JWT_SECRET_FALLBACK = "357638792F423F4428472B4B6250655368566D597133743677397A2443264629"


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    """
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    # App
    app_name: str = "AI Service"
    app_env: str = "stage"
    api_base_path: str = "/ai-service"
    host: str = "0.0.0.0"
    port: int = 8077

    # CORS
    cors_allow_origins: str = "*"  # comma-separated list
    cors_allow_credentials: bool = True
    cors_allow_methods: str = "*"
    cors_allow_headers: str = "*"

    # Database (connect to admin-core-service DB)
    # Preferred: provide a SQLAlchemy/Psycopg URL via DATABASE_URL
    database_url: Optional[str] = None
    # Fallbacks to build URL:
    db_username: Optional[str] = os.getenv("DB_USERNAME")
    db_password: Optional[str] = os.getenv("DB_PASSWORD")
    db_host: Optional[str] = os.getenv("DB_HOST")
    db_port: Optional[int] = int(os.getenv("DB_PORT", "5432"))
    db_name: Optional[str] = os.getenv("DB_NAME")
    db_schema: Optional[str] = os.getenv("DB_SCHEMA")  # optional; defaults to DB default search_path
    # If only JDBC URL is available from admin core envs, we can parse it
    admin_core_jdbc_url: Optional[str] = os.getenv("ADMIN_CORE_SERVICE_DB_URL")

    # HOTFIX (ppt-anim backfill): the media-service Postgres is a SEPARATE DB, so
    # reading its file_metadata needs its own DSN, e.g.
    # postgresql://user:pass@host:5432/media_service
    media_service_db_url: Optional[str] = os.getenv("MEDIA_SERVICE_DB_URL")

    # SQLAlchemy pool tuning
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout_seconds: int = 30
    db_pool_recycle_seconds: int = 1800  # 30 minutes
    # Trigger git status

    # LLM Configuration - Using OpenRouter (your working API key)
    llm_base_url: str = "https://openrouter.ai/api/v1/chat/completions"
    openrouter_api_key: Optional[str] = None  # Will be populated from OPENROUTER_API_KEY env var
    # Isoquant (OpenAI-compatible gateway). Only models listed in the route map
    # (services/llm_router.py) go there; unset = everything stays on OpenRouter.
    isoquant_api_key: Optional[str] = None  # ISOQUANT_API_KEY
    # Last-resort default chat model. Release 2 (2026-10-13): the base tier is
    # the 'platform_default' row in ai_model_defaults (super-admin portal);
    # this env value only applies when that lookup fails. GLM by default
    # (constants/model_defaults.GLM_DEFAULT); the deploy workflow sets the same.
    llm_default_model: str = os.getenv("LLM_DEFAULT_MODEL", "z-ai/glm-5.3-flash")
    # Failover model when the chosen model fails (ChatLLMClient, call
    # intelligence). Deliberately a DIFFERENT vendor than the GLM default, so a
    # GLM outage never fails over GLM -> GLM (NON_GLM_FALLBACK).
    llm_fallback_model: str = os.getenv("LLM_FALLBACK_MODEL", "google/gemini-2.5-flash")
    # CRM Call Intelligence (call_intelligence_service). Founder decision
    # 2026-09-11: on by default for every AI-agent call at no extra charge, so
    # the per-call cost has to be near zero. Measured on OpenRouter against a
    # real 209 s Hindi call: GLM-5.3-flash ~$0.0004 per call for the analysis;
    # for transcription, whisper-large-v3-turbo ($0.0002/min) locked onto the
    # English screener in the first 30 s and rendered the whole Hindi call as
    # garbled English (with or without language=hi), whisper-large-v3 dropped
    # sentences, gpt-4o-mini-transcribe ($0.0017/min) was clean Devanagari with
    # code-switching intact — so that is the default. Both overridable.
    # (The render-box Whisper this replaces failed 45% of runs "at capacity".)
    call_intel_llm_model: str = os.getenv("CALL_INTEL_LLM_MODEL", "z-ai/glm-5.3-flash")
    call_intel_stt_model: str = os.getenv("CALL_INTEL_STT_MODEL", "openai/gpt-4o-mini-transcribe")
    # "openrouter" (default) | "render" — the render worker stays as the fallback
    # when OpenRouter transcription fails and RENDER_SERVER_URL is configured.
    call_intel_stt_backend: str = os.getenv("CALL_INTEL_STT_BACKEND", "openrouter")
    # NOTE: the deploy workflow (docker-publish-ai-service.yml) re-applies
    # LLM_DEFAULT_MODEL / LLM_FALLBACK_MODEL on every deploy; change them there.
    #
    # Suppress provider-side "reasoning" tokens on chat completions. Reasoning
    # models otherwise spend hundreds of hidden output tokens before answering,
    # which is wasted on this workload: the median learner message is 23
    # characters and the bulk of traffic is greetings, "yes"/"idk" and quiz
    # acknowledgements. Measured on one real student question with
    # qwen/qwen3.7-flash: reasoning on = 6.9s and 1,358 completion tokens;
    # reasoning off = 1.7s and 180 tokens, for the same quality of reply.
    # Verified accepted (and NOT suppressing tool calls) on gemini-2.5-flash,
    # qwen3.7-flash and gpt-5.6-luna, streaming and non-streaming.
    llm_disable_reasoning: bool = os.getenv("LLM_DISABLE_REASONING", "true").lower() == "true"
    # Other models we've validated:
    # - google/gemini-2.5-pro
    # - openai/gpt-4o
    # - openai/gpt-4o-mini
    # Free-tier (low quality on structured HTML output, kept as last-resort fallback only):
    # - xiaomi/mimo-v2-flash:free
    # - mistralai/devstral-2512:free
    # - nvidia/nemotron-3-nano-30b-a3b:free
    llm_timeout_seconds: float = 60.0

    # S3 Configuration (for generated course images and AI videos)
    # Uses same config as media-service
    s3_aws_access_key: Optional[str] = None
    s3_aws_access_secret: Optional[str] = None
    s3_aws_region: Optional[str] = None
    aws_bucket_name: Optional[str] = None
    
    # AWS Configuration (alternative naming from media-service)
    aws_access_key: Optional[str] = None
    aws_secret_key: Optional[str] = None
    aws_region: str = "ap-south-1"
    aws_s3_public_bucket: Optional[str] = None

    # CloudFront distribution fronting the bucket ai_service uploads to
    # (CDN_PUBLIC_BASE_URL). When set, newly emitted media URLs use this host
    # instead of https://{bucket}.s3.amazonaws.com. Leave unset until a
    # distribution actually fronts aws_bucket_name — the Java-side distribution
    # currently fronts only the *-public bucket.
    cdn_public_base_url: Optional[str] = None

    # Google Generative AI Configuration (for Gemini image generation)
    gemini_api_key: Optional[str] = None

    # MathPix (PDF → Markdown/HTML conversion for question generation). Defaults
    # preserve the media_service credentials so the migrated PDF flow works
    # out-of-box; override via MATHPIX_APP_ID / MATHPIX_APP_KEY.
    mathpix_app_id: str = os.getenv("MATHPIX_APP_ID", "vacademy_8e6a90_950081")
    mathpix_app_key: str = os.getenv(
        "MATHPIX_APP_KEY",
        "b27375705e35a88b52f041c5f8eba2dda6a23f36350300d39854c8301b1a9de4",
    )
    # docconverter.pro (DOCX → HTML). Token fetched at runtime if not set.
    docconverter_base_url: str = os.getenv("DOCCONVERTER_BASE_URL", "https://api.docconverter.pro")

    # RunPod Configuration (legacy PiP avatar via EchoMimic)
    runpod_api_key: Optional[str] = None
    runpod_endpoint_id: Optional[str] = None

    # fal.ai Configuration (per-shot host-avatar talking-head video).
    # Used by app/services/fal_avatar_client.py when request.host.type == "avatar".
    # Supported custom-avatar models (see schemas/video_generation.py::AvatarModelLiteral
    # for the source of truth): fal-ai/flashtalk, fal-ai/kling-video/ai-avatar/v2/{standard,pro},
    # fal-ai/heygen/avatar4/image-to-video, veed/fabric-1.0. Plus the built-in
    # catalog routes argil/avatars/audio-to-video and veed/avatars/audio-to-video.
    fal_api_key: Optional[str] = None

    # YouTube API Configuration
    youtube_api_key: Optional[str] = None

    # YouTube captions through a proxy (services/youtube_captions). Secrets: set
    # only in the k8s secret (vacademy-secrets), never in code or platform settings.
    # YT_CAPTIONS_PROXY = webshare | generic | off (default off).
    yt_captions_proxy: Optional[str] = None
    webshare_proxy_username: Optional[str] = None        # Webshare Rotating Residential
    webshare_proxy_password: Optional[str] = None
    yt_captions_proxy_http_url: Optional[str] = None     # generic mode; URLs carry credentials
    yt_captions_proxy_https_url: Optional[str] = None
    supadata_api_key: Optional[str] = None               # secondary caption provider

    # Sarvam AI Configuration (for Indian-language STT/TTS)
    sarvam_api_key: str = ""

    # Pexels API Configuration (comma-separated keys for round-robin rotation)
    pexels_api_keys: str = ""

    # Pixabay API Configuration (comma-separated keys for round-robin rotation)
    pixabay_api_keys: str = ""

    # Serper API Configuration (Google Image / Video / Web search; comma-separated
    # keys for round-robin rotation). Used by news_recap and other videos that
    # need real photos of named entities (people, places, brands, events).
    serper_api_keys: str = ""

    # Render Worker (dedicated Hetzner server for video rendering)
    render_server_url: str = os.getenv("RENDER_SERVER_URL", "")
    render_server_key: str = os.getenv("RENDER_SERVER_KEY", "")
    # Public URL of THIS AI service (used as the callback target the render
    # worker POSTs progress/completion to). Defaults to the stage gateway so
    # production-like deployments work out of the box; override in prod /
    # dev with AI_SERVICE_PUBLIC_URL. Empty string disables push entirely.
    ai_service_public_url: str = os.getenv(
        "AI_SERVICE_PUBLIC_URL", "https://backend-stage.vacademy.io/"
    )

    # Internal Auth Configuration
    client_name: str = os.getenv("CLIENT_NAME", "ai_service")
    client_secret: Optional[str] = os.getenv("CLIENT_SECRET")
    auth_service_base_url: str = os.getenv("AUTH_SERVICE_BASE_URL", "http://auth-service:8071")
    # admin_core_service base URL — used by the Vacademy Assistant's data tools
    # (find_learner via the caller's JWT; student-360 via internal HMAC headers).
    admin_core_service_base_url: str = os.getenv(
        "ADMIN_CORE_SERVICE_BASE_URL", "http://admin-core-service:8072"
    )
    # media_service base URL — used by migrated file-dependent features (lecture
    # feedback, question-from-pdf/audio/image) to resolve a media fileId to a
    # presigned S3 URL via /media-service/internal/get-url/id. media_service
    # permanently owns file storage.
    media_server_base_url: str = os.getenv("MEDIA_SERVER_BASE_URL", "http://media-service:8075")
    # assessment_service base URL — used by the migrated AI evaluation tool to
    # fetch assessment metadata (questions + per-question marking rubric) via the
    # internal HMAC-gated endpoint /assessment-service/internal/evaluation-tool/
    # metadata/{assessmentId}. Authenticated with client_name + client_secret
    # (clientName / Signature headers), same scheme media_service used.
    assessment_service_base_url: str = os.getenv("ASSESSMENT_SERVICE_BASE_URL", "http://assessment-service:8074")
    # notification_service base URL — used by the Vacademy Assistant's
    # announcement tools (send via confirm-card, list planned/past).
    notification_service_base_url: str = os.getenv(
        "NOTIFICATION_SERVICE_BASE_URL", "http://notification-service:8076"
    )

    # JWT Configuration (Shared with Java services)
    # Read from JWT_SECRET_KEY (same value as common_service JwtService). The
    # built-in value is a temporary fallback only — it is public in this repo —
    # and get_settings() logs a WARNING when JWT_SECRET_KEY is unset or still
    # equals that public value.
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", _LEGACY_JWT_SECRET_FALLBACK)
    jwt_algorithm: str = "HS256"
    # Voice sockets verify any token they are given. Flip this on once every
    # client ships one, and unauthenticated calls are refused outright.
    voice_require_auth: bool = os.getenv("VOICE_REQUIRE_AUTH", "false").lower() == "true"
    chat_require_auth: bool = os.getenv("CHAT_REQUIRE_AUTH", "false").lower() == "true"
    jwt_token_expiry_minutes: int = 43200  # 30 days in minutes (matching Java 2592000000ms)

    # Internal service-to-service auth.
    # Used by admin_core_service when calling /credits/v1/internal/* endpoints
    # (credit-pack purchase fulfillment from the Razorpay webhook handler).
    # Compared in constant time inside require_internal_service_token().
    # MUST be set in production; if unset, the internal endpoints reject all
    # requests (no implicit fallback).
    internal_service_token: Optional[str] = os.getenv("INTERNAL_SERVICE_TOKEN")

    # Platform staff allowed on /super-admin/v1/* and the other global writes
    # (credit rate, credit grants, model registry): comma-separated auth user ids,
    # compared exactly with the caller's user id. Ids, not usernames: a username
    # can be renamed by its owner (and case-varied), an id cannot. Same people as
    # the health-check portal's PORTAL_ALLOWED_USERS. Unset = nobody (fail closed).
    super_admin_user_ids: Optional[str] = os.getenv("SUPER_ADMIN_USER_IDS")

    # ── MCP server (Model Context Protocol) ────────────────────────────────
    # ON by default. The real access control is per-institute
    # (MCP_SERVER_SETTING: enabled + role allow-list, learners never) and is
    # re-checked on every request, so the endpoint merely existing grants nobody
    # anything: an un-opted-in institute is refused, and an unauthenticated
    # caller gets a 401. A global switch on top of that bought no safety and only
    # made the server depend on a deploy-time variable, so it defaults on and
    # exists purely as an emergency kill switch (set MCP_SERVER_ENABLED=false).
    mcp_server_enabled: bool = os.getenv("MCP_SERVER_ENABLED", "true").lower() == "true"
    # Public URL of the MCP endpoint. It is BOTH the OAuth issuer and the RFC 8707
    # resource identifier, so it must be the externally reachable URL and must be
    # HTTPS (the SDK exempts localhost for local development).
    mcp_issuer_url: str = os.getenv(
        "MCP_ISSUER_URL",
        f"{os.getenv('AI_SERVICE_PUBLIC_URL', 'https://backend-stage.vacademy.io/').rstrip('/')}/ai-service/mcp",
    )
    # Where the browser is sent to log in and approve a connection.
    admin_dashboard_url: str = os.getenv("ADMIN_DASHBOARD_URL", "https://dash.vacademy.io")
    # Default learner-portal origin for institutes without their own domain
    # (institutes.learner_portal_base_url). Catalogue sites are served there.
    learner_dashboard_url: str = os.getenv("LEARNER_DASHBOARD_URL", "https://learner.vacademy.io")
    # Encrypts the platform tokens stored against each grant. Prefer a dedicated
    # key (generate: Fernet.generate_key()). Falls back to another server-side
    # secret so the MCP server does not need a deploy-time variable to come up —
    # see resolve_mcp_encryption_key(), which is what the code actually uses.
    mcp_token_encryption_key: Optional[str] = os.getenv("MCP_TOKEN_ENCRYPTION_KEY")
    mcp_access_token_ttl_seconds: int = int(os.getenv("MCP_ACCESS_TOKEN_TTL_SECONDS", "3600"))
    mcp_refresh_token_ttl_seconds: int = int(os.getenv("MCP_REFRESH_TOKEN_TTL_SECONDS", str(30 * 24 * 3600)))
    # A parked /authorize request: long enough to log in, short enough to matter.
    mcp_auth_txn_ttl_seconds: int = int(os.getenv("MCP_AUTH_TXN_TTL_SECONDS", "900"))
    # An issued authorization code. OAuth 2.1 recommends a maximum of 10 minutes.
    mcp_auth_code_ttl_seconds: int = int(os.getenv("MCP_AUTH_CODE_TTL_SECONDS", "300"))

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    def resolve_mcp_encryption_key(self) -> str:
        """
        The secret used to encrypt stored platform tokens.

        Prefers a dedicated MCP_TOKEN_ENCRYPTION_KEY. When none is set, falls
        back to another secret this service already holds, so the MCP server
        comes up without a deploy-time variable — the alternative was refusing
        to mount, which made the feature depend on config that not every deploy
        path can set.

        The fallbacks are deliberately server-side secrets that are always
        present and never leave the cluster. TokenCipher stretches whatever it
        gets through SHA-256, so a passphrase-shaped value is fine. Key
        separation is still better practice: set MCP_TOKEN_ENCRYPTION_KEY in
        production so rotating the JWT secret does not also invalidate every
        stored MCP grant.
        """
        for candidate in (self.mcp_token_encryption_key, self.internal_service_token, self.jwt_secret_key):
            if candidate:
                return candidate
        # Unreachable in practice: jwt_secret_key carries a default.
        raise ValueError("No secret available to encrypt MCP platform tokens.")

    def build_sqlalchemy_url(self) -> str:
        """
        Derive the SQLAlchemy URL to connect to Postgres.
        Priority:
          1) self.database_url (already in sqlalchemy format)
          2) Build from discrete DB_* variables
          3) Convert from JDBC ADMIN_CORE_SERVICE_DB_URL if present
        """
        if self.database_url:
            return self.database_url

        # Build from discrete parts
        if self.db_host and self.db_name and self.db_username is not None:
            password_part = f":{self.db_password}" if self.db_password else ""
            return f"postgresql+psycopg://{self.db_username}{password_part}@{self.db_host}:{self.db_port}/{self.db_name}"

        # Convert from JDBC
        if self.admin_core_jdbc_url:
            # Example JDBC: jdbc:postgresql://host:5432/dbname?sslmode=disable&currentSchema=my_schema
            jdbc = self.admin_core_jdbc_url
            if jdbc.startswith("jdbc:"):
                jdbc = jdbc[len("jdbc:") :]
            # Strip query params for base; capture schema if provided
            base, _, query = jdbc.partition("?")
            # base now like postgresql://host:port/db
            # Convert to sqlalchemy + psycopg URL
            # Username/password may come from env DB_USERNAME/DB_PASSWORD
            user = self.db_username or ""
            pwd = f":{self.db_password}" if self.db_password else ""
            # Ensure protocol is postgresql+psycopg
            base = base.replace("postgresql://", "postgresql+psycopg://")
            url = base
            if user:
                # Insert credentials after protocol
                protocol_sep = "://"
                proto, _, rest = url.partition(protocol_sep)
                url = f"{proto}{protocol_sep}{user}{pwd}@{rest}"
            # Extract schema from query if present
            if query:
                for part in query.split("&"):
                    if part.startswith("currentSchema="):
                        schema = part.split("=", 1)[1]
                        if schema:
                            # Keep schema for later use
                            object.__setattr__(self, "db_schema", schema)
                        break
            return url

        raise ValueError(
            "Database configuration missing. Provide DATABASE_URL, or DB_HOST/DB_NAME/DB_USERNAME, "
            "or ADMIN_CORE_SERVICE_DB_URL plus DB_USERNAME/DB_PASSWORD."
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    if not os.getenv("JWT_SECRET_KEY"):
        logging.getLogger(__name__).warning(
            "JWT_SECRET_KEY is not set: verifying tokens with the built-in fallback key, "
            "which is public. Set JWT_SECRET_KEY to the common_service signing key."
        )
    elif settings.jwt_secret_key == _LEGACY_JWT_SECRET_FALLBACK:
        logging.getLogger(__name__).warning(
            "JWT_SECRET_KEY equals the legacy key that is public in this repo; rotate it "
            "(together with common_service)."
        )
    return settings


