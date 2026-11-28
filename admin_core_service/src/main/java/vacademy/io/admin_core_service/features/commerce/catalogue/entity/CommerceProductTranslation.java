package vacademy.io.admin_core_service.features.commerce.catalogue.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.List;
import java.util.Map;

/** Product text in one language. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_product_translation")
public class CommerceProductTranslation extends CommerceCatalogueEntity {

    @Column(name = "package_id", nullable = false, updatable = false)
    private String packageId;

    @Column(name = "locale", nullable = false, updatable = false, length = 16)
    private String locale;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "short_description", columnDefinition = "TEXT")
    private String shortDescription;

    @Column(name = "description_html", columnDefinition = "TEXT")
    private String descriptionHtml;

    /** List of {code, html}; the block codes are an institute setting. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "content_blocks", columnDefinition = "jsonb")
    private List<Map<String, Object>> contentBlocks;

    @Column(name = "search_text", columnDefinition = "TEXT")
    private String searchText;
}
