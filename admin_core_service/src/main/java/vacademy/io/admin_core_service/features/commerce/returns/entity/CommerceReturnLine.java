package vacademy.io.admin_core_service.features.commerce.returns.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;

/** One order line on a return: how many units, and at receive how many came back resaleable or damaged. */
@Getter
@Setter
@NoArgsConstructor
@DynamicUpdate
@Entity
@Table(name = "commerce_return_line")
public class CommerceReturnLine extends CommerceCatalogueEntity {

    @Column(name = "return_id", nullable = false, updatable = false, length = 36)
    private String returnId;

    @Column(name = "order_line_id", nullable = false, updatable = false, length = 36)
    private String orderLineId;

    @Column(name = "quantity", nullable = false, updatable = false)
    private Integer quantity;

    @Column(name = "qty_resaleable", nullable = false)
    private Integer qtyResaleable = 0;

    @Column(name = "qty_damaged", nullable = false)
    private Integer qtyDamaged = 0;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "piece_ids_json", columnDefinition = "jsonb")
    private String pieceIdsJson;

    /** What the return's credit note gave back for this line. */
    @Column(name = "credited_value", precision = 12, scale = 2)
    private BigDecimal creditedValue;

    /** The cost of the goods coming back; never in a response. */
    @Column(name = "cost_total", precision = 12, scale = 2)
    private BigDecimal costTotal;
}
