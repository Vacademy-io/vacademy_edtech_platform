package vacademy.io.admin_core_service.features.product_page.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductPageCouponRequest {

    private String code;

    /** PERCENTAGE or FIXED (maps to AppliedCouponDiscount.discountType). */
    private String discountType;

    private Double discountValue;

    private Double maxDiscountValue;

    private Integer maxUses;

    /** Smallest basket this coupon may be used on. Null = no minimum. */
    private Integer minItems;

    private LocalDateTime redeemStartDate;

    private LocalDateTime redeemEndDate;
}
