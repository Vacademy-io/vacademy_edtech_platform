package vacademy.io.assessment_service.features.submission_review.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** One row of the append-only marks history (V75, spec 8.2). */
@Entity
@Table(name = "mark_event")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MarkEvent {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "assessment_id", nullable = false)
    private String assessmentId;

    @Column(name = "attempt_id", nullable = false)
    private String attemptId;

    @Column(name = "section_id")
    private String sectionId;

    /** Null = a submission-level event (release, withdraw, total recomputed...). */
    @Column(name = "question_id")
    private String questionId;

    @Column(name = "event_type", nullable = false)
    private String eventType;

    @Column(name = "old_marks")
    private Double oldMarks;

    @Column(name = "new_marks")
    private Double newMarks;

    @Column(name = "max_marks")
    private Double maxMarks;

    @Column(name = "old_source")
    private String oldSource;

    @Column(name = "new_source")
    private String newSource;

    @Column(name = "old_state")
    private String oldState;

    @Column(name = "new_state")
    private String newState;

    @Column(name = "old_feedback", columnDefinition = "TEXT")
    private String oldFeedback;

    @Column(name = "new_feedback", columnDefinition = "TEXT")
    private String newFeedback;

    @Column(name = "reason", columnDefinition = "TEXT")
    private String reason;

    @Column(name = "actor_type", nullable = false)
    private String actorType;

    @Column(name = "actor_user_id")
    private String actorUserId;

    @Column(name = "ai_process_id")
    private String aiProcessId;

    @Column(name = "ai_question_evaluation_id")
    private String aiQuestionEvaluationId;

    @Column(name = "rubric_version")
    private Integer rubricVersion;

    @Column(name = "credits_charged")
    private Double creditsCharged;

    @Column(name = "after_release", nullable = false)
    private boolean afterRelease;

    @Column(name = "payload_json", columnDefinition = "TEXT")
    private String payloadJson;

    /**
     * Set by the writer (millisecond clock) rather than the column default: several events
     * written in one transaction would otherwise share now() and lose their order.
     */
    @Column(name = "created_at", updatable = false)
    private Date createdAt;
}
