package vacademy.io.admin_core_service.features.learner_management.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.learner_management.dto.NewUserDTO;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Typed usernames in the add-learners dialog (manual rows and CSV rows). */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class BulkAssignUsernameProblemsTest {

    private static final String INSTITUTE_ID = "inst-1";

    @Mock
    private AuthService authService;

    @InjectMocks
    private BulkAssignmentService service;

    private static NewUserDTO row(String email, String username, String phone) {
        NewUserDTO dto = new NewUserDTO();
        dto.setEmail(email);
        dto.setUsername(username);
        dto.setMobileNumber(phone);
        dto.setFullName("Learner");
        return dto;
    }

    @Test
    void sameNameForTwoDifferentPeopleFailsTheLaterRow() {
        Map<Integer, String> problems = service.findUsernameProblems(List.of(
                row("a@x.com", "Sahil", null),
                row("b@x.com", "sahil", null)), INSTITUTE_ID, false);

        assertEquals(1, problems.size());
        assertTrue(problems.get(1).contains("more than one learner"), problems.get(1));
    }

    @Test
    void sameNameOnTwoRowsOfTheSamePersonIsFine() {
        Map<Integer, String> problems = service.findUsernameProblems(List.of(
                row("a@x.com", "sahil", null),
                row("A@X.com", "sahil", null)), INSTITUTE_ID, false);

        assertTrue(problems.isEmpty());
    }

    @Test
    void previewMarksANameTakenOutsideTheInstitute() {
        when(authService.checkNewLearnerUsernames(eq(INSTITUTE_ID), anyList())).thenReturn(List.of(true, false));

        Map<Integer, String> problems = service.findUsernameProblems(List.of(
                row("a@x.com", "asha", null),
                row("b@x.com", "Sahil", null)), INSTITUTE_ID, true);

        assertEquals(Map.of(1, "Username \"Sahil\" is already taken. Please use a different username."), problems);
    }

    @Test
    void rowsWithoutATypedUsernameAreNotChecked() {
        when(authService.checkNewLearnerUsernames(eq(INSTITUTE_ID), anyList())).thenReturn(List.of());

        Map<Integer, String> problems = service.findUsernameProblems(List.of(
                row("a@x.com", null, null),
                row("b@x.com", "  ", null)), INSTITUTE_ID, true);

        assertTrue(problems.isEmpty());
    }

    @Test
    void theRealAddLeavesTheTakenCheckToAuth() {
        service.findUsernameProblems(List.of(row("a@x.com", "Sahil", null)), INSTITUTE_ID, false);

        verify(authService, never()).checkNewLearnerUsernames(any(), any());
    }

    @Test
    void previewLetsRowsThroughWhenTheCheckCannotBeMade() {
        when(authService.checkNewLearnerUsernames(eq(INSTITUTE_ID), anyList())).thenReturn(null);

        Map<Integer, String> problems = service.findUsernameProblems(
                List.of(row("b@x.com", "Sahil", null)), INSTITUTE_ID, true);

        assertTrue(problems.isEmpty());
    }
}
