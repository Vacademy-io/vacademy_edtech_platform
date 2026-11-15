package vacademy.io.admin_core_service.features.commerce.tax.calc;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;

import java.math.BigDecimal;
import java.util.List;

/**
 * One order line. Prices are tax-inclusive. {@code unitPrice} is the price of one base unit and
 * {@code quantity} counts base units (measured goods), so the line
 * gross is always unitPrice x quantity. {@code qtyScale} is the number of base units in one unit
 * of the tax class and is used only for the slab test and for printing.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TaxLineInput {

    /** The caller's key for the line (order line id, cart line key). Echoed on the result. */
    private String lineRef;
    private TaxLineType lineType;
    private String description;
    private BigDecimal unitPrice;
    private int quantity;
    private Integer qtyScale;
    /** Discount given on this line alone; for a SHIPPING line, the free-shipping rule. */
    private BigDecimal lineDiscount;
    private TaxClassRef taxClass;
    /** Empty for an ordinary product. */
    private List<TaxComponentInput> components;
}
