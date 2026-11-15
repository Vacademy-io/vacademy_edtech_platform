package vacademy.io.admin_core_service.features.commerce.order.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/** The shipping rule as the admin settings screen reads and saves it. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ShippingRuleDTO {

    private String id;
    /** FLAT, ORDER_VALUE or WEIGHT. */
    private String basis;
    /** List of {up_to, charge}; exactly one tier has no up_to. */
    private List<Map<String, Object>> tiers;
    private BigDecimal freeAbove;
    private BigDecimal codCharge;
    private String taxClassId;
    private String status;
}
