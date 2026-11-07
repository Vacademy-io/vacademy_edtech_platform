package vacademy.io.assessment_service.features.proctoring.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/** What a reviewer sees for one attempt: the config that was in force, counts, and the timeline. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AttemptProctorReviewDTO {
    private String attemptId;
    private ProctoringConfigDTO config;
    private long flagCount;
    private long warnCount;
    private long snapshotCount;
    /** event_type -> count, for the summary chips. */
    private Map<String, Long> countsByType;
    private List<ProctorEventDTO> events;
}
