package vacademy.io.assessment_service.features.open_evaluation.policy;

import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;

/**
 * "Is this an API exam / an API candidate?" — the one check every no-email, no-spam rule
 * for the partner API goes through (spec section 12, items 1-7).
 *
 * <ul>
 *   <li>An <b>API exam</b> is an assessment with {@code source = 'API'}.</li>
 *   <li>An <b>API candidate</b> is a registration whose {@code source_id} starts with
 *       {@code apikey:} (the facade writes {@code apikey:{key_id}}), or whose user id is a
 *       synthetic {@code apic_…} id. Such a user has no login and no email; nothing may be
 *       sent to them.</li>
 * </ul>
 *
 * Pure functions on entities; null-safe everywhere, because these run inside notification
 * and workflow paths that must never throw.
 */
public final class ApiCandidatePolicy {

    /** {@code assessment.source} of exams created through the partner API. */
    public static final String SOURCE_API = "API";
    /** Prefix of the registration {@code source_id} the facade writes. */
    public static final String API_ACTOR_PREFIX = "apikey:";
    /** Prefix of the synthetic user id of an API candidate. */
    public static final String API_CANDIDATE_USER_PREFIX = "apic_";

    private ApiCandidatePolicy() {
    }

    public static boolean isApiExam(Assessment assessment) {
        return assessment != null && SOURCE_API.equals(assessment.getSource());
    }

    public static boolean isApi(AssessmentUserRegistration registration) {
        if (registration == null) {
            return false;
        }
        String sourceId = registration.getSourceId();
        if (sourceId != null && sourceId.startsWith(API_ACTOR_PREFIX)) {
            return true;
        }
        return isApiCandidateUserId(registration.getUserId());
    }

    public static boolean isApiCandidateUserId(String userId) {
        return userId != null && userId.startsWith(API_CANDIDATE_USER_PREFIX);
    }

    /** The attempt belongs to an API candidate. */
    public static boolean isApi(StudentAttempt attempt) {
        try {
            return attempt != null && isApi(attempt.getRegistration());
        } catch (RuntimeException lazyLoadFailure) {
            return false;
        }
    }

    /** The attempt's exam is an API exam. */
    public static boolean isOnApiExam(StudentAttempt attempt) {
        try {
            return attempt != null && attempt.getRegistration() != null
                    && isApiExam(attempt.getRegistration().getAssessment());
        } catch (RuntimeException lazyLoadFailure) {
            return false;
        }
    }

    /**
     * Whether a learner-facing message (report email, reminder, "assessment started") may
     * go to this registration: never for an API candidate, never to a blank address.
     */
    public static boolean mayMessage(AssessmentUserRegistration registration) {
        return registration != null && !isApi(registration) && StringUtils.hasText(registration.getUserEmail());
    }

    /**
     * Whether institute workflow events (ASSESSMENT_CREATE, _PUBLISHED, _END,
     * _RESULT_RELEASED, AI evaluation completed …) may fire for this assessment: always for
     * dashboard exams; for API exams only when the institute opted in with
     * {@code institute_api_access.fire_workflow_events} (spec 12 item 6). Those automations
     * would otherwise message {@code apic_} candidates that have blank channels.
     *
     * @param flags may be null (tests, early boot): an API exam is then suppressed.
     */
    public static boolean workflowEventsAllowed(Assessment assessment, String instituteId, ApiInstituteFlags flags) {
        if (!isApiExam(assessment)) {
            return true;
        }
        return flags != null && flags.fireWorkflowEvents(instituteId);
    }
}
