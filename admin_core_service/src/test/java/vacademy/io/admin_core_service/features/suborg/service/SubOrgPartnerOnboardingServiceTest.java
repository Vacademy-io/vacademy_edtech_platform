package vacademy.io.admin_core_service.features.suborg.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SubOrgPartnerOnboardingServiceTest {

    @Test
    void portalUrlAlwaysGetsASchemeAndNoTrailingSlash() {
        assertEquals("https://admin.example.org", SubOrgPartnerOnboardingService.normalizePortalUrl("admin.example.org"));
        assertEquals("https://admin.example.org", SubOrgPartnerOnboardingService.normalizePortalUrl("https://admin.example.org/"));
        assertEquals("http://localhost:5173", SubOrgPartnerOnboardingService.normalizePortalUrl("http://localhost:5173//"));
        assertEquals("", SubOrgPartnerOnboardingService.normalizePortalUrl("  "));
        assertEquals("", SubOrgPartnerOnboardingService.normalizePortalUrl(null));
    }
}
