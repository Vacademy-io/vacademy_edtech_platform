package vacademy.io.admin_core_service.features.commerce.stock.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** Body of POST /commerce/v1/stock/receipts: a goods receipt, posted as it is created. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReceiptRequest {
    private String locationId;
    /** OWN_SOURCE, SUPPLIER, OPENING or OTHER. */
    private String sourceKind;
    private String sourceLocationId;
    private String supplierId;
    private String supplierChallanNumber;
    private LocalDate supplierChallanDate;
    private String ewayBillNo;
    private LocalDate ewayBillDate;
    /** Defaults to today in the institute's zone. */
    private LocalDate receivedDate;
    private String note;
    /** Required. A repeat with the same content returns the first receipt. */
    private String clientRequestId;
    private List<Line> lines;

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Line {
        private String packageSessionId;
        /** In base units (1 / qty_scale of the unit). */
        private Integer quantity;
        /** Cost per base unit; only a manager or the accountant may send it. */
        private BigDecimal unitCost;
        private String note;
    }
}
