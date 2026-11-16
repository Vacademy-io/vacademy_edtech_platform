package vacademy.io.admin_core_service.features.learner.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Only the account owner or staff of the learner's institute can edit a learner profile
 * (PUT /learner/info/v1/profile and /edit). Same rule as auth-service's account access guard,
 * decided from the role rows auth-service holds.
 */
class LearnerProfileEditGuardTest {

    private static final String LEARNER = "learner-1";
    private static final String INST_A = "inst-a";
    private static final String INST_B = "inst-b";

    private AuthService authService;
    private LearnerProfileEditGuard guard;
    private final Map<String, List<Map<String, String>>> roleRows = new HashMap<>();

    @BeforeEach
    void setUp() {
        authService = mock(AuthService.class);
        guard = new LearnerProfileEditGuard(authService);
        when(authService.getRoleMembershipsStrict(anyString()))
                .thenAnswer(inv -> roleRows.getOrDefault(inv.<String>getArgument(0), List.of()));
        when(authService.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(
                UserDTO.builder().id(LEARNER).email("asha@example.com").mobileNumber("919876543210").build()));
    }

    private void role(String userId, String institute, String role) {
        role(userId, institute, role, "ACTIVE");
    }

    private void role(String userId, String institute, String role, String status) {
        Map<String, String> row = new HashMap<>();
        row.put("institute_id", institute);
        row.put("role_name", role);
        row.put("status", status);
        roleRows.computeIfAbsent(userId, k -> new ArrayList<>()).add(row);
    }

    private static CustomUserDetails caller(String userId) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setFullName("Caller");
        dto.setRootUser(true); // every learner carries the root flag; it must not count here
        dto.setAuthorities(List.of("ADMIN"));
        return new CustomUserDetails(dto);
    }

    private static UserDTO details(String email, String mobile) {
        return UserDTO.builder().email(email).mobileNumber(mobile).fullName("Asha Rao").build();
    }

    @Test
    void learnerEditsOwnProfileWithoutAnyLookup() {
        assertDoesNotThrow(() -> guard.requireCanEdit(caller(LEARNER), LEARNER, details("new@example.com", "9000000001")));
        verify(authService, never()).getRoleMembershipsStrict(anyString());
    }

    @Test
    void learnerMaySetOwnPassword() {
        UserDTO withPassword = details(null, null);
        withPassword.setPassword("new-pass");
        assertDoesNotThrow(() -> guard.requireCanEdit(caller(LEARNER), LEARNER, withPassword));
    }

    @Test
    void adminOfTheLearnersInstituteMayEdit() {
        role(LEARNER, INST_A, "STUDENT");
        role("admin-1", INST_A, "ADMIN");
        assertDoesNotThrow(() -> guard.requireCanEdit(caller("admin-1"), LEARNER, details("asha@example.com", "")));
    }

    @Test
    void staffOfTheLearnersInstituteMayChangeTheMobileOfALearnerOfThatInstituteOnly() {
        role(LEARNER, INST_A, "STUDENT");
        role("teacher-1", INST_A, "TEACHER");
        assertDoesNotThrow(() -> guard.requireCanEdit(caller("teacher-1"), LEARNER, details("asha@example.com", "9000000001")));
    }

    @Test
    void anotherLearnerOfTheSameInstituteIsRefused() {
        role(LEARNER, INST_A, "STUDENT");
        role("learner-2", INST_A, "STUDENT");
        VacademyException e = assertThrows(VacademyException.class,
                () -> guard.requireCanEdit(caller("learner-2"), LEARNER, details("me@example.com", null)));
        assertEquals(403, e.getStatus().value());
    }

    @Test
    void learnerWhoAlsoHoldsTeacherIsNotStaff() {
        role(LEARNER, INST_A, "STUDENT");
        role("learner-2", INST_A, "STUDENT");
        role("learner-2", INST_A, "TEACHER");
        assertThrows(VacademyException.class,
                () -> guard.requireCanEdit(caller("learner-2"), LEARNER, details(null, null)));
    }

    @Test
    void staffOfAnotherInstituteIsRefused() {
        role(LEARNER, INST_A, "STUDENT");
        role("admin-b", INST_B, "ADMIN");
        assertThrows(VacademyException.class,
                () -> guard.requireCanEdit(caller("admin-b"), LEARNER, details(null, null)));
    }

    @Test
    void deletedOrDisabledStaffRoleDoesNotCount() {
        role(LEARNER, INST_A, "STUDENT");
        role("admin-1", INST_A, "ADMIN", "DISABLED");
        assertThrows(VacademyException.class,
                () -> guard.requireCanEdit(caller("admin-1"), LEARNER, details(null, null)));
    }

    @Test
    void nonAdminStaffCannotEditAColleague() {
        role(LEARNER, INST_A, "TEACHER");
        role("teacher-1", INST_A, "TEACHER");
        assertThrows(VacademyException.class,
                () -> guard.requireCanEdit(caller("teacher-1"), LEARNER, details(null, null)));
    }

    @Test
    void mobileChangeOfALearnerOfTwoInstitutesNeedsAdminOfBoth() {
        role(LEARNER, INST_A, "STUDENT");
        role(LEARNER, INST_B, "STUDENT");
        role("admin-1", INST_A, "ADMIN");
        assertThrows(VacademyException.class,
                () -> guard.requireCanEdit(caller("admin-1"), LEARNER, details(null, "9000000001")));
        // Unchanged identifiers (the dashboard always sends them) and other fields are fine.
        assertDoesNotThrow(() -> guard.requireCanEdit(caller("admin-1"), LEARNER,
                details("ASHA@example.com ", "+91 98765 43210")));

        role("admin-1", INST_B, "ADMIN");
        assertDoesNotThrow(() -> guard.requireCanEdit(caller("admin-1"), LEARNER, details(null, "9000000001")));
    }

    @Test
    void staffCannotSetAPasswordThroughTheProfile() {
        role(LEARNER, INST_A, "STUDENT");
        role("admin-1", INST_A, "ADMIN");
        UserDTO withPassword = details(null, null);
        withPassword.setPassword("new-pass");
        assertThrows(VacademyException.class, () -> guard.requireCanEdit(caller("admin-1"), LEARNER, withPassword));
    }

    @Test
    void failedRoleLookupRefusesTheEdit() {
        when(authService.getRoleMembershipsStrict(anyString())).thenThrow(new VacademyException("down"));
        assertThrows(VacademyException.class,
                () -> guard.requireCanEdit(caller("admin-1"), LEARNER, details(null, null)));
    }

    @Test
    void missingCallerIsRefused() {
        assertThrows(VacademyException.class, () -> guard.requireCanEdit(null, LEARNER, null));
        assertThrows(VacademyException.class, () -> guard.requireCanEdit(caller("admin-1"), " ", null));
    }

    @Test
    void counsellorAlsoEnrolledAsALearnerIsStaff() {
        role(LEARNER, INST_A, "STUDENT");
        role("counsellor-1", INST_A, "COUNSELLOR");
        role("counsellor-1", INST_A, "STUDENT");
        assertDoesNotThrow(() -> guard.requireCanEdit(caller("counsellor-1"), LEARNER, details("asha@example.com", null)));
    }

    @Test
    void usernameChangeOfALearnerOfTwoInstitutesNeedsAdminOfBoth() {
        when(authService.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(UserDTO.builder()
                .id(LEARNER).username("asha01").email("asha@example.com").mobileNumber("919876543210").build()));
        role(LEARNER, INST_A, "STUDENT");
        role(LEARNER, INST_B, "STUDENT");
        role("teacher-1", INST_A, "TEACHER");
        UserDTO rename = details(null, null);
        rename.setUsername("someone-else");
        assertThrows(VacademyException.class, () -> guard.requireCanEdit(caller("teacher-1"), LEARNER, rename));

        UserDTO same = details(null, null);
        same.setUsername("ASHA01");
        assertDoesNotThrow(() -> guard.requireCanEdit(caller("teacher-1"), LEARNER, same));
    }

    @Test
    void accountWideChangeFromAnInstituteWhereTheAccountIsALearnerOnly() {
        role(LEARNER, INST_A, "STUDENT");
        role("teacher-1", INST_A, "TEACHER");
        assertDoesNotThrow(() -> guard.requireCanChangeAccountFrom(caller("teacher-1"), LEARNER, INST_A, "refused"));
    }

    @Test
    void accountWideChangeNeedsAdminWhereverElseTheAccountBelongs() {
        role(LEARNER, INST_A, "STUDENT");
        role(LEARNER, INST_B, "STUDENT");
        role("admin-1", INST_A, "ADMIN");
        VacademyException e = assertThrows(VacademyException.class,
                () -> guard.requireCanChangeAccountFrom(caller("admin-1"), LEARNER, INST_A, "refused"));
        assertEquals(403, e.getStatus().value());

        role("admin-1", INST_B, "ADMIN");
        assertDoesNotThrow(() -> guard.requireCanChangeAccountFrom(caller("admin-1"), LEARNER, INST_A, "refused"));
    }

    @Test
    void accountWideChangeOfStaffHereNeedsAdminHere() {
        role(LEARNER, INST_A, "TEACHER");
        role("teacher-1", INST_A, "TEACHER");
        assertThrows(VacademyException.class,
                () -> guard.requireCanChangeAccountFrom(caller("teacher-1"), LEARNER, INST_A, "refused"));
    }

    @Test
    void accountWideChangeByALearnerOfTheInstituteIsRefused() {
        role(LEARNER, INST_A, "STUDENT");
        role("learner-2", INST_A, "STUDENT");
        assertThrows(VacademyException.class,
                () -> guard.requireCanChangeAccountFrom(caller("learner-2"), LEARNER, INST_A, "refused"));
    }

    @Test
    void belongsToReadsNonDeletedRoleRows() {
        role(LEARNER, INST_A, "STUDENT");
        role(LEARNER, INST_B, "STUDENT", "DELETED");
        assertEquals(true, guard.belongsTo(LEARNER, INST_A));
        assertEquals(false, guard.belongsTo(LEARNER, INST_B));
    }
}
