"""
Service for recording and querying AI token usage.
"""
from __future__ import annotations

from typing import Optional, List, Dict, Any
from uuid import UUID
from decimal import Decimal
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from ..repositories.ai_token_usage_repository import AiTokenUsageRepository
from ..models.ai_token_usage import ApiProvider, RequestType, AiTokenUsage
from ..constants.models import get_model_pricing


class TokenUsageService:
    """
    High-level service for token usage tracking.
    Provides convenient methods for recording and querying usage.
    """
    
    def __init__(self, session: Session):
        self._session = session
        self._repository = AiTokenUsageRepository(session)
    
    def record_usage(
        self,
        api_provider: ApiProvider,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        request_type: RequestType,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        model: Optional[str] = None,
        request_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        input_token_price: Optional[float] = None,
        output_token_price: Optional[float] = None,
        total_price: Optional[float] = None,
        tts_provider: Optional[str] = None,
        character_count: Optional[int] = None,
        *,
        use_case: Optional[str] = None,
        actor_kind: Optional[str] = None,
        actor_user_id: Optional[str] = None,
        actor_role_class: Optional[str] = None,
        actor_roles_raw: Optional[List[Any]] = None,
        role_source: Optional[str] = None,
        actor_display_name: Optional[str] = None,
        subject_user_id: Optional[str] = None,
        subject_display_name: Optional[str] = None,
        surface: Optional[str] = None,
        source_service: Optional[str] = None,
        usage_context: Optional[Dict[str, Any]] = None,
        router: Optional[str] = None,
        provider: Optional[str] = None,
        gateway_key_id: Optional[str] = None,
        byo_key: Optional[bool] = None,
        parent_event_id: Optional[str] = None,
        usage_event_id: Optional[str] = None,
        tool_key: Optional[str] = None,
        free_reason: Optional[str] = None,
        seconds: Optional[int] = None,
        meter_event: bool = True,
    ) -> AiTokenUsage:
        """
        Record token usage for an API call.
        
        Args:
            api_provider: API provider (OPENAI or GEMINI)
            prompt_tokens: Number of prompt tokens
            completion_tokens: Number of completion tokens
            total_tokens: Total tokens
            request_type: Type of request (OUTLINE, IMAGE, CONTENT, VIDEO, TTS, etc.)
            institute_id: Optional institute ID (string UUID)
            user_id: Optional user ID (string UUID)
            model: Optional model name
            request_id: Optional request identifier
            metadata: Optional metadata dictionary (will be JSON stringified)
            input_token_price: Optional price per input token
            output_token_price: Optional price per output token
            total_price: Optional total price (if not provided, will be calculated)
            tts_provider: Optional TTS provider (google, edge, elevenlabs) for TTS requests
            character_count: Optional character count for TTS requests
        
        Returns:
            Created AiTokenUsage record
        """
        # Convert string UUIDs to UUID objects
        institute_uuid = None
        user_uuid = None
        
        if institute_id:
            try:
                institute_uuid = UUID(institute_id)
            except (ValueError, AttributeError):
                pass
        
        if user_id:
            try:
                user_uuid = UUID(user_id)
            except (ValueError, AttributeError):
                pass
        
        # Convert metadata dict to JSON string
        metadata_str = None
        if metadata:
            import json
            metadata_str = json.dumps(metadata)
        
        # Auto-fetch pricing from model if not provided
        final_input_price = input_token_price
        final_output_price = output_token_price
        
        if model and (final_input_price is None or final_output_price is None):
            model_pricing = get_model_pricing(model)
            if model_pricing:
                if final_input_price is None:
                    final_input_price = model_pricing.get("input_token_price")
                if final_output_price is None:
                    final_output_price = model_pricing.get("output_token_price")
        
        # Calculate total price if not provided but pricing is available
        calculated_total_price = total_price
        if calculated_total_price is None and final_input_price is not None and final_output_price is not None:
            calculated_total_price = (final_input_price * prompt_tokens) + (final_output_price * completion_tokens)
        
        usage = self._repository.create_usage_record(
            api_provider=api_provider,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            request_type=request_type,
            institute_id=institute_uuid,
            user_id=user_uuid,
            model=model,
            request_id=request_id,
            metadata=metadata_str,
            input_token_price=final_input_price,
            output_token_price=final_output_price,
            total_price=calculated_total_price,
            tts_provider=tts_provider,
            character_count=character_count,
        )

        # Record-only usage (no deduction follows here): a FREE usage event,
        # written on a background session so this call never waits for it. A
        # later deduct_credits(usage_log_id=...) upgrades that event to CHARGED.
        if meter_event:
            try:
                from .metering import service as _metering

                _metering.queue_free_event(
                    self._session,
                    _metering.input_from(
                        None,
                        institute_id=institute_id,
                        request_type=request_type.value if hasattr(request_type, "value") else request_type,
                        model=model,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        character_count=character_count or 0,
                        seconds=seconds or 0,
                        user_id=user_id,
                        subject_user_id=subject_user_id,
                        metadata=metadata if isinstance(metadata, dict) else None,
                        real_cost_usd=calculated_total_price,
                        use_case=use_case, actor_kind=actor_kind, actor_user_id=actor_user_id,
                        actor_role_class=actor_role_class, actor_roles_raw=actor_roles_raw,
                        role_source=role_source, actor_display_name=actor_display_name,
                        subject_display_name=subject_display_name, surface=surface,
                        source_service=source_service, usage_context=usage_context, router=router,
                        provider=provider, gateway_key_id=gateway_key_id, byo_key=byo_key,
                        parent_event_id=parent_event_id, usage_event_id=usage_event_id, tool_key=tool_key,
                    ),
                    usage_log_id=str(usage.id) if usage is not None and getattr(usage, "id", None) else None,
                    free_reason=free_reason,
                )
            except Exception:  # noqa: BLE001 - metering never affects usage recording
                pass
        return usage
    
    def record_usage_and_deduct_credits(
        self,
        api_provider: ApiProvider,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        request_type: RequestType,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        model: Optional[str] = None,
        request_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        input_token_price: Optional[float] = None,
        output_token_price: Optional[float] = None,
        total_price: Optional[float] = None,
        tts_provider: Optional[str] = None,
        character_count: Optional[int] = None,
        seconds: Optional[int] = None,
        batch_id: Optional[str] = None,
        precomputed_credits: Optional[Decimal] = None,
        idempotency_key: Optional[str] = None,
        user_role: Optional[str] = None,
        subject_user_id: Optional[str] = None,
        allow_negative: bool = False,
        description: Optional[str] = None,
        *,
        use_case: Optional[str] = None,
        actor_kind: Optional[str] = None,
        actor_user_id: Optional[str] = None,
        actor_role_class: Optional[str] = None,
        actor_roles_raw: Optional[List[Any]] = None,
        role_source: Optional[str] = None,
        actor_display_name: Optional[str] = None,
        subject_display_name: Optional[str] = None,
        surface: Optional[str] = None,
        source_service: Optional[str] = None,
        usage_context: Optional[Dict[str, Any]] = None,
        router: Optional[str] = None,
        provider: Optional[str] = None,
        gateway_key_id: Optional[str] = None,
        byo_key: Optional[bool] = None,
        parent_event_id: Optional[str] = None,
        usage_event_id: Optional[str] = None,
        tool_key: Optional[str] = None,
    ) -> AiTokenUsage:
        """
        Record token usage AND deduct credits from institute balance.

        description: optional credit_transactions.description (defaults to
            "{request_type} using {model}"); tool charges add the price source.

        precomputed_credits: when set, the exact amount to deduct (bypasses
            token-based calculation). Used by the academy-credits parametric
            tools where charge = max(parametric_estimate, actual_token_cost).
        idempotency_key: dedup key for split/async charges (transcription).
        user_role / subject_user_id: per-user ledger attribution (Phase 3).
            user_id (already a param) is written to ai_token_usage too.
        
        This is a convenience method that combines record_usage with credit deduction.
        Use this for any API calls that should consume institute credits.
        
        Args:
            Same as record_usage()
        
        Returns:
            Created AiTokenUsage record
        """
        import logging
        logger = logging.getLogger(__name__)
        
        # Usage-event attribution (optional; never changes the charge or the ledger row).
        meter = {
            k: v for k, v in dict(
                use_case=use_case, actor_kind=actor_kind, actor_user_id=actor_user_id,
                actor_role_class=actor_role_class, actor_roles_raw=actor_roles_raw, role_source=role_source,
                actor_display_name=actor_display_name, subject_display_name=subject_display_name,
                surface=surface, source_service=source_service, usage_context=usage_context, router=router,
                provider=provider, gateway_key_id=gateway_key_id, byo_key=byo_key,
                parent_event_id=parent_event_id, usage_event_id=usage_event_id, tool_key=tool_key,
            ).items() if v is not None
        }

        # First, record the usage. With an institute the deduction below writes
        # the (CHARGED) usage event; without one this row is record-only, so
        # record_usage writes a FREE / NO_INSTITUTE event instead.
        usage_record = self.record_usage(
            api_provider=api_provider,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            request_type=request_type,
            institute_id=institute_id,
            user_id=user_id,
            model=model,
            request_id=request_id,
            metadata=metadata,
            input_token_price=input_token_price,
            output_token_price=output_token_price,
            total_price=total_price,
            tts_provider=tts_provider,
            character_count=character_count,
            subject_user_id=subject_user_id,
            seconds=seconds,
            meter_event=not institute_id,
            **meter,
        )
        
        # Then, deduct credits if institute_id is provided
        if institute_id:
            try:
                from .credit_service import CreditService
                from ..schemas.credits import CreditDeductRequest
                
                logger.info(f"[TokenUsageService] Attempting to deduct credits for institute_id={institute_id}, request_type={request_type}")
                
                credit_service = CreditService(self._session)
                deduct_request = CreditDeductRequest(
                    institute_id=institute_id,
                    request_type=request_type.value if hasattr(request_type, 'value') else str(request_type),
                    model=model or "unknown",
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    character_count=character_count or 0,
                    seconds=seconds or 0,
                    usage_log_id=str(usage_record.id) if usage_record and hasattr(usage_record, 'id') else None,
                    batch_id=batch_id,
                    precomputed_credits=precomputed_credits,
                    idempotency_key=idempotency_key,
                    user_id=user_id,
                    user_role=user_role,
                    subject_user_id=subject_user_id,
                    allow_negative=allow_negative,
                    description=description,
                )
                if meter:
                    try:
                        deduct_request = CreditDeductRequest(**{**deduct_request.model_dump(), **meter})
                    except Exception as meter_error:  # noqa: BLE001 - attribution never costs a charge
                        logger.warning(f"[TokenUsageService] metering fields ignored: {meter_error}")
                try:
                    # Hints for the usage-event writer (private; never serialized).
                    deduct_request._meter_fresh_usage_row = True
                    deduct_request._meter_real_cost_usd = (
                        float(usage_record.total_price)
                        if usage_record is not None and getattr(usage_record, "total_price", None) is not None
                        else None
                    )
                    deduct_request._meter_metadata = metadata if isinstance(metadata, dict) else None
                except Exception:  # noqa: BLE001
                    pass
                logger.info(f"[TokenUsageService] CreditDeductRequest created: {deduct_request}")
                
                deduct_result = credit_service.deduct_credits(deduct_request)
                logger.info(f"[TokenUsageService] Deducted {deduct_result.credits_deducted} credits for {request_type}. New balance: {deduct_result.new_balance}")
            except Exception as credit_error:
                import traceback
                error_trace = traceback.format_exc()
                logger.error(f"[TokenUsageService] Failed to deduct credits: {credit_error}")
                logger.error(f"[TokenUsageService] Traceback: {error_trace}")
                # Don't fail the usage recording if credit deduction fails
        
        return usage_record

    def refund_video_credits(self, video_id: str, institute_id: str) -> None:
        """
        Refund ALL credits charged for a video generation that failed.
        Uses batch_id (= video_id) to find all USAGE_DEDUCTION transactions,
        sums them up, and issues a single REFUND transaction.
        """
        import logging
        from decimal import Decimal
        from sqlalchemy import text

        logger = logging.getLogger(__name__)

        try:
            # Sum all deductions for this video using batch_id (set during deduction)
            # Net out REFUND rows already issued for this batch (per-shot AI
            # video / dialogue failures refund immediately via AiVideoLedger)
            # — otherwise a pipeline abort refunds those charges a SECOND time.
            query = text("""
                SELECT COALESCE(SUM(
                    CASE WHEN ct.transaction_type = 'USAGE_DEDUCTION' THEN ABS(ct.amount)
                         WHEN ct.transaction_type = 'REFUND' THEN -ABS(ct.amount)
                         ELSE 0 END
                ), 0) as total_deducted
                FROM credit_transactions ct
                WHERE ct.batch_id = :video_id
                  AND ct.transaction_type IN ('USAGE_DEDUCTION', 'REFUND')
                  AND ct.institute_id = :institute_id
            """)
            result = self._session.execute(query, {
                "video_id": video_id,
                "institute_id": institute_id,
            })
            row = result.fetchone()
            total_deducted = Decimal(str(row.total_deducted)) if row else Decimal("0")

            # AI plans: shots paid from a plan allowance have no ledger row, so
            # the sum above never sees them; give that allowance back. No-op
            # (no I/O) unless the institute has a live AI subscription.
            from .credit_service import CreditService as _PlanCS
            _PlanCS(self._session).restore_plan_allowance(institute_id, video_id)

            if total_deducted <= Decimal("0"):
                logger.info(f"[RefundVideo] No credits to refund for video {video_id}")
                return

            from .credit_service import CreditService
            credit_service = CreditService(self._session)
            credit_service.refund_credits(
                institute_id=institute_id,
                amount=total_deducted,
                description=f"Full refund for failed video generation {video_id}",
                batch_id=video_id,
            )
            logger.info(f"[RefundVideo] Refunded {total_deducted} credits for failed video {video_id}")

        except Exception as e:
            import traceback
            logger.error(f"[RefundVideo] Failed to refund credits for video {video_id}: {e}")
            logger.error(f"[RefundVideo] Traceback: {traceback.format_exc()}")

    def get_institute_usage(
        self,
        institute_id: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> List[AiTokenUsage]:
        """
        Get token usage records for an institute.
        
        Args:
            institute_id: Institute ID (string UUID)
            start_date: Optional start date filter
            end_date: Optional end date filter
        
        Returns:
            List of token usage records
        """
        try:
            institute_uuid = UUID(institute_id)
        except (ValueError, AttributeError):
            return []
        
        return self._repository.get_usage_by_institute(
            institute_id=institute_uuid,
            start_date=start_date,
            end_date=end_date,
        )
    
    def get_user_usage(
        self,
        user_id: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> List[AiTokenUsage]:
        """
        Get token usage records for a user.
        
        Args:
            user_id: User ID (string UUID)
            start_date: Optional start date filter
            end_date: Optional end date filter
        
        Returns:
            List of token usage records
        """
        try:
            user_uuid = UUID(user_id)
        except (ValueError, AttributeError):
            return []
        
        return self._repository.get_usage_by_user(
            user_id=user_uuid,
            start_date=start_date,
            end_date=end_date,
        )
    
    def get_usage_summary(
        self,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        group_by_provider: bool = True,
        group_by_type: bool = True,
    ) -> Dict[str, Any]:
        """
        Get aggregated usage summary.
        
        Args:
            institute_id: Optional institute ID (string UUID)
            user_id: Optional user ID (string UUID)
            start_date: Optional start date filter
            end_date: Optional end date filter
            group_by_provider: Group results by API provider
            group_by_type: Group results by request type
        
        Returns:
            Dictionary with usage statistics
        """
        institute_uuid = None
        user_uuid = None
        
        if institute_id:
            try:
                institute_uuid = UUID(institute_id)
            except (ValueError, AttributeError):
                pass
        
        if user_id:
            try:
                user_uuid = UUID(user_id)
            except (ValueError, AttributeError):
                pass
        
        return self._repository.get_usage_summary(
            institute_id=institute_uuid,
            user_id=user_uuid,
            start_date=start_date,
            end_date=end_date,
            group_by_provider=group_by_provider,
            group_by_type=group_by_type,
        )
    
    def get_daily_usage(
        self,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        days: int = 30,
    ) -> List[Dict[str, Any]]:
        """
        Get daily usage for the last N days.
        
        Args:
            institute_id: Optional institute ID (string UUID)
            user_id: Optional user ID (string UUID)
            days: Number of days to look back
        
        Returns:
            List of daily usage statistics
        """
        institute_uuid = None
        user_uuid = None
        
        if institute_id:
            try:
                institute_uuid = UUID(institute_id)
            except (ValueError, AttributeError):
                pass
        
        if user_id:
            try:
                user_uuid = UUID(user_id)
            except (ValueError, AttributeError):
                pass
        
        return self._repository.get_daily_usage(
            institute_id=institute_uuid,
            user_id=user_uuid,
            days=days,
        )
    
    def get_institute_activity_log(
        self,
        institute_id: str,
        page: int = 1,
        page_size: int = 20,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        request_type: Optional[RequestType] = None,
    ) -> tuple[List[AiTokenUsage], int]:
        """
        Get paginated activity log for an institute.
        
        Args:
            institute_id: Institute ID (string UUID)
            page: Page number (1-indexed)
            page_size: Number of records per page
            start_date: Optional start date filter
            end_date: Optional end date filter
            request_type: Optional request type filter
        
        Returns:
            Tuple of (list of records, total count)
        """
        try:
            institute_uuid = UUID(institute_id)
        except (ValueError, AttributeError):
            return [], 0
        
        return self._repository.get_institute_activity_log(
            institute_id=institute_uuid,
            page=page,
            page_size=page_size,
            start_date=start_date,
            end_date=end_date,
            request_type=request_type,
        )
    
    def get_institute_activity_log_by_user(
        self,
        institute_id: str,
        page: int = 1,
        page_size: int = 20,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        request_type: Optional[RequestType] = None,
    ) -> tuple[List[Dict[str, Any]], int]:
        """
        Get paginated activity log for an institute grouped by user.
        
        Args:
            institute_id: Institute ID (string UUID)
            page: Page number (1-indexed)
            page_size: Number of records per page
            start_date: Optional start date filter
            end_date: Optional end date filter
            request_type: Optional request type filter
        
        Returns:
            Tuple of (list of user activity records with aggregated stats, total count)
        """
        try:
            institute_uuid = UUID(institute_id)
        except (ValueError, AttributeError):
            return [], 0
        
        return self._repository.get_institute_activity_log_by_user(
            institute_id=institute_uuid,
            page=page,
            page_size=page_size,
            start_date=start_date,
            end_date=end_date,
            request_type=request_type,
        )


__all__ = ["TokenUsageService"]





