package vacademy.io.admin_core_service.features.commerce.tax.calc;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;

import java.math.BigDecimal;
import java.util.List;

/** A credit note computed from an invoice. The line nets plus roundOff = total. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CreditResult {

    private TaxHead taxHead;
    /** Only the lines this note credits. */
    private List<CreditLineResult> lines;
    /** True when, with this note, every unit of the invoice has been credited. */
    private boolean completesInvoice;
    private BigDecimal taxableValue;
    private BigDecimal cgst;
    private BigDecimal sgst;
    private BigDecimal igst;
    private BigDecimal cess;
    private BigDecimal taxAmount;
    private BigDecimal roundOff;
    private BigDecimal total;
}
