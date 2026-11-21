package vacademy.io.admin_core_service.features.audience;

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
import vacademy.io.admin_core_service.features.audience.controller.AudienceController;
import vacademy.io.admin_core_service.features.audience.dto.LeadProfileEditRequestDTO;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Editing a lead's profile (PUT /v1/audience/lead/{responseId}/profile), which writes the lead
 * account's e-mail and mobile number, needs staff of the institute whose lead list holds the lead.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LeadProfileEditStaffOnlyTest {

    private static final String OWN = "inst-own";
    private static final String OTHER = "inst-other";
    private static final String LEAD = "resp-1";

    @Mock private AudienceService audienceService;
    @Spy private InstituteAccessValidator instituteAccessValidator = new InstituteAccessValidator();
    @InjectMocks private AudienceController controller;

    @BeforeEach
    void headerIsOwnInstitute() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", OWN);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails withAuthorities(String... names) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        doReturn(Arrays.stream(names).map(SimpleGrantedAuthority::new).toList()).when(user).getAuthorities();
        when(user.getUserId()).thenReturn("user-1");
        when(user.isRootUser()).thenReturn(true); // must not count: every learner carries it
        return user;
    }

    @Test
    void staffOfTheLeadsInstituteEditsTheLead() {
        when(audienceService.getInstituteIdOfLead(LEAD)).thenReturn(OWN);
        LeadProfileEditRequestDTO edit = new LeadProfileEditRequestDTO();

        controller.updateLeadProfile(LEAD, edit, withAuthorities("COUNSELLOR"));

        verify(audienceService).updateLeadProfile(eq(LEAD), eq(edit), any());
    }

    @Test
    void learnerIsRefusedAndNothingChanges() {
        when(audienceService.getInstituteIdOfLead(LEAD)).thenReturn(OWN);

        assertThatThrownBy(() -> controller.updateLeadProfile(LEAD, new LeadProfileEditRequestDTO(),
                withAuthorities("STUDENT"))).isInstanceOf(ForbiddenException.class);
        verify(audienceService, never()).updateLeadProfile(anyString(), any(), any());
    }

    @Test
    void leadOfAnotherInstituteIsRefused() {
        when(audienceService.getInstituteIdOfLead(LEAD)).thenReturn(OTHER);

        assertThatThrownBy(() -> controller.updateLeadProfile(LEAD, new LeadProfileEditRequestDTO(),
                withAuthorities("ADMIN"))).isInstanceOf(ForbiddenException.class);
        verify(audienceService, never()).updateLeadProfile(anyString(), any(), any());
    }

    @Test
    void leadWithoutAListIsRefused() {
        when(audienceService.getInstituteIdOfLead(LEAD)).thenReturn(null);

        assertThatThrownBy(() -> controller.updateLeadProfile(LEAD, new LeadProfileEditRequestDTO(),
                withAuthorities("ADMIN"))).isInstanceOf(RuntimeException.class);
        verify(audienceService, never()).updateLeadProfile(anyString(), any(), any());
    }
}
