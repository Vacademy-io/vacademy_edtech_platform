package vacademy.io.assessment_service.features.learner_assessment.dto.status_json;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class QuestionAttemptData {
    private String questionId;
    private Boolean isMarkedForReview;
    private Boolean isVisited;
    private Long questionDurationLeftInSeconds;
    private Long timeTakenInSeconds;
    private OptionsJson responseData;


    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    public static class OptionsJson {
        private String type;
        private List<String> optionIds = new ArrayList<>();
        /**
         * Typed answer for ONE_WORD and LONG_ANSWER (read by their marking strategies and
         * by the typed AI grader as {@code responseData.answer}). Left out of the JSON when
         * null, so option-only responses serialize exactly as before.
         */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private String answer;
        /** Numeric answer for NUMERIC ({@code responseData.validAnswer}); omitted when null. */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private Double validAnswer;

        public OptionsJson(String type, List<String> optionIds) {
            this.type = type;
            this.optionIds = optionIds;
        }
    }
}
