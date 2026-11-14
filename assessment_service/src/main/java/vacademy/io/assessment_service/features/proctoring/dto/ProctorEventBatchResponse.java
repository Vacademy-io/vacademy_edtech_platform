package vacademy.io.assessment_service.features.proctoring.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProctorEventBatchResponse {
    private int accepted;
    /** FLAG-severity events stored for this attempt so far, so the client can enforce the ceiling with the server's count, not its own. */
    private long flagCount;
}
