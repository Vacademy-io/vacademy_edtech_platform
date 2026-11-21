package vacademy.io.admin_core_service.features.commerce.tax.calc;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.tax.enums.RoundTotalTo;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabBasis;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabCompare;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** Everything {@link CommerceTaxCalculator} needs. The same request always gives the same result. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TaxRequest {

    private TaxMode mode;
    private SlabBasis slabBasis;
    private SlabCompare slabCompare;
    private RoundTotalTo roundTotalTo;
    /** State of the selling location (the institute as fallback). Needed in REGULAR mode. */
    private String sellerStateCode;
    /** Blank means "the seller state" (a counter sale). */
    private String placeOfSupplyState;
    /** The date that decides which rules are in force: the document date. */
    private LocalDate date;
    /** Sum of every order-level discount: coupon, offer, basket price, POS bill discount. */
    private BigDecimal orderDiscount;
    private List<TaxLineInput> lines;
}
