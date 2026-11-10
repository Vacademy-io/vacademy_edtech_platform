package vacademy.io.assessment_service.features.learner_assessment.dto.status_json.manual;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.*;

import java.util.List;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
// The learner app also sends per-question fields this DTO does not model (e.g. CBE/CODING
// responseData); the raw json is stored verbatim, so unknown fields are ignored here.
@JsonIgnoreProperties(ignoreUnknown = true)
public class ManualSectionAttemptDto {
    private String sectionId;
    private Long sectionDurationLeftInSeconds;
    private Long timeElapsedInSeconds;
    private List<ManualQuestionAttemptDto> questions;
}
