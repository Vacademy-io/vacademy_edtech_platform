package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import vacademy.io.admin_core_service.features.audience.controller.AudienceController;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService;
import vacademy.io.admin_core_service.features.audience.service.UserLeadProfileService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.Collections;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * GET /user-audiences lists only the campaigns of one institute, and only to a caller who belongs
 * to it — a person who is a lead in two institutes must not expose one to the other's admins.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class UserAudiencesInstituteScopeTest {

    private static final String OWN = "inst-own";
    private static final String OTHER = "inst-other";
    private static final String LEAD = "user-lead";

    @Mock private UserLeadProfileService userLeadProfileService;
    @Mock private AudienceRoleAccessService audienceRoleAccessService;
    @InjectMocks private AudienceController controller;

    private CustomUserDetails adminOfHeaderInstitute() {
        CustomUserDetails user = mock(CustomUserDetails.class);
        doReturn(List.of(new SimpleGrantedAuthority("ADMIN"))).when(user).getAuthorities();
        return user;
    }

    private CustomUserDetails noRoles() {
        CustomUserDetails user = mock(CustomUserDetails.class);
        doReturn(Collections.emptyList()).when(user).getAuthorities();
        return user;
    }

    @Test
    @DisplayName("Current app: instituteId param + JWT role there → scoped to that institute")
    void scopesToRequestedInstitute() {
        when(audienceRoleAccessService.currentRequestRoles(OWN)).thenReturn(Set.of("ADMIN"));

        controller.getUserAudiences(LEAD, OWN, OWN, adminOfHeaderInstitute());

        verify(userLeadProfileService).getUserAudienceMemberships(LEAD, OWN);
    }

    @Test
    @DisplayName("Bundle cached from before the param: falls back to the clientId header, still scoped")
    void oldBundleWithoutParamUsesHeaderInstitute() {
        when(audienceRoleAccessService.currentRequestRoles(OWN)).thenReturn(Set.of("ADMIN"));

        controller.getUserAudiences(LEAD, null, OWN, adminOfHeaderInstitute());

        verify(userLeadProfileService).getUserAudienceMemberships(LEAD, OWN);
    }

    @Test
    @DisplayName("Role granted after the token was minted: DB roles for the header institute suffice")
    void staleJwtButDbRolesForSameInstitute() {
        when(audienceRoleAccessService.currentRequestRoles(OWN)).thenReturn(Collections.emptySet());

        controller.getUserAudiences(LEAD, OWN, OWN, adminOfHeaderInstitute());

        verify(userLeadProfileService).getUserAudienceMemberships(LEAD, OWN);
    }

    @Test
    @DisplayName("Admin of one institute naming another → 403, nothing read")
    void otherInstituteIsForbidden() {
        when(audienceRoleAccessService.currentRequestRoles(OTHER)).thenReturn(Collections.emptySet());

        assertThatThrownBy(() -> controller.getUserAudiences(LEAD, OTHER, OWN, adminOfHeaderInstitute()))
                .isInstanceOf(ForbiddenException.class);
        verify(userLeadProfileService, never()).getUserAudienceMemberships(anyString(), anyString());
    }

    @Test
    @DisplayName("Header names the institute but the caller holds no role there → 403")
    void noRolesAnywhereIsForbidden() {
        when(audienceRoleAccessService.currentRequestRoles(any())).thenReturn(Collections.emptySet());

        assertThatThrownBy(() -> controller.getUserAudiences(LEAD, OWN, OWN, noRoles()))
                .isInstanceOf(ForbiddenException.class);
        verify(userLeadProfileService, never()).getUserAudienceMemberships(anyString(), anyString());
    }

    @Test
    @DisplayName("No institute at all → 400, never the old platform-wide list")
    void missingInstituteIsRejected() {
        assertThatThrownBy(() -> controller.getUserAudiences(LEAD, null, null, adminOfHeaderInstitute()))
                .isInstanceOf(InvalidRequestException.class);
        verify(userLeadProfileService, never()).getUserAudienceMemberships(anyString(), anyString());
    }
}
