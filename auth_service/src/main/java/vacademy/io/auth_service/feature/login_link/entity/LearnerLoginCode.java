package vacademy.io.auth_service.feature.login_link.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;

import java.time.Instant;

/**
 * One learner login code. Only the SHA-256 hex of the code is stored; the plaintext goes back
 * to the caller once. See V20__learner_login_code.sql.
 */
@Entity
@Table(name = "learner_login_code")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LearnerLoginCode {

    public static final String VIA_API_KEY = "API_KEY";
    public static final String VIA_INTERNAL = "INTERNAL";

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @ToString.Exclude
    @Column(name = "code_hash", nullable = false, length = 64)
    private String codeHash;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "created_via", nullable = false, length = 16)
    private String createdVia;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "use_count", nullable = false)
    private int useCount;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    @Column(name = "last_used_ip", length = 64)
    private String lastUsedIp;

    public boolean isUsableAt(Instant now) {
        return revokedAt == null && expiresAt != null && expiresAt.isAfter(now);
    }
}
