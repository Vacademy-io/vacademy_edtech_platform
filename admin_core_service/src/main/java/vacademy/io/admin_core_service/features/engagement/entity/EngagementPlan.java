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

/** A batch's engagement plan: the container for scheduled slots. */
@Entity
@Table(name = "engagement_plan")
@Getter
@Setter
@NoArgsConstructor
public class EngagementPlan {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "package_session_id", nullable = false)
    private String packageSessionId;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "description")
    private String description;

    @Column(name = "subject_id")
    private String subjectId;

    @Column(name = "status", nullable = false)
    private String status = EngagementEnums.PlanStatus.DRAFT.name();

    /**
     * Snapshot of the institute's IANA zone at creation — deliberately NOT read live.
     * An institute changing its timezone mid-term must not shift already-attempted
     * windows under its learners.
     */
    @Column(name = "timezone", nullable = false)
    private String timezone;

    @Column(name = "default_miss_policy", nullable = false)
    private String defaultMissPolicy = EngagementEnums.MissPolicy.EXPIRES.name();

    @Column(name = "default_catch_up_days")
    private Integer defaultCatchUpDays;

    @Column(name = "default_catch_up_percent")
    private Integer defaultCatchUpPercent;

    /** CALENDAR (real dates) or RELATIVE (days after each learner joins). */
    @Column(name = "schedule_mode", nullable = false)
    private String scheduleMode = "CALENDAR";

    /** First time the plan went PUBLISHED; RELATIVE plans start existing learners here. */
    @Column(name = "published_at")
    private Timestamp publishedAt;

    /**
     * RELATIVE plans: what Day 1 counts from. JOIN = the learner's batch join day;
     * CONTENT = the day they complete {@link #startSourceId}.
     */
    @Column(name = "start_trigger", nullable = false)
    private String startTrigger = "JOIN";

    /** CONTENT start: SUBJECT, MODULE or CHAPTER. */
    @Column(name = "start_source_type")
    private String startSourceType;

    @Column(name = "start_source_id")
    private String startSourceId;

    /** Name of the start content when it was picked; display only. */
    @Column(name = "start_source_name")
    private String startSourceName;

    /** CONTENT start: completion percent that counts as done (1–100). */
    @Column(name = "start_threshold")
    private Integer startThreshold;

    @Column(name = "created_by_user_id", nullable = false)
    private String createdByUserId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;

    public boolean isRelative() {
        return "RELATIVE".equals(scheduleMode);
    }

    /** A RELATIVE plan whose Day 1 is the day the learner completes chosen content. */
    public boolean isContentStart() {
        return isRelative() && "CONTENT".equals(startTrigger)
                && startSourceType != null && startSourceId != null;
    }

    /** Completion percent that counts as done; 100 unless set. */
    public int effectiveStartThreshold() {
        return startThreshold == null ? 100 : Math.max(1, Math.min(100, startThreshold));
    }
}
