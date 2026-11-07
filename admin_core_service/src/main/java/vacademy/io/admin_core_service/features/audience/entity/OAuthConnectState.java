package vacademy.io.admin_core_service.features.audience.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

/**
 * Tracks a single Meta (or future platform) OAuth initiation → callback → connector-save flow.
 *
 * Lifecycle:
 *   PENDING    — state created at /initiate; browser is on Meta's consent screen
 *   AUTHORIZED — /callback succeeded; encrypted user token + pages stored server-side.
 *                Stays AUTHORIZED across multiple /connector saves (TTL refreshed each
 *                time) so several form→audience connectors can be added per OAuth flow.
 *   EXPIRED    — expires_at passed; cleaned up by scheduled job
 *   CONSUMED   — legacy single-use status; no longer set (sessions now expire via TTL)
 *
 * The frontend never sees access tokens — only the session UUID (id).
 */
@Entity
@Table(name = "oauth_connect_state")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OAuthConnectState {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "vendor", nullable = false, length = 50)
    private String vendor;

    /** Pre-selected audience; may be null if admin picks it later */
    @Column(name = "audience_id")
    private String audienceId;

    /** When set, the connected Google account is linked to this mentor (per-mentor Google). */
    @Column(name = "mentor_id")
    private String mentorId;

    /** When true, the connected Google account is linked to {@code initiatedBy} (per-user Google). */
    @Column(name = "link_to_user", nullable = false)
    @Builder.Default
    private boolean linkToUser = false;

    /** Frontend path to land on after the Google callback (e.g. /meetings/my-schedule); null → default. */
    @Column(name = "return_path", length = 255)
    private String returnPath;

    /** User ID of the admin who initiated OAuth */
    @Column(name = "initiated_by")
    private String initiatedBy;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    /** Short-lived expiry — 10 minutes for PENDING, extended to 30 min after AUTHORIZED */
    @Column(name = "expires_at", nullable = false)
    private LocalDateTime expiresAt;

    /**
     * AES-256-GCM encrypted long-lived user access token.
     * Set during /callback. Null while PENDING.
     */
    @Column(name = "user_token_enc", columnDefinition = "TEXT")
    private String userTokenEnc;

    /**
     * AES-256-GCM encrypted JSON array of connectable pages.
     * Format (before encryption):
     *   [{"id":"123","name":"My Page","token_enc":"<per-page-encrypted-token>"}]
     *
     * token_enc inside each entry is also encrypted (double-layered so even the
     * pages_json_enc decryption only yields page tokens still encrypted).
     * Set during /callback. Null while PENDING.
     */
    @Column(name = "pages_json_enc", columnDefinition = "TEXT")
    private String pagesJsonEnc;

    /** PENDING | AUTHORIZED | CONSUMED | EXPIRED */
    @Column(name = "session_status", nullable = false, length = 20)
    @Builder.Default
    private String sessionStatus = "PENDING";

    /**
     * Frontend origin (scheme + host [+ port]) that started this OAuth flow, e.g.
     * "https://crm.someclient.com". Captured at /initiate so the /callback can send
     * the browser back to the SAME white-label domain it came from — landing on a
     * different origin loses the client's per-origin session. Validated against the
     * institute's registered hosts before use; null falls back to the configured
     * default callback URL.
     */
    @Column(name = "frontend_origin", length = 255)
    private String frontendOrigin;

    @PrePersist
    void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
