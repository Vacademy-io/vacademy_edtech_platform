package vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response;

import java.util.Date;

/**
 * Native-query projection for {@code StudentAttemptRepository.findCohortAttemptsBetween}:
 * one row per learner and assessment, the latest ENDED attempt in the window.
 */
public interface CohortAssessmentAttemptProjection {

    String getUserId();

    String getAssessmentId();

    String getAssessmentName();

    Date getAttemptAt();

    /** Earned / achievable marks as a percentage; null when it cannot be computed. */
    Double getPercentage();
}
