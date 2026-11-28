package vacademy.io.admin_core_service.features.capabilities.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;

/** A named module set (spec §12.3). {@code entitlements} = {"modules": [moduleKey, ...]}. */
@Entity
@Table(name = "module_preset")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ModulePreset {

    @Id
    @Column(name = "key", length = 64)
    private String key;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "entitlements", columnDefinition = "jsonb", nullable = false)
    private Map<String, Object> entitlements;

    @Column(name = "updated_by")
    private String updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
