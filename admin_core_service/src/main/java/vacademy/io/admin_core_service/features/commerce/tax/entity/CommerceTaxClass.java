package vacademy.io.admin_core_service.features.commerce.tax.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

/** A tax class: what a product is for tax (its HSN code and unit) and the owner of its rate rules. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_tax_class")
public class CommerceTaxClass extends CommerceCatalogueEntity {

    @Column(name = "code", nullable = false, updatable = false, length = 64)
    private String code;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    @Column(name = "hsn_code", length = 16)
    private String hsnCode;

    @Column(name = "unit", length = 32)
    private String unit;

    @Column(name = "status", nullable = false, length = 32)
    private String status;
}
