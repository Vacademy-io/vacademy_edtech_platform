package vacademy.io.assessment_service.features.assessment.copy_intake.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** One bulk upload of scanned copies for an assessment. See V46. */
@Entity
@Table(name = "ai_copy_intake_batch")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiCopyIntakeBatch {

    public static final String RUNNING = "RUNNING";
    public static final String NEEDS_REVIEW = "NEEDS_REVIEW";
    public static final String COMPLETED = "COMPLETED";
    public static final String FAILED = "FAILED";

    /** PDFs the admin uploaded; each copy is read for a name and matched first. */
    public static final String SOURCE_UPLOAD = "UPLOAD";
    /** Copies the learners submitted on their own attempts; nothing to identify. */
    public static final String SOURCE_SUBMITTED = "SUBMITTED";

    @Id
    @UuidGenerator
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "assessment_id", nullable = false)
    private String assessmentId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_by_name")
    private String createdByName;

    @Column(name = "created_by_email")
    private String createdByEmail;

    @Column(name = "preferred_model")
    private String preferredModel;

    @Column(name = "status", nullable = false)
    private String status;

    /** {@link #SOURCE_UPLOAD} or {@link #SOURCE_SUBMITTED}. See V49. */
    @Builder.Default
    @Column(name = "source", nullable = false)
    private String source = SOURCE_UPLOAD;

    public boolean isFromSubmissions() {
        return SOURCE_SUBMITTED.equals(source);
    }

    /** Copies in the upload. Everything else is counted from the items. */
    @Column(name = "total_items", nullable = false)
    private int totalItems;

    @Column(name = "notify_email", nullable = false)
    private boolean notifyEmail = true;

    @Column(name = "email_status")
    private String emailStatus;

    /** Status the admin was last told about; the same status is not announced twice. */
    @Column(name = "notified_status")
    private String notifiedStatus;

    @Column(name = "notified_at")
    private Date notifiedAt;

    @Column(name = "completed_at")
    private Date completedAt;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
