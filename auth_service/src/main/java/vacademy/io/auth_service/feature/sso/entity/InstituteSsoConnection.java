package vacademy.io.auth_service.feature.sso.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** An institute's own identity provider (OIDC). See V30__institute_sso_oidc.sql. */
@Entity
@Table(name = "institute_sso_connection")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InstituteSsoConnection {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "protocol", nullable = false)
    @Builder.Default
    private String protocol = "OIDC";

    @Column(name = "display_name", nullable = false)
    private String displayName;

    @Column(name = "issuer", nullable = false)
    private String issuer;

    @Column(name = "client_id", nullable = false)
    private String clientId;

    @Column(name = "client_secret_encrypted", columnDefinition = "text")
    private String clientSecretEncrypted;

    @Column(name = "token_auth_method", nullable = false)
    @Builder.Default
    private String tokenAuthMethod = "client_secret_basic";

    @Column(name = "scopes", nullable = false)
    @Builder.Default
    private String scopes = "openid profile email";

    @Column(name = "email_domains", nullable = false, columnDefinition = "text")
    private String emailDomains;

    @Column(name = "claim_user_id", nullable = false)
    @Builder.Default
    private String claimUserId = "sub";

    @Column(name = "claim_email", nullable = false)
    @Builder.Default
    private String claimEmail = "email";

    @Column(name = "claim_name", nullable = false)
    @Builder.Default
    private String claimName = "name";

    @Column(name = "claim_given_name", nullable = false)
    @Builder.Default
    private String claimGivenName = "given_name";

    @Column(name = "claim_family_name", nullable = false)
    @Builder.Default
    private String claimFamilyName = "family_name";

    @Column(name = "claim_phone")
    private String claimPhone;

    @Column(name = "claim_groups")
    private String claimGroups;

    @Column(name = "access_mode", nullable = false)
    @Builder.Default
    private String accessMode = "ALL";

    @Column(name = "allowed_groups", columnDefinition = "text")
    private String allowedGroups;

    @Column(name = "default_package_session_ids", columnDefinition = "text")
    private String defaultPackageSessionIds;

    @Column(name = "group_rules", columnDefinition = "text")
    private String groupRules;

    @Column(name = "remove_access_on_group_loss", nullable = false)
    @Builder.Default
    private boolean removeAccessOnGroupLoss = true;

    @Column(name = "trust_provider_email", nullable = false)
    private boolean trustProviderEmail;

    @Column(name = "auto_redirect", nullable = false)
    private boolean autoRedirect;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "updated_by")
    private String updatedBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at")
    private Date updatedAt;
}
