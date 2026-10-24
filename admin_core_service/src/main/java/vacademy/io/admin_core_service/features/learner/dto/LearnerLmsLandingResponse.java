package vacademy.io.admin_core_service.features.learner.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Where a learner should be sent once their portal password has been changed, when their
 * coursework actually lives on a connected WordPress/LearnDash site rather than in Vacademy.
 *
 * <p>{@code connected == false} means "nothing to hand off to" - the caller keeps its normal
 * landing behaviour. Callers must treat a null {@code redirectUrl} the same way even when
 * connected, since a site can be connected without yielding a usable URL.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerLmsLandingResponse {

    /** True when at least one active enrolment resolves to a WordPress LMS connection. */
    private boolean connected;

    /** Absolute URL on the LMS site, or null when none could be built. */
    private String redirectUrl;

    /**
     * {@code AUTO_LOGIN} when the URL signs the learner in on arrival (produced by the
     * institute's GENERATE_ADMIN_LOGIN_URL_FOR_LEARNER_PORTAL workflow), {@code SITE_ROOT}
     * when it is just the site's front page and they will sign in there themselves with the
     * password they have only now set. Null when not connected.
     */
    private String redirectType;

    /** The enrolment the hand-off was resolved from, for support and logs. */
    private String packageSessionId;
    private String packageId;

    public static LearnerLmsLandingResponse notConnected() {
        return LearnerLmsLandingResponse.builder().connected(false).build();
    }
}
