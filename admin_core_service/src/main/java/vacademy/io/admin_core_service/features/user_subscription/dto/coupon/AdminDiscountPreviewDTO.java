package vacademy.io.admin_core_service.features.user_subscription.dto.coupon;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Gross / discount / net an admin form shows before the discount is applied. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdminDiscountPreviewDTO {
    private double grossAmount;
    private double discountAmount;
    private double netAmount;
    private String discountType;

    public static AdminDiscountPreviewDTO of(double gross, double discount, String discountType) {
        double capped = Math.min(Math.max(discount, 0.0), gross);
        return AdminDiscountPreviewDTO.builder()
                .grossAmount(gross)
                .discountAmount(capped)
                .netAmount(Math.round((gross - capped) * 100.0) / 100.0)
                .discountType(discountType)
                .build();
    }
}
