package vacademy.io.admin_core_service.features.commerce.tax.calc;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * One slab of a tax class. A rule applies on a date inside [effectiveFrom, effectiveTo] to a unit
 * value inside [minUnitPrice, maxUnitPrice]; both ends are inclusive and a null end is open.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TaxRateRule {

    private BigDecimal minUnitPrice;
    private BigDecimal maxUnitPrice;
    private BigDecimal ratePercent;
    private BigDecimal cessPercent;
    private LocalDate effectiveFrom;
    private LocalDate effectiveTo;
}
