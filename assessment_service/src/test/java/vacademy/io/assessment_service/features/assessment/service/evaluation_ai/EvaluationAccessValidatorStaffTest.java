package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@link EvaluationAccessValidator#requireStaffRole} keeps STUDENTs of the institute
 * out of AI-evaluation mutations (membership alone let them through), without
 * dropping any staff role. {@link EvaluationAccessValidator#requireAssessmentInInstitute}
 * binds rubric calls to the owning institute. {@link EvaluationAccessValidator#requireActiveInstitute}
 * ties an {@code instituteId} parameter to the {@code clientId} the roles came from.
 */
class EvaluationAccessValidatorStaffTest {

    private final AssessmentInstituteMappingRepository mappings = mock(AssessmentInstituteMappingRepository.class);
    private final EvaluationAccessValidator validator = new EvaluationAccessValidator(
            mock(StudentAttemptRepository.class), mock(AiEvaluationProcessRepository.class), mappings);

    private static CustomUserDetails principal(boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    @Test
    @DisplayName("staff roles pass: ADMIN, TEACHER, EVALUATOR, MENTOR, COUNSELLOR, custom role")
    void staffRolesPass() {
        for (String role : List.of("ADMIN", "TEACHER", "EVALUATOR", "MENTOR", "COUNSELLOR", "COURSE CREATOR",
                "teacher", "SOME_CUSTOM_ROLE")) {
            assertDoesNotThrow(() -> validator.requireStaffRole(principal(false, role)), role);
        }
    }

    @Test
    @DisplayName("learner roles are refused")
    void learnersRefused() {
        assertThrows(ForbiddenException.class, () -> validator.requireStaffRole(principal(false, "STUDENT")));
        assertThrows(ForbiddenException.class, () -> validator.requireStaffRole(principal(false, "PARENT")));
        assertThrows(ForbiddenException.class,
                () -> validator.requireStaffRole(principal(false, "STUDENT", "VIEW_CALL_NUMBERS")));
    }

    @Test
    @DisplayName("a self-signup learner carrying STUDENT + TEACHER is refused")
    void learnerWithTeacherRefused() {
        assertThrows(ForbiddenException.class,
                () -> validator.requireStaffRole(principal(false, "STUDENT", "TEACHER")));
    }

    @Test
    @DisplayName("an ADMIN or EVALUATOR also enrolled as a learner keeps access")
    void staffAlsoEnrolledKeepsAccess() {
        assertDoesNotThrow(() -> validator.requireStaffRole(principal(false, "STUDENT", "ADMIN")));
        assertDoesNotThrow(() -> validator.requireStaffRole(principal(false, "STUDENT", "EVALUATOR")));
    }

    @Test
    @DisplayName("no root bypass: a root user with only STUDENT, or no role here, is refused")
    void noRootBypass() {
        assertThrows(ForbiddenException.class, () -> validator.requireStaffRole(principal(true, "STUDENT")));
        assertThrows(ForbiddenException.class, () -> validator.requireStaffRole(principal(true)));
        assertThrows(ForbiddenException.class, () -> validator.requireStaffRole(null));
    }

    @Test
    @DisplayName("rubric binding: assessment must be mapped to the caller's institute")
    void assessmentInInstitute() {
        when(mappings.findByAssessmentIdAndInstituteId("a-1", "inst-1"))
                .thenReturn(Optional.of(new AssessmentInstituteMapping()));
        when(mappings.findByAssessmentIdAndInstituteId("a-other", "inst-1")).thenReturn(Optional.empty());

        assertDoesNotThrow(() -> validator.requireAssessmentInInstitute(principal(false, "ADMIN"), "inst-1", "a-1"));
        assertThrows(ForbiddenException.class,
                () -> validator.requireAssessmentInInstitute(principal(false, "ADMIN"), "inst-1", "a-other"));
        assertThrows(ForbiddenException.class,
                () -> validator.requireAssessmentInInstitute(principal(false, "ADMIN"), "inst-1", null));
        assertThrows(ForbiddenException.class,
                () -> validator.requireAssessmentInInstitute(principal(false, "ADMIN"), null, "a-1"));
    }

    @Test
    @DisplayName("instituteId param must equal the clientId institute the roles were loaded for")
    void activeInstituteBinding() {
        assertDoesNotThrow(() -> validator.requireActiveInstitute("inst-1", "inst-1"));
        assertThrows(ForbiddenException.class, () -> validator.requireActiveInstitute("inst-own", "inst-victim"));
        assertThrows(ForbiddenException.class, () -> validator.requireActiveInstitute(null, "inst-1"));
        assertThrows(ForbiddenException.class, () -> validator.requireActiveInstitute("inst-1", null));
        assertThrows(ForbiddenException.class, () -> validator.requireActiveInstitute("inst-1", " "));
    }
}
