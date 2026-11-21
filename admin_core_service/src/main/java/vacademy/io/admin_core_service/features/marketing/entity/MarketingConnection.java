package vacademy.io.admin_core_service.features.marketing.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;

/**
 * One OAuth grant per (institute, provider, external user). Meta keeps the long-lived user token
 * in {@link #accessTokenEnc}; Google keeps the refresh token in {@link #refreshTokenEnc}. Both are
 * encrypted with TokenEncryptionService and are never returned to the browser.
 */
@Entity
@Table(name = "marketing_connection")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MarketingConnection {

    @Id
    @UuidGenerator
    @Column(length = 255, nullable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** META_ADS | META_SOCIAL | GOOGLE_ADS | GOOGLE_BUSINESS */
    @Column(name = "provider", nullable = false, length = 32)
    private String provider;

    /** Meta user id / Google sub. */
    @Column(name = "external_user_id")
    private String externalUserId;

    /** Display name (Meta) or email (Google). */
    @Column(name = "external_user_name")
    private String externalUserName;

    @Column(name = "access_token_enc", columnDefinition = "TEXT")
    private String accessTokenEnc;

    @Column(name = "refresh_token_enc", columnDefinition = "TEXT")
    private String refreshTokenEnc;

    @Column(name = "token_expires_at")
    private Instant tokenExpiresAt;

    @Column(name = "scopes", columnDefinition = "TEXT")
    private String scopes;

    /** ACTIVE | RECONNECT_NEEDED | REVOKED */
    @Builder.Default
    @Column(name = "status", nullable = false, length = 32)
    private String status = "ACTIVE";

    @Column(name = "status_detail", columnDefinition = "TEXT")
    private String statusDetail;

    /** oauth_connect_state.id that produced or last refreshed this grant. */
    @Column(name = "oauth_state_id")
    private String oauthStateId;

    @Column(name = "connected_by_user_id")
    private String connectedByUserId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
