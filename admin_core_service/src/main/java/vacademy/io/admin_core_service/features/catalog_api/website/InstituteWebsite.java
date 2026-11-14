package vacademy.io.admin_core_service.features.catalog_api.website;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * A website an institute uses with the public Catalogue API (V580). Only VERIFIED rows open the
 * origin lock; a VERIFIED host covers itself and its subdomains ({@link WebsiteHosts#covers}).
 *
 * <p>Lifecycle: PENDING (added, TXT record not seen yet) → VERIFIED (TXT record found) →
 * REVOKED (platform staff only; the row stays so the institute cannot add the host again).
 * A row the institute removes is deleted outright.
 */
@Entity
@Table(name = "institute_website")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InstituteWebsite {

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_VERIFIED = "VERIFIED";
    public static final String STATUS_REVOKED = "REVOKED";

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** Normalised ASCII host ({@link WebsiteHosts#normalize}). */
    @Column(name = "host", nullable = false, length = 253)
    private String host;

    @Column(name = "status", nullable = false, length = 20)
    private String status;

    /** 32 hex characters; the TXT value is {@code vacademy-site-verification=<token>}. */
    @Column(name = "verification_token", nullable = false, length = 64)
    private String verificationToken;

    @Column(name = "verified_at")
    private Instant verifiedAt;

    @Column(name = "last_checked_at")
    private Instant lastCheckedAt;

    @Column(name = "last_error", length = 500)
    private String lastError;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "revoked_by")
    private String revokedBy;

    @Column(name = "revoked_reason", length = 500)
    private String revokedReason;

    public boolean isRevoked() {
        return STATUS_REVOKED.equals(status);
    }

    public boolean isVerified() {
        return STATUS_VERIFIED.equals(status);
    }
}
