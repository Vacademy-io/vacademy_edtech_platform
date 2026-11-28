package vacademy.io.admin_core_service.features.user_subscription.dto.coupon;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Public validate request. At least one of package_session_id,
 * enroll_invite_id, or product_page_code must be supplied so the
 * scope check has context. institute_id is required so the service
 * can resolve the right tenant when the code is institute-scoped.
 */
@Data
@Builder(toBuilder = true)
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CouponValidateRequestDTO {

    @NotBlank
    private String couponCode;

    @NotBlank
    private String instituteId;

    private String packageSessionId;
    private String enrollInviteId;
    private String productPageCode;

    /**
     * Optional. When present, the validator resolves PaymentPlan → PaymentOption
     * and rejects FREE / DONATION / CPO at validate time so the learner FE can
     * surface a meaningful error before the user tries to pay.
     */
    private String paymentPlanId;

    /** Learner email for email-restricted coupons. Optional. */
    private String userEmail;

    @NotNull
    private Double totalAmount;

    /**
     * How many courses are in the basket, for coupons that carry a minimum.
     * Null from callers that do not deal in baskets (a single-course enrol),
     * which is treated as one item.
     */
    private Integer itemCount;
}
