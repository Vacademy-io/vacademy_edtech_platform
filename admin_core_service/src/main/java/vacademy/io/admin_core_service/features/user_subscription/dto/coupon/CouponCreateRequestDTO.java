package vacademy.io.admin_core_service.features.user_subscription.dto.coupon;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;
import java.util.List;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CouponCreateRequestDTO {

    @NotBlank
    private String code;

    /** ACTIVE | INACTIVE. Defaults to ACTIVE in the service if blank. */
    private String status;

    private Date redeemStartDate;

    /** null = never expires. */
    private Date redeemEndDate;

    /** null = unlimited. */
    private Long usageLimit;

    private boolean isEmailRestricted;

    /** JSON array string, e.g. "[\"a@x.com\",\"b@y.com\"]" */
    private String allowedEmailIds;

    private List<String> applicablePackageSessionIds;

    private List<String> applicableEnrollInviteIds;

    @NotNull
    @Valid
    private AppliedDiscountInputDTO appliedDiscount;
}
