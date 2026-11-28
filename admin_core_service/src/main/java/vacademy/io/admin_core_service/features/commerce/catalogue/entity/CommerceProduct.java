package vacademy.io.admin_core_service.features.commerce.catalogue.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/** Extension row of a PRODUCT package; the product id used everywhere is the package id. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_product")
public class CommerceProduct extends CommerceCatalogueEntity {

    @Column(name = "package_id", nullable = false, updatable = false)
    private String packageId;

    @Column(name = "slug", nullable = false)
    private String slug;

    @Column(name = "stock_mode", nullable = false, length = 32)
    private String stockMode;

    @Column(name = "tax_class_id", length = 36)
    private String taxClassId;

    @Column(name = "brand")
    private String brand;

    @Column(name = "unit", nullable = false, length = 32)
    private String unit;

    @Column(name = "qty_scale", nullable = false)
    private Integer qtyScale;

    @Column(name = "qty_step", nullable = false)
    private Integer qtyStep;

    @Column(name = "origin_location_id", length = 36)
    private String originLocationId;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "published_at")
    private LocalDateTime publishedAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "seo_i18n", columnDefinition = "jsonb")
    private Map<String, Object> seoI18n;

    @Column(name = "external_ref")
    private String externalRef;
}
