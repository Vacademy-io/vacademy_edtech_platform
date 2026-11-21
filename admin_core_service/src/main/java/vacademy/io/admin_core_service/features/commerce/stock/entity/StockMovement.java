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
 * One row of the stock ledger (V681). Append-only: no column can be updated, so no code path
 * can change a posted movement. A correction is a new row with the opposite sign.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "stock_movement")
@org.hibernate.annotations.Immutable
public class StockMovement extends CommerceCatalogueEntity {

    @Column(name = "location_id", nullable = false, updatable = false, length = 36)
    private String locationId;

    @Column(name = "package_session_id", nullable = false, updatable = false)
    private String packageSessionId;

    @Column(name = "piece_id", updatable = false, length = 36)
    private String pieceId;

    @Column(name = "type", nullable = false, updatable = false, length = 32)
    private String type;

    @Column(name = "quantity_delta", nullable = false, updatable = false)
    private Integer quantityDelta;

    @Column(name = "balance_after", nullable = false, updatable = false)
    private Integer balanceAfter;

    @Column(name = "affects_sellable", nullable = false, updatable = false)
    private boolean affectsSellable;

    @Column(name = "reference_type", updatable = false, length = 32)
    private String referenceType;

    @Column(name = "reference_id", updatable = false, length = 64)
    private String referenceId;

    @Column(name = "transfer_id", updatable = false, length = 36)
    private String transferId;

    @Column(name = "reverses_movement_id", updatable = false, length = 36)
    private String reversesMovementId;

    @Column(name = "reason", updatable = false, length = 32)
    private String reason;

    @Column(name = "note", updatable = false, columnDefinition = "TEXT")
    private String note;

    @Column(name = "actor_user_id", updatable = false, length = 36)
    private String actorUserId;

    @Column(name = "idempotency_key", nullable = false, updatable = false, length = 160)
    private String idempotencyKey;

    /** Cost per base unit in force when the movement was posted. Never updated. */
    @Column(name = "unit_cost", updatable = false, precision = 14, scale = 4)
    private BigDecimal unitCost;

    @Column(name = "cost_provisional", nullable = false, updatable = false)
    private boolean costProvisional;
}
