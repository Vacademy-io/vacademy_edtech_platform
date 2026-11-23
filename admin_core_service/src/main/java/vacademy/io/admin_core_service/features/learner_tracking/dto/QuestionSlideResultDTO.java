package vacademy.io.admin_core_service.features.learner_tracking.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

/**
 * The signed-in learner's latest answer on a QUESTION slide, as the learner may see it.
 * Verdict and correct answer are filled only after a submission and only when the slide's
 * author left "show answer after submit" on.
 */
@Getter
@Setter
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class QuestionSlideResultDTO {
    private String slideId;
    /** Whether the learner has submitted an answer on this slide. */
    private boolean submitted;
    /** The author's setting: tell the learner after submitting if the answer was right. */
    private boolean showAnswer;
    /** CORRECT | WRONG | SKIPPED; null when hidden, not submitted, or not auto-gradable (long answers). */
    private String verdict;
    /** 1-based number of the latest submission. */
    private Integer attemptNumber;
    /** How many times the learner has submitted on this slide. */
    private long attempts;
    /** Choice questions: the correct option ids. Empty when hidden. */
    private List<String> correctOptionIds = List.of();
    /** Numeric: accepted values. One-word / long answer: the model answer. Empty when hidden. */
    private List<String> correctAnswers = List.of();
    /** The author's explanation, once the learner has submitted (shown as before, whatever the setting). */
    private String explanationHtml;
    /**
     * The learner's own latest answer, as they submitted it. The app shows the verdict only
     * while this is the answer on screen, so a verdict is never paired with another attempt.
     */
    private String responseJson;
}
