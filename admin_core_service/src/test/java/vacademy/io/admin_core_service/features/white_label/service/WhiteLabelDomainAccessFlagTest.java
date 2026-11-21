package vacademy.io.admin_core_service.features.white_label.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.domain_routing.service.DomainRoutingAdminService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.live_session.client.InstituteRoleUserClient;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * white-label.domain-access.require-membership: off (default) keeps the root-flag shortcut;
 * on, only an institute ADMIN, a legacy staff member or an allowlisted super admin passes.
 */
class WhiteLabelDomainAccessFlagTest {

    private static final String INSTITUTE = "inst-1";

    private WhiteLabelService service;
    private InstituteRoleUserClient roles;
    private InstituteRepository institutes;

    @BeforeEach
    void setUp() {
        roles = Mockito.mock(InstituteRoleUserClient.class);
        institutes = Mockito.mock(InstituteRepository.class);
        when(roles.findRolesOfUser(anyString(), anyString())).thenReturn(Optional.of(Set.of()));
        when(institutes.findInstitutesByUserId(anyString())).thenReturn(List.of());
        CloudflareService cloudflare = Mockito.mock(CloudflareService.class);
        service = new WhiteLabelService(institutes, Mockito.mock(InstituteDomainRoutingRepository.class),
                Mockito.mock(DomainRoutingAdminService.class), cloudflare, roles,
                new PortalUrlReconciler(cloudflare));
        ReflectionTestUtils.setField(service, "instituteAccessValidator", new InstituteAccessValidator() {
            @Override
            public boolean isPlatformSuperAdmin(CustomUserDetails user) {
                return user != null && "ops-1".equals(user.getUserId());
            }
        });
    }

    private static CustomUserDetails principal(String userId, boolean root) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setRootUser(root);
        dto.setAuthorities(List.of());
        return new CustomUserDetails(dto);
    }

    private boolean hasAccess(CustomUserDetails user) {
        return Boolean.TRUE.equals(ReflectionTestUtils.invokeMethod(service, "hasInstituteAccess", user, INSTITUTE));
    }

    @Test
    @DisplayName("flag off (default): a root-flag account passes as before")
    void flagOffKeepsRootShortcut() {
        assertTrue(hasAccess(principal("u-1", true)));
        assertFalse(hasAccess(principal("u-2", false)));
    }

    @Test
    @DisplayName("flag on: root flag alone is refused; institute ADMIN and allowlisted super admin pass")
    void flagOnNeedsMembership() {
        ReflectionTestUtils.setField(service, "requireMembershipForDomains", true);
        assertFalse(hasAccess(principal("u-1", true)));

        when(roles.findRolesOfUser(INSTITUTE, "u-3")).thenReturn(Optional.of(Set.of("ADMIN")));
        assertTrue(hasAccess(principal("u-3", true)));
        assertTrue(hasAccess(principal("ops-1", false)));
    }
}
