package vacademy.io.community_service.feature.appregistry.store;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.util.Date;

/**
 * A store API credential (App Store Connect, Play Developer, Partner Center) for live status
 * sync, scoped to one institute or shared as the platform-wide default.
 *
 * <p>Why this exists at all: the first version of this sync used a single App Store Connect
 * credential straight from a k8s secret env var, one team for every institute. That's wrong for
 * any institute with its own Apple Developer account — Shiksha Nation is the one that surfaced
 * it, but nothing stops another brand from having the same setup. So credentials are now looked
 * up per (instituteId, platform, provider), with a shared "institute_id IS NULL" row as the
 * fallback that keeps every brand still on the original shared team working unchanged.
 *
 * <p>{@code credentialJson}'s shape depends on {@code provider} — for APP_STORE_CONNECT it's
 * {@code {"issuerId": "...", "keyId": "...", "p8": "-----BEGIN PRIVATE KEY-----..."}}. Stored as
 * plain jsonb, matching this codebase's existing convention for third-party API credentials (see
 * {@code InstitutePaymentGatewayMapping.paymentGatewaySpecificData}) — access control is the
 * database's, not a bespoke encryption layer here.
 */
@Entity
@Table(name = "store_credential", schema = "public",
        indexes = {
                @Index(name = "idx_store_credential_lookup", columnList = "institute_id,platform,provider")
        })
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode(of = "id")
public class StoreCredential {

    @Id
    @Column(name = "id")
    private String id;

    /** Null means "shared default", used when no institute-specific row matches. */
    @Column(name = "institute_id")
    private String instituteId;

    /** ANDROID / IOS / WINDOWS / MACOS. */
    @Column(name = "platform", nullable = false)
    private String platform;

    /** APP_STORE_CONNECT / GOOGLE_PLAY / PARTNER_CENTER. */
    @Column(name = "provider", nullable = false)
    private String provider;

    /** Human label for the SuperAdmin UI, e.g. "Shiksha Nation's own Apple Developer account". */
    @Column(name = "label")
    private String label;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "credential_json", columnDefinition = "jsonb", nullable = false)
    private String credentialJson;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
