"""
Service for resolving API keys from request, database, or defaults.
"""
from __future__ import annotations

import logging
from typing import Optional, Tuple
from uuid import UUID
from sqlalchemy.orm import Session

from ..config import get_settings
from ..repositories.ai_api_keys_repository import AiApiKeysRepository

logger = logging.getLogger(__name__)


class ApiKeyResolver:
    """
    Resolves API keys with waterfall priority (frontend should NOT send keys):
    1. User-level keys from database (if user_id provided)
    2. Institute-level keys from database (if institute_id provided)
    3. System default keys from environment variables (fallback)
    
    NOTE: Request-level keys are NOT accepted for security.
    Keys must be stored in database or configured via environment variables.
    """
    
    def __init__(self, session: Session):
        self._session = session
        self._repository = AiApiKeysRepository(session)
        self._settings = get_settings()
    
    def resolve_keys(
        self,
        institute_id: str,
        user_id: Optional[str] = None,
        request_model: Optional[str] = None,
        platform_default_key: Optional[str] = None,
    ) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """
        Resolve API keys and model with waterfall priority order.
        
        Priority (highest to lowest):
        1. User-level keys from database (if user_id provided)
        2. Institute-level keys from database (if institute_id provided)
        3. Environment variables (fallback); the default MODEL comes from the
           'platform_default' use case (ai_model_defaults), env only if that fails
        
        NOTE: Request-level keys are NOT accepted. Keys must be stored in database
        or configured via environment variables for security.
        
        Args:
            institute_id: Institute identifier (required)
            user_id: Optional user identifier (for user-level key lookup)
            request_model: Optional model from request (can override database default)
        
        Returns:
            Tuple of (openai_key, gemini_key, model)
        """
        # Start with defaults from environment variables (lowest priority)
        openai_key = self._settings.openrouter_api_key
        gemini_key = self._settings.gemini_api_key
        
        # Handle "auto" model - if "auto" is specified, always use the platform default
        use_auto_model = request_model and request_model.lower() == "auto"
        model = self._settings.llm_default_model  # Last resort only — see below

        # A platform setting (super-admin portal) replaces the base tier only:
        # institutes/users with their own key + default model still win below.
        platform_model = None
        if platform_default_key:
            try:
                from .platform_settings_service import get_platform_setting
                platform_model = get_platform_setting(platform_default_key, db=self._session)
                if platform_model:
                    model = str(platform_model)
            except Exception:
                logger.warning("platform default model lookup failed; using platform default", exc_info=True)
        if not platform_model:
            # Base tier: the 'platform_default' use case in ai_model_defaults
            # (super-admin portal, GLM by default). Same session — no second
            # connection per request. The env value only survives if the
            # resolver itself blows up.
            try:
                from .model_selection import resolve_models
                platform_default, _fallbacks = resolve_models(self._session, "platform_default")
                if platform_default:
                    model = platform_default
            except Exception:
                logger.warning("platform_default use-case lookup failed; using env default", exc_info=True)
        
        # Try to get keys from database (waterfall: user → institute → env)
        try:
            # Convert string IDs to UUID if needed
            institute_uuid = None
            user_uuid = None
            
            try:
                institute_uuid = UUID(institute_id)
            except (ValueError, AttributeError):
                pass
            
            if user_id:
                try:
                    user_uuid = UUID(user_id)
                except (ValueError, AttributeError):
                    pass
            
            # Waterfall resolution: User-level → Institute-level → Environment
            db_keys = None
            
            # Priority 1: Check user-level keys first
            if user_uuid and institute_uuid:
                db_keys = self._repository.get_keys_for_user(user_uuid, institute_uuid)
                if db_keys:
                    if db_keys.openai_key:
                        openai_key = db_keys.openai_key
                    if db_keys.gemini_key:
                        gemini_key = db_keys.gemini_key
                    # Use database default_model only if request_model is not provided or is "auto"
                    if (not request_model or use_auto_model) and db_keys.default_model:
                        model = db_keys.default_model
            
            # Priority 2: Fallback to institute-level keys if user-level not found
            if not db_keys and institute_uuid:
                db_keys = self._repository.get_keys_for_institute(institute_uuid)
                if db_keys:
                    if db_keys.openai_key:
                        openai_key = db_keys.openai_key
                    if db_keys.gemini_key:
                        gemini_key = db_keys.gemini_key
                    # Use database default_model only if request_model is not provided or is "auto"
                    if (not request_model or use_auto_model) and db_keys.default_model:
                        model = db_keys.default_model
            
            # Priority 3: Environment variables (already set above as defaults)
            # No action needed, they're the fallback
            
        except Exception as e:
            # Log error but continue with environment defaults
            import logging
            logger.warning(f"Failed to retrieve API keys from database: {str(e)}. Using environment defaults.")
        
        # Final model resolution: request_model overrides everything (unless it's "auto")
        if request_model and not use_auto_model:
            model = request_model
        # If "auto", model is already set to environment default above
        
        return openai_key, gemini_key, model

    def byo_default_model(self, institute_id: Optional[str], user_id: Optional[str] = None) -> Optional[str]:
        """The user/institute pick in ai_api_keys.default_model (same waterfall
        as resolve_keys: a user row, when present, hides the institute row), or
        None. Features that resolve their own use-case model call this first so
        an institute/user choice keeps beating the platform default."""
        try:
            institute_uuid = UUID(str(institute_id)) if institute_id else None
        except (ValueError, AttributeError):
            institute_uuid = None
        if not institute_uuid:
            return None
        user_uuid = None
        if user_id:
            try:
                user_uuid = UUID(str(user_id))
            except (ValueError, AttributeError):
                user_uuid = None
        try:
            db_keys = None
            if user_uuid:
                db_keys = self._repository.get_keys_for_user(user_uuid, institute_uuid)
            if not db_keys:
                db_keys = self._repository.get_keys_for_institute(institute_uuid)
            model = getattr(db_keys, "default_model", None) if db_keys else None
            if model and str(model).strip().lower() != "auto":
                return str(model).strip()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"ai_api_keys default_model lookup failed: {e}")
        return None


__all__ = ["ApiKeyResolver"]


