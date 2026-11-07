package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** The copies made for the caller, in the order they should appear in the section. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryCopyResponse {
    private List<CopiedQuestion> copied;
    /** Skipped because the section already has a copy of them. */
    private Integer alreadyInSection;
    /** Could not be copied, for example a question saved without a usable answer key. */
    private Integer failed;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CopiedQuestion {
        private String sourceQuestionId;
        private String questionId;
        private String questionType;
        private String text;
    }
}
