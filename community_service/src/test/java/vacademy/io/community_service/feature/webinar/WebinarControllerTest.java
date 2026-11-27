package vacademy.io.community_service.feature.webinar;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.community_service.feature.dashboardwidget.service.LeadTagResolver;
import vacademy.io.community_service.feature.webinar.controller.WebinarController;
import vacademy.io.community_service.feature.webinar.service.WebinarService;

import java.util.Collection;
import java.util.List;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WebinarControllerTest {

    @Mock
    private WebinarService service;
    @Mock
    private LeadTagResolver leadTagResolver;
    @InjectMocks
    private WebinarController controller;

    private static CustomUserDetails userWith(String... authorities) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        List<GrantedAuthority> auths = java.util.Arrays.stream(authorities)
                .<GrantedAuthority>map(SimpleGrantedAuthority::new).toList();
        lenient().when(user.getAuthorities()).thenAnswer(inv -> (Collection<? extends GrantedAuthority>) auths);
        return user;
    }

    @Test
    @DisplayName("only an admin of a PROD institute gets the one-click live class")
    void prodAdminsOnly() {
        lenient().when(leadTagResolver.resolve("inst-prod")).thenReturn("PROD");
        lenient().when(leadTagResolver.resolve("inst-test")).thenReturn("TEST");
        lenient().when(leadTagResolver.resolve("inst-none")).thenReturn(null);

        controller.list(userWith("ADMIN"), "inst-prod");
        verify(service).listPublished(true);

        controller.list(userWith("ADMIN"), "inst-test");
        controller.list(userWith("ADMIN"), "inst-none");
        controller.list(userWith("TEACHER"), "inst-prod");
        controller.list(userWith("ADMIN"), null);
        verify(service, org.mockito.Mockito.times(4)).listPublished(false);
    }

    @Test
    @DisplayName("a non-admin never triggers the lead-tag lookup")
    void noLookupForNonAdmins() {
        controller.list(userWith("TEACHER", "COUNSELLOR"), "inst-prod");
        verify(leadTagResolver, never()).resolve(anyString());
        verify(service).listPublished(false);
    }

    @Test
    @DisplayName("the admin role is matched case-insensitively (custom roles named 'Admin')")
    void adminCaseInsensitive() {
        when(leadTagResolver.resolve("inst-prod")).thenReturn("prod");
        controller.list(userWith("admin"), " inst-prod ");
        verify(service).listPublished(true);
    }
}
