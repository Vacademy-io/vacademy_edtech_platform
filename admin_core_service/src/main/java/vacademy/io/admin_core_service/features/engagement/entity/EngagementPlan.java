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

    @Column(name = "created_by_user_id", nullable = false)
    private String createdByUserId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;

    public boolean isRelative() {
        return "RELATIVE".equals(scheduleMode);
    }
}
