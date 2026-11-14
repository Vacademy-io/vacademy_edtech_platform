package vacademy.io.admin_core_service.features.user_subscription.dto.coupon;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.validation.Valid;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;
import java.util.List;

/**
 * Update payload. Once a coupon has been redeemed at least once,
 * the service freezes discount fields and scope. Pre-redemption,
 * any subset of these may be sent and applied.
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CouponUpdateRequestDTO {

    private String status;

    private Date redeemStartDate;

    private Date redeemEndDate;

    /** true = remove the end date so the coupon never expires (a null redeemEndDate means "unchanged"). */
    private Boolean clearRedeemEndDate;

    private Long usageLimit;

    private Boolean isEmailRestricted;

    private String allowedEmailIds;

    private List<String> applicablePackageSessionIds;

    private List<String> applicableEnrollInviteIds;

    @Valid
    private AppliedDiscountInputDTO appliedDiscount;
}
