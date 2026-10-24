package vacademy.io.admin_core_service.features.access_pass.entity;

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
 * Ledger row: how one holder plan came to have one course through a pass.
 * GRANTED rows carry the holder's plan on their ssigm, so the pass may revoke them.
 * COVERED rows are held through a different plan and are never touched by the pass.
 */
@Entity
@Table(name = "access_pass_grant")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AccessPassGrant {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "access_pass_id", nullable = false, length = 36)
    private String accessPassId;

    @Column(name = "user_plan_id", nullable = false)
    private String userPlanId;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "package_session_id", nullable = false)
    private String packageSessionId;

    @Column(name = "ssigm_id")
    private String ssigmId;

    /** {@link vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.GrantType}. */
    @Column(name = "grant_type", nullable = false, length = 32)
    private String grantType;

    /** ACTIVE | REVOKED. */
    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "granted_at")
    private Timestamp grantedAt;

    @Column(name = "revoked_at")
    private Timestamp revokedAt;

    @Column(name = "revoke_reason", columnDefinition = "TEXT")
    private String revokeReason;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Timestamp createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
