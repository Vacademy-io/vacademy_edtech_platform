package vacademy.io.admin_core_service.features.commerce.security.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

/** Body of PUT /commerce/v1/staff/locations: the full set of locations for one staff member. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class StaffLocationsRequest {
    private String userId;
    private List<String> locationIds;
}
