package vacademy.io.admin_core_service.features.telephony.publicapi.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;

/**
 * One human (counsellor) click-to-call requested through the public API: POST
 * /v1/human-calls. See V594.
 *
 * <p>The public id ({@code hcall_…}) is what the client holds. The call itself is an
 * ordinary counsellor call in telephony_call_log ({@link #callLogId}), placed through
 * CallOrchestrator like the dashboard's Call button, so the CRM, recordings, billing and
 * dispositions all treat it the same way.
 *
 * <p>Two outboxes, both written only by targeted UPDATEs (see the repository): the call's
 * own event (final_* / webhook_*, mirroring ai_call_api_call) and, when the client asked
 * for analysis, {@code human_call.analysis_ready} (analysis_*), which fires later.
 */
@Entity
@Table(name = "human_call_api_call")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class HumanCallApiCall {

    @Id
    @Column(name = "id", length = 40)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "api_key_id")
    private String apiKeyId;

    @Column(name = "counsellor_user_id", nullable = false)
    private String counsellorUserId;

    @Column(name = "counsellor_name")
    private String counsellorName;

    /** Lower-cased; also what an Idempotency-Key replay by counsellor_email compares. */
    @Column(name = "counsellor_email")
    private String counsellorEmail;

    @Column(name = "phone_number", nullable = false, length = 32)
    private String phoneNumber;

    @Column(name = "contact_name")
    private String contactName;

    @Column(name = "contact_email")
    private String contactEmail;

    @Column(name = "external_id")
    private String externalId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /** The request's {@code analyze} (ANALYZE is reserved in Postgres, hence the name). */
    @Column(name = "analysis_requested", nullable = false)
    private boolean analysisRequested;

    /** The institute's lead this call was filed under, when exactly one matched the number. */
    @Column(name = "response_id")
    private String responseId;

    @Column(name = "provider_type", length = 32)
    private String providerType;

    @Column(name = "idempotency_key")
    private String idempotencyKey;

    @Column(name = "call_log_id")
    private String callLogId;

    @Column(name = "final_status", length = 32)
    private String finalStatus;

    @Column(name = "final_event", length = 40)
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

    /** When Call Intelligence was asked to analyse this call (once the recording landed). */
    @Column(name = "analysis_triggered_at")
    private Instant analysisTriggeredAt;

    @Column(name = "analysis_finalized_at")
    private Instant analysisFinalizedAt;

    @Column(name = "analysis_webhook_status", length = 16)
    private String analysisWebhookStatus;

    @Column(name = "analysis_webhook_attempts", nullable = false)
    private int analysisWebhookAttempts;

    @Column(name = "analysis_webhook_next_at")
    private Instant analysisWebhookNextAt;

    @Column(name = "analysis_webhook_last_code")
    private Integer analysisWebhookLastCode;

    @Column(name = "analysis_webhook_last_error", length = 500)
    private String analysisWebhookLastError;

    @Column(name = "analysis_webhook_delivered_at")
    private Instant analysisWebhookDeliveredAt;

    @Column(name = "checked_at")
    private Instant checkedAt;

    /** When the call was first seen ended; the recording wait counts from here. */
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
