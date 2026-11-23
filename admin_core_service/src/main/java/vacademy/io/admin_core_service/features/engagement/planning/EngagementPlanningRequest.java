package vacademy.io.admin_core_service.features.engagement.planning;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.sql.Timestamp;
import java.time.LocalDate;

/** One weekly planning email to one teacher for one batch (V728). */
@Entity
@Table(name = "engagement_planning_request")
@Getter
@Setter
@NoArgsConstructor
public class EngagementPlanningRequest {

    public enum Status { SENT, SUBMITTED, DRAFTING, DRAFTED, PUBLISHED, FAILED, EXPIRED }

    @Id
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "package_session_id", nullable = false)
    private String packageSessionId;

    @Column(name = "teacher_user_id", nullable = false)
    private String teacherUserId;

    @Column(name = "week_start", nullable = false)
    private LocalDate weekStart;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "token_hash", nullable = false)
    private String tokenHash;

    @Column(name = "reminder_token_hash")
    private String reminderTokenHash;

    @Column(name = "subjects")
    private String subjects;

    @Column(name = "topic")
    private String topic;

    @Column(name = "ai_task_id")
    private String aiTaskId;

    @Column(name = "plan_id")
    private String planId;

    @Column(name = "error")
    private String error;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "expires_at", nullable = false)
    private Timestamp expiresAt;

    @Column(name = "sent_at")
    private Timestamp sentAt;

    @Column(name = "reminded_at")
    private Timestamp remindedAt;

    @Column(name = "submitted_at")
    private Timestamp submittedAt;

    @Column(name = "drafted_at")
    private Timestamp draftedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;

    public boolean is(Status s) {
        return s.name().equals(status);
    }
}
