package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;

import java.util.ArrayList;
import java.util.List;

/** A question as the library shows it: the question, the topics it sits in and how many assessments use it. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryQuestionDto {
    private QuestionDTO question;
    @Builder.Default
    private List<String> nodeIds = new ArrayList<>();
    private Long assessmentCount;
}
