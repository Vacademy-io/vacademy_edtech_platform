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

/** One sign-in started at the provider; consumed once by the callback. */
@Entity
@Table(name = "sso_login_attempt")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SsoLoginAttempt {

    public static final String MODE_LOGIN = "LOGIN";
    /** Admin "Test connection": shows what the provider sent, never signs anyone in. */
    public static final String MODE_TEST = "TEST";

    @Id
    @Column(name = "state", nullable = false)
    private String state;

    @Column(name = "connection_id", nullable = false)
    private String connectionId;

    @Column(name = "nonce", nullable = false)
    private String nonce;

    @Column(name = "code_verifier", nullable = false)
    private String codeVerifier;

    @Column(name = "portal_origin", nullable = false)
    private String portalOrigin;

    @Column(name = "return_path")
    private String returnPath;

    @Column(name = "mode", nullable = false)
    private String mode;

    @Column(name = "expires_at", nullable = false)
    private Date expiresAt;

    @Column(name = "used_at")
    private Date usedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;
}
