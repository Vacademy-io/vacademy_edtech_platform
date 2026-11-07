package vacademy.io.auth_service.feature.user.service;

import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.user.repository.UserInstituteRoleRepository;
import vacademy.io.auth_service.feature.user.repository.UserInstituteRoleRepository.InstituteRoleRow;
import vacademy.io.auth_service.feature.user.repository.UserInstituteRoleRepository.UserRoleRow;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * update-user, user-credentials and user-invitation/update took the target user id from the
 * request and let any signed-in user change or read anyone's username, password and email.
 * Callers are non-root here, so nothing passes as a super-admin whichever SuperAdminAuthUtil
 * (root flag or allowlist) is on the classpath.
 */
class UserAccountAccessGuardTest {

    private static final String A = "inst-a";
    private static final String B = "inst-b";

    private final UserInstituteRoleRepository repo = mock(UserInstituteRoleRepository.class);
    private final UserAccountAccessGuard guard = new UserAccountAccessGuard(repo);
    private final Map<String, List<InstituteRoleRow>> rows = new HashMap<>();
    private final Map<String, UserRoleRow> rowsById = new HashMap<>();

    @SuppressWarnings("unchecked")
    UserAccountAccessGuardTest() {
        when(repo.findInstituteRolesByUserId(anyString()))
                .thenAnswer(inv -> rows.getOrDefault(inv.getArgument(0, String.class), List.of()));
        when(repo.findInstituteRolesByUserIds(any())).thenAnswer(inv -> {
            List<UserRoleRow> out = new ArrayList<>();
            for (String id : (Collection<String>) inv.getArgument(0)) {
                rows.getOrDefault(id, List.of()).forEach(r -> out.add((UserRoleRow) r));
            }
            return out;
        });
        when(repo.findRowsByIds(any())).thenAnswer(inv -> ((Collection<String>) inv.getArgument(0)).stream()
                .filter(rowsById::containsKey).map(rowsById::get).toList());
    }

    /** Adds a role row and returns its user_role id. */
    private String role(String userId, String institute, String roleName, String status) {
        String rowId = "row-" + rowsById.size();
        UserRoleRow row = new UserRoleRow() {
            public String getId() { return rowId; }
            public String getUserId() { return userId; }
            public String getInstituteId() { return institute; }
            public String getRoleName() { return roleName; }
            public String getStatus() { return status; }
        };
        rows.computeIfAbsent(userId, k -> new ArrayList<>()).add(row);
        rowsById.put(rowId, row);
        return rowId;
    }

    private String role(String userId, String institute, String roleName) {
        return role(userId, institute, roleName, "ACTIVE");
    }

    private static CustomUserDetails caller(String userId) {
        User user = new User();
        user.setId(userId);
        user.setUsername(userId);
        user.setRootUser(false);
        return new CustomUserDetails(user, A, List.of());
    }

    // ---- update-user --------------------------------------------------------------

    @Test
    void anyoneMayEditTheirOwnAccount() {
        assertDoesNotThrow(() -> guard.requireCanEditAccount(caller("learner"), "learner"));
    }

    @Test
    void learnerCannotEditAnotherUser() {
        role("learner", A, "STUDENT");
        role("victim", A, "STUDENT");
        assertThrows(VacademyException.class, () -> guard.requireCanEditAccount(caller("learner"), "victim"));
    }

    @Test
    void teacherCannotEditAnotherUsersAccount() {
        role("teacher", A, "TEACHER");
        role("learner", A, "STUDENT");
        assertThrows(VacademyException.class, () -> guard.requireCanEditAccount(caller("teacher"), "learner"));
    }

    @Test
    void adminMayEditALearnerOfTheirInstitute() {
        role("admin", A, "ADMIN");
        role("learner", A, "STUDENT");
        role("learner", B, "STUDENT");
        assertDoesNotThrow(() -> guard.requireCanEditAccount(caller("admin"), "learner"));
    }

    @Test
    void adminCannotEditAUserOfAnotherInstitute() {
        role("admin", A, "ADMIN");
        role("victim", B, "STUDENT");
        assertThrows(VacademyException.class, () -> guard.requireCanEditAccount(caller("admin"), "victim"));
    }

    @Test
    void adminCannotEditSomeoneWhoIsAdminOfAnotherInstitute() {
        role("admin", A, "ADMIN");
        role("victim", A, "STUDENT");
        role("victim", B, "ADMIN");
        assertThrows(VacademyException.class, () -> guard.requireCanEditAccount(caller("admin"), "victim"));
    }

    @Test
    void disabledAdminRowGrantsNothing() {
        role("admin", A, "ADMIN", "DISABLED");
        role("learner", A, "STUDENT");
        assertThrows(VacademyException.class, () -> guard.requireCanEditAccount(caller("admin"), "learner"));
    }

    @Test
    void deletedStaffRowElsewhereDoesNotBlock() {
        role("admin", A, "ADMIN");
        role("learner", A, "STUDENT");
        role("learner", B, "ADMIN", "DELETED");
        assertDoesNotThrow(() -> guard.requireCanEditAccount(caller("admin"), "learner"));
    }

    // ---- user-credentials ---------------------------------------------------------

    @Test
    void teacherAndCustomRoleMayViewALearnersLogin() {
        role("teacher", A, "TEACHER");
        role("counsellor", A, "Counsellor");
        role("learner", A, "STUDENT");
        role("guardian", A, "PARENT");
        assertDoesNotThrow(() -> guard.requireCanViewCredentials(caller("teacher"), "learner"));
        assertDoesNotThrow(() -> guard.requireCanViewCredentials(caller("counsellor"), "guardian"));
    }

    @Test
    void learnerWhoCanCreateCoursesIsNotStaff() {
        role("selfsignup", A, "STUDENT");
        role("selfsignup", A, "TEACHER");
        role("learner", A, "STUDENT");
        assertThrows(VacademyException.class,
                () -> guard.requireCanViewCredentials(caller("selfsignup"), "learner"));
    }

    @Test
    void nobodyButAnAdminSeesAnAdminsPassword() {
        role("teacher", A, "TEACHER");
        role("admin", A, "ADMIN");
        role("admin2", A, "ADMIN");
        assertThrows(VacademyException.class, () -> guard.requireCanViewCredentials(caller("teacher"), "admin2"));
        assertDoesNotThrow(() -> guard.requireCanViewCredentials(caller("admin"), "admin2"));
    }

    @Test
    void staffCannotViewALoginThatIsStaffOfAnotherInstitute() {
        role("admin", A, "ADMIN");
        role("victim", A, "STUDENT");
        role("victim", B, "TEACHER");
        assertThrows(VacademyException.class, () -> guard.requireCanViewCredentials(caller("admin"), "victim"));
    }

    @Test
    void strangerCannotViewCredentials() {
        role("admin", B, "ADMIN");
        role("learner", A, "STUDENT");
        assertThrows(VacademyException.class, () -> guard.requireCanViewCredentials(caller("admin"), "learner"));
    }

    // ---- user-invitation/update ---------------------------------------------------

    @Test
    void staffMayEditAnInviteButOnlyAnAdminMayMoveAColleaguesEmail() {
        role("teacher", A, "TEACHER");
        role("admin", A, "ADMIN");
        role("invitee", A, "TEACHER", "INVITED");
        assertDoesNotThrow(() -> guard.requireCanUpdateInvitation(caller("teacher"), A, "invitee", () -> false));
        // The reminder mails the colleague's password to the new address.
        assertThrows(VacademyException.class,
                () -> guard.requireCanUpdateInvitation(caller("teacher"), A, "invitee", () -> true));
        assertDoesNotThrow(() -> guard.requireCanUpdateInvitation(caller("admin"), A, "invitee", () -> true));
    }

    @Test
    void outsiderLearnsNothingAboutTheTargetsEmail() {
        role("learner", A, "STUDENT");
        role("invitee", A, "TEACHER", "INVITED");
        AtomicBoolean asked = new AtomicBoolean();
        assertThrows(VacademyException.class, () -> guard.requireCanUpdateInvitation(caller("learner"), A, "invitee",
                () -> { asked.set(true); return true; }));
        assertFalse(asked.get());
    }

    @Test
    void learnerCannotUpdateAnInvitation() {
        role("learner", A, "STUDENT");
        role("invitee", A, "TEACHER", "INVITED");
        assertThrows(VacademyException.class,
                () -> guard.requireCanUpdateInvitation(caller("learner"), A, "invitee", () -> false));
    }

    @Test
    void invitationTargetMustBelongToTheInstitute() {
        role("admin", A, "ADMIN");
        role("victim", B, "ADMIN");
        assertThrows(VacademyException.class,
                () -> guard.requireCanUpdateInvitation(caller("admin"), A, "victim", () -> true));
    }

    @Test
    void onlyAnAdminMayEditAnAdminsInvitation() {
        role("teacher", A, "TEACHER");
        role("admin", A, "ADMIN");
        role("invitee", A, "ADMIN", "INVITED");
        assertThrows(VacademyException.class,
                () -> guard.requireCanUpdateInvitation(caller("teacher"), A, "invitee", () -> false));
        assertDoesNotThrow(() -> guard.requireCanUpdateInvitation(caller("admin"), A, "invitee", () -> false));
    }

    @Test
    void emailOfSomeoneInAnotherInstituteCannotBeMoved() {
        role("admin", A, "ADMIN");
        role("victim", A, "TEACHER", "INVITED");
        role("victim", B, "ADMIN");
        assertThrows(VacademyException.class,
                () -> guard.requireCanUpdateInvitation(caller("admin"), A, "victim", () -> true));
        // Name / roles only: the reminder still goes to the owner's own address.
        assertDoesNotThrow(() -> guard.requireCanUpdateInvitation(caller("admin"), A, "victim", () -> false));
    }

    // ---- credential reads / changes: colleagues and former institutes ---------------

    @Test
    void teacherCannotViewOrChangeAColleaguesLogin() {
        role("teacher", A, "TEACHER");
        role("admin", A, "ADMIN");
        role("billing", A, "Billing Manager");
        assertThrows(VacademyException.class, () -> guard.requireCanViewCredentials(caller("teacher"), "billing"));
        assertThrows(VacademyException.class, () -> guard.requireCanChangeCredentials(caller("teacher"), "billing"));
        assertDoesNotThrow(() -> guard.requireCanViewCredentials(caller("admin"), "billing"));
        assertDoesNotThrow(() -> guard.requireCanChangeCredentials(caller("admin"), "billing"));
    }

    @Test
    void learnerCannotChangeAnotherUsersPassword() {
        role("learner", A, "STUDENT");
        role("victim", A, "STUDENT");
        assertThrows(VacademyException.class, () -> guard.requireCanChangeCredentials(caller("learner"), "victim"));
        assertDoesNotThrow(() -> guard.requireCanChangeCredentials(caller("learner"), "learner"));
    }

    @Test
    void teacherMayChangeALearnersPasswordButNotAnotherInstitutesAdmin() {
        role("teacher", A, "TEACHER");
        role("admin", A, "ADMIN");
        role("learner", A, "STUDENT");
        role("victim", A, "STUDENT");
        role("victim", B, "ADMIN");
        assertDoesNotThrow(() -> guard.requireCanChangeCredentials(caller("teacher"), "learner"));
        assertThrows(VacademyException.class, () -> guard.requireCanChangeCredentials(caller("admin"), "victim"));
    }

    @Test
    void formerInstituteCannotReachALearnerWhoLeft() {
        role("admin", A, "ADMIN");
        role("learner", A, "STUDENT", "DELETED");
        role("learner", B, "STUDENT");
        assertThrows(VacademyException.class, () -> guard.requireCanViewCredentials(caller("admin"), "learner"));
        assertThrows(VacademyException.class, () -> guard.requireCanEditAccount(caller("admin"), "learner"));
    }

    @Test
    void bulkReadKeepsOnlyTheLoginsTheCallerMaySee() {
        role("teacher", A, "TEACHER");
        role("learner", A, "STUDENT");
        role("colleague", A, "TEACHER");
        role("stranger", B, "STUDENT");
        Set<String> visible = guard.loginsCallerMayView(caller("teacher"),
                List.of("learner", "colleague", "stranger", "teacher", "unknown"));
        assertEquals(Set.of("learner", "teacher"), visible);
        assertEquals(Set.of(), guard.loginsCallerMayView(caller("stranger"), List.of("learner")));
    }

    // ---- user-details/update ---------------------------------------------------------

    @Test
    void nobodyJoinsAnInstituteAsStaffByEditingThemselves() {
        role("learner", A, "STUDENT");
        assertThrows(VacademyException.class, () -> guard.requireCanUpdateDetails(caller("learner"), B, "learner",
                () -> false, List.of("TEACHER"), List.of()));
        // Own profile, no roles: fine anywhere.
        assertDoesNotThrow(() -> guard.requireCanUpdateDetails(caller("learner"), A, "learner",
                () -> true, List.of(), List.of()));
    }

    @Test
    void adminMayEditOwnRolesButOnlyOwnRowsOfThisInstitute() {
        String own = role("admin", A, "TEACHER");
        String elsewhere = role("admin", B, "TEACHER");
        role("admin", A, "ADMIN");
        String someoneElses = role("other", A, "TEACHER");
        assertDoesNotThrow(() -> guard.requireCanUpdateDetails(caller("admin"), A, "admin",
                () -> false, List.of("ADMIN"), List.of(own)));
        assertThrows(VacademyException.class, () -> guard.requireCanUpdateDetails(caller("admin"), A, "admin",
                () -> false, List.of(), List.of(elsewhere)));
        assertThrows(VacademyException.class, () -> guard.requireCanUpdateDetails(caller("admin"), A, "admin",
                () -> false, List.of(), List.of(someoneElses)));
        assertThrows(VacademyException.class, () -> guard.requireCanUpdateDetails(caller("admin"), A, "admin",
                () -> false, List.of(), List.of("no-such-row")));
    }

    @Test
    void outsiderCannotUpdateAMember() {
        role("learner", B, "STUDENT");
        role("member", A, "TEACHER");
        AtomicBoolean asked = new AtomicBoolean();
        assertThrows(VacademyException.class, () -> guard.requireCanUpdateDetails(caller("learner"), A, "member",
                () -> { asked.set(true); return true; }, List.of(), List.of()));
        assertFalse(asked.get());
    }

    @Test
    void teacherMayEditAColleaguesProfileButNotTheirLoginIdentity() {
        role("teacher", A, "TEACHER");
        String colleagueRow = role("colleague", A, "TEACHER");
        role("admin", A, "ADMIN");
        role("learner", A, "STUDENT");
        assertDoesNotThrow(() -> guard.requireCanUpdateDetails(caller("teacher"), A, "colleague",
                () -> false, List.of("Counsellor"), List.of(colleagueRow)));
        assertThrows(VacademyException.class, () -> guard.requireCanUpdateDetails(caller("teacher"), A, "colleague",
                () -> true, List.of(), List.of()));
        assertThrows(VacademyException.class, () -> guard.requireCanUpdateDetails(caller("teacher"), A, "admin",
                () -> false, List.of(), List.of()));
        assertDoesNotThrow(() -> guard.requireCanUpdateDetails(caller("teacher"), A, "learner",
                () -> true, List.of(), List.of()));
        assertDoesNotThrow(() -> guard.requireCanUpdateDetails(caller("admin"), A, "colleague",
                () -> true, List.of(), List.of()));
    }

    // ---- invite / add-user-roles -------------------------------------------------------

    @Test
    void onlyStaffOfTheInstituteMayInviteOrAddRoles() {
        role("teacher", A, "TEACHER");
        role("learner", A, "STUDENT");
        assertDoesNotThrow(() -> guard.requireStaffOf(caller("teacher"), A));
        assertThrows(VacademyException.class, () -> guard.requireStaffOf(caller("learner"), A));
        assertThrows(VacademyException.class, () -> guard.requireStaffOf(caller("teacher"), B));
        assertThrows(VacademyException.class, () -> guard.requireStaffOf(null, A));
    }

    // ---- resend login details -----------------------------------------------------------

    @Test
    void resendNeedsStaffOfTheInstituteTheMemberBelongsTo() {
        role("teacher", A, "TEACHER");
        role("learner", A, "STUDENT");
        role("member", A, "COUNSELLOR");
        role("elsewhere", B, "COUNSELLOR");
        assertDoesNotThrow(() -> guard.requireCanResendLogin(caller("teacher"), A, "member"));
        // A learner, an outsider and a member of another institute are all refused.
        assertThrows(VacademyException.class, () -> guard.requireCanResendLogin(caller("learner"), A, "member"));
        assertThrows(VacademyException.class, () -> guard.requireCanResendLogin(caller("stranger"), A, "member"));
        assertThrows(VacademyException.class, () -> guard.requireCanResendLogin(caller("teacher"), A, "elsewhere"));
        assertThrows(VacademyException.class, () -> guard.requireCanResendLogin(caller("teacher"), B, "elsewhere"));
        assertThrows(VacademyException.class, () -> guard.requireCanResendLogin(caller("teacher"), null, "member"));
        assertThrows(VacademyException.class, () -> guard.requireCanResendLogin(null, A, "member"));
    }

    @Test
    void onlyAnAdminMayResendAnAdminsLoginDetails() {
        role("teacher", A, "TEACHER");
        role("admin", A, "ADMIN");
        role("otherAdmin", A, "ADMIN", "INVITED");
        assertThrows(VacademyException.class, () -> guard.requireCanResendLogin(caller("teacher"), A, "otherAdmin"));
        assertDoesNotThrow(() -> guard.requireCanResendLogin(caller("admin"), A, "otherAdmin"));
    }

    @Test
    void aRemovedMemberIsNotResentLoginDetails() {
        role("admin", A, "ADMIN");
        role("gone", A, "TEACHER", "DELETED");
        assertThrows(VacademyException.class, () -> guard.requireCanResendLogin(caller("admin"), A, "gone"));
    }
}
