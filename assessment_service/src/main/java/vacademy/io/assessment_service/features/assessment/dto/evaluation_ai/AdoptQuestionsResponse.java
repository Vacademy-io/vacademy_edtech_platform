package vacademy.io.assessment_service.features.assessment.dto.evaluation_ai;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdoptQuestionsResponse {
        private String assessmentId;
        private int questionsMapped;
        private double totalMarks;
        /** Uploaded sheets that now carry a row per question and can be AI-checked. */
        private List<String> attemptIdsReady;
        /** Sheets a teacher had already graded by hand; left exactly as they were. */
        private int attemptsLeftAsGraded;
        /** Attempts still in progress; they get rows when they submit. */
        private int attemptsInProgress;
}
