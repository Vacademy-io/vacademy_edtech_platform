package vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

/**
 * One (learner, batch) enrolment with the institute enrollment number recorded on it.
 * A learner in two batches comes back twice, possibly with two different numbers; the
 * caller decides which one applies (assessment_service prefers the batch the
 * assessment was assigned to).
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public interface EnrollmentNumberRowDto {
    String getUserId();

    String getPackageSessionId();

    String getInstituteEnrollmentNumber();
}
