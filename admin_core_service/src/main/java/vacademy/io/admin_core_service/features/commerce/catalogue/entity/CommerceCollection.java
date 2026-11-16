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

/** A category or collection; parent_id makes the tree. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_collection")
public class CommerceCollection extends CommerceCatalogueEntity {

    @Column(name = "parent_id", length = 36)
    private String parentId;

    @Column(name = "kind", nullable = false, length = 32)
    private String kind;

    @Column(name = "slug", nullable = false)
    private String slug;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "name_i18n", columnDefinition = "jsonb", nullable = false)
    private Map<String, String> nameI18n;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "description_i18n", columnDefinition = "jsonb")
    private Map<String, String> descriptionI18n;

    @Column(name = "media_id")
    private String mediaId;

    @Column(name = "return_window_days")
    private Integer returnWindowDays;

    @Column(name = "position", nullable = false)
    private Integer position;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "external_ref")
    private String externalRef;
}
