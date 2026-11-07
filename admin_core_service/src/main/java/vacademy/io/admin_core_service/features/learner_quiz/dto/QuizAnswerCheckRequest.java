package vacademy.io.admin_core_service.features.learner_quiz.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

/** One answer to one question, checked without recording anything. */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class QuizAnswerCheckRequest {
    private String slideId;
    private String questionId;
    private List<String> selectedOptionIds;
    private String textAnswer;
}
