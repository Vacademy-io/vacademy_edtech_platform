package vacademy.io.admin_core_service.features.user_subscription.service.coupon;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.CouponCode;
import vacademy.io.admin_core_service.features.user_subscription.repository.CouponCodeRepository;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Apply-time atomic redemption.
 *
 * Call sites pass the resolved {@link AppliedCouponDiscount} immediately
 * before persisting the UserPlan row that references it. The decrement
 * happens in the caller's transaction so a failed decrement (status flipped
 * to INACTIVE by an admin mid-flight, or race-loss when usage_limit hits 0
 * concurrently) rolls the whole enrollment back.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CouponRedemptionService {

    private static final String STATUS_ACTIVE = "ACTIVE";

    private final CouponCodeRepository couponCodeRepository;

    /**
     * Consume one redemption slot. The flow:
     *
     *  1. Pull the parent {@link CouponCode} via the lazy ManyToOne. Because
     *     we run in the caller's transaction, the lazy proxy resolves here.
     *  2. Re-check status — admin may have soft-deleted the coupon between
     *     the learner's validate call and this apply-time consume.
     *  3. Unlimited coupons (usageLimit == null) skip the UPDATE entirely.
     *  4. Bounded coupons issue an atomic single-statement UPDATE-WHERE that
     *     also gates on status='ACTIVE'. A concurrent caller that drained the
     *     last slot first leaves us with 0 updated rows → we throw to roll
     *     back the enrollment transaction.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void consume(AppliedCouponDiscount appliedDiscount) {
        if (appliedDiscount == null) return;
        CouponCode coupon = appliedDiscount.getCouponCode();
        if (coupon == null && AdminDiscountService.SOURCE_ADMIN.equals(appliedDiscount.getDiscountSource())) {
            return; // admin discount — no coupon, nothing to redeem
        }
        if (coupon == null) {
            log.warn("AppliedCouponDiscount {} has no parent CouponCode — skipping decrement",
                    appliedDiscount.getId());
            return;
        }
        if (!STATUS_ACTIVE.equalsIgnoreCase(coupon.getStatus())) {
            log.info("Coupon {} no longer ACTIVE at apply-time (status={})",
                    coupon.getCode(), coupon.getStatus());
            throw new VacademyException(CouponValidationMessages.INACTIVE);
        }
        if (coupon.getUsageLimit() == null) {
            return; // unlimited — no decrement needed
        }
        int updated = couponCodeRepository.tryDecrementUsageLimit(coupon.getId());
        if (updated == 0) {
            log.info("Coupon {} race-lost at apply-time (usage_limit exhausted)", coupon.getCode());
            throw new VacademyException(CouponValidationMessages.LIMIT_REACHED);
        }
    }
}
