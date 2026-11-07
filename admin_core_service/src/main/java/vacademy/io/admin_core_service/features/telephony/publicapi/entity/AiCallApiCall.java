package vacademy.io.admin_core_service.features.telephony.publicapi.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;

/**
 * One call requested through the public AI calling API (Telleo API v1). See V572.
 *
 * <p>The public id ({@code call_…}) is what the client holds. The call itself rides the
 * AI call queue ({@link #queueItemId}) and, once dialled, telephony_call_log
 * ({@link #callLogId}). The final_* and webhook_* columns are the outbox the webhook job
 * drives: a call is "final" once it can no longer change, then its event is delivered.
 */
@Entity
@Table(name = "ai_call_api_call")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiCallApiCall {

    public static final String WEBHOOK_PENDING = "PENDING";
    public static final String WEBHOOK_DELIVERED = "DELIVERED";
    public static final String WEBHOOK_FAILED = "FAILED";
    /** Final, but the institute had no webhook configured when it finished. */
    public static final String WEBHOOK_NONE = "NONE";

    @Id
    @Column(name = "id", length = 40)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "api_key_id")
    private String apiKeyId;

    @Column(name = "batch_id", length = 40)
    private String batchId;

    @Column(name = "agent_id", nullable = false)
    private String agentId;

    @Column(name = "phone_number", nullable = false, length = 32)
    private String phoneNumber;

    @Column(name = "contact_name")
    private String contactName;

    @Column(name = "contact_email")
    private String contactEmail;

    @Column(name = "external_id")
    private String externalId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "variables", columnDefinition = "jsonb")
    private Map<String, String> variables;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    @Column(name = "test_mode", nullable = false)
    private boolean testMode;

    @Column(name = "idempotency_key")
    private String idempotencyKey;

    @Column(name = "queue_item_id")
    private String queueItemId;

    @Column(name = "call_log_id")
    private String callLogId;

    @Column(name = "final_status", length = 32)
    private String finalStatus;

    @Column(name = "final_event", length = 32)
    private String finalEvent;

    @Column(name = "finalized_at")
    private Instant finalizedAt;

    @Column(name = "webhook_status", length = 16)
    private String webhookStatus;

    @Column(name = "webhook_attempts", nullable = false)
    private int webhookAttempts;

    @Column(name = "webhook_next_at")
    private Instant webhookNextAt;

    @Column(name = "webhook_last_code")
    private Integer webhookLastCode;

    @Column(name = "webhook_last_error", length = 500)
    private String webhookLastError;

    @Column(name = "webhook_delivered_at")
    private Instant webhookDeliveredAt;

    /** When the finaliser last checked this call while it was not final (scan fairness). */
    @Column(name = "checked_at")
    private Instant checkedAt;

    /** When the call was first seen ended; the outcome wait counts from here. */
    @Column(name = "terminal_seen_at")
    private Instant terminalSeenAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
