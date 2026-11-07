package vacademy.io.admin_core_service.features.telephony.queue.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * Per-institute queue overrides. <b>Sparse by design</b> — an institute with no row
 * here uses the dynamic default cap, so this table stays empty until someone tunes a
 * specific customer.
 *
 * <p>{@code maxConcurrent} is the knob that makes strict-FIFO ordering fair: the drain
 * scan skips an item whose institute already has that many calls in flight, so a
 * latecomer with five leads takes the next free slot instead of waiting out a
 * 500-lead backlog ahead of it.
 */
@Entity
@Table(name = "ai_call_lane")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiCallLane {

    @Id
    @Column(name = "institute_id", nullable = false, updatable = false)
    private String instituteId;

    /**
     * Hard ceiling on this institute's simultaneous AI calls. NULL = use the dynamic
     * default, {@code max(1, ceil(fleetCapacity / lanesWithWork))}, which is
     * work-conserving: one institute dialling alone gets the whole fleet.
     */
    @Column(name = "max_concurrent")
    private Integer maxConcurrent;

    /** Reserved for a future weighted rotation. Not read today. */
    @Column(name = "weight", nullable = false)
    private int weight;

    /** True = this institute's queued calls are held (nothing dialled, nothing lost). */
    @Column(name = "paused", nullable = false)
    private boolean paused;

    /**
     * Written on every dispatch, never read. Carried so switching from FIFO to a
     * round-robin rotation — the fix if more institutes are ever busy at once than
     * the fleet has slots — is an ORDER BY change rather than a migration.
     */
    @Column(name = "last_dispatched_at")
    private Instant lastDispatchedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
        if (weight <= 0) weight = 1;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
