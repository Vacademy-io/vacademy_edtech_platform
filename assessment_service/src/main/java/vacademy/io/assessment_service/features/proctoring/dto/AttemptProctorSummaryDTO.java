package vacademy.io.assessment_service.features.proctoring.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Per-attempt flag/warn counts, for the submissions table column. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AttemptProctorSummaryDTO {
    private String attemptId;
    private long flagCount;
    private long warnCount;
}
