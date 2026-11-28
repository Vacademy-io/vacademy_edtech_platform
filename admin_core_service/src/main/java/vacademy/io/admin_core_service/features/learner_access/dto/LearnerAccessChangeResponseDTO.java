package vacademy.io.admin_core_service.features.learner_access.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerAccessChangeResponseDTO {

    private boolean dryRun;

    private SummaryDTO summary;

    private List<ItemDTO> results;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SummaryDTO {
        private int totalTargeted;
        private int updated;
        private int skipped;
        private int failed;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ItemDTO {
        private String userId;
        private String learnerName;
        private String packageSessionId;
        private String mappingId;
        /** UPDATED, SKIPPED or FAILED. */
        private String status;
        private String action;
        private Date previousExpiryDate;
        private Date newExpiryDate;
        private Integer daysDelta;
        /** Set only when the join date moved. */
        private Date previousJoinDate;
        private Date newJoinDate;
        /** The plan term after a join-date shift, so the caller can show what it becomes. */
        private Date newPlanEndDate;
        /** Days of access remaining after the change; null when unlimited. */
        private Integer remainingDays;
        private String message;
    }
}
