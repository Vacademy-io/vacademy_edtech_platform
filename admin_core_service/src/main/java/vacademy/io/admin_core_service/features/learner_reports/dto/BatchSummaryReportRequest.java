package vacademy.io.admin_core_service.features.learner_reports.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.time.LocalDate;
import java.util.List;

/** Learning Reports → Batch → Overview: one batch and window, plus what to render or send. */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BatchSummaryReportRequest {

    private String packageSessionId;

    /** Display label for the report header ("Course · Level · Session"). */
    private String batchName;

    private LocalDate startDate;
    private LocalDate endDate;

    /** Sections to render; null means the institute's saved template. */
    private List<String> sections;

    /** Limit the report to these assessments; null or empty means every assessment in the window. */
    private List<String> assessmentIds;

    /** For /send: TEACHERS or PARENTS. */
    private String audience;
}
