package vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

/** State of a background learner-list export, polled by the export dialog. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerExportJobDTO {
    private String jobId;
    /** QUEUED, RUNNING, COMPLETED or FAILED. */
    private String status;
    private int processedRows;
    /** Null until the first page has been read. */
    private Integer totalRows;
    /** True once the file can be downloaded. */
    private boolean fileReady;
    private String errorMessage;

    /** Used for the ownership check only, never sent to the browser. */
    @JsonIgnore
    private String requestedBy;
}
