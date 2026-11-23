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
public class MoveQuestionPapersRequest {
    /** Target folder; null takes the papers out of any folder. */
    private String folderId;
    private List<String> questionPaperIds = new ArrayList<>();
}
