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

/** One version of an institute's learner home: the DRAFT, the PUBLISHED one, or an ARCHIVED one. */
@Entity
@Table(name = "learner_home_layout")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LearnerHomeLayout {

    public static final String DRAFT = "DRAFT";
    public static final String PUBLISHED = "PUBLISHED";
    public static final String ARCHIVED = "ARCHIVED";

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "version", nullable = false)
    private int version;

    @Column(name = "base_version")
    private Integer baseVersion;

    @Column(name = "revision", nullable = false)
    private int revision;

    @Column(name = "template_key", length = 32)
    private String templateKey;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "settings_json", nullable = false, columnDefinition = "jsonb")
    private String settingsJson;

    @Column(name = "created_by_user_id", length = 36)
    private String createdByUserId;

    @Column(name = "updated_by_user_id", length = 36)
    private String updatedByUserId;

    @Column(name = "published_by_user_id", length = 36)
    private String publishedByUserId;

    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
