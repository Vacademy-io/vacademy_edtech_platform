package vacademy.io.admin_core_service.features.institute_api.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * One partner API key (AI Evaluation public API, spec section 6.1).
 *
 * <p>Only {@code key_hash} (hex SHA-256 of the full key) is stored; the plaintext is
 * returned once at issue and never persisted. Lookups are by hash only, so no format
 * parsing is needed and keys imported later from other tables verify the same way.
 *
 * <p>Institute binding is the tenancy wall: the public API resolves the caller's
 * institute FROM this row, never from the request.
 */
@Entity
@Table(name = "institute_api_key")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InstituteApiKey {

    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_REVOKED = "REVOKED";

    public static final String VIA_DASHBOARD = "dashboard";
    public static final String VIA_SUPER_ADMIN = "super_admin";

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "name", nullable = false, length = 120)
    private String name;

    /** First 16 characters of the key, for display and logs only. */
    @Column(name = "key_prefix", nullable = false, length = 24)
    private String keyPrefix;

    /** Hex SHA-256 of the full key. UNIQUE; the only lookup column. */
    @Column(name = "key_hash", nullable = false, unique = true, length = 64)
    private String keyHash;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "products", nullable = false, columnDefinition = "text[]")
    private String[] products;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "scopes", nullable = false, columnDefinition = "text[]")
    private String[] scopes;

    /** NULL = only the institute's daily quota applies. */
    @Column(name = "daily_copy_cap")
    private Integer dailyCopyCap;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "created_by", nullable = false)
    private String createdBy;

    /** dashboard | super_admin | migration */
    @Column(name = "created_via", nullable = false, length = 16)
    private String createdVia;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    @Column(name = "last_used_ip", length = 64)
    private String lastUsedIp;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "revoked_by")
    private String revokedBy;

    /** ai_call | video | NULL (Phase 3 import). */
    @Column(name = "legacy_source", length = 16)
    private String legacySource;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID().toString();
        }
        if (status == null) {
            status = STATUS_ACTIVE;
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    public boolean isActive() {
        return STATUS_ACTIVE.equals(status);
    }

    /** ACTIVE and not past its expiry at {@code now}. */
    public boolean isUsableAt(Instant now) {
        return isActive() && (expiresAt == null || expiresAt.isAfter(now));
    }
}
