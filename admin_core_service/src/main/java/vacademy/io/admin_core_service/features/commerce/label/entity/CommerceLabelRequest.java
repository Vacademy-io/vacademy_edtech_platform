package vacademy.io.admin_core_service.features.commerce.label.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * One row of the label print queue and reprint log (V730). Status changes are conditional
 * UPDATEs of {@code CommerceLabelRequestRepository}; nothing updates a row through the entity.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_label_request")
public class CommerceLabelRequest extends CommerceCatalogueEntity {

    @Column(name = "location_id", nullable = false, updatable = false, length = 36)
    private String locationId;

    @Column(name = "package_session_id", nullable = false, updatable = false)
    private String packageSessionId;

    @Column(name = "piece_id", updatable = false, length = 36)
    private String pieceId;

    @Column(name = "quantity", nullable = false, updatable = false)
    private Integer quantity;

    @Column(name = "reason", nullable = false, updatable = false, length = 32)
    private String reason;

    @Column(name = "reprint_reason", updatable = false, length = 32)
    private String reprintReason;

    @Column(name = "note", updatable = false, length = 200)
    private String note;

    @Column(name = "source_type", nullable = false, updatable = false, length = 32)
    private String sourceType;

    @Column(name = "source_id", updatable = false, length = 36)
    private String sourceId;

    @Column(name = "status", nullable = false, updatable = false, length = 16)
    private String status;

    @Column(name = "requested_by", updatable = false, length = 36)
    private String requestedBy;

    @Column(name = "printed_at", updatable = false)
    private LocalDateTime printedAt;

    @Column(name = "printed_by", updatable = false, length = 36)
    private String printedBy;

    @Column(name = "printed_price", updatable = false, precision = 14, scale = 4)
    private BigDecimal printedPrice;

    @Column(name = "printed_mrp", updatable = false, precision = 14, scale = 4)
    private BigDecimal printedMrp;

    @Column(name = "cancelled_at", updatable = false)
    private LocalDateTime cancelledAt;

    @Column(name = "cancelled_by", updatable = false, length = 36)
    private String cancelledBy;
}
