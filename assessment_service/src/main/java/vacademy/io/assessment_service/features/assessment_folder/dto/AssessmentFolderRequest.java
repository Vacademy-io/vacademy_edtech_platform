package vacademy.io.assessment_service.features.assessment_folder.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssessmentFolderRequest {
    private String name;
    private String description;
    private String imageUrl;
    /** ACTIVE or HIDDEN; null keeps the current value (ACTIVE on create). */
    private String status;
    /** Optional: assessments to put in the folder right after it is created. */
    private List<String> assessmentIds = new ArrayList<>();
}
