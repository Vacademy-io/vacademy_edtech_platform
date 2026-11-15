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

/** An institute-defined attribute (colour, fabric, size). */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_attribute")
public class CommerceAttribute extends CommerceCatalogueEntity {

    @Column(name = "code", nullable = false, updatable = false, length = 64)
    private String code;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "name_i18n", columnDefinition = "jsonb", nullable = false)
    private Map<String, String> nameI18n;

    @Column(name = "kind", nullable = false, length = 32)
    private String kind;

    @Column(name = "is_filterable", nullable = false)
    private Boolean isFilterable;

    @Column(name = "position", nullable = false)
    private Integer position;
}
