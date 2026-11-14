package vacademy.io.assessment_service.features.assessment.dto.batch_pending;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One batch-enrolled learner, as returned by admin_core's
 * {@code /internal/learner/v1/enrolled-by-package-sessions}.
 *
 * <p>admin_core serialises the projection with SnakeCaseStrategy, so snake_case is the
 * expected wire form. Each field also accepts the camelCase spelling: this is a
 * cross-service contract, and if the two ever disagree the failure is silent — Jackson
 * leaves the fields null and the tab renders nameless rows instead of erroring. Accepting
 * both costs nothing and removes that failure mode entirely.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class EnrolledLearnerDto {

    @JsonProperty("user_id")
    @JsonAlias("userId")
    private String userId;

    @JsonProperty("full_name")
    @JsonAlias("fullName")
    private String fullName;

    @JsonProperty("package_session_id")
    @JsonAlias("packageSessionId")
    private String packageSessionId;

    // Contact details, carried only so the "not attempted" CSV can be used to chase the
    // learners who never sat the test. Any of them can be blank for a learner imported
    // without one, so the CSV must tolerate empty cells rather than skipping the row.
    @JsonProperty("email")
    private String email;

    @JsonProperty("mobile_number")
    @JsonAlias("mobileNumber")
    private String mobileNumber;

    @JsonProperty("username")
    private String username;

    /**
     * Identity only, no contact details — for callers (and tests) that care about who is
     * on the list rather than how to reach them. Kept explicit because widening
     * {@code @AllArgsConstructor} from three fields to six silently breaks every existing
     * three-arg call site.
     */
    public EnrolledLearnerDto(String userId, String fullName, String packageSessionId) {
        this(userId, fullName, packageSessionId, null, null, null);
    }
}
