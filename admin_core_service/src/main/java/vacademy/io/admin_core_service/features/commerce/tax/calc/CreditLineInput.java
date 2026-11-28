package vacademy.io.admin_core_service.features.commerce.tax.calc;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * One invoice line as a credit note sees it: what the invoice stored, what earlier credit notes
 * already took, and how many base units this note takes. Every line of the invoice is passed,
 * with quantityToCredit 0 for a line this note leaves alone.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CreditLineInput {

    private String lineRef;
    private int quantity;
    private BigDecimal net;
    private BigDecimal taxableValue;
    private BigDecimal cgst;
    private BigDecimal sgst;
    private BigDecimal igst;
    private BigDecimal cess;
    private BigDecimal ratePercent;
    private BigDecimal cessPercent;

    private int quantityCreditedBefore;
    private BigDecimal netCreditedBefore;
    private BigDecimal taxableCreditedBefore;
    private BigDecimal cgstCreditedBefore;
    private BigDecimal sgstCreditedBefore;
    private BigDecimal igstCreditedBefore;
    private BigDecimal cessCreditedBefore;

    private int quantityToCredit;
}
