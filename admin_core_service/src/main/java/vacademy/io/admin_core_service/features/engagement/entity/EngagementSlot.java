package vacademy.io.admin_core_service.features.engagement.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalTime;

/**
 * A scheduled window inside a plan.
 *
 * Times are WALL-CLOCK in the plan's timezone, never UTC instants — a recurring
 * 6 AM slot stored as an instant drifts an hour twice a year in any DST zone.
 * {@code EngagementScheduleResolver} converts to instants at read time.
 */
@Entity
@Table(name = "engagement_slot")
@Getter
@Setter
@NoArgsConstructor
public class EngagementSlot {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "plan_id", nullable = false)
    private String planId;

    @Column(name = "title")
    private String title;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    /** NULL = single-day slot. */
    @Column(name = "end_date")
    private LocalDate endDate;

    @Column(name = "start_time", nullable = false)
    private LocalTime startTime;

    @Column(name = "end_time", nullable = false)
    private LocalTime endTime;

    /** Bitmask Mon=1..Sun=64; NULL = every day in the range. */
    @Column(name = "dow_mask")
    private Integer dowMask;

    /** NULL = reveal at endTime. */
    @Column(name = "reveal_time")
    private LocalTime revealTime;

    /** NULL = no push for this slot. */
    @Column(name = "notify_time")
    private LocalTime notifyTime;

    /** RELATIVE plans only: first and last day, 1-based, after the learner's Day 1. */
    @Column(name = "start_day")
    private Integer startDay;

    @Column(name = "end_day")
    private Integer endDay;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    @Column(name = "status", nullable = false)
    private String status = EngagementEnums.SlotStatus.ACTIVE.name();

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;

    /** The last date this slot can run — endDate, or startDate for a single-day slot. */
    public LocalDate effectiveEndDate() {
        return endDate == null ? startDate : endDate;
    }

    /** When answers and the leaderboard become visible. */
    public LocalTime effectiveRevealTime() {
        return revealTime == null ? endTime : revealTime;
    }

    /**
     * A detached copy with the same schedule shifted onto real dates. Used for RELATIVE
     * plans, per learner; never saved.
     */
    public EngagementSlot shiftedCopy(LocalDate start, LocalDate end) {
        EngagementSlot copy = new EngagementSlot();
        copy.id = id;
        copy.planId = planId;
        copy.title = title;
        copy.startDate = start;
        copy.endDate = end;
        copy.startTime = startTime;
        copy.endTime = endTime;
        copy.dowMask = null;
        copy.revealTime = revealTime;
        copy.notifyTime = notifyTime;
        copy.sortOrder = sortOrder;
        copy.status = status;
        copy.startDay = startDay;
        copy.endDay = endDay;
        copy.createdAt = createdAt;
        copy.updatedAt = updatedAt;
        return copy;
    }
}
