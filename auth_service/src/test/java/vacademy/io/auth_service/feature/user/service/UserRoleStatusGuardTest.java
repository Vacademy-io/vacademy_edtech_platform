package vacademy.io.auth_service.feature.user.service;

import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.user.repository.UserInstituteRoleRepository;
import vacademy.io.auth_service.feature.user.repository.UserInstituteRoleRepository.InstituteRoleRow;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** PUT /user-roles/update-role-status: who may enable, disable or delete members. */
class UserRoleStatusGuardTest {

    private static final String A = "inst-a";
    private static final String B = "inst-b";

    private final UserInstituteRoleRepository repo = mock(UserInstituteRoleRepository.class);
    private final UserAccountAccessGuard guard = new UserAccountAccessGuard(repo);
    private final Map<String, List<InstituteRoleRow>> rows = new HashMap<>();

    UserRoleStatusGuardTest() {
        when(repo.findInstituteRolesByUserId(anyString()))
                .thenAnswer(inv -> rows.getOrDefault(inv.getArgument(0, String.class), List.of()));
    }

    private void role(String userId, String institute, String roleName) {
        role(userId, institute, roleName, "ACTIVE");
    }

    private void role(String userId, String institute, String roleName, String status) {
        InstituteRoleRow row = new InstituteRoleRow() {
            public String getInstituteId() { return institute; }
            public String getRoleName() { return roleName; }
            public String getStatus() { return status; }
        };
        rows.computeIfAbsent(userId, k -> new ArrayList<>()).add(row);
    }

    private static CustomUserDetails caller(String userId) {
        User user = new User();
        user.setId(userId);
        user.setUsername(userId);
        user.setRootUser(false);
        return new CustomUserDetails(user, A, List.of());
    }

    @Test
    void aLearnerMayDeleteTheirOwnAccount() {
        role("learner", A, "STUDENT");
        assertDoesNotThrow(() -> guard.requireCanChangeRoleStatus(caller("learner"), A, List.of("learner"), "DELETED"));
    }

    @Test
    void aDisabledMemberCannotReactivateThemselves() {
        role("member", B, "TEACHER");          // signed in through another institute
        role("member", A, "COUNSELLOR", "DISABLED"); // disabled here
        assertThrows(VacademyException.class,
                () -> guard.requireCanChangeRoleStatus(caller("member"), A, List.of("member"), "ACTIVE"));
        assertThrows(VacademyException.class,
                () -> guard.requireCanChangeRoleStatus(caller("member"), A, List.of("member"), "DISABLED"));
    }

    @Test
    void aLearnerCannotDisableSomeoneElse() {
        role("learner", A, "STUDENT");
        role("victim", A, "STUDENT");
        assertThrows(VacademyException.class,
                () -> guard.requireCanChangeRoleStatus(caller("learner"), A, List.of("victim"), "DISABLED"));
        assertThrows(VacademyException.class,
                () -> guard.requireCanChangeRoleStatus(caller("learner"), A, List.of("learner", "victim"), "DISABLED"));
    }

    @Test
    void staffOfAnotherInstituteCannotChangeMembersHere() {
        role("admin", B, "ADMIN");
        role("victim", A, "TEACHER");
        assertThrows(VacademyException.class,
                () -> guard.requireCanChangeRoleStatus(caller("admin"), A, List.of("victim"), "DISABLED"));
    }

    @Test
    void staffMayDisableANonAdminButOnlyAnAdminMayDisableAnAdmin() {
        role("teacher", A, "TEACHER");
        role("admin", A, "ADMIN");
        role("learner", A, "STUDENT");
        role("admin2", A, "ADMIN");
        assertDoesNotThrow(() -> guard.requireCanChangeRoleStatus(caller("teacher"), A, List.of("learner"), "DISABLED"));
        assertThrows(VacademyException.class,
                () -> guard.requireCanChangeRoleStatus(caller("teacher"), A, List.of("learner", "admin2"), "DISABLED"));
        assertDoesNotThrow(() -> guard.requireCanChangeRoleStatus(caller("admin"), A, List.of("admin2"), "DISABLED"));
    }

    @Test
    void emptyTargetsOrInstituteAreRefused() {
        role("admin", A, "ADMIN");
        assertThrows(VacademyException.class, () -> guard.requireCanChangeRoleStatus(caller("admin"), A, List.of(), "DISABLED"));
        assertThrows(VacademyException.class,
                () -> guard.requireCanChangeRoleStatus(caller("admin"), " ", List.of("x"), "DISABLED"));
    }
}
