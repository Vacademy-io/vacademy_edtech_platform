package vacademy.io.admin_core_service.features.learner_quiz.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class QuizAnswerCheckResponse {
    /** Null when this question cannot be marked automatically. */
    private Boolean correct;
    /** Video and question slides only: quiz questions report the verdict and nothing more. */
    private List<String> correctOptionIds;
    private String correctAnswerText;
    private String explanation;
}
