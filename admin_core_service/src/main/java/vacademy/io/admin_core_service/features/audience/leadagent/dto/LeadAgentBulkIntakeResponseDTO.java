package vacademy.io.admin_core_service.features.audience.leadagent.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadAgentBulkIntakeResponseDTO {

    public static final String CREATED = "CREATED";
    public static final String DUPLICATE = "DUPLICATE";
    public static final String FAILED = "FAILED";

    private List<Result> results;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Result {
        private String externalId;
        /** CREATED | DUPLICATE | FAILED */
        private String status;
        private String responseId;
        private String message;
    }
}
