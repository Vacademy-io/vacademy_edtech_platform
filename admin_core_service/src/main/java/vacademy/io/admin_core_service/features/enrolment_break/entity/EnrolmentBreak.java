package vacademy.io.admin_core_service.features.enrolment_break.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * A learner's break (docs/ENROLMENT_BREAKS.md). A HOLD only stops reminders; a PAUSE also stops
 * billing and expiry, can switch course access off, and moves the dates forward on resume.
 */
@Entity
@Table(name = "enrolment_break")
@Getter
@Setter
@NoArgsConstructor
public class EnrolmentBreak {

    public static final String KIND_HOLD = "HOLD";
    public static final String KIND_PAUSE = "PAUSE";

    public static final String STATUS_SCHEDULED = "SCHEDULED";
    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_ENDED = "ENDED";
    public static final String STATUS_CANCELLED = "CANCELLED";

    public static final String END_SCHEDULED = "SCHEDULED";
    public static final String END_MANUAL = "MANUAL";
    public static final String END_CANCELLED = "CANCELLED";

    public static final String RESUME_SHIFT = "SHIFT_BY_PAUSED_DAYS";
    public static final String RESUME_KEEP = "KEEP_DATES";
    public static final String RESUME_NEW_DATE = "NEW_DATE";

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "user_id", nullable = false)
    private String userId;

    /** Null = every course of the learner at this institute. */
    @Column(name = "package_session_id")
    private String packageSessionId;

    @Column(name = "user_plan_id")
    private String userPlanId;

    @Column(name = "kind", nullable = false)
    private String kind;

    @Column(name = "stop_class_reminders", nullable = false)
    private boolean stopClassReminders = true;

    @Column(name = "stop_fee_reminders", nullable = false)
    private boolean stopFeeReminders = true;

    @Column(name = "remove_access", nullable = false)
    private boolean removeAccess = false;

    @Column(name = "starts_on", nullable = false)
    private LocalDate startsOn;

    /** Null = until an admin resumes it. */
    @Column(name = "ends_on")
    private LocalDate endsOn;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "reason")
    private String reason;

    @Column(name = "note")
    private String note;

    /** Comma-separated mapping ids this break switched to INACTIVE. */
    @Column(name = "paused_access_ids")
    private String pausedAccessIds;

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "ended_at")
    private LocalDateTime endedAt;

    @Column(name = "ended_by_user_id")
    private String endedByUserId;

    @Column(name = "end_kind")
    private String endKind;

    @Column(name = "resume_mode")
    private String resumeMode;

    @Column(name = "shifted_days")
    private Integer shiftedDays;

    @Column(name = "plan_end_before")
    private LocalDateTime planEndBefore;

    @Column(name = "plan_end_after")
    private LocalDateTime planEndAfter;

    @Column(name = "created_by_user_id")
    private String createdByUserId;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        if (id == null) id = UUID.randomUUID().toString();
        LocalDateTime now = LocalDateTime.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    public boolean isPause() {
        return KIND_PAUSE.equals(kind);
    }

    public boolean isLive() {
        return STATUS_ACTIVE.equals(status) || STATUS_SCHEDULED.equals(status);
    }

    /** True when the break covers this day (inclusive on both ends). */
    public boolean covers(LocalDate day) {
        if (day == null || startsOn == null) return false;
        if (day.isBefore(startsOn)) return false;
        return endsOn == null || !day.isAfter(endsOn);
    }
}
