package vacademy.io.admin_core_service.features.counselor_pool.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * A pool that groups counselors and links to one or more campaigns (audiences).
 * Each pool picks ONE assignment_mode (MANUAL | ROUND_ROBIN | TIME_BASED) which
 * governs how leads arriving on its audiences get routed to a counselor.
 */
@Entity
@Table(name = "counselor_pool")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CounselorPool {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "assignment_mode", nullable = false, length = 50)
    private String assignmentMode; // AssignmentMode enum value

    /**
     * How the admin authored the weekly schedule (TIME_BASED pools only).
     * Drives which editor the UI renders when the pool is reopened. NULL
     * means the admin hasn't picked yet — UI shows the empty-state chooser.
     * Routing engine ignores this field — it reads flat shift rows.
     */
    @Column(name = "schedule_pattern", length = 50)
    private String schedulePattern; // SchedulePattern enum value, or null

    /**
     * ROUND_ROBIN opt-in: when true, the rotation is additionally gated to
     * counsellors who are on shift right now (same shift schedule TIME_BASED
     * uses). When false (default), ROUND_ROBIN considers every member. Ignored
     * for MANUAL; TIME_BASED is always shift-gated regardless of this flag.
     */
    @Builder.Default
    @Column(name = "shift_aware", nullable = false)
    private Boolean shiftAware = false;

    /**
     * Opt-in: rotate in one pool-wide order (the order most lists share) instead of each
     * list's own display_order, so lists that drifted into different orders can't skip a
     * counsellor. When false (default), routing reads the list's order and per-campaign
     * orders apply.
     */
    @Builder.Default
    @Column(name = "unified_rotation_order", nullable = false)
    private Boolean unifiedRotationOrder = false;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;

    @PreUpdate
    protected void onUpdate() {
        updatedAt = new Timestamp(System.currentTimeMillis());
    }
}
