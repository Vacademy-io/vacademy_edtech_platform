package vacademy.io.auth_service.feature.user.service;

import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Any signed-in user could POST add-user-roles / user-invitation with ADMIN for any institute
 * and then pass every institute-ADMIN check. Only an ADMIN of that institute may grant ADMIN;
 * other roles are untouched.
 */
class AdminRoleGrantGuardTest {

    private static final String INSTITUTE = "inst-a";

    private final UserRoleRepository userRoleRepository = mock(UserRoleRepository.class);
    private final AdminRoleGrantGuard guard = new AdminRoleGrantGuard(userRoleRepository);

    private static CustomUserDetails caller(String userId, boolean root) {
        User user = new User();
        user.setId(userId);
        user.setUsername(userId);
        user.setRootUser(root);
        return new CustomUserDetails(user, INSTITUTE, List.of());
    }

    private void adminRowFor(String userId) {
        when(userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                eq(userId), eq(INSTITUTE), anyList(), anyList())).thenReturn(Optional.of(new UserRole()));
    }

    @Test
    void nonAdminRolesNeedNoCheck() {
        assertDoesNotThrow(() -> guard.requireAdminToGrantAdmin(caller("learner", true), INSTITUTE,
                List.of("TEACHER", "STUDENT")));
        assertDoesNotThrow(() -> guard.requireAdminToGrantAdmin(caller("learner", true), INSTITUTE, null));
        verify(userRoleRepository, never()).findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                anyString(), anyString(), anyList(), anyList());
    }

    @Test
    void adminOfInstituteMayGrantAdmin() {
        adminRowFor("admin");
        assertDoesNotThrow(() -> guard.requireAdminToGrantAdmin(caller("admin", true), INSTITUTE,
                List.of("ADMIN", "TEACHER")));
    }

    @Test
    void rootLearnerCannotGrantAdminInAnyCase() {
        when(userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                any(), any(), anyList(), anyList())).thenReturn(Optional.empty());
        assertThrows(VacademyException.class,
                () -> guard.requireAdminToGrantAdmin(caller("learner", true), INSTITUTE, List.of("ADMIN")));
        assertThrows(VacademyException.class,
                () -> guard.requireAdminToGrantAdmin(caller("learner", true), INSTITUTE, List.of("admin")));
    }

    @Test
    void paddedAdminNameStillNeedsAnAdmin() {
        when(userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                any(), any(), anyList(), anyList())).thenReturn(Optional.empty());
        for (String padded : List.of("ADMIN ", " ADMIN", "ADMIN\t", " admin\n")) {
            assertThrows(VacademyException.class,
                    () -> guard.requireAdminToGrantAdmin(caller("teacher", false), INSTITUTE,
                            List.of("TEACHER", padded)), padded);
        }
    }

    @Test
    void missingInstituteOrCallerIsRefused() {
        assertThrows(VacademyException.class,
                () -> guard.requireAdminToGrantAdmin(null, INSTITUTE, List.of("ADMIN")));
        assertThrows(VacademyException.class,
                () -> guard.requireAdminToGrantAdmin(caller("admin", true), null, List.of("ADMIN")));
    }

    @Test
    void removingAdminNeedsAnAdminOfThatInstitute() {
        when(userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                any(), any(), anyList(), anyList())).thenReturn(Optional.empty());
        assertThrows(VacademyException.class,
                () -> guard.requireAdminToRemoveAdmin(caller("teacher", false), INSTITUTE, List.of("ADMIN")));
        assertDoesNotThrow(() -> guard.requireAdminToRemoveAdmin(caller("teacher", false), INSTITUTE,
                List.of("TEACHER")));
        adminRowFor("admin");
        assertDoesNotThrow(() -> guard.requireAdminToRemoveAdmin(caller("admin", false), INSTITUTE,
                List.of("ADMIN")));
    }

    // ---- commerce roles ---------------------------------------------------------------

    private static final List<String> COMMERCE_ROLES = List.of("COMMERCE_STORE_MANAGER",
            "COMMERCE_WAREHOUSE_STAFF", "COMMERCE_POS_CASHIER", "COMMERCE_ACCOUNTANT");

    @Test
    void nonAdminCannotGrantAnyCommerceRole() {
        when(userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                any(), any(), anyList(), anyList())).thenReturn(Optional.empty());
        for (String role : COMMERCE_ROLES) {
            // Neither a cashier nor a teacher is an admin of this institute.
            assertThrows(VacademyException.class,
                    () -> guard.requireAdminToGrantAdmin(caller("cashier", true), INSTITUTE, List.of(role)), role);
            assertThrows(VacademyException.class,
                    () -> guard.requireAdminToGrantAdmin(caller("teacher", false), INSTITUTE,
                            List.of("TEACHER", " " + role.toLowerCase() + " ")), role);
        }
    }

    @Test
    void nonAdminCannotRemoveACommerceRole() {
        when(userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                any(), any(), anyList(), anyList())).thenReturn(Optional.empty());
        for (String role : COMMERCE_ROLES) {
            assertThrows(VacademyException.class,
                    () -> guard.requireAdminToRemoveAdmin(caller("teacher", false), INSTITUTE, List.of(role)), role);
        }
    }

    @Test
    void adminOfInstituteMayGrantAndRemoveCommerceRoles() {
        adminRowFor("admin");
        assertDoesNotThrow(() -> guard.requireAdminToGrantAdmin(caller("admin", false), INSTITUTE, COMMERCE_ROLES));
        assertDoesNotThrow(() -> guard.requireAdminToRemoveAdmin(caller("admin", false), INSTITUTE, COMMERCE_ROLES));
    }

    @Test
    void theAdminRowIsLookedUpInTheTargetInstituteWithAdminNamesOnly() {
        adminRowFor("admin");
        // Admin of inst-a, granting in another institute: no row there, refused.
        assertThrows(VacademyException.class,
                () -> guard.requireAdminToGrantAdmin(caller("admin", true), "inst-b",
                        List.of("COMMERCE_POS_CASHIER")));
        verify(userRoleRepository).findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                eq("admin"), eq("inst-b"), eq(List.of("ADMIN", "Admin")), anyList());
    }

    @Test
    void namesThatOnlyLookLikeCommerceRolesNeedNoCheck() {
        assertDoesNotThrow(() -> guard.requireAdminToGrantAdmin(caller("teacher", false), INSTITUTE,
                List.of("COMMERCE", "COMMERCE_POS_CASHIER_2", "HR_ADMIN")));
        verify(userRoleRepository, never()).findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                anyString(), anyString(), anyList(), anyList());
    }

    @Test
    void internalRoutesRefuseACommerceRoleOutright() {
        // No signed-in caller on an HMAC route, so nothing can prove an admin made the grant.
        for (String role : List.of("COMMERCE_STORE_MANAGER", "commerce_pos_cashier", " COMMERCE_ACCOUNTANT ")) {
            VacademyException refused = assertThrows(VacademyException.class,
                    () -> AdminRoleGrantGuard.refuseCommerceRolesWithoutCaller(List.of("STUDENT", role)), role);
            org.junit.jupiter.api.Assertions.assertEquals(403, refused.getStatus().value());
        }
        assertDoesNotThrow(() -> AdminRoleGrantGuard.refuseCommerceRolesWithoutCaller(List.of("STUDENT", "TEACHER", "ADMIN")));
        assertDoesNotThrow(() -> AdminRoleGrantGuard.refuseCommerceRolesWithoutCaller(null));
    }
}
