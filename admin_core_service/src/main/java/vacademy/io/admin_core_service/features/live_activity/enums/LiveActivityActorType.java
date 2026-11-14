package vacademy.io.admin_core_service.features.live_activity.enums;

/**
 * Who performed the activity. The spread here is the reason this feature cannot live in
 * {@code admin_activity_log}: only a minority of these events have an admin actor at all,
 * and several (webhook threads, scheduled renewal charges) have no HTTP request context.
 */
public enum LiveActivityActorType {
    PROSPECT,
    LEARNER,
    COUNSELLOR,
    ADMIN,
    AI,
    SYSTEM
}
