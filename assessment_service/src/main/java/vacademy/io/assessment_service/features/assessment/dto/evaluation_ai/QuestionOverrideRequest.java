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
 * Teacher override of a single AI-graded question on the review page:
 * adjusted marks and/or edited feedback before the result is released.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class QuestionOverrideRequest {
    private Double marksAwarded;
    private String feedback;

    /**
     * The teacher's changes to the pen notes the AI wrote on the copy for this
     * question, the whole current list (it replaces the saved one). Null leaves the
     * saved list as it is; an empty list clears it. Applied the next time the checked
     * copy is re-drawn.
     */
    private List<AnnotationEdit> annotationEdits;

    /** One pen note, named by the fields it was stored with, and what to do with it. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class AnnotationEdit {
        private String style;
        private String target;
        private String pageId;
        private String text;
        /** DELETE (leave it off the copy) or EDIT (write newText instead). */
        private String action;
        private String newText;
    }
}
