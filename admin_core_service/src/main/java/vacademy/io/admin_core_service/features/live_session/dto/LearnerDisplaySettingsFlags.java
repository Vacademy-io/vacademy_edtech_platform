package vacademy.io.admin_core_service.features.live_session.dto;

/**
 * Institute-governed flags controlling what the learner "Past Sessions"
 * experience is allowed to show. Sourced from the {@code learnerDisplay}
 * block of the {@code LIVE_SESSION_SETTING} institute setting JSON
 * (see docs/LIVE_CLASS_PAST_SESSIONS_AND_CONTENT_LINKING_PLAN.md, section A1).
 *
 * All four flags default to {@code false} (opt-in) whenever the setting is
 * absent, malformed, or the institute has never configured it — this is a
 * server-side enforcement, not just a UI nicety, so a learner can never see
 * past-session data (or the more sensitive recordings/attendance/engagement
 * sub-blocks) by guessing the endpoint URL before an admin has opted in.
 *
 * {@code showUnassignedPublicSessions} is not a Past-tab flag: when on, a
 * PUBLIC class with no batch or learner attached is listed to every enrolled
 * learner of the institute (upcoming + past). See
 * {@link vacademy.io.admin_core_service.features.live_session.service.LearnerPublicSessionVisibilityService}.
 */
public record LearnerDisplaySettingsFlags(
        boolean showPastSessions,
        boolean showRecordings,
        boolean showAttendance,
        boolean showActivityStats,
        boolean showClassMaterials,
        boolean showUnassignedPublicSessions) {

    public static LearnerDisplaySettingsFlags allOff() {
        return new LearnerDisplaySettingsFlags(false, false, false, false, false, false);
    }
}
