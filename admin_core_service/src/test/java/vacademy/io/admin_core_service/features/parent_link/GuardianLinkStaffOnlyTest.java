package vacademy.io.admin_core_service.features.parent_link;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner.service.LearnerProfileEditGuard;
import vacademy.io.admin_core_service.features.parent_link.controller.ParentLinkController;
import vacademy.io.admin_core_service.features.parent_link.dto.NewGuardianLinkRequestDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.ParentLinkActionRequestDTO;
import vacademy.io.admin_core_service.features.parent_link.service.ParentLinkService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Guardian linking (POST /parent-link/v1/link and /link-new-guardian) is for staff of the
 * institute, names only accounts of that institute, and changes an existing learner's guardian,
 * which applies to the learner's whole account, only when the learner is a learner of this
 * institute alone or the caller is ADMIN wherever else the learner belongs.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class GuardianLinkStaffOnlyTest {

    private static final String HERE = "inst-1";
    private static final String ELSEWHERE = "inst-2";
    private static final String STUDENT = "student-1";
    private static final String GUARDIAN = "guardian-1";
    private static final String STAFF = "teacher-1";

    @Mock private AuthService authService;
    @Mock private StudentSessionInstituteGroupMappingRepository ssigmRepository;
    @Mock private InstituteStudentRepository studentRepository;
    @InjectMocks private ParentLinkService parentLinkService;

    private ParentLinkController controller;
    private final Map<String, List<Map<String, String>>> roleRows = new HashMap<>();

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(parentLinkService, "learnerProfileEditGuard", new LearnerProfileEditGuard(authService));
        when(authService.getRoleMembershipsStrict(anyString()))
                .thenAnswer(inv -> roleRows.getOrDefault(inv.<String>getArgument(0), List.of()));
        when(ssigmRepository.findPackageSessionIdsByUserIdAndInstituteId(anyString(), anyString())).thenReturn(List.of());

        controller = new ParentLinkController();
        ReflectionTestUtils.setField(controller, "parentLinkService", parentLinkService);
        ReflectionTestUtils.setField(controller, "instituteAccessValidator", new InstituteAccessValidator());

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", HERE);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        role(STAFF, HERE, "TEACHER");
        role(GUARDIAN, HERE, "PARENT");
    }

    @AfterEach
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private void role(String userId, String institute, String role) {
        Map<String, String> row = new HashMap<>();
        row.put("institute_id", institute);
        row.put("role_name", role);
        row.put("status", "ACTIVE");
        roleRows.computeIfAbsent(userId, k -> new ArrayList<>()).add(row);
    }

    private static CustomUserDetails caller(String userId, String... authorities) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        doReturn(Arrays.stream(authorities).map(SimpleGrantedAuthority::new).toList()).when(user).getAuthorities();
        when(user.getUserId()).thenReturn(userId);
        when(user.isRootUser()).thenReturn(true); // must not count: every account carries it
        return user;
    }

    private static ParentLinkActionRequestDTO linkExistingGuardian() {
        return ParentLinkActionRequestDTO.builder()
                .instituteId(HERE).direction("STUDENT_ADDS_PARENT").mode("LINK_EXISTING")
                .anchorUserId(STUDENT).existingUserId(GUARDIAN).build();
    }

    @Test
    void aLearnerTokenCannotLinkAGuardian() {
        role(STUDENT, HERE, "STUDENT");

        assertThatThrownBy(() -> controller.link(caller("learner-2", "STUDENT"), linkExistingGuardian()))
                .hasMessageContaining("staff");
        verify(authService, never()).linkParentChild(anyString(), anyString());
    }

    @Test
    void staffLinkAGuardianToALearnerOfThisInstituteOnly() {
        role(STUDENT, HERE, "STUDENT");

        assertThatCode(() -> parentLinkService.requireCanLink(caller(STAFF, "TEACHER"), linkExistingGuardian()))
                .doesNotThrowAnyException();
    }

    @Test
    void aLearnerWhoAlsoBelongsElsewhereNeedsAnAdminThere() {
        role(STUDENT, HERE, "STUDENT");
        role(STUDENT, ELSEWHERE, "STUDENT");

        assertThatThrownBy(() -> controller.link(caller(STAFF, "TEACHER"), linkExistingGuardian()))
                .hasMessageContaining("guardian");
        verify(authService, never()).linkParentChild(anyString(), anyString());
    }

    @Test
    void aLearnerOfAnotherInstituteOnlyCannotBeNamed() {
        role(STUDENT, ELSEWHERE, "STUDENT");

        assertThatThrownBy(() -> parentLinkService.requireCanLink(caller(STAFF, "TEACHER"), linkExistingGuardian()))
                .hasMessageContaining("belong to this institute");
    }

    @Test
    void aGuardianOfAnotherInstituteCannotBeNamed() {
        role(STUDENT, HERE, "STUDENT");
        roleRows.remove(GUARDIAN);
        role(GUARDIAN, ELSEWHERE, "PARENT");

        assertThatThrownBy(() -> parentLinkService.requireCanLink(caller(STAFF, "TEACHER"), linkExistingGuardian()))
                .hasMessageContaining("belong to this institute");
    }

    @Test
    void anExistingLearnerNamedForANewGuardianIsCheckedTheSameWay() {
        role(STUDENT, HERE, "STUDENT");
        role(STUDENT, ELSEWHERE, "ADMIN");
        NewGuardianLinkRequestDTO request = new NewGuardianLinkRequestDTO();
        request.setInstituteId(HERE);
        request.setMode("LINK_EXISTING");
        request.setStudentExistingUserId(STUDENT);

        assertThatThrownBy(() -> controller.linkNewGuardian(caller(STAFF, "TEACHER"), request))
                .hasMessageContaining("guardian");
        verify(authService, never()).createUserFromAuthService(org.mockito.ArgumentMatchers.any(), anyString(),
                org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    void creatingANewLearnerForAGuardianOfThisInstituteNeedsNoAccountCheck() {
        ParentLinkActionRequestDTO request = ParentLinkActionRequestDTO.builder()
                .instituteId(HERE).direction("PARENT_ADDS_STUDENT").mode("CREATE_NEW")
                .anchorUserId(GUARDIAN).newFullName("New Learner").newEmail("new@example.com").build();

        assertThatCode(() -> parentLinkService.requireCanLink(caller(STAFF, "TEACHER"), request))
                .doesNotThrowAnyException();
    }

    @Test
    void guardianCredentialExportIsForStaffOfTheInstitute() {
        assertThatThrownBy(() -> controller.exportCredentials(caller("learner-2", "STUDENT"), HERE))
                .hasMessageContaining("staff");
        assertThatThrownBy(() -> controller.exportCredentials(caller(STAFF, "TEACHER"), ELSEWHERE))
                .hasMessageContaining("does not belong");
    }
}
