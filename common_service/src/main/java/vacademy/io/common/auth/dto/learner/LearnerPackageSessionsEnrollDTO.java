package vacademy.io.common.auth.dto.learner;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import vacademy.io.common.common.dto.CustomFieldValueDTO;
import vacademy.io.common.payment.dto.AdminDiscountRequestDTO;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;

import java.util.Date;
import java.util.List;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerPackageSessionsEnrollDTO {
    private List<String> packageSessionIds;
    private String planId;
    private String paymentOptionId;
    private String enrollInviteId;    private ReferRequestDTO referRequest;
    private PaymentInitiationRequestDTO paymentInitiationRequest;
    private List<CustomFieldValueDTO>customFieldValues;
    private Date startDate;

    /**
     * Optional. Discount coupon code the learner entered at checkout.
     * Backend re-validates it via CouponValidationService and atomically
     * decrements usage_limit at UserPlan creation. Null/blank = no coupon.
     */
    private String couponCode;

    /**
     * Optional. Discount an admin applies on the manual-enroll path
     * (AdminDirectEnrollService only). Learner enroll paths never read it, so a
     * learner cannot grant themselves a discount by sending this field.
     */
    private AdminDiscountRequestDTO adminDiscount;

    /**
     * Optional. Days of course access this enrollment grants, counted from
     * {@link #startDate} (or now when that is absent).
     *
     * <p>Takes priority over the payment plan's {@code validity_in_days} and the
     * invite's {@code learner_access_days} — an admin who types a number on the
     * enrollment form means that number, not the plan's default. Null falls back to
     * plan, then invite, then unlimited: the same precedence
     * {@code DefaultInviteResolver.resolveAccessDays} already uses for bulk assignment.
     */
    private Integer accessDays;
}
