package vacademy.io.admin_core_service.features.commerce.tax.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

/** A rate rule in requests and responses. Both slab ends and both dates are inclusive. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TaxRateRuleDTO {

    private String id;
    private BigDecimal minUnitPrice;
    private BigDecimal maxUnitPrice;
    private BigDecimal ratePercent;
    private BigDecimal cessPercent;
    private LocalDate effectiveFrom;
    private LocalDate effectiveTo;
}
