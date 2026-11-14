package vacademy.io.admin_core_service.features.user_subscription.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralMapping;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralRewardCredit;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.ReferralBenefitLogsBeneficiary;
import vacademy.io.admin_core_service.features.user_subscription.enums.ReferralStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.ReferralRewardCreditRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponDiscountUtil;

import java.util.Date;
import java.util.Optional;

/**
 * Referral discounts that are spent on a LATER charge than the enrolment that earned them.
 *
 * <p>Two cases, both riding the admin-discount rail (an {@link AppliedCouponDiscount} row
 * with {@code discount_source = 'REFERRAL_REWARD'}), so the gateway amount, the negative
 * payment_log_line_item, the invoice line and the cycle counting are all reused:
 * <ul>
 *   <li><b>Referee on a trial.</b> Signup only takes a Rs 1 mandate authorisation, so a
 *       discount taken off the checkout amount is lost. Instead the rule is attached to the
 *       referee's plan for one cycle; RenewalChargeService applies it to the first real charge
 *       at trial end.</li>
 *   <li><b>Referrer.</b> The reward is the referrer's own next renewal, never the referee's
 *       payment. It is held as a {@link ReferralRewardCredit}: PENDING until the referee
 *       converts, then AVAILABLE, RESERVED by a renewal charge, CONSUMED once that charge is
 *       PAID. One credit per referral, one credit per renewal.</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ReferralRewardService {

    private static final String STATUS_ACTIVE = "ACTIVE";

    private final AppliedCouponDiscountRepository appliedCouponDiscountRepository;
    private final ReferralRewardCreditRepository creditRepository;
    private final UserPlanRepository userPlanRepository;

    /**
     * Routes a PERCENTAGE / FLAT referral benefit, for the discount handlers.
     *
     * @return true when the caller should take the discount off THIS checkout (a referee on a
     *         non-trial plan with no other discount); false when it was deferred (referrer
     *         credit, referee trial) or skipped because the plan already carries a discount
     */
    public boolean routeDiscountBenefit(ReferralMapping mapping, String referrerUserId, String instituteId,
                                        String beneficiary, String mappingStatus,
                                        String mode, Double value, Double maxDiscount) {
        if (value == null || value <= 0) {
            return false;
        }
        if (!ReferralBenefitLogsBeneficiary.REFEREE.name().equalsIgnoreCase(beneficiary)) {
            // The referrer's reward is their own next renewal, never the referee's payment.
            createReferrerCredit(mapping, referrerUserId, instituteId, mode, value, maxDiscount, mappingStatus);
            return false;
        }
        UserPlan plan = mapping.getUserPlan();
        if (plan != null && Boolean.TRUE.equals(plan.getIsTrial())) {
            attachRefereeDiscountToTrialPlan(plan, instituteId, mode, value, maxDiscount);
            return false;
        }
        // One discount per charge: a coupon or admin discount already on the plan wins.
        if (plan != null && plan.getAppliedCouponDiscountId() != null) {
            log.info("Referral: plan {} already has discount {} — referee checkout discount not stacked",
                    plan.getId(), plan.getAppliedCouponDiscountId());
            return false;
        }
        return true;
    }

    /**
     * Attaches the referee's referral discount to their trial plan for its first real charge.
     * An ADMIN discount already on the plan wins (one discount per charge); a coupon does not,
     * because coupons never reach a renewal and the trial's first charge IS a renewal.
     *
     * @return the rule attached, or null when the plan keeps its existing discount
     */
    public AppliedCouponDiscount attachRefereeDiscountToTrialPlan(UserPlan userPlan, String instituteId,
                                                                  String mode, Double value, Double maxDiscount) {
        AppliedCouponDiscount existing = userPlan.getAppliedCouponDiscountId() != null
                ? appliedCouponDiscountRepository.findById(userPlan.getAppliedCouponDiscountId()).orElse(null)
                : null;
        if (existing != null && AdminDiscountService.SOURCE_ADMIN.equals(existing.getDiscountSource())) {
            log.info("Referral: trial plan {} already carries admin discount {} — referee discount not added",
                    userPlan.getId(), existing.getId());
            return null;
        }
        AppliedCouponDiscount rule = saveRule(instituteId, mode, value, maxDiscount, "Referral discount");
        userPlan.setAppliedCouponDiscountId(rule.getId());
        userPlan.setAppliedCouponDiscount(rule);
        // The counter belongs to the attached discount, and this one has not been used yet.
        userPlan.setDiscountCyclesApplied(0);
        userPlanRepository.save(userPlan);
        log.info("Referral: attached {} {} discount {} to trial plan {} for its first paid charge",
                value, mode, rule.getId(), userPlan.getId());
        return rule;
    }

    /**
     * Records the referrer's reward for a referral. AVAILABLE straight away when the referral
     * is already ACTIVE (free / donation enrolments), otherwise PENDING until conversion.
     * Idempotent per referral.
     */
    public void createReferrerCredit(ReferralMapping mapping, String referrerUserId, String instituteId,
                                     String mode, Double value, Double maxDiscount, String mappingStatus) {
        String beneficiary = ReferralBenefitLogsBeneficiary.REFERRER.name();
        if (creditRepository.existsByReferralMappingIdAndBeneficiary(mapping.getId(), beneficiary)) {
            return;
        }
        AppliedCouponDiscount rule = saveRule(instituteId, mode, value, maxDiscount, "Referral reward");
        creditRepository.save(ReferralRewardCredit.builder()
                .instituteId(instituteId)
                .userId(referrerUserId)
                .beneficiary(beneficiary)
                .referralMappingId(mapping.getId())
                .appliedCouponDiscountId(rule.getId())
                .status(ReferralStatusEnum.ACTIVE.name().equalsIgnoreCase(mappingStatus)
                        ? ReferralRewardCredit.STATUS_AVAILABLE
                        : ReferralRewardCredit.STATUS_PENDING)
                .build());
        log.info("Referral: {} {} credit for referrer {} on referral {} ({})",
                value, mode, referrerUserId, mapping.getId(), mappingStatus);
    }

    /** The referee converted: the referrer's credit for this referral becomes spendable. */
    public void releaseReferrerCredit(String referralMappingId) {
        int released = creditRepository.releaseForMapping(referralMappingId);
        if (released > 0) {
            log.info("Referral: released {} referrer credit(s) for referral {}", released, referralMappingId);
        }
    }

    /**
     * The referral credit a renewal of this plan spends, reserved to the plan so that another
     * of the member's plans (or another replica) cannot spend it too. Null when there is none.
     * The caller has already decided the plan's own discount does not apply.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public AppliedCouponDiscount reserveCreditForRenewal(UserPlan plan, String instituteId) {
        Optional<ReferralRewardCredit> usable = creditRepository.findUsableForPlan(
                plan.getUserId(), instituteId, plan.getId());
        if (usable.isEmpty()) {
            return null;
        }
        ReferralRewardCredit credit = usable.get();
        if (ReferralRewardCredit.STATUS_AVAILABLE.equals(credit.getStatus())
                && creditRepository.reserve(credit.getId(), plan.getId()) == 0) {
            // Lost a race for this credit; the next renewal picks up the next one.
            return null;
        }
        AppliedCouponDiscount rule = appliedCouponDiscountRepository
                .findById(credit.getAppliedCouponDiscountId()).orElse(null);
        if (rule != null) {
            log.info("Referral: plan {} renewal uses referrer credit {} (discount {})",
                    plan.getId(), credit.getId(), rule.getId());
        }
        return rule;
    }

    /** A renewal of this plan was confirmed PAID: spend the credit whose line is on the log. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void consumeCreditsForPaidRenewal(String userPlanId, String paymentLogId) {
        int consumed = creditRepository.consumeForPaidLog(userPlanId, paymentLogId);
        if (consumed > 0) {
            log.info("Referral: consumed {} referrer credit(s) on plan {} payment {}",
                    consumed, userPlanId, paymentLogId);
        }
    }

    /**
     * The money cap of a percentage referral benefit, or null for none. Until 2026-10 the admin
     * app saved the percentage itself as the cap, so every stored "10%" benefit carries
     * {@code maxDiscount: 10} and would be capped at Rs 10; a cap equal to the percentage is
     * that bug, not a choice, and is ignored. A cap of 0 / empty also means none.
     */
    public static Double effectiveCap(Double percentage, Double maxDiscount) {
        if (maxDiscount == null || maxDiscount <= 0) {
            return null;
        }
        if (percentage != null && Double.compare(percentage, maxDiscount) == 0) {
            return null;
        }
        return maxDiscount;
    }

    private AppliedCouponDiscount saveRule(String instituteId, String mode, Double value, Double maxDiscount,
                                           String name) {
        boolean percentage = AdminDiscountService.MODE_PERCENTAGE.equals(mode);
        AppliedCouponDiscount rule = new AppliedCouponDiscount();
        rule.setName(name);
        rule.setDiscountType(percentage ? CouponDiscountUtil.TYPE_PERCENTAGE : CouponDiscountUtil.TYPE_FLAT);
        rule.setDiscountPoint(value);
        // A cap only means something on a percentage, and only when it is a real amount.
        rule.setMaxDiscountPoint(percentage ? effectiveCap(value, maxDiscount) : null);
        rule.setStatus(STATUS_ACTIVE);
        rule.setDiscountSource(AdminDiscountService.SOURCE_REFERRAL);
        rule.setGrantedAt(new Date());
        rule.setInstituteId(instituteId);
        rule.setApplyForCycles(1);
        return appliedCouponDiscountRepository.save(rule);
    }
}
