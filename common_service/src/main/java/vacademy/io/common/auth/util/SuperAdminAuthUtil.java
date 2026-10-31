package vacademy.io.common.auth.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Arrays;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

/**
 * Platform super-admin guard. Access is decided by a server-side allowlist of
 * auth user ids only — never by is_root_user, which is set for ordinary institute
 * admins and learners too.
 *
 * The list comes from the SUPER_ADMIN_USER_IDS env var (comma separated; entries are
 * trimmed), the same variable ai_service reads. Each entry must EXACTLY equal the
 * authenticated user's id ({@link CustomUserDetails#getUserId()}, i.e. auth_service
 * users.id), case included. Ids are immutable; usernames are not (users can rename
 * themselves), so the username is never consulted. Never case-fold or trim the user's
 * side. Put in the ids of the portal's PORTAL_ALLOWED_USERS accounts.
 *
 * The principal's id comes from a username lookup of the token subject, so when
 * JwtAuthFilter recorded the token's own signed "user" claim ({@link #JWT_USER_ID_ATTRIBUTE})
 * it must equal that id too: a token whose subject was later taken by another account
 * (rename) does not inherit that account's access.
 *
 * FAIL CLOSED: with the variable unset or empty, nobody passes.
 */
@Slf4j
public class SuperAdminAuthUtil {

    public static final String ALLOWLIST_ENV = "SUPER_ADMIN_USER_IDS";

    /** Request attribute JwtAuthFilter sets to the verified token's "user" claim (users.id at mint time). */
    public static final String JWT_USER_ID_ATTRIBUTE = "jwtUserId";

    private static final long MISSING_ALLOWLIST_LOG_INTERVAL_MS = 60_000L;
    private static final AtomicLong lastMissingAllowlistLogAt = new AtomicLong();

    private SuperAdminAuthUtil() {
    }

    public static void requireSuperAdmin(CustomUserDetails user) {
        requireSuperAdmin(user, System.getenv(ALLOWLIST_ENV), currentTokenUserId());
    }

    /**
     * True when this auth user id is on the allowlist (exact match). For refusing actions
     * that must never target platform staff, e.g. minting a learner token for them.
     * False when the list is unset.
     */
    public static boolean isSuperAdminUserId(String userId) {
        return isSuperAdminUserId(userId, System.getenv(ALLOWLIST_ENV));
    }

    static boolean isSuperAdminUserId(String userId, String rawAllowlist) {
        return userId != null && !userId.isEmpty() && parseAllowlist(rawAllowlist).contains(userId);
    }

    static void requireSuperAdmin(CustomUserDetails user, String rawAllowlist) {
        requireSuperAdmin(user, rawAllowlist, null);
    }

    static void requireSuperAdmin(CustomUserDetails user, String rawAllowlist, String tokenUserId) {
        Set<String> allowed = parseAllowlist(rawAllowlist);
        if (allowed.isEmpty()) {
            logMissingAllowlist();
            throw new VacademyException(HttpStatus.FORBIDDEN, "Super admin access required");
        }
        String userId = user == null ? null : user.getUserId();
        if (userId == null || userId.isEmpty() || !allowed.contains(userId)) {
            throw new VacademyException(HttpStatus.FORBIDDEN, "Super admin access required");
        }
        if (tokenUserId != null && !tokenUserId.equals(userId)) {
            log.warn("Super-admin request denied: token user claim does not match the resolved user id");
            throw new VacademyException(HttpStatus.FORBIDDEN, "Super admin access required");
        }
    }

    // Absent outside a request, or when the token carried no "user" claim: then only the
    // allowlist decides, as before.
    private static String currentTokenUserId() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes == null) {
            return null;
        }
        Object claim = attributes.getAttribute(JWT_USER_ID_ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
        return claim instanceof String ? (String) claim : null;
    }

    static Set<String> parseAllowlist(String rawAllowlist) {
        if (rawAllowlist == null || rawAllowlist.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(rawAllowlist.split(","))
                .map(String::trim)
                .filter(id -> !id.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }

    // At most one ERROR per minute: every super-admin call hits this while misconfigured.
    private static void logMissingAllowlist() {
        long now = System.currentTimeMillis();
        long last = lastMissingAllowlistLogAt.get();
        if (now - last >= MISSING_ALLOWLIST_LOG_INTERVAL_MS
                && lastMissingAllowlistLogAt.compareAndSet(last, now)) {
            log.error("{} is not set — denying every super-admin request. Set it to the auth "
                    + "user ids (users.id) of the portal's PORTAL_ALLOWED_USERS accounts.", ALLOWLIST_ENV);
        }
    }
}
