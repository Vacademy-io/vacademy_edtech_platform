package vacademy.io.admin_core_service.features.user_subscription.dto.coupon;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import vacademy.io.common.payment.dto.AdminDiscountRequestDTO;

/**
 * Preview input: either a payment plan (gross = its actual_price) or an explicit
 * gross amount (admin invoice subtotal). Learner email / scope only matter when the
 * admin picks an existing coupon, whose own restrictions are then checked.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdminDiscountPreviewRequestDTO {
    private AdminDiscountRequestDTO discount;
    private String paymentPlanId;
    private Double grossAmount;
    private String packageSessionId;
    private String enrollInviteId;
    private String learnerEmail;
}
