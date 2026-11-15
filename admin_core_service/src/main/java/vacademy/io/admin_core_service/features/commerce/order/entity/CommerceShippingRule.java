package vacademy.io.admin_core_service.features.commerce.order.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * The delivery charge rule of an institute. One ACTIVE row per
 * institute; a change archives the row and inserts a new one, so a row never changes its
 * meaning after an order was priced with it.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_shipping_rule")
public class CommerceShippingRule extends CommerceCatalogueEntity {

    @Column(name = "basis", nullable = false, length = 32)
    private String basis;

    /** List of {up_to, charge}; see {@code CommerceShippingCalculator}. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tiers_json", nullable = false, columnDefinition = "jsonb")
    private List<Map<String, Object>> tiersJson;

    @Column(name = "free_above", precision = 12, scale = 2)
    private BigDecimal freeAbove;

    @Column(name = "cod_charge", nullable = false, precision = 12, scale = 2)
    private BigDecimal codCharge;

    @Column(name = "tax_class_id", length = 36)
    private String taxClassId;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "created_by", length = 36, updatable = false)
    private String createdBy;
}
