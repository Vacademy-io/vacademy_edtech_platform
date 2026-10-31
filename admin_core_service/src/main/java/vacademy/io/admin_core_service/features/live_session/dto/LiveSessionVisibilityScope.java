package vacademy.io.admin_core_service.features.live_session.dto;

import java.util.Set;

/**
 * The resolved live-session visibility of one caller in one institute.
 *
 * <p>{@code restricted = false} is the default and the legacy behaviour: no
 * predicate is applied and every query runs exactly as it did before V524.
 *
 * <p>When restricted, a session is visible iff any of:
 * <ol>
 *   <li>the caller created it, or</li>
 *   <li>one of its ACTIVE instructors is in {@link #allowedUserIds}, or</li>
 *   <li>it has no ACTIVE instructor and its creator is in {@link #allowedUserIds}
 *       — the creator-as-implicit-instructor fallback that keeps every
 *       pre-V524 session addressable without a backfill.</li>
 * </ol>
 *
 * <p>{@link #allowedUserIds} always contains {@link #callerUserId}, which also
 * keeps the generated {@code IN (:allowedUserIds)} from ever being empty —
 * an empty IN list is a syntax error in a native query.
 */
public record LiveSessionVisibilityScope(
        boolean restricted,
        String callerUserId,
        Set<String> allowedUserIds) {

    /** Unrestricted — what every role gets unless an admin configures otherwise. */
    public static LiveSessionVisibilityScope unrestricted(String callerUserId) {
        return new LiveSessionVisibilityScope(false, callerUserId, Set.of());
    }

    /**
     * The value bound into the native queries' {@code IN} clause. Never empty,
     * even when unrestricted (where the predicate is short-circuited by
     * {@code :restrictVisibility = FALSE} and the list is not consulted).
     */
    public Set<String> bindableUserIds() {
        if (allowedUserIds == null || allowedUserIds.isEmpty()) {
            return Set.of(callerUserId == null ? "" : callerUserId);
        }
        return allowedUserIds;
    }
}
