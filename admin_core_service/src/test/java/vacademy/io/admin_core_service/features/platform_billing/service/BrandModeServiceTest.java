package vacademy.io.admin_core_service.features.platform_billing.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class BrandModeServiceTest {

    InstituteDomainRoutingRepository routing = mock(InstituteDomainRoutingRepository.class);
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    BrandModeService service;

    @BeforeEach
    void setUp() {
        service = new BrandModeService(routing, jdbc, "vacademy.io");
        when(jdbc.queryForList(eq(BrandModeService.SELECT_OVERRIDE), eq(String.class), anyString())).thenReturn(List.of());
        when(jdbc.queryForList(eq(BrandModeService.SELECT_ADMIN_BASE_URL), eq(String.class), anyString()))
                .thenReturn(List.of());
        when(routing.findByInstituteId(anyString())).thenReturn(List.of());
    }

    static InstituteDomainRouting row(String sub, String domain, String role) {
        InstituteDomainRouting r = new InstituteDomainRouting();
        r.setSubdomain(sub);
        r.setDomain(domain);
        r.setRole(role);
        return r;
    }

    @Test
    void noCustomDomainIsVacademy() {
        assertEquals(BrandMode.VACADEMY, service.resolve("i1"));
    }

    @Test
    void customAdminDomainIsNeutral() {
        when(routing.findByInstituteId("i1")).thenReturn(List.of(row("admin", "myschool.com", "ADMIN")));
        assertEquals(BrandMode.NEUTRAL, service.resolve("i1"));
    }

    @Test
    void commaSeparatedRolesAndWildcardSubdomainAreHonoured() {
        when(routing.findByInstituteId("i1")).thenReturn(List.of(row("*", "myschool.com", "TEACHER, ADMIN")));
        assertEquals(BrandMode.NEUTRAL, service.resolve("i1"));
    }

    @Test
    void vacademySubdomainForAdminStaysVacademy() {
        when(routing.findByInstituteId("i1")).thenReturn(List.of(row("myschool", "vacademy.io", "ADMIN")));
        assertEquals(BrandMode.VACADEMY, service.resolve("i1"));
    }

    @Test
    void learnerOnlyCustomDomainStaysVacademy() {
        when(routing.findByInstituteId("i1")).thenReturn(List.of(row("learn", "myschool.com", "LEARNER")));
        assertEquals(BrandMode.VACADEMY, service.resolve("i1"));
    }

    @Test
    void customAdminPortalBaseUrlIsNeutral() {
        when(jdbc.queryForList(eq(BrandModeService.SELECT_ADMIN_BASE_URL), eq(String.class), eq("i1")))
                .thenReturn(List.of("https://admin.myschool.com/"));
        assertEquals(BrandMode.NEUTRAL, service.resolve("i1"));
        when(jdbc.queryForList(eq(BrandModeService.SELECT_ADMIN_BASE_URL), eq(String.class), eq("i2")))
                .thenReturn(List.of("dash.vacademy.io"));
        assertEquals(BrandMode.VACADEMY, service.resolve("i2"));
    }

    @Test
    void superAdminOverrideWins() {
        when(routing.findByInstituteId("i1")).thenReturn(List.of(row("admin", "myschool.com", "ADMIN")));
        when(jdbc.queryForList(eq(BrandModeService.SELECT_OVERRIDE), eq(String.class), eq("i1")))
                .thenReturn(List.of("VACADEMY"));
        assertEquals(BrandMode.VACADEMY, service.resolve("i1"));
        when(jdbc.queryForList(eq(BrandModeService.SELECT_OVERRIDE), eq(String.class), eq("i2")))
                .thenReturn(List.of("NEUTRAL"));
        assertEquals(BrandMode.NEUTRAL, service.resolve("i2"));
    }

    @Test
    void anyLookupErrorIsNeutral() {
        when(routing.findByInstituteId("i1")).thenThrow(new RuntimeException("db down"));
        assertEquals(BrandMode.NEUTRAL, service.resolve("i1"));
        assertEquals(BrandMode.NEUTRAL, service.resolve(null));
    }

    @Test
    void resultIsCachedUntilInvalidated() {
        service.resolve("i1");
        service.resolve("i1");
        verify(routing, times(1)).findByInstituteId("i1");
        service.invalidate("i1");
        service.resolve("i1");
        verify(routing, times(2)).findByInstituteId("i1");
    }

    @Test
    void frozenSnapshotBeatsLiveResolution() {
        when(routing.findByInstituteId("i1")).thenReturn(List.of(row("admin", "myschool.com", "ADMIN")));
        assertEquals(BrandMode.VACADEMY, service.resolve("i1", "VACADEMY"));
        assertEquals(BrandMode.NEUTRAL, service.resolve("i1", null));
        assertEquals(BrandMode.NEUTRAL, service.resolve("i1", "garbage"));
    }

    @Test
    void vacademyOwnedHostRule() {
        assertTrue(service.isVacademyOwnedHost("vacademy.io"));
        assertTrue(service.isVacademyOwnedHost("DASH.Vacademy.io."));
        assertTrue(service.isVacademyOwnedHost("localhost"));
        assertFalse(service.isVacademyOwnedHost("notvacademy.io"));
        assertFalse(service.isVacademyOwnedHost("vacademy.io.evil.com"));
        assertFalse(service.isVacademyOwnedHost(null));
    }

    @Test
    void adminLinkNeverPointsNeutralTenantsAtVacademy() {
        assertNull(service.adminLinkBase("https://dash.vacademy.io", BrandMode.NEUTRAL));
        assertNull(service.adminLinkBase(null, BrandMode.NEUTRAL));
        assertEquals("https://admin.myschool.com", service.adminLinkBase("admin.myschool.com/", BrandMode.NEUTRAL));
        assertEquals("https://dash.vacademy.io", service.adminLinkBase("https://dash.vacademy.io", BrandMode.VACADEMY));
    }
}
