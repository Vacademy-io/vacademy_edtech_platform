package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Result of editing a question from the library. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryQuestionEditResponse {
    /** The id the question now lives under. Differs from previous_question_id when a new version was made. */
    private String questionId;
    /** True when the question was used by an assessment, so the edit was saved as a new version. */
    private Boolean versioned;
    private String previousQuestionId;
    private Long assessmentCount;
}
