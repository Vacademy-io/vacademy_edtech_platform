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
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * The stored snapshot of a tax calculation (documents never recompute from live
 * settings). Invariants: subtotal - discount + shipping + codCharge + roundOff = total, and the
 * line nets plus roundOff = total.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TaxResult {

    public static final int CURRENT_VERSION = 1;

    private int version;
    private TaxMode mode;
    private TaxHead taxHead;
    private String sellerStateCode;
    private String placeOfSupplyState;
    private LocalDate date;
    private SlabBasis slabBasis;
    private SlabCompare slabCompare;
    private RoundTotalTo roundTotalTo;
    private List<TaxLineResult> lines;
    /** One row per rate, lowest rate first. Empty outside REGULAR mode. */
    private List<TaxRateRow> rateRows;
    /** One row per HSN code and rate. Empty outside REGULAR mode. */
    private List<TaxRateRow> hsnRows;
    /** Gross of the ITEM lines. */
    private BigDecimal subtotal;
    /** Every discount on the ITEM lines. */
    private BigDecimal discount;
    /** Net of the SHIPPING lines. */
    private BigDecimal shipping;
    /** Net of the COD_CHARGE lines. */
    private BigDecimal codCharge;
    private BigDecimal taxableValue;
    private BigDecimal cgst;
    private BigDecimal sgst;
    private BigDecimal igst;
    private BigDecimal cess;
    private BigDecimal taxAmount;
    private BigDecimal roundOff;
    private BigDecimal total;
}
