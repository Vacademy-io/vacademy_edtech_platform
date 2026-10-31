package vacademy.io.admin_core_service.features.audience.leadagent.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * The asked-for contacts that already belong to a live lead of the institute: phones as their
 * last 10 digits, emails lower-cased.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadAgentExistingContactsResponseDTO {
    private List<String> phones;
    private List<String> emails;
}
