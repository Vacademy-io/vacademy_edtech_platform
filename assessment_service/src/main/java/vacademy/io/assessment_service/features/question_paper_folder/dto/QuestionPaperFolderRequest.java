package vacademy.io.assessment_service.features.question_paper_folder.dto;

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
public class QuestionPaperFolderRequest {
    private String name;
    private String description;
    private String imageUrl;
    /** Optional: papers to put in the folder right after it is created. */
    private List<String> questionPaperIds = new ArrayList<>();
}
