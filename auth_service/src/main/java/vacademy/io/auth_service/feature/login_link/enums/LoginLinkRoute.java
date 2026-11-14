package vacademy.io.auth_service.feature.login_link.enums;

import java.util.Locale;
import java.util.Optional;

/**
 * The learner portal's passwordless landing routes. An institute that requires login codes
 * may let some of them keep signing learners in from the username alone (see
 * {@code institute_login_link_policy.code_free_routes}).
 *
 * <p>The route is reported by the learner app, so an exemption is a convenience switch, not a
 * security boundary: anyone can claim an exempt route. Exempting a route is as open as
 * switching the requirement off for logins that claim it.
 */
public enum LoginLinkRoute {
    /** /go/&lt;username&gt; - dashboard link. */
    GO,
    /** /study-library/live-class/&lt;username&gt; - live class link. */
    LIVE_CLASS,
    /** /subscriptions/&lt;username&gt; - manage / renew membership link. */
    SUBSCRIPTIONS,
    /** /sub-org-learners/&lt;username&gt; - sub-org admin link. */
    SUB_ORG_LEARNERS,
    /** /user-profile/edit/&lt;username&gt; - profile edit link. */
    PROFILE_EDIT;

    public static Optional<LoginLinkRoute> parse(String value) {
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(valueOf(value.trim().toUpperCase(Locale.ROOT)));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
