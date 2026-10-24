package vacademy.io.assessment_service.features.assessment.dto.offline_entry;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class OfflineQuestionResponse {
    private String questionId;
    private String type;
    @Builder.Default
    private List<String> optionIds = new ArrayList<>();
    /** Typed answer (ONE_WORD, LONG_ANSWER); null for option questions. */
    private String answer;
    /** Numeric answer (NUMERIC); null otherwise. */
    private Double validAnswer;
}
