package vacademy.io.assessment_service.features.assessment.dto;

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
public class SectionAddEditRequestDto {
    private String sectionDescriptionHtml;
    private String sectionName;
    private String sectionId;
    private Integer sectionDuration;
    private Integer sectionOrder;
    private Double totalMarks;
    private Double cutoffMarks;
    private Boolean problemRandomization;
    private List<QuestionAndMarking> questionAndMarking;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class QuestionAndMarking {
        private String questionId;
        private String markingJson;
        private Integer questionDurationInMin;
        private Integer questionOrder;
        private Boolean isAdded;
        private Boolean isDeleted;
        private Boolean isUpdated;
        // The question's evaluation criteria from the Add Questions step (rubric JSON) and the
        // template they came from. Null = not sent, leave the question's criteria as they are.
        private String evaluationCriteriaJson;
        private String criteriaTemplateId;
    }
}
