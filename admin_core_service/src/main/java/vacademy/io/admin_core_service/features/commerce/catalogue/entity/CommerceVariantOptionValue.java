package vacademy.io.admin_core_service.features.commerce.catalogue.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;


/** The value a variant has for one option of its product. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_variant_option_value")
public class CommerceVariantOptionValue extends CommerceCatalogueEntity {

    @Column(name = "package_session_id", nullable = false, updatable = false)
    private String packageSessionId;

    @Column(name = "attribute_id", nullable = false, updatable = false, length = 36)
    private String attributeId;

    @Column(name = "attribute_value_id", nullable = false, length = 36)
    private String attributeValueId;
}
