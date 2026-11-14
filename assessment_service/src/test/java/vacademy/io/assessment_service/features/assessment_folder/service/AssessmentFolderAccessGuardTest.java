package vacademy.io.assessment_service.features.assessment_folder.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Folder management is staff-only and bound to the caller's active institute; the learner
 * folder list only needs membership of that institute.
 */
class AssessmentFolderAccessGuardTest {

    private final AssessmentFolderAccessGuard guard = new AssessmentFolderAccessGuard();

    private static CustomUserDetails principal(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    @Test
    @DisplayName("staff roles may manage folders: ADMIN, TEACHER, EVALUATOR, custom role")
    void staffMayManage() {
        for (String role : List.of("ADMIN", "TEACHER", "EVALUATOR", "MY CUSTOM ROLE")) {
            assertDoesNotThrow(() -> guard.requireStaff(principal(role), "inst-1", "inst-1"), role);
        }
        // a learner who is also ADMIN stays staff
        assertDoesNotThrow(() -> guard.requireStaff(principal("STUDENT", "ADMIN"), "inst-1", "inst-1"));
    }

    @Test
    @DisplayName("learners cannot manage folders, even with TEACHER from self-signup")
    void learnersMayNotManage() {
        assertThrows(ForbiddenException.class, () -> guard.requireStaff(principal("STUDENT"), "inst-1", "inst-1"));
        assertThrows(ForbiddenException.class,
                () -> guard.requireStaff(principal("STUDENT", "TEACHER"), "inst-1", "inst-1"));
        assertThrows(ForbiddenException.class, () -> guard.requireStaff(principal("PARENT"), "inst-1", "inst-1"));
    }

    @Test
    @DisplayName("no role in the institute is refused for both checks")
    void noRoleRefused() {
        assertThrows(ForbiddenException.class, () -> guard.requireStaff(principal(), "inst-1", "inst-1"));
        assertThrows(ForbiddenException.class, () -> guard.requireMember(principal(), "inst-1", "inst-1"));
        assertThrows(ForbiddenException.class, () -> guard.requireMember(null, "inst-1", "inst-1"));
    }

    @Test
    @DisplayName("instituteId must be the caller's active institute (clientId)")
    void otherInstituteRefused() {
        assertThrows(ForbiddenException.class, () -> guard.requireStaff(principal("ADMIN"), "inst-1", "inst-2"));
        assertThrows(ForbiddenException.class, () -> guard.requireStaff(principal("ADMIN"), null, "inst-1"));
        assertThrows(ForbiddenException.class, () -> guard.requireMember(principal("STUDENT"), "inst-1", "inst-2"));
        assertThrows(ForbiddenException.class, () -> guard.requireStaff(principal("ADMIN"), "inst-1", " "));
    }

    @Test
    @DisplayName("learners may read their own institute's folder list")
    void learnersMayList() {
        assertDoesNotThrow(() -> guard.requireMember(principal("STUDENT"), "inst-1", "inst-1"));
    }
}
