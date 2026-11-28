package vacademy.io.admin_core_service.features.learner_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BulkAssignResponseDTO {

    private boolean dryRun;

    private SummaryDTO summary;

    private List<BulkAssignResultItemDTO> results;

    /** Set when the request enrolled an admission package: how it split across the courses. */
    private AdmissionPackagePreviewDTO admissionPackage;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SummaryDTO {
        private int totalRequested;
        private int successful;
        private int failed;
        private int skipped;
        private int reEnrolled;
    }
}
