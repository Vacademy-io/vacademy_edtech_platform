package vacademy.io.assessment_service.features.assessment_dashboard.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One (learner, batch) enrolment from admin_core's
 * {@code /internal/learner/v1/enrollments-by-package-sessions}. Accepts both spellings of
 * each field for the same reason {@code EnrolledLearnerDto} does: a naming mismatch across
 * services fails silently as nulls, not as an error.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class BatchEnrollmentRow {

    @JsonProperty("user_id")
    @JsonAlias("userId")
    private String userId;

    @JsonProperty("package_session_id")
    @JsonAlias("packageSessionId")
    private String packageSessionId;

    /** yyyy-MM-dd, or null when the mapping has no date. */
    @JsonProperty("enrolled_date")
    @JsonAlias("enrolledDate")
    private String enrolledDate;

    @JsonProperty("full_name")
    @JsonAlias("fullName")
    private String fullName;

    @JsonProperty("email")
    private String email;

    @JsonProperty("mobile_number")
    @JsonAlias("mobileNumber")
    private String mobileNumber;
}
