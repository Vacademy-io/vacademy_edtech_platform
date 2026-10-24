package vacademy.io.assessment_service.features.assessment.copy_intake.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;
import java.util.List;

/** One uploaded copy inside a batch, from file to graded attempt. See V46. */
@Entity
@Table(name = "ai_copy_intake_item")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiCopyIntakeItem {

    public static final String PENDING = "PENDING";
    public static final String IDENTIFYING = "IDENTIFYING";
    public static final String MATCHED = "MATCHED";
    public static final String AMBIGUOUS = "AMBIGUOUS";
    public static final String UNMATCHED = "UNMATCHED";
    public static final String QUEUED = "QUEUED";
    public static final String EVALUATING = "EVALUATING";
    public static final String COMPLETED = "COMPLETED";
    public static final String FAILED = "FAILED";
    public static final String SKIPPED = "SKIPPED";

    /** Still moving on its own: the batch is not done while any item is here. */
    public static final List<String> ACTIVE = List.of(PENDING, IDENTIFYING, MATCHED, QUEUED, EVALUATING);
    /** Waiting for a person: the batch is NEEDS_REVIEW while any item is here. */
    public static final List<String> WAITING_FOR_ADMIN = List.of(AMBIGUOUS, UNMATCHED);

    @Id
    @UuidGenerator
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "batch_id", nullable = false, length = 36)
    private String batchId;

    @Column(name = "file_id", nullable = false)
    private String fileId;

    @Column(name = "file_name")
    private String fileName;

    @Column(name = "page_count")
    private Integer pageCount;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "extracted_name")
    private String extractedName;

    @Column(name = "extracted_roll")
    private String extractedRoll;

    @Column(name = "extracted_class")
    private String extractedClass;

    @Column(name = "extract_confidence")
    private Double extractConfidence;

    @Column(name = "candidates_json", columnDefinition = "TEXT")
    private String candidatesJson;

    @Column(name = "match_score")
    private Double matchScore;

    @Column(name = "matched_user_id")
    private String matchedUserId;

    @Column(name = "matched_name")
    private String matchedName;

    @Column(name = "registration_id")
    private String registrationId;

    @Column(name = "attempt_id")
    private String attemptId;

    @Column(name = "process_id", length = 36)
    private String processId;

    @Column(name = "resolved_by")
    private String resolvedBy;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
