package vacademy.io.assessment_service.features.question_core.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
@AllArgsConstructor
@NoArgsConstructor
public class MCQEvaluationDTO {
    private String type;
    private MCQData data;

    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class MCQData {
        /**
         * Jackson does NOT inherit the outer class's SnakeCaseStrategy, so this nested
         * class only ever understood the camelCase spelling. Every AI question source
         * emits `correct_option_ids` (that is what question_format.py produces), which
         * bound to nothing and left this list null — and the next thing to touch it,
         * grading, died on `getCorrectOptionIds().contains(...)`.
         * <p>
         * An alias rather than @JsonNaming on the nested class, deliberately:
         * serialization stays camelCase, so every already-stored auto_evaluation_json
         * and the frontend report renderer that reads `data.correctOptionIds` keep
         * working untouched. This only widens what we accept on the way in.
         */
        @JsonAlias("correct_option_ids")
        private List<String> correctOptionIds;
    }
}
