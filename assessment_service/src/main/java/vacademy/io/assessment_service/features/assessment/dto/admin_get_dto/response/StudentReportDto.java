package vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response;


import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.Date;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public interface StudentReportDto {
    String getAssessmentId();

    String getAssessmentName();

    String getAttemptId();

    Date getStartTime();

    Date getEndTime();

    String getAttemptStatus();

    Date getAttemptDate();

    Long getDurationInSeconds();

    Double getTotalMarks();

    String getSubjectId();

    String getAssessmentStatus();

    String getEvaluationType();

    String getPlayMode();

    String getReportReleaseStatus();

    /** When a released result's marks last changed (submission review "Revised" tag); null unless released. */
    Date getResultRevisedAt();

}
