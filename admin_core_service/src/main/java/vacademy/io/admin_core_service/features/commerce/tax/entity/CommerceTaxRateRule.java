package vacademy.io.admin_core_service.features.commerce.tax.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;
import java.time.LocalDate;

/** One slab of a tax class for a span of dates. Slabs in force on one date do not overlap. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_tax_rate_rule")
public class CommerceTaxRateRule extends CommerceCatalogueEntity {

    @Column(name = "tax_class_id", nullable = false, updatable = false, length = 36)
    private String taxClassId;

    @Column(name = "min_unit_price", nullable = false, precision = 12, scale = 2)
    private BigDecimal minUnitPrice;

    @Column(name = "max_unit_price", precision = 12, scale = 2)
    private BigDecimal maxUnitPrice;

    @Column(name = "rate_percent", nullable = false, precision = 6, scale = 3)
    private BigDecimal ratePercent;

    @Column(name = "cess_percent", nullable = false, precision = 6, scale = 3)
    private BigDecimal cessPercent;

    @Column(name = "effective_from", nullable = false)
    private LocalDate effectiveFrom;

    @Column(name = "effective_to")
    private LocalDate effectiveTo;
}
