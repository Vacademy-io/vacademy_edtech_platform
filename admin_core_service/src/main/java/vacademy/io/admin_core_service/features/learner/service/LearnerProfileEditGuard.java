package vacademy.io.admin_core_service.features.learner.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Who may edit a learner's profile through the learner-info routes (PUT /learner/info/v1/profile
 * and /edit), which take the target user id from the request.
 *
 * <p>Same rule as auth-service's {@code UserAccountAccessGuard}, decided from both users' role
 * rows as auth-service holds them (never from the token's root flag):
 * <ul>
 *   <li>the user themselves, or a platform super-admin: allowed;</li>
 *   <li>anyone else must be staff of an institute the target belongs to, and ADMIN of every
 *       institute where the target is staff. Staff means ADMIN, or COUNSELLOR, or holding only
 *       non-learner roles there: an admin or counsellor who is also enrolled as a learner stays
 *       staff (same as {@code InstituteAccessValidator}), while a learner given TEACHER by
 *       self-signup does not;</li>
 *   <li>changing the e-mail, mobile number or username that signs the target in additionally
 *       needs ADMIN of every institute the target belongs to, except one where the caller is
 *       staff and the target is a learner only;</li>
 *   <li>a password is only set here by the user themselves; staff use the existing reset
 *       password flow.</li>
 * </ul>
 */
@Component
public class LearnerProfileEditGuard {

    private static final Set<String> ADMIN_ROLE_ROWS = Set.of("ADMIN", "Admin");
    private static final Set<String> LEARNER_ROLES = Set.of("STUDENT", "PARENT", "GUARDIAN");
    /** Roles only an admin hands out, which keep a caller staff when they are also enrolled as a learner. */
    private static final Set<String> LEARNER_OVERRIDING_ROLES = Set.of("ADMIN", "COUNSELLOR");
    private static final Set<String> ACCESS_GRANTING_STATUSES = Set.of("ACTIVE", "INVITED");

    private final AuthService authService;

    public LearnerProfileEditGuard(AuthService authService) {
        this.authService = authService;
    }

    /**
     * @param requested the user details sent with the edit (may be null): its e-mail, mobile
     *                  number, username and password are compared with what the account holds
     */
    public void requireCanEdit(CustomUserDetails caller, String targetUserId, UserDTO requested) {
        if (caller == null || !StringUtils.hasText(caller.getUserId()) || !StringUtils.hasText(targetUserId)) {
            throw forbidden("You can only edit your own profile");
        }
        if (caller.getUserId().equals(targetUserId) || isSuperAdmin(caller)) {
            return;
        }
        if (requested != null && StringUtils.hasText(requested.getPassword())) {
            throw forbidden("A learner's password is changed with Reset password, not with a profile edit");
        }
        Memberships callerRoles = memberships(caller.getUserId());
        Memberships target = memberships(targetUserId);
        boolean staffWhereTargetBelongs = target.belongs.stream().anyMatch(callerRoles::isStaff);
        boolean adminWhereTargetIsStaff = target.staff.stream().allMatch(callerRoles::isAdmin);
        if (!staffWhereTargetBelongs || !adminWhereTargetIsStaff) {
            throw forbidden("You can only edit your own profile, or that of a learner of an institute you are staff of");
        }
        if (changesLoginIdentity(targetUserId, requested)) {
            boolean allowed = target.belongs.stream()
                    .filter(callerRoles::isStaff)
                    .anyMatch(here -> mayChangeLoginIdentity(callerRoles, target, here));
            if (!allowed) {
                throw forbidden("Only an admin of every institute this learner belongs to can change their email, mobile number or username");
            }
        }
    }

    /**
     * For a change made from one institute that applies to the whole account, wherever it is
     * used: its sign-in e-mail or mobile number, or its guardian link. Besides the user
     * themselves and a platform super-admin, the caller must be ADMIN of every institute the
     * account belongs to, except {@code instituteId} when the caller is staff there and the
     * account is a learner only there. An account with no institute role at all (a lead that
     * never enrolled) is only this institute's to change.
     *
     * @param refusal the message of the 403 when the change is not allowed
     */
    public void requireCanChangeAccountFrom(CustomUserDetails caller, String targetUserId, String instituteId,
                                            String refusal) {
        if (caller == null || !StringUtils.hasText(caller.getUserId()) || !StringUtils.hasText(targetUserId)
                || !StringUtils.hasText(instituteId)) {
            throw forbidden(refusal);
        }
        if (caller.getUserId().equals(targetUserId) || isSuperAdmin(caller)) {
            return;
        }
        Memberships callerRoles = memberships(caller.getUserId());
        Memberships target = memberships(targetUserId);
        boolean allowed = target.belongs.stream().allMatch(i ->
                (i.equals(instituteId) && !target.staff.contains(i) && callerRoles.isStaff(i))
                        || callerRoles.isAdmin(i));
        if (!allowed) {
            throw forbidden(refusal);
        }
    }

    /** Whether the user holds a role row (not DELETED) in {@code instituteId}. */
    public boolean belongsTo(String userId, String instituteId) {
        if (!StringUtils.hasText(userId) || !StringUtils.hasText(instituteId)) {
            return false;
        }
        return memberships(userId).belongs.contains(instituteId);
    }

    /** A non-blank e-mail, mobile number or username in the request that differs from the stored one. */
    private boolean changesLoginIdentity(String targetUserId, UserDTO requested) {
        if (requested == null) {
            return false;
        }
        boolean emailSent = StringUtils.hasText(requested.getEmail());
        boolean mobileSent = StringUtils.hasText(requested.getMobileNumber());
        boolean usernameSent = StringUtils.hasText(requested.getUsername());
        if (!emailSent && !mobileSent && !usernameSent) {
            return false;
        }
        UserDTO stored = null;
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(targetUserId));
            stored = users == null || users.isEmpty() ? null : users.get(0);
        } catch (Exception e) {
            // Unknown stored values: treat a sent value as a change.
        }
        if (stored == null) {
            return true;
        }
        boolean emailChanges = emailSent && !requested.getEmail().trim()
                .equalsIgnoreCase(stored.getEmail() == null ? "" : stored.getEmail().trim());
        boolean mobileChanges = mobileSent && !digits(requested.getMobileNumber()).equals(digits(stored.getMobileNumber()));
        boolean usernameChanges = usernameSent && !requested.getUsername().trim()
                .equalsIgnoreCase(stored.getUsername() == null ? "" : stored.getUsername().trim());
        return emailChanges || mobileChanges || usernameChanges;
    }

    private static String digits(String number) {
        return number == null ? "" : number.replaceAll("[^0-9]", "");
    }

    private static boolean mayChangeLoginIdentity(Memberships callerRoles, Memberships target, String instituteId) {
        return target.belongs.stream().allMatch(i ->
                (i.equals(instituteId) && !target.staff.contains(i)) || callerRoles.isAdmin(i));
    }

    private static boolean isSuperAdmin(CustomUserDetails caller) {
        try {
            SuperAdminAuthUtil.requireSuperAdmin(caller);
            return true;
        } catch (VacademyException e) {
            return false;
        }
    }

    /** Role rows from auth-service; a failed lookup refuses the edit rather than allowing it. */
    private Memberships memberships(String userId) {
        List<Map<String, String>> rows;
        try {
            rows = authService.getRoleMembershipsStrict(userId);
        } catch (Exception e) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Could not check access to this profile, please try again");
        }
        Memberships m = new Memberships();
        for (Map<String, String> row : rows == null ? List.<Map<String, String>>of() : rows) {
            if (row == null) {
                continue;
            }
            String institute = row.get("institute_id");
            String role = row.get("role_name");
            String status = row.get("status") == null ? "" : row.get("status").toUpperCase(Locale.ROOT);
            if (institute == null || role == null) {
                continue;
            }
            if (ACCESS_GRANTING_STATUSES.contains(status)) {
                m.activeRoleNames.computeIfAbsent(institute, k -> new HashSet<>()).add(role);
            }
            if (!"DELETED".equals(status)) {
                m.belongs.add(institute);
                if (!LEARNER_ROLES.contains(role.toUpperCase(Locale.ROOT))) {
                    m.staff.add(institute);
                }
            }
        }
        return m;
    }

    private static VacademyException forbidden(String message) {
        return new VacademyException(HttpStatus.FORBIDDEN, message);
    }

    /** Caller side: active role names per institute. Target side: where it belongs / is staff. */
    private static final class Memberships {
        final Map<String, Set<String>> activeRoleNames = new HashMap<>();
        final Set<String> belongs = new HashSet<>();
        final Set<String> staff = new HashSet<>();

        boolean isAdmin(String instituteId) {
            Set<String> names = activeRoleNames.get(instituteId);
            return names != null && names.stream().anyMatch(ADMIN_ROLE_ROWS::contains);
        }

        boolean isStaff(String instituteId) {
            if (isAdmin(instituteId)) {
                return true;
            }
            Set<String> names = activeRoleNames.get(instituteId);
            if (names == null || names.isEmpty()
                    || names.stream().allMatch(InstituteAccessValidator::isCommerceRoleName)) {
                return false;
            }
            boolean learner = names.stream().anyMatch(n -> LEARNER_ROLES.contains(n.toUpperCase(Locale.ROOT)));
            return !learner
                    || names.stream().anyMatch(n -> LEARNER_OVERRIDING_ROLES.contains(n.toUpperCase(Locale.ROOT)));
        }
    }
}
