package vacademy.io.admin_core_service.features.site_assistant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;
import vacademy.io.admin_core_service.features.catalog_api.settings.CatalogSiteResolver;
import vacademy.io.admin_core_service.features.catalog_api.settings.InstituteCatalogApiSettingsRepository;
import vacademy.io.admin_core_service.features.catalog_api.website.InstituteWebsiteService;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CatalogueInstituteMapping;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository;
import vacademy.io.admin_core_service.features.domain_routing.dto.DomainRoutingResolveResponse;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.domain_routing.service.DomainRoutingService;
import vacademy.io.admin_core_service.features.domain_routing.service.LearnerPortalUrlResolver;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.site_assistant.service.SiteAssistantSiteService;

import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** resolve-site (host → institute + site, as the hosted site resolves it) and origin-check. */
class SiteAssistantSiteServiceTest {

    static final String BV = CatalogTestData.BV_INSTITUTE;

    DomainRoutingService routing;
    CatalogueInstituteMappingRepository catalogues;
    InstituteWebsiteService websites;
    SiteAssistantSiteService service;

    @BeforeEach
    void setUp() {
        routing = mock(DomainRoutingService.class);
        catalogues = mock(CatalogueInstituteMappingRepository.class);
        websites = mock(InstituteWebsiteService.class);
        CatalogSiteResolver resolver = new CatalogSiteResolver(mock(InstituteCatalogApiSettingsRepository.class),
                mock(InstituteDomainRoutingRepository.class), catalogues, mock(InstituteRepository.class),
                mock(LearnerPortalUrlResolver.class));
        service = new SiteAssistantSiteService(routing, resolver, websites);

        // Brahm Varchas as prod's public resolve endpoint returns it: LEARNER row, redirect /store, no root tag.
        DomainRoutingResolveResponse bv = CatalogTestData.MAPPER.convertValue(
                CatalogTestData.json("bv_domain_resolve.json"), DomainRoutingResolveResponse.class);
        assertEquals("/store", bv.getRedirect());
        assertNull(bv.getRootCatalogueTag());
        when(routing.resolve("brahmvarchas.org", "learning")).thenReturn(Optional.of(bv));
        when(catalogues.findByInstituteIdAndTagName(eq(BV), eq("store"), anyList()))
                .thenReturn(Optional.of(new CatalogueInstituteMapping()));
        when(catalogues.findByInstituteIdAndTagName(eq(BV), eq("events"), anyList()))
                .thenReturn(Optional.of(new CatalogueInstituteMapping()));
    }

    @Test
    void learningBrahmVarchasResolvesToTheStore() {
        for (String host : new String[]{"learning.brahmvarchas.org", "https://learning.brahmvarchas.org",
                "https://Learning.BrahmVarchas.org/store/courses?x=1", "learning.brahmvarchas.org:443",
                "learning.brahmvarchas.org."}) {
            SiteAssistantSiteService.ResolvedSite site = service.resolveSite(host, null).orElseThrow(() ->
                    new AssertionError(host));
            assertEquals(BV, site.instituteId(), host);
            assertEquals("store", site.siteTag(), host);
        }
    }

    @Test
    void aTagTheVisitorIsOnWinsOnlyWhenItIsACatalogueOfThatInstitute() {
        assertEquals("events", service.resolveSite("learning.brahmvarchas.org", "events").orElseThrow().siteTag());
        // Not a catalogue of BV: falls back to the host's own site, never to the browser's word.
        assertEquals("store", service.resolveSite("learning.brahmvarchas.org", "someone-else").orElseThrow().siteTag());
        assertEquals("store", service.resolveSite("learning.brahmvarchas.org", "../x").orElseThrow().siteTag());
    }

    @Test
    void aRootMountedHostUsesItsRootTagAndAnApexUsesTheWildcardRow() {
        DomainRoutingResolveResponse root = DomainRoutingResolveResponse.builder()
                .instituteId("inst-2").rootCatalogueTag("home").redirect("/login").build();
        when(routing.resolve("example.org", "*")).thenReturn(Optional.of(root));
        assertEquals("home", service.resolveSite("example.org", null).orElseThrow().siteTag());
        verify(routing).resolve("example.org", "*");
    }

    @Test
    void unknownOrSiteLessHostsDoNotResolve() {
        assertTrue(service.resolveSite("unknown.example.com", null).isEmpty());
        assertTrue(service.resolveSite("localhost:3000", null).isEmpty());
        assertTrue(service.resolveSite("not a host", null).isEmpty());
        assertTrue(service.resolveSite("", null).isEmpty());
        DomainRoutingResolveResponse admin = DomainRoutingResolveResponse.builder()
                .instituteId(BV).redirect("/dashboard").build();
        when(routing.resolve("brahmvarchas.org", "admin")).thenReturn(Optional.of(admin));
        assertTrue(service.resolveSite("admin.brahmvarchas.org", null).isEmpty(), "no catalogue named dashboard");
    }

    @Test
    void originCheckAllowsVerifiedHostsTheirSubdomainsAndLocalhostOnly() {
        when(websites.verifiedHosts("inst-1")).thenReturn(Set.of("x.com", "learn.acme.in"));
        assertTrue(service.originAllowed("inst-1", "x.com"));
        assertTrue(service.originAllowed("inst-1", "www.x.com"));
        assertTrue(service.originAllowed("inst-1", "https://www.x.com"));
        assertTrue(service.originAllowed("inst-1", "https://a.b.x.com:8443/page"));
        assertTrue(service.originAllowed("inst-1", "learn.acme.in"));
        assertTrue(service.originAllowed("inst-1", "localhost:3000"));
        assertTrue(service.originAllowed("inst-1", "http://127.0.0.1:5173"));
        assertTrue(service.originAllowed("inst-1", "X.COM."));

        assertFalse(service.originAllowed("inst-1", "evilx.com"));
        assertFalse(service.originAllowed("inst-1", "x.com.evil.io"));
        assertFalse(service.originAllowed("inst-1", "acme.in"), "a parent of a verified host is not covered");
        assertFalse(service.originAllowed("inst-1", "https://x.com@evil.io"));
        assertFalse(service.originAllowed("inst-1", "null"));
        assertFalse(service.originAllowed("inst-1", "file:///etc/passwd"));
        assertFalse(service.originAllowed("inst-1", ""));
        assertFalse(service.originAllowed("inst-1", null));
        assertFalse(service.originAllowed("inst-1", "foo.localhost"));

        // Another institute's verified site is not this institute's.
        when(websites.verifiedHosts("inst-2")).thenReturn(Set.of());
        assertFalse(service.originAllowed("inst-2", "www.x.com"));
    }
}
