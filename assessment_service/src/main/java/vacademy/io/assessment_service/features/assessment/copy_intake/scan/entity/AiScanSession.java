package vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/**
 * One scan-station sitting for an assessment: the loads a clerk scans, then the
 * per-student PDFs built from them and the intake batch they were handed to.
 * The copies, flags and verdict are never stored; see ScanPlanner. See V72.
 */
@Entity
@Table(name = "ai_scan_session")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiScanSession {

    public static final String OPEN = "OPEN";
    public static final String BUILDING = "BUILDING";
    public static final String BUILT = "BUILT";
    public static final String STARTING = "STARTING";
    public static final String STARTED = "STARTED";
    public static final String FAILED = "FAILED";

    @Id
    @UuidGenerator
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "assessment_id", nullable = false)
    private String assessmentId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "created_by_user_id")
    private String createdByUserId;

    @Column(name = "created_by_name")
    private String createdByName;

    @Builder.Default
    @Column(name = "status", nullable = false, length = 20)
    private String status = OPEN;

    /** {"fronts_direction": "FORWARD" | "REVERSED" | null} */
    @Column(name = "decisions_json", columnDefinition = "TEXT")
    private String decisionsJson;

    /** [{copy_key, file_id, page_count, file_name, page_map}] once built. */
    @Column(name = "built_json", columnDefinition = "TEXT")
    private String builtJson;

    /** The plan fingerprint the PDFs were built from; start refuses when today's plan differs. */
    @Column(name = "build_fingerprint", length = 64)
    private String buildFingerprint;

    @Column(name = "intake_batch_id", length = 36)
    private String intakeBatchId;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
