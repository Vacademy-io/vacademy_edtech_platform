package vacademy.io.admin_core_service.features.audience.leadagent.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/** {@code POST .../lead-agent/bulk-intake} body (LEAD_AGENT_BUILD_SPEC §5), at most 50 rows. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadAgentBulkIntakeRequestDTO {
    private String instituteId;
    private String audienceId;
    private List<Row> rows;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Row {
        /** The lead_candidate id; echoed back so the caller can match results. */
        private String externalId;
        private String fullName;
        private String email;
        private String mobile;
        /** la_* key → value. Keys outside the known la_* set are ignored. */
        private Map<String, String> customFields;
        /** Evidence written to the lead's timeline. */
        private String note;
    }
}
