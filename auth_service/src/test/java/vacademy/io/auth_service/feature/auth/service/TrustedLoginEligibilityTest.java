package vacademy.io.auth_service.feature.auth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.admin_core_service.dto.InstituteSignupPolicy;
import vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserRoleRepository;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TrustedLoginEligibilityTest {

    private static final String HERE = "inst-1";
    private static final String ELSEWHERE = "inst-2";

    private UserRoleRepository userRoleRepository;
    private InstitutePolicyService institutePolicyService;
    private TrustedLoginEligibility eligibility;
    private final User user = User.builder().id("u-1").username("asha").build();

    @BeforeEach
    void setUp() {
        userRoleRepository = mock(UserRoleRepository.class);
        institutePolicyService = mock(InstitutePolicyService.class);
        eligibility = new TrustedLoginEligibility(userRoleRepository, institutePolicyService, "root-1"::equals);
    }

    private static UserRole held(String name, String instituteId, String status) {
        Role role = new Role();
        role.setName(name);
        UserRole userRole = new UserRole();
        userRole.setRole(role);
        userRole.setInstituteId(instituteId);
        userRole.setStatus(status);
        return userRole;
    }

    private List<String> check(UserRole... roles) {
        when(userRoleRepository.findByUser(user)).thenReturn(List.of(roles));
        return eligibility.nonLearnerAccess(user);
    }

    private void learnersMayCreateCourses(String instituteId, boolean allowed) {
        when(institutePolicyService.fetchSignupPolicyAnswerCached(instituteId))
                .thenReturn(new InstitutePolicyService.SignupPolicyAnswer(
                        InstituteSignupPolicy.builder().allowLearnersToCreateCourses(allowed).build(), true));
    }

    @Test
    void studentOnlyIsALearner() {
        assertEquals(List.of(), check(held("STUDENT", HERE, "ACTIVE")));
    }

    @Test
    void parentAndInvitedStudentAreLearners() {
        assertEquals(List.of(), check(held("PARENT", HERE, "ACTIVE"), held("STUDENT", ELSEWHERE, "INVITED")));
    }

    @Test
    void adminInAnotherInstituteIsNot() {
        assertEquals(List.of("ADMIN"), check(held("STUDENT", HERE, "ACTIVE"), held("ADMIN", ELSEWHERE, "ACTIVE")));
    }

    @Test
    void invitedAdminIsNot() {
        assertEquals(List.of("ADMIN"), check(held("STUDENT", HERE, "ACTIVE"), held("ADMIN", ELSEWHERE, "INVITED")));
    }

    @Test
    void revokedStaffRolesAreIgnored() {
        assertEquals(List.of(), check(held("STUDENT", HERE, "ACTIVE"), held("ADMIN", ELSEWHERE, "DISABLED"),
                held("TEACHER", ELSEWHERE, "DELETED")));
    }

    @Test
    void customRoleIsNot() {
        assertEquals(List.of("My Custom Role".toUpperCase()), check(held("My Custom Role", HERE, "ACTIVE")));
    }

    @Test
    void superAdminIsNotEvenWithOnlyALearnerRole() {
        User root = User.builder().id("root-1").build();
        when(userRoleRepository.findByUser(root)).thenReturn(List.of(held("STUDENT", HERE, "ACTIVE")));
        assertEquals(List.of(TrustedLoginEligibility.SUPER_ADMIN), eligibility.nonLearnerAccess(root));
    }

    @Test
    void courseCreatingLearnerIsALearnerWhereTheInstituteAllowsIt() {
        learnersMayCreateCourses(HERE, true);
        assertEquals(List.of(), check(held("STUDENT", HERE, "ACTIVE"), held("TEACHER", HERE, "ACTIVE")));
    }

    @Test
    void teacherIsStaffWhereTheInstituteForbidsLearnerCourses() {
        learnersMayCreateCourses(HERE, false);
        assertEquals(List.of("TEACHER"), check(held("STUDENT", HERE, "ACTIVE"), held("TEACHER", HERE, "ACTIVE")));
    }

    @Test
    void teacherIsStaffWhereTheAccountIsNotAlsoAStudent() {
        learnersMayCreateCourses(ELSEWHERE, true);
        assertEquals(List.of("TEACHER"), check(held("STUDENT", HERE, "ACTIVE"), held("TEACHER", ELSEWHERE, "ACTIVE")));
    }

    @Test
    void studentTeacherStaysALearnerWhenThePolicyLookupThrows() {
        when(institutePolicyService.fetchSignupPolicyAnswerCached(HERE)).thenThrow(new RuntimeException("down"));
        assertEquals(List.of(), check(held("STUDENT", HERE, "ACTIVE"), held("TEACHER", HERE, "ACTIVE")));
    }

    @Test
    void studentTeacherStaysALearnerWhenAdminCoreDidNotAnswer() {
        when(institutePolicyService.fetchSignupPolicyAnswerCached(HERE))
                .thenReturn(new InstitutePolicyService.SignupPolicyAnswer(null, false));
        assertEquals(List.of(), check(held("STUDENT", HERE, "ACTIVE"), held("TEACHER", HERE, "ACTIVE")));
    }

    @Test
    void teacherIsStaffWhenTheInstituteHasNoSettings() {
        when(institutePolicyService.fetchSignupPolicyAnswerCached(HERE))
                .thenReturn(new InstitutePolicyService.SignupPolicyAnswer(null, true));
        assertEquals(List.of("TEACHER"), check(held("STUDENT", HERE, "ACTIVE"), held("TEACHER", HERE, "ACTIVE")));
    }
}
