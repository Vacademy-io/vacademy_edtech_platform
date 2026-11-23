package vacademy.io.auth_service.feature.sso.service;

import vacademy.io.auth_service.feature.sso.dto.SsoGroupRule;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Who may sign in through a connection and which batches they hold. Pure functions, no I/O.
 *
 * <p>Groups compare without case and surrounding spaces: Entra ID sends object ids, Okta and
 * Keycloak send names, and admins type them by hand.
 */
public final class SsoAccessPolicy {

    public static final String MODE_ALL = "ALL";
    public static final String MODE_GROUPS = "GROUPS";

    private SsoAccessPolicy() {
    }

    /** ALL lets everyone through; GROUPS needs at least one of {@code allowedGroups}. */
    public static boolean isAllowed(String accessMode, Collection<String> allowedGroups, Collection<String> userGroups) {
        if (!MODE_GROUPS.equalsIgnoreCase(accessMode)) {
            return true;
        }
        Set<String> allowed = normalise(allowedGroups);
        if (allowed.isEmpty()) {
            return false;
        }
        for (String group : normalise(userGroups)) {
            if (allowed.contains(group)) {
                return true;
            }
        }
        return false;
    }

    /** Batches everyone gets plus the batches of every rule whose group the user is in. */
    public static Set<String> desiredPackageSessions(Collection<String> defaults, List<SsoGroupRule> rules,
                                                     Collection<String> userGroups) {
        Set<String> desired = new LinkedHashSet<>(clean(defaults));
        if (rules != null) {
            Set<String> groups = normalise(userGroups);
            for (SsoGroupRule rule : rules) {
                if (rule == null || rule.getGroup() == null) {
                    continue;
                }
                if (groups.contains(norm(rule.getGroup()))) {
                    desired.addAll(clean(rule.getPackageSessionIds()));
                }
            }
        }
        return desired;
    }

    /** What to take away: batches this connection granted before and no longer wants. */
    public static Set<String> toRemove(Collection<String> previouslyGranted, Set<String> desired,
                                       boolean removeOnGroupLoss) {
        Set<String> remove = new LinkedHashSet<>();
        if (!removeOnGroupLoss) {
            return remove;
        }
        for (String id : clean(previouslyGranted)) {
            if (!desired.contains(id)) {
                remove.add(id);
            }
        }
        return remove;
    }

    /**
     * What to remember as granted after a sync: what was granted before, minus what admin-core
     * took away, plus what admin-core actually added. A batch the learner already held (paid, or
     * added by an admin) is never recorded, so losing a group never switches it off.
     */
    public static Set<String> grantedAfterSync(Collection<String> previouslyGranted, Collection<String> removed,
                                               Collection<String> added) {
        Set<String> granted = new LinkedHashSet<>(clean(previouslyGranted));
        granted.removeAll(clean(removed));
        granted.addAll(clean(added));
        return granted;
    }

    private static Set<String> normalise(Collection<String> values) {
        Set<String> out = new LinkedHashSet<>();
        if (values != null) {
            for (String value : values) {
                if (value != null && !value.isBlank()) {
                    out.add(norm(value));
                }
            }
        }
        return out;
    }

    private static Set<String> clean(Collection<String> values) {
        Set<String> out = new LinkedHashSet<>();
        if (values != null) {
            for (String value : values) {
                if (value != null && !value.isBlank()) {
                    out.add(value.trim());
                }
            }
        }
        return out;
    }

    private static String norm(String value) {
        return value.trim().toLowerCase(Locale.ROOT);
    }
}
