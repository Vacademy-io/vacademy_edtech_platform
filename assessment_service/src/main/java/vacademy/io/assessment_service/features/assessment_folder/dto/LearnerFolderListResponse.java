package vacademy.io.assessment_service.features.assessment_folder.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerFolderListResponse {
    /** Only folders holding at least one assessment this learner can see. */
    @Builder.Default
    private List<AssessmentFolderDto> folders = new ArrayList<>();
    /** Visible assessments that are not in any active folder ("Others"). */
    private Long unfiledCount;
}
