package vacademy.io.admin_core_service.features.engagement.templates;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/** One version of an engine email template (V616). See EngagementEmailTemplateService for the lifecycle. */
@Entity
@Table(name = "engagement_email_template")
@Getter
@Setter
@DynamicUpdate
public class EngagementEmailTemplate {

    public static final String AI_PROPOSED = "AI_PROPOSED";
    public static final String USER_REVIEW = "USER_REVIEW";
    public static final String APPROVED = "APPROVED";
    public static final String SUPERSEDED = "SUPERSEDED";
    public static final String ARCHIVED = "ARCHIVED";

    @Id
    @UuidGenerator
    @Column(length = 255, nullable = false)
    private String id;

    @Column(name = "engine_id", nullable = false)
    private String engineId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** Stable snake_case name shared by every version; what the brain picks. */
    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false)
    private Integer version = 1;

    private String title;

    @Column(length = 120)
    private String purpose;

    @Column(nullable = false, length = 10)
    private String language = "en";

    @Column(nullable = false)
    private String subject;

    private String preheader;

    @Column(name = "body_html", columnDefinition = "TEXT", nullable = false)
    private String bodyHtml;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "variable_names", columnDefinition = "jsonb", nullable = false)
    private String variableNames = "[]";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "sample_values", columnDefinition = "jsonb", nullable = false)
    private String sampleValues = "[]";

    /** {variable: source} — see TemplateVariableSources. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "variable_sources", columnDefinition = "jsonb", nullable = false)
    private String variableSources = "{}";

    /** Non-blocking validation notes shown to the reviewer: [{code, message}]. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String warnings = "[]";

    @Column(nullable = false, length = 20)
    private String status = AI_PROPOSED;

    @Column(columnDefinition = "TEXT")
    private String rationale;

    @Column(name = "created_by")
    private String createdBy;

    /** Set when this engine took over an already-approved template of another engine. */
    @Column(name = "reused_from_id")
    private String reusedFromId;

    @Column(name = "approved_by")
    private String approvedBy;

    @Column(name = "approved_at")
    private Instant approvedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;
}
