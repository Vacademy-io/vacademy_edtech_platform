package vacademy.io.assessment_service.features.assessment.dto.evaluation_ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Turn an existing offline test that only has the "Upload your answer sheet."
 * placeholder into one with real, AI-gradable questions. The questions already
 * exist in the question bank (the digitised paper); this carries their ids and
 * the marks the teacher approved.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class AdoptQuestionsRequest {

        private List<AdoptedQuestion> questions;

        /**
         * Internal choice read off the paper ("Answer any FOUR of these five"), by
         * question id. Optional: without it every question counts, as before.
         */
        private List<ChoiceGroup> choiceGroups;

        @Data
        @Builder
        @NoArgsConstructor
        @AllArgsConstructor
        @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
        @JsonIgnoreProperties(ignoreUnknown = true)
        public static class ChoiceGroup {
                private String label;
                private List<String> questionIds;
                private Integer attempt;
                /** "best" (default) or "first". */
                private String policy;
        }

        @Data
        @Builder
        @NoArgsConstructor
        @AllArgsConstructor
        @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
        @JsonIgnoreProperties(ignoreUnknown = true)
        public static class AdoptedQuestion {
                private String questionId;
                private String questionType;
                private Double marks;
        }
}
