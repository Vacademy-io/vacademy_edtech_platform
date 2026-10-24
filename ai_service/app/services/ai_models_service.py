"""
AI Models Service - Business logic for the centralized model registry.

This service handles:
- Retrieving models from the database
- Filtering by tier, provider, use case
- Managing default models per use case
- Updating model pricing and free tier status
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, Optional, List
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..schemas.ai_models import (
    AIModelResponse,
    AIModelSummary,
    ModelsListResponse,
    ModelsForUseCaseResponse,
    FreeModelsResponse,
    UseCaseDefaultResponse,
    AllUseCaseDefaultsResponse,
    CreateModelRequest,
    UpdateModelRequest,
    UpdateFreeTierRequest,
    UpdateUseCaseDefaultRequest,
    ProviderStats,
    ProvidersListResponse,
    TierStats,
    TiersListResponse,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResolvedModel:
    """One row of the resolved (stage → model) map for a video run.

    Returned by `AIModelsService.get_stage_model_map(...)`. The pipeline reads
    `model_id` to drive each LLM call; `fallback_model_id` is consumed by
    `OpenRouterClient` when the primary model errors; `source` lands in the
    cost-event record so forensics can answer "did the user override land?".
    """
    stage: str
    model_id: str
    fallback_model_id: Optional[str]
    source: str  # "matrix" | "user_default" | "user_per_stage"


LEGACY_CHANGE_REASON = "legacy /models/v2 admin endpoint (no reason captured)"

# UpdateModelRequest field -> ai_models column (the ones update_model writes).
_MODEL_UPDATE_COLUMNS = (
    ("name", "name"), ("tier", "tier"), ("is_free", "is_free"), ("is_active", "is_active"),
    ("input_price_per_1m", "input_price_per_1m"), ("output_price_per_1m", "output_price_per_1m"),
    ("credit_multiplier", "credit_multiplier"), ("quality_score", "quality_score"),
    ("speed_score", "speed_score"), ("recommended_for", "recommended_for"),
    ("description", "description"), ("display_order", "display_order"),
)


def _jsonable(value: Any) -> Any:
    """Decimals/datetimes -> strings so the value fits a JSONB column."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


class AIModelsService:
    """Service for managing the AI models registry."""

    def __init__(self, db: Session):
        self.db = db

    # ========================================================================
    # Audit trail (ai_model_change_log, V569)
    # ========================================================================
    #
    # The legacy /models/v2 writes below change prices, flags and defaults for
    # every institute. They record old/new values in ai_model_change_log like
    # the super-admin portal writes do. Best-effort: the audit never blocks or
    # undoes the write (the table may be missing, the insert may fail), and
    # every audit statement runs in a SAVEPOINT so a failure there cannot
    # poison the transaction that carries the write itself.

    def _change_log_ready(self) -> bool:
        """Is ai_model_change_log there? Checked BEFORE the write so a failed
        check can never roll the write back."""
        try:
            with self.db.begin_nested():
                return bool(self.db.execute(
                    text("SELECT to_regclass('ai_model_change_log') IS NOT NULL")
                ).scalar())
        except Exception:  # noqa: BLE001
            logger.warning("could not check for ai_model_change_log; legacy model edit not audited", exc_info=True)
            return False

    def _audit_snapshot(self, sql: str, params: Dict[str, Any]) -> Optional[List[Any]]:
        try:
            with self.db.begin_nested():
                return list(self.db.execute(text(sql), params).fetchall())
        except Exception:  # noqa: BLE001
            logger.warning("could not read the before-values for the model change log", exc_info=True)
            return None

    def _audit(self, table_name: str, row_key: str, old: Any, new: Any,
               reason: Optional[str], actor: Optional[str]) -> None:
        try:
            from .model_defaults_admin import _log_change
            with self.db.begin_nested():
                _log_change(self.db, table_name, row_key, _jsonable(old), _jsonable(new),
                            (reason or "").strip() or LEGACY_CHANGE_REASON, actor)
        except Exception:  # noqa: BLE001
            logger.warning("model change log write failed for %s %s", table_name, row_key, exc_info=True)

    # ========================================================================
    # Model Retrieval
    # ========================================================================

    def get_all_models(
        self,
        tier: Optional[str] = None,
        provider: Optional[str] = None,
        category: Optional[str] = None,
        is_free: Optional[bool] = None,
        use_case: Optional[str] = None,
        active_only: bool = True,
    ) -> ModelsListResponse:
        """Get all models with optional filtering."""
        conditions = []
        params = {}
        
        if active_only:
            conditions.append("is_active = TRUE")
        
        if tier:
            conditions.append("tier = :tier")
            params["tier"] = tier
        
        if provider:
            conditions.append("LOWER(provider) = LOWER(:provider)")
            params["provider"] = provider
        
        if category:
            conditions.append("category = :category")
            params["category"] = category
        
        if is_free is not None:
            conditions.append("is_free = :is_free")
            params["is_free"] = is_free
        
        if use_case:
            conditions.append(":use_case = ANY(recommended_for)")
            params["use_case"] = use_case
        
        where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""
        
        query = text(f"""
            SELECT model_id, name, provider, category, tier,
                   max_tokens, context_window, supports_streaming, supports_images,
                   supports_function_calling, supports_json_mode,
                   input_price_per_1m, output_price_per_1m, credit_multiplier,
                   is_free, recommended_for, quality_score, speed_score,
                   is_active, is_default, is_default_free, description
            FROM ai_models
            {where_clause}
            ORDER BY display_order, name
        """)
        
        result = self.db.execute(query, params)
        rows = result.fetchall()
        
        models = []
        free_count = 0
        paid_count = 0
        
        for row in rows:
            model = AIModelResponse(
                model_id=row.model_id,
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
                input_price_per_1m=row.input_price_per_1m,
                output_price_per_1m=row.output_price_per_1m,
                credit_multiplier=row.credit_multiplier,
                is_free=row.is_free,
                recommended_for=row.recommended_for,
                quality_score=row.quality_score,
                speed_score=row.speed_score,
                is_active=row.is_active,
                is_default=row.is_default,
                is_default_free=row.is_default_free,
                description=row.description,
            )
            models.append(model)
            
            if row.is_free:
                free_count += 1
            else:
                paid_count += 1
        
        return ModelsListResponse(
            models=models,
            total=len(models),
            free_count=free_count,
            paid_count=paid_count,
        )

    def get_model_by_id(self, model_id: str) -> Optional[AIModelResponse]:
        """Get a specific model by ID."""
        query = text("""
            SELECT model_id, name, provider, category, tier,
                   max_tokens, context_window, supports_streaming, supports_images,
                   supports_function_calling, supports_json_mode,
                   input_price_per_1m, output_price_per_1m, credit_multiplier,
                   is_free, recommended_for, quality_score, speed_score,
                   is_active, is_default, is_default_free, description
            FROM ai_models
            WHERE model_id = :model_id
        """)
        
        result = self.db.execute(query, {"model_id": model_id})
        row = result.fetchone()
        
        if not row:
            return None
        
        return AIModelResponse(
            model_id=row.model_id,
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
            input_price_per_1m=row.input_price_per_1m,
            output_price_per_1m=row.output_price_per_1m,
            credit_multiplier=row.credit_multiplier,
            is_free=row.is_free,
            recommended_for=row.recommended_for,
            quality_score=row.quality_score,
            speed_score=row.speed_score,
            is_active=row.is_active,
            is_default=row.is_default,
            is_default_free=row.is_default_free,
            description=row.description,
        )

    def get_free_models(self) -> FreeModelsResponse:
        """Get all currently active free models."""
        query = text("""
            SELECT model_id, name, provider, tier, is_free, 
                   quality_score, speed_score, description
            FROM ai_models
            WHERE is_free = TRUE AND is_active = TRUE
            ORDER BY display_order, quality_score DESC
        """)
        
        result = self.db.execute(query)
        rows = result.fetchall()
        
        models = [
            AIModelSummary(
                model_id=row.model_id,
                name=row.name,
                provider=row.provider,
                tier=row.tier,
                is_free=row.is_free,
                quality_score=row.quality_score,
                speed_score=row.speed_score,
                description=row.description,
            )
            for row in rows
        ]
        
        return FreeModelsResponse(
            models=models,
            count=len(models),
            last_updated=datetime.utcnow(),
        )

    # ========================================================================
    # Use Case Defaults
    # ========================================================================

    def get_models_for_use_case(self, use_case: str) -> ModelsForUseCaseResponse:
        """Get models recommended for a specific use case."""
        # Get use case defaults
        defaults_query = text("""
            SELECT default_model_id, fallback_model_id, free_tier_model_id, description
            FROM ai_model_defaults
            WHERE use_case = :use_case
        """)
        defaults_result = self.db.execute(defaults_query, {"use_case": use_case})
        defaults_row = defaults_result.fetchone()
        
        # Get recommended models
        rec_query = text("""
            SELECT model_id, name, provider, tier, is_free, 
                   quality_score, speed_score, description
            FROM ai_models
            WHERE :use_case = ANY(recommended_for) AND is_active = TRUE
            ORDER BY quality_score DESC, speed_score DESC
        """)
        rec_result = self.db.execute(rec_query, {"use_case": use_case})
        rec_rows = rec_result.fetchall()
        
        recommended_models = [
            AIModelSummary(
                model_id=row.model_id,
                name=row.name,
                provider=row.provider,
                tier=row.tier,
                is_free=row.is_free,
                quality_score=row.quality_score,
                speed_score=row.speed_score,
                description=row.description,
            )
            for row in rec_rows
        ]
        
        # Get all active models (for "all compatible")
        all_models = self.get_all_models(active_only=True)
        all_compatible = [
            AIModelSummary(
                model_id=m.model_id,
                name=m.name,
                provider=m.provider,
                tier=m.tier,
                is_free=m.is_free,
                quality_score=m.quality_score,
                speed_score=m.speed_score,
                description=m.description,
            )
            for m in all_models.models
        ]
        
        # Get specific model details
        default_model = None
        fallback_model = None
        free_tier_model = None
        
        if defaults_row:
            if defaults_row.default_model_id:
                default_model = self._get_model_summary(defaults_row.default_model_id)
            if defaults_row.fallback_model_id:
                fallback_model = self._get_model_summary(defaults_row.fallback_model_id)
            if defaults_row.free_tier_model_id:
                free_tier_model = self._get_model_summary(defaults_row.free_tier_model_id)
        
        # If no defaults, use first recommended
        if not default_model and recommended_models:
            default_model = recommended_models[0]
        
        return ModelsForUseCaseResponse(
            use_case=use_case,
            default_model=default_model,
            fallback_model=fallback_model,
            free_tier_model=free_tier_model,
            recommended_models=recommended_models,
            all_compatible_models=all_compatible,
        )

    def get_default_model_id_for_use_case(
        self, use_case: str, *, prefer_free: bool = False
    ) -> Optional[str]:
        """Fast lookup: return just the default model_id string for a use_case.

        Reads `ai_model_defaults` and falls back to the highest-scoring active
        model whose `recommended_for` array contains the use_case. Returns
        None if nothing matches — callers should apply their own hard fallback.

        prefer_free=True returns the free_tier_model_id first (for free-tier
        institutes that should not be billed for premium regen models).
        """
        defaults_query = text("""
            SELECT default_model_id, fallback_model_id, free_tier_model_id
            FROM ai_model_defaults
            WHERE use_case = :use_case
        """)
        row = self.db.execute(defaults_query, {"use_case": use_case}).fetchone()
        if row:
            if prefer_free and row.free_tier_model_id:
                return row.free_tier_model_id
            if row.default_model_id:
                return row.default_model_id
            if row.fallback_model_id:
                return row.fallback_model_id

        # No row in ai_model_defaults — pick the top-scored recommended model.
        rec_query = text("""
            SELECT model_id FROM ai_models
            WHERE :use_case = ANY(recommended_for) AND is_active = TRUE
            ORDER BY quality_score DESC, speed_score DESC
            LIMIT 1
        """)
        rec_row = self.db.execute(rec_query, {"use_case": use_case}).fetchone()
        return rec_row.model_id if rec_row else None

    def get_stage_model_map(
        self,
        *,
        use_case: str,
        quality_tier: str,
        overrides: Optional["ModelOverrides"] = None,  # noqa: F821 — forward ref to schemas.video_generation
    ) -> Dict[str, "ResolvedModel"]:
        """Resolve the (stage_id → ResolvedModel) map for a video run.

        Reads `ai_model_stage_assignments` once for the (use_case, quality_tier)
        slice, then layers user overrides on top per-stage:

          - per_stage[stage] takes precedence if the row's user_overridable=true
          - default applies to all user_overridable stages otherwise
          - admin matrix row is the floor; pinned stages (user_overridable=false)
            ignore overrides entirely

        Returns {stage_id: ResolvedModel(model_id, fallback_model_id, source)}.
        `source` is one of "matrix" / "user_default" / "user_per_stage" — used
        by `cost_event_tracker` to forensic-audit whether the user override
        actually landed at runtime.

        On DB-read failure (table not yet migrated, transient error) returns an
        empty dict — callers should treat that as "fall back to the legacy
        single-model resolution" so a missing matrix doesn't crash the run.
        """
        rows_query = text("""
            SELECT stage_id, model_id, fallback_model_id, user_overridable
            FROM ai_model_stage_assignments
            WHERE use_case = :use_case
              AND quality_tier = :quality_tier
              AND is_active = TRUE
        """)
        try:
            rows = self.db.execute(
                rows_query,
                {"use_case": use_case, "quality_tier": quality_tier},
            ).fetchall()
        except Exception as exc:
            logger.warning(
                "ai_model_stage_assignments lookup failed (%s); "
                "caller will fall back to legacy resolution",
                exc,
            )
            return {}

        # Pull override fields defensively. `overrides` can be either:
        #   (a) a pydantic `ModelOverrides` instance (new-gen path);
        #   (b) a plain dict (resume/retry path — JSON-deserialized from
        #       `user_selections.model_overrides` on the video record).
        # We avoid `getattr` on dicts (Python silently returns dict methods
        # for matching attr names like `.get`/`.keys`/etc.). Branch on type.
        user_default: Optional[str] = None
        per_stage_picks: Dict[str, str] = {}
        if overrides is not None:
            if isinstance(overrides, dict):
                _default_raw = overrides.get("default")
                _per_stage_raw = overrides.get("per_stage")
            else:
                _default_raw = getattr(overrides, "default", None)
                _per_stage_raw = getattr(overrides, "per_stage", None)
            if isinstance(_default_raw, str) and _default_raw.strip():
                user_default = _default_raw.strip()
            if isinstance(_per_stage_raw, dict):
                per_stage_picks = {
                    str(k): str(v).strip()
                    for k, v in _per_stage_raw.items()
                    if isinstance(v, str) and v.strip()
                }

        result: Dict[str, ResolvedModel] = {}
        for row in rows:
            stage_id = row.stage_id
            admin_model = row.model_id
            fallback = row.fallback_model_id
            overridable = bool(row.user_overridable)

            model_id = admin_model
            source = "matrix"
            if overridable:
                per_pick = per_stage_picks.get(stage_id)
                if per_pick:
                    model_id, source = per_pick, "user_per_stage"
                elif user_default:
                    model_id, source = user_default, "user_default"

            result[stage_id] = ResolvedModel(
                stage=stage_id,
                model_id=model_id,
                fallback_model_id=fallback,
                source=source,
            )
        return result

    def _get_model_summary(self, model_id: str) -> Optional[AIModelSummary]:
        """Get a model summary by ID."""
        query = text("""
            SELECT model_id, name, provider, tier, is_free, 
                   quality_score, speed_score, description
            FROM ai_models
            WHERE model_id = :model_id
        """)
        result = self.db.execute(query, {"model_id": model_id})
        row = result.fetchone()
        
        if not row:
            return None
        
        return AIModelSummary(
            model_id=row.model_id,
            name=row.name,
            provider=row.provider,
            tier=row.tier,
            is_free=row.is_free,
            quality_score=row.quality_score,
            speed_score=row.speed_score,
            description=row.description,
        )

    def get_all_use_case_defaults(self) -> AllUseCaseDefaultsResponse:
        """Get defaults for all use cases."""
        query = text("""
            SELECT use_case, default_model_id, fallback_model_id, 
                   free_tier_model_id, description
            FROM ai_model_defaults
            ORDER BY use_case
        """)
        
        result = self.db.execute(query)
        rows = result.fetchall()
        
        defaults = [
            UseCaseDefaultResponse(
                use_case=row.use_case,
                default_model_id=row.default_model_id,
                fallback_model_id=row.fallback_model_id,
                free_tier_model_id=row.free_tier_model_id,
                description=row.description,
            )
            for row in rows
        ]
        
        return AllUseCaseDefaultsResponse(defaults=defaults)

    # ========================================================================
    # Provider/Tier Stats
    # ========================================================================

    def get_providers(self) -> ProvidersListResponse:
        """Get list of providers with model counts."""
        query = text("""
            SELECT provider, 
                   COUNT(*) as total,
                   SUM(CASE WHEN is_free THEN 1 ELSE 0 END) as free_count,
                   SUM(CASE WHEN NOT is_free THEN 1 ELSE 0 END) as paid_count
            FROM ai_models
            WHERE is_active = TRUE
            GROUP BY provider
            ORDER BY total DESC
        """)
        
        result = self.db.execute(query)
        rows = result.fetchall()
        
        providers = [
            ProviderStats(
                provider=row.provider,
                total_models=row.total,
                free_models=row.free_count,
                paid_models=row.paid_count,
            )
            for row in rows
        ]
        
        return ProvidersListResponse(
            providers=providers,
            total_providers=len(providers),
        )

    def get_tiers(self) -> TiersListResponse:
        """Get list of tiers with stats."""
        query = text("""
            SELECT tier, 
                   COUNT(*) as count,
                   AVG(input_price_per_1m) as avg_input,
                   AVG(output_price_per_1m) as avg_output
            FROM ai_models
            WHERE is_active = TRUE
            GROUP BY tier
            ORDER BY 
                CASE tier 
                    WHEN 'free' THEN 1 
                    WHEN 'standard' THEN 2 
                    WHEN 'premium' THEN 3 
                    WHEN 'ultra' THEN 4 
                    ELSE 5 
                END
        """)
        
        result = self.db.execute(query)
        rows = result.fetchall()
        
        tiers = [
            TierStats(
                tier=row.tier,
                count=row.count,
                avg_input_price=row.avg_input,
                avg_output_price=row.avg_output,
            )
            for row in rows
        ]
        
        return TiersListResponse(tiers=tiers)

    # ========================================================================
    # Admin Functions
    # ========================================================================

    def create_model(self, request: CreateModelRequest, *, actor: Optional[str] = None,
                     reason: Optional[str] = None) -> AIModelResponse:
        """Create a new model in the registry."""
        audit = self._change_log_ready()
        model_id = str(uuid4())
        now = datetime.utcnow()
        
        insert_query = text("""
            INSERT INTO ai_models (
                id, model_id, name, provider, category, tier,
                max_tokens, context_window, supports_streaming, supports_images,
                input_price_per_1m, output_price_per_1m, credit_multiplier,
                is_free, recommended_for, quality_score, speed_score,
                description, display_order, created_at, updated_at
            ) VALUES (
                :id, :model_id, :name, :provider, :category, :tier,
                :max_tokens, :context_window, :supports_streaming, :supports_images,
                :input_price_per_1m, :output_price_per_1m, :credit_multiplier,
                :is_free, :recommended_for, :quality_score, :speed_score,
                :description, :display_order, :now, :now
            )
        """)
        
        self.db.execute(insert_query, {
            "id": model_id,
            "model_id": request.model_id,
            "name": request.name,
            "provider": request.provider,
            "category": request.category,
            "tier": request.tier,
            "max_tokens": request.max_tokens,
            "context_window": request.context_window,
            "supports_streaming": request.supports_streaming,
            "supports_images": request.supports_images,
            "input_price_per_1m": request.input_price_per_1m,
            "output_price_per_1m": request.output_price_per_1m,
            "credit_multiplier": request.credit_multiplier,
            "is_free": request.is_free,
            "recommended_for": request.recommended_for,
            "quality_score": request.quality_score,
            "speed_score": request.speed_score,
            "description": request.description,
            "display_order": request.display_order,
            "now": now,
        })
        if audit:
            self._audit("ai_models", request.model_id, None, {
                "tier": request.tier, "is_free": request.is_free,
                "input_price_per_1m": request.input_price_per_1m,
                "output_price_per_1m": request.output_price_per_1m,
                "credit_multiplier": request.credit_multiplier,
            }, reason, actor)

        self.db.commit()
        
        logger.info(f"Created new model: {request.model_id}")
        return self.get_model_by_id(request.model_id)

    def update_model(self, model_id: str, request: UpdateModelRequest, *, actor: Optional[str] = None,
                     reason: Optional[str] = None) -> Optional[AIModelResponse]:
        """Update an existing model."""
        updates = []
        params = {"model_id": model_id, "now": datetime.utcnow()}
        
        if request.name is not None:
            updates.append("name = :name")
            params["name"] = request.name
        if request.tier is not None:
            updates.append("tier = :tier")
            params["tier"] = request.tier
        if request.is_free is not None:
            updates.append("is_free = :is_free")
            params["is_free"] = request.is_free
        if request.is_active is not None:
            updates.append("is_active = :is_active")
            params["is_active"] = request.is_active
        if request.input_price_per_1m is not None:
            updates.append("input_price_per_1m = :input_price")
            params["input_price"] = request.input_price_per_1m
        if request.output_price_per_1m is not None:
            updates.append("output_price_per_1m = :output_price")
            params["output_price"] = request.output_price_per_1m
        if request.credit_multiplier is not None:
            updates.append("credit_multiplier = :multiplier")
            params["multiplier"] = request.credit_multiplier
        if request.quality_score is not None:
            updates.append("quality_score = :quality")
            params["quality"] = request.quality_score
        if request.speed_score is not None:
            updates.append("speed_score = :speed")
            params["speed"] = request.speed_score
        if request.recommended_for is not None:
            updates.append("recommended_for = :recommended")
            params["recommended"] = request.recommended_for
        if request.description is not None:
            updates.append("description = :description")
            params["description"] = request.description
        if request.display_order is not None:
            updates.append("display_order = :order")
            params["order"] = request.display_order
        
        if not updates:
            return self.get_model_by_id(model_id)
        
        updates.append("updated_at = :now")

        changed = {col: getattr(request, field) for field, col in _MODEL_UPDATE_COLUMNS
                   if getattr(request, field) is not None}
        old_row = None
        if self._change_log_ready():
            rows = self._audit_snapshot(
                f"SELECT {', '.join(changed)} FROM ai_models WHERE model_id = :model_id",
                {"model_id": model_id},
            )
            if rows:
                old_row = {col: getattr(rows[0], col, None) for col in changed}

        update_query = text(f"""
            UPDATE ai_models
            SET {", ".join(updates)}
            WHERE model_id = :model_id
        """)
        
        self.db.execute(update_query, params)
        if old_row is not None:
            self._audit("ai_models", model_id, old_row, changed, reason, actor)
        self.db.commit()
        
        logger.info(f"Updated model: {model_id}")
        return self.get_model_by_id(model_id)

    def update_free_tier(self, request: UpdateFreeTierRequest, *, actor: Optional[str] = None,
                         reason: Optional[str] = None) -> FreeModelsResponse:
        """Update which models are in the free tier."""
        now = datetime.utcnow()

        old_free = None
        if self._change_log_ready():
            rows = self._audit_snapshot(
                "SELECT model_id, tier FROM ai_models WHERE is_free = TRUE ORDER BY model_id", {}
            )
            if rows is not None:
                old_free = [{"model_id": r.model_id, "tier": r.tier} for r in rows]

        # First, remove free status from all models
        reset_query = text("""
            UPDATE ai_models
            SET is_free = FALSE, tier = 'standard', updated_at = :now
            WHERE is_free = TRUE
        """)
        self.db.execute(reset_query, {"now": now})
        
        # Then, mark the specified models as free
        for model_id in request.model_ids:
            update_query = text("""
                UPDATE ai_models
                SET is_free = TRUE, tier = 'free', updated_at = :now
                WHERE model_id = :model_id
            """)
            self.db.execute(update_query, {"model_id": model_id, "now": now})

        if old_free is not None:
            # The reset above also moves every previously-free model to tier
            # 'standard'; the old list keeps their tiers so that is visible.
            self._audit("ai_models", "free_tier", {"free_models": old_free},
                        {"free_models": [{"model_id": m, "tier": "free"} for m in request.model_ids],
                         "others_reset_to_tier": "standard"}, reason, actor)
        self.db.commit()
        
        logger.info(f"Updated free tier models: {request.model_ids}")
        return self.get_free_models()

    def update_use_case_default(
        self,
        use_case: str,
        request: UpdateUseCaseDefaultRequest,
        *,
        actor: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> Optional[UseCaseDefaultResponse]:
        """Update defaults for a use case. Only fields present in the request
        change (pydantic model_fields_set); an explicit null clears the
        fallback / free-tier model. Returns None when the use case has no row
        (the router answers 404). default_model_id cannot be cleared (NOT NULL):
        raises ValueError."""
        existing = self.db.execute(
            text("SELECT 1 FROM ai_model_defaults WHERE use_case = :use_case"),
            {"use_case": use_case},
        ).fetchone()
        if not existing:
            return None

        fields_set = getattr(request, "model_fields_set", None)
        if fields_set is None:  # pragma: no cover - pydantic v1 fallback
            fields_set = {f for f in ("default_model_id", "fallback_model_id", "free_tier_model_id")
                          if getattr(request, f) is not None}

        updates = []
        params = {"use_case": use_case, "now": datetime.utcnow()}
        if "default_model_id" in fields_set:
            if not request.default_model_id:
                raise ValueError("default_model_id cannot be cleared")
            updates.append("default_model_id = :default")
            params["default"] = request.default_model_id
        if "fallback_model_id" in fields_set:
            updates.append("fallback_model_id = :fallback")
            params["fallback"] = request.fallback_model_id or None
        if "free_tier_model_id" in fields_set:
            updates.append("free_tier_model_id = :free")
            params["free"] = request.free_tier_model_id or None

        if updates:
            fields = ("default_model_id", "fallback_model_id", "free_tier_model_id")
            old_defaults = None
            if self._change_log_ready():
                rows = self._audit_snapshot(
                    "SELECT default_model_id, fallback_model_id, free_tier_model_id "
                    "FROM ai_model_defaults WHERE use_case = :use_case",
                    {"use_case": use_case},
                )
                if rows:
                    old_defaults = {f: getattr(rows[0], f, None) for f in fields}
            updates.append("updated_at = :now")
            update_query = text(f"""
                UPDATE ai_model_defaults
                SET {", ".join(updates)}
                WHERE use_case = :use_case
            """)
            self.db.execute(update_query, params)
            if old_defaults is not None:
                # Same shape the super-admin portal writes (all three fields).
                new_defaults = dict(old_defaults)
                if "default" in params:
                    new_defaults["default_model_id"] = params["default"]
                if "fallback" in params:
                    new_defaults["fallback_model_id"] = params["fallback"]
                if "free" in params:
                    new_defaults["free_tier_model_id"] = params["free"]
                if new_defaults != old_defaults:
                    self._audit("ai_model_defaults", use_case, old_defaults, new_defaults, reason, actor)
            self.db.commit()
            try:
                from .model_selection import invalidate_cache
                invalidate_cache(use_case)
            except Exception:  # noqa: BLE001
                pass

        # Fetch updated record
        query = text("""
            SELECT use_case, default_model_id, fallback_model_id,
                   free_tier_model_id, description
            FROM ai_model_defaults
            WHERE use_case = :use_case
        """)
        result = self.db.execute(query, {"use_case": use_case})
        row = result.fetchone()
        if row is None:
            return None

        return UseCaseDefaultResponse(
            use_case=row.use_case,
            default_model_id=row.default_model_id,
            fallback_model_id=row.fallback_model_id,
            free_tier_model_id=row.free_tier_model_id,
            description=row.description,
        )

    # ========================================================================
    # Helper for Credit System Integration
    # ========================================================================

    def get_credit_multiplier(self, model_id: str) -> Decimal:
        """Get the credit multiplier for a model (for credit calculations)."""
        query = text("""
            SELECT credit_multiplier, is_free
            FROM ai_models
            WHERE model_id = :model_id AND is_active = TRUE
        """)
        
        result = self.db.execute(query, {"model_id": model_id})
        row = result.fetchone()
        
        if row:
            if row.is_free:
                return Decimal("0")  # Free models have 0 multiplier
            return row.credit_multiplier
        
        # Default to standard tier if not found
        return Decimal("1.0")
