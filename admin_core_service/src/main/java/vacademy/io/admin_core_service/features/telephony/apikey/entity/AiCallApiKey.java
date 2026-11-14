package vacademy.io.admin_core_service.features.telephony.apikey.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

/**
 * One issued external API key for the AI-Calling API.
 *
 * The complete key is retained for authorized operator sharing, while
 * {@code key_prefix} provides safe display metadata. An issued key can be
 * revoked at any time.
 *
 * Institute binding is the tenancy wall: the public API resolves the caller's
 * institute FROM this row, never from the request body, so a client cannot dial
 * on another tenant's credits or read another tenant's call logs.
 */
@Entity
@Table(name = "ai_call_api_key")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AiCallApiKey {

    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_REVOKED = "REVOKED";

    @Id
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** Operator label, e.g. "client-xyz production". */
    @Column(name = "key_name")
    private String keyName;

    /**
     * Visible head of the plaintext (e.g. "vak_live_ab12…"), never the secret
     * itself.
     */
    @Column(name = "key_prefix", nullable = false)
    private String keyPrefix;

    /** Plaintext key, intentionally retained for operator retrieval. */
    @Column(name = "api_key", nullable = false, unique = true)
    private String apiKey;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "created_by")
    private String createdBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @PrePersist
    void prePersist() {
        if (id == null)
            id = java.util.UUID.randomUUID().toString();
        if (status == null)
            status = STATUS_ACTIVE;
    }

    public boolean isActive() {
        return STATUS_ACTIVE.equals(status);
    }
}
