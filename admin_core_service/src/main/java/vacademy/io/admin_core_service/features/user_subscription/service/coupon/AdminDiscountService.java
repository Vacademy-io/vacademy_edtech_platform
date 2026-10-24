package vacademy.io.admin_core_service.features.user_subscription.service.coupon;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.AdminDiscountPreviewDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponValidateRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponValidateResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.AdminDiscountRequestDTO;

import java.util.Date;

/**
 * Discounts an ADMIN gives a learner, as opposed to a coupon the learner types.
 *
 * <p>An admin discount is an {@link AppliedCouponDiscount} row with
 * {@code discount_source = 'ADMIN'} and no coupon code. Attached to a user_plan it
 * rides the same rail as a coupon: the backend-derived gateway amount, the negative
 * payment_log_line_item, the invoice discount line and the ledger discount. The admin
 * may instead pick an existing coupon (mode COUPON); that resolves to the coupon's own
 * rule row and consumes a redemption via {@link CouponRedemptionService} like a learner
 * checkout. Either way the granting admin is recorded — on the ADMIN row, and on the
 * user_plan ({@code discount_granted_by_user_id}) because a coupon's rule row is shared.
 */
@Service
@RequiredArgsConstructor
public class AdminDiscountService {

    public static final String SOURCE_ADMIN = "ADMIN";
    public static final String MODE_PERCENTAGE = "PERCENTAGE";
    public static final String MODE_FLAT = "FLAT";
    public static final String MODE_COUPON = "COUPON";
    public static final String MODE_NONE = "NONE";

    private static final String STATUS_ACTIVE = "ACTIVE";

    private final AppliedCouponDiscountRepository appliedCouponDiscountRepository;
    private final CouponValidationService couponValidationService;
    private final PaymentPlanRepository paymentPlanRepository;
    private final CouponRedemptionService couponRedemptionService;

    /** True when the request actually asks for a discount. */
    public static boolean isRequested(AdminDiscountRequestDTO req) {
        return req != null && StringUtils.hasText(req.getMode())
                && !MODE_NONE.equalsIgnoreCase(req.getMode().trim());
    }

    /**
     * Resolves the discount an admin applies on a charge they are raising (manual
     * enroll, bulk assign). Ad-hoc modes persist a new ADMIN row; COUPON returns the
     * coupon's rule row (its redemption is consumed later by createUserPlan).
     *
     * @return null when no discount was requested
     */
    @Transactional
    public AppliedCouponDiscount resolveForCharge(AdminDiscountRequestDTO req,
                                                  String instituteId,
                                                  PaymentPlan paymentPlan,
                                                  PaymentOption paymentOption,
                                                  String packageSessionId,
                                                  String enrollInviteId,
                                                  String learnerEmail,
                                                  String adminUserId) {
        if (!isRequested(req)) {
            return null;
        }
        if (paymentPlan == null) {
            throw new VacademyException("A discount needs a payment plan to apply to");
        }
        requireDiscountablePlan(paymentOption != null ? paymentOption : paymentPlan.getPaymentOption());

        String mode = req.getMode().trim().toUpperCase();
        if (MODE_COUPON.equals(mode)) {
            return resolveCoupon(req.getCouponCode(), instituteId, paymentPlan, packageSessionId,
                    enrollInviteId, learnerEmail);
        }

        validateAdHoc(req, paymentPlan.getActualPrice(), true);
        AppliedCouponDiscount discount = newAdminRow(req, mode, instituteId, adminUserId,
                paymentPlan.getCurrency(), isSubscription(paymentOption, paymentPlan));
        return appliedCouponDiscountRepository.save(discount);
    }

    /**
     * Stamps the granting admin on a freshly created user_plan. The caller's later
     * save (or the enclosing transaction's flush) persists it.
     */
    public void stampGrantedBy(UserPlan userPlan, AppliedCouponDiscount discount, String adminUserId) {
        if (userPlan == null || discount == null) {
            return;
        }
        String grantedBy = StringUtils.hasText(discount.getGrantedByUserId())
                ? discount.getGrantedByUserId()
                : adminUserId;
        userPlan.setDiscountGrantedByUserId(grantedBy);
        userPlan.setDiscountGrantedAt(discount.getGrantedAt() != null ? discount.getGrantedAt() : new Date());
    }

    /** Gross / discount / net for an admin form, without persisting anything. */
    public AdminDiscountPreviewDTO preview(AdminDiscountRequestDTO req, String instituteId, String paymentPlanId,
                                           Double grossAmount, String packageSessionId, String enrollInviteId,
                                           String learnerEmail) {
        PaymentPlan plan = StringUtils.hasText(paymentPlanId)
                ? paymentPlanRepository.findById(paymentPlanId).orElse(null)
                : null;
        double gross = grossAmount != null ? grossAmount : (plan != null ? plan.getActualPrice() : 0.0);
        if (!isRequested(req)) {
            return AdminDiscountPreviewDTO.of(gross, 0.0, null);
        }
        if (plan != null) {
            requireDiscountablePlan(plan.getPaymentOption());
        }
        String mode = req.getMode().trim().toUpperCase();
        AppliedCouponDiscount rule;
        if (MODE_COUPON.equals(mode)) {
            rule = resolveCoupon(req.getCouponCode(), instituteId, plan, packageSessionId, enrollInviteId,
                    learnerEmail);
        } else {
            // The form previews before the admin has typed a reason.
            validateAdHoc(req, gross, false);
            rule = newAdminRow(req, mode, instituteId, null, null, false);
        }
        double net = CouponDiscountUtil.applyDiscount(gross, rule);
        return AdminDiscountPreviewDTO.of(gross, roundCurrency(gross - net), rule.getDiscountType());
    }

    /**
     * Discount rule for an admin invoice subtotal (no user_plan involved). With
     * {@code persist} false (the preview) nothing is written; otherwise an ad-hoc
     * discount is saved as an ADMIN row so the invoice's discount has an audit record.
     * A coupon's redemption is taken per invoice via {@link #consumeCouponUse}.
     */
    @Transactional
    public AppliedCouponDiscount resolveForInvoice(AdminDiscountRequestDTO req, String instituteId,
                                                   double subtotal, String adminUserId, boolean persist) {
        if (!isRequested(req)) {
            return null;
        }
        String mode = req.getMode().trim().toUpperCase();
        if (MODE_COUPON.equals(mode)) {
            return resolveCoupon(req.getCouponCode(), instituteId, null, null, null, null);
        }
        validateAdHoc(req, subtotal, persist);
        AppliedCouponDiscount row = newAdminRow(req, mode, instituteId, adminUserId, null, false);
        return persist ? appliedCouponDiscountRepository.save(row) : row;
    }

    /** Takes one redemption when the rule belongs to a coupon; no-op for ADMIN rows. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void consumeCouponUse(AppliedCouponDiscount rule) {
        if (rule != null && rule.getCouponCode() != null) {
            couponRedemptionService.consume(rule);
        }
    }

    // ── Billing-cycle limit ───────────────────────────────────────────────

    /**
     * How many charges the discount may reduce. ADMIN rows carry their own limit
     * (null = every cycle). Coupons keep their historical first-payment-only rule.
     */
    public static Integer cycleLimit(AppliedCouponDiscount discount) {
        if (discount == null) {
            return 0;
        }
        if (SOURCE_ADMIN.equals(discount.getDiscountSource())) {
            return discount.getApplyForCycles();
        }
        return 1;
    }

    /**
     * The plan's discount if it still has cycles left for the next charge, else null.
     * The discount is passed in (not read off the lazy association) so schedulers
     * running outside a transaction can load it by id.
     */
    public static AppliedCouponDiscount discountForNextCharge(UserPlan userPlan, AppliedCouponDiscount discount) {
        if (userPlan == null || discount == null) {
            return null;
        }
        // Renewals are discounted by ADMIN discounts only. Coupons keep their existing
        // behaviour exactly: never applied to a renewal (including a trial's first charge).
        if (!SOURCE_ADMIN.equals(discount.getDiscountSource())) {
            return null;
        }
        Integer limit = cycleLimit(discount);
        int used = userPlan.getDiscountCyclesApplied() != null ? userPlan.getDiscountCyclesApplied() : 0;
        return (limit == null || used < limit) ? discount : null;
    }

    // ── internals ─────────────────────────────────────────────────────────

    private AppliedCouponDiscount resolveCoupon(String couponCode, String instituteId, PaymentPlan plan,
                                                String packageSessionId, String enrollInviteId,
                                                String learnerEmail) {
        if (!StringUtils.hasText(couponCode)) {
            throw new VacademyException("coupon_code is required for a COUPON discount");
        }
        CouponValidateRequestDTO validate = CouponValidateRequestDTO.builder()
                .couponCode(couponCode)
                .instituteId(instituteId)
                .packageSessionId(packageSessionId)
                .enrollInviteId(enrollInviteId)
                .paymentPlanId(plan != null ? plan.getId() : null)
                .userEmail(learnerEmail)
                .totalAmount(plan != null ? plan.getActualPrice() : 0.0)
                .build();
        CouponValidateResponseDTO resp = couponValidationService.validate(validate);
        if (!resp.isValid()) {
            throw new VacademyException(resp.getMessage());
        }
        return appliedCouponDiscountRepository.findById(resp.getAppliedCouponDiscountId())
                .orElseThrow(() -> new VacademyException(
                        "Resolved AppliedCouponDiscount missing: " + resp.getAppliedCouponDiscountId()));
    }

    private AppliedCouponDiscount newAdminRow(AdminDiscountRequestDTO req, String mode, String instituteId,
                                              String adminUserId, String currency, boolean subscription) {
        AppliedCouponDiscount row = new AppliedCouponDiscount();
        row.setName("Admin discount");
        row.setDiscountType(MODE_PERCENTAGE.equals(mode) ? CouponDiscountUtil.TYPE_PERCENTAGE
                : CouponDiscountUtil.TYPE_FLAT);
        row.setDiscountPoint(req.getDiscountValue());
        row.setMaxDiscountPoint(MODE_PERCENTAGE.equals(mode) ? req.getMaxDiscountValue() : null);
        row.setCurrency(currency);
        row.setStatus(STATUS_ACTIVE);
        row.setDiscountSource(SOURCE_ADMIN);
        row.setGrantedByUserId(adminUserId);
        row.setGrantedAt(new Date());
        row.setGrantReason(req.getReason() != null ? req.getReason().trim() : null);
        row.setInstituteId(instituteId);
        // Cycles only mean something on a subscription; a one-time charge happens once.
        row.setApplyForCycles(subscription ? req.getApplyForCycles() : Integer.valueOf(1));
        return row;
    }

    private static void validateAdHoc(AdminDiscountRequestDTO req, Double gross, boolean requireReason) {
        String mode = req.getMode().trim().toUpperCase();
        if (!MODE_PERCENTAGE.equals(mode) && !MODE_FLAT.equals(mode)) {
            throw new VacademyException("discount mode must be PERCENTAGE, FLAT or COUPON");
        }
        if (req.getDiscountValue() == null || req.getDiscountValue() <= 0) {
            throw new VacademyException("discount_value must be > 0");
        }
        if (MODE_PERCENTAGE.equals(mode) && req.getDiscountValue() > 100) {
            throw new VacademyException("A percentage discount must be <= 100");
        }
        if (MODE_PERCENTAGE.equals(mode) && req.getMaxDiscountValue() != null && req.getMaxDiscountValue() <= 0) {
            throw new VacademyException("max_discount_value must be > 0 when given");
        }
        if (MODE_FLAT.equals(mode) && gross != null && req.getDiscountValue() > gross) {
            throw new VacademyException("A flat discount cannot exceed the price (" + gross + ")");
        }
        if (requireReason && !StringUtils.hasText(req.getReason())) {
            throw new VacademyException("A reason is required for an admin discount");
        }
        if (req.getApplyForCycles() != null && req.getApplyForCycles() < 1) {
            throw new VacademyException("apply_for_cycles must be >= 1, or empty for every cycle");
        }
    }

    private static void requireDiscountablePlan(PaymentOption option) {
        if (!isDiscountable(option)) {
            throw new VacademyException(CouponValidationMessages.NOT_FOR_PLAN_TYPE);
        }
    }

    /** Admin discounts apply to ONE_TIME and SUBSCRIPTION only (CPO has its own discounts). */
    private static boolean isDiscountable(PaymentOption option) {
        if (option == null || option.getType() == null) {
            return false;
        }
        return PaymentOptionType.ONE_TIME.name().equalsIgnoreCase(option.getType())
                || PaymentOptionType.SUBSCRIPTION.name().equalsIgnoreCase(option.getType());
    }

    private static boolean isSubscription(PaymentOption option, PaymentPlan plan) {
        PaymentOption effective = option != null ? option : (plan != null ? plan.getPaymentOption() : null);
        return effective != null
                && PaymentOptionType.SUBSCRIPTION.name().equalsIgnoreCase(effective.getType());
    }

    private static double roundCurrency(double amount) {
        return Math.round(amount * 100.0) / 100.0;
    }
}
