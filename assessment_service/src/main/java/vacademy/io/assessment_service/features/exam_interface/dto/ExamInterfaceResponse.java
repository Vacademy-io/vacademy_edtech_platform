package vacademy.io.assessment_service.features.exam_interface.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** {"assessment_id":"...","exam_interface":{...}|null}; null = default test screen. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonInclude(JsonInclude.Include.ALWAYS)
public class ExamInterfaceResponse {
    private String assessmentId;
    private JsonNode examInterface;
}
