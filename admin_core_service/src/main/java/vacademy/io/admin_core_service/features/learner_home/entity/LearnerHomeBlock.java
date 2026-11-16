package vacademy.io.admin_core_service.features.learner_home.entity;

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

/** One block of one layout version. {@code blockKey} stays the same across versions. */
@Entity
@Table(name = "learner_home_block")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LearnerHomeBlock {

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "layout_id", nullable = false, length = 36)
    private String layoutId;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    @Column(name = "block_key", nullable = false, length = 36)
    private String blockKey;

    @Column(name = "type", nullable = false, length = 32)
    private String type;

    @Column(name = "builtin_widget", length = 48)
    private String builtinWidget;

    @Column(name = "position", nullable = false)
    private int position;

    @Column(name = "desktop_placement", nullable = false, length = 8)
    private String desktopPlacement;

    @Column(name = "devices", nullable = false, length = 8)
    private String devices;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "admin_label", length = 120)
    private String adminLabel;

    @Column(name = "starts_at")
    private Instant startsAt;

    @Column(name = "ends_at")
    private Instant endsAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "audience_json", nullable = false, columnDefinition = "jsonb")
    private String audienceJson;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "config_json", nullable = false, columnDefinition = "jsonb")
    private String configJson;

    @Column(name = "schema_version", nullable = false)
    private short schemaVersion;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
