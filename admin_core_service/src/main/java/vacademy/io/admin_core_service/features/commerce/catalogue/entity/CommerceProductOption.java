package vacademy.io.admin_core_service.features.commerce.catalogue.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;


/** An attribute that varies between the variants of a product. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_product_option")
public class CommerceProductOption extends CommerceCatalogueEntity {

    @Column(name = "package_id", nullable = false, updatable = false)
    private String packageId;

    @Column(name = "attribute_id", nullable = false, updatable = false, length = 36)
    private String attributeId;

    @Column(name = "position", nullable = false)
    private Integer position;
}
