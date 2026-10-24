package vacademy.io.admin_core_service.features.enrollment_policy.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.plan_change.service.PlanChangeService;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.ReferralRewardService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService;

/**
 * The discount on a renewal charge, shared by the autopay sweep (RenewalChargeService) and
 * the learner's manual "pay to continue" (SubscriptionService) so both bill the same amount.
 *
 * <p>One discount per charge: the plan's own admin / referral discount while it has cycles
 * left, else one of the member's referrer credits. Coupons never reach renewals.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RenewalDiscountResolver {

    private final PlanChangeService planChangeService;
    private final AppliedCouponDiscountRepository appliedCouponDiscountRepository;
    private final ReferralRewardService referralRewardService;

    /** The discount for this plan's next charge, or null. Never throws: full price instead. */
    public AppliedCouponDiscount resolve(UserPlan plan, String instituteId) {
        AppliedCouponDiscount own = resolvePlanDiscount(plan);
        if (own != null) {
            return own;
        }
        try {
            return referralRewardService.reserveCreditForRenewal(plan, instituteId);
        } catch (Exception e) {
            log.error("[RenewalDiscount] Plan {} referral credit lookup failed — charging without it: {}",
                    plan.getId(), e.getMessage());
            return null;
        }
    }

    /**
     * The discount for a learner's manual "pay to continue": referral discounts only. Admin
     * discounts have never applied to a manual renewal and keep that behaviour unchanged;
     * a referral reward is new, so it is honoured on whichever renewal comes first.
     */
    public AppliedCouponDiscount resolveReferralOnly(UserPlan plan, String instituteId) {
        AppliedCouponDiscount own = resolvePlanDiscount(plan);
        if (own != null) {
            return AdminDiscountService.SOURCE_REFERRAL.equals(own.getDiscountSource()) ? own : null;
        }
        try {
            return referralRewardService.reserveCreditForRenewal(plan, instituteId);
        } catch (Exception e) {
            log.error("[RenewalDiscount] Plan {} referral credit lookup failed — charging without it: {}",
                    plan.getId(), e.getMessage());
            return null;
        }
    }

    /**
     * {@code grossAmount} less the discount. A charge for a booked plan change is billed at the
     * target plan's base price, so the regional scale applies only when renewing the same plan.
     */
    public double applyDiscount(UserPlan plan, double grossAmount, AppliedCouponDiscount discount) {
        if (discount == null) {
            return grossAmount;
        }
        double scale = planChangeService.pendingTargetPlan(plan) == null ? RegionalPriceLock.scale(plan) : 1.0;
        return RegionalPriceLock.applyDiscount(grossAmount, scale, discount);
    }

    /**
     * The plan's own discount if it applies to this cycle. A downgrade booked for the end of the
     * cycle lands at exactly this renewal and ends the plan's discount.
     */
    private AppliedCouponDiscount resolvePlanDiscount(UserPlan plan) {
        if (!StringUtils.hasText(plan.getAppliedCouponDiscountId())) {
            return null;
        }
        try {
            if (planChangeService.pendingTargetPlan(plan) != null) {
                return null;
            }
            AppliedCouponDiscount discount = appliedCouponDiscountRepository
                    .findById(plan.getAppliedCouponDiscountId()).orElse(null);
            return AdminDiscountService.discountForNextCharge(plan, discount);
        } catch (Exception e) {
            // Fall back to the full price rather than skipping the renewal.
            log.error("[RenewalDiscount] Plan {} discount lookup failed — charging full price: {}",
                    plan.getId(), e.getMessage());
            return null;
        }
    }
}
