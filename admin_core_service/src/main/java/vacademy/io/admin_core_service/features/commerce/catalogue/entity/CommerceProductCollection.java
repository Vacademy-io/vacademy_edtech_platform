package vacademy.io.admin_core_service.features.commerce.catalogue.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;


/** Membership of a product in a collection. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_product_collection")
public class CommerceProductCollection extends CommerceCatalogueEntity {

    @Column(name = "collection_id", nullable = false, updatable = false, length = 36)
    private String collectionId;

    @Column(name = "package_id", nullable = false, updatable = false)
    private String packageId;

    @Column(name = "position", nullable = false)
    private Integer position;
}
