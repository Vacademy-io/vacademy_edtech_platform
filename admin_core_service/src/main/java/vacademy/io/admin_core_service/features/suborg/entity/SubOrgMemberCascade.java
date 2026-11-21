package vacademy.io.admin_core_service.features.suborg.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * A sub-org whose staff must leave because its admin left. See V647__Sub_org_member_cascade.sql
 * for the lifecycle and SubOrgExitService for the rules.
 */
@Entity
@Table(name = "sub_org_member_cascade")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SubOrgMemberCascade {

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_DONE = "DONE";
    public static final String STATUS_FAILED = "FAILED";
    public static final String STATUS_REINSTATED = "REINSTATED";
    public static final String STATUS_SETTING_OFF = "SETTING_OFF";
    public static final String STATUS_OTHER_ADMIN = "OTHER_ADMIN";

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "sub_org_id", nullable = false)
    private String subOrgId;

    @Column(name = "package_session_id", nullable = false)
    private String packageSessionId;

    @Column(name = "admin_user_id", nullable = false)
    private String adminUserId;

    @Column(name = "actor_user_id")
    private String actorUserId;

    @Column(name = "effective_at", nullable = false)
    private Timestamp effectiveAt;

    /** True for a soft cancel: the job ends the admin's own access on the date too. */
    @Column(name = "terminate_admin", nullable = false)
    private boolean terminateAdmin;

    /** Set once the admin's own exit event has fired, so a retry cannot mail them twice. */
    @Column(name = "admin_notified", nullable = false)
    private boolean adminNotified;

    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = STATUS_PENDING;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "terminated_count", nullable = false)
    private int terminatedCount;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "processed_at")
    private Timestamp processedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Timestamp createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
