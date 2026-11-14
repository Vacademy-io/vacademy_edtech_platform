package vacademy.io.admin_core_service.features.workflow.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * What the Retry action returns. The re-run is dispatched asynchronously, so this describes
 * the NEW execution that was just queued, not its outcome — the caller refetches the run
 * list to watch it progress.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class WorkflowRetryResponseDTO {

    /** Id of the newly created execution. */
    private String executionId;

    /** The execution it re-runs. */
    private String retryOfExecutionId;

    private String workflowId;

    private String workflowName;
}
