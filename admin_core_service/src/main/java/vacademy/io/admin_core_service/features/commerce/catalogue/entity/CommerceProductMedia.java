package vacademy.io.admin_core_service.features.commerce.catalogue.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Map;

/** One gallery entry of a product, optionally tied to a variant. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_product_media")
public class CommerceProductMedia extends CommerceCatalogueEntity {

    @Column(name = "package_id", nullable = false, updatable = false)
    private String packageId;

    @Column(name = "package_session_id")
    private String packageSessionId;

    @Column(name = "media_id", nullable = false)
    private String mediaId;

    @Column(name = "kind", nullable = false, length = 32)
    private String kind;

    @Column(name = "tag", length = 32)
    private String tag;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "alt_i18n", columnDefinition = "jsonb")
    private Map<String, String> altI18n;

    @Column(name = "width")
    private Integer width;

    @Column(name = "height")
    private Integer height;

    /**
     * Written only by the rendition job through the statements in
     * {@code CommerceProductMediaRepository}; read-only here so that a gallery save never
     * overwrites the job state. Numeric keys are widths with public URLs, keys with a leading
     * underscore are job state: see {@code commerce.media.CommerceRenditionState}. NULL means
     * "not processed yet". The setter only changes the copy in memory.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "renditions_json", columnDefinition = "jsonb", insertable = false, updatable = false)
    private Map<String, Object> renditionsJson;

    @Column(name = "position", nullable = false)
    private Integer position;
}
