package vacademy.io.auth_service.feature.login_link.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.login_link.entity.InstituteLoginLinkPolicy;
import vacademy.io.auth_service.feature.login_link.enums.LoginLinkRoute;
import vacademy.io.auth_service.feature.login_link.repository.InstituteLoginLinkPolicyRepository;
import vacademy.io.auth_service.feature.login_link.repository.LearnerLoginCodeRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * "Require login code" with per-route exemptions: an institute can let, say, the subscription
 * link keep signing members in from the username while every other link needs a code.
 */
class LoginCodeRouteExemptionTest {

    private InstituteLoginLinkPolicyRepository policies;
    private UserRoleRepository roles;
    private LoginCodeService service;

    private static InstituteLoginLinkPolicy policy(String id, String routes) {
        return InstituteLoginLinkPolicy.builder().instituteId(id).requireLoginCode(true).codeFreeRoutes(routes).build();
    }

    @BeforeEach
    void setUp() {
        policies = mock(InstituteLoginLinkPolicyRepository.class);
        roles = mock(UserRoleRepository.class);
        service = new LoginCodeService(mock(LearnerLoginCodeRepository.class), policies,
                mock(UserRepository.class), roles);
        when(roles.findDistinctInstituteIdsByUserId("u-1")).thenReturn(List.of("vet"));
    }

    @Test
    @DisplayName("an exempt route signs in without a code; other routes still need one")
    void exemptRoute() {
        when(policies.findByRequireLoginCodeTrueAndInstituteIdIn(anyCollection()))
                .thenReturn(List.of(policy("vet", "SUBSCRIPTIONS")));
        assertFalse(service.anyInstituteRequiresCode("u-1", "vet", LoginLinkRoute.SUBSCRIPTIONS));
        assertTrue(service.anyInstituteRequiresCode("u-1", "vet", LoginLinkRoute.GO));
        assertTrue(service.anyInstituteRequiresCode("u-1", "vet", LoginLinkRoute.LIVE_CLASS));
    }

    @Test
    @DisplayName("no route reported = the old rule: a code is required")
    void noRoute() {
        when(policies.anyRequiresLoginCode(anyCollection())).thenReturn(true);
        assertTrue(service.anyInstituteRequiresCode("u-1", "vet", null));
        assertTrue(service.anyInstituteRequiresCode("u-1", "vet"));
    }

    @Test
    @DisplayName("every institute requiring a code must exempt the route")
    void allInstitutesMustExempt() {
        when(roles.findDistinctInstituteIdsByUserId("u-1")).thenReturn(List.of("vet", "other"));
        when(policies.findByRequireLoginCodeTrueAndInstituteIdIn(anyCollection()))
                .thenReturn(List.of(policy("vet", "SUBSCRIPTIONS"), policy("other", null)));
        assertTrue(service.anyInstituteRequiresCode("u-1", "vet", LoginLinkRoute.SUBSCRIPTIONS));
    }

    @Test
    @DisplayName("no institute requires a code = nothing to exempt")
    void nothingRequired() {
        when(policies.findByRequireLoginCodeTrueAndInstituteIdIn(anyCollection())).thenReturn(List.of());
        assertFalse(service.anyInstituteRequiresCode("u-1", "vet", LoginLinkRoute.GO));
    }

    @Test
    @DisplayName("saving routes keeps the switch, stores names in a fixed order; unknown stored names are ignored")
    void saveRoutes() {
        InstituteLoginLinkPolicy existing = policy("vet", null);
        when(policies.findById("vet")).thenReturn(Optional.of(existing));
        when(policies.save(any())).thenAnswer(i -> i.getArgument(0));

        InstituteLoginLinkPolicy saved = service.savePolicy("vet", null,
                List.of(LoginLinkRoute.SUBSCRIPTIONS, LoginLinkRoute.GO), "admin-1");
        assertTrue(saved.isRequireLoginCode());
        assertEquals("GO,SUBSCRIPTIONS", saved.getCodeFreeRoutes());

        saved.setCodeFreeRoutes("SUBSCRIPTIONS,NOT_A_ROUTE");
        assertEquals(Set.of(LoginLinkRoute.SUBSCRIPTIONS), saved.codeFreeRouteSet());

        assertNull(service.savePolicy("vet", false, List.of(), "admin-1").getCodeFreeRoutes());
    }
}
