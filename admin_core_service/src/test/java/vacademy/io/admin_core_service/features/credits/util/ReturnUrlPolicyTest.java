package vacademy.io.admin_core_service.features.credits.util;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.BrandModeService;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** F8: the Razorpay callback URL is limited to Vacademy-owned hosts and the institute's own domains. */
class ReturnUrlPolicyTest {

    private InstituteDomainRoutingRepository routing;
    private InstituteRepository institutes;
    private ReturnUrlPolicy policy;

    private static InstituteDomainRouting row(String sub, String domain, String inst) {
        InstituteDomainRouting r = new InstituteDomainRouting();
        r.setSubdomain(sub);
        r.setDomain(domain);
        r.setInstituteId(inst);
        r.setRole("ADMIN");
        return r;
    }

    @BeforeEach
    void setUp() {
        routing = mock(InstituteDomainRoutingRepository.class);
        institutes = mock(InstituteRepository.class);
        BrandModeService brand = new BrandModeService(routing, null, "vacademy.io");
        policy = new ReturnUrlPolicy(routing, institutes, brand);
        when(routing.findByInstituteId("inst-1")).thenReturn(List.of(
                row("admin", "shikshanation.com", "inst-1"), row("*", "myschool.in", "inst-1")));
        Institute inst = new Institute();
        inst.setId("inst-1");
        inst.setAdminPortalBaseUrl("https://portal.legacy-host.com/");
        when(institutes.findById("inst-1")).thenReturn(Optional.of(inst));
    }

    @Test
    void vacademyHostsAreAllowed() {
        String u = "https://dash.vacademy.io/settings?selectedTab=aiSettings";
        assertEquals(u, policy.sanitize("inst-1", u));
        assertNotNull(policy.sanitize("inst-1", "https://vacademy.io/x"));
        assertNotNull(policy.sanitize("inst-1", "http://localhost:5173/settings"));
        assertEquals("https://dash.vacademy.io/s?a=1", policy.sanitize("inst-1", "https://dash.vacademy.io/s?a=1#frag"));
    }

    @Test
    void theInstitutesOwnDomainsAreAllowed() {
        assertNotNull(policy.sanitize("inst-1", "https://admin.shikshanation.com/settings?a=1"));
        assertNotNull(policy.sanitize("inst-1", "https://anything.myschool.in/x"));
        assertNotNull(policy.sanitize("inst-1", "https://myschool.in/x"));
        assertNotNull(policy.sanitize("inst-1", "https://portal.legacy-host.com/settings"));
    }

    @Test
    void everythingElseIsRefused() {
        assertNull(policy.sanitize("inst-1", "https://evil.example/phish"));
        assertNull(policy.sanitize("inst-1", "https://shikshanation.com/"), "only the routed subdomain");
        assertNull(policy.sanitize("inst-1", "https://vacademy.io.evil.example/"));
        assertNull(policy.sanitize("inst-1", "http://dash.vacademy.io/"), "plain http off localhost");
        assertNull(policy.sanitize("inst-1", "javascript:alert(1)"));
        assertNull(policy.sanitize("inst-1", "https://user@dash.vacademy.io/"));
        assertNull(policy.sanitize("inst-1", "not a url"));
        assertNull(policy.sanitize("inst-1", "  "));
        assertNull(policy.sanitize("inst-2", "https://admin.shikshanation.com/"), "another institute's domain");
    }
}
