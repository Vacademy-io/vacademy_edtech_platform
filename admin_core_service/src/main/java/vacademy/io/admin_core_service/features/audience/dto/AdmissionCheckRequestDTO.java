package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Body form of the admission check, for a bulk selection too long for a query string. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdmissionCheckRequestDTO {

    private String instituteId;

    /** audience_response ids. */
    private List<String> responseIds;
}
