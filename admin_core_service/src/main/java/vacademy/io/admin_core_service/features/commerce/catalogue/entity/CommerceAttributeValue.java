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

/** One value of an attribute. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_attribute_value")
public class CommerceAttributeValue extends CommerceCatalogueEntity {

    @Column(name = "attribute_id", nullable = false, updatable = false, length = 36)
    private String attributeId;

    @Column(name = "code", nullable = false, updatable = false, length = 64)
    private String code;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "label_i18n", columnDefinition = "jsonb", nullable = false)
    private Map<String, String> labelI18n;

    @Column(name = "swatch_hex", length = 9)
    private String swatchHex;

    @Column(name = "position", nullable = false)
    private Integer position;
}
