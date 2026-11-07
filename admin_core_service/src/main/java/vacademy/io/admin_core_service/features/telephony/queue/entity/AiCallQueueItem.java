package vacademy.io.admin_core_service.features.telephony.queue.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;

/**
 * One AI call waiting for a slot on the fleet.
 *
 * <p>Every dial path — the CALL_AI workflow node, a bulk campaign, a manual click —
 * writes one of these instead of calling the provider itself. {@code AiCallQueueDrainJob}
 * is the only thing that dials, which is what makes the fleet-wide concurrency limit
 * exact: one drainer, one place that counts slots.
 *
 * <p>The row carries everything {@code AiCallService.placeCall} needs, because the
 * dial happens minutes-to-hours after enqueue and nothing about the request may be
 * re-derived from state that has since moved on. What deliberately IS re-derived at
 * dispatch time is every pre-dial guard (credits, daily cap, already-assigned,
 * deleted lead): those must reflect the world at dial time, not at enqueue time.
 */
@Entity
@Table(name = "ai_call_queue")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiCallQueueItem {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /**
     * Resolved at enqueue time and written onto the request at dispatch, so the
     * capacity this item was accounted against is the capacity it actually consumes
     * even if the institute's default provider changes while it waits.
     */
    @Column(name = "provider", nullable = false, length = 50)
    private String provider;

    /** Higher first, ties broken by {@link #createdAt}. Everything enqueues at 100 today. */
    @Column(name = "priority", nullable = false)
    private int priority;

    /** WORKFLOW | BULK | MANUAL | RETRY — provenance, for the queue view and logs. */
    @Column(name = "source", nullable = false, length = 30)
    private String source;

    /** Audience id for a bulk run, workflow execution id for a node. Nullable. */
    @Column(name = "source_ref")
    private String sourceRef;

    /**
     * The {@code CallTrigger} this item must be dialled with. Stored rather than
     * re-derived: a MANUAL click keeps its throttle exemptions after an hour in the
     * queue, and a WORKFLOW_EXPLICIT node keeps its assigned-guard opt-out.
     */
    @Column(name = "call_trigger", nullable = false, length = 30)
    private String callTrigger;

    @Column(name = "response_id")
    private String responseId;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "phone_number", length = 32)
    private String phoneNumber;

    @Column(name = "campaign_id")
    private String campaignId;

    @Column(name = "campaign_name")
    private String campaignName;

    @Column(name = "preferred_number_id")
    private String preferredNumberId;

    @Column(name = "subject_type", length = 32)
    private String subjectType;

    @Column(name = "subject_id")
    private String subjectId;

    @Column(name = "customer_name")
    private String customerName;

    @Column(name = "customer_email")
    private String customerEmail;

    /** JSON blob replayed onto {@code AiCallRequestDTO.metadata} at dispatch. */
    @Column(name = "metadata", columnDefinition = "TEXT")
    private String metadata;

    /** The actor who asked for the call; becomes {@code counsellor_user_id} on the call log. */
    @Column(name = "actor_user_id")
    private String actorUserId;

    /** {@code institute:subject:provider} — unique among pending rows. */
    @Column(name = "dedupe_key", nullable = false, length = 512)
    private String dedupeKey;

    @Column(name = "status", nullable = false, length = 20)
    private String status;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "last_error", columnDefinition = "TEXT")
    private String lastError;

    /** Human-readable reason this item ended where it did; surfaced in the queue view. */
    @Column(name = "status_reason")
    private String statusReason;

    /** Not eligible for a slot before this instant (calling window, or a backoff). */
    @Column(name = "not_before")
    private Instant notBefore;

    /** Past this instant the item is EXPIRED instead of dialled. */
    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "call_log_id")
    private String callLogId;

    @Column(name = "dispatched_at")
    private Instant dispatchedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
        if (status == null) status = "QUEUED";
        if (priority == 0) priority = 100;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
