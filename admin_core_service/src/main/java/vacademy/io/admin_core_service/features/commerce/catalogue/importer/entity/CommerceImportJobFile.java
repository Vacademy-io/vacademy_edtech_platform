package vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * The uploaded file of a job, kept apart from the job row so that reading progress never
 * loads it. Removed when the job ends without a failed row; kept otherwise for the
 * error-rows download, and purged after 30 days when the institute starts its next import.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_import_job_file")
public class CommerceImportJobFile {

    @Id
    @Column(name = "job_id", length = 36)
    private String jobId;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "content", nullable = false, updatable = false)
    private byte[] content;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
