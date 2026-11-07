package vacademy.io.admin_core_service.features.live_session.enums;

/**
 * How much of the institute's live-session list a role may see (V524).
 *
 * <p>{@link #ALL} is the default for every role that has no explicit rule, and
 * reproduces the pre-V524 behaviour exactly: one institute-scoped list, no
 * filtering. An institute that never opens the new settings block sees no
 * change at all.
 */
public enum LiveSessionVisibilityModeEnum {

    /** Every session in the institute. The default, and the legacy behaviour. */
    ALL,

    /** Only sessions the caller created or is an instructor of. */
    OWN,

    /**
     * The caller's own sessions <b>plus</b> every session instructed by a user
     * holding one of the configured roles. Own sessions are always included so
     * an admin cannot accidentally configure a role out of seeing its own work.
     */
    SPECIFIC_ROLES
}
