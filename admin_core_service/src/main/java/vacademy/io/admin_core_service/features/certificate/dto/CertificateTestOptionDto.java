package vacademy.io.admin_core_service.features.certificate.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One quiz or assessment slide in a course, with its place in the course tree.
 * Feeds the test picker in the course certificate settings, and is the unit the
 * criteria evaluator scores.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CertificateTestOptionDto {
    private String slideId;
    private String title;
    /** QUIZ | ASSESSMENT. */
    private String type;
    /** Slide status: PUBLISHED, UNSYNC, DRAFT. Only PUBLISHED and UNSYNC count for learners. */
    private String status;
    private String subjectId;
    private String subjectName;
    private String moduleId;
    private String moduleName;
    private String chapterId;
    private String chapterName;
    /** The quiz's own pass %, when it has one. Always null for an assessment. */
    private Double ownPassPercent;
    /** ASSESSMENT only: the assessment-service assessment the slide launches. */
    private String assessmentId;
}
