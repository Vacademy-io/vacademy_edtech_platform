package vacademy.io.admin_core_service.features.workflow.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.workflow.enums.ExecutionLogStatus;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowExecutionStatus;

import java.time.Instant;
import java.util.List;

/**
 * One automation run that happened for a specific learner/lead, with its ordered per-node
 * steps — what the learner side-view's Workflows tab lists.
 *
 * <p>Distinct from {@link EnrollmentWorkflowRunDTO}, which answers a different question
 * ("did the enrollment automation configured for this COURSE run?", including runs that
 * have not happened yet). This one is strictly historical and strictly per-person: every
 * row is a real execution whose {@code subject_user_id} is this user.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UserWorkflowRunDTO {

    private String executionId;

    private String workflowId;

    private String workflowName;

    /** SCHEDULED / EVENT_DRIVEN — how the run was started. */
    private String workflowType;

    /** The trigger event that fired it, e.g. LEARNER_BATCH_ENROLLMENT. Null for scheduled runs. */
    private String eventName;

    private WorkflowExecutionStatus status;

    private String errorMessage;

    private Instant startedAt;

    private Instant completedAt;

    /**
     * Whether Retry is offered for this run. False when the run has no recorded seed
     * context (it pre-dates the feature) or is still PROCESSING. {@link #retryBlockedReason}
     * carries the explanation to show instead of the button.
     */
    private boolean retryable;

    private String retryBlockedReason;

    /** Set when this run is itself a retry — the execution it re-ran. */
    private String retryOfExecutionId;

    /** Admin who pressed Retry, when this run is a retry. */
    private String retriedByUserId;

    private List<Step> steps;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Step {

        private String logId;

        private String nodeTemplateId;

        /** Human-readable node name from node_template; falls back to the node type. */
        private String nodeName;

        private String nodeType;

        private ExecutionLogStatus status;

        private String errorMessage;

        private String errorType;

        private Instant startedAt;

        private Instant completedAt;

        private Long executionTimeMs;
    }
}
