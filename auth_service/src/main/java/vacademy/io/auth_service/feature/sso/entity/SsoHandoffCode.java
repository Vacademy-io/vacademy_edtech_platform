package vacademy.io.auth_service.feature.sso.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/** One-time code the learner portal swaps for tokens. Only the hash is stored. */
@Entity
@Table(name = "sso_handoff_code")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SsoHandoffCode {

    @Id
    @Column(name = "code_hash", nullable = false)
    private String codeHash;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "connection_id", nullable = false)
    private String connectionId;

    @Column(name = "client_binding", nullable = false)
    private String clientBinding;

    @Column(name = "expires_at", nullable = false)
    private Date expiresAt;

    @Column(name = "used_at")
    private Date usedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;
}
