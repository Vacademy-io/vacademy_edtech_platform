package vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

/**
 * One (learner, batch) enrolment, for assessment_service's Assessment Dashboard.
 *
 * <p>Unlike {@link BatchEnrolledLearnerDto} this is one row per enrolment, not one per
 * learner. The dashboard works out each assessment's audience from the batches it was
 * assigned, so a learner sitting in two of the requested batches has to appear under
 * both; collapsing them to the lowest batch id would drop them from the other batch's
 * audience and report them as never having been set the test.
 *
 * <p>{@code enrolledDate} lets the caller leave out learners who joined a batch only
 * after a test had already closed. It is sent as {@code yyyy-MM-dd} text (cast in SQL),
 * so the wire format does not depend on how Jackson happens to render a SQL date.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public interface BatchEnrollmentRowDto {
    String getUserId();

    String getPackageSessionId();

    String getEnrolledDate();

    String getFullName();

    String getEmail();

    String getMobileNumber();
}
