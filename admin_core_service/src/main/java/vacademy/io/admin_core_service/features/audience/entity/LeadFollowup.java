package vacademy.io.admin_core_service.features.audience.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

@Entity
@Table(name = "lead_followup")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LeadFollowup {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "audience_response_id", nullable = false)
    private String audienceResponseId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "schedule_time")
    private Timestamp scheduleTime;

    /** PENDING | ONGOING | OVERDUE | COMPLETED */
    @Column(name = "status", nullable = false, length = 30)
    @Builder.Default
    private String status = "PENDING";

    @Column(name = "is_closed", nullable = false)
    @Builder.Default
    private Boolean isClosed = false;

    /** Opened for a repeat-lead reattempt; the Follow-ups page lists these leads first. */
    @Column(name = "is_priority", nullable = false)
    @Builder.Default
    private Boolean isPriority = false;

    @Column(name = "content", columnDefinition = "TEXT")
    private String content;

    /*
     * What the student said, how the counsellor reached them, and what happens
     * next. The option lists live in the institute's LEAD_SETTING, so these are
     * plain strings: an institute adding or renaming an option is a settings
     * change, not a migration.
     */
    @Column(name = "student_response")
    private String studentResponse;

    @Column(name = "follow_up_mode")
    private String followUpMode;

    @Column(name = "next_action")
    private String nextAction;

    /** How warm the lead sounded on this follow-up - its own record, not the lead's tier. */
    @Column(name = "interest_level")
    private String interestLevel;

    @Column(name = "closer_reason", columnDefinition = "TEXT")
    private String closerReason;

    @Column(name = "closed_by")
    private String closedBy;

    @Column(name = "closed_at")
    private Timestamp closedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;
}
