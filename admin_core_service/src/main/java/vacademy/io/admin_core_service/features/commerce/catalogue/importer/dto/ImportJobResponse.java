package vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportIssue;

import java.time.LocalDateTime;
import java.util.List;

/** An import job with its progress. rows_done + rows_failed of rows_total is the progress bar. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ImportJobResponse {

    private String jobId;
    /** QUEUED, RUNNING, COMPLETED, COMPLETED_WITH_ERRORS or FAILED. */
    private String status;
    private String fileName;
    private String fileFormat;
    private Integer rowsTotal;
    private Integer rowsDone;
    private Integer rowsFailed;
    private Integer productsTotal;
    private Integer productsCreated;
    private Integer productsUpdated;
    private Integer productsFailed;
    private Integer variantsCreated;
    private Integer variantsUpdated;
    /** Image addresses stored for the migration tool; the import downloads nothing. */
    private Integer imageUrlsQueued;
    private Integer errorCount;
    private List<ImportIssue> issues;
    private Boolean issuesTruncated;
    /** Package ids of products the job created, capped, for the links on the result page. */
    private List<String> createdPackageIds;
    /** True while GET /import/{jobId}/error-rows can still build its file. */
    private Boolean errorRowsAvailable;
    private String failureMessage;
    private String createdByUserId;
    private LocalDateTime createdAt;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
}
