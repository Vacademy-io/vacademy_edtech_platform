package vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/** One "Check all with AI" request: the submissions it queued share its id as batch_id. */
@Entity
@Table(name = "assignment_ai_evaluation_batch")
@Getter
@Setter
@NoArgsConstructor
public class AssignmentAiEvaluationBatch {

    @Id
    private String id;

    @Column(name = "slide_id", nullable = false)
    private String slideId;

    @Column(name = "package_session_id")
    private String packageSessionId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "triggered_by", nullable = false)
    private String triggeredBy;

    @Column(name = "total_count", nullable = false)
    private Integer totalCount;

    @Column(name = "notified_at")
    private Instant notifiedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
    }
}
