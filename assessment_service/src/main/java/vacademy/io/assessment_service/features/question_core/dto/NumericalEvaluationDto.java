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
public class NumericalEvaluationDto {
    private String type; // Type of evaluation (e.g., "NUMERIC")
    private NumericalData data;

    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class NumericalData {
        // Same trap as MCQEvaluationDTO.MCQData: a nested class does not inherit the
        // outer SnakeCaseStrategy, so only the camelCase spelling ever bound. The alias
        // accepts the snake_case form generators emit; serialization stays camelCase so
        // stored rows and existing readers are untouched.
        @JsonAlias("valid_answers")
        private List<Double> validAnswers;  // Stores integer, 1 decimal, 2 decimals, or negative numbers
    }
}

