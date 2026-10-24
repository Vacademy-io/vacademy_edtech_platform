package vacademy.io.auth_service.feature.user.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.user.repository.UserInstituteRoleRepository;
import vacademy.io.auth_service.feature.user.repository.UserInstituteRoleRepository.InstituteRoleRow;
import vacademy.io.auth_service.feature.user.repository.UserInstituteRoleRepository.UserRoleRow;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.UserRoleService;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.stream.Collectors;

/**
 * Who may touch another user's account (credentials, email, profile) through the public
 * user endpoints, which take the target user id from the request.
 *
 * <p>Always allowed: the user themselves, and a platform super-admin
 * ({@link SuperAdminAuthUtil}). Otherwise the decision is made from both users' user_role
 * rows in the DB, never from the token's root flag or authorities (learners and invited staff
 * are root users, and the token's authorities belong to whatever clientId the caller sent).
 *
 * <p>Vocabulary, per institute:
 * <ul>
 *   <li>caller is ADMIN: holds an ACTIVE/INVITED "ADMIN" (or legacy "Admin") row there;</li>
 *   <li>caller is staff: ADMIN, or holds ACTIVE/INVITED rows there none of which is a learner
 *       role (STUDENT/PARENT/GUARDIAN). A self-signed-up learner given [STUDENT, TEACHER] is
 *       therefore not staff — same rule as admin_core's {@code InstituteAccessValidator};</li>
 *   <li>target belongs: has a role row there that is not DELETED;</li>
 *   <li>target is ADMIN / staff: holds an ADMIN / non-learner row there that is not DELETED.</li>
 * </ul>
 *
 * <p>A login (username + password, or the email / mobile number used for OTP login) may be
 * managed by staff of an institute the target belongs to, but only by an ADMIN wherever the
 * target is staff: non-ADMIN staff reach learner-only accounts, never a colleague's.
 */
@Component
public class UserAccountAccessGuard {

    private static final Set<String> ADMIN_ROLE_ROWS = Set.of("ADMIN", "Admin");
    private static final Set<String> LEARNER_ROLES = Set.of("STUDENT", "PARENT", "GUARDIAN");

    private final UserInstituteRoleRepository userInstituteRoleRepository;

    public UserAccountAccessGuard(UserInstituteRoleRepository userInstituteRoleRepository) {
        this.userInstituteRoleRepository = userInstituteRoleRepository;
    }

    /**
     * PUT /user-details/update-user (username, password, profile). Besides self / super-admin:
     * an ADMIN of an institute the target belongs to, who is also ADMIN of every institute
     * where the target is staff — so no admin can take over another institute's staff account.
     */
    public void requireCanEditAccount(CustomUserDetails caller, String targetUserId) {
        if (isSelfOrSuperAdmin(caller, targetUserId)) {
            return;
        }
        Memberships callerRoles = callerMemberships(caller);
        Memberships target = targetMemberships(rows(targetUserId));
        boolean sharedAdmin = target.belongs.stream().anyMatch(callerRoles::isAdmin);
        boolean staffElsewhere = target.staff.stream().anyMatch(i -> !callerRoles.isAdmin(i));
        if (!sharedAdmin || staffElsewhere) {
            throw forbidden("You can only change your own account, or that of a member of an institute you administer");
        }
    }

    /**
     * GET /user/user-credentials/{userId} (returns the stored password). Besides self /
     * super-admin: staff of an institute the target belongs to (the admin dashboard shows
     * learner and guardian logins to teachers and custom roles too), who is ADMIN wherever the
     * target is staff.
     */
    public void requireCanViewCredentials(CustomUserDetails caller, String targetUserId) {
        if (isSelfOrSuperAdmin(caller, targetUserId)) {
            return;
        }
        if (!canManageLogin(callerMemberships(caller), targetMemberships(rows(targetUserId)))) {
            throw forbidden("You cannot view this user's login details");
        }
    }

    /**
     * POST /user-operation/update-password (sets username / password and mails them to the
     * user). Same rule as viewing them.
     */
    public void requireCanChangeCredentials(CustomUserDetails caller, String targetUserId) {
        if (isSelfOrSuperAdmin(caller, targetUserId)) {
            return;
        }
        if (!canManageLogin(callerMemberships(caller), targetMemberships(rows(targetUserId)))) {
            throw forbidden("You cannot change this user's login details");
        }
    }

    /**
     * Of {@code targetUserIds}, the ones whose stored password the caller may see (same rule
     * as {@link #requireCanViewCredentials}), from two queries whatever the list size. Used by
     * the bulk credential read and the Teams listing to leave out the rest.
     */
    public Set<String> loginsCallerMayView(CustomUserDetails caller, Collection<String> targetUserIds) {
        if (targetUserIds == null || targetUserIds.isEmpty() || caller == null || caller.getUserId() == null) {
            return Set.of();
        }
        Set<String> ids = targetUserIds.stream().filter(Objects::nonNull).collect(Collectors.toCollection(LinkedHashSet::new));
        if (ids.isEmpty()) {
            return Set.of();
        }
        if (isSuperAdmin(caller)) {
            return ids;
        }
        Memberships callerRoles = callerMemberships(caller);
        List<UserRoleRow> all = userInstituteRoleRepository.findInstituteRolesByUserIds(ids);
        Map<String, List<InstituteRoleRow>> byUser = new HashMap<>();
        if (all != null) {
            for (UserRoleRow row : all) {
                byUser.computeIfAbsent(row.getUserId(), k -> new ArrayList<>()).add(row);
            }
        }
        Set<String> allowed = new HashSet<>();
        for (String id : ids) {
            if (id.equals(caller.getUserId())
                    || canManageLogin(callerRoles, targetMemberships(byUser.getOrDefault(id, List.of())))) {
                allowed.add(id);
            }
        }
        return allowed;
    }

    /**
     * PUT /user-invitation/update (name, email, roles in {@code instituteId}; then mails the
     * user's username and password to the — possibly new — email). Besides super-admin: staff
     * of {@code instituteId} that the target belongs to; ADMIN of it when the target is ADMIN
     * there; and an email change only as {@link #mayChangeLoginIdentity} allows, because the
     * email is the account's global identity and the reminder carries its password.
     * {@code emailChanges} is evaluated only after the membership checks, so an outsider cannot
     * use the endpoint to learn which user ids exist.
     */
    public void requireCanUpdateInvitation(CustomUserDetails caller, String instituteId, String targetUserId,
                                           BooleanSupplier emailChanges) {
        if (isSuperAdmin(caller)) {
            return;
        }
        Memberships callerRoles = callerMemberships(requireCaller(caller, "Only staff of this institute can update an invitation"));
        if (isBlank(instituteId) || isBlank(targetUserId)) {
            throw forbidden("Only staff of this institute can update an invitation");
        }
        Memberships target = targetMemberships(rows(targetUserId));
        if (!callerRoles.isStaff(instituteId) || !target.belongs.contains(instituteId)) {
            throw forbidden("Only staff of this institute can update an invitation");
        }
        if (target.admin.contains(instituteId) && !callerRoles.isAdmin(instituteId)) {
            throw forbidden("Only an admin of this institute can update an admin's invitation");
        }
        if (!mayChangeLoginIdentity(callerRoles, target, instituteId) && emailChanges.getAsBoolean()) {
            throw forbidden("Only an admin of every institute this user belongs to can change their email");
        }
    }

    /**
     * POST /user-invitation/resend-invitation (emails the member their login details, branded
     * as {@code instituteId}). Besides super-admin: staff of {@code instituteId} that the target
     * belongs to, and ADMIN of it when the target is ADMIN there — the same rule as updating an
     * invitation, minus the email change. The mail only ever goes to the member's own address.
     */
    public void requireCanResendLogin(CustomUserDetails caller, String instituteId, String targetUserId) {
        if (isSuperAdmin(caller)) {
            return;
        }
        Memberships callerRoles = callerMemberships(requireCaller(caller, "Only staff of this institute can resend login details"));
        if (isBlank(instituteId) || isBlank(targetUserId)) {
            throw forbidden("Only staff of this institute can resend login details");
        }
        Memberships target = targetMemberships(rows(targetUserId));
        if (!callerRoles.isStaff(instituteId) || !target.belongs.contains(instituteId)) {
            throw forbidden("Only staff of this institute can resend login details");
        }
        if (target.admin.contains(instituteId) && !callerRoles.isAdmin(instituteId)) {
            throw forbidden("Only an admin of this institute can resend an admin's login details");
        }
    }

    /**
     * POST /user-details/update?userId=&instituteId= (profile incl. email and mobile number,
     * plus role rows added / marked DELETED in {@code instituteId}).
     * <ul>
     *   <li>super-admin: anything;</li>
     *   <li>the user themselves: their own profile; adding roles needs staff of
     *       {@code instituteId} (no joining an institute as staff by editing yourself), and only
     *       their own rows of {@code instituteId} may be deleted;</li>
     *   <li>anyone else: staff of {@code instituteId} that the target belongs to, ADMIN of it
     *       when the target is ADMIN there, only the target's rows of {@code instituteId} may be
     *       deleted, and an email / mobile change only as {@link #mayChangeLoginIdentity} allows.</li>
     * </ul>
     * Granting ADMIN is checked separately by {@link AdminRoleGrantGuard}.
     */
    public void requireCanUpdateDetails(CustomUserDetails caller, String instituteId, String targetUserId,
                                        BooleanSupplier loginIdentityChanges, Collection<String> addRoleNames,
                                        Collection<String> deleteUserRoleIds) {
        if (isSuperAdmin(caller)) {
            return;
        }
        Memberships callerRoles = callerMemberships(requireCaller(caller, "You cannot update this user"));
        if (isBlank(instituteId) || isBlank(targetUserId)) {
            throw forbidden("You cannot update this user");
        }
        boolean self = caller.getUserId().equals(targetUserId);
        if (self) {
            if (addRoleNames != null && !addRoleNames.isEmpty() && !callerRoles.isStaff(instituteId)) {
                throw forbidden("Only staff of this institute can add roles");
            }
        } else {
            Memberships target = targetMemberships(rows(targetUserId));
            if (!callerRoles.isStaff(instituteId) || !target.belongs.contains(instituteId)) {
                throw forbidden("Only staff of this institute can update its members");
            }
            if (target.admin.contains(instituteId) && !callerRoles.isAdmin(instituteId)) {
                throw forbidden("Only an admin of this institute can update an admin");
            }
            if (!mayChangeLoginIdentity(callerRoles, target, instituteId) && loginIdentityChanges.getAsBoolean()) {
                throw forbidden("Only an admin of every institute this user belongs to can change their email or mobile number");
            }
        }
        if (deleteUserRoleIds != null && !deleteUserRoleIds.isEmpty()) {
            Set<String> ids = deleteUserRoleIds.stream().filter(Objects::nonNull).collect(Collectors.toSet());
            List<UserRoleRow> found = ids.isEmpty() ? List.of() : userInstituteRoleRepository.findRowsByIds(ids);
            boolean foreign = found == null || found.size() != ids.size() || found.stream().anyMatch(r ->
                    !targetUserId.equals(r.getUserId()) || !instituteId.equals(r.getInstituteId()));
            if (foreign) {
                throw forbidden("Only this user's roles in this institute can be removed");
            }
        }
    }

    /** POST /user-roles/add-user-roles and /user-invitation/invite: staff of {@code instituteId} (or super-admin). */
    public void requireStaffOf(CustomUserDetails caller, String instituteId) {
        if (isSuperAdmin(caller)) {
            return;
        }
        Memberships callerRoles = callerMemberships(requireCaller(caller, "Only staff of this institute can do this"));
        if (isBlank(instituteId) || !callerRoles.isStaff(instituteId)) {
            throw forbidden("Only staff of this institute can do this");
        }
    }

    /**
     * PUT /user-roles/update-role-status (enable / disable / delete members of {@code instituteId}).
     * Besides super-admin: a member DELETING only their own rows (the learner app's "delete my
     * account" sends the caller's own id with status DELETED) — any other self change, e.g. a
     * member disabled here re-activating themselves, is not allowed; otherwise staff of
     * {@code instituteId}, and ADMIN of it when any target is ADMIN there (same rule as
     * {@link #requireCanUpdateDetails}).
     */
    public void requireCanChangeRoleStatus(CustomUserDetails caller, String instituteId, Collection<String> userIds,
                                           String newStatus) {
        if (isSuperAdmin(caller)) {
            return;
        }
        CustomUserDetails who = requireCaller(caller, "Only staff of this institute can change a member's access");
        if (isBlank(instituteId) || userIds == null || userIds.isEmpty()) {
            throw forbidden("Only staff of this institute can change a member's access");
        }
        if (UserRoleStatus.DELETED.name().equals(newStatus) && userIds.stream().allMatch(who.getUserId()::equals)) {
            return;
        }
        Memberships callerRoles = callerMemberships(who);
        if (!callerRoles.isStaff(instituteId)) {
            throw forbidden("Only staff of this institute can change a member's access");
        }
        if (callerRoles.isAdmin(instituteId)) {
            return;
        }
        for (String target : new LinkedHashSet<>(userIds)) {
            if (target != null && targetMemberships(rows(target)).admin.contains(instituteId)) {
                throw forbidden("Only an admin of this institute can change an admin's access");
            }
        }
    }

    /**
     * ADMIN of {@code instituteId} (or super-admin): an ACTIVE/INVITED "ADMIN" (or legacy "Admin")
     * row there. For changes that shape what other members may do, e.g. a custom role's permissions.
     */
    public void requireAdminOf(CustomUserDetails caller, String instituteId) {
        if (!isAdminOf(caller, instituteId)) {
            throw forbidden("Only an admin of this institute can do this");
        }
    }

    /** Non-throwing form of {@link #requireAdminOf}. */
    public boolean isAdminOf(CustomUserDetails caller, String instituteId) {
        if (isSuperAdmin(caller)) {
            return true;
        }
        if (caller == null || caller.getUserId() == null || isBlank(instituteId)) {
            return false;
        }
        return callerMemberships(caller).isAdmin(instituteId);
    }

    /**
     * Any ACTIVE/INVITED role in {@code instituteId}, learner roles included (or super-admin).
     * For reads that only need to keep one institute's data away from outsiders.
     */
    public void requireMemberOf(CustomUserDetails caller, String instituteId) {
        if (isSuperAdmin(caller)) {
            return;
        }
        Memberships callerRoles = callerMemberships(requireCaller(caller, "You do not belong to this institute"));
        if (isBlank(instituteId) || !callerRoles.callerRoleNames.containsKey(instituteId)) {
            throw forbidden("You do not belong to this institute");
        }
    }

    /** Staff of an institute the target belongs to, and ADMIN wherever the target is staff. */
    private static boolean canManageLogin(Memberships callerRoles, Memberships target) {
        return target.belongs.stream().anyMatch(callerRoles::isStaff)
                && target.staff.stream().allMatch(callerRoles::isAdmin);
    }

    /**
     * Moving the email / mobile number that logs the target in: ADMIN of every institute the
     * target belongs to, except that staff of {@code instituteId} (already checked by the
     * caller) suffice there when the target is a learner only there.
     */
    private static boolean mayChangeLoginIdentity(Memberships callerRoles, Memberships target, String instituteId) {
        return target.belongs.stream().allMatch(i ->
                (i.equals(instituteId) && !target.staff.contains(i)) || callerRoles.isAdmin(i));
    }

    private static CustomUserDetails requireCaller(CustomUserDetails caller, String message) {
        if (caller == null || caller.getUserId() == null) {
            throw forbidden(message);
        }
        return caller;
    }

    private boolean isSelfOrSuperAdmin(CustomUserDetails caller, String targetUserId) {
        if (caller == null || caller.getUserId() == null || isBlank(targetUserId)) {
            throw forbidden("Access denied");
        }
        return caller.getUserId().equals(targetUserId) || isSuperAdmin(caller);
    }

    private static boolean isSuperAdmin(CustomUserDetails caller) {
        try {
            SuperAdminAuthUtil.requireSuperAdmin(caller);
            return true;
        } catch (VacademyException e) {
            return false;
        }
    }

    private Memberships callerMemberships(CustomUserDetails caller) {
        Memberships m = new Memberships();
        for (InstituteRoleRow row : rows(caller.getUserId())) {
            if (row.getRoleName() == null
                    || !UserRoleService.ACCESS_GRANTING_STATUSES.contains(row.getStatus())) {
                continue;
            }
            m.callerRoleNames.computeIfAbsent(row.getInstituteId(), k -> new HashSet<>()).add(row.getRoleName());
        }
        return m;
    }

    private static Memberships targetMemberships(List<? extends InstituteRoleRow> targetRows) {
        Memberships m = new Memberships();
        for (InstituteRoleRow row : targetRows) {
            String institute = row.getInstituteId();
            if (row.getRoleName() == null || UserRoleStatus.DELETED.name().equals(row.getStatus())) {
                continue;
            }
            m.belongs.add(institute);
            if (ADMIN_ROLE_ROWS.contains(row.getRoleName())) {
                m.admin.add(institute);
            }
            if (!LEARNER_ROLES.contains(row.getRoleName().toUpperCase(Locale.ROOT))) {
                m.staff.add(institute);
            }
        }
        return m;
    }

    private List<InstituteRoleRow> rows(String userId) {
        List<InstituteRoleRow> rows = userInstituteRoleRepository.findInstituteRolesByUserId(userId);
        return rows == null ? List.of() : rows;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static VacademyException forbidden(String message) {
        return new VacademyException(HttpStatus.FORBIDDEN, message);
    }

    /** Caller side: access-granting role names per institute. Target side: the three sets. */
    private static final class Memberships {
        final Map<String, Set<String>> callerRoleNames = new HashMap<>();
        final Set<String> belongs = new HashSet<>();
        final Set<String> admin = new HashSet<>();
        final Set<String> staff = new HashSet<>();

        boolean isAdmin(String instituteId) {
            Set<String> names = callerRoleNames.get(instituteId);
            return names != null && names.stream().anyMatch(ADMIN_ROLE_ROWS::contains);
        }

        boolean isStaff(String instituteId) {
            if (isAdmin(instituteId)) {
                return true;
            }
            Set<String> names = callerRoleNames.get(instituteId);
            return names != null && !names.isEmpty()
                    && names.stream().noneMatch(n -> LEARNER_ROLES.contains(n.toUpperCase(Locale.ROOT)));
        }
    }
}
