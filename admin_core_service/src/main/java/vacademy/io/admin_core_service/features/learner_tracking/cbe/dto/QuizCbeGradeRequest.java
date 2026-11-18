package vacademy.io.admin_core_service.features.learner_tracking.cbe.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

/**
 * {@code POST .../quiz-slide/cbe/grade}: AI-check the Spreadsheet &amp; Written Response answers
 * of one submitted quiz attempt. The learner is the token holder; there is no user id here on
 * purpose. The answers themselves were recorded by the quiz submit.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class QuizCbeGradeRequest {
    private String slideId;
    /** The activity_log id of the submitted attempt (the id the quiz submit sent). */
    private String attemptId;
    private String chapterId;
    private String packageSessionId;
}
