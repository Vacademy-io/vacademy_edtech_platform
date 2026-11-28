"""
AI Models Registry - Database-backed model registry.

This module provides the single source of truth for AI models.
Models are fetched from the `ai_models` database table.

Fallback: If database is unavailable, uses cached/hardcoded defaults.
"""

from typing import Dict, List, Optional
from enum import Enum
import logging
from decimal import Decimal
from functools import lru_cache
from datetime import datetime

from .model_defaults import GLM_DEFAULT, NON_GLM_FALLBACK

logger = logging.getLogger(__name__)


class ModelCategory(str, Enum):
    """Model categories."""
    FREE = "free"
    PAID = "paid"
    GENERAL = "general"
    CODING = "coding"
    VISION = "vision"
    EMBEDDING = "embedding"
    IMAGE = "image"
    TTS = "tts"


class ModelTier(str, Enum):
    """Model pricing tiers."""
    FREE = "free"
    STANDARD = "standard"
    PREMIUM = "premium"
    ULTRA = "ultra"


class ModelInfo:
    """Information about an AI model."""
    
    def __init__(
        self,
        id: str,
        name: str,
        provider: str,
        category: str = "general",
        tier: str = "standard",
        description: str = "",
        max_tokens: Optional[int] = None,
        context_window: Optional[int] = None,
        supports_streaming: bool = True,
        supports_images: bool = False,
        supports_function_calling: bool = False,
        supports_json_mode: bool = False,
        input_price_per_1m: Optional[float] = None,
        output_price_per_1m: Optional[float] = None,
        credit_multiplier: float = 1.0,
        is_free: bool = False,
        recommended_for: Optional[List[str]] = None,
        quality_score: int = 3,
        speed_score: int = 3,
        is_active: bool = True,
        is_default: bool = False,
        is_default_free: bool = False,
    ):
        self.id = id
        self.name = name
        self.provider = provider
        self.category = category
        self.tier = tier
        self.description = description
        self.max_tokens = max_tokens
        self.context_window = context_window
        self.supports_streaming = supports_streaming
        self.supports_images = supports_images
        self.supports_function_calling = supports_function_calling
        self.supports_json_mode = supports_json_mode
        self.input_price_per_1m = input_price_per_1m
        self.output_price_per_1m = output_price_per_1m
        self.credit_multiplier = credit_multiplier
        self.is_free = is_free
        self.recommended_for = recommended_for or []
        self.quality_score = quality_score
        self.speed_score = speed_score
        self.is_active = is_active
        self.is_default = is_default
        self.is_default_free = is_default_free
    
    def get_input_token_price(self) -> Optional[float]:
        """Get price per input token (converts from per 1M to per token)."""
        if self.input_price_per_1m is None:
            return None
        return self.input_price_per_1m / 1_000_000
    
    def get_output_token_price(self) -> Optional[float]:
        """Get price per output token (converts from per 1M to per token)."""
        if self.output_price_per_1m is None:
            return None
        return self.output_price_per_1m / 1_000_000
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "name": self.name,
            "provider": self.provider,
            "category": self.category,
            "tier": self.tier,
            "description": self.description,
            "max_tokens": self.max_tokens,
            "context_window": self.context_window,
            "supports_streaming": self.supports_streaming,
            "supports_images": self.supports_images,
            "supports_function_calling": self.supports_function_calling,
            "supports_json_mode": self.supports_json_mode,
            "input_price_per_1m": self.input_price_per_1m,
            "output_price_per_1m": self.output_price_per_1m,
            "credit_multiplier": self.credit_multiplier,
            "is_free": self.is_free,
            "input_token_price": self.get_input_token_price(),
            "output_token_price": self.get_output_token_price(),
            "quality_score": self.quality_score,
            "speed_score": self.speed_score,
        }


# ============================================================================
# Database Access Functions
# ============================================================================

def _get_models_from_db() -> List[ModelInfo]:
    """Fetch all models from the database."""
    try:
        from ..db import db_session
        from sqlalchemy import text
        
        with db_session() as session:
            query = text("""
                SELECT model_id, name, provider, category, tier,
                       max_tokens, context_window, supports_streaming, supports_images,
                       supports_function_calling, supports_json_mode,
                       input_price_per_1m, output_price_per_1m, credit_multiplier,
                       is_free, recommended_for, quality_score, speed_score,
                       is_active, is_default, is_default_free, description
                FROM ai_models
                WHERE is_active = TRUE
                ORDER BY display_order, name
            """)
            result = session.execute(query)
            rows = result.fetchall()
            
            models = []
            for row in rows:
                model = ModelInfo(
                    id=row.model_id,
                    name=row.name,
                    provider=row.provider,
                    category=row.category,
                    tier=row.tier,
                    max_tokens=row.max_tokens,
                    context_window=row.context_window,
                    supports_streaming=row.supports_streaming,
                    supports_images=row.supports_images,
                    supports_function_calling=row.supports_function_calling,
                    supports_json_mode=row.supports_json_mode,
                    input_price_per_1m=float(row.input_price_per_1m) if row.input_price_per_1m else None,
                    output_price_per_1m=float(row.output_price_per_1m) if row.output_price_per_1m else None,
                    credit_multiplier=float(row.credit_multiplier) if row.credit_multiplier else 1.0,
                    is_free=row.is_free,
                    recommended_for=row.recommended_for or [],
                    quality_score=row.quality_score,
                    speed_score=row.speed_score,
                    is_active=row.is_active,
                    is_default=row.is_default,
                    is_default_free=row.is_default_free,
                    description=row.description or "",
                )
                models.append(model)
            
            logger.info(f"Loaded {len(models)} models from database")
            return models
            
    except Exception as e:
        logger.warning(f"Failed to load models from database: {e}. Using fallback.")
        return []


def _get_use_case_defaults_from_db() -> Dict[str, Dict[str, str]]:
    """Fetch use case defaults from the database."""
    try:
        from ..db import db_session
        from sqlalchemy import text
        
        with db_session() as session:
            query = text("""
                SELECT use_case, default_model_id, fallback_model_id, free_tier_model_id
                FROM ai_model_defaults
            """)
            result = session.execute(query)
            rows = result.fetchall()
            
            defaults = {}
            for row in rows:
                defaults[row.use_case] = {
                    "default": row.default_model_id,
                    "fallback": row.fallback_model_id,
                    "free": row.free_tier_model_id,
                }
            
            return defaults
            
    except Exception as e:
        logger.warning(f"Failed to load use case defaults from database: {e}")
        return {}


# ============================================================================
# Cached Model Registry
# ============================================================================

# Cache for models (refreshed periodically or on demand)
_models_cache: Optional[List[ModelInfo]] = None
_models_cache_time: Optional[datetime] = None
_CACHE_TTL_SECONDS = 300  # 5 minutes


def _is_cache_valid() -> bool:
    """Check if the cache is still valid."""
    if _models_cache is None or _models_cache_time is None:
        return False
    return (datetime.utcnow() - _models_cache_time).total_seconds() < _CACHE_TTL_SECONDS


def refresh_models_cache() -> List[ModelInfo]:
    """Force refresh the models cache from database."""
    global _models_cache, _models_cache_time
    
    db_models = _get_models_from_db()
    
    if db_models:
        _models_cache = db_models
        _models_cache_time = datetime.utcnow()
        return _models_cache
    
    # Fallback to hardcoded defaults if DB is empty/unavailable
    if _models_cache:
        return _models_cache
    
    _models_cache = _get_fallback_models()
    _models_cache_time = datetime.utcnow()
    return _models_cache


def get_all_models() -> List[ModelInfo]:
    """Get all available models (from cache or database)."""
    if _is_cache_valid():
        return _models_cache
    return refresh_models_cache()


# ============================================================================
# Fallback Models (used when DB is unavailable)
# ============================================================================

def _get_fallback_models() -> List[ModelInfo]:
    """Fallback hardcoded models for when database is unavailable.
    Only top-quality models from major providers."""
    return [
        # Platform default (ai_model_defaults has GLM as the default for every
        # chat use case). Live Isoquant price, the primary route for this model.
        ModelInfo(
            id=GLM_DEFAULT,
            name="GLM 5.3 Flash",
            provider="Z.ai",
            category="general",
            tier="standard",
            is_free=False,
            credit_multiplier=1.0,
            input_price_per_1m=0.027,
            output_price_per_1m=0.49,
            supports_streaming=True,
            supports_images=True,
            supports_function_calling=True,
            supports_json_mode=True,
            quality_score=4,
            speed_score=4,
            is_default=True,
            description="Platform default — reasoning model, served via Isoquant",
        ),

        # Standard tier
        ModelInfo(
            id=NON_GLM_FALLBACK,
            name="Gemini 2.5 Flash",
            provider="Google",
            category="general",
            tier="standard",
            is_free=False,
            credit_multiplier=1.0,
            input_price_per_1m=0.3,
            output_price_per_1m=2.5,
            max_tokens=1048576,
            context_window=1048576,
            supports_streaming=True,
            supports_images=True,
            supports_function_calling=True,
            supports_json_mode=True,
            quality_score=4,
            speed_score=5,
            description="Fast and affordable — great for most tasks",
        ),

        # Premium tier
        ModelInfo(
            id="google/gemini-2.5-pro",
            name="Gemini 2.5 Pro",
            provider="Google",
            category="general",
            tier="premium",
            is_free=False,
            credit_multiplier=2.0,
            input_price_per_1m=1.25,
            output_price_per_1m=5.0,
            max_tokens=65536,
            context_window=1048576,
            supports_streaming=True,
            supports_images=True,
            supports_function_calling=True,
            supports_json_mode=True,
            quality_score=5,
            speed_score=4,
            description="Google's most capable model — deep reasoning",
        ),
        ModelInfo(
            id="openai/gpt-4o",
            name="GPT-4o",
            provider="OpenAI",
            category="general",
            tier="premium",
            is_free=False,
            credit_multiplier=2.5,
            input_price_per_1m=2.5,
            output_price_per_1m=10.0,
            max_tokens=16384,
            context_window=128000,
            supports_streaming=True,
            supports_images=True,
            supports_function_calling=True,
            supports_json_mode=True,
            quality_score=5,
            speed_score=4,
            description="OpenAI's flagship multimodal model",
        ),
        ModelInfo(
            id="anthropic/claude-sonnet-4",
            name="Claude Sonnet 4",
            provider="Anthropic",
            category="general",
            tier="premium",
            is_free=False,
            credit_multiplier=2.0,
            input_price_per_1m=3.0,
            output_price_per_1m=15.0,
            max_tokens=8192,
            context_window=200000,
            supports_streaming=True,
            supports_images=True,
            supports_function_calling=True,
            supports_json_mode=True,
            quality_score=5,
            speed_score=4,
            description="Anthropic's balanced model — excellent for content",
        ),

        # Ultra tier
        ModelInfo(
            id="anthropic/claude-opus-4",
            name="Claude Opus 4",
            provider="Anthropic",
            category="general",
            tier="ultra",
            is_free=False,
            credit_multiplier=5.0,
            input_price_per_1m=15.0,
            output_price_per_1m=75.0,
            max_tokens=32000,
            context_window=200000,
            supports_streaming=True,
            supports_images=True,
            supports_function_calling=True,
            supports_json_mode=True,
            quality_score=5,
            speed_score=3,
            description="Anthropic's most capable model — highest quality",
        ),
    ]


# ============================================================================
# Public API
# ============================================================================

# Lazy-loaded model lists
def _ensure_models_loaded():
    """Ensure models are loaded."""
    if not _is_cache_valid():
        refresh_models_cache()


# Module-level model lists — these are evaluated lazily via get_all_models()
# NOTE: @property only works on class methods, NOT module-level functions.
# These are plain functions that return fresh lists each time.

def ALL_MODELS() -> List[ModelInfo]:
    """Get all models."""
    return get_all_models()


def FREE_MODELS() -> List[ModelInfo]:
    """Get free tier models."""
    return [m for m in get_all_models() if m.is_free]


def PAID_MODELS() -> List[ModelInfo]:
    """Get paid models."""
    return [m for m in get_all_models() if not m.is_free]


# Convenience functions
def get_model_by_id(model_id: str) -> Optional[ModelInfo]:
    """Get model information by ID."""
    for model in get_all_models():
        if model.id == model_id:
            return model
    return None


def get_models_by_category(category: str) -> List[ModelInfo]:
    """Get all models in a category."""
    return [m for m in get_all_models() if m.category == category]


def get_models_by_tier(tier: str) -> List[ModelInfo]:
    """Get all models in a tier."""
    return [m for m in get_all_models() if m.tier == tier]


def get_models_by_provider(provider: str) -> List[ModelInfo]:
    """Get all models from a provider."""
    return [m for m in get_all_models() if m.provider.lower() == provider.lower()]


def get_free_models() -> List[ModelInfo]:
    """Get all free tier models."""
    return [m for m in get_all_models() if m.is_free]


def get_models_for_use_case(use_case: str) -> List[ModelInfo]:
    """Get models recommended for a use case."""
    return [m for m in get_all_models() if use_case in m.recommended_for]


def get_default_model() -> Optional[ModelInfo]:
    """Get the default model."""
    for model in get_all_models():
        if model.is_default:
            return model
    # Fallback to first standard tier model
    models = get_all_models()
    for m in models:
        if m.tier == "standard":
            return m
    return models[0] if models else None


def get_default_free_model() -> Optional[ModelInfo]:
    """Get the default free model."""
    for model in get_all_models():
        if model.is_default_free:
            return model
    # Fallback to first free model
    free_models = get_free_models()
    return free_models[0] if free_models else None


# Per-process cache of ai_model_defaults: (rows, loaded_at). A failed read is
# cached too (as {}), so a DB outage costs one slow query per TTL, not one per call.
_use_case_defaults_cache: Optional[tuple] = None
_USE_CASE_DEFAULTS_TTL_SECONDS = 60


def get_use_case_default_model(use_case: str, fallback: str = GLM_DEFAULT) -> str:
    """The `ai_model_defaults` default model for a use case, or `fallback`
    when the row is missing or the read fails. For direct `post_chat` callers
    that have no DB session of their own."""
    global _use_case_defaults_cache
    now = datetime.utcnow()
    cached = _use_case_defaults_cache
    if cached is None or (now - cached[1]).total_seconds() >= _USE_CASE_DEFAULTS_TTL_SECONDS:
        cached = (_get_use_case_defaults_from_db(), now)
        _use_case_defaults_cache = cached
    row = cached[0].get(use_case) or {}
    return row.get("default") or fallback


def get_use_case_model_chain(use_case: str, model: Optional[str] = None) -> List[str]:
    """[primary, NON_GLM_FALLBACK], de-duplicated, for a caller that retries
    once on a different vendor. The primary is `model` when given, else the
    use case's ai_model_defaults default, else DEFAULT_MODEL (GLM). Never raises."""
    primary = model
    if not primary:
        try:
            primary = get_use_case_default_model(use_case, DEFAULT_MODEL)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"'{use_case}' default model lookup failed: {e}")
    return list(dict.fromkeys([primary or DEFAULT_MODEL, NON_GLM_FALLBACK]))


def get_model_pricing(model_id: str) -> Optional[Dict[str, float]]:
    """Get pricing information for a model."""
    model = get_model_by_id(model_id)
    if not model:
        return None
    
    input_price = model.get_input_token_price()
    output_price = model.get_output_token_price()
    
    if input_price is None or output_price is None:
        return None
    
    return {
        "input_token_price": input_price,
        "output_token_price": output_price,
        "credit_multiplier": model.credit_multiplier,
    }


def get_credit_multiplier(model_id: str) -> float:
    """Get credit multiplier for a model."""
    model = get_model_by_id(model_id)
    if model:
        if model.is_free:
            return 0.0
        return model.credit_multiplier
    return 1.0  # Default to standard


# ============================================================================
# Default Model IDs (for backward compatibility)
# ============================================================================

# The model-less fallback for direct callers (intent router, video-type
# classifier, reference-file description). They resolve the 'video' use case
# first via get_use_case_default_model(); this is what they use when that read
# fails.
DEFAULT_MODEL = GLM_DEFAULT
VIDEO_GENERATION_DEFAULT_MODEL = "google/gemini-2.0-flash-exp:free"


# ============================================================================
# Backward Compatibility - Legacy Lists
# ============================================================================

# These are populated lazily from the database
OPENAI_MODELS: List[ModelInfo] = []
GEMINI_MODELS: List[ModelInfo] = []
OPENROUTER_MODELS: List[ModelInfo] = []
MODELS_BY_ID: Dict[str, ModelInfo] = {}


def _refresh_legacy_lists():
    """Refresh legacy model lists from database."""
    global OPENAI_MODELS, GEMINI_MODELS, OPENROUTER_MODELS, MODELS_BY_ID
    
    all_models = get_all_models()
    
    OPENAI_MODELS = [m for m in all_models if m.provider == "OpenAI"]
    GEMINI_MODELS = [m for m in all_models if m.provider == "Google"]
    OPENROUTER_MODELS = [m for m in all_models if m.provider == "OpenRouter"]
    MODELS_BY_ID = {m.id: m for m in all_models}


# Refresh on module load
try:
    _refresh_legacy_lists()
except Exception as e:
    logger.warning(f"Could not refresh legacy model lists: {e}")


__all__ = [
    "ModelCategory",
    "ModelTier",
    "ModelInfo",
    "get_all_models",
    "get_model_by_id",
    "get_models_by_category",
    "get_models_by_tier",
    "get_models_by_provider",
    "get_free_models",
    "get_models_for_use_case",
    "get_default_model",
    "get_default_free_model",
    "get_use_case_default_model",
    "get_use_case_model_chain",
    "get_model_pricing",
    "get_credit_multiplier",
    "refresh_models_cache",
    "DEFAULT_MODEL",
    "VIDEO_GENERATION_DEFAULT_MODEL",
    # Legacy
    "OPENAI_MODELS",
    "GEMINI_MODELS",
    "OPENROUTER_MODELS",
    "MODELS_BY_ID",
]
