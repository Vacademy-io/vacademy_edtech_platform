package vacademy.io.notification_service.features.chatbot_flow.engine;

import lombok.Builder;
import lombok.Data;

import java.sql.Timestamp;
import java.util.Map;

@Data
@Builder
public class NodeExecutionResult {
    private boolean success;

    /** True if this node needs to wait for user input (CONDITION, AI_RESPONSE) */
    @Builder.Default
    private boolean waitForInput = false;

    /** True if this node schedules a delayed resume (DELAY) */
    @Builder.Default
    private boolean scheduleDelay = false;

    /** For CONDITION nodes: which branch was matched */
    private String selectedBranchId;
    /**
     * When true, follow ONLY an edge whose branchId equals {@link #selectedBranchId}; if none is
     * connected the flow ends. CONDITION keeps the lenient default (fall back to the default or
     * first edge). CRM_LEAD_CHECK needs strict: an unconnected "Existing lead" output must never
     * fall through into the new-lead questions.
     */
    @Builder.Default
    private boolean strictBranch = false;

    /** Variables to store in session context */
    private Map<String, Object> outputVariables;

    /** For DELAY nodes: when to resume */
    private Timestamp delayUntil;

    /** Error message if execution failed */
    private String errorMessage;
}
