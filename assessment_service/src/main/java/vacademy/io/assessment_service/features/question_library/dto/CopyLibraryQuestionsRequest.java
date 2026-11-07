package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/** What to copy out of the library: the given questions, or every question of one paper. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CopyLibraryQuestionsRequest {
    @Builder.Default
    private List<String> questionIds = new ArrayList<>();
    private String questionPaperId;
    /** Questions already in the section. Library questions they were copied from are skipped. */
    @Builder.Default
    private List<String> excludeQuestionIds = new ArrayList<>();
}
