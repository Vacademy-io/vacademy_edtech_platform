package vacademy.io.admin_core_service.features.audience.leadagent.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** {@code POST .../lead-agent/existing-contacts} body. Phones are compared on their last 10 digits. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadAgentExistingContactsRequestDTO {
    private String instituteId;
    private List<String> phones;
    private List<String> emails;
}
