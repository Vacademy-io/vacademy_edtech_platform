"""
AI video credit ledger writer.

Bridges the AI video orchestrator's in-process `AiVideoCostTracker` (USD)
with the global credit ledger (`credit_transactions` rows). One charge
per shot / chain / inline tag; one refund per per-shot failure. Pipeline-
level aborts continue to use `TokenUsageService.refund_video_credits()`
which sums by batch_id and writes a single rollup REFUND row.

Why a separate module
---------------------
The orchestrator runs charge/refund calls from a `ThreadPoolExecutor`. Each
worker opens a fresh, short-lived `db_session()` rather than sharing the
pipeline's main session — sharing would either serialize all worker DB
writes through one connection or trip SQLAlchemy's threadsafety guards.

The class is intentionally tiny: USD in, credit ledger row out. The
USD→credits conversion uses the live rate from `credit_rate_config` (V252)
so a rate change propagates without redeploying the AI service.
"""
from __future__ import annotations

import logging
import threading
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Optional, Set, Tuple


logger = logging.getLogger(__name__)


# Request type used for every Veo deduction. Surfaces as its own bucket
# in /credits/v1/usage analytics; matches the `ai_video` row added to
# DEFAULT_PRICING.
AI_VIDEO_REQUEST_TYPE = "ai_video"

# Default model label written to credit_transactions.model_name. The
# pipeline can override via the ledger constructor if/when we ship more
# than one Veo variant.
DEFAULT_AI_VIDEO_MODEL = "fal-ai/veo-3.1-lite"


class AiVideoLedgerInsufficient(RuntimeError):
    """Raised when a shot's ledger deduction fails for insufficient credits.

    The orchestrator catches this AFTER `cost_tracker.try_charge` has
    already succeeded — so the tracker reservation is rolled back and
    the shot is treated as `CircuitBreakerExhausted` (falls through to a
    non-AI shot type). Pre-flight should have prevented this, but a race
    between concurrent shots or a stale balance can still trip it.
    """

    def __init__(self, *, requested_credits: Decimal, message: str):
        super().__init__(message)
        self.requested_credits = requested_credits


class AiVideoLedger:
    """Thread-safe per-run ledger writer.

    Bound to (institute_id, video_id). Each `charge` / `refund` opens its
    own short-lived DB session via `db_session()`. Concurrent shots may
    charge in parallel; `CreditService.deduct_credits` uses an atomic
    `UPDATE ... WHERE current_balance >= :amount` that prevents races.

    Pass `None` for `institute_id` to disable ledger writes (legacy mode —
    keeps the orchestrator working when called outside a credit-aware
    pipeline, e.g. unit tests).
    """

    def __init__(
        self,
        *,
        institute_id: Optional[str],
        video_id: Optional[str],
        model: str = DEFAULT_AI_VIDEO_MODEL,
    ) -> None:
        self.institute_id = institute_id
        self.video_id = video_id
        self.model = model
        self._lock = threading.Lock()
        # Running totals — surfaced in the run summary alongside the
        # tracker's USD totals so we can sanity-check parity.
        self._charged_credits = Decimal("0")
        self._refunded_credits = Decimal("0")
        # Idempotency-key occurrence per (shot, segment) within THIS leg: a
        # shot with several inline <aivideo> tags makes several separate
        # charges, and only the n-th charge of a resumed leg may replay the
        # n-th charge of the leg it resumes.
        self._charge_seq: Dict[Tuple[int, Optional[int]], int] = {}
        # Shots the user sent back from the contact sheet (assist): their
        # re-render is a new, billable charge — scoped apart from the first.
        self.regen_shots: Set[int] = set()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def enabled(self) -> bool:
        return bool(self.institute_id and self.video_id)

    @property
    def total_charged_credits(self) -> Decimal:
        with self._lock:
            return self._charged_credits

    @property
    def total_refunded_credits(self) -> Decimal:
        with self._lock:
            return self._refunded_credits

    @property
    def net_credits(self) -> Decimal:
        with self._lock:
            return self._charged_credits - self._refunded_credits

    # ------------------------------------------------------------------
    # Operations
    # ------------------------------------------------------------------

    def charge(
        self,
        *,
        cost_usd: float,
        shot_idx: int,
        duration_s: int,
        audio_on: bool,
        segment_idx: Optional[int] = None,
    ) -> Decimal:
        """Deduct credits for one AI video shot / segment / inline tag.

        Returns the credits actually deducted. Raises
        `AiVideoLedgerInsufficient` if the institute's balance can't cover
        it. Caller is responsible for rolling back the cost-tracker
        reservation when this raises (the orchestrator does exactly that).
        """
        if not self.enabled:
            return Decimal("0")
        if cost_usd <= 0:
            return Decimal("0")

        # Absolute-first: when this module is loaded WITHOUT package context
        # (the pipeline's from-disk fallback), relative imports raise
        # "attempted relative import with no known parent package" — which
        # demoted EVERY dialogue clip at charge time in prod. Absolute works
        # in both contexts once ai_service/ is on sys.path.
        try:
            from app.db import db_session
            from app.schemas.credits import CreditDeductRequest
            from app.services.credit_rate_service import CreditRateService
            from app.services.credit_service import CreditService
        except ImportError:
            from ..db import db_session
            from ..schemas.credits import CreditDeductRequest
            from .credit_rate_service import CreditRateService
            from .credit_service import CreditService

        # Compute credits via the live ratio. We bypass calculate_credits
        # because Veo pricing is non-uniform (audio × duration) and lives
        # in fal_veo_client._PRICE_PER_SECOND_USD — not in ai_models.
        with db_session() as db:
            ratio = CreditRateService(db).get_effective_ratio()
            credits = (Decimal(str(cost_usd)) * ratio).quantize(
                Decimal("0.0001"), rounding=ROUND_HALF_UP
            )

            description = _format_description(
                shot_idx=shot_idx,
                segment_idx=segment_idx,
                duration_s=duration_s,
                audio_on=audio_on,
            )

            with self._lock:
                _occ = self._charge_seq.get((shot_idx, segment_idx), 0)
                self._charge_seq[(shot_idx, segment_idx)] = _occ + 1
            idem_key = charge_idempotency_key(
                db, self.video_id, self.institute_id, shot_idx, segment_idx,
                occurrence=_occ, scope=("regen" if shot_idx in self.regen_shots else None),
            )
            request = CreditDeductRequest(
                institute_id=self.institute_id,
                request_type=AI_VIDEO_REQUEST_TYPE,
                model=self.model,
                seconds=duration_s,
                batch_id=self.video_id,
                precomputed_credits=credits,
                description=description,
                idempotency_key=idem_key,
            )
            response = CreditService(db).deduct_credits(request)
        if response.success and "idempotent" in str(getattr(response, "message", "") or "").lower():
            # Replayed after a kill/resume: this shot was charged by an earlier
            # leg. Report the charge (a later per-shot failure still refunds
            # what was paid) without debiting again.
            logger.info(
                "[AiVideoLedger] Replay of an earlier charge for shot=%s seg=%s (video=%s, key=%s) — no new debit",
                shot_idx, segment_idx, self.video_id, idem_key,
            )

        if not response.success:
            logger.warning(
                "[AiVideoLedger] Charge failed for institute=%s video=%s shot=%s seg=%s "
                "credits=%s (response: %s)",
                self.institute_id,
                self.video_id,
                shot_idx,
                segment_idx,
                credits,
                response.message,
            )
            raise AiVideoLedgerInsufficient(
                requested_credits=credits,
                message=(
                    f"AI video shot {shot_idx} "
                    f"({credits} credits) exceeds available balance"
                ),
            )

        with self._lock:
            self._charged_credits += credits

        logger.info(
            "[AiVideoLedger] Charged %s credits for shot=%s seg=%s (institute=%s video=%s)",
            credits,
            shot_idx,
            segment_idx,
            self.institute_id,
            self.video_id,
        )
        return credits

    def refund(
        self,
        *,
        credits: Decimal,
        shot_idx: int,
        reason: str,
        segment_idx: Optional[int] = None,
    ) -> None:
        """Issue a REFUND row for a previously-charged shot.

        Used on per-shot Veo failures (safety block, timeout, chain
        ffmpeg failure) where the shot falls back to a non-AI type and
        the rest of the pipeline continues. NOT used on full-pipeline
        aborts — those are handled by `refund_video_credits` summing
        by batch_id.
        """
        if not self.enabled:
            return
        if credits is None or credits <= 0:
            return

        try:
            from app.db import db_session
            from app.services.credit_service import CreditService
        except ImportError:
            from ..db import db_session
            from .credit_service import CreditService

        try:
            with db_session() as db:
                CreditService(db).refund_credits(
                    institute_id=self.institute_id,
                    amount=credits,
                    description=_format_refund_description(
                        shot_idx=shot_idx,
                        segment_idx=segment_idx,
                        reason=reason,
                    ),
                    batch_id=self.video_id,
                )
        except Exception as exc:  # noqa: BLE001
            # Refund failure is non-fatal — the pipeline-level safety net
            # (`refund_video_credits` by batch_id on full abort) is a
            # backstop, and over-charge by one shot is bounded.
            logger.error(
                "[AiVideoLedger] Refund failed for shot=%s seg=%s credits=%s (%s)",
                shot_idx,
                segment_idx,
                credits,
                exc,
            )
            return

        with self._lock:
            self._refunded_credits += credits

        logger.info(
            "[AiVideoLedger] Refunded %s credits for shot=%s seg=%s (institute=%s video=%s reason=%s)",
            credits,
            shot_idx,
            segment_idx,
            self.institute_id,
            self.video_id,
            reason,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FULL_VIDEO_REFUND_PREFIX = "Full refund for failed video generation"


def charge_idempotency_key(
    db, video_id: Optional[str], institute_id: Optional[str], shot_idx: int, segment_idx: Optional[int],
    occurrence: int = 0, scope: Optional[str] = None,
) -> Optional[str]:
    """``{video_id}:aivideo:{shot}[:{scope}]:{seg}:c{k}:r{n}`` — the k-th
    charge of a shot/segment in a leg, per refund generation. ``n`` counts
    this shot's per-shot REFUND rows plus full-video refunds, so a shot
    charged before a kill is not charged again on resume, while a shot
    refunded after a failure (or a fully refunded video being retried) is
    billable again. ``k`` keeps several charges of one shot in one leg (inline
    ``<aivideo>`` tags) apart; ``scope`` ("regen") keeps a user-requested
    re-render apart from the first render. ``seg`` is the segment index, or
    ``x`` for a whole-shot charge. None when the count cannot be read (the
    charge then goes through un-keyed, as before)."""
    if not video_id:
        return None
    seg_key = str(segment_idx) if segment_idx is not None else "x"
    if scope:
        seg_key = f"{scope}:{seg_key}"
    seg_key = f"{seg_key}:c{int(occurrence or 0)}"
    seg_desc = f"/seg{segment_idx}" if segment_idx is not None else ""
    try:
        from sqlalchemy import text

        n = db.execute(
            text(
                "SELECT count(*) FROM credit_transactions "
                "WHERE batch_id = :v AND institute_id = :i AND transaction_type = 'REFUND' "
                "AND (description LIKE :shot OR description LIKE :full)"
            ),
            {
                "v": video_id,
                "i": institute_id,
                "shot": f"AI video shot {shot_idx}{seg_desc} refund%",
                "full": _FULL_VIDEO_REFUND_PREFIX + "%",
            },
        ).scalar() or 0
    except Exception as exc:  # noqa: BLE001
        logger.warning("[AiVideoLedger] refund count failed for %s shot %s (%s); un-keyed charge",
                       video_id, shot_idx, exc)
        return None
    return f"{video_id}:aivideo:{shot_idx}:{seg_key}:r{int(n)}"


def _format_description(
    *,
    shot_idx: int,
    segment_idx: Optional[int],
    duration_s: int,
    audio_on: bool,
) -> str:
    seg = f"/seg{segment_idx}" if segment_idx is not None else ""
    audio = "audio" if audio_on else "silent"
    return f"AI video shot {shot_idx}{seg} ({duration_s}s, {audio})"


def _format_refund_description(
    *,
    shot_idx: int,
    segment_idx: Optional[int],
    reason: str,
) -> str:
    seg = f"/seg{segment_idx}" if segment_idx is not None else ""
    reason_clean = (reason or "failure").strip()[:80]
    return f"AI video shot {shot_idx}{seg} refund: {reason_clean}"
