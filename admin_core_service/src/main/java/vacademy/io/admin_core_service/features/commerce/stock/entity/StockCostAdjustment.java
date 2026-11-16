package vacademy.io.admin_core_service.features.commerce.stock.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;
import java.time.LocalDate;

/** One cost change (V681). Append-only; written only by StockLedgerService. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "stock_cost_adjustment")
@org.hibernate.annotations.Immutable
public class StockCostAdjustment extends CommerceCatalogueEntity {

    @Column(name = "movement_id", updatable = false, length = 36)
    private String movementId;

    @Column(name = "receipt_line_id", updatable = false, length = 36)
    private String receiptLineId;

    @Column(name = "bill_line_id", updatable = false, length = 36)
    private String billLineId;

    @Column(name = "package_session_id", nullable = false, updatable = false)
    private String packageSessionId;

    @Column(name = "piece_id", updatable = false, length = 36)
    private String pieceId;

    @Column(name = "quantity", nullable = false, updatable = false)
    private Integer quantity;

    @Column(name = "old_unit_cost", updatable = false, precision = 14, scale = 4)
    private BigDecimal oldUnitCost;

    @Column(name = "new_unit_cost", updatable = false, precision = 14, scale = 4)
    private BigDecimal newUnitCost;

    @Column(name = "qty_on_hand_at_change", updatable = false)
    private Integer qtyOnHandAtChange;

    @Column(name = "old_average", updatable = false, precision = 14, scale = 4)
    private BigDecimal oldAverage;

    @Column(name = "new_average", updatable = false, precision = 14, scale = 4)
    private BigDecimal newAverage;

    @Column(name = "variance_amount", nullable = false, updatable = false, precision = 16, scale = 2)
    private BigDecimal varianceAmount;

    @Column(name = "book_date", nullable = false, updatable = false)
    private LocalDate bookDate;

    @Column(name = "reason", nullable = false, updatable = false, length = 32)
    private String reason;

    @Column(name = "actor_user_id", updatable = false, length = 36)
    private String actorUserId;

    @Column(name = "idempotency_key", nullable = false, updatable = false, length = 160)
    private String idempotencyKey;
}
