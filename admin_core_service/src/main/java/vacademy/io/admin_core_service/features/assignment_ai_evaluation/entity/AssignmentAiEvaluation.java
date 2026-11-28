package vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * One AI Evaluator run over a learner's assignment copy. Its id is the copy-check
 * process_id, so ai_service callbacks land on it directly. The result is a suggestion
 * for the grade form - see V566.
 */
@Entity
@Table(name = "assignment_ai_evaluation")
@Getter
@Setter
@NoArgsConstructor
public class AssignmentAiEvaluation {

    /** Waiting for a free grading slot (bulk checks, or ai_service was busy). */
    public static final String STATUS_QUEUED = "QUEUED";
    public static final String STATUS_PROCESSING = "PROCESSING";
    public static final String STATUS_COMPLETED = "COMPLETED";
    public static final String STATUS_FAILED = "FAILED";

    @Id
    private String id;

    @Column(name = "tracked_id", nullable = false)
    private String trackedId;

    /** Set for "Check all with AI" runs; the teacher is notified once per batch. */
    @Column(name = "batch_id")
    private String batchId;

    @Column(name = "slide_id", nullable = false)
    private String slideId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "triggered_by")
    private String triggeredBy;

    @Column(nullable = false)
    private String status;

    @Column(name = "current_step")
    private String currentStep;

    @Column(name = "preferred_model")
    private String preferredModel;

    @Column(name = "ai_job_id")
    private String aiJobId;

    @Column(name = "source_file_id")
    private String sourceFileId;

    @Column(name = "max_marks")
    private Double maxMarks;

    @Column(name = "marks_awarded")
    private Double marksAwarded;

    @Column(columnDefinition = "TEXT")
    private String feedback;

    @Column(name = "evaluated_file_id")
    private String evaluatedFileId;

    @Column(name = "result_json", columnDefinition = "TEXT")
    private String resultJson;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public boolean isTerminal() {
        return STATUS_COMPLETED.equals(status) || STATUS_FAILED.equals(status);
    }
}
