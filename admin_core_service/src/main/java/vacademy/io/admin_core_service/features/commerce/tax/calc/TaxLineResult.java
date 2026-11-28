package vacademy.io.admin_core_service.features.commerce.tax.calc;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;

import java.math.BigDecimal;

/**
 * The tax facts of one line, as stored on the order and the invoice. Invariants:
 * gross - lineDiscount - orderDiscount = net, and taxableValue + cgst + sgst + igst + cess = net.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TaxLineResult {

    private String lineRef;
    /** Set only for a part of a set. */
    private String componentRef;
    private TaxLineType lineType;
    private String description;
    private String taxClassId;
    private String taxClassCode;
    private String hsnCode;
    private String unit;
    private int quantity;
    private int qtyScale;
    private BigDecimal unitPrice;
    private BigDecimal gross;
    private BigDecimal lineDiscount;
    private BigDecimal orderDiscount;
    private BigDecimal net;
    /** The value that was compared with the slab limits; null when no slab was picked. */
    private BigDecimal slabUnitValue;
    private BigDecimal ratePercent;
    private BigDecimal cessPercent;
    private BigDecimal taxableValue;
    private BigDecimal cgst;
    private BigDecimal sgst;
    private BigDecimal igst;
    private BigDecimal cess;
    private BigDecimal taxAmount;
}
