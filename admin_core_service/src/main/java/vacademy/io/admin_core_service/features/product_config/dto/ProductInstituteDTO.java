package vacademy.io.admin_core_service.features.product_config.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/** One institute of a product, for monitoring its sign-ups. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductInstituteDTO {
    private String id;
    private String name;
    private String email;
    private String phone;
    private String city;
    private String state;
    private String leadTag;
    /** ON_TRIAL, EXPIRED, PAID or NOT_ON_TRIAL. */
    private String trialStatus;
    private String trialEndsAt;
    private BigDecimal creditBalance;
    private BigDecimal creditsUsed;
    private String createdAt;
}
