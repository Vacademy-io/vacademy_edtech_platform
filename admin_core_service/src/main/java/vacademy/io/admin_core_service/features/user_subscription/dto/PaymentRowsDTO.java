package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * What voiding or deleting a payment would take with it. More than one row means it was stored per
 * course (an admission package payment, a multi-course checkout) and those rows go together.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PaymentRowsDTO {
    private int voidRows;
    private Double voidAmount;
    private int deleteRows;
    private Double deleteAmount;
    private String currency;
}
