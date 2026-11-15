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
 * One physical one-of-a-kind item (V681). Status and location change only by compare-and-set
 * UPDATEs in the repository, so they are not updatable through the entity.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_piece")
public class CommercePiece extends CommerceCatalogueEntity {

    @Column(name = "package_session_id", nullable = false, updatable = false)
    private String packageSessionId;

    /** Scan code: P plus 9 random characters. */
    @Column(name = "code", nullable = false, updatable = false, length = 16)
    private String code;

    @Column(name = "location_id", updatable = false, length = 36)
    private String locationId;

    @Column(name = "status", nullable = false, updatable = false, length = 32)
    private String status;

    @Column(name = "order_line_id", updatable = false, length = 36)
    private String orderLineId;

    @Column(name = "note", columnDefinition = "TEXT")
    private String note;

    @Column(name = "unit_cost", updatable = false, precision = 14, scale = 4)
    private BigDecimal unitCost;

    @Column(name = "receipt_line_id", updatable = false, length = 36)
    private String receiptLineId;
}
