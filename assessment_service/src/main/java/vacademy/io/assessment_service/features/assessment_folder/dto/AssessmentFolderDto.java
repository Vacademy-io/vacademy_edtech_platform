package vacademy.io.assessment_service.features.assessment_folder.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssessmentFolderDto {
    private String id;
    private String name;
    private String description;
    private String imageUrl;
    private Integer displayOrder;
    private String status;
    private String parentId;
    /** Admin: every non-deleted assessment in the folder. Learner: only the ones this learner can see. */
    private Long assessmentCount;
}
