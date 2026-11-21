package vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.numeric;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class NUMERICCorrectAnswerDto {
    private String type;
    private DataFields data;

    @Getter
    @Setter
    public static class DataFields {
        private List<Double> validAnswers;
        /**
         * Optional absolute tolerance: an answer within ± this of any valid answer is
         * correct (accounting papers accept rounding, e.g. ±1). Absent or 0 = exact match.
         */
        private Double tolerance;
    }
}
