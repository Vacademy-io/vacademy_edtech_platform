package vacademy.io.assessment_service.features.assessment.omr.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** One upload of filled OMR sheets for one set (V60). Counts are taken from the items. */
@Entity
@Table(name = "omr_scan_batch")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OmrScanBatch {

    public static final String RUNNING = "RUNNING";
    public static final String NEEDS_REVIEW = "NEEDS_REVIEW";
    public static final String COMPLETED = "COMPLETED";

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "assessment_id", nullable = false)
    private String assessmentId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "set_id", nullable = false)
    private String setId;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "total_files", nullable = false)
    private Integer totalFiles;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_by_name")
    private String createdByName;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "completed_at")
    private Date completedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false)
    private Date updatedAt;

    @PreUpdate
    void touch() {
        updatedAt = new Date();
    }
}
