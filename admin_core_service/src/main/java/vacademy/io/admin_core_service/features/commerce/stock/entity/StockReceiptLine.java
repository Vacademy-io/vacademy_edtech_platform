package vacademy.io.admin_core_service.features.commerce.stock.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;

/**
 * One line of a goods receipt (V681). unit_cost and cost_source are the cost in force now and
 * change only through StockLedgerService.applyReceiptCost; qty_billed belongs to the bill link
 * writer. None of the three is updatable through the entity.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "stock_receipt_line")
public class StockReceiptLine extends CommerceCatalogueEntity {

    @Column(name = "receipt_id", nullable = false, updatable = false, length = 36)
    private String receiptId;

    @Column(name = "package_session_id", nullable = false, updatable = false)
    private String packageSessionId;

    @Column(name = "qty_received", nullable = false, updatable = false)
    private Integer qtyReceived;

    @Column(name = "qty_billed", nullable = false, insertable = false, updatable = false)
    private Integer qtyBilled;

    @Column(name = "unit_cost", updatable = false, precision = 14, scale = 4)
    private BigDecimal unitCost;

    @Column(name = "cost_source", nullable = false, updatable = false, length = 32)
    private String costSource;

    @Column(name = "note", updatable = false, columnDefinition = "TEXT")
    private String note;
}
