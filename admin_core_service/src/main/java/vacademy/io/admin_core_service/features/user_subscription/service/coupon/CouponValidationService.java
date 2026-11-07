package vacademy.io.admin_core_service.features.user_subscription.service.coupon;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponValidateRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponValidateResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.CouponCode;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.CouponSourceType;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.CouponCodeRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.CouponEnrollInviteRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.CouponPackageSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;

import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * Validates a coupon against a learner checkout context. Enforces a strict
 * ladder of checks in the order documented in the plan so the FE gets a
 * deterministic error code. Hard-restriction scoping: if the coupon has any
 * package_session or enroll_invite scope rows, the checkout context MUST
 * match one of them; an empty scope means institute-wide. Legacy
 * PRODUCT_PAGE coupons match by product_page_code → source_id.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CouponValidationService {

    private static final String STATUS_ACTIVE = "ACTIVE";

    private final CouponCodeRepository couponCodeRepository;
    private final AppliedCouponDiscountRepository appliedCouponDiscountRepository;
    private final CouponPackageSessionRepository couponPackageSessionRepository;
    private final CouponEnrollInviteRepository couponEnrollInviteRepository;
    private final ProductPageRepository productPageRepository;
    private final PaymentPlanRepository paymentPlanRepository;
    private final ObjectMapper objectMapper;

    public CouponValidateResponseDTO validate(CouponValidateRequestDTO request) {
        // 1. Lookup — institute-scoped so two institutes can share a code post-V309.
        //    Legacy PRODUCT_PAGE coupons may have institute_id backfilled (V309)
        //    or be orphans with null; for the product-page surface we fall back to
        //    a code+source-type lookup and let scopeMatches() verify ownership.
        String code = request.getCouponCode() == null ? "" : request.getCouponCode().trim().toUpperCase();
        Optional<CouponCode> couponOpt =
                couponCodeRepository.findByInstituteIdAndCode(request.getInstituteId(), code);
        if (couponOpt.isEmpty() && request.getProductPageCode() != null) {
            couponOpt = couponCodeRepository.findByCodeAndSourceType(
                    code, CouponSourceType.PRODUCT_PAGE.getValue());
        }
        if (couponOpt.isEmpty()) {
            return invalid(CouponValidationMessages.INVALID);
        }
        CouponCode coupon = couponOpt.get();

        // 2. Active
        if (!STATUS_ACTIVE.equalsIgnoreCase(coupon.getStatus())) {
            return invalid(CouponValidationMessages.INACTIVE);
        }

        // 3. Validity window
        Date now = new Date();
        // Start date is persisted as the FE's UTC midnight; on east-of-UTC
        // servers that lands several hours after the admin's intended
        // "starts today" wall-clock. Normalize to start-of-day in the server
        // local TZ so the coupon goes live at the local midnight the admin
        // expected, symmetric to the end-of-day handling below.
        if (coupon.getRedeemStartDate() != null && startOfDay(coupon.getRedeemStartDate()).after(now)) {
            return invalid(CouponValidationMessages.NOT_STARTED);
        }
        // End date is typically persisted as midnight (java.sql.Date.valueOf) — treat
        // it as inclusive of the entire day so a coupon valid "through 2026-05-28"
        // doesn't expire at 2026-05-28 00:00:01.
        if (coupon.getRedeemEndDate() != null && endOfDay(coupon.getRedeemEndDate()).before(now)) {
            return invalid(CouponValidationMessages.EXPIRED);
        }

        // 4. Usage limit (null = unlimited)
        if (coupon.getUsageLimit() != null && coupon.getUsageLimit() <= 0) {
            return invalid(CouponValidationMessages.LIMIT_REACHED);
        }

        // 5. Email restriction
        if (coupon.isEmailRestricted() && !emailAllowed(coupon.getAllowedEmailIds(), request.getUserEmail())) {
            return invalid(CouponValidationMessages.EMAIL_RESTRICTED);
        }

        // 6. Hard scope
        if (!scopeMatches(coupon, request)) {
            return invalid(CouponValidationMessages.NOT_APPLICABLE);
        }

        // 7. Payment-type gate — block FREE / DONATION / CPO when the FE supplies
        //    paymentPlanId. We mirror ReferralBenefitOrchestrator's precedent of
        //    short-circuiting FREE / DONATION. CPO uses concessions (see
        //    StudentFeeAdjustmentHistory) for fee discounts; coupons don't fit.
        if (!planTypeAllowsCoupon(request.getPaymentPlanId())) {
            return invalid(CouponValidationMessages.NOT_FOR_PLAN_TYPE);
        }

        // 8. Quantity condition — "₹99 off when you take 2 or more". A caller that
        //    does not deal in baskets sends no count, which reads as one item.
        if (coupon.getMinItems() != null && coupon.getMinItems() > 1) {
            int items = request.getItemCount() != null ? request.getItemCount() : 1;
            if (items < coupon.getMinItems()) {
                return invalid(CouponValidationMessages.BELOW_MIN_ITEMS);
            }
        }

        // 9. Discount
        Optional<AppliedCouponDiscount> discountOpt =
                appliedCouponDiscountRepository.findFirstByCouponCode_IdAndStatusOrderByCreatedAtDesc(
                        coupon.getId(), STATUS_ACTIVE);
        if (discountOpt.isEmpty()) {
            return invalid(CouponValidationMessages.DISCOUNT_MISSING);
        }
        AppliedCouponDiscount discount = discountOpt.get();
        double discountValue = CouponDiscountUtil.computeDiscount(discount, safeAmount(request.getTotalAmount()));

        return CouponValidateResponseDTO.builder()
                .couponCodeId(coupon.getId())
                .appliedCouponDiscountId(discount.getId())
                .discountType(discount.getDiscountType())
                .discountValue(discountValue)
                .maxDiscountValue(discount.getMaxDiscountPoint())
                .valid(true)
                .message(CouponValidationMessages.VALID)
                .build();
    }

    // ---------------------------------------------------------------------

    /**
     * Returns true when the resolved PaymentOption type supports coupon
     * redemption. Unknown plan id, unknown type, or missing paymentPlanId
     * all return true (open) — backend is the safety net; the FE shouldn't
     * surface coupons for ineligible plans in the first place, but we must
     * not break callers that don't yet send paymentPlanId.
     */
    private boolean planTypeAllowsCoupon(String paymentPlanId) {
        if (paymentPlanId == null || paymentPlanId.isBlank()) return true;
        Optional<PaymentPlan> planOpt = paymentPlanRepository.findById(paymentPlanId);
        if (planOpt.isEmpty()) return true;
        PaymentOption option = planOpt.get().getPaymentOption();
        if (option == null || option.getType() == null) return true;
        String type = option.getType();
        return !(PaymentOptionType.FREE.name().equalsIgnoreCase(type)
                || PaymentOptionType.DONATION.name().equalsIgnoreCase(type)
                || PaymentOptionType.CPO.name().equalsIgnoreCase(type));
    }

    private boolean scopeMatches(CouponCode coupon, CouponValidateRequestDTO request) {
        // Legacy PRODUCT_PAGE coupon: source_id IS the product_page_id; resolve by code.
        if (CouponSourceType.PRODUCT_PAGE.getValue().equals(coupon.getSourceType())) {
            if (request.getProductPageCode() == null) return false;
            Optional<ProductPage> page = productPageRepository.findByCode(request.getProductPageCode());
            return page.isPresent() && page.get().getId().equals(coupon.getSourceId());
        }

        // Institute-scoped coupon: institute must match.
        if (coupon.getInstituteId() != null
                && !coupon.getInstituteId().equals(request.getInstituteId())) {
            return false;
        }

        // Scope rows present? Then one must match the checkout context.
        boolean hasPsScope = !couponPackageSessionRepository.findByCouponCodeId(coupon.getId()).isEmpty();
        boolean hasInviteScope = !couponEnrollInviteRepository.findByCouponCodeId(coupon.getId()).isEmpty();

        if (!hasPsScope && !hasInviteScope) {
            // Empty scope = institute-wide. Already verified institute_id above.
            return true;
        }

        if (hasPsScope && request.getPackageSessionId() != null
                && couponPackageSessionRepository.existsByCouponCodeIdAndPackageSessionId(
                        coupon.getId(), request.getPackageSessionId())) {
            return true;
        }
        if (hasInviteScope && request.getEnrollInviteId() != null
                && couponEnrollInviteRepository.existsByCouponCodeIdAndEnrollInviteId(
                        coupon.getId(), request.getEnrollInviteId())) {
            return true;
        }
        return false;
    }

    private boolean emailAllowed(String allowedEmailsJson, String userEmail) {
        if (userEmail == null || userEmail.isBlank()) return false;
        if (allowedEmailsJson == null || allowedEmailsJson.isBlank()) return false;
        try {
            List<String> allowed = objectMapper.readValue(allowedEmailsJson, new TypeReference<List<String>>() {});
            return allowed.stream().anyMatch(e -> e != null && e.equalsIgnoreCase(userEmail));
        } catch (Exception e) {
            log.warn("Failed to parse allowedEmailIds for coupon: {}", e.getMessage());
            return false;
        }
    }

    private static double safeAmount(Double amount) {
        return amount == null ? 0.0 : amount;
    }

    private static Date endOfDay(Date date) {
        Calendar c = Calendar.getInstance();
        c.setTime(date);
        c.set(Calendar.HOUR_OF_DAY, 23);
        c.set(Calendar.MINUTE, 59);
        c.set(Calendar.SECOND, 59);
        c.set(Calendar.MILLISECOND, 999);
        return c.getTime();
    }

    private static Date startOfDay(Date date) {
        Calendar c = Calendar.getInstance();
        c.setTime(date);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTime();
    }

    private static CouponValidateResponseDTO invalid(String messageCode) {
        return CouponValidateResponseDTO.builder()
                .valid(false)
                .message(messageCode)
                .build();
    }
}
