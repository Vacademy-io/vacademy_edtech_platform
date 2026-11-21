package vacademy.io.admin_core_service.features.commerce.catalogue.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;


/** A facet value carried by a product. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_product_attribute_value")
public class CommerceProductAttributeValue extends CommerceCatalogueEntity {

    @Column(name = "package_id", nullable = false, updatable = false)
    private String packageId;

    @Column(name = "attribute_value_id", nullable = false, updatable = false, length = 36)
    private String attributeValueId;
}
