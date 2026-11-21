package vacademy.io.admin_core_service.features.learner_quiz.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

/**
 * One learner's answers for one attempt. Holds what the learner chose and nothing else:
 * marks, verdicts and option text are worked out on the server.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class QuizAttemptSubmitRequest {
    /** Client-generated and stable across retries of the same attempt. Becomes activity_log.id. */
    private String attemptId;
    private String slideId;
    private String chapterId;
    private String moduleId;
    private String subjectId;
    private String packageSessionId;
    private Long startTimeInMillis;
    private Long endTimeInMillis;
    private List<Answer> answers;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Answer {
        private String questionId;
        /** Option ids for option questions. */
        private List<String> selectedOptionIds;
        /** The typed answer for numeric and free-text questions. */
        private String textAnswer;
    }
}
