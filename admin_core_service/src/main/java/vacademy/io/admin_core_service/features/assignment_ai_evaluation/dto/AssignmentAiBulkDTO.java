package vacademy.io.admin_core_service.features.assignment_ai_evaluation.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.time.Instant;

/** "Check all with AI": what it covers (each learner's latest submission) and the last batch's progress. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssignmentAiBulkDTO {
    private int submissions;
    private int toCheck;
    private int alreadyGraded;
    private int alreadyAiChecked;
    /** Queued or with the grader now - never queued a second time. */
    private int inProgress;
    private int noFiles;
    private boolean totalMarksSet;
    private BatchProgress latestBatch;

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BatchProgress {
        private String batchId;
        private int total;
        private int pending;
        private int completed;
        private int failed;
        private boolean done;
        private Instant createdAt;
    }
}
