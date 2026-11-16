package vacademy.io.admin_core_service.features.learner.controller;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner.dto.SubOrgEnrollRequestDTO;
import vacademy.io.admin_core_service.features.learner.service.SubOrgLearnerService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgAccessScopeService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Adding a sub-organization member (POST /sub-org/v1/add-member) is for staff of the institute or
 * an admin of that sub-organization.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SubOrgAddMemberAccessTest {

    private static final String INSTITUTE = "inst-1";
    private static final String SUB_ORG = "sub-1";

    @Mock private SubOrgLearnerService subOrgLearnerService;
    @Mock private SubOrgAccessScopeService subOrgAccessScopeService;
    @Spy private InstituteAccessValidator instituteAccessValidator = new InstituteAccessValidator();
    @InjectMocks private SubOrgLearnerController controller;

    @BeforeEach
    void header() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INSTITUTE);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails caller(String userId, String... authorities) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        doReturn(Arrays.stream(authorities).map(SimpleGrantedAuthority::new).toList()).when(user).getAuthorities();
        when(user.getUserId()).thenReturn(userId);
        when(user.isRootUser()).thenReturn(true); // must not count: every account carries it
        return user;
    }

    private static SubOrgEnrollRequestDTO request() {
        SubOrgEnrollRequestDTO request = new SubOrgEnrollRequestDTO();
        request.setInstituteId(INSTITUTE);
        request.setSubOrgId(SUB_ORG);
        return request;
    }

    @Test
    void aLearnerWhoIsNoSubOrgAdminIsRefused() {
        assertThatThrownBy(() -> controller.enrollLearner(request(), caller("learner-1", "STUDENT")))
                .hasMessageContaining("staff");
        verify(subOrgLearnerService, never()).enrollLearnerToSubOrg(any(), any());
    }

    @Test
    void staffOfAnotherInstituteAreRefused() {
        SubOrgEnrollRequestDTO request = request();
        request.setInstituteId("inst-other");

        assertThatThrownBy(() -> controller.enrollLearner(request, caller("admin-2", "ADMIN")))
                .hasMessageContaining("does not belong");
        verify(subOrgLearnerService, never()).enrollLearnerToSubOrg(any(), any());
    }

    @Test
    void staffOfTheInstituteAddMembers() {
        controller.enrollLearner(request(), caller("admin-1", "ADMIN"));

        verify(subOrgAccessScopeService).assertNotCrossSubOrg(any(), anyString());
        verify(subOrgLearnerService).enrollLearnerToSubOrg(any(), any());
    }

    @Test
    void anAdminOfTheSubOrgAddsMembersFromTheLearnerPortal() {
        RequestContextHolder.resetRequestAttributes(); // the learner portal sends no clientId
        when(subOrgLearnerService.isActiveAdminOfSubOrg("sub-admin-1", SUB_ORG, INSTITUTE)).thenReturn(true);

        controller.enrollLearner(request(), caller("sub-admin-1", "STUDENT"));

        verify(subOrgLearnerService).enrollLearnerToSubOrg(any(), any());
    }
}
