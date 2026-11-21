package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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
import vacademy.io.admin_core_service.features.audience.dto.AudienceDTO;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.Arrays;
import java.util.Collections;
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
 * Creating or deleting a lead list needs staff of the list's institute: the body's
 * institute on create, the path's on delete, matched against the clientId header the
 * caller's authorities were minted for.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AudienceCampaignInstituteGuardTest {

    private static final String OWN = "inst-own";
    private static final String OTHER = "inst-other";

    @Mock private AudienceService audienceService;
    @Mock private AudienceRoleAccessService audienceRoleAccessService;
    @Spy private InstituteAccessValidator instituteAccessValidator = new InstituteAccessValidator();
    @InjectMocks private AudienceController controller;

    @BeforeEach
    void headerIsOwnInstitute() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", OWN);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        when(audienceService.createCampaign(any())).thenReturn("aud-new");
    }

    @AfterEach
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails withAuthorities(String... names) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        doReturn(Arrays.stream(names).map(SimpleGrantedAuthority::new).toList())
                .when(user).getAuthorities();
        when(user.getUserId()).thenReturn("user-1");
        return user;
    }

    private static AudienceDTO dto(String instituteId) {
        AudienceDTO dto = new AudienceDTO();
        dto.setInstituteId(instituteId);
        dto.setCampaignName("Spring intake");
        return dto;
    }

    @Test
    @DisplayName("Staff of the header institute creates a list there")
    void staffCreatesInOwnInstitute() {
        controller.createCampaign(dto(OWN), withAuthorities("ADMIN"));
        verify(audienceService).createCampaign(any());
    }

    @Test
    @DisplayName("Counsellor-only staff may still create lists")
    void counsellorCreates() {
        controller.createCampaign(dto(OWN), withAuthorities("COUNSELLOR"));
        verify(audienceService).createCampaign(any());
    }

    @Test
    @DisplayName("Body naming another institute is refused, nothing is created")
    void createInOtherInstituteRefused() {
        assertThatThrownBy(() -> controller.createCampaign(dto(OTHER), withAuthorities("ADMIN")))
                .isInstanceOf(ForbiddenException.class);
        verify(audienceService, never()).createCampaign(any());
    }

    @Test
    @DisplayName("An account with no role in the header institute is refused")
    void accountWithoutRoleRefused() {
        CustomUserDetails outsider = mock(CustomUserDetails.class);
        when(outsider.isRootUser()).thenReturn(true);
        doReturn(Collections.emptyList()).when(outsider).getAuthorities();

        assertThatThrownBy(() -> controller.createCampaign(dto(OWN), outsider))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> controller.deleteCampaign(OWN, "aud-1", outsider))
                .isInstanceOf(ForbiddenException.class);
        verify(audienceService, never()).createCampaign(any());
        verify(audienceService, never()).deleteCampaign(anyString(), anyString());
    }

    @Test
    @DisplayName("A learner cannot create or delete lists")
    void learnerRefused() {
        CustomUserDetails learner = withAuthorities("STUDENT");
        assertThatThrownBy(() -> controller.createCampaign(dto(OWN), learner))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> controller.deleteCampaign(OWN, "aud-1", learner))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("Missing institute in the body is refused")
    void createWithoutInstituteRefused() {
        assertThatThrownBy(() -> controller.createCampaign(dto(null), withAuthorities("ADMIN")))
                .isInstanceOf(RuntimeException.class);
        verify(audienceService, never()).createCampaign(any());
    }

    @Test
    @DisplayName("Staff deletes a list of their own institute")
    void staffDeletesInOwnInstitute() {
        controller.deleteCampaign(OWN, "aud-1", withAuthorities("ADMIN"));
        verify(audienceService).deleteCampaign("aud-1", OWN);
    }

    @Test
    @DisplayName("Delete with another institute in the path is refused")
    void deleteInOtherInstituteRefused() {
        assertThatThrownBy(() -> controller.deleteCampaign(OTHER, "aud-1", withAuthorities("ADMIN")))
                .isInstanceOf(ForbiddenException.class);
        verify(audienceService, never()).deleteCampaign(anyString(), anyString());
    }

    // ── No clientId header: the website builder's create calls on an older bundle ─────────

    private void noClientIdHeader() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
    }

    @Test
    @DisplayName("No header: staff role for the body institute in the JWT still creates (website builder)")
    void noHeaderStaffInJwtCreates() {
        noClientIdHeader();
        when(audienceRoleAccessService.currentRequestRoles(OWN)).thenReturn(Set.of("ADMIN"));
        controller.createCampaign(dto(OWN), withAuthorities());
        verify(audienceService).createCampaign(any());
    }

    @Test
    @DisplayName("No header: counsellor role in the JWT still creates")
    void noHeaderCounsellorCreates() {
        noClientIdHeader();
        when(audienceRoleAccessService.currentRequestRoles(OWN)).thenReturn(Set.of("COUNSELLOR", "STUDENT"));
        controller.createCampaign(dto(OWN), withAuthorities());
        verify(audienceService).createCampaign(any());
    }

    @Test
    @DisplayName("No header: no role for that institute in the JWT is refused")
    void noHeaderNoRoleThereRefused() {
        noClientIdHeader();
        when(audienceRoleAccessService.currentRequestRoles(OTHER)).thenReturn(Set.of());
        assertThatThrownBy(() -> controller.createCampaign(dto(OTHER), withAuthorities()))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> controller.deleteCampaign(OTHER, "aud-1", withAuthorities()))
                .isInstanceOf(ForbiddenException.class);
        verify(audienceService, never()).createCampaign(any());
        verify(audienceService, never()).deleteCampaign(anyString(), anyString());
    }

    @Test
    @DisplayName("No header: a learner-only JWT is refused")
    void noHeaderLearnerRefused() {
        noClientIdHeader();
        when(audienceRoleAccessService.currentRequestRoles(OWN)).thenReturn(Set.of("STUDENT", "TEACHER"));
        assertThatThrownBy(() -> controller.createCampaign(dto(OWN), withAuthorities()))
                .isInstanceOf(ForbiddenException.class);
        verify(audienceService, never()).createCampaign(any());
    }

    @Test
    @DisplayName("No header and no institute in the body is refused")
    void noHeaderNoInstituteRefused() {
        noClientIdHeader();
        assertThatThrownBy(() -> controller.createCampaign(dto(null), withAuthorities()))
                .isInstanceOf(ForbiddenException.class);
        verify(audienceService, never()).createCampaign(any());
    }
}
