package vacademy.io.admin_core_service.features.counsellor_workbench.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Response from /reassign and /reassign/preview. Same shape for both — preview
 * sets {@code dry_run = true} and skips persistence.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReassignResultDTO {
    private Boolean dryRun;
    private Integer totalLeads;
    private List<AssignmentResult> assignments;

    /**
     * Echoes back whether the source counsellor was flipped INACTIVE as part
     * of this transaction. The frontend uses it to render the right success
     * toast (and to know which queries to invalidate).
     */
    private Boolean markedInactive;

    /**
     * Batched calls only ({@code batch_size} set): open leads of the source counsellor still
     * in scope after this call. 0 means the handover is complete. Null when not batched.
     */
    private Integer remainingLeads;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AssignmentResult {
        private String leadId;
        private String leadName;
        private String fromUserId;
        private String toUserId;
        private String toUserName;
    }
}
