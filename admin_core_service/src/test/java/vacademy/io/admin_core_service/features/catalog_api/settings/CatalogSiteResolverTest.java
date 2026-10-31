package vacademy.io.admin_core_service.features.catalog_api.settings;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class CatalogSiteResolverTest {

    /** Brahm Varchas' LEARNER row as prod's public resolve endpoint returns it (bv_domain_resolve.json). */
    static InstituteDomainRouting bvLearnerRow() {
        JsonNode r = CatalogTestData.json("bv_domain_resolve.json");
        assertEquals("LEARNER", r.get("role").asText());
        assertEquals("/store", r.get("redirect").asText());
        assertTrue(r.get("rootCatalogueTag").isNull());
        return InstituteDomainRouting.builder().instituteId(CatalogTestData.BV_INSTITUTE)
                .domain("brahmvarchas.org").subdomain("learning").role(r.get("role").asText())
                .redirect(r.get("redirect").asText()).rootCatalogueTag(null).build();
    }

    static InstituteDomainRouting row(String sub, String domain, String role, String redirect, String rootTag,
                                      boolean primary) {
        return InstituteDomainRouting.builder().subdomain(sub).domain(domain).role(role).redirect(redirect)
                .rootCatalogueTag(rootTag).primary(primary).build();
    }

    @Test
    void brahmVarchasResolvesToTheStoreOnItsLearningDomain() {
        List<InstituteDomainRouting> rows = List.of(
                row("admin", "brahmvarchas.org", "ADMIN", "/dashboard", null, true),
                bvLearnerRow());
        CatalogSiteResolver.Resolution r = CatalogSiteResolver.resolve(null, rows, Set.of("store")::contains,
                () -> "some-old-default", () -> "https://learner.vacademy.io");
        assertEquals("store", r.siteTag());
        assertEquals(CatalogSiteResolver.SOURCE_DOMAIN_ROUTING, r.siteTagSource());
        assertEquals("https://learning.brahmvarchas.org/store", r.courseBaseUrl());
        assertEquals(CatalogSiteResolver.SOURCE_DOMAIN_ROUTING, r.source());
    }

    @Test
    void settingsWin() {
        InstituteCatalogApiSettings s = InstituteCatalogApiSettings.builder().siteTag("new")
                .courseBaseUrl("https://courses.example.com/x/").build();
        CatalogSiteResolver.Resolution r = CatalogSiteResolver.resolve(s, List.of(bvLearnerRow()), t -> true,
                () -> null, () -> null);
        assertEquals("new", r.siteTag());
        assertEquals(CatalogSiteResolver.SOURCE_SETTINGS, r.siteTagSource());
        assertEquals("https://courses.example.com/x", r.courseBaseUrl());
        assertEquals(CatalogSiteResolver.SOURCE_SETTINGS, r.source());

        // a site tag override still derives the URL from routing: /<tag> because the root is not that site
        CatalogSiteResolver.Resolution tagOnly = CatalogSiteResolver.resolve(
                InstituteCatalogApiSettings.builder().siteTag("new").build(), List.of(bvLearnerRow()), t -> true,
                () -> null, () -> null);
        assertEquals("https://learning.brahmvarchas.org/new", tagOnly.courseBaseUrl());
    }

    @Test
    void aRootMountedCatalogueHasNoTagInItsUrl() {
        List<InstituteDomainRouting> rows = List.of(
                row("*", "localhost", "LEARNER", "/x", "x", true),         // unreachable: skipped
                row("*", "school.example", "LEARNER", "/courses", null, false),
                row("www", "school.example", "LEARNER", null, "main", false));
        CatalogSiteResolver.Resolution r = CatalogSiteResolver.resolve(null, rows, t -> false, () -> null, () -> null);
        assertEquals("main", r.siteTag());
        assertEquals("https://www.school.example", r.courseBaseUrl());
    }

    @Test
    void aRedirectThatIsNoCatalogueFallsBackToTheDefaultCatalogue() {
        List<InstituteDomainRouting> rows = List.of(row("learn", "x.com", "LEARNER", "/study-library", null, true));
        CatalogSiteResolver.Resolution r = CatalogSiteResolver.resolve(null, rows, t -> false, () -> "home", () -> null);
        assertEquals("home", r.siteTag());
        assertEquals(CatalogSiteResolver.SOURCE_DEFAULT_CATALOGUE, r.siteTagSource());
        assertEquals("https://learn.x.com/home", r.courseBaseUrl());
    }

    @Test
    void noRoutingUsesTheLearnerPortalBaseUrl() {
        CatalogSiteResolver.Resolution r = CatalogSiteResolver.resolve(null, List.of(), t -> false, () -> "home",
                () -> "https://portal.example.com/");
        assertEquals("https://portal.example.com/home", r.courseBaseUrl());
        assertEquals(CatalogSiteResolver.SOURCE_LEARNER_PORTAL, r.source());
    }

    @Test
    void prefersARowThatServesTheSiteThenAPrimaryOne() {
        List<InstituteDomainRouting> rows = List.of(
                row("old", "brand.com", "LEARNER", "/store", null, false),
                row("learn", "brand.com", "LEARNER", "/other", null, true),
                row("admin-x", "brand.com", "LEARNER", "/store", null, true));
        CatalogSiteResolver.Resolution r = CatalogSiteResolver.resolve(
                InstituteCatalogApiSettings.builder().siteTag("store").build(), rows, t -> true, () -> null, () -> null);
        assertEquals("https://old.brand.com/store", r.courseBaseUrl());
    }

    @Test
    void redirectTagReadsTheFirstSegment() {
        assertEquals("store", CatalogSiteResolver.redirectTag("/store"));
        assertEquals("store", CatalogSiteResolver.redirectTag("store/abc?x=1"));
        assertEquals("store", CatalogSiteResolver.redirectTag("https://learning.brahmvarchas.org/store"));
        assertNull(CatalogSiteResolver.redirectTag("/"));
        assertNull(CatalogSiteResolver.redirectTag(null));
    }

    @Test
    void baseUrlValidation() {
        assertEquals("https://learning.brahmvarchas.org/store",
                CatalogApiSettingsController.validateBaseUrl("https://learning.brahmvarchas.org/store/"));
        for (String bad : new String[]{"http://x.com", "https://x.com/?a=1", "https://x.com/#f", "ftp://x.com",
                "https:///nohost", "https://x.com/" + "a".repeat(500)}) {
            assertThrows(VacademyException.class, () -> CatalogApiSettingsController.validateBaseUrl(bad), bad);
        }
    }
}
