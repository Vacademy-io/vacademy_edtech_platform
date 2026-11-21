package vacademy.io.admin_core_service.features.hr_tax.service.engine;

import lombok.Builder;
import lombok.Getter;

import java.math.BigDecimal;
import java.util.Map;

/** One month's income-tax outcome, with the full breakdown for audit/Form 16. */
@Getter
@Builder
public class TaxResult {

    /** Withholding for THIS month after YTD true-up (never negative). */
    private final BigDecimal monthlyTax;

    private final BigDecimal projectedAnnualGross;
    private final BigDecimal projectedAnnualTaxable;
    /** Full-year tax liability (slabs + surcharge + cess, after rebate). */
    private final BigDecimal projectedAnnualTax;
    private final BigDecimal totalExemptions;   // SD + HRA + chapter VI-A actually allowed

    /** Explainable computation: slab math, rebate, surcharge, exemption items. */
    private final Map<String, Object> breakdown;
}
