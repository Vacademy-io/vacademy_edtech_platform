package vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

/**
 * The minimum a caller needs to say "this learner is enrolled in this batch".
 *
 * <p>Kept lean on purpose. The consumer is assessment_service's "not attempted yet"
 * list, which fetches the WHOLE enrolled set (see
 * {@code StudentSessionInstituteGroupMappingRepository#findEnrolledLearnersByPackageSessions}),
 * so every field here is paid for once per learner over the wire. The contact fields
 * exist because that list is exported to CSV so an admin can chase the learners who
 * never sat the test — chasing needs an email or a phone number. Adding anything beyond
 * that is not free: check the caller actually renders it first.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public interface BatchEnrolledLearnerDto {
    String getUserId();

    String getFullName();

    String getPackageSessionId();

    // Contact details, for the "not attempted" CSV export. All three are populated in
    // practice (16/16 on a sampled live batch), but treat them as optional anyway —
    // a learner added by CSV import can be missing any of them.
    String getEmail();

    String getMobileNumber();

    String getUsername();
}
